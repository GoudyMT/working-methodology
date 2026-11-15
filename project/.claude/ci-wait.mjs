#!/usr/bin/env node
// The CI watch report (K66, the owner 2026-11-15: report each CI run's end without being asked). It waits on the CI runs
// of one commit and prints one line as each ends, green or red (again if a re-run ends differently), a line once a
// run passes ten minutes, and a last line with the result. A session starts it in the background after each push and
// passes each line on to the owner.
//
// Usage (from the project folder):
//   node .claude/ci-wait.mjs <full commit sha> [--every <seconds>] [--max <minutes>]
// It polls `gh run list --commit <sha>` every 30 seconds (10 to 600), for at most 60 minutes (up to 360). The result
// waits for two polls in a row that show the same runs, all finished, so a run that registers late is not missed. A
// commit with no run after 5 minutes is reported and given up. It only reads; gh starts from Node's own folder, so a
// gh.exe planted in the project is not the one found first on Windows.
// Exit 0 every run finished and at least one passed with none red, 1 a run red, 2 no run, none passed, or given up.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const MID = 10 * 60 * 1000;
const NONE = 5 * 60 * 1000;
const one = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
const took = (ms) => `${Math.floor(ms / 60000)}m${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}s`;
const verdict = (c) => (c === 'success' ? 'green' : ['skipped', 'neutral'].includes(c) ? 'skipped' : 'red');

/**
 * Watch one commit's CI runs to their end.
 *
 * Args:
 *     opts: { commit, every (seconds), max (minutes) }
 *     deps: { gh(args), sleep(ms), now(), log(line) } - the outside calls, so a test can run the clock
 *
 * Returns:
 *     { code } - 0 all finished, one or more green and none red; 1 a run red; 2 no run, none green, or given up
 */
export async function ciWait({ commit, every = 30, max = 60 }, deps = {}) {
	const gh = deps.gh || ((args) => spawnSync('gh', args, { cwd: path.dirname(process.execPath), encoding: 'utf8', timeout: 60000 }));
	const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
	const now = deps.now || (() => Date.now());
	const log = deps.log || ((l) => process.stdout.write(`${l}\n`));
	const start = now();
	const last = new Map();
	let said = false;
	let settled = null;
	for (;;) {
		const r = gh(['run', 'list', '--commit', commit, '--json', 'databaseId,name,status,conclusion,url']);
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
			return { code: red ? 1 : green ? 0 : 2 };
		}
		settled = shape;
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
	const every = opt('--every', 30);
	const max = opt('--max', 60);
	// gh matches a commit by its full sha only: a short one would find no run and report none.
	if (!/^[0-9a-f]{40}$/i.test(commit || '') || !(every >= 10 && every <= 600) || !(max > 0 && max <= 360)) {
		process.stdout.write('usage: node .claude/ci-wait.mjs <full 40-character commit sha> [--every <seconds, 10 to 600>] [--max <minutes, up to 360>]\n');
		process.exitCode = 2;
	} else ciWait({ commit, every, max }).then((r) => { process.exitCode = r.code; });
}
