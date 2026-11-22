// K277 (build 24, U10): sweep findings are split into lanes by the files they touch, so each lane's fix runs in its own
// worktree with no file in common. The lane count comes from file overlap, never from a fixed number.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const LANES = path.resolve('user/kit-tools/lanes.mjs');
const PRE_PR_SWEEP = path.resolve('user/skills/pre-pr-sweep/SKILL.md');
const AGENT_TEAM_BUILD = path.resolve('user/skills/agent-team-build/SKILL.md');

const finding = (id, where, severity = 'high', status = 'open') => ({ id, severity, status, where, claim: 'c', proof: 'p', fix: 'f' });

// Writes the findings file (objects become JSON lines, strings are written as they are) and runs the script on it.
const run = (lines, files) => {
	const dir = kitTemp.makeTemp('lanes-');
	const f = path.join(dir, 'findings.jsonl');
	fs.writeFileSync(f, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
	const args = [LANES, f];
	if (files) {
		const j = path.join(dir, 'files.json');
		fs.writeFileSync(j, JSON.stringify(files));
		args.push('--files', j);
	}
	return spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8' });
};
const lanesOf = (r) => r.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));

// why: catches two findings that share a file landing in different lanes
test('findings that share a file share a lane, and a finding on another file gets its own lane', () => {
	const r = run([finding('F1', 'src/a.js:3'), finding('F2', 'src/a.js:9'), finding('F3', 'src/b.js:1')]);
	assert.equal(r.status, 0, r.stderr);
	const lanes = lanesOf(r);
	assert.equal(lanes.length, 2, r.stdout);
	assert.deepEqual(lanes[0].findings, ['F1', 'F2']);
	assert.deepEqual(lanes[0].files, ['src/a.js']);
	assert.deepEqual(lanes[1].findings, ['F3']);
	assert.deepEqual(lanes[1].files, ['src/b.js']);
});

// why: catches a chain of shared files (F1 with F2 on a.js, F2 with F3 on b.js) split across lanes
test('a chain of shared files puts every finding on the chain in one lane', () => {
	const r = run([finding('F1', 'a.js'), finding('F2', 'a.js, b.js'), finding('F3', 'b.js:5'), finding('F4', 'c.js')]);
	assert.equal(r.status, 0, r.stderr);
	const lanes = lanesOf(r);
	assert.equal(lanes.length, 2, r.stdout);
	assert.deepEqual(lanes[0].findings, ['F1', 'F2', 'F3']);
	assert.deepEqual([...lanes[0].files].sort(), ['a.js', 'b.js']);
	assert.deepEqual(lanes[1].findings, ['F4']);
});

// why: catches a scanner's extra file (files.json) being ignored, so two lanes edit the same file
test('a file listed in files.json for a finding joins that finding to the lane of that file', () => {
	const r = run([finding('F1', 'x.js'), finding('F2', 'y.js')], { F2: ['x.js'] });
	assert.equal(r.status, 0, r.stderr);
	const lanes = lanesOf(r);
	assert.equal(lanes.length, 1, r.stdout);
	assert.deepEqual(lanes[0].findings, ['F1', 'F2']);
	assert.deepEqual([...lanes[0].files].sort(), ['x.js', 'y.js']);
});

// why: catches two findings with no file being merged into one lane, which lets their fixes collide
test('a finding with no file is its own lane, marked nofile with an empty files list', () => {
	const r = run([finding('F1', ''), finding('F2', ''), finding('F3', 'a.js')]);
	assert.equal(r.status, 0, r.stderr);
	const lanes = lanesOf(r);
	assert.equal(lanes.length, 3, r.stdout);
	assert.deepEqual(lanes[0].findings, ['F1']);
	assert.deepEqual(lanes[0].files, []);
	assert.equal(lanes[0].nofile, true);
	assert.deepEqual(lanes[1].findings, ['F2']);
	assert.equal(lanes[1].nofile, true);
	assert.deepEqual(lanes[2].findings, ['F3']);
});

// why: catches a file lane carrying a nofile field, so the output shape drifts from the lane contract
test('a lane with files has exactly the lane, findings and files keys', () => {
	const r = run([finding('F1', 'a.js')]);
	assert.equal(r.status, 0, r.stderr);
	assert.deepEqual(Object.keys(lanesOf(r)[0]).sort(), ['files', 'findings', 'lane']);
});

// why: catches a lane with a critical finding printed after a lane with only low findings, so the worst fix runs last
test('lanes are ordered by their highest severity, and lane names follow that order', () => {
	const r = run([
		finding('F1', 'a.js', 'low'),
		finding('F2', 'b.js', 'critical'),
		finding('F3', 'c.js', 'high'),
		finding('F4', 'd.js', 'medium'),
	]);
	assert.equal(r.status, 0, r.stderr);
	const lanes = lanesOf(r);
	assert.deepEqual(lanes.map((l) => l.findings), [['F2'], ['F3'], ['F4'], ['F1']]);
	assert.deepEqual(lanes.map((l) => l.lane), ['L1', 'L2', 'L3', 'L4']);
});

// why: catches equal-severity lanes ordered by finding id text instead of input position (F5 must precede F3)
test('lanes of equal severity keep the input order of their first finding', () => {
	const r = run([finding('F5', 'x.js', 'medium'), finding('F3', 'y.js', 'medium')]);
	assert.equal(r.status, 0, r.stderr);
	const lanes = lanesOf(r);
	assert.deepEqual(lanes.map((l) => l.findings), [['F5'], ['F3']]);
});

// why: catches findings inside a lane reordered by id, which breaks the input order the lead reviews in
test('findings inside a lane keep input order', () => {
	const r = run([finding('F3', 'a.js:1'), finding('F1', 'a.js:2')]);
	assert.equal(r.status, 0, r.stderr);
	assert.deepEqual(lanesOf(r)[0].findings, ['F3', 'F1']);
});

// why: catches backslash, ./ and case spellings of one file counted as three files, so shared files split apart
test('path spellings are folded: backslashes, a leading ./ and case name one file', () => {
	const r = run([finding('F1', 'src\\A.js:3'), finding('F2', './src/a.js')]);
	assert.equal(r.status, 0, r.stderr);
	const lanes = lanesOf(r);
	assert.equal(lanes.length, 1, r.stdout);
	assert.deepEqual(lanes[0].findings, ['F1', 'F2']);
	assert.deepEqual(lanes[0].files, ['src/a.js']);
});

// why: catches a fixed or dropped finding still getting a lane and a fix it no longer needs
test('findings with status fixed or dropped get no lane, and do not join an open finding', () => {
	const r = run([finding('F1', 'a.js', 'high', 'fixed'), finding('F2', 'a.js', 'high', 'dropped'), finding('F3', 'a.js')]);
	assert.equal(r.status, 0, r.stderr);
	const lanes = lanesOf(r);
	assert.equal(lanes.length, 1, r.stdout);
	assert.deepEqual(lanes[0].findings, ['F3']);
});

// why: catches a finding line with no where passing silently, so a fix is planned without its file
test('a finding line missing where exits 2', () => {
	const r = run([{ id: 'F1', severity: 'high', status: 'open', claim: 'c', proof: 'p', fix: 'f' }]);
	assert.equal(r.status, 2, r.stdout + r.stderr);
});

// why: catches a finding line with no id passing silently, so the lane cannot name it
test('a finding line missing id exits 2', () => {
	const r = run([{ severity: 'high', status: 'open', where: 'a.js', claim: 'c', proof: 'p', fix: 'f' }]);
	assert.equal(r.status, 2, r.stdout + r.stderr);
});

// why: catches an unreadable findings file exiting 0 with empty output, which looks like a clean sweep
test('an unreadable findings file exits 2', () => {
	const dir = kitTemp.makeTemp('lanes-');
	const r = spawnSync(process.execPath, [LANES, path.join(dir, 'missing.jsonl')], { cwd: dir, encoding: 'utf8' });
	assert.equal(r.status, 2, r.stdout + r.stderr);
});

// why: catches an unknown severity sorted as low instead of stopping the run, which hides a critical finding
test('an unknown severity exits 2 and names the finding id', () => {
	const r = run([finding('F1', 'a.js', 'urgent')]);
	assert.equal(r.status, 2, r.stdout + r.stderr);
	assert.match(r.stderr, /F1/);
});

// why: catches a finding with no severity sorted as low instead of stopping the run
test('a missing severity exits 2 and names the finding id', () => {
	const r = run([{ id: 'F9', status: 'open', where: 'a.js', claim: 'c', proof: 'p', fix: 'f' }]);
	assert.equal(r.status, 2, r.stdout + r.stderr);
	assert.match(r.stderr, /F9/);
});

// why: guards rule:finding-pipeline (a fix merges on green tests and CI, with no second review round)
test('pre-pr-sweep step 5 names lanes.mjs and says a fix merges once tests pass and CI is green, with no re-review', () => {
	const text = fs.readFileSync(PRE_PR_SWEEP, 'utf8');
	assert.match(text, /lanes\.mjs/, 'step 5 does not name lanes.mjs');
	assert.match(text, /tests pass[^.]*CI is green[^.]*no re-review/s, 'the merge rule is not stated');
});

// why: guards rule:finding-pipeline (batch lanes follow the same merge rule as the sweep)
test('agent-team-build batch mode names lanes.mjs and says a fix merges once tests pass and CI is green, with no re-review', () => {
	const text = fs.readFileSync(AGENT_TEAM_BUILD, 'utf8');
	assert.match(text, /lanes\.mjs/, 'batch mode does not name lanes.mjs');
	assert.match(text, /tests pass[^.]*CI is green[^.]*no re-review/s, 'the merge rule is not stated');
});
