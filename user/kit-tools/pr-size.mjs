#!/usr/bin/env node
// E36 (build 24): the writer's size rule. A branch that changes ten files or fewer goes to steps.writer, more to
// steps.writer-large, both read from kit.config.json beside this kit, so the model follows the diff, not a hand pick.
// Usage: node pr-size.mjs [base]. The base defaults to origin/main when it exists, else main. Prints one line,
// "writer: <model> (<n> files)"; exit 0. Exit 2 outside a git repository, on a base that cannot be diffed, or when
// kit.config.json cannot give the model.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const LIMIT = 10;

// git in the current folder, started from node's own folder with the lookup switched off, as the guard hooks start it,
// so a git.exe a project left in its folder never runs in its place.
const git = (args) => spawnSync('git', ['-C', process.cwd(), '-c', 'core.fsmonitor=false', ...args], {
	encoding: 'utf8',
	timeout: 60000,
	windowsHide: true,
	cwd: path.dirname(process.execPath),
	env: { ...process.env, NoDefaultCurrentDirectoryInExePath: '1' },
});

function main(argv) {
	const inside = git(['rev-parse', '--is-inside-work-tree']);
	if (inside.status !== 0 || inside.stdout.trim() !== 'true') {
		console.error('pr-size: not inside a git repository');
		return 2;
	}
	const base = argv[0] || (git(['rev-parse', '--verify', '--quiet', 'origin/main']).status === 0 ? 'origin/main' : 'main');
	if (base.startsWith('-')) {
		console.error(`pr-size: the base ${base} is not a branch name`);
		return 2;
	}
	const diff = git(['diff', '--name-only', `${base}...HEAD`]);
	if (diff.status !== 0) {
		console.error(`pr-size: cannot diff against ${base}: ${String(diff.stderr).trim()}`);
		return 2;
	}
	const n = diff.stdout.split('\n').filter(Boolean).length;
	const config = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'kit.config.json');
	let steps;
	try {
		steps = JSON.parse(fs.readFileSync(config, 'utf8')).steps;
	} catch (e) {
		console.error(`pr-size: cannot read ${config}: ${e.message}`);
		return 2;
	}
	const step = n <= LIMIT ? 'writer' : 'writer-large';
	const model = steps?.[step]?.model;
	if (!model) {
		console.error(`pr-size: steps.${step} has no model in ${config}`);
		return 2;
	}
	console.log(`writer: ${model} (${n} files)`);
	return 0;
}

process.exitCode = main(process.argv.slice(2));
