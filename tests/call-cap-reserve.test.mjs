// The reviewer hook's dollar reserve (K357): a reviewer is stopped when its spend plus the reserve reaches the
// ceiling. The reserve is twice the dearest call so far plus room for the report, so one dear call no longer
// stops a role that has most of its ceiling left. Prices are list prices of sonnet-5-5: $10 per million output tokens.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { runHook } from './kit-helpers.mjs';

kitTemp.sessionRoot();

// Output tokens of each call at sonnet-5-5: 4,500 is $0.045, 500 is $0.005, 14,000 is $0.14.
const CHEAP = [4500, 4500, 4500, 500];
const DEAR = 14000;
const brief = (ceilingLine) => ['Sweep: 0123456789abcdef role 1', 'Call cap: 40. A call is one message.', ceilingLine, '', 'Role: reviewer', 'Question: Is it right?', ''].join('\n');

// A reviewer transcript: the brief, then one assistant message per call, each { output, model }.
function verdict(ceilingLine, calls) {
	const dir = kitTemp.makeTemp('reserve-');
	const session = path.join(dir, 'session-1');
	fs.mkdirSync(path.join(session, 'subagents'), { recursive: true });
	const lines = [{ message: { role: 'user', content: brief(ceilingLine) } }];
	calls.forEach((c, i) => {
		const { output, model } = typeof c === 'number' ? { output: c, model: 'claude-sonnet-5-5' } : c;
		lines.push({ message: { role: 'assistant', id: `m${i}`, model, usage: { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: output } } });
	});
	fs.writeFileSync(path.join(session, 'subagents', 'agent-r1.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
	const r = runHook('user/kit-hooks/call-cap.cjs', { hook_event_name: 'PreToolUse', transcript_path: `${session}.jsonl`, agent_id: 'r1', agent_type: 'reviewer', tool_name: 'Read', tool_input: { file_path: 'x', limit: 5 } });
	assert.equal(r.status, 0, r.stderr);
	return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : { permissionDecision: 'allow' };
}

// why: catches ceiling $1.44, four cheap calls then one $0.14 call: the next tool is allowed, not refused with "Dollar ceiling reached ($0.28 of $1.44)" (K357 S1)
test('ceiling $1.44, four cheap calls then one $0.14 call: the next tool is allowed, not refused with "Dollar ceiling reached ($0.28 of $1.44)"', () => {
	const v = verdict('Dollar ceiling: $1.44', [...CHEAP, DEAR]);
	assert.equal(v.permissionDecision, 'allow', v.permissionDecisionReason);
});

// why: catches a reviewer whose spend plus twice its dearest call plus the report reaches the ceiling is still stopped (K357 S2)
test('a reviewer whose spend plus twice its dearest call plus the report reaches the ceiling is still stopped', () => {
	// spend $0.28 + 2 x $0.14 + report $0.05 = $0.61
	const stopped = verdict('Dollar ceiling: $0.60', [...CHEAP, DEAR]);
	assert.equal(stopped.permissionDecision, 'deny', 'spend and reserve over the ceiling');
	assert.match(stopped.permissionDecisionReason, /Dollar ceiling reached \(\$0\.28 of \$0\.60\)/);
	const room = verdict('Dollar ceiling: $0.62', [...CHEAP, DEAR]);
	assert.equal(room.permissionDecision, 'allow', room.permissionDecisionReason);
});

// why: catches the dear call placed first, in the middle or last gives the same verdict, since the reserve reads the dearest call (K357 S1)
test('the dear call placed first, in the middle or last gives the same verdict, since the reserve reads the dearest call', () => {
	const orders = { first: [DEAR, ...CHEAP], middle: [...CHEAP.slice(0, 2), DEAR, ...CHEAP.slice(2)], last: [...CHEAP, DEAR] };
	for (const [where, calls] of Object.entries(orders)) {
		const room = verdict('Dollar ceiling: $1.44', calls);
		assert.equal(room.permissionDecision, 'allow', `${where}: ${room.permissionDecisionReason}`);
		const tight = verdict('Dollar ceiling: $0.60', calls);
		assert.equal(tight.permissionDecision, 'deny', `${where} at a ceiling the reserve reaches`);
	}
});

// why: catches the same calls read twice give the same verdict (K357 S1)
test('the same calls read twice give the same verdict', () => {
	const calls = [...CHEAP, DEAR];
	const first = verdict('Dollar ceiling: $1.44', calls);
	const second = verdict('Dollar ceiling: $1.44', calls);
	assert.deepEqual(second, first);
	assert.equal(first.permissionDecision, 'allow', first.permissionDecisionReason);
	assert.deepEqual(verdict('Dollar ceiling: $0.60', calls), verdict('Dollar ceiling: $0.60', calls));
});

// why: catches the token ceiling path keeps its own reserve, unchanged (K357 S4)
test('the token ceiling path keeps its own reserve, unchanged', () => {
	// Token reserve: 3 x last + 6 x (last - prev) + 5,000 = 42,000 + 81,000 + 5,000 = 128,000; spend is 28,000.
	const calls = [...CHEAP, DEAR];
	const edge = verdict('Token ceiling: 156000', calls);
	assert.equal(edge.permissionDecision, 'deny', 'spend and reserve reach the ceiling');
	assert.match(edge.permissionDecisionReason, /Token ceiling reached \(28,000 of 156,000\)/);
	const over = verdict('Token ceiling: 156001', calls);
	assert.equal(over.permissionDecision, 'allow', over.permissionDecisionReason);
	// The dollar rule's reserve (28,000 + 2 x 14,000 + 5,000 = 61,000) must not leak into the token path.
	assert.equal(verdict('Token ceiling: 100000', calls).permissionDecision, 'deny', 'not the dollar reserve');
	// The same calls under a dollar ceiling take the dollar reserve.
	assert.equal(verdict('Dollar ceiling: $1.44', calls).permissionDecision, 'allow', 'the dollar path reads the dearest call');
});

// why: catches a call on an unknown model is priced at the dearest model, so the reserve only grows, logged (K357 S3)
test('a call on an unknown model is priced at the dearest model, so the reserve only grows, logged', () => {
	// The dearest model's output is $25 per million: the dear call is $0.35, spend $0.49, reserve 2 x 0.35 + 0.125 = 0.825.
	const unknown = [...CHEAP, { output: DEAR, model: 'claude-mystery-9' }];
	const stopped = verdict('Dollar ceiling: $1.30', unknown);
	assert.equal(stopped.permissionDecision, 'deny', 'priced at the dearest model');
	assert.match(stopped.permissionDecisionReason, /Dollar ceiling reached \(\$0\.49 of \$1\.30\)/);
	const room = verdict('Dollar ceiling: $1.34', unknown);
	assert.equal(room.permissionDecision, 'allow', room.permissionDecisionReason);
	// The same calls on a known model reserve less, so the ceiling the unknown model hit still has room.
	const known = verdict('Dollar ceiling: $1.30', [...CHEAP, DEAR]);
	assert.equal(known.permissionDecision, 'allow', known.permissionDecisionReason);
});
