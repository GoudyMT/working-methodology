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

const ASK = [
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
	'git status',
	'git rm --cached src/old.js',
	'git commit -m "rm the old build step"',
	'Get-ChildItem $env:TEMP',
	'node .claude/guard-delete-check.cjs',
];

let wrong = 0;
const check = (label, input, wantAsk) => {
	const reason = decide(input, WHERE);
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

// A junction inside the project that points outside it: a delete through it reaches the outside folder.
const real = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-delete-check-'));
try {
	fs.mkdirSync(path.join(real, 'proj'));
	fs.mkdirSync(path.join(real, 'outside'));
	fs.symlinkSync(path.join(real, 'outside'), path.join(real, 'proj', 'link'), 'junction');
	const where = { tmpdir: os.tmpdir(), projectDir: path.join(real, 'proj') };
	const viaLink = { tool_name: 'PowerShell', session_id: SESSION_ID, cwd: where.projectDir, tool_input: { command: 'Remove-Item -Recurse link\\*' } };
	const linkAsks = Boolean(decide(viaLink, where));
	console.log((linkAsks ? 'ask  ' : 'MISSED     ') + '[junction] Remove-Item -Recurse link\\* (link -> outside the project)');
	if (!linkAsks) wrong++;
	const plain = { ...viaLink, tool_input: { command: 'Remove-Item -Recurse build\\*' } };
	const plainQuiet = !decide(plain, where);
	console.log((plainQuiet ? 'pass ' : 'FALSE ASK  ') + '[junction] Remove-Item -Recurse build\\* (a real folder in the same project)');
	if (!plainQuiet) wrong++;
} finally {
	fs.rmSync(real, { recursive: true, force: true });
}

// End to end: the hook as a child process, fed JSON on stdin, finding the temp and project from its environment.
const env = { ...process.env, TEMP, TMP: TEMP, CLAUDE_PROJECT_DIR: PROJECT };
const runHook = (stdin) => spawnSync(process.execPath, [GUARD], { input: stdin, encoding: 'utf8', env });
const outRun = runHook(JSON.stringify(asSession('PowerShell', 'Remove-Item C:\\elsewhere\\x')));
const outJson = outRun.stdout ? JSON.parse(outRun.stdout) : {};
const outAsks = outRun.status === 0 && outJson.hookSpecificOutput?.permissionDecision === 'ask';
console.log((outAsks ? 'ask  ' : 'MISSED     ') + '[child process] Remove-Item C:\\elsewhere\\x -> ' + outRun.stdout);
if (!outAsks) wrong++;
const ownRun = runHook(JSON.stringify(asSession('Bash', 'rm -rf ' + OWN + '\\scratchpad\\x')));
const ownQuiet = ownRun.status === 0 && ownRun.stdout === '';
console.log((ownQuiet ? 'pass ' : 'FALSE ASK  ') + '[child process] own session folder -> (' + ownRun.stdout.length + ' bytes)');
if (!ownQuiet) wrong++;
const brokenRun = runHook('not json');
const brokenAsks = brokenRun.stdout.includes('"ask"');
console.log((brokenAsks ? 'ask  ' : 'MISSED     ') + '[child process] stdin not JSON -> asks');
if (!brokenAsks) wrong++;

const total = ASK.length + PASS.length + 9;
console.log(wrong === 0 ? 'ALL ' + total + ' CASES RIGHT' : 'Expected all ' + total + ' right: ' + wrong + ' WRONG');
process.exit(wrong === 0 ? 0 : 1);
