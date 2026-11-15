// K61 (the owner, 2026-11-15): merge on green had no exact steps. Install user and install project print each step the
// owner takes, the exact lines to paste or run, and whether it is done. Every line here was proven live first on a
// throwaway repo and a headless session (a wrong allow rule either does nothing or allows too much).
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { mergeOnGreen, renderMergeOnGreen, allowLines } from '../scripts/merge-on-green.mjs';

kitTemp.sessionRoot();
const g = (dir, ...a) => {
	const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-C', dir, ...a], { encoding: 'utf8' });
	if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
	return r.stdout.trim();
};
const ADAPTER = (a26, a27) => [
	'| Row | What | Module | Value |', '|---|---|---|---|',
	`| A26 | Branch rule on main: the CI gate check's name | First Push Gate | \`${a26}\` |`,
	`| A27 | Standing grants | Standing Grants | \`${a27}\` |`, ''].join('\n');
// A project on GitHub as the owner has it: origin is the GitHub repo, and origin/main holds what main holds.
function project({ a26 = '<fill in>', a27 = 'none', onMain = false, remote = 'https://github.com/pat/app.git' } = {}) {
	const dir = kitTemp.makeTemp('mog-');
	g(dir, 'init', '-q', '-b', 'main');
	fs.mkdirSync(path.join(dir, 'standards'));
	fs.writeFileSync(path.join(dir, 'standards', 'project-adapter.md'), ADAPTER(a26, a27));
	fs.writeFileSync(path.join(dir, 'README.md'), 'app\n');
	g(dir, 'add', 'README.md');
	if (onMain) g(dir, 'add', '-f', 'standards/project-adapter.md');
	g(dir, 'commit', '-q', '-m', 'chore: start');
	if (remote) {
		g(dir, 'remote', 'add', 'origin', remote);
		g(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
	}
	return dir;
}
const homeWith = (allow) => {
	const home = kitTemp.makeTemp('mog-home-');
	if (allow) fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ permissions: { allow } }));
	return home;
};
const repoAnswer = (auto, del) => (args) => (args[1] === 'repos/pat/app'
	? { status: 0, stdout: JSON.stringify({ full_name: 'pat/app', allow_auto_merge: auto, delete_branch_on_merge: del }), stderr: '' }
	: { status: 1, stdout: '', stderr: 'unexpected' });
const step = (r, id) => r.steps.find((s) => s.id === id);

// why: guards rule:standing-grants (the allow lines proven live: the ~ form matches only the ~ command Claude runs)
test('the six allow lines name the gate by the spelling each shell runs, and only arm, disarm and autofix', () => {
	const home = path.join(kitTemp.makeTemp('mog-user-'), '.claude');
	const own = allowLines(home, path.dirname(home));
	assert.deepEqual(own.bash, ['arm', 'disarm', 'autofix'].map((a) => `Bash(node ~/.claude/kit-tools/merge-gate.mjs ${a} *)`));
	const posix = home.split(path.sep).join('/');
	// The PowerShell tool never auto-runs $HOME (proven live, 2026-11-15), so its lines carry the full path.
	assert.deepEqual(own.powershell, ['arm', 'disarm', 'autofix'].map((a) => `PowerShell(node ${posix}/kit-tools/merge-gate.mjs ${a} *)`));
	for (const l of [...own.bash, ...own.powershell]) assert.doesNotMatch(l, /\$HOME|\\|\*merge-gate/, 'no variable, backslash or wildcard path');
	// A config folder somewhere else is not ~/.claude, so the Bash lines carry its full path too.
	const other = kitTemp.makeTemp('mog-cfg-');
	assert.ok(allowLines(other, path.dirname(home)).bash.every((l) => l.startsWith(`Bash(node ${other.split(path.sep).join('/')}/kit-tools/merge-gate.mjs `)));
});

// why: guards rule:standing-grants
test('install user shows the allow step to do until all six lines are in the settings, then done', () => {
	const home = homeWith(null);
	const todo = mergeOnGreen({ home });
	assert.deepEqual(todo.steps.map((s) => s.id), ['allow']);
	assert.equal(step(todo, 'allow').state, 'to do');
	const text = renderMergeOnGreen(todo).join('\n');
	for (const l of [...allowLines(home).bash, ...allowLines(home).powershell]) assert.ok(text.includes(`"${l}"`), l);
	assert.match(text, /settings\.json/);
	// The whole block to paste, as it sits in the file (the K61 sweep: six bare lines left where they go to a guess).
	assert.match(text, /"permissions": \{\n\s+"allow": \[/);
	const own = (h, n = 6) => {
		const l = [...allowLines(h).bash, ...allowLines(h).powershell].slice(0, n);
		fs.writeFileSync(path.join(h, 'settings.json'), JSON.stringify({ permissions: { allow: l } }));
		return h;
	};
	assert.equal(step(mergeOnGreen({ home: own(homeWith(null), 5) }), 'allow').state, 'to do', 'five of six is not done');
	const done = own(homeWith(null));
	assert.equal(step(mergeOnGreen({ home: done }), 'allow').state, 'done');
	assert.doesNotMatch(renderMergeOnGreen(mergeOnGreen({ home: done })).join('\n'), /Bash\(/, 'a done step prints no lines');
});

// why: guards rule:standing-grants (live on the probe repo: the kit's files stay out of git, so a grant only in the
// working copy never reaches main and the gate reads none)
test('install project shows the grant as done only once row A27 grants merge on main', () => {
	const home = homeWith(null);
	const opts = (dir) => ({ home, projectDir: dir, gh: repoAnswer(true, true), protection: () => 'protected' });
	const none = mergeOnGreen(opts(project()));
	assert.equal(step(none, 'grant').state, 'to do');
	const text = renderMergeOnGreen(none).join('\n');
	assert.match(text, /merge through the merge gate; auto-fix push/);
	assert.match(text, /"standards\/project-adapter\.md"/, 'names the track entry');
	assert.match(text, /git add -f standards\/project-adapter\.md/);
	assert.match(text, /you merge/i);
	// Paste-ready: the exact track file and the commands, the same in both shells, and the fetch after the merge.
	for (const l of ['{ "track": ["standards/project-adapter.md"] }', 'git switch -c docs/grant-merge-on-green', 'git add -f standards/project-adapter.md .kit/tracking.json', 'git push -u origin docs/grant-merge-on-green', 'git fetch origin']) assert.ok(text.includes(l), l);
	assert.match(text, /main pushed/);
	assert.equal(step(mergeOnGreen(opts(project({ a27: 'merge through the merge gate; auto-fix push' }))), 'grant').state, 'to do', 'granted in the working copy only');
	assert.equal(step(mergeOnGreen(opts(project({ a27: 'no merge', onMain: true }))), 'grant').state, 'to do');
	assert.equal(step(mergeOnGreen(opts(project({ a27: 'merge through the merge gate; auto-fix push', onMain: true }))), 'grant').state, 'done');
});

// why: guards rule:first-push-gate
test('install project names the real repo in the repo and protect steps, and marks each from GitHub', () => {
	const home = homeWith(null);
	const dir = project({ a26: 'kit-tests; solo' });
	const off = mergeOnGreen({ home, projectDir: dir, gh: repoAnswer(false, true), protection: () => 'unprotected' });
	assert.equal(step(off, 'repo').state, 'to do');
	assert.equal(step(off, 'protect').state, 'to do');
	const text = renderMergeOnGreen(off).join('\n');
	// pin: 1 (the owner pastes these commands as printed, and gh reads them)
	assert.ok(text.includes('gh api -X PATCH repos/pat/app -F allow_auto_merge=true -F delete_branch_on_merge=true'), text);
	assert.ok(text.includes('gh api -X PUT repos/pat/app/branches/main/protection --input .kit/branch-protection.json'), text);
	assert.match(text, /"kit-tests"/, 'the check name from row A26');
	assert.match(text, /merge-gate\.mjs check <PR>/);
	// The check line in each shell's spelling, and the protect file copied in each shell, from the project folder.
	const full = home.split(path.sep).join('/');
	assert.ok(text.includes(`PowerShell: node ${full}/kit-tools/merge-gate.mjs check <PR>`), 'the PowerShell check line');
	for (const l of ['cp .claude/kit/branch-protection.json .kit/branch-protection.json', 'Copy-Item .claude/kit/branch-protection.json .kit/branch-protection.json']) assert.ok(text.includes(l), l);
	assert.match(text, /project folder/);
	assert.match(text, /has run/, 'a required check must have run once');
	const on = mergeOnGreen({ home, projectDir: dir, gh: repoAnswer(true, true), protection: () => 'protected' });
	assert.equal(step(on, 'repo').state, 'done');
	assert.equal(step(on, 'protect').state, 'done');
	// No answer from GitHub is not a pass: the step stays unchecked, with its command.
	const blind = mergeOnGreen({ home, projectDir: dir, gh: () => ({ status: 1, stdout: '', stderr: 'HTTP 401' }), protection: () => null });
	assert.equal(step(blind, 'repo').state, 'not checked');
	assert.equal(step(blind, 'protect').state, 'not checked');
	const blindText = renderMergeOnGreen(blind).join('\n');
	assert.match(blindText, /gh api -X PATCH repos\/pat\/app/);
	// Each unchecked step says why and how to check again.
	assert.match(blindText, /not checked: [^\n]*gh auth login[^\n]*install project again/);
	assert.match(blindText, /private repo/, 'the Free-plan limit on a private repo');
	// No GitHub remote yet: the steps wait for the first push, with the repo left for the owner to name.
	const local = mergeOnGreen({ home, projectDir: project({ remote: null }), gh: repoAnswer(true, true), protection: () => 'protected' });
	assert.equal(step(local, 'repo').state, 'not checked');
	assert.match(renderMergeOnGreen(local).join('\n'), /repos\/<owner>\/<repo>/);
	assert.match(renderMergeOnGreen(local).join('\n'), /not checked: [^\n]*push the repo to GitHub first/);
});

// why: guards rule:standing-grants (the K61 security review: a URL whose path only mentions github.com named a repo,
// so status read another repo's settings)
test('the GitHub repo is read from the start of the remote URL only', async () => {
	const { slugOf } = await import('../scripts/safe-git.mjs');
	for (const [url, slug] of [['https://github.com/pat/app.git', 'pat/app'], ['https://x@github.com/pat/app', 'pat/app'], ['git@github.com:pat/app.git', 'pat/app'], ['ssh://git@github.com/pat/app/', 'pat/app']]) {
		assert.equal(slugOf(url), slug, url);
	}
	for (const url of ['https://evil.example/github.com/pat/app', 'https://github.com.evil.example/pat/app', 'https://github.com/../app', 'https://github.com/pat/..', 'file:///c/github.com/pat/app', '']) {
		assert.equal(slugOf(url), null, url);
	}
});
