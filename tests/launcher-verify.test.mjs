// The launcher's record checks, read in-process (K124 rest, build 17): the planted-bug sweep of
// user/kit-tools/kit-launch.cjs under Linux left 37 survivors, and these tests hold the real ones. Each test runs a copy
// of the launcher whose home is a throwaway folder, so no record or install file of the owner's is read.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const require = createRequire(import.meta.url);
const SRC = path.resolve('user/kit-tools/kit-launch.cjs');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const ID = ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false'];
const git = (cwd, ...a) => { const r = spawnSync('git', [...ID, ...a], { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };

// A launcher copy in a throwaway home (its home is the folder above its own), loaded fresh.
function launcher() {
	const home = kitTemp.makeTemp('lv-home-');
	fs.mkdirSync(path.join(home, 'kit-tools'));
	const file = path.join(home, 'kit-tools', 'kit-launch.cjs');
	fs.copyFileSync(SRC, file);
	return { home, file, L: require(file) };
}
// A project with one guard file, one git hook and a clean settings file, and the record install would write for it.
function project() {
	const dir = kitTemp.makeTemp('lv-proj-');
	fs.mkdirSync(path.join(dir, '.claude'));
	fs.mkdirSync(path.join(dir, '.githooks'));
	fs.writeFileSync(path.join(dir, '.claude', 'guard.cjs'), 'guard\n');
	fs.writeFileSync(path.join(dir, '.githooks', 'pre-commit'), 'hook\n');
	fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), '{}\n');
	const shims = kitTemp.makeTemp('lv-shims-');
	fs.writeFileSync(path.join(shims, 'pre-commit'), 'shim\n');
	const rec = { files: { '.claude/guard.cjs': sha('guard\n'), '.githooks/pre-commit': sha('hook\n') }, shims: { 'pre-commit': sha('shim\n') } };
	return { dir, shims, rec };
}

// why: guards rule:outward-acts (a clean project held as changed stops every call; a changed guard must still be named)
// planted: {"file":"user/kit-tools/kit-launch.cjs","was":"if (at && real && !same2(at, path.join(real, key)))","to":"if (at || real && !same2(at, path.join(real, key)))"}
// planted: {"file":"user/kit-tools/kit-launch.cjs","was":"try { bytes = at && fs.readFileSync(at); }","to":"try { bytes = at || fs.readFileSync(at); }"}
// planted: {"file":"user/kit-tools/kit-launch.cjs","was":"if (!(rec.files || {})[`.githooks/${name}`])","to":"if (!(rec.files && {})[`.githooks/${name}`])"}
// planted: {"file":"user/kit-tools/kit-launch.cjs","was":"if (!(rec.files || {})['.claude/protected-folders.json'] && fs.existsSync","to":"if (!(rec.files || {})['.claude/protected-folders.json'] || fs.existsSync"}
// planted: {"file":"user/kit-tools/kit-launch.cjs","was":"if (rec.shims && !Object.prototype.hasOwnProperty.call(rec.shims, name))","to":"if (rec.shims || !Object.prototype.hasOwnProperty.call(rec.shims, name))"}
// planted: {"file":"user/kit-tools/kit-launch.cjs","was":"if (why && !settings.some((x) => same(x.file, f)))","to":"if (why || !settings.some((x) => same(x.file, f)))"}
// planted: {"file":"user/kit-tools/kit-launch.cjs","was":"return { changed, settings, hooksPath, files, byKey, real: real || path.resolve(dir) };","to":"return { changed, settings, hooksPath, files, byKey, real: real && path.resolve(dir) };"}
test('a project as install left it verifies clean, and only what changed is named', () => {
	const { L } = launcher();
	const { dir, shims, rec } = project();
	const v = L.verify(dir, rec, [], shims);
	assert.deepEqual([v.changed, v.settings, v.hooksPath], [[], [], null]);
	assert.equal(v.real, fs.realpathSync(dir), 'the guards load from the project as the file system names it');
	// A project reached through a link still loads its guards where they really are.
	const link = path.join(kitTemp.makeTemp('lv-link-'), 'p');
	fs.symlinkSync(dir, link, 'junction');
	assert.equal(L.verify(link, rec, [], shims).real, fs.realpathSync(dir));
	fs.writeFileSync(path.join(dir, '.claude', 'guard.cjs'), 'swapped\n');
	assert.deepEqual(L.verify(dir, rec, [], shims).changed, ['.claude/guard.cjs']);
});

// why: guards rule:outward-acts (two folders with a bad settings file are two holds, not one)
// planted: {"file":"user/kit-tools/kit-launch.cjs","was":"const real = (p) => { try { return fs.realpathSync.native(path.resolve(p)); }","to":"const real = (p) => { try { return void fs.realpathSync.native(path.resolve(p)); }"}
// planted: {"file":"user/kit-tools/kit-launch.cjs","was":"const env = s.env && typeof s.env === 'object' ?","to":"const env = s.env && typeof s.env !== 'object' ?"}
// planted: {"file":"user/kit-tools/kit-launch.cjs","was":"if (env.length) return `its env sets","to":"if (env.length) return void `its env sets"}
// planted: {"file":"user/kit-tools/kit-launch.cjs","was":"if (!s || typeof s !== 'object') {","to":"if (!s || typeof s === 'object') {"}
test('a settings env that moves the guards is named in every folder that holds one', () => {
	const { L } = launcher();
	const { dir, shims, rec } = project();
	assert.equal(L.settingsProblem('{"env":{"NODE_OPTIONS":"--require x"}}'), 'its env sets NODE_OPTIONS, which changes how the guards start or where they look'); // pin: 3 (the reason the verify prints)
	assert.equal(L.settingsProblem('{"env":{"EDITOR":"vi"}}'), '');
	const other = kitTemp.makeTemp('lv-other-');
	fs.mkdirSync(path.join(other, '.claude'));
	for (const d of [dir, other]) fs.writeFileSync(path.join(d, '.claude', 'settings.local.json'), '{"env":{"KIT_CLAUDE_HOME":"x"}}');
	assert.equal(L.verify(dir, rec, [other], shims).settings.length, 2);
});

// why: guards rule:outward-acts (core.hooksPath moved off the kit's hooks turns every commit and push check off)
// planted: {"file":"user/kit-tools/kit-launch.cjs","was":"const x = String(p || '')","to":"const x = String(p && '')"}
// planted: {"file":"user/kit-tools/kit-launch.cjs","was":"if (!line || line[0] === '#' || line[0] === ';') continue;","to":"if (!line || line[0] !== '#' || line[0] === ';') continue;"}
// planted: {"file":"user/kit-tools/kit-launch.cjs","was":"else values.push(kv[2] || '');","to":"else values.push(kv[2] && '');"}
// planted: {"file":"user/kit-tools/kit-launch.cjs","was":"if (now !== null && now !== normPath(rec.hooksPath))","to":"if (now === null && now !== normPath(rec.hooksPath))"}
// planted: {"file":"user/kit-tools/kit-launch.cjs","was":"if (head[2].trim() || /^include/.test(section)) plain = false;","to":"if (head[2].trim() && /^include/.test(section)) plain = false;"}
// planted: {"file":"user/kit-tools/kit-launch.cjs","was":"if (plain && values.length <= 1) return normPath(values[0] || '');","to":"if (plain || values.length <= 1) return normPath(values[0] || '');"}
// planted: {"file":"user/kit-tools/kit-launch.cjs","was":"if (r.status !== 0 && r.status !== 1) return 'unreadable","to":"if (r.status === 0 && r.status !== 1) return 'unreadable"}
// planted: {"file":"user/kit-tools/kit-launch.cjs","was":"const all = String(r.stdout || '').split","to":"const all = String(r.stdout && '').split"}
// planted: {"file":"user/kit-tools/kit-launch.cjs","was":"return normPath(all[all.length - 1] || '');","to":"return normPath(all[all.length - 1] && '');"}
// planted: {"file":"user/kit-tools/kit-launch.cjs","was":"try { cfg = fs.readFileSync(path.join(gitDir, 'config'), 'utf8'); } catch { plain = false; }","to":"try { cfg = fs.readFileSync(path.join(gitDir, 'config'), 'utf8'); } catch { plain = true; }"}
test('a hooks path moved in the plain config, on its section line, through an include or in a worktree is named', () => {
	const { L } = launcher();
	const { dir, shims, rec } = project();
	git(dir, 'init', '-q', '-b', 'main');
	const config = path.join(dir, '.git', 'config');
	const base = fs.readFileSync(config, 'utf8');
	const moved = (text) => { fs.writeFileSync(config, base + text); return L.verify(dir, { ...rec, hooksPath: '.githooks' }, [], shims).hooksPath; };
	assert.equal(moved('[core]\n\thooksPath = .githooks\n'), null);
	assert.equal(moved('# a comment\n[core]\n\thooksPath = /tmp/other\n'), '/tmp/other');
	assert.equal(moved('[core] hooksPath = /tmp/other\n'), '/tmp/other', 'a value on the section line');
	fs.writeFileSync(path.join(dir, 'extra.cfg'), '[core]\n\thooksPath = /tmp/other\n');
	assert.equal(moved('[include]\n\tpath = ../extra.cfg\n'), '/tmp/other', 'a value an include brings');
	fs.writeFileSync(path.join(dir, 'extra.cfg'), '[user]\n\tname = x\n');
	assert.equal(moved('[include]\n\tpath = ../extra.cfg\n[core]\n\thooksPath = .githooks\n'), null, 'an include that moves nothing');
	// A worktree reads its main checkout's config, which its own .git file names.
	fs.writeFileSync(config, base + '[core]\n\thooksPath = /tmp/other\n');
	git(dir, 'add', '.');
	git(dir, 'commit', '-q', '-m', 'x');
	const wt = path.join(kitTemp.makeTemp('lv-wt-'), 'w');
	git(dir, 'worktree', 'add', '-q', wt);
	assert.equal(L.hooksPathNow(wt), '/tmp/other');
	git(dir, 'worktree', 'remove', '--force', wt);
});

// why: guards rule:outward-acts (a hooks path in another case is another folder where names are case-sensitive)
// planted: {"file":"user/kit-tools/kit-launch.cjs","was":"const WIN = process.platform === 'win32';","to":"const WIN = process.platform !== 'win32';"}
test('where file names are case-sensitive a hooks path in another case is a move', () => {
	if (process.platform === 'win32') return;
	const { L } = launcher();
	const { dir, shims, rec } = project();
	git(dir, 'init', '-q', '-b', 'main');
	fs.appendFileSync(path.join(dir, '.git', 'config'), '[core]\n\thooksPath = .GitHooks\n');
	assert.equal(L.verify(dir, { ...rec, hooksPath: '.githooks' }, [], shims).hooksPath, '.GitHooks');
});

// why: guards rule:outward-acts (an install run from a kit folder changed since install could install anything)
// planted: {"file":"user/kit-tools/kit-launch.cjs","was":"kitFingerprint(rec.kitDir) === rec.kitFingerprint;","to":"kitFingerprint(rec.kitDir) !== rec.kitFingerprint;"}
// planted: {"file":"user/kit-tools/kit-launch.cjs","was":"if (!nodePath) return false;","to":"if (!nodePath) return true;"}
// planted: {"file":"user/kit-tools/kit-launch.cjs","was":"} catch { return []; }\n\tconst groups","to":"} catch { return void []; }\n\tconst groups"}
test('the fix line runs only from the kit folder install recorded, and no recorded node means not wired', () => {
	const { home, L } = launcher();
	const fwd = (p) => p.split(path.sep).join('/');
	const node = fwd(process.execPath);
	fs.writeFileSync(path.join(home, 'kit-install.json'), JSON.stringify({ node }));
	const kitDir = kitTemp.makeTemp('lv-kit-');
	fs.mkdirSync(path.join(kitDir, 'scripts'));
	fs.writeFileSync(path.join(kitDir, 'scripts', 'kit.mjs'), 'kit\n');
	const dir = kitTemp.makeTemp('lv-fix-');
	const rec = { kitDir, kitFingerprint: L.kitFingerprint(kitDir) };
	const fx = (r) => L.isFix({ tool_name: 'Bash', tool_input: { command: `"${node}" "${fwd(path.join(kitDir, 'scripts', 'kit.mjs'))}" install project "${fwd(dir)}"` } }, r, dir);
	assert.equal(fx(rec), true);
	fs.writeFileSync(path.join(kitDir, 'scripts', 'kit.mjs'), 'changed\n');
	assert.equal(fx(rec), false, 'the kit folder changed since install');
	assert.equal(L.launcherWired({}, path.join(home, 'kit-tools', 'kit-launch.cjs'), null), false);
	assert.deepEqual(L.oldGuardEntries('{ not json'), []);
});

// why: guards rule:outward-acts (a folder the session cannot list is there, so its guards still run)
// planted: {"file":"user/kit-tools/kit-launch.cjs","was":"} catch (e) { return e.code === 'ENOENT' || e.code === 'ENOTDIR'; }","to":"} catch (e) { return e.code !== 'ENOENT' || e.code === 'ENOTDIR'; }"}
test('a recorded folder whose parent cannot be listed is not gone', () => {
	if (process.platform === 'win32' || process.getuid?.() === 0) return;
	const { L } = launcher();
	const parent = kitTemp.makeTemp('lv-gone-');
	fs.chmodSync(parent, 0o300);
	try {
		assert.equal(L.gone(path.join(parent, 'app')), false);
	} finally {
		fs.chmodSync(parent, 0o700);
	}
	assert.equal(L.gone(path.join(parent, 'app')), true, 'a folder that is really gone still is');
});

// K206 P3: a session ran another Claude folder's kit tool (the rules named ~/.claude, and ~ is always the real home), so
// a throwaway or probe session judged its sweep by the owner's copy. Running one is held with this session's command;
// reading one is not.
// why: catches a session that runs approve.mjs or the merge gate from a Claude folder other than its own
test('the launcher holds a kit tool run from another Claude folder, and names this session\'s own (K206)', () => {
	const { home, L } = launcher();
	assert.equal(typeof L.otherHomeTool, 'function', 'K206: the launcher checks which Claude folder a kit tool runs from');
	const user = kitTemp.makeTemp('lv-user-');
	const real = path.join(user, '.claude');
	for (const d of [home, real]) { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'kit-install.json'), '{}'); }
	const call = (command, tool = 'Bash') => L.otherHomeTool({ tool_name: tool, tool_input: { command }, cwd: user }, home, user);
	const own = home.split(path.sep).join('/');
	const held = call('node ~/.claude/skills/pre-pr-sweep/approve.mjs c.json');
	assert.equal(held?.hookSpecificOutput?.permissionDecision, 'deny');
	assert.match(held.hookSpecificOutput.permissionDecisionReason, new RegExp(`node ${own.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/skills/pre-pr-sweep/approve\\.mjs`));
	assert.equal(call('node "$env:USERPROFILE\\.claude\\kit-tools\\merge-gate.mjs" arm 5', 'PowerShell')?.hookSpecificOutput?.permissionDecision, 'deny');
	assert.equal(call(`node "${own}/skills/pre-pr-sweep/approve.mjs" c.json`), null, 'its own copy runs');
	assert.equal(call('cat ~/.claude/skills/pre-pr-sweep/approve.mjs'), null, 'a read is not held');
	assert.equal(call('node scripts/kit.mjs build'), null);
	// The default folder's own session spells it with ~, as its allow rules do.
	assert.equal(L.otherHomeTool({ tool_name: 'Bash', tool_input: { command: 'node ~/.claude/kit-tools/merge-gate.mjs arm 5' }, cwd: user }, real, user), null);
	// A folder with no kit install is not a Claude folder the kit runs from (the kit source's user/ tree, say).
	fs.rmSync(path.join(real, 'kit-install.json'));
	assert.equal(call('node ~/.claude/skills/pre-pr-sweep/approve.mjs c.json'), null);
});

// The build 22 sweep: the settings line ran a bare sh, found first on the session's PATH, so a planted sh could answer for
// every guard. It names /bin/sh, and a line that still says sh is not the wired one.
// why: catches a settings line that runs a sh found on the session's PATH
test('the settings line runs /bin/sh, and a bare sh line is not the wired one', () => {
	const { file, L } = launcher();
	const node = process.execPath;
	let line = '';
	assert.doesNotThrow(() => { line = L.launchCommand(file, node); }, 'launchCommand builds the line');
	assert.ok(line.startsWith("NODE_OPTIONS= /bin/sh '"), line);
	const settings = (command) => ({ hooks: {
		PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command, onFailure: 'block' }] }],
		ConfigChange: [{ hooks: [{ type: 'command', command: L.launchCommand(file, node, 'config-change') }] }],
	} });
	assert.equal(L.launcherWired(settings(line), file, node), true, 'the line install writes is wired');
	assert.equal(L.launcherWired(settings(line.replace('/bin/sh', 'sh')), file, node), false, 'a bare sh is not');
});
