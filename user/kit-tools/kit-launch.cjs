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
		for (const n of names.filter((x) => x.toLowerCase().startsWith(slug.toLowerCase() + '-'))) {
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
		const named = [...body.matchAll(/"([^"]+)"\s*:/g)].map((m) => m[1]).filter((k) => ENV_KEYS.test(k));
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
function verify(dir, rec, extraDirs = []) {
	const changed = [];
	const files = new Map();
	for (const [key, want] of Object.entries(rec.files || {})) {
		const file = path.join(dir, key);
		let bytes = null;
		try { bytes = fs.readFileSync(file); } catch { /* missing */ }
		if (!bytes || sha(bytes) !== want) changed.push(key);
		else files.set(path.resolve(file), bytes.toString('utf8'));
	}
	// The git hook shims beside the record: one swapped there would skip this check at the next commit or push.
	for (const [name, want] of Object.entries(rec.shims || {})) {
		let bytes = null;
		try { bytes = fs.readFileSync(path.join(recordDir(dir), 'hooks', name)); } catch { /* missing */ }
		if (!bytes || sha(bytes) !== want) changed.push(`kit-guard hooks/${name}`);
	}
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
	return { changed, settings, hooksPath, files };
}

const fixLine = (rec, dir) => `node "${posix(rec.kitDir || '<kit folder>')}/scripts/kit.mjs" install project "${posix(dir)}"`;

function describe(v, rec, dir) {
	const parts = [];
	if (v.changed.length) parts.push(`Kit guard files changed outside install: ${v.changed.join(', ')}.`);
	if (v.hooksPath) parts.push(`core.hooksPath changed outside install (now ${v.hooksPath}).`);
	if (parts.length) parts.push(`Every call is held until the kit's copies are back. Run, alone: ${fixLine(rec, dir)} (or ask the owner to).`);
	for (const s of v.settings) parts.push(`${posix(s.file)}: ${s.why}. Every call is held until the owner takes that out of the file.`);
	return parts.join(' ');
}

// The one call that may run while the guards are held: the install that puts them back, alone on its line.
function isFix(input, rec, dir) {
	if (!SHELLS.includes(String(input.tool_name))) return false;
	const cmd = String((input.tool_input && input.tool_input.command) || '').trim();
	if (/[;&|`$<>\r\n(){}]/.test(cmd.replace(/"[^"$`]*"/g, '""'))) return false;
	const norm = (p) => posix(path.resolve(p)).toLowerCase();
	const m = /^node\s+"?([^"\s]+|[^"]+)"?\s+install\s+project\s+("([^"]+)"|(\S+))(\s+--(force|unreleased))*$/.exec(cmd.replace(/\\/g, '/'));
	if (!m || !rec.kitDir) return false;
	const script = m[1].replace(/^"|"$/g, '');
	return norm(script) === norm(path.join(rec.kitDir, 'scripts', 'kit.mjs')) && norm(m[3] || m[4]) === norm(dir);
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

const deny = (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });

/** Run the project's guard from the bytes verify() hashed: a file swapped after the check is never loaded. */
function runGuard(dir, files, input) {
	const guard = path.resolve(dir, '.claude', 'guard.cjs');
	if (!files.has(guard)) return deny('The kit guard (.claude/guard.cjs) is not in the install record, so this call is held. Reinstall the kit: ' + 'kit.mjs install project.');
	const inside = (f, root) => path.resolve(f).toLowerCase().startsWith(path.resolve(root).toLowerCase() + path.sep);
	for (const ext of ['.js', '.cjs']) {
		const disk = Module._extensions[ext] || Module._extensions['.js'];
		Module._extensions[ext] = function load(mod, filename) {
			const text = files.get(path.resolve(filename));
			if (text !== undefined) return mod._compile(text, filename);
			// A project file the record does not cover never loads in the guard process. The Claude config folder's own
			// hooks load even when that folder sits inside the project (a home folder project, a dotfiles repo).
			if (inside(filename, dir) && !inside(filename, HOME)) throw new Error(`${posix(path.relative(dir, filename))} is not in the install record`);
			return disk(mod, filename);
		};
	}
	return require(guard).check(input);
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
		let kitDir = null;
		try { kitDir = JSON.parse(fs.readFileSync(path.join(HOME, 'kit-install.json'), 'utf8')).kitDir || null; } catch { /* none */ }
		const rec = { kitDir };
		if (isFix(input, rec, dir)) return null;
		return deny(`This kit project has no guard record in ${posix(RECORDS)}, so no guard can check it and every call is held. Run, alone: ${fixLine(rec, dir)} (or ask the owner to).`);
	}
	const { dir, rec } = found;
	const extra = [input.cwd, process.env.CLAUDE_PROJECT_DIR].filter(Boolean).map((d) => path.resolve(String(d))).filter((d) => !same(d, dir));
	const v = verify(dir, rec, extra);
	if (v.changed.length || v.hooksPath) return isFix(input, rec, dir) ? null : deny(describe(v, rec, dir));
	if (v.settings.length && !clearsSettings(input, v)) return deny(describe(v, rec, dir));
	return runGuard(dir, v.files, input);
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

function gitHook(dir) {
	const rec = readRecord(dir);
	if (!rec) return `Kit: no guard record for ${posix(dir)} in ${posix(RECORDS)}. Run kit.mjs install project.`;
	const v = verify(path.resolve(rec.projectDir || dir), rec);
	if (!v.changed.length && !v.hooksPath && !v.settings.length) return '';
	return `Kit: git hook held. ${describe(v, rec, path.resolve(rec.projectDir || dir))}`;
}

if (require.main === module) {
	const mode = process.argv[2] || '';
	if (mode === 'git-hook') {
		let why = '';
		try { why = gitHook(process.argv[3] || process.cwd()); } catch (e) { why = `Kit: the guard check could not run (${String(e && e.message).slice(0, 160)}).`; }
		if (why) { process.stderr.write(why + '\n'); process.exit(1); }
		process.exit(0);
	}
	let input = null;
	try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { /* below */ }
	let out = null;
	const inKit = (i) => { try { return Boolean(findProject(i) || unrecorded(i)); } catch { return true; } };
	try {
		if (mode === 'config-change') out = input ? configChange(input) : null;
		// Input it cannot read: inside a kit project the call is held, anywhere else it stays out of the way.
		else if (!input || typeof input !== 'object') out = inKit({}) ? deny('The kit guard launcher could not read this call, so it is held.') : null;
		else out = preToolUse(input);
	} catch (e) {
		if (mode !== 'config-change' && inKit(input && typeof input === 'object' ? input : {})) out = deny(`The kit guard launcher could not run (${String(e && e.message).slice(0, 160)}), so this call is held.`);
	}
	if (out) process.stdout.write(JSON.stringify(out));
}

module.exports = { verify, settingsProblem, recordName, recordDir, findProject, isFix, launchCommand, launcherWired, installedNode, shellDir, shq, hooksPathNow };
