// U21 (T-B3): the value check after green. One test per spec line V1-V6. Each test reads or runs the code it pins and
// fails on an assertion while the feature is absent. Fixtures are tiny: a mutation run takes seconds.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();

const TEST_CHECK = path.resolve('scripts/test-check.mjs');
const MUT = path.resolve('scripts/mutation-check.mjs');
const KIT_VALUE = path.resolve('user/kit-tools/test-value.mjs');
const SKILL = path.resolve('user/skills/agent-team-build/SKILL.md');

// why: V1: test-check's A2 lets a doc claim, a named pin or a guard proof pass without a caught flip, and nothing else
test('A2 exempts a doc claim, a named pin and a guard proof by their why line', () => {
	const src = fs.readFileSync(TEST_CHECK, 'utf8');
	assert.match(src, /\/\/ why: doc claim:/, 'A2 names the doc claim shape');
	assert.match(src, /\/\/ why: pin:/, 'A2 names the pin shape');
	assert.match(src, /\/\/ why: guard proof:/, 'A2 names the guard proof shape');
});

// why: V2: the mutation check reports unused tests, a smallest covering set, seconds and dollars per test, and a
// complexity list, with the --value flag that switches them on
test('mutation-check --value reports covering set, seconds, dollars and approx complexity', () => {
	const src = fs.readFileSync(MUT, 'utf8');
	assert.match(src, /--value/, 'the flag is parsed');
	assert.match(src, /ciRatePerMinute/, 'dollars come from the configured CI rate');
	assert.match(src, /not priced/, 'dollars print "not priced" when no rate is set');
	assert.match(src, /approx/, 'complexity is labelled approximate');
	assert.match(src, /covering set/, 'the smallest covering set is reported');
});

// why: V3: the --value report only reports, so it exits 0 whatever it finds (report-only in 1.51.0)
test('mutation-check --value exits 0 whatever it finds', () => {
	const src = fs.readFileSync(MUT, 'utf8');
	assert.match(src, /o\.value[\s\S]{0,400}return 0/, 'the value branch returns 0 after reporting');
});

// why: V4: the project test-value step runs the adapter's mutation tool when one is named and prints its report
test('user/kit-tools/test-value.mjs runs the named mutation tool and prints its report', () => {
	assert.ok(fs.existsSync(KIT_VALUE), 'the project step exists');
	const src = fs.readFileSync(KIT_VALUE, 'utf8');
	assert.match(src, /mutation/i, 'the step reads the mutation tool the adapter names');
	assert.match(src, /console\.log|process\.stdout\.write/, 'the step prints the report');
});

// why: V5: with no mutation tool named, the project step prints "not measured" and exits 0
test('user/kit-tools/test-value.mjs prints "not measured" and exits 0 with no tool named', () => {
	assert.ok(fs.existsSync(KIT_VALUE), 'the project step exists');
	const dir = kitTemp.makeTemp('value-gate-');
	const r = spawnSync(process.execPath, [KIT_VALUE], { cwd: dir, encoding: 'utf8' });
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.match(r.stdout, /not measured/);
});

// why: V6: the agent-team-build skill tells the lead to fold or drop a new test that catches nothing before merge
test('agent-team-build SKILL.md says the lead folds or drops a test that catches nothing before merge', () => {
	const src = fs.readFileSync(SKILL, 'utf8');
	assert.match(src, /catches nothing/, 'the skill names a test that catches nothing');
	assert.match(src, /fold or drop|fold or drops|folds or drops/, 'the lead folds or drops it');
	assert.match(src, /before the unit merges|before merge/, 'this happens before the unit merges');
});
