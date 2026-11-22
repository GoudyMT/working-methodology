// U19 (T-B1): the plan sets each unit's test budget. One test per spec line S1-S11; controls are assertions inside.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const BUDGET = fileURLToPath(new URL('../user/kit-tools/test-budget.mjs', import.meta.url));
const CHECK = fileURLToPath(new URL('../user/kit-tools/plan-check.mjs', import.meta.url));
const TESTER = fileURLToPath(new URL('../user/kit-tools/tester-model.mjs', import.meta.url));
const TEMPLATE = fileURLToPath(new URL('../user/skills/agent-team-build/templates/batch-plan.md', import.meta.url));
const ADAPTER = fileURLToPath(new URL('../user/skills/agent-team-build/templates/project-adapter.md', import.meta.url));

const TESTS = 'Tests to write first, and the failure each must show';
const HEAD = ['Id', 'Files', 'Runs', 'Risk', 'Category', TESTS, 'Tester'];
const out = (res) => res.stdout + res.stderr;

// Runs test-budget.mjs with the given arguments. A missing script fails here, with its name, not as a crash.
const runBudget = (args) => {
	assert.ok(fs.existsSync(BUDGET), 'user/kit-tools/test-budget.mjs is missing');
	return spawnSync(process.execPath, [BUDGET, ...args], { encoding: 'utf8' });
};
// Writes a kit.config.json-shaped map (its testCategories key) in a fresh temp folder and returns the file path.
const mapFile = (map) => {
	const dir = kitTemp.makeTemp('test-budget-');
	const file = path.join(dir, 'kit.config.json');
	fs.writeFileSync(file, JSON.stringify({ testCategories: map }));
	return file;
};
// A Units table with the given header names; each row is an object keyed by those names. Spec text goes before the collision list.
const planText = (rows, { head = HEAD, extra = '' } = {}) => {
	const body = rows.map((r) => `| ${head.map((h) => r[h] ?? '').join(' | ')} |`);
	return ['# Batch plan - x', '', '## Units', '', `| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...body, '', extra, '## Collision list', ''].join('\n');
};
const row = (id, over = {}) => ({ Id: id, Files: '`src/a.mjs`', Runs: 'alone', Risk: 'low', Category: 'logic', [TESTS]: 'checks it -> S1', Tester: '', ...over });
// n test lines in a Tests cell, separated by <br> as the template asks.
const tests = (n, id = 'S1') => Array.from({ length: n }, (_, i) => `check ${i + 1} -> ${id}`).join('<br>');
// Runs plan-check on a plan text in a temp folder. A missing script fails here, with its name.
const runCheck = (text) => {
	assert.ok(fs.existsSync(CHECK), 'user/kit-tools/plan-check.mjs is missing');
	const dir = kitTemp.makeTemp('plan-check-');
	const file = path.join(dir, 'plan.md');
	fs.writeFileSync(file, text);
	return spawnSync(process.execPath, [CHECK, file], { cwd: dir, encoding: 'utf8' });
};

// why: catches a unit with no category line, or the wrong one, so the lead cannot read its test budget from its files (S1).
test('B1 spec S1: test-budget prints one category line with its ceiling, and the highest category of any file wins', () => {
	const map = mapFile({ 'docs/*.md': 'docs', 'src/*.mjs': 'logic' });
	// Three files with the guard file first: a rule that keeps the last file's category would print logic or docs and fail here.
	const three = runBudget(['--files', 'user/kit-tools/approve.mjs,src/b.mjs,docs/a.md', '--map', map]);
	assert.equal(three.status, 0, out(three));
	assert.match(three.stdout, /^category: guard \(ceiling 25; /m);
	const res = runBudget(['--files', 'docs/a.md,src/b.mjs', '--map', map]);
	assert.equal(res.status, 0, out(res));
	assert.match(res.stdout, /^category: logic \(ceiling 15; .+\)\s*$/m);
	// Control: a docs-only unit takes the docs category, not the logic of the other file.
	const docs = runBudget(['--files', 'docs/a.md', '--map', map]);
	assert.equal(docs.status, 0, out(docs));
	assert.match(docs.stdout, /^category: docs \(ceiling 3; /m);
});

// why: catches a guard file or Risk high that does not fire guard, so a hook or gate change gets a logic budget (S2).
test('B2 spec S2: Risk high or any GUARD_PATHS entry fires guard, and a near-miss folder name does not', async () => {
	assert.ok(fs.existsSync(TESTER), 'user/kit-tools/tester-model.mjs is missing');
	const { GUARD_PATHS } = await import(pathToFileURL(TESTER).href);
	const high = runBudget(['--files', 'src/a.mjs', '--risk', 'high']);
	assert.equal(high.status, 0, out(high));
	assert.match(high.stdout, /^category: guard \(ceiling 25; /m);
	// Each GUARD_PATHS entry gets a file it names: a folder anywhere in the path, a file-name glob, or an exact file name.
	// Run from the tester-model list itself, so a copy in test-budget.mjs that drops an entry fails here.
	const sample = (g) => (g.endsWith('/') ? `user/${g}probe.cjs` : g.includes('*') ? g.replace('*', 'probe') : `user/tools/${g}`);
	for (const g of GUARD_PATHS) {
		const res = runBudget(['--files', sample(g), '--risk', 'low']);
		assert.equal(res.status, 0, `${g}: ${out(res)}`);
		assert.match(res.stdout, /^category: guard \(ceiling 25; /m, `${g} gives its file the guard category`);
	}
	// Control: a plain file at Risk low is not guard, and a folder whose name only ends like a guard folder is not either.
	const plain = runBudget(['--files', 'src/a.mjs', '--risk', 'low']);
	assert.equal(plain.status, 0, out(plain));
	assert.doesNotMatch(plain.stdout, /^category: guard /m);
	const near = runBudget(['--files', 'src/my-kit-hooks/a.mjs', '--risk', 'low']);
	assert.equal(near.status, 0, out(near));
	assert.doesNotMatch(near.stdout, /^category: guard /m);
});

// why: catches an unmapped file counted as docs or glue, so a file the adapter never named gets a cheap budget (S3).
test('B3 spec S3: the testCategories map sets categories by path or glob, and a file the map does not name counts as logic', async () => {
	const { CEILING } = await import(pathToFileURL(BUDGET).href);
	assert.equal(CEILING.data, 2);
	const map = mapFile({ 'docs/*.md': 'docs', 'kit-tools/exact.cjs': 'glue', 'fixtures/*.json': 'data' });
	const unmapped = runBudget(['--files', 'unmapped/z.txt', '--map', map]);
	assert.equal(unmapped.status, 0, out(unmapped));
	assert.match(unmapped.stdout, /^category: logic \(ceiling 15; /m);
	// Control: files the map does name take their own category.
	const globbed = runBudget(['--files', 'docs/a.md', '--map', map]);
	assert.match(globbed.stdout, /^category: docs \(ceiling 3; /m);
	const exact = runBudget(['--files', 'kit-tools/exact.cjs', '--map', map]);
	assert.match(exact.stdout, /^category: glue \(ceiling 6; /m);
	const data = runBudget(['--files', 'fixtures/x.json', '--map', map]);
	assert.equal(data.status, 0, out(data));
	assert.match(data.stdout, /^category: data \(ceiling 2; /m);
});

// why: catches a plan row lowering a category below the computed one, so a unit gets a cheaper budget than its files earn (S4).
test('B4 spec S4: a Category above the computed one is raised to it, and one below is refused naming both', () => {
	const raised = runBudget(['--files', 'src/a.mjs', '--category', 'guard']);
	assert.equal(raised.status, 0, out(raised));
	assert.match(raised.stdout, /^category: guard \(ceiling 25; raised from logic by the plan row\)/m);
	// Control: a lower given category is refused, and the message names both the given and the computed one.
	const lower = runBudget(['--files', 'src/a.mjs', '--category', 'docs']);
	assert.equal(lower.status, 1, out(lower));
	assert.match(out(lower), /logic/);
	assert.match(out(lower), /docs/);
});

// why: catches a Units table with no Category or Tests column read as clean, so the plan never carries a budget (S5).
test('B5 spec S5: plan-check reads the Category and Tests columns and refuses a Units table without them', () => {
	const noCat = planText([row('U1')], { head: HEAD.filter((h) => h !== 'Category') });
	const missingCat = runCheck(noCat);
	assert.equal(missingCat.status, 1, out(missingCat));
	assert.match(out(missingCat), /the Units table has no Category column/);
	const noTests = planText([row('U1')], { head: HEAD.filter((h) => h !== TESTS) });
	const missingTests = runCheck(noTests);
	assert.equal(missingTests.status, 1, out(missingTests));
	assert.match(out(missingTests), /Tests/);
	// Control: with both columns present and the row clean, no column is reported missing.
	const present = runCheck(planText([row('U1')]));
	assert.doesNotMatch(out(present), /column/i);
});

// why: catches a row over its category ceiling passing, so a unit is built with a test list too long for one budget (S6).
test('B6 spec S6: a row over its category ceiling is refused with a split message, and one at the ceiling is not', () => {
	const over = runCheck(planText([row('U1', { [TESTS]: tests(16) })]));
	assert.equal(over.status, 1, out(over));
	assert.match(out(over), /split/i);
	// Control: 15 test lines is the logic ceiling, so the row is not refused for its count.
	const atCeiling = runCheck(planText([row('U1', { [TESTS]: tests(15) })]));
	assert.doesNotMatch(out(atCeiling), /split/i);
	// Control: a docs row (ceiling 3) with 4 test lines is refused; one exactly at 3 passes. The docs map sits beside the repo root.
	const docsPlan = (n) => {
		const dir = kitTemp.makeTemp('plan-check-docs-');
		spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
		fs.writeFileSync(path.join(dir, 'kit.config.json'), JSON.stringify({ testCategories: { 'docs/*.md': 'docs' } }));
		const file = path.join(dir, 'plan.md');
		fs.writeFileSync(file, planText([row('D1', { Files: '`docs/a.md`', Category: 'docs', [TESTS]: tests(n) })]));
		return spawnSync(process.execPath, [CHECK, file], { cwd: dir, encoding: 'utf8' });
	};
	const docsOver = docsPlan(4);
	assert.equal(docsOver.status, 1, out(docsOver));
	assert.match(out(docsOver), /split/i);
	const docsAt = docsPlan(3);
	assert.equal(docsAt.status, 0, out(docsAt));
});

// why: catches a test line with no "->" passing, so a test is listed with no spec line or rule id it proves (S7).
test('B7 spec S7: a test line with no "->" is refused naming the unit, and a line with one is not', () => {
	const bad = runCheck(planText([row('U1', { [TESTS]: 'checks the thing' })]));
	assert.equal(bad.status, 1, out(bad));
	assert.match(out(bad), /U1/);
	// Control: the same unit with its line in the "->" form is not refused.
	const good = runCheck(planText([row('U1', { [TESTS]: 'checks the thing -> S1' })]));
	assert.equal(good.status, 0, out(good));
});

// why: catches a spec rule no test line names passing, so a rule ships with no test that proves it (S8).
test('B8 spec S8: a spec rule no test line names is refused by its id, and one a test names is not', () => {
	const spec = ['### U1 spec', '', '- S1: the first rule', '- S2: the second rule', ''].join('\n');
	const bad = runCheck(planText([row('U1', { [TESTS]: 'checks one -> S1' })], { extra: spec }));
	assert.equal(bad.status, 1, out(bad));
	assert.match(out(bad), /S2/);
	// Control: S1 is named by a test line, so it is not the refused rule.
	assert.doesNotMatch(out(bad), /\bS1\b/);
	// Control: with every rule named by a test line, the plan passes.
	const all = runCheck(planText([row('U1', { [TESTS]: 'checks one -> S1<br>checks two -> S2' })], { extra: spec }));
	assert.equal(all.status, 0, out(all));
});

// why: catches a Category cell below the computed category passing, so a unit gets a cheaper budget than its files earn (S9).
test('B9 spec S9: a Category cell below the computed category is refused naming the unit, and a matching one is not', () => {
	// U1's file computes logic; its cell says docs.
	const res = runCheck(planText([
		row('U1', { Category: 'docs' }),
		row('U2', { Files: '`src/b.mjs`', Category: 'logic' }),
		// Control: a guard cell on a logic file is a raise, which is allowed, so U3 is not named.
		row('U3', {
			Files: '`src/c.mjs`',
			Category: 'guard',
			[TESTS]: [
				'bypass: runs the guard through a wrapper and another shell -> S1',
				'repeat: runs the guard twice and gets the same verdict -> S1',
				'fail-closed: a broken guard blocks the call and is logged -> S1',
			].join('<br>'),
		}),
	]));
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /U1/);
	// Control: U2's cell matches the computed category, so it is not named.
	assert.doesNotMatch(out(res), /U2/);
	assert.doesNotMatch(out(res), /U3/);
});

// why: catches a locked row edited later passing, so a unit's test budget can change after it was set (S10).
test('B10 spec S10: --lock writes the sha256 of the row line, and a later run refuses that row once its text changes', () => {
	assert.ok(fs.existsSync(CHECK), 'user/kit-tools/plan-check.mjs is missing');
	const dir = kitTemp.makeTemp('plan-lock-');
	const file = path.join(dir, 'plan.md');
	const text = planText([row('U1'), row('U2', { Files: '`src/b.mjs`' })]);
	fs.writeFileSync(file, text);
	const locked = spawnSync(process.execPath, [CHECK, file, '--lock', 'U1'], { cwd: dir, encoding: 'utf8' });
	assert.equal(locked.status, 0, out(locked));
	const rowLine = text.split('\n').find((l) => l.startsWith('| U1 |'));
	const locks = JSON.parse(fs.readFileSync(`${file}.locks.json`, 'utf8'));
	assert.equal(locks.U1, crypto.createHash('sha256').update(rowLine).digest('hex'));
	// Control: the unchanged locked row passes a later run.
	const same = spawnSync(process.execPath, [CHECK, file], { cwd: dir, encoding: 'utf8' });
	assert.equal(same.status, 0, out(same));
	// The locked row edited is refused, naming U1.
	fs.writeFileSync(file, planText([row('U1', { [TESTS]: 'changed -> S1' }), row('U2', { Files: '`src/b.mjs`' })]));
	const changed = spawnSync(process.execPath, [CHECK, file], { cwd: dir, encoding: 'utf8' });
	assert.equal(changed.status, 1, out(changed));
	assert.match(out(changed), /U1/);
	// Control: editing only the unlocked row U2 passes.
	fs.writeFileSync(file, planText([row('U1'), row('U2', { Files: '`src/b.mjs`', [TESTS]: 'changed -> S1' })]));
	const unlocked = spawnSync(process.execPath, [CHECK, file], { cwd: dir, encoding: 'utf8' });
	assert.equal(unlocked.status, 0, out(unlocked));
});

// why: guards rule:agent-team-adapter (the Units table and the adapter name Category, Tests, testCategories)
test('B11 spec S11: the batch-plan Units table has Category and Tests columns, and project-adapter documents the testCategories row', () => {
	assert.ok(fs.existsSync(TEMPLATE), 'batch-plan.md is missing');
	const lines = fs.readFileSync(TEMPLATE, 'utf8').split(/\r?\n/);
	const at = lines.findIndex((l) => /^\|\s*Id\s*\|/.test(l));
	assert.ok(at >= 0, 'batch-plan.md has no Units header row');
	const heads = lines[at].split('|').slice(1, -1).map((c) => c.trim());
	assert.ok(heads.some((h) => h.startsWith('Category')), 'batch-plan.md Units table has no Category column');
	assert.ok(heads.some((h) => h.startsWith('Tests')), 'batch-plan.md Units table has no Tests column');
	// Control: the Risk and Tester columns the table already had are still there.
	assert.ok(heads.some((h) => h.startsWith('Risk')));
	assert.ok(heads.includes('Tester'));
	assert.ok(fs.existsSync(ADAPTER), 'project-adapter.md is missing');
	assert.match(fs.readFileSync(ADAPTER, 'utf8'), /^\|[^\n]*testCategories/m);
});

// why: catches a mixed Files cell that drops its bare name, so a guard file written beside a backticked one computes as logic (S1 cells).
test('B12 cell: a mixed Files cell reads its bare guard name, so a logic Category on it is refused; an all-backticked cell does the same', () => {
	const mixed = runCheck(planText([row('U1', { Files: '`docs/a.md`, project/.claude/approve.mjs', Category: 'logic' })]));
	assert.equal(mixed.status, 1, out(mixed));
	assert.match(out(mixed), /guard/);
	assert.match(out(mixed), /approve\.mjs/);
	// Control: an all-backticked cell naming the same two files is refused the same way.
	const ticked = runCheck(planText([row('U1', { Files: '`docs/a.md`, `project/.claude/approve.mjs`', Category: 'logic' })]));
	assert.equal(ticked.status, 1, out(ticked));
	assert.match(out(ticked), /approve\.mjs/);
	// Control: an all-backticked cell of two plain files, with its logic Category, passes.
	const plain = runCheck(planText([row('U1', { Files: '`docs/a.md`, `src/b.mjs`', Category: 'logic' })]));
	assert.equal(plain.status, 0, out(plain));
});
