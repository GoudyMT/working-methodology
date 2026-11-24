// K371-K378 (patch 1.51.4, U12): the agent-team-build skill and brief templates carry the steps this patch adds.
// Each test reads the template text and pins distinctive phrases or commands, never a whole sentence. A missing file
// reads as empty text, so a test fails on an assertion, never a crash. Patterns tolerate line wraps ([\s\S]{0,N}).
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
const PLAN = () => read('templates', 'batch-plan.md');
const SKILL = () => read('SKILL.md');

// why: catches a skill or plan template that never says the Rows line is locked at kickoff and a later find goes out by defer (S1)
test('the Rows line is locked at kickoff with --lock-rows and a later find goes out with closeout.mjs defer', () => {
	for (const [name, text] of [['SKILL.md', SKILL()], ['batch-plan.md', PLAN()]]) {
		assert.match(text, /plan-check(?:\.mjs)?(?:\s+(?!--)\S+)?\s+--lock-rows/, `${name} names plan-check --lock-rows`);
		assert.match(text, /Rows[\s\S]{0,200}lock|lock[\s\S]{0,200}Rows/i, `${name} says the Rows line is locked`);
		assert.match(text, /kick-?off/i, `${name} says the lock is at kickoff`);
		assert.match(text, /closeout\.mjs\s+defer/, `${name} sends a later find out with closeout.mjs defer`);
	}
});

// why: catches a skill that leaves a base-copy report fault to ride in the batch instead of one lands-first patch to main (S2)
test('a base-copy report fault goes into one lands-first patch to main, planned when the report first shows it', () => {
	const s = SKILL();
	assert.match(s, /base[- ]copy/i, 'SKILL.md names the base-copy report fault');
	assert.match(s, /base[- ]copy[\s\S]{0,300}lands?[- ]first/i, 'SKILL.md says the base-copy patch lands first');
	assert.match(s, /one[\s\S]{0,40}patch[\s\S]{0,40}\bmain\b/i, 'SKILL.md says one patch to main');
	assert.match(s, /first shows/i, 'SKILL.md says it is planned when the report first shows it');
});

// why: catches a skill missing the fresh-lead check, the hook tier steps, the high-tier block steps (S3) or the folded F1 to F4 steps
test('a fresh lead runs lead-state check, a hook error follows its tier, and a high-tier block is triaged, fixed and investigated', () => {
	const s = SKILL();
	assert.match(s, /lead-state(?:\.mjs)?(?:\s+(?!--)\S+)?\s+check/, 'names lead-state check');
	assert.match(s, /fresh lead[\s\S]{0,300}lead-state|lead-state[\s\S]{0,300}fresh lead/i, 'a fresh lead runs it');
	assert.match(s, /before[\s\S]{0,40}(?:taking|takes?)[\s\S]{0,20}phase/i, 'it runs before taking a phase');
	assert.match(s, /high[\s\S]{0,120}lead review[\s\S]{0,120}pause[\s\S]{0,60}tell the owner/i, 'high tier: lead review, else pause and tell the owner');
	assert.match(s, /small[\s\S]{0,80}log[\s\S]{0,40}report/i, 'small tier: log and report');
	assert.match(s, /triage[\s\S]{0,200}scope/i, 'at a high-tier block the lead triages and states the scope');
	assert.match(s, /fix[\s\S]{0,200}keeps? going/i, 'the fix keeps the build going');
	assert.match(s, /side-job(?:\.mjs)?\s+start[\s\S]{0,300}root cause|root cause[\s\S]{0,300}side-job(?:\.mjs)?\s+start/i, 'a separate side-job.mjs start investigation finds the root cause'); // pin: 4 owner-locked skill step
	// F1
	assert.match(s, /unit list file[\s\S]{0,200}git path|git path[\s\S]{0,200}unit list file/i, 'F1: the unit list file is at the git path'); // pin: 4 owner-locked skill step
	assert.match(s, /unit list file[\s\S]{0,300}not in the worktree/i, 'F1: not in the worktree');
	// F2
	assert.match(s, /round cap[\s\S]{0,200}Plan:[\s\S]{0,80}Unit:/i, 'F2: the round cap counts only briefs with a Plan: line and a Unit: id');
	// F3
	assert.match(s, /sweep fixes[\s\S]{0,200}no (?:review|check)/i, 'F3: sweep fixes get no review or check rounds');
	assert.match(s, /test-first[\s\S]{0,120}CI[\s\S]{0,40}gate|CI[\s\S]{0,40}gate[\s\S]{0,120}test-first/i, 'F3: after the sweep, fixes are test-first and CI is the gate');
	// F4
	assert.match(s, /ci-fix(?:\.mjs)?(?:\s+(?!--)\S+)?\s+list/, 'F4: runs ci-fix.mjs list');
	assert.match(s, /ci-fix(?:\.mjs)?(?:\s+(?!--)\S+)?\s+diagnose/, 'F4: names ci-fix.mjs diagnose');
	assert.match(s, /never[\s\S]{0,20}raw logs/i, 'F4: never raw logs');
	assert.match(s, /only the named files/i, 'F4: fix only the named files');
	assert.match(s, /second red[\s\S]{0,120}ask (?:the owner|Max)/i, 'F4: a second red on the same test means ask the owner');
	assert.match(s, /cap raise[\s\S]{0,60}(?:owner|Max)'?s choice/i, 'F4: a cap raise is the owner\'s choice');
});

// why: catches a tester brief that lets a secret-shaped test value be written whole in the test file (S4)
test('the tester brief joins a secret-shaped test value from parts at run time, never written whole', () => {
	const t = TESTER();
	assert.match(t, /secret/i, 'tester-brief.md names secret-shaped values');
	assert.match(t, /join(?:ed)?[\s\S]{0,60}parts/i, 'joined from parts');
	assert.match(t, /run[- ]?time/i, 'at run time');
	assert.match(t, /never[\s\S]{0,40}whole/i, 'never written whole');
});

// why: catches a skill that lets a gate or study asked for in a build's thread block the build instead of side-job.mjs start (S5)
test('a gate, study, trial or check asked for in a build thread starts with side-job.mjs start and the lead keeps building', () => {
	const s = SKILL();
	assert.match(s, /gate[\s\S]{0,40}study[\s\S]{0,40}trial[\s\S]{0,40}check/i, 'names gate, study, trial or check');
	assert.match(s, /thread[\s\S]{0,400}side-job(?:\.mjs)?\s+start|side-job(?:\.mjs)?\s+start[\s\S]{0,400}thread/i, 'a job asked for in the thread starts with side-job.mjs start'); // pin: 4 owner-locked skill step
	assert.match(s, /lead keeps building|keeps? building/i, 'the lead keeps building');
});
