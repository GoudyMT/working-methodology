// E13 (T7 slice 2, build 13; the owner's lock A, 2026-11-03): a watcher for pending work. PR 17 sat green for 7
// minutes waiting for a person, and nothing watches across threads. The watcher reads pull request state on a
// schedule, tells the owner when one turns ready, and never acts: its only program is a fixed gh read.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { main, program, readArgs, scheduleLines, verdict } from '../user/kit-tools/watch.mjs';

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
	assert.deepEqual(src.match(/execFileSync\([^,]+/g), ["execFileSync(program('gh')", "execFileSync(program('powershell')"]);
	assert.doesNotMatch(src, /\b(exec|spawn|spawnSync|execSync|fork)\(/);
});

// The build 13 sweep: on Windows a program in the current folder runs before PATH, so a pass started by hand inside an
// untrusted clone ran the clone's gh.exe.
// why: guards the owner's lock A: the read is the real gh, whatever folder the pass starts in
test('the watcher finds gh only in absolute PATH folders, never the current folder, and PowerShell in the system folder', () => {
	const clone = kitTemp.makeTemp('watch-clone-');
	const real = kitTemp.makeTemp('watch-bin-');
	// The host's own program name and PATH separator: CI runs this on Linux and Windows.
	const exe = process.platform === 'win32' ? 'gh.exe' : 'gh';
	const sep = process.platform === 'win32' ? ';' : ':';
	for (const d of [clone, real]) fs.writeFileSync(path.join(d, exe), '');
	const find = (pathVar) => program('gh', { pathVar, cwd: clone });
	assert.equal(find(['.', clone, real].join(sep)), path.join(real, exe));
	assert.equal(find(['sub', real].join(sep)), path.join(real, exe), 'a relative PATH folder');
	assert.throws(() => find(['.', clone].join(sep)), /not in any absolute PATH folder/);
	assert.equal(program('powershell', { platform: 'win32', systemRoot: 'C:\\Windows', pathVar: clone, cwd: clone }), 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
});

// The build 13 sweep: the bounds were checked only at add, so a hand-edited list read 60 PRs every pass, forever.
// why: guards the owner's lock A: the list's size, each entry's expiry and the stop after failed reads hold at each pass
test('a hand-edited list is held to the bounds at each pass: 20 entries, the expiry limit and three failed reads', () => {
	const r = rig();
	const file = path.join(r.dir, 'watch.json');
	const entry = (pr, extra = {}) => ({ repo: REPO, pr, expires: new Date(NOW + HOUR).toISOString(), last: null, fails: 0, stopped: false, ...extra });
	fs.mkdirSync(r.dir, { recursive: true });
	fs.writeFileSync(file, JSON.stringify({ entries: Array.from({ length: 60 }, (_, i) => entry(i + 1)) }));
	for (let i = 1; i <= 60; i++) r.states[i] = pr('OPEN', []);
	r.run(['once']);
	assert.equal(r.reads.length, 20);
	fs.writeFileSync(file, JSON.stringify({ entries: [entry(1, { expires: '9999-12-31T00:00:00Z' }), entry(2, { fails: -1000000 })] }));
	r.reads.length = 0;
	r.fail.add(2);
	for (let n = 0; n < 4; n++) r.run(['once']);
	assert.equal(r.reads.filter((a) => a[2] === '1').length, 0, 'an expiry past the limit is dropped');
	assert.equal(r.reads.filter((a) => a[2] === '2').length, 3, 'a negative failure count still stops after three');
	assert.equal(r.alerts.length, 1);
	// A log planted as a link to a file outside the folder is dropped, not written through.
	const outside = path.join(kitTemp.makeTemp('watch-out-'), 'outside.txt');
	fs.writeFileSync(outside, 'ORIGINAL');
	fs.rmSync(path.join(r.dir, 'watch.log'), { force: true });
	fs.linkSync(outside, path.join(r.dir, 'watch.log'));
	r.states[9] = pr('OPEN', []);
	r.run(['add', REPO, '9']);
	r.run(['once']);
	assert.equal(fs.readFileSync(outside, 'utf8'), 'ORIGINAL');
	assert.ok(r.log().length > 0, 'the watcher logs to its own file again');
});

// The build 13 sweep: the printed line runs in PowerShell, where a $ or a backtick in a path runs as script, and a
// quote breaks the /TR quoting.
// why: guards the owner's lock A: the schedule line the owner pastes runs one pass, and nothing else
test('the schedule line refuses a path its quoting cannot carry', () => {
	assert.equal(scheduleLines('C:/Program Files/nodejs/node.exe', 'C:/kit/.claude/kit-tools/watch.mjs', '').ok, true);
	// Every line that is not a schtasks command is a comment, and the environment's value is never printed.
	const noted = scheduleLines('C:/node.exe', 'C:/w.mjs', 'C:/x$(ni y)');
	assert.ok(noted.text.split('\n').every((l) => /^(schtasks |# )/.test(l)), noted.text);
	assert.doesNotMatch(noted.text, /ni y/);
	for (const bad of ['C:/u$(ni x)/watch.mjs', "C:/O'Brien/watch.mjs", 'C:/u`x/watch.mjs', 'C:/u"x/watch.mjs']) {
		const s = scheduleLines('C:/Program Files/nodejs/node.exe', bad, '');
		assert.equal(s.ok, false, bad);
		assert.doesNotMatch(s.text, /schtasks/);
	}
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
	assert.match(out.out, /^schtasks \/Create \/SC MINUTE \/MO 5 \/TN "Kit watcher" \/TR "conhost\.exe --headless '.+node(\.exe)?' '.+\/watch\.mjs' once" \/F$/m); // pin: 1 (the line the owner pastes into a shell)
	assert.match(out.out, /schtasks \/Delete \/TN "Kit watcher" \/F/);
	assert.equal(fs.readdirSync(r.dir).length, 0, 'nothing written');
	// The real command line, end to end: usage and a clean exit.
	const cli = spawnSync(process.execPath, [path.resolve('user/kit-tools/watch.mjs')], { encoding: 'utf8' });
	assert.equal(cli.status, 2);
	assert.match(cli.stdout, /usage: node .*watch\.mjs add/);
});
