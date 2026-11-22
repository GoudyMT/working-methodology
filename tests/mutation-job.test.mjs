// U11 (K311, owner call 5): the minimal-code job. scripts/mutation-check.mjs gains a report-only mode (--base, --report,
// --slice i/n): it flips only the production lines a branch added, names every flip no test catches, and always exits 0.
// With no coverage map, or one for another commit, it prints flips: 0 and a note, and still exits 0 (lead's ruling).
// ci.yml runs it as a four-slice job that cannot fail the run and builds its own map first. No test calls a model. The
// script is spawned on small temp repos with a hand-written coverage map, so a missing flag fails one test on an
// assertion and nothing else.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();

const MUT = path.resolve('scripts/mutation-check.mjs');
const CI = path.resolve('.github/workflows/ci.yml');
const SRC = 'src/calc.mjs';
const TESTS = 'tests/calc.test.mjs';
const FUNCS = 9;
const ASSERTED = 6; // f1 to f6 are checked; f7 to f9 are only called, so their flips survive
// The base commit's own function: a line the base has and the branch does not change, mapped to a test all the same.
const BASE_SRC = '// base\nexport function old(x) {\n\treturn x === 0;\n}\n';
const SURVIVOR = (line) => `survivor: ${SRC}:${line}: missing test or code the tests do not demand`;

const write = (dir, rel, text) => {
	fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
	fs.writeFileSync(path.join(dir, rel), text);
};

// The production source the branch adds after the base's function: nine functions, each one line that flips (=== to !==).
function branchSource() {
	let s = BASE_SRC;
	for (let k = 1; k <= FUNCS; k++) s += `export function f${k}(x) {\n\treturn x === ${k};\n}\n`;
	return s;
}

// The test file the branch adds: f1 to f6 assert both results; f7 to f9 call the function and assert nothing; and one
// added line in the test file itself, which a flip must never touch (it is not production code).
function branchTest() {
	let s = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\n";
	s += `import { ${Array.from({ length: FUNCS }, (_, i) => `f${i + 1}`).join(', ')} } from '../src/calc.mjs';\n`;
	for (let k = 1; k <= ASSERTED; k++) s += `test('f${k} is checked', () => { assert.equal(f${k}(${k}), true); assert.equal(f${k}(0), false); });\n`;
	for (let k = ASSERTED + 1; k <= FUNCS; k++) s += `test('f${k} is only called', () => { f${k}(${k}); });\n`;
	s += 'export const TRAP = 9 > 2;\n';
	return s;
}

// The line number of the first line holding a needle, 1-based.
const lineOf = (text, needle) => text.split('\n').findIndex((l) => l.includes(needle)) + 1;

// The coverage map at the branch head: each test names the production lines it reaches (the flips the map ties to it).
// f1's test also reaches the base's own line, which must never be flipped by a run whose change does not touch it.
function mapFor(src, testSrc) {
	const tests = {};
	for (let k = 1; k <= FUNCS; k++) {
		const reached = { [SRC]: [lineOf(src, `return x === ${k};`)] };
		if (k === 1) reached[SRC].push(lineOf(src, 'return x === 0;'));
		if (k > ASSERTED) reached[TESTS] = [lineOf(testSrc, 'TRAP')];
		const name = k <= ASSERTED ? 'is checked' : 'is only called';
		tests[`${TESTS}::f${k} ${name}`] = { lines: reached };
	}
	return { tests };
}

// A repo for each variant: a base commit, then a branch that adds the source and test lines, and a map at its head.
// head: the map names the branch head (the normal case). stale: the map names the base. none: no map at all.
const CACHE = {};
function fixture(variant = 'head') {
	if (CACHE[variant]) return CACHE[variant];
	const root = kitTemp.makeTemp('mutation-job-');
	const g = (...a) => spawnSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' });
	g('init', '-q', '-b', 'main');
	write(root, SRC, BASE_SRC);
	write(root, TESTS, '// base\n');
	g('add', '-A');
	g('commit', '-qm', 'base');
	const base = g('rev-parse', 'HEAD').stdout.trim();
	g('switch', '-qc', 'feat/x');
	const src = branchSource();
	const testSrc = branchTest();
	write(root, SRC, src);
	write(root, TESTS, testSrc);
	g('add', '-A');
	g('commit', '-qm', 'change');
	const head = g('rev-parse', 'HEAD').stdout.trim();
	if (variant !== 'none') write(root, 'tests/.map.json', JSON.stringify({ sha: variant === 'stale' ? base : head, ...mapFor(src, testSrc) }));
	CACHE[variant] = { root, base, head, src };
	return CACHE[variant];
}

// A report run on a fixture: --base names the base commit unless a test passes another.
const report = (extra = [], { variant = 'head', base } = {}) => {
	const f = fixture(variant);
	return spawnSync(process.execPath, [MUT, '--base', base ?? f.base, '--report', ...extra], { cwd: f.root, encoding: 'utf8' });
};

let UNSLICED = null;
const unsliced = () => (UNSLICED ||= report());

// The survivor lines a run printed, each as its file and line.
const survivorsOf = (out) => out.split('\n').filter((l) => l.startsWith('survivor: '));
const flipsOf = (out) => Number(out.split('\n')[0].replace('flips: ', ''));

// ---------------------------------------------------------------------------------------------------------------
// 1. scripts/mutation-check.mjs report mode
// ---------------------------------------------------------------------------------------------------------------

// why: catches a report that names the asserted line as a survivor, sending the owner to fix a line that is covered
test('report mode names the unasserted survivor and not the asserted line', () => {
	const r = unsliced();
	assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
	const src = fixture().src;
	const out = survivorsOf(r.stdout);
	assert.ok(out.includes(SURVIVOR(lineOf(src, 'return x === 7;'))), `no survivor for the unasserted line:\n${r.stdout}`);
	assert.ok(!out.some((l) => l.startsWith(`survivor: ${SRC}:${lineOf(src, 'return x === 1;')}:`)), 'the asserted line is named as a survivor');
});

// why: guards rule:test-value (the job reports survivors and must never fail the run on them, so report mode exits 0)
test('report mode exits 0 even when flips survive', () => {
	const r = unsliced();
	assert.ok(survivorsOf(r.stdout).length > 0, 'the fixture has no survivor to test the exit code against');
	assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
});

// why: catches a test-file line counted as a production flip, so the job reports flips the branch did not make in src
test('report mode opens with the production flip count and counts no test-file line', () => {
	const r = unsliced();
	assert.equal(r.stdout.split('\n')[0], `flips: ${FUNCS}`, r.stdout);
});

// why: catches a base-commit line mapped to a test being flipped, so the job measures code this branch never changed
test('report mode never flips a base-commit line that a test reaches', () => {
	const r = unsliced();
	assert.equal(flipsOf(r.stdout), FUNCS, r.stdout);
	const oldLine = lineOf(BASE_SRC, 'return x === 0;');
	assert.ok(!survivorsOf(r.stdout).some((l) => l.startsWith(`survivor: ${SRC}:${oldLine}:`)), 'the base line is named as a survivor');
});

// why: catches a report against the branch's own head, which has no change to flip, still flipping lines from the base
test('report mode with --base at HEAD prints flips: 0', () => {
	const r = report([], { base: fixture().head });
	assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
	assert.equal(r.stdout.split('\n')[0], 'flips: 0', r.stdout);
});

// why: catches a missing coverage map failing the job red, when the job builds its map first and a miss must only be reported
test('report mode with no coverage map exits 0, prints flips: 0 and a note', () => {
	const r = report([], { variant: 'none' });
	assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
	assert.equal(r.stdout.split('\n')[0], 'flips: 0', r.stdout);
	assert.match(r.stdout, /^note: /m);
});

// why: catches a map made for an older commit being read as this change's coverage, flipping lines against stale numbers
test('report mode with a map for another commit exits 0, prints flips: 0 and a note', () => {
	const r = report([], { variant: 'stale' });
	assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
	assert.equal(r.stdout.split('\n')[0], 'flips: 0', r.stdout);
	assert.match(r.stdout, /^note: /m);
});

// why: catches the four slices together missing or repeating a flip, so the job measures less than the whole change
test('the four slices cover every flip once and their survivors add up to the whole run', () => {
	const whole = unsliced();
	const total = flipsOf(whole.stdout);
	const sliced = [1, 2, 3, 4].map((i) => report(['--slice', `${i}/4`]));
	sliced.forEach((r, i) => assert.equal(r.status, 0, `slice ${i + 1}: ${r.stdout}${r.stderr}`));
	const counts = sliced.map((r) => flipsOf(r.stdout));
	assert.equal(counts.reduce((a, b) => a + b, 0), total, `slice counts ${counts.join(', ')} do not add up to ${total}`);
	const union = sliced.flatMap((r) => survivorsOf(r.stdout));
	assert.equal(new Set(union).size, union.length, 'a survivor shows in more than one slice');
	assert.deepEqual([...new Set(union)].sort(), [...new Set(survivorsOf(whole.stdout))].sort());
});

// why: catches a slice taking the wrong every-n-th flip, so one slice names a survivor that belongs to another
test('each slice takes every fourth flip in line order and names its own survivors', () => {
	const src = fixture().src;
	const at = (k) => lineOf(src, `return x === ${k};`);
	// Flips in line order are f1..f9; slice i takes the flips at positions i-1, i+3, i+7 (0-based), so 1/4 is f1, f5, f9.
	const expected = [
		{ count: 3, survivors: [SURVIVOR(at(9))] },
		{ count: 2, survivors: [] },
		{ count: 2, survivors: [SURVIVOR(at(7))] },
		{ count: 2, survivors: [SURVIVOR(at(8))] },
	];
	[1, 2, 3, 4].forEach((i) => {
		const r = report(['--slice', `${i}/4`]);
		assert.equal(r.status, 0, `slice ${i}: ${r.stdout}${r.stderr}`);
		assert.equal(flipsOf(r.stdout), expected[i - 1].count, `slice ${i} flip count`);
		assert.deepEqual(survivorsOf(r.stdout), expected[i - 1].survivors, `slice ${i} survivors`);
	});
});

// why: catches a 1/1 slice that drops or changes flips, so a one-job run would measure less than the unsliced run
test('slice 1/1 is the whole run', () => {
	const whole = unsliced();
	const one = report(['--slice', '1/1']);
	assert.equal(one.status, 0, `${one.stdout}${one.stderr}`);
	assert.equal(flipsOf(one.stdout), flipsOf(whole.stdout));
	assert.deepEqual(survivorsOf(one.stdout), survivorsOf(whole.stdout));
});

// why: catches a malformed slice such as 0/4, 1/0 or 1/4/2 running as some slice, which would measure the wrong share
test('report mode exits 2 with nothing on stdout for every malformed slice', () => {
	for (const bad of ['0/4', '5/4', 'x', '1/0', '-1/4', '1.5/4', '1/4/2', '/4']) {
		const r = report(['--slice', bad]);
		assert.equal(r.status, 2, `${bad}: ${r.stdout}${r.stderr}`);
		assert.equal(r.stdout, '', `${bad} printed to stdout`);
	}
});

// ---------------------------------------------------------------------------------------------------------------
// 2. .github/workflows/ci.yml minimal-code job
// ---------------------------------------------------------------------------------------------------------------

// The text of the minimal-code job: from its key line to the next top-level job key.
const minimalJob = () => {
	const parts = fs.readFileSync(CI, 'utf8').split(/^  minimal-code:$/m);
	const job = parts.length > 1 ? parts[1].split(/^  [A-Za-z0-9_-]+:$/m)[0] : '';
	// Extent guard: a job text with no runs-on or steps is a cut at the wrong key, never the job.
	return job.includes('runs-on:') && job.includes('steps:') ? job : '';
};

// why: guards rule:ci-gate (the minimal-code job runs on a pull request, in twelve minutes, over four slices)
test('the minimal-code job runs on pull requests in twelve minutes over slices 1 to 4', () => {
	const job = minimalJob();
	assert.ok(job, 'no minimal-code job in ci.yml');
	assert.match(job, /if: github\.event_name == 'pull_request'/);
	assert.match(job, /^    timeout-minutes: 12$/m);
	assert.match(job, /slice:\s*\[\s*1\s*,\s*2\s*,\s*3\s*,\s*4\s*\]/);
});

// why: guards rule:ci-gate (one run line names the script, the PR base sha, report mode and the matrix slice together)
test('one run line runs the report for its slice against the PR base sha', () => {
	const job = minimalJob();
	assert.ok(job, 'no minimal-code job in ci.yml');
	const run = job.split('\n').find((l) => l.includes('scripts/mutation-check.mjs'));
	assert.ok(run, 'no run line names scripts/mutation-check.mjs');
	for (const part of ['--base ${{ github.event.pull_request.base.sha }}', '--report', '--slice ${{ matrix.slice }}/4']) {
		assert.ok(run.includes(part), `the run line lacks ${part}: ${run}`);
	}
});

// why: catches a job that measures the branch against a map it never built, so the flip list describes stale coverage
test('the minimal-code job builds its map on a full checkout before the run line', () => {
	const job = minimalJob();
	assert.ok(job, 'no minimal-code job in ci.yml');
	assert.match(job, /^\s+fetch-depth: 0$/m, 'the checkout does not fetch full history');
	const mapAt = job.indexOf('node scripts/test-run.mjs --map');
	const runAt = job.indexOf('scripts/mutation-check.mjs');
	assert.ok(mapAt >= 0, 'the job does not build the coverage map');
	assert.ok(mapAt < runAt, 'the map is built after the run line');
});

// why: guards rule:ci-gate (no survivor may turn the run red, so the job sets continue-on-error at job level)
test('the minimal-code job cannot fail the run: continue-on-error is set at job level', () => {
	const job = minimalJob();
	assert.ok(job, 'no minimal-code job in ci.yml');
	assert.match(job, /^    continue-on-error: true$/m);
});

// why: guards rule:ci-gate (a job that reads a secret would run a PR's own code next to it, so the job holds none)
test('the minimal-code job reads no secrets and does not inherit them', () => {
	const job = minimalJob();
	assert.ok(job, 'no minimal-code job in ci.yml');
	assert.doesNotMatch(job, /secrets\./);
	assert.doesNotMatch(job, /\$\{\{\s*secrets/);
	assert.doesNotMatch(job, /secrets:\s*inherit/);
});

// why: guards rule:ci-gate (the job's token reads the repository only, so a PR's code cannot write with it)
test('the minimal-code job grants contents: read and nothing else', () => {
	const job = minimalJob();
	assert.ok(job, 'no minimal-code job in ci.yml');
	const m = /^    permissions:\n((?:      .+\n)+)/m.exec(job);
	assert.ok(m, 'the job sets no permissions block');
	assert.deepEqual(m[1].trim().split('\n').map((l) => l.trim()), ['contents: read']);
});
