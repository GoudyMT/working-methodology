// The reviewer hook's dollar reserve (K357): a reviewer is stopped when its spend plus the reserve reaches the
// ceiling. The reserve is twice the dearest call so far plus room for the report, so one dear call no longer
// stops a role that has most of its ceiling left. Prices are list prices of sonnet-5-5: $10 per million output tokens.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { createRequire } from 'node:module';
import { runHook, gitTree } from './kit-helpers.mjs';

const { dollars, reportDollars } = createRequire(import.meta.url)('../user/kit-hooks/prices.cjs');

kitTemp.sessionRoot();

// Output tokens of each call at sonnet-5-5: 4,500 is $0.045, 500 is $0.005, 14,000 is $0.14.
const CHEAP = [4500, 4500, 4500, 500];
const DEAR = 14000;
const brief = (ceilingLine) => ['Sweep: 0123456789abcdef role 1', 'Call cap: 40. A call is one message.', ceilingLine, '', 'Role: reviewer', 'Question: Is it right?', ''].join('\n');

// A reviewer transcript: the brief, then one assistant message per call, each { output, model }.
function verdict(ceilingLine, calls, cwd) {
	const dir = kitTemp.makeTemp('reserve-');
	const session = path.join(dir, 'session-1');
	fs.mkdirSync(path.join(session, 'subagents'), { recursive: true });
	const lines = [{ message: { role: 'user', content: brief(ceilingLine) } }];
	calls.forEach((c, i) => {
		const { output, model, reread = 0, input = 0, create = 0 } = typeof c === 'number' ? { output: c, model: 'claude-sonnet-5-5' } : c;
		lines.push({ message: { role: 'assistant', id: `m${i}`, model, usage: { input_tokens: input, cache_read_input_tokens: reread, cache_creation_input_tokens: create, output_tokens: output } } });
	});
	fs.writeFileSync(path.join(session, 'subagents', 'agent-r1.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
	const r = runHook('user/kit-hooks/call-cap.cjs', { hook_event_name: 'PreToolUse', transcript_path: `${session}.jsonl`, agent_id: 'r1', agent_type: 'reviewer', ...(cwd ? { cwd } : {}), tool_name: 'Read', tool_input: { file_path: 'x', limit: 5 } });
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
	// The exact edge, from the price table in the hook's order: spend, then twice the dearest call plus the report.
	const spends = [...CHEAP, DEAR].map((o) => dollars({ output_tokens: o }, 'claude-sonnet-5-5'));
	const edge = spends.reduce((t, x) => t + x, 0) + (2 * Math.max(...spends) + reportDollars('claude-sonnet-5-5'));
	const at = verdict(`Dollar ceiling: $${edge}`, [...CHEAP, DEAR]);
	assert.equal(at.permissionDecision, 'deny', 'a ceiling equal to spend plus reserve');
	const above = verdict(`Dollar ceiling: $${edge + 1e-9}`, [...CHEAP, DEAR]);
	assert.equal(above.permissionDecision, 'allow', above.permissionDecisionReason);
	const room = verdict('Dollar ceiling: $0.62', [...CHEAP, DEAR]);
	assert.equal(room.permissionDecision, 'allow', room.permissionDecisionReason);
	// M8: the reserve also holds the report call's input: the last call's context (here 2,000,000 cache-read tokens)
	// re-read at its model's cache-read price. The edge moves up by that amount, pinned both sides.
	const REREAD = 2000000;
	const calls = [...CHEAP, { output: DEAR, model: 'claude-sonnet-5-5', reread: REREAD }];
	const spend2 = [...CHEAP.map((o) => dollars({ output_tokens: o }, 'claude-sonnet-5-5')), dollars({ output_tokens: DEAR, cache_read_input_tokens: REREAD }, 'claude-sonnet-5-5')];
	const reread = dollars({ cache_read_input_tokens: REREAD }, 'claude-sonnet-5-5');
	const edge2 = spend2.reduce((t, x) => t + x, 0) + (2 * Math.max(...spend2) + reportDollars('claude-sonnet-5-5') + reread);
	const atReread = verdict(`Dollar ceiling: $${edge2}`, calls);
	assert.equal(atReread.permissionDecision, 'deny', 'a ceiling equal to spend plus reserve with the report call input');
	const justBelow = verdict(`Dollar ceiling: $${edge2 - 1e-9}`, calls);
	assert.equal(justBelow.permissionDecision, 'deny', 'just below the new edge');
	const aboveReread = verdict(`Dollar ceiling: $${edge2 + 1e-9}`, calls);
	assert.equal(aboveReread.permissionDecision, 'allow', aboveReread.permissionDecisionReason);
	// M8, second case: the dearest call is an earlier one (with a big context of its own), the last call is small, on a
	// model with another cache-read price, and has all three input kinds. The report call re-reads the LAST call's whole
	// context (input + cache read + cache creation) at the LAST call's model's cache-read price.
	const first = { output: DEAR, model: 'claude-sonnet-5-5', reread: 1000000 };
	const tail = { output: 500, model: 'claude-opus-5', input: 1000, reread: 3000, create: 2000 };
	const calls2 = [first, ...CHEAP.slice(0, 3), tail];
	const spend3 = calls2.map((c) => dollars({ output_tokens: c.output, input_tokens: c.input, cache_read_input_tokens: c.reread, cache_creation_input_tokens: c.create }, c.model));
	const context = tail.input + tail.reread + tail.create;
	const reread3 = dollars({ cache_read_input_tokens: context }, tail.model);
	const edge3 = spend3.reduce((t, x) => t + x, 0) + (2 * Math.max(...spend3) + reportDollars(tail.model) + reread3);
	assert.equal(Math.max(...spend3), spend3[0], 'the dearest call is the first one');
	assert.equal(verdict(`Dollar ceiling: $${edge3}`, calls2).permissionDecision, 'deny', 'at the edge with the last call re-read at its own price');
	assert.equal(verdict(`Dollar ceiling: $${edge3 - 1e-9}`, calls2).permissionDecision, 'deny', 'just below the edge');
	const above3 = verdict(`Dollar ceiling: $${edge3 + 1e-9}`, calls2);
	assert.equal(above3.permissionDecision, 'allow', above3.permissionDecisionReason);
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
	const repo = gitTree();
	const logRows = () => {
		const f = path.join(repo, '.git', 'kit-guard-open.log');
		return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
	};
	const stopped = verdict('Dollar ceiling: $1.30', unknown, repo);
	assert.equal(stopped.permissionDecision, 'deny', 'priced at the dearest model');
	assert.match(stopped.permissionDecisionReason, /Dollar ceiling reached \(\$0\.49 of \$1\.30\)/);
	// Logged: one row in the git folder's log, naming the model and the pricing.
	const rows = logRows();
	assert.equal(rows.length, 1, 'one row for the unknown model');
	assert.match(rows[0].cause, /claude-mystery-9/);
	assert.match(rows[0].cause, /priced at the dearest/);
	const room = verdict('Dollar ceiling: $1.34', unknown, repo);
	assert.equal(room.permissionDecision, 'allow', room.permissionDecisionReason);
	// The same calls on a known model reserve less and log nothing more.
	const known = verdict('Dollar ceiling: $1.30', [...CHEAP, DEAR], repo);
	assert.equal(known.permissionDecision, 'allow', known.permissionDecisionReason);
	assert.equal(logRows().length, rows.length + 1, 'only the unknown-model run added a row');
});
