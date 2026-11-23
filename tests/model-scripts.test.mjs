// Build 24 (U5): the tester and builder model scripts. tester-model.mjs reads the unit's row of a batch plan's Units
// table, and an optional test-review record, and prints the model for the tester (K307 criteria R1 to R6, approved as
// written in docs/plans/build-24-handoff-test-method-model-table.md section 3). builder-model.mjs reads the builder's
// model and step-up from kit.config.json. No test calls a model. Each script is run as a child process, so a missing
// script fails its own tests on an assertion and nothing else.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();

const TESTER = path.resolve('user/kit-tools/tester-model.mjs');
const BUILDER = path.resolve('user/kit-tools/builder-model.mjs');
const BATCH_TEMPLATE = path.resolve('user/skills/agent-team-build/templates/batch-plan.md');
const PLAN_HEAD = '| Id | Files | Runs | Risk | Tester | Tests to write first |';
// The batch-plan Units header as it reads today, with Risk and Tester added in an order the template does not use.
const TEMPLATE_HEAD_ORDERED = '| Id | Title | Files (exact; mark new files) | Tests to write first, and the failure each must show | Done when | Tester | Runs | Risk | Built by |';
// A row that fires no criterion: low risk, a plain source file, no unit after it, no sonnet ask, a checkable example.
const PLAIN = ['U1', '`scripts/lanes.mjs`', 'parallel', 'low', '', 'parse("1.2") -> RangeError'];
const DEFAULT_LINE = 'tester: haiku (default: no criterion fired)';

const write = (dir, rel, text) => {
	fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
	fs.writeFileSync(path.join(dir, rel), text);
};

// A plan file whose ## Units table holds the given rows, each an array of cells in the header's column order.
function planWith(rows, head = PLAN_HEAD) {
	const dir = kitTemp.makeTemp('tester-plan-');
	const rule = `|${head.split('|').slice(1, -1).map(() => '---').join('|')}|`;
	const body = ['# Batch plan - fixture', '', '## Units', '', head, rule, ...rows.map((r) => `| ${r.join(' | ')} |`), ''].join('\n');
	write(dir, 'plan.md', body);
	return path.join(dir, 'plan.md');
}

// A test-review record: one JSONL finding line per status, then the note line every record ends with.
function reviewWith(statuses) {
	const dir = kitTemp.makeTemp('tester-review-');
	const lines = statuses.map((status, i) => JSON.stringify({ id: `R${i + 1}`, severity: 'medium', status, where: 'tests/x.test.mjs', claim: 'a test', proof: 'the run', fix: 'tighten it' }));
	lines.push(JSON.stringify({ note: 'review of U1', writer: 'test-reviewer' }));
	write(dir, 'review.jsonl', lines.join('\n') + '\n');
	return path.join(dir, 'review.jsonl');
}

const runTester = (rows, unit = 'U1', extra = [], head = PLAN_HEAD) => spawnSync(process.execPath, [TESTER, planWith(rows, head), unit, ...extra], { encoding: 'utf8' });

// A kit folder holding a copy of the builder script beside a config with odd model names, so the output proves the
// models are read from the config and not written into the script.
function builderKit(model, stepUp) {
	const kit = kitTemp.makeTemp('builder-kit-');
	write(kit, 'kit.config.json', JSON.stringify({ steps: { builder: { model, effort: 'medium', enforcer: 'role:builder', stepUp } } }));
	fs.mkdirSync(path.join(kit, 'user/kit-tools'), { recursive: true });
	if (fs.existsSync(BUILDER)) fs.copyFileSync(BUILDER, path.join(kit, 'user/kit-tools/builder-model.mjs'));
	return path.join(kit, 'user/kit-tools/builder-model.mjs');
}

const runBuilder = (script, args = []) => spawnSync(process.execPath, [script, 'U5', ...args], { encoding: 'utf8' });

// ---------------------------------------------------------------------------------------------------------------
// 1. tester-model.mjs: criteria R1 to R6, in order
// ---------------------------------------------------------------------------------------------------------------

// why: guards rule:agent-role-table (a high-risk unit must put the tester on Sonnet, never Haiku)
test('tester-model picks sonnet on R1 for a row marked Risk high', () => {
	const r = runTester([['U1', '`scripts/lanes.mjs`', 'parallel', 'high', '', 'parse("1.2") -> RangeError']]);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout.trim(), /^tester: sonnet \(R1: .+\)$/);
});

// why: guards rule:agent-role-table (a row marked low or medium risk must not lift the tester off Haiku)
test('tester-model keeps haiku on R1 for a row marked Risk low or medium', () => {
	for (const risk of ['low', 'medium']) {
		const r = runTester([['U1', '`scripts/lanes.mjs`', 'parallel', risk, '', 'parse("1.2") -> RangeError']]);
		assert.equal(r.status, 0, r.stderr);
		assert.equal(r.stdout.trim(), DEFAULT_LINE, `Risk: ${risk}`);
	}
});

// why: guards rule:agent-role-table (a guard or gate file must put the tester on Sonnet)
test('tester-model picks sonnet on R2 for a guard hook path', () => {
	const r = runTester([['U1', '`user/kit-hooks/test-scope.cjs`', 'parallel', 'low', '', 'parse("1.2") -> RangeError']]);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout.trim(), /^tester: sonnet \(R2: .+\)$/);
});

// why: catches a guard list that matches any path containing the word guard, lifting every doc to Sonnet
test('tester-model keeps haiku on R2 for a plain script and for docs/guard-notes.md', () => {
	for (const file of ['`scripts/lanes.mjs`', '`docs/guard-notes.md`']) {
		const r = runTester([['U1', file, 'parallel', 'low', '', 'parse("1.2") -> RangeError']]);
		assert.equal(r.status, 0, r.stderr);
		assert.equal(r.stdout.trim(), DEFAULT_LINE, file);
	}
});

// why: guards rule:agent-role-table (every guard path in the approved list must put the tester on Sonnet)
test('tester-model picks sonnet on R2 for each guard path in the approved list', () => {
	for (const file of ['`.githooks/pre-push`', '`project/.claude/guard-read.cjs`', '`settings.json`', '`user/skills/pre-pr-sweep/approve.mjs`', '`user/kit-tools/merge-gate.mjs`']) {
		const r = runTester([['U1', file, 'parallel', 'low', '', 'parse("1.2") -> RangeError']]);
		assert.equal(r.status, 0, r.stderr);
		assert.match(r.stdout.trim(), /^tester: sonnet \(R2: .+\)$/, file);
	}
});

// why: catches a Files cell that holds one guard path among plain ones being read as plain and kept on Haiku
test('tester-model picks sonnet on R2 when a Files cell holds one plain and one guard path', () => {
	const r = runTester([['U1', '`scripts/lanes.mjs`, `.githooks/pre-push`', 'parallel', 'low', '', 'parse("1.2") -> RangeError']]);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout.trim(), /^tester: sonnet \(R2: .+\)$/);
});

// why: guards rule:agent-role-table (a unit with two or more units after it is foundation logic and needs Sonnet)
test('tester-model picks sonnet on R3 when two units run after this one', () => {
	const r = runTester([
		['U1', '`scripts/a.mjs`', 'parallel', 'low', '', 'parse("1.2") -> RangeError'],
		['U2', '`scripts/b.mjs`', 'after U1', 'low', '', 'parse("1.2") -> RangeError'],
		['U3', '`scripts/c.mjs`', 'after U1', 'low', '', 'parse("1.2") -> RangeError'],
	]);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout.trim(), /^tester: sonnet \(R3: .+\)$/);
});

// why: catches a single unit after this one lifting the tester to Sonnet and costing the default Haiku pick
test('tester-model keeps haiku on R3 when one unit runs after this one', () => {
	const r = runTester([
		['U1', '`scripts/a.mjs`', 'parallel', 'low', '', 'parse("1.2") -> RangeError'],
		['U2', '`scripts/b.mjs`', 'after U1', 'low', '', 'parse("1.2") -> RangeError'],
	]);
	assert.equal(r.status, 0, r.stderr);
	assert.equal(r.stdout.trim(), DEFAULT_LINE);
});

// why: catches units below this one that run in parallel, or after another unit, being counted as units after it
test('tester-model keeps haiku on R3 when the units below U1 read parallel or after U2', () => {
	const parallel = runTester([
		['U1', '`scripts/a.mjs`', 'parallel', 'low', '', 'parse("1.2") -> RangeError'],
		['U2', '`scripts/b.mjs`', 'parallel', 'low', '', 'parse("1.2") -> RangeError'],
		['U3', '`scripts/c.mjs`', 'parallel', 'low', '', 'parse("1.2") -> RangeError'],
	]);
	assert.equal(parallel.status, 0, parallel.stderr);
	assert.equal(parallel.stdout.trim(), DEFAULT_LINE, 'U2 and U3 read parallel');
	const chained = runTester([
		['U1', '`scripts/a.mjs`', 'parallel', 'low', '', 'parse("1.2") -> RangeError'],
		['U2', '`scripts/b.mjs`', 'parallel', 'low', '', 'parse("1.2") -> RangeError'],
		['U3', '`scripts/c.mjs`', 'after U2', 'low', '', 'parse("1.2") -> RangeError'],
		['U4', '`scripts/d.mjs`', 'after U2', 'low', '', 'parse("1.2") -> RangeError'],
	]);
	assert.equal(chained.status, 0, chained.stderr);
	assert.equal(chained.stdout.trim(), DEFAULT_LINE, 'U3 and U4 read after U2');
});

// why: guards rule:agent-role-table (a unit in the middle of the table counts only the units after it, not the rows above)
test('tester-model picks sonnet on R3 for a unit in the middle of the table with two units after it', () => {
	const r = runTester([
		['U1', '`scripts/a.mjs`', 'parallel', 'low', '', 'parse("1.2") -> RangeError'],
		['U2', '`scripts/b.mjs`', 'parallel', 'low', '', 'parse("1.2") -> RangeError'],
		['U3', '`scripts/c.mjs`', 'after U2', 'low', '', 'parse("1.2") -> RangeError'],
		['U4', '`scripts/d.mjs`', 'after U2', 'low', '', 'parse("1.2") -> RangeError'],
	], 'U2');
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout.trim(), /^tester: sonnet \(R3: .+\)$/);
});

// why: guards rule:sub-agent-verification (a review that reports a vague spec must send the rerun to Sonnet)
test('tester-model picks sonnet on R4 for a rerun after a vague review line', () => {
	const r = runTester([PLAIN], 'U1', ['--review', reviewWith(['vague'])]);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout.trim(), /^tester: sonnet \(R4: .+\)$/);
});

// why: guards rule:sub-agent-verification (a review that reports an uncovered behaviour must send the rerun to Sonnet)
test('tester-model picks sonnet on R4 for a rerun after an uncovered review line', () => {
	const r = runTester([PLAIN], 'U1', ['--review', reviewWith(['uncovered'])]);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout.trim(), /^tester: sonnet \(R4: .+\)$/);
});

// why: catches a vague line in a mixed review being outvoted by the wrong-test lines and kept on Haiku
test('tester-model picks sonnet on R4 for a review with wrong-test and vague lines together', () => {
	const r = runTester([PLAIN], 'U1', ['--review', reviewWith(['wrong-test', 'vague'])]);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout.trim(), /^tester: sonnet \(R4: .+\)$/);
});

// why: catches a wrong test escalated to Sonnet when the fix is a rewrite a Haiku tester can make
test('tester-model keeps haiku on R4 for a rerun after only wrong-test lines', () => {
	const r = runTester([PLAIN], 'U1', ['--review', reviewWith(['wrong-test', 'wrong-test'])]);
	assert.equal(r.status, 0, r.stderr);
	assert.equal(r.stdout.trim(), DEFAULT_LINE);
});

// why: guards rule:agent-role-table (a row with no checkable example must put the tester on Sonnet)
test('tester-model picks sonnet on R5 when Tests to write first is empty', () => {
	const r = runTester([['U1', '`scripts/lanes.mjs`', 'parallel', 'low', '', '']]);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout.trim(), /^tester: sonnet \(R5: .+\)$/);
});

// why: catches a vague test cell such as "it works" passing as a checkable example and keeping Haiku
test('tester-model picks sonnet on R5 when Tests to write first says only it works', () => {
	const r = runTester([['U1', '`scripts/lanes.mjs`', 'parallel', 'low', '', 'it works']]);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout.trim(), /^tester: sonnet \(R5: .+\)$/);
});

// why: guards rule:tdd (a row whose test names an input and an expected output stays on Haiku)
test('tester-model keeps haiku on R5 when a test names an input and an expected output', () => {
	const r = runTester([PLAIN]);
	assert.equal(r.status, 0, r.stderr);
	assert.equal(r.stdout.trim(), DEFAULT_LINE);
});

// why: guards rule:agent-role-table (the owner's Tester: sonnet at plan approval must be honoured)
test('tester-model picks sonnet on R6 when the owner wrote Tester: sonnet', () => {
	const r = runTester([['U1', '`scripts/lanes.mjs`', 'parallel', 'low', 'sonnet', 'parse("1.2") -> RangeError']]);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout.trim(), /^tester: sonnet \(R6: .+\)$/);
});

// why: guards rule:agent-role-table (an empty Tester cell must leave the default Haiku in place)
test('tester-model keeps haiku on R6 when the Tester cell is empty', () => {
	const r = runTester([PLAIN]);
	assert.equal(r.status, 0, r.stderr);
	assert.equal(r.stdout.trim(), DEFAULT_LINE);
});

// why: catches a later criterion or a lower Tester value winning over R1 when both fire on one row
test('tester-model names R1 when R1 and R2 both fire and the Tester cell says haiku', () => {
	const r = runTester([['U1', '`user/kit-hooks/test-scope.cjs`', 'parallel', 'high', 'haiku', 'parse("1.2") -> RangeError']]);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout.trim(), /^tester: sonnet \(R1: .+\)$/);
});

// why: catches a guard path winning over an earlier R2 check when R3 also fires and the order is reversed
test('tester-model names R2 over R3 when a guard path and two units after it both fire', () => {
	const r = runTester([
		['U1', '`user/kit-tools/merge-gate.mjs`', 'parallel', 'low', '', 'parse("1.2") -> RangeError'],
		['U2', '`scripts/b.mjs`', 'after U1', 'low', '', 'parse("1.2") -> RangeError'],
		['U3', '`scripts/c.mjs`', 'after U1', 'low', '', 'parse("1.2") -> RangeError'],
	]);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout.trim(), /^tester: sonnet \(R2: .+\)$/);
});

// why: catches a missing example being reported as the foundation reason when R3 and R5 both fire
test('tester-model names R3 over R5 when two units follow and the test cell is empty', () => {
	const r = runTester([
		['U1', '`scripts/a.mjs`', 'parallel', 'low', '', ''],
		['U2', '`scripts/b.mjs`', 'after U1', 'low', '', 'parse("1.2") -> RangeError'],
		['U3', '`scripts/c.mjs`', 'after U1', 'low', '', 'parse("1.2") -> RangeError'],
	]);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout.trim(), /^tester: sonnet \(R3: .+\)$/);
});

// why: catches a review's vague line reported as the empty-example reason when R4 and R5 both fire
test('tester-model names R4 over R5 when a review has a vague line and the test cell is empty', () => {
	const r = runTester([['U1', '`scripts/lanes.mjs`', 'parallel', 'low', '', '']], 'U1', ['--review', reviewWith(['vague'])]);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout.trim(), /^tester: sonnet \(R4: .+\)$/);
});

// why: catches the owner's Tester ask being reported over an empty example when R5 and R6 both fire
test('tester-model names R5 over R6 when the test cell is empty and the owner asks for sonnet', () => {
	const r = runTester([['U1', '`scripts/lanes.mjs`', 'parallel', 'low', 'sonnet', '']]);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout.trim(), /^tester: sonnet \(R5: .+\)$/);
});

// why: catches a template reordered by the builder leaving tester-model.mjs reading the wrong column for risk or tester
test('tester-model reads Risk and Tester by header name when the columns are in another order', () => {
	const rows = [
		['U1', 'Title', '`scripts/lanes.mjs`', 'parse("1.2") -> RangeError', 'done', '', 'parallel', 'high', 'builder'],
		['U2', 'Title', '`user/kit-hooks/test-scope.cjs`', 'parse("1.2") -> RangeError', 'done', '', 'parallel', 'low', 'builder'],
		['U3', 'Title', '`scripts/lanes.mjs`', 'parse("1.2") -> RangeError', 'done', 'sonnet', 'parallel', 'low', 'builder'],
	];
	const r1 = runTester([rows[0]], 'U1', [], TEMPLATE_HEAD_ORDERED);
	assert.equal(r1.status, 0, r1.stderr);
	assert.match(r1.stdout.trim(), /^tester: sonnet \(R1: .+\)$/, 'R1 with Risk high in the last column');
	const r2 = runTester([rows[1]], 'U2', [], TEMPLATE_HEAD_ORDERED);
	assert.equal(r2.status, 0, r2.stderr);
	assert.match(r2.stdout.trim(), /^tester: sonnet \(R2: .+\)$/, 'R2 on a guard path');
	const r3 = runTester([rows[2]], 'U3', [], TEMPLATE_HEAD_ORDERED);
	assert.equal(r3.status, 0, r3.stderr);
	assert.match(r3.stdout.trim(), /^tester: sonnet \(R6: .+\)$/, 'R6 with Tester sonnet in the sixth column');
});

// why: catches a missing plan or a unit with no row falling back to a silent Haiku pick
test('tester-model exits 2 with nothing on stdout for a missing plan or a unit with no row', () => {
	const missing = spawnSync(process.execPath, [TESTER, path.join(kitTemp.makeTemp('tester-none-'), 'plan.md'), 'U1'], { encoding: 'utf8' });
	assert.equal(missing.status, 2, `${missing.stdout}${missing.stderr}`);
	assert.equal(missing.stdout, '');
	const noRow = runTester([PLAIN], 'U9');
	assert.equal(noRow.status, 2, `${noRow.stdout}${noRow.stderr}`);
	assert.equal(noRow.stdout, '');
});

// why: guards rule:agent-role-table (the guard list must be one exported data list, shared with K341's never-drop paths)
test('tester-model exports GUARD_PATHS covering hooks, the guard scripts, settings and the gates', () => {
	const url = pathToFileURL(TESTER).href;
	const r = spawnSync(process.execPath, ['--input-type=module', '-e', `import(${JSON.stringify(url)}).then((m) => console.log(JSON.stringify(m.GUARD_PATHS)))`], { encoding: 'utf8' });
	assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
	const list = JSON.parse(r.stdout.trim());
	assert.ok(Array.isArray(list) && list.every((p) => typeof p === 'string'), 'GUARD_PATHS is not a list of strings');
	assert.ok(list.some((p) => p.includes('kit-hooks/')), 'no kit-hooks/ entry');
	assert.ok(list.some((p) => p.includes('.githooks/')), 'no .githooks/ entry');
	assert.ok(list.some((p) => /guard[^/]*\.cjs/.test(p)), 'no guard*.cjs pattern');
	assert.ok(list.some((p) => p.includes('settings.json')), 'no settings.json entry');
	assert.ok(list.some((p) => p.includes('approve.mjs')), 'no approve.mjs entry');
	assert.ok(list.some((p) => p.includes('merge-gate.mjs')), 'no merge-gate.mjs entry');
});

// ---------------------------------------------------------------------------------------------------------------
// 2. builder-model.mjs: Haiku by default, Sonnet on a red rerun, never higher than Sonnet
// ---------------------------------------------------------------------------------------------------------------

// why: guards rule:agent-role-table (a builder with no red rerun must start on the table's Haiku model)
test('builder-model prints haiku by default and with --reruns 0', () => {
	const none = runBuilder(BUILDER);
	assert.equal(none.status, 0, none.stderr);
	assert.equal(none.stdout.trim(), 'builder: haiku (default)');
	const zero = runBuilder(BUILDER, ['--reruns', '0']);
	assert.equal(zero.status, 0, zero.stderr);
	assert.equal(zero.stdout.trim(), 'builder: haiku (default)');
});

// why: guards rule:agent-role-table (one red rerun must step the builder up to the table's Sonnet step-up)
test('builder-model prints sonnet with a step-up after one red rerun', () => {
	const r = runBuilder(BUILDER, ['--reruns', '1']);
	assert.equal(r.status, 0, r.stderr);
	assert.equal(r.stdout.trim(), 'builder: sonnet (step-up: red rerun)');
});

// why: catches a rerun count that lifts the builder past Sonnet and spends Opus on one step
test('builder-model never prints a model above sonnet, however many reruns', () => {
	const r = runBuilder(BUILDER, ['--reruns', '4']);
	assert.equal(r.status, 0, r.stderr);
	assert.equal(r.stdout.trim(), 'builder: sonnet (step-up: red rerun)');
	assert.doesNotMatch(r.stdout, /opus/i);
});

// why: guards rule:agent-role-table (the builder models must be read from kit.config.json, not written into the script)
test('builder-model reads its default and step-up models from the kit config beside it', () => {
	const script = builderKit('odd-small-1', 'odd-big-2');
	const none = runBuilder(script);
	assert.equal(none.status, 0, `${none.stdout}${none.stderr}`);
	assert.equal(none.stdout.trim(), 'builder: odd-small-1 (default)');
	const rerun = runBuilder(script, ['--reruns', '1']);
	assert.equal(rerun.status, 0, `${rerun.stdout}${rerun.stderr}`);
	assert.equal(rerun.stdout.trim(), 'builder: odd-big-2 (step-up: red rerun)');
});

// ---------------------------------------------------------------------------------------------------------------
// 3. the batch plan template
// ---------------------------------------------------------------------------------------------------------------

// why: guards rule:agent-role-table (a batch plan with no Risk or Tester column leaves tester-model.mjs nothing to read)
test('the batch plan template Units table has Risk and Tester columns', () => {
	const head = fs.readFileSync(BATCH_TEMPLATE, 'utf8').split('\n').find((l) => /^\| Id \| Title \|/.test(l));
	assert.ok(head, 'no Units table header in batch-plan.md');
	const cells = head.split('|').map((c) => c.trim());
	assert.ok(cells.includes('Risk'), `no Risk column in: ${head}`);
	assert.ok(cells.includes('Tester'), `no Tester column in: ${head}`);
});
