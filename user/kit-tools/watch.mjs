#!/usr/bin/env node
// The watcher for pending work (E13; T7 slice 2, build 13; the owner's lock A, 2026-11-03). Nothing watched across
// threads: PR 17 sat green for 7 minutes waiting for a person. This script reads pull request state on a schedule and
// tells the owner when one turns ready. It never acts: its only program is one fixed gh read, run with an argument
// list and no shell, and the alert. It lives in the Claude folder, so one watcher serves every project.
//
// Usage:
//   node watch.mjs add <owner/repo> <pr> [--hours <n>]   watch a PR (48 hours by default, 336 at most; again renews it)
//   node watch.mjs remove <owner/repo> <pr> | list
//   node watch.mjs once                                   one pass: what the schedule runs
//   node watch.mjs schedule                               prints the Task Scheduler lines; the owner runs them
//
// Bounds (lock A): at most 20 entries; each expires; three failed reads in a row stop an entry with a triage line and
// one alert; a file named watch-off in the watch folder stops every pass before any read. The schedule is registered
// only by the owner, never by install. It runs outside Claude Code, so its guard hooks never see it: the read-only
// promise is this file's, and a test fails on any other program.
//
// Folder: <Claude folder>/kit-watch (watch.json, watch.log, watch-off). Exit 0 done, 1 refused, 2 a usage error.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIELDS = 'state,mergeStateStatus,headRefOid,statusCheckRollup';
const MAX_ENTRIES = 20;
const MAX_HOURS = 336;
const STOP_AFTER = 3;
const HOUR = 3600 * 1000;
const REPO = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9_.][A-Za-z0-9_.-]*$/;
const SELF = fileURLToPath(import.meta.url);
const posix = (p) => p.split(path.sep).join('/');

/** The one read the watcher runs: gh's argument list for a PR, fixed fields, no shell. */
export const readArgs = (repo, pr) => ['pr', 'view', String(pr), '--repo', repo, '--json', FIELDS];
const validRepo = (r) => typeof r === 'string' && REPO.test(r) && !r.split('/').some((p) => p === '.' || p === '..');
const validPr = (n) => Number.isInteger(n) && n > 0;

/** pending, green, failed, conflict, merged or closed: what the owner would want to know. */
export function verdict(p) {
	if (p.state === 'MERGED') return 'merged';
	if (p.state !== 'OPEN') return 'closed';
	if (p.mergeStateStatus === 'DIRTY') return 'conflict';
	const checks = Array.isArray(p.statusCheckRollup) ? p.statusCheckRollup : [];
	if (!checks.length || checks.some((c) => (c.status || 'COMPLETED') !== 'COMPLETED')) return 'pending';
	return checks.every((c) => ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(c.conclusion || c.state)) ? 'green' : 'failed';
}

function ghRead(repo, pr) {
	return JSON.parse(execFileSync('gh', readArgs(repo, pr), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, windowsHide: true }));
}

// A Windows desktop alert; the text goes in as an argument, never as script. Elsewhere the log is the alert.
function toast(text) {
	if (process.platform !== 'win32') return;
	execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(path.dirname(SELF), 'watch-toast.ps1'), 'Kit watcher', text], { stdio: 'ignore', timeout: 30000, windowsHide: true });
}

function home() {
	return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

/** The command line, with the read, the alert, the clock and the folder injectable for tests. */
export function main(argv, { dir = path.join(home(), 'kit-watch'), read = ghRead, alert = toast, now = Date.now, print = (s) => process.stdout.write(`${s}\n`) } = {}) {
	const [cmd, ...rest] = argv;
	const file = path.join(dir, 'watch.json');
	const load = () => { try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(j.entries) ? j.entries : []; } catch { return []; } };
	const save = (entries) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(`${file}.tmp`, JSON.stringify({ entries }, null, 1)); fs.renameSync(`${file}.tmp`, file); };
	const log = (o) => { fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(path.join(dir, 'watch.log'), JSON.stringify({ at: new Date(now()).toISOString(), ...o }) + '\n'); };
	const usage = () => { print(`usage: node ${posix(SELF)} add <owner/repo> <pr> [--hours <n>] | remove <owner/repo> <pr> | list | once | schedule`); return 2; };
	const target = () => {
		const [repo, n] = rest;
		const pr = /^\d+$/.test(String(n)) ? Number(n) : NaN;
		return validRepo(repo) && validPr(pr) ? { repo, pr } : null;
	};

	if (cmd === 'add') {
		const t = target();
		const i = rest.indexOf('--hours');
		const hours = i >= 0 ? Number(rest[i + 1]) : 48;
		if (!t || !Number.isFinite(hours) || hours <= 0 || hours > MAX_HOURS) { print(`watch: needs <owner/repo> <pr number> and at most ${MAX_HOURS} hours.`); return usage(); }
		const entries = load().filter((e) => !(e.repo === t.repo && e.pr === t.pr));
		if (entries.length >= MAX_ENTRIES) { print(`watch: the list holds ${MAX_ENTRIES} entries, its limit; remove one first. Nothing written.`); return 1; }
		entries.push({ ...t, expires: new Date(now() + hours * HOUR).toISOString(), last: null, fails: 0, stopped: false });
		save(entries);
		print(`watch: PR ${t.pr} in ${t.repo} until ${entries[entries.length - 1].expires}.`);
		return 0;
	}
	if (cmd === 'remove') {
		const t = target();
		if (!t) return usage();
		save(load().filter((e) => !(e.repo === t.repo && e.pr === t.pr)));
		print(`watch: PR ${t.pr} in ${t.repo} removed.`);
		return 0;
	}
	if (cmd === 'list') {
		const entries = load();
		print(entries.length ? entries.map((e) => `${e.repo}#${e.pr}  ${e.stopped ? 'stopped' : e.last || 'not read yet'}  until ${e.expires}`).join('\n') : 'watch: nothing is watched.');
		return 0;
	}
	if (cmd === 'once') {
		if (fs.existsSync(path.join(dir, 'watch-off'))) { log({ event: 'killed' }); return 0; }
		const keep = [];
		for (const e of load()) {
			if (!e || Date.parse(e.expires) <= now() || !Number.isFinite(Date.parse(e.expires))) { log({ event: 'expired', repo: e && e.repo, pr: e && e.pr }); continue; }
			if (!validRepo(e.repo) || !validPr(e.pr)) { log({ event: 'triage', pr: e.pr, why: `not a repo and PR number the watcher can read safely: ${JSON.stringify([e.repo, e.pr]).slice(0, 120)}` }); continue; }
			if (e.stopped) { keep.push(e); continue; }
			let p;
			try { p = read(e.repo, e.pr); } catch (err) {
				const why = String((err && (err.stderr || err.message)) || err).trim().split('\n')[0].slice(0, 200);
				e.fails = (e.fails || 0) + 1;
				log({ event: 'triage', repo: e.repo, pr: e.pr, fails: e.fails, why });
				if (e.fails >= STOP_AFTER) {
					e.stopped = true;
					alert(`Kit watcher stopped watching PR ${e.pr} in ${e.repo} after ${STOP_AFTER} failed reads: ${why}`);
				}
				keep.push(e);
				continue;
			}
			e.fails = 0;
			const v = verdict(p || {});
			if (v !== e.last) {
				log({ event: 'change', repo: e.repo, pr: e.pr, was: e.last, now: v, head: String((p && p.headRefOid) || '').slice(0, 7) });
				if (v !== 'pending') alert(`PR ${e.pr} in ${e.repo}: ${v}`);
				e.last = v;
			} else log({ event: 'same', repo: e.repo, pr: e.pr, now: v });
			if (v !== 'merged' && v !== 'closed') keep.push(e);
		}
		save(keep);
		return 0;
	}
	if (cmd === 'schedule') {
		// Both paths in single quotes inside /TR: schtasks turns them into double quotes, so a path with spaces holds.
		// conhost --headless runs node with no console window, so a pass every 5 minutes does not flash one.
		print([`schtasks /Create /SC MINUTE /MO 5 /TN "Kit watcher" /TR "conhost.exe --headless '${posix(process.execPath)}' '${posix(SELF)}' once" /F`,
			'Runs every 5 minutes while you are logged on; it only reads PRs you added and shows a desktop alert. To stop it:',
			'schtasks /Delete /TN "Kit watcher" /F'].join('\n'));
		return 0;
	}
	return usage();
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) process.exitCode = main(process.argv.slice(2));
