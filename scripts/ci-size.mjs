// scripts/ci-size.mjs sizes the CI jobs from the measured test times in the map: the unit runners, the test-check slices
// and the minimal-code slices, written as the GITHUB_OUTPUT lines the plan job reads.
//   node scripts/ci-size.mjs --map <map.json> [--tests <a.test.mjs,b.test.mjs>] [--changed-tests <n>] [--flips <n>]
//                            [--base <sha>] [--github-output <path>]
// The map is test-run.mjs's: { tests: { "<file>::<name>": { ms } } }. A --tests file the map does not hold counts the
// median of the map's per-file totals, so a new test file is not sized as free. With --base <sha> the changed-test count is
// the tests whose body differs between that commit and HEAD (new or changed, a loop one unit), read with test-check.mjs's
// own parser over each changed tests/*.test.mjs, run from the repo. Exit 0 with a plan (past six runners it caps at six
// and names the overage and the slowest tests on stderr), 2 on bad input.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const RUNNER_SECONDS = 110;
const MAX_RUNNERS = 6;
const CHANGED_PER_SLICE = 100;
const MAX_CHECK_SLICES = 6;
const FLIPS_PER_SLICE = 200;
const MAX_MUTATION_SLICES = 4;
const SLOWEST_NAMED = 5;
const FLAGS = ['--map', '--tests', '--changed-tests', '--flips', '--base', '--github-output'];
const USAGE = 'usage: node scripts/ci-size.mjs --map <map.json> [--tests <files>] [--changed-tests <n>] [--flips <n>] [--base <sha>] [--github-output <path>]';

// Every flag takes exactly one value; a flag with no value, or one that is another flag, is refused rather than read.
function parseArgs(args) {
	const opts = {};
	for (let i = 0; i < args.length; i += 2) {
		const flag = args[i];
		const value = args[i + 1];
		if (!FLAGS.includes(flag) || value === undefined || value === '' || value.startsWith('--')) throw new Error(USAGE);
		opts[flag.slice(2)] = value;
	}
	if (opts.map === undefined) throw new Error(USAGE);
	return opts;
}

// A count flag is a whole number; absent means zero, which the caller clamps to one slice.
function count(opts, name) {
	const raw = opts[name];
	if (raw === undefined) return 0;
	if (!/^\d+$/.test(raw)) throw new Error(`--${name} takes a whole number, got ${raw}`);
	return Number(raw);
}

// The tests whose body differs between the base commit and HEAD, over each changed tests/*.test.mjs, by test-check's parser.
async function changedSince(base) {
	if (!/^[0-9a-f]{7,64}$/i.test(base)) throw new Error(`--base takes a commit sha, got ${base}`);
	const git = (...a) => spawnSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
	const diff = git('diff', '--name-only', base, 'HEAD', '--', 'tests/*.test.mjs');
	if (diff.status !== 0) throw new Error(`cannot diff against ${base}`);
	const { tests } = await import(pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), 'test-check.mjs')).href);
	let n = 0;
	for (const f of diff.stdout.split('\n').filter(Boolean)) {
		if (!fs.existsSync(f)) continue;
		const was = git('show', `${base}:${f}`);
		const before = tests(was.status === 0 ? was.stdout : '');
		for (const [name, body] of tests(fs.readFileSync(f, 'utf8'))) if (before.get(name) !== body) n++;
	}
	return n;
}

function readMap(file) {
	let parsed;
	try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error(`cannot read map ${file}`); }
	const tests = parsed?.tests;
	if (typeof tests !== 'object' || tests === null) throw new Error(`map ${file} has no tests object`);
	return Object.entries(tests).map(([key, value]) => {
		// A key without "::" has no file part to match a --tests list against, so it is a broken map, not a free test.
		if (!key.includes('::') || !Number.isFinite(value?.ms) || value.ms < 0) throw new Error(`map ${file} has a bad entry: ${key}`);
		return { key, file: key.slice(0, key.indexOf('::')), ms: value.ms };
	});
}

function listFiles(raw) {
	const files = raw.split(',').map((f) => f.trim()).filter(Boolean);
	if (files.length === 0) throw new Error(USAGE);
	return files;
}

function median(values) {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = sorted.length >> 1;
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Predicted milliseconds: every key with no --tests list, else the keys of the listed files; a listed file the map does
// not hold counts the median of the map's per-file totals.
function predict(entries, tests) {
	const totals = new Map();
	for (const e of entries) totals.set(e.file, (totals.get(e.file) ?? 0) + e.ms);
	if (tests === null) return { ms: entries.reduce((sum, e) => sum + e.ms, 0), named: entries };
	const medianMs = median([...totals.values()]);
	let ms = 0;
	for (const file of new Set(tests)) ms += totals.has(file) ? totals.get(file) : medianMs;
	return { ms, named: entries.filter((e) => tests.includes(e.file)) };
}

// Each count is at least one slice and at most the cap; a runner or slice the cap refuses is never started.
const clamp = (n, most) => Math.min(most, Math.max(1, n));
const range = (n, from) => Array.from({ length: n }, (_, i) => from + i);

function emit(lines, target) {
	const text = lines.map((line) => `${line}\n`).join('');
	if (target === null) { process.stdout.write(text); return; }
	try { fs.appendFileSync(target, text); } catch { throw new Error(`cannot write ${target}`); }
}

async function main(args) {
	const opts = parseArgs(args);
	const entries = readMap(opts.map);
	const tests = opts.tests === undefined ? null : listFiles(opts.tests);
	const changed = opts.base === undefined ? count(opts, 'changed-tests') : await changedSince(opts.base);
	const flips = count(opts, 'flips');
	const { ms, named } = predict(entries, tests);
	if (ms > MAX_RUNNERS * RUNNER_SECONDS * 1000) {
		// Past the cap the plan is still six runners: the overage and the slowest tests are named, and the job passes (M9).
		// Named from the tests this job runs; a job whose every file is the median has no keys, so the whole map is named.
		const slowest = (named.length ? named : entries).slice().sort((a, b) => b.ms - a.ms).slice(0, SLOWEST_NAMED);
		const names = slowest.map((e) => `${e.key} (${e.ms / 1000} s)`).join(', ');
		process.stderr.write(`ci-size: predicted ${ms / 1000} s is over ${MAX_RUNNERS} runners at ${RUNNER_SECONDS} s; slowest: ${names}\n`);
	}
	const unit = clamp(Math.ceil(ms / (RUNNER_SECONDS * 1000)), MAX_RUNNERS);
	const check = clamp(Math.ceil(changed / CHANGED_PER_SLICE), MAX_CHECK_SLICES);
	const mutation = clamp(Math.ceil(flips / FLIPS_PER_SLICE), MAX_MUTATION_SLICES);
	const lines = [
		`predicted=${ms / 1000}`,
		`unit=${JSON.stringify({ shard: range(unit, 0) })}`,
		`check=${JSON.stringify({ slice: range(check, 0) })}`,
		`mutation=${JSON.stringify({ slice: range(mutation, 1) })}`,
	];
	emit(lines, opts['github-output'] || process.env.GITHUB_OUTPUT || null);
}

try {
	await main(process.argv.slice(2));
} catch (err) {
	process.stderr.write(`ci-size: ${err.message}\n`);
	process.exitCode = 2;
}
