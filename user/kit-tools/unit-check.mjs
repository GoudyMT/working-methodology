#!/usr/bin/env node
// K309 and K312 (build 24): a unit's history proves test-first only when its commits have the right shape. Prose did
// not hold that record, so this reads a commit range and checks the shape: a test-only red commit before each feat or
// fix, red tests that fail on their own tree and pass on the code's, refactors that leave the tests alone, and retest
// commits that need the owner's yes. The trial prototype was overhaul/redgreen-check.mjs.
//
// Usage: node unit-check.mjs <base>..<head> [--repo <dir>]   (exit 0 all pass, 1 faults on stderr, 2 bad use)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'spec']);
// A commit of these types is not red: its tests (if any) are not a red commit, and it skips the red and green checks.
const NOT_RED = new Set(['retest', 'refactor', 'docs', 'chore', 'build', 'ci']);
// The first string argument of a test( call; t.test( and an import of node:test do not match.
const TEST_CALL = /(?:^|[^\w.])test\(\s*(['"`])(.+?)\1/;
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
const MIXED = 'mixed: the commit touches source and test files; split it';
const NO_RED = 'no red commit before it';
const NO_RED_TEST = 'test changed without a red test; use retest:';

// A test file is under a folder named test, tests, __tests__ or spec, or is named *.test.* or *.spec.*.
const isTestFile = (rel) => {
	const parts = rel.split('/');
	return parts.slice(0, -1).some((d) => TEST_DIRS.has(d)) || /\.(test|spec)\./.test(parts[parts.length - 1]);
};

// The kit runner's switches and node:test's context stay out of the child runs, so each file reports as its own run.
const childEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^KIT_|^NODE_TEST_CONTEXT$/.test(k)));
const git = (repo, args, env) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 28, env });
function gitOut(repo, args) {
	const r = git(repo, args);
	if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.trim()}`);
	return r.stdout;
}

// Writes a commit's tree into a new temp folder through a temp index, so the repo, its index and its working tree stay as they were.
function withTree(repo, rev, fn) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-check-'));
	try {
		const env = { ...process.env, GIT_INDEX_FILE: path.join(dir, 'index') };
		const dest = path.join(dir, 'tree');
		fs.mkdirSync(dest);
		if (git(repo, ['read-tree', rev], env).status !== 0) throw new Error(`cannot read the tree of ${rev}`);
		const out = git(repo, ['checkout-index', '-a', `--prefix=${dest.split(path.sep).join('/')}/`], env);
		if (out.status !== 0) throw new Error(`cannot export the tree of ${rev}: ${out.stderr.trim()}`);
		return fn(dest);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

// The test names each file reports as ok on a commit's tree. A file that cannot load reports none.
function passingIn(repo, rev, files) {
	const out = new Map(files.map((f) => [f, new Set()]));
	if (rev === undefined || files.length === 0) return out;
	withTree(repo, rev, (dir) => {
		for (const f of files) {
			const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', f], { cwd: dir, encoding: 'utf8', env: childEnv() });
			for (const line of r.stdout.split(/\r?\n/)) {
				const m = /^ok \d+ - (.*)$/.exec(line);
				if (m) out.get(f).add(m[1].replace(/ # (SKIP|TODO).*$/, ''));
			}
		}
	});
	return out;
}

// The names of the tests a commit adds or changes: a test block (from its test( call to the next one) holding an added line.
function touchedTests(repo, hash, file) {
	const names = new Set();
	const show = git(repo, ['show', `${hash}:${file}`]);
	if (show.status !== 0) return names; // deleted in this commit: no test of it is touched
	const added = new Set();
	for (const l of gitOut(repo, ['show', '--format=', '--unified=0', hash, '--', file]).split('\n')) {
		const h = HUNK.exec(l);
		if (h) for (let i = 0; i < (h[2] === undefined ? 1 : Number(h[2])); i++) added.add(Number(h[1]) + i);
	}
	const lines = show.stdout.split('\n');
	const starts = [];
	lines.forEach((l, i) => {
		const m = TEST_CALL.exec(l);
		if (m) starts.push({ at: i + 1, name: m[2] });
	});
	starts.forEach((s, k) => {
		const end = k + 1 < starts.length ? starts[k + 1].at - 1 : lines.length;
		for (let n = s.at; n <= end; n++) {
			if (added.has(n)) {
				names.add(s.name);
				return;
			}
		}
	});
	return names;
}

// Map of each test file a commit changes to its touched test names.
const touchedMap = (repo, c) => new Map(c.tests.map((f) => [f, touchedTests(repo, c.hash, f)]));

// The touched names whose pass state (in the passing map) equals ok.
function pick(touched, passing, ok) {
	const out = new Set();
	for (const [f, names] of touched) for (const n of names) if (passing.get(f).has(n) === ok) out.add(n);
	return [...out];
}

function commitOf(repo, hash) {
	const subject = gitOut(repo, ['log', '-1', '--format=%s', hash]).trim();
	const files = gitOut(repo, ['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', hash]).split('\n').filter(Boolean);
	const tests = files.filter(isTestFile);
	const cls = tests.length === 0 ? 'source' : tests.length === files.length ? 'test' : 'mixed';
	const type = (/^([a-z]+)(\([^)]*\))?!?:/.exec(subject) || [])[1] || '';
	const parent = gitOut(repo, ['rev-list', '--parents', '-n', '1', hash]).trim().split(' ')[1];
	return { hash, short: gitOut(repo, ['rev-parse', '--short', hash]).trim(), subject, files, tests, cls, type, parent };
}

// Runs every rule over the commits, oldest first. Returns the fault lines and the owner yes lines.
function check(repo, hashes) {
	const commits = hashes.map((h) => commitOf(repo, h));
	const rangeTests = [...new Set(commits.flatMap((c) => c.tests))].sort();
	const faults = [];
	const notes = [];
	const fault = (c, why) => faults.push(`${c.short} ${c.subject}: ${why}`);
	let window = []; // the test commits since the previous source commit: the candidates for a red commit
	for (const c of commits) {
		if (c.type === 'retest') notes.push(`owner yes needed: ${c.short} ${c.subject}`);
		if (c.cls === 'mixed') {
			fault(c, MIXED);
			window = [];
			continue;
		}
		if (c.cls === 'test') {
			if (c.type === 'refactor') fault(c, 'refactor changed a test file');
			else if (!NOT_RED.has(c.type)) {
				const touched = touchedMap(repo, c);
				const onOwn = passingIn(repo, c.hash, [...touched.keys()]);
				if (pick(touched, onOwn, false).length === 0) fault(c, NO_RED_TEST);
				window.push(c);
			}
			continue;
		}
		if (c.type === 'feat' || c.type === 'fix') {
			if (window.length === 0) fault(c, NO_RED);
			else {
				const red = window[window.length - 1];
				const touched = touchedMap(repo, red);
				const files = [...touched.keys()];
				const early = pick(touched, passingIn(repo, red.hash, files), true);
				if (early.length) fault(red, `passed before the code: ${early.join(', ')}`);
				const late = pick(touched, passingIn(repo, c.hash, files), false);
				if (late.length) fault(c, `still fails after the code: ${late.join(', ')}`);
			}
		} else if (c.type === 'refactor') {
			const before = passingIn(repo, c.parent, rangeTests);
			const after = passingIn(repo, c.hash, rangeTests);
			const same = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
			if (!rangeTests.every((f) => same(before.get(f), after.get(f)))) fault(c, 'refactor changed which tests pass');
		}
		window = [];
	}
	return { faults, notes };
}

function parseArgs(argv) {
	let range;
	let repo = process.cwd();
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--repo') {
			if (argv[i + 1] === undefined) return null;
			repo = argv[++i];
		} else if (range === undefined) range = argv[i];
		else return null;
	}
	return range === undefined || !range.includes('..') ? null : { range, repo: path.resolve(repo) };
}

function main(argv) {
	const args = parseArgs(argv);
	if (!args) {
		process.stderr.write('usage: node unit-check.mjs <base>..<head> [--repo <dir>]\n');
		return 2;
	}
	const { range, repo } = args;
	if (git(repo, ['rev-parse', '--git-dir']).status !== 0) {
		process.stderr.write(`not a git repo: ${repo}\n`);
		return 2;
	}
	const listed = git(repo, ['rev-list', '--reverse', range]);
	if (listed.status !== 0) {
		process.stderr.write(`bad range ${range}: ${listed.stderr.trim()}\n`);
		return 2;
	}
	const hashes = listed.stdout.split('\n').filter(Boolean);
	if (hashes.length === 0) {
		process.stderr.write(`empty range: ${range} has no commits\n`);
		return 2;
	}
	const { faults, notes } = check(repo, hashes);
	for (const n of notes) process.stdout.write(`${n}\n`);
	if (faults.length) {
		process.stderr.write(`${faults.join('\n')}\n`);
		return 1;
	}
	return 0;
}

// Run only when started directly, never when a test or tool imports it.
// Real paths on both sides, so a run through a junction or symlink still checks.
function runDirectly() {
	try {
		return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
	} catch {
		return false;
	}
}
if (runDirectly()) process.exitCode = main(process.argv.slice(2));
