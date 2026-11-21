#!/usr/bin/env node
// The plan graph (T8, build 14): reads a batch plan's Units table as a graph and names every pair of units that may
// run at once and touch the same file. The lead wrote that pair table by hand, and the checker searched again; a set
// intersection over the plan's own Files and Runs columns answers it at no token cost.
//   node .claude/plan-graph.mjs <plan.md>
// A unit's Runs cell is "parallel", "alone" or "after U1, U2". Two units are kept apart when one runs alone or one
// comes after the other (directly or through others). Named as faults: a shared file between units not kept apart, an
// "after" naming no unit, and a cycle of "after". Each run adds a line to <git dir>/kit-plan-graph.jsonl, which the
// use check reads as proof the part is used.
// Exit 0 clean, 1 faults named, 2 the plan has no Units table or cannot be read.
import fs from 'node:fs';
import path from 'node:path';
import safeSpawn from './safe-spawn.cjs';
import { pathToFileURL } from 'node:url';

/** The units of a plan's text: [{ id, files: Set, runs: 'parallel' | 'alone' | 'after', after: [] }]. */
export function units(text) {
	const lines = String(text).replace(/\r\n/g, '\n').split('\n');
	const at = lines.findIndex((l) => /^## Units\b/.test(l));
	if (at < 0) return null;
	const rows = [];
	let head = null;
	for (const l of lines.slice(at + 1)) {
		if (/^#{1,6} /.test(l)) break;
		// The table ends at its first line that is not a row: a side table further down is not units (the build 14 sweep).
		if (!/^\s*\|/.test(l)) { if (head) break; continue; }
		// Split on pipes a backslash does not escape (markdown writes a pipe inside a cell as \|).
		const cells = l.trim().split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim().replace(/\\\|/g, '|'));
		if (!head) { head = cells.map((c) => c.toLowerCase()); continue; }
		if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
		const col = (name) => cells[head.findIndex((h) => h.startsWith(name))] || '';
		const filesCell = col('files');
		rows.push({
			id: col('id').replace(/[*_`]/g, '').trim(),
			files: new Set([...filesCell.matchAll(/`([^`]+)`/g)].map((m) => norm(m[1]))),
			unread: filesCell.trim() !== '' && !/`[^`]+`/.test(filesCell),
			runsCell: col('runs'),
		});
	}
	if (!head) return null;
	const list = rows.filter((u) => u.id);
	// "after" reads only the ids the table has, so "after U1 (uses its types)" orders U1 and nothing else.
	const ids = new Map(list.map((u) => [u.id.toUpperCase(), u.id]));
	for (const u of list) {
		const runs = u.runsCell.toLowerCase();
		u.runs = /^alone\b/.test(runs) ? 'alone' : /^after\b/.test(runs) ? 'after' : 'parallel';
		u.after = u.runs === 'after' ? [...new Set([...u.runsCell.matchAll(/[A-Za-z][\w.-]*/g)].map((m) => m[0].toUpperCase()).filter((w) => ids.has(w) && w !== u.id.toUpperCase()))] : [];
		u.unknownAfter = u.runs === 'after' && !u.after.length;
	}
	return list;
}

// One spelling per path: forward slashes, no ./, lower case (Windows and macOS fold case); a folder keeps its slash.
const norm = (p) => p.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '').toLowerCase();
// Two paths touch when they are the same, or one is a folder the other sits in.
const touch = (a, b) => a === b || (a.endsWith('/') && b.startsWith(a)) || (b.endsWith('/') && a.startsWith(b));

/** The faults of a plan's units, as plain lines. */
export function faults(list) {
	const out = [];
	const byId = new Map(list.map((u) => [u.id.toUpperCase(), u]));
	for (const u of list) {
		if (u.unknownAfter) out.push(/^after\s+u\w+/i.test(u.runsCell) ? `${u.id} runs after ${/^after\s+(\S+)/i.exec(u.runsCell)[1].replace(/[,.;]$/, '')}, which is not a unit` : `${u.id} runs after no unit it names`);
		if (u.unread) out.push(`${u.id} names no file in backticks, so its files cannot be read`);
	}
	// Everything a unit comes after, through any chain; a unit found in its own chain is in a cycle.
	const before = new Map();
	const reach = (id, seen = new Set()) => {
		for (const a of (byId.get(id) || { after: [] }).after) if (!seen.has(a)) { seen.add(a); reach(a, seen); }
		return seen;
	};
	for (const u of list) before.set(u.id.toUpperCase(), reach(u.id.toUpperCase()));
	const cyc = list.filter((u) => before.get(u.id.toUpperCase()).has(u.id.toUpperCase())).map((u) => u.id);
	if (cyc.length) out.push(`a cycle: ${cyc.join(', ')}`);
	for (let i = 0; i < list.length; i++) {
		for (let j = i + 1; j < list.length; j++) {
			const [a, b] = [list[i], list[j]];
			if (a.runs === 'alone' || b.runs === 'alone') continue;
			if (before.get(a.id.toUpperCase()).has(b.id.toUpperCase()) || before.get(b.id.toUpperCase()).has(a.id.toUpperCase())) continue;
			const shared = [...a.files].filter((f) => [...b.files].some((g) => touch(f, g)));
			if (shared.length) out.push(`${a.id} and ${b.id} may run at once and both touch ${shared.join(', ')}: order them (after) or run one alone`);
		}
	}
	return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	const file = process.argv[2];
	let text = null;
	try { text = fs.readFileSync(file || '', 'utf8'); } catch { /* named below */ }
	const list = text === null ? null : units(text);
	if (!list || !list.length) {
		process.stderr.write(`plan graph: ${text === null ? `cannot read "${file || ''}"` : 'no units in a "## Units" table'} (usage: node .claude/plan-graph.mjs <plan.md>)\n`);
		process.exitCode = 2;
	} else {
		const found = faults(list);
		process.stdout.write(found.length ? `Plan graph: ${list.length} units, ${found.length} fault(s)\n${found.map((f) => `    ${f}`).join('\n')}\n` : `Plan graph: ${list.length} units, no shared file between units that may run at once\n`);
		const g = safeSpawn.gitRead(path.dirname(path.resolve(file)), ['rev-parse', '--git-common-dir'], { encoding: 'utf8' });
		if (g.status === 0) {
			const dir = path.resolve(path.dirname(path.resolve(file)), g.stdout.trim());
			try { fs.appendFileSync(path.join(dir, 'kit-plan-graph.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), plan: path.basename(file), units: list.length, faults: found.length })}\n`); } catch { /* a trace only */ }
		}
		process.exitCode = found.length ? 1 : 0;
	}
}
