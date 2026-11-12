// T15 Part B (the owner, 2026-11-10): every test is sorted by what it guards or catches, so the cut list the owner
// reads rests on measurement, not on a guess.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { sortTests } from '../scripts/test-value.mjs';

kitTemp.sessionRoot();

// why: catches a wrong cut list: a security test sorted for cutting, or a test that guards nothing kept.
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
});
