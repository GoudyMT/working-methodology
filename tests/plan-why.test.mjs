// K368: the plan gives each test its name and why, and the record is written from it. Each test runs the kit's tools on a
// small plan written to a temp folder, as the lead runs them, so the test reads the same output the lead reads.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const PLAN_CHECK = fileURLToPath(new URL('../user/kit-tools/plan-check.mjs', import.meta.url));
const BUILD_RECORD = fileURLToPath(new URL('../scripts/build-record.mjs', import.meta.url));

// The Units table's columns, in the order this plan writes them.
const COLS = [
	{ key: 'Id', head: 'Id' },
	{ key: 'Title', head: 'Title' },
	{ key: 'Files', head: 'Files (exact; mark new files)' },
	{ key: 'Tests', head: 'Tests to write first, and the failure each must show' },
	{ key: 'Done', head: 'Done when' },
	{ key: 'Risk', head: 'Risk' },
	{ key: 'Category', head: 'Category' },
	{ key: 'Tester', head: 'Tester' },
	{ key: 'Runs', head: 'Runs' },
	{ key: 'Built', head: 'Built by' },
];
// A unit whose Title leads with its row id (K368), as this plan's rows do, unless a title says otherwise; its Tests
// lines join with <br>.
const unit = (id, tests, files = '`src/a.mjs`', title = 'K368: the plan gives each test its name and why') => ({
	Id: id, Title: title, Files: files, Tests: tests.join('<br>'),
	Done: 'x', Risk: 'low', Category: 'logic', Tester: '', Runs: 'parallel', Built: 'builder',
});
// A plan text: a title, the Units table with the given rows, and a Collision list.
const planText = (rows) => [
	'# Batch plan - x', '', '## Units', '',
	`| ${COLS.map((c) => c.head).join(' | ')} |`,
	`|${COLS.map(() => '---').join('|')}|`,
	...rows.map((r) => `| ${COLS.map((c) => r[c.key]).join(' | ')} |`),
	'', '## Collision list', '',
].join('\n');
// Runs plan-check on a plan written to a temp folder, with any extra arguments after the plan path.
const run = (text, ...args) => {
	assert.ok(fs.existsSync(PLAN_CHECK), 'user/kit-tools/plan-check.mjs is missing');
	const dir = kitTemp.makeTemp('plan-why-');
	spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
	const file = path.join(dir, 'PLAN.md');
	fs.writeFileSync(file, text);
	return spawnSync(process.execPath, [PLAN_CHECK, file, ...args], { cwd: dir, encoding: 'utf8' });
};
// A tester hand-back that names its tests in the role line, as the lead's record names them.
const recordText = (unitId, tests) => ['Prose.', 'RECORD:', JSON.stringify({ role: 'tester', commit: 'abc1234', unit: unitId, clarity: 'clear', tests }), JSON.stringify({ notChecked: 'the rest of the suite' }), ''].join('\n');
// Runs build-record --from-plan on a plan and the hand-backs in a records folder. The temp folder holds the plan and the
// records folder only: no git folder, so a file the tool writes would show in it.
const fromPlan = (plan, records) => {
	assert.ok(fs.existsSync(BUILD_RECORD), 'scripts/build-record.mjs is missing');
	const dir = kitTemp.makeTemp('plan-why-');
	const planFile = path.join(dir, 'PLAN.md');
	fs.writeFileSync(planFile, plan);
	const folder = path.join(dir, 'records');
	fs.mkdirSync(folder);
	const names = records.map((text, i) => {
		const name = `tester-${i}.jsonl`;
		fs.writeFileSync(path.join(folder, name), text);
		return name;
	});
	const res = spawnSync(process.execPath, [BUILD_RECORD, '--from-plan', planFile, '--records', folder], { cwd: dir, encoding: 'utf8' });
	return { res, dir, folder, names };
};
const out = (res) => res.stdout + res.stderr;

// why: catches plan-check --whys prints each unit's test names and their why lines from its Tests cell (K368 S1)
test("plan-check --whys prints each unit's test names and their why lines from its Tests cell", () => {
	const names = [
		'plan-check --whys prints each unit\'s test names and their why lines',
		'a why line is cut from its Tests line, the tail removed',
		'the second unit\'s own test line is printed too',
		'the row with no K code takes its unit id',
	];
	// U1 and U2 carry the K code K368 from their Title; R1 has none, so its why takes its unit id.
	const res = run(planText([
		unit('U1', [`${names[0]} -> S1`, `${names[1]} -> S1`]),
		unit('U2', [`${names[2]} -> S2`]),
		unit('R1', [`${names[3]} -> S1`], '`src/a.mjs`', 'a release row with no K code'),
	]), '--whys');
	assert.equal(res.status, 0, out(res));
	const expected = [[names[0], '(K368 S1)'], [names[1], '(K368 S1)'], [names[2], '(K368 S2)'], [names[3], '(R1 S1)']];
	for (const [name, tag] of expected) {
		assert.ok(res.stdout.includes(name), `--whys prints the test name: ${name}\n${out(res)}`);
		assert.ok(res.stdout.includes(`// why: catches ${name} ${tag}`), `--whys prints its why line: ${name}\n${out(res)}`);
	}
});

// why: catches plan-check --brief U1 --role tester writes the tester brief from the row: files, test names, why lines and the unit-lock --tester command (K368 S4)
test('plan-check --brief U1 --role tester writes the tester brief from the row: files, test names, why lines and the unit-lock --tester command', () => {
	const names = ['the tester brief names each test with its why line', 'the tester brief ends with the unit-lock tester command'];
	const plan = planText([
		unit('U1', [`${names[0]} -> S1`, `${names[1]} -> S1`], '`src/a.mjs`, `tests/a.test.mjs` (new), `tests/b.test.mjs` (new)'),
	]);
	const res = run(plan, '--brief', 'U1', '--role', 'tester');
	assert.equal(res.status, 0, out(res));
	assert.ok(res.stdout.includes('U1'), out(res));
	assert.ok(res.stdout.includes('src/a.mjs') && res.stdout.includes('tests/b.test.mjs'), `the brief holds the Files cell: ${res.stdout}`);
	for (const name of names) {
		assert.ok(res.stdout.includes(name), `the brief names the test: ${name}\n${res.stdout}`);
		assert.ok(res.stdout.includes(`// why: catches ${name} (K368 S1)`), `the brief holds its why line: ${name}\n${res.stdout}`);
	}
	// The lock line ends at its last test file: no src path after it, and no other file.
	assert.match(res.stdout, /node \S*unit-lock\.mjs --tester --files tests\/a\.test\.mjs,tests\/b\.test\.mjs$/m, `the brief holds the tester lock command:\n${res.stdout}`);
	// An unknown unit and an unknown role each exit 1 and name what is unknown.
	const noUnit = run(plan, '--brief', 'U9', '--role', 'tester');
	assert.equal(noUnit.status, 1, out(noUnit));
	assert.ok(noUnit.stderr.includes('U9'), `an unknown unit is named on stderr:\n${out(noUnit)}`);
	const noRole = run(plan, '--brief', 'U1', '--role', 'nobody');
	assert.equal(noRole.status, 1, out(noRole));
	assert.ok(noRole.stderr.includes('nobody'), `an unknown role is named on stderr:\n${out(noRole)}`);
});

// why: catches plan-check --brief U1 --role builder writes the builder brief: source files, the exact test files to run, the lock commands (K368 S4)
test('plan-check --brief U1 --role builder writes the builder brief: source files, the exact test files to run, the lock commands', () => {
	const res = run(planText([
		unit('U1', ['the builder brief names the source files and the exact test run -> S1', 'the builder brief names the lock commands for the red sha -> S1'], '`src/a.mjs`, `src/b.mjs`, `tests/a.test.mjs` (new), `tests/c.test.mjs` (new)'),
	]), '--brief', 'U1', '--role', 'builder');
	assert.equal(res.status, 0, out(res));
	assert.ok(res.stdout.includes('src/a.mjs') && res.stdout.includes('src/b.mjs'), `the brief holds the source files: ${res.stdout}`);
	// Both test files run in one command, space-joined, and the command ends there.
	assert.match(res.stdout, /node --test tests\/a\.test\.mjs tests\/c\.test\.mjs(?=\s|`|$)/m, `the brief holds the exact test run:\n${res.stdout}`);
	// The lock line names the source files only, comma-joined, ends there, and leaves <red sha> as written.
	assert.match(res.stdout, /node \S*unit-lock\.mjs <red sha> --files src\/a\.mjs,src\/b\.mjs$/m, `the brief holds the builder lock command:\n${res.stdout}`);
	assert.ok(!res.stdout.includes('--pick'), `the builder brief never names --pick:\n${res.stdout}`);
});

// why: catches a plan-check brief with no Plan, Unit id, Role, Worktree or Lane line, a repo-relative lock path, or templates with no Lane line (H6)
test('plan-check --brief prints Plan, Unit id, Role, Worktree and Lane lines and a lock path beside plan-check, and the templates carry Lane', () => {
	const plan = planText([unit('U1', ['the brief carries the lines the spawn hooks read -> S1'], '`src/a.mjs`, `tests/a.test.mjs` (new)')]);
	const field = (text, label) => (text.match(new RegExp(`^[\\s>*_\`+-]*${label}[*_\`]*:[*_\`]*[ \\t]*(.*)$`, 'im')) ?? [])[1];
	for (const role of ['tester', 'builder']) {
		const res = run(plan, '--brief', 'U1', '--role', role);
		assert.equal(res.status, 0, out(res));
		assert.match(field(res.stdout, 'Plan') ?? '', /PLAN\.md/, `${role}: a Plan: line names the plan path:\n${res.stdout}`);
		assert.equal((field(res.stdout, 'Unit') ?? '').trim().replace(/[*_`]/g, ''), 'U1', `${role}: the Unit: line is the unit id, not its title:\n${res.stdout}`);
		assert.match(field(res.stdout, 'Role') ?? '', new RegExp(role), `${role}: a Role: line:\n${res.stdout}`);
		assert.match(field(res.stdout, 'Worktree') ?? '', /\S/, `${role}: a Worktree: line:\n${res.stdout}`);
		assert.match(field(res.stdout, 'Lane') ?? '', /\S/, `${role}: a Lane: line:\n${res.stdout}`);
		const lock = res.stdout.match(/node\s+(\S*unit-lock\.mjs)/);
		assert.ok(lock, `${role}: the brief names unit-lock.mjs:\n${res.stdout}`);
		assert.equal(path.resolve(lock[1]), path.join(path.dirname(PLAN_CHECK), 'unit-lock.mjs'), `${role}: the lock path is built from plan-check's own folder, not repo-relative:\n${res.stdout}`);
		assert.ok(fs.existsSync(path.resolve(lock[1])), `${role}: the lock path exists`);
	}
	const dir = path.resolve(path.dirname(PLAN_CHECK), '..', 'skills', 'agent-team-build', 'templates');
	for (const name of ['tester-brief.md', 'builder-brief.md', 'checker-brief.md']) {
		const text = fs.existsSync(path.join(dir, name)) ? fs.readFileSync(path.join(dir, name), 'utf8') : '';
		assert.match(text, /^[\s>*_`+-]*Lane[*_`]*:[*_`]*[ \t]*[^\s*_`]/im, `${name} carries a Lane: line with text after the colon`);
	}
});

// why: catches a Tests line whose derived why is under six words is a plan fault (K368 S1)
test('a Tests line whose derived why is under six words is a plan fault', () => {
	// The counted why is the whole derived line: "catches a short line here" is five words, under six, so U1 faults.
	// The fault is raised by --whys and by --brief, never by the default run (other plans use one-word test names).
	const shortPlan = planText([unit('U1', ['a short line here -> S1'])]);
	const edgePlan = planText([unit('U1', ['each why line is counted -> S1'])]);
	const modes = [['--whys'], ['--brief', 'U1', '--role', 'tester']];
	for (const mode of modes) {
		const short = run(shortPlan, ...mode);
		assert.equal(short.status, 1, `${mode.join(' ')}: ${out(short)}`);
		assert.match(out(short), /U1/);
		assert.ok(out(short).includes('a short line here'), `${mode.join(' ')} names the line:
${out(short)}`);
		// "catches each why line is counted" is six words, the edge that checks clean.
		const edge = run(edgePlan, ...mode);
		assert.equal(edge.status, 0, `${mode.join(' ')}: ${out(edge)}`);
	}
});

// why: catches build-record --from-plan writes items[].tests from the plan and the tester RECORDs, so every new test is named (K368 S2)
test('build-record --from-plan writes items[].tests from the plan and the tester RECORDs, so every new test is named', () => {
	const planned = ['the first planned test keeps its name', 'the second planned test keeps its name'];
	// The key takes the first test file in the Files cell, tests/a.test.mjs, and the RECORD names only the first test.
	const keys = planned.map((n) => `tests/a.test.mjs::${n}`);
	const plan = planText([unit('U1', planned.map((n) => `${n} -> S1`), '`src/a.mjs`, `tests/a.test.mjs` (new), `tests/b.test.mjs` (new)')]);
	const { res, dir, folder, names } = fromPlan(plan, [recordText('U1', [keys[0]])]);
	assert.equal(res.status, 0, out(res));
	// The plan test the RECORD omits stays in items: the record adds to the plan's names, it never takes them away.
	const item = JSON.parse(res.stdout).items.find((i) => i.unit === 'U1');
	assert.ok(item, `build-record --from-plan writes an item for U1:\n${res.stdout}`);
	assert.deepEqual(item.tests, keys);
	// It writes no file: the temp folder holds the plan and the records folder, and that folder only what was written.
	assert.deepEqual(fs.readdirSync(dir).sort(), ['PLAN.md', 'records']);
	assert.deepEqual(fs.readdirSync(folder).sort(), names);
});

// why: catches a RECORD test missing from the plan is named, not added silently (K368 S3)
test('a RECORD test missing from the plan is named, not added silently', () => {
	const planned = 'the first planned test keeps its name';
	const extra = 'the extra test the plan lacks';
	const { res } = fromPlan(planText([unit('U1', [`${planned} -> S1`], '`src/a.mjs`, `tests/a.test.mjs` (new)')]), [recordText('U1', [`tests/a.test.mjs::${planned}`, `tests/a.test.mjs::${extra}`])]);
	assert.equal(res.status, 0, out(res));
	assert.ok(res.stderr.includes(`not in plan: U1 tests/a.test.mjs::${extra}`), `the missing test is named on stderr:\n${out(res)}`);
	const item = JSON.parse(res.stdout).items.find((i) => i.unit === 'U1');
	assert.ok(item, `build-record --from-plan writes an item for U1:\n${res.stdout}`);
	assert.deepEqual(item.tests, [`tests/a.test.mjs::${planned}`]);
});
