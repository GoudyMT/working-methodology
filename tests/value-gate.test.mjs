// U21 (T-B3): the value check after green. One test per spec line V1-V6. V1 to V4 run the real scripts on tiny git
// fixtures (a base commit, a branch commit, a hand-written map), so each fails on an assertion while the feature is
// absent. V5 and V6 check the project step and the skill text. Each run takes seconds.
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

const write = (dir, rel, text) => {
	fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
	fs.writeFileSync(path.join(dir, rel), text);
};
const git = (root, ...a) => spawnSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' });
const lineOf = (text, needle) => text.split('\n').findIndex((l) => l.includes(needle)) + 1;
// The "Tests that catch nothing:" section of --value: its heading, then the indented test lines until the next unindented line.
const catchNothingSection = (text) => {
	const lines = text.split('\n');
	const at = lines.findIndex((l) => l.startsWith('Tests that catch nothing:'));
	assert.ok(at >= 0, 'the --value output has a "Tests that catch nothing:" section');
	const body = [];
	for (const l of lines.slice(at + 1)) { if (!/^ {4}\S/.test(l)) break; body.push(l); }
	return body.join('\n');
};

// A repo with a base commit, then a branch commit that adds the files, and (optionally) a coverage map at the head.
function repo({ base, branch, map = null }) {
	const root = kitTemp.makeTemp('value-gate-');
	git(root, 'init', '-q', '-b', 'main');
	for (const [rel, text] of Object.entries(base)) write(root, rel, text);
	git(root, 'add', '-A');
	git(root, 'commit', '-qm', 'base');
	const baseSha = git(root, 'rev-parse', 'HEAD').stdout.trim();
	git(root, 'switch', '-qc', 'feat/x');
	for (const [rel, text] of Object.entries(branch)) write(root, rel, text);
	git(root, 'add', '-A');
	git(root, 'commit', '-qm', 'change');
	const head = git(root, 'rev-parse', 'HEAD').stdout.trim();
	if (map) write(root, 'tests/.map.json', JSON.stringify({ sha: head, ...map(head) }));
	return { root, baseSha };
}

// The value fixture: small() is caught by its test; big() has 10 branches (approx complexity 11) and its test only calls it.
const CALC_BRANCH = [
	'export function small(x) {', '\treturn x === 1;', '}',
	'export function big(x) {',
	...Array.from({ length: 10 }, (_, i) => `\tif (x === ${i + 2}) return ${i + 2};`),
	'\treturn 0;', '}', '',
].join('\n');
const CALC_TESTS = [
	"import { test } from 'node:test';",
	"import assert from 'node:assert/strict';",
	"import { small, big } from '../src/calc.mjs';",
	"test('small is checked', () => { assert.equal(small(1), true); assert.equal(small(0), false); });",
	"test('big is only called', () => { big(3); });",
	'',
].join('\n');
const valueRepo = () => repo({
	base: { 'src/calc.mjs': '// base\n', 'tests/calc.test.mjs': '// base\n' },
	branch: { 'src/calc.mjs': CALC_BRANCH, 'tests/calc.test.mjs': CALC_TESTS },
	map: () => ({ tests: {
		'tests/calc.test.mjs::small is checked': { lines: { 'src/calc.mjs': [lineOf(CALC_BRANCH, 'return x === 1;')] } },
		'tests/calc.test.mjs::big is only called': { lines: { 'src/calc.mjs': [lineOf(CALC_BRANCH, 'if (x === 2)')] } },
	} }),
});

// why: catches A2 exempting a doc claim, a pin or a guard proof, or not measuring a bare why line (V1).
test('A2 exempts a doc claim, a named pin and a guard proof by their why line', () => {
	const key = (n) => `tests/exempt.test.mjs::${n}`;
	const { root, baseSha } = repo({
		// test-check copies the harness into its scratch repo, so the fixture carries the kit's own copy.
		base: { 'src/calc.mjs': '// base\n', 'tests/harness.mjs': fs.readFileSync(path.resolve('tests/harness.mjs'), 'utf8') },
		branch: {
			'src/calc.mjs': 'export function f(x) {\n\treturn x === 1;\n}\n',
			'tests/exempt.test.mjs': [
				"import { test } from 'node:test';",
				'// why: doc claim: the README names the rule this test reads',
				"test('doc claim', () => {});",
				'// why: pin: the owner words the stop must keep',
				"test('pin', () => {});",
				'// why: guard proof: the hook refuses a push with no yes',
				"test('guard proof', () => {});",
				'// why: x',
				"test('control', () => {});",
				'',
			].join('\n'),
		},
	});
	const r = spawnSync(process.execPath, [TEST_CHECK, baseSha], { cwd: root, encoding: 'utf8' });
	const out = r.stdout + r.stderr;
	const a2 = (name) => out.split('\n').filter((l) => / A2 /.test(l) && l.includes(`${key(name)}:`));
	assert.deepEqual(a2('doc claim'), [], 'a doc claim gets no A2 note');
	assert.deepEqual(a2('pin'), [], 'a named pin gets no A2 note');
	assert.deepEqual(a2('guard proof'), [], 'a guard proof gets no A2 note');
	// Control: a bare why line is not exempt, so A2 measures it and names it as catching no flip.
	assert.equal(a2('control').length, 1, 'the control test gets one A2 note');
	assert.match(a2('control')[0] ?? '', /catches no flip/);
});

// why: catches --value omitting a test that catches nothing, its covering set, seconds, dollars or an over-10 function listed first (V2).
test('mutation-check --value reports covering set, seconds, dollars and approx complexity', () => {
	const { root } = valueRepo();
	const run = () => spawnSync(process.execPath, [MUT, '--value'], { cwd: root, encoding: 'utf8' });
	const first = run();
	const out = first.stdout + first.stderr;
	const nothing = catchNothingSection(first.stdout);
	assert.match(nothing, /big is only called/, 'the never-catching test is listed in its section');
	assert.doesNotMatch(nothing, /small is checked/, 'the test that catches a flip is not in the never-catching section');
	assert.match(out, /Covering set \(greedy[^)]*\): 1 test\(s\) catch all 1 caught flip\(s\): tests\/calc\.test\.mjs::small is checked/, 'the covering set is the test that catches the flip');
	assert.match(out, /small is checked.*\d(\.\d+)?\s?s\b/, 'each test has its seconds');
	assert.match(out, /not priced/, 'no CI rate set: dollars print "not priced"');
	// Control: the configured rate turns the seconds into a dollar figure.
	write(root, 'kit.config.json', JSON.stringify({ ciRatePerMinute: 0.5 }));
	const priced = run();
	assert.match(priced.stdout, /\$\d/, 'with a CI rate set, dollars print');
	assert.doesNotMatch(priced.stdout, /not priced/);
	// The big function (1 + 10 branches = 11, approx) is listed before small (1).
	const lineWith = (text, re) => text.split('\n').findIndex((l) => re.test(l));
	const bigAt = lineWith(priced.stdout, /\bbig\b.*\b11\b/);
	const smallAt = lineWith(priced.stdout, /\bsmall\b.*\b1\b/);
	assert.ok(bigAt >= 0, 'big is reported with approx complexity 11');
	assert.ok(smallAt >= 0 && bigAt < smallAt, 'the over-10 function is listed first');
});

// why: catches --value exiting non-zero on a survivor, or not naming it by file and line (V3).
test('mutation-check --value exits 0 and names a survivor', () => {
	const { root } = valueRepo();
	const r = spawnSync(process.execPath, [MUT, '--value'], { cwd: root, encoding: 'utf8' });
	assert.equal(r.status, 0, r.stdout + r.stderr);
	// Tied to the named survivor: the SURVIVED line for big's first branch, not a caught line (which also names a file and line).
	assert.match(r.stdout + r.stderr, new RegExp(`SURVIVED src/calc\\.mjs:${lineOf(CALC_BRANCH, 'if (x === 2)')} `), 'the survivor is named by its file and line');
});

// why: catches the project test-value step not running the mutationCommand from kit.config.json or not printing its stdout; also the step printing not measured and exiting 0 with no tool named (V4, V5).
test('user/kit-tools/test-value.mjs runs the named mutation tool and prints its report', () => {
	assert.ok(fs.existsSync(KIT_VALUE), 'the project step exists');
	const dir = kitTemp.makeTemp('value-gate-');
	const SENTINEL = 'SENTINEL-V4-7319';
	write(dir, 'stub.mjs', `console.log('${SENTINEL}');\n`);
	write(dir, 'kit.config.json', JSON.stringify({ mutationCommand: 'node stub.mjs' }));
	const r = spawnSync(process.execPath, [KIT_VALUE], { cwd: dir, encoding: 'utf8' });
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.match(r.stdout, new RegExp(SENTINEL), 'the stub output is printed');
	// Control (folded from V5): with no tool named, the step prints "not measured" and exits 0.
	const bare = kitTemp.makeTemp('value-gate-');
	const none = spawnSync(process.execPath, [KIT_VALUE], { cwd: bare, encoding: 'utf8' });
	assert.equal(none.status, 0, none.stdout + none.stderr);
	assert.match(none.stdout, /not measured/);
	// Report only: a mutation tool that exits 3 leaves the step at exit 0, and the step says so.
	const failing = kitTemp.makeTemp('value-gate-');
	write(failing, 'fail.mjs', 'process.exit(3);\n');
	write(failing, 'kit.config.json', JSON.stringify({ mutationCommand: 'node fail.mjs' }));
	const failed = spawnSync(process.execPath, [KIT_VALUE], { cwd: failing, encoding: 'utf8' });
	assert.equal(failed.status, 0, `a failing tool is report only: ${failed.stdout}${failed.stderr}`);
	assert.match(failed.stdout, /exit 3; report only/);
	// The config that cannot be read is named as such, and the step still exits 0 as not measured.
	const broken = kitTemp.makeTemp('value-gate-');
	write(broken, 'kit.config.json', '{ not json');
	const unreadable = spawnSync(process.execPath, [KIT_VALUE], { cwd: broken, encoding: 'utf8' });
	assert.equal(unreadable.status, 0, unreadable.stdout + unreadable.stderr);
	assert.match(unreadable.stdout, /not measured \(kit\.config\.json cannot be read\)/);
});

// why: guards rule:agent-team-adapter (the build skill tells the lead to fold or drop a test that catches nothing)
test('agent-team-build SKILL.md says the lead folds or drops a test that catches nothing before merge', () => {
	const src = fs.readFileSync(SKILL, 'utf8');
	// Anchored: the four claims must sit on the lead's Integrate step in "The flow", not anywhere in the file.
	const flow = src.slice(src.indexOf('## The flow'), src.indexOf('## The overwatch lead'));
	const step = flow.split('\n').find((l) => /^5\. \*\*Integrate \(lead\)\./.test(l));
	assert.ok(step, 'The flow has the Integrate (lead) step as its item 5');
	assert.match(step, /catches nothing/, 'the step names a test that catches nothing');
	assert.match(step, /\bfolds?\b/, 'the lead folds it');
	assert.match(step, /\bdrops?\b/, 'the lead drops it');
	assert.match(step, /before the unit merges/, 'this happens before the unit merges');
});
