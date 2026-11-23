// A test cannot be saved or handed back without its why (K368, U21): the edit fence refuses a tester's test file whose
// new test( lacks a why line passing test-check's whyFault (Write, Edit and MultiEdit alike, the same verdict each time),
// refuses a file it cannot parse and logs it, and handoff-gate refuses a tester RECORD that does not list each new test
// with its why. Every case runs in a temp git repo with the home and Claude folders pointed at temp dirs.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const FENCE = path.resolve('user/kit-hooks/edit-fence.cjs');
const GIT_ID = { GIT_AUTHOR_NAME: 'Tester', GIT_AUTHOR_EMAIL: 'tester@example.invalid', GIT_COMMITTER_NAME: 'Tester', GIT_COMMITTER_EMAIL: 'tester@example.invalid' };
const NO_WHY = 'no why line: name the real use or failure it guards';
const BAD_SHAPE = 'its why line starts with neither guards nor catches';
const GOOD_WHY = '// why: catches a saved test that names no failure it guards';
const TEST_REL = 'tests/sample.test.mjs';

function isolatedEnv(extra = {}) {
	const home = kitTemp.makeTemp('why-home-');
	const config = path.join(home, '.claude');
	return { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: config, KIT_CLAUDE_HOME: config, ...GIT_ID, ...extra };
}
function git(cwd, args) {
	const r = spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, env: isolatedEnv(), encoding: 'utf8' });
	assert.equal(r.status, 0, 'git ' + args.join(' ') + ' failed: ' + r.stderr);
	return r.stdout.trim();
}
function put(dir, rel, text) {
	const file = path.join(dir, rel);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, text);
}
function commit(dir, message) {
	git(dir, ['add', '-A']);
	git(dir, ['commit', '-q', '--allow-empty', '-m', message]);
	return git(dir, ['rev-parse', 'HEAD']);
}
// A temp repo whose unit list names the sample test file, as the lead writes it for a tester.
function unitRepo(existing) {
	const dir = kitTemp.makeTemp('why-repo-');
	git(dir, ['init', '-q', '-b', 'main']);
	if (existing !== undefined) put(dir, TEST_REL, existing);
	commit(dir, 'chore: start');
	const list = git(dir, ['rev-parse', '--path-format=absolute', '--git-path', 'kit-unit-files.txt']);
	fs.writeFileSync(list, TEST_REL + '\n');
	return dir;
}
function fence(dir, toolName, toolInput) {
	const input = JSON.stringify({ cwd: dir, agent_type: 'tester', tool_name: toolName, tool_input: toolInput });
	const r = spawnSync(process.execPath, [FENCE], { cwd: dir, env: isolatedEnv(), input, encoding: 'utf8' });
	return { code: r.status, err: String(r.stderr), out: String(r.stdout) };
}
const target = (dir) => path.join(dir, TEST_REL);
const testWith = (why, name) => (why ? why + '\n' : '') + "test('" + name + "', () => {});\n";
function guardLog(dir) {
	const common = git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
	const file = path.join(common, 'kit-guard-open.log');
	return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
}

// why: catches a Write to a test file whose new test( has no why line is refused, quoting whyFault's reason (K368 S1)
test("a Write to a test file whose new test( has no why line is refused, quoting whyFault's reason", () => {
	const dir = unitRepo();
	const bad = fence(dir, 'Write', { file_path: target(dir), content: testWith('', 'adds two numbers') });
	assert.equal(bad.code, 2, 'a why-less test is refused: ' + bad.err);
	assert.ok(bad.err.includes(NO_WHY), 'stderr quotes whyFault: ' + bad.err);
	assert.ok(bad.err.includes('adds two numbers') || bad.err.includes(TEST_REL), 'stderr names the test or file: ' + bad.err);
	// control: the same content on a non-test source file is not this guard's to refuse
	fs.appendFileSync(git(dir, ['rev-parse', '--path-format=absolute', '--git-path', 'kit-unit-files.txt']), 'src/add.js\n');
	const src = fence(dir, 'Write', { file_path: path.join(dir, 'src/add.js'), content: testWith('', 'adds two numbers') });
	assert.equal(src.code, 0, 'a non-test file is let through: ' + src.err);
	put(dir, 'src/add.js', 'export const add = (a, b) => a + b;\n');
	const srcEdit = fence(dir, 'Edit', { file_path: path.join(dir, 'src/add.js'), old_string: 'a + b;', new_string: 'a + b;\n' + testWith('', 'adds two numbers') });
	assert.equal(srcEdit.code, 0, 'an Edit on a non-test file is let through: ' + srcEdit.err);
});

// why: catches a why that is a bare spec id ("S1: ...") is refused the same way (K368 S1)
test('a why that is a bare spec id ("S1: ...") is refused the same way', () => {
	const dir = unitRepo();
	const bad = fence(dir, 'Write', { file_path: target(dir), content: testWith('// why: S1: the fence refuses it', 'adds two numbers') });
	assert.equal(bad.code, 2, 'a spec id as the why is refused: ' + bad.err);
	assert.ok(bad.err.includes(BAD_SHAPE), 'stderr quotes whyFault: ' + bad.err);
	const short = fence(dir, 'Write', { file_path: target(dir), content: testWith('// why: catches a short one', 'adds two numbers') });
	assert.equal(short.code, 2, 'a catches why under six words is refused: ' + short.err);
	assert.ok(short.err.includes('too short to name the failure it catches'), 'stderr quotes the too-short reason: ' + short.err);
});

// why: catches a test with a passing why line saves (K368 S1)
test('a test with a passing why line saves', () => {
	const dir = unitRepo();
	const ok = fence(dir, 'Write', { file_path: target(dir), content: testWith(GOOD_WHY, 'adds two numbers') });
	assert.equal(ok.code, 0, 'a passing why saves: ' + ok.err);
	const guards = fence(dir, 'Write', { file_path: target(dir), content: testWith('// why: guards rule:test-value (a test names its failure)', 'adds two numbers') });
	assert.equal(guards.code, 0, 'a guards why saves: ' + guards.err);
	// control: the same file with the why line removed is refused, so the pass above came from the why
	const bad = fence(dir, 'Write', { file_path: target(dir), content: testWith('', 'adds two numbers') });
	assert.equal(bad.code, 2, 'the why-less twin is refused: ' + bad.err);
});

// why: catches a tester RECORD that does not list each new test with its why is refused by handoff-gate (K368 S2)
test('a tester RECORD that does not list each new test with its why is refused by handoff-gate', () => {
	const kit = kitTemp.makeTemp('why-gate-kit-');
	fs.cpSync(path.resolve('user/kit-hooks'), path.join(kit, 'kit-hooks'), { recursive: true });
	fs.mkdirSync(path.join(kit, 'kit-tools'), { recursive: true });
	fs.copyFileSync(path.resolve('user/kit-tools/handoff.mjs'), path.join(kit, 'kit-tools', 'handoff.mjs'));
	fs.writeFileSync(path.join(kit, 'kit-hooks', 'holds.json'), JSON.stringify({ holds: [{ id: 'handoff-gate', hook: 'handoff-gate.cjs', mode: 'enforce' }] }) + '\n');
	const gate = path.join(kit, 'kit-hooks', 'handoff-gate.cjs');
	const dir = kitTemp.makeTemp('why-gate-repo-');
	git(dir, ['init', '-q', '-b', 'main']);
	put(dir, TEST_REL, testWith(GOOD_WHY, 'the old one'));
	commit(dir, 'test: first');
	put(dir, TEST_REL, testWith(GOOD_WHY, 'the old one') + testWith(GOOD_WHY, 'the new one') + testWith(GOOD_WHY, 'the other one'));
	const sha = commit(dir, 'test: add the new ones');
	const finding = { id: 'R1', severity: 'low', status: 'open', where: '-', claim: 'c', proof: 'p', fix: '-' };
	const record = (extra) => ['Prose.', 'RECORD:', JSON.stringify({ role: 'tester', commit: sha, clarity: 'clear', ...extra }), JSON.stringify(finding)].join('\n');
	const send = (message) => {
		const r = spawnSync(process.execPath, [gate], { encoding: 'utf8', input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message }, cwd: dir }) });
		assert.equal(r.status, 0, r.stderr);
		return r.stdout.trim() ? JSON.parse(r.stdout) : null;
	};
	const reasonOf = (out) => (out && out.hookSpecificOutput && out.hookSpecificOutput.permissionDecision === 'deny' ? out.hookSpecificOutput.permissionDecisionReason : null);
	const key = TEST_REL + '::the new one';
	const otherKey = TEST_REL + '::the other one';
	const missing = reasonOf(send(record({})));
	assert.ok(missing, 'a record with no tests field is refused');
	assert.ok(missing.includes(key) && missing.includes(otherKey), 'the refusal names both new tests: ' + missing);
	const badWhy = reasonOf(send(record({ tests: [{ name: 'the new one', why: '// why: S2: the record lists it' }, { name: 'the other one', why: GOOD_WHY }] })));
	assert.ok(badWhy, 'a tests entry whose why fails whyFault is refused');
	assert.ok(badWhy.includes(key), 'the refusal names the test: ' + badWhy);
	const onlyOne = reasonOf(send(record({ tests: [{ name: 'the new one', why: GOOD_WHY }] })));
	assert.ok(onlyOne, 'a record listing only one of two new tests is refused');
	assert.ok(onlyOne.includes(otherKey) && !onlyOne.includes(key), 'the refusal names the unlisted test only: ' + onlyOne);
	const wrongName = reasonOf(send(record({ tests: [{ name: 'some different name', why: GOOD_WHY }] })));
	assert.ok(wrongName, 'a record listing a different name only is refused');
	assert.ok(wrongName.includes(key) && wrongName.includes(otherKey), 'the refusal names both new tests: ' + wrongName);
	const empty = reasonOf(send(record({ tests: [] })));
	assert.ok(empty, 'an empty tests list is refused');
	assert.ok(empty.includes(key) && empty.includes(otherKey), 'the refusal names both new tests: ' + empty);
	const both = { tests: [{ name: 'the new one', why: GOOD_WHY }, { name: 'the other one', why: GOOD_WHY }] };
	const good = send(record(both));
	assert.equal(good, null, 'a record listing both new tests with passing whys passes: ' + JSON.stringify(good));
	// log mode: the same bad record is not refused, and one row names the file::name
	fs.writeFileSync(path.join(kit, 'kit-hooks', 'holds.json'), JSON.stringify({ holds: [{ id: 'handoff-gate', hook: 'handoff-gate.cjs', mode: 'log' }] }) + '\n');
	const before = guardLog(dir);
	const logged = send(record({ tests: [{ name: 'the new one', why: GOOD_WHY }] }));
	assert.equal(logged, null, 'under log the bad record is not refused: ' + JSON.stringify(logged));
	const added = guardLog(dir).slice(before.length);
	assert.equal(added.length, 1, 'one new row in kit-guard-open.log: ' + added.join('\n'));
	assert.ok(added[0].includes(otherKey), 'the row names the file::name: ' + added[0]);
});

// why: catches an Edit that adds a test( to an existing file, or a MultiEdit, is checked the same as a Write (K368 S3)
test('an Edit that adds a test( to an existing file, or a MultiEdit, is checked the same as a Write', () => {
	const start = testWith(GOOD_WHY, 'the old one');
	const dir = unitRepo(start);
	const adds = (why) => testWith(why, 'the added one');
	const edit = (why) => fence(dir, 'Edit', { file_path: target(dir), old_string: start, new_string: start + adds(why) });
	const multi = (why) => fence(dir, 'MultiEdit', { file_path: target(dir), edits: [{ old_string: 'the old one', new_string: 'the first one' }, { old_string: start.replace('the old one', 'the first one'), new_string: start.replace('the old one', 'the first one') + adds(why) }] });
	const write = (why) => fence(dir, 'Write', { file_path: target(dir), content: start + adds(why) });
	for (const [label, run] of [['Write', write], ['Edit', edit], ['MultiEdit', multi]]) {
		const bad = run('');
		assert.equal(bad.code, 2, label + ' with a why-less test is refused: ' + bad.err);
		assert.ok(bad.err.includes(NO_WHY), label + ' quotes whyFault: ' + bad.err);
		const shape = run('// why: S3: not a real why');
		assert.equal(shape.code, 2, label + ' with a bare spec id is refused: ' + shape.err);
		assert.ok(shape.err.includes(BAD_SHAPE), label + ' quotes whyFault: ' + shape.err);
		const ok = run(GOOD_WHY);
		assert.equal(ok.code, 0, label + ' with a passing why saves: ' + ok.err);
	}
	// only new tests are judged: a file whose existing test has no why still takes a new test with a good why
	const legacy = testWith('', 'the legacy one');
	const dir2 = unitRepo(legacy);
	const add = (why) => fence(dir2, 'Edit', { file_path: target(dir2), old_string: legacy, new_string: legacy + testWith(why, 'the added one') });
	const addGood = add(GOOD_WHY);
	assert.equal(addGood.code, 0, 'a new test with a good why saves beside a legacy why-less test: ' + addGood.err);
	const addBad = add('');
	assert.equal(addBad.code, 2, 'a why-less new test is refused beside a legacy one: ' + addBad.err);
	assert.ok(addBad.err.includes(NO_WHY) && addBad.err.includes('the added one'), 'it names the new test, not the legacy one: ' + addBad.err);
});

// why: catches the same write twice gives the same verdict (K368 S4)
test('the same write twice gives the same verdict', () => {
	const dir = unitRepo();
	const calls = [
		['Write', { file_path: target(dir), content: testWith('', 'adds two numbers') }],
		['Write', { file_path: target(dir), content: testWith(GOOD_WHY, 'adds two numbers') }],
	];
	const verdicts = calls.map(([tool, input]) => {
		const a = fence(dir, tool, input);
		const b = fence(dir, tool, input);
		assert.deepEqual({ code: b.code, err: b.err }, { code: a.code, err: a.err }, 'the repeat differs from the first run');
		return a.code;
	});
	assert.deepEqual(verdicts, [2, 0], 'the why-less write is refused and the passing one saves, each time');
});

// why: catches a test file the hook cannot parse is refused and logged (K368 S5)
test('a test file the hook cannot parse is refused and logged', () => {
	const dir = unitRepo(testWith(GOOD_WHY, 'the old one'));
	const cases = [
		['an Edit whose old_string is not in the file', 'Edit', { file_path: target(dir), old_string: 'text that is not in the file', new_string: 'x' }],
		['a MultiEdit with a missing old_string', 'MultiEdit', { file_path: target(dir), edits: [{ old_string: 'text that is not in the file', new_string: 'x' }] }],
		['a Write with no content', 'Write', { file_path: target(dir) }],
		['a Write with numeric content', 'Write', { file_path: target(dir), content: 42 }],
	];
	let rows = guardLog(dir).length;
	for (const [label, tool, input] of cases) {
		const r = fence(dir, tool, input);
		assert.equal(r.code, 2, label + ' is refused: ' + r.err);
		assert.ok(r.err.includes('sample.test.mjs'), label + ' names the file: ' + r.err);
		assert.ok(r.err.includes('unparsable'), label + ' says unparsable: ' + r.err);
		const all = guardLog(dir);
		assert.equal(all.length, rows + 1, label + ' adds one row to kit-guard-open.log');
		assert.ok(all[all.length - 1].includes('sample.test.mjs') && all[all.length - 1].includes('unparsable'), label + ' row holds the file and unparsable: ' + all[all.length - 1]);
		rows = all.length;
	}
});

// why: catches an Edit with replace_all true that turns a later // MARK into a why-less top-level test( passing the fence (K368 S3)
test('an Edit with replace_all that turns a later // MARK into a why-less test( is refused', () => {
	const start = '  // MARK\n' + testWith(GOOD_WHY, 'the old one') + '// MARK\n';
	const dir = unitRepo(start);
	const input = { file_path: target(dir), old_string: '// MARK', new_string: "test('the late one', () => {});", replace_all: true };
	const bad = fence(dir, 'Edit', input);
	assert.equal(bad.code, 2, 'the replace_all edit leaves a why-less top-level test and is refused: ' + bad.err);
	assert.ok(bad.err.includes(NO_WHY) && bad.err.includes('the late one'), 'stderr names the new test: ' + bad.err);
	// control: without replace_all only the indented first MARK changes, so no new top-level test appears
	const once = fence(dir, 'Edit', { ...input, replace_all: false });
	assert.equal(once.code, 0, 'a single replace of the indented MARK adds no top-level test: ' + once.err);
});

// why: catches an Edit adding a second why-less test('old', ...) beside an existing test('old') passing the fence (K368 S1)
test("an Edit adding a second why-less test with an existing test's name is refused", () => {
	const start = testWith(GOOD_WHY, 'the old one');
	const dir = unitRepo(start);
	const bad = fence(dir, 'Edit', { file_path: target(dir), old_string: start, new_string: start + testWith('', 'the old one') });
	assert.equal(bad.code, 2, 'a second test of an existing name with no why is refused: ' + bad.err);
	assert.ok(bad.err.includes(NO_WHY), 'stderr quotes whyFault: ' + bad.err);
	const ok = fence(dir, 'Edit', { file_path: target(dir), old_string: start, new_string: start + testWith(GOOD_WHY, 'the old one') });
	assert.equal(ok.code, 2, 'a second test of that name is refused even with a good why: ' + ok.err);
	assert.ok(ok.err.includes('share the name') && ok.err.includes('the old one'), 'stderr names the duplicate name: ' + ok.err);
});

// why: catches an Edit inserting a why-less duplicate above the original test of that name passing the fence (K368 S1)
test('a why-less duplicate inserted above the original test of that name is refused', () => {
	const start = testWith(GOOD_WHY, 'the old one');
	const dir = unitRepo(start);
	const above = fence(dir, 'Edit', { file_path: target(dir), old_string: start, new_string: testWith('', 'the old one') + start });
	assert.equal(above.code, 2, 'a why-less duplicate above the original is refused: ' + above.err);
	assert.ok(above.err.includes('share the name') && above.err.includes('the old one'), 'stderr names the duplicate name: ' + above.err);
});

// why: catches an Edit that removes the why line from an existing test that had one passing the fence (K368 S1)
test('an Edit that removes the why line from a test that had one is refused, a legacy why-less test stays editable', () => {
	const start = testWith(GOOD_WHY, 'the old one');
	const dir = unitRepo(start);
	const strip = fence(dir, 'Edit', { file_path: target(dir), old_string: GOOD_WHY + '\n', new_string: '' });
	assert.equal(strip.code, 2, 'removing the why line is refused: ' + strip.err);
	assert.ok(strip.err.includes(NO_WHY) && strip.err.includes('the old one'), 'stderr names the test: ' + strip.err);
	const body = fence(dir, 'Edit', { file_path: target(dir), old_string: '() => {}', new_string: '() => { 1; }' });
	assert.equal(body.code, 0, 'editing the body of a test that keeps its why saves: ' + body.err);
	const legacy = testWith('', 'the legacy one');
	const dir2 = unitRepo(legacy);
	const edit = fence(dir2, 'Edit', { file_path: target(dir2), old_string: '() => {}', new_string: '() => { 1; }' });
	assert.equal(edit.code, 0, 'a legacy why-less test stays editable: ' + edit.err);
});

// A kit copy with handoff-gate in enforce, and a repo whose last commit writes the given files over a first commit.
function gateFixture(files) {
	const kit = kitTemp.makeTemp('why-gate-kit-');
	fs.cpSync(path.resolve('user/kit-hooks'), path.join(kit, 'kit-hooks'), { recursive: true });
	fs.mkdirSync(path.join(kit, 'kit-tools'), { recursive: true });
	fs.copyFileSync(path.resolve('user/kit-tools/handoff.mjs'), path.join(kit, 'kit-tools', 'handoff.mjs'));
	fs.writeFileSync(path.join(kit, 'kit-hooks', 'holds.json'), JSON.stringify({ holds: [{ id: 'handoff-gate', hook: 'handoff-gate.cjs', mode: 'enforce' }] }) + '\n');
	const gate = path.join(kit, 'kit-hooks', 'handoff-gate.cjs');
	const dir = kitTemp.makeTemp('why-gate-repo-');
	git(dir, ['init', '-q', '-b', 'main']);
	put(dir, 'README.md', 'start\n');
	commit(dir, 'chore: first');
	for (const [rel, text] of Object.entries(files)) put(dir, rel, text);
	const sha = commit(dir, 'test: add tests');
	const finding = { id: 'R1', severity: 'low', status: 'open', where: '-', claim: 'c', proof: 'p', fix: '-' };
	const send = (extra) => {
		const message = ['Prose.', 'RECORD:', JSON.stringify({ role: 'tester', commit: sha, clarity: 'clear', ...extra }), JSON.stringify(finding)].join('\n');
		const r = spawnSync(process.execPath, [gate], { encoding: 'utf8', input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', tool_input: { message }, cwd: dir }) });
		assert.equal(r.status, 0, r.stderr);
		const out = r.stdout.trim() ? JSON.parse(r.stdout) : null;
		return out && out.hookSpecificOutput && out.hookSpecificOutput.permissionDecision === 'deny' ? out.hookSpecificOutput.permissionDecisionReason : null;
	};
	return { send };
}

// why: catches a commit adding a test in a non-ASCII file name that the record does not list passing the gate (K368 S2)
test('a commit adding a test in a non-ASCII file name that the record does not list is denied', () => {
	const { send } = gateFixture({ 'tests/café.test.mjs': testWith(GOOD_WHY, 'the new one') });
	const empty = send({ tests: [] });
	assert.ok(empty, 'an unlisted test in tests/café.test.mjs is denied under enforce');
	assert.ok(empty.includes('café.test.mjs::the new one'), 'the refusal names the file::name: ' + empty);
	const listed = send({ tests: [{ name: 'the new one', why: GOOD_WHY }] });
	assert.equal(listed, null, 'listing it with a good why passes: ' + listed);
});

// why: catches a record why given as the bare text after // why: being refused unlike the full line (K368 S2)
test('a record why given as the bare text after // why: is accepted the same as the full line', () => {
	const { send } = gateFixture({ [TEST_REL]: testWith(GOOD_WHY, 'the new one') });
	const full = send({ tests: [{ name: 'the new one', why: GOOD_WHY }] });
	assert.equal(full, null, 'the full line passes: ' + full);
	const bare = send({ tests: [{ name: 'the new one', why: GOOD_WHY.slice('// why: '.length) }] });
	assert.equal(bare, null, 'the bare text passes the same: ' + bare);
	const badBare = send({ tests: [{ name: 'the new one', why: 'S2: the record lists it' }] });
	assert.ok(badBare, 'a bare text that fails whyFault is still refused');
});

// why: catches a record giving a good why for a test whose own why line at the commit is missing passing the gate (K368 S2)
test('the gate refuses a record that gives a good why for a test with no why line at the commit', () => {
	const { send } = gateFixture({ [TEST_REL]: testWith('', 'the bare one') + testWith(GOOD_WHY, 'the good one') });
	const reason = send({ tests: [{ name: 'the bare one', why: GOOD_WHY }, { name: 'the good one', why: GOOD_WHY }] });
	assert.ok(reason, 'a why-less test in the commit is refused whatever the record says');
	assert.ok(reason.includes(TEST_REL + '::the bare one'), 'the refusal names the why-less test: ' + reason);
	assert.ok(!reason.includes('the good one'), 'the test with its why is not named: ' + reason);
});

// why: catches an Edit adding a second why-less test of a legacy why-less test's name passing the fence (K368 S1)
test('a repeated why-less name beside a legacy why-less test is refused', () => {
	const legacy = testWith('', 'the old one');
	const dir = unitRepo(legacy);
	const bad = fence(dir, 'Edit', { file_path: target(dir), old_string: legacy, new_string: legacy + testWith('', 'the old one') });
	assert.equal(bad.code, 2, 'a second why-less test of the legacy name is refused: ' + bad.err);
	assert.ok(bad.err.includes(NO_WHY) && bad.err.includes('the old one'), 'stderr names the test: ' + bad.err);
	const ok = fence(dir, 'Edit', { file_path: target(dir), old_string: legacy, new_string: legacy + testWith(GOOD_WHY, 'the old one') });
	assert.equal(ok.code, 2, 'a second test of that name is refused even with a good why: ' + ok.err);
	assert.ok(ok.err.includes('share the name') && ok.err.includes('the old one'), 'stderr names the duplicate name: ' + ok.err);
});
