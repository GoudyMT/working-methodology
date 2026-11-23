#!/usr/bin/env node
// K369 (patch 1.51.1): after the sweep, a new test needs a ticket (CI holds it). The closeout file
// docs/builds/<version>.closeout.json is written by one commit, the closeout commit. Each test, script, hook or CI file
// the range after it adds needs its own ticket: one fix row in the build record whose finding is a ticket.
//   node user/kit-tools/closeout.mjs check [--root <repo>]
//   node user/kit-tools/closeout.mjs defer "<text>" [--root <repo>]
// The root is --root, else KIT_RECORD_ROOT, else the repo top of the cwd. Problems go to stderr, one per line, and exit 1;
// a clean check exits 0. A failing check appends one line {at, hook, cause} to <git common dir>/kit-guard-open.log.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const TEST_FILE = /^tests\/.+\.test\.mjs$/;
const TEST_LINE = /^test\((['"`])((?:\\.|(?!\1).)*)\1/;
const RENAMED = /^\s*\/\/ renamed from: /;
// The paths a new script, hook or CI file lives under.
const NEW_KIND = /^(scripts\/|user\/kit-tools\/|user\/kit-hooks\/|project\/\.githooks\/|\.github\/)/;

// A problem the check cannot read at all: the check fails on it, and logs it.
class Unreadable extends Error {}

const isTicket = (f) => ['high', 'critical'].includes(f.severity) || f.security === true || f.owner === true;

function git(root, args) {
	const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
	if (r.status !== 0) throw new Unreadable(`git ${args[0]} failed: ${String(r.stderr).trim().split('\n')[0]}`);
	return r.stdout;
}

function versionOf(root) {
	try {
		return fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
	} catch (e) {
		throw new Unreadable(`cannot read VERSION: ${e.code || e.message}`);
	}
}

function readJson(file, rel) {
	let text;
	try {
		text = fs.readFileSync(file, 'utf8');
	} catch (e) {
		throw new Unreadable(`cannot read ${rel}: ${e.code || e.message}`);
	}
	try {
		return JSON.parse(text);
	} catch (e) {
		throw new Unreadable(`${rel} is not readable JSON: ${e.message.split('\n')[0]}`);
	}
}

// The test names of one file's text: each name maps to whether a "// renamed from:" line sits in the comment block above it.
function testsIn(text) {
	const lines = text.replace(/\r\n/g, '\n').split('\n');
	const out = new Map();
	lines.forEach((l, i) => {
		const m = TEST_LINE.exec(l);
		if (!m) return;
		let head = i;
		while (head > 0 && /^\s*\/\//.test(lines[head - 1])) head--;
		out.set(m[2].replace(/\\(.)/g, '$1'), lines.slice(head, i).some((c) => RENAMED.test(c)));
	});
	return out;
}

// The findings of the closeout file, id to severity; null when it is missing or unreadable (the check reports that).
export function findingsOf(root, version) {
	try {
		const co = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'builds', `${version}.closeout.json`), 'utf8'));
		return new Map(co.findings.map((f) => [f.id, f.severity]));
	} catch {
		return null;
	}
}

// Every problem with the closeout of the repo at root, as plain lines; none when it is clean.
function problemsIn(root) {
	if (git(root, ['rev-parse', '--is-shallow-repository']).trim() === 'true') {
		return ['the clone is shallow: the closeout check reads the whole history (git fetch --unshallow)'];
	}
	const version = versionOf(root);
	const rec = readJson(path.join(root, 'docs', 'builds', `${version}.json`), `docs/builds/${version}.json`);
	if (!rec || typeof rec !== 'object') throw new Unreadable(`docs/builds/${version}.json is not a JSON object`);
	// Nothing is owed by a record with no sweep.
	if (!rec.sweep) return [];
	const rel = `docs/builds/${version}.closeout.json`;
	if (!fs.existsSync(path.join(root, rel))) return [`${rel} is missing: a record with a sweep needs its closeout file, committed once`];
	const co = readJson(path.join(root, rel), rel);
	if (!co || typeof co !== 'object' || !Array.isArray(co.findings) || !Array.isArray(co.tickets)) {
		throw new Unreadable(`${rel} needs a findings list and a tickets list`);
	}
	const problems = [];
	if (co.version !== version) problems.push(`${rel} says version ${co.version}, VERSION says ${version}`);
	if (co.head !== rec.sweep.commit) problems.push(`${rel} names head ${co.head}, the record's sweep names ${rec.sweep.commit}`);
	const commits = git(root, ['log', '--format=%H', '--', rel]).split('\n').filter(Boolean);
	if (commits.length === 0) return [...problems, `${rel} is not committed: its one closeout commit writes it`];
	if (commits.length > 1) problems.push(`${rel} has ${commits.length} commits: only its one closeout commit may touch it`);
	const closeCommit = commits[commits.length - 1];

	// The flags decide a ticket; a tickets list that disagrees with them is a fault naming the id.
	const ticketIds = new Set(co.findings.filter(isTicket).map((f) => f.id));
	for (const id of ticketIds) {
		if (!co.tickets.includes(id)) problems.push(`${id} is a ticket (high or critical, security or owner) but ${rel} tickets does not list it`);
	}
	for (const id of co.tickets) {
		if (!ticketIds.has(id)) problems.push(`${id} is listed in ${rel} tickets but is no ticket: not high or critical, not security, not owner`);
	}

	// The range after the closeout commit: each test it adds, and each new script, hook or CI file.
	const changed = git(root, ['diff', '--name-status', '-M', closeCommit, 'HEAD']).split('\n').filter(Boolean).map((l) => l.split('\t'));
	const fresh = [];
	for (const parts of changed) {
		const status = parts[0];
		const at = parts[parts.length - 1];
		if (status === 'D' || !TEST_FILE.test(at)) continue;
		const now = testsIn(git(root, ['show', `HEAD:${at}`]));
		// A renamed file's tests are new under their new path; an edited file's tests are new when its old version lacks them.
		const was = status === 'M' ? testsIn(git(root, ['show', `${closeCommit}:${at}`])) : new Map();
		for (const [name, renamed] of now) {
			if (!was.has(name) && !renamed) fresh.push(`${at}::${name}`);
		}
	}
	fresh.sort();
	const added = changed.filter((p) => p[0] === 'A' || p[0].startsWith('R')).map((p) => p[p.length - 1]).filter((p) => NEW_KIND.test(p));

	const rows = Array.isArray(rec.items) ? rec.items.filter((it) => it && typeof it === 'object') : [];
	const namesOf = (it) => [...(typeof it.test === 'string' ? [it.test] : []), ...(Array.isArray(it.tests) ? it.tests : [])];
	const filesOf = (it) => (Array.isArray(it.files) ? it.files : []);
	const freshSet = new Set(fresh);
	const addedSet = new Set(added);
	const defer = (key) => `defer it: node user/kit-tools/closeout.mjs defer "${key}"`;
	for (const key of fresh) {
		const named = rows.filter((it) => namesOf(it).includes(key));
		if (named.length === 0) problems.push(`${key} is a new test with no ticket: name it in one fix row whose finding is a ticket, or ${defer(key)}`);
		else if (named.length > 1) problems.push(`${key} is named by ${named.length} fix rows: a new test needs one ticket`);
		else if (!ticketIds.has(named[0].finding)) problems.push(`${key} is named by fix row ${named[0].id} for ${named[0].finding}, which is no ticket: ${defer(key)}`);
	}
	for (const it of rows) {
		const n = namesOf(it).filter((k) => freshSet.has(k)).length;
		if (n > 1) problems.push(`fix row ${it.id} for ${it.finding} names ${n} new tests: each new test needs its own ticket`);
	}
	for (const file of added) {
		const named = rows.filter((it) => filesOf(it).includes(file));
		if (!named.some((it) => ticketIds.has(it.finding))) problems.push(`${file} is a new script, hook or CI file no ticket's fix row names: name it in a fix row whose finding is a ticket`);
	}
	// A ticket covers one new test or one new file: a second fix row on it is a fault.
	const uses = new Map();
	for (const it of rows) {
		if (!ticketIds.has(it.finding)) continue;
		if (namesOf(it).some((k) => freshSet.has(k)) || filesOf(it).some((p) => addedSet.has(p))) uses.set(it.finding, (uses.get(it.finding) || 0) + 1);
	}
	for (const [id, n] of uses) {
		if (n > 1) problems.push(`ticket ${id} is used by ${n} fix rows: a ticket covers one new test or file`);
	}
	return problems;
}

// Appends one line to the kit's fail log for this failing run; a repo that cannot say where its git folder is logs nothing.
function logFail(root, cause) {
	let common;
	try {
		common = git(root, ['rev-parse', '--git-common-dir']).trim();
	} catch {
		return;
	}
	fs.appendFileSync(path.resolve(root, common, 'kit-guard-open.log'), `${JSON.stringify({ at: new Date().toISOString(), hook: 'closeout', cause })}\n`);
}

function check(root) {
	let problems;
	try {
		problems = problemsIn(root);
	} catch (e) {
		if (!(e instanceof Unreadable)) throw e;
		problems = [e.message];
	}
	if (problems.length === 0) return 0;
	for (const p of problems) process.stderr.write(`closeout: ${p}\n`);
	logFail(root, problems.join('; '));
	return 1;
}

// A deferred item for the next patch: one JSON line, no approval.
function defer(root, text) {
	const version = versionOf(root);
	const file = path.join(root, 'docs', 'builds', `${version}.next.jsonl`);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.appendFileSync(file, `${JSON.stringify({ text, at: new Date().toISOString() })}\n`);
	process.stdout.write('written, carry on\n');
	return 0;
}

function main(argv) {
	const usage = () => {
		process.stderr.write('usage: node user/kit-tools/closeout.mjs check [--root <repo>] | defer "<text>" [--root <repo>]\n');
		return 2;
	};
	const cmd = argv[0];
	const pos = [];
	let rootArg = null;
	for (let i = 1; i < argv.length; i++) {
		if (argv[i] === '--root') {
			rootArg = argv[++i];
			if (rootArg === undefined) return usage();
		} else {
			pos.push(argv[i]);
		}
	}
	let root;
	if (rootArg !== null) root = path.resolve(rootArg);
	else if (process.env.KIT_RECORD_ROOT) root = path.resolve(process.env.KIT_RECORD_ROOT);
	else {
		const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: process.cwd(), encoding: 'utf8' });
		if (top.status !== 0) {
			process.stderr.write('closeout: not in a git repo: name the repo with --root\n');
			return 2;
		}
		root = top.stdout.trim();
	}
	if (cmd === 'check' && pos.length === 0) return check(root);
	if (cmd === 'defer' && pos.length === 1 && pos[0].trim() !== '') return defer(root, pos[0]);
	return usage();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
