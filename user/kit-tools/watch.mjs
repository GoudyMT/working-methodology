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

/**
 * A program by its full path, never by a bare name: on Windows a program in the current folder runs before PATH, so a
 * pass started by hand inside an untrusted clone ran that clone's gh.exe (the build 13 sweep). Only absolute PATH
 * folders count, the current folder never; PowerShell comes from the system folder.
 */
export function program(name, { pathVar = process.env.PATH, cwd = process.cwd(), platform = process.platform, systemRoot = process.env.SystemRoot } = {}) {
	if (platform === 'win32' && name === 'powershell') return path.join(systemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
	const file = platform === 'win32' ? `${name}.exe` : name;
	for (const d of String(pathVar || '').split(platform === 'win32' ? ';' : ':')) {
		if (!d || !path.isAbsolute(d) || path.resolve(d).toLowerCase() === path.resolve(cwd).toLowerCase()) continue;
		const p = path.join(d, file);
		if (fs.existsSync(p)) return p;
	}
	throw new Error(`${name} is not in any absolute PATH folder`);
}

function ghRead(repo, pr) {
	return JSON.parse(execFileSync(program('gh'), readArgs(repo, pr), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, windowsHide: true }));
}

// A Windows desktop alert; the text goes in as an argument, never as script. Elsewhere the log is the alert.
function toast(text) {
	if (process.platform !== 'win32') return;
	execFileSync(program('powershell'), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(path.dirname(SELF), 'watch-toast.ps1'), 'Kit watcher', text], { stdio: 'ignore', timeout: 30000, windowsHide: true });
}

// A relative CLAUDE_CONFIG_DIR would put the watch folder wherever the command runs (the build 13 sweep).
function home() {
	const set = process.env.CLAUDE_CONFIG_DIR;
	return set && path.isAbsolute(set) ? set : path.join(os.homedir(), '.claude');
}

/** The Task Scheduler lines, or a refusal for a path the quoting cannot carry ($, a backtick or a quote). */
export function scheduleLines(node, script, configDir = process.env.CLAUDE_CONFIG_DIR) {
	const bad = [node, script].find((p) => !/^[A-Za-z0-9 _.:/\\()-]+$/.test(p));
	if (bad) return { ok: false, text: `watch: ${bad} holds a character the schedule line cannot quote safely (a $, a backtick or a quote); move the kit or node to a plain path first. Nothing printed to run.` };
	const lines = [`schtasks /Create /SC MINUTE /MO 5 /TN "Kit watcher" /TR "conhost.exe --headless '${node}' '${script}' once" /F`,
		'Runs every 5 minutes while you are logged on; it only reads PRs you added and shows a desktop alert. To stop it:',
		'schtasks /Delete /TN "Kit watcher" /F'];
	if (configDir) lines.push(`CLAUDE_CONFIG_DIR is set in this shell (${configDir}): the task reads it only if it is set for your account, not just this shell.`);
	return { ok: true, text: lines.join('\n') };
}

/** The command line, with the read, the alert, the clock and the folder injectable for tests. */
export function main(argv, { dir = path.join(home(), 'kit-watch'), read = ghRead, alert = toast, now = Date.now, print = (s) => process.stdout.write(`${s}\n`) } = {}) {
	const [cmd, ...rest] = argv;
	const file = path.join(dir, 'watch.json');
	const load = () => { try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(j.entries) ? j.entries : []; } catch { return []; } };
	const save = (entries) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(`${file}.tmp`, JSON.stringify({ entries }, null, 1)); fs.renameSync(`${file}.tmp`, file); };
	// A log that is a link (a hard link or a symlink planted in the folder) is dropped, not followed: the watcher
	// writes inside its own folder only (the build 13 sweep).
	const log = (o) => {
		fs.mkdirSync(dir, { recursive: true });
		const at = path.join(dir, 'watch.log');
		try { const st = fs.lstatSync(at); if (st.isSymbolicLink() || st.nlink > 1 || !st.isFile()) fs.rmSync(at, { force: true }); } catch { /* none yet */ }
		fs.appendFileSync(at, JSON.stringify({ at: new Date(now()).toISOString(), ...o }) + '\n');
	};
	// What a hand-edited entry carries goes into the log cut short.
	const shown = (v) => JSON.stringify(v ?? null).slice(0, 120);
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
		// The bounds hold at the pass too, not only at add: watch.json is a plain file, so a hand-edited list past the
		// cap, an expiry past the limit or a negative failure count is cut back here (the build 13 sweep).
		const all = load();
		if (all.length > MAX_ENTRIES) log({ event: 'triage', why: `the list holds ${all.length} entries; only the first ${MAX_ENTRIES} are read and kept` });
		for (const e of all.slice(0, MAX_ENTRIES)) {
			const expires = Date.parse(e && e.expires);
			if (!e || !Number.isFinite(expires) || expires <= now()) { log({ event: 'expired', repo: validRepo(e && e.repo) ? e.repo : shown(e && e.repo), pr: validPr(e && e.pr) ? e.pr : shown(e && e.pr) }); continue; }
			if (expires > now() + MAX_HOURS * HOUR) { log({ event: 'triage', why: `an expiry past ${MAX_HOURS} hours: ${shown([e.repo, e.pr, e.expires])}; dropped` }); continue; }
			if (!validRepo(e.repo) || !validPr(e.pr)) { log({ event: 'triage', why: `not a repo and PR number the watcher can read safely: ${shown([e.repo, e.pr])}` }); continue; }
			e.fails = Number.isInteger(e.fails) && e.fails > 0 ? e.fails : 0;
			e.stopped = e.stopped === true || e.fails >= STOP_AFTER;
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
		const s = scheduleLines(posix(process.execPath), posix(SELF));
		print(s.text);
		return s.ok ? 0 : 1;
	}
	return usage();
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) process.exitCode = main(process.argv.slice(2));
