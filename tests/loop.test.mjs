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
// Each answer a millisecond or more after the last, as a person's taps are: two in one millisecond read as one moment.
let lastTap = 0;
// A tap's stamp sits a second ahead of the clock; a new step opened before then would see it as an answer after it.
const settle = () => { while (Date.now() <= lastTap); };
function ownerTaps(r, act, { answer = 'Yes', sid = SID } = {}) {
	lastTap = Math.max(Date.now() + 1000, lastTap + 1);
	const at = new Date(lastTap).toISOString();
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
// The plan step's self-approval line (T7 slice 2): the session records it before it asks the owner.
const shadow = (r, would = 'yes') => loop(r, ['shadow', '--would', would, '--why', 'grounded in the item and the charter']);
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
	assert.match(next.stdout, /^NEXT design: the owner's;.*shadow --would/m);
	assert.equal(code(next.stdout, 'design'), undefined, 'no act to quote before the verdict');
	shadow(r);
	assert.ok(code(loop(r, ['next']).stdout, 'design'), 'the act, once the verdict is recorded');
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
	assert.equal(shadow(r).status, 0);
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
		if (s === 'design') shadow(r2);
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
	// A guard's step too: with the switch on, its evidence alone is not enough (the build 12 sweep).
	fs.rmSync(path.join(r4.cfg, 'autonomy-off'));
	for (const s of ['proof', 'design', 'build', 'sweep', 'pr', 'ci']) {
		if (s === 'design') shadow(r4);
		if (s === 'design') ownerTaps(r4, `loop design ${code(loop(r4, ['next']).stdout, 'design')}`);
		assert.equal(loop(r4, ['done', s, '--evidence', 'x']).status, 0, s);
	}
	fs.writeFileSync(path.join(r4.cfg, 'autonomy-off'), '');
	assert.equal(loop(r4, ['done', 'merge', '--evidence', 'x']).status, 1, 'a guard step with the kill switch on');
	const r5 = repo();
	fs.rmSync(path.join(r5.dir, '.claude', 'bounds.json'));
	assert.equal(loop(r5, ['start', 'K1']).status, 1, 'no bounds file');
});

// T7 slice 2 (build 13; the stop-point map's S3, the owner's streak of 10, 2026-11-16): each plan says whether it would
// approve itself, and the record of whether the owner agreed comes from the owner's own answers, never the session's
// word. Self-approval stays off; the streak only shows how close the owner's bar is.
// why: guards the owner's S3 shadow mode: no plan skips the owner, and a disagreement cannot be hidden
test('the plan step needs its self-approval line first, and the streak counts only plans the owner passed on the first answer', () => {
	const r = repo();
	const finish = (run) => {
		for (const s of ['build', 'sweep', 'pr', 'ci', 'merge', 'tag', 'release', 'install', 'verify', 'closeout']) assert.equal(loop(run, ['done', s, '--evidence', 'x']).status, 0, s);
	};
	const plan = (item, would, answers) => {
		settle();
		assert.equal(loop(r, ['start', item]).status, 0);
		assert.equal(loop(r, ['shadow', '--would', would, '--why', 'x']).status, 1, 'a shadow line before the plan step opened');
		loop(r, ['done', 'proof', '--evidence', 'x']);
		const bare = loop(r, ['done', 'design', '--evidence', 'plan v1']);
		assert.equal(bare.status, 1, 'a plan with no self-approval line');
		assert.match(bare.stdout, /shadow --would yes\|no --why/);
		assert.equal(loop(r, ['shadow', '--would', 'maybe', '--why', 'x']).status, 2);
		assert.equal(loop(r, ['shadow', '--would', would]).status, 2, 'no why');
		assert.equal(shadow(r, would).status, 0);
		assert.equal(shadow(r, would === 'yes' ? 'no' : 'yes').status, 1, 'a second verdict on the same plan');
		const act = `loop design ${code(loop(r, ['next']).stdout, 'design')}`;
		for (const a of answers) ownerTaps(r, act, { answer: a });
		assert.equal(loop(r, ['done', 'design', '--evidence', 'plan v1']).status, 0);
		finish(r);
		return loop(r, ['show']).stdout;
	};
	assert.match(plan('K1', 'yes', ['Yes']), /shadow: 1 of 10 agreeing plans in a row/);
	assert.match(plan('K2', 'yes', ['Yes']), /shadow: 2 of 10/);
	assert.match(plan('K3', 'no', ['Yes']), /shadow: 2 of 10/, 'a "would not" plan moves nothing');
	assert.match(plan('K4', 'yes', ['No', 'Yes']), /shadow: 0 of 10/, 'a plan the owner first answered No to resets the streak');
	assert.deepEqual(log(r).filter((e) => e.kind === 'done' && e.step === 'design').map((e) => e.shadow.outcome), ['agree', 'agree', 'cautious', 'disagree']);
	assert.match(loop(r, ['show']).stdout, /self-approval stays off/);
	// The build 13 sweep: the owner's latest answer decides the lock, and a No anywhere is a disagreement; an answer
	// out of sight (another session, a word typed after the verdict) leaves the plan unscored, never agreed.
	const open = (item) => { settle(); loop(r, ['start', item]); loop(r, ['done', 'proof', '--evidence', 'x']); };
	const act = () => `loop design ${code(loop(r, ['next']).stdout, 'design')}`;
	const outcome = () => log(r).filter((e) => e.kind === 'done' && e.step === 'design').at(-1).shadow.outcome;
	open('K5');
	shadow(r);
	ownerTaps(r, act());
	ownerTaps(r, act(), { answer: 'No' });
	assert.equal(loop(r, ['done', 'design', '--evidence', 'x']).status, 1, 'a Yes, then a No');
	ownerTaps(r, act());
	assert.equal(loop(r, ['done', 'design', '--evidence', 'x']).status, 0);
	assert.equal(outcome(), 'disagree');
	finish(r);
	open('K6');
	ownerTaps(r, 'is the plan for K6 fine');
	shadow(r);
	ownerTaps(r, act());
	loop(r, ['done', 'design', '--evidence', 'x']);
	assert.equal(outcome(), 'unscored', 'an answer before the verdict');
	finish(r);
	open('K7');
	shadow(r);
	ownerSays(r, 'looks fine to me');
	ownerTaps(r, act());
	loop(r, ['done', 'design', '--evidence', 'x']);
	assert.equal(outcome(), 'unscored', 'an owner message after the verdict');
	finish(r);
	open('K8');
	shadow(r);
	fs.writeFileSync(path.join(r.dir, '.git', 'kit-loop-session'), OTHER);
	ownerTaps(r, act(), { sid: OTHER });
	loop(r, ['done', 'design', '--evidence', 'x']);
	assert.equal(outcome(), 'unscored', 'a verdict from another session');
	assert.match(loop(r, ['show']).stdout, /shadow: 0 of 10/);
	fs.writeFileSync(path.join(r.dir, '.git', 'kit-loop-session'), SID);
	// The owner's bounds file sets the step and the streak; at the streak the record says the owner may decide.
	const short = repo();
	const file = path.join(short.dir, '.claude', 'bounds.json');
	const b = JSON.parse(fs.readFileSync(file, 'utf8'));
	b.shadow = { step: 'design', streak: 1 };
	fs.writeFileSync(file, JSON.stringify(b));
	loop(short, ['start', 'K1']);
	loop(short, ['done', 'proof', '--evidence', 'x']);
	// The plan's act is made from its verdict (the build 13 review): an answer to the act the step had before a verdict,
	// the 1.38.0 spelling, locks nothing, so a session cannot ask first and write a verdict to fit the answer.
	const run = log(short).find((e) => e.kind === 'start').run;
	ownerTaps(short, `loop design ${crypto.createHash('sha256').update(`${run}:design`).digest('hex').slice(0, 6)}`);
	shadow(short);
	assert.equal(loop(short, ['done', 'design', '--evidence', 'x']).status, 1, 'a Yes to the act from before the verdict');
	ownerTaps(short, `loop design ${code(loop(short, ['next']).stdout, 'design')}`);
	assert.equal(loop(short, ['done', 'design', '--evidence', 'x']).status, 0);
	// The owner answered before the verdict was written, so it could fit their answer: kept, and it scores nothing.
	assert.equal(log(short).filter((e) => e.kind === 'done' && e.step === 'design').at(-1).shadow.outcome, 'unscored');
	finish(short);
	settle();
	loop(short, ['start', 'K2']);
	loop(short, ['done', 'proof', '--evidence', 'x']);
	shadow(short);
	ownerTaps(short, `loop design ${code(loop(short, ['next']).stdout, 'design')}`);
	loop(short, ['done', 'design', '--evidence', 'x']);
	assert.match(loop(short, ['show']).stdout, /shadow: 1 of 1 .*reached/);
	b.shadow = { step: 'design', streak: 0 };
	fs.writeFileSync(file, JSON.stringify(b));
	assert.match(loop(repo(), ['start', 'K1']).stdout, /run started|NEXT/, 'the shipped bounds start');
	const bad = repo();
	fs.writeFileSync(path.join(bad.dir, '.claude', 'bounds.json'), JSON.stringify(b));
	assert.match(loop(bad, ['start', 'K1']).stdout, /shadow/, 'a streak under 1 is refused');
});

// T7 slice 2 (build 13; the stop-point map's S13): opening the next thread on its own needs a handoff that passes the
// closeout audit, a daily cap and the kill switch off. The check is the instrument; chaining stays off until the
// owner writes a cap into the bounds file, and opening the thread stays the coordinator's.
// why: guards the owner's S13 stop: no runaway threads, and no thread opened on a handoff the next one cannot use
test('the chain check says GO only for a clean handoff, a closed run, the kill switch off and today\'s cap not reached', () => {
	const r = repo();
	fs.mkdirSync(path.join(r.cfg, 'skills', 'closeout'), { recursive: true });
	fs.copyFileSync(path.resolve('user/skills/closeout/audit.mjs'), path.join(r.cfg, 'skills', 'closeout', 'audit.mjs'));
	const handoff = path.join(r.dir, 'handoff.md');
	fs.writeFileSync(handoff, '# Notes - Continuation Handoff\n\n## REQUIRED FIRST ACTIONS\nRun the Post-Compact Orientation Protocol.\n\n## Working Mode: Plan\n\n## State Snapshot\n- Git: main at a1b2c3d, pushed\n\n## Newly-Established Working Standards\nnone\n\n## Critical In-Flight Context\n- none\n\n## Reading Order\n1. _Start Here.md\n\n## Next Step\n- What: K7, the export fix\n\n## Anti-Hallucination Discipline\n- verified\n');
	const bounds = path.join(r.dir, '.claude', 'bounds.json');
	const cap = (n) => { const b = JSON.parse(fs.readFileSync(bounds, 'utf8')); if (n == null) delete b.limits.threadsPerDay; else b.limits.threadsPerDay = n; fs.writeFileSync(bounds, JSON.stringify(b)); };
	const chain = (...more) => loop(r, ['chain', handoff, ...more]);
	assert.equal(loop(r, ['chain']).status, 2, 'no handoff named');
	const off = chain();
	assert.equal(off.status, 1);
	assert.match(off.stdout, /^STOP/m);
	assert.match(off.stdout, /threadsPerDay/, 'with no cap, chaining is off');
	cap(2);
	const go = chain();
	assert.equal(go.status, 0, go.stdout);
	assert.match(go.stdout, /^GO: .*K7, the export fix/m);
	assert.equal(fs.existsSync(path.join(r.dir, '.git', 'kit-loop.jsonl')), false, 'a check alone writes nothing');
	// The handoff the next thread starts from must pass the audit.
	fs.writeFileSync(`${handoff}.bad`, fs.readFileSync(handoff, 'utf8').replace('- What: K7, the export fix\n', ''));
	const bad = loop(r, ['chain', `${handoff}.bad`]);
	assert.equal(bad.status, 1);
	assert.match(bad.stdout, /closeout audit[\s\S]*Next Step: say what comes next/);
	// An open or halted run, and the kill switch, each stop it.
	loop(r, ['start', 'K6']);
	assert.match(chain().stdout, /run K6 is still open/);
	loop(r, ['halt', 'stuck']);
	assert.match(chain().stdout, /halted/);
	const r2 = repo();
	fs.mkdirSync(path.join(r2.cfg, 'skills', 'closeout'), { recursive: true });
	fs.copyFileSync(path.resolve('user/skills/closeout/audit.mjs'), path.join(r2.cfg, 'skills', 'closeout', 'audit.mjs'));
	fs.copyFileSync(bounds, path.join(r2.dir, '.claude', 'bounds.json'));
	const chain2 = (...more) => loop(r2, ['chain', handoff, ...more]);
	assert.equal(chain2().status, 0);
	fs.writeFileSync(path.join(r2.cfg, 'autonomy-off'), '');
	assert.match(chain2().stdout, /kill switch/);
	fs.rmSync(path.join(r2.cfg, 'autonomy-off'));
	// The cap counts the threads opened in the last 24 hours, each recorded by --open.
	assert.equal(chain2('--open').status, 0);
	assert.equal(chain2('--open').status, 0);
	const full = chain2('--open');
	assert.equal(full.status, 1);
	assert.match(full.stdout, /2 of 2 threads opened in the last 24 hours/);
	assert.equal(log(r2).filter((e) => e.kind === 'chain').length, 2, 'a refused open is not recorded');
	// A raised cap is a changed bounds file: it applies only on the owner's Yes to it, as a run's start asks (the build
	// 13 review).
	const b2 = path.join(r2.dir, '.claude', 'bounds.json');
	fs.writeFileSync(b2, JSON.stringify({ ...JSON.parse(fs.readFileSync(b2, 'utf8')), limits: { ...JSON.parse(fs.readFileSync(b2, 'utf8')).limits, threadsPerDay: 3 } }));
	const raised = chain2('--open');
	assert.equal(raised.status, 1);
	ownerTaps(r2, `loop bounds ${code(raised.stdout, 'bounds')}`);
	assert.equal(chain2('--open').status, 0, 'the raised cap, on the owner\'s Yes');
	// The count lives in the log, so a hand edit stops the check with no run open, until the owner accepts the log.
	const f2 = path.join(r2.dir, '.git', 'kit-loop.jsonl');
	fs.writeFileSync(f2, fs.readFileSync(f2, 'utf8').replace('K7, the export fix', 'K7'));
	const broken = chain2();
	assert.match(broken.stdout, /changed by hand/);
	assert.equal(loop(r2, ['resume']).status, 1, 'accepted with no Yes');
	ownerTaps(r2, `loop resume ${code(broken.stdout, 'resume')}`);
	assert.equal(loop(r2, ['resume']).status, 0);
	assert.doesNotMatch(chain2().stdout, /changed by hand/);
	assert.match(chain2().stdout, /3 of 3 threads/);
	// The build 13 sweep, each a way to GO that should have waited.
	// (1) A Yes to resume an unrelated halt does not accept a hand edit: only the owner's Yes to the log itself does.
	settle();
	loop(r2, ['start', 'K8']);
	fs.writeFileSync(f2, fs.readFileSync(f2, 'utf8').replace(/"time":"[^"]+"/, '"time":"2000-01-01T00:00:00.000Z"'));
	loop(r2, ['halt', 'waiting on CI']);
	ownerTaps(r2, `loop resume ${code(loop(r2, ['next']).stdout, 'resume')}`);
	assert.equal(loop(r2, ['resume']).status, 0);
	for (const s of ['proof', 'design', 'build', 'sweep', 'pr', 'ci', 'merge', 'tag', 'release', 'install', 'verify', 'closeout']) {
		if (s === 'design') { shadow(r2); ownerTaps(r2, `loop design ${code(loop(r2, ['next']).stdout, 'design')}`); }
		loop(r2, ['done', s, '--evidence', 'x']);
	}
	assert.match(chain2('--open').stdout, /changed by hand/, 'a resume accepted the edit');
	// (2) A chain entry whose time does not read counts as today, never as a free place under the cap.
	assert.match(chain2().stdout, /changed by hand/);
	// (3) An emptied log beside its head file is a hand edit, not a fresh start.
	const r3 = repo();
	fs.copyFileSync(bounds, path.join(r3.dir, '.claude', 'bounds.json'));
	fs.mkdirSync(path.join(r3.cfg, 'skills', 'closeout'), { recursive: true });
	fs.copyFileSync(path.resolve('user/skills/closeout/audit.mjs'), path.join(r3.cfg, 'skills', 'closeout', 'audit.mjs'));
	const chain3 = (...more) => loop(r3, ['chain', handoff, ...more]);
	assert.equal(chain3('--open').status, 0);
	assert.equal(chain3('--open').status, 0);
	fs.writeFileSync(path.join(r3.dir, '.git', 'kit-loop.jsonl'), '');
	assert.match(chain3('--open').stdout, /changed by hand/);
	const r4 = repo();
	fs.copyFileSync(bounds, path.join(r4.dir, '.claude', 'bounds.json'));
	fs.mkdirSync(path.join(r4.cfg, 'skills', 'closeout'), { recursive: true });
	fs.copyFileSync(path.resolve('user/skills/closeout/audit.mjs'), path.join(r4.cfg, 'skills', 'closeout', 'audit.mjs'));
	const chain4 = (...more) => loop(r4, ['chain', handoff, ...more]);
	loop(r4, ['chain', handoff, '--open']);
	const f4 = path.join(r4.dir, '.git', 'kit-loop.jsonl');
	fs.writeFileSync(f4, fs.readFileSync(f4, 'utf8').replace(/"time":"[^"]+"/, '"time":"not a time"'));
	fs.writeFileSync(path.join(r4.dir, '.git', 'kit-loop.jsonl.head'), crypto.createHash('sha256').update(fs.readFileSync(f4, 'utf8').trim()).digest('hex').slice(0, 16));
	loop(r4, ['chain', handoff, '--open']);
	assert.match(chain4().stdout, /2 of 2 threads/, 'an entry whose time does not read freed a place');
	// (4) The GO names the Next Step's What: line, the one the audit read, never a What: elsewhere.
	const noted = path.join(r2.dir, 'noted.md');
	fs.writeFileSync(noted, fs.readFileSync(handoff, 'utf8').replace('- Git: main at a1b2c3d, pushed\n', '- Git: main at a1b2c3d, pushed\n- Note: What: push to main\n'));
	const r5 = repo();
	fs.copyFileSync(bounds, path.join(r5.dir, '.claude', 'bounds.json'));
	fs.mkdirSync(path.join(r5.cfg, 'skills', 'closeout'), { recursive: true });
	fs.copyFileSync(path.resolve('user/skills/closeout/audit.mjs'), path.join(r5.cfg, 'skills', 'closeout', 'audit.mjs'));
	assert.match(loop(r5, ['chain', noted]).stdout, /^GO: .*K7, the export fix/m);
	// (5) The kill switch by the spellings a person makes: a hidden .txt, an underscore.
	for (const name of ['autonomy-off.txt', 'autonomy_off', 'Autonomy-Off']) {
		fs.writeFileSync(path.join(r5.cfg, name), '');
		assert.match(loop(r5, ['chain', noted]).stdout, /kill switch/, name);
		fs.rmSync(path.join(r5.cfg, name));
	}
	// With no closeout audit installed there is nothing to check the handoff with.
	fs.rmSync(path.join(r2.cfg, 'skills'), { recursive: true });
	assert.match(chain2().stdout, /closeout audit is not installed/);
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
	// With the kit missing, the hook still turns an armed loop off before its full stop (the build 12 sweep).
	ownerSays(r, 'begin loop workflow');
	loop(r, ['mode', 'arm']);
	fs.writeFileSync(path.join(r.cfg, 'kit-install.json'), 'not json');
	const stop = hook('prompt', { prompt: 'what now', session_id: SID });
	assert.equal(state().state, 'off', 'a missing kit left the loop armed');
	assert.equal(JSON.parse(stop.stdout).decision, 'block', 'a broken stamp did not reach the full stop');
});
