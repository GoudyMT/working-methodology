#!/usr/bin/env node
// The resume packet (T3, 1.30.0). A new or compacted session used to re-read every tracking file that CLAUDE.md had
// already loaded, about 40,000 tokens before any work, because rule 11 must stop a session claiming a re-read it never
// made. The packet keeps that guard and moves the proof into a script: a fresh tool call that checks every file against
// the hash it had when the packet was written, so only what changed is read again. The Active Plan and every file the
// Resume Point names (at most 3) are read every time (1.30.1): the sections shown are a preview, never a stand-in.
//
//   write  saves .kit/resume-packet.md (about 2,048 bytes; the lessons and hash lines are never cut): the sections
//          built from the tracking files, the hash of each, and git. The closeout and the pre-compact hook run it; it
//          names any label or file name a check could not read.
//   check  prints the sections rebuilt NOW from the files (never the saved text), one line per file (same / CHANGED /
//          missing) against the saved hashes, git read live against the packet's, the orientation steps, and one line
//          that starts "VERDICT:" (read <files> | full reading: <files>).
//
// The saved packet supplies only its hashes and its git line; nothing else in it reaches the session, so an edited or
// padded packet changes nothing a session reads. Every printed line from a file starts with "| ", and every reason is
// cleaned of line breaks, so no file can put a second VERDICT line in the output. Anything the check cannot tell (no
// packet, a list that is not the fixed one, no Resume Point, a file name it cannot read, a throw) is the full reading:
// it fails closed; a section label not found names its file for a read. It reports, never blocks:
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
// CM6 (a): the state file, hashed when the project has one, so a state change with no view rendered is named.
const STATE_FILE = '_State.json';
const hasState = () => fs.existsSync(path.join(ROOT, STATE_FILE));
// The same list rule 11's fallback names (rules/_parts/agents-head.md); AGENTS.md is not in it: it loads at start.
export const FULL = '_Start Here.md, _Loop Learnings.md, _Working Memory.md, _Active Plan.md, the plan the Resume Point names';
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
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The line that starts the next section ends the one above it: a bold label, a heading or a rule.
const STOP = /^(\*\*[^*\n]+(?::\*\*|\*\*:)|#{1,6} |-{3,}\s*$)/;
/**
 * A bold label's text, shown to the session: what follows the label on its line, then the lines under it up to a blank
 * line or the next section. The label is `**Name:**` or `**Name**:`; a list label may carry a note in brackets
 * (`**Carry-overs from the last PR (...):**`). Null when the label is not there. Nothing the session must not miss rests
 * on this reading (the 1.30.0 verify and the 1.30.1 sweep found a dozen shapes it misreads): the check always names
 * _Active Plan.md, and every file the Resume Point names, for a fresh read.
 */
function block(text, label, { note = false } = {}) {
	const head = new RegExp(`^\\*\\*${esc(label)}${note ? '(?: \\([^)\\n]*\\))?' : ''}(?::\\*\\*|\\*\\*:)`);
	const lines = (text || '').split(/\r?\n/);
	const at = lines.findIndex((l) => head.test(l));
	if (at < 0) return null;
	const out = [];
	const rest = lines[at].replace(head, '').trim();
	if (rest) out.push(rest);
	for (const l of lines.slice(at + 1)) { if (!l.trim() || STOP.test(l)) break; out.push(l.trimEnd()); }
	return out;
}
const nonEmpty = (b) => (b && b.length ? b : null);

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

/**
 * Every file the Resume Point names: project-relative paths inside the project, the fixed files left out, at most
 * MAX_NAMED; or refused, which means the full reading. No file is guessed to be "the" plan (the 1.30.1 sweep: every
 * guess picked a wrong file on some wording): each one named is hashed and read. A .md name left over once the readable
 * forms are taken out means the check cannot tell, so it refuses.
 */
function planPaths(text) {
	if (text.length > 4000) return { refused: 'a Resume Point over 4,000 characters' };
	let rest = text;
	const named = [];
	const take = (re) => { rest = rest.replace(re, (_, p) => { named.push(p); return ' '; }); };
	take(/\[[^\]\n]*\]\(<([^>\n]+?\.md)(?:#[^>\n]*)?>\)/g); // [text](<path>)
	take(/\[[^\]\n]*\]\(([^)<\n]+?\.md)(?:#[^)\n]*)?\)/g); // [text](path), spaces allowed as the kit writes them
	take(/`([^`\n]+?\.md)`/g); // `path`
	take(/(?<=^|\s)([\w./%-]+\.md)(?=[\s,.;:)]|$)/gm); // a bare path
	if (/\.md\b/i.test(rest)) return { refused: 'a .md name the check cannot read as a path' };
	const plans = [];
	for (const shown of named) {
		const q = JSON.stringify(shown.slice(0, 80));
		let p;
		try { p = decodeURIComponent(shown).replace(/^\.\//, ''); } catch { return { refused: `${q} cannot be decoded` }; }
		// A colon anywhere: a drive, a URL or an NTFS stream. Dot segments, a leading slash, a backslash or a control
		// character: never a plain path inside the project.
		if (/[\\:]|^\/|(^|\/)\.\.?(\/|$)/.test(p) || new RegExp(UNSAFE.source).test(p)) return { refused: `${q} is not a plain path` };
		if (FILES.includes(p) || plans.includes(p)) continue;
		// Read through one descriptor that is a plain file inside the project with one name only (a hard link to a file
		// outside would pass a path check).
		if (!open(p, { single: true })) return { refused: `${q} is not a readable file inside the project` };
		plans.push(p);
	}
	if (plans.length > MAX_NAMED) return { refused: `${plans.length} files named, more than ${MAX_NAMED}` };
	return { plans };
}
const MAX_NAMED = 3;
const SHOW_LINES = 40;
const SHOW_CHARS = 400;

/** The packet's sections, built only from the files: the same files always give the same text. */
export function sections() {
	const plan = read('_Active Plan.md');
	const memory = read('_Working Memory.md');
	const fromPlan = nonEmpty(block(plan, 'NEXT'));
	const next = fromPlan ?? nonEmpty(block(memory, 'Resume Point'));
	const where = planPaths(next ? next.join('\n') : '');
	// What the check cannot tell means the full reading; a section it cannot rebuild names its file for a read.
	const missing = [];
	const reads = [];
	// Which of them a label not found put there, apart from a preview cut (K53: write called a cut a missing label).
	const lost = [];
	// A preview is at most SHOW_LINES lines of SHOW_CHARS characters: a longer section is cut and its file named for a
	// read, so a huge file can never make the trim below slow (the 1.30.1 sweep timed a 40,000-line list at 55 s).
	const shown = (v, file) => {
		if (v === null) { reads.push(file); lost.push(file); return [`- (not found: ${file} is named for a read)`]; }
		if (!v.length) return ['- (nothing under the label)'];
		if (v.length > SHOW_LINES || v.some((l) => l.length > SHOW_CHARS)) {
			reads.push(file);
			return [...v.slice(0, SHOW_LINES).map((l) => l.slice(0, SHOW_CHARS)), `- (cut here: ${file} is named for a read)`];
		}
		return v;
	};
	if (!next) missing.push('the Resume Point (**NEXT:** in _Active Plan.md or **Resume Point:** in _Working Memory.md)');
	if (where.refused) missing.push(`the files the Resume Point names: ${where.refused}`);
	const s = {
		'Resume Point': next ? shown(next, fromPlan ? '_Active Plan.md' : '_Working Memory.md') : ['not found'],
		'Last session': shown(nonEmpty(block(memory, 'Last Session')), '_Working Memory.md'),
		'Pending the owner': shown(block(plan, 'Pending the owner'), '_Active Plan.md'),
		'Carry-overs': shown(block(plan, 'Carry-overs from the last PR', { note: true }), '_Active Plan.md'),
		'Open lessons': shown(lessons(read('_Loop Learnings.md')), '_Loop Learnings.md'), // never trimmed, but cut like the rest
		Plan: where.plans?.length ? where.plans.map((p) => `plan: ${p}`) : ['plan: none named'],
	};
	const plans = where.plans || [];
	return { s, files: [...FILES, ...(hasState() ? [STATE_FILE] : []), ...plans], plans, reads, lost, missing, resumeFrom: fromPlan ? '_Active Plan.md' : '_Working Memory.md' };
}
// What each section is built from: a trimmed section names these files for a fresh read.
const SOURCES = { 'Last session': ['_Working Memory.md'], 'Pending the owner': ['_Active Plan.md'], 'Carry-overs': ['_Active Plan.md'] };
// Trimmed first when over the size; never the lessons, the plan or a hash line. The Resume Point goes last.
const TRIM = ['Pending the owner', 'Carry-overs', 'Last session', 'Resume Point'];

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

// closed (K112, 1.42.0): the closeout ended its task, so a session resumed later is told to start fresh.
function write(session, closed = false) {
	const g = gitState();
	const at = new Date().toISOString();
	const head = ['# Resume packet', 'Start a session with: node .claude/resume-packet.mjs check', `written: ${at}`, `session: ${session || '-'}`, ...(closed ? [`closed: ${at}`] : []), gitLine(g), '', ''].join('\n');
	const { s, files, missing, reads, lost } = sections();
	fit(s, MAX - Buffer.byteLength(head) - files.length * 40);
	const hashes = files.map((f) => `${open(f)?.hash ?? 'missing'} ${f}`);
	const text = `${head}${render(s)}\n## Files\n${hashes.join('\n')}\n`;
	save(PACKET, text);
	const size = Buffer.byteLength(text);
	console.log(`resume packet written: .kit/resume-packet.md (${size} bytes${size > MAX ? `, over ${MAX}: the lessons and hashes are never cut` : ''})`);
	// Said at write time, so the closeout fixes the file (step 5) instead of every later session paying for it.
	if (missing.length) console.log(clean(`fix before the next session: a check now is the full reading, it cannot tell ${missing.join('; ')}`));
	if (lost.length) console.log(clean(`fix before the next session: a section label is not found, so a check names ${[...new Set(lost)].join(', ')} for a read`));
	const cut = [...new Set(reads)].filter((x) => !lost.includes(x));
	if (cut.length) console.log(clean(`a long section is cut in the preview, as designed, so a check names ${cut.join(', ')} for a read; nothing to fix`));
}

const ORIENT = 'Then, before source-of-truth work (rule:post-compact-orientation): anti-duplication spot-check; ASCII scan; size-cap table (node .claude/tracking-check.mjs caps); log compression check; Sweep check (a branch near a PR without a current report: sweep first); Branch check (work on main: branch first); state the working mode and the first action.';
// A reason can carry a path from a file: no character in it may start a line of its own.
const clean = (t) => t.replace(UNSAFE, ' ');
const full = (why) => console.log(`${clean(why)}\n\n${ORIENT}\nVERDICT: full reading: ${FULL}`);

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
	// The saved list must be the fixed one, plus at most the files a Resume Point may name: a dropped or added line
	// changes nothing checked.
	const extra = [...saved.files.keys()].filter((f) => !FILES.includes(f) && f !== STATE_FILE);
	if (FILES.some((f) => !saved.files.has(f)) || extra.length > MAX_NAMED) return full('The resume packet\'s file list is not the fixed one.');
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
	// A state file the packet hashed and that is gone now is named as missing.
	if (saved.files.has(STATE_FILE) && !now.files.includes(STATE_FILE)) { state[STATE_FILE] = 'missing'; out.push(`missing ${STATE_FILE}`); }
	const g = gitState();
	for (const k of GIT_KEYS) out.push(`git ${k}: ${g[k] === saved.git[k] ? 'same' : `CHANGED (packet ${saved.git[k]}, now ${g[k]})`}`);
	const readList = [];
	const add = (f) => { if (f && !readList.includes(f)) readList.push(f); };
	// The Active Plan always: it holds what waits on the owner, and no parsed section may stand in for it (the owner,
	// 2026-11-14, after the 1.30.1 sweep). Then every file the Resume Point names, what changed, and the source of
	// any section trimmed or not found.
	add('_Active Plan.md');
	for (const p of now.plans) add(p);
	for (const f of FILES) if (state[f] !== 'same') add(f);
	if (state[STATE_FILE] !== undefined && state[STATE_FILE] !== 'same') add(STATE_FILE);
	for (const k of cut) for (const f of k === 'Resume Point' ? [now.resumeFrom] : SOURCES[k] || []) add(f);
	for (const f of now.reads) add(f);
	try { save(STAMP, `${JSON.stringify({ checked: new Date().toISOString() })}\n`); } catch { /* the stamp is only the use check's trace */ }
	console.log(`${out.join('\n')}\n\n${ORIENT}\nVERDICT: read ${readList.length ? readList.join(', ') : 'nothing more'}`);
}

const [cmd, ...rest] = process.argv.slice(2);
try {
	// The options in any order (the build 16 sweep: --closed first dropped the session; --session --closed recorded it).
	const at = rest.indexOf('--session');
	const id = at >= 0 && rest[at + 1] && !rest[at + 1].startsWith('--') ? rest[at + 1] : '';
	if (cmd === 'write') write(String(id).replace(/[^\w.-]/g, '').slice(0, 64), rest.includes('--closed'));
	else if (cmd === 'check') check();
	else console.log('usage: node .claude/resume-packet.mjs write [--session <id>] [--closed] | check');
} catch (e) {
	// A check that throws still ends in a verdict: the full reading.
	if (cmd === 'check') full(`The check could not run (${String(e.message).slice(0, 120)}).`);
	else console.log(`resume packet not written: ${String(e.message).slice(0, 120)}`);
}
process.exitCode = 0;
