// K300/K301 (build 24): the handoff record and its gate. Over 3 to 5 handoffs on a small model, the prose dropped
// severities and paths, and the pipe parser split claims that held a `|`. The gate reads a hand-back's RECORD: block
// and refuses any record that is malformed, empty, or missing a finding's keys. Nothing here calls a model.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { createRequire } from 'node:module';
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

// why: catches a prose-only hand-back with no RECORD line passing the gate unread.
test('T1 spec 1: text with no RECORD line is an error', () => {
	const r = check('Just prose, no record.');
	assert.equal(r.ok, false);
	assert.ok(r.errors.some((e) => /RECORD/.test(e)), JSON.stringify(r.errors));
});

// why: catches an empty RECORD block passing as a finished hand-back with nothing in it.
test('T2 spec 9: an empty RECORD: block is an error that says empty', () => {
	const r = check(record());
	assert.equal(r.ok, false);
	assert.ok(r.errors.some((e) => /empty/i.test(e)), JSON.stringify(r.errors));
});

// why: catches a tidy hand-back with a blank line between its records refused for no reason.
test('T3 spec 1: blank lines after RECORD: are skipped', () => {
	const r = check(record(ROLE, '', finding('K1'), ''));
	assert.equal(r.ok, true, JSON.stringify(r.errors));
	assert.equal(r.findings.length, 1);
});

// why: catches a good role line and one finding refused by the gate, which would block every record.
test('T4 spec 2: a role line then a finding is ok', () => {
	const r = check(record(ROLE, finding('K1')));
	assert.equal(r.ok, true, JSON.stringify(r.errors));
});

// why: catches a bare finding list with no role line passing with no build named anywhere.
test('T5 spec 9: findings with no role line at all are an error naming line 1', () => {
	const r = check(record(finding('K1')));
	assert.equal(r.ok, false);
	assert.ok(atLine(r.errors, 1), JSON.stringify(r.errors));
});

// why: catches a finding placed before the role line being read as the record's role.
test('T6 spec 2: a finding before the role line is an error naming line 1', () => {
	const r = check(record(finding('K1'), ROLE));
	assert.equal(r.ok, false);
	assert.ok(atLine(r.errors, 1), JSON.stringify(r.errors));
});

// why: catches a six-character commit passing as a build id when a stub hash ties a finding to nothing.
test('T7 spec 3: a 6-character commit is an error on line 1', () => {
	const r = check(record('{"role": "builder", "commit": "abc123"}', finding('K1')));
	assert.equal(r.ok, false);
	assert.ok(atLine(r.errors, 1), JSON.stringify(r.errors));
});

// why: catches a full 40-character commit hash being refused by the gate as too long to be valid.
test('T8 spec 2: a 40-character commit is ok', () => {
	const r = check(record(`{"role": "builder", "commit": "${'a'.repeat(40)}"}`, finding('K1')));
	assert.equal(r.ok, true, JSON.stringify(r.errors));
});

// why: catches a 41-character commit passing as a real commit, which is longer than any SHA-1 hash.
test('T9 spec 2: a 41-character commit is an error on line 1', () => {
	const r = check(record(`{"role": "builder", "commit": "${'a'.repeat(41)}"}`, finding('K1')));
	assert.equal(r.ok, false);
	assert.ok(atLine(r.errors, 1), JSON.stringify(r.errors));
});

// why: catches a non-hex word such as zzzzzzz passing as a commit id, which names no real build.
test('T10 spec 2: a non-hex commit is an error on line 1', () => {
	const r = check(record('{"role": "builder", "commit": "zzzzzzz"}', finding('K1')));
	assert.equal(r.ok, false);
	assert.ok(atLine(r.errors, 1), JSON.stringify(r.errors));
});

// why: catches an empty role passing as a signed hand-back with no name on it at all.
test('T11 spec 2: an empty role is an error naming role on line 1', () => {
	const r = check(record('{"role": "", "commit": "abc1234"}', finding('K1')));
	assert.equal(r.ok, false);
	assert.ok(r.errors.some((e) => /^line 1: .*`role`/.test(e)), JSON.stringify(r.errors));
});

// why: catches a blank commit passing the role line with no build named for the findings below it.
test('T12 spec 2: an empty commit is an error naming commit on line 1', () => {
	const r = check(record('{"role": "builder", "commit": ""}', finding('K1')));
	assert.equal(r.ok, false);
	assert.ok(r.errors.some((e) => /^line 1: .*`commit`/.test(e)), JSON.stringify(r.errors));
});

// why: catches a finding that is missing a field being counted as complete and passed on by the gate.
for (const k of KEYS) {
	// why: catches a partial finding passing as complete when its key is missing from the line.
	test(`R1 spec 3: a finding missing '${k}' is an error on line 2`, () => {
		const r = check(record(ROLE, without(k)));
		assert.equal(r.ok, false);
		assert.ok(r.errors.some((e) => new RegExp(`^line 2: missing \`${k}\``).test(e)), JSON.stringify(r.errors));
	});

	// why: catches a blank field passing as filled in when the key is there but its value is empty.
	test(`R1 spec 3: a finding with an empty '${k}' is an error on line 2`, () => {
		const r = check(record(ROLE, finding('K1', { [k]: '' })));
		assert.equal(r.ok, false);
		assert.ok(r.errors.some((e) => new RegExp(`^line 2: empty \`${k}\``).test(e)), JSON.stringify(r.errors));
	});
}

// why: catches a numeric id passing the gate where the spec requires a string key for each finding.
test('R1 spec 3: a finding with a non-string id is an error naming id on line 2', () => {
	const r = check(record(ROLE, finding('K1', { id: 5 })));
	assert.equal(r.ok, false);
	assert.ok(r.errors.some((e) => /^line 2: .*`id`/.test(e)), JSON.stringify(r.errors));
});

// why: catches a severity outside the four levels slipping through, which hides a prose-dropped rating.
test('T13 spec 3: a severity outside the four levels is an error naming line 2', () => {
	const r = check(record(ROLE, finding('K1', { severity: 'urgent' })));
	assert.equal(r.ok, false);
	assert.ok(atLine(r.errors, 2), JSON.stringify(r.errors));
});

// why: catches a valid critical or medium finding being refused by mistake when the gate is tightened.
test('T14 spec 3: all four severities are accepted', () => {
	const lines = ['critical', 'high', 'medium', 'low'].map((s, i) => finding(`K${i}`, { severity: s }));
	const r = check(record(ROLE, ...lines));
	assert.equal(r.ok, true, JSON.stringify(r.errors));
	assert.equal(r.findings.length, 4);
});

// why: catches a finding with no path or no fix being refused when the spec explicitly allows a dash there.
test('T15 spec 3: where and fix may each be "-"', () => {
	const r = check(record(ROLE, finding('K1', { where: '-', fix: '-' })));
	assert.equal(r.ok, true, JSON.stringify(r.errors));
});

// why: catches two findings sharing one id, which the gate cannot tell apart when it reads them back.
test('T16 spec 6: a duplicate finding id is an error naming line 3', () => {
	const r = check(record(ROLE, finding('K1'), finding('K1')));
	assert.equal(r.ok, false);
	assert.ok(atLine(r.errors, 3), JSON.stringify(r.errors));
});

// why: catches a broken JSON line being skipped silently, so a finding quietly goes missing from the record.
test('T17 spec 6: a line that is not JSON is an error naming line 2', () => {
	const r = check(record(ROLE, 'this is not json'));
	assert.equal(r.ok, false);
	assert.ok(atLine(r.errors, 2), JSON.stringify(r.errors));
});

// why: catches a valid JSON line of unknown shape being ignored, which hides a typo in a key name.
test('T18 spec 6: an unknown line shape is an error naming line 2', () => {
	const r = check(record(ROLE, '{"foo": 1}'));
	assert.equal(r.ok, false);
	assert.ok(atLine(r.errors, 2), JSON.stringify(r.errors));
});

// why: catches a record holding only a role line passing as a finished hand-back with no content in it.
test('T19 spec 7: a role line alone is never ok and says the record is empty', () => {
	const r = check(record(ROLE));
	assert.equal(r.ok, false);
	assert.ok(r.errors.some((e) => /empty/i.test(e)), JSON.stringify(r.errors));
});

// why: catches a notChecked line with a blank string counted as an honest disclosure of a gap.
test('T20 spec 4: a notChecked line with an empty string is an error on line 3', () => {
	const r = check(record(ROLE, finding('K1'), '{"notChecked": ""}'));
	assert.equal(r.ok, false);
	assert.ok(atLine(r.errors, 3), JSON.stringify(r.errors));
});

// why: catches a notChecked typed as a number passing as a disclosure when it names no check at all.
test('T21 spec 4: a numeric notChecked is an error naming notChecked on line 3', () => {
	const r = check(record(ROLE, finding('K1'), '{"notChecked": 5}'));
	assert.equal(r.ok, false);
	assert.ok(r.errors.some((e) => /^line 3: .*`notChecked`/.test(e)), JSON.stringify(r.errors));
});

// why: catches an anonymous note without a writer being accepted into the record as if it were signed.
test('T22 spec 4: a note line without a writer is an error naming writer on line 2', () => {
	const r = check(record(ROLE, '{"note": "looks fine"}'));
	assert.equal(r.ok, false);
	assert.ok(r.errors.some((e) => /^line 2: missing `writer`/.test(e)), JSON.stringify(r.errors));
});

// why: catches a blank note text counted as a finished note with nothing in it to read.
test('T23 spec 4: a note with an empty text is an error naming note on line 3', () => {
	const r = check(record(ROLE, finding('K1'), '{"note": "", "writer": "tester"}'));
	assert.equal(r.ok, false);
	assert.ok(r.errors.some((e) => /^line 3: .*`note`/.test(e)), JSON.stringify(r.errors));
});

// why: catches a note whose writer is blank being accepted as signed when no name stands behind it.
test('T24 spec 4: a note with an empty writer is an error naming writer on line 3', () => {
	const r = check(record(ROLE, finding('K1'), '{"note": "ok", "writer": ""}'));
	assert.equal(r.ok, false);
	assert.ok(r.errors.some((e) => /^line 3: .*`writer`/.test(e)), JSON.stringify(r.errors));
});

// why: catches the result missing its findings in order or its notChecked and notes counts that callers read.
test('T25 spec 4-5: check returns findings in order, notChecked and notes counts', () => {
	const r = check(record(ROLE, finding('K1'), finding('K2'), '{"notChecked": "the drag path"}', '{"note": "ok", "writer": "tester"}'));
	assert.equal(r.ok, true, JSON.stringify(r.errors));
	assert.deepEqual(r.findings.map((f) => f.id), ['K1', 'K2']);
	assert.equal(r.notChecked, 1);
	assert.equal(r.notes, 1);
	assert.ok(Array.isArray(r.errors));
});

// why: catches a half-broken record shipping as ok because its one good finding hides the bad line.
test('T26 spec 8: a valid finding plus one bad line is not ok and names line 3', () => {
	const r = check(record(ROLE, finding('K1'), 'junk'));
	assert.equal(r.ok, false);
	assert.equal(r.findings.length, 1);
	assert.ok(atLine(r.errors, 3), JSON.stringify(r.errors));
});

// why: catches a claim with pipes split by the pipe parser, which loses the rest of the claim text.
test('T27 spec 10: a claim with pipes comes back unchanged', () => {
	const r = check(record(ROLE, finding('K1', { claim: 'a | b | c' })));
	assert.equal(r.ok, true, JSON.stringify(r.errors));
	assert.equal(r.findings[0].claim, 'a | b | c');
});

// why: catches a pipe inside where or proof being cut off, which mis-scores the finding it belongs to.
test('T28 spec 3: a pipe inside where and proof is kept exactly', () => {
	const r = check(record(ROLE, finding('K1', { where: 'a.mjs:1 | b.mjs:2', proof: 'x | y' })));
	assert.equal(r.ok, true, JSON.stringify(r.errors));
	assert.equal(r.findings[0].where, 'a.mjs:1 | b.mjs:2');
	assert.equal(r.findings[0].proof, 'x | y');
});

// why: catches a pipe inside id, status or fix splitting the field and breaking that finding's identity.
test('T29 spec 3: a pipe inside id, status and fix is kept exactly', () => {
	const r = check(record(ROLE, finding('K|1', { status: 'red|open', fix: 'a|b' })));
	assert.equal(r.ok, true, JSON.stringify(r.errors));
	assert.equal(r.findings[0].id, 'K|1');
	assert.equal(r.findings[0].status, 'red|open');
	assert.equal(r.findings[0].fix, 'a|b');
});

// why: catches a valid record on the CLI failing to exit 0, so the kit's gate step cannot tell it passed.
test('T30 spec 9: CLI exits 0 on a valid record and prints one line of counts', () => {
	const res = cli(['check', writeRecord(record(ROLE, finding('K1'), finding('K2')))]);
	assert.equal(res.status, 0, res.stderr);
	const lines = res.stdout.trim().split('\n');
	assert.equal(lines.length, 1);
	assert.ok(/\b2\b/.test(lines[0]), lines[0]);
});

// why: catches the CLI rewriting the file it reads on the ok path, so a second run reads a different record.
test('T31 spec 9: CLI leaves the file it reads unchanged on the ok path', () => {
	const file = writeRecord(record(ROLE, finding('K1')));
	const before = fs.readFileSync(file, 'utf8');
	cli(['check', file]);
	assert.equal(fs.readFileSync(file, 'utf8'), before);
});

// why: catches a failed gate destroying or changing the hand-back it was asked to check.
test('T32 spec 9: CLI leaves the file it reads unchanged on the error path', () => {
	const file = writeRecord(record(ROLE, 'not json'));
	const before = fs.readFileSync(file, 'utf8');
	const res = cli(['check', file]);
	assert.equal(res.status, 1);
	assert.equal(fs.readFileSync(file, 'utf8'), before);
	assert.ok(fs.existsSync(file));
});

// why: catches CLI errors merged onto one stderr line, which the caller then cannot read one by one.
test('T33 spec 9: CLI exits 1 with one stderr line per error', () => {
	const res = cli(['check', writeRecord(record(ROLE, 'not json', finding('K2', { severity: 'urgent' })))]);
	assert.equal(res.status, 1);
	const lines = res.stderr.trim().split('\n');
	assert.equal(lines.length, 2, res.stderr);
	assert.ok(/^line 2: /.test(lines[0]), lines[0]);
	assert.ok(/^line 3: /.test(lines[1]), lines[1]);
});

// why: catches a bad record piped on stdin being reported as passing, which lets it through the gate.
test('T34 spec 9: CLI check - exits 1 with the error on stderr for a bad record', () => {
	const res = cli(['check', '-'], record(ROLE, finding('K1', { severity: 'urgent' })));
	assert.equal(res.status, 1);
	assert.ok(/^line 2: /m.test(res.stderr), res.stderr);
});

// why: catches a missing hand-back file being read as a bad record instead of an unreadable path.
test('T35 spec 9: CLI exits 2 when the file cannot be read', () => {
	const missing = path.join(tempDir(), 'no-such-file.txt');
	const res = cli(['check', missing]);
	assert.equal(res.status, 2);
});

// why: catches a folder passed by mistake being read as a bad record rather than an unreadable path.
test('T36 spec 9: CLI exits 2 when the path is a directory', () => {
	const res = cli(['check', tempDir()]);
	assert.equal(res.status, 2);
});

// why: catches the check dash path refusing a valid record piped in on stdin as unreadable input.
test('T37 spec 9: CLI check - reads the record from stdin', () => {
	const res = cli(['check', '-'], record(ROLE, finding('K1')));
	assert.equal(res.status, 0, res.stderr);
});

// why: catches the gate failing on a Windows junction path to handoff.mjs, which the hooks use on Windows.
test('N1 spec 9: CLI run through a Windows junction still checks a malformed record', { windows: 'also' }, () => {
	const linkDir = path.join(tempDir(), 'link');
	fs.symlinkSync(path.dirname(CLI), linkDir, 'junction');
	const res = spawnSync(process.execPath, [path.join(linkDir, 'handoff.mjs'), 'check', writeRecord(record(ROLE, 'not json'))], { encoding: 'utf8' });
	assert.equal(res.status, 1, res.stderr);
	assert.ok(/^line 2: /m.test(res.stderr), res.stderr);
});

// why: catches a note line that also carries finding keys passing while silently dropping the finding.
test('N2 spec 6: a note line that holds finding keys is an unknown line shape on line 3', () => {
	const r = check(record(ROLE, finding('K1'), '{"note": "x", "writer": "w", "id": "K9"}'));
	assert.equal(r.ok, false);
	assert.ok(atLine(r.errors, 3), JSON.stringify(r.errors));
});

// why: catches a notChecked line that also carries finding keys passing while silently dropping the finding.
test('N3 spec 6: a notChecked line that holds finding keys is an unknown line shape on line 3', () => {
	const r = check(record(ROLE, finding('K1'), '{"notChecked": "x", "severity": "low"}'));
	assert.equal(r.ok, false);
	assert.ok(atLine(r.errors, 3), JSON.stringify(r.errors));
});

// why: catches a quoted example record in the prose being read as the real hand-back instead of the last one.
test('N4 spec 4: when the text holds two RECORD: lines, the last one starts the record', () => {
	const text = ['Example of a hand-back:', 'RECORD:', finding('KX'), 'Now the real one:', 'RECORD:', ROLE, finding('K2')].join('\n');
	const r = check(text);
	assert.equal(r.ok, true, JSON.stringify(r.errors));
	assert.deepEqual(r.findings.map((f) => f.id), ['K2']);
});

// why: catches a bad role line using up the role slot, so the next finding is wrongly judged as the role.
test('N5 spec 2: a non-JSON role line uses the role slot with no missing role error on line 2', () => {
	const r = check(record('not json', finding('K1')));
	assert.equal(r.ok, false);
	assert.ok(atLine(r.errors, 1), JSON.stringify(r.errors));
	assert.ok(!r.errors.some((e) => /missing `role`/.test(e)), JSON.stringify(r.errors));
	assert.ok(!atLine(r.errors, 2), JSON.stringify(r.errors));
});

// why: catches a null record line crashing the gate instead of being reported as an error on its line.
test('N6 spec 6: a record line that is null is an error on line 2, not a crash', () => {
	const r = check(record(ROLE, 'null'));
	assert.equal(r.ok, false);
	assert.ok(atLine(r.errors, 2), JSON.stringify(r.errors));
});

// why: catches a numeric record line crashing the gate instead of being reported as an error on its line.
test('N7 spec 6: a record line that is a number is an error on line 2, not a crash', () => {
	const r = check(record(ROLE, '5'));
	assert.equal(r.ok, false);
	assert.ok(atLine(r.errors, 2), JSON.stringify(r.errors));
});

// why: catches a RECORD: marker padded with spaces, or a whitespace-only line, being refused by the gate.
test('N8 spec 1: a RECORD: line with spaces around it works and a whitespace-only line is skipped', () => {
	const text = ['Prose.', '   RECORD:   ', ROLE, '   ', finding('K1')].join('\n');
	const r = check(text);
	assert.equal(r.ok, true, JSON.stringify(r.errors));
	assert.equal(r.findings.length, 1);
});

// why: catches a record with only a role line and one notChecked line refused as empty when it is complete.
test('N9 spec 7: a role line and one notChecked line is ok', () => {
	const r = check(record(ROLE, '{"notChecked": "the drag path"}'));
	assert.equal(r.ok, true, JSON.stringify(r.errors));
	assert.equal(r.notChecked, 1);
});

// why: catches a duplicate id with a newline in it printed as two lines, which breaks the one-line-per-error form.
test('N10 spec 6: a duplicate id holding a newline gives a single-line error on line 3', () => {
	const r = check(record(ROLE, finding('K\n1'), finding('K\n1')));
	assert.equal(r.ok, false);
	assert.ok(atLine(r.errors, 3), JSON.stringify(r.errors));
	assert.ok(r.errors.every((e) => !e.includes('\n')), JSON.stringify(r.errors));
});

// why: catches a text with two complete RECORD blocks being accepted, which hides the second hand-back.
test('N11 spec 4: two RECORD: blocks that both hold a role line are refused as two records', () => {
	const text = ['Prose.', 'RECORD:', ROLE, finding('K1'), 'Then again:', 'RECORD:', ROLE, finding('K2')].join('\n');
	const r = check(text);
	assert.equal(r.ok, false);
	assert.ok(r.errors.some((e) => /(two|2|more than one) records?/i.test(e)), JSON.stringify(r.errors));
});

// why: catches the handoff module printing or failing on import, which would break every caller that loads it.
test('N12 spec 9: importing the module prints nothing and exits 0', () => {
	const res = spawnSync(process.execPath, ['-e', `import(${JSON.stringify(pathToFileURL(CLI).href)})`], { encoding: 'utf8' });
	assert.equal(res.status, 0, res.stderr);
	assert.equal(res.stdout, '');
	assert.equal(res.stderr, '');
});

// why: catches a role line with one note line being refused as empty when the note is a complete record entry.
test('N13 spec 4: a record holding only a role line and one note line passes', () => {
	const r = check(record(ROLE, '{"note": "looks fine", "writer": "tester"}'));
	assert.equal(r.ok, true, JSON.stringify(r.errors));
	assert.equal(r.notes, 1);
});

// why: catches a record whose role line names builder passing as the tester's hand-back when the brief named tester.
test('N14 spec 2: a role line that differs from the expected role is an error naming role on line 1', () => {
	const r = check(record('{"role": "builder", "commit": "158ec54"}', finding('K1')), { role: 'tester', commit: '158ec54' });
	assert.equal(r.ok, false);
	assert.ok(r.errors.some((e) => /^line 1: .*`role`/.test(e)), JSON.stringify(r.errors));
});

// why: catches a record whose commit is not the expected one passing when the brief named a different build.
test('N15 spec 2: a commit that is not the expected commit is an error naming commit on line 1', () => {
	const r = check(record('{"role": "tester", "commit": "abc1234"}', finding('K1')), { role: 'tester', commit: '158ec54' });
	assert.equal(r.ok, false);
	assert.ok(r.errors.some((e) => /^line 1: .*`commit`/.test(e)), JSON.stringify(r.errors));
});

// why: catches matching role and commit values being refused, which would block every correct hand-back.
test('N16 spec 2: matching role and a commit that extends the expected prefix are ok', () => {
	const r = check(record('{"role": "tester", "commit": "158ec5411234567"}', finding('K1')), { role: 'tester', commit: '158ec54' });
	assert.equal(r.ok, true, JSON.stringify(r.errors));
});

// why: catches check(text) with no expectations changing behaviour when the new expectation argument is absent.
test('N17 spec 2: check with no expectations still accepts a record with any role and commit', () => {
	const r = check(record('{"role": "tester", "commit": "abc1234"}', finding('K1')));
	assert.equal(r.ok, true, JSON.stringify(r.errors));
});

// why: catches the CLI passing a commit mismatch with --role and --commit, so a wrong brief exits zero.
test('N18 spec 9: CLI check with --role and --commit exits 1 on a mismatch', () => {
	const file = writeRecord(record('{"role": "builder", "commit": "abc1234"}', finding('K1')));
	const res = cli(['check', file, '--role', 'tester', '--commit', '158ec54']);
	assert.equal(res.status, 1);
	assert.ok(/^line 1: /m.test(res.stderr), res.stderr);
});

// why: catches the CLI refusing a record whose role and commit match the expectation it was given.
test('N19 spec 9: CLI check with matching --role and --commit exits 0', () => {
	const file = writeRecord(record('{"role": "tester", "commit": "158ec54"}', finding('K1')));
	const res = cli(['check', file, '--role', 'tester', '--commit', '158ec54']);
	assert.equal(res.status, 0, res.stderr);
});

// why: catches a finding that ships a whole placeholder as its claim, so an unfilled template line passes the gate
test('a finding whose claim is a whole placeholder is refused as an unfilled placeholder on its line', () => {
	const r = check(record(ROLE, finding('K1', { claim: '<the claim>' })));
	assert.equal(r.ok, false);
	assert.ok(r.errors.some((e) => /^line 2: /.test(e) && e.includes('`claim`') && e.includes('unfilled placeholder')), JSON.stringify(r.errors));
});

// why: catches a claim that only mentions angle brackets inside its text, refused as a placeholder it is not
test('a claim with angle brackets inside its text is not an unfilled placeholder', () => {
	const r = check(record(ROLE, finding('K1', { claim: 'a <b> c' })));
	assert.equal(r.ok, true, JSON.stringify(r.errors));
});

// K301 (build 25): the log-only gate on SubagentHandback. It writes one line when a RECORD: block fails the check, and
// never refuses or throws, so a hand-back always reaches the lead.
const GATE = path.resolve('user/kit-hooks/handoff-gate.cjs');
const gateRepo = () => {
	const repo = kitTemp.makeTemp('handoff-gate-');
	spawnSync('git', ['-C', repo, 'init', '-q', '-b', 'main'], { encoding: 'utf8' });
	return repo;
};
const runGate = (cwd, message) => spawnSync(process.execPath, [GATE], { encoding: 'utf8', input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message }, cwd }) });
const gateLog = (repo) => {
	const f = path.join(repo, '.git', 'kit-guard-open.log');
	return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};

// why: catches a broken RECORD block passing the gate with no line in kit-guard-open.log to show why
test('a hand-back whose RECORD block fails the check is logged with its errors, and never refused', () => {
	const repo = gateRepo();
	const broken = record(JSON.stringify({ role: 'builder', commit: 'abc1234' }), finding('F1', { proof: '' }));
	const r = runGate(repo, broken);
	assert.equal(r.status, 0, r.stderr);
	assert.equal(r.stdout.trim(), '', 'the gate printed a decision; it must only log');
	const rows = gateLog(repo);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].hook, 'handoff-gate');
	assert.ok(!Number.isNaN(Date.parse(rows[0].at)), 'at');
	assert.ok(Array.isArray(rows[0].errors) && rows[0].errors.length > 0, 'errors');
	assert.ok(rows[0].errors.some((e) => /proof/i.test(e)), JSON.stringify(rows[0].errors));
});

// why: catches the gate logging every clean record and burying the real faults in the file
test('a valid RECORD block writes no line to kit-guard-open.log', () => {
	const repo = gateRepo();
	const good = record(JSON.stringify({ role: 'builder', commit: 'abc1234' }), finding('F1'));
	assert.equal(runGate(repo, good).status, 0);
	assert.deepEqual(gateLog(repo), []);
});

// why: catches a prose-only hand-back logged as a broken record on every ask, with no RECORD line to check
test('a hand-back with no RECORD line writes nothing to kit-guard-open.log', () => {
	const repo = gateRepo();
	assert.equal(runGate(repo, 'Prose only, no record here.').status, 0);
	assert.deepEqual(gateLog(repo), []);
});


// why: catches the gate writing its line into a worktree git dir, where the lead never reads it
test('a broken record run in a linked worktree logs to the main repo git dir and not the worktree git dir', () => {
	const repo = gateRepo();
	const g = (...a) => spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' });
	fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
	g('add', 'a.txt');
	g('commit', '-qm', 'init');
	const wt = path.join(kitTemp.makeTemp('handoff-wt-'), 'wt');
	g('worktree', 'add', '-q', wt, '-b', 'feat/wt');
	const broken = record(JSON.stringify({ role: 'builder', commit: 'abc1234' }), finding('F1', { proof: '' }));
	assert.equal(runGate(wt, broken).status, 0);
	assert.equal(gateLog(repo).length, 1, 'no line in the main repo kit-guard-open.log');
	const wtGitDir = path.resolve(wt, spawnSync('git', ['-C', wt, 'rev-parse', '--git-dir'], { encoding: 'utf8' }).stdout.trim());
	assert.equal(fs.existsSync(path.join(wtGitDir, 'kit-guard-open.log')), false, `a log in ${wtGitDir}`);
});


// why: catches a builder, checker or reviewer role file that leaves the gate off its hand-back, so broken records pass unlogged
test('builder, checker and reviewer wire the gate under SubagentHandback beside canary.cjs', () => {
	for (const role of ['builder', 'checker', 'reviewer']) {
		const text = fs.readFileSync(path.resolve('user/agents', `${role}.md`), 'utf8');
		const block = text.slice(text.indexOf('matcher: "SubagentHandback"'));
		const own = block.slice(0, block.indexOf('- matcher:', 1) === -1 ? block.length : block.indexOf('- matcher:', 1));
		assert.match(own, /canary\.cjs/, `${role}: canary.cjs`);
	}
	// The gate rides on canary.cjs, so each role's hook table keeps one entry per matcher.
	const repo = gateRepo();
	const broken = record(JSON.stringify({ role: 'builder', commit: 'abc1234' }), finding('F1', { proof: '' }));
	const r = spawnSync(process.execPath, [path.resolve('user/kit-hooks/canary.cjs')], { encoding: 'utf8', input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', agent_type: 'builder', tool_input: { message: broken }, cwd: repo }) });
	assert.equal(r.status, 0, r.stderr);
	assert.equal(gateLog(repo).length, 1);
});

// why: guards rule:agent-team-adapter (brief template drops the RECORD line or finding keys)
test('the builder and checker brief templates name the RECORD line and the seven finding keys', () => {
	for (const f of ['builder-brief.md', 'checker-brief.md']) {
		const lines = fs.readFileSync(path.resolve('user/skills/agent-team-build/templates', f), 'utf8').split(/\r?\n/);
		const at = lines.findIndex((l) => l === 'RECORD:');
		assert.ok(at >= 0, `${f}: RECORD: line`);
		const window = lines.slice(at, at + 4).join('\n');
		for (const k of ['id', 'severity', 'status', 'where', 'claim', 'proof', 'fix']) assert.match(window, new RegExp(`"${k}"`), `${f}: ${k} within three lines after RECORD:`);
	}
});

// why: guards rule:finding-pipeline (reviewer brief asks for the old pipe rows)
test('the reviewer brief approve.mjs writes asks for a RECORD block with the seven finding keys', () => {
	const line = fs.readFileSync(path.resolve('user/skills/pre-pr-sweep/approve.mjs'), 'utf8').split('\n').find((l) => l.includes('Finding format:'));
	assert.ok(line, 'no Finding format line in approve.mjs');
	assert.match(line, /RECORD:/);
	for (const k of ['id', 'severity', 'status', 'where', 'claim', 'proof', 'fix']) assert.match(line, new RegExp(`\\b${k}\\b`), k);
});

// why: catches a tester renamed by case or suffix passing with an assumed spec, which skips the stop-and-ask rule.
test('a clarity of assumed is refused for any tester-named role, not only the exact word', () => {
	const control = check(record('{"role": "tester", "commit": "abc1234", "clarity": "assumed"}', finding('F1')));
	assert.equal(control.ok, false, 'control: tester with assumed passed');
	for (const role of ['Tester', 'tester-u20']) {
		const r = check(record(`{"role": "${role}", "commit": "abc1234", "clarity": "assumed"}`, finding('F1')));
		assert.equal(r.ok, false, `role ${role} with clarity assumed passed the gate`);
		assert.ok(atLine(r.errors, 1), `no refusal names line 1 for ${role}: ${r.errors.join('; ')}`);
	}
});

// why: catches a record refused for a missing lead answer counted as one open notChecked, so the canary fails open.
test('a record refused only for clarity asked with no lead answer counts as refused, not open', () => {
	const { recordCounts } = createRequire(import.meta.url)('../user/kit-hooks/record-counts.cjs');
	const asked = record('{"role": "tester", "commit": "abc1234", "clarity": "asked"}', finding('F1'));
	assert.equal(recordCounts(asked), null, 'a record refused for clarity asked was counted as open');
	// Control: the same record with the lead's answer is counted as one finding and no open notChecked.
	const answered = record('{"role": "tester", "commit": "abc1234", "clarity": "asked"}', finding('F1'), '{"note": "lead answer: use the red test", "writer": "lead"}');
	assert.deepEqual(recordCounts(answered), { findings: 1, notChecked: 0 });
});
