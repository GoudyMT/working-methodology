// K399 (patch 1.51.4, U20): once the branch's sweep is recorded, no reviewer, checker or review pass is started. The record is
// an outcome line in <git common dir>/kit-sweep-approvals.jsonl whose contract matches a decision line whose branch is the
// current branch (an outcome with noneRan true is no sweep). agent-model.cjs then refuses a reviewer, checker or review-pass
// spawn (Agent or Task) with a line holding `closeout.mjs defer "<text>"`, and lets a tester or builder through only when
// its brief's Ticket: line names an unused finding of docs/builds/<VERSION>.closeout.json (working tree; VERSION from HEAD),
// or says "Ticket: none" while a medium or low finding is listed. Each refusal and each allowed ticket spawn appends one row
// to kit-agent-model.log; an unreadable record or a hook error refuses with "hook error: lead review". holds.json carries the
// hold as sweep-lock, enforce, tier high. Each test runs the real hook in a child process against a temp repo.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const HOOK_DIR = path.resolve('user/kit-hooks');
const HOLDS = path.join(HOOK_DIR, 'holds.json');
const VERSION = '1.51.4';
const CONTRACT = 'sweep-contract.json';

function isolatedEnv(extra = {}) {
	const home = kitTemp.makeTemp('sweep-lock-home-');
	const config = path.join(home, '.claude');
	return { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: config, KIT_CLAUDE_HOME: config, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com', ...extra };
}

function git(cwd, args) {
	const r = spawnSync('git', args, { cwd, env: isolatedEnv(), encoding: 'utf8' });
	assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
	return r.stdout.trim();
}

const finding = (id, severity) => ({ id, severity, security: false, owner: false });
const closeoutJson = (findings) => `${JSON.stringify({ version: VERSION, head: 'abc', findings, tickets: findings.filter((f) => f.severity === 'high' || f.severity === 'critical').map((f) => f.id) })}\n`;
const common = (dir) => git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
const readRows = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const APPROVALS = (dir) => path.join(common(dir), 'kit-sweep-approvals.jsonl');
const modelLog = (dir) => path.join(common(dir), 'kit-agent-model.log');
const openLog = (dir) => path.join(common(dir), 'kit-guard-open.log');
// The rows the sweep lock wrote: its refusal rows carry session and reason.
const lockRows = (dir) => readRows(modelLog(dir)).filter((r) => r.session !== undefined && r.reason !== undefined);

// A repo on main with VERSION committed, a kit-unit-files.txt (so a tester spawn is never held for its list), and the sweep's
// findings in the working tree. sweep: 'recorded' (decision on main plus outcome), 'none', 'other-branch', 'none-ran' or 'broken'.
function repo({ sweep = 'recorded', findings = [finding('F1', 'high'), finding('F2', 'medium')], closeout = true } = {}) {
	const dir = kitTemp.makeTemp('sweep-lock-repo-');
	git(dir, ['init', '-q', '-b', 'main']);
	fs.writeFileSync(path.join(dir, 'VERSION'), `${VERSION}\n`);
	git(dir, ['add', '-A']);
	git(dir, ['commit', '-q', '-m', 'start']);
	fs.mkdirSync(path.join(dir, 'docs', 'builds'), { recursive: true });
	if (closeout) fs.writeFileSync(path.join(dir, 'docs', 'builds', `${VERSION}.closeout.json`), closeoutJson(findings));
	fs.writeFileSync(git(dir, ['rev-parse', '--path-format=absolute', '--git-path', 'kit-unit-files.txt']), 'tests/sweep-lock.test.mjs\n');
	const decision = (branch) => ({ kind: 'decision', contract: CONTRACT, branch, head: git(dir, ['rev-parse', 'HEAD']), time: new Date().toISOString() });
	const outcome = (extra = {}) => ({ kind: 'outcome', contract: CONTRACT, findings: 2, real: 2, duplicates: 0, tokens: 100, budget: 1000, ...extra });
	const lines = {
		recorded: [decision('main'), outcome()],
		'other-branch': [decision('feature/other'), outcome()],
		'none-ran': [decision('main'), outcome({ noneRan: true })],
		'decision-only': [decision('main')],
		none: [],
		broken: [decision('main'), outcome()],
		directory: [],
	}[sweep];
	// 'broken' ends in a truncated line (a write cut off mid-record): it must read as unreadable, never as "no sweep", because a
	// skipped line would let a review start. 'directory' puts a folder where the record file belongs.
	if (lines.length) fs.writeFileSync(APPROVALS(dir), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n${sweep === 'broken' ? '{"kind":"outcome","contract\n' : ''}`);
	if (sweep === 'directory') fs.mkdirSync(APPROVALS(dir));
	return dir;
}

const CONFIG = (() => {
	const config = kitTemp.makeTemp('sweep-lock-config-');
	fs.mkdirSync(path.join(config, 'agents'), { recursive: true });
	for (const [name, model] of Object.entries({ checker: 'opus', tester: 'sonnet', writer: 'sonnet', builder: 'haiku', reviewer: 'sonnet', 'general-purpose': 'sonnet' })) fs.writeFileSync(path.join(config, 'agents', `${name}.md`), `---\nname: ${name}\nmodel: ${model}\n---\nrole\n`);
	return config;
})();

// Runs the real agent-model.cjs once per call, in order, from cwd, with one session id; a call is {input, tool}. One decision
// per call, null when it lets the call through.
function run(cwd, calls, hookDir = HOOK_DIR, session = 's1') {
	const script = "const a = JSON.parse(process.env.KIT_TEST_ARGS); const m = require(path.join(a.hookDir, 'agent-model.cjs')); process.stdout.write(JSON.stringify(a.calls.map((c) => m.check({ tool_name: c.tool || 'Agent', tool_input: c.input, cwd: a.cwd, session_id: a.session }) || null)));";
	const args = JSON.stringify({ hookDir, calls, cwd, session });
	const r = spawnSync(process.execPath, ['-e', `const path = require('node:path'); ${script}`], { env: isolatedEnv({ KIT_CLAUDE_HOME: CONFIG, CLAUDE_CONFIG_DIR: CONFIG, KIT_TEST_ARGS: args }), encoding: 'utf8' });
	assert.equal(r.status, 0, `agent-model.cjs check ran: ${r.stderr}`);
	return JSON.parse(r.stdout);
}
const one = (cwd, input, tool) => run(cwd, [{ input, tool }])[0];

const denied = (d) => !!d && !!d.hookSpecificOutput && d.hookSpecificOutput.permissionDecision === 'deny';
const reason = (d) => (d && d.hookSpecificOutput && d.hookSpecificOutput.permissionDecisionReason) || '';
const DEFER = /closeout\.mjs defer "/;
const checker = (unit = 'U20') => ({ subagent_type: 'checker', prompt: `Plan: PLAN.md\nUnit: ${unit}\nCheck the unit.` });
const reviewer = () => ({ subagent_type: 'reviewer', prompt: 'Review the sweep fixes.' });
const general = (role, extra = 'Do the work.') => ({ subagent_type: 'general-purpose', prompt: `Role: ${role}\n${extra}` });
const ticketed = (ticket, type = 'tester') => ({ subagent_type: type, prompt: `Role: ${type}\nTicket: ${ticket}\nWrite the tests for the finding.` });

// why: catches with a sweep recorded for the branch, a reviewer, checker or review-pass spawn is refused, printing the defer command (K399 S1)
test('with a sweep recorded for the branch, a reviewer, checker or review-pass spawn is refused, printing the defer command', () => {
	const dir = repo();
	const [chk, rev, pass] = run(dir, [{ input: checker() }, { input: reviewer() }, { input: { subagent_type: 'general-purpose', prompt: 'Role: review pass over the sweep fixes\nReview them.' } }]);
	for (const [name, d] of [['checker', chk], ['reviewer', rev], ['review pass', pass]]) {
		assert.ok(denied(d), `a ${name} spawn after the sweep is refused, got ${JSON.stringify(d)}`);
		assert.match(reason(d), DEFER, `the ${name} refusal prints the defer command`);
	}
	// F1 (L1): a Unit: range counts every unit inside it for the round cap. Two rounds on U17-U19 cap U18, with no sweep recorded.
	const ranged = repo({ sweep: 'none' });
	const rounds = ['U17-U19', 'U17-U19'].map((u) => JSON.stringify({ at: new Date().toISOString(), hook: 'agent-model', mode: 'enforce', type: 'checker', round: 'check', units: [u], plan: null }));
	fs.writeFileSync(path.join(common(ranged), 'kit-check-rounds.log'), `${rounds.join('\n')}\n`);
	const capped = one(ranged, checker('U18'));
	assert.ok(denied(capped), `U18 inside the range U17-U19 has two counted rounds, so a third is refused, got ${JSON.stringify(capped)}`);
	for (const u of ['U17', 'U19']) assert.ok(denied(one(ranged, checker(u))), `${u} inside the range U17-U19 is counted too`);
	// U20-3: a hyphen with spaces around it is prose ("U4 - 7 tests"), not a range, so the rounds count against U4 alone
	const spaced = repo({ sweep: 'none' });
	const spacedRounds = [1, 2].map(() => JSON.stringify({ at: new Date().toISOString(), hook: 'agent-model', mode: 'enforce', type: 'checker', round: 'check', units: ['U4 - 7 tests'], plan: null }));
	fs.writeFileSync(path.join(common(spaced), 'kit-check-rounds.log'), `${spacedRounds.join('\n')}\n`);
	assert.ok(denied(one(spaced, checker('U4'))), 'control: U4 has two counted rounds, so a third is refused');
	for (const u of ['U5', 'U6', 'U7']) {
		const d = one(spaced, checker(u));
		assert.equal(d, null, `"Unit: U4 - 7 tests" does not count a round against ${u}, got ${JSON.stringify(d)}`);
	}
});

// why: catches a general agent briefed to review or check is refused the same way (K399 S1)
test('a general agent briefed to review or check is refused the same way', () => {
	const dir = repo();
	const [rev, chk, testRev] = run(dir, [{ input: general('reviewer') }, { input: general('the checker for U20') }, { input: general('test-reviewer of the sweep fixes') }]);
	for (const [name, d] of [['reviewer', rev], ['checker', chk], ['test-reviewer', testRev]]) {
		assert.ok(denied(d), `a general agent briefed as ${name} is refused after the sweep, got ${JSON.stringify(d)}`);
		assert.match(reason(d), DEFER);
	}
	// F4 (A7): a scanner, researcher, drafter or orchestrator that mentions a checker is not read as a checker.
	const roles = ['scanner for the checker claims', 'researcher of the reviewer rules', 'drafter of the checker brief', 'orchestrator of the reviewer batch'];
	const others = run(dir, roles.map((r) => ({ input: general(r) })));
	others.forEach((d, i) => assert.equal(d, null, `"Role: ${roles[i]}" is not a review role and passes, got ${JSON.stringify(d)}`));
});

// why: catches a tester or builder whose brief names an unused listed finding goes through; one with no finding, or a used one, is refused (K399 S2)
test('a tester or builder whose brief names an unused listed finding goes through; one with no finding, or a used one, is refused', () => {
	const dir = repo({ findings: [finding('F1', 'high'), finding('F2', 'medium'), finding('F3', 'critical')] });
	const [wrongId, tester, builder, again, noTicket, unlisted, noneOk] = run(dir, [
		// F2 (L2): a Ticket: line matches only the id right after "Ticket:", not an id in its free text.
		{ input: ticketed('F9 see F1') },
		{ input: ticketed('F1') },
		{ input: ticketed('F3', 'builder') },
		{ input: ticketed('F1', 'builder') },
		{ input: { subagent_type: 'tester', prompt: 'Role: tester\nWrite the tests.' } },
		{ input: ticketed('F9') },
		// F3 (A4): "Ticket: none" passes while a medium or low finding is listed.
		{ input: ticketed('none') },
	]);
	assert.ok(denied(wrongId), `"Ticket: F9 see F1" names F9, which is not listed, so it is refused, got ${JSON.stringify(wrongId)}`);
	assert.equal(tester, null, `a tester naming the unused listed F1 goes through, got ${JSON.stringify(tester)}`);
	assert.equal(builder, null, `a builder naming the unused F3 goes through, got ${JSON.stringify(builder)}`);
	assert.ok(denied(again), `F1 is used, so a second spawn naming it is refused, got ${JSON.stringify(again)}`);
	assert.ok(denied(noTicket), `a tester with no Ticket: line is refused, got ${JSON.stringify(noTicket)}`);
	assert.ok(denied(unlisted), `a tester naming an id the sweep did not list is refused, got ${JSON.stringify(unlisted)}`);
	assert.equal(noneOk, null, `"Ticket: none" passes while a medium finding is listed, got ${JSON.stringify(noneOk)}`);
	// Refusal rows carry a reason; the allowed-spawn rows are the ones without.
	const allowed = readRows(modelLog(dir)).filter((r) => r.reason === undefined).map((r) => JSON.stringify(r));
	assert.equal(allowed.filter((r) => /\bF1\b/.test(r)).length, 1, `exactly one allowed-spawn row names F1, got ${allowed}`);
	assert.equal(allowed.filter((r) => /\bF3\b/.test(r)).length, 1, `exactly one allowed-spawn row names F3, got ${allowed}`);
	assert.equal(allowed.filter((r) => /\bF9\b/.test(r)).length, 0, 'a refused id leaves no allowed-spawn row');
	const high = repo({ findings: [finding('F1', 'high')] });
	assert.ok(denied(one(high, ticketed('none'))), '"Ticket: none" is refused when only high findings are listed');
	const secure = repo({ findings: [finding('F1', 'high'), { id: 'F2', severity: 'low', security: true, owner: false }] });
	assert.ok(denied(one(secure, ticketed('none'))), '"Ticket: none" is refused when the only low finding is a security one');
	// U20-2: with the closeout file committed in HEAD the K369 gate reads it; an id after "Ticket:" that it does not list is refused there
	const committed = repo({ sweep: 'none' });
	git(committed, ['add', '-A']);
	git(committed, ['commit', '-q', '-m', 'closeout']);
	assert.equal(one(committed, ticketed('F1')), null, 'control: a ticket the closeout lists goes through');
	const wrong = one(committed, ticketed('F9 see F1'));
	assert.ok(denied(wrong), `"Ticket: F9 see F1" is refused by the closeout gate, got ${JSON.stringify(wrong)}`);
	assert.match(reason(wrong), /closeout tickets/);
	// E3: with the closeout committed the closeout gate wins, so "Ticket: none" is for a builder only
	const none = repo();
	git(none, ['add', '-A']);
	git(none, ['commit', '-q', '-m', 'closeout']);
	assert.equal(one(none, ticketed('none', 'builder')), null, '"Ticket: none" passes for a builder');
	const noneTester = one(none, ticketed('none'));
	assert.ok(denied(noneTester), `"Ticket: none" is refused for a tester, got ${JSON.stringify(noneTester)}`);
	// U20-1: a ticketed spawn that a later gate refuses (here the list gate: no kit-unit-files.txt) uses up no finding, so the retry goes through
	const retry = repo();
	const listFile = git(retry, ['rev-parse', '--path-format=absolute', '--git-path', 'kit-unit-files.txt']);
	fs.rmSync(listFile);
	const held = one(retry, ticketed('F1'));
	assert.ok(denied(held), `with no list file the tester is refused by a later gate, got ${JSON.stringify(held)}`);
	assert.doesNotMatch(reason(held), /already named/, 'the first try is not refused as a used finding');
	fs.writeFileSync(listFile, 'tests/sweep-lock.test.mjs\n');
	const retried = one(retry, ticketed('F1'));
	assert.equal(retried, null, `once the list exists the retry goes through, not "already named", got ${JSON.stringify(retried)}`);
});

// why: catches every refusal writes one log line (role, unit, reason) (K399 S3)
test('every refusal writes one log line (role, unit, reason)', () => {
	const dir = repo();
	run(dir, [{ input: checker('U20') }, { input: general('reviewer', 'Unit: U21') }, { input: ticketed('F9') }], HOOK_DIR, 'sess-42');
	const rows = lockRows(dir);
	assert.equal(rows.length, 3, `three refusals write three lines, got ${JSON.stringify(rows)}`);
	assert.deepEqual(rows.map((r) => r.role), ['checker', 'reviewer', 'tester']);
	assert.equal(rows[0].unit, 'U20');
	assert.equal(rows[1].unit, 'U21');
	for (const r of rows) {
		assert.equal(r.session, 'sess-42');
		assert.ok(Date.parse(r.at) > 0, 'at is a timestamp');
		assert.ok(typeof r.reason === 'string' && r.reason.length > 0, 'reason is text');
	}
});

// why: catches with no sweep recorded nothing changes (K399 S4)
test('with no sweep recorded nothing changes', () => {
	// The control: this very spawn set is refused once the sweep is recorded.
	const hot = repo();
	assert.ok(denied(one(hot, checker())), 'with the sweep recorded the checker is refused');
	assert.ok(denied(one(hot, reviewer())), 'with the sweep recorded the reviewer is refused');
	for (const sweep of ['none', 'other-branch', 'none-ran', 'decision-only']) {
		const dir = repo({ sweep });
		const [chk, rev, tst, plain] = run(dir, [{ input: checker() }, { input: reviewer() }, { input: ticketed('F9') }, { input: { subagent_type: 'builder', prompt: 'Build the unit.' } }]);
		for (const [name, d] of [['checker', chk], ['reviewer', rev], ['unlisted-ticket tester', tst], ['builder', plain]]) assert.equal(d, null, `${sweep}: a ${name} spawn is not held, got ${JSON.stringify(d)}`);
		assert.equal(lockRows(dir).length, 0, `${sweep}: no refusal row is written`);
		assert.equal(readRows(openLog(dir)).length, 0, `${sweep}: no hook error row is written`);
	}
});

// why: catches holds.json sets the hold to enforce with tier high, and a test fails if it reads otherwise (K399 S5)
test('holds.json sets the hold to enforce with tier high, and a test fails if it reads otherwise', () => {
	const holds = JSON.parse(fs.readFileSync(HOLDS, 'utf8')).holds;
	const hold = holds.find((h) => h.id === 'sweep-lock');
	assert.ok(hold, 'holds.json has a hold with id sweep-lock');
	assert.equal(hold.hook, 'agent-model.cjs');
	assert.equal(hold.mode, 'enforce');
	assert.equal(hold.tier, 'high');
});

// why: catches fail-closed: an unreadable sweep record or a hook error blocks with "hook error: lead review", logged (K399 S5)
test('fail-closed: an unreadable sweep record or a hook error blocks with "hook error: lead review", logged', () => {
	const broken = repo({ sweep: 'broken' });
	const [spawn, builder] = run(broken, [{ input: reviewer() }, { input: { subagent_type: 'builder', prompt: 'Build the unit.' } }]);
	assert.ok(denied(spawn), `an unreadable sweep record refuses the spawn, got ${JSON.stringify(spawn)}`);
	assert.match(reason(spawn), /hook error: lead review/);
	assert.ok(denied(builder), `a builder spawn is refused too while the record cannot be read, got ${JSON.stringify(builder)}`);
	assert.ok(readRows(openLog(broken)).some((r) => r.hook === 'agent-model'), 'the cause is logged to kit-guard-open.log');
	// A directory where the record file belongs is unreadable too.
	const dirAt = repo({ sweep: 'directory' });
	const dirSpawn = one(dirAt, reviewer());
	assert.ok(denied(dirSpawn), `a folder at the record path refuses the spawn, got ${JSON.stringify(dirSpawn)}`);
	assert.match(reason(dirSpawn), /hook error: lead review/);
	// A sweep recorded with no closeout file at all: the ticket list cannot be read, so the ticketed tester is refused and logged.
	const missing = repo({ closeout: false });
	const missingSpawn = one(missing, ticketed('F1'));
	assert.ok(denied(missingSpawn), `a missing findings file refuses the ticketed tester, got ${JSON.stringify(missingSpawn)}`);
	assert.match(reason(missingSpawn), /hook error: lead review/);
	assert.equal(readRows(openLog(missing)).length, 1, 'one row in kit-guard-open.log');
	// A closeout file with no findings list, with the sweep recorded, blocks the ticket read the same way.
	const noList = repo();
	fs.writeFileSync(path.join(noList, 'docs', 'builds', `${VERSION}.closeout.json`), '{"version":"1.51.4"');
	const ticket = one(noList, ticketed('F1'));
	assert.ok(denied(ticket), `an unreadable findings list refuses the ticketed tester, got ${JSON.stringify(ticket)}`);
	assert.match(reason(ticket), /hook error: lead review/);
	// U20-5: a ticket row that cannot be written (the spawn log is read-only after the used-ticket read, so a log row fails inside the main check) blocks, never lets the spawn through.
	const locked = repo();
	// No list file as well: the list gate then logs a row inside the main check, so the failure lands in the outer catch with a ticket pending.
	fs.rmSync(git(locked, ['rev-parse', '--path-format=absolute', '--git-path', 'kit-unit-files.txt']));
	fs.writeFileSync(modelLog(locked), '');
	fs.chmodSync(modelLog(locked), 0o444);
	const unwritable = one(locked, ticketed('F1'));
	assert.ok(denied(unwritable), `an unwritable ticket row refuses the ticketed tester, got ${JSON.stringify(unwritable)}`);
	assert.match(reason(unwritable), /hook error: lead review/);
	// A hold-mode.cjs that throws is a hook error for this high-tier hold.
	const hookDir = kitTemp.makeTemp('sweep-lock-hooks-');
	fs.cpSync(HOOK_DIR, hookDir, { recursive: true });
	fs.writeFileSync(path.join(hookDir, 'hold-mode.cjs'), "'use strict';\nexports.mode = () => { throw new Error('holds unreadable'); };\n");
	const thrown = run(repo(), [{ input: reviewer() }], hookDir)[0];
	assert.ok(denied(thrown), `a throwing hold-mode refuses the review spawn, got ${JSON.stringify(thrown)}`);
	assert.match(reason(thrown), /hook error: lead review/);
});

// why: catches bypass: a review or check role named only in the brief text, in another case, or on a Task spawn is refused the same (K399 S1)
test('bypass: a review or check role named only in the brief text, in another case, or on a Task spawn is refused the same', () => {
	const dir = repo();
	const variants = [
		['brief text only, no Role: line', { subagent_type: 'general-purpose', prompt: 'You are the reviewer for the sweep fixes. Review the diff and report findings.' }],
		['upper case Role', { subagent_type: 'general-purpose', prompt: 'ROLE: CHECKER\nPlan: PLAN.md\nUnit: U20\nCheck it.' }],
		['upper case type with a plugin prefix', { subagent_type: 'kit:Reviewer', prompt: 'Review the fixes.' }],
		['no type, review pass in the text', { prompt: 'Run a review pass over the sweep fixes against the closeout line.' }],
	];
	for (const [name, input] of variants) {
		for (const tool of ['Agent', 'Task']) {
			const d = one(dir, input, tool);
			assert.ok(denied(d), `${name} on ${tool} is refused, got ${JSON.stringify(d)}`);
			assert.match(reason(d), DEFER, `${name} on ${tool} prints the defer command`);
		}
	}
});

// why: catches repeat: the same refused spawn twice gives the same refusal and one log line each (K399 S3)
test('repeat: the same refused spawn twice gives the same refusal and one log line each', () => {
	const dir = repo();
	const [first, second] = run(dir, [{ input: checker() }, { input: checker() }]);
	assert.ok(denied(first), `the first spawn is refused, got ${JSON.stringify(first)}`);
	assert.deepEqual(second, first, 'the second try gets the same refusal');
	const rows = lockRows(dir);
	assert.equal(rows.length, 2, `one log line per refusal, got ${JSON.stringify(rows)}`);
	assert.equal(rows[0].reason, rows[1].reason);
});

// why: catches a spawn with no listed sweep role, such as Explore, Plan or an odd Role: line, passing after the sweep
test('after the sweep a spawn that is not a build role with a valid ticket is refused by default', () => {
	const dir = repo();
	const odd = [
		['an Explore spawn', { subagent_type: 'Explore', prompt: 'Look through the repo for the sweep fixes.' }],
		['a Plan spawn', { subagent_type: 'Plan', prompt: 'Plan the next steps.' }],
		['a Role: line with no listed word', general('Security: audit the sweep fixes')],
		['a lead reviewer role', general('lead reviewer of the sweep')],
		['a brief that says reviewers', { subagent_type: 'general-purpose', prompt: 'Start the reviewers on the sweep fixes.' }],
	];
	const out = run(dir, odd.map(([, input]) => ({ input })));
	out.forEach((d, i) => assert.ok(denied(d), `${odd[i][0]} is refused after the sweep, got ${JSON.stringify(d)}`));
	assert.equal(one(dir, ticketed('F1')), null, 'control: a tester with a valid ticket still goes through');
});

// why: catches the tester then builder pair for one finding being refused at the builder as a used ticket
test('one ticket allows one tester spawn and one builder spawn, and no second of either', () => {
	const dir = repo();
	const [tester, builder, tester2, builder2] = run(dir, [{ input: ticketed('F1') }, { input: ticketed('F1', 'builder') }, { input: ticketed('F1') }, { input: ticketed('F1', 'builder') }]);
	assert.equal(tester, null, `the tester for F1 goes through, got ${JSON.stringify(tester)}`);
	assert.equal(builder, null, `the builder for the same F1 goes through, got ${JSON.stringify(builder)}`);
	assert.ok(denied(tester2), `a second tester for F1 is refused, got ${JSON.stringify(tester2)}`);
	assert.ok(denied(builder2), `a second builder for F1 is refused, got ${JSON.stringify(builder2)}`);
});

// why: catches "Ticket: none" being a free pass that is never used up, so any spawn can say it
test('"Ticket: none" with no named non-ticket finding is refused, while a named medium finding goes through once', () => {
	const dir = repo();
	const [none, none2] = run(dir, [{ input: ticketed('none', 'builder') }, { input: ticketed('none', 'builder') }]);
	assert.ok(denied(none), `a bare "Ticket: none" is refused, got ${JSON.stringify(none)}`);
	assert.ok(denied(none2), `and refused again, got ${JSON.stringify(none2)}`);
	const [named, again] = run(dir, [{ input: ticketed('F2', 'builder') }, { input: ticketed('F2', 'builder') }]);
	assert.equal(named, null, `control: the named medium finding F2 goes through once, got ${JSON.stringify(named)}`);
	assert.ok(denied(again), `and is used up, got ${JSON.stringify(again)}`);
});

// why: catches a detached HEAD or a new branch at the same commit lifting the sweep lock
test('a detached HEAD or a new branch at the swept commit keeps the sweep lock', () => {
	const detached = repo();
	assert.ok(denied(one(detached, reviewer())), 'control: on the swept branch the reviewer is refused');
	git(detached, ['checkout', '-q', '--detach']);
	const d = one(detached, reviewer());
	assert.ok(denied(d), `a reviewer on a detached HEAD is refused, got ${JSON.stringify(d)}`);
	const moved = repo();
	git(moved, ['checkout', '-q', '-b', 'other-name']);
	const b = one(moved, reviewer());
	assert.ok(denied(b), `a reviewer on a new branch at the swept commit is refused, got ${JSON.stringify(b)}`);
	const none = repo({ sweep: 'none' });
	git(none, ['checkout', '-q', '--detach']);
	assert.equal(one(none, reviewer()), null, 'control: with no sweep recorded a detached HEAD changes nothing');
});
