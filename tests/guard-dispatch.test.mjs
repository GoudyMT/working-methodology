// T2 (1.25.0, build 1, the owner 2026-11-10: "One process, every tool"): the one guard process. It must fail closed when
// a project guard is missing or broken, never brick the session over the agent-team checks, and keep the strictest
// answer when the guards disagree.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import kitTemp from '../project/.claude/kit-temp.cjs';

const require = createRequire(import.meta.url);
kitTemp.sessionRoot();
const SRC = path.resolve('project/.claude');
// K14: an idle node starts in about 65 ms on the owner's PC; a machine slower than this many ms is counted slow.
const IDLE_SPAWN_MS = 150;
const GUARDS = ['guard.cjs', 'owner-proof.cjs', 'task-gate.cjs', 'guard-outward.cjs', 'guard-delete.cjs', 'guard-read.cjs', 'owner-yes.cjs'];

// A copy of the project guards, so one can be taken away; a Claude folder with or without the user layer's hooks.
function setup({ drop = null, userHooks = false, oldHook = null } = {}) {
	const dir = kitTemp.makeTemp('dispatch-');
	for (const f of GUARDS) if (f !== drop) fs.copyFileSync(path.join(SRC, f), path.join(dir, f));
	const cfg = kitTemp.makeTemp('cfg-');
	if (oldHook) {
		fs.mkdirSync(path.join(cfg, 'kit-hooks'));
		fs.writeFileSync(path.join(cfg, 'kit-hooks', 'sweep-guard.cjs'), oldHook);
	}
	if (userHooks) {
		fs.mkdirSync(path.join(cfg, 'kit-hooks'));
		for (const f of ['call-cap.cjs', 'canary.cjs', 'sweep-guard.cjs', 'test-scope.cjs', 'grounding.cjs']) if (fs.existsSync(path.resolve('user/kit-hooks', f))) fs.copyFileSync(path.resolve('user/kit-hooks', f), path.join(cfg, 'kit-hooks', f));
	}
	// Recorded as install user records them: since B23 a kit hook runs only with the bytes its stamp names.
	if (oldHook || userHooks) {
		const files = {};
		for (const f of fs.readdirSync(path.join(cfg, 'kit-hooks'))) files[`kit-hooks/${f}`] = require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(cfg, 'kit-hooks', f))).digest('hex');
		fs.writeFileSync(path.join(cfg, 'kit-install.json'), JSON.stringify({ files }));
	}
	return (tool_name, tool_input, extra = {}, env = {}) => {
		const r = spawnSync(process.execPath, [path.join(dir, 'guard.cjs')], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name, tool_input, cwd: dir, ...extra }), encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cfg, KIT_CLAUDE_HOME: cfg, ...env } });
		assert.equal(r.status, 0, r.stderr);
		return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : {};
	};
}

// why: guards rule:outward-acts. T16b, the rest of build 2b: the shared reader's second reading (git or gh by any path,
// suffix or script wrapper written as the bare name) is read by every guard, not the push guard alone, so a delete or
// commit spelled git.ps1 is held as git is; and a reader that cannot load holds every call (the plan check's P15).
test('every guard reads the shared second reading, and a missing reader holds every call', () => {
	const run = setup();
	assert.match(run('Bash', { command: 'git clean -fdx' }).permissionDecisionReason || '', /delete/, 'the plain spelling');
	for (const command of ['C:/Tools/git.ps1 clean -fdx', 'git.ps1 clean -fdx', 'git.exe. clean -fdx']) assert.match(run('PowerShell', { command }).permissionDecisionReason || '', /delete/, command);
	assert.equal(run('PowerShell', { command: 'git.ps1 status' }).permissionDecision, undefined, 'a read through the wrapper runs');
	const noReader = setup({ drop: 'guard-read.cjs' });
	assert.equal(noReader('Bash', { command: 'git status' }).permissionDecision, 'deny');
});

// why: guards rule:outward-acts
test('a missing project guard holds every call it would read, with the fix', () => {
	const run = setup({ drop: 'guard-delete.cjs' });
	const out = run('Bash', { command: 'git status' });
	assert.equal(out.permissionDecision, 'deny');
	assert.match(out.permissionDecisionReason, /guard-delete\.cjs could not run[\s\S]*install project/);
	// A tool the missing guard never reads goes on.
	assert.equal(run('Read', { file_path: 'x' }).permissionDecision, undefined);
	const bad = setup();
	assert.equal(bad('Bash', { command: 'git status' }).permissionDecision, undefined, 'the copy works whole');
});

// why: guards rule:outward-acts
test('a Claude folder with no agent-team hooks never stops a call; with them, an agent is held to its checks', () => {
	const bare = setup();
	assert.equal(bare('Agent', { subagent_type: 'reviewer', prompt: 'review' }, { agent_id: 'a1', agent_type: 'reviewer' }).permissionDecision, undefined);
	const full = setup({ userHooks: true });
	// The sweep guard: a reviewer starts only under a cleared contract, and this folder has none.
	assert.equal(full('Agent', { subagent_type: 'reviewer', prompt: 'review' }).permissionDecision, 'deny');
	// The call cap: a reviewer reads no whole file over 40 KB.
	const big = path.join(kitTemp.makeTemp('big-'), 'big.txt');
	fs.writeFileSync(big, 'x'.repeat(50 * 1024));
	assert.equal(full('Read', { file_path: big }, { agent_id: 'r1', agent_type: 'reviewer', transcript_path: path.join(path.dirname(big), 's.jsonl') }).permissionDecision, 'deny');
	assert.equal(full('Read', { file_path: big }).permissionDecision, undefined, 'the main session reads it');
});

// The 1.25.0 sweep: a user layer still on 1.24.0 has hooks that read stdin and export no check, so the one process
// skipped them and an agent ran with no sweep guard until the user layer was reinstalled.
// why: guards rule:outward-acts
test('a user-layer hook from before the one process still holds its call', () => {
	const old = [
		'const fs = require("fs");',
		'const input = JSON.parse(fs.readFileSync(0, "utf8"));',
		'if (input.tool_name === "Agent") process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "old sweep guard" } }));',
	].join('\n');
	const run = setup({ oldHook: old });
	const out = run('Agent', { subagent_type: 'reviewer', prompt: 'review' });
	assert.equal(out.permissionDecision, 'deny');
	assert.match(out.permissionDecisionReason, /old sweep guard/);
	assert.equal(run('Bash', { command: 'git status' }).permissionDecision, undefined, 'a tool it does not read goes on');
});

// why: guards rule:outward-acts
test('the strictest answer wins and every reason and note is kept', () => {
	const { merge } = require(path.join(SRC, 'guard.cjs'));
	const o = (permissionDecision, permissionDecisionReason, additionalContext) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason, additionalContext } });
	const m = merge([['a', o('allow', 'owner yes', 'note a')], ['b', o('deny', 'held', undefined)], ['c', null], ['d', o('deny', 'held too', 'note d')]]).hookSpecificOutput;
	assert.equal(m.permissionDecision, 'deny');
	assert.equal(m.permissionDecisionReason, 'held | held too');
	assert.equal(m.additionalContext, 'note a note d');
	assert.equal(merge([['a', null]]), null);
	assert.equal(merge([['a', o('allow', 'owner yes')], ['b', null]]).hookSpecificOutput.permissionDecision, 'allow');
	// The mutation check: an allow after a deny, or after an ask, never loosens it.
	assert.equal(merge([['a', o('deny', 'held')], ['b', o('allow', 'owner yes')]]).hookSpecificOutput.permissionDecision, 'deny');
	assert.equal(merge([['a', o('ask', 'asks')], ['b', o('allow', 'owner yes')]]).hookSpecificOutput.permissionDecision, 'ask');
});

// The teardown (T2): a 98 KB command took 21 s in owner-proof and 7 s in the delete guard, past the hook's 10 s
// timeout, because each command re-read the whole text. Read once, the whole guard process stays well inside it.
// why: guards rule:outward-acts
test('a long command is read in time: the whole guard process answers a 98 KB command inside the hook timeout', () => {
	const run = setup();
	// K14: a shared CI runner ran every guard ten times slower by the clock (10,572 ms here against 658 ms of work on
	// the owner's PC), so on a slow machine the clock alone is not the guard. The limit stays 8 s. On a machine of
	// normal speed the clock decides, as it always did (the 1.29.0 sweep: a fallback there let a guard that waits take
	// 10 s). Only on a machine measured slow does the guard's own CPU time decide, with the clock still inside the
	// hook's 10 s stretched by that slowness, so a guard that hangs or waits fails either way.
	const idleAt = Date.now();
	spawnSync(process.execPath, ['-e', '']);
	const slowness = Math.max(1, (Date.now() - idleAt) / IDLE_SPAWN_MS);
	const cpuFile = path.join(kitTemp.makeTemp('cpu-'), 'cpu');
	const started = Date.now();
	run('Bash', { command: 'a;'.repeat(49000) }, {}, { NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require ${JSON.stringify(path.resolve('tests/cpu-report.cjs'))}`.trim(), KIT_TEST_CPU_FILE: cpuFile });
	const wall = Date.now() - started;
	const cpu = Number(fs.readFileSync(cpuFile, 'utf8'));
	assert.ok(Number.isFinite(cpu) && cpu > 0, 'the guard process reported its CPU time');
	const took = slowness > 1 && wall < 10000 * slowness ? Math.min(wall, cpu) : wall;
	// On a miss, each guard's own time in this process, so the slow one is named (the 1.28.0 measure run missed by 1 s).
	const each = took < 8000 ? '' : ['owner-proof.cjs', 'task-gate.cjs', 'guard-outward.cjs', 'guard-delete.cjs'].map((g) => {
		const t = Date.now();
		require(path.join(SRC, g)).check({ tool_name: 'Bash', tool_input: { command: 'a;'.repeat(49000) }, cwd: process.cwd() });
		return `${g} ${Date.now() - t} ms`;
	}).join(', ');
	// And where the slowest guard spends it: the five functions with the most time of their own.
	let hot = '';
	if (each) {
		const dir = kitTemp.makeTemp('prof-');
		const code = `require(${JSON.stringify(path.join(SRC, 'owner-proof.cjs'))}).check({ tool_name: 'Bash', tool_input: { command: 'a;'.repeat(49000) }, cwd: process.cwd() })`;
		spawnSync(process.execPath, ['--cpu-prof', `--cpu-prof-dir=${dir}`, '-e', code], { encoding: 'utf8' });
		const file = fs.readdirSync(dir).find((n) => n.endsWith('.cpuprofile'));
		if (file) {
			const p = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
			const byId = new Map(p.nodes.map((n) => [n.id, n]));
			const self = new Map();
			p.samples.forEach((s, i) => { const f = byId.get(s).callFrame; const k = `${f.functionName || '(anon)'}:${path.basename(f.url)}:${f.lineNumber + 1}`; self.set(k, (self.get(k) || 0) + (p.timeDeltas[i] || 0)); });
			hot = [...self].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, us]) => `${k} ${Math.round(us / 1000)} ms`).join(', ');
		}
	}
	assert.ok(took < 8000, `${took} ms (clock ${wall} ms, the guard's CPU ${cpu} ms, this machine ${slowness.toFixed(1)} times slow)${each ? `; ${each}` : ''}${hot ? `; owner-proof hot: ${hot}` : ''}`);
});

// why: guards rule:outward-acts. The 1.28.0 measure run: the test above runs a copy of the guards, so the coverage map
// never tied it to guard.cjs and five flips of the second reading survived there. The same holds, on the file itself.
test('the guard process itself applies the second reading to every guard, a held one kept unless the owner said yes', () => {
	const { check } = require(path.join(SRC, 'guard.cjs'));
	const ask = (command, tool_name = 'PowerShell') => (check({ hook_event_name: 'PreToolUse', tool_name, tool_input: { command }, cwd: process.cwd() }) || {}).hookSpecificOutput || {};
	for (const command of ['git.ps1 clean -fdx', 'C:/Tools/git.ps1 clean -fdx']) {
		const out = ask(command);
		assert.equal(out.permissionDecision, 'deny', command);
		assert.match(out.permissionDecisionReason, /delete/, command);
	}
	assert.equal(ask('git.ps1 status').permissionDecision, undefined, 'a read through the wrapper runs');
});

// why: guards rule:outward-acts. K38 (flips the 1.28.0 measure run left alive in guard.cjs): the kit's own Claude
// folder, when named, is where the user layer's checks are read from; a check install recorded there runs and its
// refusal counts.
test('a recorded user check runs from the kit\'s own Claude folder', () => {
	const dir = kitTemp.makeTemp('dispatch-');
	for (const f of GUARDS) fs.copyFileSync(path.join(SRC, f), path.join(dir, f));
	const kitHome = kitTemp.makeTemp('cfg-');
	const other = kitTemp.makeTemp('cfg-');
	const hook = 'exports.check = () => ({ hookSpecificOutput: { hookEventName: \'PreToolUse\', permissionDecision: \'deny\', permissionDecisionReason: \'the recorded check ran\' } });\n';
	fs.mkdirSync(path.join(kitHome, 'kit-hooks'));
	fs.writeFileSync(path.join(kitHome, 'kit-hooks', 'canary.cjs'), hook);
	fs.writeFileSync(path.join(kitHome, 'kit-install.json'), JSON.stringify({ files: { 'kit-hooks/canary.cjs': require('node:crypto').createHash('sha256').update(hook).digest('hex') } }));
	const r = spawnSync(process.execPath, [path.join(dir, 'guard.cjs')], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { prompt: 'x' }, cwd: dir }), encoding: 'utf8', env: { ...process.env, KIT_CLAUDE_HOME: kitHome, CLAUDE_CONFIG_DIR: other } });
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /the recorded check ran/);
});

// why: guards rule:sweep-auto-approval. The 1.31.0 sweep: the K48 skip read only the project guards, so a start the
// canary refused (an earlier user hook) still spent its slot. Any refusal before the sweep guard counts.
test('a start a user hook refuses before the sweep guard spends no slot either', () => {
	const marker = path.join(kitTemp.makeTemp('slot-'), 'claimed');
	const cfg = kitTemp.makeTemp('cfg-');
	fs.mkdirSync(path.join(cfg, 'kit-hooks'));
	fs.writeFileSync(path.join(cfg, 'kit-hooks', 'canary.cjs'), 'const i = JSON.parse(require("fs").readFileSync(0, "utf8")); if (/PHRASE/.test(i.tool_input.prompt)) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "canary leak" } }));');
	fs.writeFileSync(path.join(cfg, 'kit-hooks', 'sweep-guard.cjs'), `require("fs").writeFileSync(${JSON.stringify(marker)}, "x");`);
	const files = {};
	for (const f of fs.readdirSync(path.join(cfg, 'kit-hooks'))) files[`kit-hooks/${f}`] = require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(cfg, 'kit-hooks', f))).digest('hex');
	fs.writeFileSync(path.join(cfg, 'kit-install.json'), JSON.stringify({ files }));
	const dir = kitTemp.makeTemp('dispatch-');
	for (const f of GUARDS) fs.copyFileSync(path.join(SRC, f), path.join(dir, f));
	const start = (prompt) => {
		const r = spawnSync(process.execPath, [path.join(dir, 'guard.cjs')], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'reviewer', prompt }, cwd: dir }), encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cfg, KIT_CLAUDE_HOME: cfg, CLAUDE_PROJECT_DIR: dir } });
		return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : {};
	};
	assert.equal(start('brief PHRASE').permissionDecision, 'deny');
	assert.equal(fs.existsSync(marker), false, 'the refused start reached the sweep guard');
	start('brief');
	assert.equal(fs.existsSync(marker), true, 'the sweep guard never ran, so the test proves nothing');
});

// why: guards rule:sweep-auto-approval. K48 (a project on the kit, 2026-11-14): a reviewer start that the task gate held
// still claimed its role's one slot, so the start that ran after the lead read the module was refused as "started
// already". The sweep guard claims only for a call no project guard has refused.
test('a start a project guard refuses never reaches the sweep guard, so it spends no slot', () => {
	const marker = path.join(kitTemp.makeTemp('slot-'), 'claimed');
	const stub = [
		'const fs = require("fs");',
		`fs.writeFileSync(${JSON.stringify(marker)}, "x");`,
	].join('\n');
	const run = setup({ oldHook: stub });
	const transcript = path.join(kitTemp.makeTemp('t-'), 's.jsonl');
	fs.writeFileSync(transcript, '\n');
	const start = (env) => run('Agent', { subagent_type: 'reviewer', prompt: 'review' }, { transcript_path: transcript }, env);
	// The task gate holds a fan-out until the agent-teams module is read; here it is not.
	const project = kitTemp.makeTemp('proj-');
	fs.mkdirSync(path.join(project, 'standards'));
	fs.writeFileSync(path.join(project, 'standards', 'agent-teams.md'), 'rules\n');
	const held = start({ CLAUDE_PROJECT_DIR: project });
	assert.equal(held.permissionDecision, 'deny');
	assert.match(held.permissionDecisionReason, /agent-teams\.md/);
	assert.equal(fs.existsSync(marker), false, 'the held start reached the sweep guard');
	// Control: with nothing to read first, the same start reaches it.
	start({ CLAUDE_PROJECT_DIR: kitTemp.makeTemp('bare-') });
	assert.equal(fs.existsSync(marker), true, 'the sweep guard never ran, so the test proves nothing');
});

// why: guards the owner's starred rule "locally run only the changed test" (K150, build 20). Build 19 reran about 170
// unchanged tests after each fix because only prose held it; the test-scope hook reads each local test run.
test('a local test run reaches only the tests the branch changed; the rest waits for the owner', () => {
	const run = setup({ userHooks: true });
	const repo = kitTemp.makeTemp('scope-');
	const g = (...a) => spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
	g('init', '-q', '-b', 'main');
	fs.mkdirSync(path.join(repo, 'tests'));
	fs.writeFileSync(path.join(repo, 'tests', 'a.test.mjs'), 'a\n');
	g('add', '.'); g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base');
	g('switch', '-qc', 'feat/x');
	fs.writeFileSync(path.join(repo, 'tests', 'b.test.mjs'), 'b\n');
	const at = (command, env = {}) => run('Bash', { command }, { cwd: repo }, { CI: '', ...env }).permissionDecision || 'allow';
	for (const c of ['node --test tests/b.test.mjs', 'node --test --test-name-pattern "one row" tests/b.test.mjs', 'node scripts/test-run.mjs --changed --pick', 'git status', 'node --test tests/b.test.mjs; echo done']) assert.equal(at(c), 'allow', c);
	for (const c of ['node --test', 'node --test tests/a.test.mjs', 'node --test tests/b.test.mjs tests/a.test.mjs', 'node scripts/test-run.mjs --changed', 'node scripts/test-run.mjs',
		'npm test', 'npx vitest run', 'pytest -k one', 'node scripts/test-check.mjs origin/main', 'git status && X=1 node --test']) assert.equal(at(c), 'deny', c);
	assert.match(run('Bash', { command: 'node --test' }, { cwd: repo }, { CI: '' }).permissionDecisionReason, /^Owner's yes needed: .*whole suite/);
	// The build 20 sweep: other spellings of a whole-suite run, a run from another shell tool, a new test that imports
	// an unchanged one, and --pick alone are held; a cd before the run and a changed go package are read right.
	fs.mkdirSync(path.join(repo, 'pkg'));
	fs.writeFileSync(path.join(repo, 'pkg', 'x_test.go'), 'package pkg\n');
	fs.writeFileSync(path.join(repo, 'tests', 'c.test.mjs'), "import './a.test.mjs';\n");
	for (const c of ['npx --yes vitest run', 'npm --prefix . test', 'npm run-script test', '(node --test)', 'bash -c "npm test"', 'node scripts/test-run.mjs --pick', 'node --test tests/c.test.mjs']) assert.equal(at(c), 'deny', c);
	assert.equal(run('Monitor', { command: 'node --test' }, { cwd: repo }, { CI: '' }).permissionDecision, 'deny', 'a run from the Monitor tool');
	for (const c of ['cd tests && node --test b.test.mjs', 'go test ./pkg/', 'go test ./pkg']) assert.equal(at(c), 'allow', c);
	// The repo's own config names no program the check runs.
	const mark = path.join(repo, 'fsmonitor-ran');
	fs.writeFileSync(path.join(repo, 'fsm.cjs'), `require('fs').writeFileSync(${JSON.stringify(mark)}, 'x');\n`);
	g('config', 'core.fsmonitor', `node "${path.join(repo, 'fsm.cjs').split(path.sep).join('/')}"`);
	at('node --test tests/b.test.mjs');
	assert.equal(fs.existsSync(mark), false, 'fsmonitor ran from the check');
	g('config', '--unset', 'core.fsmonitor');
	// CI runs everything; a throwaway clone on a tag (no branch) reproduces a bug with an unchanged test; a detached
	// feature commit is read like its branch.
	assert.equal(at('node --test', { CI: 'true' }), 'allow');
	g('add', '.'); g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'b'); g('switch', '-q', '--detach');
	assert.equal(at('node --test tests/a.test.mjs'), 'deny', 'detached, not on a tag');
	g('tag', 'v1.0.0');
	assert.equal(at('node --test tests/a.test.mjs'), 'allow');
});

// why: guards the owner's rule "never just item codes to pick from" (E18, build 20). The 60-second overview scored 0 of
// 4 as rule text in 1.19.0, so the choice pop-up itself is checked: codes need plain words, and a plan asked for opens
// with its overview.
test('a choice pop-up that offers item codes with no plain words, or a plan with no overview, goes back to Claude', () => {
	const run = setup({ userHooks: true });
	const dir = kitTemp.makeTemp('ground-');
	fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
	fs.writeFileSync(path.join(dir, 'docs', 'plans', 'bare.md'), '# Build plan\n\n## 1. Proof\n\nRows.\n');
	fs.writeFileSync(path.join(dir, 'docs', 'plans', 'grounded.md'), '# Build plan\n\n## Overview\n\nWhat: the guards.\nFound: six false holds.\nDecided: the scope.\n\n## 1. Proof\n');
	const ask = (question, options) => run('AskUserQuestion', { questions: [{ question, header: 'Pick', multiSelect: false, options }] }, { cwd: dir }).permissionDecision || 'allow';
	const opt = (label, description) => ({ label, description });
	// This build's own scope pop-up passes; the shape the owner asked to end is held.
	assert.equal(ask('Build 20 scope: which slice do I build? All figures are estimates in plan quota, and CI runs on your PC runner at $0.', [
		opt('Guards + checks (Recommended)', 'K150 local test runs limited to the changed test, about $6 and every project.'), opt('Everything', 'Adds TC1 done-needs-proof, a check that a row is marked done only with its proof.')]), 'allow');
	for (const [q, o] of [['Working on M1, M2, M3: which?', [opt('Do M1', 'First one.'), opt('Do M2', 'Second one.')]],
		['Which slice do I build next, given the measured cost of each one below?', [opt('K150 + K151', 'The guard and the meter, about $11 of quota together.'), opt('Neither', 'Build nothing now and wait for the next build.')]],
		['Approve docs/plans/bare.md as written, with every step it names?', [opt('Yes, as written', 'Build it on the branch.'), opt('No', 'Change it first.')]]]) assert.equal(ask(q, o), 'deny', q);
	assert.equal(ask('Approve docs/plans/grounded.md as written, with every step it names?', [opt('Yes, as written', 'Build it on the branch.'), opt('No', 'Change it first.')]), 'allow');
	// The commit security review: a plan path outside the project (a share, another drive, a climb out) is never read.
	const outside = path.join(kitTemp.makeTemp('ground-out-'), 'plans');
	fs.mkdirSync(outside);
	fs.writeFileSync(path.join(outside, 'bare.md'), '# Plan\n');
	for (const p of [path.join(outside, 'bare.md'), `../${path.basename(path.dirname(outside))}/plans/bare.md`, '\\\\host\\share\\plans\\bare.md']) assert.equal(ask(`Approve ${p} as written, with every step it names?`, [opt('Yes, as written', 'Build it on the branch.'), opt('No', 'Change it first.')]), 'allow', p);
	assert.match(run('AskUserQuestion', { questions: [{ question: 'Working on M1, M2, M3: which?', options: [opt('Do M1', 'x')] }] }, { cwd: dir }).permissionDecisionReason, /^Held: this pop-up [^\n]*"M1"[^\n]*60-second overview/);
	// The build 20 sweep: a model, chip or hash name is no item code, and a plan's fix is named in the plan file.
	assert.equal(ask('Which model runs the check?', [opt('GPT4o', 'The hosted model.'), opt('H100', 'The rented chip.')]), 'allow');
	assert.equal(ask('Keep the SHA256 check?', [opt('Yes', 'Keep it.'), opt('No', 'Drop it.')]), 'allow');
	assert.match(run('AskUserQuestion', { questions: [{ question: 'Approve docs/plans/bare.md as written, with every step it names?', options: [opt('Yes, as written', 'Build it on the branch.'), opt('No', 'Change it first.')] }] }, { cwd: dir }).permissionDecisionReason, /at the top of the plan file/);
	// A link inside the project that points out of it is not opened.
	const linked = path.join(dir, 'docs', 'plans', 'linked.md');
	let linkMade = true;
	try { fs.symlinkSync(path.join(outside, 'bare.md'), linked, 'file'); } catch { linkMade = false; }
	if (linkMade) assert.equal(ask('Approve docs/plans/linked.md as written, with every step it names?', [opt('Yes, as written', 'Build it on the branch.'), opt('No', 'Change it first.')]), 'allow', 'a link out of the project');
});
