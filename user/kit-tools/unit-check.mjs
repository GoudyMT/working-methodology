#!/usr/bin/env node
// A unit's history proves test-first only with the right commit shape: a red test-only commit before each feat or fix.
// Usage: node unit-check.mjs <base>..<head> [--repo <dir>] [--timeout <ms>] [--plan <plan.md> --unit <id>] (0 pass, 1 fault, 2 bad use)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import kitTemp from './kit-temp.cjs';
import { BLANK, commitOf, countGate, gitOut, gitRun, gitShow, testsIn } from './count-gate.mjs';

const UNCHECKED = new Set(['chore', 'docs', 'build', 'ci']);
const MIXED = 'mixed: the commit touches source and test files; split it';
const NO_RED = 'no red commit before it';
const NO_RED_TEST = 'test changed without a red test; use retest:';
const USAGE = 'usage: node unit-check.mjs <base>..<head> [--repo <dir>] [--timeout <ms>] (node:test projects only)\n';
// A TAP result line at any indent; a SKIP or TODO directive is read.
const TAP = /^\s*(not ok|ok) \d+ - (.*?)(?: # (SKIP|TODO)\b.*)?$/;
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

// The kit runner's switches stay out of the child runs.
const childEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^KIT_|^NODE_TEST_CONTEXT$/.test(k)));

// The new-file line numbers a commit adds to one file.
function addedLines(repo, hash, file) {
	const out = new Set();
	for (const l of gitOut(repo, ['show', '--format=', '--unified=0', hash, '--', file]).split('\n')) {
		const h = HUNK.exec(l);
		if (h) for (let i = 0; i < (h[2] === undefined ? 1 : Number(h[2])); i++) out.add(Number(h[1]) + i);
	}
	return out;
}

// The tests a commit adds or changes in one file: those holding an added code line.
function touchedTests(repo, hash, file) {
	const names = new Set();
	const text = gitShow(repo, hash, file);
	if (text === null) return names;
	const added = addedLines(repo, hash, file);
	const lines = text.split('\n');
	for (const t of testsIn(text)) {
		for (let n = t.head; n <= t.end; n++) {
			if (added.has(n + 1) && !BLANK.test(lines[n])) {
				names.add(t.name);
				break;
			}
		}
	}
	return names;
}

// The test names a file held before the commit and no longer does.
function removedNames(repo, c) {
	if (!c.parent) return [];
	return c.tests.flatMap((f) => {
		const was = gitShow(repo, c.parent, f);
		if (was === null) return [];
		const now = new Set(testsIn(gitShow(repo, c.hash, f) || '').map((t) => t.name));
		return testsIn(was).map((t) => t.name).filter((n) => !now.has(n));
	});
}

// Each test's state in a run's TAP: pass, skip (SKIP or TODO) or fail.
function parseTap(out) {
	const states = new Map();
	for (const line of String(out || '').split(/\r?\n/)) {
		const m = TAP.exec(line);
		if (m) states.set(m[2].replace(/\\([\\#])/g, '$1'), m[1] !== 'ok' ? 'fail' : m[3] ? 'skip' : 'pass');
	}
	return states;
}

// A loop's name (with a ${...}) stands for the names it makes.
function stateOf(states = new Map(), name) {
	if (!name.includes('${')) return states.get(name) || 'fail';
	const re = new RegExp(`^${name.split(/(?:\$\{[^}]*\})+/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*?')}$`);
	const made = [...states].filter(([n]) => re.test(n)).map(([, s]) => s);
	if (made.length === 0) return 'fail';
	return made.includes('fail') ? 'fail' : made.includes('skip') ? 'skip' : 'pass';
}

// The touched names that meet keep in their file's run.
const pick = (touched, run, keep) => [...new Set([...touched].flatMap(([f, names]) => [...names].filter((n) => keep(stateOf(run.states.get(f), n)))))];

// A commit's tree in a temp folder, read through a temp index.
function withTree(repo, rev, fn) {
	const dir = kitTemp.makeTemp('unit-check-');
	try {
		const env = { ...process.env, GIT_INDEX_FILE: path.join(dir, 'index') };
		const dest = path.join(dir, 'tree');
		fs.mkdirSync(dest);
		if (gitRun(repo, ['read-tree', rev], { env }).status !== 0) throw new Error(`cannot read the tree of ${rev}`);
		const out = gitRun(repo, ['checkout-index', '-a', `--prefix=${dest.split(path.sep).join('/')}/`], { env });
		if (out.status !== 0) throw new Error(`cannot write the tree of ${rev}: ${String(out.stderr).trim()}`);
		return fn(dest);
	} finally {
		kitTemp.removeTemp(dir);
	}
}

// Runs each file in the tree; one past the time limit is listed as timed out.
function runFiles(dir, files, ms) {
	const states = new Map();
	const timedOut = [];
	for (const f of files) {
		const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', path.join(dir, f)], { cwd: dir, encoding: 'utf8', timeout: ms, killSignal: 'SIGKILL', maxBuffer: 1 << 26, env: childEnv() });
		if (r.error && r.error.code === 'ETIMEDOUT') timedOut.push(f);
		states.set(f, parseTap(r.stdout));
	}
	return { states, timedOut };
}

// Runs the rules over the commits, oldest first: fault lines (stderr), owner yes lines (stdout).
function check(repo, hashes, ms) {
	const commits = hashes.map((h) => commitOf(repo, h));
	const rangeTests = [...new Set(commits.flatMap((c) => c.tests))].sort();
	const faults = [];
	const notes = [];
	const reported = new Set();
	const memo = new Map();
	const fault = (c, why) => faults.push(`${c.short} ${c.subject}: ${why}`);
	// Files run in one commit's tree, memoized; one past the limit is a fault on that commit.
	const runOn = (c, rev, files) => {
		const key = `${rev}|${files.join(',')}`;
		if (!memo.has(key)) memo.set(key, rev === undefined || files.length === 0 ? { states: new Map(), timedOut: [] } : withTree(repo, rev, (dir) => runFiles(dir, files, ms)));
		const run = memo.get(key);
		for (const f of run.timedOut) {
			const k = `${c.short}|${f}`;
			if (!reported.has(k)) {
				reported.add(k);
				fault(c, `timed out: ${f} ran past ${ms} ms`);
			}
		}
		return run;
	};
	let window = []; // test commits since the last source commit: the red candidates
	for (const c of commits) {
		if (c.type === 'retest') notes.push(`owner yes needed: ${c.short} ${c.subject}`);
		if (c.cls === 'mixed') {
			fault(c, MIXED);
			window = [];
		} else if (c.cls === 'test') {
			if (c.type === 'refactor') fault(c, 'refactor changed a test file');
			else if (UNCHECKED.has(c.type)) fault(c, `a ${c.type}: commit changes a test file; use retest: for a test change`);
			else if (c.type !== 'retest') {
				const removed = removedNames(repo, c);
				if (removed.length) fault(c, `deletes ${removed.map((n) => JSON.stringify(n)).join(', ')}; use retest:`);
				const touched = new Map(c.tests.map((f) => [f, touchedTests(repo, c.hash, f)]));
				const run = runOn(c, c.hash, [...touched.keys()]);
				if (pick(touched, run, (s) => s !== 'pass').length === 0) fault(c, NO_RED_TEST);
				window.push(c);
			}
		} else {
			if ((c.type === 'feat' || c.type === 'fix') && window.length === 0) fault(c, NO_RED);
			else if (c.type === 'feat' || c.type === 'fix') {
				// Each window test is red on its tree; each touched test is green here.
				const all = new Map();
				for (const r of window) {
					const touched = new Map(r.tests.map((f) => [f, touchedTests(repo, r.hash, f)]));
					const early = pick(touched, runOn(r, r.hash, [...touched.keys()]), (s) => s === 'pass');
					if (early.length) fault(r, `passed before the code: ${early.join(', ')}`);
					for (const [f, names] of touched) all.set(f, new Set([...(all.get(f) || []), ...names]));
				}
				// A test the feat no longer holds (removed later in the window) is not read.
				for (const [f, names] of all) {
					const now = new Set(testsIn(gitShow(repo, c.hash, f) || '').map((t) => t.name));
					all.set(f, new Set([...names].filter((n) => now.has(n))));
				}
				const run = runOn(c, c.hash, [...all.keys()]);
				const late = pick(all, run, (s) => s === 'fail');
				const skipped = pick(all, run, (s) => s === 'skip');
				if (late.length) fault(c, `still fails after the code: ${late.join(', ')}`);
				if (skipped.length) fault(c, `skipped after the code: ${skipped.join(', ')}`);
			} else if (c.type === 'refactor') {
				const passing = (run, f) => new Set([...(run.states.get(f) || [])].filter(([, s]) => s === 'pass').map(([n]) => n));
				const same = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
				const before = runOn(c, c.parent, rangeTests);
				const after = runOn(c, c.hash, rangeTests);
				if (!rangeTests.every((f) => same(passing(before, f), passing(after, f)))) fault(c, 'refactor changed which tests pass');
			}
			window = [];
		}
	}
	return { faults, notes };
}

function parseArgs(argv) {
	const out = { repo: process.cwd(), timeout: 120000 };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (['--repo', '--timeout', '--plan', '--unit'].includes(a)) {
			const v = argv[++i];
			if (v === undefined || (a === '--timeout' && !(/^\d+$/.test(v) && Number(v) > 0))) return null;
			out[a.slice(2)] = a === '--timeout' ? Number(v) : v;
		} else if (out.range === undefined) out.range = a;
		else return null;
	}
	if (out.range === undefined || !out.range.includes('..') || (out.plan === undefined) !== (out.unit === undefined)) return null;
	out.repo = path.resolve(out.repo);
	return out;
}

function run(args) {
	const { range, repo, timeout } = args;
	if (gitRun(repo, ['rev-parse', '--git-dir']).status !== 0) {
		process.stderr.write(`not a git repo: ${repo}\n`);
		return 2;
	}
	const listed = gitRun(repo, ['rev-list', '--reverse', range]);
	if (listed.status !== 0) {
		process.stderr.write(`bad range ${range}: ${String(listed.stderr).trim()}\n`);
		return 2;
	}
	const hashes = listed.stdout.split('\n').filter(Boolean);
	if (hashes.length === 0) {
		process.stderr.write(`empty range: ${range} has no commits\n`);
		return 2;
	}
	for (const m of gitOut(repo, ['rev-list', '--merges', range]).split('\n').filter(Boolean)) {
		process.stderr.write(`merge commit ${gitOut(repo, ['rev-parse', '--short', m]).trim()}: a merge is not checked; check the commits it brings in\n`);
		return 2;
	}
	const { faults, notes } = check(repo, hashes, timeout);
	if (args.plan !== undefined) faults.push(...countGate(repo, hashes, args.plan, args.unit));
	for (const n of notes) process.stdout.write(`${n}\n`);
	if (faults.length) {
		process.stderr.write(`${faults.join('\n')}\n`);
		return 1;
	}
	return 0;
}

function main(argv) {
	const args = parseArgs(argv);
	if (!args) {
		process.stderr.write(USAGE);
		return 2;
	}
	try {
		return run(args);
	} catch (e) {
		process.stderr.write(`unit-check: ${e.message}\n`);
		return 2;
	}
}

// Runs only when started directly; real paths, so a junction or symlink still runs it.
function runDirectly() {
	try {
		return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
	} catch {
		return false;
	}
}
if (runDirectly()) process.exitCode = main(process.argv.slice(2));
