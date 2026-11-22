// U20 (T-B2): the count gate at red and at review. One test per spec line C1-C10; controls are assertions inside.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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
const OTHER_FILE = 'tests/b.test.mjs';
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
// The imports every test file needs, and one passing, one failing test() and it() line each.
const HEADER = "import { test, it } from 'node:test';\nimport assert from 'node:assert/strict';";
const passing = (name) => `test('${name}', () => {});`;
const failing = (name) => `test('${name}', () => assert.fail('red'));`;
const itFailing = (name) => `it('${name}', () => assert.fail('red'));`;
// n test lines in a Tests cell, separated by <br> as the template asks.
const lines = (n) => Array.from({ length: n }, (_, i) => `check ${i + 1} -> S1`).join('<br>');
// A Units row for U1 that names the test file, with a Tests cell of n lines (or the given cell text).
const row = (n, cell = lines(n), files = `\`${TEST_FILE}\``) => ({ Id: 'U1', Files: files, Runs: 'alone', Risk: 'low', Category: 'logic', [TESTS]: cell, Tester: '' });
const planText = (rows) => ['# Batch plan - x', '', '## Units', '', `| ${HEAD.join(' | ')} |`, `|${HEAD.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${HEAD.map((h) => r[h] ?? '').join(' | ')} |`), '', '## Collision list', ''].join('\n');
const writePlan = (dir, rows) => {
	const file = path.join(dir, 'plan.md');
	fs.writeFileSync(file, planText(rows));
	return file;
};
// The lock an unchanged row needs (as C11 writes it): the sha256 of the U1 row line, in the locks file beside the plan.
const lockPlan = (file) => {
	const rowLine = fs.readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith('| U1 |'));
	fs.writeFileSync(`${file}.locks.json`, JSON.stringify({ U1: crypto.createHash('sha256').update(rowLine).digest('hex') }));
	return file;
};
// A plan whose U1 row is locked, so the count gate reads its count rather than refusing it as unlocked.
const lockedPlan = (dir, rows) => lockPlan(writePlan(dir, rows));
// A temp git repo: a base commit (with an optional countCommand config), then one red commit that adds the test file.
// other (optional) is a second test file: its base and red text, written beside the first.
const fixture = ({ red, base: baseFile = null, config = null, other = null }) => {
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
	fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
	if (baseFile !== null) fs.writeFileSync(path.join(dir, TEST_FILE), baseFile);
	if (other !== null) fs.writeFileSync(path.join(dir, OTHER_FILE), other.base);
	git(['add', '-A']);
	git(['commit', '-q', '-m', 'chore: base']);
	const base = git(['rev-parse', 'HEAD']).stdout.trim();
	fs.writeFileSync(path.join(dir, TEST_FILE), red);
	if (other !== null) fs.writeFileSync(path.join(dir, OTHER_FILE), other.red);
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

// why: catches a count that misses it() calls or the second file a row names, so a unit is refused for a count it meets (C1).
test('C1 spec C1: unit-check counts the test() and it() calls the red commit adds, per file the locked row names', () => {
	// Each base file holds one test; the red commit adds one test() and one it() to a.test.mjs and one test() to b.test.mjs, so 3 in all.
	const fx = fixture({
		base: `${HEADER}\n${passing('t0')}\n`,
		red: `${HEADER}\n${passing('t0')}\n${failing('t1')}\n${itFailing('i1')}\n`,
		other: { base: `${HEADER}\n${passing('u0')}\n`, red: `${HEADER}\n${passing('u0')}\n${failing('u1')}\n` },
	});
	const both = `\`${TEST_FILE}\`, \`${OTHER_FILE}\``;
	const res = runUnit(fx, lockedPlan(fx.dir, [row(3, lines(3), both)]));
	assert.equal(res.status, 0, out(res));
	// Control: a plan of 2 is refused, which is what a count of the first file alone would show, so the second file must be counted.
	const firstOnly = runUnit(fx, lockedPlan(fx.dir, [row(2, lines(2), both)]));
	assert.equal(firstOnly.status, 1, out(firstOnly));
});

// why: catches a project count command being ignored, so the kit's own counter decides a project's test count (C2).
test('C2 spec C2: a countCommand in kit.config.json runs with the test file appended and replaces the kit counter', () => {
	const script = "console.log(process.argv.at(-1).endsWith('a.test.mjs') ? 7 : 0);\n";
	const fx = fixture({ red: redFile(2, 0), config: { command: 'node fake-count.mjs', script } });
	const res = runUnit(fx, lockedPlan(fx.dir, [row(2)]));
	assert.equal(res.status, 1, out(res));
	assert.match(out(res), /\b7\b/);
	// The no-countCommand case (the kit counter's 2 matches the plan's 2) is C3, C4's matching control, the same fixture and call.
});

// why: catches a red commit with a count off its locked row passing, so a unit ships short; or a matching count refused, which blocks a correct red commit (C3, C4).
test('C3, C4 spec C3, C4: a count that differs fails on one line naming the file and both counts, and a matching count passes with exit 0', () => {
	const fx = fixture({ red: redFile(2, 0) });
	const res = runUnit(fx, lockedPlan(fx.dir, [row(3)]));
	assert.equal(res.status, 1, out(res));
	const line = out(res).split('\n').find((l) => /a\.test\.mjs/.test(l));
	assert.ok(line, out(res));
	assert.match(line, /\b3\b/);
	assert.match(line, /\b2\b/);
	// Control: the same red commit against its planned count of 2 passes with exit 0.
	const same = runUnit(fx, lockedPlan(fx.dir, [row(2)]));
	assert.equal(same.status, 0, out(same));
});

// why: catches handoff refusing swap or redundant as a status, so a reviewer cannot write the two new verdicts (C5).
test('C5 spec C5: handoff accepts the test-reviewer statuses swap and redundant, and refuses a made-up one', async () => {
	const red = await handoffCheck(reviewText({ status: 'redundant' }));
	assert.equal(red.ok, true, red.errors.join('; '));
	const swap = await handoffCheck(reviewText({ status: 'swap', replacement: { test: 'new test', keeps: ['assert.equal(x, 1)'] } }));
	assert.equal(swap.ok, true, swap.errors.join('; '));
	// Control: a made-up status is still refused.
	const bogus = await handoffCheck(reviewText({ status: 'made-up' }));
	assert.equal(bogus.ok, false);
});

// why: catches an add finding with no break named passing, so a test is added with no reason it catches anything (C6).
test('C6 spec C6: an add finding with no breaks named is refused, and one that names its break passes', async () => {
	const bare = await handoffCheck(reviewText({ status: 'add' }));
	assert.equal(bare.ok, false);
	const emptyBreaks = await handoffCheck(reviewText({ status: 'add', breaks: '' }));
	assert.equal(emptyBreaks.ok, false);
	const named = await handoffCheck(reviewText({ status: 'add', breaks: 'a parser that drops a line' }));
	assert.equal(named.ok, true, named.errors.join('; '));
});

// why: catches a swap that drops an assertion with no replacement passing, so a weaker test replaces a stronger one unnoticed (C7).
test('C7 spec C7: a swap with no replacement or with empty or missing keeps is refused', async () => {
	const noReplacement = await handoffCheck(reviewText({ status: 'swap' }));
	assert.equal(noReplacement.ok, false);
	const emptyKeeps = await handoffCheck(reviewText({ status: 'swap', replacement: { test: 'new test', keeps: [] } }));
	assert.equal(emptyKeeps.ok, false);
	const missingKeeps = await handoffCheck(reviewText({ status: 'swap', replacement: { test: 'new test' } }));
	assert.equal(missingKeeps.ok, false);
	// The passing swap (one that keeps an assertion) is C5's check on the same call, so it is not repeated here.
});

// why: guards rule:agent-role-table (tester.md: one test per plan line, controls fold, tests are a floor)
test('C8 spec C8: tester.md states one test per plan line, controls fold into their partner test, and tests are a floor', () => {
	assert.ok(fs.existsSync(TESTER), 'user/agents/tester.md is missing');
	const text = fs.readFileSync(TESTER, 'utf8');
	assert.match(text, /one test per plan line/i);
	assert.match(text, /\bcontrols?\b[^.]*\bfold/i);
	assert.match(text, /tests? (are|is) a floor/i);
});

// why: guards rule:agent-role-table (test-reviewer.md names swap and redundant, and an add names its break)
test('C9 spec C9: test-reviewer.md names swap and redundant and says an add names its break', () => {
	assert.ok(fs.existsSync(REVIEWER), 'user/agents/test-reviewer.md is missing');
	const text = fs.readFileSync(REVIEWER, 'utf8');
	assert.match(text, /\bswap\b/);
	assert.match(text, /\bredundant\b/);
	assert.match(text, /add[^.]*names? (its|the) break/i);
});

// why: guards rule:agent-team-adapter (builder-brief.md: one test per plan line, a floor, builder never adds or drops)
test('C10 spec C10: builder-brief.md says one test per plan line, tests are a floor, and the builder never adds or drops a test', () => {
	assert.ok(fs.existsSync(BRIEF), 'builder-brief.md is missing');
	const text = fs.readFileSync(BRIEF, 'utf8');
	assert.match(text, /one test per plan line/i);
	assert.match(text, /\bfloor\b/i);
	assert.match(text, /never[^.]*\badd\b[^.]*\bdrop/i);
});

// why: catches unit-check passing an unlocked row as unchanged, so a Tests cell that was never locked is never caught (H4).
test('H4 unit-check: a row with no lock, or a locks file with no key for it, is reported not locked and does not pass', () => {
	const fx = fixture({ red: redFile(2, 0) });
	const plan = writePlan(fx.dir, [row(2)]);
	const unlocked = runUnit(fx, plan);
	assert.match(out(unlocked), /not locked/i);
	assert.notEqual(unlocked.status, 0, out(unlocked));
	// The locks file exists but holds no key for U1: still not locked.
	fs.writeFileSync(`${plan}.locks.json`, JSON.stringify({ U9: 'f'.repeat(64) }));
	const noKey = runUnit(fx, plan);
	assert.match(out(noKey), /not locked/i);
	assert.notEqual(noKey.status, 0, out(noKey));
	// Control: with the row's sha written for U1, as C11 does, the same commit passes.
	const rowLine = fs.readFileSync(plan, 'utf8').split('\n').find((l) => l.startsWith('| U1 |'));
	fs.writeFileSync(`${plan}.locks.json`, JSON.stringify({ U1: crypto.createHash('sha256').update(rowLine).digest('hex') }));
	const locked = runUnit(fx, plan);
	assert.equal(locked.status, 0, out(locked));
});

// why: catches a count that keeps only the first red commit, so a unit whose tests come in two red commits is miscounted (M5).
test('M5 count gate: two red commits, 2 tests in a.test.mjs then 1 test in b.test.mjs, against a 3-line Tests cell pass', () => {
	const fx = fixture({ red: redFile(2, 0) });
	const git = (args) => spawnSync('git', args, { cwd: fx.dir, encoding: 'utf8' });
	fs.writeFileSync(path.join(fx.dir, 'tests', 'b.test.mjs'), redFile(1, 0));
	git(['add', '-A']);
	git(['commit', '-q', '-m', 'test: red count two']);
	const head = git(['rev-parse', 'HEAD']).stdout.trim();
	const base = fx.range.split('..')[0];
	const plan = lockedPlan(fx.dir, [{ ...row(3), Files: '`tests/a.test.mjs`, `tests/b.test.mjs`' }]);
	const res = runUnit({ ...fx, range: `${base}..${head}` }, plan);
	assert.equal(res.status, 0, out(res));
});

// why: catches a count command reading the whole file, so one new test in a file of five counts as six (M5).
test('M5 count gate: with countCommand, one test added to a file that holds five counts as 1', () => {
	const five = `${HEADER}\n${[0, 1, 2, 3, 4].map((i) => passing(`t${i}`)).join('\n')}\n`;
	const script = "import fs from 'node:fs';\nconst text = fs.readFileSync(process.argv.at(-1), 'utf8');\nconsole.log((text.match(/^test\\(/gm) || []).length);\n";
	const fx = fixture({ base: five, red: `${five}${failing('t5')}\n`, config: { command: 'node fake-count.mjs', script } });
	const res = runUnit(fx, lockedPlan(fx.dir, [row(1)]));
	assert.equal(res.status, 0, out(res));
});

// why: catches a test file name reaching a shell as code, so a name with a metacharacter runs a command (M5).
test('M5 count gate: a test file name with shell metacharacters reaches countCommand exactly, as data, and runs nothing', () => {
	const NAME = 'a%KIT_PWN%$(mkdir pwn2).test.mjs';
	const dir = kitTemp.makeTemp('unit-count-');
	const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
	const ARGV_OUT = path.join(dir, 'argv.txt');
	git(['init', '-q', '-b', 'main']);
	git(['config', 'user.email', 'tester@example.com']);
	git(['config', 'user.name', 'tester']);
	fs.writeFileSync(path.join(dir, 'README.md'), 'base\n');
	fs.writeFileSync(path.join(dir, 'kit.config.json'), JSON.stringify({ countCommand: 'node fake-count.mjs' }));
	fs.writeFileSync(path.join(dir, 'fake-count.mjs'), `import fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(ARGV_OUT)}, process.argv.at(-1));\nconsole.log(2);\n`);
	git(['add', '-A']);
	git(['commit', '-q', '-m', 'chore: base']);
	const base = git(['rev-parse', 'HEAD']).stdout.trim();
	fs.mkdirSync(path.join(dir, 'tests'));
	fs.writeFileSync(path.join(dir, 'tests', NAME), redFile(2, 0));
	git(['add', '-A']);
	git(['commit', '-q', '-m', 'test: red count']);
	const head = git(['rev-parse', 'HEAD']).stdout.trim();
	const plan = lockedPlan(dir, [{ ...row(2), Files: `\`tests/${NAME}\`` }]);
	const payloadEnv = { ...process.env, KIT_PWN: `x"&mkdir ${path.join(dir, 'pwned')}&"` };
	const res = spawnSync(process.execPath, [UNIT_CHECK, `${base}..${head}`, '--repo', dir, '--plan', plan, '--unit', 'U1'], { encoding: 'utf8', env: payloadEnv });
	assert.ok(fs.existsSync(ARGV_OUT), 'countCommand ran and wrote the argument it received');
	assert.equal(path.basename(fs.readFileSync(ARGV_OUT, 'utf8')), NAME, 'countCommand received the exact test file name');
	assert.equal(res.status, 0, out(res));
	assert.equal(fs.existsSync(path.join(dir, 'pwned')), false, 'the %KIT_PWN% payload ran a command (cmd.exe expansion)');
	assert.equal(fs.existsSync(path.join(dir, 'pwn2')), false, 'the $(mkdir pwn2) payload ran a command (POSIX sh substitution)');
});

// why: catches a count gate passing a plan edited after its lock, so a unit's locked Tests cell can change unseen (C11).
test('C11 lock: an edited locked row fails with "the locked row changed", and the unedited row passes', () => {
	// The locked row is the unedited one; the lock file holds its sha256, as the lock writes it.
	const fx = fixture({ red: redFile(2, 0) });
	const plan = writePlan(fx.dir, [row(2)]);
	const rowLine = fs.readFileSync(plan, 'utf8').split('\n').find((l) => l.startsWith('| U1 |'));
	fs.writeFileSync(`${plan}.locks.json`, JSON.stringify({ U1: crypto.createHash('sha256').update(rowLine).digest('hex') }));
	// The edited Tests cell keeps the same count of 2, so only the lock can fail it.
	writePlan(fx.dir, [row(2, 'changed one -> S1<br>changed two -> S1')]);
	const edited = runUnit(fx, plan);
	assert.equal(edited.status, 1, out(edited));
	assert.match(out(edited), /the locked row changed/);
	// Control: the unedited row passes against the same lock.
	writePlan(fx.dir, [row(2)]);
	const unedited = runUnit(fx, plan);
	assert.equal(unedited.status, 0, out(unedited));
});
