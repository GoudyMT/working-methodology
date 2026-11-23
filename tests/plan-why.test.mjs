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
const unit = (id, tests) => ({
	Id: id, Title: 'K368: the plan gives each test its name and why', Files: '`src/a.mjs`', Tests: tests.join('<br>'),
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
