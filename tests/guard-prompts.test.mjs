// Fewer prompts no one can answer (E27, 1.24.0): the 10 days before this build held 512 live guard asks, 76 of them
// inside subagents, where no one sees the ask and the agent waits; and about half of the main session's delete asks
// were on text a command only writes to a file (a here-document). Each case runs the shipped hook as Claude Code does.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();

// A folder outside the project and the session's own, as each platform writes one.
const OUT = process.platform === 'win32' ? 'C:/elsewhere/x' : '/elsewhere/x';
const hook = (file, command, extra = {}) => {
	const r = spawnSync(process.execPath, [path.resolve('project/.claude', file)], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: process.cwd(), ...extra }), encoding: 'utf8' });
	assert.equal(r.status, 0, `the guard crashed: ${r.stderr}`);
	return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : 'pass';
};

// why: guards rule:outward-acts
test('a guard in a subagent refuses instead of asking, so the agent hands the act back and never waits on a prompt', () => {
	const sub = { agent_id: 'a1b2c3', agent_type: 'builder' };
	assert.equal(hook('guard-outward.cjs', 'git push origin main', sub), 'deny');
	assert.equal(hook('guard-delete.cjs', 'rm -rf ' + OUT, sub), 'deny');
	// The main session holds it too, until the owner's pop-up yes (T1), and a plain command still passes in both.
	assert.equal(hook('guard-outward.cjs', 'git push origin main'), 'deny');
	assert.equal(hook('guard-delete.cjs', 'rm -rf ' + OUT), 'deny');
	assert.equal(hook('guard-outward.cjs', 'git status', sub), 'pass');
	assert.equal(hook('guard-delete.cjs', 'git status', sub), 'pass');
});

// K110 (1.42.0, reproduced on 1.41.0): rule:outward-acts asks the owner's yes before a local git act that throws away
// uncommitted or unpushed work, but every guard let these through. Each one now waits for the yes (a subagent is
// refused); the forms that keep the work, or only read, still pass.
// why: guards rule:outward-acts
test('a local git act that throws away work waits for the owner; reads and safe forms pass', () => {
	for (const c of ['git reset --hard', 'git reset --hard HEAD~1', 'git checkout -- .', 'git checkout .', 'git checkout -f main', 'git checkout HEAD README.md', 'git restore .', 'git restore --worktree --staged x', 'git switch --discard-changes main', 'git branch -D old', 'git branch --delete --force old', 'git branch -df old', 'git stash drop', 'git stash clear', 'git reflog expire --expire=now --all', 'git reflog delete HEAD@{1}', 'git -C sub reset --hard',
		// The commit security review: a start of a long option, and the forms that overwrite or move a branch.
		'git reset --ha', 'git switch --disc main', 'git restore --work x', 'git branch -f main HEAD~3', 'git branch -M old new', 'git branch -C a b', 'git checkout -B main', 'git switch -C main', 'git switch --force-create main',
		// The second review: a one-letter start, a value after =, and a glued value that only looks like --staged.
		'git reset --h', 'git switch --force-create=main', 'git restore -sSOME .']) {
		assert.equal(hook('guard-delete.cjs', c), 'deny', c);
		assert.equal(hook('guard-delete.cjs', c, { agent_id: 'a1' }), 'deny', c);
	}
	for (const c of ['git status', 'git stash list', 'git stash', 'git stash pop', 'git branch -d old', 'git branch -a', 'git restore --staged x', 'git reset --soft HEAD~1', 'git reset HEAD x', 'git checkout main', 'git checkout -b feat/x', 'git switch main', 'git reflog', 'git log --oneline']) assert.equal(hook('guard-delete.cjs', c), 'pass', c);
});

// The build 16 sweep (each put a changed file back in a real repo): a pathspec that is a glob, magic or a list file;
// xargs feeding checkout; an alias set on the spot for checkout or restore; a path after a move the guard cannot
// follow; and the plumbing that overwrites the work tree or drops a branch.
// why: guards rule:outward-acts
test('a glob or magic pathspec, xargs, an alias on the spot, a path after a move and git plumbing that drop work wait for the owner', () => {
	for (const c of ['git checkout *.md', "git checkout '*.md'", "git checkout HEAD~1 '*.cjs'", 'git checkout :/', 'git checkout HEAD --pathspec-from-file=list.txt',
		'git ls-files -m | xargs git checkout', 'echo . | xargs git checkout', 'echo . | xargs git restore',
		'git -c alias.co=checkout co -- .', 'git -c alias.x=restore x .', "git config alias.discard 'checkout -- .'",
		'git -C sub checkout Makefile', 'git -C .. checkout LICENSE',
		'git checkout-index -f -a', 'git read-tree -u --reset HEAD', 'git update-ref -d refs/heads/side', 'git push . +HEAD~3:main',
		// The commit security review: help beside other words, other local paths and force spellings, update-ref --stdin,
		// and an alias for branch, switch, reset or push whatever its flags.
		'git checkout --pathspec-from-file list -h', 'git push ./ +HEAD~3:main', 'git push --force-with-lease .. main', 'git push -o ci.skip ./ +main:main', 'git push --repo=../x --force main', 'git update-ref --stdin', "git -c alias.b='branch --delete --force' b old", 'git -c alias.r=reset r --keep HEAD~1']) {
		assert.equal(hook('guard-delete.cjs', c), 'deny', c);
	}
	for (const c of ['git restore --help', 'git restore -h', 'git checkout --help', 'git checkout-index -a', 'git read-tree HEAD', 'git update-ref refs/heads/x HEAD', 'git config alias.st status']) assert.equal(hook('guard-delete.cjs', c), 'pass', c);
});

// K124 (1.42.0, Trial B): cmd and PowerShell read a cd with its folder glued on (cd.., cd\) as a move, so a delete after
// it may reach outside the project. A planted flip of that check passed every test on 1.41.0.
// why: guards rule:outward-acts
// planted: {"file":"project/.claude/guard-delete.cjs","was":"test(words[p]) || /^(cd|chdir|pushd)$/i.test(lead)) state.moved = true","to":"test(words[p]) && /^(cd|chdir|pushd)$/i.test(lead)) state.moved = true"}
test('a delete after a glued cd (cd.., cd\\) is read as outside the project; the same delete in place passes', () => {
	for (const c of ['cd..; Remove-Item -Recurse -Force victim', 'cd.. ; rm -r victim', 'cd\\; Remove-Item -Recurse victim']) assert.equal(hook('guard-delete.cjs', c, { tool_name: 'PowerShell' }), 'deny', c);
	assert.equal(hook('guard-delete.cjs', 'cd.. && rm -rf victim'), 'deny');
	assert.equal(hook('guard-delete.cjs', 'rm -rf victim'), 'pass');
});

// The 1.42.0 sweep (S8): with CDPATH set, `cd project` may land in a folder of that name outside the project, so a
// delete after a bare-name cd is read as after an unknown move; a ./ cd and no CDPATH read as before.
// why: guards rule:outward-acts
test('a bare-name cd beside CDPATH is an unknown move, so a delete after it waits', () => {
	// The commit security review: a quoted or escaped spelling sets the same variable, and a drive or backslash name is
	// still looked up in CDPATH by Git Bash.
	for (const c of ['CDPATH=.. cd project && rm -rf tmpx', 'export CDPATH=..; cd project; rm -rf tmpx', 'export C"D"PATH=..; cd project; rm -rf tmpx', 'export CD\\PATH=..; cd project; rm -rf tmpx', 'CDPATH=.. cd C:project && rm -rf tmpx',
		// A name the guard cannot read, or a file sourced, may set it too (the second commit review).
		'n=CD; export ${n}PATH=..; cd project; rm -rf tmpx', 'source ./env.sh; cd project; rm -rf tmpx', '. ./env.sh && cd project && rm -rf tmpx',
		// The third commit review: a quoted or joined spelling of those, a read into a built name, and BASH_ENV set inline.
		'"source" ./env.sh; cd project; rm -rf tmpx', 'sour\\\nce ./env.sh; cd project; rm -rf tmpx', 'read -r CDPA$x <<< ..; cd project; rm -rf tmpx',
		'BASH_ENV=./env.sh bash -c "cd project && rm -rf tmpx"']) assert.equal(hook('guard-delete.cjs', c), 'deny', c);
	assert.equal(hook('guard-delete.cjs', 'cd project && rm -rf tmpx'), 'pass');
	assert.equal(hook('guard-delete.cjs', 'CDPATH=.. cd ./project && rm -rf tmpx'), 'pass');
	const env = { ...process.env, CDPATH: '..' };
	const r = spawnSync(process.execPath, [path.resolve('project/.claude/guard-delete.cjs')], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'cd project && rm -rf tmpx' }, cwd: process.cwd() }), encoding: 'utf8', env });
	assert.equal(JSON.parse(r.stdout || '{"hookSpecificOutput":{}}').hookSpecificOutput.permissionDecision, 'deny');
});

// K124 (1.42.0): the planted-bug sweep of the shared reader. Past its cap of brace groups the rest of a command is
// unread, so it asks: a push behind 500 groups went out unread when only plain braces were left, and with no cap on
// groups a long run of them read one at a time for minutes, past the hook's time.
// why: guards rule:outward-acts
// planted: {"file":"project/.claude/guard-read.cjs","was":"pass < MAX_GROUPS && (brace","to":"pass < MAX_GROUPS || (brace"}
// planted: {"file":"project/.claude/guard-read.cjs","was":"if (brace.test(s) || sequence.test(s) || s.includes","to":"if (brace.test(s) && sequence.test(s) || s.includes"}
test('past the brace-group cap the rest of a command asks, and a long run of groups answers in time', () => {
	assert.equal(hook('guard-outward.cjs', 'echo ' + '{1..1}'.repeat(500) + ' ; git {push,status} origin main'), 'deny');
	const t0 = Date.now();
	assert.equal(hook('guard-outward.cjs', 'echo ' + 'x{1..1} '.repeat(12000)), 'deny');
	assert.ok(Date.now() - t0 < 5000, `12,000 groups took ${Date.now() - t0} ms`);
	assert.equal(hook('guard-outward.cjs', 'echo ' + 'x{1..1} '.repeat(20)), 'pass');
});

// K161 (build 21): no test read a sequence that counts down, so a flip of its loop (x >= b to x < b) survived the
// mutation check and pus{h..g} read as nothing; the guard proofs hold it now too.
// why: guards rule:outward-acts
// planted: {"file":"project/.claude/guard-read.cjs","was":"x <= b : x >= b","to":"x <= b : x < b"}
test('a sequence that counts down is read as bash reads it', () => {
	assert.equal(hook('guard-outward.cjs', 'git pus{h..g} origin main'), 'deny');
	assert.equal(hook('guard-delete.cjs', 'r{n..m} -rf C:/elsewhere'), 'deny');
});

// A review lead (2026-11-18): a git subcommand held in a variable was held only where git came first, so behind a
// shell keyword (then, do, else, !) or an assignment it was read as a plain git call.
// why: guards rule:outward-acts
test('a git subcommand held in a variable waits behind a shell keyword or an assignment too', () => {
	for (const c of ['if true; then git $c --hard; fi', 'for i in 1; do git $c --hard; done', 'if false; then :; else git $c --hard; fi', '! git $c --hard', 'X=1 git $c --hard',
		// The commit review: the condition keywords and coproc put git in a program's place too.
		'if git $c --hard; then :; fi', 'while git $c --hard; do :; done', 'until git $c --hard; do :; done', 'coproc git $c --hard']) assert.equal(hook('guard-delete.cjs', c), 'deny', c);
	assert.equal(hook('guard-delete.cjs', 'if true; then git status; fi'), 'pass');
});

// N10: off a terminal, npm assumes yes, so `npx <name>` in an agent's shell fetched and ran any registry package.
// why: guards rule:outward-acts
test('the shipped project settings turn off npm and npx installing a missing package without a prompt', () => {
	const settings = JSON.parse(fs.readFileSync(path.resolve('project/.claude/settings.json'), 'utf8'));
	assert.equal(settings.env && settings.env.npm_config_yes, 'false');
});

// The 1.24.0 sweep: install skips a guard-read.cjs the owner changed, so an updated guard can sit beside an older
// reader; it must still hold the command, never crash and let it through.
// why: guards rule:outward-acts
test('a guard beside an older shared reader still holds the command, and owner-proof still refuses', () => {
	const dir = kitTemp.makeTemp('stale-');
	for (const f of ['guard-delete.cjs', 'guard-outward.cjs', 'owner-proof.cjs', 'owner-yes.cjs']) fs.copyFileSync(path.resolve('project/.claude', f), path.join(dir, f));
	const old = fs.readFileSync(path.resolve('project/.claude/guard-read.cjs'), 'utf8').replace(/module\.exports = \{[^}]*\};/, 'module.exports = { BACKSLASH, BACKTICK, LF, CR, normalize, plainText, withoutComments, joinContinuations, tokenize };');
	fs.writeFileSync(path.join(dir, 'guard-read.cjs'), old);
	const run = (file, command, extra = {}) => {
		const r = spawnSync(process.execPath, [path.join(dir, file)], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: process.cwd(), ...extra }), encoding: 'utf8' });
		assert.equal(r.status, 0, `${file} crashed: ${r.stderr}`);
		return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : 'pass';
	};
	assert.equal(run('guard-delete.cjs', 'rm -rf ' + OUT), 'deny');
	assert.equal(run('guard-outward.cjs', 'git push origin main'), 'deny');
	assert.equal(run('owner-proof.cjs', 'echo x >> ~/.claude/projects/p/s.jsonl'), 'deny');
});

// The 1.24.0 sweep: reading a here-document body as data was spelled around six ways (an end mark bash reads
// otherwise, a cat function, continued lines, nested quotes, a second mark, a process substitution), and it saved about
// 10 of 518 prompts. Every body is read as commands again; each spelling the sweep found stays here as a case.
// why: guards rule:outward-acts
test('the delete guard reads every here-document body as commands, in every spelling that runs one', () => {
	assert.equal(hook('guard-delete.cjs', "cat <<'EOF' > notes.md\nrm -rf " + OUT + "\nEOF"), 'deny');
	assert.equal(hook('guard-delete.cjs', "cat <<E\"OF\" > notes.md\nhi\nEOF\nrm -rf " + OUT), 'deny');
	assert.equal(hook('guard-delete.cjs', "cat > n.md <<E'OF'\nx\nEOF\nrm -rf " + OUT + "\nE'OF'"), 'deny');
	assert.equal(hook('guard-delete.cjs', "cat() { bash; }\ncat <<EOF\nrm -rf " + OUT + "\nEOF"), 'deny');
	// The same body fed to a shell, expanded by bash, or after the here-document ends, runs.
	assert.equal(hook('guard-delete.cjs', "cat <<'EOF' | bash\nrm -rf " + OUT + "\nEOF"), 'deny');
	assert.equal(hook('guard-delete.cjs', 'cat > notes.md <<EOF\n$(rm -rf ' + OUT + ')\nEOF'), 'deny');
	assert.equal(hook('guard-delete.cjs', "bash <<'EOF'\nrm -rf " + OUT + "\nEOF"), 'deny');
	assert.equal(hook('guard-delete.cjs', "cat > notes.md <<'EOF'\nx\nEOF\nrm -rf " + OUT + ""), 'deny');
	// The security review of this branch: a second here-document on the line read by bash, and a body sent into a
	// process substitution, run; only a line holding one cat or tee and one mark is data.
	assert.equal(hook('guard-delete.cjs', "cat <<'A' > notes.md; bash <<'B'\nx\nA\nrm -rf " + OUT + "\nB"), 'deny');
	assert.equal(hook('guard-delete.cjs', "cat <<'A' > >(bash)\nrm -rf " + OUT + "\nA"), 'deny');
	assert.equal(hook('guard-delete.cjs', "cat <<'A' && bash x.sh\nrm -rf " + OUT + "\nA"), 'deny');
	// A line continued with a backslash carries its pipe on the next line.
	assert.equal(hook('guard-delete.cjs', "cat <<'A' \\\n| bash\nrm -rf " + OUT + "\nA"), 'deny');
	assert.equal(hook('guard-delete.cjs', "cat <<'A' \\\n> >(bash)\nrm -rf " + OUT + "\nA"), 'deny');
	assert.equal(hook('guard-delete.cjs', "cat <<'A' $'x'\nrm -rf " + OUT + "\nA"), 'deny');
	// Double quotes do not stop an expansion: one anywhere on the line keeps the body read.
	assert.equal(hook('guard-delete.cjs', "cat <<'A' > \"$(bash)\"\nrm -rf " + OUT + "\nA"), 'deny');
	assert.equal(hook('guard-delete.cjs', "cat <<'A' > \"`bash`\"\nrm -rf " + OUT + "\nA"), 'deny');
	// A single quote inside double quotes is text, so it hides nothing.
	assert.equal(hook('guard-delete.cjs', "cat <<'A' > \"a'$(bash)'\"\nrm -rf " + OUT + "\nA"), 'deny');
	// A mark inside quotes starts no here-document, so the lines after it are commands.
	assert.equal(hook('guard-delete.cjs', `cat "a<<'X'"\nrm -rf ${OUT}\nX`), 'deny');
});
