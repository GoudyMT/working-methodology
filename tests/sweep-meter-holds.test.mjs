// The sweep meter (build 22): the price table, the ceiling lines in a reviewer's brief and the split slices. Each case
// is a way a reviewer ran unmetered, unstartable or unread. prices.cjs and the dollar ceilings are new on this branch,
// so a test that needs them asserts they are there before it uses them.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { FIX_EXIT, approvalLog, approveIn, approveRun, askContract, commitAll, featureContract, g, ownerTaps, read, runHook, sweepGuard, sweepRepo, tapEnv } from './kit-helpers.mjs';

kitTemp.sessionRoot();
const require = createRequire(import.meta.url);

// why: catches an unknown model metered cheaper than a known one, so a dollar ceiling lets its run go on
test('an unknown model id is priced at least as dear as every known model, in every usage kind', () => {
	let prices;
	assert.doesNotThrow(() => { prices = require('../user/kit-hooks/prices.cjs'); }, 'user/kit-hooks/prices.cjs loads');
	const KINDS = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'];
	for (const kind of KINDS) {
		const unknown = prices.dollars({ [kind]: 1e6 }, 'claude-mystery-9');
		for (const key of Object.keys(prices.PRICE)) {
			const known = prices.dollars({ [kind]: 1e6 }, key);
			assert.ok(unknown >= known, `${kind}: an unknown model costs ${unknown} per million, ${key} costs ${known}`);
		}
	}
	const empty = prices.dollars({ cache_creation_input_tokens: 1e6 }, '');
	assert.equal(empty, prices.dollars({ cache_creation_input_tokens: 1e6 }, 'claude-mystery-9'), 'no model at all is unknown too');
});

// A brief as approve.mjs writes it: the ceiling is a line of its own, and the role's question follows on one line.
const briefOf = (hash, calls, ceilingLines, question) => ['Project rules: read the rules block.', '', `Sweep: ${hash} role 1`, `Call cap: ${calls}. A call is one message.`, ...ceilingLines, '', 'Role: security reviewer (security)', `Question: ${question}`, 'Change no file in the repository.', ''].join('\n');
const QUOTING = 'Does a brief that quotes "Token ceiling: 5" and "Dollar ceiling: $9.99" in its question still start?';

// why: catches a brief unstartable because its question quotes a ceiling line (the sweep guard counted every mention)
test('the sweep guard starts a brief whose question quotes a ceiling, and still refuses two real ceiling lines', () => {
	const c = featureContract();
	c.roles[0].question = QUOTING;
	const r = approveRun(c);
	assert.equal(r.status, 0, r.stdout);
	const e = approvalLog(r.dir).pop();
	const run = (lines) => sweepGuard(r.dir, { raw: true, noCeiling: true, tool_input: { subagent_type: 'reviewer', prompt: briefOf(e.hash, e.calls[0], lines, QUOTING) } });
	const two = run([`Token ceiling: ${e.ceilings[0]}`, 'Token ceiling: 99999999']);
	assert.equal(two.permissionDecision, 'deny', 'two ceiling lines');
	assert.match(two.permissionDecisionReason, /Token ceiling: <n>/);
	assert.equal(run([`Token ceiling: ${e.ceilings[0]}`, 'Dollar ceiling: $999.00']).permissionDecision, 'deny', 'a dollar line beside the token one');
	assert.equal(run([]).permissionDecision, 'deny', 'no ceiling line at all');
	const ok = run([`Token ceiling: ${e.ceilings[0]}`]);
	assert.equal(ok.permissionDecision, 'allow', ok.permissionDecisionReason);
});

// A reviewer transcript whose first message is the brief, as the call-cap hook reads it.
function capRun(content, { calls = 3 } = {}) {
	const dir = kitTemp.makeTemp('quote-');
	const session = path.join(dir, 'session-1');
	fs.mkdirSync(path.join(session, 'subagents'), { recursive: true });
	const lines = [{ message: { role: 'user', content } }];
	for (let i = 0; i < calls; i++) lines.push({ message: { role: 'assistant', id: `m${i}`, usage: { input_tokens: 0, cache_read_input_tokens: 30000, cache_creation_input_tokens: 0, output_tokens: 0 } } });
	fs.writeFileSync(path.join(session, 'subagents', 'agent-r1.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
	const r = runHook('user/kit-hooks/call-cap.cjs', { hook_event_name: 'PreToolUse', transcript_path: `${session}.jsonl`, agent_id: 'r1', agent_type: 'reviewer', tool_name: 'Read', tool_input: { file_path: 'x', limit: 5 } });
	return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : { permissionDecision: 'allow' };
}

// why: catches every call of a reviewer refused because its question quotes a ceiling (the hook counted over the brief's JSON)
test('the call-cap hook meters a brief whose question quotes a ceiling, and refuses two real ceiling lines', () => {
	const real = (...lines) => briefOf('0123456789abcdef', 40, lines, QUOTING);
	const quoted = capRun(real('Token ceiling: 200000'));
	assert.equal(quoted.permissionDecision, 'allow', quoted.permissionDecisionReason);
	const asBlocks = capRun([{ type: 'text', text: real('Token ceiling: 200000') }]);
	assert.equal(asBlocks.permissionDecision, 'allow', 'a brief sent as content blocks reads the same');
	const metered = capRun(real('Token ceiling: 100000'));
	assert.equal(metered.permissionDecision, 'deny', 'the real line is still the ceiling: 90,000 spent of 100,000');
	assert.match(metered.permissionDecisionReason, /token ceiling reached/i);
	for (const lines of [['Token ceiling: 200000', 'Token ceiling: 99999999'], ['Token ceiling: 200000', 'Dollar ceiling: $999.00']]) {
		const two = capRun(real(...lines));
		assert.equal(two.permissionDecision, 'deny', lines.join(' + '));
		assert.match(two.permissionDecisionReason, /more than one ceiling line/);
	}
});

// why: catches a fail-open log that names a Dollar ceiling when the brief may carry either kind
test('the call-cap hook names a missing ceiling of either kind when it lets a call through', () => {
	const repo = kitTemp.makeTemp('open-');
	spawnSync('git', ['init', '-q', '-b', 'main', repo]);
	fs.mkdirSync(path.join(repo, 't', 'subagents'), { recursive: true });
	fs.writeFileSync(path.join(repo, 't', 'subagents', 'agent-r8.jsonl'), `${JSON.stringify({ message: { role: 'user', content: 'Sweep: abc role 1\nCall cap: 15' } })}\n`);
	const r = runHook('user/kit-hooks/call-cap.cjs', { hook_event_name: 'PreToolUse', cwd: repo, transcript_path: path.join(repo, 't.jsonl'), agent_id: 'r8', agent_type: 'reviewer', tool_name: 'Read', tool_input: { file_path: 'x', limit: 5 } });
	assert.equal(r.stdout, '');
	assert.match(fs.readFileSync(path.join(repo, '.git', 'kit-guard-open.log'), 'utf8'), /"cause":"no ceiling \(Dollar or Token\) line in the brief"/);
});
