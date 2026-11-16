// K65 (1.35.0, the owner's ask 2026-11-15): the release-step check. 1.34.0's tag shipped with no GitHub release notes
// until the owner asked; nothing read the real state of each step before the closeout called the release done. The
// check reads each fact (PR merged, main CI green on the merge commit, the tag on the merge's files, the release notes
// published and audited, the state check, and for the kit the release copy and the installed version) and names every
// one missing. K66: ci-wait reports each CI run's end in one line, unasked, with a line mid-run past ten minutes.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { releaseCheck, argsOf, repoOf } from '../project/.claude/release-check.mjs';
import { ciWait } from '../project/.claude/ci-wait.mjs';

kitTemp.sessionRoot();
const sh = (cwd, ...a) => {
	const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' });
	if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
	return r.stdout.trim();
};

// GitHub is a local repo here: its PR merged as one commit tagged v1.1.0, and a release copy cloned at that tag. The
// fake gh answers the API from that repo, so the tree compare runs on real commits.
function setup() {
	const work = kitTemp.makeTemp('rc-src-');
	sh(work, 'init', '-q', '-b', 'main');
	fs.writeFileSync(path.join(work, 'VERSION'), '1.1.0\n');
	sh(work, 'add', '.');
	sh(work, 'commit', '-qm', 'feat: one');
	sh(work, 'tag', 'v1.1.0');
	const merged = sh(work, 'rev-parse', 'HEAD');
	const project = path.join(kitTemp.makeTemp('rc-proj-'), 'p');
	sh(path.dirname(project), 'clone', '-q', work, project);
	const copy = path.join(kitTemp.makeTemp('rc-copy-'), 'release');
	sh(path.dirname(copy), 'clone', '-q', work, copy);
	sh(copy, 'checkout', '-q', '--detach', 'v1.1.0');
	const installed = kitTemp.makeTemp('rc-bench-');
	fs.mkdirSync(path.join(installed, '.kit'));
	fs.writeFileSync(path.join(installed, '.kit', 'kit-version.json'), JSON.stringify({ version: '1.1.0' }));
	const facts = {
		pr: { state: 'MERGED', mergeCommit: { oid: merged }, baseRefName: 'main' },
		runs: [{ name: 'CI', status: 'completed', conclusion: 'success', headBranch: 'main', event: 'push' }],
		release: { tagName: 'v1.1.0', isDraft: false, body: 'Methodology kit 1.1.0 adds one thing.' },
	};
	const calls = [];
	const gh = (args) => {
		calls.push(args);
		if (args[0] === 'pr') return { status: 0, stdout: JSON.stringify(facts.pr) };
		if (args[0] === 'run') return { status: 0, stdout: JSON.stringify(facts.runs) };
		if (args[0] === 'release') return facts.release ? { status: 0, stdout: JSON.stringify(facts.release) } : { status: 1, stdout: '' };
		if (args[0] === 'api') {
			const ref = args[1].replace(/^repos\/o\/r\/commits\//, '');
			const sha = spawnSync('git', ['-C', work, 'rev-parse', '--verify', '-q', `${ref}^{commit}`], { encoding: 'utf8' }).stdout.trim();
			if (!sha) return { status: 1, stdout: '' };
			const tree = sh(work, 'rev-parse', `${sha}^{tree}`);
			return { status: 0, stdout: JSON.stringify({ sha, commit: { tree: { sha: tree } } }) };
		}
		return { status: 1, stdout: '' };
	};
	const lines = [];
	const deps = { gh, state: () => ({ status: 0, stdout: 'PASS state' }), audit: () => [], log: (l) => lines.push(l) };
	return { project, copy, installed, merged, facts, deps, lines, work, calls, opts: { tag: 'v1.1.0', pr: 5, repo: 'o/r', project } };
}
const all = (r) => r.missing.join('\n');

// why: guards the owner's ask of 2026-11-15: confirm each release step and report each CI run (K65, K66)
test('a release with every step done passes, names each step it read, and writes nothing in the project', () => {
	const t = setup();
	const before = fs.readdirSync(path.join(t.project, '.git')).sort();
	const tags = sh(t.project, 'tag');
	const r = releaseCheck({ ...t.opts, copy: t.copy, installed: t.installed }, t.deps);
	assert.equal(r.ok, true, t.lines.join('\n'));
	assert.equal(t.lines.filter((l) => /^\[\d\/7\] PASS/.test(l)).length, 7, t.lines.join('\n'));
	assert.deepEqual(fs.readdirSync(path.join(t.project, '.git')).sort(), before, 'no FETCH_HEAD, no new ref file');
	assert.equal(sh(t.project, 'tag'), tags);
	assert.ok(t.calls.every((a) => a[0] === 'api' || a.includes('-R')), 'every gh call names the repo, never the one gh guesses');
});

// J1 (build 11, the owner's pick "take, light"): before an item moves, one number in its result file is run again; a
// result with no re-run, or one whose re-run differs from what it recorded, keeps the release from being called done.
// why: guards rule:fact-check (a recorded number is a claim until it is run again)
test('a result file passes only with a re-run that matches the number it recorded', () => {
	const t = setup();
	const result = path.join(kitTemp.makeTemp('rc-result-'), 'RESULT.md');
	const run = (text) => { fs.writeFileSync(result, text); return releaseCheck({ ...t.opts, result }, t.deps); };
	assert.equal(run('# Verify\n- **Re-run:** workbench list rows: recorded 397, re-run 397\n').ok, true, t.lines.join('\n'));
	assert.equal(run('# Verify\n- **Re-run:** list rows: recorded 1,204, re-run 1204\n').ok, true, 'a thousands comma reads as the same number');
	assert.match(all(run('# Verify\nAll rows verified.\n')), /re-run.*no "Re-run:" line/i);
	assert.match(all(run('# Verify\n- **Re-run:** list rows: recorded 397, re-run 396\n')), /re-run.*397.*396/i);
	assert.match(all(releaseCheck({ ...t.opts, result: path.join(path.dirname(result), 'none.md') }, t.deps)), /re-run.*cannot be read/i);
	assert.deepEqual(argsOf(['v1.0.0', '--pr', '7', '--result', 'r.md']).result, 'r.md');
});

// why: guards the owner's ask of 2026-11-15: confirm each release step and report each CI run (K65, K66)
// The 1.34.0 miss: the tag was out, the notes were not.
test('notes that are missing, a draft, empty, failing the audit or never audited are named missing', () => {
	for (const [release, audit, want] of [
		[null, () => [], /no published release notes/],
		[{ tagName: 'v1.1.0', isDraft: true, body: 'draft text' }, () => [], /still a draft/],
		[{ tagName: 'v1.1.0', isDraft: false, body: '  ' }, () => [], /no notes/],
		[{ tagName: 'v1.1.0', isDraft: false, body: 'wip' }, () => ['line 1: AI or tool reference'], /fail the release-notes audit: line 1/],
		[{ tagName: 'v1.1.0', isDraft: false, body: 'Notes.' }, () => null, /audit is not installed/],
	]) {
		const t = setup();
		t.facts.release = release;
		t.deps.audit = audit;
		const r = releaseCheck(t.opts, t.deps);
		assert.equal(r.ok, false, JSON.stringify(release));
		assert.match(all(r), want);
	}
});

// why: guards the owner's ask of 2026-11-15: confirm each release step and report each CI run (K65, K66)
test('the live notes run the installed release-notes audit, in a temp folder that is removed after', () => {
	const home = kitTemp.makeTemp('rc-home-');
	fs.mkdirSync(path.join(home, 'skills', 'release-notes'), { recursive: true });
	fs.copyFileSync(path.resolve('user/skills/release-notes/audit.mjs'), path.join(home, 'skills', 'release-notes', 'audit.mjs'));
	const before = process.env.CLAUDE_CONFIG_DIR;
	process.env.CLAUDE_CONFIG_DIR = home;
	try {
		for (const [body, ok] of [['Methodology kit 1.1.0 adds one thing.', true], ['Written by Claude -- fast.', false]]) {
			const t = setup();
			t.facts.release = { tagName: 'v1.1.0', isDraft: false, body };
			delete t.deps.audit;
			const r = releaseCheck(t.opts, t.deps);
			assert.equal(r.ok, ok, t.lines.join('\n'));
			if (!ok) assert.match(all(r), /fail the release-notes audit: line 1/);
		}
	} finally { if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = before; }
});

// why: guards the owner's ask of 2026-11-15: confirm each release step and report each CI run (K65, K66)
test('every missing step is named at once, and a project with no state script is not a pass', () => {
	const t = setup();
	t.facts.pr = { state: 'OPEN', mergeCommit: null, baseRefName: 'main' };
	t.facts.release = null;
	t.deps.state = () => null;
	fs.writeFileSync(path.join(t.installed, '.kit', 'kit-version.json'), JSON.stringify({ version: '1.0.0' }));
	const r = releaseCheck({ ...t.opts, installed: t.installed }, t.deps);
	assert.equal(r.ok, false);
	for (const want of [/PR 5 is not merged/, /release notes/, /no state check ran/, /installed.*1\.0\.0/]) assert.match(all(r), want);
	const u = setup();
	fs.rmSync(path.join(u.installed, '.kit', 'kit-version.json'));
	assert.match(all(releaseCheck({ ...u.opts, installed: u.installed }, u.deps)), /not stamped/);
});

// why: guards the owner's ask of 2026-11-15: confirm each release step and report each CI run (K65, K66)
test('main CI counts only push runs on the base branch, every one of them green', () => {
	const run = (o) => ({ name: 'CI', status: 'completed', conclusion: 'success', headBranch: 'main', event: 'push', ...o });
	for (const runs of [
		[run({ conclusion: 'failure' })],
		[run({ status: 'in_progress', conclusion: '' })],
		[],
		[run({ event: 'pull_request' })],
		[run({ headBranch: 'feat/x' })],
		[run({ name: 'recall', event: 'workflow_dispatch' })],
		[run({ conclusion: 'skipped' })],
		[run({}), run({ name: 'Lint', conclusion: 'failure' })],
	]) {
		const t = setup();
		t.facts.runs = runs;
		const r = releaseCheck(t.opts, t.deps);
		assert.equal(r.ok, false, JSON.stringify(runs));
		assert.match(all(r), /main CI/);
	}
});

// why: guards the owner's ask of 2026-11-15: confirm each release step and report each CI run (K65, K66)
test('a tag whose files are not the merge commit\'s, and a release copy off the tag, are missing', () => {
	const t = setup();
	fs.writeFileSync(path.join(t.work, 'VERSION'), '1.1.1\n');
	sh(t.work, 'commit', '-qam', 'later');
	sh(t.work, 'tag', '-f', 'v1.1.0');
	const r = releaseCheck({ ...t.opts, copy: t.copy }, t.deps);
	assert.equal(r.ok, false);
	assert.match(all(r), /tag v1\.1\.0 .* merge commit's files/);
	assert.match(all(r), /release copy is not on v1\.1\.0/);
	// An annotated tag on the right commit passes: GitHub's commit for a tag name is the commit, never the tag object.
	const u = setup();
	sh(u.work, 'tag', '-f', '-a', '-m', 'release', 'v1.1.0', u.merged);
	assert.equal(releaseCheck({ ...u.opts, copy: u.copy }, u.deps).ok, true, u.lines.join('\n'));
});

// why: guards the owner's ask of 2026-11-15: confirm each release step and report each CI run (K65, K66)
test('a tag, PR, flag or repo that is not plain is refused before any call', () => {
	for (const [tag, pr] of [['--upload-pack=x', 5], ['a..b', 5], ['v1.1.0', '5; x'], ['v1.1.0', '-1']]) {
		const t = setup();
		const r = releaseCheck({ ...t.opts, tag, pr }, t.deps);
		assert.equal(r.ok, false);
		assert.equal(t.calls.length, 0, `${tag} ${pr}`);
	}
	assert.match(argsOf(['v1', '--pr', '5', '--copy']).why, /--copy needs a value/);
	assert.match(argsOf(['v1', '--pr', '5', '--instaled', 'x']).why, /unknown argument --instaled/);
	assert.match(argsOf(['v1', '--copy', 'x']).why, /--pr are needed/);
	assert.deepEqual(argsOf(['v1', '--pr', '5', '--repo', 'o/r']), { tag: 'v1', pr: '5', repo: 'o/r' });
	assert.equal(repoOf('https://github.com/GoudyMT/working-methodology.git'), 'GoudyMT/working-methodology');
	assert.equal(repoOf('git@github.com:o/r.git'), 'o/r');
	assert.equal(repoOf('C:/somewhere/r.git'), null);
	const t = setup();
	const r = releaseCheck({ ...t.opts, repo: undefined }, t.deps);
	assert.equal(r.ok, false, 'a local origin names no GitHub repo');
	assert.match(all(r), /GitHub repo/);
});

// K66: a fake clock and a fake GitHub that answers each poll in turn.
function polls(answers) {
	let i = 0;
	let now = 0;
	const lines = [];
	return {
		lines,
		at: () => now,
		deps: {
			gh: () => ({ status: 0, stdout: JSON.stringify(answers[Math.min(i++, answers.length - 1)]) }),
			sleep: (ms) => { now += ms; },
			now: () => now,
			log: (l) => lines.push(`${now} ${l}`),
		},
	};
}
const run = (status, conclusion, name = 'CI', id = name.length) => ({ databaseId: id, name, status, conclusion, url: `https://github.com/o/r/actions/runs/${id}` });
const ends = (p) => p.lines.map((l) => l.replace(/^\d+ /, '')).filter((l) => /^CI (?!done:|still|:)/.test(l));

// why: guards the owner's ask of 2026-11-15: confirm each release step and report each CI run (K65, K66)
test('ci-wait prints one line as each run ends, green or red, and exits on the settled result', async () => {
	let p = polls([[run('queued', '')], [run('in_progress', '')], [run('completed', 'success')]]);
	const asked = [];
	const gh = p.deps.gh;
	p.deps.gh = (args) => { asked.push(args); return gh(args); };
	let r = await ciWait({ commit: 'abc1234', repo: 'o/r', every: 30 }, p.deps);
	assert.equal(r.code, 0);
	// gh runs outside the project folder, so every call names the repo.
	assert.ok(asked.every((a) => a.join(' ').includes('-R o/r')), JSON.stringify(asked[0]));
	assert.deepEqual(ends(p), ['CI CI: green (success) in 1m00s https://github.com/o/r/actions/runs/2']);
	p = polls([[run('in_progress', ''), run('in_progress', '', 'Lint')], [run('completed', 'failure'), run('in_progress', '', 'Lint')], [run('completed', 'failure'), run('completed', 'success', 'Lint')]]);
	r = await ciWait({ commit: 'abc1234', every: 30 }, p.deps);
	assert.equal(r.code, 1, 'one red run is a red result');
	assert.equal(ends(p).filter((l) => /^CI CI: red \(failure\)/.test(l)).length, 1, 'each end is reported once');
	assert.match(p.lines.at(-1), /CI done: 1 red, 1 green/);
	// A green run re-run while another is open, ending red: the red end is read and decides the result.
	p = polls([[run('completed', 'success'), run('in_progress', '', 'Lint')], [run('in_progress', ''), run('in_progress', '', 'Lint')], [run('completed', 'failure'), run('completed', 'success', 'Lint')]]);
	r = await ciWait({ commit: 'abc1234', every: 30 }, p.deps);
	assert.equal(r.code, 1);
	assert.deepEqual(ends(p).filter((l) => /^CI CI:/.test(l)).map((l) => l.split(' ')[2]), ['green', 'red']);
	// A run that registers after the first ones finish is waited for.
	p = polls([[run('completed', 'success')], [run('completed', 'success'), run('queued', '', 'Deploy')], [run('completed', 'success'), run('completed', 'failure', 'Deploy')]]);
	r = await ciWait({ commit: 'abc1234', every: 30 }, p.deps);
	assert.equal(r.code, 1, 'the late run counts');
	// Only skipped runs pass nothing.
	p = polls([[run('completed', 'skipped')]]);
	r = await ciWait({ commit: 'abc1234', every: 30 }, p.deps);
	assert.equal(r.code, 2);
});

// why: guards the owner's ask of 2026-11-15: confirm each release step and report each CI run (K65, K66)
test('ci-wait says once at ten minutes that a run is still going, and keeps to its limit', async () => {
	const long = Array.from({ length: 40 }, () => [run('in_progress', '')]);
	const p = polls([...long, [run('completed', 'success')]]);
	assert.equal((await ciWait({ commit: 'abc1234', every: 60 }, p.deps)).code, 0);
	const mid = p.lines.filter((l) => /still running after 10 min/.test(l));
	assert.equal(mid.length, 1);
	assert.equal(Number(mid[0].split(' ')[0]), 600000, 'said at ten minutes, not before or later');
	const q = polls([[run('in_progress', '')]]);
	assert.equal((await ciWait({ commit: 'abc1234', every: 600, max: 5 }, q.deps)).code, 2);
	assert.match(q.lines.at(-1), /gave up after 5 min/);
	assert.equal(q.at(), 300000, 'a long poll interval does not carry it past --max');
	const none = polls([[]]);
	assert.equal((await ciWait({ commit: 'abc1234', every: 60 }, none.deps)).code, 2);
	assert.match(none.lines.at(-1), /no CI run started/);
});
