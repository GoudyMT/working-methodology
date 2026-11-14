#!/usr/bin/env node
// The resume packet (T3, 1.30.0). A new or compacted session used to re-read every tracking file that CLAUDE.md had
// already loaded, about 40,000 tokens before any work, because rule 11 must stop a session claiming a re-read it never
// made. The packet keeps that guard and moves the proof into a script: a fresh tool call that checks every file against
// the hash it had when the packet was written, so only what changed is read again.
//
//   write  saves .kit/resume-packet.md (about 2,048 bytes; the Resume Point, lessons and hash lines are never cut): the
//          sections built from the tracking files, the hash of each, and git. The closeout and the pre-compact hook run it.
//   check  prints the sections rebuilt NOW from the files (never the saved text), one line per file (same / CHANGED /
//          missing) against the saved hashes, git read live against the packet's, the orientation steps, and one line
//          that starts "VERDICT:" (read <files> | full reading: <files>).
//
// The saved packet supplies only its hashes and its git line; nothing else in it reaches the session, so an edited or
// padded packet changes nothing a session reads. Every printed line from a file starts with "| ", so no file can put a
// second VERDICT line in the output. Anything the check cannot tell (no packet, a list that is not the fixed one, a
// section or the plan not found, a refusal, a throw) is the full reading: it fails closed. It reports, never blocks:
// exit 0 always. Limits: a tracking file hard-linked to a file outside the project is read as the project's own
// (owners link vault files on purpose); the session that wrote the packet is recorded, not compared.
// Usage: node .claude/resume-packet.mjs write [--session <id>] | check     (run in the project folder)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const KIT = path.join(ROOT, '.kit');
const PACKET = path.join(KIT, 'resume-packet.md');
const STAMP = path.join(KIT, 'resume-check.json');
const MAX = 2048;
const MAX_FILE = 1 << 20;
// Always hashed, in this order; the plan the Resume Point names is added after them.
const FILES = ['_Start Here.md', '_Active Plan.md', '_Working Memory.md', '_Loop Learnings.md', '_Session Log.md', '_Master Roadmap.md'];
// The same list rule 11's fallback names (rules/_parts/agents-head.md); AGENTS.md is not in it: it loads at start.
export const FULL = '_Start Here.md, _Loop Learnings.md, _Working Memory.md, _Active Plan.md, the last _Session Log.md entry, the plan the Resume Point names';
// A repo's own config must not run a program (fsmonitor, a protocol helper; a clean filter runs only under status,
// which is not called), and git starts from Node's own folder, so a git.exe planted in the project is not the one found
// first on Windows. No optional locks: a hook must not take index.lock while the session commits. The ceiling keeps git
// from walking up into a parent repo when the project is not one.
const NO_PROGRAMS = ['-c', 'core.fsmonitor=false', '-c', 'protocol.allow=never',
	...['ext', 'file', 'ssh', 'git', 'http', 'https'].flatMap((p) => ['-c', `protocol.${p}.allow=never`])];
const git = (...a) => {
	const r = spawnSync('git', ['--no-optional-locks', '-C', ROOT, ...NO_PROGRAMS, ...a], { encoding: 'utf8', cwd: path.dirname(process.execPath), timeout: 10000, env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(ROOT) } });
	return r.status === 0 ? r.stdout.trim() : null;
};
const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
const real = (p) => { try { return fs.realpathSync.native(p); } catch { return null; } };

/** One file inside the project, opened once: its text and hash come from that one descriptor, never a second open. */
function open(rel, { single = false } = {}) {
	const full = path.join(ROOT, rel);
	const r = real(full);
	const root = real(ROOT);
	if (!r || !root) return null;
	const inside = path.relative(root, r);
	if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) return null;
	let fd;
	try {
		fd = fs.openSync(r, 'r');
		const st = fs.fstatSync(fd);
		if (!st.isFile() || st.size > MAX_FILE || (single && st.nlink > 1)) return null;
		const buf = Buffer.alloc(st.size);
		fs.readSync(fd, buf, 0, st.size, 0);
		return { text: buf.toString('utf8'), hash: crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16) };
	} catch { return null; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* closed */ } }
}
const read = (rel) => open(rel)?.text ?? null;
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
	const text = next || '';
	const raw = text.match(/\]\(<([^>]+\.md)(?:#[^>]*)?>\)|\]\(([^)\s#]+\.md)(?:#[^)\s]*)?\)|`([^`]+\.md)`|(?:^|\s)([\w./%-]+\.md)(?=[\s,.;:)]|$)/);
	if (!raw) return /\.md\b/i.test(text) ? { refused: '(a .md file the check cannot read as a path)' } : { plan: null };
	const shown = raw[1] || raw[2] || raw[3] || raw[4];
	let p = shown;
	try { p = decodeURIComponent(p); } catch { return { refused: shown }; }
	if (/\\|^[A-Za-z]:|^\/|(^|\/)\.\.(\/|$)/.test(p) || /[\0-\x1f\x7f-\x9f]/.test(p)) return { refused: shown };
	// The plan is read through one descriptor that is a plain file inside the project with one name only (a hard link
	// to a file outside would pass a path check).
	if (!open(p, { single: true })) return { refused: shown };
	return { plan: p.split(path.sep).join('/') };
}

/** The packet's sections, built only from the files: the same files always give the same text. */
export function sections() {
	const plan = read('_Active Plan.md');
	const memory = read('_Working Memory.md');
	const next = line(plan, 'NEXT') ?? line(memory, 'Resume Point');
	const where = planPath(next);
	const missing = [];
	const need = (v, what) => { if (v === null) missing.push(what); return v; };
	const s = {
		'Resume Point': [need(next, 'the Resume Point (**NEXT:** in _Active Plan.md or **Resume Point:** in _Working Memory.md)') ?? 'not found'],
		'Last session': [need(line(memory, 'Last Session'), '**Last Session:** in _Working Memory.md') ?? 'not found'],
		'Pending the owner': need(list(plan, 'Pending the owner'), '**Pending the owner:** in _Active Plan.md') ?? ['not found'],
		'Carry-overs': need(list(plan, 'Carry-overs from the last PR'), '**Carry-overs from the last PR** in _Active Plan.md') ?? ['not found'],
		'Open lessons': need(lessons(read('_Loop Learnings.md')), '## Open lessons in _Loop Learnings.md') ?? ['not found'],
		Plan: [where.plan ? `plan: ${where.plan}` : where.refused ? `plan: refused ${JSON.stringify(String(where.refused).slice(0, 80))}` : 'plan: none named'],
	};
	if (where.refused) missing.push(`the plan the Resume Point names (${JSON.stringify(String(where.refused).slice(0, 80))} is not a readable file inside the project)`);
	const files = [...FILES, ...(where.plan ? [where.plan] : [])];
	return { s, files, plan: where.plan, missing };
}
// What each section is built from: a trimmed section names these files for a fresh read.
const SOURCES = { 'Last session': ['_Working Memory.md'], 'Pending the owner': ['_Active Plan.md'], 'Carry-overs': ['_Active Plan.md'] };
// Trimmed first when over the size: never the Resume Point, the lessons, the plan or a hash line.
const TRIM = ['Pending the owner', 'Carry-overs', 'Last session'];

// Every line from a file is printed after "| ", so no file can start a line of the packet's or the check's own.
// Control characters and the Unicode line and paragraph separators become spaces first: a lone CR or a U+2028 would
// otherwise start a new line for a reader that splits on them.
const UNSAFE = new RegExp(`[\\x00-\\x1f\\x7f-\\x9f${String.fromCharCode(0x2028, 0x2029)}]`, 'g');
const quote = (l) => `| ${l.replace(UNSAFE, ' ')}`;
const render = (s) => Object.entries(s).map(([k, v]) => `## ${k}\n${v.map(quote).join('\n')}`).join('\n\n') + '\n';

/** Drop list lines from the end of the trimmable sections until the body fits; returns the trimmed section names. */
function fit(s, room) {
	const cut = [];
	for (const k of TRIM) {
		const all = s[k].length;
		let kept = s[k];
		while (Buffer.byteLength(render(s)) > room && kept.length > 0) {
			kept = kept.slice(0, -1);
			s[k] = [...kept, `- (${all - kept.length} more trimmed; read the file)`];
			if (!cut.includes(k)) cut.push(k);
		}
	}
	return cut;
}

function gitState() {
	// The project must be its own repo: git never reports a parent folder's branch as this project's.
	const top = git('rev-parse', '--show-toplevel');
	const root = real(ROOT);
	if (!top || !root || !same(real(top) || top, root)) return { branch: 'none', head: 'none', ahead: '-', behind: '-' };
	const branch = git('branch', '--show-current') || '(detached)';
	const head = (git('rev-parse', 'HEAD') || 'none').slice(0, 12);
	const counts = git('rev-list', '--left-right', '--count', '@{u}...HEAD');
	const [behind, ahead] = counts ? counts.split(/\s+/) : ['-', '-'];
	return { branch, head, ahead, behind };
}
const GIT_KEYS = ['branch', 'head', 'ahead', 'behind'];
const gitLine = (g) => GIT_KEYS.map((k) => `${k}: ${g[k]}`).join(' ');

/** .kit must be a real folder of this project, never a link that sends a write elsewhere. */
function kitDir({ create }) {
	try {
		const st = fs.lstatSync(KIT);
		if (st.isSymbolicLink() || !st.isDirectory()) throw new Error('.kit is a link or not a folder');
	} catch (e) {
		if (e.code !== 'ENOENT') throw e;
		if (!create) return false;
		fs.mkdirSync(KIT);
	}
	const r = real(KIT);
	const root = real(ROOT);
	if (!r || !root || !same(r, path.join(root, '.kit'))) throw new Error('.kit does not resolve inside the project');
	return true;
}

/** Write a .kit file by a fresh random name opened exclusively, then a rename: no planted name is written through. */
function save(file, text) {
	kitDir({ create: true });
	const tmp = path.join(KIT, `.resume-${crypto.randomBytes(8).toString('hex')}.tmp`);
	fs.writeFileSync(tmp, text, { flag: 'wx' });
	fs.renameSync(tmp, file);
}

function write(session) {
	const g = gitState();
	const head = ['# Resume packet', 'Start a session with: node .claude/resume-packet.mjs check', `written: ${new Date().toISOString()}`, `session: ${session || '-'}`, gitLine(g), '', ''].join('\n');
	const { s, files } = sections();
	fit(s, MAX - Buffer.byteLength(head) - files.length * 40);
	const hashes = files.map((f) => `${open(f)?.hash ?? 'missing'} ${f}`);
	const text = `${head}${render(s)}\n## Files\n${hashes.join('\n')}\n`;
	save(PACKET, text);
	const size = Buffer.byteLength(text);
	console.log(`resume packet written: .kit/resume-packet.md (${size} bytes${size > MAX ? `, over ${MAX}: the Resume Point, lessons and hashes are never cut` : ''})`);
}

const ORIENT = 'Then, before source-of-truth work (rule:post-compact-orientation): anti-duplication spot-check; ASCII scan; size-cap table (node .claude/tracking-check.mjs caps); log compression check; Sweep check (a branch near a PR without a current report: sweep first); Branch check (work on main: branch first); state the working mode and the first action.';
const full = (why) => console.log(`${why}\n\n${ORIENT}\nVERDICT: full reading: ${FULL}`);

/** The saved packet's only inputs to the check: its git line and its Files list. Null when it is not one write made. */
function parse(text) {
	const lines = text.split('\n');
	if (lines[0] !== '# Resume packet' || text.includes('\0')) return null;
	const g = (lines[4] || '').match(/^branch: (.*) head: (\S+) ahead: (\S+) behind: (\S+)$/);
	if (!g) return null;
	const at = lines.lastIndexOf('## Files');
	if (at < 0) return null;
	const files = new Map();
	for (const l of lines.slice(at + 1)) {
		if (!l) continue;
		const m = l.match(/^([0-9a-f]{16}|missing) (.+)$/);
		if (!m || files.has(m[2])) return null;
		files.set(m[2], m[1]);
	}
	return { git: { branch: g[1], head: g[2], ahead: g[3], behind: g[4] }, files };
}

function check() {
	let text;
	try {
		if (!kitDir({ create: false })) return full('No resume packet at .kit/resume-packet.md (no closeout or compact has written one).');
		text = fs.readFileSync(PACKET, 'utf8');
	} catch (e) {
		return full(e.code === 'ENOENT' ? 'No resume packet at .kit/resume-packet.md (no closeout or compact has written one).' : `The resume packet cannot be read (${String(e.message).slice(0, 80)}).`);
	}
	const saved = parse(text);
	if (!saved) return full('The resume packet is not one this script wrote.');
	// The saved list must be the fixed one, plus at most one plan: a dropped or added line changes nothing checked.
	const extra = [...saved.files.keys()].filter((f) => !FILES.includes(f));
	if (FILES.some((f) => !saved.files.has(f)) || extra.length > 1) return full('The resume packet\'s file list is not the fixed one.');
	const now = sections();
	if (now.missing.length) return full(`The check cannot find: ${now.missing.join('; ')}.`);
	const s = { ...now.s };
	const cut = fit(s, MAX);
	const out = ['Rebuilt now from the files (the saved packet text is never shown):', '', render(s).trimEnd(), '', '--- check against the packet ---'];
	const state = {};
	for (const f of now.files) {
		const h = open(f)?.hash ?? null;
		state[f] = h === null ? 'missing' : !saved.files.has(f) ? 'CHANGED' : h === saved.files.get(f) ? 'same' : 'CHANGED';
		out.push(`${state[f]} ${f}`);
	}
	const g = gitState();
	for (const k of GIT_KEYS) out.push(`git ${k}: ${g[k] === saved.git[k] ? 'same' : `CHANGED (packet ${saved.git[k]}, now ${g[k]})`}`);
	const readList = [];
	const add = (f) => { if (f && !readList.includes(f)) readList.push(f); };
	add(now.plan);
	for (const f of FILES) if (state[f] !== 'same') add(f);
	for (const k of cut) for (const f of SOURCES[k] || []) add(f);
	try { save(STAMP, `${JSON.stringify({ checked: new Date().toISOString() })}\n`); } catch { /* the stamp is only the use check's trace */ }
	console.log(`${out.join('\n')}\n\n${ORIENT}\nVERDICT: read ${readList.length ? readList.join(', ') : 'nothing more'}`);
}

const [cmd, ...rest] = process.argv.slice(2);
try {
	if (cmd === 'write') write(rest[0] === '--session' ? String(rest[1] || '').replace(/[^\w.-]/g, '').slice(0, 64) : '');
	else if (cmd === 'check') check();
	else console.log('usage: node .claude/resume-packet.mjs write [--session <id>] | check');
} catch (e) {
	// A check that throws still ends in a verdict: the full reading.
	if (cmd === 'check') full(`The check could not run (${String(e.message).slice(0, 120)}).`);
	else console.log(`resume packet not written: ${String(e.message).slice(0, 120)}`);
}
process.exitCode = 0;
