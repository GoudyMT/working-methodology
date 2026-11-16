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
const OTHER = '0bbbbbbb-1bbb-2ccc-3ddd-4eeeeeeeeeee';

// A git repo with the kit's loop script, its owner-yes reader and the shipped bounds file, a Claude folder, and the
// session the kit's prompt hook records.
function repo({ session = SID } = {}) {
	const dir = kitTemp.makeTemp('loop-');
	spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
	fs.mkdirSync(path.join(dir, '.claude'));
	for (const f of ['loop.mjs', 'owner-yes.cjs', 'bounds.json']) fs.copyFileSync(path.resolve('project/.claude', f), path.join(dir, '.claude', f));
	if (session) fs.writeFileSync(path.join(dir, '.git', 'kit-loop-session'), session);
	const cfg = kitTemp.makeTemp('loop-cfg-');
	return { dir, cfg };
}
// The environment's session id is the caller's to set, so the driver never reads it: OTHER here proves that.
const loop = ({ dir, cfg }, args, { cwd = dir } = {}) => spawnSync(process.execPath, [path.join(dir, '.claude', 'loop.mjs'), ...args], { cwd, encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: OTHER } });
const log = ({ dir }) => fs.readFileSync(path.join(dir, '.git', 'kit-loop.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const code = (out, act) => (out.match(new RegExp(`\`loop ${act} ([0-9a-f]{6})\``)) || [])[1];

// A session's transcript, as Claude Code writes it: an answered pop-up, or the owner's own message.
function transcript({ dir, cfg }, lines, sid = SID) {
	const where = path.join(cfg, 'projects', fs.realpathSync.native(dir).replace(/[^A-Za-z0-9]/g, '-'));
	fs.mkdirSync(where, { recursive: true });
	fs.appendFileSync(path.join(where, `${sid}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
}
function ownerTaps(r, act, { answer = 'Yes', sid = SID } = {}) {
	const at = new Date(Date.now() + 1000).toISOString();
	const id = `toolu_${crypto.randomBytes(6).toString('hex')}`;
	const question = `May I go on? \`${act}\``;
	const questions = [{ question, header: 'Owner yes', multiSelect: false, options: [{ label: 'Yes', description: '' }, { label: 'No', description: '' }] }];
	transcript(r, [
		{ type: 'assistant', isSidechain: false, timestamp: at, message: { content: [{ type: 'tool_use', id, name: 'AskUserQuestion', input: { questions } }] } },
		{ type: 'user', isSidechain: false, timestamp: at, permissionDecision: { decision: 'accept', source: 'user_temporary' }, toolUseResult: { questions, answers: { [question]: answer } }, message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'answered' }] } },
	], sid);
}
// Stamped now, a few milliseconds after the driver's last line, as a real message comes after it.
const ownerSays = (r, text) => { const t = Date.now(); while (Date.now() - t < 5); transcript(r, [{ type: 'user', isSidechain: false, timestamp: new Date().toISOString(), message: { role: 'user', content: text } }]); };
const resume = (r) => { ownerTaps(r, `loop resume ${code(loop(r, ['next']).stdout, 'resume')}`); return loop(r, ['resume']); };

// why: guards rule:loop-driver
test('the loop says one next step and refuses a step out of order, or with no evidence', () => {
	const r = repo();
	const start = loop(r, ['start', 'K1']);
	assert.equal(start.status, 0, start.stdout + start.stderr);
	assert.match(start.stdout, /^NEXT proof: alone/m);
	const early = loop(r, ['done', 'build', '--evidence', 'built']);
	assert.equal(early.status, 1);
	assert.match(early.stdout, /LOOP STOP/);
	assert.equal(loop(r, ['done', 'proof']).status, 2, 'a step with no evidence');
	assert.equal(loop(r, ['done', 'proof', '--evidence', 'tests/a.test.mjs red on main']).status, 0);
	const next = loop(r, ['next']);
	assert.match(next.stdout, /^NEXT design: the owner's/m);
	assert.ok(code(next.stdout, 'design'), next.stdout);
	assert.equal(loop(r, ['start', 'K2']).status, 1, 'a second run while one is open');
	// Run from another folder, the script keeps to its own project's log and bounds (the build 12 sweep).
	const elsewhere = repo();
	assert.match(loop(r, ['next'], { cwd: elsewhere.dir }).stdout, /^NEXT design/m);
	assert.equal(fs.existsSync(path.join(elsewhere.dir, '.git', 'kit-loop.jsonl')), false);
});

// why: guards rule:loop-driver (no build before the owner locks the design)
test('an owner step is done only on the owner\'s Yes to its loop act in the recorded session; an act the guard holds needs evidence', () => {
	const r = repo();
	loop(r, ['start', 'K1']);
	loop(r, ['done', 'proof', '--evidence', 'red test']);
	const act = `loop design ${code(loop(r, ['next']).stdout, 'design')}`;
	assert.equal(loop(r, ['done', 'design', '--evidence', 'plan v1']).status, 1, 'no Yes');
	ownerTaps(r, act, { answer: 'No' });
	assert.equal(loop(r, ['done', 'design', '--evidence', 'plan v1']).status, 1, 'a No is no lock');
	ownerTaps(r, act, { sid: OTHER });
	assert.equal(loop(r, ['done', 'design', '--evidence', 'plan v1']).status, 1, 'a Yes in the session the environment names');
	ownerTaps(r, 'git status');
	assert.equal(loop(r, ['done', 'design', '--evidence', 'plan v1', '--act', 'git status']).status, 1, 'a Yes to another act');
	ownerTaps(r, act);
	assert.equal(loop(r, ['done', 'design', '--evidence', 'plan v1']).status, 0);
	for (const s of ['build', 'sweep', 'pr', 'ci']) assert.equal(loop(r, ['done', s, '--evidence', 'x']).status, 0, s);
	// Merge: the guard holds the act itself for the owner's yes, so the step needs only its evidence, and no second tap.
	assert.match(loop(r, ['next']).stdout, /^NEXT merge: the guard's/m);
	assert.equal(loop(r, ['done', 'merge', '--evidence', 'PR 1 merged as abc123']).status, 0);
	const none = repo({ session: null });
	loop(none, ['start', 'K1']);
	loop(none, ['done', 'proof', '--evidence', 'x']);
	assert.equal(loop(none, ['done', 'design', '--evidence', 'x']).status, 1, 'an owner step with no session recorded');
});

// why: guards rule:loop-driver (a limit needs an instrument)
test('the counted stops halt at the bounds file\'s limits, per unit, and a halt holds every step until the owner resumes', () => {
	const r = repo();
	loop(r, ['start', 'K1']);
	assert.equal(loop(r, ['count', 'fix-round', '--unit', 'U1']).status, 0);
	assert.equal(loop(r, ['count', 'fix-round', '--unit', 'U2']).status, 0, 'another unit has its own count');
	assert.equal(loop(r, ['count', 'fix-round', '--unit', 'u1 ']).status, 0);
	const third = loop(r, ['count', 'fix-round', '--unit', 'U1']);
	assert.equal(third.status, 3, 'a unit renamed by case or a space started again');
	assert.match(third.stdout, /LOOP STOP[\s\S]*Data:[\s\S]*Options:/);
	assert.equal(log(r).at(-1).kind, 'halt');
	assert.equal(loop(r, ['done', 'proof', '--evidence', 'x']).status, 1, 'a step while halted');
	assert.equal(loop(r, ['resume']).status, 1, 'a resume with no Yes');
	assert.equal(resume(r).status, 0);
	assert.equal(loop(r, ['done', 'proof', '--evidence', 'x']).status, 0);
	assert.equal(loop(r, ['count', 'canary-miss', '--unit', 'U3']).status, 0);
	assert.equal(loop(r, ['count', 'canary-miss', '--unit', 'U3']).status, 3, 'two canary misses on a unit');
	assert.equal(resume(r).status, 0);
	// The visual check is the owner looking: it resets the count only on their Yes.
	loop(r, ['count', 'visual']);
	loop(r, ['count', 'visual']);
	assert.equal(loop(r, ['count', 'visual-check']).status, 1, 'the session checked its own visuals');
	ownerTaps(r, `loop visual-check ${code(loop(r, ['show']).stdout, 'visual-check')}`);
	assert.equal(loop(r, ['count', 'visual-check']).status, 0);
	loop(r, ['count', 'visual']);
	assert.equal(loop(r, ['count', 'visual']).status, 0, 'the check reset the visual count');
	assert.equal(loop(r, ['count', 'visual']).status, 3, 'three visual increments since the check');
	assert.equal(resume(r).status, 0);
	for (let i = 0; i < 5; i++) assert.equal(loop(r, ['count', 'ci-fix']).status, 0, 'CI fixes have no cap');
	assert.equal(loop(r, ['count', 'nap']).status, 2, 'an unknown counter');
});

// why: guards rule:loop-driver
test('a changed bounds file, a hand edit of the log or the kill switch stops the run, and an older bounds file asks first', () => {
	const r = repo();
	loop(r, ['start', 'K1']);
	const file = path.join(r.dir, '.claude', 'bounds.json');
	const shipped = fs.readFileSync(file, 'utf8');
	fs.writeFileSync(file, shipped.replace('"fixRound": 3', '"fixRound": 9'));
	assert.match(loop(r, ['next']).stdout, /LOOP STOP/);
	assert.equal(log(r).at(-1).kind, 'halt');
	// A run started on a bounds file other than the last run's waits for the owner's Yes to it (a restore or a stash).
	const r2 = repo();
	loop(r2, ['start', 'K1']);
	loop(r2, ['halt', 'ends here']);
	assert.equal(resume(r2).status, 0);
	for (const s of ['proof', 'design', 'build', 'sweep', 'pr', 'ci', 'merge', 'tag', 'release', 'install', 'verify', 'closeout']) {
		if (s === 'design') ownerTaps(r2, `loop design ${code(loop(r2, ['next']).stdout, 'design')}`);
		assert.equal(loop(r2, ['done', s, '--evidence', 'x']).status, 0, s);
	}
	fs.writeFileSync(path.join(r2.dir, '.claude', 'bounds.json'), shipped.replace('"who": "owner"', '"who": "alone"'));
	const refused = loop(r2, ['start', 'K2']);
	assert.equal(refused.status, 1, 'a changed bounds file started a run');
	ownerTaps(r2, `loop bounds ${code(refused.stdout, 'bounds')}`);
	assert.equal(loop(r2, ['start', 'K2']).status, 0);
	// A hand edit of the newest line, which has no line after it to show the break.
	const r3 = repo();
	loop(r3, ['start', 'K1']);
	loop(r3, ['done', 'proof', '--evidence', 'x']);
	const f = path.join(r3.dir, '.git', 'kit-loop.jsonl');
	fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('"x"', '"y"'));
	assert.equal(loop(r3, ['done', 'design', '--evidence', 'x']).status, 1);
	assert.match(loop(r3, ['next']).stdout, /LOOP STOP/);
	const r4 = repo();
	loop(r4, ['start', 'K1']);
	fs.writeFileSync(path.join(r4.cfg, 'autonomy-off'), '');
	assert.match(loop(r4, ['next']).stdout, /^NEXT proof: the owner's/m);
	assert.equal(loop(r4, ['done', 'proof', '--evidence', 'x']).status, 1, 'an alone step with the kill switch on');
	const r5 = repo();
	fs.rmSync(path.join(r5.dir, '.claude', 'bounds.json'));
	assert.equal(loop(r5, ['start', 'K1']).status, 1, 'no bounds file');
});

// why: guards rule:loop-workflow-mode (armed only by the owner's exact phrase; any owner message halts it)
test('loop mode arms only on the owner\'s exact phrase since it was last off, and any other owner message or a compact turns it off', () => {
	const r = repo();
	const state = () => log(r).filter((e) => e.kind === 'mode').at(-1);
	assert.equal(loop(r, ['mode', 'arm']).status, 1, 'armed with no owner message');
	ownerSays(r, 'please begin loop workflow now');
	assert.equal(loop(r, ['mode', 'arm']).status, 1, 'armed on a message that only holds the phrase');
	ownerSays(r, 'begin loop workflow');
	assert.equal(loop(r, ['mode', 'arm']).status, 0);
	assert.equal(state().state, 'armed');
	loop(r, ['mode', 'prompt', '--text', 'begin loop workflow']);
	assert.equal(state().state, 'armed', 'the phrase itself keeps it armed');
	loop(r, ['mode', 'prompt', '--text', 'how is it going?']);
	assert.equal(state().state, 'off');
	ownerSays(r, 'begin loop workflow');
	loop(r, ['mode', 'arm']);
	loop(r, ['mode', 'off', '--why', 'compact']);
	assert.equal(state().why, 'compact');
	assert.equal(loop(r, ['mode', 'arm']).status, 1, 'armed again after a compact on the old phrase');
	assert.match(loop(r, ['show']).stdout, /loop mode: off/);
});

// The hooks are what call it: the prompt hook on each owner message, and the session start and compact hooks. The
// prompt and session start hooks also record the session, the only one whose answers the driver reads.
// why: guards rule:loop-workflow-mode
test('the kit hook records the session, halts an armed loop on an owner message and turns it off at a compact', () => {
	const r = repo({ session: null });
	fs.copyFileSync(path.resolve('project/.claude/kit-hook.cjs'), path.join(r.dir, '.claude', 'kit-hook.cjs'));
	// An installed kit, as the hook finds it (a missing kit is a full stop before anything else runs).
	fs.writeFileSync(path.join(r.cfg, 'kit-install.json'), JSON.stringify({ kitDir: path.resolve('.') }));
	const hook = (mode, input) => spawnSync(process.execPath, [path.join(r.dir, '.claude', 'kit-hook.cjs'), mode], { cwd: r.dir, input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: r.dir, KIT_CLAUDE_HOME: r.cfg, CLAUDE_CONFIG_DIR: r.cfg } });
	const state = () => log(r).filter((e) => e.kind === 'mode').at(-1);
	ownerSays(r, 'begin loop workflow');
	hook('prompt', { prompt: 'begin loop workflow', session_id: SID });
	assert.equal(fs.readFileSync(path.join(r.dir, '.git', 'kit-loop-session'), 'utf8'), SID);
	assert.equal(loop(r, ['mode', 'arm']).status, 0);
	hook('prompt', { prompt: 'stop for a second', session_id: SID });
	assert.equal(state().state, 'off');
	ownerSays(r, 'begin loop workflow');
	loop(r, ['mode', 'arm']);
	hook('pre-compact', { session_id: SID });
	assert.equal(state().why, 'compact');
	ownerSays(r, 'begin loop workflow');
	loop(r, ['mode', 'arm']);
	hook('session-start', { source: 'resume', session_id: SID });
	assert.equal(state().why, 'session start');
});
