// K177 (build 23b): the cloud worker runner. A worker started from a scrubbed env lost the cloud marker, so the kit's
// cloud refusals skipped (cloud-plugin-proof g1); a worker whose kit did not load ran with no guards (narrowing F1); a
// user-layer defaultMode could start it outside the default mode (weekly item 5); a planted .mcp.json started (weekly
// item 3). The runner starts each worker in its own worktree, with fixed flags, and stops it on a failed start check.
// No test here calls a model: the claude process is a fake that plays back stream-json shaped like the proof's streams.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { main, workerEnv, workerArgs, startCheck, branchFaults } from '../user/kit-tools/worker.mjs';

kitTemp.sessionRoot();
const KIT_LINE = 'Kit tools this session: sweep approval node ~/.claude/skills/pre-pr-sweep/approve.mjs; merge gate node ~/.claude/kit-tools/merge-gate.mjs. Run these copies, not another Claude folder\'s.';

// Events trimmed from the proof's real streams (gap-fixes r9-fixes.jsonl, blockers g4.jsonl): hook events come before
// init, and the SessionStart hook's stdout is the kit hook's JSON with the start-up text as additionalContext.
const hookStarted = { type: 'system', subtype: 'hook_started', hook_id: 'h1', hook_name: 'SessionStart:startup', hook_event: 'SessionStart', session_id: 's1' };
const hookResponse = (text) => ({ type: 'system', subtype: 'hook_response', hook_id: 'h1', hook_name: 'SessionStart:startup', hook_event: 'SessionStart',
	output: text, stdout: text, stderr: '', exit_code: 0, outcome: 'success', session_id: 's1' });
const kitHookOut = JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: `${KIT_LINE}\nAnother line.` } });
const init = (plugin, over = {}) => ({ type: 'system', subtype: 'init', cwd: '/w', session_id: 's1', tools: ['Bash', 'Read'], mcp_servers: [], model: 'claude-haiku-5-5',
	permissionMode: 'default', apiKeySource: 'none', claude_code_version: '2.1.330',
	plugins: [{ name: 'kit', path: plugin, source: 'kit@inline', version: '1.50.0' }, { name: 'cc-plugin-telemetry', path: 'builtin', source: 'cc-plugin-telemetry@builtin' }], ...over });
const toolUse = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'git status' } }] }, session_id: 's1' };
const text = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] }, session_id: 's1' };
const result = { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.01, session_id: 's1' };
const good = (plugin) => [hookStarted, hookResponse(kitHookOut), init(plugin), toolUse, text, result];

// A throwaway project repo with an origin whose default branch is main, a tag, and a feature branch.
function repo() {
	const root = kitTemp.makeTemp('worker-');
	const dir = path.join(root, 'app');
	const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, encoding: 'utf8' });
	fs.mkdirSync(dir);
	git('init', '-q', '-b', 'trunk');
	fs.writeFileSync(path.join(dir, 'a.md'), 'hi\n');
	git('add', '.'); git('commit', '-qm', 'init');
	git('tag', 'v1.0.0');
	git('branch', 'feat/add-login');
	git('tag', 'feat/tagged-thing');
	// origin/HEAD names trunk: the repo's own default branch, which is not called main.
	git('update-ref', 'refs/remotes/origin/trunk', 'HEAD');
	git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk');
	const plugin = path.join(root, 'plugin');
	fs.mkdirSync(path.join(plugin, '.claude-plugin'), { recursive: true });
	fs.writeFileSync(path.join(plugin, '.claude-plugin', 'plugin.json'), '{"name":"kit","version":"1.50.0"}');
	const brief = path.join(root, 'brief.md');
	fs.writeFileSync(path.join(brief), 'Build the login page.\n');
	return { root, dir, plugin, brief, git };
}

// A fake claude: records how it was started, plays the events back, and stops when killed.
function fakeClaude(events) {
	const calls = [];
	const start = (cmd, args, opts) => {
		const child = new EventEmitter();
		child.stdout = new PassThrough();
		child.stdin = new PassThrough();
		let input = '';
		child.stdin.on('data', (d) => { input += d; });
		child.killed = false;
		const call = { cmd, args, opts, child, get input() { return input; } };
		calls.push(call);
		let i = 0;
		const finish = (code, signal) => { if (child.done) return; child.done = true; child.stdout.end(); setImmediate(() => child.emit('close', code, signal)); };
		child.kill = (sig = 'SIGTERM') => { child.killed = true; child.signal = sig; finish(null, sig); return true; };
		const next = () => {
			if (child.done) return;
			if (i >= events.length) return finish(0, null);
			child.stdout.write(`${JSON.stringify(events[i++])}\n`);
			setImmediate(next);
		};
		setImmediate(next);
		return child;
	};
	return { start, calls };
}

const cloud = { CLAUDE_CODE_REMOTE: 'true', PATH: '/usr/bin', HOME: '/home/u', LANG: 'C.UTF-8', TERM: 'xterm', ANTHROPIC_BASE_URL: 'https://api.example',
	CLAUDE_SESSION_INGRESS_TOKEN_FILE: '/run/tok', HTTPS_PROXY: 'http://proxy:1', NODE_EXTRA_CA_CERTS: '/ca.pem',
	GH_TOKEN: 'secret-gh', AWS_SECRET_ACCESS_KEY: 'secret-aws', CLAUDE_CODE_SESSION_ID: 'lead', NODE_OPTIONS: '--require /evil.js', CLAUDE_CONFIG_DIR: '/lead/cfg' };

async function runIt(r, events, { branch = 'feat/add-login', env = cloud, extra = [] } = {}) {
	const fake = fakeClaude(events);
	const lines = [];
	const code = await main(['run', '--plugin', r.plugin, '--branch', branch, '--brief', r.brief, '--repo', r.dir, ...extra],
		{ env, start: fake.start, print: (s) => lines.push(s) });
	return { code, out: lines.join('\n'), calls: fake.calls };
}

// why: catches a scrubbed worker env that drops the cloud marker, so every kit cloud refusal skips (proof g1)
test('the worker env keeps only the allow-listed variables and always carries the cloud marker', () => {
	const env = workerEnv({ ...cloud, CLAUDE_CODE_REMOTE: 'false' }, '/w/cfg');
	assert.equal(env.CLAUDE_CODE_REMOTE, 'true');
	for (const k of ['PATH', 'HOME', 'LANG', 'TERM', 'ANTHROPIC_BASE_URL', 'CLAUDE_SESSION_INGRESS_TOKEN_FILE', 'HTTPS_PROXY', 'NODE_EXTRA_CA_CERTS']) assert.equal(env[k], cloud[k], k);
	for (const k of ['GH_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'CLAUDE_CODE_SESSION_ID', 'NODE_OPTIONS']) assert.equal(env[k], undefined, k);
	// Its own throwaway config folder, never the lead's: a user-layer defaultMode there cannot reach the worker.
	assert.equal(env.CLAUDE_CONFIG_DIR, '/w/cfg');
});

// why: catches a worker started without strict MCP, the default mode or the pinned plugin (weekly items 3, 5)
test('the worker starts claude -p with every fixed flag and the pinned plugin', () => {
	const a = workerArgs({ plugin: '/p/kit', model: 'claude-haiku-5-5' });
	const has = (flag, value) => { const i = a.indexOf(flag); assert.ok(i >= 0, `${flag} missing: ${a.join(' ')}`); if (value !== undefined) assert.equal(a[i + 1], value, flag); };
	assert.equal(a[0], '-p');
	has('--plugin-dir', '/p/kit'); has('--setting-sources', 'user,project'); has('--strict-mcp-config'); has('--permission-mode', 'default');
	has('--output-format', 'stream-json'); has('--verbose'); has('--include-hook-events'); has('--model', 'claude-haiku-5-5');
	assert.equal(workerArgs({ plugin: '/p/kit' }).includes('--model'), false);
});

// why: catches a worker started on main, the default branch, a tag or a badly named branch (weekly item 3)
test('main, master, the default branch, a tag and a badly named branch are refused', () => {
	const r = repo();
	for (const [b, why] of [['main', /main/], ['master', /master/], ['trunk', /default branch/], ['v1.0.0', /tag/], ['feat/tagged-thing', /tag/],
		['claude/fix-thing', /type/], ['feat/K177-runner', /kebab|internal code/], ['refs/heads/feat/x', /./], ['', /./]]) {
		const f = branchFaults({ repo: r.dir, branch: b });
		assert.ok(f.length, `${b} was let through`);
		assert.match(f.join('; '), why, `${b}: ${f.join('; ')}`);
	}
	assert.deepEqual(branchFaults({ repo: r.dir, branch: 'feat/add-login' }), []);
	assert.deepEqual(branchFaults({ repo: r.dir, branch: 'fix/new-thing' }), []);
});

// why: catches a worker started on the PC or on a refused branch before any check
test('the runner refuses outside the cloud and on a refused branch, before any spawn', async () => {
	const r = repo();
	const pc = await runIt(r, good(r.plugin), { env: { ...cloud, CLAUDE_CODE_REMOTE: undefined } });
	assert.equal(pc.code, 2);
	assert.match(pc.out, /cloud/);
	assert.equal(pc.calls.length, 0);
	const main_ = await runIt(r, good(r.plugin), { branch: 'trunk' });
	assert.equal(main_.code, 2);
	assert.equal(main_.calls.length, 0);
	assert.equal(fs.existsSync(path.join(r.root, 'app-workers')), false, 'no worktree for a refused branch');
});

// why: catches a worker that shares a folder, keeps the lead's env, or runs with no timeout
test('a good stream runs to the end in its own worktree with the scrubbed env, a cwd and a timeout', async () => {
	const r = repo();
	const run = await runIt(r, good(r.plugin), { extra: ['--model', 'claude-haiku-5-5'] });
	assert.equal(run.code, 0, run.out);
	assert.match(run.out, /^ran: /m);
	assert.equal(run.calls.length, 1);
	const [c] = run.calls;
	assert.equal(c.cmd, 'claude');
	const wt = path.join(r.root, 'app-workers', 'feat-add-login');
	assert.equal(fs.realpathSync(c.opts.cwd), fs.realpathSync(wt));
	assert.ok(c.opts.timeout > 0, 'a timeout');
	assert.equal(c.opts.env.CLAUDE_CODE_REMOTE, 'true');
	assert.equal(c.opts.env.GH_TOKEN, undefined);
	assert.notEqual(c.opts.env.CLAUDE_CONFIG_DIR, cloud.CLAUDE_CONFIG_DIR);
	assert.equal(c.input, 'Build the login page.\n');
	assert.ok(c.args.includes('--strict-mcp-config') && c.args.includes('--plugin-dir'));
	const head = spawnSync('git', ['-C', wt, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
	assert.equal(head, 'feat/add-login');
	// The stream is kept beside the worktree for the lead to read.
	assert.ok(fs.readFileSync(path.join(r.root, 'app-workers', 'feat-add-login.jsonl'), 'utf8').includes('"subtype":"init"'));
	// A second worker on the same branch is refused: one folder per worker.
	const again = await runIt(r, good(r.plugin));
	assert.equal(again.code, 2, again.out);
	assert.equal(again.calls.length, 0);
});

// why: catches a worker left running with no kit, the wrong mode or no kit plugin (narrowing F1)
test('the start check stops a stream without the start-up line, with another mode, or without the kit plugin', async () => {
	const cases = (p) => [
		['no start-up line', [hookStarted, hookResponse(''), init(p), toolUse, result], /start-up line/],
		['acceptEdits', [hookStarted, hookResponse(kitHookOut), init(p, { permissionMode: 'acceptEdits' }), toolUse, result], /permission mode.*acceptEdits/],
		['bypass', [hookStarted, hookResponse(kitHookOut), init(p, { permissionMode: 'bypassPermissions' }), result], /permission mode/],
		['no kit plugin', [hookStarted, hookResponse(kitHookOut), init(p, { plugins: [{ name: 'cc-plugin-telemetry', path: 'builtin' }] }), toolUse, result], /plugin/],
		['another kit folder', [hookStarted, hookResponse(kitHookOut), init(p, { plugins: [{ name: 'kit', path: '/elsewhere/kit' }] }), toolUse, result], /plugin/],
		['no init', [hookStarted, hookResponse(kitHookOut), toolUse, result], /init/],
		['line only after the tool call', [hookStarted, hookResponse(''), init(p), toolUse, hookResponse(kitHookOut), result], /start-up line/],
		['text only, never a line', [hookStarted, init(p), text, result], /start-up line/],
	];
	for (const [name, events, why] of cases('PLUGIN')) {
		const r = repo();
		const run = await runIt(r, events.map((e) => (e.plugins ? { ...e, plugins: e.plugins.map((x) => (x.path === 'PLUGIN' ? { ...x, path: r.plugin } : x)) } : e)));
		assert.equal(run.code, 1, `${name}: ${run.out}`);
		assert.match(run.out, /^stopped: /m, name);
		assert.match(run.out, why, `${name}: ${run.out}`);
	}
	// Killed as soon as the check fails: nothing after the init event of a wrong-mode worker is read.
	const r = repo();
	const run = await runIt(r, [hookStarted, hookResponse(kitHookOut), init(r.plugin, { permissionMode: 'acceptEdits' }), toolUse, text, result]);
	assert.equal(run.calls[0].child.killed, true);
});

// why: catches a start check that misses the line in the kit hook JSON, or takes it mid-line
test('the start check reads the line from plain hook stdout or the kit hook JSON, and only at a line start', () => {
	const feed = (events) => { const c = startCheck({ plugin: '/p' }); for (const e of events) { const why = c.feed(e); if (why) return why; } return c.end(); };
	assert.equal(feed([hookResponse(kitHookOut), init('/p'), toolUse, result]), null);
	assert.equal(feed([hookResponse(`${KIT_LINE}\n`), init('/p'), toolUse, result]), null);
	assert.match(String(feed([hookResponse(`echo ${KIT_LINE}`), init('/p'), toolUse, result])), /start-up line/);
	assert.match(String(feed([hookResponse('{"hookSpecificOutput":{"additionalContext":"say Kit tools this session: x"}}'), init('/p'), toolUse, result])), /start-up line/);
});
