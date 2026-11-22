// The test-change hold of both pre-push hooks (rule:test-integrity). The hook passes the remote's URL; git gives the
// refs on stdin as "lref lsha rref rsha". The remote's default branch and branch tips are asked of the remote here,
// with the same reads the hook makes. Exit 0: nothing held. Exit 10: a test change or a retest: subject, named on
// stdout. Exit 2: a read failed or the repo is shallow, which holds whatever the owner says.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'spec']);
// A test path as unit-lock counts it: under a test, tests, __tests__ or spec folder, or named *.test.* or *.spec.*.
// Case-insensitive, so Tests/X.Test.mjs is held like tests/x.test.mjs.
const isTest = (rel) => {
	const parts = rel.toLowerCase().split('/');
	return parts.slice(0, -1).some((d) => TEST_DIRS.has(d)) || /\.(test|spec)\./.test(parts[parts.length - 1]);
};
const RETEST = /^((fixup|squash|amend)! )*retest(\([^)]*\))?!?:/i;
const ZERO = /^0*$/;
const SHORT = 7;
// Every git read ignores replace objects and grafts, so no object can hide a change from the hold. The graft file is
// a path that must not exist: git reads that as no grafts.
const GRAFTS = path.join(os.tmpdir(), `kit-no-grafts-${process.pid}-${Date.now()}`);
const ENV = { ...process.env, GIT_NO_REPLACE_OBJECTS: '1', GIT_GRAFT_FILE: GRAFTS };
const HOLD = "Push blocked: this push holds a test change (named below). The owner's yes is needed for it: after the owner's pop-up yes, run the push with KIT_PUSH_APPROVED=1, or the owner pushes it from their own terminal. The owner's own push from their own terminal has its own way (rule:outward-acts).";
const SHALLOW = 'Push blocked: this repository is shallow, so the history a test change would sit in may be cut off. Fetch the full history (git fetch --unshallow), then push again.';

class Unreadable extends Error {}
class Shallow extends Error {}

function git(args) {
	const r = spawnSync('git', args, { env: ENV, encoding: 'utf8', maxBuffer: 1 << 30 });
	if (r.error || r.status !== 0) throw new Unreadable(`git ${args[0]} failed (${String(r.stderr || (r.error && r.error.message) || '').trim().split('\n')[0]})`);
	return r.stdout;
}
const local = (sha) => spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], { env: ENV }).status === 0;

// The remote's default branch and its branch tips, asked of the remote. A default that names no branch is null.
function remote(url) {
	const def = /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(git(['ls-remote', '--symref', url, 'HEAD']));
	const heads = new Map();
	for (const line of git(['ls-remote', '--heads', url]).split('\n')) {
		const [sha, ref] = line.split('\t');
		if (sha && ref) heads.set(ref, sha);
	}
	return { def: def ? def[1] : null, heads };
}

// A tree as path -> "mode sha", read NUL-split so a path with a space or a newline is read whole.
const trees = new Map();
function tree(rev) {
	if (!trees.has(rev)) {
		const m = new Map();
		for (const item of git(['ls-tree', '-r', '-z', '--full-tree', rev]).split('\0')) {
			if (!item) continue;
			const tab = item.indexOf('\t');
			const [mode, , sha] = item.slice(0, Math.max(tab, 0)).split(' ');
			if (tab < 0 || !sha) throw new Unreadable(`the tree of ${rev} has an entry that does not parse`);
			m.set(item.slice(tab + 1), `${mode} ${sha}`);
		}
		trees.set(rev, m);
	}
	return trees.get(rev);
}

function mergeBase(a, b) {
	const r = spawnSync('git', ['merge-base', a, b], { env: ENV, encoding: 'utf8' });
	if (r.status === 0) return r.stdout.trim();
	if (r.status === 1) return null;
	throw new Unreadable('the merge base cannot be found');
}

// The name-status entries of a diff: a status, then its path, or its old and new paths for a rename or copy.
function entries(out) {
	const f = out.split('\0');
	const list = [];
	for (let i = 0; i < f.length; ) {
		if (f[i] === '') { i += 1; continue; }
		const st = f[i];
		if (!/^[ACDMRTUXB]\d*$/.test(st)) throw new Unreadable('a diff status does not parse');
		const n = /^[RC]/.test(st) ? 2 : 1;
		const paths = f.slice(i + 1, i + 1 + n);
		if (paths.length !== n || paths.some((p) => p === '')) throw new Unreadable('a diff path does not parse');
		list.push({ st, paths });
		i += n + 1;
	}
	return list;
}

// The "this change came from the remote" case: the branch side never changed the path since the default branch forked
// (its first parent matches the merge base), and the merge's blob is one a remote branch already holds, so the merge
// adds nothing the remote lacks. A deletion has no blob, so it is never from the remote: an undefined blob would
// match a remote tip that also lacks the path. Anything else in a merge is held.
function fromRemote(c, p, first, defTip, tips) {
	if (!defTip) return false;
	const base = mergeBase(first, defTip);
	if (!base || tree(first).get(p) !== tree(base).get(p)) return false;
	const blob = tree(c).get(p);
	return blob !== undefined && tips.some((t) => tree(t).get(p) === blob);
}

// One pushed commit: its subject, then each test path it changes against its first parent (or the empty tree).
function judge(c, held, defTip, tips) {
	const parents = git(['rev-list', '--parents', '-n', '1', c]).trim().split(' ').slice(1);
	const short = c.slice(0, SHORT);
	const subject = git(['log', '-1', '--format=%s', c]).split('\n')[0];
	if (RETEST.test(subject)) held.push(`${short} ${subject}`);
	const range = parents.length ? [parents[0], c] : ['--root', c];
	for (const { st, paths } of entries(git(['diff-tree', '-r', '-z', '-M', '--name-status', '--no-commit-id', ...range]))) {
		if (st === 'A') continue;
		for (const p of paths.filter(isTest)) {
			if (parents.length >= 2 && fromRemote(c, p, parents[0], defTip, tips)) continue;
			held.push(`${short} ${st} ${p}`);
		}
	}
}

function run(url, refs) {
	const held = [];
	if (git(['rev-parse', '--is-shallow-repository']).trim() !== 'false') throw new Shallow();
	const { def, heads } = remote(url);
	const below = [...heads.values()].filter(local);
	const defTip = def && heads.has(`refs/heads/${def}`) && local(heads.get(`refs/heads/${def}`)) ? heads.get(`refs/heads/${def}`) : null;
	for (const [, lsha, , rsha] of refs) {
		if (ZERO.test(lsha)) continue;
		const not = ZERO.test(rsha) ? below : [...below, rsha];
		for (const c of git(['rev-list', lsha, '--not', ...not]).split('\n').filter(Boolean)) judge(c, held, defTip, below);
	}
	return [...new Set(held)];
}

try {
	if (fs.existsSync(GRAFTS)) throw new Unreadable('the graft file name is taken');
	const refs = fs.readFileSync(0, 'utf8').split('\n').map((l) => l.trim().split(/\s+/)).filter((f) => f.length === 4);
	const held = run(process.argv[2], refs);
	if (held.length) {
		process.stdout.write(`${HOLD}\n${held.map((l) => `  ${l}`).join('\n')}\n`);
		process.exitCode = 10;
	}
} catch (e) {
	const why = e instanceof Shallow ? SHALLOW : `Push blocked: the history of the push cannot be read (${e.message}), so a test change in it cannot be ruled out.`;
	process.stdout.write(`${why}\n`);
	process.exitCode = 2;
}
