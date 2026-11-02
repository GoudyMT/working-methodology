// Proof for guard-delete.cjs: every delete in ASK must ask, every command in PASS must pass, and the hook run as a
// child process (the way Claude Code runs it) must print the ask decision for a delete outside the session's own
// places and nothing for one inside them. Usage: node .claude/guard-delete-check.cjs [guard file]; exit 1 on any
// wrong answer.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const GUARD = path.resolve(process.argv[2] ?? path.join(__dirname, 'guard-delete.cjs'));
const { decide } = require(GUARD);

// A fixed machine: the system temp, the project, this session and another session of the same project.
const TEMP = 'D:\\SysTemp';
const PROJECT = 'C:\\work\\proj_a.b';
const SESSION_ID = '11111111-2222-3333-4444-555555555555';
const KEY_DIR = TEMP + '\\claude\\C--work-proj-a-b';
const OWN = KEY_DIR + '\\' + SESSION_ID;
const OTHER = KEY_DIR + '\\99999999-8888-7777-6666-555555555555';
const WHERE = { tmpdir: TEMP, projectDir: PROJECT };
// Characters a shell reads like ASCII ones, built at run time so this file stays ASCII.
const LDQ = String.fromCharCode(0x201c);
const RDQ = String.fromCharCode(0x201d);
const ENDASH = String.fromCharCode(0x2013);
const NBSP = String.fromCharCode(0xa0);
const LF = String.fromCharCode(10);

// Found by the pre-PR sweep (2026-11-02): forms that delete outside the roots and passed.
const SWEEP_ASK = [
	'rm -rf C:/work/proj_a.b/b*/../../../elsewhere',
	'rm -rf build/*/../../x',
	'git -c core.x=y clean -fd',
	'git --git-dir .git clean -fd',
	'git --work-tree . clean -fd',
	'pushd C:\\elsewhere; rm -rf build',
	'chdir C:\\elsewhere; rm -rf build',
	'sl C:\\elsewhere; rm -rf build',
	'Push-Location C:\\elsewhere; rm -rf build',
	'env -C / rm -rf x',
	'env --chdir=/c/Users rm -rf someone',
	'Start-Process cmd -ArgumentList "/c rd /s /q someone" -WorkingDirectory C:/Users',
	'pwsh -ec UgBlAG0A',
	'pwsh /ec UgBlAG0A',
	"python -c \"import shutil; shutil.rmtree('C:/elsewhere')\"",
	"python3 -c \"import os; os.remove('C:/elsewhere/x')\"",
	"py -c \"import shutil; shutil.rmtree(r'C:\\elsewhere')\"",
	'perl -e "unlink glob q(/tmp/*)"',
	'ruby -rfileutils -e "FileUtils.rm_rf(q(/tmp/x))"',
	"deno eval \"Deno.removeSync('C:/elsewhere')\"",
	"bun -e \"require('fs').rmSync('C:/elsewhere')\"",
	"node -e \"require('fs').rmdirSync('C:/elsewhere')\"",
	'python - <<EOF' + LF + 'import shutil' + LF + "shutil.rmtree('C:/elsewhere')" + LF + 'EOF',
	'cd C:/elsewhere; find -name x -delete',
	'find build C:/elsewhere -delete',
	'find -P C:/Users -delete',
	'find -L /c/Users -delete',
	'rm -rf build\\' + LF + 'C:/elsewhere',
	'Remove-Item build,C:\\elsewhere',
	'& "C:\\Program Files\\Git\\usr\\bin\\rm.exe" -rf C:\\elsewhere',
	'Remove-Item C:\\work\\proj_a.b\\`.`.\\x',
	'Remove-Item C:\\work\\proj_a.b\\x, C:\\elsewhere\\x',
	"bash -c \"sh -c 'rm -rf /tmp/x'\"",
	'Remove-Item ' + LDQ + 'C:\\elsewhere\\x' + RDQ,
	'Remove-Item ' + ENDASH + 'LiteralPath:C:\\elsewhere\\x',
	'Remove-Item' + NBSP + 'C:\\elsewhere\\x',
	'echo `rm -rf C:/elsewhere/x`',
	'r`m C:\\elsewhere\\x',
	'Remove-I`tem C:\\elsewhere\\x',
	'cmd /c rd/s/q C:\\elsewhere\\x',
	'cmd /c d^el C:\\elsewhere\\x',
	'Remove-Item Microsoft.PowerShell.Core\\FileSystem::C:\\elsewhere',
	"$p = @{ LiteralPath = 'C:\\elsewhere\\x' }; Remove-Item @p -Recurse",
	'Remove-Item -LiteralPath:C:\\elsewhere\\x,keep.txt',
	'Remove-Item -Path build -LiteralPath:C:\\elsewhere\\x',
	'Get-ChildItem C:\\elsewhere -Directory | ForEach-Object -MemberName Delete -ArgumentList $true',
	'Get-ChildItem C:\\elsewhere | % Delete',
	"(Get-ChildItem C:\\elsewhere\\tg-*).ForEach('Delete')",
	'npx rimraf C:/elsewhere/tg-*',
	'npx del-cli C:/elsewhere/x',
	'robocopy C:\\empty C:\\elsewhere /MIR',
	'robocopy C:\\empty C:\\elsewhere /PURGE',
	'rsync -a --delete C:/empty/ /tmp/',
	'shred -u /tmp/x',
	'git worktree remove --force C:/elsewhere/wt',
	'New-Item -ItemType Junction -Path C:\\work\\proj_a.b\\l2 -Target C:\\Users; Remove-Item -Recurse -Force C:\\work\\proj_a.b\\l2\\someone',
	'cmd /c mklink /J l3 C:\\Users & rmdir /s /q l3\\someone',
	'ln -s / l4; rm -rf l4/etc',
	'rm -rf .git',
	'Remove-Item -Recurse -Force C:\\work\\proj_a.b\\.git',
	'rm -rf //10.255.255.9/share/x ; rm -rf C:/elsewhere/x',
	// Found by a security review of the sweep's fixes: a read-only command that runs another one.
	"git -c core.pager='rm -rf C:/elsewhere' log",
	'rg --pre "rm -rf C:/elsewhere" x .',
	'git -C C:/elsewhere rm -r build',
	"git grep --open='rm -rf C:/elsewhere' x",
	"git grep -nO'rm -rf C:/elsewhere' x",
	"'C:\\elsewhere' | Get-ChildItem | Remove-Item -Recurse",
	"$env:GIT_PAGER='rm -rf C:/elsewhere'; git log",
	'GIT_EXTERNAL_DIFF=x git diff',
	'GIT_WORK_TREE=C:/elsewhere git rm -r build',
	"git -c core.worktree=C:/elsewhere rm -r build",
	'git rm -- --cached C:/elsewhere',
	"'C:\\elsewhere' | # c" + LF + 'Get-ChildItem | Remove-Item -Recurse',
	'rm -rf build,#x C:/elsewhere',
	'rm -rf build <# x #> C:/elsewhere',
	'rm -rf build > out.txt C:/elsewhere',
	'Get-ChildItem C:/elsewhere | Remove-Item > out.txt',
	"grep x # it's" + LF + 'rm -rf C:/elsewhere',
	"[Environment]::SetEnvironmentVariable('GIT_WORK_TREE', 'C:\\elsewhere'); git rm -r build",
	'rg --hostname-bin "rm -rf C:/elsewhere" x .',
	"git grep --open-files-in-pager='rm -rf C:/elsewhere' x",
	"git grep --open-files-in-pager 'rm -rf C:/elsewhere' x",
	"'C:\\elsewhere' |" + LF + 'Get-ChildItem | Remove-Item -Recurse',
];

// Found by the same sweep: ordinary commands that asked and should not.
const SWEEP_PASS = [
	'Remove-Item -Recurse ' + OWN + '\\*',
	'rm *.o',
	'rm -rf build*',
	'cmd /c rd /s /q build',
	'cmd /c rmdir /s build',
	'erase /s C:\\work\\proj_a.b\\x',
	'cd C:\\elsewhere; rm C:\\work\\proj_a.b\\x',
	'rm -- -x',
	'rm build/a; echo /etc',
	"find . -name '*.o' -delete",
	'cd C:/work/proj_a.b && rm -rf dist',
	'cd "C:/work/proj_a.b" && rm -rf dist',
	'Set-Location C:\\work\\proj_a.b; Remove-Item -Recurse dist',
	'cd build && rm -rf out',
	'git commit -m "docs: say cd to the root" && rm -f out.txt',
	"find . -name '*.md' -exec grep -l guard {} +",
	'find user -type f -exec wc -l {} ;',
	'grep -rn "rm -rf" user/skills',
	'git grep -n Remove-Item',
	'git grep -n "map.delete"',
	'rg -n "rmSync" .',
	'Get-ChildItem dist | Remove-Item -Recurse',
	'Get-ChildItem build | Where-Object { $_.Length -gt 0 } | Remove-Item',
	'git clean -n',
	'git clean -fdX -n',
	'git rm -r --cached .',
	"node -e \"const m=new Map(); m.delete('a')\"",
	'python -c "xs=[1]; xs.remove(1)"',
	'git worktree remove C:/work/proj_a.b/.claude/worktrees/agent-x',
	'git worktree prune',
];

const ASK = [
	...SWEEP_ASK,
	'Remove-Item -Recurse $env:TEMP\\tg-*',
	'Remove-Item -Recurse ' + TEMP + '\\tg-*',
	'rm -rf /tmp/*',
	'Remove-Item -Recurse -Force ' + OTHER,
	'Remove-Item ' + OTHER + '\\scratchpad\\pr-body.md',
	'Remove-Item C:\\elsewhere\\x',
	'Remove-Item -LiteralPath C:\\elsewhere\\x',
	'Remove-Item -Path C:\\elsewhere\\x -Recurse -Force -ErrorAction SilentlyContinue',
	'git clean -fdx',
	'git -C C:/work/proj_a.b clean -fd',
	"node -e \"fs.rmSync(os.tmpdir()+'/x',{recursive:true})\"",
	"node -e \"require('fs').unlinkSync('C:/elsewhere/x')\"",
	'powershell -NoProfile -Command "Remove-Item -Recurse ' + TEMP + '\\tg-*"',
	"bash -c 'rm -rf /tmp/*'",
	'cmd /c rd /s /q C:\\elsewhere',
	'del /s /q C:\\elsewhere\\x',
	'Get-ChildItem ' + TEMP + ' -Filter tg-* | Remove-Item -Recurse',
	'ls | xargs rm -rf',
	'find ' + TEMP.split('\\').join('/') + " -maxdepth 1 -name 'tg-*' -delete",
	'cd C:/elsewhere && find . -delete',
	'find build {C:/elsewhere,x} -delete',
	"find build {C:/elsewhere,x} '-delete'",
	'find build {C:/elsewhere,x} -exec rm -rf {} +',
	'rm -rf ' + OWN + '\\..\\..\\x',
	'Remove-Item -Recurse C:\\work\\proj*',
	'Remove-Item -Recurse ' + OWN + '*',
	'rm -rf C:/work/proj_a.b*',
	'Remove-Item -Path C:\\elsewhere\\x, C:\\work\\proj_a.b\\build',
	'Remove-Item -Recurse ' + KEY_DIR + '\\*',
	'rm -rf ' + PROJECT,
	'cd C:\\elsewhere; rm -rf build',
	'Set-Location C:\\elsewhere' + String.fromCharCode(10) + 'Remove-Item -Recurse build',
	'Remove-Item HKCU:\\Software\\x',
	"[System.IO.Directory]::Delete('C:\\elsewhere', $true)",
	'rm -rf ~/x',
	'"C:/Program Files/Git/usr/bin/rm.exe" -rf C:/elsewhere',
	'rm -rf "$DIR"',
	'rm -rf %TEMP%\\x',
	'ri C:\\elsewhere\\x',
	'erase C:\\elsewhere\\x',
	'rmdir C:\\elsewhere',
	'unlink /tmp/x',
	'sudo rm -rf /var/x',
	'x=1 rm -rf /tmp/x',
	'\\\\server\\share\\x | Remove-Item',
	'Remove-Item \\\\server\\share\\x',
	// Found by a security review of the first build: brace expansion, wrappers with values, .NET calls through a
	// variable, tilde forms and encoded commands.
	'rm -rf C:/work/proj_a.b/build/{x,../../../elsewhere}',
	'rm -rf {C:/elsewhere,x}',
	'rm -rf build {C:/elsewhere,x}',
	'rm -rf build {C:/elsewhere/a..c}',
	"rm -rf build {'C:/else where',x}",
	'rm -rf build {C:/else\\ where,x}',
	'sudo -u root rm -rf /var/x',
	'nice -n 5 rm -rf /tmp/x',
	'timeout 5 rm -rf /tmp/x',
	"Start-Process rm -ArgumentList '-rf', 'C:/elsewhere'",
	'echo rm -rf C:/elsewhere',
	'$d = Get-Item C:\\elsewhere; $d.Delete()',
	"[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('C:\\elsewhere', 'DeleteAllContents')",
	'rm -rf ~other/x',
	'rm -rf ~+/x',
	'powershell -EncodedCommand UgBlAG0AbwB2AGUA',
	'pwsh -enc UgBlAG0AbwB2AGUA',
];

const PASS = [
	...SWEEP_PASS,
	'Remove-Item ' + OWN + '\\scratchpad\\pr-body.md',
	'Remove-Item -Recurse -Force ' + OWN + '\\scratchpad\\*',
	'Remove-Item ' + OWN + '\\scratchpad\\a.md, ' + OWN + '\\scratchpad\\b.md',
	'rm -rf ' + OWN.split('\\').join('/') + '/tasks',
	'rm C:/work/proj_a.b/build/out.txt',
	'rm build/out.txt',
	'rm -rf ./build',
	'rm -f does-not-exist.txt',
	'rm -rf /c/work/proj_a.b/dist',
	'del /q C:\\work\\proj_a.b\\build\\x',
	"find ./build -name '*.o' -delete",
	'rm -rf /tmp/claude/C--work-proj-a-b/' + SESSION_ID + '/scratchpad/x',
	"bash -c 'rm -rf C:/work/proj_a.b/dist'",
	'Remove-Item -Recurse C:\\work\\proj_a.b\\build\\*',
	'git rm --cached src/old.js',
	'git commit -m "rm the old build step"',
	'node .claude/guard-delete-check.cjs',
];

let wrong = 0;
let cases = 0;
// One counted result, right or wrong, printed either way.
const result = (ok, wantAsk, label) => {
	cases++;
	if (!ok) wrong++;
	console.log((ok ? (wantAsk ? 'ask  ' : 'pass ') : wantAsk ? 'MISSED     ' : 'FALSE ASK  ') + label);
};
const check = (label, input, wantAsk, where = WHERE) => {
	cases++;
	const reason = decide(input, where);
	if (Boolean(reason) !== wantAsk) {
		wrong++;
		console.log((wantAsk ? 'MISSED     ' : 'FALSE ASK  ') + label);
	} else {
		console.log((wantAsk ? 'ask  ' : 'pass ') + label);
	}
};
const asSession = (tool, command, extra) => ({ tool_name: tool, session_id: SESSION_ID, cwd: PROJECT, tool_input: { command }, ...extra });

for (const command of ASK) check(command, asSession('Bash', command), true);
for (const command of PASS) check(command, asSession('PowerShell', command), false);
// Other field names are read; the description is only shown, never run.
check('[field "script"] rm -rf /tmp/x', { tool_name: 'Monitor', session_id: SESSION_ID, cwd: PROJECT, tool_input: { script: 'rm -rf /tmp/x' } }, true);
check('[description only] rm -rf /tmp/x', asSession('Bash', 'git status', { tool_input: { command: 'git status', description: 'rm -rf /tmp/x' } }), false);
// Without a usable session id there is no session folder, so a delete in the temp asks.
check('[no session_id] delete in the session folder', asSession('Bash', 'rm -rf ' + OWN + '\\x', { session_id: undefined }), true);
check('[session_id "../.."] delete in the key folder', asSession('Bash', 'rm -rf ' + KEY_DIR + '\\x', { session_id: '../..' }), true);
check('[session_id "x/../.."] delete in another project key', asSession('Bash', 'rm -rf ' + TEMP + '\\claude\\other-proj\\x', { session_id: 'x/../..' }), true);
// The tool's own folder places a relative target, not the project.
check('[cwd C:\\elsewhere] rm build/x', asSession('Bash', 'rm build/x', { cwd: 'C:\\elsewhere' }), true);
// Strings in arrays and nested objects are read; input deeper than the guard reads asks.
check('[array field] rm -rf /tmp/x', asSession('Bash', '', { tool_input: { commands: ['rm -rf /tmp/x'] } }), true);
check('[command plus args array] python -c rmtree', asSession('Bash', '', { tool_input: { command: 'python', args: ['-c', "import shutil; shutil.rmtree('C:/elsewhere')"] } }), true);
check('[nested 6 deep] rm -rf /tmp/x', asSession('Bash', '', { tool_input: { a: { b: { c: { d: { e: { f: 'rm -rf /tmp/x' } } } } } } }), true);
check('[no tool_input] nothing the guard can read', { tool_name: 'Bash', session_id: SESSION_ID, cwd: PROJECT }, true);
// A command too long to read in time asks.
check('[300 KB command] ends in a delete', asSession('Bash', 'echo x '.repeat(50000) + '; rm -rf build'), true);
// A UNC target asks at once: following links on an unreachable host takes longer than the hook's timeout.
const uncStart = Date.now();
// A fresh address each run: Windows caches a failed host, which would hide a stall.
const uncHost = '10.255.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250);
const uncAsks = Boolean(decide(asSession('Bash', 'rm -rf //' + uncHost + '/share/x'), WHERE));
result(uncAsks && Date.now() - uncStart < 2000, true, '[UNC] asks in under 2 s (' + (Date.now() - uncStart) + ' ms)');

// A junction inside the project that points outside it: a delete through it reaches the outside folder.
const real = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-delete-check-'));
try {
	fs.mkdirSync(path.join(real, 'proj'));
	fs.mkdirSync(path.join(real, 'outside'));
	fs.symlinkSync(path.join(real, 'outside'), path.join(real, 'proj', 'link'), 'junction');
	const where = { tmpdir: os.tmpdir(), projectDir: path.join(real, 'proj') };
	const viaLink = { tool_name: 'PowerShell', session_id: SESSION_ID, cwd: where.projectDir, tool_input: { command: 'Remove-Item -Recurse link\\*' } };
	check('[junction] Remove-Item -Recurse link\\* (link -> outside the project)', viaLink, true, where);
	check('[junction] Remove-Item -Recurse link\\newdir\\x (a path below the link that does not exist yet)', { ...viaLink, tool_input: { command: 'Remove-Item -Recurse link\\newdir\\x' } }, true, where);
	check('[junction] rm -rf link/../* (.. after the link, read through it by Git Bash)', { ...viaLink, tool_input: { command: 'rm -rf link/../*' } }, true, where);
	check('[junction] cmd /c rmdir link (removes the link only)', { ...viaLink, tool_input: { command: 'cmd /c rmdir link' } }, false, where);
	check('[junction] Remove-Item -Recurse build\\* (a real folder in the same project)', { ...viaLink, tool_input: { command: 'Remove-Item -Recurse build\\*' } }, false, where);
} finally {
	fs.rmSync(real, { recursive: true, force: true });
}

// End to end: the hook as a child process, fed JSON on stdin, finding the temp and project from its environment.
const env = { ...process.env, TEMP, TMP: TEMP, CLAUDE_PROJECT_DIR: PROJECT };
const runHook = (stdin) => spawnSync(process.execPath, [GUARD], { input: stdin, encoding: 'utf8', env });
const outRun = runHook(JSON.stringify(asSession('PowerShell', 'Remove-Item C:\\elsewhere\\x')));
const outJson = outRun.stdout ? JSON.parse(outRun.stdout) : {};
const outAsks = outRun.status === 0 && outJson.hookSpecificOutput?.hookEventName === 'PreToolUse' && outJson.hookSpecificOutput?.permissionDecision === 'ask';
result(outAsks, true, '[child process] Remove-Item C:\\elsewhere\\x -> ' + outRun.stdout);
const ownRun = runHook(JSON.stringify(asSession('Bash', 'rm -rf ' + OWN + '\\scratchpad\\x')));
result(ownRun.status === 0 && ownRun.stdout === '', false, '[child process] own session folder -> (' + ownRun.stdout.length + ' bytes)');
const brokenRun = runHook('not json');
result(brokenRun.stdout.includes('"ask"'), true, '[child process] stdin not JSON -> asks');

console.log(wrong === 0 ? 'ALL ' + cases + ' CASES RIGHT' : 'Expected all ' + cases + ' right: ' + wrong + ' WRONG');
process.exit(wrong === 0 ? 0 : 1);
