// K374 U6: a fresh lead starts no agent before a passing state check. agent-model.cjs refuses an Agent or Task spawn when the
// repo holds a plans/<folder>/lead-state.json and this session has no pass in <git common>/kit-lead-state-ok (a JSON object
// {session, sha, at}, written by `lead-state.mjs check <plan> --session <id>` on VERDICT ok only). A compact_boundary line in the
// transcript later than the pass drops the pass and the session's phase-card marker. The real hook, the real lead-state tool
// and the real kit-gate run in child processes against a temp repo, so a missing behaviour fails an assertion, not the loader.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const HOOK_DIR = path.resolve('user/kit-hooks');
const HOLDS = path.join(HOOK_DIR, 'holds.json');
const TOOL = path.resolve('user/kit-tools/lead-state.mjs');
const PASS_FILE = 'kit-lead-state-ok';
const PLAN_TEXT = '# Plan\n\n## Units\n\n| Id | Title | Files | Tests |\n| --- | --- | --- | --- |\n| U1 | first | a.mjs | one |\n| U2 | second | b.mjs | one |\n';
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

function isolatedEnv(extra = {}) {
	const home = kitTemp.makeTemp('lead-gate-home-');
	const config = path.join(home, '.claude');
	return { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: config, KIT_CLAUDE_HOME: config, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com', ...extra };
}

function git(cwd, args) {
	const r = spawnSync('git', args, { cwd, env: isolatedEnv(), encoding: 'utf8' });
	assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
	return r.stdout.trim();
}

const CONFIG = (() => {
	const config = kitTemp.makeTemp('lead-gate-config-');
	fs.mkdirSync(path.join(config, 'agents'), { recursive: true });
	for (const [name, model] of Object.entries({ tester: 'sonnet', builder: 'haiku', checker: 'opus', 'general-purpose': 'sonnet' })) fs.writeFileSync(path.join(config, 'agents', `${name}.md`), `---\nname: ${name}\nmodel: ${model}\n---\nrole\n`);
	return config;
})();

// A kit-installed repo holding every source of the lead state record, with the record written by the real tool.
function fixture({ withRecord = true } = {}) {
	const root = kitTemp.makeTemp('lead-gate-repo-');
	git(root, ['init', '-q', '-b', 'main']);
	const dir = path.join(root, 'plans', 'p');
	fs.mkdirSync(dir, { recursive: true });
	fs.mkdirSync(path.join(root, '.kit'), { recursive: true });
	fs.writeFileSync(path.join(root, '.kit', 'kit-version.json'), '{}');
	fs.writeFileSync(path.join(root, 'VERSION'), '1.0.0\n');
	const plan = path.join(dir, 'PLAN.md');
	fs.writeFileSync(plan, PLAN_TEXT);
	fs.writeFileSync(path.join(dir, 'flow.jsonl'), jsonl([{ unit: 'U1', step: 'merged', at: '2026-01-01T01:00:00Z', by: 'lead' }]));
	fs.writeFileSync(path.join(dir, 'lead-checklist.jsonl'), jsonl([{ phase: 'check', item: 'send the wave report', done: false, proof: '' }]));
	git(root, ['add', '-A']);
	git(root, ['commit', '-q', '-m', 'init']);
	const common = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
	const fx = { root, dir, plan, flow: path.join(dir, 'flow.jsonl'), record: path.join(dir, 'lead-state.json'), common, pass: path.join(common, PASS_FILE), transcript: path.join(root, 't.jsonl'), open: path.join(common, 'kit-guard-open.log') };
	fs.writeFileSync(fx.transcript, jsonl([{ type: 'user', timestamp: new Date().toISOString(), message: { role: 'user', content: 'go' } }]));
	if (withRecord) {
		const w = spawnSync(process.execPath, [TOOL, 'write', plan], { cwd: root, encoding: 'utf8' });
		assert.equal(w.status, 0, `fixture needs lead-state.mjs write: ${w.stdout}${w.stderr}`);
	}
	return fx;
}

// The real check for a session: its pass is written on VERDICT ok only.
function check(fx, session) {
	const r = spawnSync(process.execPath, [TOOL, 'check', fx.plan, '--session', session], { cwd: fx.root, encoding: 'utf8' });
	return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}
const readPass = (fx) => JSON.parse(fs.readFileSync(fx.pass, 'utf8'));

// Runs the real agent-model.cjs once per input, in order, from the repo; one decision per input, null when it lets the call through.
function hook(fx, inputs, hookDir = HOOK_DIR) {
	const script = "const a = JSON.parse(process.env.KIT_TEST_ARGS); const m = require(path.join(a.hookDir, 'agent-model.cjs')); process.stdout.write(JSON.stringify(a.inputs.map((i) => m.check(i)) ));";
	const args = JSON.stringify({ hookDir, inputs: inputs.map((i) => ({ cwd: fx.root, transcript_path: fx.transcript, ...i })) });
	const r = spawnSync(process.execPath, ['-e', `const path = require('node:path'); ${script}`], { env: isolatedEnv({ KIT_CLAUDE_HOME: CONFIG, CLAUDE_CONFIG_DIR: CONFIG, KIT_TEST_ARGS: args }), encoding: 'utf8' });
	assert.equal(r.status, 0, `agent-model.cjs check ran: ${r.stderr}`);
	return JSON.parse(r.stdout);
}
const agent = (session, tool = 'Agent', call = { subagent_type: 'builder', prompt: 'Build the unit.' }) => ({ tool_name: tool, session_id: session, tool_input: call });
const denied = (d) => d && d.hookSpecificOutput && d.hookSpecificOutput.permissionDecision === 'deny';
const reason = (d) => (d && d.hookSpecificOutput && d.hookSpecificOutput.permissionDecisionReason) || '';
const CHECK_CMD = (session) => new RegExp(`lead-state\\.mjs"?\\s+check\\s+\\S.*--session\\s+${session}`);
const readRows = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

function prompt(fx, session) {
	const r = spawnSync(process.execPath, [path.join(HOOK_DIR, 'kit-gate.cjs')], { input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'carry on', cwd: fx.root, session_id: session }), env: isolatedEnv(), encoding: 'utf8' });
	return `${r.stdout || ''}${r.stderr || ''}`;
}
const CARD = /lead state: phase/;

// Appends a compact_boundary line to the transcript, stamped just after the session's pass.
function compact(fx) {
	const at = new Date(Date.parse(readPass(fx).at) + 1).toISOString();
	fs.appendFileSync(fx.transcript, jsonl([{ type: 'system', subtype: 'compact_boundary', timestamp: at }]));
}
const later = () => new Promise((r) => setTimeout(r, 30));

// why: catches a crash inside agent-model passing every spawn that is not a checker, so a high-tier hold fails open
test('a crash in the spawn check refuses a builder spawn with "hook error: lead review", logged', () => {
	const fx = fixture();
	assert.equal(check(fx, 's1').code, 0);
	assert.equal(hook(fx, [agent('s1')])[0], null, 'control: with a pass and a plain brief the builder spawn goes through');
	// A brief whose text cannot be read throws inside the hook's own check, outside every gate's own try.
	const script = "const path = require('node:path'); const a = JSON.parse(process.env.KIT_TEST_ARGS); const m = require(path.join(a.hookDir, 'agent-model.cjs')); const prompt = { toString() { throw new Error('brief unreadable'); } }; process.stdout.write(JSON.stringify(m.check({ tool_name: 'Agent', session_id: 's1', cwd: a.cwd, transcript_path: a.transcript, tool_input: { subagent_type: 'builder', prompt } }) || null));";
	const r = spawnSync(process.execPath, ['-e', script], { env: isolatedEnv({ KIT_CLAUDE_HOME: CONFIG, CLAUDE_CONFIG_DIR: CONFIG, KIT_TEST_ARGS: JSON.stringify({ hookDir: HOOK_DIR, cwd: fx.root, transcript: fx.transcript }) }), encoding: 'utf8' });
	assert.equal(r.status, 0, `the hook ran: ${r.stderr}`);
	const crashed = JSON.parse(r.stdout);
	assert.ok(denied(crashed), `a crash on a builder spawn blocks, got ${JSON.stringify(crashed)}`);
	assert.match(reason(crashed), /hook error: lead review/);
	assert.ok(readRows(fx.open).some((row) => row.kind === 'hook-error'), 'the crash is logged to kit-guard-open.log by hook-error.cjs');
});

// why: catches a SendMessage to a warm agent skipping the lead-state gate that every spawn must pass
test('a SendMessage is held for the lead-state check like a spawn, and goes through once this session has a pass', () => {
	const fx = fixture();
	const message = { tool_name: 'SendMessage', session_id: 's1', tool_input: { to: 'agent-1', message: 'carry on' } };
	const [held] = hook(fx, [message]);
	assert.ok(denied(held), `a SendMessage with no pass is refused, got ${JSON.stringify(held)}`);
	assert.match(reason(held), CHECK_CMD('s1'));
	assert.equal(check(fx, 's1').code, 0);
	const [open] = hook(fx, [message]);
	assert.equal(open, null, `with the pass the message goes through, got ${JSON.stringify(open)}`);
});

// why: catches an Agent spawn is refused while a record exists and this session has no passing lead-state check, printing the check command (K374 S1)
test('an Agent spawn is refused while a record exists and this session has no passing lead-state check, printing the check command', () => {
	const fx = fixture();
	const [spawn] = hook(fx, [agent('s1')]);
	assert.ok(denied(spawn), `a spawn with no pass is refused, got ${JSON.stringify(spawn)}`);
	assert.match(reason(spawn), CHECK_CMD('s1'), 'the refusal prints the check command with this session id');
	const other = check(fx, 's2');
	assert.equal(other.code, 0, `check passes for s2: ${other.out}`);
	const [mine] = hook(fx, [agent('s1')]);
	assert.ok(denied(mine), `another session's pass does not open this session, got ${JSON.stringify(mine)}`);
});

// why: catches after a passing check in this session the spawn goes through (K374 S1)
test('after a passing check in this session the spawn goes through', () => {
	const fx = fixture();
	const c = check(fx, 's1');
	assert.equal(c.code, 0, `check passes: ${c.out}`);
	assert.match(c.out, /VERDICT: ok/);
	const pass = readPass(fx);
	assert.equal(pass.session, 's1');
	assert.equal(pass.sha, JSON.parse(fs.readFileSync(fx.record, 'utf8')).sha);
	assert.ok(pass.at && !Number.isNaN(Date.parse(pass.at)), 'the pass carries its time');
	const [spawn] = hook(fx, [agent('s1')]);
	assert.equal(spawn, null, `the spawn goes through, got ${JSON.stringify(spawn)}`);
	// U6-1: a pass belongs to the record it checked; a new merge and a fresh write change the record sha, so the old pass no longer opens the spawn
	fs.appendFileSync(fx.flow, jsonl([{ unit: 'U2', step: 'merged', at: '2026-01-02T01:00:00Z', by: 'lead' }]));
	const w = spawnSync(process.execPath, [TOOL, 'write', fx.plan], { cwd: fx.root, encoding: 'utf8' });
	assert.equal(w.status, 0, `lead-state write: ${w.stdout}${w.stderr}`);
	assert.notEqual(JSON.parse(fs.readFileSync(fx.record, 'utf8')).sha, pass.sha, 'the record sha changed');
	const [rewritten] = hook(fx, [agent('s1')]);
	assert.ok(denied(rewritten), `a pass for the old record sha does not open the spawn, got ${JSON.stringify(rewritten)}`);
	assert.match(reason(rewritten), CHECK_CMD('s1'));
});

// why: catches a stale VERDICT keeps the refusal (K374 S2)
test('a stale VERDICT keeps the refusal', () => {
	const fx = fixture();
	fs.appendFileSync(fx.flow, jsonl([{ unit: 'U2', step: 'merged', at: '2026-01-02T01:00:00Z', by: 'lead' }]));
	const c = check(fx, 's1');
	assert.match(c.out, /VERDICT: stale/, `the record is stale: ${c.out}`);
	assert.notEqual(c.code, 0);
	assert.equal(fs.existsSync(fx.pass), false, 'a check that is not ok writes no pass');
	const [spawn] = hook(fx, [agent('s1')]);
	assert.ok(denied(spawn), `the refusal stays, got ${JSON.stringify(spawn)}`);
});

// why: catches with no record nothing changes (K374 S3)
test('with no record nothing changes', () => {
	const fx = fixture({ withRecord: false });
	const [agentSpawn, taskSpawn] = hook(fx, [agent('s1'), agent('s1', 'Task')]);
	assert.equal(agentSpawn, null, `no record, no hold, got ${JSON.stringify(agentSpawn)}`);
	assert.equal(taskSpawn, null);
	assert.equal(readRows(fx.open).length, 0, 'no log row');
	assert.equal(fs.existsSync(fx.pass), false);
	// Control: the same repo once it holds a record refuses the same spawn, so the silence above is the missing record's doing.
	const w = spawnSync(process.execPath, [TOOL, 'write', fx.plan], { cwd: fx.root, encoding: 'utf8' });
	assert.equal(w.status, 0, `lead-state write: ${w.stdout}${w.stderr}`);
	const [held] = hook(fx, [agent('s1')]);
	assert.ok(denied(held), `with a record the spawn is refused, got ${JSON.stringify(held)}`);
});

// why: catches holds.json sets the lead-state hold to enforce with tier high (Max 03:16Z), and a test fails if it reads otherwise (K374 S5)
test('holds.json sets the lead-state hold to enforce with tier high (Max 03:16Z), and a test fails if it reads otherwise', () => {
	const hold = JSON.parse(fs.readFileSync(HOLDS, 'utf8')).holds.find((h) => h.id === 'lead-state');
	assert.ok(hold, 'holds.json has a hold with id lead-state');
	assert.equal(hold.mode, 'enforce');
	assert.equal(hold.tier, 'high');
	assert.equal(hold.hook, 'agent-model.cjs');
});

// why: catches bypass: a Task spawn and a general agent are held the same (K374 S1)
test('bypass: a Task spawn and a general agent are held the same', () => {
	const fx = fixture();
	const calls = [agent('s1', 'Task'), agent('s1', 'Agent', { subagent_type: 'general-purpose', prompt: 'Do the work.' }), agent('s1', 'Agent', { prompt: 'Do the work.' }), agent('s1', 'Task', { subagent_type: 'kit:tester', prompt: 'Role: tester\nWrite tests.' })];
	for (const spawn of hook(fx, calls)) {
		assert.ok(denied(spawn), `every spawn form is refused, got ${JSON.stringify(spawn)}`);
		assert.match(reason(spawn), CHECK_CMD('s1'));
	}
	assert.equal(check(fx, 's1').code, 0);
	for (const spawn of hook(fx, calls)) assert.ok(!denied(spawn) || !CHECK_CMD('s1').test(reason(spawn)), `with the pass no spawn form is held for the check, got ${JSON.stringify(spawn)}`);
});

// why: catches repeat: the same spawn twice gives the same verdict (K374 S1)
test('repeat: the same spawn twice gives the same verdict', () => {
	const fx = fixture();
	const [a, b] = hook(fx, [agent('s1'), agent('s1')]);
	assert.ok(denied(a), `the spawn is refused, got ${JSON.stringify(a)}`);
	assert.deepEqual(b, a);
	assert.deepEqual(hook(fx, [agent('s1')])[0], a, 'a later run in a new process gives the same verdict');
	assert.equal(check(fx, 's1').code, 0);
	const [c, d] = hook(fx, [agent('s1'), agent('s1')]);
	assert.equal(c, null);
	assert.deepEqual(d, c, 'a passing session gets the same verdict twice');
});

// why: catches fail-closed: an unreadable record or a hook error blocks with "hook error: lead review", logged (K374 S4)
test('fail-closed: an unreadable record or a hook error blocks with "hook error: lead review", logged', () => {
	const fx = fixture();
	assert.equal(check(fx, 's1').code, 0);
	fs.writeFileSync(fx.record, '{ this is not json');
	const [spawn] = hook(fx, [agent('s1')]);
	assert.ok(denied(spawn), `an unreadable record blocks, got ${JSON.stringify(spawn)}`);
	assert.match(reason(spawn), /hook error: lead review/);
	const rows = readRows(fx.open);
	assert.ok(rows.some((r) => r.hook === 'agent-model' && r.cause && r.at), `a row in kit-guard-open.log, got ${JSON.stringify(rows)}`);
	// A hold-mode.cjs that throws is a hook error for this high-tier hold: it blocks even a session with a pass.
	const ok = fixture();
	assert.equal(check(ok, 's1').code, 0);
	const hookDir = kitTemp.makeTemp('lead-gate-hooks-');
	fs.cpSync(HOOK_DIR, hookDir, { recursive: true });
	fs.writeFileSync(path.join(hookDir, 'hold-mode.cjs'), "'use strict';\nexports.mode = () => { throw new Error('holds unreadable'); };\n");
	const [broken] = hook(ok, [agent('s1')], hookDir);
	assert.ok(denied(broken), `a throwing hold-mode blocks, got ${JSON.stringify(broken)}`);
	assert.match(reason(broken), /hook error: lead review/);
});

// why: catches a compact after the last pass drops this session's pass, so the next spawn is refused until a fresh check passes (K374 S6)
test('a compact after the last pass drops this session\'s pass, so the next spawn is refused until a fresh check passes', async () => {
	const fx = fixture();
	assert.equal(check(fx, 's1').code, 0);
	const [before] = hook(fx, [agent('s1')]);
	assert.equal(before, null, 'the pass holds before the compact');
	compact(fx);
	const [after] = hook(fx, [agent('s1')]);
	assert.ok(denied(after), `a compact after the pass refuses the spawn, got ${JSON.stringify(after)}`);
	assert.match(reason(after), CHECK_CMD('s1'));
	assert.equal(fs.existsSync(fx.pass), false, 'the pass is dropped');
	await later();
	assert.equal(check(fx, 's1').code, 0);
	const [fresh] = hook(fx, [agent('s1')]);
	assert.equal(fresh, null, `a fresh check after the compact opens the session again, got ${JSON.stringify(fresh)}`);
});

// why: catches after a compact the phase card shows again (K374 S6)
test('after a compact the phase card shows again', () => {
	const fx = fixture();
	assert.match(prompt(fx, 's1'), CARD, 'the first prompt shows the card');
	assert.doesNotMatch(prompt(fx, 's1'), CARD, 'a later prompt does not');
	assert.equal(check(fx, 's1').code, 0);
	compact(fx);
	const [spawn] = hook(fx, [agent('s1')]);
	assert.ok(denied(spawn), 'the compact is noticed');
	assert.equal(fs.existsSync(path.join(fx.common, 'kit-phase-card', 's1')), false, 'the session card marker is dropped');
	assert.match(prompt(fx, 's1'), CARD, 'the next prompt shows the card again');
});
