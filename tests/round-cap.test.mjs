// K366 (patch 1.51.1, U17): the hook refuses a third check round. agent-model.cjs counts a unit's check rounds in its own
// log, <git common dir>/kit-agent-model.log: each allowed checker spawn appends {at, hook, type, round:"check", units:[...]},
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
const logFile = (dir) => path.join(common(dir), 'kit-agent-model.log');
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
	const spellings = ['u17', '**U17**', '`U17`', '_u17_'];
	const results = checkCalls(dir, spellings.map(checker));
	spellings.forEach((s, i) => assert.ok(denied(results[i]), `${s} counts as U17 and is refused, got ${JSON.stringify(results[i])}`));
});

// why: catches a general-purpose agent briefed as a checker (Plan: and Unit: lines) is counted (K366 S3)
test('a general-purpose agent briefed as a checker (Plan: and Unit: lines) is counted', () => {
	const dir = repo();
	seed(dir, [['U17'], ['U17']]);
	const [counted, noUnit] = checkCalls(dir, [briefed('U17'), briefed(null)]);
	assert.ok(denied(counted), `a briefed general agent on a capped unit is refused, got ${JSON.stringify(counted)}`);
	assert.equal(noUnit, null, 'a general agent with a Plan: line and no Unit: line is no checker');
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
	const clean = repo();
	const [fine] = checkCalls(clean, [checker('U17')]);
	assert.equal(fine, null, 'a missing log is not an error');
	assert.equal(readRows(openFile(clean)).length, 0);
});
