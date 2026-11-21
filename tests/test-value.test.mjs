// T15 Part B (the owner, 2026-11-10): every test is sorted by what it guards or catches, so the cut list the owner
// reads rests on measurement, not on a guess.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { sortTests } from '../scripts/test-value.mjs';

kitTemp.sessionRoot();

// why: guards rule:test-value
// planted: {"file":"scripts/test-value.mjs","was":"for (const t of f.tests || []) reached.set(t, (reached.get(t) || 0) + 1);","to":"for (const t of f.tests && []) reached.set(t, (reached.get(t) || 0) + 1);"}
test('each test lands in one group: guards, unique, machine, repeat, text, windows or nothing', () => {
	const root = kitTemp.makeTemp('value-');
	fs.mkdirSync(path.join(root, 'tests'));
	fs.writeFileSync(path.join(root, 'tests', 'a.test.mjs'), [
		"test('one', () => {});",
		"test('two', () => {});",
		'// why: guards rule:outward-acts',
		"test('three', () => {});",
		"test('four', () => { assert.match(x, /a b c d e f g h/); // pin: 1",
		'});',
		"test('five', { windows: true }, () => {});",
		"test('six', () => {});",
		"test('seven', () => {});",
		'',
	].join('\n'));
	fs.writeFileSync(path.join(root, 'tests', 'guards-hold.test.mjs'), "test('held', () => {});\n");
	const k = (n) => `tests/a.test.mjs::${n}`;
	const map = { tests: Object.fromEntries([...['one', 'two', 'three', 'four', 'five', 'six', 'seven'].map((n) => [k(n), { lines: {}, reads: n === 'six' ? ['rules/core.md'] : [] }]), ['tests/guards-hold.test.mjs::held', { lines: {}, reads: [] }]]) };
	const flips = [
		{ file: 's.cjs', line: 1, tests: [k('one'), k('two')], caughtBy: [k('one')] },
		{ file: 's.cjs', line: 2, tests: [k('one'), k('two')], caughtBy: [k('one'), k('two')] },
		{ file: 's.cjs', line: 3, tests: [k('seven'), k('three'), 'tests/guards-hold.test.mjs::held'], caughtBy: [] },
	];
	const { rows, counts } = sortTests(root, map, flips);
	const group = (key) => rows.find((r) => r.key === key).group;
	assert.equal(group(k('one')), 'unique');
	assert.equal(group(k('two')), 'repeat');
	assert.equal(group(k('three')), 'guards', 'a why: guards tag');
	assert.equal(group('tests/guards-hold.test.mjs::held'), 'guards', 'a security test file');
	assert.equal(group(k('four')), 'machine');
	assert.equal(group(k('five')), 'windows');
	assert.equal(group(k('six')), 'text');
	assert.equal(group(k('seven')), 'nothing');
	assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), rows.length);
	// K189 (the K160 slips): how many flips reached each test is counted, not only whether one did.
	assert.equal(rows.find((r) => r.key === k('one')).reached, 2);
	assert.equal(rows.find((r) => r.key === k('three')).reached, 1);
});

// K189 (the K160 slips): the command line reads --out wherever it sits, writes the sort there, and prints the flips,
// the caught count and each group's count.
// why: guards rule:test-value
// planted: {"file":"scripts/test-value.mjs","was":"const files = outAt < 0 ? argv : argv.filter((a, i) => i !== outAt && i !== outAt + 1);","to":"const files = outAt < 0 ? argv : argv.filter((a, i) => i === outAt && i !== outAt + 1);"}
// planted: {"file":"scripts/test-value.mjs","was":"const flips = runs.flatMap((r) => r.flips || []);","to":"const flips = runs.flatMap((r) => r.flips && []);"}
// planted: {"file":"scripts/test-value.mjs","was":"const caught = flips.filter((f) => (f.caughtBy || []).length || f.caught).length;","to":"const caught = flips.filter((f) => (f.caughtBy && []).length || f.caught).length;"}
// planted: {"file":"scripts/test-value.mjs","was":"for (const g of ['guards', 'unique', 'machine', 'repeat', 'text', 'windows', 'nothing']) process.stdout.write(`    ${g}: ${counts[g] || 0}\\n`);","to":"for (const g of ['guards', 'unique', 'machine', 'repeat', 'text', 'windows', 'nothing']) process.stdout.write(`    ${g}: ${counts[g] && 0}\\n`);"}
test('the test sort writes --out and prints its counts', () => {
	const dir = kitTemp.makeTemp('value-');
	fs.mkdirSync(path.join(dir, 'tests'));
	fs.writeFileSync(path.join(dir, 'tests', 'a.test.mjs'), "test('one', () => {});\ntest('two', () => {});\n");
	const k = (n) => `tests/a.test.mjs::${n}`;
	fs.writeFileSync(path.join(dir, 'map.json'), JSON.stringify({ sha: 'x', tests: { [k('one')]: { lines: {}, reads: [] }, [k('two')]: { lines: {}, reads: [] } } }));
	fs.writeFileSync(path.join(dir, 'flips.json'), JSON.stringify({ sha: 'x', flips: [{ file: 's.cjs', line: 1, tests: [k('one'), k('two')], caughtBy: [k('one')] }, { file: 's.cjs', line: 2, tests: [k('two')], caughtBy: [] }] }));
	const out = path.join(dir, 'value.json');
	const r = spawnSync(process.execPath, [path.resolve('scripts/test-value.mjs'), 'map.json', '--out', out, 'flips.json'], { cwd: dir, encoding: 'utf8' });
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.match(r.stdout, /Test value: 2 tests, 2 flips, 1 caught/);
	assert.match(r.stdout, /unique: 1\n/);
	assert.match(r.stdout, /nothing: 1\n/);
	assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).flips, 2);
});

// why: catches a false cut list (K41, the plan check's P6): a measure scoped to a change flips a few lines, so every
// test that does not reach them would land in "nothing". The sort refuses flips from a scoped run.
test('the test sort refuses the flips of a scoped measure', async () => {
	const { main } = await import('../scripts/test-value.mjs');
	const dir = kitTemp.makeTemp('value-');
	fs.writeFileSync(path.join(dir, 'map.json'), JSON.stringify({ sha: 'x', tests: { 'tests/a.test.mjs::one': { lines: {}, reads: [] } } }));
	fs.writeFileSync(path.join(dir, 'whole.json'), JSON.stringify({ sha: 'x', flips: [] }));
	fs.writeFileSync(path.join(dir, 'scoped.json'), JSON.stringify({ sha: 'x', base: 'origin/main', flips: [] }));
	assert.equal(main([path.join(dir, 'map.json'), path.join(dir, 'whole.json')]), 0);
	assert.equal(main([path.join(dir, 'map.json'), path.join(dir, 'whole.json'), path.join(dir, 'scoped.json')]), 2);
});

// The build 14 audit: 69 merge-gate refusals made in a loop sorted as repeats, because the sort looked each test up by
// its run-time name and never read the guards tag above its loop.
// why: guards rule:test-value
// planted: {"file":"scripts/test-value.mjs","was":"const body = own.get(name) ?? [...own].find(([n]) => n.includes('${') && new RegExp(`^${n.split(/\\$\\{[^}]*\\}/).map((p) => p.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')).join('.*?')}$`).test(name))?.[1] ?? '';","to":"const body = own.get(name) ?? [...own].find(([n]) => n.includes('${') || new RegExp(`^${n.split(/\\$\\{[^}]*\\}/).map((p) => p.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')).join('.*?')}$`).test(name))?.[1] ?? '';"}
test('a test made in a loop takes the tags above its loop', () => {
	const root = kitTemp.makeTemp('value-');
	fs.mkdirSync(path.join(root, 'tests'));
	fs.writeFileSync(path.join(root, 'tests', 'a.test.mjs'), [
		"test('plain', () => {});",
		'// why: guards rule:standing-grants',
		"for (const n of ['x', 'y']) {",
		'\ttest(`gate: ${n} is refused`, () => {});',
		'}',
		"for (const n of ['p']) {",
		'\ttest(`open: ${n}`, () => {});',
		'}',
		'',
	].join('\n'));
	const k = (n) => `tests/a.test.mjs::${n}`;
	const map = { tests: Object.fromEntries(['plain', 'gate: x is refused', 'gate: y is refused', 'open: p'].map((n) => [k(n), { lines: {}, reads: [] }])) };
	const flips = [{ file: 's.cjs', line: 1, tests: Object.keys(map.tests), caughtBy: Object.keys(map.tests) }];
	const { rows } = sortTests(root, map, flips);
	const group = (key) => rows.find((r) => r.key === key).group;
	assert.equal(group(k('gate: x is refused')), 'guards');
	assert.equal(group(k('gate: y is refused')), 'guards');
	assert.equal(group(k('plain')), 'repeat');
	// K189: a loop's test takes its own loop's tags, not the first loop's in the file.
	assert.equal(group(k('open: p')), 'repeat');
});
