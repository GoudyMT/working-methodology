// U18 (lane B): the overwatch lead is the build lead. It keeps a JSONL checklist of each unit's steps, and flow-check
// reads that checklist against the plan. This file tests the checklist subcommand, the skill section that names the
// lead's job, and the agent-teams rule file's pointer to it. rules/agent-teams.md is the source; project/standards is built from it.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { GUARD_PATHS } from '../user/kit-tools/tester-model.mjs';

kitTemp.sessionRoot();
const FLOW = fileURLToPath(new URL('../user/kit-tools/flow-check.mjs', import.meta.url));
const SKILL = fileURLToPath(new URL('../user/skills/agent-team-build/SKILL.md', import.meta.url));
const RULE = fileURLToPath(new URL('../rules/agent-teams.md', import.meta.url));
// The 14,000-byte cap on rules/agent-teams.md is stated in docs/plans/build-24-handoff-test-method-model-table.md (the rule text room note).
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
// Writes a plan and a log into a temp folder and runs flow-check's checklist subcommand on them.
const checklist = (units, lines) => {
	assert.ok(fs.existsSync(FLOW), 'user/kit-tools/flow-check.mjs is missing');
	const dir = kitTemp.makeTemp('overwatch-');
	const plan = path.join(dir, 'plan.md');
	const log = path.join(dir, 'checklist.jsonl');
	fs.writeFileSync(plan, planText(units));
	fs.writeFileSync(log, lines.join('\n') + '\n');
	return spawnSync(process.execPath, [FLOW, 'checklist', log, '--plan', plan], { cwd: dir, encoding: 'utf8' });
};
// Runs the subcommand on a plan path and a log path as given, for the unreadable-input cases.
const checklistPaths = (planPath, logPath) => {
	assert.ok(fs.existsSync(FLOW), 'user/kit-tools/flow-check.mjs is missing');
	return spawnSync(process.execPath, [FLOW, 'checklist', logPath, '--plan', planPath], { encoding: 'utf8' });
};
const out = (res) => res.stdout + res.stderr;
const CLEAN = [['U1', '`src/a.mjs`'], ['U2', '`src/b.mjs`']];
// The file a risky unit touches, built from each GUARD_PATHS entry: a folder, a glob or a plain file name.
const fileFor = (entry) => {
	if (entry.endsWith('/')) return `user/${entry}guard.cjs`;
	if (entry.includes('*')) return `user/${entry.replaceAll('*', 'one')}`;
	return `user/${entry}`;
};
// The section from its heading to the next level-two heading; shared by the section tests.
const overwatchSection = () => {
	const text = fs.readFileSync(SKILL, 'utf8');
	const start = text.indexOf('## The overwatch lead');
	assert.ok(start >= 0, 'no "## The overwatch lead" section');
	const rest = text.slice(start + 1);
	const end = rest.search(/\n## /);
	return end === -1 ? text.slice(start) : text.slice(start, start + 1 + end);
};

// why: catches a clean run of a unit through tests, review and build to merged passing a checklist with no gap.
test('C1 spec 1: a unit merged after tests, review and build, in time order, is ok and prints one line per unit', () => {
	const res = checklist(CLEAN, [
		step(T(1), 'U1', 'tests'), step(T(2), 'U1', 'review'), step(T(3), 'U1', 'build'), step(T(4), 'U1', 'merged'),
		step(T(5), 'U2', 'build'),
	]);
	assert.equal(res.status, 0, out(res));
	assert.equal(res.stdout.trim().split('\n').length, CLEAN.length, res.stdout);
	assert.match(res.stdout, /^U1\b.*\bmerged\b/m);
	assert.match(res.stdout, /^U2\b.*\bbuild\b/m);
});

// why: catches a unit with no log lines being left off the report, so a unit never started looks like it was never planned.
test('C2 spec 1: a plan unit with no log lines prints "not started" and exits 0', () => {
	const res = checklist(CLEAN, [step(T(1), 'U1', 'tests'), step(T(2), 'U1', 'review'), step(T(3), 'U1', 'build'), step(T(4), 'U1', 'merged')]);
	assert.equal(res.status, 0, out(res));
	assert.match(res.stdout, /^U2: not started$/m);
	assert.doesNotMatch(res.stdout, /^U1\b.*\bbuild\b/m, 'U1 shows build, not merged');
});

// why: catches a unit merged without its tests step passing, so a change reaches main with no test written first.
test('C3 spec 1: a unit merged with no tests step is an error that names the unit and tests', () => {
	const res = checklist(CLEAN, [step(T(1), 'U1', 'review'), step(T(2), 'U1', 'build'), step(T(3), 'U1', 'merged')]);
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /U1/);
	assert.match(out(res), /tests/);
});

// why: catches a unit merged without its review step passing, so a change reaches main with no review of it.
test('C4 spec 1: a unit merged with no review step is an error that names the unit and review', () => {
	const res = checklist(CLEAN, [step(T(1), 'U1', 'tests'), step(T(2), 'U1', 'build'), step(T(3), 'U1', 'merged')]);
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /U1/);
	assert.match(out(res), /review/);
});

// why: catches a unit merged with no build step passing, so a change reaches main without a builder ever writing it.
test('C5 spec 1: a unit merged with no build step is an error that names the unit and build', () => {
	const res = checklist(CLEAN, [step(T(1), 'U1', 'tests'), step(T(2), 'U1', 'review'), step(T(3), 'U1', 'merged')]);
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /U1/);
	assert.match(out(res), /build/);
});

// why: catches a missing step being reported alongside the steps that are present, which hides which one is the gap.
test('C6 spec 1: a unit missing only its tests step names only tests, not review or build', () => {
	const res = checklist(CLEAN, [step(T(1), 'U1', 'review'), step(T(2), 'U1', 'build'), step(T(3), 'U1', 'merged')]);
	assert.equal(res.status, 1, out(res));
	assert.match(res.stderr, /tests/);
	assert.doesNotMatch(res.stderr, /\breview\b|\bbuild\b/);
});

// why: catches a unit merged before its build step, which is a merge that came before the work it claims, passing.
test('C7 spec 1: a unit whose build step comes after its merged step is an error that names the unit', () => {
	const res = checklist(CLEAN, [
		step(T(1), 'U1', 'tests'), step(T(2), 'U1', 'review'), step(T(3), 'U1', 'merged'), step(T(4), 'U1', 'build'),
	]);
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /U1/);
});

// why: catches a risky unit merged with no check step passing, so a guard, hook or gate change ships unchecked.
test('C8 spec 1: a risky unit merged without a check step is an error that names the unit and check', () => {
	const risky = [['U1', '`user/kit-hooks/guard.cjs`']];
	const res = checklist(risky, [
		step(T(1), 'U1', 'tests'), step(T(2), 'U1', 'review'), step(T(3), 'U1', 'build'), step(T(4), 'U1', 'merged'),
	]);
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /U1/);
	assert.match(out(res), /check/);
});

// why: catches a check step logged after merged counting as the check, which would let a guard change merge before it was checked.
test('C9 spec 1: a risky unit whose check step comes after merged is still an error that names check', () => {
	const risky = [['U1', '`user/kit-hooks/guard.cjs`']];
	const res = checklist(risky, [
		step(T(1), 'U1', 'tests'), step(T(2), 'U1', 'review'), step(T(3), 'U1', 'build'), step(T(4), 'U1', 'merged'),
		step(T(5), 'U1', 'check'),
	]);
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /check/);
});

// why: catches a risky unit that did get its check before merged being refused, which would block every guarded change that passed its check.
test('C10 spec 1: a risky unit merged after a check step is ok', () => {
	const risky = [['U1', '`user/kit-hooks/guard.cjs`']];
	const res = checklist(risky, [
		step(T(1), 'U1', 'tests'), step(T(2), 'U1', 'review'), step(T(3), 'U1', 'build'), step(T(4), 'U1', 'check'),
		step(T(5), 'U1', 'merged'),
	]);
	assert.equal(res.status, 0, out(res));
});

// why: catches any GUARD_PATHS entry being missed as risky, so a unit that hits one of the guard, hook or gate paths merges unchecked.
for (const entry of GUARD_PATHS) {
	test(`C11 spec 1: a unit whose files hit the guard entry ${entry} is risky, so merged without check is an error`, () => {
		const risky = [['U1', `\`${fileFor(entry)}\``]];
		const res = checklist(risky, [
			step(T(1), 'U1', 'tests'), step(T(2), 'U1', 'review'), step(T(3), 'U1', 'build'), step(T(4), 'U1', 'merged'),
		]);
		assert.equal(res.status, 1, out(res));
		assert.match(out(res), /check/);
	});
}

// why: catches a step naming a unit the plan does not hold passing, so work done outside the plan goes unseen.
test('C12 spec 1: a step that names a unit not in the plan is an error that names that unit', () => {
	const res = checklist(CLEAN, [step(T(1), 'U9', 'tests')]);
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /U9/);
});

// why: catches a unit's steps going backwards in time passing, so a log edited after the fact hides the real order of work.
test('C13 spec 1: a unit with a later line that has an earlier at is an error that names the unit', () => {
	const res = checklist(CLEAN, [step(T(5), 'U1', 'tests'), step(T(2), 'U1', 'review')]);
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /U1/);
});

// why: catches interleaved lines of two units being read as one timeline, which would flag a clean run as backwards.
test('C14 spec 1: units whose lines interleave in the log, each in time order for its own unit, are ok', () => {
	const res = checklist(CLEAN, [
		step(T(5), 'U1', 'tests'), step(T(2), 'U2', 'tests'), step(T(6), 'U1', 'review'), step(T(7), 'U1', 'build'),
		step(T(8), 'U1', 'merged'), step(T(3), 'U2', 'review'), step(T(4), 'U2', 'build'), step(T(9), 'U2', 'merged'),
	]);
	assert.equal(res.status, 0, out(res));
});

// why: catches two lines for one unit at the same time being refused, when equal times are a tie and not a backward step.
test('C15 spec 1: two lines for one unit with equal at are ok', () => {
	const res = checklist(CLEAN, [
		step(T(1), 'U1', 'tests'), step(T(1), 'U1', 'review'), step(T(1), 'U1', 'build'), step(T(1), 'U1', 'merged'),
	]);
	assert.equal(res.status, 0, out(res));
});

// why: catches an unknown step name passing, so a typo in a step hides a gap the checklist should have shown.
test('C16 spec 1: an unknown step name is an error that names that step', () => {
	const res = checklist(CLEAN, [step(T(1), 'U1', 'deploy')]);
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /deploy/);
});

// why: catches an optional fix step being refused in the middle of a clean run, when the lead logs it for a real fix.
test('C17 spec 1: a fix step in the middle of a clean unit run is ok', () => {
	const res = checklist(CLEAN, [
		step(T(1), 'U1', 'tests'), step(T(2), 'U1', 'review'), step(T(3), 'U1', 'build'), step(T(4), 'U1', 'fix'),
		step(T(5), 'U1', 'merged'),
	]);
	assert.equal(res.status, 0, out(res));
});

// why: catches a record field on a step line being refused, when the lead logs the hand-back that the step came from.
test('C18 spec 1: a step line with a record field is accepted and the run is ok', () => {
	const res = checklist(CLEAN, [
		step(T(1), 'U1', 'tests'), step(T(2), 'U1', 'review'), step(T(3), 'U1', 'build'),
		JSON.stringify({ at: T(4), unit: 'U1', step: 'merged', by: 'lead', record: 'handoff.jsonl#3' }),
	]);
	assert.equal(res.status, 0, out(res));
});

// why: catches invalid JSON in the log being skipped, which would drop a step and hide a gap behind a broken line.
test('C19 spec 1: a log line that is not valid JSON exits 2', () => {
	const res = checklist(CLEAN, ['this is not json']);
	assert.equal(res.status, 2, out(res));
});

// why: catches a step with an at that is not a time being read as a valid step, which would put it in the wrong order silently.
test('C20 spec 1: a step with an at that is not a time exits 2', () => {
	const res = checklist(CLEAN, [JSON.stringify({ at: 'yesterday', unit: 'U1', step: 'tests', by: 'lead' })]);
	assert.equal(res.status, 2, out(res));
});

// why: catches a plan file that cannot be read being reported as a checklist fault, which hides the real cause from the lead.
test('C21 spec 1: an unreadable plan exits 2', () => {
	const dir = kitTemp.makeTemp('overwatch-');
	const log = path.join(dir, 'checklist.jsonl');
	fs.writeFileSync(log, step(T(1), 'U1', 'tests') + '\n');
	const res = checklistPaths(path.join(dir, 'no-such-plan.md'), log);
	assert.equal(res.status, 2, out(res));
});

// why: catches a log file that cannot be read being reported as a clean checklist, which would show a pass over no record at all.
test('C22 spec 1: an unreadable log exits 2', () => {
	const dir = kitTemp.makeTemp('overwatch-');
	const plan = path.join(dir, 'plan.md');
	fs.writeFileSync(plan, planText(CLEAN));
	const res = checklistPaths(plan, path.join(dir, 'no-such-log.jsonl'));
	assert.equal(res.status, 2, out(res));
});


// why: guards rule:agent-team-adapter (overwatch jobs listed out of order)
test('S2 spec 2: the overwatch section names its jobs in order, from plan and split to the owner yes', () => {
	const section = overwatchSection();
	const jobs = [
		/plan and split/i,
		/start the teams/i,
		/answer lane questions/i,
		/flow-check\.mjs checklist/,
		/spin .*down/i,
		/merge the lanes/i,
		/one sweep/i,
		/fixes? in lanes/i,
		/\bCI\b.*\bgate\b.*owner.s yes/,
	].map((job) => new RegExp(`^\\s*(?:[-*]|\\d+\\.)\\s.*${job.source}`, job.flags.includes('i') ? 'mi' : 'm'));
	let at = -1;
	for (const job of jobs) {
		const found = section.search(job);
		assert.ok(found >= 0, `overwatch section has no list item for ${job}`);
		assert.ok(found > at, `${job} comes before the job above it`);
		at = found;
	}
});

// why: guards rule:agent-role-table (overwatch lead cast as an extra role)
test('S3 spec 2: one sentence of the overwatch section says the build lead is not an extra role', () => {
	const sentences = overwatchSection().split(/[.!?]\s/);
	assert.ok(sentences.some((s) => /build lead/i.test(s) && /not an extra role|not a new role|not a separate role/i.test(s)), 'no sentence joins build lead with not an extra role');
});


// why: guards rule:agent-team-adapter (pointer line does not name agent-team-build)
test('S5 spec 3: one line of rules/agent-teams.md holds "The overwatch lead" and agent-team-build', () => {
	const lines = fs.readFileSync(RULE, 'utf8').split(/\r?\n/);
	assert.ok(lines.some((l) => l.includes('The overwatch lead') && l.includes('agent-team-build')), 'no line names both');
});

// why: guards rule:size-budgets (agent-teams rule file grows past 14000 bytes)
test('S6 spec 3: rules/agent-teams.md stays under 14000 bytes', () => {
	const bytes = fs.statSync(RULE).size;
	assert.ok(bytes < MAX_RULE_BYTES, `rules/agent-teams.md is ${bytes} bytes, cap is ${MAX_RULE_BYTES}`);
});

// A one-unit plan whose Risk and Category cells are given. Its file is not a guard path, so only the cells can make it a guard unit.
const cellPlan = (risk, category) => ['# Batch plan - x', '', '## Units', '', '| Id | Files | Runs | Risk | Category |', '|---|---|---|---|---|', `| U1 | \`src/a.mjs\` | alone | ${risk} | ${category} |`, '', '## Collision list', ''].join('\n');
// The checklist subcommand on the cellPlan plan and a log of the given lines.
const cellChecklist = (risk, category, lines) => {
	assert.ok(fs.existsSync(FLOW), 'user/kit-tools/flow-check.mjs is missing');
	const dir = kitTemp.makeTemp('overwatch-');
	const plan = path.join(dir, 'plan.md');
	const log = path.join(dir, 'checklist.jsonl');
	fs.writeFileSync(plan, cellPlan(risk, category));
	fs.writeFileSync(log, lines.join('\n') + '\n');
	return spawnSync(process.execPath, [FLOW, 'checklist', log, '--plan', plan], { cwd: dir, encoding: 'utf8' });
};
const MERGED_NO_CHECK = [step(T(1), 'U1', 'tests'), step(T(2), 'U1', 'review'), step(T(3), 'U1', 'build'), step(T(4), 'U1', 'merged')];
const MERGED_AFTER_CHECK = [step(T(1), 'U1', 'tests'), step(T(2), 'U1', 'review'), step(T(3), 'U1', 'build'), step(T(4), 'U1', 'check'), step(T(5), 'U1', 'merged')];

// why: catches a Risk high unit on a non-guard file merged with no check step passing, so a high-risk change ships unchecked.
test('C23 spec 1: a unit with Risk high and no guard file is an error when merged with no check step, and clean with one', () => {
	const res = cellChecklist('high', '', MERGED_NO_CHECK);
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /U1/);
	assert.match(out(res), /check/);
	// Control: the same unit with a check step before merged is ok.
	const ok = cellChecklist('high', '', MERGED_AFTER_CHECK);
	assert.equal(ok.status, 0, out(ok));
});

// why: catches a Category guard unit on a non-guard file merged with no check step passing, so a guard change marked by its category ships unchecked.
test('C24 spec 1: a unit with Category guard and no guard file is an error when merged with no check step, and clean with one', () => {
	const res = cellChecklist('low', 'guard', MERGED_NO_CHECK);
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /U1/);
	assert.match(out(res), /check/);
	// Control: the same unit with a check step before merged is ok.
	const ok = cellChecklist('low', 'guard', MERGED_AFTER_CHECK);
	assert.equal(ok.status, 0, out(ok));
});
