// The owner's pick (2026-11-12, "Only what it touches"): a PR runs the tests its change reaches, and the whole suite
// whenever the selection cannot be trusted.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { scope, installLane } from '../scripts/pr-scope.mjs';

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
	// A map the PR commits would choose what the PR runs.
	assert.equal(change(() => { map(base); sh(dir, 'add', '-f', 'tests/.map.json'); }).scope, 'full', 'a committed map');
	map('0'.repeat(40));
	assert.equal(change(() => fs.writeFileSync(path.join(dir, 'scripts', 'a.mjs'), 'z\n')).scope, 'full', 'a map for another commit');
	fs.rmSync(path.join(dir, 'tests', '.map.json'));
	assert.equal(scope(dir, base).scope, 'full', 'no map');
	assert.equal(scope(dir, 'not-a-ref').scope, 'full', 'a base that is not a commit');
	// K9, the 1.27.0 sweep: every file the selection rests on, one row each, not three of ten.
	map(base);
	for (const f of ['scripts/test-run.mjs', 'scripts/pr-scope.mjs', 'tests/map-trace.cjs', 'package.json', 'package-lock.json', 'kit.config.json', '.gitattributes', 'project/.claude/kit-temp.cjs']) {
		assert.equal(change(() => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), 'r\n'); }).scope, 'full', f);
	}
});

// why: guards the owner's rule never to lower a gate. K8, the 1.27.0 sweep: the install lane matched a list of paths,
// so a rename out of them, a name git quotes (non-ASCII) or an input outside the list skipped the install check.
test('the install check is skipped only when every changed file is one install never reads', () => {
	const dir = kitTemp.makeTemp('lane-');
	sh(dir, 'init', '-q', '-b', 'main');
	for (const f of ['user/a.md', 'tests/a.test.mjs', 'project/x.md']) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), 'x\n'); }
	sh(dir, 'add', '.');
	sh(dir, 'commit', '-qm', 'base');
	const base = sh(dir, 'rev-parse', 'HEAD');
	const lane = (fn) => { sh(dir, 'checkout', '-q', base); sh(dir, 'checkout', '-q', '-B', 'pr'); fn(); sh(dir, 'add', '-A'); sh(dir, 'commit', '-qm', 'c'); return installLane(dir, base); };
	assert.equal(lane(() => fs.writeFileSync(path.join(dir, 'tests', 'a.test.mjs'), 'y\n')), false, 'a test only');
	assert.equal(lane(() => fs.renameSync(path.join(dir, 'user', 'a.md'), path.join(dir, 'tests', 'moved.md'))), true, 'a rename out of user/');
	const name = 'project/' + String.fromCharCode(0xe9) + '.md';
	assert.equal(lane(() => fs.writeFileSync(path.join(dir, name), 'n\n')), true, 'a non-ASCII name');
	assert.equal(lane(() => fs.writeFileSync(path.join(dir, 'VERSION'), '1.0.0\n')), true, 'an input outside any list');
	assert.equal(installLane(dir, 'not-a-ref'), true, 'a base that is not a commit');
});
