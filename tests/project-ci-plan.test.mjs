// project/.claude/ci-plan.mjs sizes a project's test shards from its test report. Each test runs the script as a child
// process from a temp project folder, the way a project's CI step runs it.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(REPO, 'project', '.claude', 'ci-plan.mjs');

// GITHUB_OUTPUT is removed unless the caller sets it, so stdout is the default sink.
function runPlan(cwd, args, env = {}) {
	const childEnv = { ...process.env, ...env };
	if (!('GITHUB_OUTPUT' in env)) delete childEnv.GITHUB_OUTPUT;
	return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, env: childEnv, encoding: 'utf8' });
}

// A jest or vitest --json report: testResults[] with each file's start and end in ms.
function jsonReport(files) {
	const testResults = files.map(([name, seconds]) => ({ name, startTime: 1000, endTime: 1000 + seconds * 1000 }));
	return JSON.stringify({ numTotalTestSuites: files.length, testResults });
}

// A temp project folder for one test, removed after it.
function projectFolder(fn) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-plan-'));
	try {
		return fn(dir);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

// why: catches a jest or vitest JSON report of 400 s gives 4 shards at 110 s each (CI-D S1)
test('a jest or vitest JSON report of 400 s gives 4 shards at 110 s each', () => {
	projectFolder((dir) => {
		fs.writeFileSync(path.join(dir, 'report.json'), jsonReport([['tests/a.test.js', 200], ['tests/b.test.js', 200]]));
		const r = runPlan(dir, ['--report', 'report.json']);
		assert.equal(r.status, 0, r.stderr);
		assert.match(r.stdout, /^total=400$/m);
		assert.match(r.stdout, /^shards=\{"shard":\[1,2,3,4\]\}$/m);
	});
});

// why: catches a pytest durations file is read the same way (CI-D S2)
test('a pytest durations file is read the same way', () => {
	projectFolder((dir) => {
		fs.writeFileSync(
			path.join(dir, 'durations.txt'),
			'250.00s call     tests/test_a.py::test_one\n150.00s setup    tests/test_b.py::test_two\n',
		);
		const r = runPlan(dir, ['--report', 'durations.txt']);
		assert.equal(r.status, 0, r.stderr);
		assert.match(r.stdout, /^total=400$/m);
		assert.match(r.stdout, /^shards=\{"shard":\[1,2,3,4\]\}$/m);
	});
});

// why: catches no report gives 1 shard and says "not measured" (CI-D S3)
test('no report gives 1 shard and says "not measured"', () => {
	projectFolder((dir) => {
		for (const args of [[], ['--report', 'missing.json']]) {
			const r = runPlan(dir, args);
			const label = args.join(' ') || '(no --report)';
			assert.match(r.stdout, /not measured/, label);
			assert.match(r.stdout, /^shards=\{"shard":\[1\]\}$/m, label);
		}
	});
});

// why: catches over 6 shards exits 1 naming the 5 slowest tests (CI-D S4)
test('over 6 shards exits 1 naming the 5 slowest tests', () => {
	projectFolder((dir) => {
		const over = [
			['tests/a.test.js', 200],
			['tests/b.test.js', 150],
			['tests/c.test.js', 120],
			['tests/d.test.js', 100],
			['tests/e.test.js', 90],
			['tests/f.test.js', 50],
			['tests/g.test.js', 20],
		];
		fs.writeFileSync(path.join(dir, 'report.json'), jsonReport(over));
		const r = runPlan(dir, ['--report', 'report.json']);
		assert.equal(r.status, 1, r.stderr);
		assert.match(
			r.stderr,
			/^ci-plan: 730 s is over 6 shards at 110 s; slowest: tests\/a\.test\.js \(200 s\), tests\/b\.test\.js \(150 s\), tests\/c\.test\.js \(120 s\), tests\/d\.test\.js \(100 s\), tests\/e\.test\.js \(90 s\)/m,
		);
		assert.doesNotMatch(r.stderr, /tests\/f\.test\.js|tests\/g\.test\.js/);
		// Exactly 660 s is 6 shards, not over: the line is over 660, not at it.
		fs.writeFileSync(path.join(dir, 'edge.json'), jsonReport([['tests/a.test.js', 660]]));
		const edge = runPlan(dir, ['--report', 'edge.json']);
		assert.equal(edge.status, 0, edge.stderr);
		assert.match(edge.stdout, /^shards=\{"shard":\[1,2,3,4,5,6\]\}$/m);
	});
});

// why: catches output is matrix JSON for the template (CI-D S5)
test('output is matrix JSON for the template', () => {
	projectFolder((dir) => {
		fs.writeFileSync(path.join(dir, 'report.json'), jsonReport([['tests/a.test.js', 200], ['tests/b.test.js', 200]]));
		const out = path.join(dir, 'github-output.txt');
		fs.writeFileSync(out, 'earlier=kept\n');
		const flag = runPlan(dir, ['--report', 'report.json', '--github-output', out]);
		assert.equal(flag.status, 0, flag.stderr);
		assert.deepEqual(fs.readFileSync(out, 'utf8').split('\n').filter(Boolean), [
			'earlier=kept',
			'total=400',
			'shards={"shard":[1,2,3,4]}',
		]);
		// CI sets GITHUB_OUTPUT itself, so the same lines must land there with no flag.
		const envOut = path.join(dir, 'env-output.txt');
		const viaEnv = runPlan(dir, ['--report', 'report.json'], { GITHUB_OUTPUT: envOut });
		assert.equal(viaEnv.status, 0, viaEnv.stderr);
		assert.deepEqual(fs.readFileSync(envOut, 'utf8').split('\n').filter(Boolean), [
			'total=400',
			'shards={"shard":[1,2,3,4]}',
		]);
	});
});
