// The owner's pick (2026-11-12, "Only what it touches"): a PR runs the tests its change reaches, and the whole suite
// whenever the selection cannot be trusted.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { scope } from '../scripts/pr-scope.mjs';

kitTemp.sessionRoot();
const sh = (cwd, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' }).stdout.trim();

// why: guards the owner's rule never to lower a gate (2026-11-10): a PR that narrows its run must fall back to the whole
// suite when the narrowing has nothing sound to stand on.
test('a PR runs the reached tests only with a map for its base and no risky change; anything else runs everything', () => {
	const dir = kitTemp.makeTemp('scope-');
	sh(dir, 'init', '-q', '-b', 'main');
	fs.mkdirSync(path.join(dir, 'tests'));
	fs.mkdirSync(path.join(dir, 'scripts'));
	for (const f of ['scripts/a.mjs', 'scripts/b.mjs', 'tests/a.test.mjs']) fs.writeFileSync(path.join(dir, f), 'x\n');
	fs.writeFileSync(path.join(dir, '.gitignore'), 'tests/.map.json\n');
	sh(dir, 'add', '.');
	sh(dir, 'commit', '-qm', 'base');
	const base = sh(dir, 'rev-parse', 'HEAD');
	const change = (fn) => { sh(dir, 'checkout', '-q', base); sh(dir, 'checkout', '-q', '-B', 'pr'); fn(); sh(dir, 'add', '-A'); sh(dir, 'commit', '-qm', 'change'); return scope(dir, base); };
	const map = (sha) => fs.writeFileSync(path.join(dir, 'tests', '.map.json'), JSON.stringify({ sha, tests: {} }));
	map(base);
	assert.equal(change(() => fs.writeFileSync(path.join(dir, 'scripts', 'a.mjs'), 'y\n')).scope, 'changed');
	assert.equal(change(() => fs.rmSync(path.join(dir, 'scripts', 'b.mjs'))).scope, 'full', 'a deletion');
	assert.equal(change(() => fs.writeFileSync(path.join(dir, 'tests', 'harness.mjs'), 'h\n')).scope, 'full', 'the harness');
	assert.equal(change(() => { fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true }); fs.writeFileSync(path.join(dir, '.github', 'workflows', 'ci.yml'), 'x\n'); }).scope, 'full', 'a workflow');
	map('0'.repeat(40));
	assert.equal(change(() => fs.writeFileSync(path.join(dir, 'scripts', 'a.mjs'), 'z\n')).scope, 'full', 'a map for another commit');
	fs.rmSync(path.join(dir, 'tests', '.map.json'));
	assert.equal(scope(dir, base).scope, 'full', 'no map');
});
