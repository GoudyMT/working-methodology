// K366 (patch 1.51.1, U17): the hook refuses a third check round. agent-model.cjs counts a unit's check rounds in its own
// log, <git common dir>/kit-check-rounds.log: each allowed checker spawn appends {at, hook, type, round:"check", units:[...]},
// a refused one has denied:true and never counts. A checker spawn is subagent_type checker, or any type whose prompt has
// Plan: and Unit: lines (units comma-separated, normalized by case and by * ` _ markup). A unit with 2 counted rows is
// refused (hold id round-cap, enforce). An unreadable log blocks with "hook error: lead review" and one row in
// <git common dir>/kit-guard-open.log. Each test runs the real hook in a child process against a temp repo.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const HOOK_DIR = path.resolve('user/kit-hooks');

function isolatedEnv(extra = {}) {
	const home = kitTemp.makeTemp('round-cap-home-');
	const config = path.join(home, '.claude');
	return { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: config, KIT_CLAUDE_HOME: config, ...extra };
}

function git(cwd, args) {
	const r = spawnSync('git', args, { cwd, env: isolatedEnv(), encoding: 'utf8' });
	assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
	return r.stdout.trim();
}

function repo() {
	const dir = kitTemp.makeTemp('round-cap-repo-');
	git(dir, ['init', '-q', '-b', 'main']);
	return dir;
}
const common = (dir) => git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
const logFile = (dir) => path.join(common(dir), 'kit-check-rounds.log');
const agentLog = (dir) => path.join(common(dir), 'kit-agent-model.log');
const openFile = (dir) => path.join(common(dir), 'kit-guard-open.log');
const readRows = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

// Seeds the repo's agent-model log with one row per entry: a unit list, or { units, denied }.
function seed(dir, entries) {
	const rows = entries.map((e) => {
		const { units, denied } = Array.isArray(e) ? { units: e, denied: false } : e;
		return JSON.stringify({ at: '2026-11-22T00:00:00.000Z', hook: 'agent-model', type: 'checker', round: 'check', units, ...(denied ? { denied: true } : {}) });
	});
	fs.writeFileSync(logFile(dir), `${rows.join('\n')}\n`);
}

const CONFIG = (() => {
	const config = kitTemp.makeTemp('round-cap-config-');
	fs.mkdirSync(path.join(config, 'agents'), { recursive: true });
	for (const [name, model] of Object.entries({ checker: 'opus', 'general-purpose': 'sonnet' })) fs.writeFileSync(path.join(config, 'agents', `${name}.md`), `---\nname: ${name}\nmodel: ${model}\n---\nrole\n`);
	return config;
})();

// Runs the real agent-model.cjs once per call, in order, from cwd; one decision per call, null when it lets the call through.
function checkCalls(cwd, calls) {
	const script = "const a = JSON.parse(process.env.KIT_TEST_ARGS); const m = require(path.join(a.hookDir, 'agent-model.cjs')); process.stdout.write(JSON.stringify(a.calls.map((c) => m.check({ tool_name: 'Agent', tool_input: c, cwd: a.cwd }))));";
	const args = JSON.stringify({ hookDir: HOOK_DIR, calls, cwd });
	const r = spawnSync(process.execPath, ['-e', `const path = require('node:path'); ${script}`], { env: isolatedEnv({ KIT_CLAUDE_HOME: CONFIG, CLAUDE_CONFIG_DIR: CONFIG, KIT_TEST_ARGS: args }), encoding: 'utf8' });
	assert.equal(r.status, 0, `agent-model.cjs check ran: ${r.stderr}`);
	return JSON.parse(r.stdout);
}

const checker = (unit) => ({ subagent_type: 'checker', prompt: `Plan: PLAN.md\nUnit: ${unit}\nCheck the unit.` });
const briefed = (unit) => ({ subagent_type: 'general-purpose', prompt: `Plan: PLAN.md\n${unit === null ? '' : `Unit: ${unit}\n`}Check the unit.` });
const denied = (d) => d && d.hookSpecificOutput && d.hookSpecificOutput.permissionDecision === 'deny';
const reason = (d) => (d && d.hookSpecificOutput && d.hookSpecificOutput.permissionDecisionReason) || '';

// why: catches a checker spawn for a unit with 2 checker records already is refused naming the unit and "next patch list" (K366 S1)
test('a checker spawn for a unit with 2 checker records already is refused naming the unit and "next patch list"', () => {
	const dir = repo();
	seed(dir, [['U17'], ['U17']]);
	const [third] = checkCalls(dir, [checker('U17')]);
	assert.ok(denied(third), `the third check round is refused, got ${JSON.stringify(third)}`);
	assert.match(reason(third), /U17/);
	assert.match(reason(third), /next patch list/);
	const batch = repo();
	seed(batch, [['U18', 'U17'], ['U17']]);
	const [viaBatch] = checkCalls(batch, [checker('U17')]);
	assert.ok(denied(viaBatch), `a round spent in a batch row counts for each unit in it, got ${JSON.stringify(viaBatch)}`);
	const other = repo();
	seed(other, [['U17'], { units: ['U17'], denied: true }]);
	const [second] = checkCalls(other, [checker('U17')]);
	assert.equal(second, null, 'a refused row never counts, so one counted round plus one refused one still passes');
});

// why: catches a first and second check pass (K366 S1)
test('a first and second check pass', () => {
	const dir = repo();
	const [first] = checkCalls(dir, [checker('U17')]);
	assert.equal(first, null, 'a missing log is zero rounds, not an error');
	const [second] = checkCalls(dir, [checker('U17')]);
	assert.equal(second, null);
	const rows = readRows(logFile(dir)).filter((r) => r.round === 'check');
	assert.equal(rows.length, 2, 'each allowed spawn appends one check row');
	assert.deepEqual(rows[0].units, ['U17']);
	const [third] = checkCalls(dir, [checker('U17')]);
	assert.ok(denied(third), `the third spawn on the same unit is refused, got ${JSON.stringify(third)}`);
	const batch = repo();
	const [allowed] = checkCalls(batch, [checker('U17, U18')]);
	assert.equal(allowed, null);
	const batchRows = readRows(logFile(batch)).filter((r) => r.round === 'check');
	assert.equal(batchRows.length, 1);
	assert.deepEqual(batchRows[0].units, ['U17', 'U18'], 'a batch spawn appends one row naming each unit');
	assert.equal(readRows(agentLog(dir)).filter((r) => r.round === 'check').length, 0, 'kit-agent-model.log keeps meaning a finding: no round row from a checker spawn');
});

// why: catches a checker for another unit passes (K366 S2)
test('a checker for another unit passes', () => {
	const dir = repo();
	seed(dir, [['U17'], ['U17']]);
	const [other, batch] = checkCalls(dir, [checker('U18'), checker('U18, U17')]);
	assert.equal(other, null);
	assert.ok(denied(batch), `a batch naming the capped unit is refused, got ${JSON.stringify(batch)}`);
	assert.match(reason(batch), /U17/);
});

// why: catches the same unit spelled with other case or markup is still counted (K366 S3)
test('the same unit spelled with other case or markup is still counted', () => {
	const dir = repo();
	seed(dir, [['U17'], ['U17']]);
	const spellings = ['u17', '**U17**', '`U17`', '_u17_', 'U017'];
	const results = checkCalls(dir, spellings.map(checker));
	spellings.forEach((s, i) => assert.ok(denied(results[i]), `${s} counts as U17 and is refused, got ${JSON.stringify(results[i])}`));
	const trailing = ['U17.', 'U17 (fix round)', 'u17, (U18)'];
	const trailed = checkCalls(dir, trailing.map(checker));
	trailing.forEach((s, i) => assert.ok(denied(trailed[i]), `Unit: ${s} counts as U17 and is refused, got ${JSON.stringify(trailed[i])}`));
	const lines = [
		{ subagent_type: 'checker', prompt: 'plan: PLAN.md\nunit: U17\nCheck the unit.' },
		{ subagent_type: 'general-purpose', prompt: '  PLAN: PLAN.md\n   Unit: U17\nCheck the unit.' },
	];
	const lined = checkCalls(dir, lines);
	lined.forEach((d, i) => assert.ok(denied(d), `lower-case or indented lines still count, got ${JSON.stringify(d)} for ${JSON.stringify(lines[i].prompt)}`));
	const [noUnit, noId] = checkCalls(dir, [{ subagent_type: 'checker', prompt: 'Plan: PLAN.md\nCheck the unit.' }, checker('the whole patch')]);
	assert.ok(denied(noUnit), `a checker spawn with no Unit: line is refused, got ${JSON.stringify(noUnit)}`);
	assert.ok(denied(noId), `a checker spawn whose Unit: line holds no id is refused, got ${JSON.stringify(noId)}`);
});

// why: catches a general-purpose agent briefed as a checker (Plan: and Unit: lines) is counted (K366 S3)
test('a general-purpose agent briefed as a checker (Plan: and Unit: lines) is counted', () => {
	const dir = repo();
	seed(dir, [['U17'], ['U17']]);
	const [counted, noUnit] = checkCalls(dir, [briefed('U17'), briefed(null)]);
	assert.ok(denied(counted), `a briefed general agent on a capped unit is refused, got ${JSON.stringify(counted)}`);
	assert.equal(noUnit, null, 'a general agent with a Plan: line and no Unit: line is no checker');
	const planOnly = repo();
	checkCalls(planOnly, [briefed(null)]);
	assert.equal(readRows(logFile(planOnly)).filter((r) => r.round === 'check').length, 0, 'a Plan:-only general agent appends no check row');
	const fresh = repo();
	checkCalls(fresh, [briefed('U17'), briefed('U17')]);
	const [third] = checkCalls(fresh, [checker('U17')]);
	assert.ok(denied(third), `two briefed rounds count toward the cap, got ${JSON.stringify(third)}`);
});

// why: catches the same spawn twice gives the same verdict (K366 S4)
test('the same spawn twice gives the same verdict', () => {
	const dir = repo();
	seed(dir, [['U17'], ['U17']]);
	const [a, b] = checkCalls(dir, [checker('U17'), checker('U17')]);
	assert.ok(denied(a), `the first spawn is refused, got ${JSON.stringify(a)}`);
	assert.deepEqual(b, a);
	const refused = readRows(logFile(dir)).filter((r) => r.denied === true);
	assert.equal(refused.length, 2, 'each refusal is logged with denied:true');
	const [c] = checkCalls(dir, [checker('U17')]);
	assert.deepEqual(c, a, 'refused rows added no rounds, so the verdict stays the same');
});

// why: catches an unreadable records folder or a hook error blocks the spawn with "hook error: lead review" and is logged (K366 S5)
test('an unreadable records folder or a hook error blocks the spawn with "hook error: lead review" and is logged', () => {
	const dir = repo();
	fs.mkdirSync(logFile(dir));
	const [decision] = checkCalls(dir, [checker('U17')]);
	assert.ok(denied(decision), `an unreadable log blocks the spawn, got ${JSON.stringify(decision)}`);
	assert.match(reason(decision), /hook error: lead review/);
	const rows = readRows(openFile(dir));
	assert.equal(rows.length, 1, 'one row in kit-guard-open.log');
	assert.equal(rows[0].hook, 'agent-model');
	assert.ok(rows[0].cause && rows[0].at, 'the row carries its cause and time');
	const junk = repo();
	fs.writeFileSync(logFile(junk), 'not json at all\n');
	const [junked] = checkCalls(junk, [checker('U17')]);
	assert.ok(denied(junked), `a non-JSON line in the log is unreadable and blocks, got ${JSON.stringify(junked)}`);
	assert.match(reason(junked), /hook error: lead review/);
	assert.equal(readRows(openFile(junk)).length, 1, 'one row in kit-guard-open.log');
	const holds = JSON.parse(fs.readFileSync(path.join(HOOK_DIR, 'holds.json'), 'utf8')).holds;
	assert.deepEqual(holds.filter((h) => h.id === 'round-cap').map((h) => h.mode), ['enforce'], 'holds.json lists round-cap in enforce mode');
	const clean = repo();
	const [fine] = checkCalls(clean, [checker('U17')]);
	assert.equal(fine, null, 'a missing log is not an error');
	assert.equal(readRows(openFile(clean)).length, 0);
});

// why: catches any hook error on a checker spawn passing instead of denying "hook error: lead review" with one kit-guard-open.log row (K366 S5 F1)
test('any hook error on a checker spawn denies "hook error: lead review" with one kit-guard-open.log row', () => {
	const dir = repo();
	seed(dir, [['U17'], ['U17']]);
	fs.mkdirSync(agentLog(dir));
	const [decision] = checkCalls(dir, [{ ...checker('U17'), model: 'sonnet' }]);
	assert.ok(denied(decision), `a model-log error on a checker spawn is denied, got ${JSON.stringify(decision)}`);
	assert.match(reason(decision), /hook error: lead review/);
	const rows = readRows(openFile(dir));
	assert.equal(rows.length, 1, 'one row in kit-guard-open.log');
	assert.equal(rows[0].hook, 'agent-model');
	const broken = kitTemp.makeTemp('round-cap-broken-');
	fs.writeFileSync(path.join(broken, '.git'), `gitdir: ${path.join(broken, 'no-such-git-folder')}\n`);
	const [unread] = checkCalls(broken, [checker('U17')]);
	assert.ok(denied(unread), `a failed common-dir read on a checker spawn is denied, got ${JSON.stringify(unread)}`);
	assert.match(reason(unread), /hook error: lead review/);
});

// why: catches Plan, Unit and Units lines in markup, list markers or repeated going unread so a capped unit gets a third round (K366 S3 F4)
test('Plan and Unit lines with bold, list markers, a Units label or a second Unit line still count', () => {
	const dir = repo();
	seed(dir, [['U17'], ['U17']]);
	const prompts = ['**Plan:** P.md\n**Unit:** U17\nGo.', '- Plan: P.md\n- Unit: U17\nGo.', 'Plan: P.md\nUnits: U17\nGo.', 'Plan: P.md\nUnit: R1\nUnit: U17\nGo.'];
	for (const type of ['general-purpose', 'checker']) {
		const results = checkCalls(dir, prompts.map((prompt) => ({ subagent_type: type, prompt })));
		results.forEach((d, i) => {
			assert.ok(denied(d), `${type} with ${JSON.stringify(prompts[i])} is refused, got ${JSON.stringify(d)}`);
			assert.match(reason(d), /third check round on U17/);
		});
	}
});

// why: catches a checker refused by the closeout gate spending a round so a later honest check is wrongly refused (K366 S1 F1 denied row)
test('a checker refused by another gate writes its row with denied:true and spends no round', () => {
	const dir = repo();
	const T = ['-c', 'user.name=T', '-c', 'user.email=t@example.invalid'];
	fs.writeFileSync(path.join(dir, 'VERSION'), '1.51.1\n');
	fs.mkdirSync(path.join(dir, 'docs', 'builds'), { recursive: true });
	fs.writeFileSync(path.join(dir, 'docs', 'builds', '1.51.1.closeout.json'), `${JSON.stringify({ version: '1.51.1', head: 'abc', findings: [], tickets: [] })}\n`);
	git(dir, ['add', '-A']);
	git(dir, [...T, 'commit', '-q', '-m', 'closeout']);
	seed(dir, [['U17']]);
	const [refused] = checkCalls(dir, [checker('U17')]);
	assert.ok(denied(refused), `a checker in closeout is refused, got ${JSON.stringify(refused)}`);
	const rows = readRows(logFile(dir));
	assert.equal(rows.length, 2);
	assert.equal(rows[1].denied, true, `the refused spawn's row carries denied:true: ${JSON.stringify(rows[1])}`);
	git(dir, ['rm', '-q', 'docs/builds/1.51.1.closeout.json']);
	git(dir, [...T, 'commit', '-q', '-m', 'leave closeout']);
	const [second, third] = checkCalls(dir, [checker('U17'), checker('U17')]);
	assert.equal(second, null, `the refused spawn spent no round, so the second counted round passes, got ${JSON.stringify(second)}`);
	assert.ok(denied(third), `the third counted round is refused, got ${JSON.stringify(third)}`);
});

// why: catches a unit id capped under one plan also capping the same id under another plan (K366 S3 plan scope)
test('two counted rounds on U7 under plan A do not cap U7 under plan B', () => {
	const dir = repo();
	const under = (plan) => ({ subagent_type: 'checker', prompt: `Plan: ${plan}\nUnit: U7\nCheck the unit.` });
	const [a1, a2, a3, b1] = checkCalls(dir, [under('A.md'), under('A.md'), under('A.md'), under('B.md')]);
	assert.equal(a1, null);
	assert.equal(a2, null);
	assert.ok(denied(a3), `the third round under plan A is refused, got ${JSON.stringify(a3)}`);
	assert.equal(b1, null, `U7 under plan B has no rounds yet and passes, got ${JSON.stringify(b1)}`);
});

// why: catches tester and builder spawns with Plan and Unit lines spending a unit's check rounds (K366 S1, round 2 N1)
test('tester and builder spawns with Plan and Unit lines spend no check round', () => {
	const dir = repo();
	const brief = 'Plan: PLAN.md\nUnit: U13\nWorktree: .\nGo.';
	const workers = [
		{ subagent_type: 'builder', prompt: brief },
		{ subagent_type: 'tester', prompt: brief },
		{ subagent_type: 'general-purpose', prompt: `Role: builder\n${brief}` },
	];
	checkCalls(dir, workers);
	assert.equal(readRows(logFile(dir)).filter((r) => r.round === 'check').length, 0, 'no check row for a worker spawn');
	const [c1, c2, c3] = checkCalls(dir, [checker('U13'), checker('U13'), checker('U13')]);
	assert.equal(c1, null, `the first real check passes, got ${JSON.stringify(c1)}`);
	assert.equal(c2, null, `the second real check passes, got ${JSON.stringify(c2)}`);
	assert.ok(denied(c3), 'the third real check is refused');
});

// why: catches a marked-up Plan line with no Unit line passing uncounted, a full round-cap bypass (K366 S3, round 2 N2)
test('a marked-up Plan line with no Unit line is refused like a plain one', () => {
	const dir = repo();
	const results = checkCalls(dir, ['**Plan:** P.md\nGo.', '- Plan: P.md\nGo.'].map((prompt) => ({ subagent_type: 'checker', prompt })));
	for (const d of results) assert.match(reason(d), /names no unit/, `refused for no unit, got ${JSON.stringify(d)}`);
});

// why: catches a plan-less checker counted against every plan's rows, so a reused unit id is capped forever (K366 S3, round 2 N5)
test('a checker with no Plan line counts only rows with no plan', () => {
	const dir = repo();
	const under = (plan) => ({ subagent_type: 'checker', prompt: `Plan: ${plan}\nUnit: U3\nCheck.` });
	checkCalls(dir, [under('A.md'), under('B.md')]);
	const [bare] = checkCalls(dir, [{ subagent_type: 'checker', prompt: 'Unit: U3\nCheck.' }]);
	assert.equal(bare, null, `rounds under plans A and B do not count for a plan-less check, got ${JSON.stringify(bare)}`);
});

// why: catches the plan key compared raw, so a respelled plan path opens a fresh count (K366 S3, round 2 a)
test('the same plan spelled another way is still the same plan', () => {
	const spellings = ['./PLAN.md', 'PLAN.md (round 3)', '_PLAN.md_', path.resolve('PLAN.md')];
	if (process.platform === 'win32') spellings.push('plan.md');
	for (const spelling of spellings) {
		const dir = repo();
		const at = (plan) => ({ subagent_type: 'checker', prompt: `Plan: ${plan}\nUnit: U7\nCheck.` });
		const [, , third] = checkCalls(dir, [at('PLAN.md'), at('PLAN.md'), at(spelling.startsWith(path.sep) || /^[A-Za-z]:/.test(spelling) ? path.join(dir, 'PLAN.md') : spelling)]);
		assert.ok(denied(third), `"${spelling}" is the plan of the first two rounds, got ${JSON.stringify(third)}`);
	}
});
