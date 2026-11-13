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
	assert.match(r.stdout, /A1 tests\/b\.test\.mjs::two is two: .*could not load/);
	assert.doesNotMatch(r.stdout, /one is positive/, 'an unchanged test was checked');
	assert.equal(spawnSync(process.execPath, [CHECK, 'HEAD~1', '--strict'], { cwd: dir, encoding: 'utf8' }).status, 1, 'strict fails on a finding');
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
