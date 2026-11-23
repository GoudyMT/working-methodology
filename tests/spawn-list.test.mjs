// K360 (patch 1.51.1, U13): a tester or writer spawn waits for its file list. agent-model.cjs refuses an Agent call for a
// tester or writer (named by subagent_type, or by a "Role:" line in a general agent's brief) while the worktree the brief
// names ("Worktree: <path>") holds no kit-unit-files.txt. Other roles are not affected, the same call gives the same
// verdict, and an unreadable worktree lets the call through and is logged. Each test runs the real hook in a child
// process against temp repos, with HOME and the Claude config folder pointed at temp dirs.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const HOOK_DIR = path.resolve('user/kit-hooks');
const COMMAND = 'unit-lock.mjs --tester --files';

function isolatedEnv(extra = {}) {
	const home = kitTemp.makeTemp('spawn-list-home-');
	const config = path.join(home, '.claude');
	return { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: config, KIT_CLAUDE_HOME: config, ...extra };
}

function git(cwd, args) {
	const r = spawnSync('git', args, { cwd, env: isolatedEnv(), encoding: 'utf8' });
	assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
	return r.stdout.trim();
}

// A repo standing for a worktree; with list true it holds kit-unit-files.txt where unit-lock writes it.
function worktree(list) {
	const dir = kitTemp.makeTemp('spawn-list-wt-');
	git(dir, ['init', '-q', '-b', 'main']);
	if (list) fs.writeFileSync(git(dir, ['rev-parse', '--path-format=absolute', '--git-path', 'kit-unit-files.txt']), 'tests/spawn-list.test.mjs\n');
	return dir;
}

// A folder whose .git points nowhere, so git cannot read it.
function brokenWorktree() {
	const dir = kitTemp.makeTemp('spawn-list-broken-');
	fs.writeFileSync(path.join(dir, '.git'), `gitdir: ${path.join(dir, 'no-such-git-folder')}\n`);
	return dir;
}

// A Claude config folder with a role file per name.
function roleConfig(roles) {
	const config = kitTemp.makeTemp('spawn-list-config-');
	fs.mkdirSync(path.join(config, 'agents'), { recursive: true });
	for (const [name, model] of Object.entries(roles)) fs.writeFileSync(path.join(config, 'agents', `${name}.md`), `---\nname: ${name}\nmodel: ${model}\n---\nrole\n`);
	return config;
}
const CONFIG = roleConfig({ tester: 'sonnet', writer: 'sonnet', builder: 'haiku', 'general-purpose': 'sonnet' });

// Runs the real agent-model.cjs once per call, from cwd; one decision per call, null when it lets the call through.
function checkCalls(cwd, calls) {
	const script = "const a = JSON.parse(process.env.KIT_TEST_ARGS); const m = require(path.join(a.hookDir, 'agent-model.cjs')); process.stdout.write(JSON.stringify(a.calls.map((c) => m.check({ tool_name: 'Agent', tool_input: c, cwd: a.cwd }))));";
	const args = JSON.stringify({ hookDir: HOOK_DIR, calls, cwd });
	const r = spawnSync(process.execPath, ['-e', `const path = require('node:path'); ${script}`], { env: isolatedEnv({ KIT_CLAUDE_HOME: CONFIG, CLAUDE_CONFIG_DIR: CONFIG, KIT_TEST_ARGS: args }), encoding: 'utf8' });
	assert.equal(r.status, 0, `agent-model.cjs check ran: ${r.stderr}`);
	return JSON.parse(r.stdout);
}

const spawnCall = (type, wt, role) => ({ subagent_type: type, prompt: `${role ? `Role: ${role}\n` : ''}Worktree: ${wt}\nWrite the tests for the unit.` });
const denied = (d) => d && d.hookSpecificOutput && d.hookSpecificOutput.permissionDecision === 'deny';
const reason = (d) => (d && d.hookSpecificOutput && d.hookSpecificOutput.permissionDecisionReason) || '';

// why: catches a tester spawn whose brief names a worktree with no kit-unit-files.txt is refused, naming the exact `unit-lock.mjs --tester --files` command (K360 S1)
test('a tester spawn whose brief names a worktree with no kit-unit-files.txt is refused, naming the exact `unit-lock.mjs --tester --files` command', () => {
	const wt = worktree(false);
	const noLine = { subagent_type: 'tester', prompt: 'Write the tests for the unit.' };
	const [tester, writer, unnamed] = checkCalls(wt, [spawnCall('tester', wt), spawnCall('writer', wt), noLine]);
	assert.ok(denied(tester), `the tester spawn is refused, got ${JSON.stringify(tester)}`);
	assert.ok(reason(tester).includes(COMMAND), `the refusal names the command: ${reason(tester)}`);
	assert.ok(denied(writer), `the writer spawn is refused too, got ${JSON.stringify(writer)}`);
	assert.ok(denied(unnamed), `a tester spawn with no Worktree line is checked against the hook's cwd, got ${JSON.stringify(unnamed)}`);
});

// why: catches a tester spawn with the list passes (K360 S1)
test('a tester spawn with the list passes', () => {
	const wt = worktree(false);
	const isolated = { ...spawnCall('tester', wt), isolation: 'worktree' };
	const [before, fresh] = checkCalls(wt, [spawnCall('tester', wt), isolated]);
	assert.ok(denied(before), `the same worktree refuses before the list is written, got ${JSON.stringify(before)}`);
	assert.equal(fresh, null, 'a spawn with isolation worktree passes: its worktree does not exist until the spawn');
	fs.writeFileSync(git(wt, ['rev-parse', '--path-format=absolute', '--git-path', 'kit-unit-files.txt']), 'tests/spawn-list.test.mjs\n');
	const [tester, writer] = checkCalls(wt, [spawnCall('tester', wt), spawnCall('writer', wt)]);
	assert.equal(tester, null);
	assert.equal(writer, null);
});

// why: catches a builder spawn is not affected (K360 S2)
test('a builder spawn is not affected', () => {
	const wt = worktree(false);
	const [builder, tester] = checkCalls(wt, [spawnCall('builder', wt), spawnCall('tester', wt)]);
	assert.ok(denied(tester), `the tester spawn into the same worktree is refused, got ${JSON.stringify(tester)}`);
	assert.equal(builder, null);
});

// why: catches a general-purpose agent briefed as tester (Role: tester line) is checked too (K360 S3)
test('a general-purpose agent briefed as tester (Role: tester line) is checked too', () => {
	const bare = worktree(false);
	const listed = worktree(true);
	const [noList, withList, other] = checkCalls(bare, [spawnCall('general-purpose', bare, 'tester'), spawnCall('general-purpose', listed, 'tester'), spawnCall('general-purpose', bare, 'builder')]);
	assert.ok(denied(noList), `the briefed tester with no list is refused, got ${JSON.stringify(noList)}`);
	assert.ok(reason(noList).includes(COMMAND), `the refusal names the command: ${reason(noList)}`);
	assert.equal(withList, null);
	assert.equal(other, null);
});

// why: catches the same spawn twice gives the same verdict (K360 S4)
test('the same spawn twice gives the same verdict', () => {
	const bare = worktree(false);
	const listed = worktree(true);
	const [a, b, c, d] = checkCalls(bare, [spawnCall('tester', bare), spawnCall('tester', bare), spawnCall('tester', listed), spawnCall('tester', listed)]);
	assert.ok(denied(a), `the first spawn is refused, got ${JSON.stringify(a)}`);
	assert.deepEqual(b, a);
	assert.equal(c, null);
	assert.deepEqual(d, c);
});

// why: catches a worktree whose git folder cannot be read lets the spawn through and is logged (K360 S5)
test('a worktree whose git folder cannot be read lets the spawn through and is logged', () => {
	const broken = brokenWorktree();
	const home = worktree(true);
	const [decision] = checkCalls(home, [spawnCall('tester', broken)]);
	assert.equal(decision, null, 'an unreadable worktree does not refuse');
	const common = git(home, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
	const log = fs.existsSync(path.join(common, 'kit-agent-model.log')) ? fs.readFileSync(path.join(common, 'kit-agent-model.log'), 'utf8') : '';
	const rows = log.split('\n').filter(Boolean).map((l) => JSON.parse(l));
	assert.ok(rows.some((r) => JSON.stringify(r).includes('worktree') && r.type === 'tester'), `the pass-through is logged: ${log}`);
});
