// Tests for the coverage map in slices and its merge (scripts/test-run.mjs --map --slice, scripts/map-merge.mjs). Each
// drives the runner or the merge on a small repo of its own, the way CI runs them.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const RUNNER = path.resolve('scripts/test-run.mjs');
const MERGE = path.resolve('scripts/map-merge.mjs');
const HARNESS = JSON.stringify(pathToFileURL(path.resolve('tests/harness.mjs')).href);
const FILE = 'tests/x.test.mjs';
const ALL = ['a', 'b', 'c', 'd'];

const sh = (cwd, ...a) => {
	const r = spawnSync('git', a, { cwd, encoding: 'utf8' });
	if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
	return r.stdout.trim();
};
// The fixture's run is its own: the Windows slice this suite may run in is not passed on.
const node = (cwd, script, args) => {
	const { KIT_WINDOWS_SLICE: _w, ...base } = process.env;
	return spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', env: base });
};
// A repo with one harnessed test file of four tests; each test logs its name and the shard it ran in. Committed on main.
function fixture() {
	const repo = kitTemp.makeTemp('map-slice-');
	fs.mkdirSync(path.join(repo, 'tests'));
	fs.writeFileSync(path.join(repo, '.gitignore'), 'tests/.map*.json\nran.log\n');
	const log = path.join(repo, 'ran.log');
	const body = (n) => `test('${n}', () => { fs.appendFileSync(${JSON.stringify(log)}, '${n} ' + process.env.KIT_SHARD + '\\n'); });`;
	fs.writeFileSync(path.join(repo, FILE), [`import { test } from ${HARNESS}; import fs from 'node:fs';`, ...ALL.map(body), ''].join('\n'));
	sh(repo, 'init', '-q', '-b', 'main'); sh(repo, 'add', '.'); sh(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'fixture');
	return { repo, log, sha: sh(repo, 'rev-parse', 'HEAD') };
}
// The test names a shard ran, from the fixture's log, sorted.
const ranIn = (log, shard) => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter((l) => l.endsWith(` ${shard}`)).map((l) => l.split(' ')[0]).sort() : []);
const tName = (key) => key.slice(key.indexOf('::') + 2);
const partPath = (repo, name) => path.join(repo, 'tests', name);
const writePart = (repo, name, sha, names, ms = 5) => fs.writeFileSync(partPath(repo, name), JSON.stringify({ sha, made: 'x', tests: Object.fromEntries(names.map((n) => [`${FILE}::${n}`, { lines: {}, reads: [], ms }])) }));

// why: catches --map with --slice 0/2 writes a part map holding only that slice's tests (CI-A S1)
test("--map with --slice 0/2 writes a part map holding only that slice's tests", () => {
	const { repo, log } = fixture();
	const file = path.join(repo, FILE);
	const r0 = node(repo, RUNNER, ['--map', '--slice', '0/2', '--shards', '1', file]);
	assert.equal(r0.status, 0, r0.stdout + r0.stderr);
	const r1 = node(repo, RUNNER, ['--map', '--slice', '1/2', '--shards', '1', file]);
	assert.equal(r1.status, 0, r1.stdout + r1.stderr);
	const parts = ['.map-part-0.json', '.map-part-1.json'].map((n) => partPath(repo, n));
	for (const p of parts) assert.ok(fs.existsSync(p), `no part map at ${p}`);
	const held = parts.map((p) => Object.keys(JSON.parse(fs.readFileSync(p, 'utf8')).tests).map(tName).sort());
	assert.deepEqual(held[0], ranIn(log, '0/2'));
	assert.deepEqual(held[1], ranIn(log, '1/2'));
	assert.deepEqual([...held[0], ...held[1]].sort(), ALL);
});

// why: catches map-merge of two part maps equals one whole-suite map (same keys, same ms) (CI-A S2)
test('map-merge of two part maps equals one whole-suite map (same keys, same ms)', () => {
	const { repo, sha } = fixture();
	// Each part holds its own times: the merge must keep every key's ms as its part recorded it.
	// a sits in both parts with one entry: the merge must keep it once.
	const shared = { lines: { 'scripts/x.mjs': [1, 2] }, reads: [], ms: 12 };
	const partA = { [`${FILE}::a`]: shared, [`${FILE}::c`]: { lines: { 'scripts/x.mjs': [3] }, reads: ['scripts/y.mjs'], ms: 7 } };
	const partB = { [`${FILE}::a`]: shared, [`${FILE}::b`]: { lines: { 'scripts/x.mjs': [4, 5] }, reads: [], ms: 40 }, [`${FILE}::d`]: { lines: {}, reads: [], ms: 0 } };
	fs.writeFileSync(partPath(repo, '.map-part-0.json'), JSON.stringify({ sha, made: 'x', tests: partA }));
	fs.writeFileSync(partPath(repo, '.map-part-1.json'), JSON.stringify({ sha, made: 'x', tests: partB }));
	const r = node(repo, MERGE, ['tests/.map-part-0.json', 'tests/.map-part-1.json']);
	assert.equal(r.status, 0, r.stdout + r.stderr);
	const text = fs.readFileSync(partPath(repo, '.map.json'), 'utf8');
	const merged = JSON.parse(text);
	assert.equal(merged.sha, sha);
	assert.deepEqual(merged.tests, { ...partA, ...partB });
	// JSON.parse would hide a repeated key, so the key is counted in the file's text.
	assert.equal(text.split(`"${FILE}::a"`).length - 1, 1);
});

// why: catches two slices given --shards and a map with ms get the same time plan, longest first (CI-A S3)
test('two slices given --shards and a map with ms get the same time plan, longest first', () => {
	const { repo, log, sha } = fixture();
	const file = path.join(repo, FILE);
	// ms a 11, b 100, c 5, d 90: longest first puts b and c on one shard, a and d on the other. Round robin by name
	// would put a and c together, so the split shows which packing ran. No two shard totals tie at any step.
	const ms = { a: 11, b: 100, c: 5, d: 90 };
	const mapOf = (s) => ({ sha: s, made: 'x', tests: Object.fromEntries(Object.entries(ms).map(([n, t]) => [`${FILE}::${n}`, { lines: {}, reads: [], ms: t }])) });
	const mapPath = partPath(repo, '.map.json');
	fs.writeFileSync(mapPath, JSON.stringify(mapOf(sha)));
	const r0 = node(repo, RUNNER, ['--slice', '0/2', '--shards', '1', '--plan', sha, file]);
	assert.equal(r0.status, 0, r0.stdout + r0.stderr);
	const r1 = node(repo, RUNNER, ['--slice', '1/2', '--shards', '1', '--plan', sha, file]);
	assert.equal(r1.status, 0, r1.stdout + r1.stderr);
	assert.deepEqual(ranIn(log, '0/2'), ['b', 'c']);
	assert.deepEqual(ranIn(log, '1/2'), ['a', 'd']);
	// The refusal half of the ruling: with --plan, a map of another sha, then no map at all, each exits 2 and runs no test.
	fs.rmSync(log, { force: true });
	fs.writeFileSync(mapPath, JSON.stringify(mapOf('1'.repeat(40))));
	const other = node(repo, RUNNER, ['--slice', '0/2', '--shards', '1', '--plan', sha, file]);
	assert.equal(other.status, 2, other.stdout + other.stderr);
	assert.deepEqual(ranIn(log, '0/2'), []);
	fs.rmSync(log, { force: true });
	fs.rmSync(mapPath);
	const gone = node(repo, RUNNER, ['--slice', '0/2', '--shards', '1', '--plan', sha, file]);
	assert.equal(gone.status, 2, gone.stdout + gone.stderr);
	assert.deepEqual(ranIn(log, '0/2'), []);
});

// why: catches map-merge refuses parts from different shas with exit 1 (CI-A S4)
test('map-merge refuses parts from different shas with exit 1', () => {
	const { repo, sha } = fixture();
	const out = partPath(repo, '.map.json');
	const parts = ['tests/.map-part-0.json', 'tests/.map-part-1.json'];
	writePart(repo, '.map-part-0.json', sha, ['a', 'c']);
	writePart(repo, '.map-part-1.json', sha, ['b', 'd']);
	// Control: parts on one sha merge, so a merge that always refuses cannot pass the refusal below.
	const same = node(repo, MERGE, parts);
	assert.equal(same.status, 0, same.stdout + same.stderr);
	assert.ok(fs.existsSync(out), 'the same-sha merge wrote no tests/.map.json');
	fs.rmSync(out);
	writePart(repo, '.map-part-1.json', '1'.repeat(40), ['b', 'd']);
	const mixed = node(repo, MERGE, parts);
	assert.equal(mixed.status, 1, mixed.stdout + mixed.stderr);
	assert.equal(fs.existsSync(out), false, 'mixed shas wrote tests/.map.json');
});
