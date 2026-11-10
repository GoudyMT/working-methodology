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
function setup({ drop = null, userHooks = false } = {}) {
	const dir = kitTemp.makeTemp('dispatch-');
	for (const f of GUARDS) if (f !== drop) fs.copyFileSync(path.join(SRC, f), path.join(dir, f));
	const cfg = kitTemp.makeTemp('cfg-');
	if (userHooks) {
		fs.mkdirSync(path.join(cfg, 'kit-hooks'));
		for (const f of ['call-cap.cjs', 'canary.cjs', 'sweep-guard.cjs']) fs.copyFileSync(path.resolve('user/kit-hooks', f), path.join(cfg, 'kit-hooks', f));
	}
	return (tool_name, tool_input, extra = {}) => {
		const r = spawnSync(process.execPath, [path.join(dir, 'guard.cjs')], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name, tool_input, cwd: dir, ...extra }), encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cfg, KIT_CLAUDE_HOME: cfg } });
		assert.equal(r.status, 0, r.stderr);
		return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : {};
	};
}

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

test('the strictest answer wins and every reason and note is kept', () => {
	const { merge } = require(path.join(SRC, 'guard.cjs'));
	const o = (permissionDecision, permissionDecisionReason, additionalContext) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason, additionalContext } });
	const m = merge([['a', o('allow', 'owner yes', 'note a')], ['b', o('deny', 'held', undefined)], ['c', null], ['d', o('deny', 'held too', 'note d')]]).hookSpecificOutput;
	assert.equal(m.permissionDecision, 'deny');
	assert.equal(m.permissionDecisionReason, 'held | held too');
	assert.equal(m.additionalContext, 'note a note d');
	assert.equal(merge([['a', null]]), null);
	assert.equal(merge([['a', o('allow', 'owner yes')], ['b', null]]).hookSpecificOutput.permissionDecision, 'allow');
});

// The teardown (T2): a 98 KB command took 21 s in owner-proof and 7 s in the delete guard, past the hook's 10 s
// timeout, because each command re-read the whole text. Read once, the whole guard process stays well inside it.
test('a long command is read in time: the whole guard process answers a 98 KB command inside the hook timeout', () => {
	const run = setup();
	const started = Date.now();
	run('Bash', { command: 'a;'.repeat(49000) });
	assert.ok(Date.now() - started < 8000, `${Date.now() - started} ms`);
});
