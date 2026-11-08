// Tests for the mutation check (scripts/mutation-check.mjs, E29): it flips conditions in the code a coverage map
// ties to tests, runs only those tests on a throwaway copy, and names every flip no test catches.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const RUNNER = path.resolve('scripts/test-run.mjs');
const CHECK = path.resolve('scripts/mutation-check.mjs');
const HARNESS = JSON.stringify(pathToFileURL(path.resolve('tests/harness.mjs')).href);
const sh = (cwd, ...a) => {
	const r = spawnSync('git', a, { cwd, encoding: 'utf8' });
	if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
	return r.stdout.trim();
};

// A repo whose test pins isPos both ways, but only checks that isBig answers a boolean: a flip in isBig survives.
function repo() {
	const dir = kitTemp.makeTemp('mutrepo-');
	fs.mkdirSync(path.join(dir, 'src'));
	fs.mkdirSync(path.join(dir, 'tests'));
	const src = [
		'exports.isPos = (x) => x > 0;',
		'exports.isBig = (x) => x > 10;',
		'',
	].join('\n');
	fs.writeFileSync(path.join(dir, 'src', 'a.cjs'), src);
	fs.writeFileSync(path.join(dir, 'tests', 'a.test.mjs'), [
		`import { test } from ${HARNESS};`,
		"import assert from 'node:assert/strict';",
		"import { createRequire } from 'node:module';",
		"const a = createRequire(import.meta.url)('../src/a.cjs');",
		"test('pos', () => { assert.equal(a.isPos(1), true); assert.equal(a.isPos(-1), false); });",
		"test('big', () => { assert.equal(typeof a.isBig(100), 'boolean'); });",
		'',
	].join('\n'));
	sh(dir, 'init', '-q', '-b', 'main');
	sh(dir, 'add', '.');
	sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'fixture');
	const r = spawnSync(process.execPath, [RUNNER, '--map', '--shards', '1', path.join(dir, 'tests', 'a.test.mjs')], { cwd: dir, encoding: 'utf8' });
	assert.equal(r.status, 0, r.stdout + r.stderr);
	return { dir, src };
}
const check = (cwd, args = []) => spawnSync(process.execPath, [CHECK, ...args], { cwd, encoding: 'utf8' });

test('the mutation check names a flip no test catches, passes one a test catches, and leaves the code as it was', () => {
	const { dir, src } = repo();
	const r = check(dir, ['src/a.cjs']);
	assert.equal(r.status, 1, r.stdout + r.stderr);
	assert.match(r.stdout, /SURVIVED src\/a\.cjs:2 > to <=: exports\.isBig = \(x\) => x <= 10; was exports\.isBig = \(x\) => x > 10; \(tests: tests\/a\.test\.mjs::big\)/);
	assert.doesNotMatch(r.stdout, /SURVIVED src\/a\.cjs:1/);
	assert.match(r.stdout, /caught src\/a\.cjs:1 /);
	assert.match(r.stdout, /mutation check: 2 flips, 1 caught, 1 survived/);
	assert.equal(fs.readFileSync(path.join(dir, 'src', 'a.cjs'), 'utf8'), src, 'the repo is never changed');
	assert.equal(sh(dir, 'status', '--porcelain'), '?? tests/.map.json', 'nothing but the map is new');
	assert.equal(sh(dir, 'worktree', 'list').split('\n').length, 1, 'its throwaway copy is gone');
	// A check outside the tests (a guard's proof script) catches what the tests miss.
	const also = check(dir, ['src/a.cjs', '--also', `node -e "process.exit(require('fs').readFileSync('src/a.cjs','utf8').includes('x <= 10') ? 1 : 0)"`]);
	assert.equal(also.status, 0, also.stdout + also.stderr);
	assert.match(also.stdout, /2 flips, 2 caught, 0 survived/);
});

test('the mutation check refuses a map from another commit or no map, and says how to make one', () => {
	const { dir } = repo();
	fs.appendFileSync(path.join(dir, 'src', 'a.cjs'), '// later\n');
	sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'later');
	const stale = check(dir, ['src/a.cjs']);
	assert.equal(stale.status, 2, stale.stdout + stale.stderr);
	assert.match(stale.stderr, /map is for .* not HEAD .*test-run\.mjs --map/);
	fs.rmSync(path.join(dir, 'tests', '.map.json'));
	const none = check(dir, ['src/a.cjs']);
	assert.equal(none.status, 2);
	assert.match(none.stderr, /no coverage map/);
});
