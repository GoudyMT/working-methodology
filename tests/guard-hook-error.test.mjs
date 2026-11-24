// K375 (patch 1.51.4, U8): the one guard process obeys the tier when a user hook breaks. Today the USER loop's catch lets
// the call through and an old-shape hook that crashes in its child process reads as no answer. Both must call hook-error.cjs
// onError(id, error, cwd): a deny "hook error: lead review: <hook>" for tier high or security, nothing for small, and one
// {kind: "hook-error", id, tier, ...} row in <git common dir>/kit-guard-open.log of the call's cwd. The project guards keep
// their "could not run" hold. A missing hook-error.cjs blocks, logged. Each test runs the real guard.cjs in a child
// process, with fake user hooks in a throwaway Claude folder; the tier of each fake comes from the real holds.json
// (canary is high, grounding is small), so no test depends on which tool a hook reads beyond Agent and AskUserQuestion.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const SRC = path.resolve('project/.claude');
const USER_SRC = path.resolve('user/kit-hooks');
const GUARDS = ['guard.cjs', 'owner-proof.cjs', 'task-gate.cjs', 'guard-outward.cjs', 'guard-delete.cjs', 'guard-read.cjs', 'owner-yes.cjs'];
const HELPERS = ['hold-mode.cjs', 'hook-error.cjs', 'holds.json', 'safe-spawn.cjs', 'prices.cjs'];
const THROWS = "exports.check = () => { throw new Error('user hook boom\\nsecond line'); };\n";
// An old-shape hook has no exports.check: guard.cjs runs it as its own process, so a crash is an exit code and stderr.
const CRASHES = "throw new Error('child boom');\n";
const QUIET = "process.exit(0);\n";

// A guard folder, a Claude folder whose kit-hooks hold the helpers plus the given fake hooks (stamped as install user
// stamps them), and a repo for the call's cwd. `drop` takes a helper away; `guards` replaces a project guard's file text.
function setup({ hooks = {}, drop = [], guards = {} } = {}) {
	const dir = kitTemp.makeTemp('guard-hook-error-');
	for (const f of GUARDS) fs.copyFileSync(path.join(SRC, f), path.join(dir, f));
	for (const [f, text] of Object.entries(guards)) fs.writeFileSync(path.join(dir, f), text);
	const cfg = kitTemp.makeTemp('guard-hook-error-cfg-');
	const kit = path.join(cfg, 'kit-hooks');
	fs.mkdirSync(kit);
	for (const f of HELPERS) if (!drop.includes(f) && fs.existsSync(path.join(USER_SRC, f))) fs.copyFileSync(path.join(USER_SRC, f), path.join(kit, f));
	for (const [f, text] of Object.entries(hooks)) fs.writeFileSync(path.join(kit, f), text);
	const files = {};
	for (const f of fs.readdirSync(kit)) files[`kit-hooks/${f}`] = crypto.createHash('sha256').update(fs.readFileSync(path.join(kit, f))).digest('hex');
	fs.writeFileSync(path.join(cfg, 'kit-install.json'), JSON.stringify({ files }));
	const repo = kitTemp.makeTemp('guard-hook-error-repo-');
	const init = spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: repo, encoding: 'utf8' });
	assert.equal(init.status, 0, init.stderr);
	const call = (tool_name, tool_input, from = repo) => {
		const r = spawnSync(process.execPath, [path.join(dir, 'guard.cjs')], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name, tool_input, cwd: from }), encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cfg, KIT_CLAUDE_HOME: cfg } });
		assert.equal(r.status, 0, r.stderr);
		return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput || {} : {};
	};
	// The log is in the git common dir of the call's cwd; for a plain repo that is <repo>/.git.
	const rows = () => {
		const file = path.join(repo, '.git', 'kit-guard-open.log');
		return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
	};
	// A linked worktree of the repo (a commit first, then `git worktree add`), for a call whose cwd is not the main folder.
	const worktree = () => {
		const run = (args, cwd) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
		run(['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'x'], repo);
		const wt = path.join(kitTemp.makeTemp('guard-hook-error-wt-'), 'linked');
		run(['worktree', 'add', '-q', '--detach', wt], repo);
		return wt;
	};
	const strayLogs = () => {
		const root = path.join(repo, '.git', 'worktrees');
		return fs.existsSync(root) ? fs.readdirSync(root).filter((n) => fs.existsSync(path.join(root, n, 'kit-guard-open.log'))) : [];
	};
	return { call, rows, worktree, strayLogs };
}
const agent = (s) => s.call('Agent', { subagent_type: 'reviewer', prompt: 'brief' });
const ask = (s) => s.call('AskUserQuestion', { questions: [] });

// why: catches a user hook that throws under tier high blocks the call with "hook error: lead review" (K375 S1)
test('a user hook that throws under tier high blocks the call with "hook error: lead review"', () => {
	const s = setup({ hooks: { 'canary.cjs': THROWS } });
	const out = agent(s);
	assert.equal(out.permissionDecision, 'deny', JSON.stringify(out));
	assert.match(out.permissionDecisionReason || '', /hook error: lead review: canary/);
	const rows = s.rows().filter((r) => r.kind === 'hook-error');
	assert.equal(rows.length, 1, JSON.stringify(s.rows()));
	assert.equal(rows[0].id, 'canary');
	assert.equal(rows[0].tier, 'high');
	assert.equal(rows[0].error, 'user hook boom', 'the first line of the error');
	// Folded control: a call whose cwd is a linked worktree logs to the main repo's .git, never under .git/worktrees/<name>/.
	const wt = s.worktree();
	const fromWt = s.call('Agent', { subagent_type: 'reviewer', prompt: 'brief' }, wt);
	assert.equal(fromWt.permissionDecision, 'deny', JSON.stringify(fromWt));
	assert.equal(s.rows().filter((r) => r.kind === 'hook-error').length, 2, `the worktree call's row is in the main .git: ${JSON.stringify(s.rows())}`);
	assert.deepEqual(s.strayLogs(), [], 'no log in .git/worktrees/<name>/');
	// Folded control: the same hook that does not throw blocks nothing and logs nothing.
	const fine = setup({ hooks: { 'canary.cjs': 'exports.check = () => null;\n' } });
	assert.doesNotMatch(agent(fine).permissionDecisionReason || '', /hook error/);
	assert.deepEqual(fine.rows(), []);
});

// why: catches a user hook that throws under tier small lets the call through and writes one hook-error line (K375 S1)
test('a user hook that throws under tier small lets the call through and writes one hook-error line', () => {
	const s = setup({ hooks: { 'grounding.cjs': THROWS } });
	const out = ask(s);
	assert.notEqual(out.permissionDecision, 'deny', JSON.stringify(out));
	assert.doesNotMatch(out.permissionDecisionReason || '', /hook error/);
	const rows = s.rows();
	assert.equal(rows.length, 1, JSON.stringify(rows));
	assert.equal(rows[0].kind, 'hook-error');
	assert.equal(rows[0].id, 'grounding');
	assert.equal(rows[0].tier, 'small');
	assert.equal(rows[0].error, 'user hook boom');
});

// why: catches a project guard that throws still holds with "could not run" (security tier, unchanged) (K375 S2)
test('a project guard that throws still holds with "could not run" (security tier, unchanged)', () => {
	const s = setup({ guards: { 'guard-delete.cjs': "exports.check = () => { throw new Error('project guard boom'); };\n" } });
	const out = s.call('Bash', { command: 'git status' });
	assert.equal(out.permissionDecision, 'deny', JSON.stringify(out));
	assert.match(out.permissionDecisionReason || '', /the kit guard guard-delete\.cjs could not run \(project guard boom\)/); // pin: 2 the lead's stop
	assert.doesNotMatch(out.permissionDecisionReason || '', /hook error: lead review/, 'the project hold keeps its own words');
	const holds = JSON.parse(fs.readFileSync(path.join(USER_SRC, 'holds.json'), 'utf8')).holds;
	for (const id of ['owner-proof', 'task-gate', 'guard-outward', 'guard-delete']) assert.equal(holds.find((h) => h.id === id).tier, 'security', `${id} stays security`);
});

// why: catches bypass: an old-shape hook that crashes in its child process obeys its tier the same (K375 S1)
test('bypass: an old-shape hook that crashes in its child process obeys its tier the same', () => {
	const high = setup({ hooks: { 'canary.cjs': CRASHES } });
	const out = agent(high);
	assert.equal(out.permissionDecision, 'deny', `a crashed child under tier high: ${JSON.stringify(out)}`);
	assert.match(out.permissionDecisionReason || '', /hook error: lead review: canary/);
	const hi = high.rows().filter((r) => r.kind === 'hook-error');
	assert.equal(hi.length, 1, JSON.stringify(high.rows()));
	assert.equal(hi[0].id, 'canary');
	assert.equal(hi[0].tier, 'high');
	const small = setup({ hooks: { 'grounding.cjs': CRASHES } });
	assert.notEqual(ask(small).permissionDecision, 'deny', 'a crashed child under tier small lets the call through');
	const lo = small.rows();
	assert.equal(lo.length, 1, JSON.stringify(lo));
	assert.equal(lo[0].id, 'grounding');
	assert.equal(lo[0].tier, 'small');
	// Folded control: an old-shape hook that exits cleanly is no error.
	const quiet = setup({ hooks: { 'canary.cjs': QUIET } });
	assert.doesNotMatch(agent(quiet).permissionDecisionReason || '', /hook error/);
	assert.deepEqual(quiet.rows(), []);
});

// why: catches repeat: the same crash twice gives the same answer (K375 S1)
test('repeat: the same crash twice gives the same answer', () => {
	for (const [name, text] of [['new shape', THROWS], ['old shape', CRASHES]]) {
		const s = setup({ hooks: { 'canary.cjs': text } });
		const first = agent(s);
		const second = agent(s);
		assert.equal(first.permissionDecision, 'deny', `${name}: ${JSON.stringify(first)}`);
		assert.deepEqual(second, first, `${name}: the second call answers as the first`);
		assert.equal(s.rows().filter((r) => r.kind === 'hook-error' && r.id === 'canary').length, 2, `${name}: one row per call`);
	}
});

// why: catches fail-closed: a missing hook-error.cjs blocks the call, logged (K375 S3)
test('fail-closed: a missing hook-error.cjs blocks the call, logged', () => {
	for (const [name, hooks, call] of [['tier high', { 'canary.cjs': THROWS }, agent], ['tier small', { 'grounding.cjs': THROWS }, ask], ['old shape', { 'canary.cjs': CRASHES }, agent]]) {
		const s = setup({ hooks, drop: ['hook-error.cjs'] });
		const out = call(s);
		assert.equal(out.permissionDecision, 'deny', `${name}: no helper blocks the call: ${JSON.stringify(out)}`);
		assert.match(out.permissionDecisionReason || '', /hook error: lead review/, name);
		assert.ok(s.rows().length >= 1, `${name}: logged`);
		// The guard finds the git dir itself here: from a linked worktree the row is in the main repo's .git.
		const before = s.rows().length;
		const wt = s.worktree();
		const fromWt = name === 'tier small' ? s.call('AskUserQuestion', { questions: [] }, wt) : s.call('Agent', { subagent_type: 'reviewer', prompt: 'brief' }, wt);
		assert.equal(fromWt.permissionDecision, 'deny', `${name}: ${JSON.stringify(fromWt)}`);
		assert.equal(s.rows().length, before + 1, `${name}: the worktree call's row is in the main .git: ${JSON.stringify(s.rows())}`);
		assert.deepEqual(s.strayLogs(), [], `${name}: no log in .git/worktrees/<name>/`);
	}
	// Folded control: with the helper missing and no hook failing, the call is not held for it.
	const fine = setup({ hooks: { 'canary.cjs': 'exports.check = () => null;\n' }, drop: ['hook-error.cjs'] });
	assert.doesNotMatch(agent(fine).permissionDecisionReason || '', /hook error/);
});

// why: catches call-cap crashing for an agent letting the call through with no hook-error answer (S1F1)
test('call-cap crashing for an agent answers by its tier high, with one hook-error row', async () => {
	const { createRequire } = await import('node:module');
	const repo = kitTemp.makeTemp('guard-hook-error-cap-repo-');
	const init = spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: repo, encoding: 'utf8' });
	assert.equal(init.status, 0, init.stderr);
	const kit = kitTemp.makeTemp('guard-hook-error-cap-kit-');
	fs.cpSync(USER_SRC, path.join(kit, 'kit-hooks'), { recursive: true });
	const cap = createRequire(import.meta.url)(path.join(kit, 'kit-hooks', 'call-cap.cjs'));
	// A call whose tool_input cannot be read: check() throws after the agent is known.
	const broken = { cwd: repo, agent_id: 'a1', agent_type: 'builder', tool_name: 'Bash', get tool_input() { throw new Error('cap boom\nsecond line'); } };
	const out = cap.check(broken);
	assert.ok(out, 'call-cap is tier high: a crash must not pass the call');
	assert.equal(out.hookSpecificOutput.permissionDecision, 'deny', JSON.stringify(out));
	assert.match(out.hookSpecificOutput.permissionDecisionReason, /hook error: lead review: call-cap/);
	const file = path.join(repo, '.git', 'kit-guard-open.log');
	const rows = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
	const errs = rows.filter((r) => r.kind === 'hook-error');
	assert.equal(errs.length, 1, JSON.stringify(rows));
	assert.equal(errs[0].id, 'call-cap');
	assert.equal(errs[0].tier, 'high');
	// Folded control: a call that does not crash is passed.
	assert.equal(cap.check({ cwd: repo, agent_id: 'a1', agent_type: 'builder', tool_name: 'Read', tool_input: {} }), null);
});
