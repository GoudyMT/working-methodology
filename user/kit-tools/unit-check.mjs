#!/usr/bin/env node
// K309 and K312 (build 24): a unit's history proves test-first only with the right commit shape: a red test-only commit
// before each feat or fix, refactors that leave tests alone, retests for the owner's yes.
// Usage: node unit-check.mjs <base>..<head> [--repo <dir>] [--timeout <ms>] (exit 0 pass, 1 faults, 2 bad use).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import safeSpawn from './audits/safe-spawn.cjs';

const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'spec']);
const UNCHECKED = new Set(['chore', 'docs', 'build', 'ci']);
const MIXED = 'mixed: the commit touches source and test files; split it';
const NO_RED = 'no red commit before it';
const NO_RED_TEST = 'test changed without a red test; use retest:';
const USAGE = 'usage: node unit-check.mjs <base>..<head> [--repo <dir>] [--timeout <ms>] (node:test projects only)\n';
// A test( call in code (group 1: the char before it; t.test( is no test).
const TEST_CALL = /(^|[^\w.$])test\(/gm;
const NAME = /\s*(['"`])((?:\\.|(?!\1).)*)\1/y;
// Strings, templates and comments, blanked before the search.
const MASK = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|`(?:\\[\s\S]|[^`\\])*`|'(?:\\[\s\S]|[^'\\\n])*'|"(?:\\[\s\S]|[^"\\\n])*"/g;
const BLANK = /^\s*(\/\/|$)/;
// A TAP result line at any indent; a SKIP or TODO directive is read.
const TAP = /^\s*(not ok|ok) \d+ - (.*?)(?: # (SKIP|TODO)\b.*)?$/;
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

// A test file: in a test, tests, __tests__ or spec folder, or named *.test.* or *.spec.*.
const isTestFile = (rel) => {
	const parts = rel.split('/');
	return parts.slice(0, -1).some((d) => TEST_DIRS.has(d)) || /\.(test|spec)\./.test(parts[parts.length - 1]);
};

// The kit runner's switches stay out of the child runs.
const childEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^KIT_|^NODE_TEST_CONTEXT$/.test(k)));
const gitRun = (repo, args, opts = {}) => safeSpawn.gitRead(repo, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
function gitOut(repo, args) {
	const r = gitRun(repo, args);
	if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${String(r.stderr).trim()}`);
	return r.stdout;
}
const gitShow = (repo, rev, file) => {
	const r = gitRun(repo, ['show', `${rev}:${file}`]);
	return r.status === 0 ? r.stdout : null;
};

// The line where the test( call at lines[at], column col, closes.
function closeOf(lines, at, col) {
	let depth = 0;
	let quote = null;
	for (let k = at; k < lines.length; k++) {
		const s = lines[k];
		if (quote && quote !== '`') quote = null;
		for (let c = k === at ? col : 0; c < s.length; c++) {
			const ch = s[c];
			if (quote) {
				if (ch === '\\') c++;
				else if (ch === quote) quote = null;
			} else if (ch === '/' && s[c + 1] === '/') break;
			else if (ch === '"' || ch === "'" || ch === '`') quote = ch;
			else if (ch === '(') depth++;
			else if (ch === ')' && --depth === 0) return k;
		}
	}
	return lines.length - 1;
}

// A file's tests in order; each runs from the comment or blank lines above it to its last line.
function testsIn(text) {
	const src = String(text);
	const lines = src.split('\n');
	const masked = src.replace(MASK, (m) => m.replace(/[^\n]/g, ' '));
	const out = [];
	for (const m of masked.matchAll(TEST_CALL)) {
		const at = m.index + m[1].length;
		NAME.lastIndex = at + 5;
		const n = NAME.exec(src);
		if (n) out.push({ name: n[2].replace(/\\(.)/g, '$1'), start: src.slice(0, at).split('\n').length - 1, col: at - (src.lastIndexOf('\n', at) + 1) });
	}
	let prev = -1;
	for (const t of out) {
		t.end = closeOf(lines, t.start, t.col);
		t.head = t.start;
		while (t.head - 1 > prev && BLANK.test(lines[t.head - 1])) t.head--;
		prev = t.end;
	}
	return out;
}

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
	const re = new RegExp(`^${name.split(/\$\{[^}]*\}/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*?')}$`);
	const made = [...states].filter(([n]) => re.test(n)).map(([, s]) => s);
	if (made.length === 0) return 'fail';
	return made.includes('fail') ? 'fail' : made.includes('skip') ? 'skip' : 'pass';
}

// The touched names that meet keep in their file's run.
const pick = (touched, run, keep) => [...new Set([...touched].flatMap(([f, names]) => [...names].filter((n) => keep(stateOf(run.states.get(f), n)))))];

// A commit's tree in a temp folder, read through a temp index.
function withTree(repo, rev, fn) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-check-'));
	try {
		const env = { ...process.env, GIT_INDEX_FILE: path.join(dir, 'index') };
		const dest = path.join(dir, 'tree');
		fs.mkdirSync(dest);
		if (gitRun(repo, ['read-tree', rev], { env }).status !== 0) throw new Error(`cannot read the tree of ${rev}`);
		const out = gitRun(repo, ['checkout-index', '-a', `--prefix=${dest.split(path.sep).join('/')}/`], { env });
		if (out.status !== 0) throw new Error(`cannot write the tree of ${rev}: ${String(out.stderr).trim()}`);
		return fn(dest);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
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

function commitOf(repo, hash) {
	const subject = gitOut(repo, ['log', '-1', '--format=%s', hash]).trim();
	const files = gitOut(repo, ['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', hash]).split('\n').filter(Boolean);
	const tests = files.filter(isTestFile);
	const cls = tests.length === 0 ? 'source' : tests.length === files.length ? 'test' : 'mixed';
	const type = (/^([a-z]+)(\([^)]*\))?!?:/.exec(subject) || [])[1] || '';
	const p = gitRun(repo, ['rev-parse', '--verify', '-q', `${hash}^`]);
	return { hash, short: gitOut(repo, ['rev-parse', '--short', hash]).trim(), subject, tests, cls, type, parent: p.status === 0 ? p.stdout.trim() : undefined };
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
		if (a === '--repo' || a === '--timeout') {
			const v = argv[++i];
			if (v === undefined) return null;
			if (a === '--repo') out.repo = v;
			else if (/^\d+$/.test(v) && Number(v) > 0) out.timeout = Number(v);
			else return null;
		} else if (out.range === undefined) out.range = a;
		else return null;
	}
	if (out.range === undefined || !out.range.includes('..')) return null;
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
