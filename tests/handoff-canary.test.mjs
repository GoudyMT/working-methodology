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

// why: catches a RECORD block with finding lines refused for having no pipe rows, which blocks every JSON hand-back; also canary.cjs growing past its 14000 byte cap.
test('the canary reads a RECORD block with finding lines as the report, with no finding-shape fault', () => {
	const dir = canaryRepo();
	const message = [`${FAKE_PHRASE}`, 'Prose the reviewer wrote.', 'RECORD:', ROLE, FINDING];
	const r = handBack(dir, 'rec1', message.join('\n'));
	// Unconditional: no refusal at all, or a refusal whose reason is not the finding-shape fault, passes.
	const out = refusal(r);
	const reason = out ? out.permissionDecisionReason : '';
	assert.doesNotMatch(reason, /one line per finding/, reason);
	// Folded control: a hand-back with neither pipe rows, No findings nor a RECORD block still gets the finding-shape fault.
	const neither = refusal(handBack(dir, 'ctl1', [`${FAKE_PHRASE}`, 'I looked and I have some thoughts about the tests.'].join('\n')));
	assert.ok(neither, 'expected a refusal');
	assert.equal(neither.permissionDecision, 'deny');
	assert.match(neither.permissionDecisionReason, /one line per finding/, neither.permissionDecisionReason);
	// Folded from "user/kit-hooks/canary.cjs is under 14000 bytes": the canary stays under its size cap.
	assert.ok(fs.statSync('user/kit-hooks/canary.cjs').size < 14000, `canary.cjs is ${fs.statSync('user/kit-hooks/canary.cjs').size} bytes`);
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

// A copy of the kit's hooks and tools with holds.json set so handoff-gate reads enforce; canary.cjs loads that list beside itself.
function enforceHome() {
	const home = makeTemp('canary-enforce-');
	fs.cpSync('user/kit-hooks', path.join(home, 'kit-hooks'), { recursive: true });
	fs.cpSync('user/kit-tools', path.join(home, 'kit-tools'), { recursive: true });
	fs.writeFileSync(path.join(home, 'kit-hooks', 'holds.json'), JSON.stringify({ holds: [{ id: 'agent-model', hook: 'agent-model.cjs', mode: 'log' }, { id: 'handoff-gate', hook: 'handoff-gate.cjs', mode: 'enforce' }] }));
	return home;
}
// The canary run from the enforce copy, as a reviewer's hand-back call.
const handBackEnforced = (home, dir, agent, message) => runHook(path.join(home, 'kit-hooks', 'canary.cjs'), { cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', agent_type: 'reviewer', agent_id: agent, tool_input: { message } }, { HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: home, KIT_CLAUDE_HOME: home });
// The stdout of one hook run as a single JSON object, or null when it is not one.
function oneObject(stdout) {
	try {
		const v = JSON.parse(stdout);
		return v && typeof v === 'object' ? v : null;
	} catch {
		return null;
	}
}

// why: catches a hand-back with no phrase and a broken RECORD block refused twice under enforce, so stdout holds two JSON objects and no reader parses it
test('under enforce, a hand-back with no phrase and a broken RECORD block gets one deny naming both reasons', () => {
	const home = enforceHome();
	const dir = canaryRepo();
	const r = handBackEnforced(home, dir, 'enf1', 'RECORD:\nnot json');
	const out = oneObject(r.stdout);
	assert.ok(out, `stdout is one JSON object: ${r.stdout}`);
	assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
	const reason = out.hookSpecificOutput.permissionDecisionReason;
	assert.match(reason, /RECORD: block is broken/, reason);
	assert.match(reason, /rule:agent-canary/, reason);
	// Folded control: a valid hand-back with the phrase gives no deny under the same enforce hold.
	const valid = [`${FAKE_PHRASE}`, 'Prose the reviewer wrote.', 'ROLE: reviewer', 'Not checked: nothing', 'RECORD:', ROLE, NOTE_CHECKED].join('\n');
	const ok = handBackEnforced(home, dir, 'enf2', valid);
	assert.equal(ok.stdout.trim(), '', `a valid hand-back is not refused: ${ok.stdout}`);
});

// why: catches a numeric agent_id that makes canary's own run() throw and drops the hand-back gate's deny, so a broken record is not refused
test('under enforce, a numeric agent_id that makes canary throw still prints the gate deny as one JSON object', () => {
	const home = enforceHome();
	const dir = canaryRepo();
	const r = handBackEnforced(home, dir, 7, 'RECORD:\nnot json');
	const out = oneObject(r.stdout);
	assert.ok(out, `stdout is one JSON object: ${r.stdout}`);
	assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
	assert.match(out.hookSpecificOutput.permissionDecisionReason, /RECORD: block is broken/, out.hookSpecificOutput.permissionDecisionReason);
	// Folded control: a valid hand-back with a numeric agent_id is still not refused.
	const valid = [`${FAKE_PHRASE}`, 'Prose the reviewer wrote.', 'ROLE: reviewer', 'Not checked: nothing', 'RECORD:', ROLE, NOTE_CHECKED].join('\n');
	assert.equal(handBackEnforced(home, dir, 8, valid).stdout.trim(), '', 'a valid hand-back with a numeric agent_id is not refused');
});
