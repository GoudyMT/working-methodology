'use strict';
// The guard launcher (V3, 1.25.1). A project cannot guard itself: in 1.25.0 a patch, a branch, a stash or a script the
// agent wrote replaced the project's guard files, and the next call ran the replaced guard (workbench
// results/v3-proof/RESULT.md). So the one PreToolUse entry lives in the Claude config folder's settings.json, which a
// project file cannot rewrite, and it runs from here. Before every call it hashes the project's guard files against
// the record `kit.mjs install project` wrote beside it, outside the project. Any difference holds every call until
// install puts the kit's copies back; with none, it runs the project's guard in this process, from the bytes it just
// hashed, so a file swapped after the check is never the one that runs.
//   node kit-launch.cjs                       PreToolUse (stdin: the hook input)
//   node kit-launch.cjs config-change         ConfigChange: refuses a settings change that would take the guards off
//   node kit-launch.cjs git-hook <project>    the kit's git hook shims: exit 1 when the guard files changed
// Its home is always the folder it sits in, never an environment variable a project's settings could set. The entry
// that starts it is a shell line that clears NODE_OPTIONS and puts node's own folder first on PATH: a settings env
// reaches every hook process (proven live, 2026-11-11), and NODE_OPTIONS would run code here before this file loads.
// In a folder with no record it does nothing: that folder is not a kit project, or predates this launcher.
// What it cannot reach: a script that also rewrites this folder (no OS barrier on native Windows), and a payload that
// acts inside the same command that planted it; the git hook shims narrow the second for commits and pushes.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Module = require('module');
const { spawnSync } = require('child_process');

const HOME = path.dirname(__dirname);
const RECORDS = path.join(HOME, 'kit-guard');
const SHELLS = ['Bash', 'PowerShell'];
const WIN = process.platform === 'win32';
const posix = (p) => String(p).split(path.sep).join('/');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => (WIN ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b));

/**
 * The record folder's name for a project: Claude Code's folder name for it, plus a short hash of the full path, so two
 * projects whose names differ only in punctuation (app-x, app_x) never share a record. One case on Windows.
 */
function recordName(dir) {
	const full = WIN ? path.resolve(dir).toLowerCase() : path.resolve(dir);
	// The name is cut to its first 100 characters (B13): the shims sit in it, and a long project path took them past
	// Windows' 260, where git finds no hook and the kit hooks stop silently. The hash of the full path keeps two long
	// paths apart; a name that fits is the one 1.25.1 gave, so an installed project keeps its record.
	return `${full.replace(/[^A-Za-z0-9]/g, '-').slice(0, 100)}-${sha(full).slice(0, 10)}`;
}
/** The name 1.25.1 gave a record, before B13 cut it: install finds an old record by it and moves it (C2). */
function legacyRecordName(dir) {
	const full = WIN ? path.resolve(dir).toLowerCase() : path.resolve(dir);
	return `${full.replace(/[^A-Za-z0-9]/g, '-')}-${sha(full).slice(0, 10)}`;
}
const recordDir = (dir) => path.join(RECORDS, recordName(dir));

function readRecord(dir) {
	try { return JSON.parse(fs.readFileSync(path.join(recordDir(dir), 'record.json'), 'utf8')); } catch { return null; }
}

/** The project a call belongs to: the nearest folder with a record, from the call's folder, then the session's. */
function findProject(input) {
	const tried = new Set();
	for (const start of [input.cwd, process.env.CLAUDE_PROJECT_DIR].filter(Boolean)) {
		for (let d = path.resolve(String(start)); !tried.has(d); d = path.dirname(d)) {
			tried.add(d);
			const rec = readRecord(d);
			if (rec) return { dir: rec.projectDir ? path.resolve(rec.projectDir) : d, rec };
		}
	}
	// The transcript sits in <home>/projects/<the session's project slug>/: Claude Code names it, no setting can.
	if (input.transcript_path) {
		const slug = path.basename(path.dirname(String(input.transcript_path)));
		let names = [];
		try { names = fs.readdirSync(RECORDS); } catch { /* none */ }
		for (const n of names.filter((x) => x.toLowerCase().startsWith(slug.toLowerCase().slice(0, 100) + '-'))) {
			try {
				const rec = JSON.parse(fs.readFileSync(path.join(RECORDS, n, 'record.json'), 'utf8'));
				if (rec && rec.projectDir && path.resolve(rec.projectDir).replace(/[^A-Za-z0-9]/g, '-').toLowerCase() === slug.toLowerCase()) return { dir: path.resolve(rec.projectDir), rec };
			} catch { /* not a record */ }
		}
	}
	return null;
}

// The settings env keys that change how node, git or the guards start, or where they look. A settings env reaches
// every hook and every command Claude Code runs, so one of these in a project file is a hold.
// The shell's own start-up variables are here too (the review of 670b3a2): an exported function, SHELLOPTS with PS4,
// or BASH_ENV runs code in the shell line before node starts.
const ENV_KEYS = /^(NODE_OPTIONS|NODE_PATH|PATH|PATHEXT|LD_PRELOAD|LD_LIBRARY_PATH|DYLD_INSERT_LIBRARIES|DYLD_LIBRARY_PATH|BASH_ENV|ENV|SHELLOPTS|BASHOPTS|PS4|PROMPT_COMMAND|BASH_XTRACEFD|IFS|CDPATH|GLOBIGNORE|BASH_FUNC_.*|GIT_CONFIG\w*|GIT_DIR|GIT_WORK_TREE|GIT_COMMON_DIR|GIT_EXEC_PATH|CLAUDE_CONFIG_DIR|CLAUDE_PROJECT_DIR|KIT_\w*)$/i;

/** Why a settings file's text would take the guards off, or ''. */
function settingsProblem(text) {
	const body = String(text).replace(/^\uFEFF/, '');
	let s = null;
	try { s = JSON.parse(body); } catch { /* read the text itself below */ }
	if (!s || typeof s !== 'object') {
		// A file JSON.parse cannot read may still be one another reader takes (a comment, a stray comma): the safe side.
		if (/"disableAllHooks"\s*:\s*true/.test(body)) return '"disableAllHooks": true turns off every hook, the kit guards with them';
		const named = [...body.matchAll(/"([^"]+)"\s*:/g)].map((m) => m[1]).filter((k) => k !== 'env' && ENV_KEYS.test(k));
		return named.length ? `its env may set ${[...new Set(named)].join(', ')}, which changes how the guards start` : '';
	}
	if (s.disableAllHooks === true) return '"disableAllHooks": true turns off every hook, the kit guards with them';
	const env = s.env && typeof s.env === 'object' ? Object.keys(s.env).filter((k) => ENV_KEYS.test(k)) : [];
	if (env.length) return `its env sets ${env.join(', ')}, which changes how the guards start or where they look`;
	return '';
}

const normPath = (p) => { const x = String(p || '').replace(/^"(.*)"$/, '$1').replace(/\\\\/g, '/').replace(/\\/g, '/'); return WIN ? x.toLowerCase() : x; };

/**
 * The hooks path git uses in this repo. The repo's own config file is read when it is plain (one value, in [core], no
 * include, no worktree config); anything else asks git itself, which takes the last value across every file it reads.
 */
function hooksPathNow(dir) {
	const gitDir = path.join(dir, '.git');
	// A config this cannot read goes to git; one git cannot read either is a hold, never a pass (the review of 670b3a2).
	let cfg = '';
	let plain = !fs.existsSync(path.join(gitDir, 'config.worktree'));
	try { cfg = fs.readFileSync(path.join(gitDir, 'config'), 'utf8'); } catch { plain = false; }
	let section = '';
	const values = [];
	for (const raw of cfg.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line[0] === '#' || line[0] === ';') continue;
		const head = /^\[([^\]]*)\](.*)$/.exec(line);
		if (head) {
			section = head[1].trim().toLowerCase();
			if (head[2].trim() || /^include/.test(section)) plain = false;
			continue;
		}
		const kv = /^([A-Za-z][A-Za-z0-9-]*)\s*(?:=\s*(.*))?$/.exec(line);
		if (!kv) { plain = false; continue; }
		const key = kv[1].toLowerCase();
		if (section === 'extensions' && key === 'worktreeconfig') plain = false;
		if (key === 'hookspath') {
			if (section !== 'core' || /[#;\\]/.test(kv[2] || '')) plain = false;
			else values.push(kv[2] || '');
		}
	}
	if (plain && values.length <= 1) return normPath(values[0] || '');
	const env = { ...process.env };
	for (const k of Object.keys(env)) if (/^GIT_/i.test(k)) delete env[k];
	// git starts from node's own folder, so a git planted in the project is not the one found first on Windows.
	const r = spawnSync('git', ['-C', dir, 'config', '--get-all', 'core.hooksPath'], { encoding: 'utf8', env, cwd: path.dirname(process.execPath), timeout: 5000 });
	// git config exits 1 for a key that is not set; anything else means it could not read its config.
	if (r.status !== 0 && r.status !== 1) return 'unreadable (git could not read this repo\'s config)';
	const all = String(r.stdout || '').split(/\r?\n/).filter(Boolean);
	return normPath(all[all.length - 1] || '');
}

/** Everything that differs from the record: guard files, the hook shims, the git hooks setting, settings that take hooks off. */
function verify(dir, rec, extraDirs = [], shimsAt = path.join(recordDir(dir), 'hooks')) {
	const changed = [];
	const files = new Map();
	const byKey = new Map();
	// Each guard file is read at its real place, and only when that is where the project says it is: through a junction
	// or link, require would load it again from the link's target, which can change between the two (the second pass on
	// 0772397). The loader is keyed by that real place, found the way require finds it (fs.realpathSync).
	let real = null;
	try { real = fs.realpathSync(dir); } catch { /* the project is gone: every file below is missing */ }
	const same2 = (a, b) => (WIN ? a.toLowerCase() === b.toLowerCase() : a === b);
	for (const [key, want] of Object.entries(rec.files || {})) {
		let at = null;
		try { at = fs.realpathSync(path.join(dir, key)); } catch { /* missing */ }
		if (at && real && !same2(at, path.join(real, key))) { changed.push(`${key} (reached through a link)`); continue; }
		let bytes = null;
		try { bytes = at && fs.readFileSync(at); } catch { /* missing */ }
		// A host's own file passes at any version the owner accepted (B15); only the host's, never a kit file.
		const ok = bytes && (sha(bytes) === want || ((rec.host || []).includes(key) && ((rec.accepted || {})[key] || []).includes(sha(bytes))));
		if (!ok) changed.push(key);
		else { files.set(WIN ? at.toLowerCase() : at, bytes.toString('utf8')); byKey.set(key, bytes); }
	}
	// A hook in .githooks that no record holds would run through the shims with no check (the second pass on 0772397).
	let hookNames = [];
	try { hookNames = fs.readdirSync(path.join(dir, '.githooks'), { withFileTypes: true }).filter((e) => !e.isDirectory()).map((e) => e.name); } catch { /* none */ }
	for (const name of hookNames) if (!(rec.files || {})[`.githooks/${name}`]) changed.push(`.githooks/${name} (not in the install record)`);
	// The git hook shims beside the record: one swapped there would skip this check at the next commit or push.
	for (const [name, want] of Object.entries(rec.shims || {})) {
		let bytes = null;
		try { bytes = fs.readFileSync(path.join(shimsAt, name)); } catch { /* missing */ }
		if (!bytes || sha(bytes) !== want) changed.push(`kit-guard hooks/${name}`);
	}
	// A file in the shims folder that install did not write is a hook git would run with no check.
	let inShims = [];
	try { inShims = fs.readdirSync(shimsAt); } catch { /* none */ }
	for (const name of inShims) if (rec.shims && !Object.prototype.hasOwnProperty.call(rec.shims, name)) changed.push(`kit-guard hooks/${name} (not in the install record)`);
	const settings = [];
	for (const d of [dir, ...extraDirs]) {
		for (const name of ['settings.json', 'settings.local.json']) {
			const f = path.join(d, '.claude', name);
			let text = null;
			try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
			const why = settingsProblem(text);
			if (why && !settings.some((x) => same(x.file, f))) settings.push({ file: f, why });
		}
	}
	let hooksPath = null;
	if (rec.hooksPath) {
		const now = hooksPathNow(dir);
		if (now !== null && now !== normPath(rec.hooksPath)) hooksPath = now || 'unset';
	}
	return { changed, settings, hooksPath, files, byKey, real: real || path.resolve(dir) };
}

const fixLine = (rec, dir) => `"${posix(installedNode() || 'node')}" "${posix(rec.kitDir || '<kit folder>')}/scripts/kit.mjs" install project "${posix(dir)}"`;

function describe(v, rec, dir) {
	const parts = [];
	if (v.changed.length) parts.push(`Kit guard files changed outside install: ${v.changed.join(', ')}.`);
	if (v.hooksPath) parts.push(`core.hooksPath changed outside install (now ${v.hooksPath}).`);
	if (parts.length && kitUnchanged(rec)) parts.push(`Every call is held until the kit's copies are back. Run, alone: ${fixLine(rec, dir)} (or ask the owner to).`);
	else if (parts.length) parts.push(`Every call is held until the kit's copies are back. The kit folder (${posix(rec.kitDir || '<kit folder>')}) has changed since this install, so no install may run from this session: the owner runs ${fixLine(rec, dir)} in a terminal, from the release copy on its tag.`);
	for (const s of v.settings) parts.push(`${posix(s.file)}: ${s.why}. Every call is held until the owner takes that out of the file.`);
	return parts.join(' ');
}

// What the fix line may install from: every file under the kit folder but its git data, the owner's reports and the
// tests (install reads none of them), by path and content. The record keeps the one install wrote from; a kit folder
// changed since (a branch checked out there, one file edited or added) no longer matches, so the held install cannot
// record a swapped guard as good (the second pass on 0772397). A link anywhere in it leaves it unpinned: no fix line.
// Of its git folder, the parts that name programs git runs or what it reads count (config, info, hooks); a .git file
// (a worktree whose git folder is elsewhere) leaves it unpinned.
const KIT_SKIP = new Set(['reports', 'node_modules', 'tests', 'scrub.local.json']);
const GIT_KEEP = new Set(['config', 'config.worktree', 'commondir', 'info', 'hooks']);
function kitFingerprint(kitDir) {
	const h = crypto.createHash('sha256');
	// A git folder counts only its parts that name programs git runs or what it reads.
	const gitTop = (rel) => ['.git/', '@gitdir/', '@common/'].includes(rel);
	const walk = (abs, rel) => {
		for (const e of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
			if (!rel && KIT_SKIP.has(e.name)) continue;
			if (gitTop(rel) && !GIT_KEEP.has(e.name)) continue;
			const r = rel + e.name;
			if (e.isSymbolicLink()) throw new Error('link');
			if (e.isDirectory()) walk(path.join(abs, e.name), r + '/');
			else if (e.isFile()) h.update(`${r}\0${sha(fs.readFileSync(path.join(abs, e.name)))}\n`);
		}
	};
	try {
		const top = path.resolve(kitDir);
		walk(top, '');
		// A worktree (W2): its .git file names its own git folder, and that names the shared one; both are pinned the way
		// a plain clone's .git folder is.
		const dotGit = path.join(top, '.git');
		if (fs.existsSync(dotGit) && fs.lstatSync(dotGit).isFile()) {
			const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(dotGit, 'utf8'));
			if (!m) throw new Error('a .git file that names no git folder');
			const own = path.resolve(top, m[1]);
			h.update(`@gitdir\0${posix(own)}\n`);
			walk(own, '@gitdir/');
			let common = null;
			try { common = path.resolve(own, fs.readFileSync(path.join(own, 'commondir'), 'utf8').trim()); } catch { /* none */ }
			if (common) { h.update(`@common\0${posix(common)}\n`); walk(common, '@common/'); }
		}
	} catch { return null; }
	return h.digest('hex');
}
const kitUnchanged = (rec) => !!rec.kitFingerprint && kitFingerprint(rec.kitDir) === rec.kitFingerprint;

// The shell words of a command, split on spaces and tabs only: plain words, or words in double quotes (no $, backtick
// or backslash) or single quotes; a backslash outside single quotes is an escape in a shell, so it is refused. Anything else (an operator, a substitution, a redirect, a line break, which ends a
// command in a shell) gives null.
function words(cmd) {
	if (/[^\x20-\x7e\t]/.test(cmd)) return null;
	const out = [];
	const re = /[ \t]*(?:"([^"$`\\]*)"|'([^']*)'|([A-Za-z0-9_.:/@%+=,-]+))(?=[ \t]|$)/y;
	let m;
	while (re.lastIndex < cmd.length && (m = re.exec(cmd))) out.push(m[1] ?? m[2] ?? m[3]);
	return re.lastIndex === cmd.length ? out : null;
}

// The one call that may run while the guards are held: the install that puts them back, alone on its line, with the
// kit script and the project as full paths (no . or .. part, no flag before the script), and only while the kit
// folder is the one the record was written from.
function isFix(input, rec, dir) {
	if (!SHELLS.includes(String(input.tool_name)) || !rec.kitDir) return false;
	let cmd = String((input.tool_input && input.tool_input.command) || '').trim();
	// PowerShell runs a quoted program with its call operator.
	if (String(input.tool_name) === 'PowerShell' && /^&[ \t]/.test(cmd)) cmd = cmd.slice(1);
	const w = words(cmd);
	if (!w || w.length < 5 || w.length > 6 || w[2] !== 'install' || w[3] !== 'project') return false;
	if (w.length === 6 && w[5] !== '--force') return false;
	const exact = (word, want) => {
		const p = word.replace(/\\/g, '/');
		if (!path.isAbsolute(p) || p.split('/').some((x) => x === '.' || x === '..') || p.endsWith('/')) return false;
		const a = posix(path.normalize(p));
		const b = posix(path.resolve(want));
		return WIN ? a.toLowerCase() === b.toLowerCase() : a === b;
	};
	// node as install user recorded it, never as PATH finds it: a node planted earlier on PATH would run the install.
	const node = installedNode();
	return !!node && exact(w[0], node) && exact(w[1], path.join(rec.kitDir, 'scripts', 'kit.mjs')) && exact(w[4], dir) && kitUnchanged(rec);
}

// A write that takes the offending key back out of a settings file is the way out of a settings hold: it goes on to
// the project guard, which asks the owner's yes for any settings write.
function clearsSettings(input, v) {
	const t = String(input.tool_name);
	const ti = input.tool_input || {};
	const target = v.settings.find((s) => ti.file_path && same(String(ti.file_path), s.file));
	if (!target || v.settings.length !== 1) return false;
	let next = null;
	if (t === 'Write') next = String(ti.content ?? '');
	if (t === 'Edit') {
		try { next = fs.readFileSync(target.file, 'utf8'); } catch { return false; }
		next = ti.replace_all ? next.split(String(ti.old_string)).join(String(ti.new_string)) : next.replace(String(ti.old_string), () => String(ti.new_string));
	}
	return next !== null && !settingsProblem(next);
}

// Every launcher refusal is a hold (T16a's "Held" kind): the guard files or settings are not as install left them.
const deny = (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Held: ' + reason } });

/** Run the project's guard from the bytes verify() hashed: a file swapped after the check is never loaded. */
function runGuard(real, files, input, fix = 'the owner reinstalls the kit with install project') {
	const dir = real;
	const guard = path.join(real, '.claude', 'guard.cjs');
	if (!files.has(WIN ? guard.toLowerCase() : guard)) return deny(`The kit guard (.claude/guard.cjs) is not in the install record. ${fix}.`);
	const inside = (f, root) => path.resolve(f).toLowerCase().startsWith(path.resolve(root).toLowerCase() + path.sep);
	const key = (f) => (WIN ? path.resolve(f).toLowerCase() : path.resolve(f));
	// The config folder's kit hooks, by the hash install user recorded for each (B23): any other file there, or one
	// changed since install user, is refused like a file outside the record.
	let userFiles = {};
	try { userFiles = JSON.parse(fs.readFileSync(path.join(HOME, 'kit-install.json'), 'utf8')).files || {}; } catch { /* none */ }
	for (const ext of ['.js', '.cjs']) {
		Module._extensions[ext] = function load(mod, filename) {
			const text = files.get(key(filename));
			if (text !== undefined) return mod._compile(text, filename);
			// Only the bytes verify() checked load here, and the Claude config folder's own kit hooks with the bytes install
			// user recorded (even when that folder sits inside the project: a home folder project, a dotfiles repo).
			// Anything else is refused, wherever it is: a link swapped after the check can send a require outside the
			// project (the security review on 330dbbf).
			const rel = inside(filename, HOME) ? posix(path.relative(HOME, filename)) : '';
			const named = /^kit-hooks\/[^/]+\.cjs$/i.test(rel) && Object.keys(userFiles).find((k) => (WIN ? k.toLowerCase() === rel.toLowerCase() : k === rel));
			const want = named ? userFiles[named] : null;
			let bytes = null;
			try { bytes = want && fs.readFileSync(filename); } catch { /* missing */ }
			if (!bytes || sha(bytes) !== want) throw new Error(`${posix(inside(filename, dir) ? path.relative(dir, filename) : filename)} is not in the install record`);
			return mod._compile(bytes.toString('utf8'), filename);
		};
	}
	// The guard itself is compiled from the checked bytes under its checked name, never found again by require.
	const m = new Module(guard, null);
	m.filename = guard;
	m.paths = Module._nodeModulePaths(path.dirname(guard));
	m._compile(files.get(key(guard)), guard);
	return m.exports.check(input);
}

/** A kit project with guard files but no record here: its record was deleted, or it predates this launcher. */
function unrecorded(input) {
	for (const start of [input.cwd, process.env.CLAUDE_PROJECT_DIR].filter(Boolean)) {
		let d = path.resolve(String(start));
		for (let up = path.dirname(d); ; d = up, up = path.dirname(d)) {
			if (fs.existsSync(path.join(d, '.kit', 'kit-version.json')) && fs.existsSync(path.join(d, '.claude', 'guard.cjs'))) return d;
			if (up === d) break;
		}
	}
	return null;
}

function preToolUse(input) {
	const found = findProject(input);
	if (!found) {
		// Fails closed: a kit project the launcher has no record for runs no guard until install writes one.
		const dir = unrecorded(input);
		if (!dir) return null;
		let rec = {};
		try { const u = JSON.parse(fs.readFileSync(path.join(HOME, 'kit-install.json'), 'utf8')); rec = { kitDir: u.kitDir || null, kitFingerprint: u.kitFingerprint || null }; } catch { /* none */ }
		if (isFix(input, rec, dir)) return null;
		return deny(`This kit project has no guard record in ${posix(RECORDS)}, so no guard can check it and every call is held. Run, alone: ${fixLine(rec, dir)} (or ask the owner to).`);
	}
	const { dir, rec } = found;
	const extra = [input.cwd, process.env.CLAUDE_PROJECT_DIR].filter(Boolean).map((d) => path.resolve(String(d))).filter((d) => !same(d, dir));
	const v = verify(dir, rec, extra);
	if (v.changed.length || v.hooksPath) return isFix(input, rec, dir) ? null : deny(describe(v, rec, dir));
	if (v.settings.length && !clearsSettings(input, v)) return deny(describe(v, rec, dir));
	return runGuard(v.real, v.files, input, `Run, alone: ${fixLine(rec, dir)} (or ask the owner to)`);
}

// ---- The entries install user writes, and the strict check that they are still whole. ----

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
/** A folder as a POSIX shell's PATH names it: Git Bash on Windows reads C:\x as /c/x. */
const shellDir = (p) => (WIN && /^[A-Za-z]:/.test(p) ? `/${p[0].toLowerCase()}${posix(p.slice(2))}` : posix(p));

/**
 * The shell line that starts the launcher: NODE_OPTIONS cleared, and node named by its full path, so neither a
 * settings env nor a PATH or shell function can run code in it or swap the node that runs it.
 *
 * Args:
 *     launcher: the launcher's path
 *     nodePath: the node install user ran with (kit-install.json keeps it)
 *     mode: '' for PreToolUse, 'config-change' for ConfigChange
 */
function launchCommand(launcher, nodePath, mode = '') {
	return `NODE_OPTIONS= ${shq(shellDir(nodePath))} ${shq(posix(launcher))}${mode ? ` ${mode}` : ''}`;
}

/** The node install user recorded beside this launcher, or null. */
function installedNode() {
	try { return JSON.parse(fs.readFileSync(path.join(HOME, 'kit-install.json'), 'utf8')).node || null; } catch { return null; }
}

const everyTool = (m) => m === undefined || m === null || m === '' || m === '*' || m === '.*';

/**
 * Whether a settings object still runs this launcher whole, as install wrote it: the exact line (this launcher, the
 * recorded node), on every tool, blocking on failure, with no condition, and on every settings change. A name kept in
 * a neutered entry, or another node, does not count.
 */
function launcherWired(s, launcher = __filename, nodePath = installedNode()) {
	if (!nodePath) return false;
	const eq = (a, b) => (WIN ? a.toLowerCase() === b.toLowerCase() : a === b);
	const has = (event, mode, extra) => (((s && s.hooks) || {})[event] || []).some((e) => everyTool(e.matcher)
		&& (e.hooks || []).some((h) => h.type === 'command' && !h.args && !h.if && eq(String(h.command || ''), launchCommand(launcher, nodePath, mode)) && extra(h)));
	return has('PreToolUse', '', (h) => h.onFailure === 'block') && has('ConfigChange', 'config-change', () => true);
}

// ConfigChange: a settings file changed mid-session. A block keeps the old settings in force for this session.
function configChange(input) {
	const source = String(input.source || '');
	if (!['project_settings', 'local_settings', 'user_settings'].includes(source) || !input.file_path) return null;
	let text = null;
	try { text = fs.readFileSync(String(input.file_path), 'utf8'); } catch { /* gone */ }
	let why = '';
	if (source === 'user_settings') {
		// The user settings carry the launcher itself: deleted, unreadable or neutered, every guard goes with them.
		let s = null;
		try { s = JSON.parse(String(text).replace(/^\uFEFF/, '')); } catch { /* below */ }
		why = text === null ? 'it deletes the user settings that run the kit guard launcher'
			: !s ? 'the user settings are no longer valid JSON, so Claude Code would drop the kit guard launcher'
			: settingsProblem(text) || (launcherWired(s) ? '' : 'it removes or changes the kit guard launcher entry in the user settings');
	} else {
		if (text === null || !findProject(input)) return null;
		why = settingsProblem(text);
	}
	if (!why) return null;
	const msg = `Kit: the change to ${posix(input.file_path)} was not applied: ${why}. The owner edits that file by hand, then starts a new session.`;
	return { decision: 'block', reason: msg, systemMessage: msg };
}

/**
 * The git hook check a shim runs. With a hook name, the guard files it checked are written, from the very bytes it
 * hashed, to a folder beside the record, and the copy of the hook is what the shim runs: a file swapped in the project
 * between the check and the run is never the one that runs (the 1.26.0 sweep, C11). The hooks find their helpers
 * beside them ($(dirname "$0")/../.claude), so the helpers run from the checked copies too.
 *
 * Returns:
 *     { why } when held, or { run } the path of the checked copy of the hook ('' with no hook name)
 */
function gitHook(dir, name = '') {
	const rec = readRecord(dir);
	if (!rec) return { why: `Kit: no guard record for ${posix(dir)} in ${posix(RECORDS)}. Run kit.mjs install project.` };
	const v = verify(path.resolve(rec.projectDir || dir), rec);
	if (v.changed.length || v.hooksPath || v.settings.length) return { why: `Kit: git hook held. ${describe(v, rec, path.resolve(rec.projectDir || dir))}` };
	if (!name) return { run: '' };
	const key = `.githooks/${name}`;
	if (!/^[A-Za-z0-9._-]+$/.test(name) || !v.byKey.has(key)) return { why: `Kit: .githooks/${name} is not in the install record; run kit.mjs install project.` };
	const all = [...v.byKey.keys()].sort();
	const id = sha(all.map((k) => `${k}\0${sha(v.byKey.get(k))}`).join('\n')).slice(0, 16);
	const runs = path.join(recordDir(dir), 'run');
	const at = path.join(runs, id);
	// A copy written earlier is used again only while every file in it is the checked bytes and nothing else is there
	// (the review on cfd3813); otherwise it is written afresh.
	const intact = () => {
		const seen = [];
		const walk = (d, rel) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) walk(path.join(d, e.name), r); else seen.push(r); } };
		try { walk(at, ''); } catch { return false; }
		return seen.length === all.length && seen.every((k) => v.byKey.has(k) && sha(fs.readFileSync(path.join(at, ...k.split('/')))) === sha(v.byKey.get(k)));
	};
	if (fs.existsSync(at) && !intact()) fs.rmSync(at, { recursive: true, force: true });
	if (!fs.existsSync(at)) {
		const tmp = `${at}.${process.pid}`;
		for (const k of all) {
			const f = path.join(tmp, ...k.split('/'));
			fs.mkdirSync(path.dirname(f), { recursive: true });
			fs.writeFileSync(f, v.byKey.get(k));
			if (k.startsWith('.githooks/')) fs.chmodSync(f, 0o755);
		}
		try { fs.renameSync(tmp, at); } catch { fs.rmSync(tmp, { recursive: true, force: true }); }
	}
	// Copies from an earlier install go once they are an hour old (a hook still running from one keeps its files).
	try {
		for (const e of fs.readdirSync(runs)) {
			const p = path.join(runs, e);
			if (e !== id && Date.now() - fs.statSync(p).mtimeMs > 3600000) fs.rmSync(p, { recursive: true, force: true });
		}
	} catch { /* nothing to tidy */ }
	return { run: posix(path.join(at, '.githooks', name)) };
}

if (require.main === module) {
	const mode = process.argv[2] || '';
	if (mode === 'git-hook') {
		let r = {};
		try { r = gitHook(process.argv[3] || process.cwd(), process.argv[4] || ''); } catch (e) { r = { why: `Kit: the guard check could not run (${String(e && e.message).slice(0, 160)}).` }; }
		if (r.why) { process.stderr.write(r.why + '\n'); process.exit(1); }
		if (r.run) process.stdout.write(r.run);
		process.exit(0);
	}
	let input = null;
	try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { /* below */ }
	let out = null;
	const inKit = (i) => { try { return Boolean(findProject(i) || unrecorded(i)); } catch { return true; } };
	try {
		if (mode === 'config-change') out = input ? configChange(input) : null;
		// Input it cannot read: inside a kit project the call is held, anywhere else it stays out of the way.
		else if (!input || typeof input !== 'object') out = inKit({}) ? deny('The kit guard launcher could not read this call.') : null;
		else out = preToolUse(input);
	} catch (e) {
		if (mode !== 'config-change' && inKit(input && typeof input === 'object' ? input : {})) out = deny(`The kit guard launcher could not run (${String(e && e.message).slice(0, 160)}).`);
	}
	if (out) process.stdout.write(JSON.stringify(out));
}

module.exports = { kitFingerprint, runGuard, verify, settingsProblem, recordName, legacyRecordName, recordDir, findProject, isFix, launchCommand, launcherWired, installedNode, shellDir, shq, hooksPathNow };
