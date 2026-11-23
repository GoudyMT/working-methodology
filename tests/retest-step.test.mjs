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

// A one-unit plan with the template's columns. Each test passes the unit's Files cell and its Tests cell.
const planWith = (files, tests) => [
	'# Batch plan - retest step',
	'',
	'## Units',
	'',
	'| Id | Files | Runs | Risk | Category | Tests | Tester |',
	'|---|---|---|---|---|---|---|',
	`| U1 | ${files} | alone | low | logic | ${tests} | builder |`,
	'',
	'### U1 spec',
	'- S1: a retest unit needs a retest step before merged.',
	'',
].join('\n');
const RETEST_LINE = 'retest: tests/kit-sweep.test.mjs:70 now expects a worktree brief to name its own rules file -> S1';
const step = (n, name) => JSON.stringify({ at: `2026-11-22T10:${String(n).padStart(2, '0')}:00Z`, unit: 'U1', step: name, by: 'lead' });

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
	return { status: r.status, out };
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
	const plan = planWith('`tests/kit-sweep.test.mjs`', RETEST_LINE);
	const noStep = checklistRun(plan, [step(1, 'tests'), step(2, 'review'), step(3, 'build'), step(4, 'merged')]);
	assert.equal(noStep.status, 1, noStep.out);
	assert.match(noStep.out, /U1/);
	assert.match(noStep.out, /retest/);
	const withStep = checklistRun(plan, [step(1, 'tests'), step(2, 'review'), step(3, 'build'), step(4, 'retest'), step(5, 'merged')]);
	assert.equal(withStep.status, 0, withStep.out);
});

// why: catches a retest step on a unit with no retest line is a fault (K361 S2)
test('a retest step on a unit with no retest line is a fault', () => {
	const plan = planWith('`tests/kit-sweep.test.mjs`', 'tests/kit-sweep.test.mjs holds the worktree brief -> S1');
	const res = checklistRun(plan, [step(1, 'tests'), step(2, 'review'), step(3, 'build'), step(4, 'retest')]);
	assert.equal(res.status, 1, res.out);
	assert.doesNotMatch(res.out, /not a known step/);
	assert.match(res.out, /U1/);
	assert.match(res.out, /retest/);
});

// why: catches plan-check reads a retest unit's Files as tests only, and refuses a source file there (K361 S3)
test("plan-check reads a retest unit's Files as tests only, and refuses a source file there", () => {
	const testsOnly = planCheckRun(planWith('`tests/kit-sweep.test.mjs`', RETEST_LINE));
	assert.equal(testsOnly.status, 0, testsOnly.out);
	const withSource = planCheckRun(planWith('`tests/kit-sweep.test.mjs`, `user/kit-tools/checklist.mjs`', RETEST_LINE));
	assert.equal(withSource.status, 1, withSource.out);
	assert.match(withSource.out, /checklist\.mjs/);
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
	return { status: r.status, out };
}

// why: catches the checklist fails while the hook log holds a hook-error line with no lead report line naming it, so a build cannot be marked ready (K361 S4)
test('the checklist fails while the hook log holds a hook-error line with no lead report line naming it, so a build cannot be marked ready', () => {
	const plan = planWith('`tests/kit-sweep.test.mjs`', 'tests/kit-sweep.test.mjs holds the worktree brief -> S1');
	const units = [step(1, 'tests'), step(2, 'review'), step(3, 'build')];
	const error = JSON.stringify({ kind: 'hook-error', id: 'E1', hook: 'agent-model.cjs', at: '2026-11-22T10:00:00Z' });
	const control = JSON.stringify({ kind: 'hook-check', id: 'C1', hook: 'agent-model.cjs', at: '2026-11-22T10:00:01Z' });
	const report = JSON.stringify({ kind: 'hook-report', error: 'E1', cause: 'the hook read a missing file', fix: 'create the file the hook reads' });
	const noFix = JSON.stringify({ kind: 'hook-report', error: 'E1', cause: 'the hook read a missing file' });
	const unreported = checklistWithHooks(plan, units, [control, error]);
	assert.equal(unreported.status, 1, unreported.out);
	assert.match(unreported.out, /E1/);
	const reported = checklistWithHooks(plan, [...units, report], [control, error]);
	assert.equal(reported.status, 0, reported.out);
	const partial = checklistWithHooks(plan, [...units, noFix], [control, error]);
	assert.equal(partial.status, 1, partial.out);
	assert.match(partial.out, /E1/);
	const controlOnly = checklistWithHooks(plan, units, [control]);
	assert.equal(controlOnly.status, 0, controlOnly.out);
});
