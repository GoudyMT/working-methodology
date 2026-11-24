// K372 (patch 1.51.4, U2): the plan's row list is locked when the build starts. plan-check --lock-rows writes the sha of the
// Rows line beside the unit locks; a later change to that line is a fault that flow-check's start prints too. The fold F1
// (a brief names its lane from the Lanes table, never a placeholder) is asserted in the plan-without-rows-lock test.
// Every test runs plan-check and flow-check as child processes in temp folders.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const CHECK = fileURLToPath(new URL('../user/kit-tools/plan-check.mjs', import.meta.url));
const FLOW = fileURLToPath(new URL('../user/kit-tools/flow-check.mjs', import.meta.url));

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const out = (r) => `${r.stdout}${r.stderr}`;
const GIT_ID = { GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.invalid' };
// Config folders point at a temp home, so no real kit state is read or written.
function env() {
	const home = kitTemp.makeTemp('row-lock-home-');
	const config = path.join(home, '.claude');
	return { ...process.env, ...GIT_ID, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: config, KIT_CLAUDE_HOME: config };
}

const ROWS = '- **Rows (2 placed, cap 15):** K901, K902';
const ROW_U1 = '| U1 | K372: the row lock | `src/a.mjs` | the rows lock writes the sha of the plan rows line -> S1 | x | low | logic | | parallel | builder |';
const ROW_U2 = '| U2 | K372: the second unit | `src/b.mjs` | the second unit names a test here -> S1 | x | low | logic | | parallel | builder |';
// A unit row with no Files cell: plan-check faults on it, so the plan cannot be locked.
const ROW_BAD = '| U3 | K372: the bad row | | the bad row names a test here -> S1 | x | low | logic | | parallel | builder |';
const UNITS_HEAD = [
	'## Units', '',
	'| Id | Title | Files (exact; mark new files) | Tests to write first, and the failure each must show | Done when | Risk | Category | Tester | Runs | Built by |',
	'|---|---|---|---|---|---|---|---|---|---|',
];
// A plan text: its Rows line, an optional Lanes table (each entry is the cells after the Lane cell's pipe), then the Units.
const planText = ({ rows = ROWS, lanes = null, rowLines = [ROW_U1] } = {}) => [
	'# Batch plan - x', '', rows, '',
	...(lanes ? ['## Lanes', '', '| Lane | Units, in order |', '|---|---|', ...lanes.map((l) => `| ${l} |`), ''] : []),
	...UNITS_HEAD, ...rowLines, '', '## Collision list', '',
].join('\n');
// A temp folder holding the plan file (and its locks file, when given). Returns the plan's path.
function planFile(text, locks = null) {
	const dir = kitTemp.makeTemp('row-lock-');
	const plan = path.join(dir, 'plan.md');
	fs.writeFileSync(plan, text);
	if (locks !== null) fs.writeFileSync(`${plan}.locks.json`, `${JSON.stringify(locks, null, 2)}\n`);
	return plan;
}
const check = (args) => spawnSync(process.execPath, [CHECK, ...args], { cwd: path.dirname(args[0]), env: env(), encoding: 'utf8' });
const CHANGED = /the Rows line changed after the build started/;

// why: catches plan-check --lock-rows writes the sha of the plan's Rows line to the locks file under "rows" (K372 S1)
test(`plan-check --lock-rows writes the sha of the plan's Rows line to the locks file under "rows"`, () => {
	const plan = planFile(planText());
	const res = check([plan, '--lock-rows']);
	assert.equal(res.status, 0, out(res));
	const locks = JSON.parse(fs.readFileSync(`${plan}.locks.json`, 'utf8'));
	assert.equal(locks.rows, sha(ROWS), 'the rows key holds the sha256 of the Rows line text');
	// A plan with a fault never gets a lock, so a bad plan cannot be locked in with its Rows line.
	const faulty = planFile(planText({ rowLines: [ROW_BAD] }));
	const refused = check([faulty, '--lock-rows']);
	assert.notEqual(refused.status, 0, out(refused));
	assert.equal(fs.existsSync(`${faulty}.locks.json`), false, 'no locks file is written for a plan with a fault');
	// A CRLF copy of the plan locks the same sha: the Rows line is hashed without its line ending.
	const crlf = planFile(planText().replace(/\n/g, '\r\n'));
	const crlfLocked = check([crlf, '--lock-rows']);
	assert.equal(crlfLocked.status, 0, out(crlfLocked));
	assert.equal(JSON.parse(fs.readFileSync(`${crlf}.locks.json`, 'utf8')).rows, sha(ROWS), 'the CRLF plan locks the same sha');
	const crlfCheck = check([crlf]);
	assert.equal(crlfCheck.status, 0, out(crlfCheck));
	assert.doesNotMatch(out(crlfCheck), /fault:/);
});

// why: catches a row added after --lock-rows is a fault that names the row and the closeout.mjs defer command (K372 S2)
test('a row added after --lock-rows is a fault that names the row and the closeout.mjs defer command', () => {
	const plan = planFile(planText({ rows: '- **Rows (3 placed, cap 15):** K901, K902, K903' }), { rows: sha(ROWS) });
	const res = check([plan]);
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), CHANGED);
	assert.match(out(res), /closeout\.mjs defer "[^"]*K903/);
});

// why: catches a rows fault that leaves the build stuck, with no locked text to restore (S11F2)
test('a rows fault prints the locked Rows line and the check passes once that line is restored', () => {
	const plan = planFile(planText());
	const locked = check([plan, '--lock-rows']);
	assert.equal(locked.status, 0, out(locked));
	const added = '- **Rows (3 placed, cap 15):** K901, K902, K903';
	fs.writeFileSync(plan, planText({ rows: added }));
	const res = check([plan]);
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), CHANGED);
	assert.ok(out(res).includes(ROWS), `the fault prints the locked Rows line text:\n${out(res)}`);
	assert.match(out(res), /restore/i, 'the fault says to restore the locked line after deferring the new row');
	// Restoring the plan's Rows line is the whole way out: no hand edit of the locks file.
	fs.writeFileSync(plan, planText());
	const again = check([plan]);
	assert.equal(again.status, 0, out(again));
	assert.doesNotMatch(out(again), /fault:/);
});

// why: catches a row taken out or reworded after the lock is a fault too (K372 S2)
test('a row taken out or reworded after the lock is a fault too', () => {
	for (const rows of ['- **Rows (1 placed, cap 15):** K901', '- **Rows (2 placed, cap 15):** K901, K902 (reworded)']) {
		const plan = planFile(planText({ rows }), { rows: sha(ROWS) });
		const res = check([plan]);
		assert.equal(res.status, 1, out(res));
		assert.match(out(res), CHANGED);
	}
});

// why: catches a plan with no rows lock checks as before (K372 S3)
test('a plan with no rows lock checks as before', () => {
	// Control part: a locks file with only unit locks and no rows key checks clean.
	const plan = planFile(planText(), { U1: sha(ROW_U1) });
	const clean = check([plan]);
	assert.equal(clean.status, 0, out(clean));
	assert.doesNotMatch(out(clean), /fault:/);
	// The lock command adds the rows key beside the unit locks and drops none of them.
	const locked = check([plan, '--lock-rows']);
	assert.equal(locked.status, 0, out(locked));
	assert.deepEqual(JSON.parse(fs.readFileSync(`${plan}.locks.json`, 'utf8')), { U1: sha(ROW_U1), rows: sha(ROWS) });

	// F1 (fold, 1.51.4 triage): a brief takes its lane from the Lanes table, never the placeholder "<lane id>"; a unit no
	// Lanes row names is a brief fault that names the unit.
	// Ruling: the lane id is the first word of the Lanes row's Lane cell ("B row lock" gives B); the Units cell lists the
	// units the lane runs, and "U1, then U2" names both.
	const lanes = planFile(planText({ lanes: ['B (row lock) | U1'], rowLines: [ROW_U1, ROW_U2] }));
	const named = check([lanes, '--brief', 'U1', '--role', 'tester']);
	assert.equal(named.status, 0, out(named));
	assert.match(named.stdout, /^Lane: B$/m);
	assert.doesNotMatch(named.stdout, /<lane id>/);
	const unnamed = check([lanes, '--brief', 'U2', '--role', 'tester']);
	assert.equal(unnamed.status, 1, out(unnamed));
	assert.match(unnamed.stderr, /U2/);
	const then = planFile(planText({ lanes: ['B (row lock) | U1, then U2'], rowLines: [ROW_U1, ROW_U2] }));
	const second = check([then, '--brief', 'U2', '--role', 'tester']);
	assert.equal(second.status, 0, out(second));
	assert.match(second.stdout, /^Lane: B$/m);
	const noLanes = planFile(planText({ rowLines: [ROW_U1, ROW_U2] }));
	const bare = check([noLanes, '--brief', 'U1', '--role', 'tester']);
	assert.equal(bare.status, 1, out(bare));
	assert.match(bare.stderr, /U1/);
});

// why: catches flow-check's start prints the rows fault, since it reads the lock faults (K372 S4)
test("flow-check's start prints the rows fault, since it reads the lock faults", () => {
	const plan = planFile(planText({ rows: '- **Rows (1 placed, cap 15):** K901' }), { rows: sha(ROWS) });
	const res = spawnSync(process.execPath, [FLOW, 'start', plan, '--role', 'builder'], { cwd: path.dirname(plan), env: env(), encoding: 'utf8' });
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), CHANGED);
});
