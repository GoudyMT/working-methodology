#!/usr/bin/env node
// State as data (T4, 1.34.0). On 1.33.1 four tracking files stated the next action by hand, and three of them were
// two releases stale while the fourth was current: every closeout edited some and missed others. Now the next action,
// what waits on the owner, the carry-overs and the kit version live once, in _State.json, and the owner's decisions in
// _Decisions.jsonl with an id, the words and the reason. The Resume Point in _Active Plan.md and the dashboard lines in
// _Working Memory.md are generated between markers from the data; text outside the markers stays the owner's.
//
// Two lists keep apart what blocks work and what only waits (E15): "blocking" needs the owner before work goes on,
// "waiting" needs the owner's eyes sometime and work goes on.
//
// Usage (from the project folder; one command per call, never chained):
//   node .claude/state.mjs show [--json]                     the next action, what blocks, what waits
//   node .claude/state.mjs set next|then|phase|last-session|kit <text>
//   node .claude/state.mjs add blocking|waiting|carry <text>  prints the new id (B-n, W-n, C-n; never given twice)
//   node .claude/state.mjs done <id>                          removes an item
//   node .claude/state.mjs decide --from <file.json> [--unchecked]
//        the file holds { "decision", "words", "why", "supersedes"? }; it is read, recorded and removed. The words
//        must be found word for word in one of the owner's messages or pop-up answers in this session's transcript;
//        --unchecked records them marked "as the session recorded them, not checked" instead.
//   node .claude/state.mjs decisions [text]                   the decisions, or those that contain the text
//   node .claude/state.mjs render [--overwrite]               writes the generated blocks from the data; refuses a
//                                                              block edited by hand since the last render
//   node .claude/state.mjs check                              exit 1 on any fault below
//   node .claude/state.mjs init                               once, in a project from before 1.34.0: moves the
//                                                              filled-in Resume Point into the data and marks the blocks
// The improvement list and the roadmap (1.35.0, list-data.mjs holds the shape and the reasons):
//   node .claude/state.mjs list [text] [--all]                the open rows, ranked (or every row), one short line each
//   node .claude/state.mjs list --agent | --full              one JSON line a row with short fields | the whole titles
//   node .claude/state.mjs step move <step> before|after <step>   place a roadmap step (by its name or release)
//   node .claude/state.mjs list --step <step>                 one roadmap step's rows (its name, build number or release)
//   node .claude/state.mjs list shorten                       once: a short name for each row from before 1.36.0
//   node .claude/state.mjs item <id> [--json]                 the whole row
//   node .claude/state.mjs list caught | audit                the catch rate and found to shipped by origin; the rows
//                                                              still owed a label
//   node .claude/state.mjs list import <file.md>              once: a markdown list into _List.jsonl, whole or not at all
//   node .claude/state.mjs item add --from <file.json>        a new row, every label it owes included
//   node .claude/state.mjs item set <id> <field> <value>      tag ("done 1.35.0"), caught-by, escaped, measured, origin ...
//   node .claude/state.mjs step set <step> release|carries|state <text>
//   node .claude/state.mjs step rename <step or release> <new name>
// render also writes the roadmap, counts and rows blocks (list:begin markers) in any of the project's markdown files.
//
// What check proves: each generated block equals what the data renders; no label a session reads (NEXT, Pending the
// owner ...) sits outside its block; the kit version in the data is the one installed; every item id is well formed;
// every decision row is whole and the committed rows are unchanged (where git has a copy); each row that claims the
// owner's words has them in the owner's turn its record points to (where that transcript is on this machine); every
// D-n named in a tracking file has a row. What it cannot see: whether the next action is still true, a note relayed
// into the owner's turn by another agent, a ruling contradicted without --supersedes, whether a
// pointer means the ruling it lands on, and pointers outside the tracking files.
// Exit 0 done or passed, 1 refused or a check fault, 2 a usage error.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as list from './list-data.mjs';
import { retiredHits, retiredList, hitLine } from './retired-check.mjs';

const STATE = '_State.json';
// install project fills this in, so a caller cannot move the transcripts with CLAUDE_CONFIG_DIR (as owner-yes.cjs).
const INSTALLED_HOME = "{{CLAUDE_HOME}}";
const installed = !INSTALLED_HOME.startsWith('{' + '{');
// K78 (1.36.0): the project read is where the shell stands when that is a project; run from outside any project, an
// installed copy reads its own project (the folder above its .claude), never the kit's template folder. On 1.35.0 a
// run from another folder said "no _List.jsonl", which reads as an empty list.
const isProject = (d) => ['_State.json', '_List.jsonl'].some((f) => fs.existsSync(path.join(d, f)));
const OWN = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = !isProject(process.cwd()) && installed && isProject(OWN) ? OWN : process.cwd();
const DECISIONS = '_Decisions.jsonl';
const PLAN = '_Active Plan.md';
const MEMORY = '_Working Memory.md';
// The tracking files a D-n pointer may sit in.
const TRACKING = ['_Start Here.md', PLAN, MEMORY, '_Loop Learnings.md', '_Session Log.md', '_Master Roadmap.md', STATE, list.LIST];
const BEGIN = '<!-- state:begin: generated by .claude/state.mjs from _State.json; change it with state.mjs, never by hand -->';
const END = '<!-- state:end -->';
const IS_BEGIN = /^<!-- state:begin\b.*-->$/;
const IS_END = /^<!-- state:end -->$/;
const KINDS = { blocking: 'B', waiting: 'W', carry: 'C' };
const LIST = { B: 'blocking', W: 'waiting', C: 'carry_overs' };
const FIELDS = { next: 'next', then: 'then', phase: 'phase', 'last-session': 'last_session', kit: 'kit' };
// The labels the resume packet and a session read (resume-packet.mjs): a generated block keeps them word for word.
const CARRY = 'Carry-overs from the last PR';
const CARRY_LABEL = `**${CARRY} (only those the owner said yes to; close in this run):**`;
const WAITING = 'Waiting for the owner\'s eyes';
const LABELS = { [PLAN]: ['Updated', 'NEXT', 'Then', CARRY, 'Pending the owner', WAITING], [MEMORY]: ['Last Session', 'Kit', 'Current Phase', 'Resume Point'] };
const claudeHome = () => (installed ? INSTALLED_HOME : process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));

const today = () => new Date().toISOString().slice(0, 10);
const file = (rel) => path.join(ROOT, rel);
const readText = (rel) => { try { return fs.readFileSync(file(rel), 'utf8'); } catch { return null; } };
const placeholder = (v) => /^<.*>$/.test(String(v ?? ''));
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex').slice(0, 16);
// One line of plain text: no line break of any kind (C0, C1, the Unicode line and paragraph separators), and no comment
// marker that could end a block early or start a new one.
const clean = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/<!--/g, '<! --').replace(/-->/g, '-- >').replace(/\s+/g, ' ').trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A label as the packet reads it, with an optional note in brackets: **Name:**, **Name**: or **Name (note):**.
const labelRe = (name) => new RegExp(`^\\*\\*${esc(name)}(?: \\(([^)\\n]*)\\))?(?::\\*\\*|\\*\\*:)\\s*`);

/**
 * Write a file whole: a temporary file with a random name, made new (never through a planted name), then renamed over
 * the target. A target that is a link is refused, as install refuses it, so a linked vault copy never goes stale
 * silently. On any failure the temporary file is removed and the target is as it was.
 */
function write(rel, text) {
	const target = file(rel);
	let st = null;
	try { st = fs.lstatSync(target); } catch { /* new file */ }
	if (st && (st.isSymbolicLink() || !st.isFile() || st.nlink > 1)) throw new Error(`${rel} is a link or not a plain file, which state.mjs never writes through`);
	const tmp = `${target}.${crypto.randomBytes(6).toString('hex')}.tmp`;
	try {
		fs.writeFileSync(tmp, text, { flag: 'wx' });
		fs.renameSync(tmp, target);
	} catch (e) {
		try { fs.rmSync(tmp, { force: true }); } catch { /* gone */ }
		throw new Error(`${rel} could not be written (${clean(e.code || e.message)}); it is unchanged`);
	}
}

/** The state, or a reason it cannot be read. Every id is checked here, so no id can carry a line or a marker. */
function loadState() {
	const text = readText(STATE);
	if (text === null) return { why: `no ${STATE}: run node .claude/state.mjs init` };
	let s;
	try { s = JSON.parse(text); } catch { return { why: `${STATE} is not JSON` }; }
	if (!s || typeof s !== 'object' || Array.isArray(s)) return { why: `${STATE} is not an object` };
	for (const k of ['next', 'then', 'phase', 'last_session', 'updated', 'kit']) if (s[k] !== undefined && typeof s[k] !== 'string') return { why: `${STATE}: "${k}" is not text` };
	s.seq = { B: 0, W: 0, C: 0, ...(s.seq || {}) };
	const seen = new Set();
	for (const [kind, k] of Object.entries(LIST)) {
		if (s[k] === undefined) s[k] = [];
		if (!Number.isSafeInteger(s.seq[kind]) || s.seq[kind] < 0) return { why: `${STATE}: seq.${kind} is not a whole number` };
		if (!Array.isArray(s[k])) return { why: `${STATE}: "${k}" is not a list` };
		for (const i of s[k]) {
			const m = i && typeof i.what === 'string' && typeof i.id === 'string' && new RegExp(`^${kind}-(\\d{1,9})$`).exec(i.id);
			if (!m) return { why: `${STATE}: an item in "${k}" is not { id: "${kind}-<n>", what }` };
			if (seen.has(i.id) || Number(m[1]) > s.seq[kind]) return { why: `${STATE}: ${i.id} is given twice or above seq.${kind}` };
			seen.add(i.id);
		}
	}
	if (s.rendered !== undefined && (typeof s.rendered !== 'object' || Array.isArray(s.rendered) || s.rendered === null)) return { why: `${STATE}: "rendered" is not an object` };
	if (s.roadmap === undefined) s.roadmap = [];
	if (!Array.isArray(s.roadmap) || s.roadmap.some((x) => !x || ['step', 'release', 'carries', 'state'].some((k) => typeof x[k] !== 'string')) || s.roadmap.some((x) => !clean(x.step))) return { why: `${STATE}: "roadmap" is not a list of { step, release, carries, state }` };
	// A step name may repeat ("fix" for two fix releases); the step with its release is one step.
	if (new Set(s.roadmap.map((x) => `${x.step}\n${x.release}`)).size !== s.roadmap.length) return { why: `${STATE}: a roadmap step is given twice with the same release` };
	// list import's record of each row it moved: [tag, text hash] by id (list-data.mjs, importMark).
	if (s.list_import === undefined) s.list_import = {};
	if (!s.list_import || typeof s.list_import !== 'object' || Array.isArray(s.list_import) || Object.values(s.list_import).some((m) => !Array.isArray(m) || m.length !== 2 || m.some((x) => typeof x !== 'string'))) return { why: `${STATE}: "list_import" is not a record of [tag, hash] by row id` };
	return { state: s };
}
const saveState = (s, { touch = true } = {}) => { if (touch) s.updated = today(); write(STATE, `${JSON.stringify(s, null, 2)}\n`); };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** The decisions in order, or a reason the file is not a clean record. */
function loadDecisions(text = readText(DECISIONS)) {
	if (text === null) return { rows: [], lines: [] };
	const rows = [];
	const lines = text.split(/\r?\n/).filter((l) => l.trim());
	for (let i = 0; i < lines.length; i++) {
		let d;
		try { d = JSON.parse(lines[i]); } catch { return { why: `${DECISIONS} row ${i + 1} is not JSON` }; }
		if (!d || d.id !== `D-${rows.length + 1}`) return { why: `${DECISIONS} row ${i + 1}: expected id D-${rows.length + 1}` };
		if (!DATE.test(String(d.date)) || ['decision', 'words', 'why'].some((k) => typeof d[k] !== 'string' || !clean(d[k]))) return { why: `${DECISIONS}: ${d.id} lacks its date, decision, words or why` };
		if (d.supersedes != null) {
			if (!rows.some((r) => r.id === d.supersedes)) return { why: `${DECISIONS}: ${d.id} supersedes ${clean(d.supersedes)}, which is not an earlier decision` };
			if (rows.some((r) => r.supersedes === d.supersedes)) return { why: `${DECISIONS}: ${d.id} supersedes ${clean(d.supersedes)}, which an earlier decision already supersedes (supersede the newest)` };
		}
		rows.push(d);
	}
	return { rows, lines };
}

// A repo's own config must not run a program, and git starts from Node's own folder (as resume-packet.mjs).
const NO_PROGRAMS = ['-c', 'core.fsmonitor=false', '-c', 'protocol.allow=never'];
const git = (...a) => spawnSync('git', ['--no-optional-locks', '-C', ROOT, ...NO_PROGRAMS, ...a], { encoding: 'utf8', cwd: path.dirname(process.execPath), timeout: 10000, env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(ROOT) } });
/** The committed copy of the decisions, or null where git keeps none (no repo, not tracked, gitignored). */
function committedDecisions() {
	const r = git('show', `HEAD:./${DECISIONS}`);
	return r.status === 0 ? r.stdout : null;
}

const items = (list) => (list.length ? list.map((i) => `- ${i.id}: ${clean(i.what)}${i.since ? ` (since ${clean(i.since)})` : ''}`) : ['- none']);
/** The two generated blocks, as lines between the markers. */
function views(s) {
	const plan = [`**Updated:** ${clean(s.updated)}`, '', `**NEXT:** ${clean(s.next)}`, ''];
	if (clean(s.then)) plan.push(`**Then:** ${clean(s.then)}`, '');
	plan.push(CARRY_LABEL, ...items(s.carry_overs), '', '**Pending the owner:**', ...items(s.blocking), '',
		`**${WAITING} (work goes on):**`, ...items(s.waiting));
	const memory = [`**Last Session:** ${clean(s.last_session)}`, '', `**Kit:** ${clean(s.kit)}`, '',
		`**Current Phase:** ${clean(s.phase)} -> [\`_Active Plan.md\`](_Active Plan.md)`, '',
		`**Resume Point:** ${clean(s.next)} -> [\`_Active Plan.md\`](_Active Plan.md) Resume Point`];
	return { [PLAN]: plan, [MEMORY]: memory };
}
// The block sits between blank lines, so the resume packet's label reading stops at its edges.
const inner = (body) => ['', ...body, ''];

/** Where a file's one generated block sits: { lines, begin, end, crlf }, or { why }. */
function locate(rel, text = readText(rel)) {
	if (text === null) return { why: `${rel} is missing` };
	const crlf = /\r\n/.test(text);
	const lines = text.split(/\r?\n/);
	const begins = lines.flatMap((l, i) => (IS_BEGIN.test(l) ? [i] : []));
	const ends = lines.flatMap((l, i) => (IS_END.test(l) ? [i] : []));
	if (begins.length !== 1 || ends.length !== 1 || ends[0] < begins[0]) return { why: `${rel} has no single generated block (run node .claude/state.mjs init)` };
	return { lines, begin: begins[0], end: ends[0], crlf };
}
const blockHash = (at) => sha(at.lines.slice(at.begin + 1, at.end).join('\n'));

/**
 * Write each block from the data. A block that differs both from the last render (by its recorded hash) and from
 * what the data renders now was edited by hand: it is refused, so a hand-written line is never wiped silently, until
 * the change is moved into the data (set, add, done) and the render is run with --overwrite.
 */
function render(s, { overwrite = false } = {}) {
	const out = [];
	s.rendered = { ...(s.rendered || {}) };
	for (const [rel, body] of Object.entries(views(s))) {
		const at = locate(rel);
		if (at.why) { out.push(at.why); continue; }
		const want = inner(body);
		const now = at.lines.slice(at.begin + 1, at.end);
		const same = now.join('\n') === want.join('\n');
		const known = s.rendered[rel] ? s.rendered[rel] === blockHash(at) : now.every((l) => !l.trim());
		if (!same && !known && !overwrite) { out.push(`${rel}: the generated block was edited by hand since the last render; move each change into the data with set, add or done, then run node .claude/state.mjs render --overwrite`); continue; }
		// The begin marker is written in its one form too: text added on the marker line is not kept.
		const lines = [...at.lines.slice(0, at.begin), BEGIN, ...want, ...at.lines.slice(at.end)];
		if (!same || at.lines[at.begin] !== BEGIN) write(rel, lines.join(at.crlf ? '\r\n' : '\n'));
		s.rendered[rel] = sha(want.join('\n'));
	}
	out.push(...listBlocks(s, { overwrite }));
	saveState(s, { touch: false });
	return out;
}

/**
 * K69 (1.36.0): after a change to the list or the roadmap, its views are written at once (a block edited by hand is
 * still refused, never wiped). With the views in the roadmap template, a session that forgot render left check failing.
 * Returns the line to print after the change.
 */
function refreshLists() {
	const { state: s, why } = loadState();
	if (why) return `; the views were not written (${why})`;
	s.rendered = { ...(s.rendered || {}) };
	const faults = listBlocks(s);
	saveState(s, { touch: false });
	return faults.length ? `; the views were not all written:\n${faults.join('\n')}` : '; the views are written';
}

/** A tracking file that is a link or has a second name: state.mjs neither writes nor reads through it. */
const linked = (rel) => { try { const st = fs.lstatSync(file(rel)); return st.isSymbolicLink() || !st.isFile() || st.nlink > 1; } catch { return false; } };
const io = { readText, linked };
// Files a session reads as instructions or by label: a list view there could pass row text off as a rule, a lesson,
// an import (@path in CLAUDE.md or AGENTS.md) or a next action, so list blocks are refused in them.
const NO_LIST = ['CLAUDE.md', 'AGENTS.md', '_Start Here.md', PLAN, MEMORY, '_Loop Learnings.md', '_Session Log.md'];
// The project's own markdown files that may hold list blocks (the roadmap, counts and rows views).
const markdownFiles = () => fs.readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isFile() && /\.md$/i.test(d.name)).map((d) => d.name).sort();
/** A path the owner named for a command's input: inside the project, a plain file, never a link or a network share. */
function inside(arg) {
	if (/^[\\/]{2}/.test(String(arg))) return null;
	const p = path.resolve(ROOT, String(arg));
	const rel = path.relative(ROOT, p);
	if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || linked(rel)) return null;
	// A linked folder on the way (a junction under the project) would lead a read, and an import's rewrite, outside it.
	if (!realUnder(p)) return null;
	return p;
}
/** Whether a path, once every link on the way is followed, still sits where its spelling says, under the real ROOT. */
function realUnder(p) {
	try {
		const want = path.relative(ROOT, p);
		const got = path.relative(fs.realpathSync.native(ROOT), fs.realpathSync.native(p));
		return process.platform === 'win32' ? want.toLowerCase() === got.toLowerCase() : want === got;
	} catch { return false; }
}

/**
 * Write (or, with check, compare) every list block from _List.jsonl and the roadmap steps. A block changed by hand since
 * the last render is refused, as the state blocks are. Returns the faults.
 */
function listBlocks(s, { overwrite = false, check = false } = {}) {
	const out = [];
	const files = markdownFiles().map((rel) => [rel, readText(rel)]).filter(([, t]) => t !== null && /<!--\s*list:/.test(t));
	for (const [rel] of files.filter(([rel]) => NO_LIST.some((n) => n.toLowerCase() === rel.toLowerCase()))) out.push(`${rel}: list blocks may not sit in a file a session reads as instructions or by label; put them in _Master Roadmap.md or a file of their own`);
	if (out.length) return out;
	if (!files.length) return out;
	const l = list.loadList(io);
	if (l.why) return [l.why];
	const v = list.views(l.rows, s.roadmap || []);
	const empty = list.views([], []);
	for (const [rel, text] of files) {
		const at = list.blocksIn(text);
		if (at.why) { out.push(`${rel}: ${at.why}`); continue; }
		let lines = at.lines;
		let changed = false;
		// From the last block up, so the line numbers of the earlier ones hold.
		for (const b of [...at.blocks].reverse()) {
			const key = `${rel}#${b.name}`;
			const want = inner(v[b.name]);
			const now = lines.slice(b.begin + 1, b.end);
			const same = now.join('\n') === want.join('\n');
			if (check) { if (!same) out.push(`${rel}: the ${b.name} list block differs from ${list.LIST} and ${STATE}: run node .claude/state.mjs render (a block edited by hand is refused there; move the change into the data first)`); continue; }
			// An empty block holds no hand-written text, so it is always filled (a block put back empty after a render).
			// So is one that still holds the view of no data at all, as the template ships it: the template's state holds no
			// hash for it, since a hash there is a change install three-way merges into each project's state (1.36.1).
			const known = now.every((x) => !x.trim()) || now.join('\n') === inner(empty[b.name]).join('\n') || s.rendered[key] === sha(now.join('\n'));
			if (!same && !known && !overwrite) { out.push(`${rel}: the ${b.name} list block was edited by hand since the last render; move each change into the data with item set or step set, then run node .claude/state.mjs render --overwrite`); continue; }
			if (!same) { lines = [...lines.slice(0, b.begin), list.listBegin(b.name), ...want, ...lines.slice(b.end)]; changed = true; }
			s.rendered[key] = sha(want.join('\n'));
		}
		if (changed) write(rel, lines.join(at.crlf ? '\r\n' : '\n'));
	}
	return out;
}

/** The installed kit version from install's stamp, or null outside an installed project. */
function installedKit() {
	try { return JSON.parse(fs.readFileSync(path.join(ROOT, '.kit', 'kit-version.json'), 'utf8')).version || null; } catch { return null; }
}

/** Every fault: a view that differs from the data, a label outside its block, a stale kit, a broken record, a lost pointer. */
function check() {
	const faults = [];
	const notes = [];
	const { state, why } = loadState();
	if (why) faults.push(why);
	const dec = loadDecisions();
	if (dec.why) faults.push(dec.why);
	if (state) {
		for (const [rel, body] of Object.entries(views(state))) {
			const at = locate(rel);
			if (at.why) { faults.push(at.why); continue; }
			if (at.lines[at.begin] !== BEGIN) faults.push(`${rel}: the begin marker line was changed by hand; run node .claude/state.mjs render --overwrite to write it back`);
			if (at.lines.slice(at.begin + 1, at.end).join('\n') !== inner(body).join('\n')) faults.push(`${rel}: the generated block differs from ${STATE}: run node .claude/state.mjs render (a block edited by hand is refused there; move the change into the data first)`);
			// The packet reads the first label anywhere in the file, so one outside the block would be read in its place.
			at.lines.forEach((l, i) => { if ((i < at.begin || i > at.end) && LABELS[rel].some((n) => labelRe(n).test(l))) faults.push(`${rel} line ${i + 1}: "${clean(l).slice(0, 40)}" is a generated label outside the block; move it into the data and delete the line`); });
		}
		faults.push(...listBlocks(state, { check: true }));
		const kit = installedKit();
		if (kit && !placeholder(state.updated) && state.kit !== kit) faults.push(`${STATE} says kit ${clean(state.kit) || '(none)'} but ${kit} is installed: check the next action and the phase, then run node .claude/state.mjs set kit ${kit}`);
	}
	const committed = dec.why ? null : committedDecisions();
	if (committed !== null) {
		const old = loadDecisions(committed);
		if (old.why || old.lines.some((l, i) => dec.lines[i] !== l)) faults.push(`${DECISIONS}: a committed decision was changed, moved or removed; rows are only ever added (git diff ${DECISIONS})`);
	} else if ((dec.rows || []).length) notes.push(`${DECISIONS} has no committed copy here, so earlier rows were not compared`);
	// Every row, committed or not: a commit does not make a forged claim true.
	for (const d of dec.rows || []) {
		if (!d.words_from) continue;
		const p = proven(d);
		if (p === 'no') faults.push(`${d.id} claims the owner's words, but they are not in the turn its record points to`);
		if (p === 'away') notes.push(`${d.id}'s words were checked when recorded; that transcript is not on this machine`);
	}
	const l = list.loadList(io);
	if (l.why) faults.push(l.why);
	else { const lf = list.faultsOf(l.rows, state ? state.list_import : {}); faults.push(...lf.faults); notes.push(...lf.notes); }
	const rows = new Map((dec.rows || []).map((d) => [d.id, d]));
	for (const rel of TRACKING) {
		const text = readText(rel);
		if (text === null) continue;
		for (const id of new Set(text.match(/\bD-\d+\b/g) || [])) {
			if (!rows.has(id)) faults.push(`${id} is named in ${rel} but has no record in ${DECISIONS}`);
			else if ((dec.rows || []).some((d) => d.supersedes === id)) notes.push(`${id} in ${rel} is superseded`);
		}
	}
	// K153 (build 20): a working-memory line that keeps wording the kit has retired fails here, so the closeout catches it.
	let retired = null;
	try { retired = retiredList(); } catch (e) { faults.push(`.claude/retired-wording.json cannot be read (${clean(e.message).slice(0, 80)}): run install project`); }
	if (retired) for (const h of retiredHits(ROOT, retired)) faults.push(hitLine(h));
	return { faults, notes, decisions: rows.size };
}

/** One labelled block in a file written by hand: the label line, its note, its text and the lines under it. */
function labelled(lines, name) {
	const re = labelRe(name);
	const all = lines.flatMap((l, i) => (re.test(l) ? [i] : []));
	if (all.length > 1) return { twice: `"**${name}**" appears ${all.length} times` };
	if (!all.length) return null;
	const at = all[0];
	const m = re.exec(lines[at]);
	const out = { at, last: at, note: m[1] || '', first: lines[at].slice(m[0].length).trim(), list: [] };
	for (let i = at + 1; i < lines.length && lines[i].trim() && !/^(\*\*[^*]+(?::\*\*|\*\*:)|#{1,6} |-{3,}\s*$|<!--)/.test(lines[i]); i++) { out.last = i; out.list.push(lines[i]); }
	return out;
}
// The notes the kit's own labels carry are the kit's words, not the owner's: never copied onto an item.
const KIT_NOTES = ['work goes on', 'only those the owner said yes to; close in this run'];
const ownNote = (b) => (b.note && !KIT_NOTES.includes(b.note.trim()) ? clean(b.note) : '');
const value = (b) => clean([ownNote(b) ? `(${ownNote(b)})` : '', b.first, ...b.list].join(' '));
// A template placeholder or an empty "none" is not an item; "none (reason)" is kept as a note, never as an open item.
const bare = (t) => /^none\.?$/i.test(t) || placeholder(t);
function asItems(b, kind, s, notes) {
	if (!b) return [];
	const lines = [b.first, ...b.list.map((l) => l.replace(/^\s*[-*+]\s+/, ''))].map(clean).filter(Boolean);
	const out = [];
	for (const t of lines) {
		if (bare(t)) continue;
		if (/^none\b/i.test(t)) { notes.push(`${LIST[kind].replace('_', '-')}: ${t}`); continue; }
		out.push({ id: `${kind}-${++s.seq[kind]}`, what: ownNote(b) ? `(${ownNote(b)}) ${t}` : t });
	}
	return out;
}

/**
 * The text of a file with its labelled lines replaced by the empty marker pair, or { why }. Plain paragraphs between
 * the labels are returned as `loose` when allowed; a heading, a table, a rule or a list between them is never folded
 * into one line: the block is refused instead.
 */
function wrapped(rel, labels, { keepLoose = false } = {}) {
	const text = readText(rel);
	if (text === null) return { why: `${rel} is missing` };
	if (!locate(rel, text).why) return { text, loose: [] };
	const lines = text.split(/\r?\n/);
	const found = [];
	for (const l of labels) { const b = labelled(lines, l); if (b?.twice) return { why: `${rel}: ${b.twice}, so init cannot tell which is the live one; keep one and run init again` }; if (b) found.push(b); }
	if (!found.length) return { why: `${rel}: none of ${labels.join(', ')} found, so the block could not be placed; add the two marker lines by hand` };
	const from = Math.min(...found.map((b) => b.at));
	const to = Math.max(...found.map((b) => b.last));
	const owned = new Set(found.flatMap((b) => Array.from({ length: b.last - b.at + 1 }, (_, i) => b.at + i)));
	const loose = [];
	for (let i = from; i <= to; i++) {
		if (!lines[i].trim() || owned.has(i)) continue;
		if (!keepLoose || /^\s*(#|\||-{3,}|[-*+] |\d+[.)] |```|<)/.test(lines[i])) return { why: `${rel}: line ${i + 1} ("${clean(lines[i]).slice(0, 40)}") sits between the labels and is not one of them, so the block was not placed; move it out, or add the two marker lines by hand` };
		loose.push(lines[i].trim());
	}
	lines.splice(from, to - from + 1, BEGIN, END);
	return { text: lines.join(/\r\n/.test(text) ? '\r\n' : '\n'), loose };
}

/**
 * Move a filled-in Resume Point into the data. Everything is read and checked first; then the data is saved, then
 * each view is written whole. A view that fails to write is left exactly as it was, so init can be run again.
 */
function init() {
	const old = loadState();
	if (old.why && readText(STATE) !== null) return { faults: [old.why] };
	const inUse = old.state && !placeholder(old.state.updated);
	if (inUse && !locate(PLAN).why && !locate(MEMORY).why) return { faults: [`${STATE} is already in use (updated ${clean(old.state.updated)}) and both views carry their blocks; init has nothing to do`] };
	const planText = readText(PLAN);
	const memText = readText(MEMORY);
	if (planText === null || memText === null) return { faults: [`${planText === null ? PLAN : MEMORY} is missing`] };
	const plan = planText.split(/\r?\n/);
	const memory = memText.split(/\r?\n/);
	const s = { updated: today(), kit: installedKit() || '', phase: '', next: '', then: '', blocking: [], waiting: inUse ? old.state.waiting : [], carry_overs: [], last_session: '', seq: { B: 0, W: 0, C: 0, ...(inUse ? old.state.seq : {}) } };
	const read = (lines, name) => { const b = labelled(lines, name); if (b?.twice) throw new Error(`${lines === plan ? PLAN : MEMORY}: ${b.twice}, so init cannot tell which is the live one; keep one and run init again`); return b; };
	const notes = [];
	try {
		const next = read(plan, 'NEXT') || read(memory, 'Resume Point');
		if (next) s.next = value(next).replace(/\s*->\s*\[`_Active Plan\.md`\].*$/, '');
		const then = read(plan, 'Then');
		if (then) s.then = value(then);
		s.carry_overs = asItems(read(plan, CARRY), 'C', s, notes);
		s.blocking = asItems(read(plan, 'Pending the owner'), 'B', s, notes);
		if (!inUse) s.waiting = asItems(read(plan, WAITING), 'W', s, notes);
		const last = read(memory, 'Last Session');
		if (last) s.last_session = value(last);
		const phase = read(memory, 'Current Phase');
		if (phase) s.phase = value(phase).replace(/\s*->\s*\[`_Active Plan\.md`\]\(_Active Plan\.md\)$/, '');
	} catch (e) { return { faults: [e.message] }; }
	const p = wrapped(PLAN, ['NEXT', 'Then', CARRY, 'Pending the owner', WAITING, 'Updated'], { keepLoose: true });
	const m = wrapped(MEMORY, ['Last Session', 'Kit', 'Current Phase', 'Resume Point']);
	if (p.why || m.why) return { faults: [p.why, m.why].filter(Boolean) };
	if (p.loose.length || notes.length) s.then = clean([s.then, ...p.loose, ...notes].join(' '));
	// The hand-kept date line goes stale first (1.33.1: three releases old); the generated block carries the date now.
	const dated = /^\*\*Last Updated:\*\*.*$/m.exec(p.text);
	const planOut = dated ? p.text.replace(/^\*\*Last Updated:\*\*.*\r?\n(\r?\n)?/m, '') : p.text;
	const fill = (text, rel) => { const at = locate(rel, text); return [...at.lines.slice(0, at.begin + 1), ...inner(views(s)[rel]), ...at.lines.slice(at.end)].join(at.crlf ? '\r\n' : '\n'); };
	const outs = { [PLAN]: fill(planOut, PLAN), [MEMORY]: fill(m.text, MEMORY) };
	s.rendered = Object.fromEntries(Object.entries(views(s)).map(([rel, body]) => [rel, sha(inner(body).join('\n'))]));
	saveState(s);
	if (readText(DECISIONS) === null) write(DECISIONS, '');
	for (const [rel, text] of Object.entries(outs)) write(rel, text);
	const said = [];
	if (dated) said.push(`removed from ${PLAN}: "${clean(dated[0])}" (the block shows the date now)`);
	if (/^## Current Phase\s*$/m.test(planOut)) said.push(`${PLAN} still has its own "## Current Phase" section: fold it into node .claude/state.mjs set phase, then delete the section`);
	return { faults: [], said };
}

/** A session's transcript files: by its id, in the Claude folder's transcripts of this project folder and its parents. */
function transcripts(id) {
	if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return [];
	const root = path.join(claudeHome(), 'projects');
	const keys = [];
	let real = ROOT;
	try { real = fs.realpathSync.native(ROOT); } catch { /* as given */ }
	for (let d = path.resolve(real); ; d = path.dirname(d)) { keys.push(d.replace(/[^A-Za-z0-9]/g, '-').toLowerCase()); if (path.dirname(d) === d) break; }
	let dirs = [];
	try { dirs = fs.readdirSync(root).filter((d) => keys.includes(d.toLowerCase())); } catch { return []; }
	return dirs.map((d) => path.join(root, d, `${id}.jsonl`)).filter((p) => fs.existsSync(p));
}
// Words as a run of whole words: case, punctuation and spacing do not matter; a part of a word never matches.
const words = (t) => ` ${String(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
const MIN_WORDS = 3;
/** What a person's turn in a transcript says: their own text, and the answers they tapped in a pop-up. */
function ownerTurn(e) {
	if (e.type !== 'user' || e.isSidechain || e.isMeta || typeof e.uuid !== 'string') return [];
	const c = e.message?.content;
	const said = typeof c === 'string' ? [c] : Array.isArray(c) ? c.filter((b) => b?.type === 'text').map((b) => b.text) : [];
	const d = e.permissionDecision || {};
	if (e.toolUseResult?.answers && d.decision === 'accept' && /^user/.test(String(d.source || ''))) said.push(...Object.values(e.toolUseResult.answers).map(String));
	return said;
}
/**
 * Where the words appear word for word (at least three whole words) in one of the owner's own turns or pop-up answers
 * in a session's transcript: "<session id>:<turn id>", or null. Never a subagent's turn, a tool result or a meta line.
 * Limit: a note relayed into the owner's turn by another agent is read as part of that turn.
 */
function ownerSaid(said, session, turn = null) {
	const want = words(said);
	if (want.trim().split(' ').length < MIN_WORDS) return null;
	for (const f of transcripts(session)) {
		let text;
		try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
		for (const line of text.split('\n')) {
			let e;
			try { e = JSON.parse(line); } catch { continue; }
			if (turn && e.uuid !== turn) continue;
			if (ownerTurn(e).some((t) => words(t).includes(want))) return `${session}:${e.uuid}`;
		}
	}
	return null;
}
/** A recorded row's words, checked again where the record points: 'yes', 'no', or 'away' (that transcript is not here). */
function proven(d) {
	const m = /^([0-9a-f-]{36}):(.+)$/i.exec(String(d.words_from || ''));
	if (!m) return 'no';
	if (!transcripts(m[1]).length) return 'away';
	return ownerSaid(d.words, m[1], m[2]) ? 'yes' : 'no';
}

/** Record one decision, under a lock so two sessions never take the same id; the row is appended, never rewritten. */
function decide(fromFile, unchecked) {
	let input;
	try { input = JSON.parse(fs.readFileSync(path.resolve(ROOT, fromFile), 'utf8')); } catch { return `${clean(fromFile)} could not be read as JSON { "decision", "words", "why", "supersedes"? }`; }
	const { decision, words, why, supersedes = null } = input || {};
	if (![decision, words, why].every((v) => typeof v === 'string' && clean(v))) return 'A decision needs "decision", "words" (the owner\'s own words) and "why" (the reason).';
	const from = ownerSaid(words, process.env.CLAUDE_CODE_SESSION_ID);
	if (!from && !unchecked) return 'The words (at least three whole words) were not found word for word in the owner\'s messages or pop-up answers in this session\'s transcript. Quote the owner exactly, or record them with --unchecked, marked as the session recorded them.';
	const lock = file(`${DECISIONS}.lock`);
	let fd;
	try { fd = fs.openSync(lock, 'wx'); } catch { return `${DECISIONS} is being written by another session (${DECISIONS}.lock); try again, or remove the lock if no session is running`; }
	try {
		const dec = loadDecisions();
		if (dec.why) return dec.why;
		if (supersedes !== null && !dec.rows.some((d) => d.id === supersedes)) return `${clean(supersedes)} is not a decision on record, so it cannot be superseded.`;
		if (supersedes !== null && dec.rows.some((d) => d.supersedes === supersedes)) return `${clean(supersedes)} is already superseded; supersede the newest decision in its line.`;
		const d = { id: `D-${dec.rows.length + 1}`, date: today(), decision: clean(decision), words: clean(words), words_from: from, why: clean(why), supersedes };
		const text = readText(DECISIONS) || '';
		const row = `${text && !text.endsWith('\n') ? '\n' : ''}${JSON.stringify(d)}\n`;
		let st = null;
		try { st = fs.lstatSync(file(DECISIONS)); } catch { /* new */ }
		if (st && (st.isSymbolicLink() || !st.isFile() || st.nlink > 1)) return `${DECISIONS} is a link or not a plain file, which state.mjs never writes through`;
		fs.appendFileSync(file(DECISIONS), row);
		try { fs.rmSync(path.resolve(ROOT, fromFile)); } catch { /* the owner's file to remove */ }
		console.log(`${d.id} recorded${from ? '' : ' (words not checked)'}`);
		return null;
	} finally {
		fs.closeSync(fd);
		fs.rmSync(lock, { force: true });
	}
}

function main(argv) {
	const [cmd, ...rest] = argv;
	const fail = (m) => { console.log(m); process.exitCode = 1; };
	const usage = () => { console.log('Usage: node .claude/state.mjs show [--json] | set next|then|phase|last-session|kit <text> | add blocking|waiting|carry <text> | done <id> | decide --from <file.json> [--unchecked] | decisions [text] | render [--overwrite] | check | init | list [text|--all|--agent|--full|--step <step>|caught|audit|shorten|import <file.md>] | item <id> [--json] | item add --from <file.json> | item set <id> <field> <value> | step set <step> release|carries|state <text> | step rename <step> <new name> | step move <step> before|after <step>'); process.exitCode = 2; };
	if (cmd === 'init') {
		const { faults, said = [] } = init();
		for (const f of [...faults, ...said]) console.log(f);
		if (faults.length) process.exitCode = 1; else console.log(`PASS ${STATE} written from the Resume Point; read it with node .claude/state.mjs show`);
		return;
	}
	if (cmd === 'check') {
		const { faults, notes, decisions } = check();
		for (const f of faults) console.log(f);
		for (const n of notes) console.log(`note: ${n}`);
		if (faults.length) process.exitCode = 1;
		else console.log(`PASS state: the blocks match ${STATE} and the installed kit; ${decisions} decision(s), each D-n in the tracking files has a row. Not checked: whether the next action is still true.`);
		return;
	}
	if (cmd === 'decide') {
		const i = rest.indexOf('--from');
		if (i < 0 || !rest[i + 1]) return usage();
		const why = decide(rest[i + 1], rest.includes('--unchecked'));
		return why ? fail(why) : undefined;
	}
	if (cmd === 'decisions') {
		const dec = loadDecisions();
		if (dec.why) return fail(dec.why);
		const q = rest.join(' ').toLowerCase();
		for (const d of dec.rows) {
			const later = dec.rows.find((x) => x.supersedes === d.id);
			const line = `${d.id} ${later ? `[superseded by ${later.id}] ` : ''}${clean(d.date)}: ${clean(d.decision)} | ${{ yes: 'owner\'s words', away: 'owner\'s words (checked when recorded; that transcript is not on this machine)', no: d.words_from ? 'words NOT found where the record points' : 'words as the session recorded them (not checked)' }[proven(d)]}: ${clean(d.words)} | why: ${clean(d.why)}`;
			if (!q || line.toLowerCase().includes(q)) console.log(line);
		}
		return;
	}
	if (cmd === 'list' || cmd === 'item') return listCommand(cmd, rest, { fail, usage });
	const { state: s, why } = loadState();
	if (cmd === 'step') {
		const [verb, step, field, ...text] = rest;
		if (why) return fail(why);
		if (verb === 'rename') {
			// K79 (1.36.0): build 10's step was split by a hand edit of _State.json, for want of this command.
			const to = clean([field, ...text].join(' '));
			if (!clean(step) || !to) return usage();
			const named = s.roadmap.filter((x) => x.step === clean(step) || (x.release && x.release === clean(step)));
			if (named.length > 1) return fail(`${clean(step)} names ${named.length} steps; name one by its release (${named.map((x) => x.release || '(none)').join(', ')})`);
			if (!named.length) return fail(`${clean(step)} is not a roadmap step`);
			const at = named[0];
			if (s.roadmap.some((x) => x !== at && x.step === to && x.release === at.release)) return fail(`step ${to} with release ${at.release || '(none)'} is already on the roadmap; nothing written`);
			const was = at.step;
			at.step = to;
			saveState(s, { touch: false });
			return console.log(`step ${was} renamed ${to}; rows placed "at" ${was} keep that text: move them with item set <id> at ${to}${refreshLists()}`);
		}
		if (verb === 'move') {
			// 1.36.1: step set adds a new step at the end, and only a hand edit of _State.json moved it.
			const where = field;
			const other = clean(text.join(' '));
			if (!clean(step) || !['before', 'after'].includes(where) || !other) return usage();
			const one = (name) => {
				const named = s.roadmap.filter((x) => x.step === name || (x.release && x.release === name));
				return named.length === 1 ? { at: named[0] } : { why: named.length ? `${name} names ${named.length} steps; name one by its release (${named.map((x) => x.release || '(none)').join(', ')})` : `${name} is not a roadmap step` };
			};
			const a = one(clean(step));
			const b = one(other);
			if (a.why || b.why) return fail(a.why || b.why);
			if (a.at === b.at) return fail('a step cannot move beside itself');
			s.roadmap.splice(s.roadmap.indexOf(a.at), 1);
			s.roadmap.splice(s.roadmap.indexOf(b.at) + (where === 'after' ? 1 : 0), 0, a.at);
			saveState(s, { touch: false });
			return console.log(`step ${a.at.step} moved ${where} ${b.at.step}${refreshLists()}`);
		}
		if (verb !== 'set' || !clean(step) || !['release', 'carries', 'state'].includes(field)) return usage();
		// A step is named by its name, or by its release where two steps share a name.
		const named = s.roadmap.filter((x) => x.step === clean(step) || (x.release && x.release === clean(step)));
		if (named.length > 1) return fail(`${clean(step)} names ${named.length} steps; name one by its release (${named.map((x) => x.release || '(none)').join(', ')})`);
		let at = named[0];
		if (!at) { at = { step: clean(step), release: '', carries: '', state: '' }; s.roadmap.push(at); }
		at[field] = clean(text.join(' '));
		// Checked before it is written: a step and release given twice would lock every state command out.
		if (s.roadmap.some((x) => x !== at && x.step === at.step && x.release === at.release)) return fail(`step ${at.step} with release ${at.release || '(none)'} is already on the roadmap; nothing written`);
		saveState(s, { touch: false });
		return console.log(`step ${at.step} ${field} set${refreshLists()}`);
	}
	if (!['show', 'set', 'add', 'done', 'render'].includes(cmd)) return usage();
	if (why) return fail(why);
	if (cmd === 'show') {
		if (rest[0] === '--json') return console.log(JSON.stringify(s, null, 2));
		const list = (head, l) => console.log([head, ...items(l).map((x) => `  ${x}`)].join('\n'));
		console.log(`NEXT: ${clean(s.next)}`);
		if (clean(s.then)) console.log(`Then: ${clean(s.then)}`);
		list('Blocking (needs the owner before work goes on):', s.blocking);
		list('Waiting (needs the owner\'s eyes; work goes on):', s.waiting);
		list('Carry-overs:', s.carry_overs);
		console.log(`Kit: ${clean(s.kit)} | last session: ${clean(s.last_session)} | updated ${clean(s.updated)}`);
		return;
	}
	if (cmd === 'render') {
		const faults = render(s, { overwrite: rest.includes('--overwrite') });
		for (const f of faults) console.log(f);
		if (faults.length) process.exitCode = 1;
		return;
	}
	if (cmd === 'set') {
		const field = FIELDS[rest[0]];
		if (!field) return usage();
		s[field] = clean(rest.slice(1).join(' '));
	} else if (cmd === 'add') {
		const kind = KINDS[rest[0]];
		const what = clean(rest.slice(1).join(' '));
		if (!kind || !what) return usage();
		const item = { id: `${kind}-${++s.seq[kind]}`, what, since: today() };
		s[LIST[kind]].push(item);
		console.log(`${item.id} added`);
	} else if (cmd === 'done') {
		const list = /^[BWC]-\d+$/.test(rest[0] || '') ? LIST[rest[0][0]] : null;
		const at = list ? s[list].findIndex((i) => i.id === rest[0]) : -1;
		if (at < 0) return fail(`${clean(rest[0])} is not an open item.`);
		s[list].splice(at, 1);
		console.log(`${rest[0]} done`);
	}
	saveState(s);
}

/** list [text] [--all] | list caught | list audit | list import <file.md> | item add --from <file.json> | item set <id> <field> <value> */
function listCommand(cmd, rest, { fail, usage }) {
	const l = list.loadList(io);
	if (cmd === 'list' && rest[0] === 'import') {
		if (!rest[1]) return usage();
		if (l.why) return fail(l.why);
		const held = l.exists ? l.rows : [];
		const { state: s, why } = loadState();
		if (why) return fail(why);
		const src = inside(rest[1]);
		if (!src) return fail(`${clean(rest[1])} is not a plain file inside this project`);
		let text;
		try { text = fs.readFileSync(src, 'utf8'); } catch { return fail(`${clean(rest[1])} could not be read`); }
		// An id the list holds, or one an import mark still names (a row taken out by hand), is never given again.
		const p = list.parseMarkdown(text, { taken: [...held.map((r) => r.id), ...Object.keys(s.list_import || {})] });
		if (p.faults.length) return fail([`Nothing written: ${p.faults.length} row(s) or table(s) cannot be moved whole.`, ...p.faults.map(clean)].join('\n'));
		// A list's tables move once, into an empty list (the template's, 1.36.0): their rows would stand for rows the data
		// holds. Checkbox rows only add (1.36.1: a project that moved its list in 1.35.0 keeps its roadmap as boxes), so
		// beside a list with rows the tables stay in the file as they are and only its boxes move.
		let leftTables = 0;
		if (held.length && p.tableRows) {
			if (p.rows.length === p.tableRows) return fail(`${list.LIST} already holds rows; an import would drop what was changed in the data since. Change rows with item set.`);
			leftTables = p.tableRows;
			p.rows = p.rows.slice(p.tableRows);
			p.steps = p.steps.filter((x) => !x.table);
			p.tableRows = 0;
		}
		// A box the list already holds (the same title in the same section) is a second import of the same lines, from the
		// kept copy or a retry: refused, so no row comes in twice (the 1.36.1 sweep).
		const twice = p.rows.filter((r) => held.some((h) => h.title === r.title && (h.section || '') === (r.section || '')));
		if (twice.length) return fail(`Nothing written: ${twice.length} box(es) are already rows of ${list.LIST} (${clean(twice[0].title).slice(0, 40)}); this file, or a copy of it, was imported before.`);
		if (p.tableRows && p.steps.length && s.roadmap.length) return fail(`Nothing written: ${STATE} already holds roadmap steps; the import would replace them.`);
		// A heading step the state already holds, by its name or its release, is kept as it is; the boxes under it are
		// placed at it (a second step answering to the same name could never be named again: the 1.36.1 sweep).
		const holds = (name) => s.roadmap.some((y) => y.step === clean(name) || (y.release && y.release === clean(name)));
		const newSteps = held.length || !p.tableRows ? p.steps.filter((x) => !holds(x.step)) : p.steps;
		const names = (p.tableRows ? p.steps : newSteps).map((x) => `${clean(x.step)}\n${clean(x.release)}`);
		if (new Set(names).size !== names.length) return fail('Nothing written: two roadmap steps in the file are the same step once their spacing is read as one space.');
		// The backup goes under .kit; a linked .kit or backup folder would put the owner's file somewhere else.
		const keepDir = ['.kit', '.kit/kit-backups'].find((d) => { try { return !fs.lstatSync(file(d)).isDirectory(); } catch { return false; } });
		if (p.boxLines.length && keepDir) return fail(`Nothing written: ${keepDir} is a link or not a folder, so the file as it was cannot be kept.`);
		// The file as it was is kept, and the boxes leave it, before any data is written; then the state, then the list. A
		// failure at any step puts back what was written before it, so a retry never adds a row twice (the 1.36.1 sweep).
		const rel = path.relative(ROOT, src).split(path.sep).join('/');
		let moved = '';
		if (p.boxLines.length) {
			const keep = `.kit/kit-backups/list-import-${new Date().toISOString().replace(/[:.]/g, '-')}/${rel}`;
			fs.mkdirSync(path.dirname(file(keep)), { recursive: true });
			if (!realUnder(path.dirname(file(keep)))) return fail(`Nothing written: ${path.dirname(keep)} leads outside the project.`);
			fs.writeFileSync(file(keep), text, { flag: 'wx' });
			const drop = new Set(p.boxLines);
			// Split on LF alone: each kept line keeps its own ending, in a file whose endings are mixed as well.
			try { write(rel, text.split('\n').filter((_, i) => !drop.has(i)).join('\n')); } catch (e) { return fail(`Nothing written: ${clean(e.message)}`); }
			moved = ` ${p.rows.length} box(es) and their own lines (${p.boxLines.length} line(s)) moved out of ${rel}; the file as it was: ${keep}.`;
		}
		const before = readText(STATE);
		const undo = () => { if (p.boxLines.length) write(rel, text); write(STATE, before); };
		s.list_import = { ...(held.length ? s.list_import : {}), ...Object.fromEntries(p.rows.map((r) => [r.id, list.importMark(r)])) };
		const step = (x) => ({ step: clean(x.step), release: clean(x.release), carries: clean(x.carries), state: clean(x.state) });
		if (p.tableRows) { if (p.steps.length) s.roadmap = p.steps.map(step); } else s.roadmap = [...s.roadmap, ...newSteps.map(step)];
		const all = [...held, ...p.rows];
		const made = p.tableRows ? p.steps : newSteps;
		try { saveState(s, { touch: false }); write(list.LIST, list.serialize(all)); } catch (e) { undo(); return fail(`Nothing written: ${clean(e.message)}`); }
		const lf = list.faultsOf(all, s.list_import);
		console.log(`PASS ${p.rows.length} row(s) and ${made.length} roadmap step(s) moved into ${list.LIST} and ${STATE};${moved || ' the markdown is unchanged.'}${leftTables ? ` ${leftTables} table row(s) stay in ${rel} as they were: ${list.LIST} already holds its rows.` : ''}`);
		// What the import decided for the owner to look over: the steps it made and the short names it clipped.
		if (made.length) console.log(`roadmap step(s) made: ${made.map((x) => clean(x.step)).join(', ')} (rename one with step rename <step> <new>)`);
		const clipped = p.rows.filter((r) => r.short?.endsWith('...'));
		if (clipped.length) console.log(`short name(s) clipped: ${clipped.map((r) => r.id).join(', ')} (set one with item set <id> short <text>)`);
		console.log(`Views${refreshLists().replace(/^; /, ': ')}.`);
		for (const n of lf.notes) console.log(`note: ${n}`);
		return console.log(`Next: put the list:begin ${p.boxLines.length ? 'boxes and roadmap' : 'roadmap, counts and rows'} markers where the views go (the kit's roadmap template has them since 1.36.0; if install named this file to merge, merge it, then run node <kit>/scripts/kit.mjs install project <folder> --merged "${rel}"), then run node .claude/state.mjs render.`);
	}
	if (l.why) return fail(l.why);
	if (cmd === 'list') {
		if (!l.exists) return console.log(`no ${list.LIST} in ${path.basename(ROOT)} (${ROOT}): add a row with node .claude/state.mjs item add --from <file.json>, or import a markdown list once`);
		if (rest[0] === 'caught') return console.log(list.caught(l.rows).join('\n'));
		if (rest[0] === 'audit') { const a = list.audit(l.rows); return console.log(a.length ? a.join('\n') : 'every row carries its labels'); }
		if (rest[0] === 'shorten') {
			// Once, for rows from before 1.36.0: each row with no short name is given one, its bold lead whole or its title
			// clipped; the clipped ones are named, since a clipped title can read badly.
			const bold = [];
			const clipped = [];
			const rows = l.rows.map((r) => {
				if (r.short != null) return r;
				const d = list.derive(r.title);
				(d.bold ? bold : clipped).push(r.id);
				return { ...r, short: d.short };
			});
			if (bold.length + clipped.length) write(list.LIST, list.serialize(rows));
			return console.log(`${bold.length + clipped.length} row(s) given a short name; from the bold lead: ${bold.length}; clipped from the title, worth a look: ${clipped.length}${clipped.length ? ` (${clipped.join(', ')})` : ''}. Change one with node .claude/state.mjs item set <id> short <text>${bold.length + clipped.length ? refreshLists() : ''}`);
		}
		const flags = ['--all', '--agent', '--full'];
		const all = rest.includes('--all');
		// --step <s>: one roadmap step's rows, by its name, its build number or its release.
		const at = rest.indexOf('--step');
		const stepName = at >= 0 ? rest[at + 1] : null;
		if (at >= 0 && !stepName) return usage();
		const step = stepName ? (loadState().state?.roadmap || []).find((x) => x.step === stepName || x.release === stepName) || { step: stepName, release: '' } : null;
		const q = rest.filter((x, i) => !flags.includes(x) && (at < 0 || (i !== at && i !== at + 1))).join(' ').toLowerCase();
		const shown = (all ? l.rows : list.ranked(l.rows)).filter((r) => (!q || list.line(r).toLowerCase().includes(q)) && (!step || list.inStep(r, step)));
		// K68: the short view by default; one JSON line a row for an agent; the 1.35.0 full lines on --full.
		if (rest.includes('--agent')) { for (const r of shown) console.log(JSON.stringify(list.agent(r))); return undefined; }
		if (!rest.includes('--full')) return console.log(list.table(shown, { all }).join('\n'));
		for (const r of shown) console.log(list.line(r));
		return console.log(`${shown.length} row(s)${all ? '' : ' open, in work order (now, next, later, then the rest), then by severity (an unrated row after high), then real use, the owner, outside, the kit\'s own finds, then no origin set'}`);
	}
	if (rest[0] && !['add', 'set'].includes(rest[0])) {
		// item <id> [--json]: the whole row, one field to a line, or as one JSON line.
		const r = l.rows.find((x) => x.id === rest[0]);
		if (!r) return fail(`${clean(rest[0])} is not a row`);
		if (rest.includes('--json')) return console.log(JSON.stringify(r));
		for (const [k, v] of Object.entries(r)) console.log(`${k}: ${clean(typeof v === 'object' ? JSON.stringify(v) : String(v))}`);
		return undefined;
	}
	if (rest[0] === 'add') {
		const i = rest.indexOf('--from');
		if (i < 0 || !rest[i + 1]) return usage();
		const src = inside(rest[i + 1]);
		if (!src) return fail(`${clean(rest[i + 1])} is not a plain file inside this project`);
		let r;
		try { r = JSON.parse(fs.readFileSync(src, 'utf8')); } catch { return fail(`${clean(rest[i + 1])} is not a JSON file`); }
		if (r && typeof r === 'object' && !Array.isArray(r) && r.severity === undefined) r.severity = 'to set';
		const { state: s, why } = loadState();
		if (why) return fail(why);
		// A new row owes its labels now, even where an imported row of the same id once did not.
		if (r && typeof r.id === 'string' && Object.hasOwn(s.list_import, r.id)) return fail(`${clean(r.id)} was moved in by the import; change it with item set`);
		const bad = list.refuse(r, l.rows, s.list_import, { added: true });
		if (bad) return fail(clean(bad));
		write(list.LIST, list.serialize([...l.rows, r]));
		return console.log(`${r.id} added${refreshLists()}`);
	}
	if (rest[0] === 'set') {
		const [, id, field, ...value] = rest;
		const at = l.rows.findIndex((r) => r.id === id);
		if (at < 0) return fail(`${clean(id)} is not a row`);
		if (!field || !value.length) return usage();
		const ch = list.setField(l.rows[at], field, value.join(' '));
		if (ch.why) return fail(ch.why);
		const { state: s, why } = loadState();
		if (why) return fail(why);
		const bad = list.refuse(ch.row, l.rows.filter((_, k) => k !== at), s.list_import);
		if (bad) return fail(clean(bad));
		const rows = [...l.rows];
		rows[at] = ch.row;
		write(list.LIST, list.serialize(rows));
		return console.log(`${id} ${field} set${refreshLists()}`);
	}
	return usage();
}

try { main(process.argv.slice(2)); } catch (e) { console.log(clean(e.message)); process.exitCode = 1; }
