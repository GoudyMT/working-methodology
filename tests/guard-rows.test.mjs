// U22 (T-B4): a guard unit's Tests cell carries three fixed rows. One test per spec line G1-G7; controls are assertions inside.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const CHECK = fileURLToPath(new URL('../user/kit-tools/plan-check.mjs', import.meta.url));
const BRIEF = fileURLToPath(new URL('../user/skills/agent-team-build/templates/batch-plan.md', import.meta.url));
const TESTER = fileURLToPath(new URL('../user/agents/tester.md', import.meta.url));

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
// Runs plan-check on a plan text in a temp folder. A missing script fails here, with its name.
const runCheck = (text) => {
	assert.ok(fs.existsSync(CHECK), 'user/kit-tools/plan-check.mjs is missing');
	const dir = kitTemp.makeTemp('guard-rows-');
	const file = path.join(dir, 'plan.md');
	fs.writeFileSync(file, text);
	return spawnSync(process.execPath, [CHECK, file], { cwd: dir, encoding: 'utf8' });
};

// why: G1, G5: a guard unit with no bypass: row passing, so a guard that a wrapper or another shell gets past is never tested for it; a guard unit with all three rows or a plain logic unit wrongly refused.
test('G1 spec G1: a guard unit with no bypass: row is refused naming bypass, and a complete guard unit and a non-guard unit with none of the rows both pass', () => {
	const noBypass = runCheck(planText([guardRow([REPEAT, FAIL_CLOSED])]));
	assert.equal(noBypass.status, 1, out(noBypass));
	assert.match(out(noBypass), /bypass/);
	// Control: a bypass line that does not start with the tag is no bypass row, so it is refused too.
	const misplaced = runCheck(planText([guardRow(['check bypass: runs it -> S1', REPEAT, FAIL_CLOSED])]));
	assert.equal(misplaced.status, 1, out(misplaced));
	// Control: a complete guard unit with its bypass: row passes.
	const complete = runCheck(planText([guardRow([BYPASS, REPEAT, FAIL_CLOSED])]));
	assert.equal(complete.status, 0, out(complete));
	// Control: a non-guard unit with one plain test line and none of the guard rows passes.
	const logic = runCheck(planText([{ Id: 'U1', Files: '`src/a.mjs`', Runs: 'alone', Risk: 'low', Category: 'logic', [TESTS]: 'checks it -> S1', Tester: '' }]));
	assert.equal(logic.status, 0, out(logic));
});

// why: G2, G5: a guard unit with no repeat: row passing, so a guard whose verdict flips on a second run is never caught; a complete guard unit wrongly refused.
test('G2 spec G2: a guard unit with no repeat: row is refused naming repeat, and a complete guard unit passes', () => {
	const noRepeat = runCheck(planText([guardRow([BYPASS, FAIL_CLOSED])]));
	assert.equal(noRepeat.status, 1, out(noRepeat));
	assert.match(out(noRepeat), /repeat/);
	// Control: with its repeat: row the same unit is a complete guard unit and passes.
	const withRepeat = runCheck(planText([guardRow([BYPASS, REPEAT, FAIL_CLOSED])]));
	assert.equal(withRepeat.status, 0, out(withRepeat));
});

// why: G3, G5: a guard unit with no fail row, or one whose outcome is not logged, passing, so a guard that fails silently ships; a complete guard unit wrongly refused.
test('G3 spec G3: a guard unit with no fail-closed or fail-open row is refused, a fail row without "logged" is refused, and a complete guard unit with a logged fail-open row passes', () => {
	const noFail = runCheck(planText([guardRow([BYPASS, REPEAT])]));
	assert.equal(noFail.status, 1, out(noFail));
	assert.match(out(noFail), /fail/);
	// Control: a fail-closed row that does not say logged is refused.
	const notLogged = runCheck(planText([guardRow([BYPASS, REPEAT, 'fail-closed: a broken guard blocks the call -> S1'])]));
	assert.equal(notLogged.status, 1, out(notLogged));
	// Control: a complete guard unit whose fail-open row says logged passes.
	const open = runCheck(planText([guardRow([BYPASS, REPEAT, 'fail-open: a broken guard lets the call through, logged -> S1'])]));
	assert.equal(open.status, 0, out(open));
});

// why: G4: a wiring: row refused as a guard proof, so a guard registered in the wrong place passes its plan unseen.
test('G4 spec G4: a wiring: row is accepted alongside the three rows, and a guard unit that puts wiring: in place of bypass: is refused', () => {
	const withWiring = runCheck(planText([guardRow([BYPASS, REPEAT, FAIL_CLOSED, WIRING])]));
	assert.equal(withWiring.status, 0, out(withWiring));
	// Control: wiring: never satisfies bypass:, so a unit with wiring in its place is refused for lacking bypass.
	const inPlace = runCheck(planText([guardRow([WIRING, REPEAT, FAIL_CLOSED])]));
	assert.equal(inPlace.status, 1, out(inPlace));
	assert.match(out(inPlace), /bypass/);
});

// why: doc claim: batch-plan.md shows the three fixed rows in its guard example.
test('G6 spec G6: batch-plan.md shows the bypass:, repeat: and fail-closed or fail-open rows in a guard example', () => {
	assert.ok(fs.existsSync(BRIEF), 'batch-plan.md is missing');
	const text = fs.readFileSync(BRIEF, 'utf8');
	assert.match(text, /guard/i);
	assert.match(text, /^\s*bypass:/m);
	assert.match(text, /^\s*repeat:/m);
	assert.match(text, /^\s*fail-(closed|open):/m);
});

// why: doc claim: tester.md tells the tester to write the three fixed rows for a guard unit.
test('G7 spec G7: tester.md tells the tester to write the bypass:, repeat: and fail-closed or fail-open rows for a guard unit', () => {
	assert.ok(fs.existsSync(TESTER), 'user/agents/tester.md is missing');
	const text = fs.readFileSync(TESTER, 'utf8');
	assert.match(text, /guard/i);
	assert.match(text, /bypass:/);
	assert.match(text, /repeat:/);
	assert.match(text, /fail-(closed|open):/);
});
