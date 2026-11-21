// Tests for the test harness (tests/harness.mjs) and the runner's shards, coverage map and change-scoped runs
// (scripts/test-run.mjs). Each drives the runner on a small repo of its own, the way the owner runs it locally.
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
const HARNESS = JSON.stringify(pathToFileURL(path.resolve('tests/harness.mjs')).href);

const sh = (cwd, ...a) => {
	const r = spawnSync('git', a, { cwd, encoding: 'utf8' });
	if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
	return r.stdout.trim();
};
// The fixture's run is its own: the Windows slice this suite may run in is not passed on (a test sets it itself).
const run = (cwd, args, env = {}) => {
	const { KIT_WINDOWS_SLICE: _w, ...base } = process.env;
	return spawnSync(process.execPath, [RUNNER, ...args], { cwd, encoding: 'utf8', env: { ...base, ...env } });
};
// Each test the fixture runs writes its name to the log, so a run shows exactly which tests ran and how often.
const ran = (log) => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).sort() : []);

// why: guards rule:test-and-review-cadence
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

// The build 17 sweep: the test check handed its list of tests to the map run as KIT_ONLY, which the runner takes out
// of every shard's environment (a run inside a run must not inherit it), so the map ran every test of each file.
// why: guards rule:test-and-review-cadence (the test check's planted-bug part ran whole files, the time K131 cut)
test('a map run given a list maps the listed tests alone', () => {
	const repo = kitTemp.makeTemp('only-');
	fs.mkdirSync(path.join(repo, 'tests'));
	fs.writeFileSync(path.join(repo, '.gitignore'), 'tests/.map.json\nonly.json\n');
	fs.writeFileSync(path.join(repo, 'tests', 'x.test.mjs'), `import { test } from ${HARNESS};\ntest('one', () => {});\ntest('two', () => {});\n`);
	sh(repo, 'init', '-q', '-b', 'main'); sh(repo, 'add', '.'); sh(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'fixture');
	const list = path.join(repo, 'only.json');
	fs.writeFileSync(list, JSON.stringify(['tests/x.test.mjs::one']));
	const r = run(repo, ['--map', '--shards', '1', '--only', list, path.join(repo, 'tests', 'x.test.mjs')]);
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(repo, 'tests', '.map.json'), 'utf8')).tests), ['tests/x.test.mjs::one']);
});

// The build 17 sweep: each slice packed by its own machine's map, so a slice with a map and one without (or with
// another commit's) split the tests two ways: one ran twice, three never. Slices split by name alone.
// why: guards rule:test-and-review-cadence (a sliced run that skips tests reports green)
// planted: {"file":"scripts/test-run.mjs","was":"if (!o.map && !o.slice && shardFiles.length","to":"if (!o.map && shardFiles.length"}
test('slices split the tests the same way whatever map each machine holds, so each test runs once', () => {
	const repo = kitTemp.makeTemp('slice-');
	const log = path.join(repo, 'ran.log');
	fs.mkdirSync(path.join(repo, 'tests'));
	fs.writeFileSync(path.join(repo, '.gitignore'), 'tests/.map.json\nran.log\n');
	const body = (n, ms) => `test('${n}', async () => { await new Promise((r) => setTimeout(r, ${ms})); fs.appendFileSync(${JSON.stringify(log)}, '${n}\\n'); });`;
	fs.writeFileSync(path.join(repo, 'tests', 'x.test.mjs'), [`import { test } from ${HARNESS}; import fs from 'node:fs';`, body('a', 5), body('slow', 600), body('b', 5), body('c', 5), body('d', 5), ''].join('\n'));
	sh(repo, 'init', '-q', '-b', 'main'); sh(repo, 'add', '.'); sh(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'fixture');
	const file = path.join(repo, 'tests', 'x.test.mjs');
	assert.equal(run(repo, ['--map', '--shards', '1', file]).status, 0);
	fs.rmSync(log, { force: true });
	assert.equal(run(repo, ['--slice', '0/2', '--shards', '1', file]).status, 0);
	fs.rmSync(path.join(repo, 'tests', '.map.json'));
	assert.equal(run(repo, ['--slice', '1/2', '--shards', '1', file]).status, 0);
	assert.deepEqual(ran(log).sort(), ['a', 'b', 'c', 'd', 'slow']);
});

// K123 (build 17, the owner's fast-CI standard): shards split by count finished unevenly (main's run of 1.42.0: 140 s
// to 180 s). The map run keeps each test's time, and a run with a map packs the tests over the shards by it, longest
// first onto the least loaded, so the shards finish together; a test the map has no time for goes round robin.
// why: guards rule:test-and-review-cadence (a shard left with the slow tests holds every PR's wait)
test('a run with a map packs the tests over the shards by their last run time, each test once', () => {
	const repo = kitTemp.makeTemp('pack-');
	const log = path.join(repo, 'ran.log');
	fs.mkdirSync(path.join(repo, 'tests'));
	fs.writeFileSync(path.join(repo, '.gitignore'), 'tests/.map.json\nran.log\n');
	const body = (n, ms) => `test('${n}', async () => { await new Promise((r) => setTimeout(r, ${ms})); fs.appendFileSync(${JSON.stringify(log)}, '${n} ' + process.env.KIT_SHARD + '\\n'); });`;
	fs.writeFileSync(path.join(repo, 'tests', 'x.test.mjs'), [`import { test } from ${HARNESS}; import fs from 'node:fs';`, body('a', 5), body('slow', 900), body('b', 5), body('c', 5), body('d', 5), ''].join('\n'));
	sh(repo, 'init', '-q', '-b', 'main'); sh(repo, 'add', '.'); sh(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'fixture');
	const file = path.join(repo, 'tests', 'x.test.mjs');
	assert.equal(run(repo, ['--map', '--shards', '1', file]).status, 0);
	const map = JSON.parse(fs.readFileSync(path.join(repo, 'tests', '.map.json'), 'utf8'));
	assert.ok(map.tests['tests/x.test.mjs::slow'].ms >= 800, JSON.stringify(map.tests['tests/x.test.mjs::slow']));
	assert.ok(map.tests['tests/x.test.mjs::a'].ms < 800);
	fs.rmSync(log, { force: true });
	const r = run(repo, ['--shards', '2', file]);
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.match(r.stdout, /packed by last run time/);
	const seen = ran(log).map((l) => l.split(' '));
	assert.deepEqual(seen.map(([n]) => n).sort(), ['a', 'b', 'c', 'd', 'slow'], 'each test once');
	const shardOf = Object.fromEntries(seen);
	assert.deepEqual(seen.filter(([n]) => n !== 'slow').map(([, s]) => s).filter((s) => s === shardOf.slow), [], 'the slow test runs alone in its shard');
	// A test the map has no time for still runs, once.
	fs.appendFileSync(file, body('new', 5) + '\n');
	fs.rmSync(log, { force: true });
	assert.equal(run(repo, ['--shards', '2', file]).status, 0);
	assert.deepEqual(ran(log).map((l) => l.split(' ')[0]).sort(), ['a', 'b', 'c', 'd', 'new', 'slow']);
});

// K108 (1.40.0 verify): a full run read only tests/*.test.mjs and CI's slow lane only tests/slow, so a test file in any
// other tests/ subfolder ran in no lane and its failures reached no one.
// why: catches a test file in a tests/ subfolder that runs in no lane (K108)
test('a full run refuses a test file in a tests/ subfolder no lane runs, and names it', () => {
	const dir = kitTemp.makeTemp('lost-');
	const log = path.join(dir, 'ran.log');
	fs.mkdirSync(path.join(dir, 'tests', 'unit'), { recursive: true });
	fs.mkdirSync(path.join(dir, 'tests', 'slow'), { recursive: true });
	const body = (n) => `import { test } from ${HARNESS}; import fs from 'node:fs';\ntest('${n}', () => { fs.appendFileSync(${JSON.stringify(log)}, '${n}\\n'); });\n`;
	fs.writeFileSync(path.join(dir, 'tests', 'top.test.mjs'), body('top'));
	fs.writeFileSync(path.join(dir, 'tests', 'slow', 'big.test.mjs'), body('big'));
	const lost = path.join(dir, 'tests', 'unit', 'lost.test.mjs');
	fs.writeFileSync(lost, body('lost'));
	const r = run(dir, [], { CI: '1' });
	assert.notEqual(r.status, 0, r.stdout + r.stderr);
	assert.match(r.stderr, /tests\/unit\/lost\.test\.mjs/);
	assert.doesNotMatch(r.stderr, /big\.test\.mjs/, 'the slow lane runs tests/slow');
	fs.rmSync(lost);
	// Only tests/slow itself is the slow lane: a slow folder deeper down runs nowhere; a top-level .test.js neither.
	// The slow lane runs *.test.mjs only, by name and case (the build 15 sweep: a .js or .Test.mjs there ran nowhere).
	for (const f of [path.join('tests', 'unit', 'slow', 'deep.test.mjs'), path.join('tests', 'top2.test.js'), path.join('tests', 'slow', 'b.test.js'), path.join('tests', 'slow', 'c.Test.mjs')]) {
		fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
		fs.writeFileSync(path.join(dir, f), body('x'));
		const r2 = run(dir, [], { CI: '1' });
		assert.match(r2.stderr, new RegExp(f.split(path.sep).join('/').replace(/\./g, '\\.')), f);
		fs.rmSync(path.join(dir, f));
	}
	// A linked folder is followed by neither lane (the build 15 sweep: tests/slow as a junction emptied the slow lane).
	const elsewhere = kitTemp.makeTemp('lost-target-');
	fs.writeFileSync(path.join(elsewhere, 'far.test.mjs'), body('far'));
	fs.symlinkSync(elsewhere, path.join(dir, 'tests', 'linked'), 'junction');
	const linked = run(dir, [], { CI: '1' });
	assert.notEqual(linked.status, 0, linked.stdout + linked.stderr);
	assert.match(linked.stderr, /tests\/linked \(a link\)/);
	fs.rmSync(path.join(dir, 'tests', 'linked'));
	assert.equal(run(dir, [], { CI: '1' }).status, 0, 'with no lost file the run passes');
});

// E31: Linux runs the suite and Windows the tests marked { windows: true }; together every test runs, and each one
// marked runs on Windows (off Windows it is skipped and reported, never dropped silently, F20). { windows: 'also' }
// runs everywhere and in the slice (F16). Both platforms are checked on either, through KIT_TEST_PLATFORM.
// why: guards rule:test-and-review-cadence
test('the Windows slice runs only the marked tests, and elsewhere the Windows-only ones are reported skipped', () => {
	const dir = kitTemp.makeTemp('winslice-');
	const log = path.join(dir, 'ran.log');
	fs.writeFileSync(path.join(dir, 'x.test.mjs'), `import { test } from ${HARNESS}; import fs from 'node:fs';\n` +
		['a', 'b'].map((n) => `test('${n}', () => { fs.appendFileSync(${JSON.stringify(log)}, '${n}\\n'); });`).join('\n') +
		`\ntest('w', { windows: true }, () => { fs.appendFileSync(${JSON.stringify(log)}, 'w\\n'); });` +
		`\ntest('j', { windows: 'also' }, () => { fs.appendFileSync(${JSON.stringify(log)}, 'j\\n'); });`);
	const runAs = (platform, slice) => {
		fs.rmSync(log, { force: true });
		const r = run(dir, ['--shards', '2', path.join(dir, 'x.test.mjs')], { KIT_TEST_PLATFORM: platform, KIT_WINDOWS_SLICE: slice ? '1' : '' });
		assert.equal(r.status, 0, r.stdout + r.stderr);
		return { ran: ran(log), out: r.stdout };
	};
	const winSlice = runAs('win32', true);
	assert.deepEqual(winSlice.ran, ['j', 'w']);
	assert.deepEqual(runAs('win32', false).ran, ['a', 'b', 'j', 'w']);
	const linux = runAs('linux', false);
	assert.deepEqual(linux.ran, ['a', 'b', 'j']);
	assert.match(linux.out, /, pass 3, fail 0, skipped 1 in/);
	// A slice run off Windows (a misconfigured job) runs nothing silently: the marked test is reported skipped.
	const linuxSlice = runAs('linux', true);
	assert.deepEqual(linuxSlice.ran, ['j']);
	assert.match(linuxSlice.out, /skipped 1 in/);
});

// CI splits the suite over several runners (S22-1): the slices together run each test once, and a file outside the
// harness runs in the first slice only.
// why: guards rule:test-and-review-cadence
test('runner slices split the shards over CI jobs: together every test exactly once, a whole file once', () => {
	const dir = kitTemp.makeTemp('slices-');
	const log = path.join(dir, 'ran.log');
	const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
	fs.writeFileSync(path.join(dir, 'x.test.mjs'), `import { test } from ${HARNESS}; import fs from 'node:fs';\n` +
		names.map((n) => `test('${n}', () => { fs.appendFileSync(${JSON.stringify(log)}, '${n}\\n'); });`).join('\n'));
	fs.writeFileSync(path.join(dir, 'w.test.mjs'), `import { test } from 'node:test'; import fs from 'node:fs';\n` +
		`test('whole', () => { fs.appendFileSync(${JSON.stringify(log)}, 'whole\\n'); });`);
	const files = [path.join(dir, 'x.test.mjs'), path.join(dir, 'w.test.mjs')];
	for (let i = 0; i < 3; i++) {
		const r = run(dir, ['--slice', `${i}/3`, '--shards', '2', ...files]);
		assert.equal(r.status, 0, r.stdout + r.stderr);
		assert.match(r.stdout, new RegExp(`slice ${i + 1}/3`));
	}
	assert.deepEqual(ran(log), [...names, 'whole'].sort());
	for (const bad of ['3/3', '-1/3', 'x', '1/0']) {
		const r = run(dir, ['--slice', bad, '--shards', '2', ...files]);
		assert.equal(r.status, 2, `--slice ${bad}: ${r.stdout}${r.stderr}`);
	}
	// The 1.23.0 sweep. Each runner picked its own shard count from its CPUs, so two slices could split the tests two
	// ways, skipping some and running others twice: a slice needs --shards, the same on every runner. And a map is of
	// the whole suite: one slice's map would stand at HEAD with half the tests.
	const none = run(dir, ['--slice', '0/3', ...files]);
	assert.equal(none.status, 2, none.stdout + none.stderr);
	assert.match(none.stderr, /--shards/);
	const half = run(dir, ['--map', '--slice', '0/2', '--shards', '2', ...files]);
	assert.equal(half.status, 2, half.stdout + half.stderr);
	assert.match(half.stderr, /whole suite/);
});

// why: guards rule:test-and-review-cadence
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

// why: guards rule:test-and-review-cadence
test('a failing test in any shard fails the run and is named in the output', () => {
	const dir = kitTemp.makeTemp('shards-');
	fs.writeFileSync(path.join(dir, 'x.test.mjs'), `import { test } from ${HARNESS};\n` +
		['a', 'b', 'c'].map((n) => `test('${n}', () => {});`).join('\n') + `\ntest('the broken one', () => { throw new Error('boom'); });\n`);
	const r = run(dir, ['--shards', '2', path.join(dir, 'x.test.mjs')]);
	assert.equal(r.status, 1, r.stdout + r.stderr);
	assert.match(r.stdout, /not ok \d+ - the broken one/);
	assert.match(r.stdout, /pass 3, fail 1/);
});

// The 1.24.0 build: a mutant dropped a test's own Claude folder, and an install wrote into the owner's real one. Every
// run gives its tests a throwaway Claude folder, so a test that loses its own falls back there, never to ~/.claude.
// why: guards rule:test-and-review-cadence
test('every run gives its tests a throwaway Claude folder, never the real one', () => {
	const dir = kitTemp.makeTemp('home-');
	const seen = path.join(dir, 'seen.json');
	fs.writeFileSync(path.join(dir, 'x.test.mjs'), `import { test } from ${HARNESS};\nimport fs from 'node:fs';\n` +
		`test('reads', () => { fs.writeFileSync(${JSON.stringify(seen)}, JSON.stringify([process.env.KIT_CLAUDE_HOME, process.env.CLAUDE_CONFIG_DIR, fs.existsSync(process.env.KIT_CLAUDE_HOME || '')])); });\n`);
	const { KIT_CLAUDE_HOME: _k, CLAUDE_CONFIG_DIR: _c, ...env } = process.env;
	const r = spawnSync(process.execPath, [RUNNER, '--shards', '1', path.join(dir, 'x.test.mjs')], { cwd: dir, encoding: 'utf8', env });
	assert.equal(r.status, 0, r.stdout + r.stderr);
	const [kit, config, exists] = JSON.parse(fs.readFileSync(seen, 'utf8'));
	assert.ok(kit && exists, 'a Claude folder the run made');
	assert.equal(config, kit, 'Claude Code\'s own variable names the same throwaway');
	assert.notEqual(path.resolve(kit), path.join(os.homedir(), '.claude'));
	assert.ok(!path.resolve(kit).startsWith(path.join(os.homedir(), '.claude')));
});

// CI killed a run at its cap with nothing printed (PR 25): each shard says where it is while it runs and when it ends.
// why: guards rule:test-and-review-cadence
test('each shard names the test it is in while it runs, and prints its own result when it ends', () => {
	const dir = kitTemp.makeTemp('beat-');
	fs.writeFileSync(path.join(dir, 'x.test.mjs'), `import { test } from ${HARNESS};\n` +
		`test('quick', () => {});\ntest('the slow one', async () => { await new Promise((r) => setTimeout(r, 1500)); });\n`);
	const r = run(dir, ['--shards', '1', path.join(dir, 'x.test.mjs')], { KIT_RUN_BEAT_MS: '300' });
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.match(r.stdout, /test-run: shard 1\/1 at[\s\S]*'x\.test\.mjs > the slow one'.*after \d+ s/);
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

// K136 (build 18): a test that installs the kit runs the guards from the installed copies, in a temp project or Claude
// folder outside the repo, under the launcher's start line (NODE_OPTIONS cleared), so the map dropped every line they
// ran and the PR test pick could miss the tests of guard code. An installed copy now counts as the repo file it came
// from: project/.claude, and user/kit-tools, kit-hooks and skills, by its path below that folder.
// why: catches the PR test pick missing tests that reach guard code through an installed copy
test('the coverage map credits lines run from an installed copy outside the repo to the repo file it came from', () => {
	const repo = kitTemp.makeTemp('maprepo-');
	const files = {
		// The build 18 sweep: install fills {{CLAUDE_HOME}} in, so the copy's offsets are longer than the repo file's.
		'project/.claude/hook.cjs': "const x = '{{CLAUDE_HOME}}';\nif (process.argv[2] === 'go') process.stdout.write('go');\nelse process.stdout.write('no');\n",
		'user/kit-tools/tool.cjs': "process.stdout.write('t');\n",
		'tests/x.test.mjs': [
			`import { test } from ${HARNESS};`,
			"import fs from 'node:fs';",
			"import os from 'node:os';",
			"import path from 'node:path';",
			"import { spawnSync } from 'node:child_process';",
			"test('installed', () => {",
			"  const at = path.join(os.tmpdir(), `inst-${process.pid}-${Date.now()}`);",
			'  fs.mkdirSync(at);',
			"  for (const [from, to] of [['project/.claude/hook.cjs', 'proj/.claude/hook.cjs'], ['user/kit-tools/tool.cjs', 'home/kit-tools/tool.cjs']]) { fs.mkdirSync(path.dirname(path.join(at, to)), { recursive: true }); fs.writeFileSync(path.join(at, to), fs.readFileSync(from, 'utf8').replaceAll('{{CLAUDE_HOME}}', '/opt/a/much/longer/claude/config/folder/than/the/placeholder/is')); }",
			"  spawnSync(process.execPath, [path.join(at, 'proj/.claude/hook.cjs'), 'go'], { env: { ...process.env, NODE_OPTIONS: '' } });",
			"  spawnSync(process.execPath, [path.join(at, 'home/kit-tools/tool.cjs')], { env: { ...process.env, NODE_OPTIONS: '' } });",
			"  fs.rmSync(at, { recursive: true, force: true });",
			'});',
			'',
		].join('\n'),
	};
	for (const [rel, body] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
		fs.writeFileSync(path.join(repo, rel), body);
	}
	sh(repo, 'init', '-q', '-b', 'main'); sh(repo, 'add', '.'); sh(repo, 'commit', '-qm', 'fixture');
	const r = run(repo, ['--map', path.join(repo, 'tests', 'x.test.mjs')]);
	assert.equal(r.status, 0, r.stdout + r.stderr);
	const t = JSON.parse(fs.readFileSync(path.join(repo, 'tests', '.map.json'), 'utf8')).tests['tests/x.test.mjs::installed'];
	assert.deepEqual(t.lines['project/.claude/hook.cjs'], [1, 2], 'the installed guard copy ran lines 1 and 2, never 3');
	assert.deepEqual(t.lines['user/kit-tools/tool.cjs'], [1]);
});

// why: guards rule:test-and-review-cadence
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

// why: guards rule:test-and-review-cadence
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

// K105 (PR 49): CI ran the security files again after the changed run had run the ones it reached, and a change
// reaching 556 of 921 tests took longer than the whole suite. --always adds files to the selection, so each test runs
// once; a selection over half the suite runs it all; --pick names the selection and runs nothing (T8, test pick).
// why: guards rule:test-and-review-cadence
test('a changed run adds the always files once, runs everything above half, and --pick only names the tests', () => {
	const { repo, log, test: file } = fixtureRepo();
	const sec = path.join(repo, 'tests', 'sec.test.mjs');
	fs.writeFileSync(sec, [`import { test } from ${HARNESS};`, "import fs from 'node:fs';", `test('sec', () => { fs.appendFileSync(${JSON.stringify(log)}, 'sec\\n'); });`, ''].join('\n'));
	sh(repo, 'add', '.'); sh(repo, 'commit', '-qm', 'sec');
	assert.equal(run(repo, ['--map', file, sec]).status, 0);
	const sub = (rel, from, to) => { const p = path.join(repo, rel); fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(from, to)); };
	fs.rmSync(log, { force: true });
	sub('src/a.mjs', 'return 2;', 'return 1 + 1;');
	let r = run(repo, ['--changed', '--always', sec, file, sec]);
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.deepEqual(ran(log), ['g', 'sec'], 'the always file ran twice, or not at all');
	fs.rmSync(log, { force: true });
	r = run(repo, ['--changed', '--pick', file, sec]);
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.match(r.stdout, /^tests\/x\.test\.mjs::g$/m);
	assert.ok(!fs.existsSync(log), '--pick ran a test');
	// K170 (the S1 replay of 1.40.0): --pick alone is the same pick; it printed nothing and ran the whole suite.
	r = run(repo, ['--pick', file, sec]);
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.match(r.stdout, /^tests\/x\.test\.mjs::g$/m);
	assert.ok(!fs.existsSync(log), '--pick alone ran a test');
	// 4 of 6 tests reached: over half, so every test runs, and the run says why.
	sub('src/b.cjs', "'b'", "'bb'");
	sub('notes.md', '# Notes', '# Notes, changed');
	r = run(repo, ['--changed', file, sec]);
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.match(r.stdout, /4 of 6 tests.*over half.*running every test/);
	assert.equal(ran(log).length, 6);
});

// The build 14 sweep: a file git shows as binary, a path with a space, a test named at run time and a test written
// `test (` each kept a reached test from running. Each now runs it, or runs its whole file.
// why: guards rule:test-and-review-cadence
test('a changed run still picks the tests a binary diff, a spaced path or an odd test start reaches', () => {
	const { repo, log, test: file } = fixtureRepo();
	const p = (rel) => path.join(repo, rel);
	fs.writeFileSync(p('a b.md'), 'spaced\n');
	fs.appendFileSync(file, [
		"test('reads spaced', () => { mark('reads spaced'); fs.readFileSync('a b.md', 'utf8'); });",
		"test('first ' + 'second', () => { mark('built'); });",
		"test ('spaced start', () => { mark('spaced start'); });", ''].join('\n'));
	sh(repo, 'add', '.'); sh(repo, 'commit', '-qm', 'more');
	assert.equal(run(repo, ['--map', file]).status, 0);
	const pick = (edit) => {
		sh(repo, 'checkout', '-q', '--', '.');
		edit();
		const r = run(repo, ['--changed', '--pick', file]);
		assert.equal(r.status, 0, r.stdout + r.stderr);
		return r.stdout;
	};
	const sub = (rel, from, to) => fs.writeFileSync(p(rel), fs.readFileSync(p(rel), 'utf8').replace(from, to));
	// A local attributes file (left untracked by checkout) makes git show src/a.mjs as binary, with no line numbers.
	assert.match(pick(() => { fs.writeFileSync(p('src/.gitattributes'), '*.mjs -diff\n'); sub('src/a.mjs', 'return 2;', 'return 5;'); }), /tests\/x\.test\.mjs::(g|\*)$/m);
	fs.rmSync(p('src/.gitattributes'));
	assert.match(pick(() => sub('a b.md', 'spaced', 'changed')), /tests\/x\.test\.mjs::(reads spaced|\*)$/m);
	assert.match(pick(() => sub('tests/x.test.mjs', "mark('built');", "mark('built'); void 0;")), /^tests\/x\.test\.mjs::\*$/m);
	assert.match(pick(() => sub('tests/x.test.mjs', "mark('spaced start');", "mark('spaced start'); void 0;")), /tests\/x\.test\.mjs::(spaced start|\*)$/m);
});

// why: guards rule:test-and-review-cadence
// 1.35.0: a PR that changed test files ran only those tests, so the pin check, which reads every test file as data,
// was skipped, and main went red on the merge.
test('a changed test file also runs the tests that read it as data', () => {
	const { repo, log, test: file } = fixtureRepo();
	const lint = path.join(repo, 'tests', 'lint.test.mjs');
	fs.writeFileSync(lint, [`import { test } from ${HARNESS};`, "import fs from 'node:fs';", `test('lint', () => { fs.appendFileSync(${JSON.stringify(log)}, 'lint\\n'); fs.readFileSync('tests/x.test.mjs', 'utf8'); });`, ''].join('\n'));
	sh(repo, 'add', '.'); sh(repo, 'commit', '-qm', 'lint');
	assert.equal(run(repo, ['--map', file, lint]).status, 0);
	fs.rmSync(log, { force: true });
	const p = path.join(repo, 'tests', 'x.test.mjs');
	fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace("mark('f');", "mark('f'); void 0;"));
	const r = run(repo, ['--changed', file, lint]);
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.deepEqual(ran(log), ['f', 'lint']);
});

// why: guards rule:test-and-review-cadence
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

// why: guards rule:test-and-review-cadence
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
// why: guards rule:test-and-review-cadence
test('the map keys a test by its path in the repo when the repo is reached through another name for its folder', { windows: 'also' }, () => {
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

// why: guards rule:test-and-review-cadence
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

// why: guards rule:test-and-review-cadence
test('a map is made only from a clean tree, so its line numbers match its commit', () => {
	const { repo, test: file } = fixtureRepo();
	fs.appendFileSync(path.join(repo, 'src', 'a.mjs'), '// local edit\n');
	const r = run(repo, ['--map', file]);
	assert.equal(r.status, 2, r.stdout + r.stderr);
	assert.match(r.stderr, /commit or stash.*src\/a\.mjs/s);
	assert.equal(fs.existsSync(path.join(repo, 'tests', '.map.json')), false);
});

// K59: a full local run costs minutes and finds what CI finds. K150 (build 20): the notice did not hold it (build 19
// reran about 170 tests locally), so off CI a full or --changed run is refused unless the owner's yes is passed on.
// renamed from: a full local run prints a notice that CI runs the suite; CI, --changed, --map and named files print none
// why: guards the owner's starred rule "locally run only the changed test"
test('off CI a full or --changed run is refused without the owner\'s yes; CI, --map and named files run', () => {
	const dir = kitTemp.makeTemp('notice-');
	fs.mkdirSync(path.join(dir, 'tests'));
	const file = path.join(dir, 'tests', 'x.test.mjs');
	fs.writeFileSync(file, `import { test } from 'node:test';\ntest('a', () => {});\n`);
	const refused = /test-run: refused: a full or --changed run is CI's job/;
	for (const args of [[], ['--changed']]) {
		const r = run(dir, args, { CI: '' });
		assert.equal(r.status, 2, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
		assert.match(r.stderr, refused);
	}
	const yes = run(dir, ['--owner-yes'], { CI: '' });
	assert.equal(yes.status, 0, yes.stdout + yes.stderr);
	assert.match(yes.stdout, /on the owner's yes/);
	for (const [args, env] of [[[], { CI: 'true' }], [['--map'], { CI: '' }], [[file], { CI: '' }], [['--changed', '--pick'], { CI: '' }], [['--pick'], { CI: '' }]]) {
		const r = run(dir, args, env);
		assert.doesNotMatch(r.stderr, refused, `${args.join(' ')} CI=${env.CI}`);
		if (!args.length || args[0] === file) assert.equal(r.status, 0, `${args.join(' ')} CI=${env.CI}: ${r.stdout}${r.stderr}`);
	}
});
