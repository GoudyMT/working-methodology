// scripts/flip-plan.mjs (CI-B) picks the mutation flips a PR must run, carries the ones past a time budget, runs the
// picked flips on parallel workers and names every flip it carried. Each test builds a small git repo and a hand-made
// tests/.map.json at its head, the way tests/mutation-check.test.mjs does.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const PLAN = path.resolve('scripts/flip-plan.mjs');
const HARNESS = JSON.stringify(pathToFileURL(path.resolve('tests/harness.mjs')).href);
const sh = (cwd, ...a) => {
	const r = spawnSync('git', a, { cwd, encoding: 'utf8' });
	if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
	return r.stdout.trim();
};

// A repo with its first commit made; commit() adds files and makes one commit, returning its sha.
function repo() {
	const dir = kitTemp.makeTemp('flipplan-');
	sh(dir, 'init', '-q', '-b', 'main');
	return dir;
}
function commit(dir, files, msg) {
	for (const [rel, text] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
		fs.writeFileSync(path.join(dir, rel), text);
	}
	sh(dir, 'add', '-A');
	sh(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', msg);
	return sh(dir, 'rev-parse', 'HEAD');
}
// The map is written after the commits, so it stays untracked, as test-run.mjs leaves it.
function map(dir, sha, tests) {
	fs.writeFileSync(path.join(dir, 'tests', '.map.json'), JSON.stringify({ sha, tests }));
}
const HEAD_IMPORTS = `import { test } from ${HARNESS};\nimport assert from 'node:assert/strict';\nimport { createRequire } from 'node:module';\nconst a = createRequire(import.meta.url)('../src/a.cjs');\n`;
function testFile(...cases) {
	return HEAD_IMPORTS + cases.join('\n') + '\n';
}
const plan = (dir, args) => spawnSync(process.execPath, [PLAN, ...args], { cwd: dir, encoding: 'utf8' });
function ok(r) {
	assert.equal(r.status, 0, r.stdout + r.stderr);
	return r.stdout;
}
const SLEEP = 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);';

// Budget fixture: four production lines, one test each, every flip predicted at 100 s.
const BUDGET_SRC = 'exports.z = 1;\nexports.one = (x) => x > 0;\nexports.two = (x) => x > 1;\nexports.three = (x) => x > 2;\nexports.four = (x) => x > 3;\n';
function budgetRepo(seconds, sleep = '') {
	const dir = repo();
	const base = commit(dir, { 'src/a.cjs': 'exports.z = 1;\n' }, 'base');
	const head = commit(dir, {
		'src/a.cjs': BUDGET_SRC,
		'tests/a.test.mjs': testFile(
			`test('t1', () => { ${sleep} assert.equal(a.one(1), true); });`,
			`test('t2', () => { ${sleep} assert.equal(a.two(5), true); });`,
			`test('t3', () => { ${sleep} assert.equal(typeof a.three(5), 'boolean'); });`,
			`test('t4', () => { ${sleep} assert.equal(typeof a.four(5), 'boolean'); });`,
		),
	}, 'head');
	map(dir, head, {
		'tests/a.test.mjs::t1': { ms: seconds * 1000, lines: { 'src/a.cjs': [2] } },
		'tests/a.test.mjs::t2': { ms: seconds * 1000, lines: { 'src/a.cjs': [3] } },
		'tests/a.test.mjs::t3': { ms: seconds * 1000, lines: { 'src/a.cjs': [4] } },
		'tests/a.test.mjs::t4': { ms: seconds * 1000, lines: { 'src/a.cjs': [5] } },
	});
	return { dir, base };
}

// why: catches only flips whose line or covering tests changed since the PR's last measured head are picked (CI-B S1)
test("only flips whose line or covering tests changed since the PR's last measured head are picked", () => {
	const dir = repo();
	const base = commit(dir, { 'src/a.cjs': 'exports.z = 1;\n' }, 'base');
	const since = commit(dir, {
		'src/a.cjs': 'exports.z = 1;\nexports.isPos = (x) => x > 0;\nexports.isBig = (x) => x > 10;\nexports.isNeg = (x) => x < 0;\n',
		'tests/a.test.mjs': testFile(
			"test('pos', () => { assert.equal(a.isPos(1), true); assert.equal(a.isPos(-1), false); });",
		),
		'tests/big.test.mjs': testFile("test('big', () => { assert.equal(typeof a.isBig(100), 'boolean'); });"),
		'tests/b.test.mjs': testFile("test('neg', () => { assert.equal(a.isNeg(-1), true); });"),
	}, 'measured');
	const head = commit(dir, {
		'src/a.cjs': 'exports.z = 1;\nexports.isPos = (x) => x > 0;\nexports.isBig = (x) => x > 20;\nexports.isNeg = (x) => x < 0;\n',
		'tests/a.test.mjs': testFile(
			"test('pos', () => { assert.equal(a.isPos(1), true); assert.equal(a.isPos(-1), false); });",
		) + '// re-read at the new head\n',
	}, 'head');
	map(dir, head, {
		'tests/a.test.mjs::pos': { ms: 1000, lines: { 'src/a.cjs': [2] } },
		'tests/big.test.mjs::big': { ms: 1000, lines: { 'src/a.cjs': [3] } },
		'tests/b.test.mjs::neg': { ms: 1000, lines: { 'src/a.cjs': [4] } },
	});
	// Line 2 is new through its covering test (a changed file), line 3 through its own changed code, line 4 through neither.
	const all = ok(plan(dir, ['--base', base]));
	assert.match(all, /^flips: 3 new of 3$/m, all);
	const mine = ok(plan(dir, ['--base', base, '--since', since]));
	assert.match(mine, /^flips: 2 new of 3$/m, mine);
	assert.match(mine, /^run: src\/a\.cjs:2 /m, mine);
	assert.match(mine, /^run: src\/a\.cjs:3 /m, mine);
	assert.doesNotMatch(mine, /src\/a\.cjs:4\b/, mine);
	// An unknown flag is a usage error and exits 2.
	const bad = plan(dir, ['--base', base, '--no-such-flag']);
	assert.equal(bad.status, 2, bad.stdout + bad.stderr);
});

// why: catches picked flips past 150 s of predicted time are named as carried, not run (CI-B S2)
test('picked flips past 150 s of predicted time are named as carried, not run', () => {
	const { dir, base } = budgetRepo(100);
	// The flip on line 3 has a test with no ms, so it counts the map's median (100 s here), not zero.
	map(dir, sh(dir, 'rev-parse', 'HEAD'), {
		'tests/a.test.mjs::t1': { ms: 100000, lines: { 'src/a.cjs': [2] } },
		'tests/a.test.mjs::t2': { lines: { 'src/a.cjs': [3] } },
		'tests/a.test.mjs::t3': { ms: 100000, lines: { 'src/a.cjs': [4] } },
		'tests/a.test.mjs::t4': { ms: 100000, lines: { 'src/a.cjs': [5] } },
	});
	// Four flips at 100 s each: the first fits the default 150 s budget, the other three are past it.
	const out = ok(plan(dir, ['--base', base]));
	assert.match(out, /^flips: 4 new of 4$/m, out);
	assert.match(out, /^run: src\/a\.cjs:2 > to <= caught$/m, out);
	for (const line of [3, 4, 5]) {
		assert.doesNotMatch(out, new RegExp(`^run: src/a\\.cjs:${line} `, 'm'), `line ${line} was run: ${out}`);
		assert.match(out, new RegExp(`^carried: src/a\\.cjs:${line} .+ \\(100(\\.0+)? s predicted\\)$`, 'm'), out);
	}
	assert.match(out, /^budget: 100(\.0+)? of 150 s$/m, out);
	// At 200 s the budget takes lines 2 and 3 (at or under is picked); lines 4 and 5 are carried.
	const at200 = ok(plan(dir, ['--base', base, '--budget', '200']));
	const runLines = at200.split('\n').filter((l) => l.startsWith('run: '));
	const carriedLines = at200.split('\n').filter((l) => l.startsWith('carried: '));
	assert.equal(runLines.length, 2, at200);
	assert.equal(carriedLines.length, 2, at200);
	assert.match(at200, /^budget: 200(\.0+)? of 200 s$/m, at200);
});

// why: catches 4 workers run flips at once and the verdicts match a serial run (CI-B S3)
test('4 workers run flips at once and the verdicts match a serial run', () => {
	// Each flip's test sleeps a second, so four serial flips take several seconds and four workers take about one.
	const { dir, base } = budgetRepo(1, SLEEP);
	const runLines = (out) => out.split('\n').filter((l) => l.startsWith('run: ')).sort();
	const t0 = Date.now();
	const serial = ok(plan(dir, ['--base', base, '--workers', '1', '--budget', '1000']));
	const serialMs = Date.now() - t0;
	const t1 = Date.now();
	const parallel = ok(plan(dir, ['--base', base, '--workers', '4', '--budget', '1000']));
	const parallelMs = Date.now() - t1;
	assert.equal(runLines(serial).length, 4, serial);
	assert.deepEqual(runLines(parallel), runLines(serial), 'the verdicts of 4 workers differ from a serial run');
	assert.ok(parallelMs < serialMs * 0.75,`4 workers took ${parallelMs} ms, serial ${serialMs} ms: not run at once`);
});

// why: catches a flip stops at its first red test (CI-B S4)
test('a flip stops at its first red test', () => {
	const dir = repo();
	const base = commit(dir, { 'src/a.cjs': 'exports.z = 1;\n' }, 'base');
	const head = commit(dir, {
		'src/a.cjs': 'exports.z = 1;\nexports.one = (x) => x > 0;\nexports.three = (x) => x > 2;\n',
		'tests/a.test.mjs': testFile(
			"test('t1', () => { assert.equal(a.one(1), true); });",
			"test('t2', () => { assert.equal(a.one(1), true); });",
			"test('t3', () => { assert.equal(typeof a.three(5), 'boolean'); });",
			"test('t4', () => { assert.equal(typeof a.three(5), 'boolean'); });",
		),
	}, 'head');
	map(dir, head, {
		'tests/a.test.mjs::t1': { ms: 1000, lines: { 'src/a.cjs': [2] } },
		'tests/a.test.mjs::t2': { ms: 1000, lines: { 'src/a.cjs': [2] } },
		'tests/a.test.mjs::t3': { ms: 1000, lines: { 'src/a.cjs': [3] } },
		'tests/a.test.mjs::t4': { ms: 1000, lines: { 'src/a.cjs': [3] } },
	});
	const json = path.join(kitTemp.makeTemp('flipplan-json-'), 'flips.json');
	ok(plan(dir, ['--base', base, '--json', json]));
	const flips = JSON.parse(fs.readFileSync(json, 'utf8'));
	const red = flips.find((f) => f.line === 2);
	assert.equal(red.verdict, 'caught', JSON.stringify(flips));
	assert.equal(red.ran.length, 1, `a red flip ran ${JSON.stringify(red.ran)}, not just its first red test`);
	const green = flips.find((f) => f.line === 3);
	assert.equal(green.verdict, 'survived', JSON.stringify(flips));
	assert.equal(green.ran.length, 2, `a green flip ran ${JSON.stringify(green.ran)}, not both of its tests`);
});

// why: catches the report names every carried flip (CI-B S5)
test('the report names every carried flip', () => {
	const { dir, base } = budgetRepo(100);
	const json = path.join(kitTemp.makeTemp('flipplan-carry-'), 'flips.json');
	// A 250 s budget takes two flips at 100 s each (200 s); the other two are carried and must each be named.
	const out = ok(plan(dir, ['--base', base, '--budget', '250', '--json', json]));
	assert.match(out, /^budget: 200(\.0+)? of 250 s$/m, out);
	const carried = out.split('\n').filter((l) => l.startsWith('carried: '));
	assert.equal(carried.length, 2, out);
	for (const line of [4, 5]) {
		assert.ok(carried.some((l) => l.startsWith(`carried: src/a.cjs:${line} `)), `line ${line} not named: ${out}`);
	}
	// A carried flip's JSON record says so and ran nothing.
	const records = JSON.parse(fs.readFileSync(json, 'utf8'));
	for (const line of [4, 5]) {
		const rec = records.find((f) => f.line === line);
		assert.ok(rec, JSON.stringify(records));
		assert.equal(rec.verdict, 'carried', JSON.stringify(rec));
		assert.deepEqual(rec.ran, [], JSON.stringify(rec));
	}
});
