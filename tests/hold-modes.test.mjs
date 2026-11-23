// Hold modes (U9, build 24): a hold either logs or enforces. user/kit-hooks/holds.json lists every hold and its mode,
// user/kit-hooks/hold-mode.cjs reads that mode for a hook, agent-model.cjs logs through it, and
// user/kit-tools/hold-check.mjs stops a release from dropping an enforced hold to log or removing it. Each test runs
// the modules in a temp folder, with HOME and the Claude config folder pointed at temp dirs.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const require = createRequire(import.meta.url);
const HOLD_MODE = path.resolve('user/kit-hooks/hold-mode.cjs');
const AGENT_MODEL = path.resolve('user/kit-hooks/agent-model.cjs');
const HOLD_CHECK = path.resolve('user/kit-tools/hold-check.mjs');
const REAL_HOLDS = path.resolve('user/kit-hooks/holds.json');

// A child process environment whose home and Claude config folders are temp dirs, so no test reads the real home.
function isolatedEnv(extra = {}) {
	const home = kitTemp.makeTemp('hold-home-');
	const config = path.join(home, '.claude');
	return { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: config, KIT_CLAUDE_HOME: config, ...extra };
}

const GIT_ID = { GIT_AUTHOR_NAME: 'Tester', GIT_AUTHOR_EMAIL: 'tester@example.invalid', GIT_COMMITTER_NAME: 'Tester', GIT_COMMITTER_EMAIL: 'tester@example.invalid' };
function git(cwd, args) {
	const r = spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd, env: isolatedEnv(GIT_ID), encoding: 'utf8' });
	assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
	return r.stdout;
}

// Writes files under dir; a null text removes the file.
function put(dir, files) {
	for (const [rel, text] of Object.entries(files)) {
		const file = path.join(dir, rel);
		if (text === null) {
			fs.rmSync(file, { force: true });
			continue;
		}
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, text);
	}
}
function save(dir, message, tag) {
	git(dir, ['add', '-A']);
	git(dir, ['commit', '-q', '--allow-empty', '-m', message]);
	if (tag) git(dir, ['tag', tag]);
}
function repo() {
	const dir = kitTemp.makeTemp('hold-check-');
	git(dir, ['init', '-q', '-b', 'main']);
	return dir;
}
const holdsText = (holds) => `${JSON.stringify({ holds }, null, 2)}\n`;
const hookPath = (name) => `user/kit-hooks/${name}`;
const hookText = (name) => `// ${name}\n`;

// Runs the kit check in dir with the given arguments; out holds stdout and stderr together.
function runCheck(dir, args = [], extraEnv = {}) {
	const r = spawnSync(process.execPath, [HOLD_CHECK, ...args], { cwd: dir, env: isolatedEnv(extraEnv), encoding: 'utf8' });
	return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

// A repo whose release (tag v1.0.0 by default) holds the given holds and hook files; then the working tree holds `after`.
// before undefined means the release has no holds.json at all; after undefined leaves the working tree's holds.json as the release had it.
function scenario({ before, after, hooks = [], tag = 'v1.0.0' }) {
	const dir = repo();
	const files = { 'README.md': 'kit\n' };
	if (before !== undefined) files['user/kit-hooks/holds.json'] = holdsText(before);
	for (const h of hooks) files[hookPath(h)] = hookText(h);
	put(dir, files);
	save(dir, 'release', tag);
	// after null deletes the working tree's holds.json.
	if (after !== undefined) put(dir, { 'user/kit-hooks/holds.json': after === null ? null : holdsText(after) });
	return dir;
}

// A copy of hold-mode.cjs alone in a temp folder, with the given holds.json text (or none), so it reads that file and nothing else.
function holdModeDir(holdsFile) {
	const dir = kitTemp.makeTemp('hold-mode-');
	fs.copyFileSync(HOLD_MODE, path.join(dir, 'hold-mode.cjs'));
	if (holdsFile !== undefined) fs.writeFileSync(path.join(dir, 'holds.json'), holdsFile);
	return dir;
}
const modeOf = (dir) => require(path.join(dir, 'hold-mode.cjs')).mode;

// why: guards rule:kit-standards (a build hold missing from holds.json is never checked)
// renamed from: holds.json lists the agent-model and handoff-gate holds, both in log mode
test('holds.json lists the agent-model hold in log mode and the handoff-gate hold in enforce mode', () => {
	let holds;
	assert.doesNotThrow(() => { holds = JSON.parse(fs.readFileSync(REAL_HOLDS, 'utf8')).holds; }, 'user/kit-hooks/holds.json reads as JSON with a holds list');
	const byId = Object.fromEntries(holds.map((h) => [h.id, h]));
	assert.deepEqual(byId['agent-model'] && { hook: byId['agent-model'].hook, mode: byId['agent-model'].mode }, { hook: 'agent-model.cjs', mode: 'log' });
	// H5 (the owner's yes to enforce, 2026-11-23): the hand-back gate enforces, high tier
	assert.deepEqual(byId['handoff-gate'] && { hook: byId['handoff-gate'].hook, mode: byId['handoff-gate'].mode, tier: byId['handoff-gate'].tier }, { hook: 'handoff-gate.cjs', mode: 'enforce', tier: 'high' });
});

// why: guards rule:kit-standards (a listed log hold read back as enforce)
test('hold-mode returns log for a hold listed as log and enforce for one listed as enforce', () => {
	let mode;
	assert.doesNotThrow(() => { mode = modeOf(holdModeDir(holdsText([{ id: 'one-hold', hook: 'one.cjs', mode: 'log' }, { id: 'two-hold', hook: 'two.cjs', mode: 'enforce' }]))); }, 'hold-mode.cjs loads and reads the holds beside it');
	assert.equal(mode('one-hold'), 'log');
	assert.equal(mode('two-hold'), 'enforce');
});

// why: guards rule:kit-standards
test('hold-mode returns enforce for an id not in the list, so existing holds keep blocking', () => {
	let mode;
	assert.doesNotThrow(() => { mode = modeOf(holdModeDir(holdsText([{ id: 'other-hold', hook: 'other.cjs', mode: 'log' }]))); }, 'hold-mode.cjs loads');
	assert.equal(mode('unlisted-hold'), 'enforce');
});


// why: guards rule:kit-standards (a deleted holds.json read as log drops enforcement)
test('hold-mode returns enforce and does not throw when holds.json is missing', () => {
	let mode;
	assert.doesNotThrow(() => { mode = modeOf(holdModeDir(undefined)); }, 'hold-mode.cjs loads');
	assert.doesNotThrow(() => mode('any-hold'), 'a missing holds.json is read without a throw');
	assert.equal(mode('any-hold'), 'enforce');
});

// why: guards rule:kit-standards (a mode typo read as log turns an enforced hold log-only)
test('hold-mode returns enforce for a listed hold whose mode is neither log nor enforce', () => {
	let mode;
	assert.doesNotThrow(() => { mode = modeOf(holdModeDir(holdsText([{ id: 'typo-hold', hook: 'typo.cjs', mode: 'warn' }]))); }, 'hold-mode.cjs loads');
	assert.equal(mode('typo-hold'), 'enforce');
});

// why: guards rule:kit-standards (a wrong-shape holds.json throws instead of defaulting to enforce)
test('hold-mode returns enforce and does not throw for holds.json of the wrong shape', () => {
	const shapes = ['{}', '[]', 'null', '{"holds":"x"}', '{"holds":[null,3]}'];
	for (const text of shapes) {
		let mode;
		assert.doesNotThrow(() => { mode = modeOf(holdModeDir(text)); }, `hold-mode.cjs loads with ${text}`);
		assert.doesNotThrow(() => mode('x'), `mode('x') does not throw with ${text}`);
		assert.equal(mode('x'), 'enforce', `mode('x') is enforce with ${text}`);
	}
});


// Runs agent-model.cjs from hookDir once per call in calls, in dir's repo; one result per call, null when it decides nothing.
function checkCalls(hookDir, dir, calls, extraEnv = {}) {
	const script = "const a = JSON.parse(process.env.KIT_TEST_ARGS); const m = require(path.join(a.hookDir, 'agent-model.cjs')); process.stdout.write(JSON.stringify(a.calls.map((c) => m.check({ tool_name: 'Agent', tool_input: c, cwd: a.dir }))));";
	const args = JSON.stringify({ hookDir, calls, dir });
	return spawnSync(process.execPath, ['-e', `const path = require('node:path'); ${script}`], { env: isolatedEnv({ ...extraEnv, KIT_TEST_ARGS: args }), encoding: 'utf8' });
}

// A Claude config folder holding one role file per name in roles (name -> model line), for the role lookup.
function roleConfig(roles) {
	const config = kitTemp.makeTemp('agent-model-config-');
	for (const [name, model] of Object.entries(roles)) {
		put(path.join(config, 'agents'), { [`${name}.md`]: `---\nname: ${name}\nmodel: ${model}\n---\nrole\n` });
	}
	return config;
}

// The kit-agent-model.log text in dir's repo (the git common folder), read after a check.
function agentLogText(dir) {
	const common = git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim();
	return fs.readFileSync(path.join(common, 'kit-agent-model.log'), 'utf8');
}

// why: guards rule:kit-standards (an enforce hold that refuses a call with no role file stops every new agent type)
test('agent-model never refuses a call with no role file under enforce, and logs the enforce mode', () => {
	assert.ok(fs.existsSync(AGENT_MODEL), 'agent-model.cjs is missing');
	const config = roleConfig({ 'opus-role': 'opus' });
	const hookDir = kitTemp.makeTemp('agent-model-enforce-');
	fs.copyFileSync(AGENT_MODEL, path.join(hookDir, 'agent-model.cjs'));
	fs.writeFileSync(path.join(hookDir, 'hold-mode.cjs'), `'use strict';
module.exports = { mode() { return 'enforce'; } };
`);
	const dir = repo();
	const run = checkCalls(hookDir, dir, [{ subagent_type: 'no-such-role' }, { subagent_type: 'opus-role', model: 'haiku' }], { KIT_CLAUDE_HOME: config, CLAUDE_CONFIG_DIR: config });
	assert.equal(run.status, 0, `agent-model.cjs check ran: ${run.stderr}`);
	const decisions = JSON.parse(run.stdout);
	assert.equal(decisions[0], null, 'the no-role-file call is not refused');
	assert.match(agentLogText(dir), /"mode":"enforce"/);
});


// why: catches a deleted holds.json that the check reads as no holds, so an enforce hold vanishes unnoticed
test('hold-check exits 1 and names the hold when the working tree deletes holds.json over an enforce hold', () => {
	const dir = scenario({
		before: [{ id: 'alpha-hold', hook: 'alpha.cjs', mode: 'enforce' }],
		hooks: ['alpha.cjs'],
		after: null,
	});
	const r = runCheck(dir, [dir, '--base', 'v1.0.0']);
	assert.equal(r.code, 1, r.out);
	assert.match(r.out, /alpha-hold/);
});

// why: catches an untracked hook file treated as missing, so a hold whose hook is new cannot be added
test('hold-check exits 0 when the hook file a new hold names is present but untracked', () => {
	const dir = scenario({
		before: undefined,
		after: [{ id: 'beta-hold', hook: 'beta.cjs', mode: 'log' }],
		hooks: [],
	});
	put(dir, { [hookPath('beta.cjs')]: hookText('beta.cjs') });
	const r = runCheck(dir, [dir, '--base', 'v1.0.0']);
	assert.equal(r.code, 0, r.out);
});

// why: catches a hook committed at the release then deleted from disk, which leaves its hold guarding nothing
test('hold-check exits 1 and names the hold when a hook committed at the release is deleted from disk', () => {
	const dir = scenario({
		before: [{ id: 'alpha-hold', hook: 'alpha.cjs', mode: 'enforce' }],
		hooks: ['alpha.cjs'],
	});
	put(dir, { [hookPath('alpha.cjs')]: null });
	const r = runCheck(dir, [dir, '--base', 'v1.0.0']);
	assert.equal(r.code, 1, r.out);
	assert.match(r.out, /alpha-hold/);
});

// why: catches a dropped enforce hold that the release check lets through as a plain mode change
test('hold-check exits 1 and names the hold when an enforce hold is log at the release', () => {
	const dir = scenario({
		before: [{ id: 'alpha-hold', hook: 'alpha.cjs', mode: 'enforce' }],
		hooks: ['alpha.cjs'],
		after: [{ id: 'alpha-hold', hook: 'alpha.cjs', mode: 'log' }],
	});
	const r = runCheck(dir, [dir, '--base', 'v1.0.0']);
	assert.equal(r.code, 1, r.out);
	assert.match(r.out, /alpha-hold/);
});

// why: catches an enforce hold deleted from holds.json, which hold-check must report as a drop
test('hold-check exits 1 and names the hold when an enforce hold is gone from the list', () => {
	const dir = scenario({
		before: [{ id: 'alpha-hold', hook: 'alpha.cjs', mode: 'enforce' }],
		hooks: ['alpha.cjs'],
		after: [],
	});
	const r = runCheck(dir, [dir, '--base', 'v1.0.0']);
	assert.equal(r.code, 1, r.out);
	assert.match(r.out, /alpha-hold/);
});

// why: catches a hold naming a hook file that was renamed or never added, so the hold guards nothing
test('hold-check exits 1 and names the hold when its hook file is missing from user/kit-hooks', () => {
	const dir = scenario({
		before: undefined,
		after: [{ id: 'beta-hold', hook: 'beta.cjs', mode: 'log' }],
		hooks: [],
	});
	const r = runCheck(dir, [dir, '--base', 'v1.0.0']);
	assert.equal(r.code, 1, r.out);
	assert.match(r.out, /beta-hold/);
});

// why: catches a release with no holds.json, which the check must accept rather than fail on a missing base file
test('hold-check exits 0 when the release has no holds.json and the new holds have their hook files', () => {
	const dir = scenario({
		before: undefined,
		after: [{ id: 'beta-hold', hook: 'beta.cjs', mode: 'log' }],
		hooks: ['beta.cjs'],
	});
	const r = runCheck(dir, [dir, '--base', 'v1.0.0']);
	assert.equal(r.code, 0, r.out);
});

// why: catches a check that flags a hold tightened from log to enforce, which is the direction a release may go
test('hold-check exits 0 when enforce holds stay enforce and a log hold moves to enforce', () => {
	const dir = scenario({
		before: [
			{ id: 'alpha-hold', hook: 'alpha.cjs', mode: 'enforce' },
			{ id: 'beta-hold', hook: 'beta.cjs', mode: 'log' },
		],
		hooks: ['alpha.cjs', 'beta.cjs'],
		after: [
			{ id: 'alpha-hold', hook: 'alpha.cjs', mode: 'enforce' },
			{ id: 'beta-hold', hook: 'beta.cjs', mode: 'enforce' },
		],
	});
	const r = runCheck(dir, [dir, '--base', 'v1.0.0']);
	assert.equal(r.code, 0, r.out);
});

// why: catches the default base read by text or date, so the wrong tag is compared and a real drop goes unflagged
test('hold-check with no --base compares against the latest v* tag by version, not by text or by date', () => {
	const dir = repo();
	put(dir, { 'user/kit-hooks/alpha.cjs': hookText('alpha.cjs'), 'user/kit-hooks/holds.json': holdsText([{ id: 'alpha-hold', hook: 'alpha.cjs', mode: 'log' }]) });
	save(dir, 'release 1.9.0', 'v1.9.0');
	put(dir, { 'user/kit-hooks/holds.json': holdsText([{ id: 'alpha-hold', hook: 'alpha.cjs', mode: 'enforce' }]) });
	save(dir, 'release 1.10.0', 'v1.10.0');
	// A newer non-v tag holds the hold as log; only v* tags may serve as the default base.
	put(dir, { 'user/kit-hooks/holds.json': holdsText([{ id: 'alpha-hold', hook: 'alpha.cjs', mode: 'log' }]) });
	save(dir, 'old build', 'old-build');
	const r = runCheck(dir, [dir]);
	assert.equal(r.code, 1, r.out);
	assert.match(r.out, /alpha-hold/);
});

// why: catches --base ignored, so a check against an older release passes or fails for the wrong tag
test('hold-check with --base checks against the named ref, not the latest tag', () => {
	const dir = repo();
	put(dir, { 'user/kit-hooks/alpha.cjs': hookText('alpha.cjs'), 'user/kit-hooks/holds.json': holdsText([{ id: 'alpha-hold', hook: 'alpha.cjs', mode: 'enforce' }]) });
	save(dir, 'release 1.9.0', 'v1.9.0');
	put(dir, { 'user/kit-hooks/holds.json': holdsText([{ id: 'alpha-hold', hook: 'alpha.cjs', mode: 'log' }]) });
	save(dir, 'release 1.10.0', 'v1.10.0');
	const r = runCheck(dir, [dir, '--base', 'v1.9.0']);
	assert.equal(r.code, 1, r.out);
	assert.match(r.out, /alpha-hold/);
});

// why: catches a check run outside a git repo that exits 0 and passes a release it could not compare
test('hold-check exits 2 when the kit dir is not a git repo', () => {
	const dir = kitTemp.makeTemp('hold-plain-');
	put(dir, { 'user/kit-hooks/holds.json': holdsText([{ id: 'alpha-hold', hook: 'alpha.cjs', mode: 'log' }]), 'user/kit-hooks/alpha.cjs': hookText('alpha.cjs') });
	// The ceiling stops git from finding an enclosing repo above the temp folder.
	const r = runCheck(dir, [dir], { GIT_CEILING_DIRECTORIES: path.dirname(dir) });
	assert.equal(r.code, 2, r.out);
});

// why: catches the kit dir argument ignored, so a check run from another folder reads the wrong kit's holds
test('hold-check reads the kit dir it is given, not the folder it is run from', () => {
	const kit = scenario({
		before: [{ id: 'alpha-hold', hook: 'alpha.cjs', mode: 'enforce' }],
		hooks: ['alpha.cjs'],
		after: [{ id: 'alpha-hold', hook: 'alpha.cjs', mode: 'log' }],
	});
	const elsewhere = kitTemp.makeTemp('hold-elsewhere-');
	const r = runCheck(elsewhere, [kit, '--base', 'v1.0.0']);
	assert.equal(r.code, 1, r.out);
	assert.match(r.out, /alpha-hold/);
});

// why: catches a hook named by a path that climbs out of user/kit-hooks or nests in it, which passes because the file exists
test('hold-check exits 1 when a hold names its hook by a path, even when that path is a real file', () => {
	const dir = scenario({
		before: undefined,
		after: [
			{ id: 'beta-hold', hook: '../escape.cjs', mode: 'log' },
			{ id: 'gamma-hold', hook: 'sub/nested.cjs', mode: 'log' },
			{ id: 'ok-hold', hook: 'ok.cjs', mode: 'log' },
		],
		hooks: ['ok.cjs'],
	});
	put(dir, { 'user/escape.cjs': hookText('escape.cjs'), 'user/kit-hooks/sub/nested.cjs': hookText('nested.cjs') });
	const r = runCheck(dir, [dir, '--base', 'v1.0.0']);
	assert.equal(r.code, 1, r.out);
	assert.match(r.out, /beta-hold/);
	assert.match(r.out, /gamma-hold/);
	// Control: a plain file name that exists is not named.
	assert.doesNotMatch(r.out, /ok-hold/);
});

// why: catches a duplicate hold id read by its first entry, so a log entry beside an enforce one drops the enforce hold unnoticed
test('hold-check reads a duplicate hold id as enforce unless every entry for it says log', () => {
	const mixed = scenario({
		before: [{ id: 'alpha-hold', hook: 'alpha.cjs', mode: 'enforce' }],
		hooks: ['alpha.cjs'],
		after: [{ id: 'alpha-hold', hook: 'alpha.cjs', mode: 'log' }, { id: 'alpha-hold', hook: 'alpha.cjs', mode: 'enforce' }],
	});
	const kept = runCheck(mixed, [mixed, '--base', 'v1.0.0']);
	assert.equal(kept.code, 0, kept.out);
	const allLog = scenario({
		before: [{ id: 'alpha-hold', hook: 'alpha.cjs', mode: 'enforce' }],
		hooks: ['alpha.cjs'],
		after: [{ id: 'alpha-hold', hook: 'alpha.cjs', mode: 'log' }, { id: 'alpha-hold', hook: 'alpha.cjs', mode: 'log' }],
	});
	const dropped = runCheck(allLog, [allLog, '--base', 'v1.0.0']);
	assert.equal(dropped.code, 1, dropped.out);
	assert.match(dropped.out, /alpha-hold/);
});

// why: catches a bad --base, a base holds.json that is no holds list, or a bad argument passing as a clean check
test('hold-check exits 2 for a base that is no commit, a base holds.json that is no list, and a bad argument', () => {
	const dir = scenario({
		before: [{ id: 'alpha-hold', hook: 'alpha.cjs', mode: 'enforce' }],
		hooks: ['alpha.cjs'],
	});
	assert.equal(runCheck(dir, [dir, '--base', 'v9.9.9']).code, 2, 'a base that is no commit');
	assert.equal(runCheck(dir, [dir, '--base']).code, 2, '--base with no ref');
	assert.equal(runCheck(dir, [dir, '--no-such-flag']).code, 2, 'an unknown argument');
	const bad = repo();
	put(bad, { 'user/kit-hooks/holds.json': '{"holds":"x"}\n' });
	save(bad, 'release 1.0.0', 'v1.0.0');
	const r = runCheck(bad, [bad, '--base', 'v1.0.0']);
	assert.equal(r.code, 2, r.out);
	assert.match(r.out, /does not read as a holds list/);
});

// why: catches the default base picked by tag creation date, so a v1.9.0 tagged after v1.10.0 reads as the latest release
test('hold-check with no --base takes the highest v* version when a lower one was tagged later', () => {
	const dir = repo();
	put(dir, { 'user/kit-hooks/alpha.cjs': hookText('alpha.cjs'), 'user/kit-hooks/holds.json': holdsText([{ id: 'alpha-hold', hook: 'alpha.cjs', mode: 'enforce' }]) });
	save(dir, 'release 1.10.0', 'v1.10.0');
	put(dir, { 'user/kit-hooks/holds.json': holdsText([{ id: 'alpha-hold', hook: 'alpha.cjs', mode: 'log' }]) });
	save(dir, 'release 1.9.0', 'v1.9.0');
	const r = runCheck(dir, [dir]);
	assert.equal(r.code, 1, r.out);
	assert.match(r.out, /alpha-hold/);
});

// why: guards rule:agent-role-table (an enforce hold that agent-model logs and passes lets a model mismatch through)
test('agent-model refuses a model-mismatch call when its hold reads enforce, and passes and logs it under log', () => {
	assert.ok(fs.existsSync(AGENT_MODEL), 'user/kit-hooks/agent-model.cjs is missing');
	assert.ok(fs.existsSync(HOLD_MODE), 'user/kit-hooks/hold-mode.cjs is missing');
	const hookDir = kitTemp.makeTemp('agent-model-modes-');
	fs.copyFileSync(AGENT_MODEL, path.join(hookDir, 'agent-model.cjs'));
	fs.copyFileSync(HOLD_MODE, path.join(hookDir, 'hold-mode.cjs'));
	const config = roleConfig({ 'opus-role': 'opus' });
	const env = { KIT_CLAUDE_HOME: config, CLAUDE_CONFIG_DIR: config };
	const calls = [{ subagent_type: 'opus-role', model: 'haiku' }, { subagent_type: 'opus-role', model: 'opus' }];
	const setMode = (mode) => fs.writeFileSync(path.join(hookDir, 'holds.json'), holdsText([{ id: 'agent-model', hook: 'agent-model.cjs', mode }]));
	const dir = repo();
	setMode('enforce');
	const enforced = checkCalls(hookDir, dir, calls, env);
	assert.equal(enforced.status, 0, enforced.stderr);
	const decisions = JSON.parse(enforced.stdout);
	assert.equal(decisions[0] && decisions[0].hookSpecificOutput && decisions[0].hookSpecificOutput.permissionDecision, 'deny', `the mismatch call is refused: ${enforced.stdout}`);
	assert.equal(decisions[1], null, 'the same-family call is not refused');
	setMode('log');
	const logged = checkCalls(hookDir, dir, calls, env);
	assert.equal(logged.status, 0, logged.stderr);
	assert.deepEqual(JSON.parse(logged.stdout), [null, null], 'under log neither call is refused');
	assert.match(agentLogText(dir), /"mode":"log"/);
});

// why: guards rule:agent-role-table (a hook copied without hold-mode.cjs must log its miss, never refuse or hide it)
test('agent-model marks a log row holdModeMissing when hold-mode.cjs is absent, and not when it is present', () => {
	assert.ok(fs.existsSync(AGENT_MODEL), 'user/kit-hooks/agent-model.cjs is missing');
	assert.ok(fs.existsSync(HOLD_MODE), 'user/kit-hooks/hold-mode.cjs is missing');
	const config = roleConfig({ 'opus-role': 'opus' });
	const env = { KIT_CLAUDE_HOME: config, CLAUDE_CONFIG_DIR: config };
	const call = [{ subagent_type: 'opus-role', model: 'haiku' }];
	const bare = kitTemp.makeTemp('agent-model-nohold-');
	fs.copyFileSync(AGENT_MODEL, path.join(bare, 'agent-model.cjs'));
	const dirBare = repo();
	const missing = checkCalls(bare, dirBare, call, env);
	assert.equal(missing.status, 0, missing.stderr);
	assert.deepEqual(JSON.parse(missing.stdout), [null], 'the fallback to log does not refuse the mismatch call');
	const rowBare = JSON.parse(agentLogText(dirBare).trim().split('\n')[0]);
	assert.equal(rowBare.mode, 'log');
	assert.equal(rowBare.holdModeMissing, true, JSON.stringify(rowBare));
	const full = kitTemp.makeTemp('agent-model-withhold-');
	fs.copyFileSync(AGENT_MODEL, path.join(full, 'agent-model.cjs'));
	fs.copyFileSync(HOLD_MODE, path.join(full, 'hold-mode.cjs'));
	fs.writeFileSync(path.join(full, 'holds.json'), holdsText([{ id: 'agent-model', hook: 'agent-model.cjs', mode: 'log' }]));
	const dirFull = repo();
	assert.equal(checkCalls(full, dirFull, call, env).status, 0);
	const rowFull = JSON.parse(agentLogText(dirFull).trim().split('\n')[0]);
	assert.equal('holdModeMissing' in rowFull, false, JSON.stringify(rowFull));
});

// why: catches a broken RECORD that handoff-gate only logs under enforce, so the hand-back reaches the lead with no refusal
test('handoff-gate refuses a broken RECORD block under enforce, and stays silent for a valid one or under log', () => {
	assert.ok(fs.existsSync(path.resolve('user/kit-hooks/handoff-gate.cjs')), 'user/kit-hooks/handoff-gate.cjs is missing');
	assert.ok(fs.existsSync(path.resolve('user/kit-tools/handoff.mjs')), 'user/kit-tools/handoff.mjs is missing');
	const kit = kitTemp.makeTemp('handoff-gate-kit-');
	fs.cpSync(path.resolve('user/kit-hooks'), path.join(kit, 'kit-hooks'), { recursive: true });
	fs.mkdirSync(path.join(kit, 'kit-tools'), { recursive: true });
	fs.copyFileSync(path.resolve('user/kit-tools/handoff.mjs'), path.join(kit, 'kit-tools', 'handoff.mjs'));
	const gate = path.join(kit, 'kit-hooks', 'handoff-gate.cjs');
	const setMode = (mode) => fs.writeFileSync(path.join(kit, 'kit-hooks', 'holds.json'), holdsText([{ id: 'handoff-gate', hook: 'handoff-gate.cjs', mode }]));
	const cwd = kitTemp.makeTemp('handoff-gate-repo-');
	spawnSync('git', ['-C', cwd, 'init', '-q', '-b', 'main'], { encoding: 'utf8' });
	const ROLE = '{"role": "builder", "commit": "abc1234"}';
	const FIELDS = { id: 'F1', severity: 'low', status: 'red', where: 'tests/a.test.mjs:1', claim: 'c', proof: 'p', fix: '-' };
	const broken = ['Prose.', 'RECORD:', ROLE, JSON.stringify({ ...FIELDS, proof: '' })].join('\n');
	const valid = ['Prose.', 'RECORD:', ROLE, JSON.stringify(FIELDS)].join('\n');
	const send = (message) => spawnSync(process.execPath, [gate], { encoding: 'utf8', input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message }, cwd }) });
	setMode('enforce');
	const refused = send(broken);
	assert.equal(refused.status, 0, refused.stderr);
	let out = null;
	assert.doesNotThrow(() => { out = JSON.parse(refused.stdout); }, `enforce prints a decision: ${refused.stdout}`);
	assert.equal(out && out.hookSpecificOutput && out.hookSpecificOutput.permissionDecision, 'deny', `the broken record is refused: ${refused.stdout}`);
	assert.equal(send(valid).stdout.trim(), '', 'a valid record is not refused');
	setMode('log');
	assert.equal(send(broken).stdout.trim(), '', 'under log the gate prints nothing');
});

// why: catches handoff.mjs warning about a missing clarity that the gate never logs, so the warning reaches no log
test('handoff-gate logs the missing-clarity warning for a valid tester record, and not once clarity is given', () => {
	const cwd = kitTemp.makeTemp('handoff-warn-repo-');
	spawnSync('git', ['-C', cwd, 'init', '-q', '-b', 'main'], { encoding: 'utf8' });
	const FIELDS = { id: 'F1', severity: 'low', status: 'red', where: 'tests/a.test.mjs:1', claim: 'c', proof: 'p', fix: '-' };
	const noClarity = ['Prose.', 'RECORD:', '{"role": "tester", "commit": "abc1234"}', JSON.stringify(FIELDS)].join('\n');
	const clear = ['Prose.', 'RECORD:', '{"role": "tester", "commit": "abc1234", "clarity": "clear"}', JSON.stringify(FIELDS)].join('\n');
	const send = (message) => spawnSync(process.execPath, [path.resolve('user/kit-hooks/handoff-gate.cjs')], { encoding: 'utf8', input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message }, cwd }) });
	const logFile = path.join(cwd, '.git', 'kit-guard-open.log');
	const rows = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
	const warned = send(noClarity);
	assert.equal(warned.status, 0, warned.stderr);
	assert.equal(warned.stdout.trim(), '', 'a warning is logged, never printed as a decision');
	assert.equal(rows().length, 1, 'one row for the missing clarity');
	assert.match(JSON.stringify(rows()[0].warnings), /missing clarity/);
	assert.equal(send(clear).status, 0);
	assert.equal(rows().length, 1, 'a record with clarity adds no row');
});

// why: catches H5 a why-less new test in a hand-back RECORD reaching the lead because the shipped handoff-gate hold only logs
test('H5: with holds.json as shipped, a hand-back whose RECORD lists a why-less new test is refused, even when the log write fails', () => {
	const cwd = kitTemp.makeTemp('handoff-h5-repo-');
	git(cwd, ['init', '-q', '-b', 'main']);
	fs.mkdirSync(path.join(cwd, 'tests'));
	fs.writeFileSync(path.join(cwd, 'tests', 'a.test.mjs'), "// why: catches an old one that the repo already had in it\ntest('old one', () => {});\n");
	git(cwd, ['add', '-A']);
	git(cwd, ['commit', '-q', '-m', 'test: first']);
	fs.appendFileSync(path.join(cwd, 'tests', 'a.test.mjs'), "test('new one', () => {});\n");
	git(cwd, ['add', '-A']);
	git(cwd, ['commit', '-q', '-m', 'test: add a why-less one']);
	const sha = git(cwd, ['rev-parse', 'HEAD']);
	const FIELDS = { id: 'F1', severity: 'low', status: 'red', where: 'tests/a.test.mjs:2', claim: 'c', proof: 'p', fix: '-' };
	const role = { role: 'tester', commit: sha, clarity: 'clear', tests: [{ name: 'new one', why: '// why: catches a new one that the record lists with a why' }] };
	const message = ['Prose.', 'RECORD:', JSON.stringify(role), JSON.stringify(FIELDS)].join('\n');
	const send = () => spawnSync(process.execPath, [path.resolve('user/kit-hooks/handoff-gate.cjs')], { encoding: 'utf8', input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message }, cwd }) });
	const refused = send();
	assert.equal(refused.status, 0, refused.stderr);
	let out = null;
	assert.doesNotThrow(() => { out = JSON.parse(refused.stdout); }, `a decision is printed: ${refused.stdout}`);
	assert.equal(out && out.hookSpecificOutput && out.hookSpecificOutput.permissionDecision, 'deny', `the why-less new test is refused: ${refused.stdout}`);
	assert.ok(out.hookSpecificOutput.permissionDecisionReason.includes('tests/a.test.mjs::new one'), out.hookSpecificOutput.permissionDecisionReason);
	// the deny holds when the log cannot be written: the log path is a directory
	const common = path.join(cwd, '.git');
	fs.rmSync(path.join(common, 'kit-guard-open.log'), { force: true });
	fs.mkdirSync(path.join(common, 'kit-guard-open.log'));
	const unlogged = send();
	assert.match(unlogged.stdout, /"permissionDecision":"deny"/, `no deny when the log write fails: ${unlogged.stdout}`);
});

// why: guards rule:agent-role-table (a model named in full or in capitals must not pass the family check under enforce)
test('agent-model denies a full or capitalised model name of another family, passes its own full id, and repeats its verdict', () => {
	assert.ok(fs.existsSync(AGENT_MODEL), 'user/kit-hooks/agent-model.cjs is missing');
	assert.ok(fs.existsSync(HOLD_MODE), 'user/kit-hooks/hold-mode.cjs is missing');
	const hookDir = kitTemp.makeTemp('agent-model-bypass-');
	fs.copyFileSync(AGENT_MODEL, path.join(hookDir, 'agent-model.cjs'));
	fs.copyFileSync(HOLD_MODE, path.join(hookDir, 'hold-mode.cjs'));
	fs.writeFileSync(path.join(hookDir, 'holds.json'), holdsText([{ id: 'agent-model', hook: 'agent-model.cjs', mode: 'enforce' }]));
	const config = roleConfig({ 'opus-role': 'opus' });
	const env = { KIT_CLAUDE_HOME: config, CLAUDE_CONFIG_DIR: config };
	const calls = [{ subagent_type: 'opus-role', model: 'claude-haiku-4-5' }, { subagent_type: 'opus-role', model: 'HAIKU' }, { subagent_type: 'opus-role', model: 'claude-opus-4-5' }];
	const verdicts = () => {
		const r = checkCalls(hookDir, repo(), calls, env);
		assert.equal(r.status, 0, r.stderr);
		return JSON.parse(r.stdout).map((o) => (o && o.hookSpecificOutput ? o.hookSpecificOutput.permissionDecision : null));
	};
	const first = verdicts();
	assert.deepEqual(first, ['deny', 'deny', null], `a full id and a capitalised name of haiku are refused against opus: ${first}`);
	assert.deepEqual(verdicts(), first, 'a repeat run gives the same verdict');
});

// why: guards rule:agent-role-table (a damaged holds list or an unknown mode must read as enforce, and the row must show it)
test('agent-model reads a corrupt holds.json or an unknown mode as enforce, and logs the mode it read', () => {
	const config = roleConfig({ 'opus-role': 'opus' });
	const env = { KIT_CLAUDE_HOME: config, CLAUDE_CONFIG_DIR: config };
	assert.ok(fs.existsSync(AGENT_MODEL), 'agent-model.cjs is missing');
	assert.ok(fs.existsSync(HOLD_MODE), 'hold-mode.cjs is missing');
	const damaged = ['{oops', holdsText([{ id: 'agent-model', hook: 'agent-model.cjs', mode: 'warn' }])];
	for (const text of damaged) {
		const hookDir = kitTemp.makeTemp('agent-model-failclosed-');
		fs.copyFileSync(AGENT_MODEL, path.join(hookDir, 'agent-model.cjs'));
		fs.copyFileSync(HOLD_MODE, path.join(hookDir, 'hold-mode.cjs'));
		fs.writeFileSync(path.join(hookDir, 'holds.json'), text);
		const dir = repo();
		const r = checkCalls(hookDir, dir, [{ subagent_type: 'opus-role', model: 'haiku' }], env);
		assert.equal(r.status, 0, r.stderr);
		const d = JSON.parse(r.stdout)[0];
		assert.equal(d && d.hookSpecificOutput && d.hookSpecificOutput.permissionDecision, 'deny', `a damaged list stops the mismatch: ${text}`);
		assert.equal(JSON.parse(agentLogText(dir).trim().split('\n')[0]).mode, 'enforce', `the row logs enforce: ${text}`);
	}
});

// why: catches a damaged hand-back record that handoff-gate logs but never refuses under enforce, and a repeat changing its verdict
test('handoff-gate refuses a non-JSON line, a missing role line, a missing field, and a CRLF broken record under enforce', () => {
	assert.ok(fs.existsSync(path.resolve('user/kit-hooks/handoff-gate.cjs')), 'user/kit-hooks/handoff-gate.cjs is missing');
	assert.ok(fs.existsSync(path.resolve('user/kit-tools/handoff.mjs')), 'user/kit-tools/handoff.mjs is missing');
	const kit = kitTemp.makeTemp('handoff-gate-bypass-');
	fs.cpSync(path.resolve('user/kit-hooks'), path.join(kit, 'kit-hooks'), { recursive: true });
	fs.mkdirSync(path.join(kit, 'kit-tools'), { recursive: true });
	fs.copyFileSync(path.resolve('user/kit-tools/handoff.mjs'), path.join(kit, 'kit-tools', 'handoff.mjs'));
	fs.writeFileSync(path.join(kit, 'kit-hooks', 'holds.json'), holdsText([{ id: 'handoff-gate', hook: 'handoff-gate.cjs', mode: 'enforce' }]));
	const gate = path.join(kit, 'kit-hooks', 'handoff-gate.cjs');
	const cwd = kitTemp.makeTemp('handoff-gate-bypass-repo-');
	spawnSync('git', ['-C', cwd, 'init', '-q', '-b', 'main'], { encoding: 'utf8' });
	const ROLE = '{"role": "builder", "commit": "abc1234"}';
	const FIELDS = { id: 'F1', severity: 'low', status: 'red', where: 'tests/a.test.mjs:1', claim: 'c', proof: 'p', fix: '-' };
	const send = (message) => spawnSync(process.execPath, [gate], { encoding: 'utf8', input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message }, cwd }) });
	const verdict = (message) => {
		const r = send(message);
		assert.equal(r.status, 0, r.stderr);
		const d = r.stdout.trim() ? JSON.parse(r.stdout) : null;
		return d && d.hookSpecificOutput ? d.hookSpecificOutput.permissionDecision : null;
	};
	const cases = {
		'a non-JSON line': ['Prose.', 'RECORD:', ROLE, 'not json'].join('\n'),
		'a missing role line': ['Prose.', 'RECORD:', JSON.stringify(FIELDS)].join('\n'),
		'a missing field': ['Prose.', 'RECORD:', ROLE, JSON.stringify({ ...FIELDS, proof: undefined })].join('\n'),
		'a CRLF broken record': ['Prose.', 'RECORD:', ROLE, JSON.stringify({ ...FIELDS, proof: '' })].join('\r\n'),
	};
	for (const [name, message] of Object.entries(cases)) {
		const first = verdict(message);
		assert.equal(first, 'deny', `${name} is refused under enforce`);
		assert.equal(verdict(message), first, `${name} gives the same verdict on a repeat`);
	}
	// Folded control (was its own test): a valid record is not refused.
	assert.equal(verdict(['Prose.', 'RECORD:', ROLE, JSON.stringify(FIELDS)].join('\n')), null, 'a valid record is not refused');
});

// why: guards rule:agent-role-table (a plugin-named role call, kit:checker, must read as its bare role file under enforce)
test('agent-model reads a plugin role name as its bare role file, refusing a mismatch under enforce', () => {
	assert.ok(fs.existsSync(AGENT_MODEL), 'user/kit-hooks/agent-model.cjs is missing');
	assert.ok(fs.existsSync(HOLD_MODE), 'user/kit-hooks/hold-mode.cjs is missing');
	const hookDir = kitTemp.makeTemp('agent-model-plugin-');
	fs.copyFileSync(AGENT_MODEL, path.join(hookDir, 'agent-model.cjs'));
	fs.copyFileSync(HOLD_MODE, path.join(hookDir, 'hold-mode.cjs'));
	fs.writeFileSync(path.join(hookDir, 'holds.json'), holdsText([{ id: 'agent-model', hook: 'agent-model.cjs', mode: 'enforce' }]));
	const config = roleConfig({ checker: 'opus' });
	const env = { KIT_CLAUDE_HOME: config, CLAUDE_CONFIG_DIR: config };
	const dir = repo();
	const calls = [{ subagent_type: 'kit:checker', model: 'haiku' }, { subagent_type: 'checker', model: 'haiku' }, { subagent_type: 'kit:checker', model: 'opus' }];
	const run = checkCalls(hookDir, dir, calls, env);
	assert.equal(run.status, 0, run.stderr);
	const [plugin, bare, same] = JSON.parse(run.stdout);
	assert.equal(plugin && plugin.hookSpecificOutput && plugin.hookSpecificOutput.permissionDecision, 'deny', `kit:checker on haiku is refused: ${run.stdout}`);
	// Folded control: the bare name is refused the same way, and kit:checker on its own family is not refused.
	assert.equal(bare && bare.hookSpecificOutput && bare.hookSpecificOutput.permissionDecision, 'deny', `checker on haiku is refused: ${run.stdout}`);
	assert.equal(same, null, 'kit:checker on opus is not refused');
});

// why: catches a checker that exits other than 0 or 1 leaving no row, so a broken hand-back check fails with nothing logged
test('handoff-gate logs a row with checkerExit when handoff.mjs exits with a code other than 0 or 1, and prints nothing', () => {
	const kit = kitTemp.makeTemp('handoff-gate-exit-');
	fs.cpSync(path.resolve('user/kit-hooks'), path.join(kit, 'kit-hooks'), { recursive: true });
	fs.mkdirSync(path.join(kit, 'kit-tools'), { recursive: true });
	fs.writeFileSync(path.join(kit, 'kit-tools', 'handoff.mjs'), 'process.exit(3);\n');
	fs.writeFileSync(path.join(kit, 'kit-hooks', 'holds.json'), holdsText([{ id: 'handoff-gate', hook: 'handoff-gate.cjs', mode: 'enforce' }]));
	const cwd = kitTemp.makeTemp('handoff-gate-exit-repo-');
	spawnSync('git', ['-C', cwd, 'init', '-q', '-b', 'main'], { encoding: 'utf8' });
	const message = ['Prose.', 'RECORD:', '{"role": "builder", "commit": "abc1234"}', '{"id": "F1"}'].join('\n');
	const r = spawnSync(process.execPath, [path.join(kit, 'kit-hooks', 'handoff-gate.cjs')], { encoding: 'utf8', input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message }, cwd }) });
	assert.equal(r.status, 0, r.stderr);
	assert.equal(r.stdout.trim(), '', `a checker exit 3 refuses nothing: ${r.stdout}`);
	const logFile = path.join(cwd, '.git', 'kit-guard-open.log');
	const rows = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
	assert.equal(rows.length, 1, `one row for the checker exit: ${JSON.stringify(rows)}`);
	assert.equal(rows[0].checkerExit, 3, JSON.stringify(rows[0]));
});
