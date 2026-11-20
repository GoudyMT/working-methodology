// T14 (the owner, 2026-11-10): the use check says, per kit part, whether it is present, wired and used, and install
// is finished only when every part is present and wired. Each case installs the kit as the owner does, into a
// throwaway project, then breaks one link the way a real project drifts.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { install } from '../scripts/kit.mjs';

kitTemp.sessionRoot();
const KIT = path.resolve('.');
function project({ git = true } = {}) {
	const dir = kitTemp.makeTemp('use-');
	const home = kitTemp.makeTemp('use-home-');
	if (git) spawnSync('git', ['init', '-q', '-b', 'main', dir]);
	// The guards run from the Claude config folder since V3 (1.25.1), so the owner installs it first.
	install({ kit: KIT, home, target: 'user' });
	install({ kit: KIT, home, target: 'project', projectDir: dir });
	homes.set(dir, home);
	return dir;
}
const homes = new Map();
const check = (dir) => {
	const r = spawnSync(process.execPath, [path.join(dir, '.claude', 'use-check.mjs'), '--json'], { cwd: dir, encoding: 'utf8', env: { ...process.env, KIT_CLAUDE_HOME: homes.get(dir) } });
	return { code: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr };
};
// A part the check does not have is a failed assertion, not a crash on reading its fields.
const part = (out, name) => { const p = out.parts.find((x) => x.name === name); assert.ok(p, `the use check has a ${name} part`); return p; };

// why: guards rule:outward-acts
test('an unwired part fails the check by name: the guard entry gone, git hooks not set, a guard file missing', () => {
	const unwired = project();
	const file = path.join(homes.get(unwired), 'settings.json');
	const s = JSON.parse(fs.readFileSync(file, 'utf8'));
	s.hooks.PreToolUse = [];
	fs.writeFileSync(file, JSON.stringify(s));
	const a = check(unwired);
	assert.equal(a.code, 1);
	assert.deepEqual(a.out.failing, ['guards']);
	// The fix is named: the user install wires the launcher again.
	assert.match(part(a.out, 'guards').wired.detail, /install user/);
	// Claude Code reads an empty or "*" matcher, or none, as every tool, the same as ".*" (the 1.25.0 sweep).
	for (const matcher of ['', '*', undefined]) {
		const other = project();
		const f = path.join(homes.get(other), 'settings.json');
		const t = JSON.parse(fs.readFileSync(f, 'utf8'));
		for (const h of t.hooks.PreToolUse) if (matcher === undefined) delete h.matcher; else h.matcher = matcher;
		fs.writeFileSync(f, JSON.stringify(t));
		assert.deepEqual(check(other).out.failing, [], `matcher ${JSON.stringify(matcher)}`);
	}
	const noHooks = project();
	spawnSync('git', ['-C', noHooks, 'config', '--unset', 'core.hooksPath']);
	assert.deepEqual(check(noHooks).out.failing, ['git-hooks']);
	const missing = project();
	fs.rmSync(path.join(missing, '.claude', 'owner-yes.cjs'));
	const m = check(missing);
	assert.deepEqual(m.out.failing, ['guards']);
	assert.match(part(m.out, 'guards').present.detail, /owner-yes\.cjs/);
});

// K71 and K72 (1.36.0, the 2026-11-15 outside review): saved approvals in .claude/settings.local.json can hold
// secrets, and git keeps tracking a file once added whatever the ignore lists say; "disableAllHooks": true in a project
// settings file turns every hook off with no sign, and a session cannot see it from inside.
// why: guards the owner's yes to K71 and K72, 2026-11-15 (card "Yes, all three into build 10"; K71 check only, pop-up)
test('the check fails when git tracks settings.local.json or a project settings file turns hooks off', () => {
	const dir = project();
	assert.deepEqual(check(dir).out.failing, []);
	assert.equal(fs.existsSync(path.join(dir, '.gitignore')), false, 'install leaves nothing git can see (rule:kit-stays-local)');
	// Tracked by git: the check fails and names the way out.
	fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), '{}');
	spawnSync('git', ['-C', dir, 'add', '-f', '.claude/settings.local.json']);
	let c = check(dir);
	assert.equal(c.code, 1);
	assert.ok(c.out.failing.includes('private-files'), JSON.stringify(c.out.failing));
	assert.match(part(c.out, 'private-files').wired.detail, /git tracks \.claude\/settings\.local\.json[\s\S]*git rm --cached/);
	spawnSync('git', ['-C', dir, 'rm', '-q', '--cached', '.claude/settings.local.json']);
	assert.deepEqual(check(dir).out.failing, []);
	// disableAllHooks in either project settings file fails the guards part.
	for (const name of ['settings.local.json', 'settings.json']) {
		const f = path.join(dir, '.claude', name);
		const before = fs.readFileSync(f, 'utf8');
		fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(before), disableAllHooks: true }));
		c = check(dir);
		assert.equal(c.code, 1, name);
		assert.match(part(c.out, 'guards').wired.detail, /disableAllHooks/, name);
		fs.writeFileSync(f, before);
	}
	assert.deepEqual(check(dir).out.failing, []);
	// A user layer from before 1.36.0 has no settings reader: the check names the update, never crashes.
	const lib = path.join(homes.get(dir), 'kit-tools', 'kit-launch.cjs');
	const real = fs.readFileSync(lib, 'utf8');
	fs.writeFileSync(lib, `${real}\nmodule.exports = { ...module.exports, settingsProblem: undefined };\n`);
	c = check(dir);
	assert.equal(c.code, 1, c.err);
	assert.match(part(c.out, 'guards').wired.detail, /older than this check[\s\S]*install user/);
	fs.writeFileSync(lib, real);
	// A folder with no git: nothing to track, so the part does not apply.
	assert.equal(part(check(project({ git: false })).out, 'private-files').wired.ok, null);
});

// K69 (1.36.0): both real projects kept a hand checkbox roadmap (53 and 555 boxes) on 2026-11-15.
// why: guards the owner's lock of K69, 2026-11-15 (pop-up "Checkbox lists become data"): the list as data in every project
test('the list part passes a fresh install and fails a hand-kept checkbox roadmap until it is moved', () => {
	const dir = project();
	assert.equal(part(check(dir).out, 'list').wired.ok, true);
	const f = path.join(dir, '_Master Roadmap.md');
	fs.writeFileSync(f, `${fs.readFileSync(f, 'utf8')}\n## v1 - "First" (IN PROGRESS)\n\n- [x] Setup\n- [ ] Login page\n`);
	const c = check(dir);
	assert.equal(c.code, 1);
	assert.deepEqual(c.out.failing, ['list']);
	assert.match(part(c.out, 'list').wired.detail, /2 checkbox line\(s\) kept by hand[\s\S]*state\.mjs list import "_Master Roadmap\.md"/);
	const r = spawnSync(process.execPath, [path.join(dir, '.claude', 'state.mjs'), 'list', 'import', '_Master Roadmap.md'], { cwd: dir, encoding: 'utf8', env: { ...process.env, CLAUDE_CODE_SESSION_ID: '' } });
	assert.equal(r.status, 0, r.stdout);
	assert.deepEqual(check(dir).out.failing, []);
	assert.match(fs.readFileSync(f, 'utf8'), /^- \[ \] R2 Login page$/m, 'the view shows the moved box');
	// A roadmap with no generated boxes block fails, and the message names the two marker lines to copy.
	fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/<!-- list:begin boxes[\s\S]*?<!-- list:end -->\n?/, ''));
	const n = check(dir);
	assert.deepEqual(n.out.failing, ['list']);
	assert.match(part(n.out, 'list').wired.detail, /no generated boxes block[\s\S]*<!-- list:begin boxes -->[\s\S]*<!-- list:end -->/);
});

// why: catches a break at project/.claude/use-check.mjs:89 that no other test catches
test('install project prints the use check and fails when a part is not wired; status names it', () => {
	const dir = kitTemp.makeTemp('use-cli-');
	const home = kitTemp.makeTemp('use-cli-home-');
	spawnSync('git', ['init', '-q', '-b', 'main', dir]);
	const cli = (...a) => spawnSync(process.execPath, [path.resolve('scripts/kit.mjs'), ...a], { encoding: 'utf8', env: { ...process.env, KIT_CLAUDE_HOME: home } });
	assert.equal(cli('install', 'user', '--unreleased').status, 0);
	const ok = cli('install', 'project', dir, '--unreleased');
	assert.equal(ok.status, 0, ok.stdout + ok.stderr);
	assert.match(ok.stdout, /Use check: every part present and wired/);
	fs.rmSync(path.join(dir, '.githooks', 'pre-push'));
	const st = cli('status', dir);
	assert.match(st.stdout, /Use check: not finished, git-hooks/);
	assert.match(st.stdout, /Not current:.*use check/);
});

// why: guards rule:outward-acts (every owner's yes is read from one field of the pop-up record). The 1.25.0
// carry-over R7.1: that field (permissionDecision) is not documented, and nothing said whether a real answer carries it.
test('the guards part reports whether the newest pop-up answer carries the field the guards read', () => {
	const dir = project();
	const home = homes.get(dir);
	const slug = path.resolve(dir).replace(/[^A-Za-z0-9]/g, '-');
	const t = path.join(home, 'projects', slug, '11111111-2222-3333-4444-555555555555.jsonl');
	fs.mkdirSync(path.dirname(t), { recursive: true });
	const answer = (withField) => JSON.stringify({ type: 'user', timestamp: new Date().toISOString(), ...(withField ? { permissionDecision: { decision: 'accept', source: 'user_temporary' } } : {}), toolUseResult: { answers: { q: 'Yes' } }, message: { content: [{ type: 'tool_result', tool_use_id: 'x' }] } });
	assert.equal(part(check(dir).out, 'guards').used.ok, null, 'no pop-up yet is not a fault');
	fs.writeFileSync(t, answer(true) + '\n');
	assert.equal(part(check(dir).out, 'guards').used.ok, true);
	fs.appendFileSync(t, answer(false) + '\n');
	const used = part(check(dir).out, 'guards').used;
	assert.equal(used.ok, false);
	assert.match(used.detail, /permissionDecision/);
});

// T9 (1.42.0, D-2): AGENTS.md is measured as the project has it, filled in and as written on disk, never the kit's
// template: the template stayed under its cap while a filled copy on the owner's PC was over it (28,354 B).
// K111 (1.42.0): sessions ran past 400K tokens; the installed project settings compact at 400K, and the use check names
// any window in force over that, or under the 100K Claude Code ignores.
// why: guards rule:kit-standards
test('the use check fails a filled AGENTS.md over the cap and a compact window outside 100K to 400K', () => {
	const ok = project();
	assert.deepEqual(check(ok).out.failing, []);
	assert.equal(part(check(ok).out, 'start-load').wired.ok, true);
	assert.equal(part(check(ok).out, 'compact-window').wired.ok, true);
	const big = project();
	fs.appendFileSync(path.join(big, 'AGENTS.md'), 'x'.repeat(26000));
	const b = check(big);
	assert.deepEqual(b.out.failing, ['start-load']);
	assert.match(part(b.out, 'start-load').wired.detail, /over the 22,000 B cap/);
	// K118 (build 21): the cap came down from 25,000 B, so a file between the two caps now fails.
	const mid = project();
	const agents = path.join(mid, 'AGENTS.md');
	fs.appendFileSync(agents, 'x'.repeat(23000 - fs.statSync(agents).size));
	assert.deepEqual(check(mid).out.failing, ['start-load'], 'a 23,000 B AGENTS.md');
	for (const [file, settings] of [['settings.json', { autoCompactWindow: 650000 }], ['settings.local.json', { modelSettings: { 'claude-opus-5-5': { autoCompactWindow: 900000 } } }], ['settings.json', { autoCompactWindow: 40000 }]]) {
		const w = project();
		const f = path.join(w, '.claude', file);
		const s = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
		fs.writeFileSync(f, JSON.stringify({ ...s, ...settings }));
		assert.deepEqual(check(w).out.failing, ['compact-window'], `${file} ${JSON.stringify(settings)}`);
	}
	const none = project();
	const f = path.join(none, '.claude', 'settings.json');
	const s = JSON.parse(fs.readFileSync(f, 'utf8'));
	delete s.autoCompactWindow;
	fs.writeFileSync(f, JSON.stringify(s));
	assert.match(part(check(none).out, 'compact-window').wired.detail, /no autoCompactWindow/);
});

// why: guards rule:kit-standards. The 1.42.0 sweep thought a per-model window in the owner's own settings file could
// win over the project's; measured on 2026-11-17 it does not (a session in a project setting 400000 showed 400k with
// the owner's opus window at 650000), and the check that failed on it stopped every install on such a machine. A
// per-model window in the project's own files still counts, and a text value there fails.
test('the compact-window check passes the owner\'s own per-model window, and fails a project text value and a BOM-led file', () => {
	const w = project();
	const file = path.join(homes.get(w), 'settings.json');
	const s0 = JSON.parse(fs.readFileSync(file, 'utf8'));
	s0.modelSettings = { 'claude-opus-5-5': { autoCompactWindow: 650000 } };
	fs.writeFileSync(file, JSON.stringify(s0));
	assert.deepEqual(check(w).out.failing, []);
	const p = project();
	const pf = path.join(p, '.claude', 'settings.json');
	const ps = JSON.parse(fs.readFileSync(pf, 'utf8'));
	fs.writeFileSync(pf, JSON.stringify({ ...ps, modelSettings: { 'claude-opus-5-5': { autoCompactWindow: 'auto' } } }));
	assert.match(part(check(p).out, 'compact-window').wired.detail, /settings\.json \(claude-opus-5-5\) sets auto/);
	const bom = project();
	const f = path.join(bom, '.claude', 'settings.json');
	const s = JSON.parse(fs.readFileSync(f, 'utf8'));
	fs.writeFileSync(f, '\uFEFF' + JSON.stringify({ ...s, autoCompactWindow: 900000 }));
	assert.match(part(check(bom).out, 'compact-window').wired.detail, /settings.json sets 900000/);
});
