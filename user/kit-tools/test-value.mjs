#!/usr/bin/env node
// The project's test value step (U21, the owner's ask 2026-11-22): runs the mutation tool that kit.config.json names in
// "mutationCommand", at the project root, and prints its report. With no tool named, or no readable config, it prints
// "not measured". Report only: it exits 0 whatever the tool prints or does (report-only in 1.51.0).
//   node kit-tools/test-value.mjs        (from the project root)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

let cmd = '';
let why = 'no mutationCommand in kit.config.json';
try {
	cmd = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'kit.config.json'), 'utf8')).mutationCommand || '';
} catch {
	why = 'kit.config.json cannot be read';
}
if (typeof cmd !== 'string' || !cmd.trim()) {
	process.stdout.write(`Test value: not measured (${why})\n`);
} else {
	const r = spawnSync(cmd, { cwd: process.cwd(), shell: true, encoding: 'utf8', maxBuffer: 1 << 28 });
	process.stdout.write(r.stdout || '');
	process.stderr.write(r.stderr || '');
	if (r.error || r.status !== 0) process.stdout.write(`Test value: the mutation tool ended with ${r.error ? r.error.message : `exit ${r.status}`}; report only\n`);
}
