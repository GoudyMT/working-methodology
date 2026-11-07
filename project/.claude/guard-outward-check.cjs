// Proof for guard-outward.cjs: every command in ASK must ask, every command in PASS must pass, and the hook run
// as a child process (the way Claude Code runs it) must print the ask decision for a push and nothing for a
// status. Usage: node .claude/guard-outward-check.cjs [guard file]; exit 1 on any wrong answer.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const GUARD = path.resolve(process.argv[2] ?? path.join(__dirname, 'guard-outward.cjs'));
const { decide } = require(GUARD);

const BS = String.fromCharCode(92);
const BT = String.fromCharCode(96);
const LF = String.fromCharCode(10);
const WIN_GIT = 'C:' + BS + 'Program Files' + BS + 'Git' + BS + 'cmd' + BS + 'git.exe';

const ASK = [
	'git push',
	'git push origin main',
	'git -C "D:/work/x y/repo" push',
	"git -C 'C:/a b' push --dry-run origin probe",
	'git -c user.name=x push',
	'git.exe push',
	'"C:/Program Files/Git/cmd/git.exe" push origin HEAD',
	'& "' + WIN_GIT + '" push',
	'git --git-dir=C:/r/.git push',
	'git --git-dir C:/r/.git --work-tree C:/r push',
	"$env:A='1'; git -C $wt push origin HEAD",
	'(git push)',
	'cd x && git push',
	'git send-pack origin',
	// Second loop: escapes, braces, odd spaces and plain forms.
	'gi' + BS + 't push',
	'git pu' + BS + 'sh',
	'git pu' + BT + 'sh',
	'git {push,origin}',
	'git pu{sh,sh} origin',
	'git --attr-source HEAD push',
	'git --shallow-file x push',
	'git config alias.p push; git p',
	'git --config-env=alias.p=V p',
	'git-lfs push origin main',
	'git' + String.fromCharCode(0xa0) + 'push',
	// A logged owner yes, in spellings the settings' ask rule cannot match.
	"node approve.mjs c.json --own'er'-yes \"go\"",
	'node appr*.mjs c.json --owner-yes "go"',
	'node appr*.mjs c.json --owner-yes=go',
	'node approve.mjs c.json --own' + BS + 'er-yes "go"',
	'node approve.mjs c.json --own' + BT + 'er-yes "go"',
	'cmd /c node approve.mjs c.json --own^er-yes go',
	'F=--owner-yes; node approve.mjs c.json $F go',
	'node approve.mjs c.json --own' + BS + LF + 'er-yes go',
	'GIT PUSH',
	'git status' + LF + 'git push',
	'git -C x ' + BT + LF + '  push',
	'git -C x ' + BS + LF + '  push',
	'git lfs push origin main',
	'git subtree push --prefix=x origin y',
	'git -c alias.p=push p',
	'powershell -NoProfile -Command "git -C C:/r push"',
	"bash -c 'git push origin HEAD'",
	"Start-Process git -ArgumentList '-C', $wt, 'push'",
	'gh pr create --title x --body-file y.md',
	'gh pr merge 139 --squash --subject "x (#139)" --body-file e.txt',
	'gh -R owner/repo pr merge 139',
	'gh pr --repo owner/repo merge 139',
	'gh release create v1.4.2 --notes-file n.md',
	'gh release upload v1.4.2 a.zip',
	'gh release edit v1.4.1 --draft=false',
	'gh release delete v0',
	'gh api repos/owner/repo/pulls -X POST',
	'gh api -XPATCH repos/x/y',
	'gh api --method=DELETE repos/x/y/git/refs/heads/z',
	'gh api repos/x/y/issues -f title=t',
	'gh api graphql -F query=@q.graphql',
	'gh pr comment 139 --body hi',
	'gh pr ready 139',
	'gh pr edit 139 --title t',
	'gh pr close 139',
	'gh workflow run ci.yml',
	'gh repo sync',
	'"C:/Program Files/GitHub CLI/gh.exe" pr merge 139',
	'gh run rerun 123',
	'gh issue create -t x',
];

const PASS = [
	'git status',
	'git -C "C:/x y/repo" log --oneline -5',
	'git commit -m "fix: push the guard"',
	'git fetch origin',
	'git pull --ff-only',
	'git stash push -m wip',
	'git -C C:/r rev-parse --show-toplevel',
	'git log --grep push',
	'git branch -d probe-push',
	'git worktree list',
	'git -c core.autocrlf=false status',
	'gh pr view 139 --json state,mergeable',
	'gh pr view 139 --repo owner/repo',
	'gh pr checks 139',
	'gh pr diff 139',
	'gh run list --branch chore/test-tools-v5',
	'gh run view 123 --log',
	'gh run download 123 -n logs',
	'gh api repos/owner/repo/pulls/139',
	'gh api repos/x/y -X GET',
	'gh release view v1.4.1',
	'gh release list',
	'gh auth status',
	'gh search prs vitest',
	'node .claude/agent-usage.cjs',
	'Get-Content pushed.txt',
	'echo push',
	'pnpm --dir C:/wt exec vitest run',
];

let wrong = 0;
const check = (label, input, wantAsk) => {
	const reason = decide(input);
	if (Boolean(reason) !== wantAsk) {
		wrong++;
		console.log((wantAsk ? 'MISSED     ' : 'FALSE ASK  ') + label);
	} else {
		console.log((wantAsk ? 'ask  ' : 'pass ') + (reason || '-').padEnd(28) + label);
	}
};

for (const command of ASK) check(command, { tool_name: 'Bash', tool_input: { command } }, true);
for (const command of PASS) check(command, { tool_name: 'PowerShell', tool_input: { command } }, false);
// Other field names: a tool that names its command differently is still read; the description is not.
check('[field "script"] git -C x push', { tool_name: 'Monitor', tool_input: { script: 'git -C x push' } }, true);
check('[description only] git push', { tool_name: 'Bash', tool_input: { command: 'git status', description: 'git push' } }, false);
check('[no tool_input] nothing to run', { tool_name: 'Bash' }, false);

// End to end: the hook as a child process, fed JSON on stdin.
const runHook = (stdin) => spawnSync(process.execPath, [GUARD], { input: stdin, encoding: 'utf8' });
const pushRun = runHook(JSON.stringify({ tool_name: 'PowerShell', tool_input: { command: 'git -C C:/r push' } }));
const pushOut = pushRun.stdout ? JSON.parse(pushRun.stdout) : {};
const pushAsks = pushRun.status === 0 && pushOut.hookSpecificOutput?.permissionDecision === 'ask';
console.log((pushAsks ? 'ask  ' : 'MISSED     ') + '[child process] git -C C:/r push -> ' + pushRun.stdout);
if (!pushAsks) wrong++;
const statusRun = runHook(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git status' } }));
const statusQuiet = statusRun.status === 0 && statusRun.stdout === '';
console.log((statusQuiet ? 'pass ' : 'FALSE ASK  ') + '[child process] git status -> (' + statusRun.stdout.length + ' bytes)');
if (!statusQuiet) wrong++;
// A log file that cannot be written (its folder does not exist) must not cost the ask or the clean exit.
const badLog = path.join(__dirname, 'no-such-folder', 'log.txt');
const badLogRun = spawnSync(process.execPath, [GUARD, badLog], {
	input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push' } }),
	encoding: 'utf8',
});
const badLogAsks = badLogRun.status === 0 && badLogRun.stdout.includes('"ask"');
console.log((badLogAsks ? 'ask  ' : 'MISSED     ') + '[child process] unwritable log -> exit ' + badLogRun.status);
if (!badLogAsks) wrong++;
const brokenRun = runHook('not json');
const brokenAsks = brokenRun.stdout.includes('"ask"');
console.log((brokenAsks ? 'ask  ' : 'MISSED     ') + '[child process] stdin not JSON -> asks');
if (!brokenAsks) wrong++;

const total = ASK.length + PASS.length + 7;
console.log(wrong === 0 ? 'ALL ' + total + ' CASES RIGHT' : 'Expected all ' + total + ' right: ' + wrong + ' WRONG');
process.exit(wrong === 0 ? 0 : 1);
