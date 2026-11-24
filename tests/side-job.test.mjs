// K378 (U16): user/kit-tools/side-job.mjs starts a job that is not the build in its own claude -p session.
// Seam: KIT_SIDE_JOB_CMD replaces the claude command; here it is `node <stub>`, a small script that records its pid and
// folder, then sleeps, or exits with a chosen code after writing a last log line. No real session, no network.
import { test } from './harness.mjs';
import { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'user', 'kit-tools', 'side-job.mjs');

const STUB = `
import fs from 'node:fs';
const e = process.env;
if (e.STUB_PID_OUT) fs.writeFileSync(e.STUB_PID_OUT, String(process.pid));
if (e.STUB_CWD_OUT) fs.writeFileSync(e.STUB_CWD_OUT, process.cwd());
if (e.STUB_LINE) console.log(e.STUB_LINE);
if (e.STUB_MODE === 'exit') process.exit(Number(e.STUB_EXIT || 0));
setTimeout(() => process.exit(0), 60000);
`;

const made = [];
const pids = [];
const pidFiles = [];
const scratch = () => { const d = fs.realpathSync(kitTemp.makeTemp('sidejob-')); made.push(d); return d; };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// A throwaway repo stands in for the build's worktree: its .git is the git common dir the job log lives in. The job's
// TEMP, TMP and TMPDIR point at ctx.tmp, so a job with no --folder makes its throwaway folder there.
function setup() {
	const repo = scratch();
	spawnSync('git', ['init', '-q'], { cwd: repo });
	const stub = path.join(scratch(), 'stub.mjs');
	fs.writeFileSync(stub, STUB);
	const brief = path.join(repo, 'brief.md');
	fs.writeFileSync(brief, 'do the job\n');
	return { repo, stub, brief, out: scratch(), tmp: scratch() };
}

function run(ctx, args, env = {}) {
	const o = path.join(ctx.out, `o${Math.random().toString(36).slice(2)}.txt`);
	const fd = fs.openSync(o, 'w');
	const t0 = Date.now();
	const r = spawnSync(process.execPath, [SCRIPT, ...args], {
		cwd: ctx.repo, stdio: ['ignore', fd, fd], timeout: 20000,
		env: { ...process.env, TEMP: ctx.tmp, TMP: ctx.tmp, TMPDIR: ctx.tmp, KIT_SIDE_JOB_CMD: `node ${ctx.stub}`, ...env },
	});
	fs.closeSync(fd);
	return { status: r.status, ms: Date.now() - t0, text: fs.readFileSync(o, 'utf8') };
}

// Every start gets its own STUB_PID_OUT, refused ones too: a pid file that appears means a refused start ran a job.
function start(ctx, kind, env = {}, extra = []) {
	const pidFile = path.join(ctx.out, `pid${pidFiles.length}`);
	pidFiles.push(pidFile);
	const r = run(ctx, ['start', '--kind', kind, '--brief', ctx.brief, ...extra], { STUB_PID_OUT: pidFile, ...env });
	return { ...r, pidFile };
}
// Default output line: "started <id> log <path>".
const parse = (text) => { const m = /started\s+(\S+)\s+log\s+(.+)/.exec(text); return m ? { id: m[1], log: m[2].trim() } : null; };

async function waitFor(fn, ms = 8000) {
	const end = Date.now() + ms;
	while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); }
	return fn();
}
// The pid once the stub wrote it, registered for cleanup the moment it is known.
const readPid = (f) => { try { const n = Number(fs.readFileSync(f, 'utf8')); if (n && alive(n)) { pids.push(n); return n; } } catch {} return 0; };
const awaitPid = (f) => waitFor(() => readPid(f));
const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

after(() => {
	for (const f of pidFiles) readPid(f);
	for (const p of pids) { try { process.kill(p); } catch {} }
	for (const d of made) kitTemp.removeTemp(d);
});

// why: catches start launching the job in the caller's session, attached, slow, or without its id and log path (K378 S1)
test('start launches the job in its own session, detached, and returns at once, printing its id and log path', async () => {
	const ctx = setup();
	const baseline = run(ctx, ['status', 'nosuchid']).ms;
	const r = start(ctx, 'gate', { STUB_MODE: 'sleep', STUB_LINE: 'job output line' });
	assert.equal(r.status, 0, r.text);
	assert.ok(r.ms < baseline + 2000, `start took ${r.ms} ms against a ${baseline} ms no-op call`);
	const job = parse(r.text);
	assert.ok(job, `no "started <id> log <path>" line in: ${r.text}`);
	const pid = await awaitPid(r.pidFile);
	assert.ok(pid, 'the stub command never ran');
	assert.ok(alive(pid), 'the job did not outlive the start call');
	assert.ok(fs.existsSync(job.log), `log path ${job.log} does not exist`);
	const logged = await waitFor(() => readText(job.log).includes('job output line'));
	assert.ok(logged, `the job's own log ${job.log} does not hold its output`);
});

// why: catches a kind outside gate, study, trial and check starting a job or not naming the four (K378 S1)
test('a kind outside gate, study, trial and check is refused, naming the four', () => {
	const ctx = setup();
	const r = start(ctx, 'deploy', { STUB_MODE: 'sleep' });
	assert.notEqual(r.status, 0, r.text);
	for (const k of ['gate', 'study', 'trial', 'check']) assert.match(r.text, new RegExp(k), `refusal does not name ${k}: ${r.text}`);
	assert.equal(fs.existsSync(r.pidFile), false, 'a refused kind still started a job');
});

// why: catches a job running in the build's worktree, or a folder inside it being accepted (K378 S2)
test('the job runs in its own folder, never the build\'s worktree', async () => {
	const ctx = setup();
	const cwdFile = path.join(ctx.out, 'cwd');
	const r = start(ctx, 'study', { STUB_MODE: 'sleep', STUB_CWD_OUT: cwdFile });
	assert.equal(r.status, 0, r.text);
	const cwd = await waitFor(() => readText(cwdFile));
	await awaitPid(r.pidFile);
	assert.ok(cwd, 'the stub never reported its folder');
	const real = fs.realpathSync(cwd);
	assert.ok(real.startsWith(fs.realpathSync(ctx.tmp)), `${real} is not under the system temp (${ctx.tmp})`);
	assert.ok(!real.startsWith(ctx.repo), `${real} is inside the build's worktree`);
	// A fresh folder outside the repo is where the job runs.
	const fresh = scratch();
	const freshCwd = path.join(ctx.out, 'cwd-fresh');
	const ok = start(ctx, 'trial', { STUB_MODE: 'sleep', STUB_CWD_OUT: freshCwd }, ['--folder', fresh]);
	assert.equal(ok.status, 0, ok.text);
	const got = await waitFor(() => readText(freshCwd));
	await awaitPid(ok.pidFile);
	assert.ok(got, 'the stub never reported its folder under --folder');
	assert.equal(fs.realpathSync(got), fresh);
	// control: the worktree itself as --folder is refused, naming the folder.
	const bad = start(ctx, 'check', { STUB_MODE: 'sleep' }, ['--folder', ctx.repo]);
	assert.notEqual(bad.status, 0, bad.text);
	assert.ok(bad.text.includes(ctx.repo), `refusal does not name ${ctx.repo}: ${bad.text}`);
	assert.equal(fs.existsSync(bad.pidFile), false, 'a refused worktree folder still started a job');
	// control: a subfolder of the repo is refused too, naming it.
	const sub = path.join(ctx.repo, 'sub');
	fs.mkdirSync(sub);
	const badSub = start(ctx, 'check', { STUB_MODE: 'sleep' }, ['--folder', sub]);
	assert.notEqual(badSub.status, 0, badSub.text);
	assert.ok(badSub.text.includes(sub), `refusal does not name ${sub}: ${badSub.text}`);
	assert.equal(fs.existsSync(badSub.pidFile), false, 'a refused repo subfolder still started a job');
});

// why: catches status mixing up running, done and failed, or dropping the exit code and the log's last line (K378 S3)
test('status prints running, done with its exit code, or failed with the log\'s last line', async () => {
	const ctx = setup();
	const running = parse(start(ctx, 'gate', { STUB_MODE: 'sleep' }).text);
	const doneStart = start(ctx, 'study', { STUB_MODE: 'exit', STUB_EXIT: '0', STUB_LINE: 'all fine' });
	const done = parse(doneStart.text);
	const failed = parse(start(ctx, 'trial', { STUB_MODE: 'exit', STUB_EXIT: '3', STUB_LINE: 'boom last line' }).text);
	assert.ok(running && done && failed, 'a start did not print its id and log path');
	await awaitPid(pidFiles[pidFiles.length - 3]);
	const left = await waitFor(() => !/running/.test(run(ctx, ['status', done.id]).text) && !/running/.test(run(ctx, ['status', failed.id]).text));
	assert.ok(left, 'the done and failed jobs never left running');
	const sRun = run(ctx, ['status', running.id]);
	assert.equal(sRun.status, 0, sRun.text);
	assert.equal(sRun.text.trim(), 'running');
	assert.doesNotMatch(sRun.text, /exit/);
	assert.equal(run(ctx, ['status', done.id]).text.trim(), 'done (exit 0)');
	assert.equal(run(ctx, ['status', failed.id]).text.trim(), 'failed (exit 3): boom last line');
	// control: a finished job frees its kind.
	const again = start(ctx, 'study', { STUB_MODE: 'sleep' });
	assert.equal(again.status, 0, `a done job still held its kind: ${again.text}`);
	assert.ok(await awaitPid(again.pidFile), 'the second study job never ran');
});

// why: catches stop leaving the job alive, unlogged, or its kind held (K378 S3)
test('stop ends the job and logs it', async () => {
	const ctx = setup();
	const first = start(ctx, 'trial', { STUB_MODE: 'sleep' });
	const job = parse(first.text);
	assert.ok(job, 'start did not print its id and log path');
	const pid = await awaitPid(first.pidFile);
	assert.ok(pid && alive(pid), 'the job is not running before stop');
	const r = run(ctx, ['stop', job.id]);
	assert.equal(r.status, 0, r.text);
	const gone = await waitFor(() => !alive(pid));
	assert.ok(gone, 'the job process is still alive after stop');
	const logFile = path.join(ctx.repo, '.git', 'kit-side-jobs.jsonl');
	const lines = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
	assert.ok(lines.split('\n').some((l) => l.includes(job.id) && /stop/i.test(l)), `no stop line for ${job.id} in kit-side-jobs.jsonl`);
	assert.doesNotMatch(run(ctx, ['status', job.id]).text, /running/);
	// control: a stopped job frees its kind.
	const again = start(ctx, 'trial', { STUB_MODE: 'sleep' });
	assert.equal(again.status, 0, `a stopped job still held its kind: ${again.text}`);
	assert.ok(await awaitPid(again.pidFile), 'the restarted trial job never ran');
});

// why: catches a second job of one kind starting while one runs, or its refusal not naming the running id (K378 S4)
test('a second start of the same kind while one runs is refused, naming the running id', async () => {
	const ctx = setup();
	const firstStart = start(ctx, 'gate', { STUB_MODE: 'sleep' });
	const first = parse(firstStart.text);
	assert.ok(first, 'the first start did not print its id and log path');
	await awaitPid(firstStart.pidFile);
	const second = start(ctx, 'gate', { STUB_MODE: 'sleep' });
	assert.notEqual(second.status, 0, second.text);
	assert.ok(second.text.includes(first.id), `refusal does not name ${first.id}: ${second.text}`);
	assert.equal(fs.existsSync(second.pidFile), false, 'a refused second start still ran a job');
	// control: another kind still starts.
	const other = start(ctx, 'study', { STUB_MODE: 'sleep' });
	assert.equal(other.status, 0, other.text);
	await awaitPid(other.pidFile);
});

// why: catches a reused pid of a dead supervisor reading as running, holding its kind and letting stop kill a stranger
test('a job whose supervisor pid now belongs to another process reads as stale: its kind restarts and stop spares the process', async () => {
	const { spawn } = await import('node:child_process');
	const ctx = setup();
	const first = start(ctx, 'gate', { STUB_MODE: 'sleep' });
	const job = parse(first.text);
	assert.ok(job, `start did not print its id and log path: ${first.text}`);
	const stubPid = await awaitPid(first.pidFile);
	assert.ok(stubPid, 'the stub command never ran');
	const logFile = path.join(ctx.repo, '.git', 'kit-side-jobs.jsonl');
	const rows = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
	const supervisor = rows.find((r) => r.event === 'start' && r.id === job.id).pid;
	// The real supervisor and its job die with no end row, as a crash leaves them.
	process.kill(supervisor);
	process.kill(stubPid);
	assert.ok(await waitFor(() => !alive(supervisor) && !alive(stubPid)), 'the first job did not die');
	// An unrelated live process now holds the pid the record names.
	const stranger = spawn(process.execPath, [ctx.stub], { stdio: 'ignore' });
	pids.push(stranger.pid);
	const reused = rows.map((r) => (r.event === 'start' && r.id === job.id ? { ...r, pid: stranger.pid } : r));
	fs.writeFileSync(logFile, `${reused.map((r) => JSON.stringify(r)).join('\n')}\n`);
	assert.ok(alive(stranger.pid), 'the unrelated process is not alive');
	assert.doesNotMatch(run(ctx, ['status', job.id]).text, /^running/, 'a reused pid still reads as running');
	const stopped = run(ctx, ['stop', job.id]);
	assert.doesNotMatch(stopped.text, /^stopped /, `stop claimed to stop a stranger: ${stopped.text}`);
	await new Promise((r) => setTimeout(r, 1500));
	assert.ok(alive(stranger.pid), 'stop killed the unrelated process that reused the pid');
	const again = start(ctx, 'gate', { STUB_MODE: 'sleep' });
	assert.equal(again.status, 0, `a reused pid still held the gate kind: ${again.text}`);
	assert.ok(await awaitPid(again.pidFile), 'the restarted gate job never ran');
});
