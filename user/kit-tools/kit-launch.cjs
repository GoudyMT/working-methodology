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
// The longest project folder name Claude Code writes whole.
const SLUG_MAX = 200;
const SHELLS = ['Bash', 'PowerShell'];
const WIN = process.platform === 'win32';
const posix = (p) => String(p).split(path.sep).join('/');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
// One folder by any spelling: an 8.3 short name (RUNNER~1) and its long name are the same folder, so each is
// read as the file system resolves it (seen in CI on 1.33.0: the session's own project, named by ".", was taken for
// another project with no record, and every read in it was held).
const real = (p) => { try { return fs.realpathSync.native(path.resolve(p)); } catch { return path.resolve(p); } };
const same = (a, b) => (WIN ? real(a).toLowerCase() === real(b).toLowerCase() : real(a) === real(b));

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
// only: the folder alone, as for a folder a command moves into (no session folder, no transcript).
function findProject(input, only = false) {
	const tried = new Set();
	// Each folder as written and as the file system resolves it (a junction, an 8.3 name): install records it by either.
	for (const start of (only ? [input.cwd] : [input.cwd, process.env.CLAUDE_PROJECT_DIR]).filter(Boolean).flatMap((x) => [x, real(String(x))])) {
		for (let d = path.resolve(String(start)); !tried.has(d); d = path.dirname(d)) {
			tried.add(d);
			const rec = readRecord(d);
			if (rec) return { dir: rec.projectDir ? path.resolve(rec.projectDir) : d, rec };
		}
	}
	// The transcript sits in <home>/projects/<the session's project slug>/: Claude Code names it, no setting can.
	if (!only && input.transcript_path) {
		const slug = path.basename(path.dirname(String(input.transcript_path)));
		let names = [];
		try { names = fs.readdirSync(RECORDS); } catch { /* none */ }
		const cuts = [];
		for (const n of names.filter((x) => x.toLowerCase().startsWith(slug.toLowerCase().slice(0, 100) + '-'))) {
			try {
				const rec = JSON.parse(fs.readFileSync(path.join(RECORDS, n, 'record.json'), 'utf8'));
				const full = rec && rec.projectDir ? path.resolve(rec.projectDir).replace(/[^A-Za-z0-9]/g, '-').toLowerCase() : null;
				// Past 200 characters Claude Code keeps the first 200, then a dash and a short hash of its own (C13, seen on
				// 2026-11-13): such a folder is matched by those 200 characters, a shorter one by its whole name.
				const cut = full && full.length > SLUG_MAX && new RegExp(`^.{${SLUG_MAX}}-[a-z0-9]{1,16}$`, 'i').test(slug) && full.slice(0, SLUG_MAX) === slug.slice(0, SLUG_MAX).toLowerCase();
				if (full && full === slug.toLowerCase()) return { dir: path.resolve(rec.projectDir), rec };
				if (cut) cuts.push({ dir: path.resolve(rec.projectDir), rec });
			} catch { /* not a record */ }
		}
		// Claude Code's own hash is not ours to work out, so two long paths alike in their first 200 characters cannot
		// be told apart here (the 1.29.0 sweep): neither is taken, and the call is held with the way out.
		if (cuts.length === 1) return cuts[0];
		if (cuts.length > 1) return { ambiguous: true };
	}
	return null;
}

// The settings env keys that change how node, git or the guards start, or where they look. A settings env reaches
// every hook and every command Claude Code runs, so one of these in a project file is a hold.
// The shell's own start-up variables are here too (the review of 670b3a2): an exported function, SHELLOPTS with PS4,
// or BASH_ENV runs code in the shell line before node starts.
const ENV_KEYS = /^(NODE_OPTIONS|NODE_PATH|PATH|PATHEXT|LD_PRELOAD|LD_LIBRARY_PATH|DYLD_INSERT_LIBRARIES|DYLD_LIBRARY_PATH|BASH_ENV|ENV|SHELLOPTS|BASHOPTS|PS4|PROMPT_COMMAND|BASH_XTRACEFD|IFS|CDPATH|GLOBIGNORE|BASH_FUNC_.*|GIT_CONFIG\w*|GIT_SSH\w*|GIT_PROXY_COMMAND|GIT_ASKPASS|SSH_ASKPASS|HTTPS?_PROXY|ALL_PROXY|GIT_DIR|GIT_WORK_TREE|GIT_COMMON_DIR|GIT_EXEC_PATH|CLAUDE_CONFIG_DIR|CLAUDE_PROJECT_DIR|KIT_\w*)$/i;

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

// The kit guards a settings file's PreToolUse hooks run themselves. Since 1.25.1 only the launcher in the Claude
// config folder runs them, so a project file in the older shape runs each one a second time (K49, reported by a
// project on the kit: the sweep guard's second check of a start found its own slot taken, and no reviewer could
// start). Only the kit's own places count: a project guard in .claude, a user hook in kit-hooks. A project's own
// hook of the same file name elsewhere is the project's (the 1.31.0 sweep). The whole command text is searched, so
// shell punctuation around the path (`;`, `&&`, `)`, `>>`) hides nothing.
const KIT_GUARD = /(?:^|[^\w.-])(?:\.claude[\\/](guard|owner-proof|task-gate|guard-outward|guard-delete)|kit-hooks[\\/](call-cap|canary|sweep-guard))\.cjs(?![\w.-])/gi;
/** The kit guard files one hook entry runs itself, in order, or []. */
function runsKitGuard(h) {
	if (!h || typeof h !== 'object') return [];
	const text = [String(h.command || ''), ...(Array.isArray(h.args) ? h.args.map(String) : [])].join(' ').replace(/\\\\/g, '/');
	const found = [];
	for (const m of text.matchAll(KIT_GUARD)) { const f = `${(m[1] || m[2]).toLowerCase()}.cjs`; if (!found.includes(f)) found.push(f); }
	return found;
}
/** The kit guard files a settings file's PreToolUse hooks run themselves, in order, or []. */
function oldGuardEntries(text) {
	let s = null;
	try { s = JSON.parse(String(text).replace(/^\ufeff/, '')); } catch { return []; }
	const groups = s && s.hooks && typeof s.hooks === 'object' && Array.isArray(s.hooks.PreToolUse) ? s.hooks.PreToolUse : [];
	const found = [];
	for (const g of groups) for (const h of g && typeof g === 'object' && Array.isArray(g.hooks) ? g.hooks : []) for (const f of runsKitGuard(h)) if (!found.includes(f)) found.push(f);
	return found;
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
	// A folder list the record does not hold yet (written after the install, or by a kit from before 1.29.0) could be
	// dropped again with nothing to show it was there: it is held until install records it, which the fix line does.
	if (!(rec.files || {})['.claude/protected-folders.json'] && fs.existsSync(path.join(dir, '.claude', 'protected-folders.json'))) changed.push('.claude/protected-folders.json (a folder list not in the install record yet)');
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
	// The folder list has its own way back: the install below does not accept a list that is gone or changed.
	if (v.changed.includes('.claude/protected-folders.json')) parts.push('The folder list (.claude/protected-folders.json) is gone or changed since install recorded it: put it back as it was, or the owner accepts the change in their own terminal with install project --accept-host .claude/protected-folders.json.');
	if (parts.length && kitUnchanged(rec)) parts.push(`Every call is held until the kit's copies are back. Run, alone: ${fixLine(rec, dir)} (or ask the owner to).`);
	else if (parts.length) parts.push(`Every call is held until the kit's copies are back. The kit folder (${posix(rec.kitDir || '<kit folder>')}) has changed since this install, so no install may run from this session: the owner runs it in a terminal, from the release copy on its tag (PowerShell runs a quoted program only after &). PowerShell: & ${fixLine(rec, dir)} Bash: ${fixLine(rec, dir)}`);
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
function unrecorded(input, only = false) {
	for (const start of (only ? [input.cwd] : [input.cwd, process.env.CLAUDE_PROJECT_DIR]).filter(Boolean)) {
		let d = path.resolve(String(start));
		for (let up = path.dirname(d); ; d = up, up = path.dirname(d)) {
			if (fs.existsSync(path.join(d, '.kit', 'kit-version.json')) && fs.existsSync(path.join(d, '.claude', 'guard.cjs'))) return d;
			if (up === d) break;
		}
	}
	return null;
}

// Every folder a shell command moves into (cd, chdir, pushd, Set-Location, sl, or git -C), at its start or after a
// separator or an opening bracket, resolved from the session's folder. Seen live 2026-11-15: a session started outside
// a kit project worked in one through cd, and the project's guards never ran, since the project was found by the
// session's folder alone. A folder built at run time ($x, %x%, ~, a backtick) stays unread, as for every guard.
// The kit projects a shell command names, other than the session's own (seen live 2026-11-15: a session outside a
// kit project worked in one through cd, and none of its guards ran). A reader of moves always misses a spelling
// (the sweep found command cd, bash -c, eval, cd --, a quote inside a path, GIT_DIR=, 8.3 names, chained relative
// moves), so this reads no moves and fails toward checking: a project is named when its folder's own name appears
// in the command with no name character on either side, in any spelling (case, slashes, quotes, a backslash escape, Git Bash's /c/ form, home as ~ or
// $HOME), when a path in it resolves into the project (a relative path, an 8.3 short name), or when a wildcard in it
// could match the project's path or name; a brace list is expanded and $'...' quoting decoded, as the shell does. A named project's guards run on the call as if it were started there. A
// project whose name only appears in a command costs one more check, never a pass. A name built at run time ($x, a
// backtick) stays unread, as for every guard.
function recordedProjects() {
	let names = [];
	try { names = fs.readdirSync(RECORDS); } catch { return []; }
	const out = [];
	for (const n of names) {
		try {
			const rec = JSON.parse(fs.readFileSync(path.join(RECORDS, n, 'record.json'), 'utf8'));
			if (rec && typeof rec.projectDir === 'string') out.push(path.resolve(rec.projectDir));
		} catch { /* not a record */ }
	}
	return out;
}
function namedProjects(input) {
	if (!input || !SHELLS.includes(input.tool_name)) return [];
	const command = String((input.tool_input && input.tool_input.command) ?? '');
	if (!command.trim()) return [];
	const cwd = path.resolve(String(input.cwd || process.cwd()));
	const fold = (s) => (WIN ? s.toLowerCase() : s);
	const home = posix(require('os').homedir());
	// One spelling for a path: home expanded, forward slashes, no quotes, the drive as c:/, no doubled slashes.
	const norm = (s) => fold(String(s).replace(/(^|[\s=(:;&|"'])(~|\$HOME|\$\{HOME\}|\$env:USERPROFILE|%USERPROFILE%)(?=[/\\\s"']|$)/gi, (m, a) => a + home))
		.replace(/\\/g, '/').replace(/["'`]/g, '').replace(/(^|[\s=(:;&|])\/([a-zA-Z])\//g, (m, a, d) => `${a}${d}:/`).replace(/\/{2,}/g, '/');
	// $'...' is read as the text bash makes of its escapes, and $"..." as the string itself (the third review, on cd0f9f5).
	const ESC = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', v: '\v' };
	const decoded = command.replace(/\$'((?:[^'\\]|\\[\s\S])*)'/g, (m, body) => body.replace(/\\(x[0-9a-fA-F]{1,2}|u[0-9a-fA-F]{1,4}|U[0-9a-fA-F]{1,8}|c[\s\S]|[0-7]{1,3}|[\s\S])/g, (e, c) => {
		if (/^[xuU][0-9a-fA-F]/.test(c)) { const n = parseInt(c.slice(1), 16); return n <= 0x10ffff ? String.fromCodePoint(n) : ''; }
		if (/^c[\s\S]$/.test(c)) return String.fromCharCode(c.charCodeAt(1) & 0x1f);
		if (/^[0-7]/.test(c)) return String.fromCharCode(parseInt(c, 8) & 0xff);
		return ESC[c] ?? c;
	})).replace(/\$"/g, '"');
	// A brace list or range ({a,b}, {1..3}, {01..10..2}, {a..e}) builds names the command never writes out: each word is
	// expanded as bash does (zero padding and steps included). Only the names it really makes count, so a command with
	// braces costs no check of a project it does not name (1.33.1: failing closed on every brace, $'' or lone [ ran the
	// guards of every recorded project and timed the hook out). One that would make more than NAMES_MAX names, or nests
	// deeper than bash reads here, cannot be read for sure and is held with its reason (unreadable), never fanned out.
	const NAMES_MAX = 4096;
	const made = [];
	let unreadable = '';
	// bash takes a sign on either end and on the step ({+7..7}, {1..3..+1}); the build 11 repro of the MC3 trial.
	const RANGE = /^(?:([-+]?\d+)\.\.([-+]?\d+)|([A-Za-z])\.\.([A-Za-z]))(?:\.\.([-+]?\d+))?$/;
	const rangeOf = (body) => {
		const m = RANGE.exec(body);
		if (!m) return null;
		const step = Math.abs(Number(m[5] || 1)) || 1;
		if (m[1] !== undefined) {
			const [a, b] = [Number(m[1]), Number(m[2])];
			// Ends past a safe whole number cannot be counted exactly: held (the 1.33.1 review).
			if (![a, b, step].every(Number.isSafeInteger) || Math.floor(Math.abs(b - a) / step) + 1 > NAMES_MAX) return { count: Infinity };
			// bash pads to the longer end when either end starts with a 0.
			const width = /^[-+]?0\d/.test(m[1]) || /^[-+]?0\d/.test(m[2]) ? Math.max(m[1].length, m[2].length) : 0;
			const pad = (n) => (n < 0 ? '-' + String(-n).padStart(width - 1, '0') : String(n).padStart(width, '0'));
			const out = [];
			const n = Math.floor(Math.abs(b - a) / step) + 1;
			for (let k = 0; k < n; k++) out.push(pad(a <= b ? a + k * step : a - k * step));
			return { alts: out };
		}
		const [a, b] = [m[3].charCodeAt(0), m[4].charCodeAt(0)];
		const out = [];
		for (let i = a; a <= b ? i <= b : i >= b; i += a <= b ? step : -step) out.push(String.fromCharCode(i));
		return { alts: out };
	};
	// The first group bash expands in a word, read as bash does (build 11, the MC3 trial's repro: a{p,{z}}p built app
	// unread): a brace and its matching close, with a comma at its own level (a list, whose items may hold braces of
	// their own) or a range; any other brace is text, and the search goes on inside it.
	// A word is a list of characters, each marked quoted or not: a quoted or escaped brace or comma is text to bash. The
	// pairs are found in one pass with a stack (the push security review: a scan per brace was quadratic, and a brace
	// with no close ended the search where bash skips it).
	const WORD_MAX = 8192;
	// The work one command may cost the reader, in characters scanned over every expansion (the push security review:
	// nested lists could multiply the scans past the hook's 10 s). Past it the command is held as unreadable.
	const WORK_MAX = 2000000;
	let work = 0;
	const firstGroup = (w) => {
		work += w.length;
		if (work > WORK_MAX) { unreadable = 'braces that would take the guard too long to read'; return null; }
		const stack = [];
		let best = null;
		for (let j = 0; j < w.length; j++) {
			if (w[j].q) continue;
			if (w[j].c === '{') stack.push({ start: j, cuts: [] });
			else if (w[j].c === ',' && stack.length) stack[stack.length - 1].cuts.push(j);
			else if (w[j].c === '}' && stack.length) {
				const g = stack.pop();
				if (best && best.start < g.start) continue;
				if (g.cuts.length) {
					const alts = [];
					let from = g.start + 1;
					for (const c of [...g.cuts, j]) { alts.push(w.slice(from, c)); from = c + 1; }
					best = { start: g.start, end: j, alts };
				} else if (w.slice(g.start + 1, j).every((x) => !x.q && x.c !== '{' && x.c !== '}')) {
					const r = rangeOf(w.slice(g.start + 1, j).map((x) => x.c).join(''));
					if (r) best = { start: g.start, end: j, ...r, alts: r.alts && r.alts.map((a) => [...a].map((c) => ({ c, q: false }))) };
				}
			}
		}
		return best;
	};
	const expandWord = (w, depth = 0) => {
		if (unreadable) return;
		const g = firstGroup(w);
		if (unreadable) return;
		if (!g) { if (made.length >= NAMES_MAX) unreadable = `more than ${NAMES_MAX} names from its braces`; else made.push(w.map((x) => x.c).join('')); return; }
		if (depth > 16) { unreadable = 'braces nested deeper than the guard reads'; return; }
		if (g.count === Infinity) { unreadable = `more than ${NAMES_MAX} names from its braces`; return; }
		for (const alt of g.alts) expandWord([...w.slice(0, g.start), ...alt, ...w.slice(g.end + 1)], depth + 1);
	};
	// Each word is read two ways and both count, so a reading the guard gets wrong can only add a check: as bash splits
	// and quotes it, and as plain text split at spaces (the reading before build 11).
	const bashWords = (s) => {
		const words = [];
		let cur = [];
		let q = null;
		for (let i = 0; i < s.length; i++) {
			const ch = s[i];
			if (q === "'") { if (ch === "'") q = null; else cur.push({ c: ch, q: true }); continue; }
			// In double quotes a backslash escapes only $ ` " \ and a new line; before anything else it stays (bash).
			if (q === '"') { if (ch === '"') q = null; else if (ch === '\\' && i + 1 < s.length && /[$`"\\\n]/.test(s[i + 1])) cur.push({ c: s[++i], q: true }); else cur.push({ c: ch, q: true }); continue; }
			if (ch === "'" || ch === '"') { q = ch; continue; }
			if (ch === '\\' && i + 1 < s.length) { cur.push({ c: s[++i], q: true }); continue; }
			if (/\s/.test(ch)) { if (cur.length) words.push(cur); cur = []; continue; }
			cur.push({ c: ch, q: false });
		}
		if (cur.length) words.push(cur);
		return words;
	};
	const plainWords = decoded.split(/\s+/).filter(Boolean).map((w) => [...w].map((c) => ({ c, q: false })));
	for (const w of [...bashWords(decoded), ...plainWords]) {
		if (!w.some((x) => x.c === '{')) continue;
		if (w.length > WORD_MAX) { unreadable = `a word over ${WORD_MAX} characters with braces in it`; break; }
		expandWord(w);
	}
	// A backslash is a separator on Windows and an escape in a POSIX shell (my\ app is "my app"): both readings count.
	const spelled = `${decoded} ${made.join(' ')}`;
	let text = `${norm(spelled)} ${norm(spelled.replace(/\\(.)/g, '$1'))}`;
	// A comma ends a word in a PowerShell list (a,b), and is a plain character inside a bracket set ([a,b]pp, K120):
	// both readings count.
	const tokens = [...new Set([...text.split(/[\s;&|(){}=,]+/), ...text.split(/[\s;&|(){}=]+/)].filter(Boolean))];
	// A wildcard (*, ?, [set], [!set], [[:alpha:]]) is compiled once and matched without a regex, in time linear in the
	// two lengths for each star (the third review). A [ with no ] after it is a plain character, as in the shell.
	const POSIX = { alpha: /[A-Za-z]/, digit: /[0-9]/, alnum: /[A-Za-z0-9]/, upper: /[A-Z]/, lower: /[a-z]/, space: /\s/, blank: /[ \t]/,
		punct: /[!-\/:-@[-`{-~]/, xdigit: /[0-9A-Fa-f]/, word: /\w/, cntrl: /[\x00-\x1f\x7f]/, print: /[ -~]/, graph: /[!-~]/, ascii: /[\x00-\x7f]/ };
	const compile = (g) => {
		const pat = [];
		const lastClose = g.lastIndexOf(']');
		for (let i = 0; i < g.length; i++) {
			const ch = g[i];
			if (ch === '*') { if (pat[pat.length - 1] !== '*') pat.push('*'); continue; }
			if (ch === '?') { pat.push('?'); continue; }
			if (ch === '[' && lastClose > i + 1) {
				let j = i + 1;
				const neg = g[j] === '!' || g[j] === '^';
				if (neg) j++;
				const items = [];
				let first = true;
				let closed = -1;
				for (; j < g.length; j++) {
					if (g[j] === ']' && !first) { closed = j; break; }
					first = false;
					const cls = g[j] === '[' && g[j + 1] === ':' ? /^\[:([a-z]+):\]/.exec(g.slice(j, j + 12)) : null;
					if (cls && POSIX[cls[1]]) { items.push(POSIX[cls[1]]); j += cls[0].length - 1; continue; }
					if (g[j + 1] === '-' && j + 2 < g.length && g[j + 2] !== ']') { items.push([g[j], g[j + 2]]); j += 2; continue; }
					items.push(g[j]);
				}
				if (closed > 0) { pat.push({ neg, items }); i = closed; continue; }
			}
			pat.push(ch);
		}
		return pat;
	};
	const one = (p, c) => {
		if (p === '?') return true;
		// The pattern was folded with the command on Windows, so its letters match either case there; a class still reads
		// the name as written (the build 16 sweep: [!a-z]yApp is MyApp).
		if (typeof p === 'string') return p === c || (WIN && p.toLowerCase() === c.toLowerCase());
		const hit = p.items.some((x) => (x instanceof RegExp ? x.test(c) : Array.isArray(x) ? c >= x[0] && c <= x[1] : x === c));
		return hit !== p.neg;
	};
	const globMatch = (pat, str) => {
		let pi = 0, si = 0, star = -1, mark = 0;
		while (si < str.length) {
			if (pi < pat.length && pat[pi] !== '*' && one(pat[pi], str[si])) { pi++; si++; } else if (pi < pat.length && pat[pi] === '*') { star = pi++; mark = si; } else if (star >= 0) { pi = star + 1; si = ++mark; } else return false;
		}
		while (pi < pat.length && pat[pi] === '*') pi++;
		return pi === pat.length;
	};
	const isGlob = (t) => /[*?]/.test(t) || (t.indexOf('[') >= 0 && t.indexOf(']', t.indexOf('[') + 2) > 0);
	// A wildcard names what it matches on disk, as the shell expands it from the session's folder: a * in a folder with
	// no kit project names none, wherever the projects are (the 1.33.1 sweep: matching it against every project's name
	// ran all their guards). Past GLOB_MAX matches or READS_MAX folder reads it cannot be read for sure and is held.
	const GLOB_MAX = 4096;
	const READS_MAX = 256;
	let reads = 0;
	const expandGlob = (t) => {
		const drive = /^[a-z]:\//i.exec(t);
		const rootLen = drive ? 3 : t.startsWith('/') ? 1 : 0;
		// A relative wildcard is read from the session's folder and from every folder the command names, since a cd before
		// it may have moved there (the 1.33.1 review).
		let bases = rootLen ? [t.slice(0, rootLen)] : [posix(cwd) + '/', ...dirs.map((d) => posix(d) + '/')];
		// Every folder a wildcard part matched is named, not only the last part's: a file part after it (A*/x.tx?) matches
		// no folder, and the project it sits in is still reached.
		const found = [];
		for (const seg of t.slice(rootLen).split('/').filter(Boolean)) {
			if (!isGlob(seg)) { bases = bases.map((b) => b + seg + '/'); continue; }
			// The folders read are named too (a link on the way, zz/.claude/g*, reaches the project it points into).
			found.push(...bases);
			const pat = compile(seg);
			const next = [];
			for (const b of bases) {
				if (++reads > READS_MAX) { unreadable = 'more folder reads than the guard makes for its wildcards'; return []; }
				let ents = [];
				try { ents = fs.readdirSync(b, { withFileTypes: true }); } catch { continue; }
				// K120 (1.42.0): only a folder or a link can be or lead into a kit project, so a plain file match is no name
				// (a wildcard over thousands of files was held). The name is matched as folded and as written: on Windows a
				// capital class ([[:upper:]]pp) matches App, which the folded app never does.
				for (const e of ents) if ((e.isDirectory() || e.isSymbolicLink()) && (globMatch(pat, fold(e.name)) || globMatch(pat, e.name))) next.push(b + e.name + '/');
				if (next.length > GLOB_MAX) { unreadable = `more than ${GLOB_MAX} matches for its wildcards`; return []; }
			}
			bases = next;
			found.push(...next);
		}
		return [...new Set([...found, ...bases])].map((b) => b.replace(/\/$/, ''));
	};
	// A relative path, an 8.3 short name or a wildcard's match: the folder it names, as the file system resolves it from
	// the session. A kit project the launcher has no record for is found from these too, so it holds the call as it
	// would there.
	const unrec = [];
	const seen = new Set();
	const dirs = [];
	const resolveTo = (t, from = cwd) => {
		let real = '';
		try { real = fs.realpathSync.native(path.resolve(from, t)); } catch { return; }
		if (seen.has(real)) return;
		seen.add(real);
		try {
			if (fs.statSync(real).isDirectory()) {
				if (dirs.length >= DIRS_MAX) unreadable = `more than ${DIRS_MAX} folders to read its wildcards from`;
				else dirs.push(real);
			}
		} catch { /* gone */ }
		text += ` ${norm(real)}`;
		const u = unrecorded({ cwd: real }, true);
		if (u && !unrec.some((x) => same(x, u))) unrec.push(u);
	};
	// Paths first, so a relative wildcard is also read from the folders they name. A bare name (cd app) is a folder too
	// when it is one, from the session's folder or from a folder named before it (the review of c07f2bd); a command whose
	// wildcards follow more folders than the guard reads is held.
	// K120 (1.42.0): a command that names many folders and no wildcard (ls d0 ... d69) was held; with no wildcard to read
	// from them, the cap is for the passes alone.
	const DIRS_MAX = tokens.some(isGlob) ? 64 : 256;
	// Each folder is listed once and its names looked up, not a stat per word and folder: 4,000 bare names beside 60
	// folders took about 9 s of the hook's 10 s (K120).
	// The names are compared without case or Unicode form on every platform (a file system that ignores them, as on
	// macOS, finds App for app; the commit security review); a name that does not exist as written fails at resolveTo.
	const key = (s) => String(s).normalize('NFC').toLowerCase();
	const listed = new Map();
	const namesIn = (base) => {
		if (!listed.has(base)) {
			const s = new Set();
			try { for (const e of fs.readdirSync(base, { withFileTypes: true })) if (e.isDirectory() || e.isSymbolicLink()) s.add(key(e.name)); } catch { /* unreadable: none */ }
			listed.set(base, s);
		}
		return listed.get(base);
	};
	const rooted = (t) => /^([a-z]:)?[\\/]/i.test(t) || t.startsWith('~');
	// Read again while a pass finds a new folder, so a name inside a folder found later in the pass is read from it too
	// (cd a && cd b && cd a, the review of bfad509); DIRS_MAX bounds the passes. A relative path is read from every
	// folder found as well, so a chain of moves (cd .. && cd .. && cd ..) is followed to its end (K120).
	// A path that climbs (..) is read from a found folder only as many times as the command writes a climb, so it never
	// walks on past what the moves could reach.
	// Counted on the text the tokens come from (quotes gone, braces made), so a quoted ".." counts (the commit security
	// review); each reading of the command counts, which can only read further.
	let climbs = (text.match(/(^|[/\s;&|(=])\.\.(?=$|[/\s;&|)])/g) || []).length;
	for (let before = -1; before !== dirs.length && !unreadable;) {
		before = dirs.length;
		for (const t of tokens) {
			if (isGlob(t) || /\$/.test(t)) continue;
			if (/[/~.]/.test(t)) {
				if (rooted(t)) { resolveTo(t); continue; }
				resolveTo(t);
				const climb = /(^|[\\/])\.\.($|[\\/])/.test(t);
				// The build 16 sweep: a dotted name was resolved from every folder found (28 s for 1,800 names beside 250
				// folders). Only a first part that is a folder or link there can lead anywhere new; a plain file in a
				// folder already read adds nothing, so it is looked up in the folder's listing first.
				const head = t.split('/')[0];
				const leads = (base) => climb || head === '.' || head === '' || namesIn(base).has(key(head));
				for (const base of dirs.slice()) {
					if (climb && climbs <= 1) break;
					if (!leads(base)) continue;
					const had = dirs.length;
					resolveTo(t, base);
					if (climb && dirs.length > had) climbs--;
				}
				continue;
			}
			for (const base of [cwd, ...dirs]) if (namesIn(base).has(key(t))) resolveTo(path.join(base, t));
		}
	}
	for (const t of tokens) {
		if (unreadable) break;
		if (isGlob(t)) for (const m of expandGlob(t)) resolveTo(m);
	}
	const WORD = /[A-Za-z0-9_.-]/;
	// p appears with no name character after it; bounded, with none before it either (a name may hold a space, so it
	// is never read as one word of the command).
	const has = (p, bounded) => {
		for (let i = text.indexOf(p); i >= 0; i = text.indexOf(p, i + 1)) {
			const next = text[i + p.length];
			if ((next === undefined || !WORD.test(next)) && (!bounded || i === 0 || !WORD.test(text[i - 1]))) return true;
		}
		return false;
	};
	const out = [];
	const recorded = recordedProjects();
	for (const dir of recorded) {
		const p = norm(dir);
		const name = norm(path.basename(dir));
		const under = norm(posix(path.relative(cwd, dir)));
		const below = under && !under.startsWith('..') && !path.isAbsolute(under);
		if (has(p) || has(name, true) || (below && has(under, true))) out.push(dir);
	}
	// A folder found by its real path may be a recorded project under another spelling (an 8.3 short name): that record's.
	for (const u of unrec) {
		const dir = recorded.find((d) => same(d, u)) || u;
		if (!out.some((x) => same(x, dir))) out.push(dir);
	}
	if (unreadable) out.unreadable = unreadable;
	return out;
}

// E35 (1.36.0, reproduced on 1.35.0 from the folder above a kit project): a file tool names its project by its path, as
// a shell command does by its words, so a Write or Edit of a kit project's file from outside it runs that project's
// guards. A recorded project that holds the path, else a kit project found above it.
// The tools that write a file by its path; a read changes nothing a guard keeps (the 1.36.0 sweep).
const FILE_WRITES = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
function fileProjects(input) {
	const ti = (input && input.tool_input) || {};
	const p = ti.file_path ?? ti.notebook_path;
	if (!FILE_WRITES.includes(input && input.tool_name) || typeof p !== 'string' || !p) return [];
	const out = [];
	// A network path is never touched here (a share that does not answer would stall every call to the hook's time-out),
	// and it cannot be placed in a project without it: held, with the way out. A \\?\ or \\.\ drive path is the drive path.
	let spelled = String(p);
	if (WIN && /^[\\/]{2}[?.][\\/][a-zA-Z]:/.test(spelled)) spelled = spelled.slice(4);
	if (/^[\\/]{2}/.test(spelled)) { out.held = 'writes to a network path'; return out; }
	let abs = path.resolve(String(input.cwd || process.cwd()), spelled);
	// A file with a second name (a hard link) may be a guard file under another path: held, as state.mjs and install hold it.
	// stat, not lstat: a link outside the project that leads to such a file is held as the file is (the commit review).
	try { if (fs.statSync(abs).nlink > 1) { out.held = 'writes a file that has a second name (a hard link)'; return out; } } catch { /* not there yet */ }
	try { abs = fs.realpathSync.native(abs); } catch { try { abs = path.join(fs.realpathSync.native(path.dirname(abs)), path.basename(abs)); } catch { /* not there yet */ } }
	const real = (d) => { try { return fs.realpathSync.native(d); } catch { return d; } };
	// A recorded folder is matched by its real path and handed on by its recorded spelling, the one its record answers to.
	const inside = (d) => { const rel = path.relative(real(d), abs); return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel); };
	out.push(...recordedProjects().filter(inside));
	const u = unrecorded({ cwd: path.dirname(abs) }, true);
	if (u && !out.some((x) => same(real(x), u))) out.push(u);
	return out;
}

/**
 * Whether a recorded folder is gone (K94, build 12): the file system says it is not there, and no folder above it
 * holds its name in another case. A folder the session cannot read (a denied read, set by a command the guards allow)
 * is there (the build 12 sweep: existsSync read it as gone, and its guards were skipped).
 */
function gone(dir) {
	try { fs.lstatSync(dir); return false; } catch (e) { if (e.code !== 'ENOENT') return false; }
	const parent = path.dirname(dir);
	if (parent === dir) return true;
	try {
		const base = path.basename(dir).toLowerCase();
		return !fs.readdirSync(parent).some((n) => n.toLowerCase() === base);
	} catch (e) { return e.code === 'ENOENT' || e.code === 'ENOTDIR'; }
}

// Whether a call is the forget of this gone project and nothing else: one shell command, node running a kit.mjs with
// forget and this folder, no separator, redirect, substitution or variable anywhere in it.
function forgets(input, dir) {
	if (!SHELLS.includes(input && input.tool_name)) return false;
	const command = String(((input && input.tool_input) || {}).command ?? '').trim();
	if (/[;&|<>`$()\n{}]/.test(command.replace(/^&\s+/, ''))) return false;
	const m = /^(?:&\s+)?(?:"([^"]+)"|(\S+))\s+(?:"([^"]+)"|(\S+))\s+forget\s+(?:"([^"]+)"|([^"\s]+))$/i.exec(command);
	if (!m) return false;
	const fold = (s) => (WIN ? s.toLowerCase() : s);
	const same = (a, b) => fold(posix(a)) === fold(posix(b));
	const cwd = String(input.cwd || process.cwd());
	// The program is node by name or the node that runs this launcher, and the script is the installed kit's own
	// kit.mjs, by its real path (the push security review: any script named kit.mjs passed).
	const program = m[1] || m[2];
	if (!(program === 'node' || same(path.resolve(cwd, program), process.execPath) || same(path.resolve(cwd, program), process.execPath.replace(/\.exe$/i, '')))) return false;
	let kitDir = null;
	try { kitDir = JSON.parse(fs.readFileSync(path.join(HOME, 'kit-install.json'), 'utf8')).kitDir || null; } catch { return false; }
	const real = (p) => { try { return fs.realpathSync.native(p); } catch { return null; } };
	const script = real(path.resolve(cwd, m[3] || m[4]));
	const kitScript = kitDir && real(path.join(kitDir, 'scripts', 'kit.mjs'));
	if (!script || !kitScript || !same(script, kitScript)) return false;
	return same(path.resolve(cwd, m[5] || m[6]), path.resolve(dir));
}

function preToolUse(input) {
	const here = projectCheck(input);
	// Each other kit project the command names checks it too, with its own folder as the call's, and holds it as it would
	// a call started there. The strictest answer wins: a refusal, then an ask, then the rest (as guard.cjs merges).
	const mine = findProject(input);
	const answers = [here];
	const named = namedProjects(input);
	// One the reader cannot read for sure is held with its reason, never fanned out over every project (1.33.1).
	if (named.unreadable && recordedProjects().some((d) => !(mine && !mine.ambiguous && same(mine.dir, d)))) {
		answers.push(deny(`This command makes ${named.unreadable}, so the kit cannot tell which of its projects it reaches. Split it into smaller commands, or spell the folders out.`));
	}
	// A file path is handed on whole, as the session's folder resolves it: read from the other project's folder, a
	// relative one would name another file (the push security review of E35).
	const ti = input.tool_input || {};
	const key = typeof ti.file_path === 'string' ? 'file_path' : typeof ti.notebook_path === 'string' ? 'notebook_path' : null;
	const fanned = key ? { ...input, tool_input: { ...ti, [key]: path.resolve(String(input.cwd || process.cwd()), ti[key]) } } : input;
	const files = fileProjects(input);
	// Held whether or not a project is recorded: an unrecorded one is reachable too (the commit review).
	if (files.held) answers.push(deny(`Held: this tool ${files.held}, so the kit cannot tell which of its projects it reaches. Use the file's own path on its drive.`));
	for (const dir of [...named, ...files.filter((d) => !named.some((x) => same(x, d)))]) {
		if (mine && !mine.ambiguous && same(mine.dir, dir)) continue;
		// K94 (build 12): a recorded folder that is gone held every command naming it, the forget that clears it included,
		// with a reason that sent the owner to reinstall it. Now forget, alone, passes; anything else naming it is held
		// with the way out, since a command could make it again with guards no install wrote (the build 12 sweep: any
		// reading of which commands write is a parser the shell can differ from, so none is kept).
		if (gone(dir)) {
			if (!forgets(input, dir)) answers.push(deny(`Held: ${posix(dir)} is a kit project that was deleted, and its guard record is still kept. Clear it first, alone: node "<kit folder>/scripts/kit.mjs" forget "${posix(dir)}" (or ask the owner to).`));
			continue;
		}
		answers.push(projectCheck({ ...fanned, cwd: dir }, true));
	}
	const rank = (o) => { const d = o && o.hookSpecificOutput && o.hookSpecificOutput.permissionDecision; return d === 'deny' ? 3 : d === 'ask' ? 2 : o ? 1 : 0; };
	return answers.reduce((best, o) => (rank(o) > rank(best) ? o : best), null);
}

function projectCheck(input, only = false) {
	const found = findProject(input, only);
	if (found && found.ambiguous) return deny('Held: this session\'s folder name fits more than one installed kit project with a long path, so the kit cannot tell which guards to run. Start the session inside the project folder, or shorten the path.');
	if (!found) {
		// Fails closed: a kit project the launcher has no record for runs no guard until install writes one.
		const dir = unrecorded(input, only);
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

module.exports = { gone, kitFingerprint, runGuard, verify, settingsProblem, oldGuardEntries, runsKitGuard, recordName, legacyRecordName, recordDir, findProject, isFix, launchCommand, launcherWired, installedNode, shellDir, shq, hooksPathNow };
