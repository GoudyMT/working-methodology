// U11 (K311, owner call 5): the minimal-code job. scripts/mutation-check.mjs gains a report-only mode (--base, --report,
// --slice i/n): it flips only the production lines a branch added, names every flip no test catches, and always exits 0.
// ci.yml runs it as a four-slice job that cannot fail the run. No test calls a model. The script is spawned on a small
// temp repo with a hand-written coverage map, so a missing flag fails one test on an assertion and nothing else.
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
const SURVIVOR = (line) => `survivor: ${SRC}:${line}: missing test or code the tests do not demand`;

const write = (dir, rel, text) => {
	fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
	fs.writeFileSync(path.join(dir, rel), text);
};

// The production source the branch adds: nine functions, each one line that flips (=== to !==).
function branchSource() {
	let s = '// base\n';
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

// The coverage map at the branch head: each test names the production lines it reaches (the flips the map ties to it).
function mapFor(src, testSrc) {
	const lines = src.split('\n');
	const at = (needle) => lines.findIndex((l) => l.includes(needle)) + 1;
	const tests = {};
	for (let k = 1; k <= FUNCS; k++) {
		const reached = { [SRC]: [at(`return x === ${k};`)] };
		if (k > ASSERTED) reached[TESTS] = [testSrc.split('\n').findIndex((l) => l.includes('TRAP')) + 1];
		const name = k <= ASSERTED ? 'is checked' : 'is only called';
		tests[`${TESTS}::f${k} ${name}`] = { lines: reached };
	}
	return { tests };
}

// One repo for every test: a base commit, then a branch that adds the source and test lines, and a map at its head.
let FIX = null;
function fixture() {
	if (FIX) return FIX;
	const root = kitTemp.makeTemp('mutation-job-');
	const g = (...a) => spawnSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' });
	g('init', '-q', '-b', 'main');
	write(root, SRC, '// base\n');
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
	write(root, 'tests/.map.json', JSON.stringify({ sha: head, ...mapFor(src, testSrc) }));
	FIX = { root, base, head };
	return FIX;
}

const report = (extra = []) => {
	const f = fixture();
	return spawnSync(process.execPath, [MUT, '--base', f.base, '--report', ...extra], { cwd: f.root, encoding: 'utf8' });
};

let UNSLICED = null;
const unsliced = () => (UNSLICED ||= report());

// The survivor lines a run printed, each as its file and line.
const survivorsOf = (out) => out.split('\n').filter((l) => l.startsWith('survivor: '));

// ---------------------------------------------------------------------------------------------------------------
// 1. scripts/mutation-check.mjs report mode
// ---------------------------------------------------------------------------------------------------------------

// why: catches a report that names the asserted line as a survivor, sending the owner to fix a line that is covered
test('report mode names the unasserted survivor and not the asserted line', () => {
	const r = unsliced();
	assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
	const f7 = fixture();
	const line7 = fs.readFileSync(path.join(f7.root, SRC), 'utf8').split('\n').findIndex((l) => l.includes('return x === 7;')) + 1;
	const line1 = fs.readFileSync(path.join(f7.root, SRC), 'utf8').split('\n').findIndex((l) => l.includes('return x === 1;')) + 1;
	const out = survivorsOf(r.stdout);
	assert.ok(out.includes(SURVIVOR(line7)), `no survivor for the unasserted line ${line7}:\n${r.stdout}`);
	assert.ok(!out.some((l) => l.startsWith(`survivor: ${SRC}:${line1}:`)), `the asserted line ${line1} is named as a survivor`);
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

// why: catches a slice split that drops a flip or runs one twice, so one slice of the four measures nothing it should
test('the four slices cover every flip once and their survivors add up to the whole run', () => {
	const whole = unsliced();
	const total = Number(whole.stdout.split('\n')[0].replace('flips: ', ''));
	const sliced = [1, 2, 3, 4].map((i) => report(['--slice', `${i}/4`]));
	sliced.forEach((r, i) => assert.equal(r.status, 0, `slice ${i + 1}: ${r.stdout}${r.stderr}`));
	const counts = sliced.map((r) => Number(r.stdout.split('\n')[0].replace('flips: ', '')));
	assert.equal(counts.reduce((a, b) => a + b, 0), total, `slice counts ${counts.join(', ')} do not add up to ${total}`);
	const union = sliced.flatMap((r) => survivorsOf(r.stdout));
	assert.equal(new Set(union).size, union.length, 'a survivor shows in more than one slice');
	assert.deepEqual([...new Set(union)].sort(), [...new Set(survivorsOf(whole.stdout))].sort());
});

// why: catches a slice of 0, 5 or a word silently running as slice zero, which would measure the wrong share of flips
test('report mode exits 2 for a slice of 0/4, 5/4 or a word', () => {
	for (const bad of ['0/4', '5/4', 'x']) {
		const r = report(['--slice', bad]);
		assert.equal(r.status, 2, `${bad}: ${r.stdout}${r.stderr}`);
	}
});

// ---------------------------------------------------------------------------------------------------------------
// 2. .github/workflows/ci.yml minimal-code job
// ---------------------------------------------------------------------------------------------------------------

// The text of the minimal-code job: from its key line to the next job.
const minimalJob = () => {
	const parts = fs.readFileSync(CI, 'utf8').split(/^  minimal-code:$/m);
	return parts.length > 1 ? parts[1].split(/^  [a-z-]+:$/m)[0] : '';
};

// why: guards rule:ci-gate (the minimal-code job runs on a pull request, in twelve minutes, over four slices)
test('the minimal-code job runs on pull requests in twelve minutes over slices 1 to 4', () => {
	const job = minimalJob();
	assert.ok(job, 'no minimal-code job in ci.yml');
	assert.match(job, /if: github\.event_name == 'pull_request'/);
	assert.match(job, /^    timeout-minutes: 12$/m);
	assert.match(job, /slice:\s*\[\s*1\s*,\s*2\s*,\s*3\s*,\s*4\s*\]/);
});

// why: guards rule:ci-gate (the job runs the report over the PR base, one slice per matrix entry, and names no other mode)
test('the minimal-code job runs the report for its slice against the PR base sha', () => {
	const job = minimalJob();
	assert.ok(job, 'no minimal-code job in ci.yml');
	assert.ok(job.includes('--report --slice ${{ matrix.slice }}/4'), 'the run line has no --report --slice matrix slice');
	assert.ok(job.includes('--base'), 'the run line has no --base');
	assert.ok(job.includes('${{ github.event.pull_request.base.sha }}'), 'the job does not name the PR base sha');
});

// why: guards rule:ci-gate (no survivor may turn the run red, so the job sets continue-on-error at job level)
test('the minimal-code job cannot fail the run: continue-on-error is set at job level', () => {
	const job = minimalJob();
	assert.ok(job, 'no minimal-code job in ci.yml');
	assert.match(job, /^    continue-on-error: true$/m);
});

// why: guards rule:ci-gate (a job that reads a secret would run a PR's own code next to it, so the job holds none)
test('the minimal-code job reads no secrets', () => {
	const job = minimalJob();
	assert.ok(job, 'no minimal-code job in ci.yml');
	assert.doesNotMatch(job, /secrets\./);
});
