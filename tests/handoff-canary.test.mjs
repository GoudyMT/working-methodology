// The canary's shape check on a reviewer's hand-back (T6, build 11). A reviewer's findings may come as a RECORD: block
// (the K300 record, one JSON object per line) instead of pipe rows, so the canary must read that block as the report.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import { FAKE_PHRASE, canary, canaryRepo } from './kit-helpers.mjs';

const ROLE = '{"role":"reviewer","commit":"abc1234"}';
const FINDING = '{"id":"R1","severity":"medium","status":"CONFIRMED","where":"src/x.ts:4","claim":"a claim","proof":"the run","fix":"-"}';
const NOTE_CHECKED = '{"notChecked":"the scan of tests"}';
// The desktop app's hand-back: the canary sees the message on the tool call, before it reaches the transcript.
const handBack = (dir, agent, message) => canary({ cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', agent_type: 'reviewer', agent_id: agent, tool_input: { message } });
const refusal = (r) => (r.stdout || '').trim() ? JSON.parse(r.stdout).hookSpecificOutput : null;

// why: catches a RECORD block with finding lines refused for having no pipe rows, which blocks every JSON hand-back.
test('the canary reads a RECORD block with finding lines as the report, with no finding-shape fault', () => {
	const dir = canaryRepo();
	const message = [`${FAKE_PHRASE}`, 'Prose the reviewer wrote.', 'RECORD:', ROLE, FINDING];
	const r = handBack(dir, 'rec1', message.join('\n'));
	const out = refusal(r);
	if (out) assert.doesNotMatch(out.permissionDecisionReason, /one line per finding/, out.permissionDecisionReason);
});

// why: catches a clean RECORD block with only a role line and a notChecked line refused as an out-of-shape report.
test('a RECORD block with only a role line and a notChecked line is a clean report and is not refused', () => {
	const dir = canaryRepo();
	const message = [`${FAKE_PHRASE}`, 'Prose the reviewer wrote.', 'RECORD:', ROLE, NOTE_CHECKED];
	const r = handBack(dir, 'rec2', message.join('\n'));
	assert.equal(refusal(r), null, r.stdout);
});

// why: catches a hand-back with no pipe rows, no No findings line and no RECORD block passing the shape check unfaulted.
test('a hand-back with neither pipe rows, No findings nor a RECORD block still gets the finding-shape fault', () => {
	const dir = canaryRepo();
	const message = [`${FAKE_PHRASE}`, 'I looked and I have some thoughts about the tests.'];
	const out = refusal(handBack(dir, 'ctl1', message.join('\n')));
	assert.ok(out, 'expected a refusal');
	assert.equal(out.permissionDecision, 'deny');
	assert.match(out.permissionDecisionReason, /one line per finding/, out.permissionDecisionReason);
});
