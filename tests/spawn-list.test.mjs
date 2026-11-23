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
// The hook names unit-lock.mjs by a path built from its own folder, so the command runs outside the kit repo.
const COMMAND = path.join(HOOK_DIR, '..', 'kit-tools', 'unit-lock.mjs');

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

// A main repo with one commit and a linked worktree of it; the linked worktree's own git folder is where its list belongs.
function linkedWorktree() {
	const main = kitTemp.makeTemp('spawn-list-main-');
	git(main, ['init', '-q', '-b', 'main']);
	git(main, ['-c', 'user.name=T', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'x']);
	const linked = path.join(kitTemp.makeTemp('spawn-list-link-'), 'wt');
	git(main, ['worktree', 'add', '-q', '-b', 'lane', linked]);
	return { main, linked };
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
	for (const d of [tester, writer]) assert.ok(reason(d).includes(`${COMMAND} --tester --files`), `the full command is named: ${reason(d)}`);
	assert.ok(fs.existsSync(COMMAND), 'the path in the message exists on disk');
	const listed = worktree(true);
	const [named] = checkCalls(listed, [spawnCall('tester', wt)]);
	assert.ok(denied(named), `a cwd with a list does not cover a Worktree line naming a bare worktree, got ${JSON.stringify(named)}`);
});

// why: catches a tester spawn with the list passes (K360 S1)
test('a tester spawn with the list passes', () => {
	const wt = worktree(false);
	const isolated = { ...spawnCall('tester', wt), isolation: 'worktree' };
	const others = ['none', '', true].map((isolation) => ({ ...spawnCall('tester', wt), isolation }));
	const [before, fresh, ...refused] = checkCalls(wt, [spawnCall('tester', wt), isolated, ...others]);
	assert.ok(denied(before), `the same worktree refuses before the list is written, got ${JSON.stringify(before)}`);
	assert.equal(fresh, null, 'a spawn with isolation worktree passes: its worktree does not exist until the spawn');
	refused.forEach((d, i) => assert.ok(denied(d), `isolation ${JSON.stringify(['none', '', true][i])} is no isolation and is refused, got ${JSON.stringify(d)}`));
	const { main, linked } = linkedWorktree();
	fs.writeFileSync(path.join(git(main, ['rev-parse', '--path-format=absolute', '--git-common-dir']), 'kit-unit-files.txt'), 'tests/spawn-list.test.mjs\n');
	const [commonOnly] = checkCalls(linked, [spawnCall('tester', linked)]);
	assert.ok(denied(commonOnly), `a list only in the main repo's common folder is refused, got ${JSON.stringify(commonOnly)}`);
	fs.writeFileSync(git(linked, ['rev-parse', '--path-format=absolute', '--git-path', 'kit-unit-files.txt']), 'tests/spawn-list.test.mjs\n');
	const [own] = checkCalls(linked, [spawnCall('tester', linked)]);
	assert.equal(own, null, "a list in the linked worktree's own git folder passes");
	fs.writeFileSync(git(wt, ['rev-parse', '--path-format=absolute', '--git-path', 'kit-unit-files.txt']), 'tests/spawn-list.test.mjs\n');
	const [tester, writer] = checkCalls(wt, [spawnCall('tester', wt), spawnCall('writer', wt)]);
	assert.equal(tester, null);
	assert.equal(writer, null);
});

// why: catches a builder spawn is not affected (K360 S2)
test('a builder spawn is not affected', () => {
	const wt = worktree(false);
	const types = ['reviewer', 'checker', 'Explore', 'general-purpose'];
	const [builder, tester, mismatch, ...rest] = checkCalls(wt, [spawnCall('builder', wt), spawnCall('tester', wt), { ...spawnCall('builder', wt), model: 'opus' }, ...types.map((t) => spawnCall(t, wt))]);
	assert.ok(denied(tester), `the tester spawn into the same worktree is refused, got ${JSON.stringify(tester)}`);
	assert.equal(builder, null);
	assert.equal(mismatch, null, 'a model-family mismatch still returns null: the agent-model hold stays log');
	rest.forEach((d, i) => assert.equal(d, null, `a ${types[i]} spawn is not affected`));
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
	const spellings = [spawnCall('kit:tester', bare), spawnCall('kit:writer', bare), spawnCall('general-purpose', bare, 'writer'), { subagent_type: 'general-purpose', prompt: `role: Tester\nWorktree: ${bare}\nGo.` }];
	checkCalls(bare, spellings).forEach((d, i) => assert.ok(denied(d), `spelling ${i} is refused in a bare worktree, got ${JSON.stringify(d)}`));
	const [plain] = checkCalls(bare, [spawnCall('general-purpose', bare)]);
	assert.equal(plain, null, 'a general-purpose spawn with no Role line is not checked');
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
	const missing = path.join(kitTemp.makeTemp('spawn-list-gone-'), 'no-such-worktree');
	const [decision, absent] = checkCalls(home, [spawnCall('tester', broken), spawnCall('tester', missing)]);
	assert.equal(decision, null, 'an unreadable worktree does not refuse');
	assert.equal(absent, null, 'a nonexistent worktree path does not refuse');
	const common = git(home, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
	const log = fs.existsSync(path.join(common, 'kit-agent-model.log')) ? fs.readFileSync(path.join(common, 'kit-agent-model.log'), 'utf8') : '';
	const rows = log.split('\n').filter(Boolean).map((l) => JSON.parse(l));
	const mine = rows.filter((r) => r.type === 'tester' && /worktree/i.test(String(r.why)));
	assert.equal(mine.length, 2, `each pass-through is logged with worktree in its why: ${log}`);
	for (const r of mine) assert.match(String(r.mode), /^(log|enforce)$/, 'the row records the mode it read');
});

// why: catches a briefed tester whose Role line has bold markup or a unit tag slipping past the list gate (K360 S3 F3)
test('a Role line of "tester (U13)" or "**tester**" is read as tester', () => {
	const bare = worktree(false);
	const prompt = (role) => ({ subagent_type: 'general-purpose', prompt: `Role: ${role}\nWorktree: ${bare}\nGo.` });
	const roles = ['tester (U13)', '**tester**', '**Tester** (U13)'];
	const [builder, ...results] = checkCalls(bare, [prompt('builder (U13)'), ...roles.map(prompt)]);
	assert.equal(builder, null, 'a builder Role line is not refused');
	results.forEach((d, i) => assert.ok(denied(d), `Role: ${roles[i]} with no list is refused, got ${JSON.stringify(d)}`));
});

// why: catches a Worktree line in bold, indented or a list item being missed so the hook cwd list covers a bare worktree (K360 S1 F4 F6)
test('a Worktree line in bold, indented or as a list item names the worktree', () => {
	const bare = worktree(false);
	const listed = worktree(true);
	const lines = [`**Worktree:** ${bare}`, `  Worktree: ${bare}`, `- Worktree: ${bare}`, `* worktree: ${bare}`];
	const calls = lines.map((line) => ({ subagent_type: 'tester', prompt: `${line}\nWrite the tests.` }));
	checkCalls(listed, calls).forEach((d, i) => assert.ok(denied(d), `${JSON.stringify(lines[i])} names the bare worktree and is refused, got ${JSON.stringify(d)}`));
});

// why: catches a Worktree path on a network share being handed to git so the spawn waits on the network (K360 S5 F5)
test('a Worktree path on a share passes with one kit-guard-open.log row and no network wait', () => {
	const home = worktree(true);
	const shares = ['\\\\kit-no-such-host-zz\\share\\wt', '//kit-no-such-host-zz/share/wt'];
	const script = "const a = JSON.parse(process.env.KIT_TEST_ARGS); const m = require(path.join(a.hookDir, 'agent-model.cjs')); const t = process.hrtime.bigint(); const d = m.check({ tool_name: 'Agent', tool_input: a.call, cwd: a.cwd }); process.stdout.write(JSON.stringify({ d, ms: Number(process.hrtime.bigint() - t) / 1e6 }));";
	for (const share of shares) {
		const args = JSON.stringify({ hookDir: HOOK_DIR, call: spawnCall('tester', share), cwd: home });
		const r = spawnSync(process.execPath, ['-e', `const path = require('node:path'); ${script}`], { env: isolatedEnv({ KIT_CLAUDE_HOME: CONFIG, CLAUDE_CONFIG_DIR: CONFIG, KIT_TEST_ARGS: args }), encoding: 'utf8' });
		assert.equal(r.status, 0, `hook ran: ${r.stderr}`);
		const { d, ms } = JSON.parse(r.stdout);
		assert.equal(d, null, `${share} passes`);
		assert.ok(ms < 500, `${share} returns quickly (git never touches a share), took ${ms} ms`);
	}
	const file = path.join(git(home, ['rev-parse', '--path-format=absolute', '--git-common-dir']), 'kit-guard-open.log');
	const rows = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
	assert.equal(rows.length, 2, 'one kit-guard-open.log row per share spawn');
	for (const row of rows) assert.ok(JSON.stringify(row).includes('kit-no-such-host-zz'), `the row names the share: ${JSON.stringify(row)}`);
});
