// The canary's shape check on a reviewer's hand-back (T6, build 11). A reviewer's findings may come as a RECORD: block
// (the K300 record, one JSON object per line) instead of pipe rows, so the canary must read that block as the report.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { FAKE_PHRASE, canary, canaryRepo, commitAll, g, makeTemp, runHook } from './kit-helpers.mjs';

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

// why: catches M7 a tester hand-back naming a commit that does not resolve passing the enforce gate with its tests unchecked
test('M7: under enforce, a tester hand-back naming a commit that does not resolve is refused', () => {
	const home = enforceHome();
	const dir = canaryRepo();
	const BAD = '0123456789abcdef0123456789abcdef01234567';
	const listed = [{ name: 'x', why: '// why: catches a listed test whose commit cannot be read' }];
	const role = (commit, tests) => JSON.stringify({ role: 'tester', commit, clarity: 'clear', ...(tests ? { tests } : {}) });
	const message = (commit, tests) => [`${FAKE_PHRASE}`, 'Prose the tester wrote.', 'ROLE: tester', 'Not checked: nothing', 'RECORD:', role(commit, tests), NOTE_CHECKED].join('\n');
	const bad = oneObject(handBackEnforced(home, dir, 'm7a', message(BAD, listed)).stdout);
	assert.ok(bad, 'a commit that resolves to nothing is refused');
	assert.equal(bad.hookSpecificOutput.permissionDecision, 'deny');
	assert.ok(bad.hookSpecificOutput.permissionDecisionReason.includes(BAD), `the reason names the commit: ${bad.hookSpecificOutput.permissionDecisionReason}`);
	// control: the same unresolvable commit with no tests list is not refused
	assert.equal(handBackEnforced(home, dir, 'm7c', message(BAD)).stdout.trim(), '', 'no tests listed: the commit is not checked');
	// control: the repo's own head resolves, so the same record is not refused
	const head = spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
	assert.equal(handBackEnforced(home, dir, 'm7b', message(head, listed)).stdout.trim(), '', 'a resolving commit is not refused');
	// a commit that deletes a test file and adds one test with a proper why, listed in the RECORD, is not refused
	const del = canaryRepo();
	fs.mkdirSync(path.join(del, 'tests'));
	fs.writeFileSync(path.join(del, 'tests', 'old.test.mjs'), "// why: catches an old test that the repo had before the delete\ntest('old', () => {});\n");
	commitAll(del, 'test: first');
	fs.rmSync(path.join(del, 'tests', 'old.test.mjs'));
	fs.writeFileSync(path.join(del, 'tests', 'new.test.mjs'), "// why: catches a new test added in the same commit as a delete\ntest('fresh one', () => {});\n");
	commitAll(del, 'test: delete one file and add another');
	const delSha = g(del, 'rev-parse', 'HEAD').stdout.trim();
	const freshTests = [{ name: 'fresh one', why: '// why: catches a new test added in the same commit as a delete' }];
	assert.equal(handBackEnforced(home, del, 'm7d', message(delSha, freshTests)).stdout.trim(), '', 'a deleted test file is not an unreadable commit');
	// a show that really fails (a test path that is a submodule entry, not a blob) is refused as unreadable
	const sub = canaryRepo();
	commitAll(sub, 'test: first');
	g(sub, 'update-index', '--add', '--cacheinfo', '160000,1234567890abcdef1234567890abcdef12345678,tests/sub.test.mjs');
	g(sub, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'test: add a submodule entry');
	const subSha = g(sub, 'rev-parse', 'HEAD').stdout.trim();
	const unread = oneObject(handBackEnforced(home, sub, 'm7e', message(subSha, listed)).stdout);
	assert.ok(unread, 'a commit whose test path cannot be shown is refused');
	assert.equal(unread.hookSpecificOutput.permissionDecision, 'deny');
});
