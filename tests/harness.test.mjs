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

test('a failing test in any shard fails the run and is named in the output', () => {
	const dir = kitTemp.makeTemp('shards-');
	fs.writeFileSync(path.join(dir, 'x.test.mjs'), `import { test } from ${HARNESS};\n` +
		['a', 'b', 'c'].map((n) => `test('${n}', () => {});`).join('\n') + `\ntest('the broken one', () => { throw new Error('boom'); });\n`);
	const r = run(dir, ['--shards', '2', path.join(dir, 'x.test.mjs')]);
	assert.equal(r.status, 1, r.stdout + r.stderr);
	assert.match(r.stdout, /not ok \d+ - the broken one/);
	assert.match(r.stdout, /pass 3, fail 1/);
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
	assert.deepEqual(changed(() => sub('src/b.cjs', "'b'", "'bb'")), ['child']);
	assert.deepEqual(changed(() => sub('notes.md', '# Notes', '# Notes, changed')), ['reads']);
	assert.deepEqual(changed(() => sub('tests/x.test.mjs', "mark('f');", "mark('f'); void 0;")), ['f']);
	assert.deepEqual(changed(() => fs.appendFileSync(file, "test('h', () => { mark('h'); });\n")), ['h']);
	assert.deepEqual(changed(() => sub('tests/x.test.mjs', "import fs from 'node:fs';", "import fs from 'node:fs'; // shared")), ['child', 'f', 'g', 'reads'], 'a change outside any test runs the whole file');
	assert.deepEqual(changed(() => {}), [], 'nothing changed, nothing runs');
});

test('a changed run with no map, or a map from a commit not in history, runs everything and says why', () => {
	const { repo, log, test: file } = fixtureRepo();
	let r = run(repo, ['--changed', file]);
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.match(r.stdout, /no coverage map.*running every test/);
	assert.equal(ran(log).length, 4);
	fs.writeFileSync(path.join(repo, 'tests', '.map.json'), JSON.stringify({ sha: '0'.repeat(40), tests: {} }));
	fs.rmSync(log);
	r = run(repo, ['--changed', file]);
	assert.match(r.stdout, /map's commit .* is not in this repo.*running every test/);
	assert.equal(ran(log).length, 4);
});

test('a map is made only from a clean tree, so its line numbers match its commit', () => {
	const { repo, test: file } = fixtureRepo();
	fs.appendFileSync(path.join(repo, 'src', 'a.mjs'), '// local edit\n');
	const r = run(repo, ['--map', file]);
	assert.equal(r.status, 2, r.stdout + r.stderr);
	assert.match(r.stderr, /commit or stash.*src\/a\.mjs/s);
	assert.equal(fs.existsSync(path.join(repo, 'tests', '.map.json')), false);
});
