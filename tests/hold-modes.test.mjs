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
test('holds.json lists the agent-model and handoff-gate holds, both in log mode', () => {
	let holds;
	assert.doesNotThrow(() => { holds = JSON.parse(fs.readFileSync(REAL_HOLDS, 'utf8')).holds; }, 'user/kit-hooks/holds.json reads as JSON with a holds list');
	const byId = Object.fromEntries(holds.map((h) => [h.id, h]));
	assert.deepEqual(byId['agent-model'] && { hook: byId['agent-model'].hook, mode: byId['agent-model'].mode }, { hook: 'agent-model.cjs', mode: 'log' });
	assert.deepEqual(byId['handoff-gate'] && { hook: byId['handoff-gate'].hook, mode: byId['handoff-gate'].mode }, { hook: 'handoff-gate.cjs', mode: 'log' });
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

// why: guards rule:kit-standards (a log-only guard refuses when its list is damaged)
test('agent-model never refuses in build 24, even when its hold reads enforce', () => {
	assert.ok(fs.existsSync(AGENT_MODEL), 'agent-model.cjs is missing');
	const hookDir = kitTemp.makeTemp('agent-model-enforce-');
	fs.copyFileSync(AGENT_MODEL, path.join(hookDir, 'agent-model.cjs'));
	fs.writeFileSync(path.join(hookDir, 'hold-mode.cjs'), `'use strict';\nmodule.exports = { mode() { return 'enforce'; } };\n`);
	const config = roleConfig({ 'opus-role': 'opus' });
	const dir = repo();
	const run = checkCalls(hookDir, dir, [{ subagent_type: 'no-such-role' }, { subagent_type: 'opus-role', model: 'haiku' }], { KIT_CLAUDE_HOME: config, CLAUDE_CONFIG_DIR: config });
	assert.equal(run.status, 0, `agent-model.cjs check ran: ${run.stderr}`);
	assert.deepEqual(JSON.parse(run.stdout), [null, null], 'neither the no-role-file call nor the model-mismatch call is refused');
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
