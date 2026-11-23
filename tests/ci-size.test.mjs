// scripts/ci-size.mjs sizes the CI jobs from the measured test times in the map: unit runners, test-check slices and
// minimal-code slices, and the GITHUB_OUTPUT lines the plan job reads. A wrong count leaves a job over its time budget
// or starts runners with nothing to run.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const SCRIPT = path.resolve('scripts/ci-size.mjs');

// A map in test-run.mjs's shape: { tests: { "<file>::<name>": { ms } } }.
function map(entries) {
	const dir = kitTemp.makeTemp('ci-size-');
	const file = path.join(dir, 'map.json');
	const tests = {};
	for (const [key, ms] of entries) tests[key] = { ms };
	fs.writeFileSync(file, JSON.stringify({ tests }));
	return { dir, file };
}

// Runs the script with the map and a fresh --github-output file; returns its status, stderr and output lines.
let outputs = 0;
function run(dir, mapFile, args = []) {
	const out = path.join(dir, `github-output-${outputs++}.txt`);
	const r = spawnSync(process.execPath, [SCRIPT, '--map', mapFile, '--github-output', out, ...args], { encoding: 'utf8' });
	const lines = fs.existsSync(out) ? fs.readFileSync(out, 'utf8').split('\n').filter(Boolean) : [];
	return { status: r.status, stderr: r.stderr, lines };
}

// why: catches predicted 330 s gives 3 unit runners, 100 s gives 1, cap 6 (CI-A S1)
test('predicted 330 s gives 3 unit runners, 100 s gives 1, cap 6', () => {
	for (const [seconds, shards] of [[330, '[0,1,2]'], [100, '[0]'], [650, '[0,1,2,3,4,5]']]) {
		const m = map([['tests/a.test.mjs::one', seconds * 1000]]);
		const r = run(m.dir, m.file);
		assert.equal(r.status, 0, `${seconds} s: exit ${r.status}, stderr: ${r.stderr}`);
		assert.ok(r.lines.includes(`unit={"shard":${shards}}`), `${seconds} s: output ${JSON.stringify(r.lines)}`);
	}
});

// why: catches 600 changed tests give 6 test-check slices, 0 give 1 (CI-A S2)
test('600 changed tests give 6 test-check slices, 0 give 1', () => {
	const m = map([['tests/a.test.mjs::one', 1000]]);
	const six = run(m.dir, m.file, ['--changed-tests', '600']);
	assert.equal(six.status, 0, `600 changed: exit ${six.status}, stderr: ${six.stderr}`);
	assert.ok(six.lines.includes('check={"slice":[0,1,2,3,4,5]}'), `600 changed: output ${JSON.stringify(six.lines)}`);
	const zero = run(m.dir, m.file, ['--changed-tests', '0']);
	assert.equal(zero.status, 0, `0 changed: exit ${zero.status}, stderr: ${zero.stderr}`);
	assert.ok(zero.lines.includes('check={"slice":[0]}'), `0 changed: output ${JSON.stringify(zero.lines)}`);
});

// why: catches 655 flips give 4 minimal-code slices, 3 give 1 (CI-A S3)
test('655 flips give 4 minimal-code slices, 3 give 1', () => {
	const m = map([['tests/a.test.mjs::one', 1000]]);
	const many = run(m.dir, m.file, ['--flips', '655']);
	assert.equal(many.status, 0, `655 flips: exit ${many.status}, stderr: ${many.stderr}`);
	assert.ok(many.lines.includes('mutation={"slice":[1,2,3,4]}'), `655 flips: output ${JSON.stringify(many.lines)}`);
	const few = run(m.dir, m.file, ['--flips', '3']);
	assert.equal(few.status, 0, `3 flips: exit ${few.status}, stderr: ${few.stderr}`);
	assert.ok(few.lines.includes('mutation={"slice":[1]}'), `3 flips: output ${JSON.stringify(few.lines)}`);
});

// why: catches prediction over 6x110 s exits 1 naming the 5 slowest tests (CI-A S4)
test('prediction over 6x110 s exits 1 naming the 5 slowest tests', () => {
	const m = map([
		['tests/a.test.mjs::t1', 300000],
		['tests/a.test.mjs::t2', 200000],
		['tests/b.test.mjs::t3', 150000],
		['tests/b.test.mjs::t4', 100000],
		['tests/c.test.mjs::t5', 90000],
		['tests/c.test.mjs::t6', 80000],
		['tests/d.test.mjs::t7', 70000],
	]);
	const r = run(m.dir, m.file);
	assert.equal(r.status, 1, `over 660 s: exit ${r.status}, stderr: ${r.stderr}`);
	const slowest = ['tests/a.test.mjs::t1', 'tests/a.test.mjs::t2', 'tests/b.test.mjs::t3', 'tests/b.test.mjs::t4', 'tests/c.test.mjs::t5'];
	const at = slowest.map((name) => r.stderr.indexOf(name));
	for (const [i, pos] of at.entries()) assert.ok(pos >= 0, `slowest ${slowest[i]} not named: ${r.stderr}`);
	assert.deepEqual([...at].sort((x, y) => x - y), at, `slowest tests not in order: ${r.stderr}`);
	for (const quieter of ['tests/c.test.mjs::t6', 'tests/d.test.mjs::t7']) {
		assert.equal(r.stderr.includes(quieter), false, `${quieter} is not among the 5 slowest: ${r.stderr}`);
	}
});

// why: catches a test missing from the map counts the map median (CI-A S5)
test('a test missing from the map counts the map median', () => {
	// Per-file totals: a 50 s (two keys), b 60 s, c 40 s, d 500 s. Median 55 s; mean 162.5 s; median of one key, 40 s.
	const m = map([
		['tests/a.test.mjs::one', 20000],
		['tests/a.test.mjs::two', 30000],
		['tests/b.test.mjs::one', 60000],
		['tests/c.test.mjs::one', 40000],
		['tests/d.test.mjs::one', 500000],
	]);
	const r = run(m.dir, m.file, ['--tests', 'tests/missing.test.mjs']);
	assert.equal(r.status, 0, `missing test: exit ${r.status}, stderr: ${r.stderr}`);
	assert.ok(r.lines.includes('predicted=55'), `missing test: output ${JSON.stringify(r.lines)}`);
});

// why: catches output is GitHub matrix JSON on GITHUB_OUTPUT lines (CI-A S6)
test('output is GitHub matrix JSON on GITHUB_OUTPUT lines', () => {
	const m = map([['tests/a.test.mjs::one', 330000]]);
	const out = path.join(m.dir, 'github-output.txt');
	fs.writeFileSync(out, 'keep=1\n');
	const r = spawnSync(process.execPath, [SCRIPT, '--map', m.file, '--github-output', out, '--changed-tests', '250', '--flips', '450'], { encoding: 'utf8' });
	assert.equal(r.status, 0, `matrices: exit ${r.status}, stderr: ${r.stderr}`);
	const lines = fs.readFileSync(out, 'utf8').split('\n').filter(Boolean);
	const expected = ['keep=1', 'predicted=330', 'unit={"shard":[0,1,2]}', 'check={"slice":[0,1,2]}', 'mutation={"slice":[1,2,3]}'];
	assert.deepEqual([...lines].sort(), [...expected].sort(), `matrices: output ${JSON.stringify(lines)}`);
});
