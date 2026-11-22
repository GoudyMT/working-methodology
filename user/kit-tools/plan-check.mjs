#!/usr/bin/env node
// Checks a batch plan before any unit runs, and the saved hand-back records against it.
// The plan's Units table needs the columns Id, Files, Runs, Risk, Category, Tests and Tester; each unit row needs a Files
// cell, a Runs cell, a Category cell and a Tests cell; the table needs at least one unit; and the plan graph
// (project/.claude/plan-graph.mjs) must name no fault: two units that may run at once and touch one file, a Runs that
// names no unit, or a cycle of "after". Test budget (test-budget.mjs): a Category cell may not be lower than the category
// the unit's files compute; a unit's test lines (the Tests cell, split by <br>) may not pass its category's ceiling; each
// test line says "-> <id>"; and each rule under the unit's "### <id> spec" section ("- <id>: ...") has a test line naming it.
// --lock <unit> writes the sha256 of the unit's row line to <plan>.locks.json, when the plan checks clean; a later check
// refuses a locked row whose text changed.
// With --records <folder>, each .jsonl file there is a whole hand-back (prose, RECORD:, then JSON lines), checked by
// handoff.mjs's check. Its unit comes from its role line only, compared exactly after trimming. A record naming a unit
// the plan does not hold is a fault, and so is a builder record whose unit has no tester record. A record with no unit
// is skipped, with a line "record without unit: <file name>".
//   node plan-check.mjs <plan.md> [--records <folder>] [--lock <unit>]
// Exit 0 clean (warning lines allowed), 1 faults named, 2 the plan, the folder, a record or the lock file cannot be read,
// or the usage is wrong. Faults and warnings go to stdout; the problems that give exit 2 go to stderr.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { units, faults } from '../../project/.claude/plan-graph.mjs';
import safeSpawn from '../../project/.claude/safe-spawn.cjs';
import { check } from './handoff.mjs';
import { budget, filesOf, readMap, InputError, CEILING, ORDER } from './test-budget.mjs';

const COLUMNS = ['Id', 'Files', 'Runs', 'Risk', 'Category', 'Tests', 'Tester'];

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
		return sha(raw.get(id)) === hex ? [] : [`unit ${id} is locked and its row has changed since it was locked`];
	});
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
	let records = null;
	let lock = null;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--records' || argv[i] === '--lock') {
			if (i + 1 >= argv.length) return null;
			if (argv[i] === '--lock') lock = argv[++i];
			else records = argv[++i];
		} else if (argv[i].startsWith('--')) {
			return null;
		} else {
			pos.push(argv[i]);
		}
	}
	return pos.length === 1 ? { plan: pos[0], records, lock } : null;
}

function main(argv) {
	const args = parseArgs(argv);
	if (!args) {
		process.stderr.write('plan-check: usage: node plan-check.mjs <plan.md> [--records <folder>] [--lock <unit>]\n');
		return 2;
	}
	try {
		let text;
		try {
			text = fs.readFileSync(args.plan, 'utf8');
		} catch (e) {
			throw new Unreadable(`cannot read plan ${args.plan}: ${e.code || e.message}`);
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

process.exitCode = main(process.argv.slice(2));
