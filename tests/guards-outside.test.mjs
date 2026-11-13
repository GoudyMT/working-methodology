// V3 (1.25.1): the guard files are checked from outside the project before every call. In 1.25.0 `git apply`,
// `git checkout <branch>`, `git stash pop` and a script the agent wrote replaced guard.cjs or .githooks/pre-push with
// no stop; the guard then passed `git push origin main` and kit.mjs status said everything matched (workbench
// results/v3-proof/RESULT.md). And one settings key, "disableAllHooks": true, written into the project's settings by a
// script, turned off every hook for the rest of the session, user hooks included (proven live with claude -p,
// 2026-11-11). Each test installs the real kit into a temp home and a temp git project, then runs every hook the
// installed settings wire, the way Claude Code runs them.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { createRequire } from 'node:module';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { install, foldBack, guardDir, releaseState, status as kitStatus } from '../scripts/kit.mjs';

kitTemp.sessionRoot();
const KIT = path.resolve('.');
const posix = (p) => p.split(path.sep).join('/');
// The fix line names the node install user recorded (here, the node running the tests), never `node` from PATH.
const NODE = posix(process.execPath);
const fixOf = (kit, proj, extra = '') => `"${NODE}" "${posix(kit)}/scripts/kit.mjs" install project "${posix(proj)}"${extra}`;
const ENV = { ...process.env };
for (const k of ['CLAUDECODE', 'AI_AGENT', 'KIT_PUSH_APPROVED', 'CLAUDE_CONFIG_DIR', 'KIT_CLAUDE_HOME', 'CLAUDE_PROJECT_DIR', 'GIT_DIR', 'GIT_INDEX_FILE']) delete ENV[k];
const ID = ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false'];
const git = (cwd, args, env = {}) => spawnSync('git', [...ID, ...args], { cwd, encoding: 'utf8', env: { ...ENV, ...env } });
const ok = (r) => { assert.equal(r.status, 0, `${r.stderr}${r.stdout}`); return r.stdout.trim(); };

// A git project with a first commit on main and a local bare remote, then the kit installed into it and a temp home.
function setup({ homeAt = '.claude', projName = 'app', before = () => {}, kit = KIT } = {}) {
	const root = kitTemp.makeTemp('v3-');
	// Named as the real one is, so the guards that read a path by its .claude folder see it as the owner's.
	const home = path.join(root, homeAt);
	const proj = path.join(root, projName);
	const remote = path.join(root, 'remote.git');
	fs.mkdirSync(proj);
	ok(git(proj, ['init', '-q', '-b', 'main']));
	fs.writeFileSync(path.join(proj, 'README.md'), 'app\n');
	ok(git(proj, ['add', 'README.md']));
	ok(git(proj, ['commit', '-q', '-m', 'init']));
	ok(git(root, ['init', '-q', '--bare', '-b', 'main', remote]));
	ok(git(proj, ['remote', 'add', 'origin', remote]));
	ok(git(proj, ['push', '-q', 'origin', 'main']));
	before(proj);
	install({ kit, home, target: 'user' });
	install({ kit, home, target: 'project', projectDir: proj });
	return { root, home, proj, remote, session: session(home, proj) };
}

// The shell Claude Code runs a hook's command line in: Git Bash on Windows, found beside git itself (never the bash PATH
// finds first, which from PowerShell is WSL's: B17); bash elsewhere.
function gitBash() {
	if (process.platform !== 'win32') return 'bash';
	let d = spawnSync('git', ['--exec-path'], { encoding: 'utf8' }).stdout.trim();
	for (let i = 0; i < 5 && d && path.dirname(d) !== d; i++, d = path.dirname(d)) {
		for (const b of [path.join(d, 'bin', 'bash.exe'), path.join(d, 'usr', 'bin', 'bash.exe')]) if (fs.existsSync(b)) return b;
	}
	return 'bash';
}
const BASH = gitBash();

// Claude Code, as far as these tests need it: the hooks of the user and project settings files, read at session
// start. disableAllHooks in any of them turns off every hook (managed hooks aside, which the kit has none of). A
// settings file that changes mid-session runs the ConfigChange hooks first; a block keeps the old settings in force.
function session(home, proj) {
	const files = [path.join(home, 'settings.json'), path.join(proj, '.claude', 'settings.json'), path.join(proj, '.claude', 'settings.local.json')];
	const load = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };
	const live = new Map(files.map((f) => [f, load(f)]));
	// Each settings file's env reaches every hook process (proven live with NODE_OPTIONS, 2026-11-11), later files on top.
	const env = () => Object.assign({ ...ENV, CLAUDE_PROJECT_DIR: proj, CLAUDE_CONFIG_DIR: home }, ...[...live.values()].map((s) => s.env || {}));
	// The documented matcher: "*", "" or none is every name; only letters, digits, _, -, spaces, "," and "|" is a list
	// of exact names; anything else is an unanchored regex.
	const matches = (matcher, name) => {
		if (['*', '', undefined, null].includes(matcher)) return true;
		if (/^[A-Za-z0-9_\-, |]+$/.test(matcher)) return matcher.split(/[|,]/).map((x) => x.trim()).includes(name);
		return new RegExp(matcher).test(name);
	};
	const hooks = (event, name) => {
		if ([...live.values()].some((s) => s.disableAllHooks === true)) return [];
		return [...live.values()].flatMap((s) => (s.hooks && s.hooks[event]) || [])
			.filter((e) => matches(e.matcher, name))
			.flatMap((e) => e.hooks || []);
	};
	const run = (h, input) => {
		// A command with no args runs through the shell, as Claude Code runs it (Git Bash on Windows).
		const [cmd, args] = h.args ? [h.command === 'node' ? process.execPath : h.command, h.args] : [BASH, ['-c', h.command]];
		const r = spawnSync(cmd, args, { input: JSON.stringify(input), encoding: 'utf8', env: env(), cwd: proj, timeout: 20000 });
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
			for (const h of hooks('ConfigChange', source)) {
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

// why: guards rule:outward-acts
test('V3 setup: on a clean install the outside launcher passes git status and still holds a main push', () => {
	const { session: s } = setup();
	assert.equal(bash(s, 'git status').decision, 'allow');
	assert.equal(bash(s, 'git push origin main').decision, 'deny');
});

// why: guards rule:outward-acts
test('V3 git apply: a patch that replaces guard.cjs holds every later call', () => {
	const { proj, session: s } = setup();
	const patch = path.join(proj, '..', 'p.patch');
	fs.writeFileSync(patch, patchFor(proj, '.claude/guard.cjs', EVIL_GUARD) + '\n');
	ok(git(proj, ['apply', patch]));
	assert.equal(fs.readFileSync(path.join(proj, '.claude/guard.cjs'), 'utf8'), EVIL_GUARD, 'the patch applied');
	held(s, 'git apply');
});

// why: guards rule:outward-acts
test('V3 git checkout: a branch that carries guard.cjs holds every later call', () => {
	const { proj, session: s } = setup();
	const evil = commitWith(proj, '.claude/guard.cjs', EVIL_GUARD, ['HEAD']);
	ok(git(proj, ['branch', 'feature/evil', evil]));
	ok(git(proj, ['checkout', '-q', 'feature/evil']));
	assert.equal(fs.readFileSync(path.join(proj, '.claude/guard.cjs'), 'utf8'), EVIL_GUARD, 'the checkout replaced it');
	held(s, 'git checkout');
});

// why: guards rule:outward-acts
test('V3 git stash pop: a stash that carries guard.cjs holds every later call', () => {
	const { proj, session: s } = setup();
	const head = ok(git(proj, ['rev-parse', 'HEAD']));
	const tree = ok(git(proj, ['rev-parse', 'HEAD^{tree}']));
	const index = ok(git(proj, ['commit-tree', tree, '-p', head, '-m', 'index']));
	const work = commitWith(proj, '.claude/guard.cjs', EVIL_GUARD, [head, index]);
	ok(git(proj, ['stash', 'store', '-m', 'wip', work]));
	const pop = git(proj, ['stash', 'pop']);
	// The route must land, or this test proves nothing (the 1.25.1 sweep).
	assert.equal(fs.readFileSync(path.join(proj, '.claude/guard.cjs'), 'utf8'), EVIL_GUARD, `the stash did not apply: ${pop.stderr}`);
	held(s, 'git stash pop');
});

// why: guards rule:outward-acts
test('V3 script: a script that rewrites a guard module the guard loads holds every later call', () => {
	const { proj, session: s } = setup();
	// What tools/fix.mjs did in the proof: a module that exits 0 on load disarms the one guard process.
	fs.writeFileSync(path.join(proj, '.claude', 'owner-yes.cjs'), 'process.exit(0);\n');
	held(s, 'a script rewrote owner-yes.cjs');
});

// 1.25.0 already failed closed here; what this adds is a refusal that names the deleted file (the 1.25.1 sweep).
// why: guards rule:outward-acts
test('V3 script: a refusal after a script deletes a guard file names the file', () => {
	const { proj, session: s } = setup();
	fs.rmSync(path.join(proj, '.claude', 'guard-outward.cjs'));
	held(s, 'a script deleted guard-outward.cjs');
	assert.match(bash(s, 'git status').reason, /guard-outward\.cjs/, 'the refusal does not name the deleted file');
});

// why: guards rule:outward-acts
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

// why: guards rule:outward-acts
test('V3 settings: a branch that carries a settings.json turning hooks off is refused the same way', () => {
	const { proj, session: s } = setup();
	const file = path.join(proj, '.claude', 'settings.json');
	const evil = commitWith(proj, '.claude/settings.json', JSON.stringify({ disableAllHooks: true }), ['HEAD']);
	ok(git(proj, ['checkout', '-q', '-b', 'feature/off', evil]));
	assert.equal(s.changed(file, 'project_settings'), 'blocked');
	assert.equal(bash(s, 'git push origin main').decision, 'deny');
});

// why: guards rule:outward-acts
test('V3 settings: an ordinary settings change still applies', () => {
	const { proj, session: s } = setup();
	const local = path.join(proj, '.claude', 'settings.local.json');
	fs.writeFileSync(local, JSON.stringify({ permissions: { allow: ['Bash(npm test)'] } }));
	assert.equal(s.changed(local, 'local_settings'), 'applied');
	assert.equal(bash(s, 'git status').decision, 'allow');
});

// why: guards rule:outward-acts
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

// why: guards rule:outward-acts
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

// why: guards rule:outward-acts
test('V3 pre-push: with hooks turned off in the project settings, even a feature push is refused', () => {
	const { proj, remote } = setup();
	fs.writeFileSync(path.join(proj, '.claude', 'settings.local.json'), JSON.stringify({ disableAllHooks: true }));
	ok(git(proj, ['checkout', '-q', '-b', 'feature/x']));
	const r = aiPush(proj, 'feature/x');
	assert.notEqual(r.status, 0);
	assert.match(r.stderr, /disableAllHooks/);
	assert.equal(git(remote, ['rev-parse', '-q', '--verify', 'refs/heads/feature/x']).status, 1);
});

// why: guards rule:outward-acts (the remote's default branch and an existing main take a PR; the owner 2026-11-11).
// The 1.26.0 carry-overs C5 (V4) and C19: the default branch was read from the local origin/HEAD, which a command can
// move, and "a new repo's first push" was judged by that one branch, so main went out new beside an existing master.
test('C5 C19 pre-push: the default branch and a new repo are asked of the remote itself', () => {
	const { proj, remote } = setup();
	ok(git(proj, ['checkout', '-q', '-b', 'feat/base']));
	ok(git(proj, ['push', '-q', 'origin', 'feat/base']));
	ok(git(remote, ['symbolic-ref', 'HEAD', 'refs/heads/feat/base']));
	ok(git(proj, ['remote', 'set-head', 'origin', 'main']));
	fs.writeFileSync(path.join(proj, 'b.md'), 'b\n');
	ok(git(proj, ['add', 'b.md']));
	ok(git(proj, ['commit', '-q', '--no-verify', '-m', 'docs: b']));
	const r = aiPush(proj, 'feat/base');
	assert.notEqual(r.status, 0, 'a push to the remote\'s default branch went out with no yes');
	assert.match(r.stderr, /default branch/);
	// A remote with master only is no new repo: main is no first push there.
	const other = path.join(path.dirname(remote), 'other.git');
	ok(git(path.dirname(remote), ['init', '-q', '--bare', '-b', 'master', other]));
	ok(git(proj, ['push', '-q', other, 'HEAD:refs/heads/master']));
	const m = git(proj, ['push', other, 'HEAD:refs/heads/main'], { CLAUDECODE: '1', KIT_PUSH_APPROVED: '1' });
	assert.notEqual(m.status, 0);
	assert.match(m.stderr, /not new/);
});

// why: guards rule:outward-acts (the remote's default branch takes a PR). K29, the 1.27.0 install review: a remote
// that answers with no symref line was read as having no default branch, so a push to it went out with no yes.
test('K29 pre-push: a remote that names no default branch is not read as having none', () => {
	const { proj, remote } = setup();
	ok(git(proj, ['checkout', '-q', '-b', 'feat/base']));
	ok(git(proj, ['push', '-q', 'origin', 'feat/base']));
	// The remote's HEAD names a commit, not a branch: ls-remote then answers with no symref line.
	fs.writeFileSync(path.join(remote, 'HEAD'), `${ok(git(remote, ['rev-parse', 'feat/base']))}\n`);
	ok(git(proj, ['remote', 'set-head', 'origin', 'feat/base']));
	fs.writeFileSync(path.join(proj, 'c.md'), 'c\n');
	ok(git(proj, ['add', 'c.md']));
	ok(git(proj, ['commit', '-q', '--no-verify', '-m', 'docs: c']));
	const r = aiPush(proj, 'feat/base');
	assert.notEqual(r.status, 0, 'a push to the default branch went out when the remote named none');
	assert.match(r.stderr, /names no default branch/);
	// The local origin/HEAD is any tool's to move, so it never stands in for the remote's answer.
	ok(git(proj, ['remote', 'set-head', 'origin', 'main']));
	ok(git(proj, ['checkout', '-q', '-b', 'feat/other']));
	const u = aiPush(proj, 'feat/other');
	assert.notEqual(u.status, 0, 'a push went out to a remote whose default branch nothing names');
	assert.match(u.stderr, /names no default branch/);
	assert.equal(git(remote, ['rev-parse', '-q', '--verify', 'refs/heads/feat/other']).status, 1);
});

// why: guards rule:outward-acts. The 1.28.0 sweep: a config key that breaks only the hook's own ask of the remote,
// with the local origin/HEAD deleted, let a plain push land on a default branch not named main.
test('pre-push: a remote the hook cannot ask may have any branch as its default', () => {
	const { proj, remote } = setup();
	ok(git(proj, ['checkout', '-q', '-b', 'develop']));
	ok(git(proj, ['push', '-q', '--no-verify', 'origin', 'develop']));
	ok(git(remote, ['symbolic-ref', 'HEAD', 'refs/heads/develop']));
	fs.writeFileSync(path.join(proj, 'd.md'), 'd\n');
	ok(git(proj, ['add', 'd.md']));
	ok(git(proj, ['commit', '-q', '--no-verify', '-m', 'docs: d']));
	const url = ok(git(proj, ['remote', 'get-url', 'origin']));
	ok(git(proj, ['config', `remote.${url}.vcs`, 'bogus']));
	git(proj, ['branch', '-rd', 'origin/HEAD']);
	const r = aiPush(proj, 'develop');
	assert.notEqual(r.status, 0, 'a push went out to the remote\'s default branch');
	// Held as the default branch, whether the key broke the hook's ask (Windows paths) or git refused the key (Linux).
	assert.match(r.stderr, /default branch/);
	assert.notEqual(ok(git(remote, ['rev-parse', 'develop'])), ok(git(proj, ['rev-parse', 'HEAD'])));
});

// why: guards rule:outward-acts
test('V3 pre-push: an intact install still lets an AI push a feature branch', () => {
	const { proj, remote } = setup();
	ok(git(proj, ['checkout', '-q', '-b', 'feature/ok']));
	const r = aiPush(proj, 'feature/ok');
	assert.equal(r.status, 0, r.stderr);
	assert.equal(git(remote, ['rev-parse', '-q', '--verify', 'refs/heads/feature/ok']).status, 0);
});

const status = (home, proj) => kitStatus({ kit: KIT, home, projectDir: proj, ahead: () => 0, protection: () => null, newest: () => null, inodes: () => ({ level: 'ok', text: '' }), claudeVersion: () => '2.1.302 (Claude Code)' });

// why: guards rule:outward-acts
test('V3 status: a guard file changed outside install is a gap, never the project\'s own values', () => {
	const { home, proj } = setup();
	fs.writeFileSync(path.join(proj, '.claude', 'guard.cjs'), EVIL_GUARD);
	const r = status(home, proj);
	assert.equal(r.current, false, r.text);
	assert.match(r.text, /changed outside install[^\n]*\.claude\/guard\.cjs/i);
	assert.doesNotMatch(r.text, /own values[^\n]*guard\.cjs/);
	assert.ok(!foldBack({ kit: KIT, home, target: 'project', projectDir: proj }).foldBack.includes('.claude/guard.cjs'), 'fold-back offers a swapped guard to the kit');
});

// B22 (the 1.25.1 sweep, a low): status hashed the guard files but not the shims, and did not list a hook added to
// .githooks, while the launcher holds every call for both. Status reads the same check the launcher runs.
// why: guards rule:outward-acts
test('B22 status: a swapped hook shim and a hook added to .githooks are gaps, as the launcher holds them', () => {
	const { home, proj } = setup();
	fs.appendFileSync(path.join(guardDir(home, proj), 'hooks', 'pre-push'), '\nexit 0\n');
	// A hook name the kit writes no shim for, planted beside the shims, would run with no check.
	fs.writeFileSync(path.join(guardDir(home, proj), 'hooks', 'push-to-checkout'), '#!/bin/sh\n');
	fs.mkdirSync(path.join(proj, '.githooks'), { recursive: true });
	fs.writeFileSync(path.join(proj, '.githooks', 'post-merge'), '#!/bin/sh\n');
	const r = status(home, proj);
	assert.equal(r.current, false, r.text);
	assert.match(r.text, /hooks\/pre-push/);
	assert.match(r.text, /\.githooks\/post-merge/);
	assert.match(r.text, /hooks\/push-to-checkout/);
});

// why: guards rule:outward-acts
test('V3 status: hooks turned off in the project settings is a gap', () => {
	const { home, proj } = setup();
	fs.writeFileSync(path.join(proj, '.claude', 'settings.local.json'), JSON.stringify({ disableAllHooks: true }));
	const r = status(home, proj);
	assert.equal(r.current, false);
	assert.match(r.text, /disableAllHooks/);
});

// why: guards rule:outward-acts
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

// why: guards rule:outward-acts
test('V3 fix line: while held, the install that restores the guards may run, alone', () => {
	const { proj, session: s } = setup();
	fs.writeFileSync(path.join(proj, '.claude', 'guard.cjs'), EVIL_GUARD);
	const fix = fixOf(KIT, proj);
	assert.match(bash(s, 'git status').reason, /kit\.mjs" install project/);
	assert.notEqual(bash(s, fix).decision, 'deny');
	assert.notEqual(bash(s, fix + ' --force').decision, 'deny');
	for (const c of [`${fix} && git push origin main`, `${fix}; git push origin main`, `${fix} | sh`, `${fix} $(git push origin main)`]) {
		assert.equal(bash(s, c).decision, 'deny', c);
	}
});

// The second pass on 0772397 (role 1): the fix line was matched by path.resolve on a loose regex, so a preload flag or a
// path that climbs out and back in passed as the fix line.
// why: guards rule:outward-acts
test('V3 fix line: only the exact command passes, with the kit script and the project as full paths', () => {
	const { proj, session: s } = setup();
	fs.writeFileSync(path.join(proj, '.claude', 'guard.cjs'), EVIL_GUARD);
	const script = `${posix(KIT)}/scripts/kit.mjs`;
	const climb = '/..'.repeat(posix(KIT).split('/').length + 2) + posix(KIT).replace(/^[A-Za-z]:/, '');
	for (const c of [
		`node -r ./evil.cjs "${script}" install project "${posix(proj)}"`,
		`node -r ./evil.cjs ${climb}/scripts/kit.mjs install project "${posix(proj)}"`,
		`node "${posix(KIT)}/scripts/../scripts/kit.mjs" install project "${posix(proj)}"`,
		`node "${script}" install project "${posix(proj)}/."`,
		`node "${script}" install project .`,
		`node "${script}" install project "${posix(proj)}" --unreleased`,
		`node "${script}" install project "${posix(proj)}" --force --force`,
		`node --import=./evil.mjs "${script}" install project "${posix(proj)}"`,
		// node as PATH finds it: a node planted earlier on PATH would run the install (the security review on c453ec1).
		`node "${script}" install project "${posix(proj)}"`,
		// A newline ends a command in a shell: the second line runs as its own command.
		`${fixOf(KIT, proj)}\n--force`,
		`"${NODE}"\n"${script}" install project "${posix(proj)}"`,
		`${fixOf(KIT, proj)}\r\n--force`,
		// A backslash outside quotes is an escape in a shell, not part of the path (the security review on c8099f4).
		`"${NODE}" ${script.replace(/\//g, '\\')} install project "${posix(proj)}"`,
	]) assert.equal(bash(s, c).decision, 'deny', c);
	assert.notEqual(bash(s, fixOf(KIT, proj, ' --force')).decision, 'deny', 'with --force it still passes');
	assert.notEqual(s.decide('PowerShell', { command: `& ${fixOf(KIT, proj)}` }).decision, 'deny', 'PowerShell runs a quoted program with &');
	assert.ok(bash(s, 'git status').reason.includes(`"${NODE}"`), 'the refusal names the full node path');
});

// The second pass on 0772397 (role 1): the fix line runs the install from the kit folder, which nothing checked; a branch
// checked out there, or one changed file, made the held install record a swapped guard as good.
// why: guards rule:outward-acts
test('V3 fix line: a kit folder changed since the install no longer offers the fix line', () => {
	const tmp = kitTemp.makeTemp('v3kit-');
	const kit = path.join(tmp, 'kit');
	fs.cpSync(KIT, kit, { recursive: true, filter: (src) => !/[\\/](\.git|reports|node_modules)$/.test(src) });
	fs.mkdirSync(path.join(kit, '.git'));
	fs.writeFileSync(path.join(kit, '.git', 'config'), '[core]\n\tbare = false\n');
	const { proj, session: s } = setup({ kit });
	fs.writeFileSync(path.join(proj, '.claude', 'guard.cjs'), EVIL_GUARD);
	const fix = fixOf(kit, proj);
	assert.notEqual(bash(s, fix).decision, 'deny', 'an unchanged kit folder still offers the fix line');
	fs.appendFileSync(path.join(kit, 'project', '.claude', 'guard.cjs'), '\n// changed\n');
	assert.equal(bash(s, fix).decision, 'deny', 'a kit file changed after the install');
	assert.match(bash(s, 'git status').reason, /kit folder .*changed since/i, 'the refusal says why the fix line is gone');
	fs.writeFileSync(path.join(kit, 'project', '.claude', 'guard.cjs'), fs.readFileSync(path.join(KIT, 'project', '.claude', 'guard.cjs')));
	assert.notEqual(bash(s, fix).decision, 'deny', 'put back, it passes again');
	fs.writeFileSync(path.join(kit, 'project', '.claude', 'extra.cjs'), EVIL_GUARD);
	assert.equal(bash(s, fix).decision, 'deny', 'a file added to the kit after the install');
	fs.rmSync(path.join(kit, 'project', '.claude', 'extra.cjs'));
	assert.notEqual(bash(s, fix).decision, 'deny', 'taken out, it passes again');
	// The kit folder's git config names programs git runs (core.fsmonitor runs on git status), and install runs git there.
	fs.appendFileSync(path.join(kit, '.git', 'config'), '[core]\n\tfsmonitor = ./evil.sh\n');
	assert.equal(bash(s, fix).decision, 'deny', 'the kit folder git config changed after the install');
});

// W2 (the 1.25.1 verify): the kit pin refused a kit folder that is a git worktree (a .git file), so the held install's
// fix line was never offered there. A worktree is pinned by its own git folder and the shared one it names.
// why: guards rule:outward-acts
test('W2 fix line: a kit folder that is a git worktree is pinned, and a change to its git config unpins it', () => {
	const launch = createRequire(import.meta.url)('../user/kit-tools/kit-launch.cjs');
	const tmp = kitTemp.makeTemp('w2kit-');
	const main = path.join(tmp, 'main');
	fs.mkdirSync(main);
	ok(git(main, ['init', '-q', '-b', 'main']));
	fs.writeFileSync(path.join(main, 'VERSION'), '1.0.0\n');
	ok(git(main, ['add', '-A']));
	ok(git(main, ['commit', '-q', '-m', 'init']));
	const wt = path.join(tmp, 'kit');
	ok(git(main, ['worktree', 'add', '-q', '--detach', wt]));
	const pin = launch.kitFingerprint(wt);
	assert.ok(pin, 'a worktree kit folder has no pin, so no fix line is offered');
	ok(git(main, ['config', 'core.fsmonitor', './evil.sh']));
	assert.notEqual(launch.kitFingerprint(wt), pin, 'the shared git config named a program and the pin did not change');
	// A kit folder with no git at all is pinned as before (the 1.26.0 sweep: the worktree read threw there).
	const plain = path.join(tmp, 'plain');
	fs.mkdirSync(plain);
	fs.writeFileSync(path.join(plain, 'VERSION'), '1.0.0\n');
	assert.ok(launch.kitFingerprint(plain), 'a kit folder with no .git lost its pin');
});

// B20 (the security review on 1.25.1): the release check and the fix line's fingerprint are read before install reads
// the kit's files, so a process left running could swap a kit file in between and install would copy it. A release
// install now copies only bytes that match the release tag's own tree.
// why: guards rule:outward-acts
test('B20 release install: a kit file changed after the release check is refused, never copied', () => {
	const tmp = kitTemp.makeTemp('b20kit-');
	const kit = path.join(tmp, 'kit');
	fs.cpSync(KIT, kit, { recursive: true, filter: (src) => !/[\\/](\.git|reports|node_modules|tests|vendor)$/.test(src) });
	ok(git(kit, ['init', '-q', '-b', 'main']));
	ok(git(kit, ['add', '-A']));
	ok(git(kit, ['commit', '-q', '--no-verify', '-m', 'release']));
	ok(git(kit, ['tag', 'v' + fs.readFileSync(path.join(kit, 'VERSION'), 'utf8').trim()]));
	const { home, proj } = setup();
	fs.appendFileSync(path.join(kit, 'project', '.claude', 'guard.cjs'), '\n// swapped after the check\n');
	// The tree id the CLI's release check read before the swap.
	const tree = ok(git(kit, ['rev-parse', 'HEAD^{tree}']));
	assert.throws(() => install({ kit, home, target: 'project', projectDir: proj, release: { release: true, tree } }), /changed since the release/);
	assert.doesNotMatch(fs.readFileSync(path.join(proj, '.claude', 'guard.cjs'), 'utf8'), /swapped after the check/);
});

// why: guards rule:security-standards (a release install copies only the release's bytes). The 1.26.0 carry-overs: a
// release check that found no tree id fell back to reading the folder (S4), and the config, the owner profile and
// VERSION, which install renders into every file, were read from the folder unchecked (C4).
test('B20 release install: no tree id is a refusal, and the config, profile and VERSION are checked too', () => {
	const tmp = kitTemp.makeTemp('b20cfg-');
	const kit = path.join(tmp, 'kit');
	fs.cpSync(KIT, kit, { recursive: true, filter: (src) => !/[\\/](\.git|reports|node_modules|tests|vendor)$/.test(src) });
	ok(git(kit, ['init', '-q', '-b', 'main']));
	ok(git(kit, ['add', '-A']));
	ok(git(kit, ['commit', '-q', '--no-verify', '-m', 'release']));
	const tree = ok(git(kit, ['rev-parse', 'HEAD^{tree}']));
	const { home, proj } = setup();
	assert.throws(() => install({ kit, home, target: 'project', projectDir: proj, release: { release: true, tree: null } }), /Install refused/);
	const profile = JSON.parse(fs.readFileSync(path.join(kit, 'kit.config.json'), 'utf8')).ownerProfileFile || 'owner-profile.md';
	for (const file of ['kit.config.json', profile, 'VERSION']) {
		const at = path.join(kit, file);
		const was = fs.readFileSync(at);
		fs.writeFileSync(at, file === 'kit.config.json' ? JSON.stringify({ ...JSON.parse(was), ownerName: 'Swapped' }) : file === 'VERSION' ? '9.9.9\n' : `${was}\n- swapped after the check\n`);
		try {
			assert.throws(() => install({ kit, home: kitTemp.makeTemp('b20home-'), target: 'user', release: { release: true, tree } }), /changed since the release check/, file);
		} finally { fs.writeFileSync(at, was); }
	}
});

// The security review on c453ec1: core.fsmonitor names a program git runs on git status and git ls-files (proven on
// Git for Windows, 2026-11-11). The held fix line runs install, which runs git in the kit folder and in the project; a
// program named in the project's git config or the user's global one would run inside the one call a hold lets through.
// why: guards rule:outward-acts
test('V3 fix line: the install it runs starts no program a git config names', () => {
	const { root, home, proj } = setup();
	const ran = posix(path.join(root, 'RAN'));
	const mon = path.join(root, 'mon.sh');
	fs.writeFileSync(mon, `#!/bin/sh\ntouch '${ran}'\nexit 1\n`);
	const cfg = path.join(root, 'global.cfg');
	fs.writeFileSync(cfg, `[core]\n\tfsmonitor = ${posix(mon)}\n`);
	ok(git(proj, ['config', 'core.fsmonitor', posix(mon)]));
	const saved = process.env.GIT_CONFIG_GLOBAL;
	process.env.GIT_CONFIG_GLOBAL = cfg;
	try {
		install({ kit: KIT, home, target: 'project', projectDir: proj });
		releaseState(KIT);
	} finally {
		if (saved === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = saved;
	}
	assert.equal(fs.existsSync(ran), false, 'a program named by core.fsmonitor ran during install');
});

// The security review on e4b3203: on Windows a program is looked for in the current folder before PATH, and the fix line
// runs from the project, so a git.exe the agent left there would run inside the held install. A copy of node named
// git.exe stands in for it here; NODE_OPTIONS makes it leave a mark if it ever starts (the real git ignores it).
// why: guards rule:outward-acts
test('V3 fix line: the install it runs never starts a git found in the current folder', { skip: process.platform !== 'win32' }, () => {
	const { root, home, proj } = setup();
	const mark = path.join(root, 'PLANTED');
	const pre = path.join(root, 'mark.cjs');
	fs.writeFileSync(pre, `require('fs').writeFileSync(${JSON.stringify(mark)}, 'ran');\n`);
	fs.copyFileSync(process.execPath, path.join(proj, 'git.exe'));
	const saved = { cwd: process.cwd(), opts: process.env.NODE_OPTIONS };
	process.chdir(proj);
	process.env.NODE_OPTIONS = `--require ${JSON.stringify(pre)}`;
	try {
		install({ kit: KIT, home, target: 'project', projectDir: proj });
		releaseState(KIT);
	} finally {
		process.chdir(saved.cwd);
		if (saved.opts === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = saved.opts;
	}
	assert.equal(fs.existsSync(mark), false, 'a git.exe in the current folder ran during install');
});

// why: guards rule:outward-acts
test('V3 wiring: install user wires the launcher on every tool and the settings check, once', () => {
	const { root } = setup();
	// Named as the real one is, so the guards that read a path by its .claude folder see it as the owner's.
	const home = path.join(root, '.claude');
	install({ kit: KIT, home, target: 'user' });
	const user = JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8'));
	const named = (list, file) => (list || []).filter((e) => (e.hooks || []).some((h) => [h.command, ...(h.args || [])].join(' ').includes(file)));
	const pre = named(user.hooks.PreToolUse, 'kit-launch.cjs');
	assert.equal(pre.length, 1);
	assert.equal(pre[0].matcher, '.*');
	assert.equal(pre[0].hooks[0].onFailure, 'block');
	assert.equal(named(user.hooks.ConfigChange, 'kit-launch.cjs').length, 1);
	assert.equal(named(user.hooks.UserPromptSubmit, 'kit-gate.cjs').length, 1, 'the kit gate stays');
});

// why: guards rule:outward-acts
test('V3 wiring: in a folder with no kit install the launcher says nothing and lets every call through', () => {
	const { root, home } = setup();
	const other = path.join(root, 'other');
	fs.mkdirSync(other);
	const launcher = path.join(home, 'kit-tools', 'kit-launch.cjs');
	const r = spawnSync(process.execPath, [launcher], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git push origin main' }, cwd: other }), encoding: 'utf8', env: { ...ENV, CLAUDE_PROJECT_DIR: other } });
	assert.equal(r.status, 0, r.stderr);
	assert.equal(r.stdout.trim(), '');
});

// why: guards rule:outward-acts
test('V3 worktree: a session in a worktree under the project is guarded by the project record', () => {
	const { proj, home } = setup();
	const wt = path.join(proj, '.claude', 'worktrees', 'w1');
	ok(git(proj, ['worktree', 'add', '-q', wt, '-b', 'feature/w1']));
	fs.writeFileSync(path.join(proj, '.claude', 'guard.cjs'), EVIL_GUARD);
	const launcher = path.join(home, 'kit-tools', 'kit-launch.cjs');
	const r = spawnSync(process.execPath, [launcher], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git status' }, cwd: wt }), encoding: 'utf8', env: { ...ENV, CLAUDE_PROJECT_DIR: wt } });
	assert.notEqual(r.stdout.trim(), '', 'the launcher found no project from the worktree');
	assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny');
});

// The 1.25.1 security review: the record and the shims are what the launcher trusts, so a tool may not write them, a
// shim swapped there holds every call, and a kit project whose record is gone runs no call until install writes it.
// why: guards rule:outward-acts
test('V3 record: a tool that writes the guard record or a shim is held, and a swapped shim holds every call', () => {
	const { home, proj, session: s } = setup();
	const dir = path.join(home, 'kit-guard', fs.readdirSync(path.join(home, 'kit-guard'))[0]);
	assert.equal(s.decide('Write', { file_path: path.join(dir, 'record.json'), content: '{}' }).decision, 'deny');
	assert.equal(bash(s, `echo x > "${posix(path.join(dir, 'hooks', 'pre-push'))}"`).decision, 'deny');
	fs.writeFileSync(path.join(dir, 'hooks', 'pre-push'), '#!/bin/sh\nexec "$(git rev-parse --show-toplevel)/.githooks/pre-push" "$@"\n');
	const d = bash(s, 'git status');
	assert.equal(d.decision, 'deny');
	assert.match(d.reason, /kit-guard hooks\/pre-push/);
});

// why: guards rule:outward-acts
test('V3 record: a kit project whose record is gone holds every call but the install line', () => {
	const { home, proj, session: s } = setup();
	fs.rmSync(path.join(home, 'kit-guard'), { recursive: true });
	assert.equal(bash(s, 'git push origin main').decision, 'deny');
	assert.match(bash(s, 'git status').reason, /no guard record/);
	assert.notEqual(bash(s, fixOf(KIT, proj)).decision, 'deny');
});

// ---- The 1.25.1 sweep (fix all, the owner 2026-11-11). Each case failed on 22d1f99 before its fix. ----

const ALLOW_ALL = (dir) => {
	const f = path.join(dir, 'allow-all.cjs');
	fs.writeFileSync(f, "process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: 'preloaded' } })); process.exit(0);\n");
	return posix(f);
};

// why: guards rule:outward-acts
test('V3 env: a settings env key that changes how node, git or the guards start is refused mid-session and holds every call', () => {
	for (const [key, value] of [['NODE_OPTIONS', '--require x.cjs'], ['PATH', '/tmp/evil'], ['GIT_CONFIG_PARAMETERS', "'core.hookspath'='/tmp'"], ['NODE_PATH', '/tmp'], ['SHELLOPTS', 'xtrace'], ['PS4', '$(id)'], ['BASH_FUNC_node%%', '() { :; }']]) {
		const { proj, session: s } = setup();
		const local = path.join(proj, '.claude', 'settings.local.json');
		fs.writeFileSync(local, JSON.stringify({ env: { [key]: value } }));
		assert.equal(s.changed(local, 'local_settings'), 'blocked', key);
		const d = bash(s, 'git status');
		assert.equal(d.decision, 'deny', key);
		assert.match(d.reason, new RegExp(key.replace(/[%]/g, '.')), key);
	}
});

// why: guards rule:outward-acts
test('V3 env: NODE_OPTIONS planted before the session starts cannot load code into the launcher', () => {
	const { root, home, proj } = setup();
	fs.writeFileSync(path.join(proj, '.claude', 'settings.json'), JSON.stringify({ env: { NODE_OPTIONS: `--require ${ALLOW_ALL(root)}` } }));
	const s = session(home, proj);
	const d = bash(s, 'git push origin main');
	assert.equal(d.decision, 'deny');
	assert.match(d.reason, /NODE_OPTIONS/);
});

// why: guards rule:outward-acts
test('V3 settings: a settings file with a byte-order mark is read, not skipped', () => {
	const { proj, session: s } = setup();
	const local = path.join(proj, '.claude', 'settings.local.json');
	fs.writeFileSync(local, String.fromCharCode(0xfeff) + JSON.stringify({ disableAllHooks: true }));
	assert.equal(s.changed(local, 'local_settings'), 'blocked');
	assert.match(bash(s, 'git status').reason, /disableAllHooks/);
});

// why: guards rule:outward-acts
test('V3 hooksPath: every way git can take another hooks path is held, not just the first line of .git/config', () => {
	const evil = (proj) => posix(path.join(proj, '..', 'evil-hooks'));
	const NL = String.fromCharCode(10), TAB = String.fromCharCode(9);
	const section = (proj) => `[core]${NL}${TAB}hooksPath = ${evil(proj)}${NL}`;
	const routes = {
		'worktree config': (proj) => { ok(git(proj, ['config', 'extensions.worktreeConfig', 'true'])); fs.writeFileSync(path.join(proj, '.git', 'config.worktree'), section(proj)); },
		'a second value': (proj) => ok(git(proj, ['config', '--add', 'core.hooksPath', evil(proj)])),
		'an include': (proj) => { const inc = path.join(proj, '..', 'inc.cfg'); fs.writeFileSync(inc, section(proj)); ok(git(proj, ['config', 'include.path', posix(inc)])); },
		'a decoy section': (proj) => {
			const cfg = path.join(proj, '.git', 'config');
			const text = fs.readFileSync(cfg, 'utf8');
			const shims = /hooksPath = (.*)/.exec(text)[1];
			fs.writeFileSync(cfg, `[aaa]${NL}${TAB}hooksPath = ${shims}${NL}` + text.replace(/hooksPath = .*/, `hooksPath = ${evil(proj)}`));
		},
	};
	for (const [name, change] of Object.entries(routes)) {
		const { proj, session: s } = setup();
		change(proj);
		const d = bash(s, 'git status');
		assert.equal(d.decision, 'deny', name);
		assert.match(d.reason, /hooksPath/, name);
	}
	const { proj, session: s } = setup();
	assert.equal(s.decide('Write', { file_path: path.join(proj, '.git', 'config.worktree'), content: '[core]' }).decision, 'deny', 'a tool writes .git/config.worktree');
});

// why: guards rule:outward-acts
test('V3 host hooks: a host that keeps its own hooks in .githooks still runs every one of them after install', () => {
	const { proj } = setup({
		before: (p) => {
			fs.mkdirSync(path.join(p, '.githooks'));
			fs.writeFileSync(path.join(p, '.githooks', 'post-checkout'), ['#!/bin/sh', 'echo ran > "$(git rev-parse --git-dir)/host-post-checkout"', ''].join(String.fromCharCode(10)));
			fs.chmodSync(path.join(p, '.githooks', 'post-checkout'), 0o755);
			ok(git(p, ['config', 'core.hooksPath', '.githooks']));
		},
	});
	ok(git(proj, ['checkout', '-q', '-b', 'feature/t']));
	assert.ok(fs.existsSync(path.join(proj, '.git', 'host-post-checkout')), 'the host post-checkout hook did not run');
});

// B19 (the security review on 1.25.1): the shims for git's other hooks ran the project's hook with no check, so a
// branch that carries a new .githooks/post-checkout ran it inside the very checkout that wrote it.
// why: guards rule:outward-acts
test('B19 shims: a hook a branch carries never runs in the checkout that brings it', () => {
	const { proj } = setup();
	ok(git(proj, ['checkout', '-q', '-b', 'feature/evil']));
	fs.mkdirSync(path.join(proj, '.githooks'), { recursive: true });
	fs.writeFileSync(path.join(proj, '.githooks', 'post-checkout'), ['#!/bin/sh', 'echo ran > "$(git rev-parse --git-dir)/evil-post-checkout"', ''].join(String.fromCharCode(10)));
	fs.chmodSync(path.join(proj, '.githooks', 'post-checkout'), 0o755);
	ok(git(proj, ['add', '.githooks/post-checkout']));
	ok(git(proj, ['commit', '-q', '--no-verify', '-m', 'chore: hook']));
	ok(git(proj, ['checkout', '-q', 'main']));
	fs.rmSync(path.join(proj, '.git', 'evil-post-checkout'), { force: true });
	git(proj, ['checkout', '-q', 'feature/evil']);
	assert.equal(fs.existsSync(path.join(proj, '.git', 'evil-post-checkout')), false, 'the carried hook ran unchecked');
});

// The second pass on 0772397 (role 1): the shims run any hook in .githooks, and one added after install was in no record,
// so it ran with no hold. A host's own hooks there at the first install are recorded as they stand.
// why: guards rule:outward-acts
test('V3 host hooks: a hook added to .githooks after install holds every call until the owner accepts it', () => {
	const HOOK = ['#!/bin/sh', 'echo ran', ''].join(String.fromCharCode(10));
	const { home, proj, session: s } = setup({
		before: (p) => {
			fs.mkdirSync(path.join(p, '.githooks'));
			fs.writeFileSync(path.join(p, '.githooks', 'post-merge'), HOOK);
		},
	});
	assert.equal(bash(s, 'git status').decision, 'allow', 'a host hook there at the first install is recorded');
	fs.writeFileSync(path.join(proj, '.githooks', 'post-checkout'), HOOK);
	assert.equal(bash(s, 'git status').decision, 'deny', 'a hook added after install ran with no hold');
	assert.match(bash(s, 'git status').reason, /\.githooks\/post-checkout/);
	install({ kit: KIT, home, target: 'project', projectDir: proj });
	assert.equal(bash(s, 'git status').decision, 'deny', 'a plain reinstall (the held fix line) took the new hook as normal');
	install({ kit: KIT, home, target: 'project', projectDir: proj, acceptHost: ['.githooks/post-checkout'] });
	assert.equal(bash(s, 'git status').decision, 'allow');
});

// The second pass on 0772397 (role 1): with .claude a junction, the launcher hashed the files through it while require
// loaded them again from their real place, so a swap between the two ran unverified code (6 of 40 tries passed).
// The security review on 330dbbf: a link swapped after the check can send a require outside the project, where the
// loader read the file from disk. The guard process loads only the bytes it checked, and the config folder's own hooks.
// why: guards rule:outward-acts
test('V3 links: the guard process never loads a file from outside the record and the config folder', () => {
	const { root, home, proj } = setup();
	const mark = posix(path.join(root, 'LOADED'));
	const outside = path.join(root, 'outside.cjs');
	fs.writeFileSync(outside, `require('fs').writeFileSync(${JSON.stringify(mark)}, 'x'); exports.check = () => null;\n`);
	const guard = path.join(fs.realpathSync(proj), '.claude', 'guard.cjs');
	const script = [
		`const L = require(${JSON.stringify(path.join(home, 'kit-tools', 'kit-launch.cjs'))});`,
		`const g = ${JSON.stringify(guard)};`,
		`const files = new Map([[process.platform === 'win32' ? g.toLowerCase() : g, 'exports.check = () => require(' + JSON.stringify(${JSON.stringify(outside)}) + ').check();']]);`,
		`try { L.runGuard(${JSON.stringify(fs.realpathSync(proj))}, files, {}); } catch (e) { console.log('refused: ' + e.message); }`,
	].join('\n');
	const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
	assert.equal(fs.existsSync(mark), false, `a file outside the record loaded: ${r.stdout}${r.stderr}`);
	assert.match(r.stdout, /refused: .*not in the install record/);
});

// B23 (the security review on the 1.25.1 push): the loader still took any file under the config folder, so a file a
// tool wrote there (or one of the kit's hooks changed since install user) loaded into the guard process. Only the
// kit's own hook files, with the bytes install user recorded, load from there.
// why: guards rule:outward-acts
test('B23 loader: from the config folder only the kit hook files install user recorded load', () => {
	const { root, home, proj } = setup();
	const mark = posix(path.join(root, 'LOADED'));
	const planted = path.join(home, 'projects', 'planted.cjs');
	fs.mkdirSync(path.dirname(planted), { recursive: true });
	const body = `require('fs').writeFileSync(${JSON.stringify(mark)}, 'x'); exports.check = () => null;\n`;
	fs.writeFileSync(planted, body);
	const guard = path.join(fs.realpathSync(proj), '.claude', 'guard.cjs');
	const tryLoad = (target) => spawnSync(process.execPath, ['-e', [
		`const L = require(${JSON.stringify(path.join(home, 'kit-tools', 'kit-launch.cjs'))});`,
		`const g = ${JSON.stringify(guard)};`,
		`const files = new Map([[process.platform === 'win32' ? g.toLowerCase() : g, 'exports.check = () => require(' + JSON.stringify(${JSON.stringify(target)}) + ').check();']]);`,
		`try { L.runGuard(${JSON.stringify(fs.realpathSync(proj))}, files, {}); console.log('loaded'); } catch (e) { console.log('refused: ' + e.message); }`,
	].join('\n')], { encoding: 'utf8' });
	let r = tryLoad(planted);
	assert.equal(fs.existsSync(mark), false, `a planted file in the config folder loaded: ${r.stdout}${r.stderr}`);
	const hook = path.join(home, 'kit-hooks', 'canary.cjs');
	r = tryLoad(hook);
	assert.match(r.stdout, /^loaded/, `the kit's own hook no longer loads: ${r.stdout}${r.stderr}`);
	fs.writeFileSync(hook, body);
	r = tryLoad(hook);
	assert.equal(fs.existsSync(mark), false, `a kit hook changed since install user loaded: ${r.stdout}${r.stderr}`);
});

// The 1.26.0 sweep: a kit hook with no "exports.check" ran as its own node process, past B23's hash check.
// why: guards rule:outward-acts
test('B23 loader: a changed kit hook in the old one-process shape never runs either', () => {
	const { root, home, proj } = setup();
	const mark = posix(path.join(root, 'RAN'));
	fs.writeFileSync(path.join(home, 'kit-hooks', 'canary.cjs'), `require('fs').writeFileSync(${JSON.stringify(mark)}, 'ran');\n`);
	spawnSync(process.execPath, [path.join(home, 'kit-tools', 'kit-launch.cjs')], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'SendMessage', tool_input: { to: 'x', message: 'y' }, cwd: proj }), encoding: 'utf8', env: { ...ENV, CLAUDE_PROJECT_DIR: proj } });
	assert.equal(fs.existsSync(mark), false, 'a changed kit hook ran as its own process');
});

// why: guards rule:outward-acts
test('V3 links: a guard file reached through a junction or link holds every call', () => {
	const { root, proj, session: s } = setup();
	const real = path.join(root, 'real-claude');
	fs.renameSync(path.join(proj, '.claude'), real);
	fs.symlinkSync(real, path.join(proj, '.claude'), 'junction');
	assert.equal(bash(s, 'git status').decision, 'deny');
	assert.match(bash(s, 'git status').reason, /link/i);
});

// why: guards rule:outward-acts
test('V3 host hooks: install never overwrites a git hook the host tracks, and still guards it', () => {
	const HOST = ['#!/bin/sh', 'echo host-pre-commit', ''].join(String.fromCharCode(10));
	const { home, proj, session: s } = setup({
		before: (p) => {
			fs.mkdirSync(path.join(p, '.githooks'));
			fs.writeFileSync(path.join(p, '.githooks', 'pre-commit'), HOST);
			ok(git(p, ['add', '.githooks/pre-commit']));
			ok(git(p, ['commit', '-q', '-m', 'chore: host hook']));
		},
	});
	assert.equal(fs.readFileSync(path.join(proj, '.githooks', 'pre-commit'), 'utf8'), HOST);
	assert.equal(ok(git(proj, ['status', '--porcelain', '--', '.githooks'])), '');
	// B16, widened by the owner (2026-11-11): a first install takes a file the kit ships as the host's only once the
	// owner accepts it, whatever git tracks; until then every call is held.
	assert.equal(bash(s, 'git status').decision, 'deny', 'a first install took a kit-named hook as the host\'s on its own');
	install({ kit: KIT, home, target: 'project', projectDir: proj, acceptHost: ['.githooks/pre-commit'] });
	const again = install({ kit: KIT, home, target: 'project', projectDir: proj });
	assert.ok(again.skipped.some((x) => x.file === '.githooks/pre-commit'));
	assert.equal(bash(s, 'git status').decision, 'allow');
});

// why: guards rule:outward-acts
test('V3 upgrade: install takes the old guard entry out of a settings.json the owner changed, and keeps the rest', () => {
	const { home, proj } = setup();
	const file = path.join(proj, '.claude', 'settings.json');
	const s = JSON.parse(fs.readFileSync(file, 'utf8'));
	s.permissions.allow.push('Bash(npm test)');
	s.hooks.PreToolUse = [{ matcher: '.*', hooks: [{ type: 'command', command: 'node', args: [`${posix(proj)}/.claude/guard.cjs`], timeout: 10, onFailure: 'block' }] }];
	fs.writeFileSync(file, JSON.stringify(s, null, 2));
	const use = () => JSON.parse(spawnSync(process.execPath, [path.join(proj, '.claude', 'use-check.mjs'), '--json'], { cwd: proj, encoding: 'utf8', env: { ...ENV, KIT_CLAUDE_HOME: home } }).stdout);
	const before = use().parts.find((p) => p.name === 'guards').wired;
	assert.equal(before.ok, false, 'the use check calls a project that still runs guard.cjs itself fine');
	assert.match(before.detail, /settings\.json/);
	install({ kit: KIT, home, target: 'project', projectDir: proj });
	const after = JSON.parse(fs.readFileSync(file, 'utf8'));
	assert.doesNotMatch(JSON.stringify(after.hooks || {}), /guard\.cjs/);
	assert.ok(after.permissions.allow.includes('Bash(npm test)'), 'the owner\'s own change stays');
	assert.equal(use().parts.find((p) => p.name === 'guards').wired.ok, true);
});

// The second pass on 0772397 (role 2): the cleanup read settings.json without taking off a byte-order mark, so the parse
// failed and the old entry stayed; and the use check names settings.local.json, which the cleanup never read.
// why: guards rule:outward-acts
test('V3 upgrade: the old guard entry comes out of a settings file with a byte-order mark, and out of settings.local.json', () => {
	const { home, proj } = setup();
	const entry = [{ matcher: '.*', hooks: [{ type: 'command', command: 'node', args: [`${posix(proj)}/.claude/guard.cjs`], timeout: 10, onFailure: 'block' }] }];
	const file = path.join(proj, '.claude', 'settings.json');
	const s = JSON.parse(fs.readFileSync(file, 'utf8'));
	s.hooks.PreToolUse = entry;
	fs.writeFileSync(file, '\uFEFF' + JSON.stringify(s, null, 2));
	const local = path.join(proj, '.claude', 'settings.local.json');
	fs.writeFileSync(local, JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, hooks: { PreToolUse: entry } }, null, 2));
	const r = install({ kit: KIT, home, target: 'project', projectDir: proj });
	for (const f of [file, local]) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /guard\.cjs/, `${path.basename(f)} still runs guard.cjs`);
	assert.deepEqual(JSON.parse(fs.readFileSync(local, 'utf8')).permissions.allow, ['Bash(ls)'], 'the rest of settings.local.json stays');
	assert.ok(fs.existsSync(path.join(r.backupDir, '.claude', 'settings.local.json')), 'the old settings.local.json is backed up');
	const use = JSON.parse(spawnSync(process.execPath, [path.join(proj, '.claude', 'use-check.mjs'), '--json'], { cwd: proj, encoding: 'utf8', env: { ...ENV, KIT_CLAUDE_HOME: home } }).stdout);
	assert.equal(use.parts.find((p) => p.name === 'guards').wired.ok, true);
});

// why: guards rule:outward-acts
test('V3 user settings: a launcher entry kept by name but made harmless is refused mid-session, and status calls it a fault', () => {
	const launch = (list) => list.find((e) => JSON.stringify(e).includes('kit-launch'));
	const breakers = {
		'a matcher for no tool': (u) => { launch(u.hooks.PreToolUse).matcher = 'NoSuchTool'; },
		'a command that only names it': (u) => { const h = launch(u.hooks.PreToolUse).hooks[0]; h.command = 'echo kit-launch.cjs'; delete h.args; },
		'an if that never matches': (u) => { launch(u.hooks.PreToolUse).hooks[0].if = 'Bash(nothing *)'; },
		'onFailure dropped': (u) => { delete launch(u.hooks.PreToolUse).hooks[0].onFailure; },
		'ConfigChange narrowed to skills': (u) => { launch(u.hooks.ConfigChange).matcher = 'skills'; },
		'another node': (u) => { const h = launch(u.hooks.PreToolUse).hooks[0]; h.command = h.command.replace(/^NODE_OPTIONS= '[^']*'/, "NODE_OPTIONS= '/tmp/node'"); },
	};
	for (const [name, change] of Object.entries(breakers)) {
		const { home, proj, session: s } = setup();
		const file = path.join(home, 'settings.json');
		const u = JSON.parse(fs.readFileSync(file, 'utf8'));
		change(u);
		fs.writeFileSync(file, JSON.stringify(u));
		assert.equal(s.changed(file, 'user_settings'), 'blocked', name);
		assert.match(status(home, proj).text, /launcher is not wired/, name);
	}
	for (const [name, change] of Object.entries({ 'invalid JSON': (f) => fs.writeFileSync(f, '{ broken'), 'deleted': (f) => fs.rmSync(f) })) {
		const { home, session: s } = setup();
		const file = path.join(home, 'settings.json');
		change(file);
		assert.equal(s.changed(file, 'user_settings'), 'blocked', name);
	}
});

// why: guards rule:outward-acts
test('V3 config folder inside a project: the user slip-catchers still run', () => {
	const { home, proj } = setup({ homeAt: path.join('app', 'u', '.claude') });
	const cap = "exports.check = () => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'cap reached' } });\n";
	fs.writeFileSync(path.join(home, 'kit-hooks', 'call-cap.cjs'), cap);
	// Recorded as install user would record it: since B23 a kit hook loads only with the bytes the stamp names.
	const stampFile = path.join(home, 'kit-install.json');
	const stamp = JSON.parse(fs.readFileSync(stampFile, 'utf8'));
	stamp.files['kit-hooks/call-cap.cjs'] = crypto.createHash('sha256').update(cap).digest('hex');
	fs.writeFileSync(stampFile, JSON.stringify(stamp));
	const r = spawnSync(process.execPath, [path.join(home, 'kit-tools', 'kit-launch.cjs')], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'README.md' }, agent_id: 'r1', cwd: proj }), encoding: 'utf8', env: { ...ENV, CLAUDE_PROJECT_DIR: proj } });
	assert.notEqual(r.stdout.trim(), '', r.stderr);
	assert.match(JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason, /cap reached/);
});

// B17 (the 1.25.1 sweep): the emulator ran a shell-form hook with the bash PATH finds first. From PowerShell on Windows
// that is WSL's bash, which cannot run the launcher line, so the suite failed at its baseline and a deny-only test
// passed for the wrong reason. Claude Code runs these lines with Git Bash, so the emulator does too.
// why: guards rule:outward-acts
test('B17 emulator: a shell-form hook runs in Git Bash on Windows, whatever bash PATH finds first', { skip: process.platform !== 'win32' }, () => {
	const r = spawnSync(BASH, ['-c', 'uname -s'], { encoding: 'utf8', env: { ...ENV, PATH: path.dirname(process.execPath) } });
	assert.match(r.stdout, /MINGW|MSYS/, `the emulator's shell is ${BASH}: ${r.stdout}${r.stderr}`);
});

// why: guards rule:outward-acts
test('V3 record names: two projects whose names differ only in punctuation keep separate records', () => {
	assert.notEqual(guardDir('/h', '/w/app-x'), guardDir('/h', '/w/app_x'));
	assert.notEqual(guardDir('/h', '/w/app.x'), guardDir('/h', '/w/app-x'));
});

// B13 (the 1.25.1 sweep): the shims sit at <config>/kit-guard/<the whole project path, then a hash>/hooks/<name>. A long
// project path took that past Windows' 260 characters, git found no hook there, and the kit hooks stopped silently.
// why: guards rule:outward-acts
test('B13 record names: a long project path still gives a shim path git can open on Windows', () => {
	const deep = (tail) => '/w/' + 'a-very-long-folder-name/'.repeat(12) + tail;
	const shim = path.join(guardDir('D:/a-home-folder/.claude', deep('app')), 'hooks', 'p4-prepare-changelist');
	assert.ok(shim.length < 260, `the shim path is ${shim.length} characters`);
	assert.notEqual(guardDir('/h', deep('app-1')), guardDir('/h', deep('app-2')), 'two long paths that share a start share a record');
	// An installed project keeps its record across the upgrade: a short path's name is the one 1.25.1 gave it.
	const full = process.platform === 'win32' ? path.resolve('/w/app').toLowerCase() : path.resolve('/w/app');
	const was = `${full.replace(/[^A-Za-z0-9]/g, '-')}-${crypto.createHash('sha256').update(full).digest('hex').slice(0, 10)}`;
	assert.equal(path.basename(guardDir('/h', '/w/app')), was, 'a short path lost the record name 1.25.1 gave it');
});

// why: guards rule:outward-acts
test('V3 launcher: input it cannot read inside a kit project holds the call', () => {
	const { home, proj } = setup();
	const r = spawnSync(process.execPath, [path.join(home, 'kit-tools', 'kit-launch.cjs')], { input: 'not json', encoding: 'utf8', env: { ...ENV, CLAUDE_PROJECT_DIR: proj } });
	assert.equal(JSON.parse(r.stdout || '{}').hookSpecificOutput?.permissionDecision, 'deny');
});

// why: guards rule:outward-acts
test('V3 record: the install record and a config folder with another name are guarded too', () => {
	const { home, proj, session: s } = setup({ homeAt: 'cfg' });
	assert.equal(s.decide('Write', { file_path: path.join(home, 'kit-install.json'), content: '{"kitDir":"/tmp/evil"}' }).decision, 'deny');
	assert.equal(s.decide('Write', { file_path: path.join(guardDir(home, proj), 'record.json'), content: '{}' }).decision, 'deny');
});

// why: guards rule:outward-acts
test('V3 shims: a project folder with a dollar sign in its name still commits through the shims', () => {
	const { proj } = setup({ projName: 'app$x' });
	fs.writeFileSync(path.join(proj, 'README.md'), 'two\n');
	const r = git(proj, ['commit', '-q', '-am', 'docs: change the readme']);
	assert.equal(r.status, 0, r.stderr);
});

// ---- The automatic review of 670b3a2 (fix all). ----

// why: guards rule:outward-acts
test('V3 hooksPath: a git config the launcher cannot read holds every call', () => {
	const { proj, session: s } = setup();
	const cfg = path.join(proj, '.git', 'config');
	fs.renameSync(cfg, cfg + '.moved');
	fs.mkdirSync(cfg);
	const d = bash(s, 'git status');
	assert.equal(d.decision, 'deny');
	assert.match(d.reason, /hooksPath/);
});

// why: guards rule:outward-acts
test('V3 install: a kit guard file is put back even when the project stamp was edited to forget it', () => {
	const { home, proj } = setup();
	const stamp = path.join(proj, '.kit', 'kit-version.json');
	const st = JSON.parse(fs.readFileSync(stamp, 'utf8'));
	delete st.files['.githooks/pre-push'];
	fs.writeFileSync(stamp, JSON.stringify(st));
	const EVIL = ['#!/bin/sh', 'exit 0', ''].join(String.fromCharCode(10));
	fs.writeFileSync(path.join(proj, '.githooks', 'pre-push'), EVIL);
	const r = install({ kit: KIT, home, target: 'project', projectDir: proj });
	assert.notEqual(fs.readFileSync(path.join(proj, '.githooks', 'pre-push'), 'utf8'), EVIL);
	assert.ok(r.replaced.includes('.githooks/pre-push'));
});

// why: guards rule:outward-acts
test('V3 host hooks: a swapped host hook stays held through a reinstall until the owner accepts it', () => {
	const HOST = ['#!/bin/sh', 'echo host-pre-commit', ''].join(String.fromCharCode(10));
	const { home, proj, session: s } = setup({
		before: (p) => {
			fs.mkdirSync(path.join(p, '.githooks'));
			fs.writeFileSync(path.join(p, '.githooks', 'pre-commit'), HOST);
			ok(git(p, ['add', '.githooks/pre-commit']));
			ok(git(p, ['commit', '-q', '-m', 'chore: host hook']));
		},
	});
	// Accepted first, so the hold below comes from the swap, not from the first-install hold (the 1.26.0 sweep).
	install({ kit: KIT, home, target: 'project', projectDir: proj, acceptHost: ['.githooks/pre-commit'] });
	assert.equal(bash(s, 'git status').decision, 'allow');
	fs.writeFileSync(path.join(proj, '.githooks', 'pre-commit'), ['#!/bin/sh', 'exit 0', ''].join(String.fromCharCode(10)));
	install({ kit: KIT, home, target: 'project', projectDir: proj });
	assert.equal(bash(s, 'git status').decision, 'deny', 'a reinstall took the swapped host hook as the new normal');
	install({ kit: KIT, home, target: 'project', projectDir: proj, acceptHost: ['.githooks/pre-commit'] });
	assert.equal(bash(s, 'git status').decision, 'allow');
	const fix = fixOf(KIT, proj, ' --accept-host .githooks/pre-commit');
	fs.writeFileSync(path.join(proj, '.githooks', 'pre-commit'), ['#!/bin/sh', 'exit 3', ''].join(String.fromCharCode(10)));
	assert.equal(bash(s, fix).decision, 'deny', 'accepting a host hook is the owner\'s act, not the held fix line');
});

// B16 (the 1.25.1 sweep): in tracked mode the project stamp is in git, so a branch can edit it. On the first install
// with no outside record, install read "the kit never wrote this file" from that stamp and recorded a swapped
// guard.cjs as the host's own. Now such a file holds every call until the owner accepts it.
// why: guards rule:outward-acts
test('B16 first record: a tracked stamp that forgets a swapped kit guard file does not make it the host\'s', () => {
	const { home, proj, session: s } = setup();
	fs.rmSync(guardDir(home, proj), { recursive: true, force: true });
	const stampFile = path.join(proj, '.kit', 'kit-version.json');
	const stamp = JSON.parse(fs.readFileSync(stampFile, 'utf8'));
	delete stamp.files['.claude/guard.cjs'];
	fs.writeFileSync(stampFile, JSON.stringify(stamp, null, 2));
	fs.writeFileSync(path.join(proj, '.claude', 'guard.cjs'), EVIL_GUARD);
	ok(git(proj, ['add', '-f', '.kit/kit-version.json', '.claude/guard.cjs']));
	ok(git(proj, ['commit', '-q', '--no-verify', '-m', 'chore: tracked kit']));
	install({ kit: KIT, home, target: 'project', projectDir: proj });
	assert.equal(bash(s, 'git push origin main').decision, 'deny', 'the swapped guard was recorded as the host\'s and ran');
});

// The 1.26.0 sweep: the first-install hold named install project --force as a way out, but --force wrote the kit's copy
// and the hold stayed. Either way out the refusal names must lift it.
// why: guards rule:outward-acts
test('B16 first record: the --force way out puts the kit\'s copy back and lifts the hold', () => {
	const { home, proj, session: s } = setup({
		before: (p) => {
			fs.mkdirSync(path.join(p, '.githooks'));
			fs.writeFileSync(path.join(p, '.githooks', 'pre-commit'), ['#!/bin/sh', 'echo team', ''].join(String.fromCharCode(10)));
			ok(git(p, ['add', '.githooks/pre-commit']));
			ok(git(p, ['commit', '-q', '-m', 'chore: team hook']));
		},
	});
	assert.equal(bash(s, 'git status').decision, 'deny');
	install({ kit: KIT, home, target: 'project', projectDir: proj, force: true });
	assert.equal(bash(s, 'git status').decision, 'allow', 'the --force way out left the hold in place');
});

// B15 (the 1.25.1 sweep): a host hook that differs between branches held after a plain checkout, and accepting it on
// one branch held the other. Each version the owner accepts stays accepted; a version never accepted still holds.
// why: guards rule:outward-acts
test('B15 host hooks: a host hook accepted on each branch no longer holds a plain checkout', () => {
	const NL = String.fromCharCode(10);
	const { home, proj, session: s } = setup({
		before: (p) => {
			fs.mkdirSync(path.join(p, '.githooks'));
			fs.writeFileSync(path.join(p, '.githooks', 'pre-commit'), ['#!/bin/sh', 'echo main', ''].join(NL));
			ok(git(p, ['add', '.githooks/pre-commit']));
			ok(git(p, ['commit', '-q', '-m', 'chore: host hook']));
		},
	});
	// The first install holds a kit-named host hook until the owner accepts it (B16).
	install({ kit: KIT, home, target: 'project', projectDir: proj, acceptHost: ['.githooks/pre-commit'] });
	ok(git(proj, ['checkout', '-q', '-b', 'feature/b']));
	fs.writeFileSync(path.join(proj, '.githooks', 'pre-commit'), ['#!/bin/sh', 'echo branch', ''].join(NL));
	ok(git(proj, ['commit', '-q', '--no-verify', '-am', 'chore: branch hook']));
	assert.equal(bash(s, 'git status').decision, 'deny', 'a host hook never accepted must hold');
	install({ kit: KIT, home, target: 'project', projectDir: proj, acceptHost: ['.githooks/pre-commit'] });
	assert.equal(bash(s, 'git status').decision, 'allow');
	ok(git(proj, ['checkout', '-q', 'main']));
	assert.equal(bash(s, 'git status').decision, 'allow', 'the version on main, accepted at the first install, held again');
	ok(git(proj, ['checkout', '-q', 'feature/b']));
	assert.equal(bash(s, 'git status').decision, 'allow', 'the accepted branch version held again');
	fs.writeFileSync(path.join(proj, '.githooks', 'pre-commit'), ['#!/bin/sh', 'exit 0', ''].join(NL));
	assert.equal(bash(s, 'git status').decision, 'deny', 'a third version, never accepted, passed');
});

// why: guards rule:security-standards (a guard file is the kit's unless the owner accepts the project's own). The
// 1.26.0 carry-overs: on a reinstall a guard file a later release adds, already tracked by a branch, was taken as the
// host's and recorded as good (C1); a host entry for a kit file from a record written before the owner had to accept
// one stayed accepted (C10).
const hostHook = (p) => {
	fs.mkdirSync(path.join(p, '.githooks'));
	fs.writeFileSync(path.join(p, '.githooks', 'pre-commit'), ['#!/bin/sh', 'echo host', ''].join(String.fromCharCode(10)));
	ok(git(p, ['add', '.githooks/pre-commit']));
	ok(git(p, ['commit', '-q', '-m', 'chore: host hook']));
};
// why: guards rule:outward-acts
test('C1 reinstall: a guard file a later release adds, already tracked by a branch, holds until the owner accepts it', () => {
	const { home, proj, session: s } = setup();
	const kit = path.join(kitTemp.makeTemp('c1kit-'), 'kit');
	fs.cpSync(KIT, kit, { recursive: true, filter: (src) => !/[\\/](\.git|reports|node_modules|tests|vendor)$/.test(src) });
	fs.writeFileSync(path.join(kit, 'project', '.claude', 'later-guard.cjs'), "'use strict';\nmodule.exports = {};\n");
	fs.writeFileSync(path.join(proj, '.claude', 'later-guard.cjs'), EVIL_GUARD);
	ok(git(proj, ['add', '-f', '.claude/later-guard.cjs']));
	ok(git(proj, ['commit', '-q', '--no-verify', '-m', 'chore: plant']));
	const r = install({ kit, home, target: 'project', projectDir: proj });
	assert.ok(r.skipped.some((x) => x.file === '.claude/later-guard.cjs'), 'the planted file was recorded as the host\'s');
	assert.equal(bash(s, 'git status').decision, 'deny');
	install({ kit, home, target: 'project', projectDir: proj, acceptHost: ['.claude/later-guard.cjs'] });
	assert.equal(bash(s, 'git status').decision, 'allow', 'the owner\'s accept is the way out');
});
// why: guards rule:outward-acts
test('C10 reinstall: a kit file a record took as the host\'s before the owner had to accept it holds until accepted', () => {
	const { home, proj, session: s } = setup({ before: hostHook });
	install({ kit: KIT, home, target: 'project', projectDir: proj, acceptHost: ['.githooks/pre-commit'] });
	assert.equal(bash(s, 'git status').decision, 'allow');
	// A record from before the owner's accept was kept: the host entry is there, the accept is not.
	const file = path.join(guardDir(home, proj), 'record.json');
	const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
	delete rec.ownerAccepted;
	rec.version = '1.25.1';
	fs.writeFileSync(file, JSON.stringify(rec, null, 2));
	install({ kit: KIT, home, target: 'project', projectDir: proj });
	assert.equal(bash(s, 'git status').decision, 'deny', 'a host entry the owner never accepted stayed accepted');
	install({ kit: KIT, home, target: 'project', projectDir: proj, acceptHost: ['.githooks/pre-commit'] });
	assert.equal(bash(s, 'git status').decision, 'allow');
});

// why: catches a lost record on upgrade (the 1.26.0 carry-over C2): B13 cut long record names, and a record 1.25.1 wrote
// under the whole name was no longer found, so the owner's host accepts were lost.
test('C2 record names: install finds a long-named record 1.25.1 wrote, keeps its accepts and moves it', () => {
	const { home, proj, session: s } = setup({ projName: 'app-with-a-long-name-' + 'x'.repeat(40), before: hostHook });
	install({ kit: KIT, home, target: 'project', projectDir: proj, acceptHost: ['.githooks/pre-commit'] });
	const now = guardDir(home, proj);
	const full = process.platform === 'win32' ? path.resolve(proj).toLowerCase() : path.resolve(proj);
	const legacy = path.join(home, 'kit-guard', `${full.replace(/[^A-Za-z0-9]/g, '-')}-${crypto.createHash('sha256').update(full).digest('hex').slice(0, 10)}`);
	assert.notEqual(now, legacy, 'the test path is not long enough to be cut');
	fs.renameSync(now, legacy);
	install({ kit: KIT, home, target: 'project', projectDir: proj });
	assert.equal(fs.existsSync(legacy), false, 'the old record was left behind');
	assert.equal(bash(s, 'git status').decision, 'allow', 'the owner\'s accept was lost with the old record');
});

// why: guards rule:security-standards (every shim checks the guard files before a project hook runs). The 1.26.0
// carry-over C9: a project installed before the shims checked every hook kept its old shims until install project ran.
test('C9 install user: every recorded project gets the current shims, and the launcher still passes', () => {
	const { home, proj, session: s } = setup();
	const hooks = path.join(guardDir(home, proj), 'hooks');
	const file = path.join(guardDir(home, proj), 'record.json');
	const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
	// An old shim: it runs the project hook with no check first.
	const old = ['#!/bin/sh', `[ -x '${posix(proj)}/.githooks/post-checkout' ] || exit 0`, `exec '${posix(proj)}/.githooks/post-checkout' "$@"`, ''].join(String.fromCharCode(10));
	fs.writeFileSync(path.join(hooks, 'post-checkout'), old);
	rec.shims['post-checkout'] = crypto.createHash('sha256').update(old).digest('hex');
	fs.writeFileSync(file, JSON.stringify(rec, null, 2));
	install({ kit: KIT, home, target: 'user' });
	assert.match(fs.readFileSync(path.join(hooks, 'post-checkout'), 'utf8'), /git-hook/, 'the old shim was kept');
	assert.equal(bash(s, 'git status').decision, 'allow');
});

// why: guards rule:first-push-gate (the 1.27.0 sweep, high): the new shims run a project's hooks from the launcher's
// copy, which only a 1.27.0 first-push-check can place; a project still on an older kit could no longer commit, so
// install user leaves its shims and names the project.
test('install user leaves the shims of a project still on an older kit, and says so', () => {
	const { home, proj } = setup();
	const hooks = path.join(guardDir(home, proj), 'hooks');
	const file = path.join(guardDir(home, proj), 'record.json');
	const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
	const shim = (name) => fs.readFileSync(path.join(hooks, name), 'utf8');
	const before = shim('pre-commit');
	// A 1.26.0 first-push-check finds its project from its own folder only.
	const fpc = path.join(proj, '.claude', 'first-push-check.mjs');
	fs.writeFileSync(fpc, "// The 1.26.0 first push gate: its project is the folder above its own.\nconsole.log('first push check: old');\n");
	assert.doesNotMatch(fs.readFileSync(fpc, 'utf8'), /KIT_HOOK_PROJECT/, 'the old script was not made');
	fs.writeFileSync(path.join(hooks, 'pre-commit'), before + '# old\n');
	rec.shims['pre-commit'] = crypto.createHash('sha256').update(before + '# old\n').digest('hex');
	// The record accepted this older file, as an install project of the older kit would have.
	const older = crypto.createHash('sha256').update(fs.readFileSync(fpc)).digest('hex');
	rec.files['.claude/first-push-check.mjs'] = older;
	fs.writeFileSync(file, JSON.stringify(rec, null, 2));
	const r = install({ kit: KIT, home, target: 'user' });
	assert.equal(shim('pre-commit'), before + '# old\n', 'an older project got shims its hooks cannot run under');
	assert.ok(r.skipped.some((x) => x.reason.includes(posix(proj)) && /install project/.test(x.reason)), JSON.stringify(r.skipped));
	// An old-looking file the record never accepted is not an older kit: the project gets this release's shims (the
	// security review of the fix: the project's live file alone must not keep the old shims).
	fs.appendFileSync(fpc, '// edited\n');
	const r2 = install({ kit: KIT, home, target: 'user' });
	assert.notEqual(shim('pre-commit'), before + '# old\n', 'an unrecorded file kept the old shims');
	assert.ok(!r2.skipped.some((x) => x.reason.includes('runs an older kit')), JSON.stringify(r2.skipped));
});

// why: guards rule:security-standards (the hook that runs is the one the launcher checked). The 1.26.0 carry-over C11:
// a shim checked the hook's hash, then ran the project's file by its path, so a swap in between ran.
test('C11 shims: a git hook runs from the copy the launcher checked, never from the project file read again', () => {
	const { home, proj } = setup();
	const hooks = path.join(guardDir(home, proj), 'hooks');
	for (const name of ['pre-commit', 'post-checkout']) assert.doesNotMatch(fs.readFileSync(path.join(hooks, name), 'utf8'), /exec '[^']*\.githooks\//, `${name} runs the project's file`);
	fs.writeFileSync(path.join(proj, 'a.md'), 'a\n');
	ok(git(proj, ['add', 'a.md']));
	ok(git(proj, ['commit', '-q', '-m', 'docs: a']));
	const runs = path.join(guardDir(home, proj), 'run');
	const copies = fs.readdirSync(runs);
	assert.equal(copies.length, 1, 'the checked copy was not written');
	assert.equal(fs.readFileSync(path.join(runs, copies[0], '.githooks', 'pre-commit'), 'utf8'), fs.readFileSync(path.join(proj, '.githooks', 'pre-commit'), 'utf8'));
	// A copy changed after it was written is written afresh before it runs (the review on cfd3813).
	fs.writeFileSync(path.join(runs, copies[0], '.githooks', 'pre-commit'), '#!/bin/sh\nexit 0\n');
	fs.writeFileSync(path.join(runs, copies[0], 'extra'), 'x');
	const launcher = path.join(home, 'kit-tools', 'kit-launch.cjs');
	const r = spawnSync(process.execPath, [launcher, 'git-hook', proj, 'pre-commit'], { encoding: 'utf8', env: { ...ENV, CLAUDE_CONFIG_DIR: home } });
	assert.equal(r.status, 0, r.stderr);
	assert.equal(fs.readFileSync(r.stdout, 'utf8'), fs.readFileSync(path.join(proj, '.githooks', 'pre-commit'), 'utf8'), 'a changed copy ran');
	assert.equal(fs.existsSync(path.join(runs, copies[0], 'extra')), false);
});

// why: catches a blocked call (the 1.25.0 carry-over R4.2): old-shape user hooks ran up to 5 s each inside the guard's
// 10 s, so two slow ones timed the guard out and the call was blocked.
test('R4.2 slow old-shape kit hooks are cut short, and the call is answered well inside the guard time limit', () => {
	const { home, proj } = setup();
	const stampFile = path.join(home, 'kit-install.json');
	const stamp = JSON.parse(fs.readFileSync(stampFile, 'utf8'));
	const slow = 'setTimeout(() => {}, 60000);\n';
	for (const f of ['canary.cjs', 'sweep-guard.cjs']) {
		fs.writeFileSync(path.join(home, 'kit-hooks', f), slow);
		stamp.files[`kit-hooks/${f}`] = crypto.createHash('sha256').update(slow).digest('hex');
	}
	fs.writeFileSync(stampFile, JSON.stringify(stamp, null, 2));
	const input = { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { prompt: 'x' }, cwd: proj, session_id: 's1' };
	// K14: the limit is the clock here (the point is the cut), stretched only by how slow this machine starts an idle
	// node (about 65 ms on the owner's PC; a shared runner has run ten times slower).
	const idleAt = Date.now();
	spawnSync(process.execPath, ['-e', '']);
	const slowness = Math.max(1, (Date.now() - idleAt) / 150);
	const t0 = Date.now();
	const r = spawnSync(process.execPath, [path.join(home, 'kit-tools', 'kit-launch.cjs')], { input: JSON.stringify(input), encoding: 'utf8', env: { ...ENV, CLAUDE_PROJECT_DIR: proj, CLAUDE_CONFIG_DIR: home }, timeout: 20000 });
	assert.equal(r.status, 0, r.stderr);
	assert.ok(Date.now() - t0 < Math.min(8000 * slowness, 19000), `the guard took ${Date.now() - t0} ms on a machine ${slowness.toFixed(1)} times slow`);
	// A hook cut short says so, as a changed one does (C12).
	assert.match(r.stdout, /canary.cjs ran out of its time/);
});

// why: catches a silent switch-off (the 1.26.0 carry-over C12): a kit hook the owner kept or merged by hand no longer
// matches its recorded bytes, so the one guard process skips it; the session must hear that, not lose it in silence.
test('C12 kit hooks: a changed kit hook that is skipped says so', () => {
	const { home, proj } = setup();
	fs.appendFileSync(path.join(home, 'kit-hooks', 'canary.cjs'), '\n// merged by hand\n');
	const input = { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { prompt: 'x', subagent_type: 'reviewer' }, cwd: proj, session_id: 's1' };
	const r = spawnSync(process.execPath, [path.join(home, 'kit-tools', 'kit-launch.cjs')], { input: JSON.stringify(input), encoding: 'utf8', env: { ...ENV, CLAUDE_PROJECT_DIR: proj, CLAUDE_CONFIG_DIR: home } });
	assert.match(r.stdout, /canary\.cjs[^"]*install user/, `a skipped kit hook went unmentioned: ${r.stdout}`);
});

// The owner's pick A (2026-11-11): a broken launcher keeps blocking every tool, and the kit gate tells the owner why and what
// to run, on every prompt, in any folder.
// why: guards rule:outward-acts
test('V3 broken launcher: the kit gate names it and the one command that repairs it', () => {
	const { root, home } = setup();
	const other = path.join(root, 'plain');
	fs.mkdirSync(path.join(other, '.kit'), { recursive: true });
	fs.writeFileSync(path.join(other, '.kit', 'no-kit'), '');
	const gate = (env = {}) => spawnSync(process.execPath, [path.join(home, 'kit-hooks', 'kit-gate.cjs')], { input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'hi', cwd: other }), encoding: 'utf8', env: { ...ENV, KIT_CLAUDE_HOME: home, ...env } });
	assert.equal(gate().stdout.trim(), '', 'a whole launcher says nothing');
	fs.writeFileSync(path.join(home, 'kit-tools', 'kit-launch.cjs'), Buffer.alloc(64));
	const out = JSON.parse(gate().stdout || '{}');
	assert.equal(out.decision, 'block');
	assert.match(out.reason, /kit-launch\.cjs/);
	assert.match(out.reason, /install user/);
	fs.rmSync(path.join(home, 'kit-tools', 'kit-launch.cjs'));
	assert.equal(JSON.parse(gate().stdout || '{}').decision, 'block', 'a missing launcher too');
});

// B14 (the 1.25.1 sweep): the launcher entry names node by the path install user recorded. A node moved or upgraded
// blocks every call with "No such file", and the gate named only a missing launcher, so the owner saw no reason.
// why: guards rule:outward-acts
test('B14 moved node: the kit gate names the missing recorded node and the command that repairs it', () => {
	const { root, home } = setup();
	const other = path.join(root, 'plain');
	fs.mkdirSync(path.join(other, '.kit'), { recursive: true });
	fs.writeFileSync(path.join(other, '.kit', 'no-kit'), '');
	const gate = () => spawnSync(process.execPath, [path.join(home, 'kit-hooks', 'kit-gate.cjs')], { input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'hi', cwd: other }), encoding: 'utf8', env: { ...ENV, KIT_CLAUDE_HOME: home } });
	const stampFile = path.join(home, 'kit-install.json');
	const stamp = JSON.parse(fs.readFileSync(stampFile, 'utf8'));
	stamp.node = posix(path.join(root, 'gone', 'node.exe'));
	fs.writeFileSync(stampFile, JSON.stringify(stamp));
	const out = JSON.parse(gate().stdout || '{}');
	assert.equal(out.decision, 'block', 'a moved node blocked every call and the gate said nothing');
	assert.match(out.reason, /gone\/node\.exe/);
	assert.match(out.reason, /install user/);
});

// why: catches a project that cannot commit with no fix named (K4, the 1.27.0 sweep): install project over an older
// user layer wrote shims that ask the launcher for a checked copy the old launcher does not give, so git ran exec "".
test('K4 shims: an older launcher that gives no checked hook names the fix instead of running nothing', () => {
	const { home, proj } = setup();
	// The 1.26.0 launcher checks and exits 0, printing no copy.
	fs.writeFileSync(path.join(home, 'kit-tools', 'kit-launch.cjs'), "'use strict';\nprocess.exit(0);\n");
	fs.writeFileSync(path.join(proj, 'k.md'), 'k\n');
	ok(git(proj, ['add', 'k.md']));
	const r = git(proj, ['commit', '-q', '-m', 'docs: k']);
	assert.notEqual(r.status, 0, 'the commit went through with no hook run');
	assert.match(r.stderr, /install user/);
	assert.doesNotMatch(r.stderr, /exec: : not found|cannot execute|Permission denied/);
});
// why: guards rule:outward-acts. R6.4 (the 1.25.0 sweep): a pin read the placeholder in the kit's source, and no test
// read what install makes of it. The installed guard holds no placeholder and names this install's Claude folder,
// which is where it looks for the user layer's checks.
test('R6.4 install fills in where the user layer sits: the installed guard names the Claude folder, no placeholder', () => {
	const { home, proj } = setup();
	const text = fs.readFileSync(path.join(proj, '.claude', 'guard.cjs'), 'utf8');
	assert.doesNotMatch(text, /\{\{/);
	const named = JSON.parse(/const INSTALLED_HOME = ("(?:[^"\\]|\\.)*");/.exec(text)[1]);
	assert.equal(path.resolve(named), path.resolve(home));
});

// why: guards rule:outward-acts. C13 (reproduced 2026-11-13: Claude Code names a project folder by the first 200
// characters of the path's slug, a dash and a short hash once the slug is longer). A session whose shell stands
// outside its project is found by its transcript's folder; for a long path that name never equalled the full slug,
// so the project was not found and its guards did not run.
test('C13 a project with a long path is found by its transcript folder, the name Claude Code shortens', () => {
	const home = kitTemp.makeTemp('c13-');
	fs.mkdirSync(path.join(home, 'kit-tools'));
	fs.copyFileSync(path.join(KIT, 'user', 'kit-tools', 'kit-launch.cjs'), path.join(home, 'kit-tools', 'kit-launch.cjs'));
	const launch = createRequire(import.meta.url)(path.join(home, 'kit-tools', 'kit-launch.cjs'));
	const slugOf = (dir) => path.resolve(dir).replace(/[^A-Za-z0-9]/g, '-');
	const record = (dir) => {
		const at = path.join(home, 'kit-guard', launch.recordName(dir));
		fs.mkdirSync(at, { recursive: true });
		fs.writeFileSync(path.join(at, 'record.json'), JSON.stringify({ projectDir: dir, files: {} }));
	};
	const long = path.join(home, 'work', 'a'.repeat(80), 'b'.repeat(80), 'c'.repeat(80));
	const short = path.join(home, 'work', 'app');
	record(long);
	record(short);
	const from = (folder) => launch.findProject({ cwd: os.tmpdir(), transcript_path: path.join(home, 'projects', folder, 's.jsonl') });
	const before = process.env.CLAUDE_PROJECT_DIR;
	delete process.env.CLAUDE_PROJECT_DIR;
	try {
		assert.ok(slugOf(long).length > 200);
		assert.equal(from(`${slugOf(long).slice(0, 200)}-s157ju`).dir, path.resolve(long));
		assert.equal(from(slugOf(short)).dir, path.resolve(short), 'a short path, by its whole name');
		// Another long path that shares no 200 characters, and a short name with a tail, are not it.
		assert.equal(from(`${slugOf(path.join(home, 'other', 'a'.repeat(240))).slice(0, 200)}-s157ju`), null);
		assert.equal(from(`${slugOf(short)}-s157ju`), null);
		// Two long paths alike in their first 200 characters cannot be told apart by this name: neither is taken.
		const twin = path.join(home, 'work', 'a'.repeat(80), 'b'.repeat(80), 'c'.repeat(80) + '-two');
		record(twin);
		assert.deepEqual(from(`${slugOf(long).slice(0, 200)}-s157ju`), { ambiguous: true });
	} finally {
		if (before !== undefined) process.env.CLAUDE_PROJECT_DIR = before;
	}
});

// why: guards rule:security-standards. The 1.29.0 sweep (two reviewers, the same hole): a folder list that was only read
// from the project could be dropped by a branch switch, a reset, a stash or a clean, and every folder on it lost
// its hold. Install records the list outside the project, as it records a host's own hook: gone or changed, every
// call is held until the owner accepts it in their own terminal, and no tool call may carry that flag.
test('a folder list gone or changed since install holds every call until the owner accepts it', () => {
	const { home, proj } = setup({ before: (p) => { fs.mkdirSync(path.join(p, '.claude'), { recursive: true }); fs.writeFileSync(path.join(p, '.claude', 'protected-folders.json'), JSON.stringify({ folders: ['vault'] })); } });
	const list = path.join(proj, '.claude', 'protected-folders.json');
	const call = (command) => {
		const r = spawnSync(process.execPath, [path.join(home, 'kit-tools', 'kit-launch.cjs')], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: proj, session_id: 's1' }), encoding: 'utf8', env: { ...ENV, CLAUDE_PROJECT_DIR: proj, CLAUDE_CONFIG_DIR: home } });
		return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason || '' : '';
	};
	assert.equal(call('git status'), '', 'as installed');
	const kept = fs.readFileSync(list);
	fs.rmSync(list);
	assert.match(call('git status'), /protected-folders\.json/, 'gone, as after a switch to a branch without it');
	install({ kit: KIT, home, target: 'project', projectDir: proj });
	assert.match(call('git status'), /protected-folders\.json/, 'a plain install does not accept its removal');
	fs.writeFileSync(list, JSON.stringify({ folders: [] }));
	assert.match(call('git status'), /protected-folders\.json/, 'emptied');
	fs.writeFileSync(list, kept);
	assert.equal(call('git status'), '', 'back as recorded');
	// The flag that accepts a change is the owner's, in their own terminal: never in a tool call.
	assert.match(call(`node "${KIT.split(path.sep).join('/')}/scripts/kit.mjs" install project . --accept-host .claude/protected-folders.json`), /^Never by a tool/);
	fs.writeFileSync(list, JSON.stringify({ folders: ['vault', 'more'] }));
	install({ kit: KIT, home, target: 'project', projectDir: proj, acceptHost: ['.claude/protected-folders.json'] });
	assert.equal(call('git status'), '', 'the owner accepted the new list');
	// The flag is refused by install itself in a shell an AI tool started, however the command was spelled.
	fs.writeFileSync(list, JSON.stringify({ folders: [] }));
	const byTool = spawnSync(process.execPath, [path.join(KIT, 'scripts', 'kit.mjs'), 'install', 'project', proj, '--accept-host', '.claude/protected-folders.json'], { encoding: 'utf8', env: { ...ENV, CLAUDECODE: '1', KIT_CLAUDE_HOME: home, CLAUDE_CONFIG_DIR: home } });
	assert.equal(byTool.status, 1, byTool.stdout + byTool.stderr);
	assert.match(call('git status'), /protected-folders\.json/, 'still held');
	// The version accepted before is not accepted again by itself.
	fs.writeFileSync(list, kept);
	assert.match(call('git status'), /protected-folders\.json/, 'an older accepted list');
	// A list the record does not hold yet is held until install records it.
	const fresh = setup();
	fs.mkdirSync(path.join(fresh.proj, '.claude'), { recursive: true });
	fs.writeFileSync(path.join(fresh.proj, '.claude', 'protected-folders.json'), JSON.stringify({ folders: ['vault'] }));
	const held = spawnSync(process.execPath, [path.join(fresh.home, 'kit-tools', 'kit-launch.cjs')], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git status' }, cwd: fresh.proj, session_id: 's1' }), encoding: 'utf8', env: { ...ENV, CLAUDE_PROJECT_DIR: fresh.proj, CLAUDE_CONFIG_DIR: fresh.home } });
	assert.match(held.stdout, /a folder list not in the install record yet/);
	install({ kit: KIT, home: fresh.home, target: 'project', projectDir: fresh.proj });
	const after = spawnSync(process.execPath, [path.join(fresh.home, 'kit-tools', 'kit-launch.cjs')], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git status' }, cwd: fresh.proj, session_id: 's1' }), encoding: 'utf8', env: { ...ENV, CLAUDE_PROJECT_DIR: fresh.proj, CLAUDE_CONFIG_DIR: fresh.home } });
	assert.equal(after.stdout, '', 'recorded by a plain install');
});
