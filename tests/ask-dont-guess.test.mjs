// U16 (lane B): a tester or test-reviewer that guesses is refused. Its role line carries a clarity field, and the gate
// refuses "assumed" and an "asked" record with no lead answer. Every check runs the handoff CLI in a child process.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const CLI = fileURLToPath(new URL('../user/kit-tools/handoff.mjs', import.meta.url));
const FIELDS = { id: 'K1', severity: 'low', status: 'red', where: 'tests/a.test.mjs:1', claim: 'c', proof: 'p', fix: '-' };
const finding = (over = {}) => JSON.stringify({ ...FIELDS, ...over });
// test-reviewer statuses are checked by the gate, so its finding uses one it may write.
const reviewFinding = () => finding({ status: 'open' });
const roleLine = (role, clarity) => JSON.stringify(clarity === undefined ? { role, commit: '158ec54' } : { role, commit: '158ec54', clarity });
const leadAnswer = (text) => JSON.stringify({ note: `lead answer: ${text}`, writer: 'lead' });
const record = (...lines) => ['Prose the hand-back holds.', 'RECORD:', ...lines].join('\n');
const tempDir = () => kitTemp.makeTemp('ask-dont-guess-');
const gate = (text, role) => {
	const file = path.join(tempDir(), 'record.txt');
	fs.writeFileSync(file, text);
	return spawnSync(process.execPath, [CLI, 'check', file, '--role', role], { encoding: 'utf8' });
};
const lines = (res) => res.stderr.trim().split('\n');

// why: catches a tester role line with no clarity field passing the gate, so a guessed spec goes unflagged.
test('A1 spec 1: a tester role line with no clarity is an error naming clarity on line 1', () => {
	const res = gate(record(roleLine('tester'), finding()), 'tester');
	assert.equal(res.status, 1, res.stderr);
	assert.ok(lines(res).some((l) => /^line 1: .*`clarity`/.test(l)), res.stderr);
});

// why: catches a test-reviewer role line with no clarity field passing the gate, so its guessed review goes unflagged.
test('A2 spec 1: a test-reviewer role line with no clarity is an error naming clarity on line 1', () => {
	const res = gate(record(roleLine('test-reviewer'), reviewFinding()), 'test-reviewer');
	assert.equal(res.status, 1, res.stderr);
	assert.ok(lines(res).some((l) => /^line 1: .*`clarity`/.test(l)), res.stderr);
});

// why: catches a tester that reports its spec as clear being refused, which would block every clear tester record.
test('A3 spec 2: a tester role line with clarity "clear" and a finding is ok', () => {
	const res = gate(record(roleLine('tester', 'clear'), finding()), 'tester');
	assert.equal(res.status, 0, res.stderr);
});

// why: catches a test-reviewer that reports its spec as clear being refused, which would block every clear review record.
test('A4 spec 2: a test-reviewer role line with clarity "clear" and a finding is ok', () => {
	const res = gate(record(roleLine('test-reviewer', 'clear'), reviewFinding()), 'test-reviewer');
	assert.equal(res.status, 0, res.stderr);
});

// why: catches an "asked" tester record refused even though the lead answered it, which would block every asked record.
test('A5 spec 2: a tester with clarity "asked" and a non-empty lead answer line is ok', () => {
	const res = gate(record(roleLine('tester', 'asked'), leadAnswer('use the 2026 path'), finding()), 'tester');
	assert.equal(res.status, 0, res.stderr);
});

// why: catches an "asked" test-reviewer refused even though the lead answered it, which would block every asked review.
test('A6 spec 2: a test-reviewer with clarity "asked" and a non-empty lead answer line is ok', () => {
	const res = gate(record(roleLine('test-reviewer', 'asked'), leadAnswer('the tests are the spec'), reviewFinding()), 'test-reviewer');
	assert.equal(res.status, 0, res.stderr);
});

// why: catches an "asked" tester record passing with no lead answer, so a question nobody answered counts as settled.
test('A7 spec 2: a tester with clarity "asked" and no lead answer line is an error', () => {
	const res = gate(record(roleLine('tester', 'asked'), finding()), 'tester');
	assert.equal(res.status, 1, res.stderr);
	assert.match(res.stderr, /lead answer/i);
});

// why: catches an "asked" record whose lead answer text is blank passing as answered when nothing was answered.
test('A8 spec 2: a tester with clarity "asked" and a lead answer with empty text is an error', () => {
	const res = gate(record(roleLine('tester', 'asked'), leadAnswer(''), finding()), 'tester');
	assert.equal(res.status, 1, res.stderr);
	assert.match(res.stderr, /lead answer|`note`|empty/i);
});

// why: catches a lead answer written by the tester itself passing as the lead's answer to its own question.
test('A9 spec 2: a lead answer line whose writer is not lead is an error', () => {
	const selfAnswer = JSON.stringify({ note: 'lead answer: yes', writer: 'tester' });
	const res = gate(record(roleLine('tester', 'asked'), selfAnswer, finding()), 'tester');
	assert.equal(res.status, 1, res.stderr);
});

// why: catches an "assumed" tester record passing the gate, which lets a guessed spec line ship unchecked.
test('A10 spec 2: a tester with clarity "assumed" is an error that says to stop and ask the lead', () => {
	const res = gate(record(roleLine('tester', 'assumed'), finding()), 'tester');
	assert.equal(res.status, 1, res.stderr);
	assert.match(res.stderr, /assumed/);
	assert.match(res.stderr, /stop and ask the lead/);
});

// why: catches an "assumed" tester record passing when a lead answer is also present, which hides a guess behind an unrelated answer.
test('A11 spec 2: a tester with clarity "assumed" is still an error with a lead answer line present', () => {
	const res = gate(record(roleLine('tester', 'assumed'), leadAnswer('use the 2026 path'), finding()), 'tester');
	assert.equal(res.status, 1, res.stderr);
	assert.match(res.stderr, /assumed/);
});

// why: catches an "assumed" test-reviewer record passing the gate, so a review that guessed reaches the lead as settled.
test('A12 spec 2: a test-reviewer with clarity "assumed" is an error that says to stop and ask the lead', () => {
	const res = gate(record(roleLine('test-reviewer', 'assumed'), leadAnswer('the tests are the spec'), reviewFinding()), 'test-reviewer');
	assert.equal(res.status, 1, res.stderr);
	assert.match(res.stderr, /stop and ask the lead/);
});

// why: catches an "asked" test-reviewer record with no lead answer passing, the same hole the tester has.
test('A13 spec 2: a test-reviewer with clarity "asked" and no lead answer line is an error', () => {
	const res = gate(record(roleLine('test-reviewer', 'asked'), reviewFinding()), 'test-reviewer');
	assert.equal(res.status, 1, res.stderr);
	assert.match(res.stderr, /lead answer/i);
});

// why: catches a builder being made to carry clarity, which would refuse every builder record that predates the field.
test('A14 spec 3: a builder role line with no clarity is ok', () => {
	const res = gate(record(roleLine('builder'), finding()), 'builder');
	assert.equal(res.status, 0, res.stderr);
});

// why: catches a clarity key on a builder role line being refused, when the spec allows the key on other roles.
test('A15 spec 3: a builder role line with a clarity key is ok', () => {
	const res = gate(record(roleLine('builder', 'clear'), finding()), 'builder');
	assert.equal(res.status, 0, res.stderr);
});

// why: catches the tester role file dropping the stop-and-ask rule, so a tester guesses with nothing to stop it.
test('A16 spec 4: user/agents/tester.md says to stop and ask the lead', () => {
	const text = fs.readFileSync(path.resolve('user/agents/tester.md'), 'utf8');
	assert.match(text, /stop and ask the lead/i);
});

// why: catches the tester role file dropping the never-guess rule, so a guessed spec line is not forbidden.
test('A17 spec 4: user/agents/tester.md says never to guess', () => {
	const text = fs.readFileSync(path.resolve('user/agents/tester.md'), 'utf8');
	assert.match(text, /never guess/i);
});

// why: catches the tester role file not naming the clarity field, so the brief and the gate never tie together.
test('A18 spec 4: user/agents/tester.md names the clarity field', () => {
	const text = fs.readFileSync(path.resolve('user/agents/tester.md'), 'utf8');
	assert.match(text, /\bclarity\b/);
});

// why: catches the test-reviewer role file dropping the stop-and-ask rule, so a reviewer guesses past an unclear spec.
test('A19 spec 4: user/agents/test-reviewer.md says to stop and ask the lead', () => {
	const text = fs.readFileSync(path.resolve('user/agents/test-reviewer.md'), 'utf8');
	assert.match(text, /stop and ask the lead/i);
});

// why: catches the test-reviewer role file dropping the never-guess rule, so a reviewer may guess an unclear spec line.
test('A20 spec 4: user/agents/test-reviewer.md says never to guess', () => {
	const text = fs.readFileSync(path.resolve('user/agents/test-reviewer.md'), 'utf8');
	assert.match(text, /never guess/i);
});

// why: catches the test-reviewer role file not naming the clarity field, so its role line never carries the field.
test('A21 spec 4: user/agents/test-reviewer.md names the clarity field', () => {
	const text = fs.readFileSync(path.resolve('user/agents/test-reviewer.md'), 'utf8');
	assert.match(text, /\bclarity\b/);
});

// why: catches a tester brief template that exists but omits the clarity field, so a brief never asks for it.
test('A22 spec 4: a tester brief template, if one exists, names the clarity field', () => {
	// No tester brief template exists yet under user/skills/agent-team-build/templates (only builder-brief.md and
	// checker-brief.md), so this checks nothing until one is added; it does not pass as proof the brief asks for clarity.
	const file = path.resolve('user/skills/agent-team-build/templates/tester-brief.md');
	if (!fs.existsSync(file)) return;
	assert.match(fs.readFileSync(file, 'utf8'), /\bclarity\b/);
});
