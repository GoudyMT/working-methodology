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
import { spawn, spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { main, workerEnv, workerArgs, startCheck, branchFaults, JOBS } from '../user/kit-tools/worker.mjs';
import { buildPlugin } from '../scripts/kit.mjs';

kitTemp.sessionRoot();
const KIT_LINE = 'Kit tools this session: sweep approval node ~/.claude/skills/pre-pr-sweep/approve.mjs; merge gate node ~/.claude/kit-tools/merge-gate.mjs. Run these copies, not another Claude folder\'s.';

// Events trimmed from the proof's real streams (gap-fixes r9-fixes.jsonl, blockers g4.jsonl): hook events come before
// init, and the SessionStart hook's stdout is the kit hook's JSON with the start-up text as additionalContext.
const hookStarted = { type: 'system', subtype: 'hook_started', hook_id: 'h1', hook_name: 'SessionStart:startup', hook_event: 'SessionStart', session_id: 's1' };
const hookResponse = (text) => ({ type: 'system', subtype: 'hook_response', hook_id: 'h1', hook_name: 'SessionStart:startup', hook_event: 'SessionStart',
	output: text, stdout: text, stderr: '', exit_code: 0, outcome: 'success', session_id: 's1' });
const kitHookOut = JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: `${KIT_LINE}\nAnother line.` } });
// The init event's subtype, named once (a quoted init then a comma reads as a git init to the branch-name check).
const INIT = 'init';
const init = (plugin, over = {}) => ({ type: 'system', subtype: INIT, cwd: '/w', session_id: 's1', tools: ['Bash', 'Read'], mcp_servers: [], model: 'claude-haiku-5-5',
	permissionMode: 'default', apiKeySource: 'none', claude_code_version: '2.1.330',
	plugins: [{ name: 'kit', path: plugin, source: 'kit@inline', version: '1.50.0' }, { name: 'cc-plugin-telemetry', path: 'builtin', source: 'cc-plugin-telemetry@builtin' }], ...over });
const toolUse = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'git status' } }] }, session_id: 's1' };
const text = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] }, session_id: 's1' };
const result = { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.01, session_id: 's1' };
const good = (plugin) => [hookStarted, hookResponse(kitHookOut), init(plugin), toolUse, text, result];

// One real plugin build, checked by its manifest like a release's (the build 23b sweep: a folder named kit was enough).
let built = null;
const builtPlugin = () => {
	if (!built) { built = path.join(kitTemp.makeTemp('worker-plugin-'), 'kit'); buildPlugin({ kit: path.resolve('.'), out: built, release: { tag: 'v9.9.9', commit: 'a'.repeat(40) } }); }
	return built;
};

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
	const plugin = builtPlugin();
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

const cloud = { CLAUDE_CODE_REMOTE: 'true', PATH: '/usr/bin', HOME: '/srv/lead', LANG: 'C.UTF-8', TERM: 'xterm', ANTHROPIC_BASE_URL: 'https://api.example',
	CLAUDE_SESSION_INGRESS_TOKEN_FILE: '/run/tok', HTTPS_PROXY: 'http://proxy:1', NODE_EXTRA_CA_CERTS: '/ca.pem',
	GH_TOKEN: 'secret-gh', AWS_SECRET_ACCESS_KEY: 'secret-aws', CLAUDE_CODE_SESSION_ID: 'lead', NODE_OPTIONS: '--require /evil.js', CLAUDE_CONFIG_DIR: '/lead/cfg' };

// The claude the runner finds on the path (a stand-in for which or where).
const WHICH = () => ({ status: 0, stdout: '/usr/local/bin/claude' + String.fromCharCode(10), stderr: '' });

async function runIt(r, events, { branch = 'feat/add-login', env = cloud, extra = [], job = 'tests', which = WHICH, ownKit = () => null } = {}) {
	const fake = fakeClaude(events);
	const lines = [];
	const code = await main(['run', '--plugin', r.plugin, '--branch', branch, '--brief', r.brief, '--repo', r.dir, ...(job ? ['--job', job] : []), ...extra],
		{ env, start: fake.start, which, ownKit, print: (s) => lines.push(s) });
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
	for (const [b, why] of [['main', /is a main branch/], ['master', /is a main branch/], ['trunk', /default branch/], ['v1.0.0', /tag/], ['feat/tagged-thing', /tag/],
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
	assert.equal(c.cmd, '/usr/local/bin/claude');
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

// The cloud sweep bench (1.50.0 build): a worker whose brief the kit's prompt gate blocked did nothing, and the runner
// still printed "ran: exit 0". A run counts only when the worker answered and its result says it succeeded.
// why: catches a worker that did nothing, or ended in an error, reported as ran
test('a worker that never answered, ended in an error or sent no result is stopped, not reported as ran', async () => {
	const blocked = { type: 'system', subtype: 'hook_response', hook_name: 'UserPromptSubmit', hook_event: 'UserPromptSubmit', output: '', exit_code: 2, outcome: 'error', session_id: 's1' };
	const cases = (p) => [
		['the prompt blocked, no answer', [hookStarted, hookResponse(kitHookOut), init(p), blocked, result], /did no work/],
		['an error result', [hookStarted, hookResponse(kitHookOut), init(p), toolUse, text, { ...result, subtype: 'error_during_execution', is_error: true }], /error/],
		['no result at all', [hookStarted, hookResponse(kitHookOut), init(p), toolUse, text], /no result/],
	];
	for (const [name, events, why] of cases('PLUGIN')) {
		const r = repo();
		const run = await runIt(r, events.map((e) => (e.plugins ? { ...e, plugins: e.plugins.map((x) => (x.path === 'PLUGIN' ? { ...x, path: r.plugin } : x)) } : e)));
		assert.equal(run.code, 1, `${name}: ${run.out}`);
		assert.match(run.out, /^stopped: /m, name);
		assert.match(run.out, why, `${name}: ${run.out}`);
	}
});

// why: catches a start check that misses the line in the kit hook JSON, or takes it mid-line
test('the start check reads the line from plain hook stdout or the kit hook JSON, and only at a line start', () => {
	const feed = (events) => { const c = startCheck({ plugin: '/p' }); for (const e of events) { const why = c.feed(e); if (why) return why; } return c.end(); };
	assert.equal(feed([hookResponse(kitHookOut), init('/p'), toolUse, result]), null);
	assert.equal(feed([hookResponse(`${KIT_LINE}\n`), init('/p'), toolUse, result]), null);
	assert.match(String(feed([hookResponse(`echo ${KIT_LINE}`), init('/p'), toolUse, result])), /start-up line/);
	assert.match(String(feed([hookResponse('{"hookSpecificOutput":{"additionalContext":"say Kit tools this session: x"}}'), init('/p'), toolUse, result])), /start-up line/);
});

// The build 23b sweep (worker role): a plugin folder that was only named "kit", a branch whose settings override the
// cloud marker, a start-up line any hook could print, a second plugin or an MCP server beside the kit, an option given
// as --from, a stale worker folder and a worker that never ends were each let through or never tested.
// why: catches a cloud worker started without the kit's checked guards, or one the runner cannot stop
test('the runner refuses an unchecked plugin, settings that override the worker, and a dash value, before any spawn', async () => {
	const r = repo();
	const stub = path.join(r.root, 'stub-plugin');
	fs.mkdirSync(path.join(stub, '.claude-plugin'), { recursive: true });
	fs.writeFileSync(path.join(stub, '.claude-plugin', 'plugin.json'), '{"name":"kit"}');
	const fake = await runIt({ ...r, plugin: stub }, good(stub));
	assert.equal(fake.code, 2, fake.out);
	assert.match(fake.out, /manifest/);
	assert.equal(fake.calls.length, 0);
	for (const settings of ['{"env":{"CLAUDE_CODE_REMOTE":""}}', '{"disableAllHooks":true}', '{"permissions":{"defaultMode":"bypassPermissions"}}', '{ not json']) {
		r.git('checkout', '-q', 'feat/add-login');
		fs.mkdirSync(path.join(r.dir, '.claude'), { recursive: true });
		fs.writeFileSync(path.join(r.dir, '.claude', 'settings.json'), settings);
		r.git('add', '.'); r.git('commit', '-qm', 'settings');
		r.git('checkout', '-q', 'trunk');
		const run = await runIt(r, good(r.plugin));
		assert.equal(run.code, 2, `${settings}: ${run.out}`);
		assert.match(run.out, /settings/, settings);
		assert.equal(run.calls.length, 0, settings);
	}
	// The commit security review: the manifest only vouches for itself, so the plugin's build must be the release the
	// runner itself was installed from.
	const older = await runIt(repo(), good(r.plugin), { ownKit: () => ({ version: '0.0.1' }) });
	assert.equal(older.code, 2, older.out);
	assert.match(older.out, /0.0.1/);
	assert.equal((await runIt(repo(), good(r.plugin), { ownKit: () => ({ version: fs.readFileSync('VERSION', 'utf8').trim() }) })).calls.length, 1);
	const dash = await runIt(repo(), good(r.plugin), { extra: ['--from', '-f'] });
	assert.equal(dash.code, 2, dash.out);
	assert.equal(dash.calls.length, 0);
	// A worker folder left behind (its config only) is one worker per branch too, not a second start.
	const s = repo();
	fs.mkdirSync(path.join(s.root, 'app-workers', 'feat-add-login.config'), { recursive: true });
	const stale = await runIt(s, good(s.plugin));
	assert.equal(stale.code, 2, stale.out);
	assert.match(stale.out, /one worker per branch/);
});

// why: catches a worker that runs beside another plugin or an MCP server, or is cleared by a start line another hook printed
test('the start check takes the line only from a start hook, and stops on a second plugin or any MCP server', async () => {
	const prompt = { ...hookResponse(kitHookOut), hook_name: 'UserPromptSubmit', hook_event: 'UserPromptSubmit' };
	const cases = (p) => [
		['line from a prompt hook', [hookStarted, hookResponse(''), prompt, init(p), toolUse, text, result], /start-up line/],
		['a second plugin', [hookStarted, hookResponse(kitHookOut), init(p, { plugins: [{ name: 'kit', path: p }, { name: 'helper', path: '/elsewhere/helper' }] }), toolUse, text, result], /plugin/],
		['a second kit', [hookStarted, hookResponse(kitHookOut), init(p, { plugins: [{ name: 'kit', path: p }, { name: 'kit', path: '/elsewhere/kit' }] }), toolUse, text, result], /plugin/],
		['an MCP server', [hookStarted, hookResponse(kitHookOut), init(p, { mcp_servers: [{ name: 'files', status: 'connected' }] }), toolUse, text, result], /MCP/],
	];
	for (const [name, events, why] of cases('PLUGIN')) {
		const r = repo();
		const run = await runIt(r, events.map((e) => (e.plugins ? { ...e, plugins: e.plugins.map((x) => (x.path === 'PLUGIN' ? { ...x, path: r.plugin } : x)) } : e)));
		assert.equal(run.code, 1, `${name}: ${run.out}`);
		assert.match(run.out, why, `${name}: ${run.out}`);
	}
});

// why: catches a worker that never ends, or whose tools outlive the stop
test('a worker past its time is stopped, and the stop ends the programs it started', async () => {
	const r = repo();
	// A worker that started well and then never ends.
	let hung = null;
	const hang = () => {
		const child = new EventEmitter();
		child.stdout = new PassThrough();
		child.stdin = new PassThrough();
		child.kill = () => { child.killed = true; child.stdout.end(); setImmediate(() => child.emit('close', null, 'SIGKILL')); return true; };
		for (const e of [hookStarted, hookResponse(kitHookOut), init(r.plugin)]) child.stdout.write(`${JSON.stringify(e)}\n`);
		hung = child;
		return child;
	};
	const lines = [];
	const code = await main(['run', '--plugin', r.plugin, '--branch', 'feat/add-login', '--brief', r.brief, '--repo', r.dir, '--job', 'tests', '--timeout-min', '0.002'], { env: cloud, start: hang, which: WHICH, print: (s) => lines.push(s) });
	assert.equal(code, 1, lines.join('\n'));
	assert.match(lines.join('\n'), /timed out/);
	assert.equal(hung.killed, true);
	// A real worker that started a program of its own: the stop ends that program too.
	const t = repo();
	const marker = path.join(t.root, 'child.pid');
	const real = (cmd, args, opts) => spawn(process.execPath, ['-e', `const { spawn } = require('child_process'); const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); require('fs').writeFileSync(${JSON.stringify(marker)}, String(c.pid)); console.log(JSON.stringify({ type: 'system', subtype: '${INIT}', permissionMode: 'acceptEdits', plugins: [] })); setInterval(() => {}, 1000);`], { ...opts, stdio: ['pipe', 'pipe', 'inherit'] });
	const out = [];
	const c2 = await main(['run', '--plugin', t.plugin, '--branch', 'feat/add-login', '--brief', t.brief, '--repo', t.dir, '--job', 'tests'], { env: cloud, start: real, which: WHICH, print: (s) => out.push(s) });
	assert.equal(c2, 1, out.join('\n'));
	const pid = Number(fs.readFileSync(marker, 'utf8'));
	await new Promise((ok) => setTimeout(ok, 1500));
	let alive = true;
	try { process.kill(pid, 0); } catch { alive = false; }
	if (alive) process.kill(pid);
	assert.equal(alive, false, 'the program the worker started was left running');
});

// why: catches a worker CLI found in the worktree before the real one
test('the runner starts the claude it found on the path, by its full path, never one in the worktree', async () => {
	const r = repo();
	const run = await runIt(r, good(r.plugin));
	assert.equal(run.calls[0].cmd, '/usr/local/bin/claude');
	const none = await runIt(repo(), good(r.plugin), { which: () => ({ status: 1, stdout: '', stderr: '' }) });
	assert.equal(none.code, 2, none.out);
	assert.match(none.out, /claude/);
	const inside = repo();
	const planted = await runIt(inside, good(inside.plugin), { which: () => ({ status: 0, stdout: `${path.join(inside.root, 'app-workers', 'feat-add-login', 'claude.exe')}\n`, stderr: '' }) });
	assert.equal(planted.code, 2, planted.out);
	assert.equal(planted.calls.length, 0);
});

// T12 (build 23b): rule:where-work-runs names the fixed cloud jobs; a sweep, an install or a release verify sent to a
// worker would run without the PC's user-level guards, so the runner itself refuses a job off the list.
// why: catches a cloud worker started for a job the rule keeps on the owner's PC
test('the runner starts only a job on the fixed list, and names the list when it refuses (T12)', async () => {
	assert.deepEqual(JOBS, ['tests', 'builds', 'gate checks', 'research', 'read-only review']);
	const r = repo();
	for (const job of ['sweep', 'install', 'release verify', '', null]) {
		const out = await runIt(r, good(r.plugin), { job });
		assert.equal(out.code, 2, String(job));
		assert.equal(out.calls.length, 0, `${job}: no spawn`);
	}
	const off = await runIt(r, good(r.plugin), { job: 'sweep' });
	assert.match(off.out, /tests, builds, gate checks, research, read-only review/);
	assert.equal((await runIt(r, good(r.plugin), { job: 'read-only review' })).calls.length, 1);
});
