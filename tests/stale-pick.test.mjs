// --pick names the tests a change reaches from the coverage map. A map made at a commit that is not an ancestor of HEAD
// (a side branch, a rebased-away commit) would name the wrong tests, so the pick refuses it and says what to do.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const RUNNER = path.resolve('scripts/test-run.mjs');
// The runner picks only the test files that import the harness, so each fixture test imports it too.
const HARNESS = JSON.stringify(pathToFileURL(path.resolve('tests/harness.mjs')).href);

// The runner's environment minus the Windows slice, as the harness runs it.
const run = (cwd, args) => {
	const { KIT_WINDOWS_SLICE: _w, ...base } = process.env;
	return spawnSync(process.execPath, [RUNNER, ...args], { cwd, encoding: 'utf8', env: base });
};
const git = (cwd, ...a) => {
	const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' });
	if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
	return r.stdout.trim();
};

// The body of test 'one' is the part a change edits; test 'two' stays as it is.
const testFile = (oneBody) => [
	`import { test } from ${HARNESS};`,
	`test('one', () => { ${oneBody} });`,
	"test('two', () => {});",
	'',
].join('\n');

// A temp repo on main with one test file, committed, and no map yet.
const fixtureRepo = () => {
	const repo = kitTemp.makeTemp('stale-pick-');
	fs.mkdirSync(path.join(repo, 'tests'));
	fs.writeFileSync(path.join(repo, '.gitignore'), 'tests/.map.json\n');
	const file = path.join(repo, 'tests', 'x.test.mjs');
	fs.writeFileSync(file, testFile('void 0;'));
	git(repo, 'init', '-q', '-b', 'main');
	git(repo, 'add', '.');
	git(repo, 'commit', '-qm', 'fixture');
	return { repo, file };
};

// why: catches --pick with a map whose sha is not an ancestor of HEAD exits 1 naming the map sha and "name the test files" (K362 S1)
test('--pick with a map whose sha is not an ancestor of HEAD exits 1 naming the map sha and "name the test files"', () => {
	const { repo, file } = fixtureRepo();
	// The control (S2): a map at an ancestor of HEAD still picks the changed test as before.
	const madeHere = run(repo, ['--map', file]);
	assert.equal(madeHere.status, 0, madeHere.stdout + madeHere.stderr);
	// An ancestor includes itself: a map at HEAD is current, so the pick exits 0 before anything changes.
	const atHead = run(repo, ['--changed', '--pick', file]);
	assert.equal(atHead.status, 0, atHead.stdout + atHead.stderr);
	fs.writeFileSync(file, testFile('void 1;'));
	git(repo, 'commit', '-qam', 'change one');
	const current = run(repo, ['--changed', '--pick', file]);
	assert.equal(current.status, 0, current.stdout + current.stderr);
	assert.match(current.stdout, /^tests\/x\.test\.mjs::one$/m);
	// A side commit: the map is made here, then main moves on, so this commit is no ancestor of HEAD.
	git(repo, 'checkout', '-q', '-b', 'side');
	fs.writeFileSync(file, testFile('void 2;'));
	git(repo, 'commit', '-qam', 'side change');
	const sideSha = git(repo, 'rev-parse', 'HEAD');
	const made = run(repo, ['--map', file]);
	assert.equal(made.status, 0, made.stdout + made.stderr);
	git(repo, 'checkout', '-q', 'main');
	fs.writeFileSync(file, testFile('void 3;'));
	git(repo, 'commit', '-qam', 'main change');
	const r = run(repo, ['--changed', '--pick', file]);
	assert.equal(r.status, 1, r.stdout + r.stderr);
	// The first 12 characters of the map's sha: a full sha names it too, so either form passes.
	assert.ok(r.stderr.includes(sideSha.slice(0, 12)), r.stderr);
	assert.match(r.stderr, /name the test files/);
});
