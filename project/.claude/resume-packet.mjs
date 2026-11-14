#!/usr/bin/env node
// The resume packet (T3, 1.30.0). A new or compacted session used to re-read every tracking file that CLAUDE.md had
// already loaded, about 40,000 tokens before any work, because rule 11 must stop a session claiming a re-read it never
// made. The packet keeps that guard and moves the proof into a script: a fresh tool call that checks every file against
// the hash it had when the packet was written, so only what changed is read again.
//
//   write  builds .kit/resume-packet.md (at most 2,048 bytes) from the tracking files and git. The closeout and the
//          pre-compact hook run it.
//   check  prints the packet, then one line per file (same / CHANGED / missing), the git state read live against the
//          packet's, the orientation steps, and one last line: VERDICT: read <files> | full reading: <files>.
//
// The check never trusts the packet: its file list must be the fixed one, and every section whose source file is
// unchanged must rebuild to the same text, or the verdict is the full reading. Any failure is the full reading too, so
// it fails closed. It reports, never blocks: exit 0 always.
// Usage: node .claude/resume-packet.mjs write [--session <id>] | check     (run in the project folder)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const PACKET = path.join(ROOT, '.kit', 'resume-packet.md');
const MAX = 2048;
// Always hashed, in this order; the plan the Resume Point names is added after them.
const FILES = ['_Start Here.md', '_Active Plan.md', '_Working Memory.md', '_Loop Learnings.md', '_Session Log.md', '_Master Roadmap.md'];
const FULL = '_Start Here.md, AGENTS.md, _Loop Learnings.md, _Working Memory.md, _Active Plan.md, the last _Session Log.md entry, the plan the Resume Point names';
// A repo's own config must not run a program (fsmonitor, a protocol helper), and git starts from Node's own folder,
// so a git.exe planted in the project is not the one found first on Windows. No optional locks: a hook must not take
// index.lock while the session commits.
const NO_PROGRAMS = ['-c', 'core.fsmonitor=false', '-c', 'protocol.allow=never',
	...['ext', 'file', 'ssh', 'git', 'http', 'https'].flatMap((p) => ['-c', `protocol.${p}.allow=never`])];
const git = (...a) => {
	const r = spawnSync('git', ['--no-optional-locks', '-C', ROOT, ...NO_PROGRAMS, ...a], { encoding: 'utf8', cwd: path.dirname(process.execPath), timeout: 10000 });
	return r.status === 0 ? r.stdout.trim() : null;
};

const read = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return null; } };
const hash = (rel) => { try { return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex').slice(0, 16); } catch { return null; } };
const line = (text, label) => (text?.match(new RegExp(`^\\*\\*${label}:\\*\\* *(.*)$`, 'm')) || [])[1]?.trim() ?? null;

/** The "- " lines right under a bold label, up to the first blank line. */
function list(text, label) {
	const lines = (text || '').split(/\r?\n/);
	const at = lines.findIndex((l) => l.startsWith(`**${label}`));
	if (at < 0) return null;
	const out = [];
	for (const l of lines.slice(at + 1)) { if (!l.trim()) break; if (l.startsWith('- ')) out.push(l); }
	return out;
}

/** Each open lesson: its title and its never / always line. Never trimmed. */
function lessons(text) {
	const m = (text || '').match(/^## Open lessons\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m);
	if (!m) return null;
	const out = [];
	for (const e of m[1].split(/^### /m).slice(1)) {
		const title = e.split(/\r?\n/)[0].replace(/\s*\|\s*open\s*$/i, '').trim();
		const rule = (e.match(/^- Rule \(never\/always\): *(.*)$/m) || [])[1] || '(no rule line)';
		out.push(`- ${title}`, `  ${rule.trim()}`);
	}
	return out.length ? out : ['- none open'];
}

/** The plan file the Resume Point names: a project-relative path, forward slashes, inside the project, or refused. */
function planPath(next) {
	const raw = (next || '').match(/\]\(([^)\s]+\.md)\)|`([^`]+\.md)`/);
	if (!raw) return { plan: null };
	let p = raw[1] || raw[2];
	try { p = decodeURIComponent(p); } catch { return { refused: p }; }
	if (/\\|^[A-Za-z]:|^\/|(^|\/)\.\.(\/|$)/.test(p) || /[\0-\x1f]/.test(p)) return { refused: p };
	const full = path.resolve(ROOT, p);
	let real;
	try { real = fs.realpathSync(full); } catch { return { refused: p }; }
	const rel = path.relative(fs.realpathSync(ROOT), real);
	if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || !fs.statSync(real).isFile()) return { refused: p };
	return { plan: p };
}

/** The packet's sections, built only from the files: the same files always give the same text. */
export function sections() {
	const plan = read('_Active Plan.md');
	const memory = read('_Working Memory.md');
	const next = line(plan, 'NEXT') ?? line(memory, 'Resume Point');
	const where = planPath(next);
	const s = {
		'Resume Point': [next ?? 'not found in _Active Plan.md (**NEXT:**) or _Working Memory.md (**Resume Point:**)'],
		'Last session': [line(memory, 'Last Session') ?? 'not found in _Working Memory.md (**Last Session:**)'],
		'Pending the owner': list(plan, 'Pending the owner') ?? ['not found in _Active Plan.md'],
		'Carry-overs': list(plan, 'Carry-overs from the last PR') ?? ['not found in _Active Plan.md'],
		'Open lessons': lessons(read('_Loop Learnings.md')) ?? ['not found in _Loop Learnings.md (## Open lessons)'],
		Plan: [where.plan ? `plan: ${where.plan}` : where.refused ? `plan: refused (${where.refused.slice(0, 80)})` : 'plan: none named'],
	};
	const files = [...FILES, ...(where.plan ? [where.plan] : [])];
	s.Files = files.map((f) => `${hash(f) ?? 'missing'} ${f}`);
	return { s, files, plan: where.plan };
}
// What each section is built from: a section is checked against its rebuild only while these are unchanged.
const SOURCES = { 'Resume Point': ['_Active Plan.md', '_Working Memory.md'], 'Last session': ['_Working Memory.md'], 'Pending the owner': ['_Active Plan.md'], 'Carry-overs': ['_Active Plan.md'], 'Open lessons': ['_Loop Learnings.md'], Plan: ['_Active Plan.md', '_Working Memory.md'] };
// Trimmed first when over the size: never the Resume Point, the lessons, the plan or a hash line.
const TRIM = ['Last session', 'Carry-overs', 'Pending the owner'];

const render = (s) => Object.entries(s).map(([k, v]) => `## ${k}\n${v.join('\n')}`).join('\n\n') + '\n';

/** Drop list lines from the end of the trimmable sections until the body fits beside the header. */
function fit(s, room) {
	for (const k of TRIM) {
		const all = s[k];
		while (Buffer.byteLength(render(s)) > room && s[k].length > 1) {
			const kept = s[k].filter((l) => !l.startsWith('- (')).slice(0, -1);
			s[k] = [...kept, `- (${all.length - kept.length} more trimmed; see the file)`];
			if (kept.length === 0) break;
		}
	}
	return s;
}

function gitState() {
	const branch = git('branch', '--show-current') || '(detached)';
	const head = (git('rev-parse', 'HEAD') || 'none').slice(0, 12);
	const dirty = git('status', '--porcelain', '--untracked-files=no');
	const counts = git('rev-list', '--left-right', '--count', '@{u}...HEAD');
	const [behind, ahead] = counts ? counts.split(/\s+/) : ['-', '-'];
	return { branch, head, clean: dirty === null ? '?' : dirty ? 'no' : 'yes', ahead, behind };
}
const gitLine = (g) => `branch: ${g.branch} head: ${g.head} clean: ${g.clean} ahead: ${g.ahead} behind: ${g.behind}`;

function write(session) {
	const g = gitState();
	const head = ['# Resume packet', 'Start a session with: node .claude/resume-packet.mjs check', `written: ${new Date().toISOString()}`, `session: ${session || '-'}`, gitLine(g), '', ''].join('\n');
	const { s } = sections();
	const body = render(fit(s, MAX - Buffer.byteLength(head)));
	const text = head + body;
	fs.mkdirSync(path.dirname(PACKET), { recursive: true });
	// A temp file and a rename: a session never reads a half-written packet.
	const tmp = `${PACKET}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, text);
	fs.renameSync(tmp, PACKET);
	const size = Buffer.byteLength(text);
	console.log(`resume packet written: .kit/resume-packet.md (${size} bytes${size > MAX ? `, over ${MAX}: the Resume Point, lessons and hashes are never cut` : ''})`);
}

const ORIENT = 'Then, before source-of-truth work (rule:post-compact-orientation): anti-duplication spot-check; ASCII scan; size-cap table (node .claude/tracking-check.mjs caps); log compression check; Sweep check (a branch near a PR without a current report: sweep first); Branch check (work on main: branch first); state the working mode and the first action.';

/** Split a saved packet into its header lines and its sections, or null when it is not one. */
function parse(text) {
	if (!text.startsWith('# Resume packet\n') || text.includes('\0')) return null;
	const out = { sections: {} };
	const g = text.match(/^branch: (.*) head: (\S+) clean: (\S+) ahead: (\S+) behind: (\S+)$/m);
	if (!g) return null;
	out.git = { branch: g[1], head: g[2], clean: g[3], ahead: g[4], behind: g[5] };
	for (const part of text.split(/^## /m).slice(1)) {
		const [name, ...rest] = part.replace(/\n+$/, '').split('\n');
		out.sections[name] = rest;
	}
	return out;
}

function check() {
	const full = (why) => { console.log(`${why}\n\n${ORIENT}\nVERDICT: full reading: ${FULL}`); };
	let text;
	try { text = fs.readFileSync(PACKET, 'utf8'); } catch { return full('No resume packet at .kit/resume-packet.md (no closeout or compact has written one).'); }
	const saved = parse(text);
	if (!saved || !saved.sections.Files) return full('The resume packet is not one this script wrote.');
	const now = sections();
	const out = [text.trimEnd(), '', '--- check ---'];
	// The file list is the fixed one, never the packet's own: a dropped line cannot shrink what is checked.
	const listed = new Map(saved.sections.Files.map((l) => { const i = l.indexOf(' '); return [l.slice(i + 1), l.slice(0, i)]; }));
	const wanted = [...FILES, ...(saved.sections.Plan?.[0]?.startsWith('plan: ') && !/^plan: (none|refused)/.test(saved.sections.Plan[0]) ? [saved.sections.Plan[0].slice(6)] : [])];
	if (wanted.some((f) => !listed.has(f)) || listed.size !== wanted.length) return full(`${text.trimEnd()}\n\n--- check ---\npacket text: CHANGED (its file list is not the fixed one)`);
	const state = {};
	for (const f of wanted) {
		const h = hash(f);
		state[f] = h === null ? 'missing' : h === listed.get(f) ? 'same' : 'CHANGED';
		out.push(`${state[f]} ${f}`);
	}
	// Every section whose sources are unchanged must rebuild to the saved text, trimmed the same way.
	const rebuilt = fit({ ...now.s }, MAX - (Buffer.byteLength(text) - Buffer.byteLength(text.slice(text.indexOf('## ')))));
	const edited = Object.keys(SOURCES).filter((k) => SOURCES[k].every((f) => state[f] === 'same') && JSON.stringify(rebuilt[k]) !== JSON.stringify(saved.sections[k]));
	if (edited.length) return full(`${out.join('\n')}\npacket text: CHANGED (${edited.join(', ')} does not match its unchanged source)`);
	out.push('packet text: same');
	const g = gitState();
	for (const k of ['branch', 'head', 'clean', 'ahead', 'behind']) out.push(`git ${k}: ${g[k] === saved.git[k] ? 'same' : `CHANGED (packet ${saved.git[k]}, now ${g[k]})`}`);
	const read = [...(now.plan && state[now.plan] !== 'missing' ? [now.plan] : []), ...FILES.filter((f) => state[f] !== 'same')];
	if (now.plan && state[now.plan] && state[now.plan] !== 'same' && !read.includes(now.plan)) read.push(now.plan);
	console.log(`${out.join('\n')}\n\n${ORIENT}\nVERDICT: read ${read.length ? read.join(', ') : 'nothing more'}`);
}

const [cmd, ...rest] = process.argv.slice(2);
try {
	if (cmd === 'write') write(rest[0] === '--session' ? String(rest[1] || '').replace(/[^\w.-]/g, '').slice(0, 64) : '');
	else if (cmd === 'check') check();
	else console.log('usage: node .claude/resume-packet.mjs write [--session <id>] | check');
} catch (e) {
	// A check that throws still ends in a verdict: the full reading.
	if (cmd === 'check') console.log(`The check could not run (${String(e.message).slice(0, 120)}).\n\n${ORIENT}\nVERDICT: full reading: ${FULL}`);
	else console.log(`resume packet not written: ${String(e.message).slice(0, 120)}`);
}
process.exitCode = 0;
