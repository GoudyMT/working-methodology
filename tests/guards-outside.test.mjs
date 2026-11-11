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
		const [cmd, args] = h.args ? [h.command === 'node' ? process.execPath : h.command, h.args] : ['bash', ['-c', h.command]];
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
	// The route must land, or this test proves nothing (the 1.25.1 sweep).
	assert.equal(fs.readFileSync(path.join(proj, '.claude/guard.cjs'), 'utf8'), EVIL_GUARD, `the stash did not apply: ${pop.stderr}`);
	held(s, 'git stash pop');
});

test('V3 script: a script that rewrites a guard module the guard loads holds every later call', () => {
	const { proj, session: s } = setup();
	// What tools/fix.mjs did in the proof: a module that exits 0 on load disarms the one guard process.
	fs.writeFileSync(path.join(proj, '.claude', 'owner-yes.cjs'), 'process.exit(0);\n');
	held(s, 'a script rewrote owner-yes.cjs');
});

// 1.25.0 already failed closed here; what this adds is a refusal that names the deleted file (the 1.25.1 sweep).
test('V3 script: a refusal after a script deletes a guard file names the file', () => {
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

// The security review on c453ec1: core.fsmonitor names a program git runs on git status and git ls-files (proven on
// Git for Windows, 2026-11-11). The held fix line runs install, which runs git in the kit folder and in the project; a
// program named in the project's git config or the user's global one would run inside the one call a hold lets through.
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
	assert.notEqual(r.stdout.trim(), '', 'the launcher found no project from the worktree');
	assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny');
});

// The 1.25.1 security review: the record and the shims are what the launcher trusts, so a tool may not write them, a
// shim swapped there holds every call, and a kit project whose record is gone runs no call until install writes it.
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

test('V3 env: NODE_OPTIONS planted before the session starts cannot load code into the launcher', () => {
	const { root, home, proj } = setup();
	fs.writeFileSync(path.join(proj, '.claude', 'settings.json'), JSON.stringify({ env: { NODE_OPTIONS: `--require ${ALLOW_ALL(root)}` } }));
	const s = session(home, proj);
	const d = bash(s, 'git push origin main');
	assert.equal(d.decision, 'deny');
	assert.match(d.reason, /NODE_OPTIONS/);
});

test('V3 settings: a settings file with a byte-order mark is read, not skipped', () => {
	const { proj, session: s } = setup();
	const local = path.join(proj, '.claude', 'settings.local.json');
	fs.writeFileSync(local, String.fromCharCode(0xfeff) + JSON.stringify({ disableAllHooks: true }));
	assert.equal(s.changed(local, 'local_settings'), 'blocked');
	assert.match(bash(s, 'git status').reason, /disableAllHooks/);
});

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

test('V3 links: a guard file reached through a junction or link holds every call', () => {
	const { root, proj, session: s } = setup();
	const real = path.join(root, 'real-claude');
	fs.renameSync(path.join(proj, '.claude'), real);
	fs.symlinkSync(real, path.join(proj, '.claude'), 'junction');
	assert.equal(bash(s, 'git status').decision, 'deny');
	assert.match(bash(s, 'git status').reason, /link/i);
});

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
	const again = install({ kit: KIT, home, target: 'project', projectDir: proj });
	assert.ok(again.skipped.some((x) => x.file === '.githooks/pre-commit'));
	assert.equal(bash(s, 'git status').decision, 'allow');
	fs.writeFileSync(path.join(proj, '.githooks', 'pre-commit'), ['#!/bin/sh', 'exit 0', ''].join(String.fromCharCode(10)));
	assert.equal(bash(s, 'git status').decision, 'deny', 'a swapped host hook is still a guard file');
});

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

test('V3 record names: two projects whose names differ only in punctuation keep separate records', () => {
	assert.notEqual(guardDir('/h', '/w/app-x'), guardDir('/h', '/w/app_x'));
	assert.notEqual(guardDir('/h', '/w/app.x'), guardDir('/h', '/w/app-x'));
});

// B13 (the 1.25.1 sweep): the shims sit at <config>/kit-guard/<the whole project path, then a hash>/hooks/<name>. A long
// project path took that past Windows' 260 characters, git found no hook there, and the kit hooks stopped silently.
test('B13 record names: a long project path still gives a shim path git can open on Windows', () => {
	const deep = (tail) => '/w/' + 'a-very-long-folder-name/'.repeat(12) + tail;
	const shim = path.join(guardDir('C:/Users/someone/.claude', deep('app')), 'hooks', 'p4-prepare-changelist');
	assert.ok(shim.length < 260, `the shim path is ${shim.length} characters`);
	assert.notEqual(guardDir('/h', deep('app-1')), guardDir('/h', deep('app-2')), 'two long paths that share a start share a record');
	// An installed project keeps its record across the upgrade: a short path's name is the one 1.25.1 gave it.
	const full = process.platform === 'win32' ? path.resolve('/w/app').toLowerCase() : path.resolve('/w/app');
	const was = `${full.replace(/[^A-Za-z0-9]/g, '-')}-${crypto.createHash('sha256').update(full).digest('hex').slice(0, 10)}`;
	assert.equal(path.basename(guardDir('/h', '/w/app')), was, 'a short path lost the record name 1.25.1 gave it');
});

test('V3 launcher: input it cannot read inside a kit project holds the call', () => {
	const { home, proj } = setup();
	const r = spawnSync(process.execPath, [path.join(home, 'kit-tools', 'kit-launch.cjs')], { input: 'not json', encoding: 'utf8', env: { ...ENV, CLAUDE_PROJECT_DIR: proj } });
	assert.equal(JSON.parse(r.stdout || '{}').hookSpecificOutput?.permissionDecision, 'deny');
});

test('V3 record: the install record and a config folder with another name are guarded too', () => {
	const { home, proj, session: s } = setup({ homeAt: 'cfg' });
	assert.equal(s.decide('Write', { file_path: path.join(home, 'kit-install.json'), content: '{"kitDir":"/tmp/evil"}' }).decision, 'deny');
	assert.equal(s.decide('Write', { file_path: path.join(guardDir(home, proj), 'record.json'), content: '{}' }).decision, 'deny');
});

test('V3 shims: a project folder with a dollar sign in its name still commits through the shims', () => {
	const { proj } = setup({ projName: 'app$x' });
	fs.writeFileSync(path.join(proj, 'README.md'), 'two\n');
	const r = git(proj, ['commit', '-q', '-am', 'docs: change the readme']);
	assert.equal(r.status, 0, r.stderr);
});

// ---- The automatic review of 670b3a2 (fix all). ----

test('V3 hooksPath: a git config the launcher cannot read holds every call', () => {
	const { proj, session: s } = setup();
	const cfg = path.join(proj, '.git', 'config');
	fs.renameSync(cfg, cfg + '.moved');
	fs.mkdirSync(cfg);
	const d = bash(s, 'git status');
	assert.equal(d.decision, 'deny');
	assert.match(d.reason, /hooksPath/);
});

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

// B15 (the 1.25.1 sweep): a host hook that differs between branches held after a plain checkout, and accepting it on
// one branch held the other. Each version the owner accepts stays accepted; a version never accepted still holds.
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

// The owner's pick A (2026-11-11): a broken launcher keeps blocking every tool, and the kit gate tells the owner why and what
// to run, on every prompt, in any folder.
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
