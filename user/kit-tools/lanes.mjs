#!/usr/bin/env node
// Splits a sweep's findings into lanes that share no file, so each lane's fix runs in its own worktree and no two
// lanes edit one file. The input is a hand-back's findings file: one JSON object per finding line. Prose, RECORD:,
// role, note and notChecked lines are skipped; a fixed or dropped finding gets no lane; a finding with no status is
// open. A where may name several files, split by ", ", and findings that name one file share a lane. A files.json
// entry ties more files to a finding: its keys are finding ids, its values lists of paths.
//   node lanes.mjs <findings.jsonl> [--files <files.json>]
// Output: one JSON line per lane, {"lane":"L1","findings":["F1","F2"],"files":["src/a.js"]}. A lane with no file is
// marked "nofile":true and has "files":[]. Lanes sort by their highest severity, then by the input position of their
// first finding. Exit 0 (nothing printed when no open finding is left); exit 2 when a file cannot be read, a finding
// line has no id or where, its severity is missing or unknown, or the file holds no JSON object line at all. The problem
// goes to stderr and stdout stays empty.
import fs from 'node:fs';
import path from 'node:path';

const RANK = { critical: 4, high: 3, medium: 2, low: 1 };
const DONE = new Set(['fixed', 'dropped']);
const FINDING_KEYS = ['id', 'severity', 'status', 'where', 'claim', 'proof', 'fix'];

// A problem with the input. main() turns it into exit 2 with the message on stderr.
class BadInput extends Error {}

// One spelling per file, folded as project/.claude/plan-graph.mjs folds it: no line number, forward slashes, no ./,
// lower case (Windows and macOS fold case). Empty and "-" name no file and come back as null.
const fileOf = (entry) => {
	const t = entry.trim().replace(/:\d+(?:[:-]\d+)?$/, '').replace(/\\/g, '/');
	const f = t === '' || t === '-' ? '' : path.posix.normalize(t).toLowerCase();
	return f && f !== '.' ? f : null;
};
const filesIn = (where) => where.split(',').map(fileOf).filter(Boolean);

// The finding lines of a hand-back, in input order. A line that does not open with { is prose or RECORD:. An object
// with none of the finding keys is a role, note or notChecked line. A { line that is not JSON is an input error.
function findingsIn(text) {
	const out = [];
	let objects = 0;
	text.split(/\r?\n/).forEach((line, i) => {
		const s = line.trim();
		if (!s.startsWith('{')) return;
		let o;
		try {
			o = JSON.parse(s);
		} catch {
			throw new BadInput(`line ${i + 1} starts with { but is not JSON`);
		}
		objects++;
		if (FINDING_KEYS.some((k) => k in o)) out.push(o);
	});
	// A file with no JSON object line at all is not a findings file (a markdown plan, say): refused, not an empty result.
	if (objects === 0) throw new BadInput('no JSON object line: this is not a findings file');
	return out;
}

// Every finding is checked, fixed and dropped ones too, so a broken line never passes silently.
function checked(f) {
	if (typeof f.id !== 'string' || f.id.trim() === '') throw new BadInput(`a finding line has no id: ${JSON.stringify(f).slice(0, 120)}`);
	if (typeof f.where !== 'string') throw new BadInput(`finding ${f.id} has no where (a file:line, or - for none)`);
	if (!Object.prototype.hasOwnProperty.call(RANK, f.severity)) {
		const got = f.severity === undefined ? 'missing' : JSON.stringify(f.severity);
		throw new BadInput(`finding ${f.id} has a missing or unknown severity (${got}; use critical, high, medium or low)`);
	}
	return f;
}

// The files.json map: finding id -> list of paths. Anything else is an input error.
function filesMap(file) {
	let o;
	try {
		o = JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch (e) {
		throw new BadInput(`cannot read --files ${file}: ${e.message}`);
	}
	if (!o || typeof o !== 'object' || Array.isArray(o)) throw new BadInput(`--files ${file} is not an object of finding id -> file list`);
	for (const [id, list] of Object.entries(o)) {
		if (!Array.isArray(list) || list.some((p) => typeof p !== 'string')) throw new BadInput(`--files ${file}: the files for ${id} are not a list of paths`);
	}
	return o;
}

// Open findings (input order) are joined with union-find: two that share a file, or that a files.json entry ties to
// one file, end in one group. Each group is one lane.
function lanesOf(all, extra) {
	const open = all
		.map((f, i) => ({ f, i, files: new Set(filesIn(f.where)) }))
		.filter((o) => !DONE.has(o.f.status ?? 'open'));
	for (const o of open) {
		const tied = Object.prototype.hasOwnProperty.call(extra, o.f.id) ? extra[o.f.id] : [];
		for (const p of tied) {
			const f = fileOf(p);
			if (f) o.files.add(f);
		}
	}
	const parent = open.map((_, k) => k);
	const root = (k) => (parent[k] === k ? k : (parent[k] = root(parent[k])));
	const holder = new Map();
	open.forEach((o, k) => {
		for (const file of o.files) {
			if (holder.has(file)) parent[root(k)] = root(holder.get(file));
			else holder.set(file, k);
		}
	});
	const groups = new Map();
	open.forEach((o, k) => {
		const r = root(k);
		if (!groups.has(r)) groups.set(r, { items: [], files: new Set() });
		const g = groups.get(r);
		g.items.push(o);
		for (const file of o.files) g.files.add(file);
	});
	const lanes = [...groups.values()].map((g) => ({
		findings: g.items.map((o) => o.f.id),
		files: [...g.files].sort(),
		rank: Math.max(...g.items.map((o) => RANK[o.f.severity])),
		first: g.items[0].i,
	}));
	lanes.sort((a, b) => b.rank - a.rank || a.first - b.first);
	return lanes.map((l, n) => {
		const row = { lane: `L${n + 1}`, findings: l.findings, files: l.files };
		if (l.files.length === 0) row.nofile = true;
		return row;
	});
}

function parseArgs(argv) {
	const pos = [];
	let files = null;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--files') {
			if (i + 1 >= argv.length) return null;
			files = argv[++i];
		} else if (argv[i].startsWith('--')) {
			return null;
		} else {
			pos.push(argv[i]);
		}
	}
	return pos.length === 1 ? { findings: pos[0], files } : null;
}

const fail = (msg) => {
	process.stderr.write(`lanes: ${msg}\n`);
	return 2;
};

function main(argv) {
	const args = parseArgs(argv);
	if (!args) return fail('usage: node lanes.mjs <findings.jsonl> [--files <files.json>]');
	try {
		let text;
		try {
			text = fs.readFileSync(args.findings, 'utf8');
		} catch (e) {
			throw new BadInput(`cannot read ${args.findings}: ${e.message}`);
		}
		const all = findingsIn(text).map(checked);
		const extra = args.files === null ? {} : filesMap(args.files);
		const lanes = lanesOf(all, extra);
		process.stdout.write(lanes.map((l) => `${JSON.stringify(l)}\n`).join(''));
		return 0;
	} catch (e) {
		if (!(e instanceof BadInput)) throw e;
		return fail(e.message);
	}
}

process.exitCode = main(process.argv.slice(2));
