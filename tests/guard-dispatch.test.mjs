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
		for (const f of ['call-cap.cjs', 'canary.cjs', 'sweep-guard.cjs']) fs.copyFileSync(path.resolve('user/kit-hooks', f), path.join(cfg, 'kit-hooks', f));
	}
	// Recorded as install user records them: since B23 a kit hook runs only with the bytes its stamp names.
	if (oldHook || userHooks) {
		const files = {};
		for (const f of fs.readdirSync(path.join(cfg, 'kit-hooks'))) files[`kit-hooks/${f}`] = require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(cfg, 'kit-hooks', f))).digest('hex');
		fs.writeFileSync(path.join(cfg, 'kit-install.json'), JSON.stringify({ files }));
	}
	return (tool_name, tool_input, extra = {}) => {
		const r = spawnSync(process.execPath, [path.join(dir, 'guard.cjs')], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name, tool_input, cwd: dir, ...extra }), encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cfg, KIT_CLAUDE_HOME: cfg } });
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
test('a missing or broken project guard holds every call it would read, with the fix', () => {
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
	const started = Date.now();
	run('Bash', { command: 'a;'.repeat(49000) });
	const took = Date.now() - started;
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
	assert.ok(took < 8000, `${took} ms${each ? `; ${each}` : ''}${hot ? `; owner-proof hot: ${hot}` : ''}`);
});
