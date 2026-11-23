// K369 (patch 1.51.1, U24): the hook refuses checkers and ticketless testers in closeout. "In closeout" means
// docs/builds/<VERSION>.closeout.json exists in the HEAD commit of the repo the hook's cwd is in. agent-model.cjs then
// refuses a checker spawn (subagent_type checker, or Plan: and Unit: lines) with a line holding
// `node user/kit-tools/closeout.mjs defer "<text>"`, and refuses a tester or writer spawn (subagent_type, or a Role: line)
// whose brief has no "Ticket: <id>" line naming an id in the file's tickets. An unparsable closeout file blocks with
// "hook error: lead review" and one row in <git common dir>/kit-guard-open.log. holds.json sets spawn-list, warm-agents,
// round-cap and closeout-spawn to enforce with a tier. Each test runs the real hook in a child process against a temp repo.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const HOOK_DIR = path.resolve('user/kit-hooks');
const HOLDS = path.join(HOOK_DIR, 'holds.json');
const VERSION = '1.51.1';
const CLOSEOUT = `docs/builds/${VERSION}.closeout.json`;

function isolatedEnv(extra = {}) {
	const home = kitTemp.makeTemp('closeout-spawn-home-');
	const config = path.join(home, '.claude');
	return { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: config, KIT_CLAUDE_HOME: config, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com', ...extra };
}

function git(cwd, args) {
	const r = spawnSync('git', args, { cwd, env: isolatedEnv(), encoding: 'utf8' });
	assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
	return r.stdout.trim();
}

// A repo with VERSION committed and a kit-unit-files.txt, so a tester spawn is never held for its list. closeout is the
// text of the closeout file, committed in HEAD ('commit'), left in the working tree only ('tree'), or absent (null).
// file names the closeout file (default: this VERSION's); where 'none' makes no commit at all.
function repo(closeout, where = 'commit', file = CLOSEOUT) {
	const dir = kitTemp.makeTemp('closeout-spawn-repo-');
	git(dir, ['init', '-q', '-b', 'main']);
	fs.writeFileSync(path.join(dir, 'VERSION'), `${VERSION}\n`);
	fs.mkdirSync(path.join(dir, 'docs', 'builds'), { recursive: true });
	if (where !== 'none') {
		if (closeout !== null && where === 'commit') fs.writeFileSync(path.join(dir, file), closeout);
		git(dir, ['add', '-A']);
		git(dir, ['commit', '-q', '-m', 'start']);
	}
	if (closeout !== null && where === 'tree') fs.writeFileSync(path.join(dir, file), closeout);
	fs.writeFileSync(git(dir, ['rev-parse', '--path-format=absolute', '--git-path', 'kit-unit-files.txt']), 'tests/closeout-spawn.test.mjs\n');
	return dir;
}
const closeoutJson = (tickets) => `${JSON.stringify({ version: VERSION, head: 'abc', findings: [], tickets })}\n`;
const openFile = (dir) => path.join(git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']), 'kit-guard-open.log');
const readRows = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

const CONFIG = (() => {
	const config = kitTemp.makeTemp('closeout-spawn-config-');
	fs.mkdirSync(path.join(config, 'agents'), { recursive: true });
	for (const [name, model] of Object.entries({ checker: 'opus', tester: 'sonnet', writer: 'sonnet', builder: 'haiku', 'general-purpose': 'sonnet' })) fs.writeFileSync(path.join(config, 'agents', `${name}.md`), `---\nname: ${name}\nmodel: ${model}\n---\nrole\n`);
	return config;
})();

// Runs the real agent-model.cjs once per call, in order, from cwd; one decision per call, null when it lets the call through.
function checkCalls(cwd, calls, hookDir = HOOK_DIR) {
	const script = "const a = JSON.parse(process.env.KIT_TEST_ARGS); const m = require(path.join(a.hookDir, 'agent-model.cjs')); process.stdout.write(JSON.stringify(a.calls.map((c) => m.check({ tool_name: 'Agent', tool_input: c, cwd: a.cwd }))));";
	const args = JSON.stringify({ hookDir, calls, cwd });
	const r = spawnSync(process.execPath, ['-e', `const path = require('node:path'); ${script}`], { env: isolatedEnv({ KIT_CLAUDE_HOME: CONFIG, CLAUDE_CONFIG_DIR: CONFIG, KIT_TEST_ARGS: args }), encoding: 'utf8' });
	assert.equal(r.status, 0, `agent-model.cjs check ran: ${r.stderr}`);
	return JSON.parse(r.stdout);
}

const checker = (unit = 'U24') => ({ subagent_type: 'checker', prompt: `Plan: PLAN.md\nUnit: ${unit}\nCheck the unit.` });
const briefedChecker = (unit = 'U24') => ({ subagent_type: 'general-purpose', prompt: `Plan: PLAN.md\nUnit: ${unit}\nCheck the unit.` });
const tester = (ticket, type = 'tester', role) => ({ subagent_type: type, prompt: `${role ? `Role: ${role}\n` : ''}${ticket ? `Ticket: ${ticket}\n` : ''}Write the tests for the finding.` });
const denied = (d) => d && d.hookSpecificOutput && d.hookSpecificOutput.permissionDecision === 'deny';
const reason = (d) => (d && d.hookSpecificOutput && d.hookSpecificOutput.permissionDecisionReason) || '';
const DEFER = /closeout\.mjs defer "/;

// why: catches a checker spawn while a closeout file is committed is refused, printing the defer command, and a throwing hold-mode.cjs failing open (K369 S1, M4)
test('a checker spawn while a closeout file is committed is refused, printing the defer command', () => {
	const dir = repo(closeoutJson(['F1']));
	const [spawn] = checkCalls(dir, [checker()]);
	assert.ok(denied(spawn), `a checker spawn in closeout is refused, got ${JSON.stringify(spawn)}`);
	assert.match(reason(spawn), DEFER);
	const tree = repo(closeoutJson(['F1']), 'tree');
	const [uncommitted] = checkCalls(tree, [checker()]);
	assert.equal(uncommitted, null, 'a closeout file only in the working tree does not count');
	// The refusal follows the closeout-spawn hold: a copy of the hook folder with that hold at log lets the call through and logs it.
	const hookDir = kitTemp.makeTemp('closeout-spawn-hooks-');
	fs.cpSync(HOOK_DIR, hookDir, { recursive: true });
	const holds = JSON.parse(fs.readFileSync(HOLDS, 'utf8'));
	holds.holds = holds.holds.filter((h) => h.id !== 'closeout-spawn').concat({ id: 'closeout-spawn', hook: 'agent-model.cjs', mode: 'log', tier: 'high' });
	fs.writeFileSync(path.join(hookDir, 'holds.json'), JSON.stringify(holds));
	const logDir = repo(closeoutJson(['F1']));
	const [logged] = checkCalls(logDir, [checker()], hookDir);
	assert.equal(logged, null, `under log the checker spawn is not refused, got ${JSON.stringify(logged)}`);
	const rows = fs.readFileSync(path.join(git(logDir, ['rev-parse', '--path-format=absolute', '--git-common-dir']), 'kit-agent-model.log'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
	assert.ok(rows.some((r) => JSON.stringify(r).includes('closeout') && r.denied !== true), `the would-be refusal is logged, got ${JSON.stringify(rows)}`);
	// M4: a hold-mode.cjs that throws fails closed for this high-tier hold, for a checker and a ticketless tester.
	fs.writeFileSync(path.join(hookDir, 'hold-mode.cjs'), "'use strict';\nexports.mode = () => { throw new Error('holds unreadable'); };\n");
	const [brokenChecker, brokenTester] = checkCalls(repo(closeoutJson(['F1'])), [checker(), tester(null)], hookDir);
	assert.ok(denied(brokenChecker), `a throwing hold-mode refuses the checker in closeout, got ${JSON.stringify(brokenChecker)}`);
	assert.ok(denied(brokenTester), `a throwing hold-mode refuses the ticketless tester, got ${JSON.stringify(brokenTester)}`);
});

// why: catches a tester whose brief names an unused ticket passes, and one without is refused (K369 S2)
test('a tester whose brief names an unused ticket passes, and one without is refused', () => {
	const dir = repo(closeoutJson(['F1', 'F2']));
	const [listed, writer, none, unknown] = checkCalls(dir, [tester('F2'), tester('F1', 'writer'), tester(null), tester('F9')]);
	assert.equal(listed, null, `a tester naming a ticket in the file passes, got ${JSON.stringify(listed)}`);
	assert.equal(writer, null, `a writer naming a ticket passes, got ${JSON.stringify(writer)}`);
	assert.ok(denied(none), `a tester with no Ticket: line is refused, got ${JSON.stringify(none)}`);
	assert.ok(denied(unknown), `a tester naming an id outside the tickets is refused, got ${JSON.stringify(unknown)}`);
	const [builder] = checkCalls(dir, [{ subagent_type: 'builder', prompt: 'Build the unit.' }]);
	assert.equal(builder, null, 'other roles are not held');
	const [bareWriter] = checkCalls(dir, [tester(null, 'writer')]);
	assert.ok(denied(bareWriter), `a writer with no Ticket: line is refused, got ${JSON.stringify(bareWriter)}`);
	const prefixed = repo(closeoutJson(['F10']));
	const [wholeId, kitTester] = checkCalls(prefixed, [tester('F1'), tester(null, 'kit:tester')]);
	assert.ok(denied(wholeId), `Ticket: F1 does not match the ticket F10, got ${JSON.stringify(wholeId)}`);
	assert.ok(denied(kitTester), `a kit:tester spawn with no ticket is refused, got ${JSON.stringify(kitTester)}`);
});

// why: catches no closeout file changes nothing (K369 S3)
test('no closeout file changes nothing', () => {
	const dir = repo(null);
	const [spawn, bare, builder] = checkCalls(dir, [checker(), tester(null), { subagent_type: 'builder', prompt: 'Build the unit.' }]);
	assert.equal(spawn, null, `a checker spawn is not held without a closeout file, got ${JSON.stringify(spawn)}`);
	assert.equal(bare, null, `a ticketless tester is not held without a closeout file, got ${JSON.stringify(bare)}`);
	assert.equal(builder, null);
	assert.equal(readRows(openFile(dir)).length, 0, 'no log row when there is nothing to read');
	const older = repo(closeoutJson(['F1']), 'commit', 'docs/builds/1.50.0.closeout.json');
	const [oldChecker, oldTester] = checkCalls(older, [checker(), tester(null)]);
	assert.equal(oldChecker, null, `another version's closeout file does not count, got ${JSON.stringify(oldChecker)}`);
	assert.equal(oldTester, null, `a ticketless tester passes when only another version has a file, got ${JSON.stringify(oldTester)}`);
	assert.equal(readRows(openFile(older)).length, 0, 'no log row for another version');
	const fresh = repo(closeoutJson(['F1']), 'none');
	const [freshChecker, freshTester, freshBuilder] = checkCalls(fresh, [checker(), tester(null), { subagent_type: 'builder', prompt: 'Build the unit.' }]);
	assert.equal(freshChecker, null, `a repo with no commit yet holds nothing, got ${JSON.stringify(freshChecker)}`);
	assert.equal(freshTester, null, `a ticketless tester passes in a repo with no commit, got ${JSON.stringify(freshTester)}`);
	assert.equal(freshBuilder, null);
	assert.equal(readRows(openFile(fresh)).length, 0, 'no log row for a repo with no commit');
	const closed = repo(closeoutJson(['F1']));
	const [held] = checkCalls(closed, [checker()]);
	assert.ok(denied(held), 'the same spawn in a repo with the file is held');
});

// why: catches a general agent briefed as checker is refused too (K369 S4)
test('a general agent briefed as checker is refused too', () => {
	const dir = repo(closeoutJson(['F1']));
	const [checkerBrief, noTicket, withTicket, other] = checkCalls(dir, [briefedChecker(), tester(null, 'general-purpose', 'tester'), tester('F1', 'general-purpose', 'tester'), tester(null, 'general-purpose', 'builder')]);
	assert.ok(denied(checkerBrief), `a general agent with Plan: and Unit: lines is refused, got ${JSON.stringify(checkerBrief)}`);
	assert.match(reason(checkerBrief), DEFER);
	assert.ok(denied(noTicket), `a general agent briefed Role: tester with no ticket is refused, got ${JSON.stringify(noTicket)}`);
	assert.equal(withTicket, null, 'a briefed tester with a listed ticket passes');
	assert.equal(other, null, 'a briefed builder is not held');
	const [briefedWriter, testWriter] = checkCalls(dir, [tester(null, 'general-purpose', 'writer'), tester(null, 'general-purpose', 'test-writer')]);
	assert.ok(denied(briefedWriter), `a general agent briefed Role: writer with no ticket is refused, got ${JSON.stringify(briefedWriter)}`);
	assert.ok(denied(testWriter), `a general agent briefed Role: test-writer with no ticket is refused, got ${JSON.stringify(testWriter)}`);
	const [phraseTester, phraseWriter] = checkCalls(dir, [tester(null, 'general-purpose', 'the tester for F1'), tester(null, 'general-purpose', 'second writer')]);
	assert.ok(denied(phraseTester), `"Role: the tester for F1" with no ticket is refused, got ${JSON.stringify(phraseTester)}`);
	assert.ok(denied(phraseWriter), `"Role: second writer" with no ticket is refused, got ${JSON.stringify(phraseWriter)}`);
});

// why: catches holds.json sets the K360, K364, K366 and K369 refusals to enforce with a tier field (K366 and K369 high, K360 and K364 small), and a test fails if any of them reads log or has no tier (K369 S6)
test('holds.json sets the K360, K364, K366 and K369 refusals to enforce with a tier field (K366 and K369 high, K360 and K364 small), and a test fails if any of them reads log or has no tier', () => {
	const holds = JSON.parse(fs.readFileSync(HOLDS, 'utf8')).holds;
	const expected = { 'spawn-list': 'small', 'warm-agents': 'small', 'round-cap': 'high', 'closeout-spawn': 'high' };
	for (const [id, tier] of Object.entries(expected)) {
		const hold = holds.find((h) => h.id === id);
		assert.ok(hold, `holds.json has a hold with id ${id}`);
		assert.equal(hold.mode, 'enforce', `${id} runs in enforce mode`);
		assert.equal(hold.tier, tier, `${id} carries tier ${tier}`);
	}
});

// why: catches the same spawn twice gives the same verdict (K369 S4)
test('the same spawn twice gives the same verdict', () => {
	const dir = repo(closeoutJson(['F1']));
	const [a, b, c, d] = checkCalls(dir, [checker(), checker(), tester(null), tester(null)]);
	assert.ok(denied(a), `the checker spawn is refused, got ${JSON.stringify(a)}`);
	assert.deepEqual(b, a);
	assert.ok(denied(c), `the ticketless tester is refused, got ${JSON.stringify(c)}`);
	assert.deepEqual(d, c);
	const [e] = checkCalls(dir, [checker()]);
	assert.deepEqual(e, a, 'a later run in a new process gives the same verdict');
});

// why: catches an unreadable closeout file or a hook error blocks the call with "hook error: lead review" and is logged (K369 S5)
test('an unreadable closeout file or a hook error blocks the call with "hook error: lead review" and is logged', () => {
	const dir = repo('{ this is not json');
	const [spawn, tickets] = checkCalls(dir, [checker(), tester('F1')]);
	assert.ok(denied(spawn), `an unparsable closeout file blocks a checker spawn, got ${JSON.stringify(spawn)}`);
	assert.match(reason(spawn), /hook error: lead review/);
	assert.ok(denied(tickets), `it blocks a tester spawn too, got ${JSON.stringify(tickets)}`);
	assert.match(reason(tickets), /hook error: lead review/);
	const rows = readRows(openFile(dir));
	assert.ok(rows.length >= 1, 'a row in kit-guard-open.log');
	assert.equal(rows[0].hook, 'agent-model');
	assert.ok(rows[0].cause && rows[0].at, 'the row carries its cause and time');
	const noList = repo('{}\n');
	const [listChecker, listTester, listBuilder] = checkCalls(noList, [checker(), tester('F1'), { subagent_type: 'builder', prompt: 'Build the unit.' }]);
	assert.ok(denied(listChecker), `a closeout file with no tickets array is unreadable, got ${JSON.stringify(listChecker)}`);
	assert.match(reason(listChecker), /hook error: lead review/);
	assert.ok(denied(listTester), `a tester spawn is blocked too, got ${JSON.stringify(listTester)}`);
	assert.match(reason(listTester), /hook error: lead review/);
	assert.equal(listBuilder, null, 'a builder spawn needs no check, so it passes');
	assert.ok(readRows(openFile(noList)).length >= 1, 'the missing tickets array is logged');
	const clean = repo(closeoutJson(['F1']));
	const [fine] = checkCalls(clean, [tester('F1')]);
	assert.equal(fine, null, 'a readable file is not an error');
	assert.equal(readRows(openFile(clean)).length, 0);
});

// why: catches a test-writer spawn with no Ticket line slipping through the closeout gate (K369 S2 F4)
test('a test-writer spawn with no Ticket line is refused', () => {
	const dir = repo(closeoutJson(['F1']));
	const [bare, named] = checkCalls(dir, [tester(null, 'test-writer'), tester('F1', 'test-writer')]);
	assert.ok(denied(bare), `a test-writer with no Ticket: line is refused, got ${JSON.stringify(bare)}`);
	assert.equal(named, null, 'a test-writer naming a listed ticket passes');
});

// why: catches Ticket: F10 being accepted when the closeout tickets hold only F1 (K369 S2 F4)
test('Ticket: F10 against the tickets ["F1"] is refused', () => {
	const dir = repo(closeoutJson(['F1']));
	const [longer, exact] = checkCalls(dir, [tester('F10'), tester('F1')]);
	assert.ok(denied(longer), `Ticket: F10 is not the ticket F1, got ${JSON.stringify(longer)}`);
	assert.equal(exact, null, 'Ticket: F1 passes');
});

// why: catches an uncommitted VERSION edit in the working tree changing which closeout file the gate reads (K369 S1 F2)
test('an uncommitted VERSION edit in the working tree does not change the verdict', () => {
	const dir = repo(closeoutJson(['F1']));
	const [before] = checkCalls(dir, [checker()]);
	assert.ok(denied(before), 'the checker is refused with the closeout file committed');
	fs.writeFileSync(path.join(dir, 'VERSION'), '9.9.9\n');
	const [after, ticketless] = checkCalls(dir, [checker(), tester(null)]);
	assert.deepEqual(after, before, 'VERSION is read from HEAD, so the verdict is the same');
	assert.ok(denied(ticketless), 'a ticketless tester is still refused');
	const fresh = repo(closeoutJson(['F1']), 'commit', 'docs/builds/9.9.9.closeout.json');
	fs.writeFileSync(path.join(fresh, 'VERSION'), '9.9.9\n');
	const [other] = checkCalls(fresh, [checker()]);
	assert.equal(other, null, 'a working-tree VERSION naming the committed closeout file does not make the gate read it');
});

// why: catches a git failure inside the closeout gate letting a checker through instead of "hook error: lead review" (K369 S5 F3)
test('a git failure inside the closeout gate refuses a checker with "hook error: lead review"', () => {
	const dir = repo(closeoutJson(['F1']));
	const blob = git(dir, ['rev-parse', 'HEAD:VERSION']);
	const loose = path.join(git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']), 'objects', blob.slice(0, 2), blob.slice(2));
	fs.chmodSync(loose, 0o666);
	fs.rmSync(loose);
	const [spawn] = checkCalls(dir, [checker()]);
	assert.ok(denied(spawn), `a git show that fails on HEAD:VERSION refuses the checker, got ${JSON.stringify(spawn)}`);
	assert.match(reason(spawn), /hook error: lead review/);
	assert.ok(readRows(openFile(dir)).length >= 1, 'the cause is logged in kit-guard-open.log');
});

// why: catches a ticketed tester counted as a checker because its brief carries Plan: and Unit: lines (K369 S2, round 2 N1)
// planted: {"file":"user/kit-hooks/agent-model.cjs","was":"return !role && hasLine(prompt, 'plan') && hasLine(prompt, 'units?');","to":"return hasLine(prompt, 'plan') && hasLine(prompt, 'units?');"}
test('a ticketed tester whose brief carries Plan and Unit lines passes in closeout', () => {
	const dir = repo(closeoutJson(['F1']));
	const briefed = { subagent_type: 'tester', prompt: 'Plan: PLAN.md\nUnit: U24\nRole: tester\nTicket: F1\nWrite the tests for the finding.' };
	const general = { subagent_type: 'general-purpose', prompt: 'Plan: PLAN.md\nUnit: U24\nRole: tester\nTicket: F1\nWrite the tests for the finding.' };
	const [typed, roled] = checkCalls(dir, [briefed, general]);
	assert.equal(typed, null, `a tester type with Plan and Unit lines is no checker, got ${JSON.stringify(typed)}`);
	assert.equal(roled, null, `a general agent with Role: tester is no checker, got ${JSON.stringify(roled)}`);
});

// why: catches a git that never ran (not on PATH, or timed out) read as no closeout, so a ticketless tester passes (K369 S5, round 2 b)
test('a git that cannot run inside the closeout gate refuses the spawn', () => {
	const dir = repo(closeoutJson(['F1']));
	const bin = path.dirname(process.execPath);
	const script = "const a = JSON.parse(process.env.KIT_TEST_ARGS); const m = require(path.join(a.hookDir, 'agent-model.cjs')); process.stdout.write(JSON.stringify(m.check({ tool_name: 'Agent', tool_input: a.call, cwd: a.cwd })));";
	const args = JSON.stringify({ hookDir: HOOK_DIR, call: tester(null), cwd: dir });
	const env = isolatedEnv({ KIT_CLAUDE_HOME: CONFIG, CLAUDE_CONFIG_DIR: CONFIG, KIT_TEST_ARGS: args, PATH: bin, Path: bin });
	const r = spawnSync(process.execPath, ['-e', `const path = require('node:path'); ${script}`], { env, encoding: 'utf8' });
	assert.equal(r.status, 0, `agent-model.cjs check ran: ${r.stderr}`);
	const d = JSON.parse(r.stdout);
	assert.ok(denied(d), `with no git on PATH the spawn is refused, got ${JSON.stringify(d)}`);
	assert.match(reason(d), /hook error: lead review/);
});

// why: catches H3 a git exit 128 or an unwritable agent log letting a ticketless tester through the closeout gate
test('H3 a git that exits 128, or a log that cannot be written, still refuses a ticketless tester in closeout', () => {
	const broken = repo(closeoutJson(['F1']));
	fs.rmSync(path.join(broken, '.git'), { recursive: true, force: true });
	fs.writeFileSync(path.join(broken, '.git'), 'gitdir: ./missing\n');
	const probe = spawnSync('git', ['-C', broken, 'rev-parse', '--verify', '-q', 'HEAD'], { env: isolatedEnv(), encoding: 'utf8' });
	assert.equal(probe.status, 128, `the fixture must make git exit 128, got ${probe.status}: ${probe.stderr}`);
	const [sick, sickWriter] = checkCalls(broken, [tester(null), tester(null, 'writer')]);
	assert.ok(denied(sick), `a rev-parse that exits 128 refuses the ticketless tester, got ${JSON.stringify(sick)}`);
	assert.match(reason(sick), /hook error|closeout/, 'refused by the closeout gate, not another');
	assert.ok(denied(sickWriter), `and the ticketless writer, got ${JSON.stringify(sickWriter)}`);
	// Control: a plain folder that is not a repo has no closeout, so a ticketless tester passes.
	const plain = kitTemp.makeTemp('closeout-spawn-plain-');
	const [plainTester] = checkCalls(plain, [tester(null)]);
	assert.equal(plainTester, null, `a folder that is not a repo holds nothing, got ${JSON.stringify(plainTester)}`);
	// The list file stays, so the list gate passes and only the closeout gate can refuse. A no-type spawn logs a row first,
	// and the log is a folder there, so the write throws.
	const dir = repo(closeoutJson(['F1']));
	fs.mkdirSync(path.join(git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']), 'kit-agent-model.log'));
	const [logged, loggedWriter] = checkCalls(dir, [tester(null, '', 'tester'), tester(null, '', 'writer')]);
	assert.ok(denied(logged), `a log write error cannot let a ticketless tester through in closeout, got ${JSON.stringify(logged)}`);
	assert.match(reason(logged), /hook error|closeout/, 'refused by the closeout gate, not the list gate');
	assert.doesNotMatch(reason(logged), /kit-unit-files/);
	assert.ok(denied(loggedWriter), `nor a ticketless writer, got ${JSON.stringify(loggedWriter)}`);
});
