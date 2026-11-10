// E32 (option C, the owner 2026-11-10): two test lanes on the same PR, both required, and the kit recognises when a
// project needs the second one. The lane-state script reports; it never edits a workflow, a ruleset or a test.
// Build brief: workbench results/layered-testing/RESULT.md, "Build brief for E32"; proof steps (a) to (e) there.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const SCRIPT = path.resolve('project/.claude/lane-state.mjs');

// A project of either kind the brief names: Node (tests beside source, slow tests in tests/slow) or pytest (the same
// folder convention, read by a conftest hook).
function project(kind, lanes) {
	const dir = kitTemp.makeTemp(`lanes-${kind}-`);
	fs.mkdirSync(path.join(dir, '.kit'));
	if (kind === 'node') fs.writeFileSync(path.join(dir, 'a.test.mjs'), 'test\n');
	else fs.writeFileSync(path.join(dir, 'test_a.py'), 'def test_a(): pass\n');
	if (lanes) fs.writeFileSync(path.join(dir, '.kit', 'lanes.json'), JSON.stringify(lanes));
	return dir;
}
const state = (dir, ...args) => {
	const r = spawnSync(process.execPath, [SCRIPT, '--json', ...args], { cwd: dir, encoding: 'utf8' });
	return { code: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr };
};

test('(a) with no large test a project is in one lane; (b) one large test turns the slow lane on with no other edit', () => {
	for (const kind of ['node', 'pytest']) {
		const dir = project(kind);
		const one = state(dir);
		assert.equal(one.code, 0, one.err);
		assert.equal(one.out.state, 'one-lane', kind);
		assert.deepEqual(one.out.counts, { large: 0 });
		fs.mkdirSync(path.join(dir, 'tests', 'slow'), { recursive: true });
		fs.writeFileSync(path.join(dir, 'tests', 'slow', kind === 'node' ? 'browser.test.mjs' : 'test_browser.py'), 'x\n');
		const two = state(dir);
		assert.equal(two.code, 0);
		assert.equal(two.out.state, 'two-lanes', kind);
		assert.deepEqual(two.out.counts, { large: 1 });
		// The slow lane empties: back to one lane.
		fs.rmSync(path.join(dir, 'tests', 'slow'), { recursive: true });
		assert.equal(state(dir).out.state, 'one-lane');
	}
});

test('(e) three fast-lane runs over budget in a row report over budget, the slowest tests and the next lever', () => {
	const dir = project('node', { budgetMinutes: 10, levers: ['measure', 'parallel'] });
	const runs = (mins) => mins.map((m, i) => ({ minutes: m, tests: [{ name: `slow one ${i}`, seconds: 300 }, { name: 'quick', seconds: 1 }] }));
	const file = path.join(dir, 'times.json');
	fs.writeFileSync(file, JSON.stringify(runs([4, 11, 12])));
	const two = state(dir, '--times', file);
	assert.equal(two.code, 0, 'two over budget is not three in a row');
	assert.equal(two.out.state, 'one-lane');
	fs.writeFileSync(file, JSON.stringify(runs([11, 12, 13])));
	const over = state(dir, '--times', file);
	assert.equal(over.code, 1, 'over budget is a finding');
	assert.equal(over.out.state, 'over-budget');
	assert.equal(over.out.budgetMinutes, 10);
	assert.deepEqual(over.out.lastMinutes, [11, 12, 13]);
	assert.equal(over.out.slowest[0].name, 'slow one 2');
	assert.ok(!over.out.slowest.some((t) => t.name === 'quick'), 'only the tests that cost the time');
	// The levers in order; the ones the project marks applied are skipped, moving tests out is the last.
	assert.equal(over.out.nextLever, 'cancel stale runs');
	const plain = state(project('node'), '--times', file).out;
	assert.equal(plain.nextLever, 'measure');
});

test('the script only reports: it changes no file, and a broken lanes file is an error, not a lane state', () => {
	const dir = project('node', { budgetMinutes: 10 });
	const before = fs.readdirSync(dir, { recursive: true }).sort();
	state(dir);
	assert.deepEqual(fs.readdirSync(dir, { recursive: true }).sort(), before);
	fs.writeFileSync(path.join(dir, '.kit', 'lanes.json'), '{ not json');
	assert.equal(state(dir).code, 2);
});

test('(d) a fast-lane test over its time limit fails, and the failure names the limit', () => {
	const dir = kitTemp.makeTemp('limit-');
	const harness = path.resolve('tests/harness.mjs').split(path.sep).join('/');
	fs.writeFileSync(path.join(dir, 'slow.test.mjs'), `import { test } from 'file:///${harness.replace(/^\//, '')}';\ntest('waits', () => new Promise((r) => setTimeout(r, 2000)));\n`);
	// The runner's own shard, filter and map settings stay out: this child runs its one test whole.
	// Nor the test runner's own context: Node 22 runs no file for a node --test that inherits it (CI, PR 28).
	const { NODE_TEST_CONTEXT: _c, KIT_SHARD: _s, KIT_ONLY: _o, KIT_MAP_DIR: _m, KIT_RUN_AT: _a, ...env } = process.env;
	const r = spawnSync(process.execPath, ['--test', 'slow.test.mjs'], { cwd: dir, encoding: 'utf8', env: { ...env, KIT_TEST_LIMIT_MS: '200' } });
	assert.notEqual(r.status, 0);
	assert.match(r.stdout, /timed out after 200ms/);
});

test('(c) the kit\'s own CI runs the slow lane beside the fast one, only when it holds a test, and needs both to merge', () => {
	const ci = fs.readFileSync(path.resolve('.github/workflows/ci.yml'), 'utf8');
	// The slow job is skipped by a job-level if on what a detect step found, never by a path filter on the workflow.
	// pin: 1 (GitHub reads these lines)
	assert.match(ci, /\n {2}slow-tests:\n {4}needs: \[lanes\]\n {4}if: needs\.lanes\.outputs\.slow == 'true'/);
	assert.doesNotMatch(ci, /\n {2}(pull_request|push):\n {4}paths:/);
	// The required check fails on a slow lane that failed, and takes a skipped one as passed. pin: 1 (GitHub reads it)
	const gate = ci.slice(ci.indexOf('\n  kit-tests:'));
	assert.match(gate, /needs: \[[^\]]*slow-tests[^\]]*\]/);
	assert.match(gate, /needs\.slow-tests\.result != 'success' && needs\.slow-tests\.result != 'skipped'/); // pin: 1
	// The kit itself has no large test today, so the script says one lane for it.
	const kit = spawnSync(process.execPath, [SCRIPT, '--json'], { encoding: 'utf8' });
	assert.equal(JSON.parse(kit.stdout).state, 'one-lane');
});
