// K244: CI's "Branch and commit names" step checked each PR commit's message only. A commit made with --no-verify, on
// the web or in a cloud session skips the local commit-msg hook, so one recorded under an AI tool's name as author or
// committer reached the PR unchecked. The step now holds each commit's author and committer to the same name check.
// The step's own run lines are read from ci.yml and run in bash, as GitHub runs them, over a temp repo.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const KIT = path.resolve('.');
const ENV = { ...process.env };
for (const k of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']) delete ENV[k];
const ID = ['-c', 'user.name=Max Owner', '-c', 'user.email=max@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];
const git = (cwd, args, env = {}) => spawnSync('git', [...ID, ...args], { cwd, encoding: 'utf8', env: { ...ENV, ...env } });

// The step's run block, dedented, as bash gets it.
function stepRun() {
	const ci = fs.readFileSync(path.join(KIT, '.github', 'workflows', 'ci.yml'), 'utf8');
	const text = ci.split('- name: Branch and commit names\n')[1].split(/\n\s+- (?:name|uses):/)[0];
	const lines = text.split('run: |\n')[1].split('\n');
	const indent = /^\s*/.exec(lines[0])[0].length;
	const end = lines.findIndex((l) => l.trim() && /^\s*/.exec(l)[0].length < indent);
	return (end < 0 ? lines : lines.slice(0, end)).map((l) => l.slice(indent)).join('\n');
}

// A repo with a main commit by a person and a PR branch whose one commit is by whoever the case names; the base copy
// of the scripts sits where the unpack step puts it.
function run({ author, committer, baseCopy = true }) {
	const dir = kitTemp.makeTemp('ci-names-');
	const repo = path.join(dir, 'repo');
	fs.mkdirSync(repo);
	git(repo, ['init', '-q', '-b', 'main']);
	git(repo, ['commit', '-q', '--allow-empty', '-m', 'chore: start']);
	git(repo, ['checkout', '-q', '-b', 'fix/plain-words']);
	const env = {};
	if (author) Object.assign(env, { GIT_AUTHOR_NAME: author[0], GIT_AUTHOR_EMAIL: author[1] });
	if (committer) Object.assign(env, { GIT_COMMITTER_NAME: committer[0], GIT_COMMITTER_EMAIL: committer[1] });
	assert.equal(git(repo, ['commit', '-q', '--allow-empty', '-m', 'fix: a plain change'], env).status, 0);
	const head = git(repo, ['rev-parse', 'HEAD']).stdout.trim();
	fs.mkdirSync(path.join(repo, 'project', '.claude'), { recursive: true });
	const base = path.join(dir, 'base', 'project', '.claude');
	fs.mkdirSync(base, { recursive: true });
	for (const f of ['name-check.mjs', 'safe-spawn.cjs'].filter((x) => fs.existsSync(path.join(KIT, 'project', '.claude', x)))) {
		fs.copyFileSync(path.join(KIT, 'project', '.claude', f), path.join(repo, 'project', '.claude', f));
		if (baseCopy) fs.copyFileSync(path.join(KIT, 'project', '.claude', f), path.join(base, f));
	}
	return spawnSync('bash', ['-c', stepRun()], {
		cwd: repo,
		encoding: 'utf8',
		env: { ...ENV, RUNNER_TEMP: dir, HEAD_REF: 'fix/plain-words', PR_TITLE: 'fix: a plain change', PR_NUMBER: '7', PR_BASE: 'main', PR_HEAD: head },
	});
}

// why: catches a PR commit recorded under an AI tool's name that skipped the local commit-msg hook
test('CI refuses a PR commit whose author or committer names an AI tool, and passes a person', () => {
	const person = run({});
	assert.equal(person.status, 0, person.stdout + person.stderr);
	for (const [what, c] of [
		['an AI author', { author: ['Claude', 'noreply@anthropic.com'] }],
		['an AI committer', { committer: ['GitHub Copilot', '1+Copilot@users.noreply.github.com'] }],
		['an AI maker email', { author: ['Max Owner', 'max@openai.com'] }],
	]) {
		const r = run(c);
		assert.equal(r.status, 1, `${what} passed CI: ${r.stdout}${r.stderr}`);
		assert.match(r.stderr, /names an AI tool/, what);
	}
	// A person whose name only holds the letters passes.
	assert.equal(run({ author: ['Claudia Owner', 'claudia@example.com'] }).status, 0);
});

// why: guards rule:commit-message-format (CI still checks authors when the base copy predates the check)
test('with no author check in the base copy, CI runs the PR copy for it and says so', () => {
	const r = run({ author: ['Claude', 'noreply@anthropic.com'], baseCopy: false });
	assert.equal(r.status, 1, r.stdout + r.stderr);
	assert.match(r.stdout, /the base has no /);
});
