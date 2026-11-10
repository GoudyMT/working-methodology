// The test lanes' state (E32, option C, the owner 2026-11-10): which lanes a project's PRs run, worked out from what is
// there, never from a guess. It reports only: it never edits a workflow, a ruleset or a test (rule:test-lanes).
//   one-lane     the slow-lane folder holds no test: every test runs in one lane
//   two-lanes    it holds at least one large test: a fast lane reports first, a slow lane runs beside it, merge needs both
//   over-budget  the fast lane ran over the project's budget on the last 3 PR runs in a row: a finding, with the
//                slowest tests and the next lever (measure, parallel, cancel stale runs, change-scoped selection, then
//                moving tests to the slow lane, last)
// Settings: .kit/lanes.json, all optional: { "slowDir": "tests/slow", "budgetMinutes": 10, "fast": "<command>",
//   "slow": "<command>", "eval": "<command> or none", "evalThreshold": <n>, "levers": ["measure", ...] (applied) }.
// Times: --times <file>, a JSON list of fast-lane runs, oldest first: [{ "minutes": n, "tests": [{ "name", "seconds" }] }].
// Usage: node .claude/lane-state.mjs [--times <file>] [--json]   exit 0 one or two lanes, 1 over budget, 2 an error.
import fs from 'node:fs';
import path from 'node:path';

const DEFAULTS = { slowDir: 'tests/slow', budgetMinutes: 10 };
// The order the levers are tried in before any test leaves the fast lane; the last is the last resort.
const LEVERS = ['measure', 'parallel', 'cancel stale runs', 'change-scoped selection', 'move to the slow lane'];
// Three runs in a row over the budget make it a finding: one slow run is noise.
const IN_A_ROW = 3;
// A test is named among the slowest when it took at least this share of its run.
const SHARE = 0.01;

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

function fail(message) {
	console.error(`lane-state: ${message}`);
	process.exit(2);
}

function settings(root) {
	const file = path.join(root, '.kit', 'lanes.json');
	if (!fs.existsSync(file)) return { ...DEFAULTS };
	try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { return fail(`${file} is not valid JSON`); }
}

// The large tests: every file in the slow-lane folder, at any depth.
function large(root, dir) {
	const at = path.join(root, dir);
	if (!fs.existsSync(at)) return 0;
	return fs.readdirSync(at, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).length;
}

function main() {
	const root = process.cwd();
	const s = settings(root);
	const count = large(root, s.slowDir);
	let runs = [];
	const times = opt('--times');
	if (times) {
		try { runs = JSON.parse(fs.readFileSync(times, 'utf8')); } catch { return fail(`${times} is not a JSON list of runs`); }
		if (!Array.isArray(runs)) return fail(`${times} is not a JSON list of runs`);
	}
	const last = runs.slice(-IN_A_ROW);
	const over = last.length === IN_A_ROW && last.every((r) => Number(r.minutes) > s.budgetMinutes);
	const out = { state: over ? 'over-budget' : count > 0 ? 'two-lanes' : 'one-lane', counts: { large: count }, budgetMinutes: s.budgetMinutes, lastMinutes: last.map((r) => Number(r.minutes)), slowDir: s.slowDir };
	if (over) {
		const run = last[last.length - 1];
		const total = Number(run.minutes) * 60;
		out.slowest = (run.tests || []).filter((t) => Number(t.seconds) >= total * SHARE).sort((a, b) => b.seconds - a.seconds).slice(0, 5);
		const done = new Set(Array.isArray(s.levers) ? s.levers : []);
		out.nextLever = LEVERS.find((l) => !done.has(l)) || LEVERS[LEVERS.length - 1];
	}
	if (args.includes('--json')) console.log(JSON.stringify(out));
	else {
		console.log(`test lanes: ${out.state} (${count} large test${count === 1 ? '' : 's'} in ${s.slowDir}; fast-lane budget ${s.budgetMinutes} min${out.lastMinutes.length ? `; last runs ${out.lastMinutes.join(', ')} min` : ''})`);
		if (over) {
			for (const t of out.slowest) console.log(`    ${t.seconds} s  ${t.name}`);
			console.log(`    next lever: ${out.nextLever}. Moving tests to the slow lane comes last; a security or owner-rule test never moves for speed.`);
		}
	}
	process.exitCode = over ? 1 : 0;
}

main();
