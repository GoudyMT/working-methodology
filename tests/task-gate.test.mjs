// The task gate (E30, option B, the owner 2026-11-08): the rules for a PR, a commit, a tag or release and an agent
// fan-out stay out of the start load, and the step waits until the session has read them since it started or last
// compacted. Each case runs the shipped hook as Claude Code does, over a transcript written the way it writes one.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const HOOK = path.resolve('project/.claude/task-gate.cjs');
let seq = 0;
const read = (file) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: `t${++seq}`, name: 'Read', input: { file_path: file } }] } });
const shell = (command) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: `t${++seq}`, name: 'Bash', input: { command } }] } });
const compact = { type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted' };
function gate(lines, tool_name, tool_input, extra = {}, modules = true) {
	const dir = kitTemp.makeTemp('gate-');
	if (modules) for (const f of ['.claude/rules/git-and-release.md', 'standards/reviews-and-findings.md', 'standards/agent-teams.md']) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), '# rules\n'); }
	const t = path.join(dir, 's.jsonl');
	// A row may build its reads from the project folder: the Read tool always sends an absolute path.
	if (typeof lines === 'function') lines = lines(dir);
	fs.writeFileSync(t, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
	const { CLAUDE_PROJECT_DIR: _p, ...env } = process.env;
	const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name, tool_input, transcript_path: t, cwd: dir, ...extra }), encoding: 'utf8', env });
	assert.equal(r.status, 0, `the gate crashed: ${r.stderr}`);
	if (!r.stdout) return { decision: 'pass', reason: '' };
	const o = JSON.parse(r.stdout).hookSpecificOutput;
	return { decision: o.permissionDecision, reason: o.permissionDecisionReason };
}
const RELEASE = '.claude/rules/git-and-release.md';

test('a PR, commit, tag or release waits until the session has read its rules, in any spelling', () => {
	for (const command of ['gh pr create --title x --body-file b.md', 'gh -R o/r pr edit 3 --body x', 'git commit -m "feat: x"', 'git -C . commit -qm x', 'git tag v1.2.0', 'gh release create v1.2.0', 'cd sub && git commit -m x']) {
		const held = gate([], 'Bash', { command });
		assert.equal(held.decision, 'deny', command);
		// The refusal names the file to read, so the session can go on by itself.
		assert.ok(held.reason.includes(RELEASE), command);
		assert.equal(gate([read(RELEASE), read('standards/reviews-and-findings.md')], 'Bash', { command }).decision, 'pass', `${command} after the read`);
		// As the Read tool sends it: the absolute path inside this project (the 1.25.0 sweep: no row read one).
		assert.equal(gate((dir) => [read(path.join(dir, RELEASE)), read(path.join(dir, 'standards', 'reviews-and-findings.md'))], 'Bash', { command }).decision, 'pass', `${command} after an absolute read`);
		// F12: another folder's copy of the rules (the kit source, another project) is not this project's read.
		assert.equal(gate([read(`/elsewhere/${RELEASE}`), read('/elsewhere/standards/reviews-and-findings.md'), shell(`cat ../other/${RELEASE}`)], 'Bash', { command }).decision, 'deny', `${command} after another copy's read`);
	}
	// F14: an env prefix, a wrapper or a shell handed the command still waits. The 1.25.0 sweep: a git option that takes
	// a value hid the subcommand behind it, and gh pr new is gh pr create.
	for (const command of ['X=1 git commit -m x', 'env X=1 git commit -m x', 'command git tag v1', 'bash -c "git commit -m x"', 'powershell -Command "git commit -m x"', 'sh -c \'cd a && gh pr create -t x -b y\'', 'git --attr-source HEAD commit -m x', 'gh pr new -t x -b y']) {
		assert.equal(gate([], 'Bash', { command }).decision, 'deny', command);
	}
	// F13: a list, a manual or a label-only edit writes no commit, tag or body, so it never waits.
	for (const command of ['git tag', 'git tag -l', 'git tag --list "v1*"', 'git tag -n --sort=-v:refname', 'git commit --help', 'git tag -h', 'gh pr create --help', 'gh pr edit 3 --add-label bug']) {
		assert.equal(gate([], 'Bash', { command }).decision, 'pass', command);
	}
	// The 1.25.0 sweep: --sort or --format with a tag name makes the tag, and -h as a message's value is no help.
	for (const command of ['git tag -d v1', 'git tag -a v1 -m x', 'gh pr edit 3 --add-label bug --body x', 'gh pr edit 3 --title=y', 'git tag --sort=refname v9.9', 'git tag --format=x v9.8', 'git tag -m -h v9.7']) assert.equal(gate([], 'Bash', { command }).decision, 'deny', command);
	// A PR also needs the findings rule (the sweep summary in its body).
	assert.ok(gate([read(RELEASE)], 'Bash', { command: 'gh pr create -t x -b y' }).reason.includes('standards/reviews-and-findings.md'));
	assert.equal(gate([read(RELEASE), read('standards/reviews-and-findings.md')], 'Bash', { command: 'gh pr create -t x -b y' }).decision, 'pass');
	assert.equal(gate([], 'PowerShell', { command: 'git commit -m x' }).decision, 'deny');
});

test('a read before the last compact does not count, a shell read does, and other commands never wait', () => {
	assert.equal(gate([read(RELEASE), compact], 'Bash', { command: 'git commit -m x' }).decision, 'deny', 'read before the compact');
	// A transcript line with no message (a summary, a snapshot) is read past: the gate still holds (the mutation check).
	assert.equal(gate([{ type: 'summary', summary: 'x' }], 'Bash', { command: 'git commit -m x' }).decision, 'deny', 'a line with no message');
	assert.equal(gate([compact, read(RELEASE)], 'Bash', { command: 'git commit -m x' }).decision, 'pass');
	assert.equal(gate([shell(`cat ${RELEASE}`)], 'Bash', { command: 'git commit -m x' }).decision, 'pass', 'read in a shell');
	// The 1.24.0 sweep: a command that only names the file is no read, the gated step's own text included.
	assert.equal(gate([shell(`git commit -m "per ${RELEASE}"`)], 'Bash', { command: `git commit -m "per ${RELEASE}"` }).decision, 'deny');
	assert.equal(gate([shell(`Test-Path ${RELEASE}`)], 'Bash', { command: 'git commit -m x' }).decision, 'deny');
	for (const command of ['git status', 'git log --oneline -3', 'gh pr view 3', 'echo "git commit" > notes.md', 'npm test']) assert.equal(gate([], 'Bash', { command }).decision, 'pass', command);
});

test('an agent fan-out waits for the agent-teams rules', () => {
	const fan = gate([], 'Agent', { subagent_type: 'builder', prompt: 'build unit 1' });
	assert.equal(fan.decision, 'deny');
	assert.ok(fan.reason.includes('standards/agent-teams.md'));
	assert.equal(gate([read('standards/agent-teams.md')], 'Agent', { subagent_type: 'builder', prompt: 'x' }).decision, 'pass');
	// An agent's own steps are its brief's: the gate holds the lead, not a subagent.
	assert.equal(gate([], 'Bash', { command: 'git commit -m x' }, { agent_id: 'a1' }).decision, 'pass');
	// A project without the kit's modules has nothing to read, so nothing waits.
	assert.equal(gate([], 'Bash', { command: 'git commit -m x' }, {}, false).decision, 'pass');
});

test('the gate passes when it cannot read the transcript, and the shipped settings wire it', () => {
	const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git commit -m x' }, transcript_path: path.join(kitTemp.makeTemp('none-'), 'missing.jsonl') }), encoding: 'utf8' });
	assert.equal(r.status, 0);
	assert.equal(r.stdout, '', 'a gate that cannot read never blocks a commit');
	const { routes } = require(path.resolve('project/.claude/guard.cjs'));
	for (const tool of ['Bash', 'PowerShell', 'Agent', 'Task']) assert.ok(routes(tool).includes('task-gate.cjs'), tool);
});
