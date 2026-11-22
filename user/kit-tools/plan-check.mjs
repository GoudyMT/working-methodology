#!/usr/bin/env node
// Checks a batch plan before any unit runs, and the saved hand-back records against it.
// The plan's Units table needs the columns Id, Files, Runs, Risk and Tester; each unit row needs a Files cell and a
// Runs cell; the table needs at least one unit; and the plan graph (project/.claude/plan-graph.mjs) must name no fault:
// two units that may run at once and touch one file, a Runs that names no unit, or a cycle of "after".
// With --records <folder>, each .jsonl file there is a whole hand-back (prose, RECORD:, then JSON lines), checked by
// handoff.mjs's check. Its unit comes from its role line only, compared exactly after trimming. A record naming a unit
// the plan does not hold is a fault, and so is a builder record whose unit has no tester record. A record with no unit
// is skipped, with a line "record without unit: <file name>".
//   node plan-check.mjs <plan.md> [--records <folder>]
// Exit 0 clean (warning lines allowed), 1 faults named, 2 the plan, the folder or a record cannot be read, or the usage
// is wrong. Faults and warnings go to stdout; the problems that give exit 2 go to stderr.
import fs from 'node:fs';
import path from 'node:path';
import { units, faults } from '../../project/.claude/plan-graph.mjs';
import { check } from './handoff.mjs';

const COLUMNS = ['Id', 'Files', 'Runs', 'Risk', 'Tester'];

// A problem with an input the check cannot read. main() turns it into exit 2.
class Unreadable extends Error {}

// The Units table of a plan text: its header cells and its row cells, or null when the plan has no Units table.
// It ends at its first line that is not a row, as project/.claude/plan-graph.mjs reads it.
function unitsTable(text) {
	const lines = text.replace(/\r\n/g, '\n').split('\n');
	const at = lines.findIndex((l) => /^## Units\b/.test(l));
	if (at < 0) return null;
	let head = null;
	const rows = [];
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
	}
	return head ? { head, rows } : null;
}

// The plan's faults and its unit ids. A missing column or an empty Files or Runs cell is named by unit and column.
function checkPlan(text) {
	const table = unitsTable(text);
	if (table === null) return { faults: ['the plan has no ## Units table'], ids: new Set() };
	const at = {};
	const missing = [];
	for (const key of COLUMNS) {
		const i = table.head.findIndex((h) => h.startsWith(key.toLowerCase()));
		if (i < 0) missing.push(`the Units table has no ${key} column`);
		else at[key] = i;
	}
	if (missing.length) return { faults: missing, ids: new Set() };
	const found = [];
	const ids = new Set();
	for (const row of table.rows) {
		const id = (row[at.Id] || '').replace(/[*_`]/g, '').trim();
		if (!id) continue;
		ids.add(id);
		if ((row[at.Files] || '').trim() === '') found.push(`unit ${id} has an empty Files cell`);
		if ((row[at.Runs] || '').trim() === '') found.push(`unit ${id} has an empty Runs cell`);
	}
	if (ids.size === 0) found.push('the Units table has no units');
	else found.push(...faults(units(text) || []));
	return { faults: found, ids };
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
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--records') {
			if (i + 1 >= argv.length) return null;
			records = argv[++i];
		} else if (argv[i].startsWith('--')) {
			return null;
		} else {
			pos.push(argv[i]);
		}
	}
	return pos.length === 1 ? { plan: pos[0], records } : null;
}

function main(argv) {
	const args = parseArgs(argv);
	if (!args) {
		process.stderr.write('plan-check: usage: node plan-check.mjs <plan.md> [--records <folder>]\n');
		return 2;
	}
	try {
		let text;
		try {
			text = fs.readFileSync(args.plan, 'utf8');
		} catch (e) {
			throw new Unreadable(`cannot read plan ${args.plan}: ${e.code || e.message}`);
		}
		const plan = checkPlan(text);
		const rec = args.records === null ? { found: [], warnings: [], read: 0 } : checkRecords(args.records, plan.ids);
		const lines = [...plan.faults, ...rec.found];
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
