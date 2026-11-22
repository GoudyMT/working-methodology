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

// Writes the findings file (objects become JSON lines, strings are written as they are). files is an object written to
// files.json, or a path string passed to --files as it is.
const run = (lines, files) => {
	const dir = kitTemp.makeTemp('lanes-');
	const f = path.join(dir, 'findings.jsonl');
	fs.writeFileSync(f, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
	const args = [LANES, f];
	if (typeof files === 'string') args.push('--files', files);
	else if (files !== undefined) {
		const j = path.join(dir, 'files.json');
		fs.writeFileSync(j, JSON.stringify(files));
		args.push('--files', j);
	}
	return spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8' });
};
const lanesOf = (r) => r.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l));

// The part of a SKILL.md from the line startRe matches up to the next line endRe matches.
const section = (file, startRe, endRe) => {
	const text = fs.readFileSync(file, 'utf8');
	const start = text.search(startRe);
	assert.ok(start >= 0, `no section starts at ${startRe} in ${file}`);
	const rest = text.slice(start + 1);
	const end = rest.search(endRe);
	return end < 0 ? rest : rest.slice(0, end);
};

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

// why: catches a no-file finding with an empty or dash where value merged into one lane, so their fixes collide
test('a finding whose where is empty or a dash has no file: its own lane, marked nofile with an empty files list', () => {
	const r = run([finding('F1', ''), finding('F2', '-'), finding('F3', 'a.js')]);
	assert.equal(r.status, 0, r.stderr);
	const lanes = lanesOf(r);
	assert.equal(lanes.length, 3, r.stdout);
	assert.deepEqual(lanes[0].findings, ['F1']);
	assert.deepEqual(lanes[0].files, []);
	assert.equal(lanes[0].nofile, true);
	assert.deepEqual(lanes[1].findings, ['F2']);
	assert.deepEqual(lanes[1].files, []);
	assert.equal(lanes[1].nofile, true);
	assert.deepEqual(lanes[2].findings, ['F3']);
	assert.equal('nofile' in lanes[2], false, 'a file lane carries a nofile key');
});

// why: catches a no-file finding that files.json gives a file staying alone, so its fix ignores the shared file
test('a no-file finding that files.json gives a file joins that file lane, with no nofile key', () => {
	const r = run([finding('F1', ''), finding('F2', 'a.js')], { F1: ['a.js'] });
	assert.equal(r.status, 0, r.stderr);
	const lanes = lanesOf(r);
	assert.equal(lanes.length, 1, r.stdout);
	assert.deepEqual(lanes[0].findings, ['F1', 'F2']);
	assert.deepEqual(lanes[0].files, ['a.js']);
	assert.equal('nofile' in lanes[0], false, 'a file lane carries a nofile key');
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

// why: catches a shared-file lane ranked by its lowest finding instead of its highest severity
test('a lane ranks by its highest severity when a shared file joins a low and a critical finding', () => {
	const r = run([finding('F1', 'a.js', 'low'), finding('F2', 'b.js', 'medium'), finding('F3', 'a.js', 'critical')]);
	assert.equal(r.status, 0, r.stderr);
	assert.deepEqual(lanesOf(r).map((l) => l.findings), [['F1', 'F3'], ['F2']]);
});

// why: catches equal-severity lanes ordered by finding id text instead of input position (F5 must precede F3)
test('lanes of equal severity keep the input order of their first finding', () => {
	const r = run([finding('F5', 'x.js', 'medium'), finding('F3', 'y.js', 'medium')]);
	assert.equal(r.status, 0, r.stderr);
	assert.deepEqual(lanesOf(r).map((l) => l.findings), [['F5'], ['F3']]);
});

// why: catches a lane of equal-severity findings sharing a file split by the lane's first finding instead of the file
test('equal-severity findings sharing a file stay in one lane, and lane names follow input order', () => {
	const r = run([finding('F1', 'x.js', 'medium'), finding('F2', 'y.js', 'medium'), finding('F3', 'x.js', 'medium')]);
	assert.equal(r.status, 0, r.stderr);
	const lanes = lanesOf(r);
	assert.deepEqual(lanes.map((l) => l.findings), [['F1', 'F3'], ['F2']]);
	assert.deepEqual(lanes.map((l) => l.lane), ['L1', 'L2']);
});

// why: catches findings inside a lane reordered by id, which breaks the input order the lead reviews in
test('findings inside a lane keep input order', () => {
	const r = run([finding('F3', 'a.js:1'), finding('F1', 'a.js:2')]);
	assert.equal(r.status, 0, r.stderr);
	assert.deepEqual(lanesOf(r)[0].findings, ['F3', 'F1']);
});

// why: catches backslash, ./ and case spellings of one file counted as separate files, so shared files split apart
test('path spellings are folded: backslashes, a leading ./ and case name one file, and lane files carry no ./, backslash or capitals', () => {
	const r = run([finding('F1', 'src\\A.js:3'), finding('F2', './src/a.js'), finding('F3', 'SRC/a.js:1')]);
	assert.equal(r.status, 0, r.stderr);
	const lanes = lanesOf(r);
	assert.equal(lanes.length, 1, r.stdout);
	assert.deepEqual(lanes[0].findings, ['F1', 'F2', 'F3']);
	assert.deepEqual(lanes[0].files, ['src/a.js']);
	for (const lane of lanes) for (const f of lane.files) assert.doesNotMatch(f, /\.\/|\\|[A-Z]/, `unfolded path ${f}`);
});

// why: catches a fixed or dropped finding still getting a lane and a fix it no longer needs
test('findings with status fixed or dropped get no lane, and do not join an open finding', () => {
	const r = run([finding('F1', 'a.js', 'high', 'fixed'), finding('F2', 'a.js', 'high', 'dropped'), finding('F3', 'a.js')]);
	assert.equal(r.status, 0, r.stderr);
	const lanes = lanesOf(r);
	assert.equal(lanes.length, 1, r.stdout);
	assert.deepEqual(lanes[0].findings, ['F3']);
});

// why: catches a fully fixed hand-back printing a lane for a sweep with nothing left to fix
test('an input where every finding is fixed or dropped exits 0 with empty output', () => {
	const r = run([finding('F1', 'a.js', 'high', 'fixed'), finding('F2', 'b.js', 'low', 'dropped')]);
	assert.equal(r.status, 0, r.stderr);
	assert.equal(r.stdout.trim(), '');
});

// why: catches a finding with no status key dropped from the lanes, so a real open finding gets no fix
test('a finding with no status key counts as open and is grouped', () => {
	const r = run([{ id: 'F1', severity: 'high', where: 'a.js', claim: 'c', proof: 'p', fix: 'f' }, finding('F2', 'a.js')]);
	assert.equal(r.status, 0, r.stderr);
	const lanes = lanesOf(r);
	assert.equal(lanes.length, 1, r.stdout);
	assert.deepEqual(lanes[0].findings, ['F1', 'F2']);
});

// why: catches an unknown files.json id (F99 matches no finding) failing the run instead of being ignored
test('a files.json id that matches no finding is ignored', () => {
	const r = run([finding('F1', 'a.js')], { F99: ['b.js'] });
	assert.equal(r.status, 0, r.stderr);
	const lanes = lanesOf(r);
	assert.equal(lanes.length, 1, r.stdout);
	assert.deepEqual(lanes[0].findings, ['F1']);
	assert.deepEqual(lanes[0].files, ['a.js']);
});

// why: catches an unreadable --files path exiting 0, which would plan lanes without the scanner's file list
test('an unreadable --files file exits 2 with empty output', () => {
	const r = run([finding('F1', 'a.js')], path.join(kitTemp.makeTemp('lanes-'), 'no-such-files.json'));
	assert.equal(r.status, 2, r.stdout + r.stderr);
	assert.equal(r.stdout.trim(), '');
});

// why: catches prose, RECORD:, role, note or notChecked lines in a whole hand-back counted as findings or failing the run
test('a whole hand-back is read: prose, RECORD, role, note and notChecked lines are skipped, and only the two findings are lanes', () => {
	const r = run([
		'Sweep of the branch, written after the reasoning.',
		finding('F1', 'a.js'),
		'RECORD:',
		{ role: 'builder', commit: 'abc1234' },
		{ note: 'two findings', writer: 'builder' },
		{ notChecked: 'the docs folder' },
		finding('F2', 'b.js'),
	]);
	assert.equal(r.status, 0, r.stdout + r.stderr);
	const lanes = lanesOf(r);
	assert.deepEqual(lanes.map((l) => l.findings), [['F1'], ['F2']]);
});

// why: catches a finding line with no where key passing silently, so a fix is planned without its file
test('a finding line missing the where key exits 2, prints nothing, and names where', () => {
	const r = run([{ id: 'F1', severity: 'high', status: 'open', claim: 'c', proof: 'p', fix: 'f' }]);
	assert.equal(r.status, 2, r.stdout + r.stderr);
	assert.equal(r.stdout.trim(), '');
	assert.match(r.stderr, /\bwhere\b/);
});

// why: catches a finding line with no id passing silently, so the lane cannot name it
test('a finding line missing id exits 2, prints nothing, and names id', () => {
	const r = run([{ severity: 'high', status: 'open', where: 'a.js', claim: 'c', proof: 'p', fix: 'f' }]);
	assert.equal(r.status, 2, r.stdout + r.stderr);
	assert.equal(r.stdout.trim(), '');
	assert.match(r.stderr, /\bid\b/);
});

// why: catches an unreadable findings file exiting 0 with empty output, which looks like a clean sweep
test('an unreadable findings file exits 2 with empty output', () => {
	const dir = kitTemp.makeTemp('lanes-');
	const r = spawnSync(process.execPath, [LANES, path.join(dir, 'missing.jsonl')], { cwd: dir, encoding: 'utf8' });
	assert.equal(r.status, 2, r.stdout + r.stderr);
	assert.equal(r.stdout.trim(), '');
});

// why: catches an unknown severity sorted as low instead of stopping the run, which hides a critical finding
test('an unknown severity exits 2, prints nothing, and names the finding id and severity', () => {
	const r = run([finding('F1', 'a.js', 'urgent')]);
	assert.equal(r.status, 2, r.stdout + r.stderr);
	assert.equal(r.stdout.trim(), '');
	assert.match(r.stdout + r.stderr, /F1/);
	assert.match(r.stdout + r.stderr, /severity/);
});

// why: catches a finding with no severity sorted as low instead of stopping the run
test('a missing severity exits 2, prints nothing, and names the finding id and severity', () => {
	const r = run([{ id: 'F9', status: 'open', where: 'a.js', claim: 'c', proof: 'p', fix: 'f' }]);
	assert.equal(r.status, 2, r.stdout + r.stderr);
	assert.equal(r.stdout.trim(), '');
	assert.match(r.stdout + r.stderr, /F9/);
	assert.match(r.stdout + r.stderr, /severity/);
});

// why: guards rule:finding-pipeline (a fix merges on green tests and CI, with no second review round)
test('pre-pr-sweep step 5 names lanes.mjs and says a fix merges once tests pass and CI is green, with no re-review', () => {
	const step5 = section(PRE_PR_SWEEP, /^5\. \*\*Fix/m, /^6\. /m);
	assert.match(step5, /lanes\.mjs/, 'step 5 does not name lanes.mjs');
	assert.match(step5, /tests pass[^.]*CI is green[^.]*no re-review/s, 'the merge rule is not stated in step 5');
});

// why: guards rule:finding-pipeline (batch lanes follow the same merge rule as the sweep)
test('agent-team-build batch flow names lanes.mjs and says a fix merges once tests pass and CI is green, with no re-review', () => {
	const flow = section(AGENT_TEAM_BUILD, /^## The flow/m, /^## /m);
	assert.match(flow, /lanes\.mjs/, 'batch flow does not name lanes.mjs');
	assert.match(flow, /tests pass[^.]*CI is green[^.]*no re-review/s, 'the merge rule is not stated in the batch flow');
});
