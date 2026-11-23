// scripts/flip-plan.mjs picks the mutation flips a PR must run, carries the ones past a time budget, runs the picked flips
// on parallel copies of HEAD and names every flip it carried. A flip is mutation-check's: one per production line the PR
// added, placed on the lines the coverage map ties to tests. Report only: it exits 0 whatever the flips show.
//   node scripts/flip-plan.mjs --base <PR base sha> [--since <last measured head sha>] [--budget <s>] [--workers <n>]
//                              [--json <file>]
// Run at the PR head, with tests/.map.json made at HEAD. A usage error or an unreadable map exits 2.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { changedLines, flip, runTests } from './mutation-check.mjs';

const { makeTemp, removeTemp } = kitTemp;
const DEFAULT_BUDGET_S = 150;
const DEFAULT_WORKERS = 4;
const RUN_TIMEOUT_MS = 120000;
const FLAGS = ['--base', '--since', '--budget', '--workers', '--json'];
const USAGE = 'usage: node scripts/flip-plan.mjs --base <sha> [--since <sha>] [--budget <s>] [--workers <n>] [--json <file>]';
// The same test-file test mutation-check uses: its flips are never placed on test code.
const isTest = (f) => /(^|\/)tests?\/|\.test\.[cm]?js$/.test(f);
const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });

function parseArgs(argv) {
	const o = {};
	for (let i = 0; i < argv.length; i += 2) {
		const flag = argv[i];
		const value = argv[i + 1];
		if (!FLAGS.includes(flag) || value === undefined || value.startsWith('--')) throw new Error(USAGE);
		o[flag.slice(2)] = value;
	}
	if (o.base === undefined) throw new Error(USAGE);
	const number = (v) => (/^\d+(\.\d+)?$/.test(v) ? Number(v) : NaN);
	const budget = o.budget === undefined ? DEFAULT_BUDGET_S : number(o.budget);
	const workers = o.workers === undefined ? DEFAULT_WORKERS : number(o.workers);
	if (Number.isNaN(budget) || !Number.isInteger(workers) || workers < 1) throw new Error(USAGE);
	return { base: o.base, since: o.since, budget, workers, json: o.json };
}

function readMap(root) {
	let parsed;
	try { parsed = JSON.parse(fs.readFileSync(path.join(root, 'tests', '.map.json'), 'utf8')); } catch { throw new Error('cannot read tests/.map.json: make it with node scripts/test-run.mjs --map'); }
	if (typeof parsed?.tests !== 'object' || parsed.tests === null) throw new Error('tests/.map.json has no tests object');
	return parsed.tests;
}

// A test with no ms in the map counts the median of the ms the map does hold, so it is neither free nor a guess of zero.
function medianMs(tests) {
	const ms = Object.values(tests).map((t) => t.ms).filter((v) => typeof v === 'number').sort((a, b) => a - b);
	if (ms.length === 0) return 0;
	const mid = ms.length >> 1;
	return ms.length % 2 ? ms[mid] : (ms[mid - 1] + ms[mid]) / 2;
}

// Every flip the base..HEAD change makes: one per production line added, that a test the map ties to it reaches.
function candidates(root, head, tests, scope) {
	const fallback = medianMs(tests);
	const seen = new Map();
	for (const [key, t] of Object.entries(tests)) {
		for (const [file, lines] of Object.entries(t.lines || {})) {
			if (isTest(file)) continue;
			for (const line of lines) {
				if (!scope[file]?.has(line)) continue;
				const id = `${file}:${line}`;
				if (!seen.has(id)) seen.set(id, { file, line, tests: [], ms: 0 });
				const spot = seen.get(id);
				spot.tests.push(key);
				spot.ms += typeof t.ms === 'number' ? t.ms : fallback;
			}
		}
	}
	const spots = [];
	const sources = new Map();
	for (const spot of [...seen.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
		if (!sources.has(spot.file)) sources.set(spot.file, git(root, 'show', `${head}:${spot.file}`).stdout.split('\n'));
		const f = flip(sources.get(spot.file)[spot.line - 1] ?? '');
		if (f) spots.push({ ...spot, op: f.op, text: f.text, seconds: spot.ms / 1000 });
	}
	return spots;
}

// The copies a flip runs in: a scratch clone at HEAD, so a flip never touches the repo, with a throwaway Claude folder
// and home, as mutation-check makes them.
function makeCopy(root, head) {
	const dir = makeTemp('flip-plan-');
	const add = git(path.dirname(dir), 'clone', '--quiet', '--no-hardlinks', '--no-checkout', root, dir);
	const out = add.status === 0 ? git(dir, '-c', 'advice.detachedHead=false', 'checkout', '--quiet', head) : add;
	if (out.status !== 0) { removeTemp(dir); throw new Error(`could not make a copy of HEAD: ${out.stderr}`); }
	const claude = makeTemp('claude-home-');
	const user = makeTemp('user-home-');
	try { fs.copyFileSync(path.join(os.homedir(), '.gitconfig'), path.join(user, '.gitconfig')); } catch { /* none */ }
	const home = { KIT_CLAUDE_HOME: claude, CLAUDE_CONFIG_DIR: claude, HOME: user, USERPROFILE: user };
	return { dir, home, dirs: [dir, claude, user] };
}

// One flip: its line changed in the copy, then its tests run one at a time and stop at the first red one.
async function runFlip(copy, spot) {
	const file = path.join(copy.dir, spot.file);
	const original = fs.readFileSync(file, 'utf8');
	const lines = original.split('\n');
	lines[spot.line - 1] = spot.text;
	fs.writeFileSync(file, lines.join('\n'));
	const ran = [];
	let caught = false;
	try {
		for (const key of spot.tests) {
			ran.push(key);
			if ((await runTests(copy.dir, [key], RUN_TIMEOUT_MS, copy.home)).caught) { caught = true; break; }
		}
	} finally {
		fs.writeFileSync(file, original);
	}
	return { ran, caught };
}

// The picked flips run on `workers` copies, each taking the next flip in file then line order. Results are kept by the
// flip's place in that order, so the report reads the same whatever the number of workers.
async function runPicked(root, head, picked, workers) {
	const results = new Array(picked.length);
	const copies = [];
	let next = 0;
	const worker = async () => {
		const copy = makeCopy(root, head);
		copies.push(copy);
		while (next < picked.length) {
			const i = next++;
			results[i] = await runFlip(copy, picked[i]);
		}
	};
	try {
		await Promise.all(Array.from({ length: Math.min(workers, picked.length) }, worker));
	} finally {
		for (const copy of copies) for (const dir of copy.dirs) removeTemp(dir);
	}
	return results;
}

export async function main(argv) {
	const o = parseArgs(argv);
	kitTemp.sessionRoot();
	const top = git(process.cwd(), 'rev-parse', '--show-toplevel');
	if (top.status !== 0) throw new Error('run it inside a git repo');
	const root = path.resolve(top.stdout.trim());
	const head = git(root, 'rev-parse', 'HEAD').stdout.trim();
	const tests = readMap(root);
	const scope = changedLines(root, o.base);
	if (!scope || scope.overflow) throw new Error(`base "${o.base}" is not a commit this repo can diff against HEAD`);
	const sinceScope = o.since === undefined ? null : changedLines(root, o.since);
	if (o.since !== undefined && (!sinceScope || sinceScope.overflow)) throw new Error(`--since "${o.since}" is not a commit this repo can diff against HEAD`);

	const spots = candidates(root, head, tests, scope);
	// A flip is new when its line changed since the last measured head, or a test that reaches it changed.
	const isNew = (s) => !sinceScope || Boolean(sinceScope[s.file]?.has(s.line)) || s.tests.some((k) => Boolean(sinceScope[k.slice(0, k.indexOf('::'))]));
	const news = spots.filter(isNew);
	// In file then line order, a flip is picked while the running total stays at or under the budget; the rest are carried.
	const picked = [];
	const carried = [];
	let used = 0;
	for (const s of news) {
		if (carried.length === 0 && used + s.seconds <= o.budget) { used += s.seconds; picked.push(s); }
		else carried.push(s);
	}

	const copyResults = await runPicked(root, head, picked, o.workers);
	const out = [`flips: ${news.length} new of ${spots.length}`];
	picked.forEach((s, i) => out.push(`run: ${s.file}:${s.line} ${s.op} ${copyResults[i].caught ? 'caught' : 'survived'}`));
	for (const s of carried) out.push(`carried: ${s.file}:${s.line} ${s.op} (${s.seconds} s predicted)`);
	out.push(`budget: ${used} of ${o.budget} s`);
	process.stdout.write(`${out.join('\n')}\n`);

	if (o.json) {
		const records = [
			...picked.map((s, i) => ({ file: s.file, line: s.line, op: s.op, verdict: copyResults[i].caught ? 'caught' : 'survived', ran: copyResults[i].ran })),
			...carried.map((s) => ({ file: s.file, line: s.line, op: s.op, verdict: 'carried', ran: [] })),
		].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
		fs.writeFileSync(o.json, `${JSON.stringify(records, null, 1)}\n`);
	}
	return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	try {
		process.exitCode = await main(process.argv.slice(2));
	} catch (err) {
		process.stderr.write(`flip-plan: ${err.message}\n`);
		process.exitCode = 2;
	}
}
