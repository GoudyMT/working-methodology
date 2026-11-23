#!/usr/bin/env node
// Checks a batch plan before any unit runs, and the saved hand-back records against it.
// The Units table needs the columns Id, Files, Runs, Risk, Category, Tests and Tester; a unit's Files, Runs, Category and
// Tests cells are not empty; the plan graph (project/.claude/plan-graph.mjs) names no fault; the test budget
// (test-budget.mjs) holds; each spec rule has a test line "-> <id>"; guard rows hold (guard-rows.mjs).
// --lock <unit> writes the row's sha256 to <plan>.locks.json when the plan checks clean; a later check refuses a changed row.
// --records <folder> checks each .jsonl hand-back (handoff.mjs) against the plan by its role line's unit.
// --whys prints each unit's test names and their why lines, derived from its Tests cell (K368); a why under six words is a
// fault in the check. --brief <unit> --role tester|builder prints that unit's brief as markdown: its files, test names,
// why lines and the lock commands, written from the row so they are never typed by hand.
//   node plan-check.mjs <plan.md> [--records <folder>] [--lock <unit>]
//   node plan-check.mjs <plan.md> --whys
//   node plan-check.mjs <plan.md> --brief <unit> --role tester|builder
// Exit 0 clean, 1 faults on stdout (or an unknown unit or role on stderr), 2 unreadable input or bad usage (stderr).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { units, faults } from './plan-graph.mjs';
import safeSpawn from './safe-spawn.cjs';
import { check } from './handoff.mjs';
import { budget, filesOf, readMap, InputError, CEILING, ORDER } from './test-budget.mjs';
import { guardRowFaults } from './guard-rows.mjs';
import { hasRetestLine } from './checklist.mjs';

const COLUMNS = ['Id', 'Files', 'Runs', 'Risk', 'Category', 'Tests', 'Tester'];
const TEST_FOLDER = /^tests\//;

// A problem with an input the check cannot read. main() turns it into exit 2.
class Unreadable extends Error {}

// The Units table of a plan text: its header cells, its row cells and each row's text, or null when the plan has no
// Units table. It ends at its first line that is not a row, as project/.claude/plan-graph.mjs reads it.
function unitsTable(text) {
	const lines = text.replace(/\r\n/g, '\n').split('\n');
	const at = lines.findIndex((l) => /^## Units\b/.test(l));
	if (at < 0) return null;
	let head = null;
	const rows = [];
	const raws = [];
	for (const l of lines.slice(at + 1)) {
		if (/^#{1,6} /.test(l)) break;
		if (!/^\s*\|/.test(l)) {
			if (head) break;
			continue;
		}
		const cells = l.trim().split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim().replace(/\\\|/g, '|'));
		if (!head) {
			head = cells.map((c) => c.toLowerCase());
			continue;
		}
		if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
		rows.push(cells);
		raws.push(l);
	}
	return head ? { head, rows, raws } : null;
}

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

// A Tests cell's lines, each one test: split at <br>, trimmed, no empty line.
export const testLines = (cell) => String(cell || '').split(/<br\s*\/?>/i).map((l) => l.trim()).filter(Boolean);

// A Tests line's test name (the text before "->") and its spec id (the first "-> <id>" after it), null when it has none.
export function testOf(line) {
	const i = line.indexOf('->');
	if (i < 0) return { name: line.trim(), rule: null };
	const m = /->\s*([A-Za-z][\w-]*)/.exec(line.slice(i));
	return { name: line.slice(0, i).trim(), rule: m ? m[1] : null };
}

// The why a test line derives: "catches" and the test name. The check counts these words (six at least).
const whyOf = (name) => `catches ${name}`;

// The why line written above a test: its row id is the Title's leading K code, or the unit id (an R row).
const whyLine = (t, rowId) => `// why: ${whyOf(t.name)}${t.rule ? ` (${rowId} ${t.rule})` : ''}`;

// The Units table's rows: each unit's id, Title, Files and Tests cells, and its row id (the leading K code of its Title,
// else its unit id). A plan with no Units table or without these columns cannot be read.
export function planUnits(text) {
	const table = unitsTable(text);
	if (table === null) throw new Unreadable('the plan has no ## Units table');
	const at = {};
	for (const key of ['Id', 'Title', 'Files', 'Tests']) {
		const i = table.head.findIndex((h) => h.startsWith(key.toLowerCase()));
		if (i < 0) throw new Unreadable(`the Units table has no ${key} column`);
		at[key] = i;
	}
	return table.rows.map((row) => {
		const id = (row[at.Id] || '').replace(/[*_`]/g, '').trim();
		const title = row[at.Title] || '';
		const k = /^\s*(K\d+)\b/.exec(title);
		return { id, title, files: row[at.Files] || '', tests: row[at.Tests] || '', rowId: k ? k[1] : id };
	}).filter((u) => u.id);
}

// --whys: each unit's test names and their why lines.
function whysText(units) {
	return units.map((u) => [u.id, ...testLines(u.tests).flatMap((l) => {
		const t = testOf(l);
		return [`  ${t.name}`, `  ${whyLine(t, u.rowId)}`];
	})].join('\n')).join('\n') + '\n';
}

// --brief: one unit's brief for its tester or its builder, from its row. The test files are the Files cell's tests/ paths.
function briefText(u, role) {
	const files = filesOf(u.files);
	const tests = files.filter((f) => TEST_FOLDER.test(f.replace(/\\/g, '/')));
	const src = files.filter((f) => !TEST_FOLDER.test(f.replace(/\\/g, '/')));
	if (role === 'tester') {
		return [`# Tester brief: ${u.id}`, '', `Unit: ${u.title.trim()}`, `Files: ${u.files.trim()}`, '',
			'Write each test first, with its name and its why line as given:', '',
			...testLines(u.tests).flatMap((l) => {
				const t = testOf(l);
				return [`- ${t.name}`, `  ${whyLine(t, u.rowId)}`];
			}), '',
			'Lock before the unit runs, from the repo root:', '', '```', `node user/kit-tools/unit-lock.mjs --tester --files ${tests.join(',')}`, '```', ''].join('\n');
	}
	return [`# Builder brief: ${u.id}`, '', `Unit: ${u.title.trim()}`, '',
		`Source files (edit these): ${src.join(', ')}`, `Tests (locked, never edit): ${tests.join(', ')}`, '',
		'Run only these tests:', '', '```', `node --test ${tests.join(' ')}`, '```', '',
		'Lock after the red commit, with its sha:', '', '```', `node user/kit-tools/unit-lock.mjs <red sha> --files ${src.join(',')}`, '```', ''].join('\n');
}

// The rule ids ("- S1: ...") under a unit's "### <id> spec" section, in order. None when the plan has no such section.
function specRules(text, id) {
	const lines = text.replace(/\r\n/g, '\n').split('\n');
	const at = lines.findIndex((l) => l.trim() === `### ${id} spec`);
	if (at < 0) return [];
	const rules = [];
	for (const l of lines.slice(at + 1)) {
		if (/^#{1,6} /.test(l)) break;
		const m = /^- ([A-Za-z][\w-]*):/.exec(l);
		if (m) rules.push(m[1]);
	}
	return rules;
}

// The test budget checks of one unit row: a Category cell that names no category or is lower than the computed one, a
// Tests count over the category's ceiling, a test line with no "->", and a spec rule no test line names.
function budgetFaults(id, cells, at, map, rules) {
	const found = [];
	const given = (cells[at.Category] || '').trim().toLowerCase();
	if (given === '') found.push(`unit ${id} has an empty Category cell`);
	else if (!ORDER.includes(given)) found.push(`unit ${id} has a Category cell that names no category (${ORDER.join(', ')})`);
	const b = budget(filesOf(cells[at.Files] || ''), { risk: cells[at.Risk] || '', map, given: ORDER.includes(given) ? given : null });
	if (b.lower) found.push(`unit ${id} has Category ${given}, below the ${b.computed} its files earn (${b.reason}): a Category may raise a unit, never lower it`);
	const lines = (cells[at.Tests] || '').split(/<br\s*\/?>/i).map((l) => l.trim()).filter(Boolean);
	if (lines.length === 0) found.push(`unit ${id} has an empty Tests cell`);
	if (lines.length > CEILING[b.category]) found.push(`unit ${id} has ${lines.length} test lines, over its ${b.category} ceiling of ${CEILING[b.category]}: split the unit`);
for (const l of lines) if (!l.includes('->')) found.push(`unit ${id} has a test line with no "->": ${l}`);
	if (b.category === 'guard') found.push(...guardRowFaults(id, lines));
	const named = new Set(lines.flatMap((l) => [...l.matchAll(/->\s*([A-Za-z][\w-]*)/g)].map((m) => m[1])));
	for (const rule of rules) if (!named.has(rule)) found.push(`unit ${id} spec rule ${rule} has no test line with -> ${rule}`);
	return found;
}

// The plan's faults, its unit ids and each row's text by id. A missing column, or an empty Files, Runs, Category or
// Tests cell, is named by unit and column; the budget checks name the unit too.
function checkPlan(text, map) {
	const table = unitsTable(text);
	if (table === null) return { faults: ['the plan has no ## Units table'], ids: new Set(), raw: new Map() };
	const at = {};
	const missing = [];
	for (const key of COLUMNS) {
		const i = table.head.findIndex((h) => h.startsWith(key.toLowerCase()));
		if (i < 0) missing.push(`the Units table has no ${key} column`);
		else at[key] = i;
	}
	if (missing.length) return { faults: missing, ids: new Set(), raw: new Map() };
	const found = [];
	const ids = new Set();
	const raw = new Map();
	table.rows.forEach((row, n) => {
		const id = (row[at.Id] || '').replace(/[*_`]/g, '').trim();
		if (!id) return;
		ids.add(id);
		raw.set(id, table.raws[n]);
		if ((row[at.Files] || '').trim() === '') found.push(`unit ${id} has an empty Files cell`);
		if ((row[at.Runs] || '').trim() === '') found.push(`unit ${id} has an empty Runs cell`);
		if (hasRetestLine(row[at.Tests] || '')) {
			for (const f of filesOf(row[at.Files] || '')) {
				if (!TEST_FOLDER.test(f.replace(/\\/g, '/'))) found.push(`unit ${id} is a retest unit (a Tests line starts "retest:") and its Files hold ${f}: a retest changes tests only, so list test files alone`);
			}
		}
		found.push(...budgetFaults(id, row, at, map, specRules(text, id)));
	});
	if (ids.size === 0) found.push('the Units table has no units');
	else found.push(...faults(units(text) || []));
	return { faults: found, ids, raw };
}

// The testCategories map of the repo's kit.config.json: the plan's git top folder, or the plan's own folder outside a repo.
// No kit.config.json means no map, so every file counts as logic.
function mapOf(plan) {
	const dir = path.dirname(path.resolve(plan));
	const r = safeSpawn.gitRead(dir, ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
	const file = path.join(r.status === 0 ? r.stdout.trim() : dir, 'kit.config.json');
	if (!fs.existsSync(file)) return {};
	try {
		return readMap(file);
	} catch (e) {
		if (e instanceof InputError) throw new Unreadable(e.message);
		throw e;
	}
}

// The lock file's locks (unit -> sha256). No file means none; a file that is not a JSON object is an error.
function readLocks(file) {
	let text;
	try {
		text = fs.readFileSync(file, 'utf8');
	} catch (e) {
		if (e.code === 'ENOENT') return {};
		throw new Unreadable(`cannot read ${file}: ${e.code || e.message}`);
	}
	let o = null;
	try {
		o = JSON.parse(text);
	} catch {
		/* named below */
	}
	if (o === null || typeof o !== 'object' || Array.isArray(o)) throw new Unreadable(`${file} is not a lock file (a JSON object of unit -> sha256)`);
	return o;
}

// A locked unit whose row text no longer hashes to its lock is a fault; a locked unit with no row is one too.
function lockFaults(locks, raw) {
	return Object.entries(locks).flatMap(([id, hex]) => {
		if (!raw.has(id)) return [`locked unit ${id} has no row in the Units table`];
		return sha(raw.get(id)) === hex ? [] : [`unit ${id}: the locked row changed since --lock`];
	});
}

// For unit-check's count gate: one unit's row of a plan. Its Files paths, its Tests line count, and whether its row
// changed since its --lock. Throws an Error when the plan, its Units table or the unit's row cannot be read.
export function unitGate(plan, id) {
	const table = unitsTable(fs.readFileSync(plan, 'utf8'));
	if (table === null) throw new Error(`${plan} has no ## Units table`);
	const col = (key) => table.head.findIndex((h) => h.startsWith(key.toLowerCase()));
	if (col('Files') < 0 || col('Tests') < 0) throw new Error(`${plan}: the Units table has no Files or Tests column`);
	const i = table.rows.findIndex((r) => (r[col('Id')] || '').replace(/[*_`]/g, '').trim() === id);
	if (i < 0) throw new Error(`the Units table has no row for unit ${id}`);
	const cells = table.rows[i];
	const lines = (cells[col('Tests')] || '').split(/<br\s*\/?>/i).filter((l) => l.trim()).length;
	const locks = readLocks(`${plan}.locks.json`);
	const locked = Object.prototype.hasOwnProperty.call(locks, id);
	return { files: filesOf(cells[col('Files')] || ''), lines, locked, changed: locked && locks[id] !== sha(table.raws[i]) };
}

// For flow-check's start: the plan's faults and its lock faults, as the check prints them. An unreadable plan or lock
// file throws (a plain Error, or Unreadable's message) for the caller to name.
export function planFaults(plan) {
	const p = checkPlan(fs.readFileSync(plan, 'utf8'), mapOf(plan));
	return [...p.faults, ...lockFaults(readLocks(`${plan}.locks.json`), p.raw)];
}

// The role line of a hand-back: the first non-blank line after the last RECORD: line, as handoff.mjs reads it.
function roleLineOf(text) {
	const lines = text.split(/\r?\n/);
	let at = -1;
	lines.forEach((l, i) => {
		if (l.trim() === 'RECORD:') at = i;
	});
	if (at < 0) return null;
	const first = lines.slice(at + 1).find((l) => l.trim() !== '');
	try {
		const o = JSON.parse(first);
		return o !== null && typeof o === 'object' && !Array.isArray(o) ? o : null;
	} catch {
		return null;
	}
}

// Every .jsonl record in the folder: its faults, its warnings and how many it read. An unreadable folder or file throws.
function checkRecords(dir, ids) {
	let names;
	try {
		names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.jsonl')).map((e) => e.name).sort();
	} catch (e) {
		throw new Unreadable(`cannot read --records folder ${dir}: ${e.code || e.message}`);
	}
	const found = [];
	const warnings = [];
	const builders = [];
	const testers = new Set();
	for (const name of names) {
		let text;
		try {
			text = fs.readFileSync(path.join(dir, name), 'utf8');
		} catch (e) {
			throw new Unreadable(`cannot read record ${name}: ${e.code || e.message}`);
		}
		const r = check(text);
		if (!r.ok) {
			found.push(`record ${name} is not a valid hand-back: ${r.errors.join('; ')}`);
			continue;
		}
		const role = roleLineOf(text);
		const raw = role.unit;
		if (raw === undefined || raw === null) {
			warnings.push(`record without unit: ${name}`);
			continue;
		}
		if (typeof raw !== 'string') {
			found.push(`record ${name} has a unit that is not text`);
			continue;
		}
		const unit = raw.trim();
		if (unit === '') {
			warnings.push(`record without unit: ${name}`);
			continue;
		}
		if (!ids.has(unit)) found.push(`record ${name} names unit ${unit}, which the plan does not hold`);
		else if (role.role === 'builder') builders.push({ name, unit });
		else if (role.role === 'tester') testers.add(unit);
	}
	for (const b of builders) {
		if (!testers.has(b.unit)) found.push(`unit ${b.unit} has a builder record (${b.name}) but no tester record`);
	}
	return { found, warnings, read: names.length };
}

function parseArgs(argv) {
	const pos = [];
	const opt = {};
	let whys = false;
	for (let i = 0; i < argv.length; i++) {
		if (['--records', '--lock', '--brief', '--role'].includes(argv[i])) {
			if (i + 1 >= argv.length) return null;
			opt[argv[i].slice(2)] = argv[++i];
		} else if (argv[i] === '--whys') {
			whys = true;
		} else if (argv[i].startsWith('--')) {
			return null;
		} else {
			pos.push(argv[i]);
		}
	}
	const brief = opt.brief ?? null;
	const records = opt.records ?? null;
	const lock = opt.lock ?? null;
	// --whys and --brief print and stop: they take no --records or --lock, and --role goes with --brief only.
	if (pos.length !== 1 || (whys && brief !== null) || ((whys || brief !== null) && (records !== null || lock !== null))) return null;
	if ((opt.role !== undefined) !== (brief !== null)) return null;
	return { plan: pos[0], records, lock, whys, brief, role: opt.role ?? null };
}

function main(argv) {
	const args = parseArgs(argv);
	if (!args) {
		process.stderr.write('plan-check: usage: node plan-check.mjs <plan.md> [--records <folder>] [--lock <unit>] | <plan.md> --whys | <plan.md> --brief <unit> --role tester|builder\n');
		return 2;
	}
	try {
		let text;
		try {
			text = fs.readFileSync(args.plan, 'utf8');
		} catch (e) {
			throw new Unreadable(`cannot read plan ${args.plan}: ${e.code || e.message}`);
		}
		if (args.whys) {
			process.stdout.write(whysText(planUnits(text)));
			return 0;
		}
		if (args.brief !== null) {
			const unit = planUnits(text).find((u) => u.id === args.brief);
			if (!['tester', 'builder'].includes(args.role)) {
				process.stderr.write(`plan-check: role ${args.role} is not tester or builder\n`);
				return 1;
			}
			if (!unit) {
				process.stderr.write(`plan-check: unit ${args.brief} is not in the Units table\n`);
				return 1;
			}
			process.stdout.write(briefText(unit, args.role));
			return 0;
		}
		const plan = checkPlan(text, mapOf(args.plan));
		const lockFile = `${args.plan}.locks.json`;
		const locks = readLocks(lockFile);
		const rec = args.records === null ? { found: [], warnings: [], read: 0 } : checkRecords(args.records, plan.ids);
		const lines = [...plan.faults, ...lockFaults(locks, plan.raw), ...rec.found];
		if (args.lock !== null) {
			if (!plan.raw.has(args.lock)) throw new Unreadable(`--lock: the Units table has no row for unit ${args.lock}`);
			if (lines.length === 0) {
				fs.writeFileSync(lockFile, `${JSON.stringify({ ...locks, [args.lock]: sha(plan.raw.get(args.lock)) }, null, 2)}\n`);
				process.stdout.write(`locked: ${args.lock} in ${lockFile}\n`);
			} else {
				process.stdout.write(`not locked: ${args.lock}, the plan has faults\n`);
			}
		}
		for (const w of rec.warnings) process.stdout.write(`${w}\n`);
		for (const f of lines) process.stdout.write(`fault: ${f}\n`);
		process.stdout.write(`plan check: ${plan.ids.size} units, ${rec.read} records, ${lines.length} fault(s)\n`);
		return lines.length ? 1 : 0;
	} catch (e) {
		if (!(e instanceof Unreadable)) throw e;
		process.stderr.write(`plan-check: ${e.message}\n`);
		return 2;
	}
}

// Runs only when started directly: unit-check imports unitGate from this file.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
