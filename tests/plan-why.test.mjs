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
// A unit whose Title leads with its row id (K368), as this plan's rows do; its Tests lines join with <br>.
const unit = (id, tests, files = '`src/a.mjs`') => ({
	Id: id, Title: 'K368: the plan gives each test its name and why', Files: files, Tests: tests.join('<br>'),
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
// Runs build-record --from-plan on a plan and the hand-backs in a records folder, both in a temp folder.
const fromPlan = (plan, records) => {
	assert.ok(fs.existsSync(BUILD_RECORD), 'scripts/build-record.mjs is missing');
	const dir = kitTemp.makeTemp('plan-why-');
	spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
	const planFile = path.join(dir, 'PLAN.md');
	fs.writeFileSync(planFile, plan);
	const folder = path.join(dir, 'records');
	fs.mkdirSync(folder);
	records.forEach((text, i) => fs.writeFileSync(path.join(folder, `tester-${i}.jsonl`), text));
	return spawnSync(process.execPath, [BUILD_RECORD, '--from-plan', planFile, '--records', folder], { cwd: dir, encoding: 'utf8' });
};
const out = (res) => res.stdout + res.stderr;

// why: catches plan-check --whys prints each unit's test names and their why lines from its Tests cell (K368 S1)
test("plan-check --whys prints each unit's test names and their why lines from its Tests cell", () => {
	const names = [
		'plan-check --whys prints each unit\'s test names and their why lines',
		'a why line is cut from its Tests line, the tail removed',
		'the second unit\'s own test line is printed too',
	];
	const res = run(planText([
		unit('U1', [`${names[0]} -> S1`, `${names[1]} -> S1`]),
		unit('U2', [`${names[2]} -> S1`]),
	]), '--whys');
	assert.equal(res.status, 0, out(res));
	for (const name of names) {
		assert.ok(res.stdout.includes(name), `--whys prints the test name: ${name}\n${out(res)}`);
		assert.ok(res.stdout.includes(`// why: catches ${name} (K368 S1)`), `--whys prints its why line: ${name}\n${out(res)}`);
	}
});

// why: catches plan-check --brief U1 --role tester writes the tester brief from the row: files, test names, why lines and the unit-lock --tester command (K368 S4)
test('plan-check --brief U1 --role tester writes the tester brief from the row: files, test names, why lines and the unit-lock --tester command', () => {
	const names = ['the tester brief names each test with its why line', 'the tester brief ends with the unit-lock tester command'];
	const res = run(planText([
		unit('U1', [`${names[0]} -> S1`, `${names[1]} -> S1`], '`src/a.mjs`, `tests/a.test.mjs` (new), `tests/b.test.mjs` (new)'),
	]), '--brief', 'U1', '--role', 'tester');
	assert.equal(res.status, 0, out(res));
	assert.ok(res.stdout.includes('U1'), out(res));
	assert.ok(res.stdout.includes('src/a.mjs') && res.stdout.includes('tests/b.test.mjs'), `the brief holds the Files cell: ${res.stdout}`);
	for (const name of names) {
		assert.ok(res.stdout.includes(name), `the brief names the test: ${name}\n${res.stdout}`);
		assert.ok(res.stdout.includes(`// why: catches ${name} (K368 S1)`), `the brief holds its why line: ${name}\n${res.stdout}`);
	}
	assert.ok(res.stdout.includes('node user/kit-tools/unit-lock.mjs --tester --files tests/a.test.mjs,tests/b.test.mjs'), `the brief holds the tester lock command:\n${res.stdout}`);
});

// why: catches plan-check --brief U1 --role builder writes the builder brief: source files, the exact test files to run, the lock commands (K368 S4)
test('plan-check --brief U1 --role builder writes the builder brief: source files, the exact test files to run, the lock commands', () => {
	const res = run(planText([
		unit('U1', ['the builder brief names the source files and the exact test run -> S1', 'the builder brief names the lock commands for the red sha -> S1'], '`src/a.mjs`, `src/b.mjs`, `tests/a.test.mjs` (new)'),
	]), '--brief', 'U1', '--role', 'builder');
	assert.equal(res.status, 0, out(res));
	assert.ok(res.stdout.includes('src/a.mjs') && res.stdout.includes('src/b.mjs'), `the brief holds the source files: ${res.stdout}`);
	assert.ok(res.stdout.includes('node --test tests/a.test.mjs'), `the brief holds the exact test run:\n${res.stdout}`);
	// The lock line names the source files only: the test file is not in it, and <red sha> is left as written.
	assert.ok(res.stdout.includes('node user/kit-tools/unit-lock.mjs <red sha> --files src/a.mjs,src/b.mjs'), `the brief holds the builder lock command:\n${res.stdout}`);
});

// why: catches a Tests line whose derived why is under six words is a plan fault (K368 S1)
test('a Tests line whose derived why is under six words is a plan fault', () => {
	// The derived why is "catches a short line here": four words, under six, so the plan has a fault naming U1.
	const short = run(planText([unit('U1', ['a short line here -> S1'])]));
	assert.equal(short.status, 1, out(short));
	assert.match(out(short), /fault:[^\n]*U1/);
	// Six words of test text make a why of six words or more, so the same plan with that line checks clean.
	const six = run(planText([unit('U1', ['each of these runs six words -> S1'])]));
	assert.equal(six.status, 0, out(six));
});

// why: catches build-record --from-plan writes items[].tests from the plan and the tester RECORDs, so every new test is named (K368 S2)
test('build-record --from-plan writes items[].tests from the plan and the tester RECORDs, so every new test is named', () => {
	const planned = ['the first planned test keeps its name', 'the second planned test keeps its name'];
	const keys = planned.map((n) => `tests/a.test.mjs::${n}`);
	const res = fromPlan(planText([unit('U1', planned.map((n) => `${n} -> S1`), '`src/a.mjs`, `tests/a.test.mjs` (new)')]), [recordText('U1', keys)]);
	assert.equal(res.status, 0, out(res));
	const item = JSON.parse(res.stdout).items.find((i) => i.unit === 'U1');
	assert.ok(item, `build-record --from-plan writes an item for U1:\n${res.stdout}`);
	assert.deepEqual(item.tests, keys);
});

// why: catches a RECORD test missing from the plan is named, not added silently (K368 S3)
test('a RECORD test missing from the plan is named, not added silently', () => {
	const planned = 'the first planned test keeps its name';
	const extra = 'the extra test the plan lacks';
	const res = fromPlan(planText([unit('U1', [`${planned} -> S1`], '`src/a.mjs`, `tests/a.test.mjs` (new)')]), [recordText('U1', [`tests/a.test.mjs::${planned}`, `tests/a.test.mjs::${extra}`])]);
	assert.equal(res.status, 0, out(res));
	assert.ok(res.stderr.includes(`not in plan: U1 tests/a.test.mjs::${extra}`), `the missing test is named on stderr:\n${out(res)}`);
	const item = JSON.parse(res.stdout).items.find((i) => i.unit === 'U1');
	assert.ok(item, `build-record --from-plan writes an item for U1:\n${res.stdout}`);
	assert.deepEqual(item.tests, [`tests/a.test.mjs::${planned}`]);
});
