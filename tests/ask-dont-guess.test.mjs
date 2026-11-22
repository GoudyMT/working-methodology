// U16 (lane B): a tester or test-reviewer that guesses is refused. Its role line carries a clarity field, and the gate
// refuses "assumed" and an "asked" record with no lead answer. Every check runs the handoff CLI in a child process.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const CLI = fileURLToPath(new URL('../user/kit-tools/handoff.mjs', import.meta.url));
const TESTER_MD = fileURLToPath(new URL('../user/agents/tester.md', import.meta.url));
const TEST_REVIEWER_MD = fileURLToPath(new URL('../user/agents/test-reviewer.md', import.meta.url));
const FIELDS = { id: 'K1', severity: 'low', status: 'red', where: 'tests/a.test.mjs:1', claim: 'c', proof: 'p', fix: '-' };
const finding = (over = {}) => JSON.stringify({ ...FIELDS, ...over });
// test-reviewer statuses are checked by the gate, so its finding uses one it may write.
const reviewFinding = () => finding({ status: 'open' });
const roleLine = (role, clarity) => JSON.stringify(clarity === undefined ? { role, commit: '158ec54' } : { role, commit: '158ec54', clarity });
const leadAnswer = (text) => JSON.stringify({ note: `lead answer: ${text}`, writer: 'lead' });
const record = (...lines) => ['Prose the hand-back holds.', 'RECORD:', ...lines].join('\n');
const tempDir = () => kitTemp.makeTemp('ask-dont-guess-');
// The record's own role line decides the rule, so --role is passed only when a test asks for it.
const gate = (text, role) => {
	const file = `${tempDir()}/record.txt`;
	fs.writeFileSync(file, text);
	const args = [CLI, 'check', file];
	if (role !== undefined) args.push('--role', role);
	return spawnSync(process.execPath, args, { encoding: 'utf8' });
};
const lines = (res) => res.stderr.trim().split('\n');
// A missing clarity is log-only in this release: the warning line is in stdout or stderr and the exit stays 0.
const warnLines = (res) => `${res.stdout}${res.stderr}`.split('\n').filter((l) => /missing clarity \(log-only in this release\)/.test(l));
// Splits a role file into paragraphs; the three rules must share one, so each rule is said in the same breath.
const paragraphs = (file) => fs.readFileSync(file, 'utf8').split(/\r?\n\s*\r?\n/);

// why: catches a tester role line with no clarity field passing the gate, so a guessed spec goes unflagged.
test('A1 spec 1: a tester role line with no clarity warns on line 1 and exits 0', () => {
	const res = gate(record(roleLine('tester'), finding()), 'tester');
	assert.equal(res.status, 0, res.stderr);
	assert.ok(warnLines(res).some((l) => /line 1/.test(l)), `${res.stdout}${res.stderr}`);
});

// why: catches a test-reviewer role line with no clarity field passing the gate, so its guessed review goes unflagged.
test('A2 spec 1: a test-reviewer role line with no clarity warns on line 1 and exits 0', () => {
	const res = gate(record(roleLine('test-reviewer'), reviewFinding()), 'test-reviewer');
	assert.equal(res.status, 0, res.stderr);
	assert.ok(warnLines(res).some((l) => /line 1/.test(l)), `${res.stdout}${res.stderr}`);
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
	assert.match(res.stderr, /lead answer/i);
});

// why: catches a lead answer whose text is only spaces passing as answered, since blank text is no answer at all.
test('A8b spec 2: a tester with clarity "asked" and a lead answer of only spaces is an error', () => {
	const res = gate(record(roleLine('tester', 'asked'), leadAnswer('   '), finding()), 'tester');
	assert.equal(res.status, 1, res.stderr);
	assert.match(res.stderr, /lead answer/i);
});

// why: catches a note from the lead that lacks the "lead answer:" prefix passing as the answer to the question asked.
test('A8c spec 2: a tester with clarity "asked" and a lead note without the lead answer prefix is an error', () => {
	const res = gate(record(roleLine('tester', 'asked'), JSON.stringify({ note: 'thanks', writer: 'lead' }), finding()), 'tester');
	assert.equal(res.status, 1, res.stderr);
	assert.match(res.stderr, /lead answer/i);
});

// why: catches a lead answer written by the tester itself passing as the lead's answer to its own question.
test('A9 spec 2: a lead answer line whose writer is not lead is an error that names the lead answer', () => {
	const selfAnswer = JSON.stringify({ note: 'lead answer: yes', writer: 'tester' });
	const res = gate(record(roleLine('tester', 'asked'), selfAnswer, finding()), 'tester');
	assert.equal(res.status, 1, res.stderr);
	assert.match(res.stderr, /lead answer/i);
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
	assert.match(res.stderr, /stop and ask the lead/);
});

// why: catches an "assumed" test-reviewer record passing the gate, so a review that guessed reaches the lead as settled.
test('A12 spec 2: a test-reviewer with clarity "assumed" is an error that says assumed and stop and ask the lead', () => {
	const res = gate(record(roleLine('test-reviewer', 'assumed'), leadAnswer('the tests are the spec'), reviewFinding()), 'test-reviewer');
	assert.equal(res.status, 1, res.stderr);
	assert.match(res.stderr, /assumed/);
	assert.match(res.stderr, /stop and ask the lead/);
});

// why: catches an "asked" test-reviewer record with no lead answer passing, the same hole the tester has.
test('A13 spec 2: a test-reviewer with clarity "asked" and no lead answer line is an error', () => {
	const res = gate(record(roleLine('test-reviewer', 'asked'), reviewFinding()), 'test-reviewer');
	assert.equal(res.status, 1, res.stderr);
	assert.match(res.stderr, /lead answer/i);
});

// why: catches a clarity value outside the three allowed words passing the gate, which lets a free-text guess in as a rating.
test('A14 spec 1: a tester with clarity "maybe" is an error on line 1 that names the value', () => {
	const res = gate(record(roleLine('tester', 'maybe'), finding()), 'tester');
	assert.equal(res.status, 1, res.stderr);
	assert.ok(lines(res).some((l) => /^line 1: /.test(l)), res.stderr);
	assert.match(res.stderr, /maybe/);
});

// why: catches a numeric clarity passing the gate, since a number names no state of the spec at all.
test('A15 spec 1: a tester with a numeric clarity is an error on line 1 that names the value', () => {
	const res = gate(record(roleLine('tester', 5), finding()), 'tester');
	assert.equal(res.status, 1, res.stderr);
	assert.ok(lines(res).some((l) => /^line 1: /.test(l)), res.stderr);
	assert.match(res.stderr, /\b5\b/);
});

// why: catches a tester role line with no clarity passing when the gate is run without --role, so the rule hides behind a flag.
test('A16 spec 1: a tester role line with no clarity warns on line 1 and exits 0 with no --role flag passed', () => {
	const res = gate(record(roleLine('tester'), finding()));
	assert.equal(res.status, 0, res.stderr);
	assert.ok(warnLines(res).some((l) => /line 1/.test(l)), `${res.stdout}${res.stderr}`);
});

// why: catches a checker role line demanding clarity, which would refuse every checker record that predates the field.
test('A17 spec 3: a checker role line with no clarity is ok', () => {
	const res = gate(record(roleLine('checker'), finding()), 'checker');
	assert.equal(res.status, 0, res.stderr);
});

// why: catches a reviewer role line demanding clarity, which would refuse every reviewer record that predates the field.
test('A18 spec 3: a reviewer role line with no clarity is ok', () => {
	const res = gate(record(roleLine('reviewer'), finding()), 'reviewer');
	assert.equal(res.status, 0, res.stderr);
});

// why: catches a builder record refused for an "assumed" clarity, which the spec says the gate must ignore on other roles.
test('A19 spec 3: a builder role line with clarity "assumed" is ok', () => {
	const res = gate(record(roleLine('builder', 'assumed'), finding()), 'builder');
	assert.equal(res.status, 0, res.stderr);
});

// why: catches the tester and test-reviewer role files dropping one of the three rules, so a guessing tester has no written stop.
test('A20 spec 4: user/agents/tester.md has one paragraph that says stop and ask the lead, never guess, and clarity', () => {
	assert.ok(fs.existsSync(TESTER_MD), 'user/agents/tester.md exists');
	const hit = paragraphs(TESTER_MD).some((p) => /stop and ask the lead/i.test(p) && /never guess/i.test(p) && /\bclarity\b/.test(p));
	assert.ok(hit, 'no single paragraph holds all three rules');
});

// why: catches the test-reviewer role file dropping one of the three rules, so a guessing reviewer has no written stop.
test('A21 spec 4: user/agents/test-reviewer.md has one paragraph that says stop and ask the lead, never guess, and clarity', () => {
	assert.ok(fs.existsSync(TEST_REVIEWER_MD), 'user/agents/test-reviewer.md exists');
	const hit = paragraphs(TEST_REVIEWER_MD).some((p) => /stop and ask the lead/i.test(p) && /never guess/i.test(p) && /\bclarity\b/.test(p));
	assert.ok(hit, 'no single paragraph holds all three rules');
});
