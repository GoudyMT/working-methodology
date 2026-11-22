// U15 (build 24): the flow lock. The build flow the owner set becomes checks, all in user/kit-tools/flow-check.mjs
// (start, agents, reviews, reviewers, rounds) and one log-only row in user/kit-hooks/agent-model.cjs. Nothing here calls a
// model. Every test runs the scripts as child processes in temp folders and temp git repos, with HOME and the Claude
// config folders pointed at temp dirs. A missing script fails each test with one clear message, never the whole file.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const FLOW = path.resolve('user/kit-tools/flow-check.mjs');
const AGENT_MODEL = path.resolve('user/kit-hooks/agent-model.cjs');
const PLAN_GRAPH = path.resolve('project/.claude/plan-graph.mjs');
const TESTER_MODEL = path.resolve('user/kit-tools/tester-model.mjs');

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
const failed = (r) => { assert.equal(r.code, 1, r.out); assert.ok(r.out.trim().length > 0, 'a failure names its cause'); };

// A hand-back as the lead saves it: prose, RECORD:, the role line, then the lines after it.
const handBack = (role, ...lines) => ['Prose.', 'RECORD:', JSON.stringify(role), ...lines].join('\n') + '\n';
const finding = (id) => JSON.stringify({ id, severity: 'medium', status: 'open', where: 'tests/x.test.mjs:1', claim: 'a weak test here', proof: 'the run', fix: 'tighten it' });
const NOTE = (text, writer = 'lead') => JSON.stringify({ note: text, writer });

// ---------------------------------------------------------------------------------------------------------------
// L1: a builder start needs the plan's latest plan-graph run to have exited 0, with the plan unchanged since.
// Choice: plan-graph logs {at, plan: basename, units, faults} and no hash, so "unchanged" is the log line's time against
// the plan file's mtime, and "exited 0" is faults == 0.
// ---------------------------------------------------------------------------------------------------------------
const PLAN_OK = '# plan\n\n## Units\n\n| Id | Files | Runs |\n|---|---|---|\n| U1 | `a.txt` | parallel |\n| U2 | `b.txt` | parallel |\n';
const PLAN_BAD = '# plan\n\n## Units\n\n| Id | Files | Runs |\n|---|---|---|\n| U1 | `a.txt` | parallel |\n| U2 | `a.txt` | parallel |\n';
function planRepo(text = PLAN_OK) {
	const dir = repo();
	const plan = put(dir, 'docs/plan.md', text);
	return { dir, plan, log: path.join(dir, '.git', 'kit-plan-graph.jsonl') };
}
const logLine = (over = {}) => `${JSON.stringify({ at: new Date().toISOString(), plan: 'plan.md', units: 2, faults: 0, ...over })}\n`;
const start = (plan) => flow(['start', plan, '--role', 'builder']);

// why: catches a builder start going ahead when plan-graph never ran on the plan
test('L1: start exits 1 when the plan has no plan-graph log line', () => {
	const { plan } = planRepo();
	failed(start(plan));
});

// why: catches a clean plan-graph run being refused so no builder can ever start
test('L1: start exits 0 when the latest log line has no faults and is newer than the plan file', () => {
	const { plan, log } = planRepo();
	const old = new Date(Date.now() - 60000);
	fs.utimesSync(plan, old, old);
	fs.writeFileSync(log, logLine());
	const r = start(plan);
	assert.equal(r.code, 0, r.out);
});

// why: catches a builder starting on a plan whose graph still shows shared files
test('L1: start exits 1 when the latest plan-graph run reported faults', () => {
	const { plan, log } = planRepo();
	const old = new Date(Date.now() - 60000);
	fs.utimesSync(plan, old, old);
	fs.writeFileSync(log, logLine({ faults: 2 }));
	failed(start(plan));
});

// why: catches a plan edited after its graph run still passing on the old clean result
test('L1: start exits 1 when the plan file changed after the plan-graph run', () => {
	const { plan, log } = planRepo();
	fs.writeFileSync(log, logLine());
	const later = new Date(Date.now() + 120000);
	fs.utimesSync(plan, later, later);
	failed(start(plan));
});

// why: catches an older clean line hiding a newer faulty run
test('L1: the latest log line for the plan wins over an older clean one', () => {
	const { plan, log } = planRepo();
	const old = new Date(Date.now() - 120000);
	fs.utimesSync(plan, old, old);
	fs.writeFileSync(log, logLine({ at: new Date(Date.now() - 60000).toISOString() }) + logLine({ faults: 1 }));
	failed(start(plan));
});

// why: catches an older faulty line blocking a start after the plan was fixed and re-run
test('L1: a later clean line wins over an older faulty one', () => {
	const { plan, log } = planRepo();
	const old = new Date(Date.now() - 120000);
	fs.utimesSync(plan, old, old);
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
	failed(start(plan));
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
	failed(start(bad.plan));
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

// why: catches one agent writing the tests and the code, which removes the second pair of eyes
test('L3: agents exits 1 when one agent id is both tester and builder', () => {
	const r = agents(records([{ agent: 'a1', role: 'tester', unit: 'U1', lane: 'A' }, { agent: 'a1', role: 'builder', unit: 'U1', lane: 'A' }]));
	failed(r);
	assert.match(r.out, /a1/);
});

// why: catches a fresh clean team being refused by the role-split check
test('L3: agents exits 0 when testers and builders are different agent ids', () => {
	const r = agents(records([{ agent: 'a1', role: 'tester', unit: 'U1', lane: 'A' }, { agent: 'a2', role: 'builder', unit: 'U1', lane: 'A' }]));
	assert.equal(r.code, 0, r.out);
});

// why: catches one agent id repeating a role across units being read as a mix of two roles
test('L3: agents exits 0 when one agent is a builder on two units', () => {
	const r = agents(records([{ agent: 'a2', unit: 'U1', lane: 'A' }, { agent: 'a2', unit: 'U2', lane: 'A' }]));
	assert.equal(r.code, 0, r.out);
});

// why: catches an agent piling up units until its context is stale
test('L4: agents exits 1 when one agent holds 4 units', () => {
	const r = agents(records(['U1', 'U2', 'U3', 'U4'].map((unit) => ({ agent: 'a3', unit, lane: 'A' }))));
	failed(r);
	assert.match(r.out, /a3/);
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
	failed(r);
	assert.match(r.out, /a4/);
});

// why: catches the lane cap being set one too low and refusing a legal 2 lanes
test('L4: agents exits 0 when one agent holds exactly 2 lanes', () => {
	const r = agents(records(['A', 'B'].map((lane, i) => ({ agent: 'a4', unit: `U${i}`, lane }))));
	assert.equal(r.code, 0, r.out);
});

// why: catches the check reading only the first file in the folder
test('L3: agents finds the fault in the last of several saved hand-backs', () => {
	const r = agents(records([{ agent: 'b1', role: 'builder', unit: 'U1' }, { agent: 'b2', role: 'builder', unit: 'U2' }, { agent: 'b3', role: 'tester', unit: 'U3' }, { agent: 'b3', role: 'builder', unit: 'U4' }]));
	failed(r);
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
	failed(reviews(reviewDir()));
});

// why: catches a builder starting before the tester fixed the review findings
test('L6: reviews exits 1 when the review has findings and there is no fix record', () => {
	failed(reviews(reviewDir({ review: [finding('R1')] })));
});

// why: catches a finished review and fix pair being refused so the builder never starts
test('L6: reviews exits 0 with one review record that has findings and one fix record', () => {
	const r = reviews(reviewDir({ review: [finding('R1')], fix: [NOTE('fixed R1', 'tester')] }));
	assert.equal(r.code, 0, r.out);
});

// why: catches a clean review being made to wait for a fix record that has nothing to fix
test('L6: reviews exits 0 with a review that has no findings and no fix record', () => {
	const r = reviews(reviewDir({ review: [NOTE('no findings', 'test-reviewer')] }));
	assert.equal(r.code, 0, r.out);
});

// why: catches a second review slipping in with no reason, which hides a repeat loop
test('L6: reviews exits 1 on a second review record with no second-review note', () => {
	failed(reviews(reviewDir({ review: [finding('R1')], second: [finding('R2')], fix: [NOTE('fixed', 'tester')] })));
});

// why: catches the lead's reasoned second review being refused
test('L6: reviews exits 0 on a second review record that holds the lead second-review note', () => {
	const r = reviews(reviewDir({ review: [finding('R1')], second: [NOTE('second review: the fix changed the test shape'), finding('R2')], fix: [NOTE('fixed', 'tester')] }));
	assert.equal(r.code, 0, r.out);
});

// why: catches a note written by someone other than the lead opening the second review
test('L6: reviews exits 1 when the second-review note is written by the tester, not the lead', () => {
	failed(reviews(reviewDir({ review: [finding('R1')], second: [NOTE('second review: I want one', 'tester'), finding('R2')], fix: [NOTE('fixed', 'tester')] })));
});

// why: catches another unit's review record counting for this unit
test('L6: reviews for U2 ignores the U1 records', () => {
	failed(reviews(reviewDir({ review: [finding('R1')], fix: [NOTE('fixed', 'tester')] }), 'U2'));
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
	failed(r);
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

// why: catches a reviewer that finished still being counted as active
test('L7: reviewers exits 1 when the one reviewer finished and 4 units are waiting', () => {
	const r = reviewers(ledger([ev(0, 'U1', 'review-start'), ev(1, 'U1', 'review-done'), ev(2, 'U2', 'review-wait'), ev(3, 'U3', 'review-wait'), ev(4, 'U4', 'review-wait'), ev(5, 'U5', 'review-wait')]));
	// With no reviewer active the queue is not served at all; the fault is at least as bad as one reviewer.
	failed(r);
});

// ---------------------------------------------------------------------------------------------------------------
// L9: the checker is for risky units only (a unit whose Files hit GUARD_PATHS), and a unit gets at most 2 FIX rounds.
// ---------------------------------------------------------------------------------------------------------------
const { GUARD_PATHS } = await import(`file://${TESTER_MODEL.replace(/\\/g, '/')}`);
// A file path that the GUARD_PATHS entry matches.
const guardFile = (g) => (g.endsWith('/') ? `x/${g}f.js` : g.includes('*') ? `x/${g.replace('*', 'x')}` : `x/${g}`);

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

// why: catches a checker spent on a unit that touches no guard path
test('L9: a checker call naming a unit with no guard file logs "checker on a non-risky unit" and is not refused', () => {
	const plan = planWith(['src/app.js', 'docs/readme.md']);
	assert.ok(whys(runHook(`Review this.\nUnit: U1\nPlan: ${plan}\n`)).includes('checker on a non-risky unit'));
});

// why: catches the risky-unit list in the hook drifting from the R2 guard list
for (const g of GUARD_PATHS) {
	test(`L9: a checker call on a unit whose file hits the guard entry ${g} logs no non-risky row`, () => {
		const plan = planWith(['src/app.js', guardFile(g)]);
		assert.ok(!whys(runHook(`Unit: U1\nPlan: ${plan}\n`)).includes('checker on a non-risky unit'));
	});
}

// why: catches the non-risky row firing for roles other than the checker
test('L9: a builder call naming a non-risky unit logs no non-risky row', () => {
	const plan = planWith(['src/app.js']);
	assert.ok(!whys(runHook(`Unit: U1\nPlan: ${plan}\n`, { type: 'builder' })).includes('checker on a non-risky unit'));
});

// why: catches a checker call with no plan named passing unseen
test('L9: a checker call with no Plan line logs "checker with no plan named" and is not refused', () => {
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
	failed(rounds(checkerDir(['FIX', 'FIX', 'FIX'])));
});

// why: catches the round cap being set one too low and stopping a legal second fix
test('L9: rounds exits 0 with two FIX checker records', () => {
	const r = rounds(checkerDir(['FIX', 'FIX']));
	assert.equal(r.code, 0, r.out);
});

// why: catches PASS records counting as fix rounds
test('L9: rounds exits 0 with three checker records of which only two are FIX', () => {
	const r = rounds(checkerDir(['FIX', 'PASS', 'FIX']));
	assert.equal(r.code, 0, r.out);
});

// why: catches another unit's FIX records counting against this unit
test('L9: rounds for U2 ignores three FIX records of U1', () => {
	const r = rounds(checkerDir(['FIX', 'FIX', 'FIX']), 'U2');
	assert.equal(r.code, 0, r.out);
});
