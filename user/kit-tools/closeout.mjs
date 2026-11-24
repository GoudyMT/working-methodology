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
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import safeSpawn from './safe-spawn.cjs';
import { GATE_FILE, gateLine, loosened, popUpAnswer, popUpReadable, attempt2Acts } from './ci-digest.mjs';

const TEST_FILE = /^tests\/.+\.test\.mjs$/;
// The one parse of a test file's tests, shared with the why rule at save (indented, aliased, named-array and loop tests).
const { testStarts } = createRequire(import.meta.url)('../kit-hooks/why-rule.cjs');
const RENAMED = /^\s*\/\/ renamed from: (.+?)\s*$/;
// The paths a new script, hook or CI file lives under.
// Under project/.claude/ and user/skills/ only scripts count; the docs there need no ticket.
const NEW_KIND = /^(scripts\/|user\/kit-tools\/|user\/kit-hooks\/|project\/\.githooks\/|\.github\/|(project\/\.claude\/|user\/skills\/).+\.(mjs|cjs|js|sh|ps1)$)/;

// A problem the check cannot read at all: the check fails on it, and logs it.
class Unreadable extends Error {}

const isTicket = (f) => ['high', 'critical'].includes(f.severity) || f.security === true || f.owner === true;

// git in the repo at root, started through safe-spawn (-C root, read-only); a failure is unreadable.
function git(root, args) {
	const r = safeSpawn.gitRead(root, args, { encoding: 'utf8' });
	if (r.status !== 0) throw new Unreadable(`git ${args[0]} failed: ${String(r.stderr).trim().split('\n')[0]}`);
	return r.stdout;
}

// The full sha a name resolves to as a commit, or null when it names none. A name that starts with - is never one.
function commitOf(root, name) {
	if (typeof name !== 'string' || !name || name.startsWith('-')) return null;
	const r = safeSpawn.gitRead(root, ['rev-parse', '--verify', '--quiet', `${name}^{commit}`], { encoding: 'utf8' });
	return r.status === 0 ? r.stdout.trim() : null;
}

// The range's end: HEAD, or for a merge whose first parent is PR_BASE (set by the Build record step) its second parent,
// the PR head, so the tests main gained are never charged to the patch.
function rangeEnd(root) {
	const base = process.env.PR_BASE;
	if (!base) return 'HEAD';
	const pb = commitOf(root, base);
	if (pb === null) throw new Unreadable(`PR_BASE ${base} is no commit here`);
	return commitOf(root, 'HEAD^2') !== null && commitOf(root, 'HEAD^1') === pb ? 'HEAD^2' : 'HEAD';
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

// The test names of one file's text, each with the names its "// renamed from:" lines tag (the comment block above it).
// A top-level loop that makes tests counts as test-check reads it: its first test( inside, up to the next line at the margin.
function testsIn(text) {
	const lines = text.replace(/\r\n/g, '\n').split('\n');
	const out = new Map();
	const tagsAbove = (i) => {
		let head = i;
		while (head > 0 && /^\s*\/\//.test(lines[head - 1])) head--;
		return lines.slice(head, i).map((c) => RENAMED.exec(c)).filter(Boolean).map((m) => m[1]);
	};
	for (const s of testStarts(lines.join('\n'))) out.set(s.name, tagsAbove(s.i));
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
	const rel = `docs/builds/${version}.closeout.json`;
	// A closeout file with no sweep in the record is a record whose sweep block was taken out after it; nothing is owed
	// only when neither exists.
	if (!rec.sweep) return fs.existsSync(path.join(root, rel)) ? [`${rel} exists but docs/builds/${version}.json has no sweep block: restore the record's sweep`] : [];
	if (!fs.existsSync(path.join(root, rel))) return [`${rel} is missing: a record with a sweep needs its closeout file, committed once`];
	const co = readJson(path.join(root, rel), rel);
	if (!co || typeof co !== 'object' || !Array.isArray(co.findings) || !Array.isArray(co.tickets)) {
		throw new Unreadable(`${rel} needs a findings list and a tickets list`);
	}
	const problems = [];
	if (co.version !== version) problems.push(`${rel} says version ${co.version}, VERSION says ${version}`);
	const head = commitOf(root, co.head);
	if (head === null || head !== commitOf(root, rec.sweep.commit)) problems.push(`${rel} names head ${co.head}, the record's sweep names ${rec.sweep.commit}`);
	const end = rangeEnd(root);
	const commits = git(root, ['log', '--format=%H', end, '--', rel]).split('\n').filter(Boolean);
	if (commits.length === 0) return [...problems, `${rel} is not committed: its one closeout commit writes it`];
	if (commits.length > 1) problems.push(`${rel} has ${commits.length} commits: only its one closeout commit may touch it`);
	const closeCommit = commits[commits.length - 1];
	// Nothing may land between the swept head and the closeout commit: its parent must be that head.
	const parent = commitOf(root, `${closeCommit}^`);
	if (parent === null || parent !== head) problems.push(`the closeout commit ${closeCommit} has parent ${parent || 'none'}, but ${rel} names head ${co.head}: nothing may land between them`);

	// The flags decide a ticket; a tickets list that disagrees with them is a fault naming the id.
	const ticketIds = new Set(co.findings.filter(isTicket).map((f) => f.id));
	for (const id of ticketIds) {
		if (!co.tickets.includes(id)) problems.push(`${id} is a ticket (high or critical, security or owner) but ${rel} tickets does not list it`);
	}
	for (const id of co.tickets) {
		if (!ticketIds.has(id)) problems.push(`${id} is listed in ${rel} tickets but is no ticket: not high or critical, not security, not owner`);
	}

	// The range after the closeout commit: each test it adds, and each new script, hook or CI file.
	// -z with quotePath off: a non-ASCII name comes back whole, never as a quoted "\303..." path no show could read.
	const fields = git(root, ['-c', 'core.quotePath=false', 'diff', '--name-status', '-z', '-M', closeCommit, end]).split('\0');
	if (fields[fields.length - 1] === '') fields.pop();
	const changed = [];
	for (let k = 0; k < fields.length;) {
		const n = fields[k][0] === 'R' || fields[k][0] === 'C' ? 3 : 2;
		changed.push(fields.slice(k, k + n));
		k += n;
	}
	for (const p of changed.flat()) {
		if (p.startsWith('"')) throw new Unreadable(`git gave the quoted path ${p}: the closeout check cannot read it`);
	}
	const fresh = [];
	for (const parts of changed) {
		const status = parts[0];
		const at = parts[parts.length - 1];
		if (status === 'D' || !TEST_FILE.test(at)) continue;
		const now = testsIn(git(root, ['show', `${end}:${at}`]));
		// A renamed file's tests are new under their new path; an edited file's tests are new when its old version lacks them.
		const was = status === 'M' ? testsIn(git(root, ['show', `${closeCommit}:${at}`])) : new Map();
		for (const [name, tags] of now) {
			if (was.has(name)) continue;
			// A "renamed from" tag exempts only a name the closeout commit's file had and this file has lost.
			if (tags.some((t) => was.has(t) && !now.has(t))) continue;
			fresh.push(`${at}::${name}`);
		}
	}
	fresh.sort();
	const added = changed.filter((p) => p[0] === 'A' || p[0].startsWith('R')).map((p) => p[p.length - 1]).filter((p) => NEW_KIND.test(p));

	// A fix row is a sweep.fixes row, where the test check (A7) wants a test written after the sweep named, or an item
	// that names its finding.
	const rows = [...(Array.isArray(rec.items) ? rec.items : []), ...(Array.isArray(rec.sweep.fixes) ? rec.sweep.fixes : [])].filter((it) => it && typeof it === 'object');
	const namesOf = (it) => [...(typeof it.test === 'string' ? [it.test] : []), ...(Array.isArray(it.tests) ? it.tests : [])];
	const filesOf = (it) => (Array.isArray(it.files) ? it.files : []);
	const freshSet = new Set(fresh);
	const addedSet = new Set(added);
	const defer = (key) => `remove the test and defer it: node user/kit-tools/closeout.mjs defer "${key}"`;
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
	// K399 U21 (RESULT 2.5): the CI diagnoses and the gate numbers of the range after the swept head.
	const cf = cifixOf(root, version);
	if (cf !== null) problems.push(...cifixProblems(root, cf, head, end));
	if (head !== null) problems.push(...gateProblems(root, commitOf(root, process.env.PR_BASE) || head, end, cf ? cf.lines : []));
	return problems;
}

const CAUSES = ['code', 'pin', 'env'];
// The proof ci-fix.mjs wrote into a line: a session, the grant as its id, an act quoting the line, and the answer time.
const proofOk = (line, acts, grant) => {
	const p = line.proof;
	return !!p && typeof p === 'object' && typeof p.session === 'string' && p.session !== '' && p.id === grant && acts.includes(p.act) && Number.isFinite(p.at);
};
// The pop-up the proof names is re-read from proof.session: the answer must be the grant's accepted Yes, to the proof's act, at
// the proof's time (K399 U22, 06:52Z ruling 4). A record that cannot be read fails, except in GitHub Actions (ruling 6), where
// the proof is checked for consistency only: there is no pop-up record in CI, and the cifix record has one writer, ci-fix.mjs.
const liveProof = (root, line, acts, grant) => {
	const sid = line.proof.session;
	if (!popUpReadable(root, sid)) return process.env.GITHUB_ACTIONS === 'true';
	const ans = popUpAnswer(acts, root, sid);
	if (!ans || !ans.yes || ans.id !== grant || ans.at !== line.proof.at || ans.act !== line.proof.act) return false;
	return !revokedNow(root, line.proof);
};
// A newer answer to the proof's own act in the current session's record that is not a Yes revokes the proof (K399 U22,
// 06:52Z ruling 7). No current session, or one whose record cannot be read, revokes nothing.
const revokedNow = (root, proof) => {
	const cur = process.env.CLAUDE_CODE_SESSION_ID;
	if (!cur || !popUpReadable(root, cur)) return false;
	const later = popUpAnswer([proof.act], root, cur);
	return !!later && !later.yes && later.at > proof.at;
};
// A sha that names a commit of this branch's history: a full sha that is an ancestor of HEAD (git merge-base through the safe call).
const inHistory = (root, sha) => /^[0-9a-f]{40}$/i.test(String(sha)) && safeSpawn.gitRead(root, ['merge-base', '--is-ancestor', String(sha), 'HEAD'], { encoding: 'utf8' }).status === 0;
// The cifix record of the build: { rel, lines }, or null when the build has none. A line that is not JSON is unreadable.
function cifixOf(root, version) {
	const rel = `docs/builds/${version}.cifix.jsonl`;
	if (!fs.existsSync(path.join(root, rel))) return null;
	const lines = fs.readFileSync(path.join(root, rel), 'utf8').split('\n').filter((l) => l.trim() !== '').map((l, i) => {
		try {
			return JSON.parse(l);
		} catch {
			throw new Unreadable(`${rel} line ${i + 1} is not readable JSON`);
		}
	});
	return { rel, lines };
}

// Each diagnosis line is well formed; each fix: or retest: commit after the swept head stays inside the files a line names,
// and a pin file changes only in a retest: commit.
function cifixProblems(root, { rel, lines }, head, end) {
	const problems = [];
	lines.forEach((l, i) => {
		if (!l || typeof l !== 'object') throw new Unreadable(`${rel} line ${i + 1} is not an object`);
		if (!CAUSES.includes(l.cause)) problems.push(`cifix: ${rel} line ${i + 1} has cause ${JSON.stringify(l.cause)}: code, pin or env`);
		const n = typeof l.fix === 'string' ? l.fix.trim().split(/\s+/).filter(Boolean).length : 0;
		if (n < 6) problems.push(`cifix: ${rel} line ${i + 1} has a fix of ${n} words: 6 or more`);
		if (l.attempt === 2) {
			// Every run (CI too, no session id): the grant is the id ci-fix.mjs wrote in the line's proof, the proof's act is an
			// accepted act for the item, and no other line uses the grant (F6, U22 ruling 1).
			const grant = typeof l.grant === 'string' ? l.grant.trim() : '';
			const acts = attempt2Acts(String(l.key));
			if (grant === '') problems.push(`cifix: ${rel} line ${i + 1} is attempt 2 with no grant: the grant is the id of the owner's accepted pop-up quoting the item`);
			else if (!proofOk(l, acts, grant)) problems.push(`cifix: ${rel} line ${i + 1} is attempt 2 whose proof does not match: it needs the grant ${grant} as its id and an act quoting ${l.key}`);
			else if (lines.some((o, k) => k !== i && o && o.grant === grant)) problems.push(`cifix: ${rel} line ${i + 1} reuses grant ${grant}: a pop-up yes is spent once`);
			else if (!liveProof(root, l, acts, grant)) problems.push(`cifix: ${rel} line ${i + 1} is attempt 2 whose proof does not match the owner's accepted Yes at proof.session, grant ${grant}, ${l.key}`);
		} else if (l.attempt !== 1) problems.push(`cifix: ${rel} line ${i + 1} has attempt ${JSON.stringify(l.attempt)}: 1, or 2 with a grant`);
	});
	if (head === null) return problems;
	// A fix: or retest: commit pairs with the newest cifix line committed before it (RESULT 2.5): its files must be that
	// line's files, and a pin line's file changes only in a retest: commit. Each commit's own copy of the record gives its lines.
	// The newest run's lines: those added by the newest commit that added any (F8). Only fix(ci): and retest(ci): commits
	// pair with them (F9).
	// Ruling 2: a gate: line (an owner's yes) never starts or replaces the diagnosis group. It is kept apart: its files are
	// allowed in the CI fix commits that follow it, but it is no diagnosis.
	const isGate = (line) => String(line?.key).startsWith('gate:');
	let group = null;
	let gates = [];
	let seen = 0;
	for (const row of git(root, ['log', '--reverse', '--format=%H %s', `${head}..${end}`]).split('\n').filter(Boolean)) {
		const sha = row.slice(0, 40);
		const subject = row.slice(41);
		const copy = safeSpawn.gitRead(root, ['show', `${sha}:${rel}`], { encoding: 'utf8' });
		if (copy.status === 0) {
			const parsed = copy.stdout.split('\n').filter((x) => x.trim() !== '');
			const added = [];
			for (let k = seen; k < parsed.length; k++) {
				try {
					added.push({ line: JSON.parse(parsed[k]), no: k + 1 });
				} catch {
					/* a bad line is reported by the record check above */
				}
			}
			const diag = added.filter(({ line }) => !isGate(line));
			if (diag.length) {
				group = diag;
				gates = [];
			}
			if (group !== null) gates.push(...added.filter(({ line }) => isGate(line)));
			seen = parsed.length;
		}
		if (group === null) continue;
		const named = new Map();
		for (const { line, no } of [...group, ...gates]) for (const f of Array.isArray(line.files) ? line.files : []) named.set(f, no);
		const files = git(root, ['show', '--name-only', '--format=', sha]).split('\n').filter((f) => f && f !== rel);
		// A CI fix commit is fix(ci): or retest(ci): (also with !, and the fixup!, squash! and amend! forms): any other commit
		// that touches a file the newest run's diagnoses name is no CI fix, so it pairs with no line and is a fault.
		if (!/^((fixup|squash|amend)! )?(fix|retest)\(ci\)!?:/.test(subject)) {
			// An owner-yes line (key gate:...) is no diagnosis: it names the gate file the owner allowed, not a red item's file.
			const diagnosed = new Map();
			for (const { line, no } of group) if (!String(line.key).startsWith('gate:')) for (const f of Array.isArray(line.files) ? line.files : []) diagnosed.set(f, no);
			for (const f of files) if (diagnosed.has(f)) problems.push(`cifix: commit ${sha.slice(0, 12)} changes ${f}, which the newest run's cifix line ${diagnosed.get(f)} names, as "${subject}": a CI fix is a fix(ci): or retest(ci): commit`);
			continue;
		}
		for (const f of files) {
			if (!named.has(f)) problems.push(`cifix: commit ${sha.slice(0, 12)} changes ${f}, outside the files of the newest run's cifix lines (${group.map((g) => g.no).join(', ')})`);
			const pinned = group.some(({ line }) => line.cause === 'pin' && (Array.isArray(line.files) ? line.files : []).includes(f));
			if (pinned && !/^((fixup|squash|amend)! )?retest\(ci\)!?:/.test(subject)) problems.push(`cifix: commit ${sha.slice(0, 12)} changes pin file ${f} as "${subject}": a pin fix must be a retest(ci): commit`);
		}
	}
	return problems;
}

// The test starts of a test file's text: [{ i, name }], from testStarts (the file's own parser) plus the test.skip( and
// test.only( forms it does not read, so a skipped test is a kept test (K399 U22, 07:20Z ruling 9).
const SKIP_FORM = /(?<![\w$.])test\.(?:skip|only)\(\s*(['"`])((?:\\.|(?!\1).)*)\1/;
function startsOf(text) {
	const lines = text.replace(/\r\n/g, '\n').split('\n');
	const starts = testStarts(lines.join('\n')).map((s) => ({ i: s.i, name: s.name }));
	lines.forEach((l, i) => {
		const m = SKIP_FORM.exec(l);
		if (m) starts.push({ i, name: m[2] });
	});
	return starts.sort((a, b) => a.i - b.i);
}

// Each test's lines: { name, from, to }. A test ends on its own line when its call closes there, else at the first closing
// line at the margin below it (why-rule.cjs tests()), else at the line before the next start.
function spansOf(text) {
	const lines = text.replace(/\r\n/g, '\n').split('\n');
	const starts = startsOf(text);
	return starts.map((s, k) => {
		let to = k + 1 < starts.length ? starts[k + 1].i - 1 : lines.length - 1;
		if (/\}\)\s*;?\s*$/.test(lines[s.i])) to = s.i;
		else {
			const close = lines.findIndex((l, j) => j > s.i && j <= to && /^\}\)/.test(l));
			if (close >= 0) to = close;
		}
		return { name: s.name, from: s.i, to };
	});
}

// The test each timeout: line of a test file's text sits in: { text, name } per line; name is null when the line is outside
// every test's lines.
function timeoutHolders(text) {
	const lines = text.replace(/\r\n/g, '\n').split('\n');
	const spans = spansOf(text);
	const out = [];
	lines.forEach((l, i) => {
		if (!/timeout:\s*\d/.test(l)) return;
		const inside = spans.filter((s) => s.from <= i && i <= s.to);
		out.push({ text: l.trim(), name: inside.length ? inside[inside.length - 1].name : null });
	});
	return out;
}

// A test name in the new text that the base text does not have: a rename, or a new test (ruling 9).
function newNamesIn(was, now) {
	const old = new Set(startsOf(was).map((s) => s.name));
	return startsOf(now).some((s) => !old.has(s.name));
}

// The string literals ('x', "x" or `x`) of a text, unescaped, so 'the owner\'s yes' reads as the name it stands for.
function literalsIn(text) {
	const out = new Set();
	for (const l of text.split('\n')) {
		for (const m of l.matchAll(/'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|`((?:\\.|[^`\\])*)`/g)) out.add((m[1] ?? m[2] ?? m[3]).replace(/\\(.)/g, '$1'));
	}
	return out;
}

// A lost timeout: line (text) is allowed only when every test that held a line of that text is gone from the new text: its
// name is not among the new text's test names and not an unescaped string literal in it (K399 U22, 06:52Z ruling 8; 08:10Z
// ruling 10; security review of 0698f77d). No holder found: not allowed.
function timeoutLossOk(was, now, text) {
	const named = new Set(startsOf(now).map((s) => s.name));
	const literals = literalsIn(now);
	const holders = timeoutHolders(was).filter((h) => h.text === text);
	return holders.length > 0 && holders.every((h) => h.name !== null && !named.has(h.name) && !literals.has(h.name));
}

// The base and new gate lines paired as multisets, per key (K399 S3F1, as ci-fix.cjs gateChange): the lines of one key are
// sorted by their numbers and paired in order. The base lines left over are lost, the new lines left over are added.
function pairGateLines(was, now) {
	const byNums = (a, b) => {
		for (let i = 0; i < Math.max(a.nums.length, b.nums.length); i++) {
			const d = (a.nums[i] ?? -1) - (b.nums[i] ?? -1);
			if (d !== 0) return d;
		}
		return 0;
	};
	const pairs = [];
	const lost = [];
	const added = [];
	for (const key of new Set([...was, ...now].map((x) => x.key))) {
		const xs = was.filter((x) => x.key === key).sort(byNums);
		const ys = now.filter((y) => y.key === key).sort(byNums);
		const n = Math.min(xs.length, ys.length);
		for (let i = 0; i < n; i++) pairs.push([xs[i], ys[i]]);
		lost.push(...xs.slice(n));
		added.push(...ys.slice(n));
	}
	return { pairs, lost, added };
}

// A gate-file number that rises on a cap line or falls on a floor line, against the base, needs an owner-yes record:
// a cifix line {key: "gate:<file>:<line text>", grant}. A line that is neither cap nor floor may change.
function gateProblems(root, base, end, lines) {
	const problems = [];
	if (base === null) return problems;
	const files = git(root, ['-c', 'core.quotePath=false', 'diff', '--name-only', base, end]).split('\n').filter(Boolean);
	const showOf = (rev, f) => {
		const r = safeSpawn.gitRead(root, ['show', `${rev}:${f}`], { encoding: 'utf8' });
		return r.status === 0 ? r.stdout : null;
	};
	for (const f of files) {
		if (!/^tests\/.+\.test\.mjs$/.test(f) && !GATE_FILE.test(f)) continue;
		const was = showOf(base, f);
		const now = showOf(end, f);
		if (was === null || now === null) continue;
		// The lines of the file as gate lines (the shared reader: comments left out, every number kept), matched by their key.
		const oldG = was.replace(/\r\n/g, '\n').split('\n').map((o) => gateLine(f, o)).filter(Boolean);
		// Ruling 1, with the proof (K399 U22 ruling 1, 05:25Z): a gate grant is the id ci-fix.mjs wrote in the line's proof, the
		// proof's act quotes this gate line (the full act, or the line alone), and no other line uses that id. Where this
		// session's record can be read, the pop-up is re-read live too.
		const ownedBy = (text) => lines.some((l, k) => {
			if (!l || l.key !== `gate:${f}:${text}` || typeof l.grant !== 'string' || l.grant.trim() === '') return false;
			const grant = l.grant.trim();
			const full = `ci-fix gate-yes ${f}:${text}`;
			const acts = [full, text];
			if (!proofOk(l, acts, grant) || lines.some((o, j) => j !== k && o && typeof o.grant === 'string' && o.grant.trim() === grant)) return false;
			// A bare-line act (the line alone, no file) binds to a file only through proof.file, which must be this line's file.
			if (l.proof.act !== full && (l.proof.file !== f || !inHistory(root, l.proof.sha))) return false;
			return liveProof(root, l, acts, grant);
		});
		const GRANT_NEED = (text) => `(a cifix line {key: "gate:${f}:${text}", grant: the id of the owner's accepted pop-up quoting ci-fix gate-yes ${f}:${text}, with its proof, used by no other line})`;
		// First pair each new gate line with its base line by key. A gate file holds every unpaired line, removed or new, as the
		// hook's gateChange does (K399 U22 ruling 27.05Z), whether or not the other side changed.
		const strict = GATE_FILE.test(f);
		// Paired as multisets per key (K399 S3F1): a decoy line with the old number cannot take the pairing from a raised one.
		const newG = now.replace(/\r\n/g, '\n').split('\n').map((raw) => gateLine(f, raw)).filter(Boolean);
		const { pairs, lost, added } = pairGateLines(oldG, newG);
		if (strict) {
			for (const o of lost) {
				if (!ownedBy(o.text)) problems.push(`gate: ${f} "${o.text}" removes a ${o.kind} line with no owner-yes record ${GRANT_NEED(o.text)}`);
			}
		} else {
			// A test file's timeout: lines (K399 U22, 05:33Z; ruling 3, 06:17Z): the lost ones are held unless their number is no
			// greater than the drop in the count of test( calls, so one deleted test covers one timeout: line. A rewrite (a new
			// one unpaired) is held by the new-line rule below.
			const lostT = lost.filter((o) => /timeout:\s*\d/.test(o.text));
			const newT = added.some((g) => /timeout:\s*\d/.test(g.text));
			// Ruling 9: the lost lines are no more than the drop in test starts, and no new name appears (a rename).
			const countOk = lostT.length <= startsOf(was).length - startsOf(now).length && !newNamesIn(was, now);
			const unowned = lostT.find((o) => !(countOk && timeoutLossOk(was, now, o.text)) && !ownedBy(o.text));
			if (lostT.length && !newT && unowned) problems.push(`gate: ${f} "${unowned.text}" removes a timeout line whose test is kept, with no owner-yes record ${GRANT_NEED(unowned.text)}`);
		}
		// A new line past the base's lines of its key is held (a decoy cannot hide a raised one); a line holding both kinds is
		// held on any change. In a test file a new line whose key the base lacks is a new test's own line, held only beside a
		// lost line (a rewrite such as 6e4, ruling 9); a gate file holds every new line.
		const baseKeys = new Set(oldG.map((o) => o.key));
		for (const g of added) {
			if (!strict && !baseKeys.has(g.key) && lost.length === 0 && g.kind !== 'mixed') continue;
			if (!ownedBy(g.text)) problems.push(`gate: ${f} "${g.text}" ${g.kind === 'mixed' ? 'mixes a cap and a floor' : 'is a gate line with no base line'} and is changed with no owner-yes record ${GRANT_NEED(g.text)}`);
		}
		for (const [o, g] of pairs) {
			// Every number on the line counts: a two-number cap line is loosened by its second number too (F10).
			const at = loosened(g.kind, o.nums, g.nums);
			if (at < 0) continue;
			const verb = g.kind === 'cap' ? 'raises a cap' : g.kind === 'floor' ? 'lowers a floor' : 'changes a mixed cap and floor';
			if (!ownedBy(g.text)) problems.push(`gate: ${f} "${g.text}" ${verb} from ${o.nums[at]} to ${g.nums[at]} with no owner-yes record ${GRANT_NEED(g.text)}`);
		}
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
	// K413 (U21 S7): a project with no VERSION has no build record, so nothing is owed: no log line, exit 0.
	if (!fs.existsSync(path.join(root, 'VERSION'))) {
		process.stdout.write('no build record: nothing to close out\n');
		return 0;
	}
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
	// K413 (U21 S7): with no VERSION the line goes to next.jsonl, never a stack trace.
	const hasVersion = fs.existsSync(path.join(root, 'VERSION'));
	try {
		const file = path.join(root, 'docs', 'builds', hasVersion ? `${versionOf(root)}.next.jsonl` : 'next.jsonl');
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.appendFileSync(file, `${JSON.stringify({ text, at: new Date().toISOString() })}\n`);
	} catch (e) {
		process.stderr.write(`closeout: the deferred line could not be written: ${e.code || e.message}\n`);
		return 1;
	}
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
		const top = safeSpawn.gitRead(process.cwd(), ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
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
