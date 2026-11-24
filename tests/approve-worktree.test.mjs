// K357: sweep approval reads the branch's own worktree and the pause ask names the session id the resume needs.

import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FIX_EXIT, TAP_SID, approveIn, approvalLog, askContract, featureContract, g, makeTemp, ownerTaps, read, sweepRepo, tapEnv } from './kit-helpers.mjs';

const RULES = (phrase, pad = 0) => ['# Agent teams', ...Array(pad).fill('pad'), '8. **Rules every brief carries**', `   Confirmation phrase: open with: ${phrase}`, ''].join('\n');
const real = (p) => fs.realpathSync.native(p).split(path.sep).join('/').toLowerCase();

// A main checkout and a linked worktree on its own branch, each with its own untracked rules file (git ignores both).
function twoCheckouts() {
  const dir = sweepRepo();
  fs.mkdirSync(path.join(dir, 'standards'));
  fs.writeFileSync(path.join(dir, 'standards', 'agent-teams.md'), RULES('Main Main'));
  fs.appendFileSync(path.join(dir, '.git', 'info', 'exclude'), 'standards/\n');
  const wt = path.join(path.dirname(dir), `${path.basename(dir)}-wt`);
  g(dir, 'worktree', 'add', '-q', wt, '-b', 'feat/wt');
  fs.mkdirSync(path.join(wt, 'standards'), { recursive: true });
  fs.writeFileSync(path.join(wt, 'standards', 'agent-teams.md'), RULES('Wt Wt', 2));
  fs.mkdirSync(path.join(wt, 'sweeps'), { recursive: true });
  return { dir, wt };
}
const clear = (where, file, env = {}) => { fs.writeFileSync(file, JSON.stringify(featureContract())); return approveIn(where, [file], env); };
const firstBrief = (folder) => read(path.join(folder, 'contract-brief-1.md')).split('\n')[0].toLowerCase();
const recordedPhrase = (dir) => JSON.parse(read(path.join(dir, '.git', 'kit-sweep-rules.json'))).phrase;
// A paused log: an escape pauses auto-approval, so the next ask carries the resume help.
const pause = (where, file) => { fs.writeFileSync(file, JSON.stringify(askContract())); const e = approveIn(where, [file, '--escape', 'a bug got through'], {}); assert.equal(e.status, 0, e.stdout + e.stderr); };

// why: catches a contract on a branch checked out in a linked worktree reads that worktree's untracked rule files and merge base, not the main checkout's (K357 S1)
test('a contract on a branch checked out in a linked worktree reads that worktree\'s untracked rule files and merge base, not the main checkout\'s', () => {
  const { dir, wt } = twoCheckouts();
  const r = clear(wt, path.join(wt, 'sweeps', 'contract.json'));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const first = firstBrief(path.join(wt, 'sweeps'));
  assert.ok(first.includes(`${real(wt)}/standards/agent-teams.md with the read tool`), first);
  assert.ok(!first.includes(`${real(dir)}/standards/agent-teams.md`), `names the main checkout's file: ${first}`);
  assert.equal(recordedPhrase(dir), 'Wt Wt', 'the canary phrase is the worktree file\'s');
  // The merge base the log records is the worktree branch's own.
  assert.equal(approvalLog(dir).pop().base, g(wt, 'merge-base', 'main', 'HEAD').stdout.trim());
});

// why: catches the pause ask prints the session id the resume needs, and names CLAUDE_CODE_SESSION_ID when it is unset (K357 S2)
test('the pause ask prints the session id the resume needs, and names CLAUDE_CODE_SESSION_ID when it is unset', () => {
  const { wt } = twoCheckouts();
  const f = path.join(wt, 'sweeps', 'contract.json');
  pause(wt, f);
  fs.writeFileSync(f, JSON.stringify(askContract()));
  const withId = approveIn(wt, [f], { CLAUDE_CODE_SESSION_ID: TAP_SID });
  assert.match(withId.stdout, /ASK THE OWNER/);
  assert.match(withId.stdout, /--resume/);
  assert.ok(withId.stdout.includes(TAP_SID), `the resume line names no session id:\n${withId.stdout}`);
  const without = approveIn(wt, [f], {});
  assert.match(without.stdout, /ASK THE OWNER/);
  // K377 U14: --resume finds the owner's pop-up answer with no session id in the shell, so the unset case still names the step.
  assert.match(without.stdout, /--resume/, `the unset case names no resume step:\n${without.stdout}`);
  assert.ok(!without.stdout.includes(TAP_SID));
});

// why: catches a contract in the main checkout reads as before (K357 S3)
test('a contract in the main checkout reads as before', () => {
  const { dir } = twoCheckouts();
  fs.mkdirSync(path.join(dir, 'sweeps'), { recursive: true });
  const f = path.join(dir, 'sweeps', 'contract.json');
  // Control: the main checkout's own untracked file is still the one read, and the main checkout still owns the log.
  const r = clear(dir, f);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(firstBrief(path.join(dir, 'sweeps')).includes(`${real(dir)}/standards/agent-teams.md with the read tool`));
  assert.equal(recordedPhrase(dir), 'Main Main');
  assert.equal(approvalLog(dir).pop().decision, 'approved');
  // The pause ask there names the session id as well, and the resume step is the same one.
  const paused = twoCheckouts().dir;
  const pf = path.join(paused, 'sweeps', 'contract.json');
  pause(paused, pf);
  fs.writeFileSync(pf, JSON.stringify(askContract()));
  const ask = approveIn(paused, [pf], { CLAUDE_CODE_SESSION_ID: TAP_SID });
  assert.match(ask.stdout, /--resume/);
  assert.ok(ask.stdout.includes(TAP_SID), ask.stdout);
});

// why: catches a contract path through a symlink or a .. spelling resolves to the same worktree (K357 S4)
test('a contract path through a symlink or a .. spelling resolves to the same worktree', () => {
  const a = twoCheckouts();
  const dotted = path.join(a.wt, 'sweeps', '..', 'sweeps', '..', 'sweeps', 'contract.json');
  const ra = clear(a.wt, dotted);
  assert.equal(ra.status, 0, ra.stdout + ra.stderr);
  assert.ok(firstBrief(path.join(a.wt, 'sweeps')).includes(`${real(a.wt)}/standards/agent-teams.md with the read tool`), firstBrief(path.join(a.wt, 'sweeps')));
  assert.equal(recordedPhrase(a.dir), 'Wt Wt');
  // A junction (a directory symlink that needs no privilege on Windows) to the worktree's sweeps folder, run from the main checkout.
  const b = twoCheckouts();
  const link = path.join(path.dirname(b.dir), `${path.basename(b.dir)}-link`);
  fs.symlinkSync(path.join(b.wt, 'sweeps'), link, 'junction');
  const rb = clear(b.dir, path.join(link, 'contract.json'));
  assert.equal(rb.status, 0, rb.stdout + rb.stderr);
  assert.ok(firstBrief(path.join(b.wt, 'sweeps')).includes(`${real(b.wt)}/standards/agent-teams.md with the read tool`), firstBrief(path.join(b.wt, 'sweeps')));
  assert.equal(recordedPhrase(b.dir), 'Wt Wt');
});

// why: catches two runs on the same contract give the same decision (K357 S5)
test('two runs on the same contract give the same decision', () => {
  const { dir, wt } = twoCheckouts();
  const f = path.join(wt, 'sweeps', 'contract.json');
  pause(wt, f);
  fs.writeFileSync(f, JSON.stringify(askContract()));
  const env = { CLAUDE_CODE_SESSION_ID: TAP_SID };
  const same = (out) => out.stdout.split('\n').filter((l) => !/Triage report/.test(l)).join('\n');
  const one = approveIn(wt, [f], env);
  const two = approveIn(wt, [f], env);
  assert.equal(same(one), same(two));
  assert.ok(one.stdout.includes(TAP_SID), `the ask names no session id:\n${one.stdout}`);
  const [x, y] = approvalLog(dir).filter((e) => e.kind === 'decision').slice(-2);
  assert.deepEqual([x.decision, x.reasons, x.hash, x.base], [y.decision, y.reasons, y.hash, y.base]);
});

// why: guards rule:sweep-auto-approval (a worktree git cannot read is never approved from: FIX THE CONTRACT, logged) (K357 S6)
test('a worktree git cannot read gives FIX THE CONTRACT, logged', () => {
  const { dir, wt } = twoCheckouts();
  // Git still finds the repository from the contract's folder but no work tree: the worktree cannot be read.
  const f = path.join(dir, '.git', 'worktrees', path.basename(wt), 'contract.json');
  fs.writeFileSync(f, JSON.stringify(featureContract()));
  const before = fs.existsSync(path.join(dir, '.git', 'kit-sweep-approvals.jsonl')) ? approvalLog(dir).length : 0;
  const r = approveIn(dir, [f], {});
  assert.equal(r.status, FIX_EXIT, r.stdout + r.stderr);
  assert.match(r.stdout, /FIX THE CONTRACT/);
  assert.doesNotMatch(r.stdout, /APPROVED/);
  const last = approvalLog(dir).slice(before).pop();
  assert.ok(last, 'nothing logged');
  assert.equal(last.decision, 'fix');
  assert.ok(last.reasons.some((x) => /worktree/i.test(x)), JSON.stringify(last.reasons));
});

// why: catches a worktree with no rules file of its own reading nothing, so the main checkout's block is never read or slot-checked (K357 C1)
// planted: {"file":"user/skills/pre-pr-sweep/approve.mjs","was":"for (const root of [top, mainTop])","to":"for (const root of [top])"}
test('a worktree that lacks the rules file reads the main checkout\'s file, and a slotted block there still gives FIX THE CONTRACT', () => {
  const clean = twoCheckouts();
  fs.rmSync(path.join(clean.wt, 'standards'), { recursive: true });
  const r = clear(clean.wt, path.join(clean.wt, 'sweeps', 'contract.json'));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const first = firstBrief(path.join(clean.wt, 'sweeps'));
  assert.ok(first.includes(`${real(clean.dir)}/standards/agent-teams.md with the read tool`), `the brief names no absolute path to the main file: ${first}`);
  assert.equal(recordedPhrase(clean.dir), 'Main Main', 'the canary phrase is the main checkout file\'s');
  // The main checkout's block still holds a template slot: the fallback runs the slot check too.
  const slotted = twoCheckouts();
  fs.rmSync(path.join(slotted.wt, 'standards'), { recursive: true });
  fs.writeFileSync(path.join(slotted.dir, 'standards', 'agent-teams.md'), ['# Agent teams', '8. **Rules every brief carries**', '   <PROJECT NAME> - RULES EVERY AGENT FOLLOWS', '   Confirmation phrase: open with: Main Main', ''].join('\n'));
  const bad = clear(slotted.wt, path.join(slotted.wt, 'sweeps', 'contract.json'));
  assert.equal(bad.status, FIX_EXIT, bad.stdout + bad.stderr);
  assert.match(bad.stdout, /FIX THE CONTRACT/);
  assert.doesNotMatch(bad.stdout, /APPROVED/);
});

// why: catches the owner's yes or resume missed because the asking session's transcript sits under a checkout key the lookup never reads (K357 C2)
test('the owner yes is found from a worktree whether the asking session\'s transcript is under the worktree\'s folder or the main checkout\'s', () => {
  const asked = (c) => {
    const f = path.join(c.wt, 'sweeps', 'contract.json');
    fs.writeFileSync(f, JSON.stringify(askContract()));
    const ask = approveIn(c.wt, [f], {});
    const m = ask.stdout.match(/`sweep yes ([0-9a-f]{6})`/);
    assert.ok(m, ask.stdout + ask.stderr);
    return { f, act: `sweep yes ${m[1]}` };
  };
  // The session ran in the worktree: its transcript is kept only under the worktree's own projects folder.
  const own = twoCheckouts();
  const a = asked(own);
  const cfgOwn = makeTemp('cfg-');
  ownerTaps(cfgOwn, own.wt, a.act);
  const okOwn = approveIn(own.wt, [a.f, '--owner-yes'], tapEnv(cfgOwn));
  assert.equal(okOwn.status, 0, okOwn.stdout + okOwn.stderr);
  assert.equal(approvalLog(own.dir).pop().kind, 'owner-yes');
  // The session ran in the main checkout and the yes runs from a sibling worktree: its key is the main checkout's.
  const sib = twoCheckouts();
  const b = asked(sib);
  const cfgSib = makeTemp('cfg-');
  ownerTaps(cfgSib, sib.dir, b.act);
  const okSib = approveIn(sib.wt, [b.f, '--owner-yes'], tapEnv(cfgSib));
  assert.equal(okSib.status, 0, okSib.stdout + okSib.stderr);
  assert.equal(approvalLog(sib.dir).pop().kind, 'owner-yes');
});
