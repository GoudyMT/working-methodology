// The test-change hold of both pre-push hooks (rule:test-integrity). The hook passes the remote's URL; git gives the
// refs on stdin as "lref lsha rref rsha". The remote's default branch and branch tips are asked of the remote here,
// with the same reads the hook makes. Either read holds a push: each pushed commit (A), and the net change each pushed
// ref makes (B). Exit 0: nothing held. Exit 10: a test change or a retest: subject, named on stdout. Exit 2: a read
// failed, the repo is shallow, or a remote value is not fetched, which holds whatever the owner says.
import fs from 'node:fs';
import safeSpawn from './safe-spawn.cjs';
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
const { tool, gitArgs, gitEnv, NO_FSMONITOR } = safeSpawn;
// gitEnv drops the GIT_* names it does not keep, which includes both of these, so they are added after it.
const ENV = { ...gitEnv(), GIT_NO_REPLACE_OBJECTS: '1', GIT_GRAFT_FILE: GRAFTS };
// git in this folder (-C), started from node's own folder by safe-spawn's tool, which keeps the env option as given.
// Not gitRead: its fetch-protocol switches would refuse the ls-remote of the push's own remote.
const gitRun = (args, extra = {}) => tool('git', ['-C', process.cwd(), ...NO_FSMONITOR, ...gitArgs(args)], { encoding: 'utf8', maxBuffer: 1 << 30, env: ENV, ...extra });
const HOLD = "Push blocked: this push holds a test change (named below). The owner's yes is needed for it: after the owner's pop-up yes, run the push with KIT_PUSH_APPROVED=1, or the owner pushes it from their own terminal. The owner's own push from their own terminal has its own way (rule:outward-acts).";
const SHALLOW = 'Push blocked: this repository is shallow, so the history a test change would sit in may be cut off. Fetch the full history (git fetch --unshallow), then push again.';

class Unreadable extends Error {}
class Shallow extends Error {}
class Unfetched extends Error {}

function git(args) {
	const r = gitRun(args);
	if (r.error || r.status !== 0) throw new Unreadable(`git ${args[0]} failed (${String(r.stderr || (r.error && r.error.message) || '').trim().split('\n')[0]})`);
	return r.stdout;
}
const local = (sha) => gitRun(['cat-file', '-e', `${sha}^{commit}`]).status === 0;

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
	const r = gitRun(['merge-base', a, b]);
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

// git names the empty tree without a write; a new ref with no merge base is read against it.
let empty = null;
function emptyTree() {
	if (empty === null) {
		const r = gitRun(['hash-object', '-t', 'tree', '--stdin'], { input: '' });
		if (r.status !== 0) throw new Unreadable('the empty tree cannot be named');
		empty = r.stdout.trim();
	}
	return empty;
}
const treeOrNone = (rev) => (rev ? tree(rev) : new Map());

// (B) The net change one pushed ref makes. Its base is the remote's own value of the ref; a new ref has none, so its base
// is merge-base(pushed tip, default tip), or the empty tree when there is none. Renames are not detected, so a moved test
// reads as a delete and an add. A test path that is not a fresh add is held, unless BOTH hold: the pushed tip has the
// default tip's value at that path (the default branch already carries it), and the remote's value has the merge-base's
// value (the branch did not make the change). Two absent values are equal: a path the default branch deleted is safe,
// since the second part rules out a branch's own change. A new ref's second part is true by definition.
function judgeRef(tip, rsha, rref, defTip, held) {
	const fresh = ZERO.test(rsha);
	const base = fresh ? (defTip && mergeBase(tip, defTip)) || emptyTree() : rsha;
	const ownBase = fresh || !defTip ? null : mergeBase(rsha, defTip);
	const short = tip.slice(0, SHORT);
	for (const { st, paths } of entries(git(['diff-tree', '-r', '-z', '--no-renames', '--name-status', '--no-commit-id', base, tip]))) {
		const p = paths[0];
		if (st === 'A' || !isTest(p)) continue;
		const onDefault = Boolean(defTip) && tree(tip).get(p) === tree(defTip).get(p);
		const ownKept = fresh || treeOrNone(ownBase).get(p) === tree(rsha).get(p);
		if (onDefault && ownKept) continue;
		held.push(`${short} ${st} ${p} (net on ${rref})`);
	}
}

// (A) One pushed commit: its subject, then each test path it changes against its first parent (or the empty tree).
// A merge's diff is not read when a default branch is named, since a merge can take a change from a side branch and
// judgeRef reads the net change of the ref that carries it. With no default branch nothing says where a merge's change
// came from, so any change to a test path in a merge holds. The retest subject backstop reads every pushed commit.
function judgeCommit(c, held, defTip) {
	const parents = git(['rev-list', '--parents', '-n', '1', c]).trim().split(' ').slice(1);
	const short = c.slice(0, SHORT);
	const subject = git(['log', '-1', '--format=%s', c]).split('\n')[0];
	if (RETEST.test(subject)) held.push(`${short} ${subject}`);
	const merge = parents.length > 1;
	if (merge && defTip) return;
	const range = parents.length ? [parents[0], c] : ['--root', c];
	for (const { st, paths } of entries(git(['diff-tree', '-r', '-z', '-M', '--name-status', '--no-commit-id', ...range]))) {
		if (st === 'A' && !merge) continue;
		for (const p of paths.filter(isTest)) held.push(`${short} ${st} ${p}`);
	}
}

function run(url, refs) {
	const held = [];
	if (git(['rev-parse', '--is-shallow-repository']).trim() !== 'false') throw new Shallow();
	// Deletes only, or no refs: no commit is pushed, and the remote need not be asked.
	if (refs.every(([, lsha]) => ZERO.test(lsha))) return held;
	const { def, heads } = remote(url);
	const below = [...heads.values()].filter(local);
	const defTip = def && heads.has(`refs/heads/${def}`) && local(heads.get(`refs/heads/${def}`)) ? heads.get(`refs/heads/${def}`) : null;
	for (const [, lsha, rref, rsha] of refs) {
		if (ZERO.test(lsha)) continue;
		// The remote's value must be a commit here, or the net change of the ref cannot be read: a force push nobody fetched.
		if (!ZERO.test(rsha) && !local(rsha)) throw new Unfetched(`Push blocked: the remote's ${rref} is at ${rsha}, which this repo has not fetched: fetch first, then push again.`);
		const not = ZERO.test(rsha) ? below : [...below, rsha];
		for (const c of git(['rev-list', lsha, '--not', ...not]).split('\n').filter(Boolean)) judgeCommit(c, held, defTip);
		judgeRef(lsha, rsha, rref, defTip, held);
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
	const why = e instanceof Shallow ? SHALLOW : e instanceof Unfetched ? e.message : `Push blocked: the history of the push cannot be read (${e.message}), so a test change in it cannot be ruled out.`;
	process.stdout.write(`${why}\n`);
	process.exitCode = 2;
}
