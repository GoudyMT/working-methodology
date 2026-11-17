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

// K124 (1.42.0, Trial B): cmd and PowerShell read a cd with its folder glued on (cd.., cd\) as a move, so a delete after
// it may reach outside the project. A planted flip of that check passed every test on 1.41.0.
// why: guards rule:outward-acts
test('a delete after a glued cd (cd.., cd\\) is read as outside the project; the same delete in place passes', () => {
	for (const c of ['cd..; Remove-Item -Recurse -Force victim', 'cd.. ; rm -r victim', 'cd\\; Remove-Item -Recurse victim']) assert.equal(hook('guard-delete.cjs', c, { tool_name: 'PowerShell' }), 'deny', c);
	assert.equal(hook('guard-delete.cjs', 'cd.. && rm -rf victim'), 'deny');
	assert.equal(hook('guard-delete.cjs', 'rm -rf victim'), 'pass');
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
