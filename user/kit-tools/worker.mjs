#!/usr/bin/env node
// K177 (build 23b): the cloud worker runner. It starts one worker: a `claude -p` in its own git worktree, from a
// scrubbed env that always carries the cloud marker, with the pinned kit plugin, and stops it when the start check
// fails. Found in the cloud plugin proof and the 2026-11-21 narrowing test: a scrubbed env dropped CLAUDE_CODE_REMOTE,
// so every kit cloud refusal skipped; a worker whose kit did not load ran with no guards; a user-layer defaultMode
// could start a worker outside the default mode; a planted .mcp.json started its server.
//
// Usage (cloud only):
//   node worker.mjs run --plugin <dir> --branch <type/name> --brief <file> [--model <id>] [--repo <dir>]
//                       [--from <ref>] [--workdir <dir>] [--timeout-min <n>] [--budget-usd <n>]
// Prints "ran: ..." (exit code of the worker) or "stopped: <why>" (exit 1); a refusal before the start exits 2.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
// The start-up text the kit's SessionStart hook always gives (scripts/kit.mjs kitToolsLine).
export const KIT_LINE = 'Kit tools this session:';
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
const realStart = (cmd, args, opts) => spawn(cmd, args, { ...opts, stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });

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
			if (e.type === 'system' && e.subtype === 'hook_response' && lineIn(hookText(e))) sawLine = true;
			if (e.type === 'system' && e.subtype === 'init' && !sawInit) {
				sawInit = true;
				if (e.permissionMode !== 'default') return `the permission mode is ${e.permissionMode ?? 'not named'}, not default`;
				const kit = (Array.isArray(e.plugins) ? e.plugins : []).filter((p) => p && p.name === 'kit');
				if (!kit.length) return 'the plugin "kit" is not in the init event\'s plugins list';
				if (!kit.some((p) => typeof p.path === 'string' && real(p.path) === want)) return `the "kit" plugin loaded is not the pinned one (${kit.map((p) => p.path).join(', ')})`;
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
		'--workdir': 'workdir', '--timeout-min': 'timeoutMin', '--budget-usd': 'budget' };
	for (let i = 0; i < rest.length; i += 2) {
		const k = names[rest[i]];
		if (!k || rest[i + 1] === undefined || rest[i + 1].startsWith('--')) return { error: `unknown or empty option ${rest[i]}` };
		o[k] = rest[i + 1];
	}
	return o;
}

const USAGE = 'Usage: node worker.mjs run --plugin <dir> --branch <type/name> --brief <file> [--model <id>] [--repo <dir>] [--from <ref>] [--workdir <dir>] [--timeout-min <n>] [--budget-usd <n>]';

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
export async function main(argv, { env = process.env, run = realRun, start = realStart, print = console.log } = {}) {
	const o = parseArgs(argv);
	if (o.error || o.cmd !== 'run' || !o.plugin || !o.branch || !o.brief) { print(o.error ? `${o.error}\n${USAGE}` : USAGE); return 2; }
	const refuse = (why) => { print(`refused: ${why}`); return 2; };
	// The cloud lane only: on the PC the owner's own session does the work, and the kit's cloud refusals key on the marker.
	if (env.CLAUDE_CODE_REMOTE !== 'true') return refuse('the worker runner is for the cloud lane (CLAUDE_CODE_REMOTE=true); on the PC, work in the session itself');
	const repo = path.resolve(o.repo || process.cwd());
	const plugin = path.resolve(o.plugin);
	let manifest = null;
	try { manifest = JSON.parse(fs.readFileSync(path.join(plugin, '.claude-plugin', 'plugin.json'), 'utf8')); } catch { /* named below */ }
	if (!manifest || manifest.name !== 'kit') return refuse(`${plugin} is not the kit plugin (no .claude-plugin/plugin.json named "kit")`);
	let brief;
	try { brief = fs.readFileSync(path.resolve(o.brief), 'utf8'); } catch { return refuse(`the brief ${o.brief} cannot be read`); }
	if (!brief.trim()) return refuse('the brief is empty');
	const timeoutMin = o.timeoutMin === undefined ? 120 : Number(o.timeoutMin);
	if (!(timeoutMin > 0 && timeoutMin <= 24 * 60)) return refuse('--timeout-min is a number of minutes, above 0 and at most a day');
	if (git(run, repo, 'rev-parse', '--git-dir').status !== 0) return refuse(`${repo} is not a git repo`);
	const faults = branchFaults({ repo, branch: o.branch, run });
	if (faults.length) return refuse(faults.join('; '));

	// One folder per worker, beside the repo: the worktree, its own throwaway config, and the stream it wrote.
	const top = git(run, repo, 'rev-parse', '--show-toplevel').stdout.trim() || repo;
	const workdir = path.resolve(o.workdir || `${top}-workers`);
	const slug = o.branch.replace(/\//g, '-');
	const tree = path.join(workdir, slug);
	const config = path.join(workdir, `${slug}.config`);
	const log = path.join(workdir, `${slug}.jsonl`);
	if (fs.existsSync(tree) || fs.existsSync(config)) return refuse(`${tree} already exists: one worker per branch, at a time`);
	fs.mkdirSync(workdir, { recursive: true });
	const local = git(run, repo, 'show-ref', '--verify', '--quiet', `refs/heads/${o.branch}`).status === 0;
	const remote = !local && git(run, repo, 'show-ref', '--verify', '--quiet', `refs/remotes/origin/${o.branch}`).status === 0;
	const add = local ? ['worktree', 'add', tree, o.branch]
		: remote ? ['worktree', 'add', '--track', '-b', o.branch, tree, `origin/${o.branch}`]
			: ['worktree', 'add', '-b', o.branch, tree, o.from || 'HEAD'];
	const made = git(run, repo, ...add);
	if (made.status !== 0) return refuse(`git worktree add failed: ${made.stderr.trim().split('\n')[0]}`);
	fs.mkdirSync(config, { recursive: true });
	fs.writeFileSync(path.join(config, '.claude.json'), `${JSON.stringify({ projects: { [tree]: { hasTrustDialogAccepted: true } } })}\n`);

	const timeout = Math.round(timeoutMin * 60000);
	const child = start('claude', workerArgs({ plugin, model: o.model, budget: o.budget }), { cwd: tree, env: workerEnv(env, config), timeout });
	const out = fs.createWriteStream(log);
	const check = startCheck({ plugin });
	let stopWhy = null;
	const stop = (why) => { if (stopWhy) return; stopWhy = why; try { child.kill('SIGKILL'); } catch { /* already gone */ } };
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
	if (stopWhy) { print(`stopped: ${stopWhy} (worktree ${tree}, log ${log})`); return 1; }
	print(`ran: exit ${code ?? signal}, worktree ${tree}, log ${log}`);
	return typeof code === 'number' ? code : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) main(process.argv.slice(2)).then((c) => { process.exitCode = c; });
