#!/usr/bin/env node
// Checks a batch plan before any unit runs, and the saved hand-back records against it.
// The Units table needs the columns Id, Files, Runs, Risk, Category, Tests and Tester; a unit's Files, Runs, Category and
// Tests cells are not empty; the plan graph (project/.claude/plan-graph.mjs) names no fault; the test budget
// (test-budget.mjs) holds; each spec rule has a test line "-> <id>"; guard rows hold (guard-rows.mjs).
// --lock <unit> writes the row's sha256 to <plan>.locks.json when the plan checks clean; a later check refuses a changed row.
// --lock-rows writes the sha256 of the plan's Rows line under "rows" in the same file, when the plan checks clean; a later
// check refuses a Rows line that changed (a row added, taken out or reworded), since the build's row list is locked.
// --records <folder> checks each .jsonl hand-back (handoff.mjs) against the plan by its role line's unit.
// --whys prints each unit's test names and their why lines, derived from its Tests cell (K368); a why under six words is a
// fault in the check. --brief <unit> --role tester|builder prints that unit's brief as markdown: its files, test names,
// why lines and the lock commands, written from the row so they are never typed by hand.
//   node plan-check.mjs <plan.md> [--records <folder>] [--lock <unit> | --lock-rows]
//   node plan-check.mjs <plan.md> --whys
//   node plan-check.mjs <plan.md> --brief <unit> --role tester|builder
// Exit 0 clean, 1 faults on stdout (or an unknown unit or role, or a unit with no lane, on stderr), 2 unreadable input or bad
// usage (stderr).
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

// The table under a heading of a plan text: its header cells, its row cells and each row's text, or null when the plan has no
// such heading. It ends at its first line that is not a row, as project/.claude/plan-graph.mjs reads it.
function tableUnder(text, heading) {
	const lines = text.replace(/\r\n/g, '\n').split('\n');
	const at = lines.findIndex((l) => heading.test(l));
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

const unitsTable = (text) => tableUnder(text, /^## Units\b/);

// The lane a unit runs in: the first word of the Lane cell of the Lanes row whose "Units, in order" cell names the unit
// ("B (row lock)" gives B; "U1, then U2" names both). Null when no Lanes row names the unit, or the plan has no Lanes table.
function laneOf(text, id) {
	const table = tableUnder(text, /^## Lanes\b/);
	if (table === null) return null;
	const lane = table.head.findIndex((h) => h.startsWith('lane'));
	const units = table.head.findIndex((h) => h.startsWith('units'));
	if (lane < 0 || units < 0) return null;
	const row = table.rows.find((r) => (r[units] || '').replace(/[*_`]/g, '').split(',').flatMap((p) => p.split(/\bthen\b/i)).map((s) => s.trim()).includes(id));
	if (!row) return null;
	return (row[lane] || '').replace(/[*_`]/g, '').trim().split(/\s+/)[0] || null;
}

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

// The plan's Rows line as its text without the line ending (CRLF safe), or null when the plan has none.
function rowsLineOf(text) {
	return text.split(/\r?\n/).find((l) => l.startsWith('- **Rows')) ?? null;
}

// The row ids a Rows line lists: the text after its colon, split at commas, with the markup taken out. Only plain ids
// (letters and digits) count, so a defer command never carries anything a shell could read.
function rowIdsOf(rowsLine) {
	if (!rowsLine) return [];
	const after = rowsLine.slice(rowsLine.indexOf(':') + 1);
	return after.replace(/[*_`]/g, '').split(',').map((s) => s.trim()).filter((s) => /^[A-Za-z0-9]+$/.test(s));
}

// The locked Rows line text beside the locks file (<plan>.rows.txt), or null when it is missing or does not hash to the
// locked sha. The locks file keeps only the sha, so the text lives in its own sidecar.
function lockedRowsOf(plan, locks) {
	if (!Object.prototype.hasOwnProperty.call(locks, 'rows')) return null;
	let text;
	try {
		text = fs.readFileSync(`${plan}.rows.txt`, 'utf8');
	} catch {
		return null;
	}
	return sha(text) === locks.rows ? text : null;
}

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

// A test line whose derived why has fewer than six words is a plan fault, named by its unit and its line. Only --whys and
// --brief raise it: a plan with one-word test names checks clean in the default run.
const WHY_MIN_WORDS = 6;
function shortWhys(u) {
	return testLines(u.tests).map(testOf).flatMap((t) => {
		const words = whyOf(t.name).split(/\s+/).length;
		return words < WHY_MIN_WORDS ? [`${u.id}: "${t.name}" has a why of ${words} words, under ${WHY_MIN_WORDS}`] : [];
	});
}

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
function briefText(u, role, planPath, lane) {
	const lockTool = path.join(import.meta.dirname, 'unit-lock.mjs').replace(/\\/g, '/');
	const lock = /\s/.test(lockTool) ? `"${lockTool}"` : lockTool;
	const lines = [`Plan: ${planPath}`, `Unit: ${u.id}`, `Role: ${role}`, 'Worktree: <absolute path of your own worktree>', `Lane: ${lane}`, ''];
	const files = filesOf(u.files);
	const tests = files.filter((f) => TEST_FOLDER.test(f.replace(/\\/g, '/')));
	const src = files.filter((f) => !TEST_FOLDER.test(f.replace(/\\/g, '/')));
	if (role === 'tester') {
		return [`# Tester brief: ${u.id}`, '', ...lines, `Title: ${u.title.trim()}`, `Files: ${u.files.trim()}`, '',
			'Write each test first, with its name and its why line as given:', '',
			...testLines(u.tests).flatMap((l) => {
				const t = testOf(l);
				return [`- ${t.name}`, `  ${whyLine(t, u.rowId)}`];
			}), '',
			'Lock before the unit runs, from the repo root:', '', '```', `node ${lock} --tester --files ${tests.join(',')}`, '```', ''].join('\n');
	}
	return [`# Builder brief: ${u.id}`, '', ...lines, `Title: ${u.title.trim()}`, '',
		`Source files (edit these): ${src.join(', ')}`, `Tests (locked, never edit): ${tests.join(', ')}`, '',
		'Run only these tests:', '', '```', `node --test ${tests.join(' ')}`, '```', '',
		'Lock after the red commit, with its sha:', '', '```', `node ${lock} <red sha> --files ${src.join(',')}`, '```', ''].join('\n');
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

// The locks file's key for the plan's Rows line (K372): the sha256 of that line, written by --lock-rows.
const ROWS_KEY = 'rows';
const CLOSEOUT_TOOL = path.join(import.meta.dirname, 'closeout.mjs').replace(/\\/g, '/');

// A locked unit whose row text no longer hashes to its lock is a fault; a locked unit with no row is one too. A locked
// Rows line that no longer hashes to its lock is a fault too: a new find goes to the next patch, not into this build.
function lockFaults(locks, raw, rowsLine, lockedRows) {
	const units = Object.entries(locks).filter(([id]) => id !== ROWS_KEY).flatMap(([id, hex]) => {
		if (!raw.has(id)) return [`locked unit ${id} has no row in the Units table`];
		return sha(raw.get(id)) === hex ? [] : [`unit ${id}: the locked row changed since --lock`];
	});
	if (!Object.prototype.hasOwnProperty.call(locks, ROWS_KEY) || (rowsLine !== null && sha(rowsLine) === locks[ROWS_KEY])) return units;
	const restore = lockedRows === null
		? 'restore the locked Rows line from git (its <plan>.rows.txt is missing or does not match the lock)'
		: `restore this Rows line after deferring the new row: ${lockedRows}`;
	const locked = rowIdsOf(lockedRows);
	const added = lockedRows === null ? [] : rowIdsOf(rowsLine).filter((id) => !locked.includes(id));
	return [
		...units,
		`the Rows line changed after the build started: a new find goes to the next patch; ${restore}`,
		...added.map((id) => `the added row ${id} goes to the next patch: node ${CLOSEOUT_TOOL} defer "${id}"`),
	];
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
	const text = fs.readFileSync(plan, 'utf8');
	const p = checkPlan(text, mapOf(plan));
	const locks = readLocks(`${plan}.locks.json`);
	return [...p.faults, ...lockFaults(locks, p.raw, rowsLineOf(text), lockedRowsOf(plan, locks))];
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
	let lockRows = false;
	for (let i = 0; i < argv.length; i++) {
		if (['--records', '--lock', '--brief', '--role'].includes(argv[i])) {
			if (i + 1 >= argv.length) return null;
			opt[argv[i].slice(2)] = argv[++i];
		} else if (argv[i] === '--whys') {
			whys = true;
		} else if (argv[i] === '--lock-rows') {
			lockRows = true;
		} else if (argv[i].startsWith('--')) {
			return null;
		} else {
			pos.push(argv[i]);
		}
	}
	const brief = opt.brief ?? null;
	const records = opt.records ?? null;
	const lock = opt.lock ?? null;
	// --whys and --brief print and stop: they take no --records, --lock or --lock-rows, and --role goes with --brief only.
	// --lock and --lock-rows each write the locks file, so they are not given together.
	if (pos.length !== 1 || (whys && brief !== null) || ((whys || brief !== null) && (records !== null || lock !== null || lockRows))) return null;
	if (lockRows && lock !== null) return null;
	if ((opt.role !== undefined) !== (brief !== null)) return null;
	return { plan: pos[0], records, lock, lockRows, whys, brief, role: opt.role ?? null };
}

function main(argv) {
	const args = parseArgs(argv);
	if (!args) {
		process.stderr.write('plan-check: usage: node plan-check.mjs <plan.md> [--records <folder>] [--lock <unit> | --lock-rows] | <plan.md> --whys | <plan.md> --brief <unit> --role tester|builder\n');
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
			const all = planUnits(text);
			process.stdout.write(whysText(all));
			const shorts = all.flatMap(shortWhys);
			for (const f of shorts) process.stdout.write(`fault: ${f}\n`);
			return shorts.length ? 1 : 0;
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
			const shorts = shortWhys(unit);
			if (shorts.length) {
				for (const f of shorts) process.stderr.write(`plan-check: fault: ${f}\n`);
				return 1;
			}
			const lane = laneOf(text, unit.id);
			if (lane === null) {
				process.stderr.write(`plan-check: fault: unit ${unit.id} is in no Lanes row's Units cell, so its brief has no lane\n`);
				return 1;
			}
			process.stdout.write(briefText(unit, args.role, args.plan, lane));
			return 0;
		}
		const plan = checkPlan(text, mapOf(args.plan));
		const lockFile = `${args.plan}.locks.json`;
		const locks = readLocks(lockFile);
		const rec = args.records === null ? { found: [], warnings: [], read: 0 } : checkRecords(args.records, plan.ids);
		const rowsLine = rowsLineOf(text);
		const lines = [...plan.faults, ...lockFaults(locks, plan.raw, rowsLine, lockedRowsOf(args.plan, locks)), ...rec.found];
		if (args.lockRows && rowsLine === null) lines.push('the plan has no Rows line to lock');
		if (args.lockRows && lines.length === 0) {
			fs.writeFileSync(lockFile, `${JSON.stringify({ ...locks, [ROWS_KEY]: sha(rowsLine) }, null, 2)}\n`);
				fs.writeFileSync(`${args.plan}.rows.txt`, rowsLine);
			process.stdout.write(`locked: ${ROWS_KEY} in ${lockFile}\n`);
		} else if (args.lockRows) {
			process.stdout.write('not locked: rows, the plan has faults\n');
		}
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
