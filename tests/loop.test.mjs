// T7 slice 1 (build 12, the owner's lock 2026-11-16): the loop driver. 17 of the kit's 26 stop rules rested on the
// model remembering them, and six numeric limits had no counter (the v2.0 teardown). The driver owns the build loop's
// state in the git folder, says the one next step, refuses a step out of order, counts the stops that have a number,
// and stops with a triage card that only the owner's Yes clears.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const SID = '0aaaaaaa-1bbb-2ccc-3ddd-4eeeeeeeeeee';

// A git repo with the kit's loop script, its owner-yes reader and the shipped bounds file, and a Claude folder.
function repo() {
	const dir = kitTemp.makeTemp('loop-');
	spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
	fs.mkdirSync(path.join(dir, '.claude'));
	for (const f of ['loop.mjs', 'owner-yes.cjs', 'bounds.json']) fs.copyFileSync(path.resolve('project/.claude', f), path.join(dir, '.claude', f));
	const cfg = kitTemp.makeTemp('loop-cfg-');
	return { dir, cfg };
}
const loop = ({ dir, cfg }, args, env = {}) => spawnSync(process.execPath, [path.join(dir, '.claude', 'loop.mjs'), ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: SID, ...env } });
const log = ({ dir }) => fs.readFileSync(path.join(dir, '.git', 'kit-loop.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const code = (out, act) => (out.match(new RegExp(`\`loop ${act} ([0-9a-f]{6})\``)) || [])[1];

// The session's transcript, as Claude Code writes it: an answered pop-up, or the owner's own message.
function transcript({ dir, cfg }, lines) {
	const where = path.join(cfg, 'projects', fs.realpathSync.native(dir).replace(/[^A-Za-z0-9]/g, '-'));
	fs.mkdirSync(where, { recursive: true });
	fs.appendFileSync(path.join(where, `${SID}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}
function ownerTaps(r, act, { answer = 'Yes' } = {}) {
	const at = new Date(Date.now() + 1000).toISOString();
	const id = `toolu_${crypto.randomBytes(6).toString('hex')}`;
	const question = `May I go on? \`${act}\``;
	const questions = [{ question, header: 'Owner yes', multiSelect: false, options: [{ label: 'Yes', description: '' }, { label: 'No', description: '' }] }];
	transcript(r, [
		{ type: 'assistant', isSidechain: false, timestamp: at, message: { content: [{ type: 'tool_use', id, name: 'AskUserQuestion', input: { questions } }] } },
		{ type: 'user', isSidechain: false, timestamp: at, permissionDecision: { decision: 'accept', source: 'user_temporary' }, toolUseResult: { questions, answers: { [question]: answer } }, message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'answered' }] } },
	]);
}
const ownerSays = (r, text) => transcript(r, [{ type: 'user', isSidechain: false, timestamp: new Date().toISOString(), message: { role: 'user', content: text } }]);

// why: guards rule:loop-driver
test('the loop says one next step and refuses a step out of order, or with no evidence', () => {
	const r = repo();
	const start = loop(r, ['start', 'K1']);
	assert.equal(start.status, 0, start.stdout + start.stderr);
	assert.match(start.stdout, /^NEXT proof: alone/m);
	const early = loop(r, ['done', 'build', '--evidence', 'built']);
	assert.equal(early.status, 1);
	assert.match(early.stdout, /LOOP STOP[\s\S]*out of order[\s\S]*next step is proof/);
	assert.equal(loop(r, ['done', 'proof']).status, 2, 'a step with no evidence');
	assert.equal(loop(r, ['done', 'proof', '--evidence', 'tests/a.test.mjs red on main']).status, 0);
	const next = loop(r, ['next']);
	assert.match(next.stdout, /^NEXT design: the owner's/m);
	assert.ok(code(next.stdout, 'design'), next.stdout);
	assert.equal(loop(r, ['start', 'K2']).status, 1, 'a second run while one is open');
});

// why: guards rule:loop-driver (no build before the owner locks the design)
test('an owner step is done only on the owner\'s Yes after it opened: its loop act, or the outward act the guard asked', () => {
	const r = repo();
	loop(r, ['start', 'K1']);
	loop(r, ['done', 'proof', '--evidence', 'red test']);
	const act = `loop design ${code(loop(r, ['next']).stdout, 'design')}`;
	const none = loop(r, ['done', 'design', '--evidence', 'plan v1']);
	assert.equal(none.status, 1);
	assert.match(none.stdout, /owner's Yes/);
	ownerTaps(r, act, { answer: 'No' });
	assert.equal(loop(r, ['done', 'design', '--evidence', 'plan v1']).status, 1, 'a No is no lock');
	ownerTaps(r, act);
	assert.equal(loop(r, ['done', 'design', '--evidence', 'plan v1']).status, 0);
	for (const s of ['build', 'sweep', 'pr', 'ci']) assert.equal(loop(r, ['done', s, '--evidence', 'x']).status, 0, s);
	// Merge: the guard already asked for the merge itself; that Yes is the step's, so no second tap.
	assert.equal(loop(r, ['done', 'merge', '--evidence', 'PR 1', '--act', 'gh pr merge 1 --squash']).status, 1, 'no Yes to that act');
	ownerTaps(r, 'gh pr merge 1 --squash');
	assert.equal(loop(r, ['done', 'merge', '--evidence', 'PR 1', '--act', 'gh pr merge 1 --squash']).status, 0);
	assert.equal(loop(r, ['done', 'tag', '--evidence', 'v1', '--act', 'gh pr merge 1 --squash']).status, 1, 'one Yes is for one step');
});

// why: guards rule:loop-driver (a limit needs an instrument)
test('the counted stops halt at the bounds file\'s limits, per unit, and a halt holds every step until the owner resumes', () => {
	const r = repo();
	loop(r, ['start', 'K1']);
	assert.equal(loop(r, ['count', 'fix-round', '--unit', 'U1']).status, 0);
	assert.equal(loop(r, ['count', 'fix-round', '--unit', 'U2']).status, 0, 'another unit has its own count');
	assert.equal(loop(r, ['count', 'fix-round', '--unit', 'U1']).status, 0);
	const third = loop(r, ['count', 'fix-round', '--unit', 'U1']);
	assert.equal(third.status, 3);
	assert.match(third.stdout, /LOOP STOP[\s\S]*fix round 3 of unit U1[\s\S]*Data:[\s\S]*Options:/);
	assert.equal(loop(r, ['done', 'proof', '--evidence', 'x']).status, 1, 'a step while halted');
	const act = `loop resume ${code(loop(r, ['next']).stdout, 'resume')}`;
	assert.equal(loop(r, ['resume']).status, 1, 'a resume with no Yes');
	ownerTaps(r, act);
	assert.equal(loop(r, ['resume']).status, 0);
	assert.equal(loop(r, ['done', 'proof', '--evidence', 'x']).status, 0);
	assert.equal(loop(r, ['count', 'canary-miss', '--unit', 'U3']).status, 0);
	assert.equal(loop(r, ['count', 'canary-miss', '--unit', 'U3']).status, 3, 'two canary misses on a unit');
	ownerTaps(r, `loop resume ${code(loop(r, ['next']).stdout, 'resume')}`);
	assert.equal(loop(r, ['resume']).status, 0);
	loop(r, ['count', 'visual']);
	loop(r, ['count', 'visual']);
	loop(r, ['count', 'visual-check']);
	loop(r, ['count', 'visual']);
	assert.equal(loop(r, ['count', 'visual']).status, 0, 'the check reset the visual count');
	assert.equal(loop(r, ['count', 'visual']).status, 3, 'three visual increments since the check');
	ownerTaps(r, `loop resume ${code(loop(r, ['next']).stdout, 'resume')}`);
	loop(r, ['resume']);
	for (let i = 0; i < 5; i++) assert.equal(loop(r, ['count', 'ci-fix']).status, 0, 'CI fixes have no cap');
	assert.equal(loop(r, ['count', 'nap']).status, 2, 'an unknown counter');
});

// why: guards rule:loop-driver
test('a changed bounds file, a hand edit of the log or the kill switch stops the run', () => {
	const r = repo();
	loop(r, ['start', 'K1']);
	const file = path.join(r.dir, '.claude', 'bounds.json');
	const b = JSON.parse(fs.readFileSync(file, 'utf8'));
	b.limits.fixRound = 9;
	fs.writeFileSync(file, JSON.stringify(b));
	assert.match(loop(r, ['next']).stdout, /LOOP STOP[\s\S]*bounds file changed/);
	const r2 = repo();
	loop(r2, ['start', 'K1']);
	loop(r2, ['done', 'proof', '--evidence', 'x']);
	const f = path.join(r2.dir, '.git', 'kit-loop.jsonl');
	fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('"x"', '"y"'));
	assert.match(loop(r2, ['next']).stdout, /LOOP STOP[\s\S]*changed by hand/);
	const r3 = repo();
	loop(r3, ['start', 'K1']);
	fs.writeFileSync(path.join(r3.cfg, 'autonomy-off'), '');
	assert.match(loop(r3, ['next']).stdout, /^NEXT proof: the owner's \(the kill switch/m);
	assert.equal(loop(r3, ['done', 'proof', '--evidence', 'x']).status, 1, 'an alone step with the kill switch on');
	const r4 = repo();
	fs.rmSync(path.join(r4.dir, '.claude', 'bounds.json'));
	assert.equal(loop(r4, ['start', 'K1']).status, 1, 'no bounds file');
	assert.equal(log(r).at(-1).kind, 'halt');
});

// why: guards rule:loop-workflow-mode (armed only by the owner's exact phrase; any owner message halts it)
test('loop mode arms only on the owner\'s exact phrase, and any other owner message or a compact turns it off', () => {
	const r = repo();
	assert.equal(loop(r, ['mode', 'arm']).status, 1, 'armed with no owner message');
	ownerSays(r, 'please begin loop workflow now');
	assert.equal(loop(r, ['mode', 'arm']).status, 1, 'armed on a message that only holds the phrase');
	ownerSays(r, 'begin loop workflow');
	assert.equal(loop(r, ['mode', 'arm']).status, 0);
	assert.match(loop(r, ['show']).stdout, /loop mode: armed/);
	assert.equal(loop(r, ['mode', 'prompt', '--text', 'begin loop workflow']).status, 0);
	assert.match(loop(r, ['show']).stdout, /loop mode: armed/, 'the phrase itself keeps it armed');
	loop(r, ['mode', 'prompt', '--text', 'how is it going?']);
	assert.match(loop(r, ['show']).stdout, /loop mode: off \(an owner message halts the loop\)/);
	ownerSays(r, 'how is it going?');
	assert.equal(loop(r, ['mode', 'arm']).status, 1, 'armed after the owner spoke again');
	ownerSays(r, 'begin loop workflow');
	loop(r, ['mode', 'arm']);
	loop(r, ['mode', 'off', '--why', 'compact']);
	assert.match(loop(r, ['show']).stdout, /loop mode: off \(compact\)/);
});

// The hooks are what call it: the prompt hook on each owner message, and the session start and compact hooks.
// why: guards rule:loop-workflow-mode
test('the kit hook halts an armed loop on an owner message and turns it off at a compact', () => {
	const r = repo();
	fs.copyFileSync(path.resolve('project/.claude/kit-hook.cjs'), path.join(r.dir, '.claude', 'kit-hook.cjs'));
	const hook = (mode, input) => spawnSync(process.execPath, [path.join(r.dir, '.claude', 'kit-hook.cjs'), mode], { cwd: r.dir, input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: r.dir, KIT_CLAUDE_HOME: r.cfg, CLAUDE_CONFIG_DIR: r.cfg } });
	const arm = () => { ownerSays(r, 'begin loop workflow'); assert.equal(loop(r, ['mode', 'arm']).status, 0); };
	arm();
	hook('prompt', { prompt: 'begin loop workflow' });
	assert.match(loop(r, ['show']).stdout, /loop mode: armed/);
	hook('prompt', { prompt: 'stop for a second' });
	assert.match(loop(r, ['show']).stdout, /loop mode: off \(an owner message halts the loop\)/);
	arm();
	hook('pre-compact', { session_id: SID });
	assert.match(loop(r, ['show']).stdout, /loop mode: off \(compact\)/);
	arm();
	hook('session-start', { source: 'resume' });
	assert.match(loop(r, ['show']).stdout, /loop mode: off \(session start\)/);
});
