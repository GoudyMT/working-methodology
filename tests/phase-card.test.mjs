// K374 U5: the lead state record is written at each merge and shown as a phase card, and written once at a context
// threshold. Every hook and tool is spawned, never imported, so a missing behaviour fails an assertion, not the loader.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = (f) => path.join(ROOT, 'user', 'kit-tools', f);
const HOOK = (f) => path.join(ROOT, 'user', 'kit-hooks', f);
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const NEXT_ITEM = 'send the second wave brief for lane D';
const PLAN_TEXT = '# Plan\n\n## Units\n\n| Id | Title | Files | Tests |\n| --- | --- | --- | --- |\n| U1 | first | a.mjs | one |\n| U2 | second | b.mjs | one |\n| U3 | third | c.mjs | one |\n';
const merged = (unit) => [
	{ unit, step: 'tests', at: '2026-01-01T00:00:00Z', by: 'lead' },
	{ unit, step: 'review', at: '2026-01-01T00:10:00Z', by: 'lead' },
	{ unit, step: 'build', at: '2026-01-01T00:20:00Z', by: 'lead' },
	{ unit, step: 'merged', at: '2026-01-01T01:00:00Z', by: 'lead' },
];

// A kit-installed git repo holding every source the record reads; withRecord also writes the record with the real tool.
function fixture({ withRecord = true, window = 400000 } = {}) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-card-'));
	const git = (...a) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', ...a], { cwd: root, encoding: 'utf8' });
	git('init', '-q');
	const dir = path.join(root, 'plans', 'p');
	fs.mkdirSync(dir, { recursive: true });
	fs.mkdirSync(path.join(root, '.kit'), { recursive: true });
	fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
	fs.writeFileSync(path.join(root, '.kit', 'kit-version.json'), '{}');
	fs.writeFileSync(path.join(root, '.claude', 'settings.json'), JSON.stringify({ autoCompactWindow: window }));
	fs.writeFileSync(path.join(root, 'VERSION'), '1.0.0\n');
	const plan = path.join(dir, 'PLAN.md');
	fs.writeFileSync(plan, PLAN_TEXT);
	fs.writeFileSync(path.join(dir, 'flow.jsonl'), jsonl(merged('U1')));
	fs.writeFileSync(
		path.join(dir, 'lead-checklist.jsonl'),
		jsonl([
			{ phase: 'build', item: 'merge unit U1', done: true, proof: 'abc' },
			{ phase: 'check', item: NEXT_ITEM, done: false, proof: '' },
			{ phase: 'check', item: 'send the wave report to Max', done: true, proof: 'ok' },
			{ phase: 'close', item: 'write the closeout', done: false, proof: '' },
		]),
	);
	const hookLog = path.join(root, '.git', 'kit-guard-open.log');
	fs.writeFileSync(hookLog, jsonl([{ at: '2026-01-01T00:30:00Z', hook: 'old', cause: 'earlier row' }]));
	git('add', '-A');
	git('commit', '-q', '-m', 'init');
	const fx = { root, dir, plan, flow: path.join(dir, 'flow.jsonl'), record: path.join(dir, 'lead-state.json'), hookLog };
	if (withRecord) {
		const w = spawnSync(process.execPath, [TOOL('lead-state.mjs'), 'write', plan], { cwd: root, encoding: 'utf8' });
		assert.equal(w.status, 0, `fixture needs lead-state.mjs write: ${w.stdout}${w.stderr}`);
	}
	return fx;
}
const logRows = (fx) => fs.readFileSync(fx.hookLog, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
const mergedOf = (fx) => JSON.parse(fs.readFileSync(fx.record, 'utf8')).merged;

function prompt(fx, session) {
	const r = spawnSync(process.execPath, [HOOK('kit-gate.cjs')], { input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'carry on', cwd: fx.root, session_id: session }), encoding: 'utf8' });
	return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}
const sid = () => `s-${randomUUID()}`;
// The fixture's phase is check and two items are undone; the next item's text holds no phase word, so the phase is read from its own label.
const cardOk = (out) => /\bphase\b[^\n]*\bcheck\b/i.test(out) && /\bowed\b\D{0,12}\b2\b/i.test(out) && out.includes(NEXT_ITEM) && /VERDICT: ok/.test(out);
const require = createRequire(import.meta.url);

// A lead transcript whose last call read `tokens` of context (input + cache read + cache write), beside its subagents folder.
function transcriptAt(fx, name, tokens) {
	const file = path.join(fx.root, `${name}.jsonl`);
	const usage = { input_tokens: 10, cache_read_input_tokens: tokens - 1010, cache_creation_input_tokens: 1000, output_tokens: 50 };
	fs.writeFileSync(file, jsonl([{ message: { role: 'user', content: 'go' } }, { message: { role: 'assistant', id: `m-${tokens}`, model: 'claude-sonnet-5-5', usage } }]));
	return file;
}
function toolCall(fx, transcript, session) {
	const r = spawnSync(process.execPath, [HOOK('call-cap.cjs')], {
		input: JSON.stringify({ hook_event_name: 'PreToolUse', session_id: session, transcript_path: transcript, cwd: fx.root, tool_name: 'Read', tool_input: { file_path: 'x', limit: 5 } }),
		encoding: 'utf8',
	});
	return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}
const WATCH_LINE = /context at [\d,]+: state record written/;

// why: catches flow-check checklist writes the lead state record after each read (K374 S1)
test('flow-check checklist writes the lead state record after each read', () => {
	const fx = fixture({ withRecord: false });
	assert.ok(!fs.existsSync(fx.record), 'control: no record before the read');
	const run = () => spawnSync(process.execPath, [TOOL('flow-check.mjs'), 'checklist', fx.flow, '--plan', fx.plan], { cwd: fx.root, encoding: 'utf8' });
	const a = run();
	assert.ok(fs.existsSync(fx.record), `the read wrote no record: ${a.stdout}${a.stderr}`);
	assert.deepEqual(mergedOf(fx), ['U1']);
	fs.appendFileSync(fx.flow, jsonl(merged('U2')));
	run();
	assert.deepEqual(mergedOf(fx), ['U1', 'U2'], 'the next read refreshes the record');
	const c = spawnSync(process.execPath, [TOOL('lead-state.mjs'), 'check', fx.plan], { cwd: fx.root, encoding: 'utf8' });
	assert.equal(c.status, 0, `${c.stdout}${c.stderr}`);
});

// why: catches a session's first prompt with a record in the repo prints the phase card: phase, next step and the check VERDICT (K374 S2)
test("a session's first prompt with a record in the repo prints the phase card: phase, next step and the check VERDICT", () => {
	const fx = fixture();
	const p = prompt(fx, sid());
	assert.equal(p.code, 0, p.out);
	assert.ok(cardOk(p.out), `no card: ${p.out}`);
	assert.doesNotMatch(p.out, /"decision"\s*:\s*"block"/, 'the card never blocks the prompt');
	// control: a stale record shows its VERDICT, not ok
	fs.appendFileSync(fx.flow, jsonl(merged('U2')));
	const q = prompt(fx, sid());
	assert.match(q.out, /VERDICT: stale/, q.out);
});

// why: catches a later prompt in the same session prints no card (K374 S2)
test('a later prompt in the same session prints no card', () => {
	const fx = fixture();
	const session = sid();
	assert.ok(cardOk(prompt(fx, session).out), 'control: the first prompt shows the card');
	const later = prompt(fx, session);
	assert.equal(later.code, 0, later.out);
	assert.doesNotMatch(later.out, /VERDICT/, later.out);
	assert.ok(!later.out.includes(NEXT_ITEM), later.out);
});

// why: catches with no record no card is printed (K374 S3)
test('with no record no card is printed', () => {
	const fx = fixture({ withRecord: false });
	const p = prompt(fx, sid());
	assert.equal(p.code, 0, p.out);
	assert.equal(p.out.trim(), '', 'no record: no output at all');
	// control: the same repo with a record prints the card
	fixtureWrite(fx);
	assert.ok(cardOk(prompt(fx, sid()).out), 'a record brings the card');
});
function fixtureWrite(fx) {
	const w = spawnSync(process.execPath, [TOOL('lead-state.mjs'), 'write', fx.plan], { cwd: fx.root, encoding: 'utf8' });
	assert.equal(w.status, 0, `${w.stdout}${w.stderr}`);
}

// why: catches bypass: a new session id after a resume or compact shows the card again (K374 S2)
// A compact keeps the session id (P0 probe), so only a resume brings a new one; the compact case is U6 S6.
test('bypass: a new session id after a resume or compact shows the card again', () => {
	const fx = fixture();
	const first = sid();
	assert.ok(cardOk(prompt(fx, first).out), 'control: first session shows it');
	assert.doesNotMatch(prompt(fx, first).out, /VERDICT/, 'control: the same session does not');
	const resumed = prompt(fx, sid());
	assert.ok(cardOk(resumed.out), `a new session id must show the card again: ${resumed.out}`);
});

// why: catches repeat: two sessions on the same record get the same card (K374 S2)
test('repeat: two sessions on the same record get the same card', () => {
	const fx = fixture();
	const a = prompt(fx, sid());
	const b = prompt(fx, sid());
	assert.ok(cardOk(a.out), `no card: ${a.out}`);
	assert.equal(b.out, a.out);
});

// why: catches fail-open: an unreadable record prints "lead state unreadable: run lead-state check" and is logged (K374 S4)
test('fail-open: an unreadable record prints "lead state unreadable: run lead-state check" and is logged', () => {
	const fx = fixture();
	fs.writeFileSync(fx.record, '{ this is not json');
	const before = logRows(fx).length;
	const p = prompt(fx, sid());
	assert.equal(p.code, 0, p.out);
	assert.ok(p.out.includes('lead state unreadable: run lead-state check'), p.out);
	assert.doesNotMatch(p.out, /"decision"\s*:\s*"block"/, 'a small tier hook lets the prompt through');
	const added = logRows(fx).slice(before);
	assert.equal(added.length, 1, 'one log row');
	assert.equal(added[0].hook, 'kit-gate');
	assert.ok(typeof added[0].at === 'string' && added[0].at && typeof added[0].cause === 'string' && added[0].cause);
});

// why: catches context watch: the lead's context passing the threshold writes the record once per crossing and prints one line "context at N: state record written" (K374 S5)
test(`context watch: the lead's context passing the threshold writes the record once per crossing and prints one line "context at N: state record written"`, () => {
	const fx = fixture(); // window 400000: the threshold is the lower of 350000 and 300000
	const session = sid();
	fs.appendFileSync(fx.flow, jsonl(merged('U2')));
	const below = toolCall(fx, transcriptAt(fx, 't', 290000), session);
	assert.equal(below.code, 0, below.out);
	assert.equal(below.out.trim(), '', 'under the threshold the hook prints nothing');
	// the router must send the lead's own call (no agent_id) to the hook, and still an agent's
	const { routes } = require('../project/.claude/guard.cjs');
	assert.ok(routes('Read', {}).includes('call-cap.cjs'), 'a lead call reaches call-cap.cjs');
	assert.ok(routes('Read', { agent_id: 'a1' }).includes('call-cap.cjs'), 'an agent call still does');
	assert.deepEqual(mergedOf(fx), ['U1'], 'control: the record is not touched under the threshold');
	const over = toolCall(fx, transcriptAt(fx, 't', 320000), session);
	assert.equal(over.code, 0, over.out);
	assert.equal(over.out.match(new RegExp(WATCH_LINE, 'g'))?.length, 1, `one line: ${over.out}`);
	assert.equal(Number(over.out.match(/context at ([\d,]+):/)[1].replace(/,/g, '')), 320000);
	assert.doesNotMatch(over.out, /"permissionDecision"\s*:\s*"deny"/);
	assert.deepEqual(mergedOf(fx), ['U1', 'U2'], 'the record was written at the crossing');
	// the same crossing: no second write, no second line
	fs.appendFileSync(fx.flow, jsonl(merged('U3')));
	const again = toolCall(fx, transcriptAt(fx, 't', 330000), session);
	assert.doesNotMatch(again.out, WATCH_LINE);
	assert.deepEqual(mergedOf(fx), ['U1', 'U2'], 'once per crossing');
	// a compact drops the context; the next crossing writes again
	assert.doesNotMatch(toolCall(fx, transcriptAt(fx, 't', 100000), session).out, WATCH_LINE);
	const second = toolCall(fx, transcriptAt(fx, 't', 310000), session);
	assert.match(second.out, WATCH_LINE, second.out);
	assert.deepEqual(mergedOf(fx), ['U1', 'U2', 'U3']);
	// the window in force sets the lower arm: 75 percent of 200000 is 150000
	const small = fixture({ window: 200000 });
	assert.match(toolCall(small, transcriptAt(small, 't', 160000), sid()).out, WATCH_LINE, 'a smaller window crosses earlier');
	// a window of 1000000 puts the 350000 arm lower than 75 percent
	const big = fixture({ window: 1000000 });
	assert.equal(toolCall(big, transcriptAt(big, 't', 340000), sid()).out.trim(), '', 'under 350000 nothing');
	assert.equal(toolCall(big, transcriptAt(big, 't', 360000), sid()).out.match(new RegExp(WATCH_LINE, 'g'))?.length, 1, 'over 350000 one line');
	// no record: the watch has no plan to read, so it writes and prints nothing
	const bare = fixture({ withRecord: false });
	assert.equal(toolCall(bare, transcriptAt(bare, 't', 320000), sid()).out.trim(), '');
	assert.ok(!fs.existsSync(bare.record), 'no record is created');
});

// why: catches the record written at the threshold lists the open warm agents (K374 S5)
test('the record written at the threshold lists the open warm agents', () => {
	const fx = fixture();
	const transcript = transcriptAt(fx, 't', 320000);
	const subs = path.join(fx.root, 't', 'subagents');
	fs.mkdirSync(subs, { recursive: true });
	const agentUsage = { input_tokens: 5, cache_read_input_tokens: 40000, cache_creation_input_tokens: 1000, output_tokens: 0 };
	fs.writeFileSync(path.join(subs, 'agent-a1.jsonl'), jsonl([{ message: { role: 'user', content: 'Role: builder\nLane: D\nUnit: U5' } }, { message: { role: 'assistant', id: 'x1', usage: agentUsage } }]));
	// an agent of another session is not this session's open agent: openAgents reads only this session's subagents folder
	const other = path.join(fx.root, 'other-session', 'subagents');
	fs.mkdirSync(other, { recursive: true });
	fs.writeFileSync(path.join(other, 'agent-z9.jsonl'), jsonl([{ message: { role: 'user', content: 'Role: builder\nLane: D' } }, { message: { role: 'assistant', id: 'z1', usage: agentUsage } }]));
	const r = toolCall(fx, transcript, sid());
	assert.match(r.out, WATCH_LINE, r.out);
	// any array of the record that names the agent by id lists it: the field's name is the builder's
	const rec = JSON.parse(fs.readFileSync(fx.record, 'utf8'));
	const found = Object.values(rec).filter(Array.isArray).flat().find((e) => e && typeof e === 'object' && e.id === 'a1');
	assert.ok(found, `the record lists no agent a1: ${JSON.stringify(rec)}`);
	assert.equal(found.role, 'builder');
	assert.equal(found.lane, 'D');
	assert.equal(found.tokens, 41005);
	assert.ok(!JSON.stringify(rec).includes('z9'), 'an agent of another session is not listed');
});

// why: catches fail-open: an unreadable transcript lets the call through (small tier) and is logged (K374 S5)
test('fail-open: an unreadable transcript lets the call through (small tier) and is logged', () => {
	const fx = fixture();
	const before = logRows(fx).length;
	const r = toolCall(fx, path.join(fx.root, 'no-such-transcript.jsonl'), sid());
	assert.equal(r.code, 0, r.out);
	assert.doesNotMatch(r.out, /"permissionDecision"\s*:\s*"(deny|ask)"/, 'the call goes through');
	const added = logRows(fx).slice(before);
	assert.equal(added.length, 1, 'one log row');
	assert.equal(added[0].hook, 'call-cap');
	assert.ok(typeof added[0].cause === 'string' && added[0].cause);
	assert.deepEqual(mergedOf(fx), ['U1'], 'nothing was written');
});
