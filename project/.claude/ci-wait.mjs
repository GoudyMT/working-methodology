#!/usr/bin/env node
// The CI watch report (K66, the owner 2026-11-15: report each CI run's end without being asked). It waits on the CI runs
// of one commit and prints one line as each ends, green or red (again if a re-run ends differently), a line once a
// run passes ten minutes, and a last line with the result. A session starts it in the background after each push and
// passes each line on to the owner.
//
// K399 (patch 1.51.4, U21): it also writes the CI state file `<git common dir>/kit-ci-state.json` when a run ends (the
// digest of its red jobs, from ci-digest.mjs), and when the first non-rollup job ends red while the run is still open,
// it writes a partial state (settled: false) and exits 1 at once, so the lead can start diagnosing. --settle waits for
// the whole run and writes the full list.
//
// Usage (from the project folder):
//   node .claude/ci-wait.mjs <full commit sha> [--every <seconds>] [--max <minutes>] [--settle]
// It polls `gh run list --commit <sha>` every 15 seconds (10 to 600), for at most 60 minutes (up to 360). The result
// waits for two polls in a row that show the same runs, all finished, so a run that registers late is not missed. A
// commit with no run after 5 minutes is reported and given up. It only reads; gh starts from Node's own folder, so a
// gh.exe planted in the project is not the one found first on Windows.
// Exit 0 every run finished and at least one passed with none red, 1 a run red, 2 no run, none passed, or given up.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { repoOf } from './release-check.mjs';
import { digest, gitDirs, ghRun, readCifix } from './ci-digest.mjs';

const MID = 10 * 60 * 1000;
const NONE = 5 * 60 * 1000;
const one = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
const took = (ms) => `${Math.floor(ms / 60000)}m${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}s`;
const verdict = (c) => (c === 'success' ? 'green' : ['skipped', 'neutral'].includes(c) ? 'skipped' : 'red');

/**
 * Watch one commit's CI runs to their end.
 *
 * Args:
 *     opts: { commit, repo, every (seconds, default 15), max (minutes), settle (wait for the whole run), common (the git
 *             common folder for the state file; default the repo's own), root (the repo; default the cwd) }
 *     deps: { gh(args), sleep(ms), now(), log(line) } - the outside calls, so a test can run the clock
 *
 * Returns:
 *     { code } - 0 all finished, one or more green and none red; 1 a run red; 2 no run, none green, or given up
 */
export async function ciWait({ commit, repo, every = 15, max = 60, settle = false, common, root }, deps = {}) {
	const gh = deps.gh || ghRun;
	const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
	const now = deps.now || (() => Date.now());
	const log = deps.log || ((l) => process.stdout.write(`${l}\n`));
	const start = now();
	const last = new Map();
	const repoRoot = root || process.cwd();
	const folder = common || (gitDirs(repoRoot) || {}).common || null;
	let prior = new Set();
	try {
		prior = new Set(readCifix(repoRoot).lines.map((l) => l && l.key));
	} catch (e) {
		log(`CI: the cifix record could not be read, so no item is held as red again: ${e.message}`);
	}
	// Every gh call names its repo with -R (release-check pins it): the jobs of a run, and one failed job's log.
	const jobsOf = (runId) => {
		const r = gh(['run', 'view', String(runId), '-R', repo, '--json', 'jobs']);
		try { return r.status === 0 ? JSON.parse(r.stdout) : null; } catch { return null; }
	};
	const digestOf = (jobs, runId) => digest(jobs, (job) => {
		const r = gh(['run', 'view', String(runId), '-R', repo, '--log-failed', '--job', String(job.databaseId ?? job.id)]);
		return r.status === 0 ? r.stdout : null;
	}, prior);
	const writeState = (s) => {
		if (!folder) { log('CI: no git folder found: the state file is not written'); return; }
		try {
			fs.writeFileSync(path.join(folder, 'kit-ci-state.json'), `${JSON.stringify(s, null, 2)}\n`);
		} catch (e) {
			log(`CI: the state file could not be written: ${e.code || e.message}`);
		}
	};
	let said = false;
	let settled = null;
	for (;;) {
		const r = gh(['run', 'list', '-R', repo, '--commit', commit, '--json', 'databaseId,name,status,conclusion,url']);
		let runs = null;
		try { runs = r.status === 0 ? JSON.parse(r.stdout) : null; } catch { /* read again next poll */ }
		const t = now() - start;
		for (const run of runs || []) {
			if (run.status !== 'completed') continue;
			const v = verdict(run.conclusion);
			// A run is reported each time it ends with another result: a re-run that turns red is never read as green.
			if (last.get(run.databaseId) === v) continue;
			last.set(run.databaseId, v);
			log(`CI ${one(run.name)}: ${v} (${one(run.conclusion)}) in ${took(t)} ${one(run.url)}`);
		}
		const open = (runs || []).filter((x) => x.status !== 'completed');
		const shape = runs && runs.length && !open.length ? runs.map((x) => `${x.databaseId}:${x.conclusion}`).sort().join(',') : null;
		if (shape && shape === settled) {
			const vs = runs.map((x) => verdict(x.conclusion));
			const red = vs.filter((v) => v === 'red').length;
			const green = vs.filter((v) => v === 'green').length;
			log(`CI done: ${red} red, ${green} green${vs.length - red - green ? `, ${vs.length - red - green} skipped` : ''}, for ${String(commit).slice(0, 12)}`);
			const redRun = runs.find((x) => verdict(x.conclusion) === 'red') || runs[0];
			let failed = [];
			// Unreadable jobs leave a provisional, unsettled entry: never a settled red with no items (F11).
			let settledState = true;
			if (red) {
				const jobs = jobsOf(redRun.databaseId);
				if (jobs) failed = digestOf(jobs, redRun.databaseId).items;
				// Jobs that cannot be read, or that digest to no items, leave a provisional state (F11).
				if (!jobs || failed.length === 0) {
					settledState = false;
					log(jobs ? 'CI: the red run has no failing items yet: the state is provisional until it has' : 'CI: the jobs of the red run could not be read: the state is provisional until they are');
				}
			}
			writeState({ sha: commit, run: redRun.databaseId, verdict: !settledState ? 'pending' : red ? 'red' : green ? 'green' : 'none', settled: settledState, ...(settledState ? {} : { provisional: true }), failed, at: new Date().toISOString() });
			return { code: red ? 1 : green ? 0 : 2 };
		}
		settled = shape;
		// The first red job of an open run: report it now, with the partial list, unless --settle waits for the whole run.
		if (!settle) {
			for (const run of open) {
				const jobs = jobsOf(run.databaseId);
				if (!jobs || !Array.isArray(jobs.jobs)) continue;
				const pending = jobs.jobs.filter((j) => j && j.status !== 'completed').length;
				const d = digestOf(jobs, run.databaseId);
				if (pending && d.items.length) {
					log(`CI red early: ${one(d.items[0].job)} failed (${pending} jobs still running); the lead can diagnose now`);
					writeState({ sha: commit, run: run.databaseId, verdict: 'red', settled: false, failed: d.items, at: new Date().toISOString() });
					return { code: 1 };
				}
			}
		}
		if (!said && open.length && t >= MID) { said = true; log(`CI still running after 10 min: ${open.map((x) => one(x.name)).join(', ')}`); }
		if ((!runs || !runs.length) && t >= NONE) { log(`CI: no CI run started for ${String(commit).slice(0, 12)} in 5 min`); return { code: 2 }; }
		const left = max * 60000 - t;
		if (left <= 0) { log(`CI: gave up after ${max} min; still running: ${open.map((x) => one(x.name)).join(', ') || 'none read'}`); return { code: 2 }; }
		await sleep(Math.min(every * 1000, left));
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	const a = process.argv.slice(2);
	const opt = (k, d) => { const i = a.indexOf(k); return i < 0 ? d : Number(a[i + 1]); };
	const commit = a[0];
	const every = opt('--every', 15);
	const max = opt('--max', 60);
	const settle = a.includes('--settle');
	// gh runs outside the project, so the repo is named: --repo, or the one the project's origin remote names.
	const ri = a.indexOf('--repo');
	const origin = spawnSync('git', ['--no-optional-locks', '-C', process.cwd(), '-c', 'core.fsmonitor=false', 'remote', 'get-url', 'origin'], { cwd: path.dirname(process.execPath), encoding: 'utf8' });
	const repo = ri >= 0 ? a[ri + 1] : repoOf(origin.stdout);
	// gh matches a commit by its full sha only: a short one would find no run and report none.
	if (!/^[0-9a-f]{40}$/i.test(commit || '') || !(every >= 10 && every <= 600) || !(max > 0 && max <= 360) || !/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo || '')) {
		process.stdout.write('usage: node .claude/ci-wait.mjs <full 40-character commit sha> [--repo <owner/name>] [--every <seconds, 10 to 600, default 15>] [--max <minutes, up to 360>] [--settle] (the repo comes from the origin remote when not given)\n');
		process.exitCode = 2;
	} else ciWait({ commit, repo, every, max, settle }).then((r) => { process.exitCode = r.code; });
}
