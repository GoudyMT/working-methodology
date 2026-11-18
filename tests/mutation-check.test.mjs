// Tests for the mutation check (scripts/mutation-check.mjs, E29): it flips conditions in the code a coverage map
// ties to tests, runs only those tests on a throwaway copy, and names every flip no test catches.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
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

// why: catches a break at scripts/mutation-check.mjs:144 that no other test catches
test('the mutation check names a flip no test catches, passes one a test catches, and leaves the code as it was', () => {
	const { dir, src } = repo();
	const r = check(dir, ['src/a.cjs']);
	assert.equal(r.status, 1, r.stdout + r.stderr);
	assert.match(r.stdout, /SURVIVED src\/a\.cjs:2 > to <=: exports\.isBig = \(x\) => x <= 10;[^\n]*\(tests: tests\/a\.test\.mjs::big\)/);
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
	// The copy is a clone of its own: what runs in it reaches none of the repo's config, refs or hooks (the 1.23.0
	// sweep: a worktree shares them).
	const reach = check(dir, ['src/a.cjs', '--also', 'git config kit.probe reached && git branch probe-reached && exit 1']);
	assert.equal(reach.status, 0, reach.stdout + reach.stderr);
	assert.equal(spawnSync('git', ['-C', dir, 'config', 'kit.probe'], { encoding: 'utf8' }).stdout.trim(), '', 'the repo\'s config is untouched');
	assert.doesNotMatch(sh(dir, 'branch', '--list'), /probe-reached/, 'the repo\'s refs are untouched');
	// The 1.24.0 build: a flip that drops a test's own Claude folder must land in a throwaway, never ~/.claude. The
	// tests and the outside checks both run with one, set by the check itself.
	const seen = path.join(kitTemp.makeTemp('seen-'), 'home.txt');
	const write = `node -e "require('fs').appendFileSync(${JSON.stringify(seen).replace(/"/g, '\'')}, [process.env.KIT_CLAUDE_HOME, process.env.CLAUDE_CONFIG_DIR].join('|') + '\\n')"`;
	const { KIT_CLAUDE_HOME: _k, CLAUDE_CONFIG_DIR: _c, ...bare } = process.env;
	spawnSync(process.execPath, [CHECK, 'src/a.cjs', '--also', `${write} && exit 1`], { cwd: dir, encoding: 'utf8', env: bare });
	const homes = fs.readFileSync(seen, 'utf8').trim().split('\n');
	for (const line of homes) {
		const [kit, config] = line.split('|');
		assert.ok(kit && kit === config, line);
		assert.ok(!path.resolve(kit).startsWith(path.join(os.homedir(), '.claude')), line);
	}
});

// why: guards rule:test-value
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

// why: catches a cut list built on guesses (T15 Part B): to sort tests by value the check must say which tests caught
// each flip, and it must split over CI jobs without losing or repeating a flip.
test('the mutation check records which tests caught each flip, and its slices cover every flip once', () => {
	const { dir } = repo();
	const out = path.join(dir, 'flips.json');
	const r = check(dir, ['src/a.cjs', '--json', out]);
	assert.equal(r.status, 1, r.stdout + r.stderr);
	const flips = JSON.parse(fs.readFileSync(out, 'utf8')).flips;
	const at = (line) => flips.find((f) => f.file === 'src/a.cjs' && f.line === line);
	assert.deepEqual(at(1).caughtBy, ['tests/a.test.mjs::pos']);
	assert.deepEqual(at(2).caughtBy, []);
	assert.deepEqual(at(2).tests, ['tests/a.test.mjs::big']);
	const seen = [];
	for (const s of ['0/2', '1/2']) {
		const part = path.join(dir, `part-${s[0]}.json`);
		check(dir, ['src/a.cjs', '--slice', s, '--json', part]);
		seen.push(...JSON.parse(fs.readFileSync(part, 'utf8')).flips.map((f) => `${f.file}:${f.line}`));
	}
	assert.deepEqual(seen.sort(), ['src/a.cjs:1', 'src/a.cjs:2']);
});

// K131 (build 17): the test check's A2 asks only whether each test catches some flip, and re-running every test on
// every flip took part 0 of PR 52 eleven minutes. With --until-caught a test that has caught one flip runs on no
// later one, and the run ends once every test has caught one; without it every flip still runs every test it reaches.
// why: guards rule:test-value (A2's verdict per test, at a cost CI can carry)
test('with --until-caught a test that caught a flip runs on no later flip, and the run ends when all have caught one', () => {
	const { dir } = repo();
	fs.writeFileSync(path.join(dir, 'src', 'a.cjs'), ['exports.isPos = (x) => x > 0;', 'exports.isNeg = (x) => x < 0;', 'exports.isBig = (x) => x > 10;', ''].join('\n'));
	fs.writeFileSync(path.join(dir, 'tests', 'a.test.mjs'), [
		`import { test } from ${HARNESS};`, "import assert from 'node:assert/strict';", "import { createRequire } from 'node:module';",
		"const a = createRequire(import.meta.url)('../src/a.cjs');",
		"test('signs', () => { assert.equal(a.isPos(1), true); assert.equal(a.isNeg(-1), true); assert.equal(a.isPos(-1), false); assert.equal(a.isNeg(1), false); });", '',
	].join('\n'));
	sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'two lines one test');
	assert.equal(spawnSync(process.execPath, [RUNNER, '--map', '--shards', '1', path.join(dir, 'tests', 'a.test.mjs')], { cwd: dir, encoding: 'utf8' }).status, 0);
	const flipsOf = (args) => { const out = path.join(dir, `f-${args.length}.json`); check(dir, ['src/a.cjs', '--json', out, ...args]); return JSON.parse(fs.readFileSync(out, 'utf8')).flips; };
	const every = flipsOf([]);
	assert.deepEqual(every.map((f) => [f.line, f.caught]), [[1, true], [2, true]]);
	const until = flipsOf(['--until-caught']);
	assert.deepEqual(until.map((f) => [f.line, f.caughtBy]), [[1, ['tests/a.test.mjs::signs']]], 'the second flip ran no test');
});

// K126 (build 17): the coverage map misses code a test reaches through a child the tracer never loads into (the
// launcher clears NODE_OPTIONS at its start), so 25 of the launcher's 37 survivors were caught by tests the map did not
// name. With --whole a flip that survives its mapped tests runs once more against every test of their files, and is a
// survivor only if those pass too.
// why: guards rule:test-value (a survivor triaged by hand that a test already catches is wasted triage)
test('with --whole a survivor of its mapped tests is run against every test of their files', () => {
	const { dir } = repo();
	const mapFile = path.join(dir, 'tests', '.map.json');
	const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
	// The map loses pos's reach of line 1, as a child the tracer never loaded into would.
	delete map.tests['tests/a.test.mjs::pos'].lines['src/a.cjs'];
	map.tests['tests/a.test.mjs::big'].lines['src/a.cjs'] = [1, 2];
	fs.writeFileSync(mapFile, JSON.stringify(map));
	const plain = check(dir, ['src/a.cjs']);
	assert.match(plain.stdout, /SURVIVED src\/a\.cjs:1 /);
	const whole = check(dir, ['src/a.cjs', '--whole']);
	assert.match(whole.stdout, /caught src\/a\.cjs:1 [^\n]*\(by the whole file\)/);
	assert.match(whole.stdout, /SURVIVED src\/a\.cjs:2 /, 'a flip no test of the file catches still survives');
});

// why: catches a measure that costs 600 CI minutes for a one-line change, or passes green having measured nothing
// (K41, the owner 2026-11-13; the plan check's P5 and P13). Scoped to a base, only the changed lines are flipped; a
// base that is no commit stops the run; no flip in scope is said as nothing measured; --count costs no test run.
test('the mutation check scoped to a base flips only the changed lines, and says so when that is nothing', () => {
	const { dir } = repo();
	fs.writeFileSync(path.join(dir, 'src', 'a.cjs'), ['exports.isPos = (x) => x > 0;', 'exports.isBig = (x) => x > 20;', ''].join('\n'));
	sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'change one line');
	const map = spawnSync(process.execPath, [RUNNER, '--map', '--shards', '1', path.join(dir, 'tests', 'a.test.mjs')], { cwd: dir, encoding: 'utf8' });
	assert.equal(map.status, 0, map.stdout + map.stderr);
	const scoped = check(dir, ['--base', 'HEAD~1']);
	assert.match(scoped.stdout, /mutation check: 1 flips, 0 caught, 1 survived/);
	assert.doesNotMatch(scoped.stdout, /a\.cjs:1 /);
	const count = check(dir, ['--base', 'HEAD~1', '--count']);
	assert.equal(count.status, 0, count.stdout + count.stderr);
	assert.match(count.stdout, /^flips: 1$/m);
	assert.doesNotMatch(count.stdout, /SURVIVED|caught/);
	for (const base of ['no-such-ref', '--output=x', 'HEAD~9']) {
		const bad = check(dir, ['--base', base]);
		assert.equal(bad.status, 2, `${base}: ${bad.stdout}${bad.stderr}`);
		assert.match(bad.stderr, /is not a commit/);
	}
	assert.equal(fs.existsSync(path.join(dir, 'x')), false, 'a base is never read as a git option');
	const none = check(dir, ['--base', 'HEAD']);
	assert.equal(none.status, 0, none.stdout + none.stderr);
	assert.match(none.stdout, /nothing measured[^\n]*HEAD/);
	assert.doesNotMatch(none.stdout, /0 flips, 0 caught/);
});

// The build 14 audit (2026-11-16): a flip in the kit's home lookup skipped the two Claude-folder settings and a test
// rewrote the owner's real install record. Every run now also gets a throwaway home folder, so a code path that falls
// back to the user's home lands there too.
// why: guards the owner's rule that the kit installs into ~/.claude only from the release copy
test('a mutation run gives its tests a throwaway home folder, never the owner\'s', () => {
	const { dir } = repo();
	const seen = path.join(kitTemp.makeTemp('mut-home-'), 'home.txt');
	const t = path.join(dir, 'tests', 'a.test.mjs');
	fs.writeFileSync(t, fs.readFileSync(t, 'utf8').replace("test('pos', () => {", `test('pos', () => { require('node:fs').appendFileSync(${JSON.stringify(seen)}, require('node:os').homedir() + '\\n');`).replace("import assert from 'node:assert/strict';", "import assert from 'node:assert/strict';\nimport { createRequire as cr } from 'node:module';\nconst require = cr(import.meta.url);"));
	sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'home');
	assert.equal(spawnSync(process.execPath, [RUNNER, '--map', '--shards', '1', t], { cwd: dir, encoding: 'utf8' }).status, 0);
	fs.rmSync(seen, { force: true });
	check(dir, ['src/a.cjs']);
	const homes = fs.readFileSync(seen, 'utf8').split('\n').filter(Boolean);
	assert.ok(homes.length > 0, 'the flipped runs never ran the test');
	for (const h of homes) assert.notEqual(path.resolve(h), path.resolve(os.homedir()), `a flipped run saw the real home: ${h}`);
});
