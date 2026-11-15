// K65 (1.35.0, the owner's ask 2026-11-15): the release-step check. 1.34.0's tag shipped with no GitHub release notes
// until the owner asked; nothing read the real state of each step before the closeout called the release done. The
// check reads each fact (PR merged, main CI green on the merge commit, the tag on the merge's files, the release notes
// published, the state check, and for the kit the release copy and the installed version) and names every one missing.
// K66: ci-wait reports each CI run's end in one line, unasked, with a line mid-run past ten minutes.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { releaseCheck } from '../project/.claude/release-check.mjs';
import { ciWait } from '../project/.claude/ci-wait.mjs';

kitTemp.sessionRoot();
const sh = (cwd, ...a) => {
	const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' });
	if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
	return r.stdout.trim();
};

// A project on GitHub (a bare origin) whose PR merged as one commit tagged v1.1.0, and a release copy at that tag.
function setup() {
	const work = kitTemp.makeTemp('rc-src-');
	sh(work, 'init', '-q', '-b', 'main');
	fs.writeFileSync(path.join(work, 'VERSION'), '1.1.0\n');
	sh(work, 'add', '.');
	sh(work, 'commit', '-qm', 'feat: one');
	sh(work, 'tag', 'v1.1.0');
	const merged = sh(work, 'rev-parse', 'HEAD');
	const origin = path.join(kitTemp.makeTemp('rc-origin-'), 'p.git');
	sh(work, 'clone', '-q', '--bare', work, origin);
	const project = path.join(kitTemp.makeTemp('rc-proj-'), 'p');
	sh(path.dirname(project), 'clone', '-q', origin, project);
	const copy = path.join(kitTemp.makeTemp('rc-copy-'), 'release');
	sh(path.dirname(copy), 'clone', '-q', origin, copy);
	sh(copy, 'checkout', '-q', '--detach', 'v1.1.0');
	const installed = kitTemp.makeTemp('rc-bench-');
	fs.mkdirSync(path.join(installed, '.kit'));
	fs.writeFileSync(path.join(installed, '.kit', 'kit-version.json'), JSON.stringify({ version: '1.1.0' }));
	const facts = {
		pr: { state: 'MERGED', mergeCommit: { oid: merged }, baseRefName: 'main' },
		runs: [{ name: 'CI', status: 'completed', conclusion: 'success', headBranch: 'main', event: 'push' }],
		release: { tagName: 'v1.1.0', isDraft: false, body: 'Methodology kit 1.1.0 adds one thing.' },
	};
	const gh = (args) => {
		if (args[0] === 'pr') return { status: 0, stdout: JSON.stringify(facts.pr) };
		if (args[0] === 'run') return { status: 0, stdout: JSON.stringify(facts.runs) };
		if (args[0] === 'release') return facts.release ? { status: 0, stdout: JSON.stringify(facts.release) } : { status: 1, stdout: '', stderr: 'release not found' };
		return { status: 1, stdout: '' };
	};
	const lines = [];
	const deps = { gh, state: () => ({ status: 0, stdout: 'PASS state' }), log: (l) => lines.push(l) };
	return { project, copy, installed, merged, facts, deps, lines, work, origin };
}

test('a release with every step done passes, and names each step it read', () => {
	const t = setup();
	const r = releaseCheck({ tag: 'v1.1.0', pr: 5, project: t.project, copy: t.copy, installed: t.installed }, t.deps);
	assert.equal(r.ok, true, t.lines.join('\n'));
	assert.equal(r.missing.length, 0);
	assert.equal(t.lines.filter((l) => /^\[\d\/7\] PASS/.test(l)).length, 7, t.lines.join('\n'));
});

// The 1.34.0 miss: the tag was out, the notes were not.
test('a tag with no published release notes is named missing, and the check fails', () => {
	const t = setup();
	t.facts.release = null;
	let r = releaseCheck({ tag: 'v1.1.0', pr: 5, project: t.project }, t.deps);
	assert.equal(r.ok, false);
	assert.match(r.missing.join('\n'), /release notes/);
	for (const release of [{ tagName: 'v1.1.0', isDraft: true, body: 'draft text' }, { tagName: 'v1.1.0', isDraft: false, body: '  ' }]) {
		t.facts.release = release;
		r = releaseCheck({ tag: 'v1.1.0', pr: 5, project: t.project }, t.deps);
		assert.equal(r.ok, false, JSON.stringify(release));
		assert.match(r.missing.join('\n'), /release notes/);
	}
});

test('every missing step is named at once, not only the first', () => {
	const t = setup();
	t.facts.pr = { state: 'OPEN', mergeCommit: null, baseRefName: 'main' };
	t.facts.release = null;
	t.deps.state = () => ({ status: 1, stdout: '_Active Plan.md: the generated block differs' });
	fs.writeFileSync(path.join(t.installed, '.kit', 'kit-version.json'), JSON.stringify({ version: '1.0.0' }));
	const r = releaseCheck({ tag: 'v1.1.0', pr: 5, project: t.project, installed: t.installed }, t.deps);
	assert.equal(r.ok, false);
	const all = r.missing.join('\n');
	for (const want of [/PR 5 is not merged/, /release notes/, /state check/, /installed.*1\.0\.0/]) assert.match(all, want);
});

test('main CI that failed, is still running, or never ran on the merge commit is missing', () => {
	for (const runs of [
		[{ name: 'CI', status: 'completed', conclusion: 'failure', headBranch: 'main', event: 'push' }],
		[{ name: 'CI', status: 'in_progress', conclusion: '', headBranch: 'main', event: 'push' }],
		[],
		[{ name: 'CI', status: 'completed', conclusion: 'success', headBranch: 'feat/x', event: 'pull_request' }],
	]) {
		const t = setup();
		t.facts.runs = runs;
		const r = releaseCheck({ tag: 'v1.1.0', pr: 5, project: t.project }, t.deps);
		assert.equal(r.ok, false, JSON.stringify(runs));
		assert.match(r.missing.join('\n'), /main CI/);
	}
});

test('a tag whose files are not the merge commit\'s, and a release copy off the tag, are missing', () => {
	const t = setup();
	fs.writeFileSync(path.join(t.work, 'VERSION'), '1.1.1\n');
	sh(t.work, 'commit', '-qam', 'later');
	sh(t.work, 'tag', '-f', 'v1.1.0');
	sh(t.work, 'push', '-q', '-f', t.origin, 'main', 'refs/tags/v1.1.0');
	const r = releaseCheck({ tag: 'v1.1.0', pr: 5, project: t.project, copy: t.copy }, t.deps);
	assert.equal(r.ok, false);
	assert.match(r.missing.join('\n'), /tag v1\.1\.0.*merge/);
	assert.match(r.missing.join('\n'), /release copy/);
});

// K66: a fake clock and a fake GitHub that answers each poll in turn.
function polls(answers) {
	let i = 0;
	let now = 0;
	const lines = [];
	return {
		lines,
		deps: {
			gh: () => ({ status: 0, stdout: JSON.stringify(answers[Math.min(i++, answers.length - 1)]) }),
			sleep: (ms) => { now += ms; },
			now: () => now,
			log: (l) => lines.push(l),
		},
	};
}
const run = (status, conclusion, name = 'CI') => ({ databaseId: name.length, name, status, conclusion, url: `https://github.com/o/r/actions/runs/${name.length}` });

test('ci-wait prints one line as each run ends, green or red, and exits on the result', async () => {
	let p = polls([[run('queued', '')], [run('in_progress', '')], [run('completed', 'success')]]);
	let r = await ciWait({ commit: 'abc1234', every: 30 }, p.deps);
	assert.equal(r.code, 0);
	assert.deepEqual(p.lines.filter((l) => /^CI (?!done:)/.test(l)), ['CI CI: green (success) in 1m00s https://github.com/o/r/actions/runs/2']);
	p = polls([[run('in_progress', ''), run('in_progress', '', 'Lint')], [run('completed', 'failure'), run('in_progress', '', 'Lint')], [run('completed', 'failure'), run('completed', 'success', 'Lint')]]);
	r = await ciWait({ commit: 'abc1234', every: 30 }, p.deps);
	assert.equal(r.code, 1, 'one red run is a red result');
	assert.equal(p.lines.filter((l) => /^CI CI: red \(failure\)/.test(l)).length, 1, 'each end is reported once');
	assert.match(p.lines.at(-1), /^CI done: 1 red, 1 green/);
});

test('ci-wait says once when a run passes ten minutes, and gives up past its limit', async () => {
	const long = Array.from({ length: 30 }, () => [run('in_progress', '')]);
	const p = polls([...long, [run('completed', 'success')]]);
	const r = await ciWait({ commit: 'abc1234', every: 60 }, p.deps);
	assert.equal(r.code, 0);
	assert.equal(p.lines.filter((l) => /still running after 10 min/.test(l)).length, 1);
	const q = polls([[run('in_progress', '')]]);
	const r2 = await ciWait({ commit: 'abc1234', every: 60, max: 5 }, q.deps);
	assert.equal(r2.code, 2);
	assert.match(q.lines.at(-1), /gave up after 5 min/);
	const none = polls([[]]);
	const r3 = await ciWait({ commit: 'abc1234', every: 60 }, none.deps);
	assert.equal(r3.code, 2);
	assert.match(none.lines.at(-1), /no CI run started/);
});
