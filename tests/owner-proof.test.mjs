// Tests for the owner-proof guard (project/.claude/owner-proof.cjs, E27): the owner's thread yes is read from the
// session transcripts and kit-owner.json, so no tool call may write them.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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

test('the owner-proof guard refuses every tool write to the session transcripts and kit-owner.json', () => {
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

test('the owner-proof guard lets reads of the transcripts through, and every other write', () => {
	const allow = [
		['Write', { file_path: path.resolve('notes.txt'), content: 'x' }],
		['Edit', { file_path: path.join(cfg, 'settings-notes.md'), old_string: 'a', new_string: 'b' }],
		['Bash', { command: 'cat ~/.claude/projects/C--repo/s.jsonl' }],
		['Bash', { command: 'grep -c owner ~/.claude/projects/C--repo/s.jsonl' }],
		['Bash', { command: 'ls ~/.claude/projects' }],
		['PowerShell', { command: 'Get-Content "$HOME\\.claude\\kit-owner.json"' }],
		['Bash', { command: 'git status' }],
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
	for (const [tool, input] of allow) assert.equal(run(tool, input), 'allow', `${tool} ${JSON.stringify(input)}`);
});

// S23-2 (the 1.23.0 verify): reads through a variable or after a cd into the transcripts, and a file whose text only
// names kit-owner.json, were refused. S23-1: the mutation check found writes no test covered.
test('the owner-proof guard follows a variable and a cd into the transcripts, and reads a quoted heredoc as data', () => {
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
	];
	for (const [tool, input] of deny) assert.equal(run(tool, input), 'deny', `${tool} ${JSON.stringify(input)}`);
	const allow = [
		['Bash', { command: 'P=~/.claude/projects; grep -c x $P/p/s.jsonl' }],
		['Bash', { command: 'cd ~/.claude/projects/p && grep -c x s.jsonl' }],
		['Bash', { command: "cat > notes.md <<'EOF'\nThe owner file is ~/.claude/kit-owner.json.\nEOF" }],
		['Bash', { command: "sed -i 's/old/kit-owner.json/' notes.md" }],
	];
	for (const [tool, input] of allow) assert.equal(run(tool, input), 'allow', `${tool} ${JSON.stringify(input)}`);
});

test('the shipped project settings wire the owner-proof guard on every write tool and shell', () => {
	const pre = JSON.parse(fs.readFileSync(path.resolve('project/.claude/settings.json'), 'utf8')).hooks.PreToolUse;
	// It ships in the project layer beside the guards whose reader it uses: a project whose user layer is older
	// would otherwise block every call on a missing file (the 1.23.0 sweep).
	const entry = pre.find((e) => e.hooks.some((h) => (h.args || []).join(' ').includes('{{PROJECT_DIR}}/.claude/owner-proof.cjs')));
	assert.ok(entry, 'wired from the project layer');
	for (const tool of ['Write', 'Edit', 'NotebookEdit', 'Bash', 'PowerShell']) assert.match(tool, new RegExp(`^(${entry.matcher})$`), tool);
	assert.equal(entry.hooks.find((h) => (h.args || []).join(' ').includes('owner-proof')).onFailure, 'block');
});
