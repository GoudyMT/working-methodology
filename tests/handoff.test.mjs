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
const KEYS = ['id', 'severity', 'status', 'where', 'claim', 'proof', 'fix'];
const FIELDS = { id: 'K1', severity: 'low', status: 'red', where: 'tests/a.test.mjs:1', claim: 'c', proof: 'p', fix: '-' };
const finding = (id, over = {}) => JSON.stringify({ ...FIELDS, id, ...over });
const without = (k) => { const o = { ...FIELDS }; delete o[k]; return JSON.stringify(o); };
const record = (...lines) => ['Prose the model wrote, with severity: high in it.', 'RECORD:', ...lines].join('\n');
// Every error that names a record line starts with "line N: " (N counted from 1 after RECORD:).
const atLine = (errors, n) => errors.some((e) => new RegExp(`^line ${n}: `).test(e));
const cli = (args, input) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', input });
const tempDir = () => kitTemp.makeTemp('handoff-test-');
const writeRecord = (body) => {
	const file = path.join(tempDir(), 'record.txt');
	fs.writeFileSync(file, body);
	return file;
};

// why: a prose-only hand-back with no RECORD: line must fail, or a model's free text passes the gate unread.
test('T1 spec 1: text with no RECORD line is an error', () => {
	const r = check('Just prose, no record.');
	assert.equal(r.ok, false);
	assert.ok(r.errors.some((e) => /RECORD/.test(e)), JSON.stringify(r.errors));
});

// why: an empty RECORD: block must fail and say it is empty, or a model that wrote the marker and nothing else passes.
test('T2 spec 9: an empty RECORD: block is an error that says empty', () => {
	const r = check(record());
	assert.equal(r.ok, false);
	assert.ok(r.errors.some((e) => /empty/i.test(e)), JSON.stringify(r.errors));
});

// why: blank lines between record lines must be skipped, or a tidy hand-back with a gap is refused for nothing.
test('T3 spec 1: blank lines after RECORD: are skipped', () => {
	const r = check(record(ROLE, '', finding('K1'), ''));
	assert.equal(r.ok, true, JSON.stringify(r.errors));
	assert.equal(r.findings.length, 1);
});

// why: a valid role line plus one finding must pass, or the gate refuses every good record.
test('T4 spec 2: a role line then a finding is ok', () => {
	const r = check(record(ROLE, finding('K1')));
	assert.equal(r.ok, true, JSON.stringify(r.errors));
});

// why: a finding with no role line at all must error on line 1, or a bare finding list passes with no build named.
test('T5 spec 9: findings with no role line at all are an error naming line 1', () => {
	const r = check(record(finding('K1')));
	assert.equal(r.ok, false);
	assert.ok(atLine(r.errors, 1), JSON.stringify(r.errors));
});

// why: a finding placed before the role line must be an error naming line 1, or a record with no role is read as one.
test('T6 spec 2: a finding before the role line is an error naming line 1', () => {
	const r = check(record(finding('K1'), ROLE));
	assert.equal(r.ok, false);
	assert.ok(atLine(r.errors, 1), JSON.stringify(r.errors));
});

// why: a commit of 6 characters must be refused, or a short stub hash ties a finding to no build.
test('T7 spec 3: a 6-character commit is an error on line 1', () => {
	const r = check(record('{"role": "builder", "commit": "abc123"}', finding('K1')));
	assert.equal(r.ok, false);
	assert.ok(atLine(r.errors, 1), JSON.stringify(r.errors));
});

// why: a 40-character commit must pass, or a full SHA-1 hash is refused by the gate.
test('T8 spec 2: a 40-character commit is ok', () => {
	const r = check(record(`{"role": "builder", "commit": "${'a'.repeat(40)}"}`, finding('K1')));
	assert.equal(r.ok, true, JSON.stringify(r.errors));
});

// why: a 41-character commit must be refused, or a hash longer than a SHA-1 passes as a real commit.
test('T9 spec 2: a 41-character commit is an error on line 1', () => {
	const r = check(record(`{"role": "builder", "commit": "${'a'.repeat(41)}"}`, finding('K1')));
	assert.equal(r.ok, false);
	assert.ok(atLine(r.errors, 1), JSON.stringify(r.errors));
});

// why: a commit with non-hex characters must be refused, or a made-up word passes as a commit id.
test('T10 spec 2: a non-hex commit is an error on line 1', () => {
	const r = check(record('{"role": "builder", "commit": "zzzzzzz"}', finding('K1')));
	assert.equal(r.ok, false);
	assert.ok(atLine(r.errors, 1), JSON.stringify(r.errors));
});

// why: an empty role must be refused, or a role line with no name is taken as a signed hand-back.
test('T11 spec 2: an empty role is an error naming role on line 1', () => {
	const r = check(record('{"role": "", "commit": "abc1234"}', finding('K1')));
	assert.equal(r.ok, false);
	assert.ok(r.errors.some((e) => /^line 1: .*`role`/.test(e)), JSON.stringify(r.errors));
});

// why: an empty commit must be refused, or a role line with a blank commit passes with no build named.
test('T12 spec 2: an empty commit is an error naming commit on line 1', () => {
	const r = check(record('{"role": "builder", "commit": ""}', finding('K1')));
	assert.equal(r.ok, false);
	assert.ok(r.errors.some((e) => /^line 1: .*`commit`/.test(e)), JSON.stringify(r.errors));
});

// why: each finding key must be present and non-empty, or a finding missing a field passes as complete. One test per key.
for (const k of KEYS) {
	// why: a finding missing its `${k}` key must fail naming that key on line 2, or a partial finding passes as complete.
	test(`R1 spec 3: a finding missing \`${k}\` is an error on line 2`, () => {
		const r = check(record(ROLE, without(k)));
		assert.equal(r.ok, false);
		assert.ok(r.errors.some((e) => new RegExp(`^line 2: missing \`${k}\``).test(e)), JSON.stringify(r.errors));
	});

	// why: a finding with an empty `${k}` string must fail naming that key on line 2, or a blank field passes as filled in.
	test(`R1 spec 3: a finding with an empty \`${k}\` is an error on line 2`, () => {
		const r = check(record(ROLE, finding('K1', { [k]: '' })));
		assert.equal(r.ok, false);
		assert.ok(r.errors.some((e) => new RegExp(`^line 2: empty \`${k}\``).test(e)), JSON.stringify(r.errors));
	});
}

// why: a non-string id must be refused, or a number passes where the spec wants a string key.
test('R1 spec 3: a finding with a non-string id is an error naming id on line 2', () => {
	const r = check(record(ROLE, finding('K1', { id: 5 })));
	assert.equal(r.ok, false);
	assert.ok(r.errors.some((e) => /^line 2: .*`id`/.test(e)), JSON.stringify(r.errors));
});

// why: a severity outside critical/high/medium/low must be refused on line 2, or the prose-drop of a severity goes unseen.
test('T13 spec 3: a severity outside the four levels is an error naming line 2', () => {
	const r = check(record(ROLE, finding('K1', { severity: 'urgent' })));
	assert.equal(r.ok, false);
	assert.ok(atLine(r.errors, 2), JSON.stringify(r.errors));
});

// why: each of the four severity levels must pass, or a valid critical or medium finding is refused by mistake.
test('T14 spec 3: all four severities are accepted', () => {
	const lines = ['critical', 'high', 'medium', 'low'].map((s, i) => finding(`K${i}`, { severity: s }));
	const r = check(record(ROLE, ...lines));
	assert.equal(r.ok, true, JSON.stringify(r.errors));
	assert.equal(r.findings.length, 4);
});

// why: where "-" and fix "-" must pass, or a finding with no path or no fix is refused when the spec allows it.
test('T15 spec 3: where and fix may each be "-"', () => {
	const r = check(record(ROLE, finding('K1', { where: '-', fix: '-' })));
	assert.equal(r.ok, true, JSON.stringify(r.errors));
});

// why: two findings sharing an id must be an error naming the second one's line, or the gate cannot tell them apart.
test('T16 spec 6: a duplicate finding id is an error naming line 3', () => {
	const r = check(record(ROLE, finding('K1'), finding('K1')));
	assert.equal(r.ok, false);
	assert.ok(atLine(r.errors, 3), JSON.stringify(r.errors));
});

// why: a line that is not JSON must be an error naming its line, or a broken line is skipped silently.
test('T17 spec 6: a line that is not JSON is an error naming line 2', () => {
	const r = check(record(ROLE, 'this is not json'));
	assert.equal(r.ok, false);
	assert.ok(atLine(r.errors, 2), JSON.stringify(r.errors));
});

// why: a line that is valid JSON but of no known shape must be an error, or a typo'd key becomes an ignored line.
test('T18 spec 6: an unknown line shape is an error naming line 2', () => {
	const r = check(record(ROLE, '{"foo": 1}'));
	assert.equal(r.ok, false);
	assert.ok(atLine(r.errors, 2), JSON.stringify(r.errors));
});

// why: a record with only a role line must fail and say it is empty, or a bare role passes as a finished hand-back.
test('T19 spec 7: a role line alone is never ok and says the record is empty', () => {
	const r = check(record(ROLE));
	assert.equal(r.ok, false);
	assert.ok(r.errors.some((e) => /empty/i.test(e)), JSON.stringify(r.errors));
});

// why: a notChecked line with an empty string must be an error on line 3, or a blank gap is counted as an honest disclosure.
test('T20 spec 4: a notChecked line with an empty string is an error on line 3', () => {
	const r = check(record(ROLE, finding('K1'), '{"notChecked": ""}'));
	assert.equal(r.ok, false);
	assert.ok(atLine(r.errors, 2), JSON.stringify(r.errors));
});

// why: a notChecked given as a number must be refused, or a count typed as a value passes as a disclosure.
test('T21 spec 4: a numeric notChecked is an error naming notChecked on line 3', () => {
	const r = check(record(ROLE, finding('K1'), '{"notChecked": 5}'));
	assert.equal(r.ok, false);
	assert.ok(r.errors.some((e) => /^line 3: .*`notChecked`/.test(e)), JSON.stringify(r.errors));
});

// why: a note line with no writer must be an error naming writer on line 2, or an anonymous note is accepted into the record.
test('T22 spec 4: a note line without a writer is an error naming writer on line 2', () => {
	const r = check(record(ROLE, '{"note": "looks fine"}'));
	assert.equal(r.ok, false);
	assert.ok(r.errors.some((e) => /^line 2: missing `writer`/.test(e)), JSON.stringify(r.errors));
});

// why: an empty note text with a writer must be refused, or a blank note is counted as a finished note.
test('T23 spec 4: a note with an empty text is an error naming note on line 3', () => {
	const r = check(record(ROLE, finding('K1'), '{"note": "", "writer": "tester"}'));
	assert.equal(r.ok, false);
	assert.ok(r.errors.some((e) => /^line 3: .*`note`/.test(e)), JSON.stringify(r.errors));
});

// why: an empty writer must be refused, or a note with no name behind it is accepted as signed.
test('T24 spec 4: a note with an empty writer is an error naming writer on line 3', () => {
	const r = check(record(ROLE, finding('K1'), '{"note": "ok", "writer": ""}'));
	assert.equal(r.ok, false);
	assert.ok(r.errors.some((e) => /^line 3: .*`writer`/.test(e)), JSON.stringify(r.errors));
});

// why: the result must carry findings in order and counts for notChecked and notes, or the CLI and callers read the wrong fields.
test('T25 spec 4-5: check returns findings in order, notChecked and notes counts', () => {
	const r = check(record(ROLE, finding('K1'), finding('K2'), '{"notChecked": "the drag path"}', '{"note": "ok", "writer": "tester"}'));
	assert.equal(r.ok, true, JSON.stringify(r.errors));
	assert.deepEqual(r.findings.map((f) => f.id), ['K1', 'K2']);
	assert.equal(r.notChecked, 1);
	assert.equal(r.notes, 1);
	assert.ok(Array.isArray(r.errors));
});

// why: ok must be false when any error is present, even with valid findings, or a half-broken record ships as passing.
test('T26 spec 8: a valid finding plus one bad line is not ok and names line 3', () => {
	const r = check(record(ROLE, finding('K1'), 'junk'));
	assert.equal(r.ok, false);
	assert.equal(r.findings.length, 1);
	assert.ok(atLine(r.errors, 3), JSON.stringify(r.errors));
});

// why: a claim holding `a | b | c` must come back unchanged, or the pipe parser splits it and the claim is lost.
test('T27 spec 10: a claim with pipes comes back unchanged', () => {
	const r = check(record(ROLE, finding('K1', { claim: 'a | b | c' })));
	assert.equal(r.ok, true, JSON.stringify(r.errors));
	assert.equal(r.findings[0].claim, 'a | b | c');
});

// why: a pipe in any other field must be kept too, or a where or proof with a pipe is cut and mis-scored.
test('T28 spec 3: a pipe inside where and proof is kept exactly', () => {
	const r = check(record(ROLE, finding('K1', { where: 'a.mjs:1 | b.mjs:2', proof: 'x | y' })));
	assert.equal(r.ok, true, JSON.stringify(r.errors));
	assert.equal(r.findings[0].where, 'a.mjs:1 | b.mjs:2');
	assert.equal(r.findings[0].proof, 'x | y');
});

// why: a pipe in id, status and fix must be kept too, or a split field silently breaks the finding's identity.
test('T29 spec 3: a pipe inside id, status and fix is kept exactly', () => {
	const r = check(record(ROLE, finding('K|1', { status: 'red|open', fix: 'a|b' })));
	assert.equal(r.ok, true, JSON.stringify(r.errors));
	assert.equal(r.findings[0].id, 'K|1');
	assert.equal(r.findings[0].status, 'red|open');
	assert.equal(r.findings[0].fix, 'a|b');
});

// why: a valid record on the CLI must exit 0 and print one line of counts, or the kit's gate step cannot tell it passed.
test('T30 spec 9: CLI exits 0 on a valid record and prints one line of counts', () => {
	const res = cli(['check', writeRecord(record(ROLE, finding('K1'), finding('K2')))]);
	assert.equal(res.status, 0, res.stderr);
	const lines = res.stdout.trim().split('\n');
	assert.equal(lines.length, 1);
	assert.ok(/\b2\b/.test(lines[0]), lines[0]);
});

// why: the CLI must never change or delete the file it reads, or a re-run of the gate reads a different record.
test('T31 spec 9: CLI leaves the file it reads unchanged on the ok path', () => {
	const file = writeRecord(record(ROLE, finding('K1')));
	const before = fs.readFileSync(file, 'utf8');
	cli(['check', file]);
	assert.equal(fs.readFileSync(file, 'utf8'), before);
});

// why: the CLI must leave the file unchanged on the error path too, or a failed gate destroys the hand-back it checked.
test('T32 spec 9: CLI leaves the file it reads unchanged on the error path', () => {
	const file = writeRecord(record(ROLE, 'not json'));
	const before = fs.readFileSync(file, 'utf8');
	const res = cli(['check', file]);
	assert.equal(res.status, 1);
	assert.equal(fs.readFileSync(file, 'utf8'), before);
	assert.ok(fs.existsSync(file));
});

// why: an invalid record on the CLI must exit 1 with each error on its own stderr line, or the caller cannot read them.
test('T33 spec 9: CLI exits 1 with one stderr line per error', () => {
	const res = cli(['check', writeRecord(record(ROLE, 'not json', finding('K2', { severity: 'urgent' })))]);
	assert.equal(res.status, 1);
	const lines = res.stderr.trim().split('\n');
	assert.equal(lines.length, 2, res.stderr);
	assert.ok(/^line 2: /.test(lines[0]), lines[0]);
	assert.ok(/^line 3: /.test(lines[1]), lines[1]);
});

// why: an invalid record piped on stdin must exit 1 with the error on stderr, or the stdin path reports a bad record as passing.
test('T34 spec 9: CLI check - exits 1 with the error on stderr for a bad record', () => {
	const res = cli(['check', '-'], record(ROLE, finding('K1', { severity: 'urgent' })));
	assert.equal(res.status, 1);
	assert.ok(/^line 2: /m.test(res.stderr), res.stderr);
});

// why: a file that cannot be read must exit 2, not 0 or 1, or a missing hand-back looks like a bad record.
test('T35 spec 9: CLI exits 2 when the file cannot be read', () => {
	const missing = path.join(tempDir(), 'no-such-file.txt');
	const res = cli(['check', missing]);
	assert.equal(res.status, 2);
});

// why: a directory path is not a readable hand-back, so it must exit 2, or a folder passed by mistake reads as a bad record.
test('T36 spec 9: CLI exits 2 when the path is a directory', () => {
	const res = cli(['check', tempDir()]);
	assert.equal(res.status, 2);
});

// why: check - must read the record from stdin, or a hand-back piped into the gate is refused as unreadable.
test('T37 spec 9: CLI check - reads the record from stdin', () => {
	const res = cli(['check', '-'], record(ROLE, finding('K1')));
	assert.equal(res.status, 0, res.stderr);
});
