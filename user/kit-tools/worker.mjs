#!/usr/bin/env node
// K177 (build 23b): the cloud worker runner. It starts one worker: a `claude -p` in its own git worktree, from a
// scrubbed env that always carries the cloud marker, with the pinned kit plugin, and stops it when the start check
// fails. Found in the cloud plugin proof and the 2026-11-21 narrowing test: a scrubbed env dropped CLAUDE_CODE_REMOTE,
// so every kit cloud refusal skipped; a worker whose kit did not load ran with no guards; a user-layer defaultMode
// could start a worker outside the default mode; a planted .mcp.json started its server.
//
// Usage (cloud only):
//   node worker.mjs run --plugin <dir> --branch <type/name> --brief <file> --job <kind> [--model <id>] [--repo <dir>]
//                       [--from <ref>] [--workdir <dir>] [--timeout-min <n>] [--budget-usd <n>]
// Prints "ran: ..." (exit code of the worker, once it answered and its result is a success) or "stopped: <why>" (exit 1); a refusal before the start exits 2.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const SELF = fileURLToPath(import.meta.url);
// The start-up text the kit's SessionStart hook always gives (scripts/kit.mjs kitToolsLine).
export const KIT_LINE = 'Kit tools this session:';
// T12: the fixed cloud jobs (rule:where-work-runs). Sweeps, installs and release verify run without the owner's
// user-level guards in a cloud worker, so the runner starts nothing else.
export const JOBS = ['tests', 'builds', 'gate checks', 'research', 'read-only review'];
// Every child starts in node's own folder unless it is given the folder it works in.
const SAFE_CWD = path.dirname(process.execPath);
// git on the project repo runs no hook or program the repo's config could name, and fetches nothing.
const NO_PROGRAMS = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'protocol.allow=never',
	...['ext', 'file', 'ssh', 'git', 'http', 'https'].flatMap((p) => ['-c', `protocol.${p}.allow=never`])];
// What a worker keeps of the caller's env: the shell basics and what the cloud login and its proxy need. Nothing
// else: a token or NODE_OPTIONS in the lead's env is not the worker's.
const KEEP = ['PATH', 'HOME', 'LANG', 'TERM', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_SESSION_INGRESS_TOKEN_FILE',
	'HTTPS_PROXY', 'https_proxy', 'NO_PROXY', 'no_proxy', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE'];

const realRun = (cmd, args, opts = {}) => {
	const r = spawnSync(cmd, args, { encoding: 'utf8', cwd: SAFE_CWD, timeout: 30000, windowsHide: true, ...opts });
	return { status: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
};
// POSIX: the worker leads its own process group, so a stop reaches every program it started (the build 23b sweep).
const realStart = (cmd, args, opts) => spawn(cmd, args, { ...opts, stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true, detached: process.platform !== 'win32' });
// The claude on the path, found from node's own folder (which, or where on Windows), never the worktree's.
// The install record of the kit this runner came from (the Claude folder above kit-tools), or null outside one.
const realOwnKit = () => { try { return JSON.parse(fs.readFileSync(path.join(path.dirname(SELF), '..', 'kit-install.json'), 'utf8')); } catch { return null; } };
const realWhich = () => realRun(process.platform === 'win32' ? 'where' : 'which', ['claude']);

/** Stop the worker and every program it started: its process group, or taskkill /T on Windows. */
function stopTree(child) {
	try {
		if (child.pid && process.platform === 'win32') spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { cwd: SAFE_CWD, windowsHide: true, timeout: 10000 });
		else if (child.pid) process.kill(-child.pid, 'SIGKILL');
	} catch { /* gone, or no group: the kill below */ }
	try { child.kill('SIGKILL'); } catch { /* already gone */ }
}

// Settings a branch may not carry into a worker: they would undo what the runner pins (the cloud marker, the Claude
// folder, the mode) or turn the kit's hooks off (the build 23b sweep: a committed env block cleared the marker).
const PINNED_ENV = /^(CLAUDE_CODE_REMOTE|CLAUDE_CONFIG_DIR|CLAUDE_PLUGIN_ROOT|CLAUDE_PLUGIN_DATA|NODE_OPTIONS|KIT_\w+)$/i;
function settingsFaults(text, file) {
	let j;
	try { j = JSON.parse(text); } catch { return [`${file} is not JSON, so the runner cannot check what it sets`]; }
	const out = [];
	if (j && j.env && typeof j.env === 'object') for (const k of Object.keys(j.env)) if (PINNED_ENV.test(k)) out.push(`${file} sets ${k}, which the runner pins`);
	if (j && j.disableAllHooks) out.push(`${file} turns hooks off`);
	const mode = j && ((j.permissions && j.permissions.defaultMode) || j.defaultMode);
	if (mode && mode !== 'default') out.push(`${file} starts in ${mode}, not default`);
	return out;
}

/** The worker's env: only the allow-listed variables, its own config folder, and CLAUDE_CODE_REMOTE=true always. */
export function workerEnv(env, configDir) {
	const out = Object.fromEntries(KEEP.filter((k) => env[k] != null && env[k] !== '').map((k) => [k, env[k]]));
	out.CLAUDE_CONFIG_DIR = configDir;
	out.CLAUDE_CODE_REMOTE = 'true';
	return out;
}

/** The fixed flags every worker starts with; the brief goes in on stdin. */
export function workerArgs({ plugin, model, budget }) {
	return ['-p', '--plugin-dir', plugin, '--setting-sources', 'user,project', '--strict-mcp-config', '--permission-mode', 'default',
		'--output-format', 'stream-json', '--verbose', '--include-hook-events', ...(model ? ['--model', model] : []),
		...(budget ? ['--max-budget-usd', String(budget)] : [])];
}

const git = (run, repo, ...a) => run('git', ['-C', repo, ...NO_PROGRAMS, ...a]);

/**
 * Why a branch is not one a worker may run on: the owner's own feature branch only. Never main, master or the repo's
 * default branch, never a tag, and the kit's branch name pattern (name-check.mjs branch, the copy beside this file).
 *
 * Returns:
 *     the reasons, empty when the branch is fine
 */
export function branchFaults({ repo, branch, run = realRun }) {
	const b = String(branch || '');
	if (!b) return ['no branch named'];
	if (['main', 'master'].includes(b)) return [`"${b}" is a main branch: a worker runs only on the owner's feature branches`];
	const head = git(run, repo, 'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD');
	const def = head.status === 0 ? head.stdout.trim().replace(/^origin\//, '') : '';
	if (def && def === b) return [`"${b}" is the repo's default branch: a worker runs only on the owner's feature branches`];
	if (git(run, repo, 'show-ref', '--verify', '--quiet', `refs/tags/${b}`).status === 0) return [`"${b}" is a tag, not a branch`];
	const check = run(process.execPath, [path.join(path.dirname(SELF), 'audits', 'name-check.mjs'), 'branch', b]);
	if (check.status !== 0) return [check.stderr.trim().replace(/^name-check: /gm, '') || `"${b}" fails the branch name check`];
	if (git(run, repo, 'check-ref-format', '--branch', b).status !== 0) return [`"${b}" is not a valid branch name`];
	return [];
}

// The text a hook gave: its stdout, and the start-up text inside the kit hook's JSON answer.
function hookText(e) {
	const raw = [e.output, e.stdout].filter((s) => typeof s === 'string').join('\n');
	const parts = [raw];
	for (const s of [e.output, e.stdout]) {
		try {
			const j = JSON.parse(s);
			const ctx = j && j.hookSpecificOutput && j.hookSpecificOutput.additionalContext;
			if (typeof ctx === 'string') parts.push(ctx);
			if (j && typeof j.systemMessage === 'string') parts.push(j.systemMessage);
		} catch { /* plain text */ }
	}
	return parts.join('\n');
}

/**
 * The start check, fed the stream one event at a time. It fails closed: the init event must say the default mode and
 * list the pinned kit plugin, and the kit start-up line must come from a hook before the first tool call (or before
 * the end, if the worker never calls a tool). The mode is read from init: on CLI 2.1.330 the SessionStart payload has
 * no permission_mode.
 *
 * Returns:
 *     { feed(event) -> null or why to stop, end() -> null or why the start never checked out }
 */
export function startCheck({ plugin }) {
	const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
	const want = real(plugin);
	let sawInit = false;
	let sawLine = false;
	let checked = false;
	const lineIn = (t) => t.split(/\r?\n/).some((l) => l.startsWith(KIT_LINE));
	const before = () => {
		if (!sawInit) return 'a tool call came before the init event, so the start check never ran';
		if (!sawLine) return `the kit start-up line ("${KIT_LINE}") never appeared before the first tool call: the kit did not load, so its guards are missing`;
		return null;
	};
	return {
		feed(e) {
			if (!e || typeof e !== 'object' || checked) return null;
			// Only a start hook's answer counts (the build 23b sweep: a prompt hook could print the line).
			if (e.type === 'system' && e.subtype === 'hook_response' && /^SessionStart\b/.test(String(e.hook_event || e.hook_name || '')) && lineIn(hookText(e))) sawLine = true;
			if (e.type === 'system' && e.subtype === 'init' && !sawInit) {
				sawInit = true;
				if (e.permissionMode !== 'default') return `the permission mode is ${e.permissionMode ?? 'not named'}, not default`;
				const plugins = Array.isArray(e.plugins) ? e.plugins.filter(Boolean) : [];
				const kit = plugins.filter((p) => p.name === 'kit');
				if (!kit.length) return 'the plugin "kit" is not in the init event\'s plugins list';
				if (!kit.every((p) => typeof p.path === 'string' && real(p.path) === want)) return `the "kit" plugin loaded is not the pinned one (${kit.map((p) => p.path).join(', ')})`;
				// The build 23b sweep: nothing loads beside the kit but Claude Code's own built-in plugins, and no MCP server.
				const others = plugins.filter((p) => p.name !== 'kit' && p.path !== 'builtin');
				if (others.length) return `another plugin loaded beside the kit (${others.map((p) => p.name).join(', ')})`;
				if (Array.isArray(e.mcp_servers) && e.mcp_servers.length) return `an MCP server started (${e.mcp_servers.map((m) => m && m.name).join(', ')}), though the worker allows none`;
			}
			const tool = e.type === 'assistant' && Array.isArray(e.message?.content) && e.message.content.some((c) => c && c.type === 'tool_use');
			if (tool) { checked = true; return before(); }
			return null;
		},
		end() {
			if (checked) return null;
			if (!sawInit) return 'the stream ended with no init event, so the start check never ran';
			return before();
		},
	};
}

function parseArgs(argv) {
	const [cmd, ...rest] = argv;
	const o = { cmd };
	const names = { '--plugin': 'plugin', '--branch': 'branch', '--brief': 'brief', '--model': 'model', '--repo': 'repo', '--from': 'from',
		'--workdir': 'workdir', '--timeout-min': 'timeoutMin', '--budget-usd': 'budget', '--job': 'job' };
	for (let i = 0; i < rest.length; i += 2) {
		const k = names[rest[i]];
		// A value that starts with a dash would reach git as an option (the build 23b sweep: --from -f).
		if (!k || rest[i + 1] === undefined || rest[i + 1].startsWith('-')) return { error: `unknown or empty option ${rest[i]}, or a value that starts with a dash` };
		o[k] = rest[i + 1];
	}
	return o;
}

const USAGE = 'Usage: node worker.mjs run --plugin <dir> --branch <type/name> --brief <file> --job <kind> [--model <id>] [--repo <dir>] [--from <ref>] [--workdir <dir>] [--timeout-min <n>] [--budget-usd <n>]';

/**
 * Start one worker and wait for it.
 *
 * Args:
 *     argv: the command line after the script
 *     deps: { env, run (sync git and node), start (spawn of claude), print }
 *
 * Returns:
 *     a promise of the exit code: the worker's own when it ran, 1 when stopped, 2 when refused before the start
 */
export async function main(argv, { env = process.env, run = realRun, start = realStart, which = realWhich, ownKit = realOwnKit, print = console.log } = {}) {
	const o = parseArgs(argv);
	if (o.error || o.cmd !== 'run' || !o.plugin || !o.branch || !o.brief) { print(o.error ? `${o.error}\n${USAGE}` : USAGE); return 2; }
	const refuse = (why) => { print(`refused: ${why}`); return 2; };
	if (!JOBS.includes(o.job)) return refuse(`job "${o.job || ''}" is not a cloud worker job; the jobs are: ${JOBS.join(', ')} (rule:where-work-runs). Anything else stays on the owner's PC`);
	// The cloud lane only: on the PC the owner's own session does the work, and the kit's cloud refusals key on the marker.
	if (env.CLAUDE_CODE_REMOTE !== 'true') return refuse('the worker runner is for the cloud lane (CLAUDE_CODE_REMOTE=true); on the PC, work in the session itself');
	const repo = path.resolve(o.repo || process.cwd());
	const plugin = path.resolve(o.plugin);
	let manifest = null;
	try { manifest = JSON.parse(fs.readFileSync(path.join(plugin, '.claude-plugin', 'plugin.json'), 'utf8')); } catch { /* named below */ }
	if (!manifest || manifest.name !== 'kit') return refuse(`${plugin} is not the kit plugin (no .claude-plugin/plugin.json named "kit")`);
	// The build 23b sweep: a folder named kit was enough. The plugin's files must match its guard manifest, as its own
	// launcher checks on every call, and it sits outside the repo the worker works in.
	let checked = null;
	try { checked = createRequire(import.meta.url)('./plugin-launch.cjs').checkManifest(plugin); } catch { /* below */ }
	if (!checked || checked.changed.length) return refuse(`${plugin} does not match its guard manifest (${checked ? checked.changed.slice(0, 3).join(', ') : 'no manifest check'}): build the plugin from a release with kit.mjs build plugin`);
	// The commit security review: the manifest vouches only for itself, so the build it records must be the release this
	// runner was installed from (outside an install, as in its tests, there is no record to hold it to).
	const own = ownKit();
	let built = null;
	try { built = JSON.parse(fs.readFileSync(path.join(plugin, 'kit-build.json'), 'utf8')); } catch { /* below */ }
	if (own && own.version && (!built || built.version !== own.version || (own.commit && built.commit && built.commit !== own.commit))) return refuse(`the plugin is kit ${built ? built.version : 'with no build record'}, the runner's own kit is ${own.version}: build the plugin from the release the runner came from`);
	let brief;
	try { brief = fs.readFileSync(path.resolve(o.brief), 'utf8'); } catch { return refuse(`the brief ${o.brief} cannot be read`); }
	if (!brief.trim()) return refuse('the brief is empty');
	const timeoutMin = o.timeoutMin === undefined ? 120 : Number(o.timeoutMin);
	if (!(timeoutMin > 0 && timeoutMin <= 24 * 60)) return refuse('--timeout-min is a number of minutes, above 0 and at most a day');
	if (git(run, repo, 'rev-parse', '--git-dir').status !== 0) return refuse(`${repo} is not a git repo`);
	const faults = branchFaults({ repo, branch: o.branch, run });
	if (faults.length) return refuse(faults.join('; '));
	const topDir = git(run, repo, 'rev-parse', '--show-toplevel').stdout.trim() || repo;
	const inTree = (p, d) => { const r = path.relative(path.resolve(d), path.resolve(p)); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
	if (inTree(plugin, topDir)) return refuse(`the plugin ${plugin} is inside the repo the worker works in`);
	// The claude the worker runs, by its full path, found before any folder is the worker's (Windows looks in the
	// current folder first).
	const found = which();
	const claude = found && found.status === 0 ? String(found.stdout).split(/\r?\n/).map((l) => l.trim()).find(Boolean) : '';
	if (!claude || !path.isAbsolute(claude)) return refuse('claude is not on the path, so the runner has no CLI to start');
	if (inTree(claude, path.dirname(topDir))) return refuse(`the claude on the path (${claude}) sits beside the repo, not where the CLI is installed`);

	// One folder per worker, beside the repo: the worktree, its own throwaway config, and the stream it wrote.
	const top = git(run, repo, 'rev-parse', '--show-toplevel').stdout.trim() || repo;
	const workdir = path.resolve(o.workdir || `${top}-workers`);
	const slug = o.branch.replace(/\//g, '-');
	const tree = path.join(workdir, slug);
	const config = path.join(workdir, `${slug}.config`);
	const log = path.join(workdir, `${slug}.jsonl`);
	if (fs.existsSync(tree) || fs.existsSync(config)) return refuse(`${fs.existsSync(tree) ? tree : config} already exists: one worker per branch, at a time`);
	fs.mkdirSync(workdir, { recursive: true });
	const local = git(run, repo, 'show-ref', '--verify', '--quiet', `refs/heads/${o.branch}`).status === 0;
	const remote = !local && git(run, repo, 'show-ref', '--verify', '--quiet', `refs/remotes/origin/${o.branch}`).status === 0;
	const ref = local ? o.branch : remote ? `origin/${o.branch}` : o.from || 'HEAD';
	// The settings the worker will load from the branch, read before it is checked out.
	const bad = [];
	for (const f of ['.claude/settings.json', '.claude/settings.local.json']) {
		const shown = git(run, repo, 'show', `${ref}:${f}`);
		if (shown.status === 0) bad.push(...settingsFaults(shown.stdout, f));
	}
	if (bad.length) return refuse(`the branch's settings would change the worker: ${bad.join('; ')}`);
	const add = local ? ['worktree', 'add', tree, o.branch]
		: remote ? ['worktree', 'add', '--track', '-b', o.branch, '--', tree, `origin/${o.branch}`]
			: ['worktree', 'add', '-b', o.branch, '--', tree, o.from || 'HEAD'];
	const made = git(run, repo, ...add);
	if (made.status !== 0) return refuse(`git worktree add failed: ${made.stderr.trim().split('\n')[0]}`);
	fs.mkdirSync(config, { recursive: true });
	fs.writeFileSync(path.join(config, '.claude.json'), `${JSON.stringify({ projects: { [tree]: { hasTrustDialogAccepted: true } } })}\n`);

	const timeout = Math.round(timeoutMin * 60000);
	const child = start(claude, workerArgs({ plugin, model: o.model, budget: o.budget }), { cwd: tree, env: workerEnv(env, config), timeout });
	const out = fs.createWriteStream(log);
	const check = startCheck({ plugin });
	let stopWhy = null;
	// The cloud sweep bench: a worker the prompt gate blocked did nothing and still exited 0. A run counts only when the
	// worker answered and its result event says it succeeded.
	let answered = false;
	let outcome = null;
	const stop = (why) => { if (stopWhy) return; stopWhy = why; stopTree(child); };
	const timer = setTimeout(() => stop(`timed out after ${timeoutMin} min`), timeout);
	let buf = '';
	child.stdout.on('data', (d) => {
		out.write(d);
		if (stopWhy) return;
		buf += d;
		let i;
		while (!stopWhy && (i = buf.indexOf('\n')) >= 0) {
			const line = buf.slice(0, i);
			buf = buf.slice(i + 1);
			let e;
			try { e = JSON.parse(line); } catch { continue; }
			if (e && e.type === 'assistant') answered = true;
			if (e && e.type === 'result') outcome = e;
			const why = check.feed(e);
			if (why) stop(why);
		}
	});
	child.stdin.on('error', () => { /* a worker stopped before it read the brief */ });
	child.stdin.end(brief);
	const [code, signal] = await new Promise((resolve) => {
		child.on('error', (err) => { stop(`claude could not start: ${err.message}`); resolve([null, null]); });
		child.on('close', (c, s) => resolve([c, s]));
	});
	clearTimeout(timer);
	await new Promise((resolve) => out.end(resolve));
	if (!stopWhy) { const why = check.end(); if (why) stopWhy = why; }
	if (!stopWhy && !outcome) stopWhy = `the worker sent no result event (exit ${code ?? signal}), so it may not have finished`;
	if (!stopWhy && (outcome.is_error !== false || outcome.subtype !== 'success')) stopWhy = `the worker ended in an error (${outcome.subtype || 'no subtype'})`;
	if (!stopWhy && !answered) stopWhy = 'the worker did no work: it never answered (a hook may have blocked its brief)';
	if (stopWhy) { print(`stopped: ${stopWhy} (worktree ${tree}, log ${log})`); return 1; }
	print(`ran: exit ${code ?? signal}, worktree ${tree}, log ${log}`);
	return typeof code === 'number' ? code : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) main(process.argv.slice(2)).then((c) => { process.exitCode = c; });
