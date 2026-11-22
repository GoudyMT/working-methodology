// U22 (T-B4): a guard unit's Tests cell carries three fixed rows. One test per spec line G1-G4, G6 and G7 (the spec has no G5 line); controls are assertions inside.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const CHECK = fileURLToPath(new URL('../user/kit-tools/plan-check.mjs', import.meta.url));
const BRIEF = fileURLToPath(new URL('../user/skills/agent-team-build/templates/batch-plan.md', import.meta.url));
const TESTER = fileURLToPath(new URL('../user/agents/tester.md', import.meta.url));
const GUARD_ROWS = fileURLToPath(new URL('../user/kit-tools/guard-rows.mjs', import.meta.url));

const TESTS = 'Tests to write first, and the failure each must show';
const HEAD = ['Id', 'Files', 'Runs', 'Risk', 'Category', TESTS, 'Tester'];
const out = (res) => res.stdout + res.stderr;

// The three fixed rows of a guard unit, each a Tests line that starts with its tag and ends in a spec id.
const BYPASS = 'bypass: runs the guard through a wrapper and another shell -> S1';
const REPEAT = 'repeat: runs the guard twice and gets the same verdict -> S1';
const FAIL_CLOSED = 'fail-closed: a broken guard blocks the call and is logged -> S1';
const WIRING = 'wiring: the guard is registered where it must run -> S1';

// A Units table of the given rows; each row is an object keyed by the header names.
const planText = (rows) => ['# Batch plan - x', '', '## Units', '', `| ${HEAD.join(' | ')} |`, `|${HEAD.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${HEAD.map((h) => r[h] ?? '').join(' | ')} |`), '', '## Collision list', ''].join('\n');
// A guard unit U1 whose Tests cell is the given lines, joined by <br>.
const guardRow = (testLines) => ({ Id: 'U1', Files: '`user/kit-tools/approve.mjs`', Runs: 'alone', Risk: 'high', Category: 'guard', [TESTS]: testLines.join('<br>'), Tester: '' });
// A plain logic unit with one test line and no guard rows.
const logicRow = (id) => ({ Id: id, Files: '`src/a.mjs`', Runs: 'alone', Risk: 'low', Category: 'logic', [TESTS]: 'checks it -> S1', Tester: '' });
// Runs plan-check on a plan text in a temp folder. A missing script fails here, with its name.
const runCheck = (text) => {
	assert.ok(fs.existsSync(CHECK), 'user/kit-tools/plan-check.mjs is missing');
	const dir = kitTemp.makeTemp('guard-rows-');
	const file = path.join(dir, 'plan.md');
	fs.writeFileSync(file, text);
	return spawnSync(process.execPath, [CHECK, file], { cwd: dir, encoding: 'utf8' });
};

// why: catches a guard unit with no bypass row passing, so a guard a wrapper or another shell gets past is never tested; or a complete guard unit beside a plain logic unit wrongly refused (G1).
test('G1 spec G1: a guard unit with no bypass: row is refused naming that unit, and a complete guard unit beside a plain logic unit passes', () => {
	const noBypass = runCheck(planText([guardRow([REPEAT, FAIL_CLOSED])]));
	assert.equal(noBypass.status, 1, out(noBypass));
	assert.match(out(noBypass), /bypass/);
	assert.match(out(noBypass), /U1/);
	// Control: a bypass line that does not start with the tag is no bypass row, so it is refused too.
	const misplaced = runCheck(planText([guardRow(['check bypass: runs it -> S1', REPEAT, FAIL_CLOSED])]));
	assert.equal(misplaced.status, 1, out(misplaced));
	// Control: a guard raised on a logic file with no rows at all is refused.
	const raised = runCheck(planText([{ Id: 'U1', Files: '`src/a.mjs`', Runs: 'alone', Risk: 'low', Category: 'guard', [TESTS]: 'checks it -> S1', Tester: '' }]));
	assert.equal(raised.status, 1, out(raised));
	// Control: a complete guard unit U1 beside a plain logic unit U2 passes.
	const pair = runCheck(planText([guardRow([BYPASS, REPEAT, FAIL_CLOSED]), logicRow('U2')]));
	assert.equal(pair.status, 0, out(pair));
	// Two guard units in one plan: each is checked on its own rows, so a second guard unit with no bypass: row is refused by its name.
	const guardTwo = { ...guardRow([REPEAT, FAIL_CLOSED]), Id: 'U3', Files: '`user/kit-hooks/call-cap.cjs`' };
	const twoGuards = runCheck(planText([guardRow([BYPASS, REPEAT, FAIL_CLOSED]), guardTwo]));
	assert.equal(twoGuards.status, 1, out(twoGuards));
	assert.match(out(twoGuards), /unit U3 is a guard unit with no bypass: row/);
	assert.doesNotMatch(out(twoGuards), /unit U1 is a guard unit/);
});

// why: catches a guard unit with no repeat row passing, so a guard whose verdict flips on a second run is never caught; or a complete guard unit wrongly refused (G2).
test('G2 spec G2: a guard unit with no repeat: row is refused naming repeat, and a complete guard unit passes', () => {
	const noRepeat = runCheck(planText([guardRow([BYPASS, FAIL_CLOSED])]));
	assert.equal(noRepeat.status, 1, out(noRepeat));
	assert.match(out(noRepeat), /repeat/);
	// Control: a repeat tag that is not at the line start is no repeat row, so it is refused too.
	const misplaced = runCheck(planText([guardRow([BYPASS, 'check repeat: runs it twice -> S1', FAIL_CLOSED])]));
	assert.equal(misplaced.status, 1, out(misplaced));
	// Control: with its repeat: row the same unit is a complete guard unit and passes.
	const withRepeat = runCheck(planText([guardRow([BYPASS, REPEAT, FAIL_CLOSED])]));
	assert.equal(withRepeat.status, 0, out(withRepeat));
});

// why: catches a guard unit with no fail row, or one whose outcome is not logged, passing, so a guard that fails silently ships; or a complete guard unit wrongly refused (G3).
test('G3 spec G3: a guard unit with no fail-closed or fail-open row is refused, a fail row without "logged" is refused, and a complete guard unit with a logged fail-open row passes', () => {
	const noFail = runCheck(planText([guardRow([BYPASS, REPEAT])]));
	assert.equal(noFail.status, 1, out(noFail));
	assert.match(out(noFail), /fail-(closed|open)/);
	// Control: a fail-closed tag that is not at the line start is no fail row, so it is refused too.
	const misplaced = runCheck(planText([guardRow([BYPASS, REPEAT, 'check fail-closed: a broken guard blocks the call, logged -> S1'])]));
	assert.equal(misplaced.status, 1, out(misplaced));
	// Control: a fail-closed row that does not say logged is refused.
	const notLogged = runCheck(planText([guardRow([BYPASS, REPEAT, 'fail-closed: a broken guard blocks the call -> S1'])]));
	assert.equal(notLogged.status, 1, out(notLogged));
	// Control: "logged" on the repeat line only, not on the fail line, is still refused.
	const loggedElsewhere = runCheck(planText([guardRow([BYPASS, 'repeat: runs it twice, logged -> S1', 'fail-closed: a broken guard blocks the call -> S1'])]));
	assert.equal(loggedElsewhere.status, 1, out(loggedElsewhere));
	// Control: a fail-open row that does not say logged is refused, even with valid bypass and repeat rows.
	const openNotLogged = runCheck(planText([guardRow([BYPASS, REPEAT, 'fail-open: lets through, not logged -> S1'])]));
	assert.equal(openNotLogged.status, 1, out(openNotLogged));
	// Control: a complete guard unit whose fail-open row says logged passes.
	const open = runCheck(planText([guardRow([BYPASS, REPEAT, 'fail-open: a broken guard lets the call through, logged -> S1'])]));
	assert.equal(open.status, 0, out(open));
});

// why: catches a wiring: row refused as a guard proof, so a guard registered in the wrong place passes its plan unseen (G4).
test('G4 spec G4: a wiring: row is accepted alongside the three rows, and wiring: never stands in for bypass:, repeat: or the fail row', () => {
	const withWiring = runCheck(planText([guardRow([BYPASS, REPEAT, FAIL_CLOSED, WIRING])]));
	assert.equal(withWiring.status, 0, out(withWiring));
	// Control: wiring: never satisfies bypass:, so a unit with wiring in its place is refused for lacking bypass.
	const inPlace = runCheck(planText([guardRow([WIRING, REPEAT, FAIL_CLOSED])]));
	assert.equal(inPlace.status, 1, out(inPlace));
	assert.match(out(inPlace), /bypass/);
	// Control: wiring: in place of repeat: is refused for lacking repeat.
	const repeatSwap = runCheck(planText([guardRow([BYPASS, WIRING, FAIL_CLOSED])]));
	assert.equal(repeatSwap.status, 1, out(repeatSwap));
	assert.match(out(repeatSwap), /repeat/);
});

// why: guards rule:agent-team-adapter (the batch-plan.md guard example is a Tests cell plan-check accepts as a complete guard unit)
test('G6 spec G6: the batch-plan.md guard example, read as a Tests cell, passes plan-check, and drops refused without its bypass row', () => {
	assert.ok(fs.existsSync(BRIEF), 'batch-plan.md is missing');
	const text = fs.readFileSync(BRIEF, 'utf8');
	const example = /Example Tests cell: `([^`]+)`/.exec(text);
	assert.ok(example, 'batch-plan.md holds an example guard Tests cell');
	// The cell spans two lines in the template; its <br> separators split the three rows, and <S1> is the spec id.
	const lines = example[1].replace(/\s+/g, ' ').replace(/^\|\s*/, '').replace(/\s*\|$/, '').split('<br>').map((l) => l.trim().replace(/<(S\d+)>/g, '$1'));
	assert.equal(lines.length, 3, `three rows: ${lines.join(' | ')}`);
	const whole = runCheck(planText([guardRow(lines)]));
	assert.equal(whole.status, 0, out(whole));
	// Control: the same example without its bypass: row is refused for lacking one, so the example is not passing by accident.
	const noBypass = runCheck(planText([guardRow(lines.filter((l) => !l.startsWith('bypass:')))]));
	assert.equal(noBypass.status, 1, out(noBypass));
	assert.match(out(noBypass), /bypass: row/);
});

// why: guards rule:agent-role-table (the tags tester.md names for a guard unit are the rows guard-rows.mjs accepts)
test('G7 spec G7: the tags tester.md names for a guard unit are the rows guardRowFaults accepts, and dropping bypass: is a fault', async () => {
	assert.ok(fs.existsSync(TESTER), 'user/agents/tester.md is missing');
	assert.ok(fs.existsSync(GUARD_ROWS), 'user/kit-tools/guard-rows.mjs is missing');
	const text = fs.readFileSync(TESTER, 'utf8');
	const para = text.split('\n').find((l) => /^Guard units\./.test(l));
	assert.ok(para, 'tester.md has a Guard units paragraph');
	const tags = [...para.matchAll(/`([a-z-]+):`/g)].map((m) => `${m[1]}:`);
	for (const tag of ['bypass:', 'repeat:', 'fail-closed:', 'fail-open:']) assert.ok(tags.includes(tag), `tester.md names ${tag}`);
	const { guardRowFaults } = await import(pathToFileURL(GUARD_ROWS).href);
	const rows = ['bypass: runs it through a wrapper -> S1', 'repeat: runs it twice -> S1', 'fail-closed: blocks the call and is logged -> S1'];
	assert.deepEqual(guardRowFaults('U1', rows), [], 'the three named rows are accepted');
	const faults = guardRowFaults('U1', rows.filter((r) => !r.startsWith('bypass:')));
	assert.ok(faults.some((f) => /bypass:/.test(f)), `dropping bypass: is a fault: ${faults.join('; ')}`);
});
