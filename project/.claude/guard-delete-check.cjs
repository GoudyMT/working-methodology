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
const EMSP = String.fromCharCode(0x2003);
const IDSP = String.fromCharCode(0x3000);
const LSQ = String.fromCharCode(0x2018);
const RSQ = String.fromCharCode(0x2019);
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
	'rm -rf \\> C:/elsewhere',
	'rm -rf build >,C:/elsewhere',
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
	'rm -rf dist 2>/dev/null',
	'Remove-Item dist -Recurse *> $null',
];

// Found by the short re-sweep (2026-11-02): forms that still passed, and gaps no case covered.
const RESWEEP_ASK = [
	".venv/Scripts/python -c \"import shutil; shutil.rmtree('C:/elsewhere')\"",
	"\"C:/Program Files/nodejs/node.exe\" -e \"require('fs').rmSync('C:/elsewhere')\"",
	'find C:/elsewhere \\( -name a -o -name b \\) -delete',
	'New-Item -ItemType "Junction" -Path l -Target C:\\Users; Remove-Item -Recurse l\\someone',
	'New-Item -Type Junction -Path l -Target C:\\Users; Remove-Item -Recurse l\\someone',
	'ln --symbolic / l4; rm -rf l4/etc',
	'ln -f -s / l4; rm -rf l4/etc',
	'Get-ChildItem build | ForEach-Object { Join-Path $env:TEMP $_.Name } | Remove-Item -Recurse',
	'Get-ChildItem build | Split-Path -Parent | Remove-Item -Recurse',
	'Get-Item C:\\work\\proj_a.b | Remove-Item -Recurse',
	'gi C:\\elsewhere | Remove-Item -Recurse',
	'gci C:\\elsewhere | ri',
	'cd C:\\elsewhere; cd C:\\work\\proj_a.b\\missing; rm -rf *',
	'cd C:\\elsewhere && (cd C:\\work\\proj_a.b && echo x); rm -rf build',
	'cd C:\\elsewhere || rm -rf build',
	'Push-Location C:\\work\\proj_a.b\\build; Pop-Location; Remove-Item -Recurse x',
	'pushd build && popd && rm -rf x',
	'Invoke-Expression "cd C:\\elsewhere"; Remove-Item -Recurse build',
	'cd ~; rm -rf build',
	'cd -; rm -rf build',
	'rsync -a --del C:/empty/ /tmp/',
	'rsync -a --remove-source-files /tmp/x C:/work/proj_a.b/x',
	'rm -rf D:x',
	'Remove-Item -Recurse C:x',
	'grep "$(rm -rf C:/elsewhere)" x',
	"git -c alias.c='!rm -rf C:/elsewhere' c",
	'git config alias.c "!rm -rf C:/elsewhere"',
	'env -C/ rm -rf x',
	'sudo -DC:/Users rm -rf someone',
	'rm -rf build 2>&1 C:/elsewhere',
	'rm -rf build &>log C:/elsewhere',
	'Remove-Item build 2>&1 C:/elsewhere',
	'rm -rf build >|log C:/elsewhere',
	'git clean -fd node_modules',
	'git --work-tree=C:/elsewhere rm -r build',
	'git --git-dir=C:/elsewhere/.git rm -r build',
	'Remove-Item -Recurse:$true C:\\elsewhere',
	'Remove-Item ' + LSQ + 'C:\\elsewhere\\x' + RSQ,
	'Remove-Item build <# C:\\elsewhere #>',
	'Invoke-Expression "cd $x"; Remove-Item -Recurse build',
	'cd C:\\elsewhere && (cd C:\\work\\proj_a.b) && rm -rf build',
	'cmd /c "cd /d D:\\x & cd C:\\work\\proj_a.b && rd /s /q build"',
	'cd C:\\elsewhere && rm -rf C:\\work\\proj_a.b\\x *>/dev/null',
	// Members of the older lists that no case caught when planted breaks removed them.
	'Get-ChildItem C:\\elsewhere | foreach Delete',
	'find -D tree C:/elsewhere -delete',
	'find -H C:/elsewhere -delete',
	'find -O3 C:/elsewhere -delete',
	'sh`red -u /tmp/x',
	"node -e \"require('fs').symlinkSync('C:/Users','l')\"; rm -rf l/someone",
	"php -r \"unlink('C:/elsewhere/x');\"",
	'perl -MFile::Path -e "remove_tree(q(/tmp/x))"',
	"node -e \"require('fs').rm('C:/elsewhere', {recursive:true}, ()=>{})\"",
	'RIPGREP_CONFIG_PATH=C:/x/rc rg x',
	'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=diff.external GIT_CONFIG_VALUE_0=x git diff',
	"php -r \"@unlink('C:/elsewhere/x');\"",
	'git diff --ext-diff',
	'git log -p --textconv',
	'Remove-Item' + EMSP + 'C:\\elsewhere\\x',
	'Remove-Item' + IDSP + 'C:\\elsewhere\\x',
	"Remove-Item build <# it's #> C:\\elsewhere",
];

const RESWEEP_PASS = [
	'.venv/Scripts/python -m pytest',
	"find . \\( -name '*.o' -o -name '*.tmp' \\) -delete",
	'New-Item -ItemType Directory build; Remove-Item -Recurse build\\x',
	'Get-Item build | Remove-Item -Recurse',
	'gci build -File | ri',
	'cd build && rm -rf out && cd .. && rm -rf dist',
	'Set-Location C:\\work\\proj_a.b; Remove-Item -Recurse dist',
	'rm -rf build 2>&1',
	'rm -rf build &>/dev/null',
	'git clean --dry-run -fd',
	'git clean -fdn',
	'Remove-Item -Recurse:$true build',
	'grep -rn "rm -rf $(pwd)" user/skills',
	'cd C:\\elsewhere && rm -rf C:\\work\\proj_a.b\\x 2>&1',
	'echo x && Get-ChildItem dist | Remove-Item -Recurse',
	"$env:PAGER = 'less'; Get-Content notes.txt",
	'cmd /c "cd /d C:\\work\\proj_a.b && rd /s /q build"',
	'git blame -L "/rm -rf C:/elsewhere/,+5" setup.sh',
	'sls "Remove-Item C:\\elsewhere" *.ps1',
	'findstr /s "rmdir /s C:\\elsewhere" *.cmd',
	// A command of only a redirection once crashed the guard, and a crash blocks the call.
	'rm -rf build; > out.txt',
];

// Found open on the released guard (2026-11-05): an -e that takes the next letters as its pattern, an alias defined
// in the same command, and robocopy moves, which delete the source.
const HOLES_ASK = [
	'git clean -fdx -en',
	'git clean -fden',
	'git clean -fde n',
	'git clean -e -n -fd',
	'git clean -fd --exclude -n',
	'git clean -fd --exclude=-n',
	'git -c alias.zz="clean -fdx" zz',
	"git -c alias.zz='reset --hard' zz",
	'git -c alias.zz=clean zz -fdx',
	'git -c alias.zz="rm -r" zz x',
	'git config alias.zz "clean -fdx"',
	'robocopy a b /MOV',
	'robocopy a b /MOVE',
	'robocopy C:\\work\\proj_a.b\\a C:\\work\\proj_a.b\\b /mov',
];

// Found by the sweep, each run for real: every spelling robocopy takes for a removing switch. // is the form that
// works in Git Bash, where a single / is rewritten as a path; a job file can carry any switch, so it asks unread.
const ROBOCOPY_ASK = [
	'robocopy src dst //MOVE',
	'robocopy src dst //MOV',
	'robocopy src dst //MIR',
	'robocopy src dst //PURGE',
	'robocopy.exe src dst //MOVE',
	'timeout 20 robocopy src dst //MOVE',
	'robocopy src dst "//MOVE"',
	'robocopy src dst -MOVE',
	'robocopy src dst -mov',
	'robocopy src dst -MIR',
	'robocopy src dst -PURGE',
	'robocopy src dst /JOB:x',
	'robocopy /JOB:y',
	'robocopy src dst -JOB:x',
	'cmd /c robocopy/MOVE src dst',
	"$opts=@('/MOVE','/R:1'); robocopy src dst $opts",
	'robocopy src dst $(echo /MOVE)',
	'Start-Process robocopy -ArgumentList "src dst /MOVE" -Wait',
	"node -e \"require('child_process').spawnSync('robocopy',['src','dst','/MOVE'])\"",
	'rob`ocopy src dst /MOVE',
	'robocopy src dst /M`OVE',
	'cmd /c rob^ocopy src dst /MOVE',
	"$x='robocopy src dst /MOVE'; iex $x",
];

// A clean is a dry run only when the last word on it says so and every word came out clean.
const CLEAN_ASK = [
	"Start-Process git -ArgumentList 'clean -fdx'",
	"Start-Process git 'clean -fdx'",
	"saps git 'clean -fdx'",
	"Start-Process git.exe -ArgumentList '-C . clean -fdx'",
	'git clean -n --no-dry-run -fdx',
	'git clean --dry-run --no-dry-run',
	'git clean -nd --no-d',
	'git clean -fdx --exc -n',
	'git clean -fdx --e -n',
	'git clean -fdx --end-of-options . -n',
	'git clean -fd -- -n',
	'git clean -fd -- --dry-run',
	'git clean -fdx --exclude=a,-n',
	'git clean -fdx -e a,-n',
	'git clean -fdx --exclude=x\\ -n',
	'git clean -fdx -e "a\\" -n "',
	'git clean -fdx\r-n',
	'git clean -fdx . \u2013n',
	'E=-e; git clean -fdx $E -n',
	'git clean -fdx -e $null -n',
	'git clean -fdx -e "" -n',
	'git -c x.y=a,b clean -fdx',
	'git --attr-source HEAD clean -fdx',
	'git --shallow-file x clean -fdx',
	'git c\\lean -fdx',
	'git c`lean -fdx',
	'cmd /c git cl^ean -fdx',
	'echo `git clean -fdx`',
	'C=clean; git $C -fdx',
	"$a='clean','-fdx'; git @a",
];

// An alias reads as what git would run, so its quoting and escapes come off first, and a value it cannot read asks.
const RESWEEP2_ASK = [
	"Start-Process git -WorkingDirectory C:\\elsewhere -ArgumentList 'clean -fdx'",
	"Start-Process git -WindowStyle Hidden -ArgumentList 'clean -fdx'",
	"Start-Process -ArgumentList 'clean -fdx' -FilePath git",
	"Start-Process git -WorkingDirectory C:\\elsewhere -ArgumentList 'clean','-fdx'",
	'robocopy src dst /"MIR"',
	'robocopy src dst /M"I"R',
	"robocopy src dst /MI''R",
	'rob"oco"py src dst /MIR',
	'"robo"copy src dst /MOVE',
	'git clean -n \\; . --no-dry-run -fdx',
	'git clean -n \\& . --no-dry-run -fdx',
	'git clean -fdx . a\x0b-n',
	'C=lean; git c$C -fdx',
	'git cl$()ean -fdx',
	'git c$(echo lean) -fdx',
	'git -c alias.zz=!rm.exe\\ -rf\\ C:/elsewhere zz',
	"git clean -fdx -e '' -n",
	'"git" c`lean -fdx',
	'cmd /c "git" cl^ean -fdx',
	'"git" clean -fdx -e a` -n',
	'"git" -c alias.zz=cl`ean zz -fdx',
	'git -c alias.zz="!true;rm -rf x" zz',
	'git -c alias.zz="!(rm -rf x)" zz',
];

const ALIAS_ASK = [
	'git -c alias.zz="worktree remove --force" zz C:/elsewhere/wt',
	'git -c alias.zz=worktree zz remove --force C:/elsewhere/wt',
	'git config alias.zz "worktree remove --force"',
	'V="clean -fdx" git --config-env=alias.zz=V zz',
	'git --config-env alias.zz=V zz',
	'git -c alias.zz=!rm\\ -rf\\ C:/elsewhere zz',
	'git -c alias.zz=clean\\ -fdx zz',
	'git -c alias.zz=cl`ean zz -fdx',
	'git -c "alias.my zz.command=clean -fdx" "my zz"',
	"git -c alias.zz='\"clean\" -fdx' zz",
	"git -c alias.zz='cl\"\"ean -fdx' zz",
	"git -c alias.zz='reset \"--hard\"' zz",
	'V=clean; git -c alias.zz=$V zz -fdx',
	'git -c alias.zz=rm zz x',
	"git -c alias.zz='!rm -rf x' zz",
	'git -c ALIAS.zz=clean zz -fdx',
	'git config ALIAS.zz "clean -fdx"',
	'git -c alias.zz="reset -q --hard" zz',
	"git -c alias.zz='reset --ha' zz",
];

// 1.21.0: the forms the review of the 1.20.0 guard found passing (G1 to G8), each asked before or is a hole.
const REVIEW121_ASK = [
	"robocopy C:/src C:/elsewhere /MIR>nul",
	"robocopy C:/src C:/elsewhere /MIR>C:/work/proj_a.b/log.txt",
	"robocopy C:/src C:/elsewhere /MIR|more",
	"robocopy C:/src C:/elsewhere /PURGE&echo done",
	"robocopy C:/src C:/elsewhere /MOVE<nul",
	"& { robocopy C:/src C:/elsewhere /MIR}",
	"Invoke-Command {robocopy C:/src C:/elsewhere /MIR}",
	"robocopy C:/src C:/elsewhere /MIR/NP",
	"rg x $(robocopy C:/src C:/elsewhere /MIR)",
	"grep x `robocopy C:/src C:/elsewhere /MIR`",
	"git commit -m \"$(robocopy C:/src C:/elsewhere /MIR)\"",
	"rg x <(robocopy C:/src C:/elsewhere /MIR)",
	"C=clean; timeout 5 git $C -fdx",
	"sudo git $C -fdx",
	"env git $C -fdx",
	"nice git $C -fdx",
	"command git $C -fdx",
	"bash -c 'C=clean; git $C -fdx'",
	"echo \"$(git $C -fdx)\"",
	"C=clean; echo \"git $C -fdx\" | sh",
	"Start-Process git -ArgumentList @('clean','-fdx')",
	"Start-Process git @('clean','-fdx')",
	"Start-Process git -ArgumentList ('clean','-fdx')",
	"git c\"lea\"n -fdx -e a\\ -n",
	"git cle'an' -fdx -e a\\ -n",
	"git -C C:/elsewhere c\"lea\"n -fdx -e a\\ -n",
	"git -c a.b` c.d clean -fdx",
	"git -c alias.zz=!/bin/rm\\ -rf\\ C:/elsewhere zz",
	"git -c alias.zz=!sh\\ -c\\ rm\\ -rf\\ C:/elsewhere zz",
	"git -c alias.zz=!xargs\\ rm\\ -rf\\ C:/elsewhere zz",
	"git -c alias.zz=!find\\ /c/elsewhere\\ -delete zz",
	"r\\\nm -rf /tmp/x",
	"find C:/elsewhere -del\\\nete",
	"git cl\\\nean -fdx",
	"echo \"rm -rf C:/elsewhere\" | bash",
	"printf \"rm -rf C:/elsewhere\" > a.sh",
	// Printed text that is then run, with no delete word the printer skip could see (1.21.0 sweep, R1).
	"$(echo \"find C:/elsewhere -delete\")",
	"eval $(echo \"find C:/elsewhere -delete\")",
	"sh -c \"$(echo 'find C:/elsewhere -delete')\"",
	"echo \"find C:/elsewhere -delete\" |& sh",
	"iex (echo '[IO.File]::Delete(\"C:\\elsewhere\\x\")')",
	"$(printf 'git worktree remove --force C:/elsewhere/wt')",
	"echo \"find C:/elsewhere -delete\" > a.sh",
	// The automated review of that fix: a group or a second command around the printer still feeds it on.
	"$(true; echo \"find C:/elsewhere -delete\")",
	"(echo \"find C:/elsewhere -delete\") | sh",
	"{ echo \"find C:/elsewhere -delete\"; } | sh",
	"{ echo \"find C:/elsewhere -delete\"; } > a.sh",
	"echo \"find C:/elsewhere -delete\" |&\nsh",
	"sh -c 'echo \"find C:/elsewhere -delete\"' | sh",
	// xargs adds targets the guard never sees, and -I can change any word (1.21.0 sweep, R2).
	"echo C:/elsewhere | xargs rm -rf build",
	"find C:/elsewhere | xargs rm -rf dist",
	"echo C:/elsewhere | xargs -I_ rm -rf _",
	"echo clean | xargs -Ilog git log -fdx",
	// One harmless delete word must not switch the escape check off; a program can sit in a variable (R3).
	"rm -f build/b1; r\\m -rf C:/elsewhere",
	"git add clean; gi\\t clean -fdx",
	"bash -c rm\\ -rf\\ C:/elsewhere",
	"$'rm' -rf C:/elsewhere",
	"$'\\x72\\x6d' -rf C:/elsewhere",
	"bash -c $'rm -rf C:/elsewhere'",
	"X=rm; $X -rf C:/elsewhere",
	"G=rm; ${G} -rf C:/elsewhere",
	"/usr/bin/r[m].exe -rf C:/elsewhere",
	"$x='Remove-Item'; & $x C:\\elsewhere",
	// cmd glues the path to a builtin with = or a backslash as well as a slash (R4).
	"cmd /c del=C:\\elsewhere\\x",
	"cmd /c \"del=C:\\elsewhere\\x\"",
	"cmd /c rd=C:\\elsewhere",
	"cmd /c rd\\Users\\someone",
	"cmd /c del\\elsewhere\\x",
	"rimraf.cmd C:/elsewhere",
	"rm.bat C:/elsewhere",
	// PowerShell parentheses cut words off the command (R5).
	"git ('clean','-fdx')",
	"git ('clean') -fdx",
	"git (echo clean) -fdx",
	"Remove-Item build,('C:\\elsewhere')",
	"Start-Process -ArgumentList @('clean','-fdx') -FilePath git",
	"$a=@{FilePath='git';ArgumentList='clean -fdx'}; Start-Process @a",
	"findstr x (robocopy C:/src C:/elsewhere /MIR)",
	"rg x (robocopy C:/src C:/elsewhere /MIR)",
	"git log (robocopy C:/src C:/elsewhere /MIR)",
	"(gi C:\\elsewhere\\x).Parent.Delete($true)",
	"(gci C:\\elsewhere)[0].Delete()",
	// Git's routes in other spellings (R6).
	"git -c core.fsmonitor=rm\\ -rf\\ C:/elsewhere status",
	"git -c diff.external=rm\\ -rf\\ C:/elsewhere diff",
	"git -c core.sshCommand=rm\\ -rf\\ C:/elsewhere fetch",
	"git -c credential.helper=!rm\\ -rf\\ C:/elsewhere fetch",
	"$env:HOME='C:\\x'; git zz",
	"$env:XDG_CONFIG_HOME='C:\\x'; git zz",
	"USERPROFILE=C:/x git zz",
	"cmd /c \"git %C% -fdx\"",
	"cmd /c git $C -fdx",
	"winpty git $C -fdx",
	// The sweep's test-value role: real asks with no row until now (T3).
	"git -c includeIf.gitdir:C:/x/.path=C:/x/evil x",
	"XDG_CONFIG_HOME=C:/x git x",
	"nohup git $C -fdx",
	"exec git $C -fdx",
	"time git $C -fdx",
	"rg x >(robocopy C:/src C:/elsewhere /MIR)",
	"git -c \"alias.zz= !/bin/true\" zz",
	"git -c a.b^ c.d clean -fdx",
	// .git and the root in other spellings (R8).
	"rm -rf .g*",
	"rm -rf .gi?",
	"rm -rf .[g]it",
	"Remove-Item -Recurse -Force .gi*",
	"rm -rf GIT~1",
	"cmd /c rd /s /q .git.",
	"find . -delete",
	// A link made in the same command, spelled short, or followed by find (R7).
	"New-Item -ItemType J -Path l -Target C:\\Users; Remove-Item -Recurse l\\someone",
	"New-Item -Type Ju -Path l -Target C:\\Users; Remove-Item -Recurse l\\someone",
	"python -c \"import os; os.symlink('C:/Users','l')\"; rm -rf l/someone",
	"find -L . -name x -delete",
	"find build -follow -name x -delete",
];

// 1.21.0: the guard carry-overs from 1.20.0 (escapes in a nested shell, alias routes, inline code and xargs; git $flags
// log asks because $flags may hold a subcommand).
const CARRY121_ASK = [
	"bash -c \"gi\\t clean -fdx\"",
	"bash -c 'r\\m -rf C:/elsewhere'",
	"git config include.path C:/x/evil.cfg; git x",
	"git -c include.path=C:/x/evil x",
	"git config --rename-section alias foo; git x",
	"HOME=C:/elsewhere git x",
	"GIT_CONFIG_GLOBAL=C:/x/g git x",
	"python -c \"import subprocess; subprocess.run(['git','clean','-fdx'])\"",
	"echo clean | xargs git",
	"echo clean | xargs git -C x",
	"git $flags log",
];

const HOLES_PASS = [
	"git --no-pager log",
	"git --no-pager diff",
	"git ls-files | xargs git add",
	'git clean -nfd -e x',
	'git clean -fd -e build -n',
	'git clean -n -e x',
	'git -c alias.st=status st',
	'git -c alias.lg="log --oneline" lg',
	'robocopy a b /E',
	'robocopy a b /E /XF movie.txt',
	'robocopy a b /E /XD C:\\data\\mover',
	'git clean --no-dry-run -n',
	'git clean -n -- build',
	'git commit -m "clean up the tests"',
	'git -c user.name="a b" status',
	'git -c alias.lg="log --format=%h" lg',
	'git diff HEAD^ HEAD -- tools/clean.mjs',
	'git show HEAD^:scripts/clean.sh',
	'git log feat/clean-up ^main --oneline',
	'git checkout -b clean-up HEAD^',
	"git commit -m 'docs: keep `clean` in the readme'",
	'git commit -m "fix: leave the git tree clean, always"',
	'git commit -m "bump git $ver"',
	'git clean -n; echo $?',
	'git clean -nd && echo "done, ok"',
	'git add clean; echo $?',
	'git checkout clean && echo "on it, ok"',
	'git merge clean -m "merge a, b"',
	'echo "git $VERSION"',
	'echo git @ host',
	'robocopy a b /E /LOG:C:/logs/job.txt',
	'robocopy C:/data/move C:/dest /E',
	'robocopy src/mir out /E',
	'robocopy a b /E /XD node_modules/purge',
	'rg "robocopy /MIR" project/',
	'git log --grep="robocopy /MIR"',
	'ls C:/job; echo robocopy',
	'cat docs/job/notes.md | grep robocopy',
	'git commit -m "docs: robocopy notes in docs/job/readme"',
	'cat docs/robocopy.md src/move/index.js',
	'robocopy a b /XD C:/data/mover',
	'robocopy a b /XF move.txt',
	'git clean -n --exclude=build',
	'git clean -n --force',
	'git clean -n --quiet',
];

const ASK = [
	...SWEEP_ASK,
	...RESWEEP_ASK,
	...HOLES_ASK,
	...ROBOCOPY_ASK,
	...CLEAN_ASK,
	...ALIAS_ASK,
	...RESWEEP2_ASK,
	...REVIEW121_ASK,
	...CARRY121_ASK,
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
	...RESWEEP_PASS,
	...HOLES_PASS,
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
	// Everyday commands the stricter reads must leave alone.
	"$x = 1",
	"$env:KIT_X='1'; node x.mjs",
	"$files = Get-ChildItem build",
	"$p -eq 3",
	"foreach ($f in $files) { node x.mjs }",
	"if ($LASTEXITCODE -ne 0) { exit 1 }",
	"[ -f a.txt ] && node x.mjs",
	"[string]$x = 'a'",
	"git ls-files | xargs git log",
	"HOME=/x npm test",
	"find . -name '*.pyc' -delete",
	"find build -type f -delete",
	"find build -delete",
	"rm -rf .gitignore-old",
	"rm -f build/*.log",
	"rm -rf build/*/x",
	"cat notes.txt",
	"cmd /c dir",
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
// A session's folder is found by its id alone, under any one key: Claude Code moved from the path slug to a hash.
const CLAUDE_TMP = TEMP + '\\claude';
const HEX = CLAUDE_TMP + '\\f76c0d1fad491d01';
const HEX_OWN = HEX + '\\' + SESSION_ID;
const OTHER_ID = '99999999-8888-7777-6666-555555555555';
const del = (target, extra) => asSession('Bash', 'rm -rf ' + target, extra);
check('[hex key] own session folder', del(HEX_OWN + '\\scratchpad\\x'), false);
check('[hex key] own session folder, forward slashes', del(HEX_OWN.split('\\').join('/') + '/scratchpad/x'), false);
check('[hex key] own session folder, /tmp spelling', del('/tmp/claude/f76c0d1fad491d01/' + SESSION_ID + '/scratchpad/x'), false);
check('[hex key] own session folder, PowerShell', asSession('PowerShell', 'Remove-Item -Recurse ' + HEX_OWN + '\\scratchpad'), false);
check('[hex key] wildcard in the own session folder', del(HEX_OWN + '\\*'), false);
check('[slug key] own session folder still passes', del(OWN + '\\scratchpad\\x'), false);
check('[hex key] another session', del(HEX + '\\' + OTHER_ID + '\\x'), true);
check('[hex key] the key folder', del(HEX + '\\x'), true);
check('[hex key] the session folder itself', del(HEX_OWN), true);
check('[hex key] wildcard in the key folder', del(HEX + '\\*'), true);
check('[layout] shallower: the id right under claude', del(CLAUDE_TMP + '\\' + SESSION_ID + '\\x'), true);
check('[layout] deeper: two folders before the id', del(HEX + '\\sub\\' + SESSION_ID + '\\x'), true);
check('[layout] deeper: the id under another session', del(HEX + '\\' + OTHER_ID + '\\' + SESSION_ID + '\\x'), true);
check('[layout] a wildcard for the key', del(CLAUDE_TMP + '\\*\\' + SESSION_ID + '\\x'), true);
check('[layout] the id under the temp, not temp/claude', del(TEMP + '\\f76c0d1fad491d01\\' + SESSION_ID + '\\x'), true);
check('[layout] the id right under the temp, one level above claude', del(TEMP + '\\' + SESSION_ID + '\\x'), true);
check('[layout] the id right under another drive', del('C:\\' + SESSION_ID + '\\x'), true);
check('[layout] another folder named claude', del('C:\\other\\claude\\f76c0d1fad491d01\\' + SESSION_ID + '\\x'), true);
check('[..] out of the own folder into another session', del(HEX_OWN + '\\..\\' + OTHER_ID + '\\x'), true);
check('[..] out of the own folder into the key folder', del(HEX_OWN + '\\..\\x'), true);
check('[..] out of claude and back to the temp', del(CLAUDE_TMP + '\\..\\f76c0d1fad491d01\\' + SESSION_ID + '\\x'), true);
check('[id] a folder the id is a prefix of', del(HEX + '\\' + SESSION_ID + '0\\x'), true);
check('[id] a folder the id is a suffix of', del(HEX + '\\0' + SESSION_ID + '\\x'), true);
check('[id] a wildcard after the id, which matches longer names', del(HEX + '\\' + SESSION_ID + '*'), true);
check('[id] a wildcard inside the id', del(HEX + '\\1111*\\x'), true);
check('[id] a folder that is a prefix of the id', del(HEX + '\\' + SESSION_ID.slice(0, 8) + '\\x'), true);
check('[id] a trailing dot, the same folder to Windows', del(HEX + '\\' + SESSION_ID + '.\\x'), true);
const LETTER_ID = 'abcdef12-3456-7890-abcd-ef1234567890';
check('[id] own id with letters', del(HEX + '\\' + LETTER_ID + '\\x', { session_id: LETTER_ID }), false);
check('[id] own id in another case', del(HEX + '\\' + LETTER_ID.toUpperCase() + '\\x', { session_id: LETTER_ID }), true);
check('[id] empty session id', del(HEX + '\\x', { session_id: '' }), true);
check('[id] empty session id, doubled slash', del(HEX + '\\\\x', { session_id: '' }), true);
check('[id] missing session id', del(HEX_OWN + '\\x', { session_id: undefined }), true);
check('[id] a word for a session id matches no folder', del(HEX + '\\x\\y', { session_id: 'x' }), true);
check('[id] a word for a session id, the old slug place', del(KEY_DIR + '\\x\\y', { session_id: 'x' }), true);
// The tool's own folder places a relative target, not the project.
check('[cwd C:\\elsewhere] rm build/x', asSession('Bash', 'rm build/x', { cwd: 'C:\\elsewhere' }), true);
// A cd is trusted only when it leads its command and comes before &&.
check('[cwd C:\\elsewhere] cd C:\\work\\proj_a.b && rm -rf dist', asSession('Bash', 'cd C:\\work\\proj_a.b && rm -rf dist', { cwd: 'C:\\elsewhere' }), false);
check('[cwd C:\\elsewhere] echo cd C:\\work\\proj_a.b && rm -rf dist', asSession('Bash', 'echo cd C:\\work\\proj_a.b && rm -rf dist', { cwd: 'C:\\elsewhere' }), true);
check('[cwd C:\\elsewhere] cd C:\\work\\proj_a.b; rm -rf dist', asSession('Bash', 'cd C:\\work\\proj_a.b; rm -rf dist', { cwd: 'C:\\elsewhere' }), true);
// After ; or || the next command runs even when the cd before && failed.
check('[cwd C:\\elsewhere] cd C:\\work\\proj_a.b && echo y; rm -rf dist', asSession('Bash', 'cd C:\\work\\proj_a.b && echo y; rm -rf dist', { cwd: 'C:\\elsewhere' }), true);
check('[cwd C:\\elsewhere] cd C:\\work\\proj_a.b && echo y || rm -rf dist', asSession('Bash', 'cd C:\\work\\proj_a.b && echo y || rm -rf dist', { cwd: 'C:\\elsewhere' }), true);
check('[cwd C:\\elsewhere] cd C:\\work\\proj_a.b && cd build && echo y; rm -rf x', asSession('Bash', 'cd C:\\work\\proj_a.b && cd build && echo y; rm -rf x', { cwd: 'C:\\elsewhere' }), true);
check('[cwd C:\\elsewhere] (echo a; cd C:\\work\\proj_a.b && true) && rm -rf build', asSession('Bash', '(echo a; cd C:\\work\\proj_a.b && true) && rm -rf build', { cwd: 'C:\\elsewhere' }), true);
check('[cwd C:\\elsewhere] cd C:\\work\\proj_a.b && grep x y; rm -rf dist', asSession('Bash', 'cd C:\\work\\proj_a.b && grep x y; rm -rf dist', { cwd: 'C:\\elsewhere' }), true);
check('[cwd C:\\elsewhere] (cd C:\\work\\proj_a.b && grep x y) && rm -rf dist', asSession('Bash', '(cd C:\\work\\proj_a.b && grep x y) && rm -rf dist', { cwd: 'C:\\elsewhere' }), true);
check('[cwd C:\\elsewhere] true ||<LF>cd C:\\work\\proj_a.b && rm -rf dist', asSession('Bash', 'true ||' + LF + 'cd C:\\work\\proj_a.b && rm -rf dist', { cwd: 'C:\\elsewhere' }), true);
check('[cwd C:\\elsewhere] cd C:\\work\\proj_a.b &&<LF>rm -rf dist', asSession('Bash', 'cd C:\\work\\proj_a.b &&' + LF + 'rm -rf dist', { cwd: 'C:\\elsewhere' }), false);
check('cmd /c "cd/d C:\\elsewhere && rd /s /q build"', asSession('Bash', 'cmd /c "cd/d C:\\elsewhere && rd /s /q build"'), true);
check('cmd /c "cd.. && rd /s /q build"', asSession('Bash', 'cmd /c "cd.. && rd /s /q build"'), true);
check('cmd /c "cd=C:\\elsewhere && rd /s /q build"', asSession('Bash', 'cmd /c "cd=C:\\elsewhere && rd /s /q build"'), true);
check('[cwd C:\\elsewhere] grep "$(cd C:\\work\\proj_a.b && echo)" x && rm -rf dist', asSession('Bash', 'grep "$(cd C:\\work\\proj_a.b && echo)" x && rm -rf dist', { cwd: 'C:\\elsewhere' }), true);
check('[cwd C:\\elsewhere] bash -c "cd C:\\work\\proj_a.b && echo" && rm -rf dist', asSession('Bash', 'bash -c "cd C:\\work\\proj_a.b && echo" && rm -rf dist', { cwd: 'C:\\elsewhere' }), true);
check('Invoke-Expression "cd C:\\elsewhere; cd C:\\work\\proj_a.b\\missing && echo"; Remove-Item -Recurse build', asSession('PowerShell', 'Invoke-Expression "cd C:\\elsewhere; cd C:\\work\\proj_a.b\\missing && echo"; Remove-Item -Recurse build'), true);
check('cmd /c cd"C:\\elsewhere" & rd /s /q build', asSession('Bash', 'cmd /c cd"C:\\elsewhere" & rd /s /q build'), true);
check('cmd /c cd@C:\\elsewhere & rd /s /q build', asSession('Bash', 'cmd /c cd@C:\\elsewhere & rd /s /q build'), true);
check('cmd /c "chdir+C:\\elsewhere && rd /s /q build"', asSession('Bash', 'cmd /c "chdir+C:\\elsewhere && rd /s /q build"'), true);
check('[cwd C:\\elsewhere] false || cd C:\\work\\proj_a.b && rm -rf dist', asSession('Bash', 'false || cd C:\\work\\proj_a.b && rm -rf dist', { cwd: 'C:\\elsewhere' }), true);
check('[cwd C:\\elsewhere] echo x | cd C:\\work\\proj_a.b && rm -rf dist', asSession('Bash', 'echo x | cd C:\\work\\proj_a.b && rm -rf dist', { cwd: 'C:\\elsewhere' }), true);
check('[cwd C:\\elsewhere] cd C:\\work\\proj_a.b && rm -rf build && rm -rf dist', asSession('Bash', 'cd C:\\work\\proj_a.b && rm -rf build && rm -rf dist', { cwd: 'C:\\elsewhere' }), false);
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
	check('[junction] cmd /c rmdir /s /q link (a recursive rmdir follows the link)', { ...viaLink, tool_input: { command: 'cmd /c rmdir /s /q link' } }, true, where);
	check('[junction] rmdir -Recurse link (rmdir is Remove-Item in PowerShell)', { ...viaLink, tool_input: { command: 'rmdir -Recurse link' } }, true, where);
	check('[junction] rmdir -Recurse:$true link', { ...viaLink, tool_input: { command: 'rmdir -Recurse:$true link' } }, true, where);
	check('[junction] cmd /c rd/s/q link (a switch glued to rd)', { ...viaLink, tool_input: { command: 'cmd /c rd/s/q link' } }, true, where);
	// A link any level below a wildcard: the shell walks through it, so the scan goes as deep as the pattern does.
	fs.mkdirSync(path.join(real, 'proj', 'deep', 'one'), { recursive: true });
	fs.symlinkSync(path.join(real, 'outside'), path.join(real, 'proj', 'deep', 'one', 'hop'), 'junction');
	check('[junction] rm -rf deep/*/*/x (a link two levels below the wildcard)', { ...viaLink, tool_input: { command: 'rm -rf deep/*/*/x' } }, true, where);
	check('[junction] rm -rf deep/**/x (a pattern of any depth)', { ...viaLink, tool_input: { command: 'rm -rf deep/**/x' } }, true, where);
	check('[junction] rm -rf deep/*/x (no link on the way of this pattern)', { ...viaLink, tool_input: { command: 'rm -rf deep/*/x' } }, false, where);
	// A link to a folder deep inside the project: PowerShell reads ".." as written, so inner\..\..\x is outside.
	fs.mkdirSync(path.join(real, 'proj', 'a', 'b'), { recursive: true });
	fs.symlinkSync(path.join(real, 'proj', 'a', 'b'), path.join(real, 'proj', 'inner'), 'junction');
	check('[junction] Remove-Item inner\\..\\..\\x (outside as written, inside through the link)', { ...viaLink, tool_input: { command: 'Remove-Item inner\\..\\..\\x' } }, true, where);
	check('[junction] Remove-Item inner\\..\\x (inside both ways)', { ...viaLink, tool_input: { command: 'Remove-Item inner\\..\\x' } }, false, where);
	// Links on the way to a session folder: what counts is where the path lands, read after them.
	const temp = path.join(real, 'temp');
	const tempWhere = { tmpdir: temp, projectDir: path.join(real, 'proj') };
	const own = path.join(temp, 'claude', 'f76c0d1fad491d01', SESSION_ID);
	fs.mkdirSync(path.join(own, 'scratchpad'), { recursive: true });
	fs.mkdirSync(path.join(real, 'outside', SESSION_ID), { recursive: true });
	fs.symlinkSync(path.join(real, 'outside'), path.join(temp, 'claude', 'key-link'), 'junction');
	fs.symlinkSync(path.join(real, 'outside'), path.join(own, 'out'), 'junction');
	fs.mkdirSync(path.join(temp, 'claude', 'other-key'));
	fs.symlinkSync(path.join(real, 'outside'), path.join(temp, 'claude', 'other-key', SESSION_ID), 'junction');
	const inTemp = (target) => ({ tool_name: 'Bash', session_id: SESSION_ID, cwd: tempWhere.projectDir, tool_input: { command: 'rm -rf "' + target.split(path.sep).join('/') + '"' } });
	check('[junction] the real own session folder', inTemp(path.join(own, 'scratchpad', 'x')), false, tempWhere);
	check('[junction] the key is a link out of claude', inTemp(path.join(temp, 'claude', 'key-link', SESSION_ID, 'x')), true, tempWhere);
	check('[junction] the id folder is a link out of claude', inTemp(path.join(temp, 'claude', 'other-key', SESSION_ID, 'x')), true, tempWhere);
	check('[junction] a link inside the own folder', inTemp(path.join(own, 'out', 'x')), true, tempWhere);
	// A wildcard ends what can be read of a path, so a link beside it asks (1.21.0 sweep, R7).
	check('[junction] a wildcard that may walk through a link in the own folder', inTemp(path.join(own, 'ou*', 'x')), true, tempWhere);
	check('[junction] a wildcard that may walk through a link in the project', { ...viaLink, tool_input: { command: 'rm -rf li*/x' } }, true, where);
	check('[junction] ./*/x beside a link', { ...viaLink, tool_input: { command: 'rm -rf ./*/x' } }, true, where);
	check('[junction] a wildcard with nothing after it stays in its folder', inTemp(path.join(own, 'scratchpad', '*')), false, tempWhere);
	check('[junction] a wildcard in a folder with no link', inTemp(path.join(own, 'scratchpad', '*', 'x')), false, tempWhere);
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
const hexRun = runHook(JSON.stringify(asSession('Bash', 'rm -rf ' + HEX_OWN + '\\scratchpad\\x')));
result(hexRun.status === 0 && hexRun.stdout === '', false, '[child process] own session folder under a hex key -> (' + hexRun.stdout.length + ' bytes)');
const brokenRun = runHook('not json');
result(brokenRun.stdout.includes('"ask"'), true, '[child process] stdin not JSON -> asks');

console.log(wrong === 0 ? 'ALL ' + cases + ' CASES RIGHT' : 'Expected all ' + cases + ' right: ' + wrong + ' WRONG');
process.exit(wrong === 0 ? 0 : 1);
