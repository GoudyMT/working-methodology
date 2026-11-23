// K360-K366 (patch 1.51.1, U16): the agent-team-build brief templates and SKILL.md carry the build steps this patch
// enforces elsewhere (unit lock first, warm reset, round cap, closeout card, isolated worktrees). Each test reads the
// template text and pins a step, a command or a number, never a whole paragraph. A missing tester-brief.md reads as
// empty text, so its tests fail on an assertion, never a crash.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(KIT, 'user', 'skills', 'agent-team-build');
const read = (...p) => {
	const f = path.join(DIR, ...p);
	return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
};
const TESTER = () => read('templates', 'tester-brief.md');
const BUILDER = () => read('templates', 'builder-brief.md');
const CHECKER = () => read('templates', 'checker-brief.md');
const PLAN = () => read('templates', 'batch-plan.md');
const SKILL = () => read('SKILL.md');

// why: catches a tester brief that locks its files after the unit, or a builder brief that names no test files or uses --pick (K360 S1)
test('the tester brief locks first, and the builder brief names exact test files and never --pick', () => {
	const t = TESTER();
	assert.ok(fs.existsSync(path.join(DIR, 'templates', 'tester-brief.md')), 'templates/tester-brief.md exists');
	const lock = t.search(/unit-lock\.mjs\s+--tester/);
	assert.ok(lock >= 0, 'tester-brief.md names `unit-lock.mjs --tester`');
	const unit = t.search(/^#{2,}.*\bunit\b/im);
	assert.ok(unit >= 0, 'tester-brief.md has a unit section');
	assert.ok(lock < unit, 'the lock step comes before the unit section');
	const b = BUILDER();
	assert.match(b, /exact[^\n]*test files?|test files?[^\n]*\bexact/i, 'builder-brief names exact test files');
	assert.doesNotMatch(b, /--pick/, 'builder-brief never says --pick');
});

// why: catches a plan template that shows no retest unit and no lead ruling proof line (K361 S2)
test('the plan template shows a retest unit and a "lead ruling:" proof line', () => {
	const p = PLAN();
	assert.match(p, /retest/i, 'batch-plan shows a retest unit');
	assert.match(p, /lead ruling:/i, 'batch-plan shows a "lead ruling:" note');
	assert.match(p, /lead ruling:[^\n]*\n?[^\n]*proof|proof[^\n]*lead ruling:/i, 'the ruling carries a proof');
});

// why: catches a skill that leaves out the warm-agent reset limit and the check-round cap and who enforces them (K362 S3)
test('the skill names the reset limit and the 2-check-round cap with their enforcers', () => {
	const s = SKILL();
	assert.match(s, /warm\.mjs/, 'names warm.mjs');
	assert.match(s, /150000|150K/i, 'names the 150000 limit');
	assert.match(s, /reset[^\n]*(150000|150K)|(150000|150K)[^\n]*reset/i, 'the limit sits beside a reset line');
	assert.match(s, /(\b2\b|\btwo\b)[ -]check[ -]rounds?|check[ -]rounds?[^\n]{0,60}(\b2\b|\btwo\b)/i, 'names the 2 check-round cap');
	assert.match(s, /agent-model/, 'names the agent-model hook as enforcer');
});

// why: catches missing lane cap, plan-check --brief, base re-check, and tester-brief stop-and-ask, plain commands, scratch rules (K363 S4)
test('the skill carries the lane cap, briefs from plan-check, and a base re-check; the tester brief carries stop-and-ask, plain commands and scratch', () => {
	const s = SKILL();
	assert.match(s, /at most 4 lanes|4 lanes (building )?at once|no more than 4 lanes/i, 'at most 4 lanes at once');
	assert.match(s, /plan-check\.mjs[^\n]*--brief|--brief[^\n]*plan-check/, 'briefs come from plan-check --brief');
	assert.match(s, /claims/i, 'names the Claims grep');
	assert.match(s, /collision/i, 'names the Collision grep');
	assert.match(s, /base (moves|changes|has moved)|when the base/i, 'a re-run whenever the base moves');
	const t = TESTER();
	assert.match(t, /stop[ -]and[ -]ask/i, 'tester brief names stop-and-ask');
	assert.match(t, /single command|one command|plain command/i, 'tester brief names plain single commands');
	assert.match(t, /scratch[^\n]*outside|outside[^\n]*scratch/i, 'tester brief puts scratch outside the repo');
});

// why: catches a review step with no closeout card steps and no plain test-count line (K366 S5)
test('the skill review step carries the closeout card and the may-or-may-not table', () => {
	const s = SKILL();
	assert.match(s, /closeout(\.mjs)?\s+open/i, 'closeout open');
	assert.match(s, /one fix per finding/i, 'one fix per finding');
	assert.match(s, /closeout\.mjs\s+check/, 'closeout check');
	assert.match(s, /closeout\.mjs\s+defer/, 'closeout defer');
	assert.match(s, /^\|[^\n]*\bmay\b[^\n]*\|/im, 'a may-or-may-not table row');
	assert.match(s, /may not/i, 'a "may not" cell');
	assert.match(s, /one test per ticket/i, 'the test count only goes down, except one test per ticket');
});

// why: catches a skill missing isolated worktrees, lane-sha reset, lock after spawn, wip commit, reviewer caps, scale log and date -u (K364 S6)
test('the skill carries isolated worktrees, the lock after spawn, the wip commit, the 3 and 2 caps and date -u', () => {
	const s = SKILL();
	assert.match(s, /isolat/i, 'testers and builders run isolated');
	assert.match(s, /worktree/i, 'in worktrees');
	assert.match(s, /lane sha/i, 'reset to the lane sha first');
	assert.match(s, /unit lock|unit-lock|kit-unit-files/i, 'the unit lock');
	assert.match(s, /right after (the )?spawn|immediately after (the )?spawn/i, 'the lock is written right after spawn');
	assert.match(s, /wip commit|commit[^\n]{0,20}\bwip\b/i, 'a wip commit before an agent stops to ask');
	assert.match(s, /\b3\b[^\n]*(reviewers?)|reviewers?[^\n]*\b3\b/i, 'up to 3 reviewers');
	assert.match(s, /\b2\b[^\n]*checkers?|checkers?[^\n]*\b2\b/i, 'up to 2 checkers');
	assert.match(s, /kind\W{0,3}scale/i, 'each start is logged as kind scale');
	assert.match(s, /date -u/, 'a date -u read before any time is written');
});

// why: catches a tester, builder or checker brief missing the Plan:, Unit:, Role: and Worktree: lines the spawn hooks read (K360 S1)
test('the tester, builder and checker brief templates each carry Plan:, Unit:, Role: and Worktree: lines', () => {
	const briefs = { 'tester-brief.md': TESTER(), 'builder-brief.md': BUILDER(), 'checker-brief.md': CHECKER() };
	for (const [name, text] of Object.entries(briefs)) {
		assert.ok(text.length > 0, `${name} exists`);
		for (const label of ['Plan', 'Unit', 'Role', 'Worktree']) {
			assert.match(text, new RegExp(`^[\\s>*_\`+-]*${label}[*_\`]*:`, 'im'), `${name} carries a ${label}: line`);
		}
	}
});
