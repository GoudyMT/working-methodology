#!/usr/bin/env node
// U15 (build 24): the flow lock. Five checks on the build flow, each a plain script over saved files; none calls a model.
//   node user/kit-tools/flow-check.mjs start <plan.md> --role builder     the plan's latest plan-graph run is clean and not older than the plan
//   node user/kit-tools/flow-check.mjs agents <folder>                   no agent id is both tester and builder, or holds over 3 units or 2 lanes
//   node user/kit-tools/flow-check.mjs reviews <unit> --dir <folder>     one review record (a second needs the lead's note), findings need a fix record
//   node user/kit-tools/flow-check.mjs reviewers <ledger.jsonl>          more than 3 units waiting while at most one reviewer is active
//   node user/kit-tools/flow-check.mjs rounds <unit> --dir <folder>      at most 2 FIX rounds from the checker per unit
//   node user/kit-tools/flow-check.mjs checklist <log.jsonl> --plan <plan.md>   each unit's last step, and the flow faults
// Exit 0 clean, 1 a fault named on stderr, 2 usage or unreadable input. Hand-backs are read with handoff.mjs's check.
// A lead note is text in the record an agent writes, so these checks only log in this release; a lead-only answer file comes before they enforce.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { check } from './handoff.mjs';
import { checklist, InputError } from './checklist.mjs';

const UNIT_BAD = /[\\/]|\.\./;
const MAX_UNITS = 3;
const MAX_LANES = 2;
const MAX_WAITING = 3;
const MAX_FIX = 2;

const say = (msg) => { process.stdout.write(`flow-check: ${msg}\n`); return 0; };
const fault = (lines) => { for (const l of lines) process.stderr.write(`flow-check: ${l}\n`); return 1; };
const bad = (msg) => { process.stderr.write(`flow-check: ${msg}\n`); return 2; };
const usage = (msg = '') => bad(`${msg ? `${msg}; ` : ''}usage: flow-check.mjs start <plan.md> --role builder | agents <folder> | reviews <unit> --dir <folder> | reviewers <ledger.jsonl> | rounds <unit> --dir <folder> | checklist <log.jsonl> --plan <plan.md>`);
const readText = (file) => fs.readFileSync(file, 'utf8');
const lastRecordAt = (lines) => lines.map((l) => l.trim()).lastIndexOf('RECORD:');

// git in a folder, launched as pr-size.mjs launches it: from node's own folder, with the git.exe lookup switched off.
function gitIn(folder, args) {
	return spawnSync('git', ['-C', folder, '-c', 'core.fsmonitor=false', ...args], {
		encoding: 'utf8',
		timeout: 60000,
		windowsHide: true,
		cwd: path.dirname(process.execPath),
		env: { ...process.env, NoDefaultCurrentDirectoryInExePath: '1' },
	});
}

// The role line of a hand-back: the first non-blank line after its last RECORD: marker, as JSON; null when none.
function roleLine(text) {
	const lines = text.split(/\r?\n/);
	const at = lastRecordAt(lines);
	const first = at < 0 ? undefined : lines.slice(at + 1).find((l) => l.trim() !== '');
	try { return first === undefined ? null : JSON.parse(first); } catch { return null; }
}

// The note lines of a hand-back, the JSON objects with a note key after its RECORD: marker.
function notesOf(text) {
	const lines = text.split(/\r?\n/);
	const at = lastRecordAt(lines);
	return at < 0 ? [] : lines.slice(at + 1).flatMap((l) => {
		try { const o = JSON.parse(l); return o && typeof o.note === 'string' ? [o] : []; } catch { return []; }
	});
}

// start <plan.md> --role builder: the latest plan-graph line for this plan's name (its folder's git dir) has no faults
// and is not older than the plan file.
async function start(planArg) {
	const plan = path.resolve(planArg);
	const name = path.basename(plan);
	// plan-check's checks come first: a plan it refuses never starts, whatever its plan-graph run said.
	// Loaded here only: plan-check reads the plan graph, and the other subcommands never need it.
	const { planFaults } = await import('./plan-check.mjs');
	let faults;
	try { faults = planFaults(plan); } catch (e) { return bad(`${name}: ${e.message}`); }
	if (faults.length) return fault(faults.map((f) => `${name} has a plan-check fault: ${f}`));
	const mtime = fs.statSync(plan).mtimeMs;
	const g = gitIn(path.dirname(plan), ['rev-parse', '--git-common-dir']);
	if (g.status !== 0) return fault([`${name} is not in a git repository, so there is no plan-graph log: run plan-graph on it`]);
	const logFile = path.join(path.resolve(path.dirname(plan), g.stdout.trim()), 'kit-plan-graph.jsonl');
	let lines = [];
	try { lines = readText(logFile).split(/\r?\n/).filter((l) => l.trim()); } catch (e) { if (e.code !== 'ENOENT') throw e; }
	let last = null;
	for (const line of lines) {
		let o;
		try { o = JSON.parse(line); } catch { return bad(`${logFile} has a line that is not JSON`); }
		// A line with a planPath is this plan only at that full path; a legacy line with none matches by basename.
		if (o && (o.planPath === undefined ? o.plan === name : o.planPath === plan.replace(/\\/g, '/'))) last = o;
	}
	if (!last) return fault([`no plan-graph log line for ${name} in ${logFile}: run node .claude/plan-graph.mjs ${planArg} first`]);
	if (last.faults !== 0) return fault([`plan-graph's latest run of ${name} (${last.at}) reported ${last.faults} fault(s): fix the plan and run plan-graph again`]);
	const at = Date.parse(last.at);
	if (Number.isNaN(at)) return fault([`${name}'s latest plan-graph line has no valid time: run plan-graph again`]);
	// Whole milliseconds: a plan saved in the same millisecond as its run is not newer than it.
	if (Math.floor(mtime) > at) return fault([`${name} changed after its plan-graph run at ${last.at}: run plan-graph again`]);
	return say(`start: ${name} has a clean plan-graph run at ${last.at}`);
}

// agents <folder>: every hand-back (a .jsonl with a RECORD: line) read with handoff's check; per agent id, not both
// tester and builder, at most 3 distinct units and at most 2 lanes.
function agents(folder) {
	const by = new Map();
	const out = [];
	let n = 0;
	for (const name of fs.readdirSync(folder).sort()) {
		if (!name.endsWith('.jsonl')) continue;
		const text = readText(path.join(folder, name));
		const lines = text.split(/\r?\n/);
		// A file with no word "record" is not a hand-back; one that names it without the exact RECORD: line is a fault.
		if (!lines.some((l) => l.trim() === 'RECORD:')) {
			if (lines.some((l) => /record/i.test(l))) out.push(`${name}: no exact RECORD: line`);
			continue;
		}
		const r = check(text);
		if (!r.ok) { out.push(`${name}: ${r.errors.join('; ')}`); continue; }
		n++;
		const role = roleLine(text);
		if (!role || typeof role.agent !== 'string' || !role.agent) { out.push(`${name}: its role line has no agent key`); continue; }
		const e = by.get(role.agent) ?? { roles: new Set(), units: new Set(), lanes: new Set() };
		by.set(role.agent, e);
		e.roles.add(role.role);
		if (role.unit) e.units.add(String(role.unit));
		if (role.lane) e.lanes.add(String(role.lane));
	}
	for (const [agent, e] of by) {
		if (e.roles.has('tester') && e.roles.has('builder')) out.push(`agent ${agent} is both tester and builder`);
		if (e.units.size > MAX_UNITS) out.push(`agent ${agent} holds ${e.units.size} units, max ${MAX_UNITS}: ${[...e.units].join(', ')}`);
		if (e.lanes.size > MAX_LANES) out.push(`agent ${agent} works ${e.lanes.size} lanes, max ${MAX_LANES}: ${[...e.lanes].join(', ')}`);
	}
	return out.length ? fault(out) : say(`agents: ${n} hand-backs, ${by.size} agent id(s), no agent over the limits`);
}

// reviews <unit> --dir <folder>: <unit>.review*.jsonl (a second or later one needs the lead's "second review:" note),
// and <unit>.fix.jsonl when there is any finding. The unit name matches exactly: U1 is not U10.
function reviews(unit, dir) {
	const files = fs.readdirSync(dir).flatMap((name) => {
		const m = /^(.+)\.review(\d*)\.jsonl$/.exec(name);
		return m && m[1] === unit ? [{ name, k: m[2] === '' ? 0 : Number(m[2]) }] : [];
	}).sort((a, b) => a.k - b.k);
	if (!files.length) return fault([`no review for ${unit} in ${dir}: the test-reviewer writes ${unit}.review.jsonl`]);
	const out = [];
	let findings = 0;
	const ids = [];
	files.forEach(({ name }, i) => {
		const text = readText(path.join(dir, name));
		const r = check(text, { role: 'test-reviewer' });
		if (!r.ok) { out.push(`${name}: ${r.errors.join('; ')}`); return; }
		findings += r.findings.length;
		ids.push(...r.findings.map((f) => f.id));
		if (i > 0 && !notesOf(text).some((o) => o.writer === 'lead' && /^second review:/.test(o.note))) {
			out.push(`${name} is a second review of ${unit} with no lead note: a line {"note":"second review: <why>","writer":"lead"}`);
		}
	});
	const fixName = `${unit}.fix.jsonl`;
	const hasFix = fs.existsSync(path.join(dir, fixName));
	if (hasFix) {
		const fx = check(readText(path.join(dir, fixName)), { role: 'tester' });
		if (!fx.ok) out.push(`${fixName}: ${fx.errors.join('; ')}`);
		// A finding passes only with a fixed line for its id; a note saying "fixed" does not mark it.
		const fixed = new Set(fx.findings.filter((f) => f.status === 'fixed').map((f) => f.id));
		const missing = ids.filter((id) => !fixed.has(id));
		if (missing.length) out.push(`${unit} review finding(s) with no fixed line in ${fixName}: ${missing.join(', ')}`);
	}
	if (findings && !hasFix) out.push(`${unit} has ${findings} review finding(s) and no fix record: ${fixName} holds the tester's fixes`);
	return out.length ? fault(out) : say(`reviews: ${unit} ok, ${files.length} review record(s), ${findings} finding(s)`);
}

// reviewers <ledger.jsonl>: lines {at, unit, event, reviewer}; review-start opens a unit with its reviewer, review-done
// closes it, review-wait queues it. After each line, more than 3 waiting with at most one active reviewer is a fault.
function reviewers(file) {
	const open = new Map();
	const waiting = new Set();
	const lines = readText(file).split(/\r?\n/).filter((l) => l.trim());
	for (let i = 0; i < lines.length; i++) {
		let e;
		try { e = JSON.parse(lines[i]); } catch { return bad(`${file} line ${i + 1} is not JSON`); }
		if (!e || typeof e !== 'object') return bad(`${file} line ${i + 1} is not an event object`);
		if (e.event === 'review-start') { open.set(e.unit, e.reviewer); waiting.delete(e.unit); }
		else if (e.event === 'review-wait') waiting.add(e.unit);
		else if (e.event === 'review-done') { open.delete(e.unit); waiting.delete(e.unit); }
		const active = new Set(open.values()).size;
		if (waiting.size > MAX_WAITING && active <= 1) {
			return fault([`at ${e.at}: ${waiting.size} units wait for review (${[...waiting].join(', ')}) with ${active} active reviewer(s); at most ${MAX_WAITING} may wait with one reviewer`]);
		}
	}
	return say(`reviewers: never more than ${MAX_WAITING} units waiting with one active reviewer`);
}

// rounds <unit> --dir <folder>: <unit>.checker*.jsonl, a FIX record holds a line VERDICT: FIX. The unit name matches exactly.
function rounds(unit, dir) {
	const fix = fs.readdirSync(dir).filter((name) => {
		const m = /^(.+)\.checker\d*\.jsonl$/.exec(name);
		return m && m[1] === unit && (/^VERDICT:[ \t]*(\S+)/m.exec(readText(path.join(dir, name))) || [])[1] === 'FIX';
	}).length;
	if (fix > MAX_FIX) return fault([`${unit} has ${fix} FIX rounds from the checker, max ${MAX_FIX}: the lead decides the next step, not another round`]);
	return say(`rounds: ${unit} has ${fix} FIX round(s), max ${MAX_FIX}`);
}

// checklist <log.jsonl> --plan <plan.md>: one line per plan unit on stdout (its last step, or not started), the flow
// faults on stderr with exit 1. A log or plan that cannot be read, or a line that is not a step, exits 2.
function checklistCmd(logFile, planFile) {
	let lines;
	let faults;
	try {
		({ lines, faults } = checklist(readText(planFile), readText(logFile)));
	} catch (e) {
		if (e instanceof InputError) return bad(e.message);
		throw e;
	}
	for (const l of lines) process.stdout.write(`${l}\n`);
	return faults.length ? fault(faults) : 0;
}

function main(argv) {
	const [cmd, ...rest] = argv;
	const flags = {};
	const pos = [];
	for (let i = 0; i < rest.length; i++) {
		if (rest[i] === '--role' || rest[i] === '--dir' || rest[i] === '--plan') {
			if (rest[i + 1] === undefined) return usage(`${rest[i]} needs a value`);
			flags[rest[i].slice(2)] = rest[++i];
		} else pos.push(rest[i]);
	}
	const unitOk = (u) => u !== undefined && u.trim() !== '' && !UNIT_BAD.test(u);
	switch (cmd) {
		case 'start':
			return pos.length === 1 && flags.role === 'builder' ? start(pos[0]) : usage('start needs one plan and --role builder');
		case 'agents':
			return pos.length === 1 ? agents(pos[0]) : usage('agents needs one folder');
		case 'reviews':
			if (pos.length !== 1 || flags.dir === undefined) return usage('reviews needs one unit and --dir <folder>');
			return unitOk(pos[0]) ? reviews(pos[0], flags.dir) : bad(`unit ${JSON.stringify(pos[0])} is not a plain name`);
		case 'reviewers':
			return pos.length === 1 ? reviewers(pos[0]) : usage('reviewers needs one ledger file');
		case 'rounds':
			if (pos.length !== 1 || flags.dir === undefined) return usage('rounds needs one unit and --dir <folder>');
			return unitOk(pos[0]) ? rounds(pos[0], flags.dir) : bad(`unit ${JSON.stringify(pos[0])} is not a plain name`);
		case 'checklist':
			return pos.length === 1 && flags.plan !== undefined ? checklistCmd(pos[0], flags.plan) : usage('checklist needs one log and --plan <plan.md>');
		default:
			return usage();
	}
}

try {
	process.exitCode = await main(process.argv.slice(2));
} catch (e) {
	if (!e.code) throw e;
	process.stderr.write(`flow-check: cannot read ${e.path ?? ''}: ${e.code}\n`);
	process.exitCode = 2;
}
