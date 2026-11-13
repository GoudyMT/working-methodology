// Tests for the owner-proof guard (project/.claude/owner-proof.cjs, E27): the owner's thread yes is read from the
// session transcripts and kit-owner.json, so no tool call may write them.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const HOOK = path.resolve('project/.claude/owner-proof.cjs');
const cfg = kitTemp.makeTemp('cfg-');
const run = (tool_name, tool_input, cwd = process.cwd()) => {
	const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name, tool_input, cwd }), encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cfg } });
	// A crash is no answer: onFailure block turns it into a block, so it never counts as an allow.
	assert.equal(r.status, 0, `the guard crashed: ${r.stderr}`);
	return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : 'allow';
};
const T = path.join(cfg, 'projects', 'C--repo', 's.jsonl');

// why: guards rule:outward-acts
test('the owner-proof guard refuses every tool write to the session transcripts and kit-owner.json', { windows: 'also' }, () => {
	const deny = [
		['Write', { file_path: T, content: 'x' }],
		['Edit', { file_path: T, old_string: 'a', new_string: 'b' }],
		['Write', { file_path: path.join(cfg, 'kit-owner.json'), content: '{}' }],
		['Edit', { file_path: path.join(cfg, 'Projects', 'C--repo', 's.jsonl'), old_string: 'a', new_string: 'b' }],
		['NotebookEdit', { notebook_path: path.join(cfg, 'projects', 'x.ipynb'), new_source: 'x' }],
		['Bash', { command: 'echo x >> ~/.claude/projects/C--repo/s.jsonl' }],
		['Bash', { command: 'cp a.jsonl ~/.CLAUDE/Projects/C--repo/' }],
		['Bash', { command: 'mv a.jsonl "$HOME/.claude/projects/C--repo/s.jsonl"' }],
		['Bash', { command: 'cd ~/.claude/projects/C--repo && printf x > s.jsonl' }],
		['Bash', { command: 'node -e "require(\'fs\').appendFileSync(process.env.HOME + \'/.claude/projects/p/s.jsonl\', \'x\')"' }],
		['Bash', { command: 'tee -a ~/.claude/pro\\jects/p/s.jsonl < x' }],
		['Bash', { command: 'echo {} > ~/.claude/kit-owner.json' }],
		['Bash', { command: `sed -i s/a/b/ ${T.split(path.sep).join('/')}` }],
		['PowerShell', { command: 'Add-Content "$HOME\\.claude\\projects\\p\\s.jsonl" x' }],
		['PowerShell', { command: 'Set-Content -Path $env:USERPROFILE\\.claude\\kit-owner.json -Value "{}"' }],
		['PowerShell', { command: 'Copy-Item a.jsonl $env:USERPROFILE\\.CLAUDE\\Projects\\p\\' }],
		['Bash', { command: 'cp ~/.claude/projects/p/memory/a.md ~/.claude/projects/p/s.jsonl' }],
		['Bash', { command: 'echo x >> ~/.claude/projects/p/memory/../s.jsonl' }],
		['Write', { file_path: path.join(cfg, 'projects', 'p', 'memory', '..', 's.jsonl'), content: 'x' }],
		['Bash', { command: 'rg --pre ./w.sh x ~/.claude/projects/p/s.jsonl' }],
		// The 1.23.0 sweep: other spellings of the same folder, read by the shell as it.
		['Bash', { command: 'echo hi >> ~/.claude/./projects/A/s.jsonl' }],
		['Bash', { command: 'echo hi >> ~/.claude//projects/A/s.jsonl' }],
		['Bash', { command: 'echo hi >> ~/.claude/project[s]/A/s.jsonl' }],
		['Bash', { command: 'echo hi >> ~/.claude/proj*/A/s.jsonl' }],
		['Bash', { command: 'echo hi >> $USERPROFILE/CLAUDE~1/projects/A/s.jsonl' }],
		['Bash', { command: 'cd ~/.claude && echo hi >> projects/A/s.jsonl' }],
		['PowerShell', { command: 'Set-Location $HOME\\.claude; Add-Content projects\\A\\s.jsonl x' }],
		['Bash', { command: 'cp x.jsonl ~/.claude/./projects/C--repo/forged.jsonl' }],
		['Bash', { command: 'echo {} > ~/.claude/kit-owne?.json' }],
		['PowerShell', { command: 'Add-Content "$HOME\\.claude\\.\\projects\\p\\s.jsonl" x' }],
		['Bash', { command: 'cp a.jsonl b.jsonl ~/.claude/projects/p/' }],
		['Bash', { command: 'find ~/.claude/projects -name x -delete' }],
		// The shell's folder is followed through every cd, and one it cannot read is the safe side.
		['Bash', { command: 'cd ~ && cd .claude && echo hi >> projects/A/s.jsonl' }],
		['Bash', { command: 'cd ~/.claude/x && cd .. && echo hi >> projects/A/s.jsonl' }],
		// S23-1: a ~ form the guard does not follow (~-, ~+, ~2) leaves the folder unknown.
		['Bash', { command: 'cd ~- && echo x > projects/p/s.jsonl' }],
		// S23-1: a variable set in the command and glued to the rest of the path (F6).
		['Bash', { command: 'P=~/.cla; echo x > ${P}ude/projects/x/s.jsonl' }],
		// The mutation check: an expansion with an operator is not read ahead, and past 32 readings it fails closed.
		['Bash', { command: 'P=~/.cla; echo x > ${P:-y}ude/projects/x/s.jsonl' }],
		['Bash', { command: 'A=1; A=2; A=3; A=4; A=5; A=6; B=1; B=2; B=3; B=4; B=5; B=6; echo $A$B > out.txt' }],
		['Bash', { command: 'cd $(echo ~/.claude) && echo hi >> projects/A/s.jsonl' }],
		['PowerShell', { command: 'Set-Location -Path $HOME\\.claude; Add-Content projects\\A\\s.jsonl x' }],
		// A cd in a subshell, a pipeline or the background, or a popd, leaves the folder unknown: the safe side.
		['Bash', { command: 'cd ~/.claude && (cd /tmp) && echo hi >> projects/A/s.jsonl' }],
		['Bash', { command: 'cd ~/.claude && cd /tmp | true && echo hi >> projects/A/s.jsonl' }],
		['Bash', { command: 'pushd ~/.claude && pushd /tmp && popd && echo hi >> projects/A/s.jsonl' }],
		// A copy with an option that may name its destination, or a destination inside.
		['Bash', { command: 'cp --ta=~/.claude/projects/p x.jsonl' }],
		['Bash', { command: 'cp --t ~/.claude/projects/p x.jsonl' }],
		['PowerShell', { command: 'Copy-Item x.jsonl -De $HOME\\.claude\\projects\\p\\s.jsonl' }],
		['Bash', { command: 'cp -t ~/.claude/projects/p x.jsonl' }],
		['Bash', { command: 'cp -rt ~/.claude/projects/p x.jsonl' }],
		['PowerShell', { command: 'Copy-Item -Dest $HOME\\.claude\\projects\\p\\s.jsonl -Path x.jsonl' }],
		// A message is only the value right after its flag; a redirect is never one.
		['Bash', { command: 'git log "a b" > "~/.claude/projects/p/s.jsonl x"' }],
		['Bash', { command: 'git commit -F "~/.claude/projects/p/s .jsonl"' }],
		// A read piped on goes only into another reader.
		['Bash', { command: 'cat ~/.claude/projects/p/s.jsonl | tee ~/x' }],
	];
	for (const [tool, input] of deny) assert.equal(run(tool, input), 'deny', `${tool} ${JSON.stringify(input)}`);
	// A session whose own folder is the Claude folder: a relative word is read from there.
	assert.equal(run('Bash', { command: 'echo hi >> projects/A/s.jsonl' }, cfg), 'deny', 'from the Claude folder itself');
	assert.equal(run('Bash', { command: 'echo hi >> notes.txt' }, cfg), 'allow', 'another file there');
	// A cd in a group opened first, after ||, or piped with |& does not move the shell the next command runs in.
	// A cd that may fail, and a move through the stack or history, leave the folder unknown too.
	for (const command of ['cd /nowhere && true || echo hi >> projects/A/s.jsonl', 'pushd -n /tmp && echo hi >> projects/A/s.jsonl', 'cd ~- && echo hi >> projects/A/s.jsonl', 'cd /nowhere ; echo hi >> projects/A/s.jsonl','cd /tmp && cd - && echo hi >> projects/A/s.jsonl', 'pushd /tmp && pushd +1 && echo hi >> projects/A/s.jsonl', '(cd /tmp) ; echo hi >> projects/A/s.jsonl','cd /tmp || true ; echo hi >> projects/A/s.jsonl', 'cd /tmp |& cat ; echo hi >> projects/A/s.jsonl']) {
		assert.equal(run('Bash', { command }, cfg), 'deny', command);
	}
	// PowerShell takes a parameter's start, and some take a value: a copy with one is refused rather than guessed.
	assert.equal(run('PowerShell', { command: 'Copy-Item -Pa x.jsonl -Fi y $HOME\\.claude\\projects\\p\\s.jsonl' }), 'deny', 'a PowerShell copy with parameters');
	// Another name for the same folder (a junction, a short name) reaches the same files.
	fs.mkdirSync(path.join(cfg, 'projects', 'C--repo'), { recursive: true });
	const link = path.join(kitTemp.makeTemp('link-'), 'p');
	fs.symlinkSync(path.join(cfg, 'projects'), link, 'junction');
	assert.equal(run('Write', { file_path: path.join(link, 'C--repo', 's.jsonl'), content: 'x' }), 'deny', 'through a junction');
	// A link to a project folder not made yet still points inside.
	const dangling = path.join(kitTemp.makeTemp('link-'), 'd');
	fs.symlinkSync(path.join(cfg, 'projects', 'C--new'), dangling, 'junction');
	assert.equal(run('Write', { file_path: path.join(dangling, 's.jsonl'), content: 'x' }), 'deny', 'through a link whose target is not there yet');
});

// why: guards rule:outward-acts
test('the owner-proof guard lets reads of the transcripts through, and every other write', () => {
	const allow = [
		['Write', { file_path: path.resolve('notes.txt'), content: 'x' }],
		['Edit', { file_path: path.join(cfg, 'settings-notes.md'), old_string: 'a', new_string: 'b' }],
		['Bash', { command: 'cat ~/.claude/projects/C--repo/s.jsonl' }],
		['Bash', { command: 'grep -c owner ~/.claude/projects/C--repo/s.jsonl' }],
		['Bash', { command: 'ls ~/.claude/projects' }],
		['PowerShell', { command: 'Get-Content "$HOME\\.claude\\kit-owner.json"' }],
		['Bash', { command: 'git status' }],
		// S23-1: a read through a quoted variable passes (the sequential reader's flip survived without it).
		['Bash', { command: 'P="~/.claude/projects"; grep x $P/p/s.jsonl' }],
		// The mutation check: a set variable used in braces is read ahead as its value.
		['Bash', { command: 'P=/tmp/x; cat ${P}/a.txt' }],
		// S23-1: a word written from the root is not read from the folder the shell starts in, a .claude folder here.
		['Bash', { command: 'echo x > /tmp/a.cjs' }, path.join(cfg, 'repo', '.claude', 'agents')],
		['Bash', { command: 'node approve.mjs c.json --owner-yes "yes" --thread cmsg_Abcdefgh12' }],
		['Read', { file_path: T }],
		// The auto memory lives beside the transcripts, and sessions write it.
		['Write', { file_path: path.join(cfg, 'projects', 'C--repo', 'memory', 'MEMORY.md'), content: 'x' }],
		['Edit', { file_path: path.join(cfg, 'projects', 'C--repo', 'memory', 'notes.md'), old_string: 'a', new_string: 'b' }],
		['Bash', { command: 'echo x >> ~/.claude/projects/C--repo/memory/notes.md' }],
		// The 1.23.0 sweep: a message that only names the file, and reads that copy a transcript out.
		['Bash', { command: 'git commit -m "docs: say the owner writes kit-owner.json"' }],
		['PowerShell', { command: 'git commit -m "the thread yes reads ~/.claude/projects"' }],
		['Bash', { command: 'gh pr create --title x --body "The thread yes reads kit-owner.json"' }],
		['Bash', { command: 'cp ~/.claude/projects/p/s.jsonl /tmp/x.jsonl' }],
		['PowerShell', { command: 'Copy-Item $HOME\\.claude\\projects\\p\\s.jsonl $env:TEMP\\x.jsonl' }],
		['PowerShell', { command: 'Get-Item "$HOME\\.claude\\projects\\p\\s.jsonl"' }],
		['Bash', { command: 'jq -c .type ~/.claude/projects/p/s.jsonl' }],
		['Bash', { command: 'cd ~/.claude && git status' }],
		['Bash', { command: 'grep -h cmsg_ ~/.claude/projects/p/s.jsonl | sort | uniq -c' }],
		['PowerShell', { command: 'Get-Content $HOME\\.claude\\projects\\p\\s.jsonl | ConvertFrom-Json | Select-Object type' }],
		['Bash', { command: 'cd src && echo x > out.txt' }],
	];
	for (const [tool, input, cwd] of allow) assert.equal(run(tool, input, cwd), 'allow', `${tool} ${JSON.stringify(input)}`);
});

// S23-2 (the 1.23.0 verify): reads through a variable or after a cd into the transcripts, and a file whose text only
// names kit-owner.json, were refused. S23-1: the mutation check found writes no test covered.
// why: guards rule:outward-acts
test('the owner-proof guard follows a variable and a cd into the transcripts, and holds a heredoc that names the file of the owner', () => {
	const deny = [
		['Bash', { command: 'P=~/.claude/projects; echo x >> $P/p/s.jsonl' }],
		['Bash', { command: 'P=~/.claude/projects/p; cp x.jsonl ${P}/s.jsonl' }],
		['Bash', { command: 'cd ~/.claude/projects/p && touch s.jsonl' }],
		['Bash', { command: 'cd ~/.claude/projects/p && forge' }],
		['Bash', { command: 'cd ~/.claude/projects/p; touch s.jsonl' }],
		['Bash', { command: 'echo {} > $CFG/kit-owner.json' }],
		['PowerShell', { command: 'Set-Content $env:CFG\\kit-owner.json "{}"' }],
		['Bash', { command: "cat > ~/.claude/projects/p/s.jsonl <<'EOF'\nx\nEOF" }],
		['Bash', { command: "cat <<'EOF' | bash\necho x >> ~/.claude/projects/p/s.jsonl\nEOF" }],
		['Bash', { command: 'cat <<EOF > notes.md\n$(echo x >> ~/.claude/projects/p/s.jsonl)\nEOF' }],
		['PowerShell', { command: 'cp -n ~/.claude/projects/p/s.jsonl ./out.txt' }],
		// The 1.24.0 sweep: an end mark bash reads otherwise, a variable glued to the name, and CDPATH.
		['Bash', { command: 'cat <<E"OF" > /tmp/x\nhi\nEOF\necho x > ~/.claude/kit-owner.json' }],
		['Bash', { command: "cat > notes.md <<E'OF'\nx\nEOF\necho x >> ~/.claude/projects/p/s.jsonl\nE'OF'" }],
		['Bash', { command: 'P=~/.claude/; echo x > ${P}kit-owner.json' }],
		['Bash', { command: 'echo x > ${Q}kit-owner.json' }],
		['Bash', { command: 'export CDPATH=~/.claude; cd projects && echo x > p/s.jsonl' }],
		// A heredoc's lines are read like any other (the 1.24.0 sweep), and a name with a full stop after it is the same
		// file to Windows: this passed until 1.29.0 only because of that full stop.
		['Bash', { command: "cat > notes.md <<'EOF'\nThe owner file is ~/.claude/kit-owner.json.\nEOF" }],
	];
	for (const [tool, input] of deny) assert.equal(run(tool, input), 'deny', `${tool} ${JSON.stringify(input)}`);
	const allow = [
		['Bash', { command: 'P=~/.claude/projects; grep -c x $P/p/s.jsonl' }],
		['Bash', { command: 'cd ~/.claude/projects/p && grep -c x s.jsonl' }],
		['Bash', { command: "sed -i 's/old/kit-owner.json/' notes.md" }],
	];
	for (const [tool, input] of allow) assert.equal(run(tool, input), 'allow', `${tool} ${JSON.stringify(input)}`);
});

// why: guards rule:outward-acts
test('the shipped project settings wire the owner-proof guard on every write tool and shell', () => {
	// It ships in the project layer, run by the one guard process (T2) beside the guards whose reader it uses: a project
	// whose user layer is older would otherwise block every call on a missing file (the 1.23.0 sweep).
	const { routes } = require(path.resolve('project/.claude/guard.cjs'));
	for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell']) assert.ok(routes(tool).includes('owner-proof.cjs'), tool);
});

// why: guards rule:outward-acts (a gate bypass is never a tool's act, even with a yes; the owner's lock 2026-11-11).
// K21, from the 1.26.0 plan-check probe: a settings write that turns every hook off took one pop-up tap, like any
// settings change, so one yes switched every guard off.
test('a settings write that turns the hooks off is never by a tool, in any spelling', () => {
	const proj = kitTemp.makeTemp('proj-');
	fs.mkdirSync(path.join(proj, '.claude'));
	fs.writeFileSync(path.join(proj, '.claude', 'settings.json'), '{\n  "permissions": {}\n}\n');
	const why = (tool_name, tool_input) => {
		const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name, tool_input, cwd: proj }), encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cfg } });
		assert.equal(r.status, 0, r.stderr);
		return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason : '';
	};
	const local = path.join(proj, '.claude', 'settings.local.json');
	const shared = path.join(proj, '.claude', 'settings.json');
	const edge = path.join(proj, '.claude', 'settings.local.json');
	fs.writeFileSync(edge, '{"Hooks": true}\n');
	const never = [
		['Write', { file_path: local, content: '{"disableAllHooks": true}' }],
		['Write', { file_path: local, content: '{"\\u0064isableAllHooks": true}' }],
		['Edit', { file_path: shared, old_string: '"permissions"', new_string: '"disableAllHooks": true, "permissions"' }],
		// The key made across the edit's edge: the result is read, not only the new text.
		['Edit', { file_path: edge, old_string: '{"', new_string: '{"disableAll' }],
		['MultiEdit', { file_path: shared, edits: [{ old_string: '"permissions"', new_string: '"disableAllHooks": true, "permissions"' }] }],
		['Bash', { command: `echo '{"disableAllHooks": true}' > .claude/settings.local.json` }],
	];
	for (const [tool, input] of never) assert.match(why(tool, input), /^Never by a tool/, `${tool} ${JSON.stringify(input)}`);
	// An ordinary settings change still takes the owner's yes, not a flat refusal.
	assert.match(why('Write', { file_path: local, content: '{"permissions": {}}' }), /Owner's yes needed/);
	// An edit without replace_all changes only the first match, as Claude Code applies it: replacing every match would
	// make the key here, the first alone does not (the mutation check's survivor in the 1.28.0 run).
	fs.writeFileSync(edge, '{"note": "QQ", "disableAllQQ": true}\n');
	assert.match(why('Edit', { file_path: edge, old_string: 'QQ', new_string: 'Hooks' }), /^Owner's yes needed/);
	assert.match(why('Edit', { file_path: edge, old_string: 'QQ', new_string: 'Hooks', replace_all: true }), /^Never by a tool/);
});

// why: guards rule:security-standards (a domain hard boundary, rule:project-adapter A2, held by code). E3: the
// workbench's deny rules stopped the edit tools but not a shell write into the kit source or the release copy. A
// project lists such folders in .claude/protected-folders.json; that list is the owner's to write, and a bad one fails closed.
test('folders a project lists are never written by a tool, from the edit tools or a shell', () => {
	const proj = kitTemp.makeTemp('e3-');
	const kept = kitTemp.makeTemp('e3-kept-');
	fs.mkdirSync(path.join(proj, '.claude'));
	const list = path.join(proj, '.claude', 'protected-folders.json');
	fs.writeFileSync(list, JSON.stringify({ folders: [kept] }));
	const why = (tool_name, tool_input) => {
		const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name, tool_input, cwd: proj }), encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cfg } });
		assert.equal(r.status, 0, r.stderr);
		return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason : '';
	};
	const k = kept.split(path.sep).join('/');
	for (const [tool, input] of [['Write', { file_path: path.join(kept, 'a.md'), content: 'x' }], ['Edit', { file_path: path.join(kept, 'b.md'), old_string: 'a', new_string: 'b' }], ['Bash', { command: `echo x > "${k}/a.md"` }], ['Bash', { command: `rm -rf "${k}/scripts"` }], ['PowerShell', { command: `Set-Content -Path "${kept}\\a.md" -Value x` }]]) {
		assert.match(why(tool, input), /^Never by a tool: .*protected-folders\.json/, `${tool} ${JSON.stringify(input)}`);
	}
	// Reads stay open.
	assert.equal(why('Bash', { command: `cat "${k}/README.md"` }), '');
	// K34 (the 1.28.0 sweep, P14): the list was a settings file, so one yes could delete it and every folder on it lost
	// its hold. It is the owner's to write: no tool writes, moves or deletes it, with a yes or without; a read runs.
	const l = list.split(path.sep).join('/');
	for (const [tool, input] of [['Write', { file_path: list, content: '{"folders": []}' }], ['Edit', { file_path: list, old_string: 'a', new_string: 'b' }], ['Bash', { command: 'rm .claude/protected-folders.json' }], ['Bash', { command: `mv "${l}" /tmp/x` }], ['Bash', { command: 'echo {} > .claude/protected-folders.json' }], ['PowerShell', { command: 'Remove-Item .claude\\protected-folders.json' }]]) {
		assert.match(why(tool, input), /^Never by a tool: the folder list/, `${tool} ${JSON.stringify(input)}`);
	}
	assert.equal(why('Bash', { command: 'cat .claude/protected-folders.json' }), '');
	// A list that cannot be read holds every shell call and names the fix.
	fs.writeFileSync(list, '{ not json');
	assert.match(why('Bash', { command: 'git status' }), /protected-folders\.json.*cannot be read/);
});
// why: guards rule:security-standards (rule:project-adapter A2). The commit-time security review of E3: deleting or
// moving a folder above a listed one wrote the listed one too; the list was read from the shell's folder, not the
// project; and a relative word after a cd the guard cannot follow was not read at all.
test('a listed folder is held through its parent, after an unknown cd, and from any folder of the project', () => {
	const proj = kitTemp.makeTemp('e3b-');
	const outer = kitTemp.makeTemp('e3b-outer-');
	const kept = path.join(outer, 'kitsrc');
	fs.mkdirSync(kept);
	fs.mkdirSync(path.join(proj, '.claude'));
	fs.mkdirSync(path.join(proj, 'sub'));
	fs.writeFileSync(path.join(proj, '.claude', 'protected-folders.json'), JSON.stringify({ folders: [kept] }));
	const why = (command, cwd = proj) => {
		const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd }), encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cfg, CLAUDE_PROJECT_DIR: proj } });
		assert.equal(r.status, 0, r.stderr);
		return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason : '';
	};
	const o = outer.split(path.sep).join('/');
	assert.match(why(`rm -rf "${o}"`), /protected-folders\.json/, 'a parent deleted');
	assert.match(why(`mv "${o}" /tmp/x`), /protected-folders\.json/, 'a parent moved');
	assert.match(why(`cd "$X" && rm -rf kitsrc`), /protected-folders\.json/, 'after a cd the guard cannot follow');
	assert.match(why(`echo x > "${o}/kitsrc/a.md"`, path.join(proj, 'sub')), /protected-folders\.json/, 'from a subfolder of the project');
	assert.equal(why(`ls "${o}"`), '', 'a read of the parent');
});
// why: guards rule:security-standards. The 1.28.0 sweep and the commit review: a sed script in a variable read as a
// print, a listed folder spelled /c/..., $PWD/... or ~/..., the root, and env --unset or export -n with a built name.
test('the sweep\'s spellings of a guard file read, a listed folder and a marker clear are held', () => {
	const proj = kitTemp.makeTemp('e3c-');
	const kept = path.join(proj, 'vault');
	fs.mkdirSync(kept);
	fs.mkdirSync(path.join(proj, '.claude'));
	fs.writeFileSync(path.join(proj, '.claude', 'protected-folders.json'), JSON.stringify({ folders: [kept] }));
	const why = (command, tool_name = 'Bash') => {
		const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name, tool_input: { command }, cwd: proj }), encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cfg, CLAUDE_PROJECT_DIR: proj } });
		return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason : '';
	};
	assert.match(why('sed -n "$p" .claude/guard-outward.cjs'), /^Never by a tool/);
	const unix = '/' + kept.split(path.sep).join('/').replace(/^([A-Za-z]):/, (m, d) => d.toLowerCase());
	for (const command of ['echo x > "$PWD/vault/a.txt"', `echo x > "${unix}/a.txt"`, 'rm -rf /', `sed -n 1w${unix}/a.txt notes.txt`, `env gsed -n 1w${unix}/a.txt notes.txt`]) assert.match(why(command), /protected-folders\.json/, command);
	const outward = (command) => {
		const r = spawnSync(process.execPath, [path.resolve('project/.claude/guard-outward.cjs')], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: process.cwd() }), encoding: 'utf8' });
		return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason || '' : '';
	};
	for (const command of ['env --unset="$M" git push origin feat/x', 'export -n "$M"; git push origin feat/x']) assert.match(outward(command), /^Never by a tool: clearing/, command);
});
// why: guards rule:security-standards (pass bar 4, K19). In bash a wildcard at the start of a path part never matches a
// name that starts with a dot, so tests/* cannot name .githooks or .claude and a test run naming it is no write to a
// guard. Quoted, escaped, or with dot globbing turned on, the wildcard may still name one: held.
test('a bash wildcard that cannot match a dot name is no write to a guard', () => {
	const proj = kitTemp.makeTemp('k19-');
	fs.mkdirSync(path.join(proj, 'tests'));
	const why = (command, tool_name = 'Bash') => {
		const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name, tool_input: { command }, cwd: proj }), encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cfg, CLAUDE_PROJECT_DIR: proj } });
		return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason : '';
	};
	for (const command of ['npm test -- tests/*', 'node --test tests/*.test.mjs', 'npm test -- tests/?ard*']) assert.equal(why(command), '', command);
	for (const command of ["npm test -- 'tests/*'", 'shopt -s dotglob; npm test -- tests/*', 'GLOBIGNORE=x npm test -- tests/*', 'npm test -- tests/\\*', 'npm test -- tests/.*', 'setopt globdots; npm test -- tests/*', 'npm test -- tests/*(D)', 'eval "sh"opt -s dotglob"; npm test -- tests/*', '$(printf shopt) -s dotglob; npm test -- tests/*']) assert.match(why(command), /^Never by a tool/, command);
	// PowerShell matches dot names, so there the wildcard is held wherever the folder holds one (K32 reads the folder).
	fs.mkdirSync(path.join(proj, 'tests', '.githooks'), { recursive: true });
	assert.match(why('npm test -- tests/*', 'PowerShell'), /^Never by a tool/, 'PowerShell matches dot names');
});
// why: guards rule:security-standards. The plan check's P4 and the 1.28.0 sweep: a reader's exemption holds only for
// the bare name looked up on PATH; ./sed or ./cat is any program a tool wrote there.
test('a reader named by a path gets no read exemption for a guard or settings file', () => {
	const proj = kitTemp.makeTemp('p4-');
	const why = (command) => {
		const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: proj }), encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cfg, CLAUDE_PROJECT_DIR: proj } });
		return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason : '';
	};
	for (const command of ['./sed -n 1p .claude/settings.json', './cat .claude/guard.cjs', 'bin/sed -n 5p .claude/guard-outward.cjs']) assert.notEqual(why(command), '', command.slice(0, 80));
	for (const command of ['sed -n 1p .claude/settings.json', 'cat .claude/guard.cjs']) assert.equal(why(command), '', command);
	// A folder named unknown is not the guard's unknown folder (the review of the per-word memo).
	fs.mkdirSync(path.join(proj, 'unknown', '.claude'), { recursive: true });
	assert.notEqual(why('cd unknown && cat .claude/settings.json; popd && echo x > .claude/settings.json'), '', 'a write after a move the guard cannot follow');
	// A sed script that is not a line print gets no exemption: e runs each line as a command (the 1.28.0 mutation run's
	// survivor). A w command glued to its file (1w.claude/guard.cjs) writes it, so the path inside the word is read.
	for (const command of ['sed -n e .claude/settings.json', 'sed -n 1w.claude/guard.cjs notes.txt', 'sed -n s/a/b/w.claude/guard.cjs notes.txt', 'sed -n 1w.git/hooks/pre-push notes.txt', 'sed -n /x/w.claude/settings.json notes.txt', 'sed -n s/a/b/gw.claude/guard.cjs notes.txt', 'sed -n -e1w.claude/guard.cjs notes.txt', 'sed -n 1!w.claude/guard.cjs notes.txt', 'sed -n 1{w.claude/guard.cjs notes.txt', "sed -n '1w .claude/guard.cjs' notes.txt", "sed -n -e 'p;w .claude/settings.json' notes.txt", 'env sed -n 1w.claude/guard.cjs notes.txt', 'gsed -n 1w.claude/guard.cjs notes.txt', 'busybox sed -n 1w.claude/guard.cjs notes.txt', 'sh -c "sed -n 1w.claude/guard.cjs notes.txt"', 'toybox sed -n 1w.claude/guard.cjs notes.txt', '/usr/bin/sed -n 1w.claude/guard.cjs notes.txt', `sed -n s/a/`+'b'.repeat(5000)+`/w notes.txt`]) assert.notEqual(why(command), '', command.slice(0, 80));
});
// why: guards rule:security-standards. The 1.28.0 measure run's survivors: what the guard follows and what it does not.
// A folder named like a listed one elsewhere is not it; after a cd the guard cannot follow, only a word naming the
// listed folder is held; a cd it follows carries a write into the settings; an export only sets a name.
test('owner-proof places a word by the folder it is in, and holds only what it names', () => {
	const proj = kitTemp.makeTemp('surv-');
	fs.mkdirSync(path.join(proj, 'vault'));
	fs.mkdirSync(path.join(proj, 'other', 'vault'), { recursive: true });
	fs.mkdirSync(path.join(proj, '.claude'));
	fs.writeFileSync(path.join(proj, '.claude', 'protected-folders.json'), JSON.stringify({ folders: ['vault'] }));
	const why = (command) => {
		const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: proj }), encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cfg, CLAUDE_PROJECT_DIR: proj } });
		return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason : '';
	};
	assert.equal(why('echo x > other/vault/a.txt'), '', 'a folder that only shares the listed one\'s name');
	assert.match(why('echo x > vault/a.txt'), /protected-folders\.json/);
	assert.equal(why('cd "$X" && echo x > notes.txt'), '', 'after a cd the guard cannot follow, a word naming no listed folder');
	assert.match(why('cd "$X" && echo x > vault/a.txt'), /protected-folders\.json/);
	assert.match(why('cd .claude && echo x > settings.json'), /^Owner's yes needed/, 'a cd the guard follows');
	assert.equal(why('export P=.claude/settings.json'), '', 'an export only sets a name');
	for (const command of ['echo x > .claude/kit-install.json', 'echo x > .claude/kit-guard/record.json']) assert.match(why(command), /^Never by a tool/, command);
});

// why: guards rule:security-standards. K38, the 25 flips the 1.28.0 measure run left alive: each case below was built
// and run against its flipped line (graduated lesson: a surviving mutation is dead only after its case was run). A sed
// that prints is a reader only in its exact shape; a cd is followed by its -path word; a default value is read as the
// text it gives; a break that is not plain makes every cd unsure.
test('owner-proof: a dressed-up sed, a cd by -path, a default value and an unsure cd are each read right', () => {
	const held = ['sed -n e 5p .claude/guard.cjs', 'sed -n 5p -i .claude/guard.cjs', 'cd stuff -path .claude && rm guard.cjs', 'echo x > .claude/${U:-guard.cjs}', 'true | cd docs && rm guard.cjs', 'false || cd docs && echo x > projects/p/s.jsonl'];
	for (const command of held) assert.equal(run('Bash', { command }), 'deny', command);
	assert.equal(run('PowerShell', { command: 'Set-Location stuff -Path .claude && Remove-Item guard.cjs' }), 'deny');
	// A name set twice and never used is read once, not for ever; a quoted word that only holds a guard's name beside
	// other text is a reader's argument, not a write.
	for (const command of ['P=a; P=b; echo hi', 'grep x ".claude/guard.cjs y"']) assert.equal(run('Bash', { command }), 'allow', command);
});

// why: guards rule:security-standards. K32 (the 1.28.0 sweep, P18; the plan check's P2): PowerShell's wildcards match dot
// names, so tests/* was held as a write to a guard whatever tests held. It runs when the folder it names holds
// no dot name, no kit- name and no link at any depth; anything the guard cannot see that plainly stays held.
test('a PowerShell wildcard under a folder that holds no dot name is no write to a guard', { windows: 'also' }, () => {
	const proj = kitTemp.makeTemp('k32-');
	for (const d of ['tests/unit', 'sub/.git', 'hooked/.githooks', 'deep/a/b/.claude', 'other', '.claude']) fs.mkdirSync(path.join(proj, ...d.split('/')), { recursive: true });
	fs.writeFileSync(path.join(proj, 'tests', 'a.test.mjs'), 'x');
	fs.symlinkSync(path.join(proj, 'other'), path.join(proj, 'linked'), 'junction');
	fs.mkdirSync(path.join(proj, 'holds-link'));
	fs.symlinkSync(path.join(proj, '.claude'), path.join(proj, 'holds-link', 'l'), 'junction');
	const ps = (command, cwd = proj) => {
		const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'PowerShell', tool_input: { command }, cwd }), encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cfg, CLAUDE_PROJECT_DIR: proj } });
		assert.equal(r.status, 0, r.stderr);
		return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : 'allow';
	};
	for (const command of ['node --test tests/*', 'Remove-Item tests/*', 'Remove-Item tests\\*', 'Get-ChildItem tests/*.mjs', 'Remove-Item -Recurse other/*']) assert.equal(ps(command), 'allow', command);
	const held = ['Remove-Item sub/*', 'Remove-Item sub/*/config', 'Remove-Item hooked/*', 'Remove-Item -Recurse deep/*', 'Remove-Item linked/*', 'Remove-Item holds-link/*', 'Remove-Item ../*', 'Remove-Item ./*', 'Remove-Item *',
		'Remove-Item .claude/*', 'Remove-Item $HOME/*', 'Remove-Item ~/*', 'Remove-Item $d/*', 'Remove-Item missing/*', 'Remove-Item "tests/*"', 'Remove-Item tests/../*'];
	for (const command of held) assert.equal(ps(command), 'deny', command);
	// Only a command of one statement: one before it could change the folder after the guard read it.
	for (const command of ['New-Item -ItemType Junction tests/l -Target $t; Remove-Item -Recurse tests/*', 'Get-Date | Out-Null; Remove-Item tests/*']) assert.equal(ps(command), 'deny', command);
	// After a cd the guard cannot follow, the folder is not known, so nothing is read from the disk.
	assert.equal(ps('Set-Location $x; Remove-Item tests/*'), 'deny');
	// A dot name that arrives later is seen: the folder is read each time.
	fs.mkdirSync(path.join(proj, 'tests', 'unit', '.githooks'));
	assert.equal(ps('Remove-Item tests/*'), 'deny');
});

// why: guards rule:security-standards. Found by the security review of this build and reproduced on the released
// 1.28.0: Windows opens the same file under a name with dots or spaces on its end (settings.json.) or a stream
// suffix (guard.cjs::$DATA), and neither was read as the file, so PowerShell could write the settings, a guard,
// .git/config or the owner's yes file with no hold. Each such name is read as the file it opens.
test('a protected file named with a trailing dot, a trailing space or a stream suffix is still that file', () => {
	const cases = [
		['PowerShell', { command: 'Set-Content .claude\\settings.json. x' }],
		['PowerShell', { command: 'Set-Content .claude\\settings.local.json.. x' }],
		['PowerShell', { command: 'Set-Content .claude\\guard.cjs. x' }],
		['PowerShell', { command: 'Set-Content .claude.\\guard.cjs x' }],
		['PowerShell', { command: 'Set-Content .git\\config. x' }],
		['PowerShell', { command: 'Set-Content .githooks.\\pre-push x' }],
		['PowerShell', { command: 'Add-Content $HOME\\.claude\\kit-owner.json. x' }],
		['PowerShell', { command: 'Remove-Item .claude\\protected-folders.json.' }],
		['Bash', { command: 'echo x > .claude/guard.cjs::$DATA' }],
		['Bash', { command: 'echo x > .claude/settings.json:s' }],
		['Bash', { command: 'echo x > .claude/settings.json::$DATA' }],
		['Bash', { command: 'echo x > ".claude/guard.cjs. "' }],
		['Bash', { command: 'echo x >> ~/.claude/kit-owner.json::$DATA' }],
		['Bash', { command: 'echo x > .git/config::$DATA' }],
		['Write', { file_path: '.claude/guard.cjs::$DATA', content: 'x' }],
		['Write', { file_path: '.claude/settings.json.', content: 'x' }],
		['Edit', { file_path: '.claude/settings.local.json::$DATA', old_string: 'a', new_string: 'b' }],
		['Write', { file_path: path.join(cfg, 'kit-owner.json::$DATA'), content: '{}' }],
	];
	for (const [tool, input] of cases) assert.equal(run(tool, input), 'deny', `${tool} ${JSON.stringify(input)}`);
	// A drive letter keeps its colon, and a name that only looks alike is not the file.
	for (const [tool, input] of [['Bash', { command: 'echo x > C:/work/notes.txt' }], ['Bash', { command: 'echo x > docs/settings.json.md' }], ['PowerShell', { command: 'Set-Content docs\\guard.cjs.txt x' }]]) assert.equal(run(tool, input), 'allow', JSON.stringify(input));
});
