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
	if (git) spawnSync('git', ['init', '-q', dir]);
	install({ kit: KIT, home, target: 'project', projectDir: dir });
	return dir;
}
const check = (dir) => {
	const r = spawnSync(process.execPath, [path.join(dir, '.claude', 'use-check.mjs'), '--json'], { cwd: dir, encoding: 'utf8' });
	return { code: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr };
};
const part = (out, name) => out.parts.find((p) => p.name === name);

test('a fresh install has every part present and wired, and a part with no trace yet says so', () => {
	const dir = project();
	const r = check(dir);
	assert.equal(r.code, 0, JSON.stringify(r.out));
	assert.deepEqual(r.out.failing, []);
	assert.equal(part(r.out, 'guards').wired.ok, true);
	assert.equal(part(r.out, 'git-hooks').wired.ok, true);
	assert.equal(part(r.out, 'git-hooks').used.ok, null, 'no push yet is not a fault');
	// A push leaves its trace.
	fs.appendFileSync(path.join(dir, '.git', 'kit-push.log'), '2026-11-10T00:00:00Z auto refs/heads/x abc\n');
	assert.equal(part(check(dir).out, 'git-hooks').used.ok, true);
});

test('an unwired part fails the check by name: the guard entry gone, git hooks not set, a guard file missing', () => {
	const unwired = project();
	const file = path.join(unwired, '.claude', 'settings.json');
	const s = JSON.parse(fs.readFileSync(file, 'utf8'));
	s.hooks.PreToolUse = [];
	fs.writeFileSync(file, JSON.stringify(s));
	const a = check(unwired);
	assert.equal(a.code, 1);
	assert.deepEqual(a.out.failing, ['guards']);
	// The fix is named: a settings.json the owner changed is merged by hand, or reinstalled with --force.
	assert.match(part(a.out, 'guards').wired.detail, /by hand[\s\S]*--force/);
	// Claude Code reads an empty or "*" matcher, or none, as every tool, the same as ".*" (the 1.25.0 sweep).
	for (const matcher of ['', '*', undefined]) {
		const other = project();
		const f = path.join(other, '.claude', 'settings.json');
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

test('a part the project opts out of is named, not missing; a folder without git has no git level to fail', () => {
	const dir = project();
	spawnSync('git', ['-C', dir, 'config', '--unset', 'core.hooksPath']);
	fs.mkdirSync(path.join(dir, '.kit'), { recursive: true });
	fs.writeFileSync(path.join(dir, '.kit', 'parts.json'), JSON.stringify({ optOut: ['git-hooks'] }));
	const r = check(dir);
	assert.equal(r.code, 0);
	assert.equal(part(r.out, 'git-hooks').optedOut, true);
	fs.writeFileSync(path.join(dir, '.kit', 'parts.json'), '{ broken');
	assert.equal(check(dir).code, 2, 'a broken opt-out file is an error, never an opt-out');
	const plain = project({ git: false });
	const p = check(plain);
	assert.equal(p.code, 0, JSON.stringify(p.out));
	assert.equal(part(p.out, 'git-hooks').wired.ok, null);
});

test('install project prints the use check and fails when a part is not wired; status names it', () => {
	const dir = kitTemp.makeTemp('use-cli-');
	const home = kitTemp.makeTemp('use-cli-home-');
	spawnSync('git', ['init', '-q', dir]);
	const cli = (...a) => spawnSync(process.execPath, [path.resolve('scripts/kit.mjs'), ...a], { encoding: 'utf8', env: { ...process.env, KIT_CLAUDE_HOME: home } });
	const ok = cli('install', 'project', dir, '--unreleased');
	assert.equal(ok.status, 0, ok.stdout + ok.stderr);
	assert.match(ok.stdout, /Use check: every part present and wired/);
	fs.rmSync(path.join(dir, '.githooks', 'pre-push'));
	const st = cli('status', dir);
	assert.match(st.stdout, /Use check: not finished, git-hooks/);
	assert.match(st.stdout, /Not current:.*use check/);
});
