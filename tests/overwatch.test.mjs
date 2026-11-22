// U18 (lane B): the overwatch lead is the build lead. It keeps a JSONL checklist of each unit's steps, and flow-check
// reads that checklist against the plan. This file tests the checklist subcommand, the skill section that names the
// lead's job, and the agent-teams rule file's pointer to it.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const FLOW = fileURLToPath(new URL('../user/kit-tools/flow-check.mjs', import.meta.url));
const SKILL = fileURLToPath(new URL('../user/skills/agent-team-build/SKILL.md', import.meta.url));
const RULE = fileURLToPath(new URL('../rules/agent-teams.md', import.meta.url));
const MAX_RULE_BYTES = 14000;

// A plan's Units table, with the template's columns. Each unit gives its files in backticks.
const planText = (units) => {
	const head = '| Id | Title | Files (exact; mark new files) | Tests to write first, and the failure each must show | Done when | Risk | Tester | Runs | Built by |';
	const rows = units.map(([id, files]) => `| ${id} | t | ${files} | x | x | low | | alone | builder |`);
	return ['# Batch plan - x', '', '## Units', '', head, '|---|---|---|---|---|---|---|---|---|', ...rows, '', '## Collision list', ''].join('\n');
};
// One JSON line per step, as the overwatch lead writes it.
const step = (at, unit, name, by = 'lead') => JSON.stringify({ at, unit, step: name, by });
const T = (n) => `2026-11-22T10:${String(n).padStart(2, '0')}:00Z`;
// Runs flow-check's checklist subcommand on a plan and a log, both written to a temp folder.
const checklist = (units, lines) => {
	assert.ok(fs.existsSync(FLOW), 'user/kit-tools/flow-check.mjs is missing');
	const dir = kitTemp.makeTemp('overwatch-');
	const plan = path.join(dir, 'plan.md');
	const log = path.join(dir, 'checklist.jsonl');
	fs.writeFileSync(plan, planText(units));
	fs.writeFileSync(log, lines.join('\n') + '\n');
	return spawnSync(process.execPath, [FLOW, 'checklist', log, '--plan', plan], { cwd: dir, encoding: 'utf8' });
};
const out = (res) => res.stdout + res.stderr;
const CLEAN = [['U1', '`src/a.mjs`'], ['U2', '`src/b.mjs`']];

// why: catches a clean run of a unit through tests, review and build to merged passing a checklist with no gap.
test('C1 spec 1: a unit merged after tests, review and build, in time order, is ok and prints one line per unit', () => {
	const res = checklist(CLEAN, [
		step(T(1), 'U1', 'tests'), step(T(2), 'U1', 'review'), step(T(3), 'U1', 'build'), step(T(4), 'U1', 'merged'),
		step(T(5), 'U2', 'build'),
	]);
	assert.equal(res.status, 0, out(res));
	assert.match(res.stdout, /U1.*merged/);
	assert.match(res.stdout, /U2.*build/);
});

// why: catches a unit merged without its tests step passing, so a change reaches main with no test written first.
test('C2 spec 1: a unit merged with no tests step is an error that names the unit and tests', () => {
	const res = checklist(CLEAN, [step(T(1), 'U1', 'review'), step(T(2), 'U1', 'build'), step(T(3), 'U1', 'merged')]);
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /U1/);
	assert.match(out(res), /tests/);
});

// why: catches a unit merged without its review step passing, so a change reaches main with no review of it.
test('C3 spec 1: a unit merged with no review step is an error that names the unit and review', () => {
	const res = checklist(CLEAN, [step(T(1), 'U1', 'tests'), step(T(2), 'U1', 'build'), step(T(3), 'U1', 'merged')]);
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /U1/);
	assert.match(out(res), /review/);
});

// why: catches a unit merged with no build step passing, so a change reaches main without a builder ever writing it.
test('C4 spec 1: a unit merged with no build step is an error that names the unit and build', () => {
	const res = checklist(CLEAN, [step(T(1), 'U1', 'tests'), step(T(2), 'U1', 'review'), step(T(3), 'U1', 'merged')]);
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /U1/);
	assert.match(out(res), /build/);
});

// why: catches a unit merged before its build step, which is a merge that came before the work it claims, passing.
test('C5 spec 1: a unit whose build step comes after its merged step is an error that names the unit', () => {
	const res = checklist(CLEAN, [
		step(T(1), 'U1', 'tests'), step(T(2), 'U1', 'review'), step(T(3), 'U1', 'merged'), step(T(4), 'U1', 'build'),
	]);
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /U1/);
});

// why: catches a risky unit merged with no check step passing, so a guard, hook or gate change ships unchecked.
test('C6 spec 1: a risky unit merged without a check step is an error that names the unit and check', () => {
	const risky = [['U1', '`user/kit-hooks/guard.cjs`']];
	const res = checklist(risky, [
		step(T(1), 'U1', 'tests'), step(T(2), 'U1', 'review'), step(T(3), 'U1', 'build'), step(T(4), 'U1', 'merged'),
	]);
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /U1/);
	assert.match(out(res), /check/);
});

// why: catches a risky unit that did get its check step being refused, which would block every guarded change that passed its check.
test('C7 spec 1: a risky unit merged after a check step is ok', () => {
	const risky = [['U1', '`user/kit-hooks/guard.cjs`']];
	const res = checklist(risky, [
		step(T(1), 'U1', 'tests'), step(T(2), 'U1', 'review'), step(T(3), 'U1', 'build'), step(T(4), 'U1', 'check'),
		step(T(5), 'U1', 'merged'),
	]);
	assert.equal(res.status, 0, out(res));
});

// why: catches a step naming a unit the plan does not hold passing, so work done outside the plan goes unseen.
test('C8 spec 1: a step that names a unit not in the plan is an error that names that unit', () => {
	const res = checklist(CLEAN, [step(T(1), 'U9', 'tests')]);
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /U9/);
});

// why: catches a unit's steps going backwards in time passing, so a log edited after the fact hides the real order of work.
test('C9 spec 1: a unit whose steps go backwards in time is an error that names the unit', () => {
	const res = checklist(CLEAN, [step(T(5), 'U1', 'tests'), step(T(2), 'U1', 'review')]);
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /U1/);
});

// why: catches a fix step, which is optional, being refused when it sits in the middle of a clean unit's run.
test('C10 spec 1: a fix step in the middle of a clean unit run is ok', () => {
	const res = checklist(CLEAN, [
		step(T(1), 'U1', 'tests'), step(T(2), 'U1', 'review'), step(T(3), 'U1', 'build'), step(T(4), 'U1', 'fix'),
		step(T(5), 'U1', 'merged'),
	]);
	assert.equal(res.status, 0, out(res));
});

// why: catches a checklist with a fix step and no other gap being refused, since the fix step is optional for a unit that needed none.
test('C11 spec 1: a unit with no fix step is ok', () => {
	const res = checklist(CLEAN, [
		step(T(1), 'U1', 'tests'), step(T(2), 'U1', 'review'), step(T(3), 'U1', 'build'), step(T(4), 'U1', 'merged'),
	]);
	assert.equal(res.status, 0, out(res));
});

// why: catches the skill's overwatch section missing, so a build lead never learns what it owns for the run.
test('S1 spec 2: SKILL.md has a section headed "## The overwatch lead"', () => {
	assert.match(fs.readFileSync(SKILL, 'utf8'), /^## The overwatch lead$/m);
});

// why: catches the overwatch section listing its jobs out of order, so a lead starts the teams before the split is planned.
test('S2 spec 2: the overwatch section names its jobs in order, from plan and split to the owner yes', () => {
	const text = fs.readFileSync(SKILL, 'utf8');
	const start = text.indexOf('## The overwatch lead');
	assert.ok(start >= 0, 'no overwatch section');
	const rest = text.slice(start + 1);
	const end = rest.search(/\n## /);
	const section = end === -1 ? text.slice(start) : text.slice(start, start + 1 + end);
	const jobs = [
		/plan and split/i,
		/start the teams/i,
		/answer lane questions/i,
		/flow-check\.mjs checklist/,
		/spin .*down/i,
		/merge the lanes/i,
		/one sweep/i,
		/fixes? in lanes/i,
		/CI.*gate.*owner'?s yes/i,
	];
	let at = -1;
	for (const job of jobs) {
		const found = section.search(job);
		assert.ok(found >= 0, `overwatch section has no line for ${job}`);
		assert.ok(found > at, `${job} comes before the job above it`);
		at = found;
	}
});

// why: catches the overwatch section casting the lead as an extra role, which would add a seat the build does not have.
test('S3 spec 2: the overwatch section says the overwatch lead is the build lead, not an extra role', () => {
	const text = fs.readFileSync(SKILL, 'utf8');
	const start = text.indexOf('## The overwatch lead');
	const section = start >= 0 ? text.slice(start, start + 4000) : '';
	assert.match(section, /build lead/i);
	assert.match(section, /not an extra role|not a new role|not a separate role/i);
});

// why: catches the agent-teams rule file dropping its pointer to the overwatch section, so a reader of the rules never finds the lead's job.
test('S4 spec 3: rules/agent-teams.md names The overwatch lead', () => {
	assert.match(fs.readFileSync(RULE, 'utf8'), /The overwatch lead/);
});

// why: catches the agent-teams rule file growing past its 14,000-byte cap, which the kit's size budget refuses.
test('S5 spec 3: rules/agent-teams.md stays under 14000 bytes', () => {
	const bytes = fs.statSync(RULE).size;
	assert.ok(bytes < MAX_RULE_BYTES, `rules/agent-teams.md is ${bytes} bytes, cap is ${MAX_RULE_BYTES}`);
});
