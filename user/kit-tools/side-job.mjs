#!/usr/bin/env node
// K378 (U16): a job that is not the build runs in its own session, so the build never waits behind it.
//   side-job.mjs start --kind <gate|study|trial|check> --brief <file> [--folder <dir>]
//   side-job.mjs status [<id>]
//   side-job.mjs stop <id>
// start runs KIT_SIDE_JOB_CMD (default `claude -p`, the brief on its stdin) detached in a supervisor process, and
// returns at once with `started <id> log <path>`. The job's stdout goes to its own log file. The job folder is --folder,
// never inside the build's worktree or the main checkout, or else a new throwaway folder under the system temp. One job
// per kind at a time; a stopped or finished job frees its kind. Every event goes to <git common>/kit-side-jobs.jsonl.
// The git folder is found by reading .git with fs (no git process), so a project's git config cannot run here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import safeSpawn from './safe-spawn.cjs';

const KINDS = ['gate', 'study', 'trial', 'check'];
const DEFAULT_CMD = 'claude -p';
const JOB_LOG = 'kit-side-jobs.jsonl';
const JOB_DIR = 'kit-side-jobs';

function fail(msg) {
	console.error(msg);
	process.exitCode = 1;
	return null;
}

/** The worktree top and the git common dir of a folder, read from .git by fs; null when no repo above it. */
function repoOf(dir) {
	let d = path.resolve(dir);
	for (;;) {
		const g = path.join(d, '.git');
		if (fs.existsSync(g)) {
			if (fs.statSync(g).isDirectory()) return { top: d, common: g };
			const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(g, 'utf8'));
			if (!m) return null;
			const gd = path.resolve(d, m[1]);
			const cd = path.join(gd, 'commondir');
			return { top: d, common: fs.existsSync(cd) ? path.resolve(gd, fs.readFileSync(cd, 'utf8').trim()) : gd };
		}
		const up = path.dirname(d);
		if (up === d) return null;
		d = up;
	}
}

/** The folders a job may never run in: the build's worktree and the main checkout (the parent of a .git folder). */
function protectedRoots(repo) {
	const roots = [repo.top];
	if (path.basename(repo.common) === '.git') roots.push(path.dirname(repo.common));
	return roots.map((r) => fs.realpathSync(r));
}

const inside = (p, root) => {
	const r = path.relative(root, p);
	return r === '' || (r !== '..' && !r.startsWith(`..${path.sep}`) && !path.isAbsolute(r));
};

function readEvents(common) {
	const file = path.join(common, JOB_LOG);
	if (!fs.existsSync(file)) return [];
	return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((l) => {
		try { return [JSON.parse(l)]; } catch { return []; }
	});
}

function appendEvent(common, ev) {
	fs.appendFileSync(path.join(common, JOB_LOG), `${JSON.stringify({ ...ev, at: new Date().toISOString() })}\n`);
}

/** Every job in the log, with its end and stop events folded in. */
function jobsOf(common) {
	const byId = new Map();
	for (const ev of readEvents(common)) {
		if (ev.event === 'start') byId.set(ev.id, { ...ev, end: null, stopped: false });
		else if (byId.has(ev.id)) {
			const job = byId.get(ev.id);
			if (ev.event === 'end') job.end = ev;
			if (ev.event === 'stop') job.stopped = true;
		}
	}
	return [...byId.values()];
}

function alive(pid) {
	if (!pid) return false;
	try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** The state of a job: running, stopped, done (exit 0), or failed with its exit code (or none recorded). */
function stateOf(job) {
	if (job.stopped) return { state: 'stopped', text: 'stopped' };
	if (job.end) {
		if (job.end.exit === 0) return { state: 'done', text: 'done (exit 0)' };
		const how = job.end.exit === null ? `signal ${job.end.signal}` : `exit ${job.end.exit}`;
		return { state: 'failed', text: `failed (${how})` };
	}
	if (alive(job.pid)) return { state: 'running', text: 'running' };
	return { state: 'failed', text: 'failed (no exit recorded)' };
}

/** The last non-empty line of a job log, read from its last 8 KB. */
function lastLine(file) {
	let fd;
	try {
		fd = fs.openSync(file, 'r');
		const size = fs.fstatSync(fd).size;
		const len = Math.min(size, 8192);
		const buf = Buffer.alloc(len);
		fs.readSync(fd, buf, 0, len, size - len);
		const lines = buf.toString('utf8').split(/\r?\n/).filter((l) => l.trim());
		return lines.length ? lines[lines.length - 1] : '(empty log)';
	} catch {
		return '(no log)';
	} finally {
		if (fd !== undefined) fs.closeSync(fd);
	}
}

function parseArgs(argv) {
	const out = { _: [] };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i].startsWith('--')) { out[argv[i].slice(2)] = argv[i + 1]; i++; } else out._.push(argv[i]);
	}
	return out;
}

function start(args) {
	const repo = repoOf(process.cwd());
	if (!repo) return fail('side-job start: not inside a git repository');
	const common = fs.realpathSync(repo.common);
	if (!KINDS.includes(args.kind)) return fail(`side-job start: --kind must be one of ${KINDS.join(', ')} (got ${args.kind})`);
	if (!args.brief || !fs.existsSync(args.brief)) return fail(`side-job start: brief not found: ${args.brief}`);
	const brief = path.resolve(args.brief);
	let folder = null;
	if (args.folder) {
		if (!fs.existsSync(args.folder) || !fs.statSync(args.folder).isDirectory()) return fail(`side-job start: folder not found: ${args.folder}`);
		folder = fs.realpathSync(args.folder);
		const hit = protectedRoots(repo).find((r) => inside(folder, r));
		if (hit) return fail(`side-job start: folder ${folder} is inside the build's worktree or main checkout (${hit}); give a folder outside it`);
	}
	fs.mkdirSync(path.join(common, JOB_DIR), { recursive: true });
	// An exclusive-create lock per kind covers the check and the start event, so two starts at once cannot both pass.
	const lock = path.join(common, JOB_DIR, `${args.kind}.lock`);
	if (!takeLock(lock)) return fail(`side-job start: another ${args.kind} start is in progress; try again`);
	try {
		const busy = jobsOf(common).find((j) => j.kind === args.kind && stateOf(j).state === 'running');
		if (busy) return fail(`side-job start: a ${args.kind} job is already running: ${busy.id}`);
		let madeFolder = null;
		if (!folder) folder = madeFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'side-job-'));
		const refuse = (msg) => {
			if (madeFolder) { try { fs.rmdirSync(madeFolder); } catch { /* not empty or gone */ } }
			return fail(msg);
		};
		const [prog, ...progArgs] = jobCommand();
		const program = resolveProgram(prog, folder);
		if (!program) return refuse(`side-job start: program not found on an absolute PATH entry outside the job folder: ${prog}`);
		const spec = launchSpec(program, progArgs);
		if (spec.error) return refuse(`side-job start: ${spec.error}`);
		const id = `${args.kind}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
		const log = path.join(common, JOB_DIR, `${id}.log`);
		fs.writeFileSync(log, '');
		const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '__supervise', id, args.kind, folder, brief, log, common, program], {
			detached: true, stdio: 'ignore', windowsHide: true, cwd: path.dirname(process.execPath),
		});
		child.unref();
		appendEvent(common, { event: 'start', id, kind: args.kind, pid: child.pid, folder, brief, log });
		console.log(`started ${id} log ${log}`);
	} finally {
		try { fs.unlinkSync(lock); } catch { /* already gone */ }
	}
}

/** How to start the program: a .cmd or .bat on Windows goes through cmd.exe (by absolute path), each part quoted. */
function launchSpec(program, progArgs) {
	if (process.platform !== 'win32' || !/\.(cmd|bat)$/i.test(program)) return { file: program, args: progArgs, verbatim: false };
	for (const part of [program, ...progArgs]) {
		if (/["%\r\n]/.test(part)) return { error: `a .cmd program or argument may not hold a double quote, %, or a newline: ${JSON.stringify(part)}` };
	}
	const comSpec = process.env.ComSpec;
	const cmd = comSpec && path.isAbsolute(comSpec) && fs.existsSync(comSpec)
		? comSpec : path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
	const quoted = [program, ...progArgs].map((p) => `"${p}"`).join(' ');
	return { file: cmd, args: ['/d', '/s', '/c', `"${quoted}"`], verbatim: true };
}

const jobCommand = () => (process.env.KIT_SIDE_JOB_CMD || DEFAULT_CMD).trim().split(/\s+/);

/** The absolute path of the job program: `node` is this node; else PATH is walked here, never the job folder or a relative entry. */
function resolveProgram(prog, folder) {
	if (prog === 'node') return process.execPath;
	const isFile = (f) => { try { return fs.statSync(f).isFile(); } catch { return false; } };
	const win = process.platform === 'win32';
	const exts = win ? ['', ...(process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)] : [''];
	if (path.isAbsolute(prog)) return exts.map((e) => prog + e).find((f) => isFile(f) && !inside(path.resolve(f), folder)) || null;
	if (/[\\/]/.test(prog)) return null;
	for (const dir of (process.env.PATH || '').split(path.delimiter)) {
		if (!dir || !path.isAbsolute(dir) || inside(path.resolve(dir), folder)) continue;
		const hit = exts.map((e) => path.join(dir, prog + e)).find(isFile);
		if (hit) return hit;
	}
	return null;
}

/** Take the kind's lock with an exclusive create; a lock older than 10 s is a crashed start's and is cleared. */
function takeLock(file) {
	for (let i = 0; i < 50; i++) {
		try { fs.closeSync(fs.openSync(file, 'wx')); return true; } catch (e) {
			if (e.code !== 'EEXIST') throw e;
			try { if (Date.now() - fs.statSync(file).mtimeMs > 10000) fs.unlinkSync(file); } catch { /* raced */ }
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
		}
	}
	return false;
}

/** The detached supervisor: runs the job command, sends its stdout to the log, and records how it ended. */
function supervise([id, kind, folder, brief, log, common, program]) {
	const progArgs = jobCommand().slice(1);
	const out = fs.openSync(log, 'a');
	const inp = fs.openSync(brief, 'r');
	let ended = false;
	const finish = (exit, signal, note) => {
		if (ended) return;
		ended = true;
		if (note) fs.appendFileSync(log, `${note}\n`);
		appendEvent(common, { event: 'end', id, exit, signal: signal || null });
	};
	const spec = launchSpec(program, progArgs);
	const child = spawn(spec.file, spec.args, {
		windowsVerbatimArguments: spec.verbatim,
		cwd: folder,
		stdio: [inp, out, out],
		windowsHide: true,
		env: { ...process.env, NoDefaultCurrentDirectoryInExePath: '1', SIDE_JOB_ID: id, SIDE_JOB_KIND: kind },
	});
	fs.closeSync(inp);
	fs.closeSync(out);
	child.on('error', (e) => finish(127, null, `side job could not start: ${e.message}`));
	child.on('exit', (code, signal) => finish(code, signal));
}

function status(args) {
	const repo = repoOf(process.cwd());
	if (!repo) return fail('side-job status: not inside a git repository');
	const jobs = jobsOf(fs.realpathSync(repo.common));
	const want = args._[0];
	const shown = want ? jobs.filter((j) => j.id === want) : jobs;
	if (want && !shown.length) return fail(`side-job status: no job ${want}`);
	for (const j of shown) {
		const st = stateOf(j);
		const tail = st.state === 'failed' ? `: ${lastLine(j.log)}` : '';
		console.log(`${want ? '' : `${j.id} ${j.kind} `}${st.text}${tail}`);
	}
}

function killTree(pid) {
	if (process.platform === 'win32') {
		safeSpawn.tool('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
		return;
	}
	try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ } }
}

function stop(args) {
	const repo = repoOf(process.cwd());
	if (!repo) return fail('side-job stop: not inside a git repository');
	const common = fs.realpathSync(repo.common);
	const want = args._[0];
	const job = jobsOf(common).find((j) => j.id === want);
	if (!job) return fail(`side-job stop: no job ${want}`);
	const st = stateOf(job);
	if (st.state !== 'running') {
		console.log(`${job.id} is not running: ${st.text}`);
		return;
	}
	appendEvent(common, { event: 'stop', id: job.id });
	killTree(job.pid);
	console.log(`stopped ${job.id}`);
}

const [sub, ...rest] = process.argv.slice(2);
if (sub === '__supervise') supervise(rest);
else if (sub === 'start') start(parseArgs(rest));
else if (sub === 'status') status(parseArgs(rest));
else if (sub === 'stop') stop(parseArgs(rest));
else {
	console.error('usage: side-job.mjs start --kind <gate|study|trial|check> --brief <file> [--folder <dir>] | status [<id>] | stop <id>');
	process.exitCode = 2;
}
