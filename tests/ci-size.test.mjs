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
	// 331 s is the first figure past 3 runners (ceil(331 / 110) = 4); 660 s is the last that fits 6; 661 s is over.
	for (const [seconds, shards] of [[330, '[0,1,2]'], [100, '[0]'], [331, '[0,1,2,3]'], [650, '[0,1,2,3,4,5]'], [660, '[0,1,2,3,4,5]']]) {
		const m = map([['tests/a.test.mjs::one', seconds * 1000]]);
		const r = run(m.dir, m.file);
		assert.equal(r.status, 0, `${seconds} s: exit ${r.status}, stderr: ${r.stderr}`);
		assert.ok(r.lines.includes(`unit={"shard":${shards}}`), `${seconds} s: output ${JSON.stringify(r.lines)}`);
	}
	const over = map([['tests/a.test.mjs::one', 661000]]);
	// Past six runners it never fails the lanes job (M9): it names the overage, caps at 6 and exits 0.
	const past = run(over.dir, over.file);
	assert.equal(past.status, 0, `661 s: exit ${past.status}, stderr: ${past.stderr}`);
	assert.ok(past.lines.includes('unit={"shard":[0,1,2,3,4,5]}'), `661 s: output ${JSON.stringify(past.lines)}`);
	assert.match(past.stderr, /\b661\b[^\n]*\bover\b/, `661 s: overage not named: ${past.stderr}`);
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
	// 101 is the first count past one slice (ceil(1.01) = 2); 700 would be 7 slices and must be capped at 6.
	const edge = run(m.dir, m.file, ['--changed-tests', '101']);
	assert.equal(edge.status, 0, `101 changed: exit ${edge.status}, stderr: ${edge.stderr}`);
	assert.ok(edge.lines.includes('check={"slice":[0,1]}'), `101 changed: output ${JSON.stringify(edge.lines)}`);
	const capped = run(m.dir, m.file, ['--changed-tests', '700']);
	assert.equal(capped.status, 0, `700 changed: exit ${capped.status}, stderr: ${capped.stderr}`);
	assert.ok(capped.lines.includes('check={"slice":[0,1,2,3,4,5]}'), `700 changed: output ${JSON.stringify(capped.lines)}`);
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
	// 201 is the first count past one slice (ceil(201 / 200) = 2); 1000 would be 5 slices and must be capped at 4.
	const edge = run(m.dir, m.file, ['--flips', '201']);
	assert.equal(edge.status, 0, `201 flips: exit ${edge.status}, stderr: ${edge.stderr}`);
	assert.ok(edge.lines.includes('mutation={"slice":[1,2]}'), `201 flips: output ${JSON.stringify(edge.lines)}`);
	const capped = run(m.dir, m.file, ['--flips', '1000']);
	assert.equal(capped.status, 0, `1000 flips: exit ${capped.status}, stderr: ${capped.stderr}`);
	assert.ok(capped.lines.includes('mutation={"slice":[1,2,3,4]}'), `1000 flips: output ${JSON.stringify(capped.lines)}`);
	// With neither flag given, the counts are zero: one test-check slice and one minimal-code slice.
	const absent = run(m.dir, m.file);
	assert.equal(absent.status, 0, `no flags: exit ${absent.status}, stderr: ${absent.stderr}`);
	assert.ok(absent.lines.includes('check={"slice":[0]}'), `no flags: output ${JSON.stringify(absent.lines)}`);
	assert.ok(absent.lines.includes('mutation={"slice":[1]}'), `no flags: output ${JSON.stringify(absent.lines)}`);
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
	assert.equal(r.status, 0, `over 660 s: exit ${r.status}, stderr: ${r.stderr}`);
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
	// A present file counts the sum of its own keys: a is 20 + 30 = 50 s.
	const present = run(m.dir, m.file, ['--tests', 'tests/a.test.mjs']);
	assert.equal(present.status, 0, `present file: exit ${present.status}, stderr: ${present.stderr}`);
	assert.ok(present.lines.includes('predicted=50'), `present file: output ${JSON.stringify(present.lines)}`);
	// A present file (b, 60 s) plus a missing one (the median, 55 s) is 115 s.
	const mixed = run(m.dir, m.file, ['--tests', 'tests/b.test.mjs,tests/missing.test.mjs']);
	assert.equal(mixed.status, 0, `mixed: exit ${mixed.status}, stderr: ${mixed.stderr}`);
	assert.ok(mixed.lines.includes('predicted=115'), `mixed: output ${JSON.stringify(mixed.lines)}`);
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

	// A missing map is a bad input: exit 2, not a sized plan.
	const absentMap = spawnSync(process.execPath, [SCRIPT, '--map', path.join(m.dir, 'no-such-map.json'), '--github-output', out], { encoding: 'utf8' });
	assert.equal(absentMap.status, 2, `missing map: exit ${absentMap.status}, stderr: ${absentMap.stderr}`);

	// With no --github-output and no GITHUB_OUTPUT in the environment, the same lines go to stdout.
	const env = { ...process.env };
	delete env.GITHUB_OUTPUT;
	const stdout = spawnSync(process.execPath, [SCRIPT, '--map', m.file], { encoding: 'utf8', env });
	assert.equal(stdout.status, 0, `stdout: exit ${stdout.status}, stderr: ${stdout.stderr}`);
	const printed = stdout.stdout.split('\n').filter(Boolean);
	const printedWant = ['predicted=330', 'unit={"shard":[0,1,2]}', 'check={"slice":[0]}', 'mutation={"slice":[1]}'];
	assert.deepEqual([...printed].sort(), [...printedWant].sort(), `stdout: output ${JSON.stringify(printed)}`);

		// With GITHUB_OUTPUT set in the environment and no --github-output flag, the lines are appended to that file.
		const envFile = path.join(m.dir, 'env-github-output.txt');
		fs.writeFileSync(envFile, 'keep=1\n');
		const viaEnv = { ...process.env, GITHUB_OUTPUT: envFile };
		const fromEnv = spawnSync(process.execPath, [SCRIPT, '--map', m.file], { encoding: 'utf8', env: viaEnv });
		assert.equal(fromEnv.status, 0, `env file: exit ${fromEnv.status}, stderr: ${fromEnv.stderr}`);
		const appended = fs.readFileSync(envFile, 'utf8').split('\n').filter(Boolean);
		assert.deepEqual([...appended].sort(), ['keep=1', ...printedWant].sort(), `env file: output ${JSON.stringify(appended)}`);
});

// A temp git repo: the base commit holds `before` as tests/a.test.mjs (none when null); the head commit holds `after`.
function repoOf(before, after) {
	const dir = kitTemp.makeTemp('ci-size-repo-');
	const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, encoding: 'utf8' });
	git('init', '-q', '-b', 'main');
	fs.mkdirSync(path.join(dir, 'tests'));
	fs.writeFileSync(path.join(dir, 'README'), 'x');
	if (before !== null) fs.writeFileSync(path.join(dir, 'tests/a.test.mjs'), before);
	git('add', '.'); git('commit', '-qm', 'base');
	const base = git('rev-parse', 'HEAD').stdout.trim();
	fs.writeFileSync(path.join(dir, 'tests/a.test.mjs'), after);
	git('add', '.'); git('commit', '-qm', 'head');
	return { dir, base };
}
const plain = (n) => Array.from({ length: n }, (_, i) => `test('t${i}', () => {});`).join('\n') + '\n';

// why: catches changed-test count read from test-check's own parse so loops count and unchanged tests do not (M10)
test('the changed-test count comes from the test parse of base against head, loops counted', () => {
	const m = map([['tests/a.test.mjs::one', 1000]]);
	// Runs the script in the repo with --base (the flag that asks for the count) and returns the status, stderr and lines.
	const sized = (repo, name) => {
		const out = path.join(m.dir, name);
		const r = spawnSync(process.execPath, [SCRIPT, '--map', m.file, '--base', repo.base, '--github-output', out], { cwd: repo.dir, encoding: 'utf8' });
		return { status: r.status, stderr: r.stderr, lines: fs.existsSync(out) ? fs.readFileSync(out, 'utf8').split('\n').filter(Boolean) : [] };
	};
	// 100 new plain tests and a loop that makes more: 101 changed units is past one slice. A grep for test( at the margin
	// finds 100 and misses the loop, so it would size one slice.
	const looped = sized(repoOf(null, plain(100) + 'for (const x of [1, 2]) {\n\ttest(`loop ${x}`, () => {});\n}\n'), 'looped.txt');
	assert.equal(looped.status, 0, `looped: exit ${looped.status}, stderr: ${looped.stderr}`);
	assert.ok(looped.lines.includes('check={"slice":[0,1]}'), `looped: output ${JSON.stringify(looped.lines)}`);
	// 150 tests already on the base and one new: one changed unit. A grep counts every test in the changed file (151).
	const grown = sized(repoOf(plain(150), plain(150) + "test('fresh', () => {});\n"), 'grown.txt');
	assert.equal(grown.status, 0, `grown: exit ${grown.status}, stderr: ${grown.stderr}`);
	assert.ok(grown.lines.includes('check={"slice":[0]}'), `grown: output ${JSON.stringify(grown.lines)}`);
});
