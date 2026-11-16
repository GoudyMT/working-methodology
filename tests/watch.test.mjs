// E13 (T7 slice 2, build 13; the owner's lock A, 2026-11-03): a watcher for pending work. PR 17 sat green for 7
// minutes waiting for a person, and nothing watches across threads. The watcher reads pull request state on a
// schedule, tells the owner when one turns ready, and never acts: its only program is a fixed gh read.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { main, readArgs, verdict } from '../user/kit-tools/watch.mjs';

kitTemp.sessionRoot();
const REPO = 'someone/app';
const NOW = Date.parse('2026-11-16T12:00:00Z');
const HOUR = 3600 * 1000;

// A watch folder and fakes for the two things the watcher does outside itself: the read and the alert.
function rig(states = {}) {
	const dir = kitTemp.makeTemp('watch-');
	const reads = [];
	const alerts = [];
	const fail = new Set();
	const read = (repo, pr) => { reads.push(readArgs(repo, pr)); if (fail.has(pr)) throw new Error('gh: not signed in'); return states[pr]; };
	const alert = (text) => alerts.push(text);
	const lines = [];
	const run = (argv, at = NOW) => { lines.length = 0; const code = main(argv, { dir, read, alert, now: () => at, print: (s) => lines.push(s) }); return { code, out: lines.join('\n') }; };
	const log = () => (fs.existsSync(path.join(dir, 'watch.log')) ? fs.readFileSync(path.join(dir, 'watch.log'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
	return { dir, reads, alerts, fail, run, log, states };
}
const pr = (state, checks, merge = 'CLEAN') => ({ state, mergeStateStatus: merge, headRefOid: 'abcdef1234', statusCheckRollup: checks });
const done = (conclusion) => ({ status: 'COMPLETED', conclusion });

// why: guards the owner's lock A: the watcher reads, and its one read is a fixed gh command with no shell
test('the watcher reads only with the fixed gh command, and refuses a repo or number it could not pass safely', () => {
	assert.deepEqual(readArgs(REPO, 7), ['pr', 'view', '7', '--repo', REPO, '--json', 'state,mergeStateStatus,headRefOid,statusCheckRollup']);
	const r = rig({ 7: pr('OPEN', []) });
	for (const bad of [['add', 'someone/app;rm', '7'], ['add', '--repo', '7'], ['add', 'someone', '7'], ['add', REPO, '7x'], ['add', REPO, '-1'], ['add', '../x/y', '7']]) {
		const out = r.run(bad);
		assert.equal(out.code, 2, `${bad.join(' ')}: ${out.out}`);
	}
	assert.equal(r.run(['add', REPO, '7']).code, 0);
	// A hand-edited entry is refused at the pass, before any read.
	const file = path.join(r.dir, 'watch.json');
	const list = JSON.parse(fs.readFileSync(file, 'utf8'));
	list.entries.push({ ...list.entries[0], repo: 'a/b c', pr: 8 });
	fs.writeFileSync(file, JSON.stringify(list));
	r.run(['once']);
	assert.deepEqual(r.reads, [readArgs(REPO, 7)]);
	assert.ok(r.log().some((e) => e.event === 'triage' && /not a repo/.test(e.why)), JSON.stringify(r.log()));
	// The module runs no program but gh and the alert's PowerShell (a new call site shows here).
	const src = fs.readFileSync(path.resolve('user/kit-tools/watch.mjs'), 'utf8');
	assert.deepEqual(src.match(/execFileSync\('[^']+'/g), ["execFileSync('gh'", "execFileSync('powershell.exe'"]);
	assert.doesNotMatch(src, /\b(exec|spawn|spawnSync|execSync|fork)\(/);
});

// why: guards E13's purpose: the owner hears when a PR turns ready, once per change, never for "still the same"
test('the watcher alerts on each change to green, failed, conflict, merged or closed, and not on pending or the same state', () => {
	const r = rig({ 7: pr('OPEN', []) });
	r.run(['add', REPO, '7']);
	const step = (state) => { r.states[7] = state; r.run(['once']); return r.alerts.length; };
	assert.equal(step(pr('OPEN', [])), 0, 'no checks yet is pending');
	assert.equal(step(pr('OPEN', [{ status: 'IN_PROGRESS' }])), 0, 'running is pending');
	assert.equal(step(pr('OPEN', [done('SUCCESS'), done('SKIPPED')])), 1);
	assert.match(r.alerts[0], /PR 7 in someone\/app: green/);
	assert.equal(step(pr('OPEN', [done('SUCCESS'), done('SKIPPED')])), 1, 'the same state twice alerts once');
	assert.equal(step(pr('OPEN', [done('SUCCESS'), done('FAILURE')])), 2);
	assert.match(r.alerts[1], /failed/);
	assert.equal(step(pr('OPEN', [done('SUCCESS')], 'DIRTY')), 3);
	assert.match(r.alerts[2], /conflict/);
	assert.equal(step(pr('MERGED', [done('SUCCESS')])), 4);
	assert.match(r.alerts[3], /merged/);
	// A merged or closed PR is finished: it leaves the list.
	assert.equal(r.run(['list']).out.includes('#7'), false, r.run(['list']).out);
	assert.equal(verdict(pr('CLOSED', [])), 'closed');
	assert.equal(verdict(pr('OPEN', [done('CANCELLED')])), 'failed');
});

// why: guards the bounds of lock A: an entry expires, the list has a size, failures stop with a triage line, and a
// kill switch stops every pass
test('the watcher drops an expired entry, caps the list, stops an entry after three failed reads, and halts on watch-off', () => {
	const r = rig({ 7: pr('OPEN', []), 8: pr('OPEN', []) });
	assert.equal(r.run(['add', REPO, '7', '--hours', '337']).code, 2, 'at most 14 days');
	assert.equal(r.run(['add', REPO, '7', '--hours', '1']).code, 0);
	r.run(['once'], NOW + 2 * HOUR);
	assert.deepEqual(r.reads, [], 'an expired entry is not read');
	assert.ok(r.log().some((e) => e.event === 'expired' && e.pr === 7));
	assert.equal(r.run(['list']).out.includes('#7'), false);

	for (let n = 1; n <= 20; n++) assert.equal(r.run(['add', REPO, String(n)]).code, 0);
	const full = r.run(['add', REPO, '21']);
	assert.equal(full.code, 1);
	assert.match(full.out, /20 entries/);
	assert.equal(r.run(['add', REPO, '7']).code, 0, 'adding a watched PR again renews it');
	for (let n = 1; n <= 20; n++) if (n !== 8) r.run(['remove', REPO, String(n)]);

	r.fail.add(8);
	r.run(['once']); r.run(['once']);
	assert.equal(r.alerts.length, 0, 'two failed reads are not yet a stop');
	r.run(['once']);
	assert.equal(r.alerts.length, 1);
	assert.match(r.alerts[0], /stopped watching PR 8 .*3 failed reads.*gh: not signed in/);
	const before = r.reads.length;
	r.run(['once']);
	assert.equal(r.reads.length, before, 'a stopped entry is not read again');

	r.fail.clear();
	r.run(['add', REPO, '8']);
	fs.writeFileSync(path.join(r.dir, 'watch-off'), '');
	r.run(['once']);
	assert.equal(r.reads.length, before, 'watch-off stops the pass before any read');
	assert.ok(r.log().some((e) => e.event === 'killed'));
});

// why: guards the owner's lock A: the schedule is the owner's opt-in act; the watcher only prints the line
test('schedule prints a PowerShell-ready Task Scheduler line for the owner and registers nothing', () => {
	const r = rig();
	const out = r.run(['schedule']);
	assert.equal(out.code, 0);
	assert.match(out.out, /^schtasks \/Create \/SC MINUTE \/MO 5 \/TN "Kit watcher" \/TR "conhost\.exe --headless '.+node(\.exe)?' '.+\/watch\.mjs' once" \/F$/m);
	assert.match(out.out, /schtasks \/Delete \/TN "Kit watcher" \/F/);
	assert.equal(fs.readdirSync(r.dir).length, 0, 'nothing written');
	// The real command line, end to end: usage and a clean exit.
	const cli = spawnSync(process.execPath, [path.resolve('user/kit-tools/watch.mjs')], { encoding: 'utf8' });
	assert.equal(cli.status, 2);
	assert.match(cli.stdout, /usage: node .*watch\.mjs add/);
});
