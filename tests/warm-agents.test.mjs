// K364 (patch 1.51.1, U18): warm agents and a logged context reset. agent-model.cjs (reached for Agent, Task and SendMessage
// through guard.cjs) holds a fresh tester or builder spawn while an open agent of the same lane and table role is under
// WARM_LIMIT (150000 tokens), and holds a SendMessage to an agent over it. user/kit-tools/warm.mjs reads context size the
// way call-cap.cjs does and logs each reset. Fixtures are fake transcripts: <session>.jsonl beside
// <session>/subagents/agent-<id>.jsonl; the hook input carries transcript_path. Each test runs the real files in a child
// process against temp folders.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const require = createRequire(import.meta.url);
const HOOK_DIR = path.resolve('user/kit-hooks');
const WARM = path.resolve('user/kit-tools/warm.mjs');
const LIMIT = 150000;

function isolatedEnv(extra = {}) {
	const home = kitTemp.makeTemp('warm-home-');
	const config = path.join(home, '.claude');
	return { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: config, KIT_CLAUDE_HOME: config, ...extra };
}

function git(cwd, args) {
	const r = spawnSync('git', args, { cwd, env: isolatedEnv(), encoding: 'utf8' });
	assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
	return r.stdout.trim();
}

function repo() {
	const dir = kitTemp.makeTemp('warm-repo-');
	git(dir, ['init', '-q', '-b', 'main']);
	return dir;
}
const openLog = (dir) => path.join(git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']), 'kit-guard-open.log');
const readRows = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

// A fake session: the transcript file and its subagents folder.
function session() {
	const root = kitTemp.makeTemp('warm-session-');
	const transcript = path.join(root, 'session.jsonl');
	fs.writeFileSync(transcript, '');
	const subagents = path.join(root, 'session', 'subagents');
	fs.mkdirSync(subagents, { recursive: true });
	return { transcript, subagents };
}

const usage = (input, cacheRead = 0, cacheCreate = 0, output = 0) => ({ input_tokens: input, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheCreate, output_tokens: output });
const user = (text) => JSON.stringify({ message: { role: 'user', content: text } });
const assistant = (id, u) => JSON.stringify({ message: { role: 'assistant', id, usage: u, content: [{ type: 'text', text: 'x' }] } });

// An agent's transcript: its brief, then one assistant call whose context is `tokens`.
// With calls (a list of context sizes) the transcript streams several calls, the last one setting the size.
function agent(s, id, { role, lane, tokens, calls }) {
	const brief = `${role ? `Role: ${role}\n` : ''}${lane ? `Lane: ${lane}\n` : ''}Do the unit.`;
	const sizes = calls || [tokens];
	const lines = [user(brief), ...sizes.map((t, i) => assistant(`m-${id}-${i}`, usage(t)))];
	fs.writeFileSync(path.join(s.subagents, `agent-${id}.jsonl`), `${lines.join('\n')}\n`);
}

// The real guard.cjs as Claude Code runs it: a copy of the project guards, a Claude folder holding agent-model.cjs with
// its hold files and warm.mjs (stamped as install user records them), and the call on stdin. Returns the hook output.
function guardRun(cwd, s, tool_name, tool_input) {
	const dir = kitTemp.makeTemp('warm-guard-');
	for (const f of ['guard.cjs', 'owner-proof.cjs', 'task-gate.cjs', 'guard-outward.cjs', 'guard-delete.cjs', 'guard-read.cjs', 'owner-yes.cjs']) fs.copyFileSync(path.resolve('project/.claude', f), path.join(dir, f));
	const cfg = kitTemp.makeTemp('warm-cfg-');
	fs.mkdirSync(path.join(cfg, 'kit-hooks'));
	for (const f of ['agent-model.cjs', 'hold-mode.cjs', 'holds.json', 'safe-spawn.cjs']) if (fs.existsSync(path.join(HOOK_DIR, f))) fs.copyFileSync(path.join(HOOK_DIR, f), path.join(cfg, 'kit-hooks', f));
	fs.mkdirSync(path.join(cfg, 'kit-tools'));
	if (fs.existsSync(WARM)) fs.copyFileSync(WARM, path.join(cfg, 'kit-tools', 'warm.mjs'));
	const files = {};
	for (const f of fs.readdirSync(path.join(cfg, 'kit-hooks'))) files[`kit-hooks/${f}`] = require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(cfg, 'kit-hooks', f))).digest('hex');
	fs.writeFileSync(path.join(cfg, 'kit-install.json'), JSON.stringify({ files }));
	const r = spawnSync(process.execPath, [path.join(dir, 'guard.cjs')], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name, tool_input, cwd, transcript_path: s.transcript }), encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cfg, KIT_CLAUDE_HOME: cfg, CLAUDE_PROJECT_DIR: dir } });
	assert.equal(r.status, 0, r.stderr);
	return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : {};
}

// Runs the real agent-model.cjs once per input in order; one decision per input, null when it lets the call through.
function checkInputs(cwd, s, inputs) {
	const script = "const a = JSON.parse(process.env.KIT_TEST_ARGS); const m = require(path.join(a.hookDir, 'agent-model.cjs')); process.stdout.write(JSON.stringify(a.inputs.map((i) => m.check({ ...i, cwd: a.cwd, transcript_path: a.transcript }))));";
	const args = JSON.stringify({ hookDir: HOOK_DIR, inputs, cwd, transcript: s.transcript });
	const r = spawnSync(process.execPath, ['-e', `const path = require('node:path'); ${script}`], { env: isolatedEnv({ KIT_TEST_ARGS: args }), encoding: 'utf8' });
	assert.equal(r.status, 0, `agent-model.cjs check ran: ${r.stderr}`);
	return JSON.parse(r.stdout);
}

const spawn = (type, lane, extra = '') => ({ tool_name: 'Agent', tool_input: { subagent_type: type, prompt: `${extra}${lane ? `Lane: ${lane}\n` : ''}Write the tests.` } });
const message = (to) => ({ tool_name: 'SendMessage', tool_input: { to, message: 'next unit' } });
const denied = (d) => d && d.hookSpecificOutput && d.hookSpecificOutput.permissionDecision === 'deny';
const reason = (d) => (d && d.hookSpecificOutput && d.hookSpecificOutput.permissionDecisionReason) || '';

// why: catches a fresh tester spawn is held while a tester of that lane is open and under the limit (K364 S1)
test('a fresh tester spawn is held while a tester of that lane is open and under the limit', () => {
	const s = session();
	agent(s, 'a1', { role: 'tester', lane: 'A', tokens: 50000 });
	const dir = repo();
	const [held, otherLane, noLane, builder] = checkInputs(dir, s, [spawn('tester', 'A'), spawn('tester', 'B'), spawn('tester', null), spawn('builder', 'A')]);
	assert.ok(denied(held), `the fresh tester is held, got ${JSON.stringify(held)}`);
	assert.match(reason(held), /a tester of lane A is open \(agent a1, 50000 tokens, under 150000\): continue it with SendMessage/);
	assert.equal(otherLane, null, 'another lane is not held');
	assert.equal(noLane, null, 'a spawn with no Lane line is not held');
	assert.equal(builder, null, 'a builder is not held by an open tester');
	const [checker, general] = checkInputs(dir, s, [spawn('checker', 'A'), spawn('general-purpose', 'A')]);
	assert.equal(checker, null, 'a checker spawn is not held by an open tester');
	assert.equal(general, null, 'a general-purpose spawn with no Role line is not held');
	const over = session();
	agent(over, 'a9', { role: 'tester', lane: 'A', tokens: 200000 });
	const [fresh] = checkInputs(dir, over, [spawn('tester', 'A')]);
	assert.equal(fresh, null, 'an open tester over the limit does not hold a fresh spawn');
	// At the limit counts as over: 149999 holds, 150000 and 150001 do not.
	const edge = session();
	agent(edge, 'e1', { role: 'tester', lane: 'D', tokens: LIMIT - 1 });
	agent(edge, 'e2', { role: 'tester', lane: 'E', tokens: LIMIT });
	agent(edge, 'e3', { role: 'tester', lane: 'F', tokens: LIMIT + 1 });
	const [justUnder, atLimit, past] = checkInputs(dir, edge, [spawn('tester', 'D'), spawn('tester', 'E'), spawn('tester', 'F')]);
	assert.ok(denied(justUnder), `149999 tokens is under the limit and holds, got ${JSON.stringify(justUnder)}`);
	assert.equal(atLimit, null, '150000 tokens is over and holds nothing');
	assert.equal(past, null, '150001 tokens holds nothing');
	// A streamed agent follows its last call, not the sum of its calls.
	const streamed = session();
	agent(streamed, 's1', { role: 'tester', lane: 'C', calls: [100000, 90000, 80000] });
	const [byLast] = checkInputs(dir, streamed, [spawn('tester', 'C')]);
	assert.ok(denied(byLast), `the last call (80000) is under the limit, so the spawn is held, got ${JSON.stringify(byLast)}`);
	assert.match(reason(byLast), /agent s1, 80000 tokens/);
});

// why: catches a SendMessage to an agent over the limit is held and says reset (K364 S2)
test('a SendMessage to an agent over the limit is held and says reset', () => {
	const s = session();
	agent(s, 'a1', { role: 'tester', lane: 'A', tokens: 50000 });
	agent(s, 'a2', { role: 'builder', lane: 'A', tokens: 200000 });
	const dir = repo();
	const [over, under] = checkInputs(dir, s, [message('a2'), message('a1')]);
	assert.ok(denied(over), `the message to the agent over the limit is held, got ${JSON.stringify(over)}`);
	assert.match(reason(over), /agent a2 is at 200000 tokens, over 150000: reset it \(spawn a fresh one and log the reset with warm\.mjs reset\)/);
	assert.equal(under, null, 'a message to an agent under the limit goes through');
	const edge = session();
	agent(edge, 'e2', { role: 'tester', lane: 'E', tokens: LIMIT });
	agent(edge, 's1', { role: 'tester', lane: 'C', calls: [100000, 90000, 80000] });
	const [atLimit, byLast] = checkInputs(dir, edge, [message('e2'), message('s1')]);
	assert.ok(denied(atLimit), `a message to an agent at 150000 is refused, got ${JSON.stringify(atLimit)}`);
	assert.match(reason(atLimit), /agent e2 is at 150000 tokens, over 150000/);
	assert.equal(byLast, null, 'a streamed agent whose last call is 80000 is under the limit, whatever the sum');
	const viaGuard = guardRun(dir, s, 'SendMessage', { to: 'a2', message: 'next unit' });
	assert.equal(viaGuard.permissionDecision, 'deny', `guard.cjs routes SendMessage to agent-model.cjs, got ${JSON.stringify(viaGuard)}`);
	assert.match(viaGuard.permissionDecisionReason || '', /agent a2 is at 200000 tokens, over 150000: reset it/);
	assert.equal(guardRun(dir, s, 'SendMessage', { to: 'a1', message: 'next unit' }).permissionDecision, undefined, 'a message under the limit passes through guard.cjs');
	const holds = JSON.parse(fs.readFileSync(path.join(HOOK_DIR, 'holds.json'), 'utf8')).holds;
	assert.deepEqual(holds.filter((h) => h.id === 'warm-agents').map((h) => h.mode), ['enforce'], 'holds.json lists warm-agents in enforce mode');
});

// why: catches every reset writes one JSON line with agent, role, tokens and reason (K364 S3)
test('every reset writes one JSON line with agent, role, tokens and reason', () => {
	assert.ok(fs.existsSync(WARM), 'user/kit-tools/warm.mjs is missing');
	const log = path.join(kitTemp.makeTemp('warm-log-'), 'checklist.jsonl');
	const run = (args) => spawnSync(process.execPath, [WARM, 'reset', ...args], { env: isolatedEnv(), encoding: 'utf8' });
	const first = run(['--agent', 'a2', '--role', 'tester', '--tokens', '200000', '--reason', 'over the limit', '--log', log]);
	assert.equal(first.status, 0, first.stderr);
	const rows = readRows(log);
	assert.equal(rows.length, 1, 'one line per reset');
	assert.equal(rows[0].kind, 'reset');
	assert.equal(rows[0].agent, 'a2');
	assert.equal(rows[0].role, 'tester');
	assert.equal(rows[0].tokens, 200000);
	assert.equal(rows[0].reason, 'over the limit');
	assert.ok(rows[0].at && !Number.isNaN(Date.parse(rows[0].at)), 'the row carries its time');
	assert.deepEqual(JSON.parse(first.stdout.trim()), rows[0], 'the row is printed');
	run(['--agent', 'b1', '--role', 'builder', '--tokens', '160000', '--reason', 'drift', '--log', log]);
	assert.equal(readRows(log).length, 2, 'the next reset appends');
	const flags = { '--agent': 'b2', '--role': 'builder', '--tokens': '1', '--reason': 'drift', '--log': log };
	for (const omit of Object.keys(flags)) {
		const args = Object.entries(flags).filter(([k]) => k !== omit).flat();
		assert.equal(run(args).status, 2, `a missing ${omit} exits 2`);
		assert.equal(readRows(log).length, 2, `a reset missing ${omit} writes nothing`);
	}
});

// A transcript with streamed lines: m1 twice, m2 twice (the last line of each message holds its final usage), then a user line.
function sizedTranscript() {
	const file = path.join(kitTemp.makeTemp('warm-size-'), 'agent-s1.jsonl');
	const lines = [user('Role: tester\nLane: A\nbrief'), assistant('m1', usage(1, 10, 100, 5)), assistant('m1', usage(1, 10, 100, 1000)), assistant('m2', usage(5, 20, 200, 2)), assistant('m2', usage(5, 20, 200, 3000)), user('a tool answer')];
	fs.writeFileSync(file, `${lines.join('\n')}\n`);
	return file;
}

// why: catches the context size is the last call's input plus cache plus output tokens, as call-cap.cjs reads it (K364 S4)
test("the context size is the last call's input plus cache plus output tokens, as call-cap.cjs reads it", async () => {
	assert.ok(fs.existsSync(WARM), 'user/kit-tools/warm.mjs is missing');
	const warm = await import(pathToFileURL(WARM).href);
	assert.equal(typeof warm.contextSize, 'function', 'warm.mjs exports contextSize');
	assert.equal(warm.contextSize(sizedTranscript()), 5 + 20 + 200 + 3000, 'the last message, at its last line: input + cache read + cache creation + output');
	const shrinking = path.join(kitTemp.makeTemp('warm-shrink-'), 'agent-s2.jsonl');
	fs.writeFileSync(shrinking, `${[user('brief'), assistant('m1', usage(100000)), assistant('m2', usage(500))].join('\n')}\n`);
	assert.equal(warm.contextSize(shrinking), 500, 'the last message sets the size, even when an earlier one was larger');
	assert.throws(() => warm.contextSize(path.join(kitTemp.makeTemp('warm-none-'), 'agent-none.jsonl')), 'an unreadable file throws');
});

// why: catches a fresh spawn under another role name of the same table role is still held (K364 S5)
test('a fresh spawn under another role name of the same table role is still held', () => {
	const s = session();
	agent(s, 'a1', { role: 'tester', lane: 'A', tokens: 50000 });
	agent(s, 'b1', { role: 'implementer', lane: 'A', tokens: 60000 });
	const dir = repo();
	const [alias, plugin, briefed, builder, implementer] = checkInputs(dir, s, [spawn('test-writer', 'A'), spawn('kit:tester', 'A'), spawn('general-purpose', 'A', 'Role: test-writer\n'), spawn('builder', 'A'), spawn('implementer', 'A')]);
	assert.ok(denied(alias), `test-writer is held by the open tester, got ${JSON.stringify(alias)}`);
	assert.ok(denied(plugin), `kit:tester is held, got ${JSON.stringify(plugin)}`);
	assert.ok(denied(briefed), `a general agent with Role: test-writer is held, got ${JSON.stringify(briefed)}`);
	assert.ok(denied(builder), `a builder spawn is held by the open implementer, got ${JSON.stringify(builder)}`);
	assert.ok(denied(implementer), `an implementer spawn is held too, got ${JSON.stringify(implementer)}`);
	assert.match(reason(alias), /a tester of lane A is open \(agent a1/, 'the refusal names the table role');
});

// why: catches two reads of one transcript give one size (K364 S6)
test('two reads of one transcript give one size', async () => {
	assert.ok(fs.existsSync(WARM), 'user/kit-tools/warm.mjs is missing');
	const warm = await import(pathToFileURL(WARM).href);
	const file = sizedTranscript();
	assert.equal(typeof warm.contextSize, 'function', 'warm.mjs exports contextSize');
	assert.equal(warm.contextSize(file), warm.contextSize(file));
	const s = session();
	agent(s, 'a1', { role: 'tester', lane: 'A', tokens: 50000 });
	const [one] = warm.openAgents(path.join(path.dirname(s.transcript), 'session', 'subagents'));
	const [two] = warm.openAgents(path.join(path.dirname(s.transcript), 'session', 'subagents'));
	assert.deepEqual(two, one);
	assert.equal(one.id, 'a1');
	assert.equal(one.lane, 'A');
	assert.equal(one.tokens, 50000, 'the hook and the size read agree');
	assert.ok(String(one.file).endsWith('agent-a1.jsonl'));
	const [held] = checkInputs(repo(), s, [spawn('tester', 'A')]);
	assert.match(reason(held), /agent a1, 50000 tokens/, 'the hook reports the same size');
});

// why: catches an unreadable transcript lets the call through and is logged (K364 S7)
test('an unreadable transcript lets the call through and is logged', () => {
	const s = session();
	agent(s, 'a1', { role: 'tester', lane: 'A', tokens: 50000 });
	fs.mkdirSync(path.join(s.subagents, 'agent-bad.jsonl'));
	const dir = repo();
	const [decision, sent] = checkInputs(dir, s, [spawn('tester', 'A'), message('bad')]);
	assert.equal(decision, null, 'an unreadable transcript does not hold the spawn');
	assert.equal(sent, null, 'nor the message');
	const rows = readRows(openLog(dir));
	assert.ok(rows.length >= 1, 'the fail-open is logged in kit-guard-open.log');
	assert.equal(rows[0].hook, 'agent-model');
	assert.ok(rows[0].cause && rows[0].at, 'the row carries its cause and time');
});
