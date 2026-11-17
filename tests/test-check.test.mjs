// T15 Part A (the owner, 2026-11-10): the bar for a new test is checked by a script, not left as one line of rule
// text: it fails first, earns its place, sits in the right lane, and is owed at all.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const CHECK = path.resolve('scripts/test-check.mjs');
const sh = (cwd, ...a) => {
	const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' });
	if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
	return r.stdout.trim();
};

// A repo with the kit's runner and harness, a bug at the base, and a fix with four new tests.
function repo() {
	const dir = kitTemp.makeTemp('checkrepo-');
	for (const f of ['scripts/test-run.mjs', 'scripts/mutation-check.mjs', 'tests/harness.mjs', 'tests/map-trace.cjs', 'project/.claude/kit-temp.cjs', 'project/standards/INDEX.md']) {
		fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
		fs.copyFileSync(path.resolve(f), path.join(dir, f));
	}
	fs.mkdirSync(path.join(dir, 'src'));
	fs.writeFileSync(path.join(dir, '.gitignore'), 'tests/.map.json\n');
	fs.writeFileSync(path.join(dir, 'src', 'a.cjs'), 'exports.isPos = (x) => x >= 0;\n');
	const head = ["import { test } from './harness.mjs';", "import assert from 'node:assert/strict';", "import { createRequire } from 'node:module';", "const a = createRequire(import.meta.url)('../src/a.cjs');"];
	fs.writeFileSync(path.join(dir, 'tests', 'a.test.mjs'), [...head, "test('one is positive', () => { assert.equal(a.isPos(1), true); });", ''].join('\n'));
	sh(dir, 'init', '-q', '-b', 'main');
	sh(dir, 'add', '.');
	sh(dir, 'commit', '-qm', 'base');
	fs.writeFileSync(path.join(dir, 'src', 'a.cjs'), 'exports.isPos = (x) => x > 0;\n');
	fs.writeFileSync(path.join(dir, 'tests', 'a.test.mjs'), [...head,
		"test('one is positive', () => { assert.equal(a.isPos(1), true); });",
		"test('zero is not positive', () => { assert.equal(a.isPos(0), false); });",
		"test('a hollow one', () => { assert.equal(typeof a.isPos(5), 'boolean'); });",
		'// why: guards rule:outward-acts',
		"test('a guarded one', () => { assert.equal(a.isPos(0), false); });",
		"test('a browser one', () => { const go = () => fetch('https://example.com/x'); assert.equal(a.isPos(0), false, typeof go); });",
		"test('a pattern one', () => { assert.equal(a.isPos(0), false, 'a host in a string: https://hooks.example.com/x'); });",
		''].join('\n'));
	fs.writeFileSync(path.join(dir, 'src', 'b.cjs'), 'exports.two = () => 2;\n');
	fs.writeFileSync(path.join(dir, 'tests', 'b.test.mjs'), [head[0], head[1], head[2], "const b = createRequire(import.meta.url)('../src/b.cjs');", "test('two is two', () => { assert.equal(b.two(), 2); });", ''].join('\n'));
	sh(dir, 'add', '.');
	sh(dir, 'commit', '-qm', 'fix');
	return dir;
}

// why: catches a check that passes what the rule forbids (rule:test-value): a hollow new test kept, a large test in
// the fast lane, or a guard test asked to catch a flip it is not meant to.
test('the test check names a test that does not fail first, catches nothing or sits in the wrong lane', () => {
	const dir = repo();
	const r = spawnSync(process.execPath, [CHECK, 'HEAD~1'], { cwd: dir, encoding: 'utf8' });
	assert.equal(r.status, 0, `report mode exits 0: ${r.stdout}${r.stderr}`);
	const k = (n) => `tests/a.test.mjs::${n}`;
	assert.match(r.stdout, new RegExp(`A1 ${k('a hollow one')}: passes on the base commit`));
	assert.match(r.stdout, new RegExp(`A2 ${k('a hollow one')}: catches no flip`));
	assert.match(r.stdout, new RegExp(`A3 ${k('a browser one')}: `));
	assert.doesNotMatch(r.stdout, new RegExp(`A[12] ${k('zero is not positive')}`), 'the real new test was named');
	assert.doesNotMatch(r.stdout, new RegExp(`A2 ${k('a guarded one')}`), 'a guard test was asked to catch a flip');
	assert.doesNotMatch(r.stdout, new RegExp(`A3 ${k('a pattern one')}`), 'a host named in a string is not a call to it');
	// K105: a test in a file the base does not have, red there because its file cannot load, fails first.
	assert.doesNotMatch(r.stdout, /A1 tests\/b\.test\.mjs::two is two/, 'a new file that cannot load on the base was named');
	assert.doesNotMatch(r.stdout, /one is positive/, 'an unchanged test was checked');
	assert.equal(spawnSync(process.execPath, [CHECK, 'HEAD~1', '--strict'], { cwd: dir, encoding: 'utf8' }).status, 1, 'strict fails on a finding');
});

// K95 (build 12, seen on PR 47): two slices ran past the job's 15 minutes measuring flips and were cancelled with no
// line of output, so even their quick findings were lost. With a time budget the check stops a step that would run
// past it, names each test it could not check, and still reports what it found; it says each step as it starts.
// why: guards the owner's rule never to lower a gate (a check that is cancelled reports nothing)
test('the test check keeps to its time budget, names what it could not check and still reports the rest', () => {
	const dir = repo();
	const t0 = Date.now();
	const r = spawnSync(process.execPath, [CHECK, 'HEAD~1', '--budget', '0'], { cwd: dir, encoding: 'utf8' });
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.ok(Date.now() - t0 < 60000, `took ${Date.now() - t0} ms`);
	const k = (n) => `tests/a.test.mjs::${n}`;
	const line = (rule) => r.stdout.split('\n').find((l) => l.includes(`${rule} ${k('a hollow one')}`)) || '';
	assert.ok(line('A1').includes('not checked'), r.stdout);
	assert.ok(line('A2').includes('not measured'), r.stdout);
	assert.match(r.stdout, new RegExp(`A3 ${k('a browser one')}: `), 'a quick finding was lost');
	assert.match(r.stderr, /test check: /, 'no progress line');
	assert.equal(spawnSync(process.execPath, [CHECK, 'HEAD~1', '--budget', 'x'], { cwd: dir, encoding: 'utf8' }).status, 2);
});

// The sweep of K95: a run stopped at the budget kept the results of the tests that had finished, but named every test
// "not checked", so a real finding was lost. Only a test with no result is named so.
// why: guards the owner's rule never to lower a gate
test('a run stopped at the budget keeps the findings of the tests that finished before it', () => {
	const dir = repo();
	const head = ["import { test } from './harness.mjs';", "import assert from 'node:assert/strict';"];
	fs.writeFileSync(path.join(dir, 'tests', 'q.test.mjs'), [...head, "test('a quick hollow one', () => { assert.equal(1, 1); });", ''].join('\n'));
	fs.writeFileSync(path.join(dir, 'tests', 'z.test.mjs'), [...head, "test('a slow one', async () => { await new Promise((r) => setTimeout(r, 120000)); });", ''].join('\n'));
	sh(dir, 'add', '.');
	sh(dir, 'commit', '-qm', 'two more');
	const r = spawnSync(process.execPath, [CHECK, 'HEAD~1', '--budget', '15'], { cwd: dir, encoding: 'utf8' });
	assert.equal(r.status, 0, r.stdout + r.stderr);
	const quick = r.stdout.split('\n').find((l) => l.includes('A1 tests/q.test.mjs::a quick hollow one')) || '';
	assert.ok(quick && !quick.includes('not checked'), `a finished test's finding was lost: ${r.stdout}`);
	const slow = r.stdout.split('\n').find((l) => l.includes('A1 tests/z.test.mjs::a slow one'));
	assert.ok(slow && slow.includes('not checked'), r.stdout);
});

// why: guards the owner's rule never to lower a gate. K13, the 1.27.0 build: on a PR that changed 616 tests the check
// ran past its 15 minutes and checked nothing; split into slices, each changed test is checked once.
test('the test check splits the changed tests into slices that cover each once', () => {
	const dir = repo();
	const files = (args) => {
		const r = spawnSync(process.execPath, [CHECK, ...args], { cwd: dir, encoding: 'utf8' });
		assert.equal(r.status, 0, r.stdout + r.stderr);
		return [...r.stdout.matchAll(/^Test check: (\d+) new or changed/gm)].map((m) => Number(m[1]))[0];
	};
	const base = sh(dir, 'rev-parse', 'HEAD~1');
	// The count each run names: the slices split the changed tests, none twice, none left out.
	const one = files([base, '--slice', '0/2']);
	const two = files(['--slice', '1/2', base]);
	assert.ok(one > 0 && two > 0, `a slice got nothing: ${one} and ${two}`);
	assert.equal(one + two, files([base]), 'the slices do not add up to the whole');
	assert.equal(spawnSync(process.execPath, [CHECK, base, '--slice', '2/2'], { cwd: dir, encoding: 'utf8' }).status, 2, 'a slice past the count');
});
// why: guards rule:test-value. K12, the 1.27.0 sweep: the check took any "why: guards" text, so a tag naming a rule
// that does not exist, or a made-up one, kept a test in the never-cut group unread.
test('the test check takes a why tag only when it names a rule in the rule index or the owner', () => {
	const dir = repo();
	const file = path.join(dir, 'tests', 'a.test.mjs');
	fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('// why: guards rule:outward-acts', '// why: guards rule:no-such-rule'));
	sh(dir, 'commit', '-qam', 'retag');
	const r = spawnSync(process.execPath, [CHECK, sh(dir, 'rev-parse', 'HEAD~2')], { cwd: dir, encoding: 'utf8' });
	assert.match(r.stdout, /A2 tests\/a\.test\.mjs::a guarded one: .*rule:no-such-rule.*not in the rule index/);
});
// why: guards rule:test-value. K36 (the 1.28.0 sweep, and the plan check's P15): the index is the change's own copy, so a
// change could add a row for a made-up rule and tag a hollow test with it. A rule the change itself adds still counts,
// and the report names it for the owner to read.
test('the test check names a rule that the change itself adds to the rule index', () => {
	const dir = repo();
	const file = path.join(dir, 'tests', 'a.test.mjs');
	fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('// why: guards rule:outward-acts', '// why: guards rule:made-up-here'));
	fs.appendFileSync(path.join(dir, 'project', 'standards', 'INDEX.md'), '| made-up-here | `standards/x.md` |\n');
	sh(dir, 'commit', '-qam', 'a rule of its own');
	const r = spawnSync(process.execPath, [CHECK, sh(dir, 'rev-parse', 'HEAD~2')], { cwd: dir, encoding: 'utf8' });
	assert.match(r.stdout, /a guarded one: names rule:made-up-here[^\n]*itself adds/);
	assert.doesNotMatch(r.stdout, /a guarded one: .*not in the rule index/);
});

// K105 (build 13, PR 49): the check read only `test('<literal>'` at the start of a line, so a test made in a loop was
// never checked, and a loop a fix added passed whatever it proved. N12: the check now flags less (a new file that cannot
// load on the base fails first), so what it must still flag is a row here: a changed file that cannot load there.
// why: guards rule:test-value
test('the test check reads tests made in a loop, and still names a changed file that cannot load on the base', () => {
	const dir = repo();
	// The base before the fix, so a loop that proves the fix fails there.
	const base = sh(dir, 'rev-parse', 'HEAD~1');
	fs.appendFileSync(path.join(dir, 'tests', 'a.test.mjs'), [
		"for (const n of [0, -1]) test(`not positive: ${n}`, () => { assert.equal(a.isPos(n), false); });",
		'for (const n of [5, 6]) {',
		"\ttest(`a hollow loop: ${n}`, () => { assert.equal(typeof a.isPos(n), 'boolean'); });",
		'}',
		''].join('\n'));
	sh(dir, 'commit', '-qam', 'loops');
	const r = spawnSync(process.execPath, [CHECK, base], { cwd: dir, encoding: 'utf8' });
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.match(r.stdout, /A1 tests\/a\.test\.mjs::a hollow loop.*passes on the base commit/);
	assert.doesNotMatch(r.stdout, /A1 tests\/a\.test\.mjs::not positive/, 'a loop that fails first was named');
	// Its flips are caught under the names the loop made (the build 14 sweep: the A2 match had no test).
	assert.doesNotMatch(r.stdout, /A2 tests\/a\.test\.mjs::not positive/, 'a loop that catches a flip was named');
	// A file the base has, changed to read a module only the change adds: its red on the base proves nothing.
	const lead = ["import { test } from './harness.mjs';", "import assert from 'node:assert/strict';"];
	const old = path.join(dir, 'tests', 'old.test.mjs');
	fs.writeFileSync(old, [...lead, "test('old', () => { assert.equal(1, 1); });", ''].join('\n'));
	sh(dir, 'add', '.');
	sh(dir, 'commit', '-qm', 'an old file');
	const base2 = sh(dir, 'rev-parse', 'HEAD');
	fs.writeFileSync(path.join(dir, 'src', 'c.cjs'), 'exports.three = () => 3;\n');
	fs.writeFileSync(old, [...lead, "import { createRequire } from 'node:module';", "const c = createRequire(import.meta.url)('../src/c.cjs');", "test('old', () => { assert.equal(c.three(), 3); });", ''].join('\n'));
	sh(dir, 'add', '.');
	sh(dir, 'commit', '-qm', 'the old file reads c');
	const r2 = spawnSync(process.execPath, [CHECK, base2], { cwd: dir, encoding: 'utf8' });
	assert.match(r2.stdout, /A1 tests\/old\.test\.mjs::old: .*could not load/);
});

// K105 (PR 49): the PR claimed each fix had a test that fails first, and nothing read the claim. With the record, the
// check states the verdict of each test the fix ledger names, and names a fix whose test does not fail first or is
// not one this change adds or changes.
// why: guards rule:test-value
test('the test check states the verdict of each test the fix ledger names', () => {
	const dir = repo();
	const rec = path.join(dir, 'record.json');
	const fix = (id, severity, test) => ({ id, severity, text: id, commit: 'abc1234', test });
	fs.writeFileSync(rec, JSON.stringify({ sweep: { fixes: [
		fix('F1', 'high', 'tests/a.test.mjs::zero is not positive'),
		fix('F2', 'medium', 'tests/a.test.mjs::a hollow one'),
		fix('F3', 'high', 'tests/a.test.mjs::one is positive'),
		fix('F4', 'low', 'no test: no real input'),
	] } }));
	const r = spawnSync(process.execPath, [CHECK, 'HEAD~1', '--record', rec], { cwd: dir, encoding: 'utf8' });
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.match(r.stdout, /^Fix ledger: 4 fix\(es\)$/m);
	assert.match(r.stdout, /^ {4}F1 \(high\) tests\/a\.test\.mjs::zero.*: fails first$/m);
	assert.match(r.stdout, /^ {4}F4 \(low\) no test: no real input$/m);
	assert.match(r.stdout, /A5 F2: .*passes on the base commit/);
	assert.match(r.stdout, /A5 F3: .*not one this change adds or changes/);
	assert.doesNotMatch(r.stdout, /A5 F1|A5 F4/);
	assert.equal(spawnSync(process.execPath, [CHECK, 'HEAD~1', '--record', path.join(dir, 'none.json')], { cwd: dir, encoding: 'utf8' }).status, 2, 'a record it cannot read');
});

// The build 14 sweep (role 2): results were keyed by bare name across every file run, so a passing test took the red
// result of a same-named test in another file, and a loop took one whose name fit its pattern; a new file that only
// exited non-zero, or was made unable to load on purpose, read as failing first for a fix.
// why: guards rule:test-value
test('the test check keys each result by its file, and a fix test red only because its file cannot load is named', () => {
	const dir = repo();
	const base = sh(dir, 'rev-parse', 'HEAD~1');
	const lead = ["import { test } from './harness.mjs';", "import assert from 'node:assert/strict';", "import fs from 'node:fs';", "import { createRequire } from 'node:module';", "const a = createRequire(import.meta.url)('../src/a.cjs');"];
	fs.appendFileSync(path.join(dir, 'tests', 'a.test.mjs'), [
		"test('same name', () => { assert.equal(a.isPos(5), true); });",
		"for (const n of [7, 8]) test(`zero check ${n}`, () => { assert.equal(a.isPos(n), true); });",
		''].join('\n'));
	fs.writeFileSync(path.join(dir, 'tests', 'c.test.mjs'), [...lead,
		"test('same name', () => { assert.equal(a.isPos(0), false); });",
		"test('zero check fails', () => { assert.equal(a.isPos(0), false); });",
		''].join('\n'));
	// Passes on the base, but the file ends non-zero there.
	fs.writeFileSync(path.join(dir, 'tests', 'd.test.mjs'), [...lead,
		"process.on('exit', () => { if (!fs.existsSync('src/b.cjs')) process.exitCode = 1; });",
		"test('d passes', () => { assert.equal(a.isPos(5), true); });", ''].join('\n'));
	sh(dir, 'add', '.');
	sh(dir, 'commit', '-qm', 'more');
	const rec = path.join(dir, 'record.json');
	const fix = (id, test) => ({ id, severity: 'high', text: id, commit: 'abc1234', test });
	fs.writeFileSync(rec, JSON.stringify({ sweep: { fixes: [fix('F1', 'tests/a.test.mjs::same name'), fix('F2', 'tests/a.test.mjs::zero check ${n}'), fix('F3', 'tests/d.test.mjs::d passes'), fix('F4', 'tests/b.test.mjs::two is two'), fix('F5', 'no test: no real input')] } }));
	const r = spawnSync(process.execPath, [CHECK, base, '--record', rec], { cwd: dir, encoding: 'utf8' });
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.match(r.stdout, /A1 tests\/a\.test\.mjs::same name: .*passes on the base commit/);
	assert.match(r.stdout, /A1 tests\/a\.test\.mjs::zero check .*passes on the base commit/);
	assert.match(r.stdout, /A1 tests\/d\.test\.mjs::d passes: .*passes on the base commit/);
	assert.match(r.stdout, /A5 F4: .*only because its file cannot load/);
	assert.doesNotMatch(r.stdout, /A1 tests\/c\.test\.mjs::same name/, 'the real red test was named');
	// Split over two slices, each row is stated once, by the slice that holds its test, and the rest by the first.
	const rows = [0, 1].flatMap((i) => spawnSync(process.execPath, [CHECK, base, '--record', rec, '--slice', `${i}/2`], { cwd: dir, encoding: 'utf8' }).stdout.split('\n').filter((l) => /^ {4}F\d /.test(l)));
	assert.deepEqual(rows.map((l) => l.trim().split(' ')[0]).sort(), ['F1', 'F2', 'F3', 'F4', 'F5']);
});

// why: guards the owner's ruling (2026-11-17, "we have the standard, now we just need to enforce it"): a new test
// names the real use or failure it guards in a why line of the kit's shape, or the check names it.
test('the test check names a new test with no why line, or one of no known shape', () => {
	const dir = repo();
	const file = path.join(dir, 'tests', 'a.test.mjs');
	fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace("test('zero is not positive'", "// why: catches zero read as positive, a real bug\ntest('zero is not positive'")
		.replace("test('a browser one'", "// why: catches it\ntest('a browser one'")
		.replace("test('a pattern one'", "// why: guards the lane\ntest('a pattern one'"));
	sh(dir, 'commit', '-qam', 'tags');
	const r = spawnSync(process.execPath, [CHECK, sh(dir, 'rev-parse', 'HEAD~2')], { cwd: dir, encoding: 'utf8' });
	const k = (n) => `tests/a.test.mjs::${n}`;
	assert.match(r.stdout, new RegExp(`A6 ${k('a hollow one')}: `), 'no why line');
	assert.match(r.stdout, new RegExp(`A6 ${k('a browser one')}: `), 'a catches line too short to name a failure');
	assert.match(r.stdout, new RegExp(`A6 ${k('a pattern one')}: `), 'a guards line naming no rule and not the owner');
	assert.doesNotMatch(r.stdout, new RegExp(`A6 ${k('zero is not positive')}`), 'a catches line that names the failure');
	assert.doesNotMatch(r.stdout, new RegExp(`A6 ${k('a guarded one')}`), 'a guards line naming a known rule');
});

// why: catches false flags the build 14 PR raised: a why line added to an old test read as a changed test that must
// fail first again, and a sample tag inside a string read as the test's own tag.
test('a test whose only change is its comment lines gets the why line check only, and a tag is read above the test', () => {
	const dir = repo();
	const file = path.join(dir, 'tests', 'a.test.mjs');
	fs.writeFileSync(file, fs.readFileSync(file, 'utf8')
		.replace("test('one is positive'", "// why: catches one read as not positive, a real bug\ntest('one is positive'")
		.replace("test('a guarded one', () => {", "test('a guarded one', () => { const sample = '// why: guards rule:no-such-rule';"));
	sh(dir, 'commit', '-qam', 'retag');
	const r = spawnSync(process.execPath, [CHECK, sh(dir, 'rev-parse', 'HEAD~2')], { cwd: dir, encoding: 'utf8' });
	assert.doesNotMatch(r.stdout, /A[12] tests\/a\.test\.mjs::one is positive/, 'a comment-only change was held to fail first');
	assert.doesNotMatch(r.stdout, /rule:no-such-rule/, 'a tag inside a string was read as the test\'s tag');
	fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('// why: catches one read as not positive, a real bug', '// why: catches it'));
	sh(dir, 'commit', '-qam', 'short');
	const s = spawnSync(process.execPath, [CHECK, sh(dir, 'rev-parse', 'HEAD~3')], { cwd: dir, encoding: 'utf8' });
	assert.match(s.stdout, /A6 tests\/a\.test\.mjs::one is positive: /, 'a comment-only change to a bad why line was not named');
});

// why: guards the owner's K24 ruling (2026-11-17, "Required; unmeasured is named only"): the required check fails on
// a real finding, while a test the time budget left unmeasured is named and does not fail it.
test('strict mode fails on a finding but only names a test the time budget left unmeasured', () => {
	const dir = repo();
	fs.appendFileSync(path.join(dir, 'src', 'a.cjs'), 'exports.neg = (x) => x < 0;\n');
	fs.appendFileSync(path.join(dir, 'tests', 'a.test.mjs'), "// why: catches minus one read as not negative, a real bug\ntest('minus one is negative', () => { assert.equal(a.neg(-1), true); });\n");
	sh(dir, 'commit', '-qam', 'neg');
	const base = sh(dir, 'rev-parse', 'HEAD~1');
	const r = spawnSync(process.execPath, [CHECK, base, '--strict', '--budget', '0'], { cwd: dir, encoding: 'utf8' });
	assert.match(r.stdout, /A1 tests\/a\.test\.mjs::minus one is negative: not checked: the time budget ran out/);
	assert.equal(r.status, 0, `a budget-out alone failed strict: ${r.stdout}`);
	fs.appendFileSync(path.join(dir, 'tests', 'a.test.mjs'), "test('an untagged one', () => { assert.equal(a.neg(-2), true); });\n");
	sh(dir, 'commit', '-qam', 'untagged');
	assert.equal(spawnSync(process.execPath, [CHECK, base, '--strict', '--budget', '0'], { cwd: dir, encoding: 'utf8' }).status, 1, 'a real finding beside a budget-out passed strict');
});
