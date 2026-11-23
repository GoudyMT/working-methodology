// scripts/ci-budget.mjs enforces the merge-path time budget in the required check (CI-C).
//   node scripts/ci-budget.mjs --jobs <file> [--timings <file>] [--limit <s>] [--self <job name>] [--skip <job name>]...
// --skip leaves out a job by name and its matrix legs, and names each one on a skipped line. --jobs is GitHub's run-jobs answer as one {jobs:[...]} object (gh api --paginate, pages merged). Every job in it is
// measured except --self, so the list comes from the run and not from a fixed list. A job's time is completed_at minus
// started_at; queue wait is not counted. --timings is optional JSON {"<job name>": {"<file::name>": ms}}: a failing job
// is named with its 5 slowest tests from it. Exit 0 pass, 1 a failing job (named on stderr), 2 an unreadable --jobs or
// --timings or a bad usage. An unreadable input also appends one row {at, hook, cause} to <git common dir>/kit-guard-open.log.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_LIMIT = 180;
const SLOWEST_NAMED = 5;
const FLAGS = ['--jobs', '--timings', '--limit', '--self', '--skip'];
const USAGE = 'usage: node scripts/ci-budget.mjs --jobs <file> [--timings <file>] [--limit <s>] [--self <job name>] [--skip <job name>]...';

class Usage extends Error {}
class Unreadable extends Error {}

// Every flag takes exactly one value; a flag with no value, or one that is another flag, is refused.
function parseArgs(args) {
	const opts = { skip: [] };
	for (let i = 0; i < args.length; i += 2) {
		const flag = args[i];
		const value = args[i + 1];
		if (!FLAGS.includes(flag) || value === undefined || value === '' || value.startsWith('--')) throw new Usage(USAGE);
		if (flag === '--skip') opts.skip.push(value);
		else opts[flag.slice(2)] = value;
	}
	if (opts.jobs === undefined) throw new Usage(USAGE);
	if (opts.limit !== undefined && !/^\d+$/.test(opts.limit)) throw new Usage(`--limit takes a whole number of seconds, got ${opts.limit}`);
	return opts;
}

function readJson(file, what) {
	let text;
	try {
		text = fs.readFileSync(file, 'utf8');
	} catch (e) {
		throw new Unreadable(`cannot read ${what} ${file}: ${e.code || e.message}`);
	}
	try {
		return JSON.parse(text);
	} catch {
		throw new Unreadable(`${what} ${file} is not JSON`);
	}
}

// Valid JSON that measures nothing is unreadable too: no jobs array, an empty one, or fewer jobs than total_count says.
function loadJobs(file) {
	const answer = readJson(file, '--jobs');
	const jobs = answer?.jobs;
	if (!Array.isArray(jobs) || jobs.length === 0) throw new Unreadable(`--jobs ${file} lists no jobs`);
	if (answer.total_count !== undefined && (!Number.isInteger(answer.total_count) || answer.total_count > jobs.length)) {
		throw new Unreadable(`--jobs ${file} lists ${jobs.length} jobs, total_count says ${answer.total_count}`);
	}
	for (const job of jobs) {
		if (typeof job?.name !== 'string' || job.name === '') throw new Unreadable(`--jobs ${file} has a job with no name`);
	}
	return jobs;
}

function loadTimings(file) {
	const timings = readJson(file, '--timings');
	if (typeof timings !== 'object' || timings === null || Array.isArray(timings)) throw new Unreadable(`--timings ${file} is not an object of job names`);
	for (const tests of Object.values(timings)) {
		if (typeof tests !== 'object' || tests === null) throw new Unreadable(`--timings ${file} has a job with no test object`);
		for (const ms of Object.values(tests)) {
			if (!Number.isFinite(ms) || ms < 0) throw new Unreadable(`--timings ${file} has a test time that is not a number of ms`);
		}
	}
	return timings;
}

// A job's verdict: null for --self, a skip line, a failure reason, or its measured time.
function judge(job, opts, limitMs) {
	if (job.name === opts.self) return null;
	// --skip names a job and its matrix legs ("<name> (n)"); they are named as skipped in whatever state they are in.
	if (opts.skip.some((s) => job.name === s || job.name.startsWith(`${s} (`))) return { name: job.name, skipped: true };
	if (job.conclusion === 'skipped') return { name: job.name, skipped: true };
	if (job.status !== 'completed') return { name: job.name, reason: `not completed (${job.status})` };
	if (job.conclusion !== 'success') return { name: job.name, reason: job.conclusion ?? 'no conclusion' };
	const start = Date.parse(job.started_at);
	const end = Date.parse(job.completed_at);
	if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return { name: job.name, reason: 'no valid start and end time' };
	const ms = end - start;
	return { name: job.name, ms, over: ms > limitMs };
}

function byName(a, b) {
	return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

// The 5 slowest tests of a job, from --timings; a job with none there says so instead of naming any.
function slowest(timings, name) {
	const tests = timings && Object.hasOwn(timings, name) ? timings[name] : undefined;
	const entries = tests ? Object.entries(tests) : [];
	if (entries.length === 0) return ['  no per-test timings for this job'];
	entries.sort((a, b) => b[1] - a[1] || byName({ name: a[0] }, { name: b[0] }));
	return [`  the ${Math.min(SLOWEST_NAMED, entries.length)} slowest tests:`, ...entries.slice(0, SLOWEST_NAMED).map(([key, ms]) => `    ${key}: ${ms} ms`)];
}

function check(opts) {
	const limit = Number(opts.limit ?? DEFAULT_LIMIT);
	const jobs = loadJobs(opts.jobs);
	const timings = opts.timings === undefined ? null : loadTimings(opts.timings);
	const verdicts = jobs.map((job) => judge(job, opts, limit * 1000)).filter(Boolean).sort(byName);
	const out = [`ci budget: ${verdicts.length} jobs measured, limit ${limit} s per job`];
	const err = [];
	let failed = false;
	for (const v of verdicts) {
		if (v.skipped) {
			out.push(`skipped: ${v.name}`);
		} else if (v.reason !== undefined) {
			failed = true;
			err.push(`FAIL ${v.name}: ${v.reason}`);
		} else if (v.over) {
			failed = true;
			err.push(`FAIL ${v.name}: ${v.ms / 1000} s, over the ${limit} s limit`, ...slowest(timings, v.name));
		} else {
			out.push(`${v.name}: ${v.ms / 1000} s`);
		}
	}
	out.push("queue wait is not counted: a job's time is completed_at minus started_at");
	return { code: failed ? 1 : 0, out: `${out.join('\n')}\n`, err: err.length ? `${err.join('\n')}\n` : '' };
}

// The log is in the git common dir, so a worktree's row lands where the main checkout reads it.
function logUnreadable(cause) {
	try {
		const common = spawnSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' });
		if (common.status !== 0) return;
		const file = path.join(path.resolve(common.stdout.trim()), 'kit-guard-open.log');
		fs.appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), hook: 'ci-budget', cause })}\n`);
	} catch {
		// No log to write to: the exit code and the stderr line still fail the check.
	}
}

function main(args) {
	let opts;
	try {
		opts = parseArgs(args);
	} catch (e) {
		process.stderr.write(`${e.message}\n`);
		return 2;
	}
	let result;
	try {
		result = check(opts);
	} catch (e) {
		const cause = e instanceof Unreadable ? e.message : `unexpected error: ${e.message}`;
		process.stderr.write(`ci-budget: ${cause}\n`);
		logUnreadable(cause);
		return 2;
	}
	process.stdout.write(result.out);
	if (result.err) process.stderr.write(result.err);
	return result.code;
}

process.exitCode = main(process.argv.slice(2));
