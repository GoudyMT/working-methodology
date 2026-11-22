// U15 (build 24): the flow lock. The build flow the owner set becomes checks, all in user/kit-tools/flow-check.mjs
// (start, agents, reviews, reviewers, rounds) and one log-only row in user/kit-hooks/agent-model.cjs. Nothing here calls a
// model. Every test runs the scripts as child processes in temp folders and temp git repos, with HOME and the Claude
// config folders pointed at temp dirs. A missing script fails each test with one clear message, never the whole file.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const FLOW = here('../user/kit-tools/flow-check.mjs');
const AGENT_MODEL = here('../user/kit-hooks/agent-model.cjs');
const PLAN_GRAPH = here('../project/.claude/plan-graph.mjs');
const TESTER_MODEL = here('../user/kit-tools/tester-model.mjs');

const tmp = (p) => kitTemp.makeTemp(p);
const GIT_ID = { GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.invalid' };
function env(extra = {}) {
	const home = tmp('flow-home-');
	const config = path.join(home, '.claude');
	return { ...process.env, ...GIT_ID, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: config, KIT_CLAUDE_HOME: config, ...extra };
}
function repo() {
	const dir = tmp('flow-repo-');
	const r = spawnSync('git', ['init', '-q', '-b', 'main', dir], { env: env(), encoding: 'utf8' });
	assert.equal(r.status, 0, r.stderr);
	return dir;
}
const put = (dir, rel, text) => {
	fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
	fs.writeFileSync(path.join(dir, rel), text);
	return path.join(dir, rel);
};

// flow-check as a child process; a missing script is one failed assertion, not a silent exit 1 from node.
function flow(args, cwd = tmp('flow-cwd-')) {
	assert.ok(fs.existsSync(FLOW), 'user/kit-tools/flow-check.mjs exists');
	const r = spawnSync(process.execPath, [FLOW, ...args], { cwd, env: env(), encoding: 'utf8' });
	const out = `${r.stdout}${r.stderr}`;
	assert.ok(!/node:internal|MODULE_NOT_FOUND|SyntaxError/.test(out), `flow-check ran without crashing: ${out}`);
	return { code: r.status, out };
}
// A failure must name its cause: every caller passes the message flow-check prints for that fault.
const failed = (r, cause) => { assert.equal(r.code, 1, r.out); assert.match(r.out, cause, 'a failure names its cause'); };
const NO_LOG = /no .*log|plan-graph/i;

// A hand-back as the lead saves it: prose, RECORD:, the role line, then the lines after it.
const handBack = (role, ...lines) => ['Prose.', 'RECORD:', JSON.stringify(role), ...lines].join('\n') + '\n';
const finding = (id) => JSON.stringify({ id, severity: 'medium', status: 'open', where: 'tests/x.test.mjs:1', claim: 'a weak test here', proof: 'the run', fix: 'tighten it' });
const NOTE = (text, writer = 'lead') => JSON.stringify({ note: text, writer });
// A fix line that marks review finding <id> fixed; a fix record holding only a note does not pass.
const fixedLine = (id) => JSON.stringify({ id, severity: 'medium', status: 'fixed', where: 'tests/x.test.mjs:1', claim: 'a weak test here', proof: 'the run', fix: 'tightened it' });

// ---------------------------------------------------------------------------------------------------------------
// L1: a builder start needs the plan's latest plan-graph run to have exited 0, with the plan unchanged since.
// Choice: plan-graph logs {at, plan: basename, units, faults} and no hash, so "unchanged" is the log line's time against
// the plan file's mtime, and "exited 0" is faults == 0.
// ---------------------------------------------------------------------------------------------------------------
// A full plan: start runs plan-check first, so the plan carries the Risk, Category and Tests columns it reads.
const fullPlan = (u2File) => `# plan\n\n## Units\n\n| Id | Files | Runs | Risk | Category | Tests | Tester |\n|---|---|---|---|---|---|---|\n| U1 | \`a.txt\` | parallel | low | logic | check 1 -> S1 | |\n| U2 | \`${u2File}\` | parallel | low | logic | check 1 -> S1 | |\n`;
const PLAN_OK = fullPlan('b.txt');
const PLAN_BAD = fullPlan('a.txt');
function planRepo(text = PLAN_OK) {
	const dir = repo();
	const plan = put(dir, 'docs/plan.md', text);
	return { dir, plan, log: path.join(dir, '.git', 'kit-plan-graph.jsonl') };
}
const logLine = (over = {}) => `${JSON.stringify({ at: new Date().toISOString(), plan: 'plan.md', units: 2, faults: 0, ...over })}\n`;
const start = (plan) => flow(['start', plan, '--role', 'builder']);

// why: catches a builder start going ahead when plan-graph never ran, and a clean run refused so no builder can start
test('L1: start exits 1 when the plan has no plan-graph log line, and 0 once a clean line is logged', () => {
	const { plan, log } = planRepo();
	failed(start(plan), NO_LOG);
	// Control: a clean line, newer than the plan file, lets the start through.
	const old = new Date(Date.now() - 60000);
	fs.utimesSync(plan, old, old);
	fs.writeFileSync(log, logLine());
	const r = start(plan);
	assert.equal(r.code, 0, r.out);
});

// why: catches a plan saved in the same instant as its clean run being refused by a strict comparison
test('L1: start exits 0 when the plan mtime equals the log line time', () => {
	const { plan, log } = planRepo();
	const at = new Date(Date.now() - 60000);
	fs.utimesSync(plan, at, at);
	fs.writeFileSync(log, logLine({ at: at.toISOString() }));
	const r = start(plan);
	assert.equal(r.code, 0, r.out);
});

// why: catches a builder starting on a plan whose graph still shows shared files
test('L1: start exits 1 when the latest plan-graph run reported faults', () => {
	const { plan, log } = planRepo();
	const old = new Date(Date.now() - 60000);
	fs.utimesSync(plan, old, old);
	fs.writeFileSync(log, logLine({ faults: 2 }));
	failed(start(plan), /fault/i);
});

// why: catches a plan edited after its graph run still passing on the old clean result
test('L1: start exits 1 when the plan file changed after the plan-graph run', () => {
	const { plan, log } = planRepo();
	fs.writeFileSync(log, logLine());
	const later = new Date(Date.now() + 120000);
	fs.utimesSync(plan, later, later);
	failed(start(plan), /changed|newer|after/i);
});

// why: catches an older clean line hiding a newer faulty run, and an older faulty line blocking a start after a clean re-run
test('L1: the latest log line for the plan wins, whichever of two lines is older', () => {
	const { plan, log } = planRepo();
	const old = new Date(Date.now() - 120000);
	fs.utimesSync(plan, old, old);
	fs.writeFileSync(log, logLine({ at: new Date(Date.now() - 60000).toISOString() }) + logLine({ faults: 1 }));
	failed(start(plan), /fault/i);
	// Control: the faulty line older, the clean one newer, lets the start through.
	fs.writeFileSync(log, logLine({ at: new Date(Date.now() - 60000).toISOString(), faults: 3 }) + logLine());
	const r = start(plan);
	assert.equal(r.code, 0, r.out);
});

// why: catches another plan's clean run being taken as this plan's proof
test('L1: a clean log line for a different plan file name does not let this plan start', () => {
	const { plan, log } = planRepo();
	const old = new Date(Date.now() - 60000);
	fs.utimesSync(plan, old, old);
	fs.writeFileSync(log, logLine({ plan: 'other-plan.md' }));
	failed(start(plan), NO_LOG);
});

// why: catches the start check and the real plan-graph disagreeing about the log they share
test('L1: a real plan-graph run on a clean plan lets the builder start; on a shared-file plan it does not', () => {
	assert.ok(fs.existsSync(PLAN_GRAPH), 'plan-graph.mjs exists');
	const clean = planRepo(PLAN_OK);
	const old = new Date(Date.now() - 60000);
	fs.utimesSync(clean.plan, old, old);
	const g1 = spawnSync(process.execPath, [PLAN_GRAPH, clean.plan], { env: env(), encoding: 'utf8' });
	assert.equal(g1.status, 0, g1.stdout + g1.stderr);
	assert.equal(start(clean.plan).code, 0);
	const bad = planRepo(PLAN_BAD);
	fs.utimesSync(bad.plan, old, old);
	const g2 = spawnSync(process.execPath, [PLAN_GRAPH, bad.plan], { env: env(), encoding: 'utf8' });
	assert.equal(g2.status, 1, g2.stdout + g2.stderr);
	failed(start(bad.plan), /fault/i);
});

// ---------------------------------------------------------------------------------------------------------------
// L3/L4: one agent id is not tester and builder, holds at most 3 units and at most 2 lanes.
// ---------------------------------------------------------------------------------------------------------------
// One saved hand-back per entry of specs: { agent, role, unit, lane }.
function records(specs) {
	const dir = tmp('flow-agents-');
	specs.forEach((s, i) => {
		const role = { role: s.role || 'builder', commit: 'abc1234', agent: s.agent };
		if (s.unit) role.unit = s.unit;
		if (s.lane) role.lane = s.lane;
		put(dir, `rec${i}.jsonl`, handBack(role, NOTE('done', s.role || 'builder')));
	});
	return dir;
}
const agents = (dir) => flow(['agents', dir]);

// why: catches one agent writing the tests and the code, and a fresh clean team refused by the role-split check
test('L3: agents exits 1 when one agent id is both tester and builder, and 0 when the ids differ or one builds two units', () => {
	const r = agents(records([{ agent: 'a1', role: 'tester', unit: 'U1', lane: 'A' }, { agent: 'a1', role: 'builder', unit: 'U1', lane: 'A' }]));
	failed(r, /agent a1 is both tester and builder/);
	// Control: testers and builders under different agent ids pass.
	const split = agents(records([{ agent: 'a1', role: 'tester', unit: 'U1', lane: 'A' }, { agent: 'a2', role: 'builder', unit: 'U1', lane: 'A' }]));
	assert.equal(split.code, 0, split.out);
	// Control: one agent id as builder on two units is one role repeated, not a mix of two roles, so it passes.
	const twoUnits = agents(records([{ agent: 'a2', unit: 'U1', lane: 'A' }, { agent: 'a2', unit: 'U2', lane: 'A' }]));
	assert.equal(twoUnits.code, 0, twoUnits.out);
});

// why: catches an agent piling up units until its context is stale
test('L4: agents exits 1 when one agent holds 4 units', () => {
	const r = agents(records(['U1', 'U2', 'U3', 'U4'].map((unit) => ({ agent: 'a3', unit, lane: 'A' }))));
	failed(r, /agent a3 holds 4 units, max 3/);
});

// why: catches the unit cap being set one too low and refusing a legal 3 units
test('L4: agents exits 0 when one agent holds exactly 3 units', () => {
	const r = agents(records(['U1', 'U2', 'U3'].map((unit) => ({ agent: 'a3', unit, lane: 'A' }))));
	assert.equal(r.code, 0, r.out);
});

// why: catches two records for one unit counting as two units
test('L4: agents counts distinct units, so four records on 3 units pass', () => {
	const r = agents(records(['U1', 'U1', 'U2', 'U3'].map((unit) => ({ agent: 'a3', unit, lane: 'A' }))));
	assert.equal(r.code, 0, r.out);
});

// why: catches an agent spread over three lanes, which no one can follow
test('L4: agents exits 1 when one agent holds 3 lanes', () => {
	const r = agents(records(['A', 'B', 'C'].map((lane, i) => ({ agent: 'a4', unit: `U${i}`, lane }))));
	failed(r, /agent a4 works 3 lanes, max 2/);
});

// why: catches the lane cap being set one too low and refusing a legal 2 lanes
test('L4: agents exits 0 when one agent holds exactly 2 lanes', () => {
	const r = agents(records(['A', 'B'].map((lane, i) => ({ agent: 'a4', unit: `U${i}`, lane }))));
	assert.equal(r.code, 0, r.out);
});

// why: catches the check reading only the first file in the folder
test('L3: agents finds the fault in the last of several saved hand-backs', () => {
	const r = agents(records([{ agent: 'b1', role: 'builder', unit: 'U1' }, { agent: 'b2', role: 'builder', unit: 'U2' }, { agent: 'b3', role: 'tester', unit: 'U3' }, { agent: 'b3', role: 'builder', unit: 'U4' }]));
	failed(r, /agent b3 is both tester and builder/);
	// Folded control: a .jsonl with no RECORD block and a non-jsonl file are ignored.
	const clean = records([{ agent: 'a1', role: 'tester', unit: 'U1', lane: 'A' }, { agent: 'a2', role: 'builder', unit: 'U1', lane: 'A' }]);
	put(clean, 'stray.jsonl', `${JSON.stringify({ role: 'builder', commit: 'abc1234', agent: 'a1', unit: 'U9' })}\n`);
	put(clean, 'notes.txt', handBack({ role: 'builder', commit: 'abc1234', agent: 'a1', unit: 'U8' }, NOTE('x')));
	const ok = agents(clean);
	assert.equal(ok.code, 0, ok.out);
});

// ---------------------------------------------------------------------------------------------------------------
// L6: one review record and one fix record per unit, then the builder. Files: <unit>.review*.jsonl, <unit>.fix.jsonl.
// ---------------------------------------------------------------------------------------------------------------
const REVIEW_ROLE = { role: 'test-reviewer', commit: 'abc1234' };
function reviewDir({ review, fix, second } = {}) {
	const dir = tmp('flow-reviews-');
	if (review !== undefined) put(dir, 'U1.review.jsonl', handBack(REVIEW_ROLE, ...review));
	if (second !== undefined) put(dir, 'U1.review2.jsonl', handBack(REVIEW_ROLE, ...second));
	if (fix !== undefined) put(dir, 'U1.fix.jsonl', handBack({ role: 'tester', commit: 'abc1234' }, ...fix));
	return dir;
}
const reviews = (dir, unit = 'U1') => flow(['reviews', unit, '--dir', dir]);

// why: catches a builder starting with no test review at all
test('L6: reviews exits 1 when the unit has no review record', () => {
	failed(reviews(reviewDir()), /review/i);
});

// why: catches a builder starting before the tester fixed the review findings
test('L6: reviews exits 1 when the review has findings and there is no fix record', () => {
	failed(reviews(reviewDir({ review: [finding('R1')] })), /fix/i);
});

// why: catches a finished review and fix pair being refused so the builder never starts
test('L6: reviews exits 0 with one review record that has findings and one fix record', () => {
	const r = reviews(reviewDir({ review: [finding('R1')], fix: [fixedLine('R1')] }));
	assert.equal(r.code, 0, r.out);
});

// why: catches a clean review being made to wait for a fix record that has nothing to fix
test('L6: reviews exits 0 with a review that has no findings and no fix record', () => {
	const r = reviews(reviewDir({ review: [NOTE('no findings', 'test-reviewer')] }));
	assert.equal(r.code, 0, r.out);
});

// why: catches a second review slipping in with no reason, which hides a repeat loop
test('L6: reviews exits 1 on a second review record with no second-review note', () => {
	failed(reviews(reviewDir({ review: [finding('R1')], second: [finding('R2')], fix: [fixedLine('R1'), fixedLine('R2')] })), /second review of U1 with no lead note/);
});

// why: catches the lead's reasoned second review being refused
test('L6: reviews exits 0 on a second review record that holds the lead second-review note', () => {
	const r = reviews(reviewDir({ review: [finding('R1')], second: [NOTE('second review: the fix changed the test shape'), finding('R2')], fix: [fixedLine('R1'), fixedLine('R2')] }));
	assert.equal(r.code, 0, r.out);
});

// why: catches a note written by someone other than the lead opening the second review
test('L6: reviews exits 1 when the second-review note is written by the tester, not the lead', () => {
	failed(reviews(reviewDir({ review: [finding('R1')], second: [NOTE('second review: I want one', 'tester'), finding('R2')], fix: [fixedLine('R1'), fixedLine('R2')] })), /second review of U1 with no lead note/);
});

// why: catches another unit's review record counting for this unit
test('L6: reviews for U2 ignores the U1 records', () => {
	failed(reviews(reviewDir({ review: [finding('R1')], fix: [fixedLine('R1')] }), 'U2'), /no review for U2/);
	// Folded control: U10 records do not count for U1, including an unexplained second U10 review.
	const dir = reviewDir({ review: [finding('R1')], fix: [fixedLine('R1')] });
	put(dir, 'U10.review.jsonl', handBack(REVIEW_ROLE, finding('R9')));
	put(dir, 'U10.review2.jsonl', handBack(REVIEW_ROLE, finding('R10')));
	const ok = reviews(dir);
	assert.equal(ok.code, 0, ok.out);
});

// ---------------------------------------------------------------------------------------------------------------
// L7: more than 3 units waiting for review while only one reviewer is active is a fault, named by its time.
// ---------------------------------------------------------------------------------------------------------------
const T = (min) => `2026-11-22T10:${String(min).padStart(2, '0')}:00.000Z`;
const ev = (min, unit, event, reviewer = 'r1') => JSON.stringify({ at: T(min), unit, event, reviewer });
function ledger(lines) {
	return put(tmp('flow-ledger-'), 'ledger.jsonl', lines.join('\n') + '\n');
}
const reviewers = (file) => flow(['reviewers', file]);

// why: catches a review queue growing behind one reviewer with no alarm
test('L7: reviewers exits 1 and names the time when a 4th unit waits while one reviewer is active', () => {
	const r = reviewers(ledger([ev(0, 'U1', 'review-start'), ev(1, 'U2', 'review-wait'), ev(2, 'U3', 'review-wait'), ev(3, 'U4', 'review-wait'), ev(4, 'U5', 'review-wait')]));
	failed(r, /4 units wait for review \(U2, U3, U4, U5\) with 1 active reviewer/);
	assert.ok(r.out.includes(T(4)) || r.out.includes('10:04'), `names the time of the fourth waiting unit: ${r.out}`);
});

// why: catches the limit being set one too low and alarming at 3 waiting units
test('L7: reviewers exits 0 with exactly 3 units waiting and one reviewer active', () => {
	const r = reviewers(ledger([ev(0, 'U1', 'review-start'), ev(1, 'U2', 'review-wait'), ev(2, 'U3', 'review-wait'), ev(3, 'U4', 'review-wait')]));
	assert.equal(r.code, 0, r.out);
});

// why: catches a second reviewer not relieving the alarm
test('L7: reviewers exits 0 with 4 units waiting while two reviewers are active', () => {
	const r = reviewers(ledger([ev(0, 'U1', 'review-start', 'r1'), ev(0, 'U6', 'review-start', 'r2'), ev(1, 'U2', 'review-wait'), ev(2, 'U3', 'review-wait'), ev(3, 'U4', 'review-wait'), ev(4, 'U5', 'review-wait')]));
	assert.equal(r.code, 0, r.out);
});

// why: catches units that started review still being counted as waiting
test('L7: reviewers exits 0 when each waiting unit starts review before the queue passes 3', () => {
	const r = reviewers(ledger([ev(0, 'U1', 'review-start'), ev(1, 'U2', 'review-wait'), ev(2, 'U3', 'review-wait'), ev(3, 'U2', 'review-start'), ev(4, 'U4', 'review-wait'), ev(5, 'U5', 'review-wait'), ev(6, 'U3', 'review-start'), ev(7, 'U6', 'review-wait')]));
	assert.equal(r.code, 0, r.out);
});

// why: catches a queue with no active reviewer at all passing as quiet
test('L7: reviewers exits 1 when no reviewer is active and 4 units are waiting', () => {
	const r = reviewers(ledger([ev(0, 'U1', 'review-start'), ev(1, 'U1', 'review-done'), ev(2, 'U2', 'review-wait'), ev(3, 'U3', 'review-wait'), ev(4, 'U4', 'review-wait'), ev(5, 'U5', 'review-wait')]));
	failed(r, /4 units wait for review \(U2, U3, U4, U5\) with 0 active reviewer/);
});

// why: catches a reviewer that finished still being counted as active, hiding a one-reviewer queue
test('L7: reviewers exits 1 when r1 and r2 started, r2 finished, and 4 units are waiting', () => {
	const r = reviewers(ledger([ev(0, 'U1', 'review-start', 'r1'), ev(0, 'U6', 'review-start', 'r2'), ev(1, 'U6', 'review-done', 'r2'), ev(2, 'U2', 'review-wait'), ev(3, 'U3', 'review-wait'), ev(4, 'U4', 'review-wait'), ev(5, 'U5', 'review-wait')]));
	failed(r, /4 units wait for review \(U2, U3, U4, U5\) with 1 active reviewer/);
});

// ---------------------------------------------------------------------------------------------------------------
// L9: the checker is for risky units only (a unit whose Files hit GUARD_PATHS), and a unit gets at most 2 FIX rounds.
// ---------------------------------------------------------------------------------------------------------------
// Each test that needs GUARD_PATHS imports the tester-model copy inside the test, so a missing tester-model fails that test on an assertion, not the whole file at load.
const importTesterGuard = async () => {
	assert.ok(fs.existsSync(TESTER_MODEL), 'user/kit-tools/tester-model.mjs exists');
	return (await import(pathToFileURL(TESTER_MODEL).href)).GUARD_PATHS;
};
const hookText = () => {
	assert.ok(fs.existsSync(AGENT_MODEL), 'user/kit-hooks/agent-model.cjs exists');
	return fs.readFileSync(AGENT_MODEL, 'utf8');
};
function planWith(files) {
	return put(tmp('flow-plan-'), 'plan.md', `# plan\n\n## Units\n\n| Id | Files | Runs |\n|---|---|---|\n| U1 | ${files.map((f) => `\`${f}\``).join(', ')} | parallel |\n`);
}
function runHook(prompt, { type = 'checker' } = {}) {
	assert.ok(fs.existsSync(AGENT_MODEL), 'agent-model.cjs exists');
	const hookDir = tmp('flow-hook-');
	fs.copyFileSync(AGENT_MODEL, path.join(hookDir, 'agent-model.cjs'));
	fs.writeFileSync(path.join(hookDir, 'hold-mode.cjs'), `'use strict';\nmodule.exports = { mode() { return 'enforce'; } };\n`);
	const config = tmp('flow-config-');
	for (const t of ['checker', 'builder']) put(config, `agents/${t}.md`, `---\nname: ${t}\nmodel: opus\n---\nrole\n`);
	const dir = repo();
	const script = `const m = require(${JSON.stringify(path.join(hookDir, 'agent-model.cjs'))}); process.stdout.write(JSON.stringify(m.check({ tool_name: 'Agent', tool_input: { subagent_type: ${JSON.stringify(type)}, prompt: ${JSON.stringify(prompt)} }, cwd: ${JSON.stringify(dir)} })));`;
	const r = spawnSync(process.execPath, ['-e', script], { env: env({ KIT_CLAUDE_HOME: config, CLAUDE_CONFIG_DIR: config }), encoding: 'utf8' });
	assert.equal(r.status, 0, r.stderr);
	assert.equal(r.stdout, 'null', 'the hook never refuses');
	const log = path.join(dir, '.git', 'kit-agent-model.log');
	return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
}
const whys = (rows) => rows.map((r) => r.why);




// why: guards rule:agent-team-adapter (the non-risky row fires only for a checker on a non-risky unit, never for a builder or a Risk high unit)
test('L9: on one non-risky unit the checker call logs the row; a builder call and a Risk high unit log nothing', () => {
	assert.match(hookText(), /checker on a non-risky unit/, 'agent-model.cjs holds the non-risky checker row');
	const plan = planWith(['src/app.js']);
	const prompt = `Unit: U1\nPlan: ${plan}\n`;
	assert.ok(whys(runHook(prompt, { type: 'checker' })).includes('checker on a non-risky unit'));
	assert.ok(!whys(runHook(prompt, { type: 'builder' })).includes('checker on a non-risky unit'));
	// Risk high unit: its Files cell names a guard path, so the checker call logs no non-risky row and no other row.
	const risky = put(tmp('flow-plan-'), 'plan.md', '# plan\n\n## Units\n\n| Id | Files | Risk | Runs |\n|---|---|---|---|\n| U1 | `user/kit-hooks/agent-model.cjs` | high | parallel |\n');
	assert.deepEqual(whys(runHook(`Unit: U1\nPlan: ${risky}\n`, { type: 'checker' })), [], 'a risky checker call logs nothing');
});

// why: guards rule:agent-team-adapter (checker call with no plan passes unseen)
test('L9: a checker call with no Plan line logs "checker with no plan named" and is not refused', () => {
	assert.match(hookText(), /checker with no plan named/, 'agent-model.cjs holds the no-plan checker row');
	assert.ok(whys(runHook('Review this.\nUnit: U1\n')).includes('checker with no plan named'));
});

// FIX rounds: <unit>.checker*.jsonl, each a whole hand-back; a FIX record holds a line /^VERDICT:\s*FIX\b/m.
function checkerDir(verdicts, unit = 'U1') {
	const dir = tmp('flow-rounds-');
	verdicts.forEach((v, i) => put(dir, `${unit}.checker${i + 1}.jsonl`, `VERDICT: ${v}\nProse.\nRECORD:\n${JSON.stringify({ role: 'checker', commit: 'abc1234' })}\n${NOTE('checked', 'checker')}\n`));
	return dir;
}
const rounds = (dir, unit = 'U1') => flow(['rounds', unit, '--dir', dir]);

// why: catches a third fix round on one unit, which means the unit needs the lead, not another loop
test('L9: rounds exits 1 when a third FIX checker record exists for the unit', () => {
	assert.ok(fs.existsSync(FLOW), 'user/kit-tools/flow-check.mjs exists');
	failed(rounds(checkerDir(['FIX', 'FIX', 'FIX'])), /U1 has 3 FIX rounds from the checker, max 2/);
});

// why: catches the round cap being set one too low and stopping a legal second fix
test('L9: rounds exits 0 with two FIX checker records', () => {
	assert.ok(fs.existsSync(FLOW), 'user/kit-tools/flow-check.mjs exists');
	const r = rounds(checkerDir(['FIX', 'FIX']));
	assert.equal(r.code, 0, r.out);
});

// why: catches PASS records counting as fix rounds
test('L9: rounds exits 0 with three checker records of which only two are FIX', () => {
	assert.ok(fs.existsSync(FLOW), 'user/kit-tools/flow-check.mjs exists');
	const r = rounds(checkerDir(['FIX', 'PASS', 'FIX']));
	assert.equal(r.code, 0, r.out);
});

// why: catches another unit's FIX records counting against this unit
test('L9: rounds for U2 ignores three FIX records of U1', () => {
	assert.ok(fs.existsSync(FLOW), 'user/kit-tools/flow-check.mjs exists');
	const r = rounds(checkerDir(['FIX', 'FIX', 'FIX']), 'U2');
	assert.equal(r.code, 0, r.out);
});

// why: catches three U10 FIX records counted against unit U1 because the names share a prefix
test('L9: rounds U1 ignores three FIX records of U10', () => {
	assert.ok(fs.existsSync(FLOW), 'user/kit-tools/flow-check.mjs exists');
	const dir = checkerDir(['FIX', 'FIX']);
	for (const n of [1, 2, 3]) put(dir, `U10.checker${n}.jsonl`, `VERDICT: FIX\nRECORD:\n${JSON.stringify({ role: 'checker', commit: 'abc1234' })}\n`);
	const r = rounds(dir);
	assert.equal(r.code, 0, r.out);
});

// why: catches VERDICT: FIXED or a mid-line VERDICT: FIX being counted as a FIX round
test('L9: rounds exits 0 with three records holding VERDICT: FIXED or a mid-line VERDICT: FIX', () => {
	assert.ok(fs.existsSync(FLOW), 'user/kit-tools/flow-check.mjs exists');
	const dir = tmp('flow-rounds-');
	const body = `RECORD:\n${JSON.stringify({ role: 'checker', commit: 'abc1234' })}\n${NOTE('checked', 'checker')}\n`;
	put(dir, 'U1.checker1.jsonl', `VERDICT: FIXED\n${body}`);
	put(dir, 'U1.checker2.jsonl', `The checker said VERDICT: FIX in prose.\n${body}`);
	put(dir, 'U1.checker3.jsonl', `VERDICT: FIXED\n${body}`);
	const r = rounds(dir);
	assert.equal(r.code, 0, r.out);
	// Exact count: one record read as FIX would still exit 0 under the cap of 2, so the printed count of 0 is the proof.
	assert.match(r.out, /rounds: U1 has 0 FIX round\(s\), max 2/);
});

// why: guards rule:agent-team-adapter (hook GUARD_PATHS drifts from the tester-model copy)
test('L9: the hook GUARD_PATHS equals tester-model GUARD_PATHS', async () => {
	hookText();
	const hook = createRequire(import.meta.url)(AGENT_MODEL);
	assert.ok('GUARD_PATHS' in hook, 'agent-model.cjs exports GUARD_PATHS');
	assert.deepEqual(hook.GUARD_PATHS, await importTesterGuard());
});

// ---------------------------------------------------------------------------------------------------------------
// H2-H5 (build 24 sweep fixes): the agent check names what it cannot read, the review check needs fixed lines,
// the overwatch steps name the lock and unit check, and lanes.mjs refuses a plan it cannot read.
// ---------------------------------------------------------------------------------------------------------------
const LANES = here('../user/kit-tools/lanes.mjs');
const SKILL = here('../user/skills/agent-team-build/SKILL.md');

// why: catches start letting a builder go ahead on a plan plan-check refuses, or on another plan.md's clean log by basename (L1).
test('L1 start: refuses a plan plan-check refuses, matches the log by full path, and a clean run of this plan still starts', () => {
	const PLAN_CHECK = here('../user/kit-tools/plan-check.mjs');
	const FULL_PLAN = (category) => `# plan\n\n## Units\n\n| Id | Files | Runs | Risk | Category | Tests | Tester |\n|---|---|---|---|---|---|---|\n| U1 | \`a.txt\` | parallel | low | ${category} | check 1 -> S1 | |\n| U2 | \`b.txt\` | parallel | low | logic | check 1 -> S1 | |\n`;
	const dir = repo();
	const clean = put(dir, 'docs/plan.md', FULL_PLAN('logic'));
	const bad = put(dir, 'bad/plan.md', FULL_PLAN(''));
	const elsewhere = put(dir, 'elsewhere/plan.md', FULL_PLAN('logic'));
	const graph = (p) => spawnSync(process.execPath, [PLAN_GRAPH, p], { cwd: dir, env: env(), encoding: 'utf8' });
	const check = (p) => spawnSync(process.execPath, [PLAN_CHECK, p], { cwd: dir, env: env(), encoding: 'utf8' });
	// Control: a plan plan-check accepts, with its own clean plan-graph run, starts.
	assert.equal(check(clean).status, 0, 'the control plan passes plan-check');
	assert.equal(graph(clean).status, 0);
	assert.equal(start(clean).code, 0, start(clean).out);
	// Red 1: plan-check refuses the empty Category, yet plan-graph runs clean on it, so start must still refuse it.
	assert.equal(check(bad).status, 1, 'plan-check refuses the empty Category');
	assert.equal(graph(bad).status, 0);
	failed(start(bad), /Category|plan-check/i);
	// Red 2: a plan.md at another path has no plan-graph run of its own; the clean log of the plan above must not count for it.
	failed(start(elsewhere), NO_LOG);
});

// why: catches a documented hand-back with no agent key being skipped silently, so its tester and builder identity is never checked (H2).
test('H2 agents: role lines with no agent key are named and exit 1; a keyed hand-back is not named', () => {
	const dir = tmp('flow-agents-');
	put(dir, 'U1.tester.jsonl', handBack({ role: 'tester', commit: 'abc1234', clarity: 'clear' }, NOTE('done', 'tester')));
	put(dir, 'U1.builder.jsonl', handBack({ role: 'builder', commit: 'abc1234' }, NOTE('done', 'builder')));
	// Control: a hand-back with an agent key and an exact RECORD: line is not named.
	put(dir, 'U9.builder.jsonl', handBack({ role: 'builder', commit: 'abc1234', agent: 'a9', unit: 'U9' }, NOTE('done', 'builder')));
	const r = agents(dir);
	assert.equal(r.code, 1, r.out);
	assert.match(r.out, /U1\.tester\.jsonl/, r.out);
	assert.match(r.out, /U1\.builder\.jsonl/, r.out);
	assert.doesNotMatch(r.out, /U9\.builder\.jsonl/, r.out);
});

// why: catches a .jsonl whose RECORD: marker is misspelled being skipped with no word, so its role is never read (H2).
test('H2 agents: a .jsonl with no exact RECORD: line is named and exits 1; a keyed hand-back is not named', () => {
	const dir = tmp('flow-agents-');
	put(dir, 'U1.builder.jsonl', `Prose.\nRECORD :\n${JSON.stringify({ role: 'builder', commit: 'abc1234', agent: 'a1', unit: 'U1' })}\n${NOTE('done')}\n`);
	// Control: a hand-back with an agent key and an exact RECORD: line is not named.
	put(dir, 'U9.builder.jsonl', handBack({ role: 'builder', commit: 'abc1234', agent: 'a9', unit: 'U9' }, NOTE('done')));
	const r = agents(dir);
	assert.equal(r.code, 1, r.out);
	assert.match(r.out, /U1\.builder\.jsonl/, r.out);
	assert.doesNotMatch(r.out, /U9\.builder\.jsonl/, r.out);
});

// why: catches a fix file that never marks a review finding fixed passing review, so an unfixed finding reaches the builder (H3).
test('H3 reviews: a fix file that does not mark review finding R1 fixed is refused, and one with a fixed line passes', () => {
	failed(reviews(reviewDir({ review: [finding('R1')], fix: [NOTE('fixed R1', 'tester')] })), /R1/);
	// Control: a fixed line for R1 in the fix record passes.
	const ok = reviews(reviewDir({ review: [finding('R1')], fix: [fixedLine('R1')] }));
	assert.equal(ok.code, 0, ok.out);
});

// why: catches a second review's findings going unchecked for fixes, so R2 ships unfixed behind a passing R1 (H3).
test('H3 reviews: a second review finding R2 with no fixed line is refused and named, and fixed lines for R1 and R2 pass', () => {
	const second = [NOTE('second review: the fix changed the test shape'), finding('R2')];
	failed(reviews(reviewDir({ review: [finding('R1')], second, fix: [fixedLine('R1')] })), /R2/);
	// Control: with fixed lines for R1 and R2 the same two reviews pass.
	const ok = reviews(reviewDir({ review: [finding('R1')], second, fix: [fixedLine('R1'), fixedLine('R2')] }));
	assert.equal(ok.code, 0, ok.out);
});

// why: catches the overwatch steps never naming the lock and the unit check, so a builder runs on an unlocked row (H4).
test('H4 SKILL.md: the overwatch steps name plan-check --lock and unit-check --plan --unit', () => {
	const text = fs.readFileSync(SKILL, 'utf8');
	const at = text.indexOf('## The overwatch lead');
	const end = text.indexOf('## Who decides');
	assert.ok(at >= 0 && end > at, 'SKILL.md has the overwatch section and the Who decides section after it');
	const section = text.slice(at, end);
	assert.match(section, /plan-check(\.mjs)?\b[^\n]*--lock/);
	assert.match(section, /unit-check(\.mjs)?\b[^\n]*--plan[^\n]*--unit/);
});

// why: catches the split step naming lanes.mjs, a sweep-findings tool, for splitting a plan's units (H5).
test('H5 SKILL.md: the plan-and-split step names plan-graph for the unit split and does not name lanes.mjs there', () => {
	const text = fs.readFileSync(SKILL, 'utf8');
	const step = text.split('\n').find((l) => l.includes('**Plan and split.**'));
	assert.ok(step, 'SKILL.md has the Plan and split step');
	assert.match(step, /plan-graph/);
	assert.doesNotMatch(step, /lanes\.mjs/);
});

// why: catches lanes.mjs printing nothing and exiting 0 for a markdown plan, so a build's units are never split into lanes (H5).
test('H5 lanes: a markdown plan exits 2 with stderr and empty stdout; controls: all-fixed prints nothing, one open finding prints one lane', () => {
	const dir = tmp('flow-lanes-');
	const lanes = (file) => spawnSync(process.execPath, [LANES, file], { cwd: dir, env: env(), encoding: 'utf8' });
	const plan = put(dir, 'plan.md', '# plan\n\n## Units\n\n| Id | Files | Runs |\n|---|---|---|\n| U1 | `a.txt` | parallel |\n');
	const r = lanes(plan);
	assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
	assert.equal(r.stdout, '');
	assert.ok(r.stderr.trim() !== '', 'a stderr message names the problem');
	// Control: a findings file where every finding is fixed exits 0 with empty stdout.
	const fixed = put(dir, 'fixed.jsonl', `${JSON.stringify({ id: 'F1', severity: 'high', status: 'fixed', where: 'a.js:1', claim: 'c', proof: 'p', fix: 'f' })}\n`);
	const done = lanes(fixed);
	assert.equal(done.status, 0, `${done.stdout}${done.stderr}`);
	assert.equal(done.stdout, '');
	// Control: one valid open finding exits 0 and prints one lane line.
	const open = put(dir, 'open.jsonl', `${JSON.stringify({ id: 'F2', severity: 'high', status: 'open', where: 'a.js:1', claim: 'c', proof: 'p', fix: 'f' })}\n`);
	const one = lanes(open);
	assert.equal(one.status, 0, `${one.stdout}${one.stderr}`);
	const rows = one.stdout.split('\n').filter((l) => l.trim() !== '');
	assert.equal(rows.length, 1, one.stdout);
	assert.deepEqual(JSON.parse(rows[0]).findings, ['F2']);
});

// why: catches a PASS record quoting a FIX verdict being counted as a fix round
test('L9: rounds exits 0 when a PASS record quotes an earlier VERDICT: FIX line', () => {
	assert.ok(fs.existsSync(FLOW), 'user/kit-tools/flow-check.mjs exists');
	const dir = checkerDir(['FIX', 'FIX']);
	put(dir, 'U1.checker3.jsonl', `VERDICT: PASS\nThe earlier checker wrote:\nVERDICT: FIX\nRECORD:\n${JSON.stringify({ role: 'checker', commit: 'abc1234' })}\n${NOTE('checked', 'checker')}\n`);
	const r = rounds(dir);
	assert.equal(r.code, 0, r.out);
});
