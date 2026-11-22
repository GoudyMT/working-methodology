// The canary's shape check on a reviewer's hand-back (T6, build 11). A reviewer's findings may come as a RECORD: block
// (the K300 record, one JSON object per line) instead of pipe rows, so the canary must read that block as the report.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FAKE_PHRASE, canary, canaryRepo, makeTemp, runHook } from './kit-helpers.mjs';

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
	// Folded control: a hand-back with neither pipe rows, No findings nor a RECORD block still gets the finding-shape fault.
	const neither = refusal(handBack(dir, 'ctl1', [`${FAKE_PHRASE}`, 'I looked and I have some thoughts about the tests.'].join('\n')));
	assert.ok(neither, 'expected a refusal');
	assert.equal(neither.permissionDecision, 'deny');
	assert.match(neither.permissionDecisionReason, /one line per finding/, neither.permissionDecisionReason);
});

// why: catches a clean RECORD block with only a role line and a notChecked line refused as an out-of-shape report.
test('a RECORD block with only a role line and a notChecked line is a clean report and is not refused', () => {
	const dir = canaryRepo();
	const message = [`${FAKE_PHRASE}`, 'Prose the reviewer wrote.', 'RECORD:', ROLE, NOTE_CHECKED];
	const r = handBack(dir, 'rec2', message.join('\n'));
	assert.equal(refusal(r), null, r.stdout);
});

// A temp home with a copy of the kit's hooks and a kit-tools/handoff.mjs that throws on load (C1).
function brokenHome() {
	const home = makeTemp('canary-home-');
	fs.cpSync('user/kit-hooks', path.join(home, 'kit-hooks'), { recursive: true });
	fs.mkdirSync(path.join(home, 'kit-tools'), { recursive: true });
	fs.writeFileSync(path.join(home, 'kit-tools', 'handoff.mjs'), 'export const = ;\n');
	return home;
}
// The canary run from the temp home, with HOME and the Claude folders pointed at that home.
const handBackFrom = (home, dir, agent, message) => runHook(path.join(home, 'kit-hooks', 'canary.cjs'), { cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', agent_type: 'reviewer', agent_id: agent, tool_input: { message } }, { HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: home, KIT_CLAUDE_HOME: home });

// why: catches a valid RECORD hand-back refused when the handoff checker fails to load.
test('with a handoff checker that throws on load, a ROLE and Not checked hand-back with a valid RECORD block is not refused', () => {
	const home = brokenHome();
	const dir = canaryRepo();
	const message = [`${FAKE_PHRASE}`, 'ROLE: reviewer', 'Not checked: nothing', 'RECORD:', ROLE, NOTE_CHECKED];
	const r = handBackFrom(home, dir, 'c1', message.join('\n'));
	assert.equal(refusal(r), null, r.stdout);
});

// why: guards rule:size-budgets (canary.cjs grows to 14000 bytes or more)
test('user/kit-hooks/canary.cjs is under 14000 bytes', () => {
	assert.ok(fs.statSync('user/kit-hooks/canary.cjs').size < 14000, `canary.cjs is ${fs.statSync('user/kit-hooks/canary.cjs').size} bytes`);
});
