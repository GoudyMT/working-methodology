'use strict';
// K174: the kit plugin's one hook launcher. `kit.mjs build plugin` copies this file to <plugin root>/launch.cjs, and
// the plugin's hooks/hooks.json runs it for every event the plugin wires:
//   (no mode)       PreToolUse, started through kit-tools/kit-start.sh (K205's timed retry)
//   session-start   SessionStart: the kit's start-up report, from the plugin's own kit copy (kit-hook.cjs)
//   prompt          UserPromptSubmit: the kit gate, then kit-hook.cjs prompt
//   subagent-stop   SubagentStop: each role's Stop hooks
//   config-change   ConfigChange: a change that takes the guards or this plugin off is blocked
// The plugin root is the Claude-folder stand-in, laid out as install user lays one out (kit-tools/, kit-hooks/,
// skills/, agents/, kit-install.json), so the kit's tools find each other and the start-up line names real paths.
// Every call first hashes each file guard-manifest.json names; one changed file refuses every call (fail closed). Then:
// a write into the plugin folder is refused; a kit tool from another Claude folder is refused (K206 P3); the hooks a
// role file carries run here by agent_type (Claude Code ignores a plugin agent's own hooks: block); and the kit's
// guard runs from the checked bytes with the plugin root as its Claude folder. The guards catch slips; they are not a
// sandbox: a session past the self-protection could rewrite the manifest too. A cloud session installs the plugin
// fresh from a pinned tag, so a change never outlives the session.
// Exported for the runner and the grant: checkManifest, writesPlugin, roleHooks, liftOwnerHold, preTool, sessionStart,
// prompt, subagentStop, configChange, pluginConfigChange.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const WIN = process.platform === 'win32';
// A child process starts from node's own folder, never the session's, where a planted program could be found first.
const SAFE_CWD = path.dirname(process.execPath);
const SHELLS = ['Bash', 'PowerShell', 'Monitor', 'mcp__terminal__run_in_terminal'];
const FILE_WRITES = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
const posix = (p) => String(p).split(path.sep).join('/');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const fold = (p) => (WIN ? p.toLowerCase() : p);
const deny = (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
// The files a launcher cannot run without: a manifest that leaves one out is not the release's.
const MUST = ['launch.cjs', 'hooks/hooks.json', 'roles.json', 'kit-install.json', 'kit-tools/kit-launch.cjs', 'kit/project/.claude/guard.cjs'];

/**
 * Hash every file the manifest names. Returns { changed: [paths], bytes: Map(path -> Buffer) }; a manifest that is
 * missing, unreadable or leaves out a file the launcher runs is itself a changed file.
 */
function checkManifest(root = ROOT) {
	let files = null;
	try { files = JSON.parse(fs.readFileSync(path.join(root, 'guard-manifest.json'), 'utf8')).files; } catch { /* below */ }
	if (!files || typeof files !== 'object' || MUST.some((f) => typeof files[f] !== 'string')) return { changed: ['guard-manifest.json'], bytes: new Map() };
	const changed = [];
	const bytes = new Map();
	for (const rel of Object.keys(files).sort()) {
		let b = null;
		try { b = fs.readFileSync(path.join(root, ...rel.split('/'))); } catch { /* gone */ }
		if (!b || sha(b) !== files[rel]) changed.push(rel);
		else bytes.set(rel, b);
	}
	// The build 23b sweep: a file added where Claude Code or the launcher loads code or roles from is a change too.
	const loads = (rel) => /\.(cjs|mjs|js|json|sh|ps1)$/.test(rel) || /^agents\/[^/]+\.md$/.test(rel);
	for (const dir of ['agents', 'hooks', 'kit-hooks', 'kit-tools']) {
		let names = [];
		try { names = fs.readdirSync(path.join(root, dir), { recursive: true }).map((n) => `${dir}/${String(n).split(path.sep).join('/')}`); } catch { continue; }
		for (const rel of names) if (loads(rel) && !Object.hasOwn(files, rel)) changed.push(`${rel} (not in the manifest)`);
	}
	return { changed, bytes };
}

const real = (p) => { try { return fs.realpathSync.native(path.resolve(p)); } catch { return path.resolve(p); } };
const within = (p, r) => { const a = fold(posix(p)); const b = fold(posix(r)); return a === b || a.startsWith(b.endsWith('/') ? b : `${b}/`); };

/** Why a call writes into the plugin folder, or ''. A kit tool run from the plugin (node <root>/skills/..., kit-tools/...) is no write. */
function writesPlugin(input, root = ROOT) {
	const roots = [...new Set([root, process.env.CLAUDE_PLUGIN_DATA].filter(Boolean).flatMap((r) => [path.resolve(r), real(r)]))];
	const tool = String(input.tool_name || '');
	const ti = input.tool_input || {};
	const cwd = path.resolve(String(input.cwd || process.cwd()));
	const target = ti.file_path || ti.notebook_path || ti.path;
	if (FILE_WRITES.includes(tool) && typeof target === 'string' && roots.some((r) => within(path.resolve(cwd, target), r) || within(real(path.resolve(cwd, target)), r))) {
		return 'Kit plugin: the plugin folder holds the guards; it is never edited in a session.';
	}
	if (!SHELLS.includes(tool)) return '';
	const command = posix(String(ti.command ?? '')).replace(/\\/g, '/');
	const spelled = roots.map((r) => fold(posix(r)));
	// Each kit tool run from the plugin is taken out first; any other mention of the folder is a reach into it.
	const RUN = /(?:^|[\s;&|(])["']?(?:[^\s"';&|]*\/)?node(?:\.exe)?["']?\s+["']?([^\s"';&|]+?)\/(skills\/[\w.-]+\/[\w.-]+\.[cm]js|kit-tools\/[\w.-]+\.[cm]js)["']?(?=\s|$|[;&|)])/gi;
	const rest = command.replace(RUN, (m, dir) => (spelled.includes(fold(posix(path.resolve(cwd, dir)))) ? ' ' : m));
	if (spelled.some((r) => fold(rest).includes(r)) || /CLAUDE_PLUGIN_(ROOT|DATA)/.test(rest) || roots.some((r) => within(cwd, r)) || reachesBy(rest, cwd, roots)) {
		return 'Kit plugin: a command that reaches the plugin folder is refused; the plugin folder holds the guards. Run a kit tool from it as node <plugin root>/skills/... or kit-tools/..., with nothing else naming the folder.';
	}
	return '';
}

// The build 23b sweep: the folder found only by its exact spelling let ./, a doubled slash, .. or a wildcard from the
// parent through. Each path word is resolved (from a cd's folder after one), and a wildcard whose fixed part sits on
// the way to the plugin and whose next part could name it reaches it.
// The commit security review: the home folder and the Claude folder as the shell spells them (~, $HOME, %USERPROFILE%,
// $CLAUDE_CONFIG_DIR) are read as those folders, and a part the shell still expands (another variable, a substitution,
// a brace list) is read as a wildcard that may name anything.
const GLOB = /[*?[{$%`]/;
const globPart = (g) => {
	// A brace sequence ({a..z}) or nested braces are read as matching anything, as a variable is.
	if (/[$%`]/.test(g) || /\{[^{}]*\.\.[^{}]*\}|\{[^{}]*\{/.test(g)) return /^/;
	const alts = /\{([^{}]*,[^{}]*)\}/.exec(g);
	if (alts) return { test: (s) => alts[1].split(',').some((a) => globPart(g.replace(alts[0], a)).test(s)) };
	return new RegExp(`^${g.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, WIN ? 'i' : '');
};
const HOME_DIR = require('os').homedir();
const expandHome = (w) => w.replace(/^~(?=\/|\\|$)/, HOME_DIR)
	.replace(/^(\$\{?HOME\}?|\$\{?USERPROFILE\}?|\$env:(HOME|USERPROFILE)|%USERPROFILE%|%HOME%)(?=\/|\\|$)/i, HOME_DIR)
	.replace(/^(\$\{?CLAUDE_CONFIG_DIR\}?|\$env:CLAUDE_CONFIG_DIR|%CLAUDE_CONFIG_DIR%)(?=\/|\\|$)/i, process.env.CLAUDE_CONFIG_DIR || path.join(HOME_DIR, '.claude'));
function reachesBy(command, cwd, roots) {
	let base = cwd;
	const words = command.split(/[\s"';&|<>()]+/).filter(Boolean).map(expandHome);
	for (let i = 0; i < words.length; i++) {
		const w = words[i];
		if (/^(cd|pushd|set-location|sl)$/i.test(w) && words[i + 1]) { base = path.resolve(base, words[++i]); if (roots.some((r) => within(base, r))) return true; continue; }
		if (!/[/\\]/.test(w) && !/^\.\.?$/.test(w)) continue;
		const parts = w.replace(/\\/g, '/').split('/');
		const cut = parts.findIndex((x) => GLOB.test(x));
		// A word that opens with an expansion may stand for any folder: it reaches the plugin when the rest of it names
		// the plugin folder's own name (the commit security review: $X/kit-plugin/launch.cjs).
		if (cut === 0 && /[$%`]/.test(parts[0]) && roots.some((r) => parts.slice(1).some((x) => fold(x) === fold(path.basename(r))))) return true;
		if (cut < 0) { if (roots.some((r) => within(path.resolve(base, parts.join('/')), r))) return true; continue; }
		const fixed = path.resolve(base, parts.slice(0, cut).join('/') || '.');
		if (roots.some((r) => { const rel = posix(path.relative(fixed, r)); return within(r, fixed) && (rel === '' || globPart(parts[cut]).test(rel.split('/')[0])); })) return true;
	}
	return false;
}

let rolesRead = null;
function readRoles(root) {
	if (rolesRead && rolesRead.root === root) return rolesRead.roles;
	let roles = {};
	try { roles = JSON.parse(fs.readFileSync(path.join(root, 'roles.json'), 'utf8')); } catch { /* none */ }
	rolesRead = { root, roles };
	return roles;
}
// A plugin agent's type carries the plugin's name; a role of the same name from elsewhere runs its own hooks.
const roleOf = (input) => { const m = /^kit:([\w-]+)$/.exec(String(input.agent_type || '')); return m ? m[1] : null; };

/**
 * Run the hooks roles.json gives the call's role for this event, each as its own process, as Claude Code would run
 * them from the role file. Returns a PreToolUse deny, { stop: reason } for a held stop, or null.
 */
function roleHooks(input, event, root = ROOT) {
	const role = roleOf(input);
	const own = role ? readRoles(root)[role] : null;
	if (!own) return null;
	const tool = String(input.tool_name || '');
	const list = event === 'PreToolUse' ? (own.PreToolUse || []).filter(([m]) => { try { return new RegExp(`^(?:${m})$`).test(tool); } catch { return false; } }).map(([, f]) => f) : own.Stop || [];
	for (const file of list) {
		if (!/^[\w.-]+\.cjs$/.test(file)) continue;
		const r = spawnSync(process.execPath, [path.join(root, 'kit-hooks', file)], { input: JSON.stringify(input), cwd: SAFE_CWD, encoding: 'utf8', timeout: 5000, env: childEnv(root) });
		const why = String(r.stderr || '').trim() || `${file} held this.`;
		if (event === 'PreToolUse') {
			if (r.status === 2) return deny(why);
			let o = null;
			try { o = r.stdout && r.stdout.trim() ? JSON.parse(r.stdout) : null; } catch { /* not an answer */ }
			if (o && o.hookSpecificOutput && o.hookSpecificOutput.permissionDecision === 'deny') return o;
		} else if (r.status === 2) return { stop: why };
	}
	return null;
}

/**
 * K176's hook point: a card grant may lift an "Owner's yes needed" hold for the main session's own call, never a
 * subagent's. Only when kit-tools/owner-grant.cjs is in the plugin (built in, and in the manifest); a grant that throws
 * leaves the hold as it was. lift(answer, input, home) returns the answer to give, home being the plugin root.
 */
function liftOwnerHold(answer, input, root = ROOT) {
	const h = answer && answer.hookSpecificOutput;
	if (!h || !['deny', 'ask'].includes(h.permissionDecision) || !/Owner's yes needed/.test(String(h.permissionDecisionReason || ''))) return answer;
	if (!input || input.agent_id) return answer;
	const grant = path.join(root, 'kit-tools', 'owner-grant.cjs');
	if (!fs.existsSync(grant)) return answer;
	try {
		const out = require(grant).lift(answer, input, root);
		return out === undefined ? answer : out;
	} catch { return answer; }
}

const childEnv = (root) => {
	const env = { ...process.env, KIT_CLAUDE_HOME: root, CLAUDE_PLUGIN_ROOT: root };
	delete env.NODE_OPTIONS;
	return env;
};
const projectOf = (input) => {
	const dir = process.env.CLAUDE_PROJECT_DIR || (input && input.cwd) || '';
	return dir && fs.existsSync(String(dir)) ? path.resolve(String(dir)) : SAFE_CWD;
};
const heldText = (changed) => `the kit plugin's guard files differ from its release (${changed.slice(0, 5).join(', ')}${changed.length > 5 ? ', ...' : ''}), so every call is refused. Reinstall the plugin from its tag.`;

/** PreToolUse: the strictest answer of the checks above, then the kit's guard from the checked bytes. */
function preTool(input, root = ROOT) {
	if (!input || typeof input !== 'object') return deny('Held: the kit plugin launcher could not read this call.');
	const m = checkManifest(root);
	if (m.changed.length) return deny(`Held: ${heldText(m.changed)}`);
	const w = writesPlugin(input, root);
	if (w) return deny(w);
	// K206 P3, the PC launcher's own check, with the plugin root as this session's Claude folder.
	const launch = require(path.join(root, 'kit-tools', 'kit-launch.cjs'));
	const other = launch.otherHomeTool(input, root);
	if (other) return other;
	const role = roleHooks(input, 'PreToolUse', root);
	if (role) return role;
	// The guard and every file it loads come from the bytes just hashed (the PC launcher's runGuard), so a file swapped
	// after the check is never the one that runs. Its user-layer hooks are read against the plugin's kit-install.json.
	process.env.KIT_CLAUDE_HOME = root;
	const files = new Map();
	for (const [rel, b] of m.bytes) if (/\.c?js$/.test(rel)) files.set(fold(path.resolve(root, rel)), b.toString('utf8'));
	const answer = launch.runGuard(path.join(root, 'kit', 'project'), files, input, 'Reinstall the kit plugin from its tag');
	// The build 23b sweep: the PC launcher's hold on a session running the grant tool, here too. Loaded after runGuard,
	// so it comes from the checked bytes like the guard.
	try { const held = require(path.join(root, 'kit-tools', 'owner-grant.cjs')).runsGrantTool(input); if (held) return held; } catch { return deny('Held: the kit plugin\'s grant check could not load. Reinstall the kit plugin from its tag.'); }
	return liftOwnerHold(answer, input, root);
}

/** SessionStart: the kit's start-up report from the plugin's kit copy (K175 finds it at the plugin root). */
function sessionStart(input, raw, root = ROOT) {
	const m = checkManifest(root);
	if (m.changed.length) {
		const text = `Kit plugin: ${heldText(m.changed)}`;
		return JSON.stringify({ systemMessage: text, hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } });
	}
	const r = spawnSync(process.execPath, [path.join(root, 'kit', 'project', '.claude', 'kit-hook.cjs'), 'session-start'], { input: raw, cwd: projectOf(input), encoding: 'utf8', timeout: 25000, env: { ...childEnv(root), CLAUDE_PROJECT_DIR: projectOf(input) } });
	return r.stdout || '';
}

/** UserPromptSubmit: the kit gate (a folder with no kit is a full stop), then the kit's per-message check. */
function prompt(input, raw, root = ROOT) {
	const m = checkManifest(root);
	if (m.changed.length) return JSON.stringify({ systemMessage: `Kit plugin: ${heldText(m.changed)}` });
	for (const [file, args] of [[path.join(root, 'kit-hooks', 'kit-gate.cjs'), []], [path.join(root, 'kit', 'project', '.claude', 'kit-hook.cjs'), ['prompt']]]) {
		const r = spawnSync(process.execPath, [file, ...args], { input: raw, cwd: projectOf(input), encoding: 'utf8', timeout: 4000, env: { ...childEnv(root), CLAUDE_PROJECT_DIR: projectOf(input) } });
		if (r.stdout && r.stdout.trim()) return r.stdout;
	}
	return '';
}

/** SubagentStop: the role's Stop hooks. Returns { code, stderr }. */
function subagentStop(input, root = ROOT) {
	const m = checkManifest(root);
	if (m.changed.length) return input && input.stop_hook_active ? { code: 0 } : { code: 2, stderr: `Kit plugin: ${heldText(m.changed)}` };
	const r = roleHooks(input || {}, 'Stop', root);
	return r && r.stop ? { code: 2, stderr: r.stop } : { code: 0 };
}

/** Why a settings change would take the guards or this plugin off, as a block, or null. */
function pluginConfigChange(input, root = ROOT) {
	const m = checkManifest(root);
	if (m.changed.length) {
		const msg = `Kit: the settings change was not applied: ${heldText(m.changed)}`;
		return { decision: 'block', reason: msg, systemMessage: msg };
	}
	const source = String(input.source || '');
	if (!['project_settings', 'local_settings', 'user_settings'].includes(source) || !input.file_path) return null;
	let text = null;
	try { text = fs.readFileSync(String(input.file_path), 'utf8'); } catch { return null; }
	let s = null;
	try { s = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { /* settingsProblem reads the text */ }
	const off = s && s.enabledPlugins && typeof s.enabledPlugins === 'object' && Object.entries(s.enabledPlugins).some(([k, v]) => /^kit@/.test(k) && v === false);
	const launch = require(path.join(root, 'kit-tools', 'kit-launch.cjs'));
	const why = launch.settingsProblem(text) || (off ? 'it turns the kit plugin off' : '');
	if (!why) return null;
	const msg = `Kit: the change to ${posix(input.file_path)} was not applied: ${why}. The owner edits that file by hand, then starts a new session.`;
	return { decision: 'block', reason: msg, systemMessage: msg };
}

/** ConfigChange: K216's answer, where a check that throws is a named block, never silence. */
function configChange(input, root = ROOT) {
	try {
		return require(path.join(root, 'kit-tools', 'kit-launch.cjs')).configChangeAnswer(input, (i) => pluginConfigChange(i, root));
	} catch (e) {
		const msg = `Kit: the settings change was not applied: the kit plugin could not check it (${String(e && e.message).slice(0, 160)}).`;
		return { decision: 'block', reason: msg, systemMessage: msg };
	}
}

if (require.main === module) {
	const mode = process.argv[2] || 'pre-tool';
	let raw = '';
	try { raw = fs.readFileSync(0, 'utf8'); } catch { /* none */ }
	let input = null;
	try { input = JSON.parse(raw || '{}'); } catch { /* below */ }
	if (mode === 'subagent-stop') {
		let r = { code: 0 };
		try { r = subagentStop(input); } catch { /* a stop hook that errors never traps an agent */ }
		if (r.stderr) process.stderr.write(`${r.stderr}\n`);
		process.exit(r.code);
	}
	let out = '';
	try {
		if (mode === 'pre-tool') { const o = preTool(input); out = o ? JSON.stringify(o) : ''; }
		else if (mode === 'config-change') { const o = configChange(input); out = o ? JSON.stringify(o) : ''; }
		else if (mode === 'session-start') out = sessionStart(input, raw);
		else if (mode === 'prompt') out = prompt(input, raw);
	} catch (e) {
		// A broken launcher never lets a call or a settings change through; the start-up and prompt hooks say nothing.
		if (mode === 'pre-tool') out = JSON.stringify(deny(`Held: the kit plugin launcher could not run (${String(e && e.message).slice(0, 160)}).`));
		if (mode === 'config-change') out = JSON.stringify({ decision: 'block', reason: 'Kit: the settings change was not applied: the kit plugin launcher could not run.' });
	}
	if (out) process.stdout.write(out);
}

module.exports = { checkManifest, writesPlugin, roleHooks, liftOwnerHold, preTool, sessionStart, prompt, subagentStop, configChange, pluginConfigChange };
