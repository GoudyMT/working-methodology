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
// The flip run is the slow part of the check (PR 50: one slice 11 minutes, three slices 9 s each). K131 (build 17):
// the map is made of the untagged tests alone, so A2 is sliced by test as A1 is, and the slices together name what
// the whole run names (PR 52's part 0 spent 11 minutes mapping and flipping one whole file).
// why: catches one CI slice doing every test file's flip run while the others idle (PR 50, PR 52)
// renamed from: the test check measures each test file's flips in one slice, and the slices cover every file
test('the test check slices its flip run by test, and the slices name what the whole run names', () => {
	const dir = repo();
	const base = sh(dir, 'rev-parse', 'HEAD~1');
	const a2 = (args) => {
		const r = spawnSync(process.execPath, [CHECK, ...args], { cwd: dir, encoding: 'utf8' });
		assert.equal(r.status, 0, r.stdout + r.stderr);
		const line = r.stderr.split('\n').find((l) => /A2: \d+/.test(l)) || '';
		return { files: [...line.matchAll(/tests\/\S+?\.test\.mjs/g)].map((x) => x[0]), notes: r.stdout.split('\n').filter((l) => /^\s*A2 /.test(l)) };
	};
	const s0 = a2([base, '--slice', '0/2']);
	const s1 = a2([base, '--slice', '1/2']);
	assert.deepEqual([...new Set([...s0.files, ...s1.files])].sort(), ['tests/a.test.mjs', 'tests/b.test.mjs']);
	assert.deepEqual([...s0.notes, ...s1.notes].sort(), a2([base]).notes.sort(), 'the slices name what the whole run names');
	// The build 17 sweep: and no test is measured by both slices.
	const keysOf = (notes) => notes.map((l) => l.trim().split(/\s+/)[1].replace(/:$/, ''));
	assert.deepEqual(keysOf(s0.notes).filter((k) => keysOf(s1.notes).includes(k)), [], 'a test in both slices');
	// N12's third must-still-flag row (the owner's pick, 2026-11-17, folded here: a row alone passes on the old code by
	// design, and the strict check refuses that). A test red on the base only by a crash proves no assertion.
	const crashBase = sh(dir, 'rev-parse', 'HEAD');
	fs.appendFileSync(path.join(dir, 'src', 'a.cjs'), 'exports.isNeg = (x) => x < 0;\n');
	fs.appendFileSync(path.join(dir, 'tests', 'a.test.mjs'), "test('minus one is negative', () => { assert.equal(a.isNeg(-1), true); });\n");
	sh(dir, 'commit', '-qam', 'isNeg');
	const crash = spawnSync(process.execPath, [CHECK, crashBase], { cwd: dir, encoding: 'utf8' });
	assert.match(crash.stdout, /A1 tests\/a\.test\.mjs::minus one is negative: [^\n]*crash/);
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
	assert.match(r2.stdout, /A1 tests\/old\.test\.mjs: .*could not load/);
	// K170 (the S1 replay of 1.45.0): a module a require() could not find is named too, not only an ESM import.
	assert.match(r2.stdout, /A1 tests\/old\.test\.mjs:.*cannot load this: it lacks src\/c\.cjs/, r2.stdout);
});

// K148 (build 19): PR 55 changed test files to import a helper module main did not have yet, so main's copy of the
// checks named every changed test as failing on the base. That reads as a broken test, and hides the one cause: main
// cannot load the file. The check names the file once, with the module it could not find; the finding still fails CI.
// why: guards rule:test-value
test('a changed file main cannot load is named once, with the module main lacks, and still fails strict', () => {
	const dir = repo();
	const lead = ["import { test } from './harness.mjs';", "import assert from 'node:assert/strict';"];
	const old = path.join(dir, 'tests', 'old.test.mjs');
	fs.writeFileSync(old, [...lead, "test('one', () => { assert.equal(1, 1); });", "test('two', () => { assert.equal(2, 2); });", ''].join('\n'));
	sh(dir, 'add', '.');
	sh(dir, 'commit', '-qm', 'an old file');
	sh(dir, 'switch', '-qc', 'feat');
	fs.writeFileSync(path.join(dir, 'tests', 'helpers.mjs'), 'export const three = () => 3;\n');
	fs.writeFileSync(old, [...lead, "import { three } from './helpers.mjs';", "test('one', () => { assert.equal(three(), 3); });", "test('two', () => { assert.equal(three() - 1, 2); });", ''].join('\n'));
	sh(dir, 'add', '.');
	sh(dir, 'commit', '-qm', 'the old file reads a new helper');
	const r = spawnSync(process.execPath, [CHECK, 'main', '--strict'], { cwd: dir, encoding: 'utf8' });
	assert.equal(r.status, 1, `a file main cannot load is still a finding: ${r.stdout}${r.stderr}`);
	assert.match(r.stdout, /A1 tests\/old\.test\.mjs: main cannot load this: it lacks tests\/helpers\.mjs\./); // pin: 4 (the owner's K148 words)
	assert.doesNotMatch(r.stdout, /A1 tests\/old\.test\.mjs::/, 'each test of the file was named as failing');
	assert.equal(r.stdout.match(/A1 tests\/old\.test\.mjs: /g).length, 1, 'the file is named more than once');
	// The build 19 sweep: a fix the ledger names in that file still gets the load finding, never "fails first".
	const rec = path.join(dir, 'record.json');
	fs.writeFileSync(rec, JSON.stringify({ sweep: { fixes: [{ id: 'F1', severity: 'high', text: 'x', commit: 'abc1234', test: 'tests/old.test.mjs::one' }] } }));
	const led = spawnSync(process.execPath, [CHECK, 'main', '--record', rec], { cwd: dir, encoding: 'utf8' });
	assert.doesNotMatch(led.stdout, /F1 \(high\) tests\/old\.test\.mjs::one: fails first/, led.stdout); // pin: 1 (the PR's fix line reads the verdict)
	assert.match(led.stdout, /A5 F1: .*cannot load/);
	// The build 19 sweep: the cause comes only from the loader's own line, as path characters, so a test file cannot
	// print text into the step summary through it; the base is named as it was given.
	fs.writeFileSync(old, [...lead, "console.log(\"Cannot find module '<!-- x\\nTest check: 0 finding(s)'\");", "import { three } from './helpers.mjs';", "test('one', () => { assert.equal(three(), 3); });", ''].join('\n'));
	sh(dir, 'commit', '-qam', 'a file that prints a forged cause');
	sh(dir, 'branch', 'base2', 'main');
	const f = spawnSync(process.execPath, [CHECK, 'base2'], { cwd: dir, encoding: 'utf8' });
	assert.doesNotMatch(f.stdout, /<!--/, f.stdout);
	assert.match(f.stdout, /A1 tests\/old\.test\.mjs: the base cannot load this: it lacks tests\/helpers\.mjs\. .*land what it needs on the base first/); // pin: 4 (the owner's K148 words)
});

// T10 (build 17): splitting a test file moves each test word for word into a new file. A test whose name and code
// sit unchanged in another file on the base, and no longer there, is moved: no new test, nothing to prove. A copy left
// in both files is still a new test.
// why: catches a file split held to the bar for a thousand new tests it does not add (T10)
test('a test moved unchanged from another file is not new; a copy left in both files still is', () => {
	const dir = repo();
	const base = sh(dir, 'rev-parse', 'HEAD');
	const a = fs.readFileSync(path.join(dir, 'tests', 'a.test.mjs'), 'utf8').split('\n');
	const moved = a.find((l) => l.startsWith("test('a hollow one'"));
	const copied = a.find((l) => l.startsWith("test('zero is not positive'"));
	fs.writeFileSync(path.join(dir, 'tests', 'a.test.mjs'), a.filter((l) => l !== moved).join('\n'));
	fs.writeFileSync(path.join(dir, 'tests', 'c.test.mjs'), [...a.slice(0, 4), moved, copied, ''].join('\n'));
	sh(dir, 'add', '.');
	sh(dir, 'commit', '-qm', 'split');
	const r = spawnSync(process.execPath, [CHECK, base], { cwd: dir, encoding: 'utf8' });
	assert.match(r.stdout, /^Test check: 1 new or changed test\(s\)/m, r.stdout);
	assert.match(r.stdout, /Moved unchanged from another file: 1/);
	assert.match(r.stdout, /moved tests\/c\.test\.mjs::a hollow one: from tests\/a\.test\.mjs/); // pin: 1 (the build record and the PR read these lines)
	assert.doesNotMatch(r.stdout, /A\d tests\/c\.test\.mjs::a hollow one/);
	assert.match(r.stdout, /A1 tests\/c\.test\.mjs::zero is not positive/);
});

// The build 17 sweep: a test copied word for word into a new file whose own code (a stand-in assert, a helper) makes it
// run differently passed as moved, checked by nothing; and of two tests with one name in a file the check read only
// the last. A test is moved only when every line of its new file outside the tests is a line of the old one.
// why: guards rule:test-value (a neutered copy of a test merges with no check run on it)
test('a moved test whose new file brings code of its own is checked, and two tests of one name are named', () => {
	const dir = repo();
	const base = sh(dir, 'rev-parse', 'HEAD');
	const a = fs.readFileSync(path.join(dir, 'tests', 'a.test.mjs'), 'utf8').split('\n');
	const moved = a.find((l) => l.startsWith("test('a hollow one'"));
	fs.writeFileSync(path.join(dir, 'tests', 'a.test.mjs'), a.filter((l) => l !== moved).join('\n'));
	fs.writeFileSync(path.join(dir, 'tests', 'c.test.mjs'), [...a.slice(0, 4), 'const assert = { equal() {}, ok() {} };', moved, ''].join('\n'));
	fs.writeFileSync(path.join(dir, 'tests', 'd.test.mjs'), [...a.slice(0, 4), "test('twice', () => { assert.ok(true); });", "test('twice', () => { assert.ok(1); });", "describe('hidden', () => {", "\ttest('inside', () => { assert.ok(true); });", '});', ''].join('\n'));
	sh(dir, 'add', '.');
	sh(dir, 'commit', '-qm', 'split with a stand-in');
	// The tree's own map is put back after the check's partial one (the build 17 sweep).
	fs.writeFileSync(path.join(dir, 'tests', '.map.json'), '{"kept":1}');
	const r = spawnSync(process.execPath, [CHECK, base], { cwd: dir, encoding: 'utf8' });
	assert.equal(fs.readFileSync(path.join(dir, 'tests', '.map.json'), 'utf8'), '{"kept":1}');
	assert.doesNotMatch(r.stdout, /moved tests\/c\.test\.mjs::a hollow one/, r.stdout);
	assert.match(r.stdout, /A6 tests\/c\.test\.mjs::a hollow one/, 'held to the bar as a new test');
	assert.match(r.stdout, /tests\/d\.test\.mjs::twice: two tests in this file share the name/); // pin: 1 (the PR reads the finding)
	assert.match(r.stdout, /A1 tests\/d\.test\.mjs: a describe, suite or it block/); // pin: 1 (the PR reads the finding)
});

// PR 51: a test's text ran on to the next test, so the top-level code after it (a fixture, a helper) was part of its
// body, and a new test put between them made the old one read as changed, a false finding under --strict.
// why: catches an unchanged test named as changed when a new test is inserted after it (PR 51)
test('a test ends at its own closing line, so a test inserted after it leaves it unchanged', async () => {
	const { tests } = await import(pathToFileURL(CHECK).href);
	const base = ["test('old', () => {", '\tassert.ok(1);', '});', '', 'const FIXTURE = 1;', "test('next', () => {});", ''].join('\n');
	const head = base.replace("});\n\nconst FIXTURE", "});\n\ntest('inserted', () => {});\n\nconst FIXTURE");
	assert.equal(tests(head).get('old'), tests(base).get('old'));
	assert.ok(tests(head).has('inserted'));
});

// K105 (PR 49): the PR claimed each fix had a test that fails first, and nothing read the claim. With the record, the
// check states the verdict of each test the fix ledger names, and names a fix whose test does not fail first or is
// not one this change adds or changes.
// why: guards rule:test-value
test('the test check states the verdict of each test the fix ledger names', () => {
	const dir = repo();
	const rec = path.join(dir, 'record.json');
	const fix = (id, severity, test) => ({ id, severity, text: id, commit: 'abc1234', test });
	fs.writeFileSync(rec, JSON.stringify({ items: [{ id: 'I1', text: 'two', test: 'tests/b.test.mjs::two is two' }], sweep: { fixes: [
		fix('F1', 'high', 'tests/a.test.mjs::zero is not positive'),
		fix('F2', 'medium', 'tests/a.test.mjs::a hollow one'),
		fix('F3', 'high', 'tests/a.test.mjs::one is positive'),
		fix('F4', 'low', 'no test: no real input'),
		{ ...fix('F5', 'medium', 'tests/a.test.mjs::a pattern one'), reason: 'no existing test reaches the host check' },
		// The build 20 sweep: a security flag that is not true, and a one-word reason, excuse nothing.
		{ ...fix('F6', 'low', 'tests/a.test.mjs::a guarded one'), security: 'no' },
		{ ...fix('F7', 'medium', 'tests/a.test.mjs::a hollow one'), reason: ' later ' },
	] } }));
	const r = spawnSync(process.execPath, [CHECK, 'HEAD~1', '--record', rec], { cwd: dir, encoding: 'utf8' });
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.match(r.stdout, /^Fix ledger: 7 fix\(es\)$/m);
	// K152 (build 20, the owner's test standard): every new test is named in the build record, by an item or a fix, and
	// a medium or low fix adds a row to an existing test unless it gives a reason.
	assert.match(r.stdout, /A7 tests\/a\.test\.mjs::a browser one: [^\n]*build record does not name/);
	assert.match(r.stdout, /A7 F2: a medium fix[^\n]*a hollow one/);
	for (const id of ['F6', 'F7']) assert.match(r.stdout, new RegExp(`A7 ${id}: a (low|medium) fix adds a new test`), id);
	for (const id of ['F1', 'F5', 'tests/b.test.mjs::two is two', 'tests/a.test.mjs::zero is not positive', 'tests/a.test.mjs::a pattern one']) assert.ok(!r.stdout.includes(`A7 ${id}`), id);
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
	assert.match(r.stdout, /A1 tests\/a\.test\.mjs::minus one is negative: not checked: the time budget ran out/); // pin: 1 (strict mode keys on these words)
	assert.equal(r.status, 0, `a budget-out alone failed strict: ${r.stdout}`);
	fs.appendFileSync(path.join(dir, 'tests', 'a.test.mjs'), "test('an untagged one', () => { assert.equal(a.neg(-2), true); });\n");
	sh(dir, 'commit', '-qam', 'untagged');
	assert.equal(spawnSync(process.execPath, [CHECK, base, '--strict', '--budget', '0'], { cwd: dir, encoding: 'utf8' }).status, 1, 'a real finding beside a budget-out passed strict');
});

// Build 16 (PR 52, the owner 2026-11-18: "Teach it 3 proofs"): a planted-bug test guards code that was already right,
// so it cannot fail on the base. It names the bug it catches, and the check plants that bug in the new code: the test
// must fail there on an assertion. A plant the test does not catch, or a planted text not found once, is named.
// why: guards rule:test-value
test('a planted-bug test passes when it fails on its planted bug, and is named when it does not', () => {
	const dir = repo();
	const plant = (was, to) => `// planted: ${JSON.stringify({ file: 'src/a.cjs', was, to })}`;
	fs.appendFileSync(path.join(dir, 'tests', 'a.test.mjs'), [
		'// why: guards rule:outward-acts', plant('x > 0', 'x < 0'),
		"test('caught plant', () => { assert.equal(a.isPos(2), true); });",
		'// why: guards rule:outward-acts', plant('x > 0', 'x >= 0'),
		"test('missed plant', () => { assert.equal(a.isPos(2), true); });",
		'// why: guards rule:outward-acts', plant('x > 9', 'x < 9'),
		"test('absent plant', () => { assert.equal(a.isPos(2), true); });",
		// A name with a backslash, as TAP writes it doubled (PR 52: the glued-cd test, cd\\, read as never run).
		'// why: guards rule:outward-acts', plant('x > 0', 'x < 0'),
		"test('caught plant, cd\\\\ too', () => { assert.equal(a.isPos(2), true); });",
		''].join('\n'));
	sh(dir, 'commit', '-qam', 'planted');
	const r = spawnSync(process.execPath, [CHECK, sh(dir, 'rev-parse', 'HEAD~2')], { cwd: dir, encoding: 'utf8' });
	assert.doesNotMatch(r.stdout, /A1 tests\/a\.test\.mjs::caught plant/, r.stdout);
	assert.match(r.stdout, /^ {4}planted tests\/a\.test\.mjs::caught plant, cd\\ /m);
	assert.match(r.stdout, /^ {4}planted tests\/a\.test\.mjs::caught plant: .* 1 planted/m);
	assert.match(r.stdout, /A1 tests\/a\.test\.mjs::missed plant: .*planted bug in src\/a\.cjs/);
	assert.match(r.stdout, /A1 tests\/a\.test\.mjs::absent plant: .*not found once in src\/a\.cjs/);
});

// Build 16: a behaviour this change removes or alters takes its test with it. A changed test, named or renamed
// ("// renamed from: <old name>"), passes when its old version fails on the new code: the edit was forced. The check
// cannot tell a forced edit from a weakened one, so each is listed for the owner, a loss of lines as trimmed and any
// other edit as adapted. An edit the new code did not force still must add a catch.
// why: guards rule:test-value
test('a test edit the new code forced is listed for the owner, and one it did not force still must fail first', () => {
	const dir = repo();
	const file = path.join(dir, 'tests', 'a.test.mjs');
	const two = (name, x, y) => [`test('${name}', () => {`, `\tassert.equal(a.isPos(${x}), true);`, `\tassert.equal(a.isPos(${y}), true);`, '});'];
	fs.appendFileSync(file, [...two('pair', 1, 5), ...two('old name', 1, 6), "test('loose', () => {", '\tassert.equal(a.isPos(1), true);', '});', ...two('kept', 3, 5), "test('edited', () => {", '\tassert.equal(a.isPos(4), true);', '});', "test('named once', () => {", '\tassert.equal(a.isPos(7), true);', '});', ''].join('\n'));
	sh(dir, 'commit', '-qam', 'more tests');
	const base = sh(dir, 'rev-parse', 'HEAD');
	fs.writeFileSync(path.join(dir, 'src', 'a.cjs'), 'exports.isPos = (x) => x > 1;\n');
	fs.writeFileSync(file, fs.readFileSync(file, 'utf8')
		.replace("test('pair', () => {\n\tassert.equal(a.isPos(1), true);\n", "test('pair', () => {\n")
		.replace("test('old name', () => {\n\tassert.equal(a.isPos(1), true);\n", "// renamed from: old name\ntest('new name', () => {\n")
		.replace("test('loose', () => {\n\tassert.equal(a.isPos(1), true);", "test('loose', () => {\n\tassert.equal(typeof a.isPos(1), 'boolean');")
		.replace("test('kept', () => {\n\tassert.equal(a.isPos(3), true);\n", "test('kept', () => {\n")
		.replace("test('edited', () => {\n\tassert.equal(a.isPos(4), true);", "test('edited', () => {\n\tassert.equal(typeof a.isPos(4), 'boolean');")
		.replace("test('named once', () => {", "// renamed from: named once\ntest('named twice', () => {"));
	sh(dir, 'commit', '-qam', 'one is no longer positive');
	const r = spawnSync(process.execPath, [CHECK, base], { cwd: dir, encoding: 'utf8' });
	assert.doesNotMatch(r.stdout, /A1 tests\/a\.test\.mjs::(pair|new name):/, r.stdout);
	assert.match(r.stdout, /^ {4}trimmed tests\/a\.test\.mjs::pair: /m);
	assert.match(r.stdout, /^ {4}trimmed tests\/a\.test\.mjs::new name: /m);
	assert.match(r.stdout, /^ {4}adapted tests\/a\.test\.mjs::loose: /m, 'an edit the new code forced');
	assert.match(r.stdout, /A1 tests\/a\.test\.mjs::kept: /, 'a removal the new code did not force');
	assert.match(r.stdout, /A1 tests\/a\.test\.mjs::edited: /, 'an edit the new code did not force');
	// A new name over the same code is no new test: it is held to its why line only (PR 52: a renamed test was held).
	assert.doesNotMatch(r.stdout, /A1 tests\/a\.test\.mjs::named twice/, 'a rename with the same code was held to fail first');
});

// Build 16: a fix's test in a file the branch adds cannot load on the base, so the base proves nothing about it. The
// fix row names its commit: the test is measured on the commit before the fix, where its file loads.
// why: guards rule:test-value
test('a fix test whose file is new on the branch is measured on the commit before its fix', () => {
	const dir = repo();
	const base = sh(dir, 'rev-parse', 'HEAD');
	fs.writeFileSync(path.join(dir, 'src', 'c.mjs'), 'export const three = () => 4;\n');
	sh(dir, 'add', '.');
	sh(dir, 'commit', '-qm', 'three, wrong');
	// The fix also adds a function the test file imports, so the file as written cannot load on the commit before it.
	fs.writeFileSync(path.join(dir, 'src', 'c.mjs'), 'export const three = () => 3;\nexport const extra = () => 1;\n');
	fs.writeFileSync(path.join(dir, 'tests', 'c.test.mjs'), ["import { test } from './harness.mjs';", "import assert from 'node:assert/strict';", "import { three, extra as more } from '../src/c.mjs';",
		'// why: guards rule:outward-acts', "test('three is three', () => { assert.equal(three(), 3); });",
		'// why: guards rule:outward-acts', "test('three is a number', () => { assert.equal(typeof three(), 'number'); });",
		'// why: guards rule:outward-acts', "test('extra is one', () => { assert.equal(more(), 1); });", ''].join('\n'));
	sh(dir, 'add', '.');
	sh(dir, 'commit', '-qm', 'three fixed');
	const fixAt = sh(dir, 'rev-parse', 'HEAD');
	const rec = path.join(dir, 'record.json');
	fs.writeFileSync(rec, JSON.stringify({ sweep: { fixes: [
		{ id: 'F1', severity: 'high', text: 'F1', commit: fixAt.slice(0, 7), test: 'tests/c.test.mjs::three is three' },
		{ id: 'F2', severity: 'high', text: 'F2', commit: fixAt.slice(0, 7), test: 'tests/c.test.mjs::three is a number' },
		{ id: 'F3', severity: 'high', text: 'F3', commit: fixAt.slice(0, 7), test: 'tests/c.test.mjs::extra is one' },
	] } }));
	const r = spawnSync(process.execPath, [CHECK, base, '--record', rec], { cwd: dir, encoding: 'utf8' });
	assert.match(r.stdout, new RegExp(`^ {4}F1 \\(high\\) tests/c\\.test\\.mjs::three is three: fails first on ${fixAt.slice(0, 9)}\\^$`, 'm'), r.stdout);
	assert.doesNotMatch(r.stdout, /A5 F1/);
	assert.match(r.stdout, new RegExp(`A5 F2: the test it names passes on ${fixAt.slice(0, 9)}\\^, the commit before its fix`));
	assert.match(r.stdout, new RegExp(`A5 F3: the test it names fails on ${fixAt.slice(0, 9)}\\^, but not on an assertion`), 'a call to what the fix added');
});

// The owner, 2026-11-18 ("we can measure them on windows now"): the test check runs on Linux, where a Windows-only
// test is skipped and a planted bug that shows only on Windows is invisible. Linux leaves each to the Windows job,
// and names them; the Windows job's part (--windows) measures them there and nothing else.
// why: guards rule:test-value
test('a Windows-only test or planted bug is left to the Windows job, which measures it', () => {
	const dir = repo();
	const plant = (os) => `// planted: ${JSON.stringify({ file: 'src/a.cjs', was: 'x > 0', to: 'x < 0', ...(os ? { os } : {}) })}`;
	fs.appendFileSync(path.join(dir, 'tests', 'a.test.mjs'), [
		'// why: guards rule:outward-acts', plant(),
		"test('win only', { windows: true }, () => { assert.equal(a.isPos(2), true); });",
		'// why: guards rule:outward-acts', plant('win32'),
		"test('win plant', () => { assert.equal(a.isPos(3), true); });",
		''].join('\n'));
	sh(dir, 'commit', '-qam', 'windows');
	const base = sh(dir, 'rev-parse', 'HEAD~2');
	const r = spawnSync(process.execPath, [CHECK, base], { cwd: dir, encoding: 'utf8' });
	const w = spawnSync(process.execPath, [CHECK, base, '--windows'], { cwd: dir, encoding: 'utf8' });
	assert.doesNotMatch(r.stdout, /A1 tests\/a\.test\.mjs::win (only|plant)/, r.stdout);
	if (process.platform === 'win32') {
		assert.match(r.stdout, /^ {4}planted tests\/a\.test\.mjs::win only: /m);
		assert.match(w.stdout, /^ {4}planted tests\/a\.test\.mjs::win plant: /m, w.stdout);
		assert.doesNotMatch(w.stdout, /a hollow one/, 'the Windows part checks only what Linux leaves to it');
	} else {
		assert.match(r.stdout, /^ {4}left .* tests\/a\.test\.mjs::win only/m);
		assert.match(r.stdout, /^ {4}left .* tests\/a\.test\.mjs::win plant/m);
		assert.equal(w.status, 2, 'the Windows part off Windows');
	}
});
