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
	for (const f of ['scripts/test-run.mjs', 'scripts/mutation-check.mjs', 'tests/harness.mjs', 'tests/map-trace.cjs', 'project/.claude/kit-temp.cjs']) {
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
		"test('a browser one', () => { const url = 'https://example.com/x'; assert.equal(a.isPos(0), false, url); });",
		''].join('\n'));
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
	assert.doesNotMatch(r.stdout, /one is positive/, 'an unchanged test was checked');
	assert.equal(spawnSync(process.execPath, [CHECK, 'HEAD~1', '--strict'], { cwd: dir, encoding: 'utf8' }).status, 1, 'strict fails on a finding');
});
