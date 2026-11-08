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
const run = (tool_name, tool_input) => {
	const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name, tool_input, cwd: process.cwd() }), encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cfg } });
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
		['Bash', { command: 'echo hi >> C:/Users/x/CLAUDE~1/projects/A/s.jsonl' }],
		['Bash', { command: 'cd ~/.claude && echo hi >> projects/A/s.jsonl' }],
		['PowerShell', { command: 'Set-Location $HOME\\.claude; Add-Content projects\\A\\s.jsonl x' }],
		['Bash', { command: 'cp x.jsonl ~/.claude/./projects/C--repo/forged.jsonl' }],
		['Bash', { command: 'echo {} > ~/.claude/kit-owne?.json' }],
		['PowerShell', { command: 'Add-Content "$HOME\\.claude\\.\\projects\\p\\s.jsonl" x' }],
		['Bash', { command: 'cp a.jsonl b.jsonl ~/.claude/projects/p/' }],
		['Bash', { command: 'find ~/.claude/projects -name x -delete' }],
	];
	for (const [tool, input] of deny) assert.equal(run(tool, input), 'deny', `${tool} ${JSON.stringify(input)}`);
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
