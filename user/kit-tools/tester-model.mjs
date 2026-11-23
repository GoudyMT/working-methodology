#!/usr/bin/env node
// The model for a unit's tester (build 24). Reads one unit's row of a batch plan's Units table, by header name, and
// the unit's test-review record when one is given, and prints one line:
//   tester: <model> (<criterion id>: <reason>)
// The criteria R1 to R6 are in docs/plans/build-24-handoff-test-method-model-table.md, section 3. The first criterion
// that fires wins, in that order. When none fires the tester is Haiku.
//   node user/kit-tools/tester-model.mjs <plan.md> <unit> [--review <record file>]
// Exit 0 with the line. Exit 2 when the plan, the unit's row, a Units column or the review record cannot be read, with
// nothing on stdout: a missing row is an error, never a silent Haiku.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { filesOf } from './test-budget.mjs';

// R2: the guard, hook and gate paths, one data list. A name ending in "/" matches a folder anywhere in a path, a name
// with "*" matches a file name by glob, any other name matches a file name exactly.
export const GUARD_PATHS = ['kit-hooks/', '.githooks/', 'guard*.cjs', 'settings.json', 'approve.mjs', 'merge-gate.mjs'];

const DEFAULT = 'haiku';
const SONNET = 'sonnet';
const COLUMNS = ['id', 'files', 'runs', 'risk', 'tester', 'tests to write first'];

class InputError extends Error {}

// The Units table as rows keyed by header name. A missing table or column is an error, never a guessed column.
function readUnits(text) {
	const lines = String(text).replace(/\r\n/g, '\n').split('\n');
	const at = lines.findIndex((l) => /^## Units\b/.test(l));
	if (at < 0) throw new InputError('the plan has no "## Units" table');
	const table = [];
	for (const l of lines.slice(at + 1)) {
		if (/^#{1,6} /.test(l)) break;
		if (!/^\s*\|/.test(l)) { if (table.length) break; continue; }
		// A pipe a backslash escapes stays inside its cell (markdown writes a pipe in a cell as \|).
		table.push(l.trim().split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim().replace(/\\\|/g, '|')));
	}
	const [head, ...body] = table.filter((r) => !r.every((c) => /^:?-+:?$/.test(c)));
	if (!head) throw new InputError('the "## Units" table has no header row');
	const names = head.map((h) => h.toLowerCase());
	const col = (name) => names.findIndex((h) => h.startsWith(name));
	const missing = COLUMNS.filter((c) => col(c) < 0);
	if (missing.length) throw new InputError(`the Units table has no column for ${missing.map((c) => `"${c}"`).join(', ')}`);
	const cell = (cells, name) => (cells[col(name)] || '').trim();
	return body
		.map((cells) => ({
			id: cell(cells, 'id').replace(/[*_`]/g, '').trim(),
			files: cell(cells, 'files'),
			runs: cell(cells, 'runs'),
			risk: cell(cells, 'risk'),
			tester: cell(cells, 'tester'),
			tests: cell(cells, 'tests to write first'),
		}))
		.filter((r) => r.id);
}

// The ids (upper case) a unit runs after, from its Runs cell: "after U1, U2" or "after U1 (uses its types)".
function afterIds(row, ids) {
	if (!/^after\b/i.test(row.runs)) return [];
	const words = row.runs.match(/[A-Za-z][\w.-]*/g) || [];
	return [...new Set(words.map((w) => w.toUpperCase()))].filter((w) => ids.has(w) && w !== row.id.toUpperCase());
}

// One spelling per path for the guard match: forward slashes, no leading ./, lower case.
const norm = (p) => p.replace(/\\/g, '/').replace(/^(\.\/)+/, '').toLowerCase();

const globRe = (glob) => new RegExp(`^${glob.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`);

// The first GUARD_PATHS entry a path matches, or undefined.
function guardOf(file) {
	const base = file.split('/').pop();
	return GUARD_PATHS.find((g) => (g.endsWith('/') ? `/${file}`.includes(`/${g}`) : g.includes('*') ? globRe(g).test(base) : base === g));
}

// The status of each finding line of a review record (JSONL). A note line carries no status and counts for nothing.
function statusesOf(text) {
	const out = [];
	String(text).split('\n').forEach((line, i) => {
		if (!line.trim()) return;
		let obj;
		try { obj = JSON.parse(line); } catch { throw new InputError(`the review record line ${i + 1} is not JSON`); }
		if (obj && typeof obj.status === 'string') out.push(obj.status);
	});
	return out;
}

// The model and reason for the unit, from the first criterion that fires. A null reason means it did not fire.
function decide(planText, unit, reviewText) {
	const rows = readUnits(planText);
	const ids = new Set(rows.map((r) => r.id.toUpperCase()));
	const key = unit.toUpperCase();
	const row = rows.find((r) => r.id.toUpperCase() === key);
	if (!row) throw new InputError(`the Units table has no row for ${unit}`);
	const after = rows.filter((r) => afterIds(r, ids).includes(key)).length;
	const guard = filesOf(row.files).map(norm).map((f) => [f, guardOf(f)]).find(([, g]) => g);
	const reviewed = reviewText === null ? [] : statusesOf(reviewText);
	const owner = /^(?:claude-)?(sonnet|opus)\b/.exec(row.tester.toLowerCase());
	const criteria = [
		['R1', SONNET, row.risk.toLowerCase() === 'high' ?'marked high risk' : null],
		['R2', SONNET, guard ? `a guard, hook or gate path: ${guard[0]}` : null],
		['R3', SONNET, after >= 2 ?`${after} units run after it` : null],
		['R4', SONNET, reviewed.some((s) => s === 'vague' || s === 'uncovered') ? 'the review has a vague or uncovered line' : null],
		['R5', SONNET, /\S.*->\s*\S/.test(row.tests) ? null : 'Tests to write first names no input and expected output'],
		['R6', owner ? owner[1] : SONNET, owner ? `the owner wrote Tester: ${owner[1]}` : null],
	];
	const fired = criteria.find(([, , reason]) => reason);
	return fired ? `tester: ${fired[1]} (${fired[0]}: ${fired[2]})` : `tester: ${DEFAULT} (default: no criterion fired)`;
}

function readFile(file, what) {
	try {
		return fs.readFileSync(file, 'utf8');
	} catch {
		throw new InputError(`cannot read the ${what} "${file}"`);
	}
}

function main(argv) {
	let reviewFile = null;
	const pos = [];
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--review') {
			reviewFile = argv[++i];
			if (reviewFile === undefined) return usage();
		} else {
			pos.push(argv[i]);
		}
	}
	if (pos.length !== 2) return usage();
	try {
		const plan = readFile(pos[0], 'plan');
		const review = reviewFile === null ? null : readFile(reviewFile, 'review record');
		process.stdout.write(`${decide(plan, pos[1], review)}\n`);
		return 0;
	} catch (e) {
		if (!(e instanceof InputError)) throw e;
		process.stderr.write(`tester-model: ${e.message}\n`);
		return 2;
	}
}

function usage() {
	process.stderr.write('usage: tester-model.mjs <plan.md> <unit> [--review <record file>]\n');
	return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	process.exitCode = main(process.argv.slice(2));
}
