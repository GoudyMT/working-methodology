// U20 (T-B2): the count gate at red and at review. One test per spec line C1-C10; controls are assertions inside.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const UNIT_CHECK = fileURLToPath(new URL('../user/kit-tools/unit-check.mjs', import.meta.url));
const HANDOFF = fileURLToPath(new URL('../user/kit-tools/handoff.mjs', import.meta.url));
const TESTER = fileURLToPath(new URL('../user/agents/tester.md', import.meta.url));
const REVIEWER = fileURLToPath(new URL('../user/agents/test-reviewer.md', import.meta.url));
const BRIEF = fileURLToPath(new URL('../user/skills/agent-team-build/templates/builder-brief.md', import.meta.url));

const TEST_FILE = 'tests/a.test.mjs';
const TESTS = 'Tests to write first, and the failure each must show';
const HEAD = ['Id', 'Files', 'Runs', 'Risk', 'Category', TESTS, 'Tester'];
const out = (res) => res.stdout + res.stderr;

// A red test file: n test() calls and m it() calls, each failing on purpose.
const redFile = (n, m) => [
	"import { test, it } from 'node:test';",
	"import assert from 'node:assert/strict';",
	...Array.from({ length: n }, (_, i) => `test('t${i}', () => assert.fail('red'));`),
	...Array.from({ length: m }, (_, i) => `it('i${i}', () => assert.fail('red'));`),
	'',
].join('\n');
// n test lines in a Tests cell, separated by <br> as the template asks.
const lines = (n) => Array.from({ length: n }, (_, i) => `check ${i + 1} -> S1`).join('<br>');
// A Units row for U1 that names the test file, with a Tests cell of n lines.
const row = (n) => ({ Id: 'U1', Files: `\`${TEST_FILE}\``, Runs: 'alone', Risk: 'low', Category: 'logic', [TESTS]: lines(n), Tester: '' });
const planText = (rows) => ['# Batch plan - x', '', '## Units', '', `| ${HEAD.join(' | ')} |`, `|${HEAD.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${HEAD.map((h) => r[h] ?? '').join(' | ')} |`), '', '## Collision list', ''].join('\n');
const writePlan = (dir, rows) => {
	const file = path.join(dir, 'plan.md');
	fs.writeFileSync(file, planText(rows));
	return file;
};
// A temp git repo: a base commit (with an optional countCommand config), then one red commit that adds the test file.
const fixture = ({ red, config = null }) => {
	const dir = kitTemp.makeTemp('unit-count-');
	const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
	git(['init', '-q', '-b', 'main']);
	git(['config', 'user.email', 'tester@example.com']);
	git(['config', 'user.name', 'tester']);
	fs.writeFileSync(path.join(dir, 'README.md'), 'base\n');
	if (config !== null) {
		fs.writeFileSync(path.join(dir, 'kit.config.json'), JSON.stringify({ countCommand: config.command }));
		fs.writeFileSync(path.join(dir, 'fake-count.mjs'), config.script);
	}
	git(['add', '-A']);
	git(['commit', '-q', '-m', 'chore: base']);
	const base = git(['rev-parse', 'HEAD']).stdout.trim();
	fs.mkdirSync(path.join(dir, 'tests'));
	fs.writeFileSync(path.join(dir, TEST_FILE), red);
	git(['add', '-A']);
	git(['commit', '-q', '-m', 'test: red count']);
	const head = git(['rev-parse', 'HEAD']).stdout.trim();
	return { dir, range: `${base}..${head}` };
};
// Runs unit-check over the fixture's range with the plan. A missing script fails here, with its name.
const runUnit = (fx, plan) => {
	assert.ok(fs.existsSync(UNIT_CHECK), 'user/kit-tools/unit-check.mjs is missing');
	return spawnSync(process.execPath, [UNIT_CHECK, fx.range, '--repo', fx.dir, '--plan', plan, '--unit', 'U1'], { encoding: 'utf8' });
};
// A test-reviewer hand-back holding one finding; the fields given override the defaults.
const reviewText = (finding) => ['Prose the hand-back holds.', 'RECORD:', JSON.stringify({ role: 'test-reviewer', commit: '158ec54' }), JSON.stringify({ id: 'K1', severity: 'low', status: 'open', where: '-', claim: 'c', proof: 'p', fix: '-', ...finding })].join('\n');
const handoffCheck = async (text) => {
	assert.ok(fs.existsSync(HANDOFF), 'user/kit-tools/handoff.mjs is missing');
	const { check } = await import(pathToFileURL(HANDOFF).href);
	return check(text, { role: 'test-reviewer' });
};

// why: C1: a count that misses it() calls, so a unit whose tests use it() is refused for a count it meets.
test('C1 spec C1: unit-check counts the test() and it() calls the red commit adds, per file the locked row names', () => {
	const fx = fixture({ red: redFile(1, 1) });
	const res = runUnit(fx, writePlan(fx.dir, [row(2)]));
	assert.equal(res.status, 0, out(res));
	// Control: the same commit against a plan of one test is refused, so the count was read as something other than one.
	const off = runUnit(fx, writePlan(fx.dir, [row(1)]));
	assert.equal(off.status, 1, out(off));
});

// why: C2: a project count command ignored, so the kit's own counter decides a project's test count.
test('C2 spec C2: a countCommand in kit.config.json runs with the test file appended and replaces the kit counter', () => {
	const script = "console.log(process.argv.at(-1).endsWith('a.test.mjs') ? 7 : 0);\n";
	const fx = fixture({ red: redFile(2, 0), config: { command: 'node fake-count.mjs', script } });
	const res = runUnit(fx, writePlan(fx.dir, [row(2)]));
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /\b7\b/);
	// Control: with no countCommand, the kit counter's 2 matches the plan's 2.
	const bare = fixture({ red: redFile(2, 0) });
	const kit = runUnit(bare, writePlan(bare.dir, [row(2)]));
	assert.equal(kit.status, 0, out(kit));
});

// why: C3: a red commit whose count differs from its locked row passing, so a unit ships with fewer tests than planned.
test('C3 spec C3: a red commit whose count differs from the locked row fails, naming the file and both counts', () => {
	const fx = fixture({ red: redFile(2, 0) });
	const res = runUnit(fx, writePlan(fx.dir, [row(3)]));
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /a\.test\.mjs/);
	assert.match(out(res), /\b3\b/);
	assert.match(out(res), /\b2\b/);
	// Control: the same red commit against its planned count of 2 passes.
	const same = runUnit(fx, writePlan(fx.dir, [row(2)]));
	assert.equal(same.status, 0, out(same));
});

// why: C4: a matching count refused, so a correct red commit is blocked before its review.
test('C4 spec C4: a red commit whose count matches the locked row passes with exit 0', () => {
	const fx = fixture({ red: redFile(2, 0) });
	const res = runUnit(fx, writePlan(fx.dir, [row(2)]));
	assert.equal(res.status, 0, out(res));
	// Control: a count of 1 against this commit's 2 is refused.
	const off = runUnit(fx, writePlan(fx.dir, [row(1)]));
	assert.equal(off.status, 1, out(off));
});

// why: C5: handoff refusing swap or redundant as a status, so a reviewer cannot write the two new verdicts.
test('C5 spec C5: handoff accepts the test-reviewer statuses swap and redundant, and refuses a made-up one', async () => {
	const red = await handoffCheck(reviewText({ status: 'redundant' }));
	assert.equal(red.ok, true, red.errors.join('; '));
	const swap = await handoffCheck(reviewText({ status: 'swap', replacement: { test: 'new test', keeps: ['assert.equal(x, 1)'] } }));
	assert.equal(swap.ok, true, swap.errors.join('; '));
	// Control: a made-up status is still refused.
	const bogus = await handoffCheck(reviewText({ status: 'made-up' }));
	assert.equal(bogus.ok, false);
});

// why: C6: an add finding with no break named passing, so a test is added with no reason it catches anything.
test('C6 spec C6: an add finding with no breaks named is refused, and one that names its break passes', async () => {
	const bare = await handoffCheck(reviewText({ status: 'add' }));
	assert.equal(bare.ok, false);
	const named = await handoffCheck(reviewText({ status: 'add', breaks: 'a parser that drops a line' }));
	assert.equal(named.ok, true, named.errors.join('; '));
});

// why: C7: a swap that drops an assertion with no replacement passing, so a weaker test replaces a stronger one unnoticed.
test('C7 spec C7: a swap with no replacement or with empty or missing keeps is refused, and one that keeps its assertions passes', async () => {
	const noReplacement = await handoffCheck(reviewText({ status: 'swap' }));
	assert.equal(noReplacement.ok, false);
	const emptyKeeps = await handoffCheck(reviewText({ status: 'swap', replacement: { test: 'new test', keeps: [] } }));
	assert.equal(emptyKeeps.ok, false);
	const missingKeeps = await handoffCheck(reviewText({ status: 'swap', replacement: { test: 'new test' } }));
	assert.equal(missingKeeps.ok, false);
	// Control: a swap whose replacement keeps an assertion passes.
	const kept = await handoffCheck(reviewText({ status: 'swap', replacement: { test: 'new test', keeps: ['assert.equal(x, 1)'] } }));
	assert.equal(kept.ok, true, kept.errors.join('; '));
});

// why: doc claim: tester.md says one test per plan line, controls fold into their partner test, and tests are a floor.
test('C8 spec C8: tester.md states one test per plan line, controls fold into their partner test, and tests are a floor', () => {
	assert.ok(fs.existsSync(TESTER), 'user/agents/tester.md is missing');
	const text = fs.readFileSync(TESTER, 'utf8');
	assert.match(text, /one test per plan line/i);
	assert.match(text, /\bcontrols?\b[^.]*\bfold/i);
	assert.match(text, /\bfloor\b/i);
});

// why: doc claim: test-reviewer.md names the statuses swap and redundant and says an add names its break.
test('C9 spec C9: test-reviewer.md names swap and redundant and says an add names its break', () => {
	assert.ok(fs.existsSync(REVIEWER), 'user/agents/test-reviewer.md is missing');
	const text = fs.readFileSync(REVIEWER, 'utf8');
	assert.match(text, /\bswap\b/);
	assert.match(text, /\bredundant\b/);
	assert.match(text, /\badd\b[^.]*\bbreak/i);
});

// why: doc claim: builder-brief.md says one test per plan line, tests are a floor, and the builder never adds or drops a test.
test('C10 spec C10: builder-brief.md says one test per plan line, tests are a floor, and the builder never adds or drops a test', () => {
	assert.ok(fs.existsSync(BRIEF), 'builder-brief.md is missing');
	const text = fs.readFileSync(BRIEF, 'utf8');
	assert.match(text, /one test per plan line/i);
	assert.match(text, /\bfloor\b/i);
	assert.match(text, /never[^.]*\badd\b[^.]*\bdrop/i);
});
