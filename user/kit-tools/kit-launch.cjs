'use strict';
// The guard launcher (V3, 1.25.1). A project cannot guard itself: in 1.25.0 a patch, a branch, a stash or a script the
// agent wrote replaced the project's guard files, and the next call ran the replaced guard (workbench
// results/v3-proof/RESULT.md). So the one PreToolUse entry lives in the Claude config folder's settings.json, which a
// project file cannot rewrite, and it runs from here. Before every call it hashes the project's guard files against
// the record `kit.mjs install project` wrote beside it, outside the project. Any difference holds every call until
// install puts the kit's copies back; with none, it runs the project's guard in this process, from the bytes it just
// hashed, so a file swapped after the check is never the one that runs.
//   node kit-launch.cjs                       PreToolUse (stdin: the hook input)
//   node kit-launch.cjs config-change         ConfigChange: refuses a settings change that would turn the hooks off
//   node kit-launch.cjs git-hook <project>    the kit's git hook shims: exit 1 when the guard files changed
// Its home is always the folder it sits in, never an environment variable a project's settings could set. In a
// folder with no record it does nothing: that folder is not a kit project, or predates this launcher.
// What it cannot reach: a script that also rewrites this folder (no OS barrier on native Windows), and a payload that
// acts inside the same command that planted it; the git hook shims narrow the second for commits and pushes.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Module = require('module');

const HOME = path.dirname(__dirname);
const RECORDS = path.join(HOME, 'kit-guard');
const SHELLS = ['Bash', 'PowerShell'];
const posix = (p) => String(p).split(path.sep).join('/');

/** The record folder for a project: Claude Code's folder name for it, lower-cased on Windows (one drive, any case). */
function recordDir(dir) {
	const slug = path.resolve(dir).replace(/[^A-Za-z0-9]/g, '-');
	return path.join(RECORDS, process.platform === 'win32' ? slug.toLowerCase() : slug);
}

function readRecord(dir) {
	try { return JSON.parse(fs.readFileSync(path.join(recordDir(dir), 'record.json'), 'utf8')); } catch { return null; }
}

/** The project a call belongs to: the nearest folder with a record, from the call's folder, then the session's. */
function findProject(input) {
	const tried = new Set();
	const starts = [input.cwd, process.env.CLAUDE_PROJECT_DIR].filter(Boolean);
	// The transcript sits in <home>/projects/<the session's project slug>/: Claude Code names it, no setting can.
	for (const start of starts) {
		for (let d = path.resolve(String(start)); !tried.has(d); d = path.dirname(d)) {
			tried.add(d);
			const rec = readRecord(d);
			if (rec) return { dir: rec.projectDir ? path.resolve(rec.projectDir) : d, rec };
		}
	}
	if (input.transcript_path) {
		const slug = path.basename(path.dirname(String(input.transcript_path)));
		try {
			const rec = JSON.parse(fs.readFileSync(path.join(RECORDS, process.platform === 'win32' ? slug.toLowerCase() : slug, 'record.json'), 'utf8'));
			if (rec && rec.projectDir) return { dir: path.resolve(rec.projectDir), rec };
		} catch { /* no record for that session */ }
	}
	return null;
}

const SETTINGS_KEYS = ['CLAUDE_CONFIG_DIR', 'CLAUDE_PROJECT_DIR', 'KIT_CLAUDE_HOME'];
/** Why a settings file's text would take the guards off, or ''. */
function settingsProblem(text) {
	let s;
	try { s = JSON.parse(text); } catch { return ''; }
	if (!s || typeof s !== 'object') return '';
	if (s.disableAllHooks === true) return '"disableAllHooks": true turns off every hook, the kit guards with them';
	const env = s.env && typeof s.env === 'object' ? Object.keys(s.env).filter((k) => SETTINGS_KEYS.includes(k)) : [];
	if (env.length) return `its env sets ${env.join(', ')}, which moves where the guards look`;
	return '';
}

/** Everything that differs from the record: guard files, the git hooks setting, settings that turn hooks off. */
function verify(dir, rec, extraDirs = []) {
	const changed = [];
	const files = new Map();
	for (const [key, want] of Object.entries(rec.files || {})) {
		const file = path.join(dir, key);
		let bytes = null;
		try { bytes = fs.readFileSync(file); } catch { /* missing */ }
		if (!bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== want) changed.push(key);
		else files.set(path.resolve(file), bytes.toString('utf8'));
	}
	// The git hook shims beside the record: one swapped there would skip this check at the next commit or push.
	for (const [name, want] of Object.entries(rec.shims || {})) {
		let bytes = null;
		try { bytes = fs.readFileSync(path.join(recordDir(dir), 'hooks', name)); } catch { /* missing */ }
		if (!bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== want) changed.push(`kit-guard hooks/${name}`);
	}
	const settings = [];
	for (const d of [dir, ...extraDirs]) {
		for (const name of ['settings.json', 'settings.local.json']) {
			const f = path.join(d, '.claude', name);
			let text = null;
			try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
			const why = settingsProblem(text);
			if (why && !settings.some((x) => x.file === f)) settings.push({ file: f, why });
		}
	}
	let hooksPath = null;
	if (rec.hooksPath) {
		// Read from the repo's own config file (no git process per call); a branch or a patch cannot reach .git.
		let cfg = '';
		try { cfg = fs.readFileSync(path.join(dir, '.git', 'config'), 'utf8'); } catch { /* a worktree or no repo */ }
		const m = /^\s*hookspath\s*=\s*(.*?)\s*$/im.exec(cfg);
		const now = m ? m[1].replace(/^"(.*)"$/, '$1').replace(/\\\\/g, '/').replace(/\\/g, '/') : '';
		if (cfg && now !== rec.hooksPath) hooksPath = now || 'unset';
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
	const target = v.settings.find((s) => ti.file_path && path.resolve(String(ti.file_path)) === path.resolve(s.file));
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
	for (const ext of ['.js', '.cjs']) {
		const disk = Module._extensions[ext] || Module._extensions['.js'];
		Module._extensions[ext] = function load(mod, filename) {
			const text = files.get(path.resolve(filename));
			if (text !== undefined) return mod._compile(text, filename);
			// A project file the record does not cover never loads in the guard process.
			if (path.resolve(filename).toLowerCase().startsWith(path.resolve(dir).toLowerCase() + path.sep)) throw new Error(`${posix(path.relative(dir, filename))} is not in the install record`);
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
	const extra = [input.cwd, process.env.CLAUDE_PROJECT_DIR].filter(Boolean).map((d) => path.resolve(String(d))).filter((d) => d !== dir);
	const v = verify(dir, rec, extra);
	if (v.changed.length || v.hooksPath) return isFix(input, rec, dir) ? null : deny(describe(v, rec, dir));
	if (v.settings.length && !clearsSettings(input, v)) return deny(describe(v, rec, dir));
	return runGuard(dir, v.files, input);
}

// ConfigChange: a settings file changed mid-session. A block keeps the old settings in force for this session.
function configChange(input) {
	const source = String(input.source || '');
	if (!['project_settings', 'local_settings', 'user_settings'].includes(source) || !input.file_path) return null;
	let text = '';
	try { text = fs.readFileSync(String(input.file_path), 'utf8'); } catch { return null; }
	if (source !== 'user_settings' && !findProject(input)) return null;
	let why = settingsProblem(text);
	if (!why && source === 'user_settings') {
		let s = {};
		try { s = JSON.parse(text) || {}; } catch { return null; }
		const wired = (event) => JSON.stringify(((s.hooks || {})[event]) || '').includes('kit-launch.cjs');
		if (!wired('PreToolUse') || !wired('ConfigChange')) why = 'it removes the kit guard launcher from the user settings';
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
	try {
		if (mode === 'config-change') out = input ? configChange(input) : null;
		else if (!input || typeof input !== 'object') out = null;
		else out = preToolUse(input);
	} catch (e) {
		// In a kit project a launcher that fails holds the call; anywhere else it stays out of the way.
		const kit = input && typeof input === 'object' && (() => { try { return findProject(input); } catch { return null; } })();
		if (kit && mode !== 'config-change') out = deny(`The kit guard launcher could not run (${String(e && e.message).slice(0, 160)}), so this call is held.`);
	}
	if (out) process.stdout.write(JSON.stringify(out));
}

module.exports = { verify, settingsProblem, recordDir, findProject, isFix };
