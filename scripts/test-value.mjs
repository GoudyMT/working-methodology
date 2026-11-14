#!/usr/bin/env node
// The test value sort (T15 Part B, the owner 2026-11-10): reads the mutation check's flips (every slice's --json) and
// the coverage map, and puts every test in one group by what it guards or catches. It only reports: no test is
// removed by it, and the cut list goes to the owner before anything is deleted (E31: security and owner-rule tests are
// never cut).
//   node scripts/test-value.mjs <map.json> <flips.json>... [--out <value.json>]   a summary on stdout, rows in --out
// The groups, first match wins:
//   guards     a security or owner rule: a "why: guards" tag, a pin of the owner's words (pin: 4), or a test in a
//              security test file. Kept, never cut.
//   unique     catches a flip no other test catches. Kept.
//   machine    pins words a machine reads, a stop's order or frozen text (pin: 1 to 3). Kept.
//   repeat     catches flips, every one of them also caught by another test. One of each set may go.
//   text       reaches no flip but reads kit text (links, sizes, built copies): an invariant; the owner decides.
//   windows    runs only on Windows, so a Linux measurement cannot see it.
//   nothing    reaches flips and catches none, or reaches nothing and reads nothing, and guards no rule: the cut list.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// The test files whose every test guards the owner's machine against a tool (the guards, the owner's yes, the push
// hook, the task gate): kept whole, whatever the measurement says.
export const SECURITY_FILES = ['tests/guards-hold.test.mjs', 'tests/guards-outside.test.mjs', 'tests/owner-proof.test.mjs', 'tests/task-gate.test.mjs', 'tests/guard-dispatch.test.mjs', 'tests/guard-prompts.test.mjs'];

// A test's own source: its comment lines, then its test( line up to the next top-level test(.
function bodies(root, file) {
	let text = '';
	try { text = fs.readFileSync(path.join(root, file), 'utf8'); } catch { return new Map(); }
	const lines = text.split('\n');
	const out = new Map();
	const starts = [];
	lines.forEach((l, i) => {
		const m = /^(?:for \(.*\) )?test\((['"`])((?:\\.|(?!\1).)*)\1/.exec(l.trimStart());
		if (m && /^(\t| {0,2})?(for |test\()/.test(l)) starts.push([i, m[2].replace(/\\(.)/g, '$1')]);
	});
	// A test's tags are the comment lines right above it; the comment above the next test is that test's.
	const comment = (l) => /^\s*\/\//.test(l);
	starts.forEach(([i, name], k) => {
		let head = i;
		while (head > 0 && comment(lines[head - 1])) head--;
		let end = k + 1 < starts.length ? starts[k + 1][0] : lines.length;
		while (end - 1 > i && comment(lines[end - 1])) end--;
		out.set(name, lines.slice(head, end).join('\n'));
	});
	return out;
}

/**
 * Sort every test the map names into one group.
 *
 * Args:
 *     root: the repo the test files are read from
 *     map: the coverage map ({ tests: { "<file>::<name>": { lines, reads } } })
 *     flips: every flip the mutation check ran ({ file, line, tests, caughtBy })
 *
 * Returns:
 *     { rows: [{ key, group, size, reached, caught, unique, pins, why }], counts: { group: n } }
 */
export function sortTests(root, map, flips) {
	const reached = new Map();
	const caught = new Map();
	const catchers = new Map();
	for (const f of flips) {
		for (const t of f.tests || []) reached.set(t, (reached.get(t) || 0) + 1);
		const id = `${f.file}:${f.line}`;
		catchers.set(id, new Set(f.caughtBy || []));
		for (const t of f.caughtBy || []) caught.set(t, (caught.get(t) || 0) + 1);
	}
	const unique = new Map();
	for (const set of catchers.values()) if (set.size === 1) { const [t] = set; unique.set(t, (unique.get(t) || 0) + 1); }
	const cache = new Map();
	const rows = [];
	for (const key of Object.keys(map.tests || {}).sort()) {
		const at = key.indexOf('::');
		const file = key.slice(0, at);
		const name = key.slice(at + 2);
		if (!cache.has(file)) cache.set(file, bodies(root, file));
		const body = cache.get(file).get(name) || '';
		const pins = [...body.matchAll(/pin: ([1-4])/g)].map((m) => Number(m[1]));
		const why = (/\/\/ why: (.*)/.exec(body) || [])[1] || '';
		// Size by what the test needs (rule:test-lanes): another process or a git repo is medium; the slow-lane folder
		// is large; the rest is small.
		const size = file.startsWith('tests/slow/') ? 'large' : /spawn|execFile|exec\(|\bgit\(|makeTemp|setup\(/.test(body) ? 'medium' : 'small';
		const t = map.tests[key];
		const r = { key, size, reached: reached.get(key) || 0, caught: caught.get(key) || 0, unique: unique.get(key) || 0, pins, why };
		r.group = /^guards\b/.test(why) || pins.includes(4) || SECURITY_FILES.includes(file) ? 'guards'
			: r.unique > 0 ? 'unique'
			: pins.some((p) => p <= 3) ? 'machine'
			: r.caught > 0 ? 'repeat'
			: /windows: true/.test(body) ? 'windows'
			: r.reached === 0 && (t.reads || []).length ? 'text'
			: 'nothing';
		rows.push(r);
	}
	const counts = {};
	for (const r of rows) counts[r.group] = (counts[r.group] || 0) + 1;
	return { rows, counts };
}

export function main(argv) {
	const outAt = argv.indexOf('--out');
	const out = outAt >= 0 ? argv[outAt + 1] : null;
	// With no --out, nothing is taken from the list (the first file was dropped, so the sort could not run without it).
	const files = outAt < 0 ? argv : argv.filter((a, i) => i !== outAt && i !== outAt + 1);
	if (files.length < 2) { process.stderr.write('usage: node scripts/test-value.mjs <map.json> <flips.json>... [--out <value.json>]\n'); return 2; }
	const map = JSON.parse(fs.readFileSync(files[0], 'utf8'));
	const runs = files.slice(1).map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
	// A measure scoped to a change (mutation-check --base) flips only its lines: sorted, every test that does not reach
	// them would read as catching nothing, a false cut list (K41).
	if (runs.some((r) => r.base)) { process.stderr.write('test-value: these flips are from a measure scoped to a change; the sort needs a whole-kit measure\n'); return 2; }
	const flips = runs.flatMap((r) => r.flips || []);
	const { rows, counts } = sortTests(process.cwd(), map, flips);
	if (out) fs.writeFileSync(out, JSON.stringify({ sha: map.sha, flips: flips.length, counts, rows }, null, 1) + '\n');
	const caught = flips.filter((f) => (f.caughtBy || []).length || f.caught).length;
	process.stdout.write(`Test value: ${rows.length} tests, ${flips.length} flips, ${caught} caught\n`);
	for (const g of ['guards', 'unique', 'machine', 'repeat', 'text', 'windows', 'nothing']) process.stdout.write(`    ${g}: ${counts[g] || 0}\n`);
	return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
