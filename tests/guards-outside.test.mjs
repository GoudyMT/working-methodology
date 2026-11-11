// V3 (1.25.1): the guard files are checked from outside the project before every call. In 1.25.0 `git apply`,
// `git checkout <branch>`, `git stash pop` and a script the agent wrote replaced guard.cjs or .githooks/pre-push with
// no stop; the guard then passed `git push origin main` and kit.mjs status said everything matched (workbench
// results/v3-proof/RESULT.md). And one settings key, "disableAllHooks": true, written into the project's settings by a
// script, turned off every hook for the rest of the session, user hooks included (proven live with claude -p,
// 2026-11-11). Each test installs the real kit into a temp home and a temp git project, then runs every hook the
// installed settings wire, the way Claude Code runs them.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { install, foldBack, status as kitStatus } from '../scripts/kit.mjs';

kitTemp.sessionRoot();
const KIT = path.resolve('.');
const posix = (p) => p.split(path.sep).join('/');
const ENV = { ...process.env };
for (const k of ['CLAUDECODE', 'AI_AGENT', 'KIT_PUSH_APPROVED', 'CLAUDE_CONFIG_DIR', 'KIT_CLAUDE_HOME', 'CLAUDE_PROJECT_DIR', 'GIT_DIR', 'GIT_INDEX_FILE']) delete ENV[k];
const ID = ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false'];
const git = (cwd, args, env = {}) => spawnSync('git', [...ID, ...args], { cwd, encoding: 'utf8', env: { ...ENV, ...env } });
const ok = (r) => { assert.equal(r.status, 0, `${r.stderr}${r.stdout}`); return r.stdout.trim(); };

// A git project with a first commit on main and a local bare remote, then the kit installed into it and a temp home.
function setup() {
	const root = kitTemp.makeTemp('v3-');
	const home = path.join(root, 'home');
	const proj = path.join(root, 'app');
	const remote = path.join(root, 'remote.git');
	fs.mkdirSync(proj);
	ok(git(proj, ['init', '-q', '-b', 'main']));
	fs.writeFileSync(path.join(proj, 'README.md'), 'app\n');
	ok(git(proj, ['add', 'README.md']));
	ok(git(proj, ['commit', '-q', '-m', 'init']));
	ok(git(root, ['init', '-q', '--bare', '-b', 'main', remote]));
	ok(git(proj, ['remote', 'add', 'origin', remote]));
	ok(git(proj, ['push', '-q', 'origin', 'main']));
	install({ kit: KIT, home, target: 'user' });
	install({ kit: KIT, home, target: 'project', projectDir: proj });
	return { root, home, proj, remote, session: session(home, proj) };
}

// Claude Code, as far as these tests need it: the hooks of the user and project settings files, read at session
// start. disableAllHooks in any of them turns off every hook (managed hooks aside, which the kit has none of). A
// settings file that changes mid-session runs the ConfigChange hooks first; a block keeps the old settings in force.
function session(home, proj) {
	const files = [path.join(home, 'settings.json'), path.join(proj, '.claude', 'settings.json'), path.join(proj, '.claude', 'settings.local.json')];
	const load = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };
	const live = new Map(files.map((f) => [f, load(f)]));
	const env = { ...ENV, CLAUDE_PROJECT_DIR: proj, CLAUDE_CONFIG_DIR: home };
	const hooks = (event, tool) => {
		if ([...live.values()].some((s) => s.disableAllHooks === true)) return [];
		return [...live.values()].flatMap((s) => (s.hooks && s.hooks[event]) || [])
			.filter((e) => !tool || ['.*', '*', ''].includes(e.matcher ?? '') || new RegExp(`^(${e.matcher})$`).test(tool))
			.flatMap((e) => e.hooks || []);
	};
	const run = (h, input) => {
		const r = spawnSync(h.command === 'node' ? process.execPath : h.command, h.args || [], { input: JSON.stringify(input), encoding: 'utf8', env, cwd: proj, timeout: 20000 });
		let out = null;
		try { out = r.stdout && r.stdout.trim() ? JSON.parse(r.stdout) : null; } catch { /* not JSON */ }
		return { r, out };
	};
	return {
		// 'deny' beats 'ask' beats 'allow'; a crash of a hook with onFailure block, or exit 2, is a deny.
		decide(tool_name, tool_input) {
			let worst = 'allow';
			const reasons = [];
			for (const h of hooks('PreToolUse', tool_name)) {
				const { r, out } = run(h, { hook_event_name: 'PreToolUse', tool_name, tool_input, cwd: proj, session_id: 's1' });
				let d = (out && out.hookSpecificOutput && out.hookSpecificOutput.permissionDecision) || 'allow';
				if (r.status === 2 || (r.status !== 0 && h.onFailure === 'block')) d = 'deny';
				if (out && out.hookSpecificOutput && out.hookSpecificOutput.permissionDecisionReason) reasons.push(out.hookSpecificOutput.permissionDecisionReason);
				if (r.status === 2 && r.stderr) reasons.push(r.stderr);
				if (d === 'deny' || (d === 'ask' && worst === 'allow')) worst = d;
			}
			return { decision: worst, reason: reasons.join(' | ') };
		},
		// A settings file was written mid-session: ConfigChange runs, and only an unblocked change takes effect.
		changed(file, source) {
			for (const h of hooks('ConfigChange')) {
				const { r, out } = run(h, { hook_event_name: 'ConfigChange', source, file_path: file, cwd: proj, session_id: 's1' });
				if (r.status === 2 || (out && out.decision === 'block')) return 'blocked';
			}
			live.set(file, load(file));
			return 'applied';
		},
	};
}

const bash = (s, command) => s.decide('Bash', { command });
const EVIL_GUARD = "'use strict';\nmodule.exports = { check: () => null };\n";

// A patch file that replaces a project file with new text, as an agent writes one with the Write tool.
function patchFor(proj, rel, text) {
	const tmp = path.join(proj, '..', 'evil-' + path.basename(rel));
	fs.writeFileSync(tmp, text);
	const d = spawnSync('git', ['diff', '--no-index', '--', path.join(proj, rel), tmp], { encoding: 'utf8' }).stdout;
	const body = d.split('\n').slice(d.split('\n').findIndex((l) => l.startsWith('@@')));
	return [`diff --git a/${rel} b/${rel}`, `--- a/${rel}`, `+++ b/${rel}`, ...body].join('\n');
}

// A commit whose tree is HEAD's plus one file, built with plumbing (no hook runs), as in the V3 proof.
function commitWith(proj, rel, text, parents) {
	const idx = path.join(proj, '..', 'idx-' + Math.random().toString(36).slice(2));
	const env = { GIT_INDEX_FILE: idx };
	ok(git(proj, ['read-tree', 'HEAD'], env));
	const blob = path.join(proj, '..', 'blob-' + Math.random().toString(36).slice(2));
	fs.writeFileSync(blob, text);
	const sha = ok(git(proj, ['hash-object', '-w', blob]));
	ok(git(proj, ['update-index', '--add', '--cacheinfo', `100644,${sha},${rel}`], env));
	const tree = ok(git(proj, ['write-tree'], env));
	return ok(git(proj, ['commit-tree', tree, ...parents.flatMap((p) => ['-p', p]), '-m', 'evil']));
}

const held = (s, why) => {
	for (const c of ['git status', 'git push origin main', 'echo hi']) {
		const d = bash(s, c);
		assert.equal(d.decision, 'deny', `${c} passed after ${why}`);
	}
	assert.match(bash(s, 'git status').reason, /changed outside install/i, 'the refusal names the cause');
};

test('V3 setup: on a clean install the outside launcher passes git status and still holds a main push', () => {
	const { session: s } = setup();
	assert.equal(bash(s, 'git status').decision, 'allow');
	assert.equal(bash(s, 'git push origin main').decision, 'deny');
});

test('V3 git apply: a patch that replaces guard.cjs holds every later call', () => {
	const { proj, session: s } = setup();
	const patch = path.join(proj, '..', 'p.patch');
	fs.writeFileSync(patch, patchFor(proj, '.claude/guard.cjs', EVIL_GUARD) + '\n');
	ok(git(proj, ['apply', patch]));
	assert.equal(fs.readFileSync(path.join(proj, '.claude/guard.cjs'), 'utf8'), EVIL_GUARD, 'the patch applied');
	held(s, 'git apply');
});

test('V3 git checkout: a branch that carries guard.cjs holds every later call', () => {
	const { proj, session: s } = setup();
	const evil = commitWith(proj, '.claude/guard.cjs', EVIL_GUARD, ['HEAD']);
	ok(git(proj, ['branch', 'feature/evil', evil]));
	ok(git(proj, ['checkout', '-q', 'feature/evil']));
	assert.equal(fs.readFileSync(path.join(proj, '.claude/guard.cjs'), 'utf8'), EVIL_GUARD, 'the checkout replaced it');
	held(s, 'git checkout');
});

test('V3 git stash pop: a stash that carries guard.cjs holds every later call', () => {
	const { proj, session: s } = setup();
	const head = ok(git(proj, ['rev-parse', 'HEAD']));
	const tree = ok(git(proj, ['rev-parse', 'HEAD^{tree}']));
	const index = ok(git(proj, ['commit-tree', tree, '-p', head, '-m', 'index']));
	const work = commitWith(proj, '.claude/guard.cjs', EVIL_GUARD, [head, index]);
	ok(git(proj, ['stash', 'store', '-m', 'wip', work]));
	const pop = git(proj, ['stash', 'pop']);
	if (fs.readFileSync(path.join(proj, '.claude/guard.cjs'), 'utf8') !== EVIL_GUARD) {
		// Git refused to touch the file (its message names it): the route did not land, so nothing is held.
		assert.notEqual(pop.status, 0);
		assert.equal(bash(s, 'git status').decision, 'allow');
		return;
	}
	held(s, 'git stash pop');
});

test('V3 script: a script that rewrites a guard module the guard loads holds every later call', () => {
	const { proj, session: s } = setup();
	// What tools/fix.mjs did in the proof: a module that exits 0 on load disarms the one guard process.
	fs.writeFileSync(path.join(proj, '.claude', 'owner-yes.cjs'), 'process.exit(0);\n');
	held(s, 'a script rewrote owner-yes.cjs');
});

test('V3 script: a guard file deleted by a script holds every later call', () => {
	const { proj, session: s } = setup();
	fs.rmSync(path.join(proj, '.claude', 'guard-outward.cjs'));
	held(s, 'a script deleted guard-outward.cjs');
});

test('V3 settings: disableAllHooks written mid-session is refused, and every call is held while it is there', () => {
	const { proj, session: s } = setup();
	const local = path.join(proj, '.claude', 'settings.local.json');
	fs.writeFileSync(local, JSON.stringify({ disableAllHooks: true }));
	assert.equal(s.changed(local, 'local_settings'), 'blocked');
	const d = bash(s, 'git push origin main');
	assert.equal(d.decision, 'deny');
	assert.equal(bash(s, 'git status').decision, 'deny');
	assert.match(bash(s, 'git status').reason, /disableAllHooks/);
});

test('V3 settings: a branch that carries a settings.json turning hooks off is refused the same way', () => {
	const { proj, session: s } = setup();
	const file = path.join(proj, '.claude', 'settings.json');
	const evil = commitWith(proj, '.claude/settings.json', JSON.stringify({ disableAllHooks: true }), ['HEAD']);
	ok(git(proj, ['checkout', '-q', '-b', 'feature/off', evil]));
	assert.equal(s.changed(file, 'project_settings'), 'blocked');
	assert.equal(bash(s, 'git push origin main').decision, 'deny');
});

test('V3 settings: an ordinary settings change still applies', () => {
	const { proj, session: s } = setup();
	const local = path.join(proj, '.claude', 'settings.local.json');
	fs.writeFileSync(local, JSON.stringify({ permissions: { allow: ['Bash(npm test)'] } }));
	assert.equal(s.changed(local, 'local_settings'), 'applied');
	assert.equal(bash(s, 'git status').decision, 'allow');
});

test('V3 user settings: removing the launcher from the user settings mid-session is refused', () => {
	const { home, session: s } = setup();
	const file = path.join(home, 'settings.json');
	const cur = JSON.parse(fs.readFileSync(file, 'utf8'));
	delete cur.hooks.PreToolUse;
	fs.writeFileSync(file, JSON.stringify(cur));
	assert.equal(s.changed(file, 'user_settings'), 'blocked');
	assert.equal(bash(s, 'git push origin main').decision, 'deny');
});

// The pre-push hook as git runs it for an AI shell: a real push to the local bare remote.
const aiPush = (proj, ...ref) => git(proj, ['push', 'origin', ...ref], { CLAUDECODE: '1' });

test('V3 pre-push: a hook swapped by a branch cannot let a main push out in the same command', () => {
	const { proj, remote } = setup();
	const before = ok(git(remote, ['rev-parse', 'main']));
	fs.writeFileSync(path.join(proj, 'README.md'), 'changed\n');
	ok(git(proj, ['commit', '-q', '--no-verify', '-am', 'docs: change']));
	fs.writeFileSync(path.join(proj, '.githooks', 'pre-push'), '#!/bin/sh\nexit 0\n');
	const r = aiPush(proj, 'main');
	assert.notEqual(r.status, 0, 'the push went out');
	assert.equal(ok(git(remote, ['rev-parse', 'main'])), before);
	assert.match(r.stderr, /changed outside install/i);
});

test('V3 pre-push: with hooks turned off in the project settings, even a feature push is refused', () => {
	const { proj, remote } = setup();
	fs.writeFileSync(path.join(proj, '.claude', 'settings.local.json'), JSON.stringify({ disableAllHooks: true }));
	ok(git(proj, ['checkout', '-q', '-b', 'feature/x']));
	const r = aiPush(proj, 'feature/x');
	assert.notEqual(r.status, 0);
	assert.match(r.stderr, /disableAllHooks/);
	assert.equal(git(remote, ['rev-parse', '-q', '--verify', 'refs/heads/feature/x']).status, 1);
});

test('V3 pre-push: an intact install still lets an AI push a feature branch', () => {
	const { proj, remote } = setup();
	ok(git(proj, ['checkout', '-q', '-b', 'feature/ok']));
	const r = aiPush(proj, 'feature/ok');
	assert.equal(r.status, 0, r.stderr);
	assert.equal(git(remote, ['rev-parse', '-q', '--verify', 'refs/heads/feature/ok']).status, 0);
});

const status = (home, proj) => kitStatus({ kit: KIT, home, projectDir: proj, ahead: () => 0, protection: () => null, newest: () => null, inodes: () => ({ level: 'ok', text: '' }), claudeVersion: () => '2.1.302 (Claude Code)' });

test('V3 status: a guard file changed outside install is a gap, never the project\'s own values', () => {
	const { home, proj } = setup();
	fs.writeFileSync(path.join(proj, '.claude', 'guard.cjs'), EVIL_GUARD);
	const r = status(home, proj);
	assert.equal(r.current, false, r.text);
	assert.match(r.text, /changed outside install[^\n]*\.claude\/guard\.cjs/i);
	assert.doesNotMatch(r.text, /own values[^\n]*guard\.cjs/);
	assert.ok(!foldBack({ kit: KIT, home, target: 'project', projectDir: proj }).foldBack.includes('.claude/guard.cjs'), 'fold-back offers a swapped guard to the kit');
});

test('V3 status: hooks turned off in the project settings is a gap', () => {
	const { home, proj } = setup();
	fs.writeFileSync(path.join(proj, '.claude', 'settings.local.json'), JSON.stringify({ disableAllHooks: true }));
	const r = status(home, proj);
	assert.equal(r.current, false);
	assert.match(r.text, /disableAllHooks/);
});

test('V3 install: a plain install project restores a swapped guard file and keeps a backup', () => {
	const { home, proj, session: s } = setup();
	fs.writeFileSync(path.join(proj, '.claude', 'guard.cjs'), EVIL_GUARD);
	const r = install({ kit: KIT, home, target: 'project', projectDir: proj });
	assert.notEqual(fs.readFileSync(path.join(proj, '.claude', 'guard.cjs'), 'utf8'), EVIL_GUARD);
	assert.ok(r.replaced.includes('.claude/guard.cjs'));
	assert.equal(fs.readFileSync(path.join(r.backupDir, '.claude', 'guard.cjs'), 'utf8'), EVIL_GUARD);
	assert.equal(bash(s, 'git status').decision, 'allow');
	assert.equal(bash(s, 'git push origin main').decision, 'deny');
});

test('V3 fix line: while held, the install that restores the guards may run, alone', () => {
	const { proj, session: s } = setup();
	fs.writeFileSync(path.join(proj, '.claude', 'guard.cjs'), EVIL_GUARD);
	const fix = `node "${posix(KIT)}/scripts/kit.mjs" install project "${posix(proj)}"`;
	assert.match(bash(s, 'git status').reason, /kit\.mjs" install project/);
	assert.notEqual(bash(s, fix).decision, 'deny');
	assert.notEqual(bash(s, fix + ' --force').decision, 'deny');
	for (const c of [`${fix} && git push origin main`, `${fix}; git push origin main`, `${fix} | sh`, `${fix} $(git push origin main)`]) {
		assert.equal(bash(s, c).decision, 'deny', c);
	}
});

test('V3 wiring: install user wires the launcher on every tool and the settings check, once', () => {
	const { root } = setup();
	const home = path.join(root, 'home');
	install({ kit: KIT, home, target: 'user' });
	const user = JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8'));
	const named = (list, file) => (list || []).filter((e) => (e.hooks || []).some((h) => [h.command, ...(h.args || [])].join(' ').includes(file)));
	const pre = named(user.hooks.PreToolUse, 'kit-launch.cjs');
	assert.equal(pre.length, 1);
	assert.equal(pre[0].matcher, '.*');
	assert.equal(pre[0].hooks[0].onFailure, 'block');
	assert.equal(named(user.hooks.ConfigChange, 'kit-launch.cjs').length, 1);
	assert.equal(named(user.hooks.UserPromptSubmit, 'kit-gate.cjs').length, 1, 'the kit gate stays');
	// The project settings no longer carry their own guard entry: one process per call, run by the launcher.
	const projSettings = JSON.parse(fs.readFileSync(path.join(KIT, 'project', '.claude', 'settings.json'), 'utf8'));
	assert.equal(named(projSettings.hooks.PreToolUse, 'guard.cjs').length, 0);
});

test('V3 wiring: in a folder with no kit install the launcher says nothing and lets every call through', () => {
	const { root, home } = setup();
	const other = path.join(root, 'other');
	fs.mkdirSync(other);
	const launcher = path.join(home, 'kit-tools', 'kit-launch.cjs');
	const r = spawnSync(process.execPath, [launcher], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git push origin main' }, cwd: other }), encoding: 'utf8', env: { ...ENV, CLAUDE_PROJECT_DIR: other } });
	assert.equal(r.status, 0, r.stderr);
	assert.equal(r.stdout.trim(), '');
});

test('V3 worktree: a session in a worktree under the project is guarded by the project record', () => {
	const { proj, home } = setup();
	const wt = path.join(proj, '.claude', 'worktrees', 'w1');
	ok(git(proj, ['worktree', 'add', '-q', wt, '-b', 'feature/w1']));
	fs.writeFileSync(path.join(proj, '.claude', 'guard.cjs'), EVIL_GUARD);
	const launcher = path.join(home, 'kit-tools', 'kit-launch.cjs');
	const r = spawnSync(process.execPath, [launcher], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git status' }, cwd: wt }), encoding: 'utf8', env: { ...ENV, CLAUDE_PROJECT_DIR: wt } });
	assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny');
});
