#!/usr/bin/env node
// What a PR's test job runs (T15, the owner's pick 2026-11-12: "Only what it touches"): the tests the change reaches,
// by the coverage map main's last push made, or the whole suite when the selection cannot be trusted. The security
// tests and the guard proofs run on every PR whatever this says; the whole suite runs on every push to main and
// before every release.
//   node scripts/pr-scope.mjs <base>     prints "scope=changed" or "scope=full", and "why=<reason>" (GITHUB_OUTPUT lines)
// The whole suite, when: no map for the base commit; a deleted file; or a change to what the selection itself rests
// on or what every test reads (the workflows, the runner, the harness, the map tracer, a package file, the kit config,
// git attributes). The kit teaches the same rule for a commit hook (rule:test-and-review-cadence).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// The map itself too: one a PR commits would choose what that PR runs (the security review of this build).
export const RISKY = /^(\.github\/|tests\/\.map\.json$|scripts\/test-run\.mjs$|scripts\/pr-scope\.mjs$|tests\/harness\.mjs$|tests\/map-trace\.cjs$|package(-lock)?\.json$|kit\.config\.json$|\.gitattributes$|project\/\.claude\/kit-temp\.cjs$)/;

export function scope(root, base) {
	const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
	const sha = git('rev-parse', '--verify', '--end-of-options', `${base}^{commit}`).stdout.trim();
	if (!/^[0-9a-f]{40,64}$/.test(sha)) return { scope: 'full', why: `the base ${base} is not a commit` };
	let map = null;
	try { map = JSON.parse(fs.readFileSync(path.join(root, 'tests', '.map.json'), 'utf8')); } catch { /* none */ }
	if (!map || map.sha !== sha) return { scope: 'full', why: `no coverage map for the base commit ${sha.slice(0, 9)}` };
	const diff = git('diff', '--name-status', '--no-renames', `${sha}...HEAD`);
	if (diff.status !== 0) return { scope: 'full', why: 'the change could not be read' };
	for (const [status, file] of diff.stdout.split('\n').filter(Boolean).map((l) => l.split('\t'))) {
		if (status === 'D') return { scope: 'full', why: `${file} is deleted` };
		if (RISKY.test(file)) return { scope: 'full', why: `${file} changed, and every test rests on it` };
	}
	return { scope: 'changed', why: 'the tests the change reaches, by the map' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	const base = process.argv[2];
	const r = base ? scope(process.cwd(), base) : { scope: 'full', why: 'no base given' };
	process.stdout.write(`scope=${r.scope}\nwhy=${r.why}\n`);
}
