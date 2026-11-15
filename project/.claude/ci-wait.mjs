#!/usr/bin/env node
// The CI watch report (K66, the owner 2026-11-15: report each CI run's end without being asked). It waits on the CI runs
// of one commit and prints one line as each ends, green or red, a line once a run passes ten minutes, and a last line
// with the result. A session starts it in the background after each push and passes each line on to the owner.
//
// Usage (from the project folder):
//   node .claude/ci-wait.mjs <commit> [--every <seconds>] [--max <minutes>]
// It polls `gh run list --commit <commit>` every 30 seconds (at least 10), for at most 60 minutes. A commit with no run
// after 5 minutes is reported and given up. It only reads.
// Exit 0 every run green, 1 a run red, 2 no run, given up, or a usage error.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const GREEN = ['success', 'skipped', 'neutral'];
const MID = 10 * 60 * 1000;
const NONE = 5 * 60 * 1000;
const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
const took = (ms) => `${Math.floor(ms / 60000)}m${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}s`;

/**
 * Watch one commit's CI runs to their end.
 *
 * Args:
 *     opts: { commit, every (seconds), max (minutes) }
 *     deps: { gh(args), sleep(ms), now(), log(line) } - the outside calls, so a test can run the clock
 *
 * Returns:
 *     { code } - 0 all green, 1 a run red, 2 no run or given up
 */
export async function ciWait({ commit, every = 30, max = 60 }, deps = {}) {
	const gh = deps.gh || ((args) => spawnSync('gh', args, { encoding: 'utf8', timeout: 60000 }));
	const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
	const now = deps.now || (() => Date.now());
	const log = deps.log || ((l) => process.stdout.write(`${l}\n`));
	const start = now();
	const ended = new Map();
	let said = false;
	for (;;) {
		const r = gh(['run', 'list', '--commit', commit, '--json', 'databaseId,name,status,conclusion,url']);
		let runs = null;
		try { runs = r.status === 0 ? JSON.parse(r.stdout) : null; } catch { /* read again next poll */ }
		const t = now() - start;
		for (const run of runs || []) {
			if (run.status !== 'completed' || ended.has(run.databaseId)) continue;
			const green = GREEN.includes(run.conclusion);
			ended.set(run.databaseId, green);
			log(`CI ${one(run.name)}: ${green ? 'green' : 'red'} (${one(run.conclusion)}) in ${took(t)} ${one(run.url)}`);
		}
		const open = (runs || []).filter((x) => x.status !== 'completed');
		if (runs && runs.length && !open.length) {
			const red = [...ended.values()].filter((g) => !g).length;
			log(`CI done: ${red} red, ${ended.size - red} green, for ${String(commit).slice(0, 12)}`);
			return { code: red ? 1 : 0 };
		}
		if (!said && open.length && t >= MID) { said = true; log(`CI still running after 10 min: ${open.map((x) => one(x.name)).join(', ')}`); }
		if ((!runs || !runs.length) && t >= NONE) { log(`CI: no CI run started for ${String(commit).slice(0, 12)} in 5 min`); return { code: 2 }; }
		if (t >= max * 60000) { log(`CI: gave up after ${max} min; still running: ${open.map((x) => one(x.name)).join(', ') || 'none read'}`); return { code: 2 }; }
		await sleep(every * 1000);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	const a = process.argv.slice(2);
	const opt = (k, d) => { const i = a.indexOf(k); return i < 0 ? d : Number(a[i + 1]); };
	const commit = a[0];
	const every = opt('--every', 30);
	const max = opt('--max', 60);
	if (!/^[0-9a-f]{7,40}$/i.test(commit || '') || !(every >= 10) || !(max > 0 && max <= 360)) {
		process.stdout.write('usage: node .claude/ci-wait.mjs <commit sha> [--every <seconds, 10 or more>] [--max <minutes, up to 360>]\n');
		process.exitCode = 2;
	} else ciWait({ commit, every, max }).then((r) => { process.exitCode = r.code; });
}
