// Tests for the test harness (tests/harness.mjs) and the runner's shards, coverage map and change-scoped runs
// (scripts/test-run.mjs). Each drives the runner on a small repo of its own, the way the owner runs it locally.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const RUNNER = path.resolve('scripts/test-run.mjs');
const HARNESS = JSON.stringify(pathToFileURL(path.resolve('tests/harness.mjs')).href);

const sh = (cwd, ...a) => {
	const r = spawnSync('git', a, { cwd, encoding: 'utf8' });
	if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
	return r.stdout.trim();
};
const run = (cwd, args, env = {}) => spawnSync(process.execPath, [RUNNER, ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
// Each test the fixture runs writes its name to the log, so a run shows exactly which tests ran and how often.
const ran = (log) => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).sort() : []);

test('the runner splits a harness file into shards that together run every test exactly once', () => {
	const dir = kitTemp.makeTemp('shards-');
	const log = path.join(dir, 'ran.log');
	const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
	fs.writeFileSync(path.join(dir, 'x.test.mjs'), `import { test } from ${HARNESS}; import fs from 'node:fs';\n` +
		names.map((n) => `test('${n}', () => { fs.appendFileSync(${JSON.stringify(log)}, '${n}\\n'); });`).join('\n'));
	const r = run(dir, ['--shards', '3', path.join(dir, 'x.test.mjs')]);
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.deepEqual(ran(log), names);
	assert.match(r.stdout, /3 shards/);
	assert.match(r.stdout, /pass 7, fail 0/);
});

test('a run started inside another run ignores the outer run\'s selection and map', () => {
	const dir = kitTemp.makeTemp('nested-');
	const log = path.join(dir, 'ran.log');
	fs.writeFileSync(path.join(dir, 'x.test.mjs'), `import { test } from ${HARNESS}; import fs from 'node:fs';\n` +
		['a', 'b'].map((n) => `test('${n}', () => { fs.appendFileSync(${JSON.stringify(log)}, '${n}\\n'); });`).join('\n'));
	const outer = path.join(dir, 'only.json');
	fs.writeFileSync(outer, '[]');
	const r = run(dir, ['--shards', '1', path.join(dir, 'x.test.mjs')], { KIT_ONLY: outer, KIT_MAP_DIR: path.join(dir, 'nomap'), KIT_MAP_TEST: 'x' });
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.deepEqual(ran(log), ['a', 'b']);
	assert.equal(fs.existsSync(path.join(dir, 'nomap')), false);
});

test('a failing test in any shard fails the run and is named in the output', () => {
	const dir = kitTemp.makeTemp('shards-');
	fs.writeFileSync(path.join(dir, 'x.test.mjs'), `import { test } from ${HARNESS};\n` +
		['a', 'b', 'c'].map((n) => `test('${n}', () => {});`).join('\n') + `\ntest('the broken one', () => { throw new Error('boom'); });\n`);
	const r = run(dir, ['--shards', '2', path.join(dir, 'x.test.mjs')]);
	assert.equal(r.status, 1, r.stdout + r.stderr);
	assert.match(r.stdout, /not ok \d+ - the broken one/);
	assert.match(r.stdout, /pass 3, fail 1/);
});

// CI killed a run at its cap with nothing printed (PR 25): each shard says where it is while it runs and when it ends.
test('each shard names the test it is in while it runs, and prints its own result when it ends', () => {
	const dir = kitTemp.makeTemp('beat-');
	fs.writeFileSync(path.join(dir, 'x.test.mjs'), `import { test } from ${HARNESS};\n` +
		`test('quick', () => {});\ntest('the slow one', async () => { await new Promise((r) => setTimeout(r, 1500)); });\n`);
	const r = run(dir, ['--shards', '1', path.join(dir, 'x.test.mjs')], { KIT_RUN_BEAT_MS: '300' });
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.match(r.stdout, /test-run: shard 1\/1 at 'x\.test\.mjs > the slow one' after \d+ s/);
	assert.match(r.stdout, /test-run: shard 1\/1 done, pass 2, fail 0 in [\d.]+ s/);
	assert.ok(r.stdout.indexOf('shard 1/1 done') < r.stdout.indexOf('1 shards, pass'), 'the shard line comes before the total');
});

// A small repo: a source module with two functions, a script a test runs as a child, and a notes file a test reads.
function fixtureRepo() {
	const repo = kitTemp.makeTemp('maprepo-');
	const log = path.join(kitTemp.makeTemp('maplog-'), 'ran.log');
	const files = {
		'src/a.mjs': 'export function f() {\n  return 1;\n}\nexport function g() {\n  return 2;\n}\n',
		'src/b.cjs': "process.stdout.write('b');\n",
		'notes.md': '# Notes\n',
		'tests/x.test.mjs': [
			`import { test } from ${HARNESS};`,
			"import fs from 'node:fs';",
			"import { spawnSync } from 'node:child_process';",
			"import { f, g } from '../src/a.mjs';",
			`const mark = (n) => fs.appendFileSync(${JSON.stringify(log)}, n + '\\n');`,
			"test('f', () => { mark('f'); if (f() !== 1) throw new Error('f'); });",
			"test('g', () => { mark('g'); if (g() !== 2) throw new Error('g'); });",
			"test('child', () => { mark('child'); spawnSync(process.execPath, ['src/b.cjs']); });",
			"test('reads', () => { mark('reads'); fs.readFileSync('notes.md', 'utf8'); });",
			"test('own env', () => { mark('own env'); spawnSync(process.execPath, ['src/b.cjs'], { env: { PATH: process.env.PATH } }); });",
			'',
		].join('\n'),
	};
	for (const [rel, body] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
		fs.writeFileSync(path.join(repo, rel), body);
	}
	sh(repo, 'init', '-q', '-b', 'main'); sh(repo, 'add', '.'); sh(repo, 'commit', '-qm', 'fixture');
	return { repo, log, test: path.join(repo, 'tests', 'x.test.mjs') };
}

test('the coverage map records the lines each test runs, in its own process and in children, and the files it reads', () => {
	const { repo, test: file } = fixtureRepo();
	const r = run(repo, ['--map', file]);
	assert.equal(r.status, 0, r.stdout + r.stderr);
	const map = JSON.parse(fs.readFileSync(path.join(repo, 'tests', '.map.json'), 'utf8'));
	assert.equal(map.sha, sh(repo, 'rev-parse', 'HEAD'));
	const t = (name) => map.tests[`tests/x.test.mjs::${name}`];
	assert.ok(t('f').lines['src/a.mjs'].includes(2), 'f runs its own body');
	assert.ok(!t('f').lines['src/a.mjs'].includes(5), 'f never runs g');
	assert.ok(t('g').lines['src/a.mjs'].includes(5));
	assert.ok(t('child').lines['src/b.cjs'].includes(1), 'a child process is mapped to the test that started it');
	assert.ok(t('reads').reads.includes('notes.md'));
	assert.ok(t('own env').lines['src/b.cjs'].includes(1), 'a child given its own env is still mapped');
	assert.ok(t('own env').reads.includes('src/b.cjs'), 'and the script it runs counts as read');
	assert.ok(!t('f').reads.includes('notes.md'));
});

test('a changed run picks only the tests that reach the changed lines or files, and new tests', () => {
	const { repo, log, test: file } = fixtureRepo();
	assert.equal(run(repo, ['--map', file]).status, 0);
	const changed = (edit) => {
		sh(repo, 'checkout', '-q', '--', '.');
		fs.rmSync(log, { force: true });
		edit();
		const r = run(repo, ['--changed', file]);
		assert.equal(r.status, 0, r.stdout + r.stderr);
		return ran(log);
	};
	const sub = (rel, from, to) => { const p = path.join(repo, rel); fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(from, to)); };
	assert.deepEqual(changed(() => sub('src/a.mjs', 'return 2;', 'return 1 + 1;')), ['g']);
	assert.deepEqual(changed(() => sub('src/b.cjs', "'b'", "'bb'")), ['child', 'own env']);
	assert.deepEqual(changed(() => sub('notes.md', '# Notes', '# Notes, changed')), ['reads']);
	assert.deepEqual(changed(() => sub('tests/x.test.mjs', "mark('f');", "mark('f'); void 0;")), ['f']);
	assert.deepEqual(changed(() => fs.appendFileSync(file, "test('h', () => { mark('h'); });\n")), ['h']);
	assert.deepEqual(changed(() => sub('tests/x.test.mjs', "import fs from 'node:fs';", "import fs from 'node:fs'; // shared")), ['child', 'f', 'g', 'own env', 'reads'], 'a change outside any test runs the whole file');
	assert.deepEqual(changed(() => {}), [], 'nothing changed, nothing runs');
});

test('a changed run with no map, or a map from a commit not in history, runs everything and says why', () => {
	const { repo, log, test: file } = fixtureRepo();
	let r = run(repo, ['--changed', file]);
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.match(r.stdout, /no coverage map.*running every test/);
	assert.equal(ran(log).length, 5);
	fs.writeFileSync(path.join(repo, 'tests', '.map.json'), JSON.stringify({ sha: '0'.repeat(40), tests: {} }));
	fs.rmSync(log);
	r = run(repo, ['--changed', file]);
	assert.match(r.stdout, /map's commit .* is not in this repo.*running every test/);
	assert.equal(ran(log).length, 5);
});

test('a map run keeps the commit it started on, and its children start in a folder with a broken package.json', () => {
	const repo = kitTemp.makeTemp('maprepo2-');
	const bad = kitTemp.makeTemp('badpkg-');
	fs.writeFileSync(path.join(bad, 'package.json'), '{ not json');
	fs.mkdirSync(path.join(repo, 'tests'));
	fs.writeFileSync(path.join(repo, 'tests', 'y.test.mjs'), [
		`import { test } from ${HARNESS};`,
		"import { spawnSync } from 'node:child_process';",
		`test('child in a broken package', () => { const r = spawnSync(process.execPath, ['-e', '1'], { cwd: ${JSON.stringify(bad)}, encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); });`,
		"test('commits', () => { spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'later'], { encoding: 'utf8' }); });",
		'',
	].join('\n'));
	sh(repo, 'init', '-q', '-b', 'main'); sh(repo, 'add', '.'); sh(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'fixture');
	const start = sh(repo, 'rev-parse', 'HEAD');
	const r = run(repo, ['--map', '--shards', '1', path.join(repo, 'tests', 'y.test.mjs')]);
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.notEqual(sh(repo, 'rev-parse', 'HEAD'), start, 'a test committed during the run');
	assert.equal(JSON.parse(fs.readFileSync(path.join(repo, 'tests', '.map.json'), 'utf8')).sha, start);
});

// CI's temp folder is a short name (RUNNER~1) that git reports long (PR 25); a junction makes the same split here.
test('the map keys a test by its path in the repo when the repo is reached through another name for its folder', () => {
	const { repo, log, test: file } = fixtureRepo();
	const link = `${repo}-link`;
	fs.symlinkSync(repo, link, 'junction');
	try {
		const r = run(link, ['--map', path.join(link, path.relative(repo, file))]);
		assert.equal(r.status, 0, r.stdout + r.stderr);
		const map = JSON.parse(fs.readFileSync(path.join(repo, 'tests', '.map.json'), 'utf8'));
		assert.ok(map.tests['tests/x.test.mjs::f'], Object.keys(map.tests).join(', '));
		assert.ok(map.tests['tests/x.test.mjs::f'].lines['src/a.mjs'].includes(2), 'its lines are keyed in the repo too');
		const p = path.join(repo, 'src', 'a.mjs');
		fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('return 2;', 'return 1 + 1;'));
		const c = run(link, ['--changed', path.join(link, path.relative(repo, file))]);
		assert.equal(c.status, 0, c.stdout + c.stderr);
		assert.deepEqual(ran(log), ['child', 'f', 'g', 'own env', 'reads', 'g'].sort(), 'the map run, then only g');
	} finally {
		fs.unlinkSync(link);
	}
});

test('a runner started by a mapped test maps nothing of its own into the outer map', () => {
	const { repo, test: file } = fixtureRepo();
	const inner = kitTemp.makeTemp('inner-');
	fs.writeFileSync(path.join(inner, 'z.test.mjs'), `import { test } from ${HARNESS};\ntest('inner one', () => {});\n`);
	fs.appendFileSync(file, `test('runs a runner', () => { spawnSync(process.execPath, [${JSON.stringify(RUNNER)}, '--shards', '2', ${JSON.stringify(path.join(inner, 'z.test.mjs'))}], { cwd: ${JSON.stringify(inner)}, env: { ...process.env } }); });\n`);
	sh(repo, 'add', '.'); sh(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'runner test');
	const r = run(repo, ['--map', file]);
	assert.equal(r.status, 0, r.stdout + r.stderr);
	const keys = Object.keys(JSON.parse(fs.readFileSync(path.join(repo, 'tests', '.map.json'), 'utf8')).tests);
	assert.ok(keys.includes('tests/x.test.mjs::runs a runner'), keys.join(', '));
	assert.deepEqual(keys.filter((k) => /inner one/.test(k)), []);
});

test('a map is made only from a clean tree, so its line numbers match its commit', () => {
	const { repo, test: file } = fixtureRepo();
	fs.appendFileSync(path.join(repo, 'src', 'a.mjs'), '// local edit\n');
	const r = run(repo, ['--map', file]);
	assert.equal(r.status, 2, r.stdout + r.stderr);
	assert.match(r.stderr, /commit or stash.*src\/a\.mjs/s);
	assert.equal(fs.existsSync(path.join(repo, 'tests', '.map.json')), false);
});
