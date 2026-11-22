#!/usr/bin/env node
// U4 (build 24, K308): the lead's lock for a unit. Run once the red commit has landed: it writes kit-unit-files.txt at
// `git rev-parse --git-path kit-unit-files.txt` (the worktree's own git folder, never committed), first line "# red <sha>",
// then the source files the unit may change. The builder's edit fence then keeps it to those files. Usage:
// node unit-lock.mjs <red sha> --files a.js,b.js. Exit 0 and print the list; exit 1 naming each test file given (a lock
// takes source files only, and writes nothing); exit 2 when the red point is not a commit, or the arguments are wrong.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const LIST = 'kit-unit-files.txt';
// A test file, as unit-check counts it: in a test, tests, __tests__ or spec folder, or named *.test.* or *.spec.*.
const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'spec']);
const isTestFile = (rel) => {
	const parts = rel.split('/');
	return parts.slice(0, -1).some((d) => TEST_DIRS.has(d)) || /\.(test|spec)\./.test(parts[parts.length - 1]);
};

// git in the current folder, started from node's own folder with the lookup switched off, as pr-size.mjs starts it.
const git = (args) => spawnSync('git', ['-C', process.cwd(), '-c', 'core.fsmonitor=false', ...args], {
	encoding: 'utf8',
	timeout: 60000,
	windowsHide: true,
	cwd: path.dirname(process.execPath),
	env: { ...process.env, NoDefaultCurrentDirectoryInExePath: '1' },
});

function main(argv) {
	const [sha, flag, list] = argv;
	if (!sha || sha.startsWith('-') || flag !== '--files' || list === undefined) {
		console.error('usage: node unit-lock.mjs <red sha> --files a.js,b.js');
		return 2;
	}
	const inside = git(['rev-parse', '--is-inside-work-tree']);
	if (inside.status !== 0 || inside.stdout.trim() !== 'true') {
		console.error('unit-lock: not inside a git repository');
		return 2;
	}
	const red = git(['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]);
	if (red.status !== 0) {
		console.error(`unit-lock: ${sha} is not a commit, so the unit cannot be locked to it`);
		return 2;
	}
	const files = list.split(',').map((f) => f.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '')).filter(Boolean);
	if (files.length === 0) {
		console.error('unit-lock: --files names no source file');
		return 2;
	}
	const tests = files.filter(isTestFile);
	if (tests.length > 0) {
		for (const t of tests) console.error(`unit-lock: ${t} is a test file; a unit lock takes source files only, and nothing was written`);
		return 1;
	}
	const where = git(['rev-parse', '--path-format=absolute', '--git-path', LIST]);
	if (where.status !== 0) {
		console.error(`unit-lock: cannot find ${LIST}: ${String(where.stderr).trim()}`);
		return 2;
	}
	const text = [`# red ${red.stdout.trim()}`, ...files].join('\n') + '\n';
	fs.writeFileSync(where.stdout.trim(), text);
	process.stdout.write(text);
	return 0;
}

process.exitCode = main(process.argv.slice(2));
