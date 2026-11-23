// A planned retest is its own checklist step. Each test runs flow-check's checklist subcommand or plan-check on a plan
// and log written to a temp folder, so the test reads the same output a lead reads. Nothing here calls a model.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const FLOW = fileURLToPath(new URL('../user/kit-tools/flow-check.mjs', import.meta.url));
const PLAN_CHECK = fileURLToPath(new URL('../user/kit-tools/plan-check.mjs', import.meta.url));

// A plan with the template's columns and one spec section per unit. Each unit gives its id, its Files cell and its Tests cell.
const planOf = (units) => [
	'# Batch plan - retest step',
	'',
	'## Units',
	'',
	'| Id | Files | Runs | Risk | Category | Tests | Tester |',
	'|---|---|---|---|---|---|---|',
	...units.map((u) => `| ${u.id} | ${u.files} | alone | low | logic | ${u.tests} | builder |`),
	'',
	...units.flatMap((u) => [`### ${u.id} spec`, '- S1: a retest unit needs a retest step before merged.', '']),
].join('\n');
const planWith = (files, tests) => planOf([{ id: 'U1', files, tests }]);
const RETEST_LINE = 'retest: tests/kit-sweep.test.mjs:70 now expects a worktree brief to name its own rules file -> S1';
const PLAIN_LINE = 'tests/plain.test.mjs holds the worktree brief -> S1';
const step = (n, name, unit = 'U1') => JSON.stringify({ at: `2026-11-22T10:${String(n).padStart(2, '0')}:00Z`, unit, step: name, by: 'lead' });

// Writes the plan and the log into a temp folder and runs flow-check's checklist subcommand on them.
function checklistRun(planText, logLines) {
	assert.ok(fs.existsSync(FLOW), 'user/kit-tools/flow-check.mjs is missing');
	const dir = kitTemp.makeTemp('retest-step-');
	const plan = path.join(dir, 'plan.md');
	const log = path.join(dir, 'checklist.jsonl');
	fs.writeFileSync(plan, planText);
	fs.writeFileSync(log, logLines.join('\n') + '\n');
	const r = spawnSync(process.execPath, [FLOW, 'checklist', log, '--plan', plan], { cwd: dir, encoding: 'utf8' });
	const out = `${r.stdout}${r.stderr}`;
	assert.ok(!/node:internal|MODULE_NOT_FOUND|SyntaxError/.test(out), `flow-check ran without crashing: ${out}`);
	return { status: r.status, out, err: r.stderr };
}

// Writes the plan into a temp folder and runs plan-check on it.
function planCheckRun(planText) {
	assert.ok(fs.existsSync(PLAN_CHECK), 'user/kit-tools/plan-check.mjs is missing');
	const dir = kitTemp.makeTemp('retest-step-');
	const plan = path.join(dir, 'PLAN.md');
	fs.writeFileSync(plan, planText);
	const r = spawnSync(process.execPath, [PLAN_CHECK, plan], { cwd: dir, encoding: 'utf8' });
	const out = `${r.stdout}${r.stderr}`;
	assert.ok(!/node:internal|MODULE_NOT_FOUND|SyntaxError/.test(out), `plan-check ran without crashing: ${out}`);
	return { status: r.status, out };
}

// why: catches a plan unit whose Tests lines start "retest:" needs a retest step before merged (K361 S1)
test('a plan unit whose Tests lines start "retest:" needs a retest step before merged', () => {
	const plan = planOf([
		{ id: 'U1', files: '`tests/kit-sweep.test.mjs`', tests: RETEST_LINE },
		{ id: 'U2', files: '`tests/plain.test.mjs`', tests: PLAIN_LINE },
	]);
	const noStep = checklistRun(plan, [step(1, 'tests'), step(2, 'review'), step(3, 'build'), step(4, 'merged')]);
	assert.equal(noStep.status, 1, noStep.out);
	assert.match(noStep.err, /U1/);
	assert.match(noStep.err, /retest/);
	const withStep = checklistRun(plan, [step(1, 'tests'), step(2, 'review'), step(3, 'build'), step(4, 'retest'), step(5, 'merged')]);
	assert.equal(withStep.status, 0, withStep.out);
	const afterMerged = checklistRun(plan, [step(1, 'tests'), step(2, 'review'), step(3, 'build'), step(4, 'merged'), step(5, 'retest')]);
	assert.equal(afterMerged.status, 1, afterMerged.out);
	assert.match(afterMerged.err, /U1/);
	assert.match(afterMerged.err, /retest/);
	const plainUnit = checklistRun(plan, [step(1, 'tests', 'U2'), step(2, 'review', 'U2'), step(3, 'build', 'U2'), step(4, 'merged', 'U2')]);
	assert.equal(plainUnit.status, 0, plainUnit.out);
});

// why: catches a retest step on a unit with no retest line is a fault (K361 S2)
test('a retest step on a unit with no retest line is a fault', () => {
	const plan = planWith('`tests/kit-sweep.test.mjs`', 'tests/kit-sweep.test.mjs holds the worktree brief -> S1');
	const res = checklistRun(plan, [step(1, 'tests'), step(2, 'review'), step(3, 'build'), step(4, 'retest')]);
	assert.equal(res.status, 1, res.out);
	assert.doesNotMatch(res.err, /not a known step/);
	assert.match(res.err, /U1/);
	assert.match(res.err, /retest/);
});

// why: catches plan-check reads a retest unit's Files as tests only, and refuses a source file there (K361 S3)
test("plan-check reads a retest unit's Files as tests only, and refuses a source file there", () => {
	const testsOnly = planCheckRun(planWith('`tests/kit-sweep.test.mjs`', RETEST_LINE));
	assert.equal(testsOnly.status, 0, testsOnly.out);
	const withSource = planCheckRun(planWith('`tests/kit-sweep.test.mjs`, `user/kit-tools/checklist.mjs`', RETEST_LINE));
	assert.equal(withSource.status, 1, withSource.out);
	assert.match(withSource.out, /checklist\.mjs/);
	const plainSource = planCheckRun(planOf([
		{ id: 'U1', files: '`tests/kit-sweep.test.mjs`', tests: RETEST_LINE },
		{ id: 'U2', files: '`user/kit-tools/checklist.mjs`', tests: 'user/kit-tools/checklist.mjs holds the brief -> S1' },
	]));
	assert.equal(plainSource.status, 0, plainSource.out);
	assert.doesNotMatch(plainSource.out, /checklist\.mjs/);
});

// Writes the plan, the checklist log and a hook log into a temp folder and runs the checklist subcommand with --hooks.
function checklistWithHooks(planText, logLines, hookLines) {
	assert.ok(fs.existsSync(FLOW), 'user/kit-tools/flow-check.mjs is missing');
	const dir = kitTemp.makeTemp('retest-step-');
	const plan = path.join(dir, 'plan.md');
	const log = path.join(dir, 'checklist.jsonl');
	const hooks = path.join(dir, 'kit-guard-open.log');
	fs.writeFileSync(plan, planText);
	fs.writeFileSync(log, logLines.join('\n') + '\n');
	fs.writeFileSync(hooks, hookLines.join('\n') + '\n');
	const r = spawnSync(process.execPath, [FLOW, 'checklist', log, '--plan', plan, '--hooks', hooks], { cwd: dir, encoding: 'utf8' });
	const out = `${r.stdout}${r.stderr}`;
	assert.ok(!/node:internal|MODULE_NOT_FOUND|SyntaxError/.test(out), `flow-check ran without crashing: ${out}`);
	return { status: r.status, out, err: r.stderr };
}

// why: catches the checklist fails while the hook log holds a hook-error line with no lead report line naming it, so a build cannot be marked ready (K361 S4)
test('the checklist fails while the hook log holds a hook-error line with no lead report line naming it, so a build cannot be marked ready', () => {
	const plan = planWith('`tests/kit-sweep.test.mjs`', 'tests/kit-sweep.test.mjs holds the worktree brief -> S1');
	const units = [step(1, 'tests'), step(2, 'review'), step(3, 'build')];
	const error = (id) => JSON.stringify({ kind: 'hook-error', id, hook: 'agent-model.cjs', at: '2026-11-22T10:00:00Z' });
	const control = JSON.stringify({ kind: 'hook-check', id: 'C1', hook: 'agent-model.cjs', at: '2026-11-22T10:00:01Z' });
	const report = (error, cause, fix) => JSON.stringify({ kind: 'hook-report', error, cause, fix });
	const unreported = checklistWithHooks(plan, units, [control, error('E1')]);
	assert.equal(unreported.status, 1, unreported.out);
	assert.match(unreported.err, /\bE1\b/);
	const reported = checklistWithHooks(plan, [...units, report('E1', 'the hook read a missing file', 'create the file the hook reads')], [control, error('E1')]);
	assert.equal(reported.status, 0, reported.out);
	const noFix = checklistWithHooks(plan, [...units, report('E1', 'the hook read a missing file', undefined)], [control, error('E1')]);
	assert.equal(noFix.status, 1, noFix.out);
	assert.match(noFix.err, /\bE1\b/);
	const noCause = checklistWithHooks(plan, [...units, report('E1', undefined, 'create the file the hook reads')], [control, error('E1')]);
	assert.equal(noCause.status, 1, noCause.out);
	assert.match(noCause.err, /\bE1\b/);
	const otherReport = checklistWithHooks(plan, [...units, report('E2', 'the hook read a missing file', 'create the file the hook reads')], [control, error('E1'), error('E2')]);
	assert.equal(otherReport.status, 1, otherReport.out);
	assert.match(otherReport.err, /\bE1\b/);
	const controlOnly = checklistWithHooks(plan, units, [control]);
	assert.equal(controlOnly.status, 0, controlOnly.out);
});
