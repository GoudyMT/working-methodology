// K300/K301 (build 24): the handoff record and its gate. Over 3 to 5 handoffs on a small model, the prose dropped
// severities and paths, and the pipe parser split claims that held a `|`. The gate reads a hand-back's RECORD: block
// and refuses any record that is malformed, empty, or missing a finding's keys. Nothing here calls a model.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { check } from '../user/kit-tools/handoff.mjs';

kitTemp.sessionRoot();
const CLI = fileURLToPath(new URL('../user/kit-tools/handoff.mjs', import.meta.url));
const ROLE = '{"role": "builder", "commit": "abc1234"}';
const finding = (id, over = {}) => JSON.stringify({ id, severity: 'low', status: 'red', where: 'tests/a.test.mjs:1', claim: 'c', proof: 'p', fix: '-', ...over });
const record = (...lines) => ['Prose the model wrote, with severity: high in it.', 'RECORD:', ...lines].join('\n');
const named = (errors, n) => errors.some((e) => new RegExp(`\\b${n}\\b`).test(e));
const cli = (args, input) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', input });
const writeRecord = (body) => {
	const file = path.join(kitTemp.makeTemp('handoff-test-'), 'record.txt');
	fs.writeFileSync(file, body);
	return file;
};

// why: a prose-only hand-back with no RECORD: line must fail, or a model's free text passes the gate unread.
test('T1 spec 1: text with no RECORD line is an error', () => {
	const r = check('Just prose, no record.');
	assert.equal(r.ok, false);
	assert.ok(r.errors.some((e) => /RECORD/.test(e)));
});

// why: blank lines between record lines must be skipped, or a tidy hand-back with a gap is refused for nothing.
test('T2 spec 1: blank lines after RECORD: are skipped', () => {
	const r = check(record(ROLE, '', finding('K1'), ''));
	assert.equal(r.ok, true, JSON.stringify(r.errors));
	assert.equal(r.findings.length, 1);
});

// why: a valid role line plus one finding must pass, or the gate refuses every good record.
test('T3 spec 2: a role line then a finding is ok', () => {
	const r = check(record(ROLE, finding('K1')));
	assert.equal(r.ok, true, JSON.stringify(r.errors));
});

// why: a commit shorter than 7 hex characters must be refused, or a stub hash ties a finding to no build.
test('T4 spec 2: a commit under 7 hex characters is an error', () => {
	const r = check(record('{"role": "builder", "commit": "abc12"}', finding('K1')));
	assert.equal(r.ok, false);
	assert.ok(named(r.errors, 1), JSON.stringify(r.errors));
});

// why: a finding placed before the role line must be an error, or a record with no role is read as one.
test('T5 spec 2: a finding before the role line is an error naming line 1', () => {
	const r = check(record(finding('K1'), ROLE));
	assert.equal(r.ok, false);
	assert.ok(named(r.errors, 1), JSON.stringify(r.errors));
});

// why: a finding missing its fix key must fail and name the key, or a finding with no fix passes as complete.
test('T6 spec 3: a finding missing the fix key is an error that names fix', () => {
	const bad = JSON.stringify({ id: 'K1', severity: 'low', status: 'red', where: '-', claim: 'c', proof: 'p' });
	const r = check(record(ROLE, bad));
	assert.equal(r.ok, false);
	assert.ok(r.errors.some((e) => /fix/.test(e)), JSON.stringify(r.errors));
});

// why: an empty proof string must be refused, or a finding claims a check it never showed.
test('T7 spec 3: a finding with an empty proof is an error', () => {
	const r = check(record(ROLE, finding('K1', { proof: '' })));
	assert.equal(r.ok, false);
});

// why: a severity outside critical/high/medium/low must be refused, or the prose-drop of a severity goes unseen.
test('T8 spec 3: a severity outside the four levels is an error naming line 2', () => {
	const r = check(record(ROLE, finding('K1', { severity: 'urgent' })));
	assert.equal(r.ok, false);
	assert.ok(named(r.errors, 2), JSON.stringify(r.errors));
});

// why: each of the four severity levels must pass, or a valid critical or medium finding is refused by mistake.
test('T9 spec 3: all four severities are accepted', () => {
	const lines = ['critical', 'high', 'medium', 'low'].map((s, i) => finding(`K${i}`, { severity: s }));
	const r = check(record(ROLE, ...lines));
	assert.equal(r.ok, true, JSON.stringify(r.errors));
	assert.equal(r.findings.length, 4);
});

// why: where "-" and fix "-" must pass, or a finding with no path or no fix is refused when the spec allows it.
test('T10 spec 3: where and fix may each be "-"', () => {
	const r = check(record(ROLE, finding('K1', { where: '-', fix: '-' })));
	assert.equal(r.ok, true, JSON.stringify(r.errors));
});

// why: two findings sharing an id must be an error naming the second one's line, or the gate cannot tell them apart.
test('T11 spec 6: a duplicate finding id is an error naming line 3', () => {
	const r = check(record(ROLE, finding('K1'), finding('K1')));
	assert.equal(r.ok, false);
	assert.ok(named(r.errors, 3), JSON.stringify(r.errors));
});

// why: a line that is not JSON must be an error naming its line, or a broken line is skipped silently.
test('T12 spec 6: a line that is not JSON is an error naming line 2', () => {
	const r = check(record(ROLE, 'this is not json'));
	assert.equal(r.ok, false);
	assert.ok(named(r.errors, 2), JSON.stringify(r.errors));
});

// why: a line that is valid JSON but of no known shape must be an error, or a typo'd key becomes an ignored line.
test('T13 spec 6: an unknown line shape is an error naming line 2', () => {
	const r = check(record(ROLE, '{"foo": 1}'));
	assert.equal(r.ok, false);
	assert.ok(named(r.errors, 2), JSON.stringify(r.errors));
});

// why: a record with only a role line must fail and say it is empty, or a bare role passes as a finished hand-back.
test('T14 spec 7: a role line alone is never ok and says the record is empty', () => {
	const r = check(record(ROLE));
	assert.equal(r.ok, false);
	assert.ok(r.errors.some((e) => /empty/i.test(e)), JSON.stringify(r.errors));
});

// why: a notChecked line with an empty string must be an error, or a blank gap is counted as an honest disclosure.
test('T15 spec 4: a notChecked line with an empty string is an error', () => {
	const r = check(record(ROLE, finding('K1'), '{"notChecked": ""}'));
	assert.equal(r.ok, false);
});

// why: a note line with no writer must be an error, or an anonymous note is accepted into the record.
test('T16 spec 4: a note line without a writer is an error', () => {
	const r = check(record(ROLE, '{"note": "looks fine"}'));
	assert.equal(r.ok, false);
});

// why: the result must carry findings in order and counts for notChecked and notes, or the CLI and callers read the wrong fields.
test('T17 spec 4-5: check returns findings in order, notChecked and notes counts', () => {
	const r = check(record(ROLE, finding('K1'), finding('K2'), '{"notChecked": "the drag path"}', '{"note": "ok", "writer": "tester"}'));
	assert.equal(r.ok, true, JSON.stringify(r.errors));
	assert.deepEqual(r.findings.map((f) => f.id), ['K1', 'K2']);
	assert.equal(r.notChecked, 1);
	assert.equal(r.notes, 1);
	assert.ok(Array.isArray(r.errors));
});

// why: ok must be false when any error is present, even with valid findings, or a half-broken record ships as passing.
test('T18 spec 8: a valid finding plus one bad line is not ok', () => {
	const r = check(record(ROLE, finding('K1'), 'junk'));
	assert.equal(r.ok, false);
	assert.equal(r.findings.length, 1);
	assert.ok(r.errors.length > 0);
});

// why: a claim holding `a | b | c` must come back unchanged, or the pipe parser splits it and the claim is lost.
test('T19 spec 10: a claim with pipes comes back unchanged', () => {
	const r = check(record(ROLE, finding('K1', { claim: 'a | b | c' })));
	assert.equal(r.ok, true, JSON.stringify(r.errors));
	assert.equal(r.findings[0].claim, 'a | b | c');
});

// why: a pipe in any other field must be kept too, or a where or proof with a pipe is cut and mis-scored.
test('T20 spec 3: a pipe inside where and proof is kept exactly', () => {
	const r = check(record(ROLE, finding('K1', { where: 'a.mjs:1 | b.mjs:2', proof: 'x | y' })));
	assert.equal(r.ok, true, JSON.stringify(r.errors));
	assert.equal(r.findings[0].where, 'a.mjs:1 | b.mjs:2');
	assert.equal(r.findings[0].proof, 'x | y');
});

// why: a valid record on the CLI must exit 0 and print one line of counts, or the kit's gate step cannot tell it passed.
test('T21 spec 9: CLI exits 0 on a valid record and prints one line of counts', () => {
	const res = cli(['check', writeRecord(record(ROLE, finding('K1'), finding('K2')))]);
	assert.equal(res.status, 0, res.stderr);
	const lines = res.stdout.trim().split('\n');
	assert.equal(lines.length, 1);
	assert.ok(/\b2\b/.test(lines[0]), lines[0]);
});

// why: the CLI must never change or delete the file it reads, or a re-run of the gate reads a different record.
test('T22 spec 9: CLI leaves the file it reads unchanged', () => {
	const file = writeRecord(record(ROLE, finding('K1')));
	const before = fs.readFileSync(file, 'utf8');
	cli(['check', file]);
	assert.equal(fs.readFileSync(file, 'utf8'), before);
});

// why: an invalid record on the CLI must exit 1 with each error on its own stderr line, or the caller cannot read them.
test('T23 spec 9: CLI exits 1 with one stderr line per error', () => {
	const res = cli(['check', writeRecord(record(ROLE, 'not json', finding('K2', { severity: 'urgent' })))]);
	assert.equal(res.status, 1);
	const lines = res.stderr.trim().split('\n');
	assert.equal(lines.length, 2, res.stderr);
	assert.ok(named([lines[0]], 2), lines[0]);
	assert.ok(named([lines[1]], 3), lines[1]);
});

// why: a file that cannot be read must exit 2, not 0 or 1, or a missing hand-back looks like a bad record.
test('T24 spec 9: CLI exits 2 when the file cannot be read', () => {
	const missing = path.join(kitTemp.makeTemp('handoff-test-'), 'no-such-file.txt');
	const res = cli(['check', missing]);
	assert.equal(res.status, 2);
});

// why: check - must read the record from stdin, or a hand-back piped into the gate is refused as unreadable.
test('T25 spec 9: CLI check - reads the record from stdin', () => {
	const res = cli(['check', '-'], record(ROLE, finding('K1')));
	assert.equal(res.status, 0, res.stderr);
});
