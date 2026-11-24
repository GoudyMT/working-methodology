// Tests for U14 (K377): --resume and --owner-yes work with no CLAUDE_CODE_SESSION_ID in the shell. The owner's accepted
// pop-up is found among this repo's own session records, for this pause's or ask's code, and nowhere else.

import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { TAP_SID, g, approvalLog, approveIn, approveRun, askContract, featureContract, makeTemp, outcome, ownerTaps } from './kit-helpers.mjs';

const OTHER_SID = '1bbbbbbb-1bbb-2ccc-3ddd-4eeeeeeeeeee';
// The child's env: a Claude Code shell (so the call is not read as the owner's terminal), the folder of session records,
// and no session id.
const noSid = (cfg) => ({ CLAUDE_CONFIG_DIR: cfg, CLAUDECODE: '1' });
const repoKey = (dir) => fs.realpathSync.native(dir).replace(/[^A-Za-z0-9]/g, '-');

// A paused sweep: the outcome ran over its ceiling, and the next ask pauses and prints the pause's code.
const paused = () => {
  const r = approveRun(featureContract());
  outcome(r, String(Math.ceil(537500 * 1.3)));
  const ask = approveIn(r.dir, [r.f]);
  const code = (ask.stdout.match(/`sweep resume ([0-9a-f]{6})`/) || [])[1];
  assert.ok(code, ask.stdout);
  return { ...r, code };
};
// An ask sent to the owner, with the ask's code.
const asked = (dir) => {
  const r = approveRun(askContract(), dir);
  assert.equal(r.status, 1, r.stdout);
  const code = (r.stdout.match(/`sweep yes ([0-9a-f]{6})`/) || [])[1];
  assert.ok(code, r.stdout);
  return { ...r, code };
};
const kinds = (dir) => approvalLog(dir).map((e) => e.kind);

// why: catches a resume that needs a session id the owner's shell never has (K377 S1)
test('--resume with no session id finds the accepted pop-up for this pause among this repo\'s sessions, and not another repo\'s', () => {
  const r = paused();
  const cfg = makeTemp('cfg-');
  // F1 (K394): a newer Yes to the same act in another repo's sessions is never read.
  ownerTaps(cfg, r.dir, `sweep resume ${r.code}`, { sid: OTHER_SID, folder: 'C--elsewhere', at: new Date(Date.now() + 5000).toISOString() });
  assert.equal(approveIn(r.dir, ['--resume'], noSid(cfg)).status, 1, 'another repo\'s Yes is not read');
  ownerTaps(cfg, r.dir, `sweep resume ${r.code}`);
  const ok = approveIn(r.dir, ['--resume'], noSid(cfg));
  assert.equal(ok.status, 0, ok.stdout);
  const line = approvalLog(r.dir).pop();
  assert.deepEqual([line.kind, line.proof], ['resume', 'popup']);
  assert.match(line.tap, new RegExp(`^${TAP_SID}:toolu_`), 'the Yes came from this repo\'s session');
});

// why: catches an owner yes that needs a session id, or an ask code a later ask shares (K377 S1, F2)
test('--owner-yes with no session id finds the Yes for this ask\'s code, and a Yes to an earlier ask cannot clear a later one', () => {
  const a = asked();
  const cfg = makeTemp('cfg-');
  // The first ask is still open: asking again prints the same code.
  const reask = approveIn(a.dir, [a.f]);
  assert.equal((reask.stdout.match(/`sweep yes ([0-9a-f]{6})`/) || [])[1], a.code, 'an open ask changed its code when asked again');
  // The same contract and question asked in another repo has a code of its own: the code covers the repo.
  assert.notEqual(asked().code, a.code, 'two repos share an ask code');
  // F2: a second, different contract in the same repo has a code of its own.
  const fB = a.f.replace('contract.json', 'contract-b.json');
  const cB = JSON.parse(fs.readFileSync(a.f, 'utf8'));
  cB.roles[0].question += ' Also the second ask.';
  fs.writeFileSync(fB, JSON.stringify(cB));
  const second = approveIn(a.dir, [fB]);
  const codeB = (second.stdout.match(/`sweep yes ([0-9a-f]{6})`/) || [])[1];
  assert.ok(codeB, second.stdout);
  assert.notEqual(codeB, a.code, 'two asks share a code');
  // A Yes quoting the first ask's code is refused for the second.
  const before = kinds(a.dir).length;
  ownerTaps(cfg, a.dir, `sweep yes ${a.code}`);
  const late = approveIn(a.dir, [fB, '--owner-yes'], noSid(cfg));
  assert.equal(late.status, 1, late.stdout);
  assert.equal(kinds(a.dir).length, before, 'nothing logged');
  // The second ask's own Yes, with no session id, clears it.
  ownerTaps(cfg, a.dir, `sweep yes ${codeB}`);
  const ok = approveIn(a.dir, [fB, '--owner-yes'], noSid(cfg));
  assert.equal(ok.status, 0, ok.stdout);
  const line = approvalLog(a.dir).pop();
  assert.deepEqual([line.kind, line.proof], ['owner-yes', 'popup']);
  // The same contract asked again after its sweep closed is a later ask: a new code, and the earlier code clears nothing.
  assert.equal(approveIn(a.dir, [fB, '--outcome', '--none-ran']).status, 0, 'the second ask\'s sweep is closed');
  const again = approveIn(a.dir, [fB]);
  const code3 = (again.stdout.match(/`sweep yes ([0-9a-f]{6})`/) || [])[1];
  assert.ok(code3, again.stdout);
  assert.notEqual(code3, codeB, 'two asks of one contract share a code');
  const before3 = kinds(a.dir).length;
  ownerTaps(cfg, a.dir, `sweep yes ${codeB}`);
  assert.equal(approveIn(a.dir, [fB, '--owner-yes'], noSid(cfg)).status, 1, 'the earlier ask\'s Yes cleared a later ask');
  assert.equal(kinds(a.dir).length, before3, 'nothing logged');
});

// why: catches a yes for one pause clearing another pause (K377 S2)
test('a Yes for another pause\'s code is refused, and this pause\'s own Yes is read in the same session', () => {
  const r = paused();
  const cfg = makeTemp('cfg-');
  ownerTaps(cfg, r.dir, 'sweep resume 000000');
  const wrong = approveIn(r.dir, ['--resume'], noSid(cfg));
  assert.equal(wrong.status, 1, wrong.stdout);
  assert.ok(!kinds(r.dir).includes('resume'), 'nothing logged');
  // A Yes followed later by a No to the same act, in another session record: the newest answer decides, so it is refused.
  const act = `sweep resume ${r.code}`;
  ownerTaps(cfg, r.dir, act, { at: new Date(Date.now() + 1000).toISOString() });
  ownerTaps(cfg, r.dir, act, { sid: OTHER_SID, answer: 'No', at: new Date(Date.now() + 3000).toISOString() });
  const taken = approveIn(r.dir, ['--resume'], noSid(cfg));
  assert.equal(taken.status, 1, `a later No in another record did not take the Yes back: ${taken.stdout}`);
  assert.ok(!kinds(r.dir).includes('resume'), 'nothing logged');
  ownerTaps(cfg, r.dir, act, { at: new Date(Date.now() + 6000).toISOString() });
  assert.equal(approveIn(r.dir, ['--resume'], noSid(cfg)).status, 0, 'this pause\'s own Yes, same session');
  // With a session id set to session A (which holds a Yes), a later No in session B of the same repo still decides:
  // the named session only limits who may supply the Yes.
  const named = (c) => ({ ...noSid(c), CLAUDE_CODE_SESSION_ID: TAP_SID });
  const p2 = paused();
  const cfg2 = makeTemp('cfg-');
  ownerTaps(cfg2, p2.dir, `sweep resume ${p2.code}`, { at: new Date(Date.now() + 1000).toISOString() });
  ownerTaps(cfg2, p2.dir, `sweep resume ${p2.code}`, { sid: OTHER_SID, answer: 'No', at: new Date(Date.now() + 3000).toISOString() });
  const stillYes = approveIn(p2.dir, ['--resume'], named(cfg2));
  assert.equal(stillYes.status, 1, `a later No in session B did not stop --resume run as session A: ${stillYes.stdout}`);
  assert.ok(!kinds(p2.dir).includes('resume'), 'nothing logged');
  const ask = asked();
  const cfg3 = makeTemp('cfg-');
  ownerTaps(cfg3, ask.dir, `sweep yes ${ask.code}`, { at: new Date(Date.now() + 1000).toISOString() });
  ownerTaps(cfg3, ask.dir, `sweep yes ${ask.code}`, { sid: OTHER_SID, answer: 'No', at: new Date(Date.now() + 3000).toISOString() });
  const n = kinds(ask.dir).length;
  const stillYes2 = approveIn(ask.dir, [ask.f, '--owner-yes'], named(cfg3));
  assert.equal(stillYes2.status, 1, `a later No in session B did not stop --owner-yes run as session A: ${stillYes2.stdout}`);
  assert.equal(kinds(ask.dir).length, n, 'nothing logged');
});

// why: catches a Yes from another repo's session clearing this repo's pause (K377 S2)
test('bypass: a Yes from a session of another repo is refused, however its folder is spelled', () => {
  const r = paused();
  const cfg = makeTemp('cfg-');
  const act = `sweep resume ${r.code}`;
  ownerTaps(cfg, r.dir, act, { sid: OTHER_SID, folder: 'C--elsewhere' });
  // A folder whose name only starts with this repo's own name is another repo's.
  ownerTaps(cfg, r.dir, act, { sid: OTHER_SID, folder: `${repoKey(r.dir)}-sibling` });
  // A record under the key of the repo's parent folder is no record of this repo either.
  ownerTaps(cfg, r.dir, act, { sid: OTHER_SID, folder: repoKey(path.dirname(fs.realpathSync.native(r.dir))) });
  const out = approveIn(r.dir, ['--resume'], noSid(cfg));
  assert.equal(out.status, 1, out.stdout);
  assert.ok(!kinds(r.dir).includes('resume'), 'nothing logged');
  ownerTaps(cfg, r.dir, act);
  assert.equal(approveIn(r.dir, ['--resume'], noSid(cfg)).status, 0, 'the same act in this repo\'s own session');
  // The same for an ask: its only Yes is in another repo's folder.
  const ask = asked();
  const cfg2 = makeTemp('cfg-');
  ownerTaps(cfg2, ask.dir, `sweep yes ${ask.code}`, { sid: OTHER_SID, folder: 'C--elsewhere' });
  const n = kinds(ask.dir).length;
  const yes = approveIn(ask.dir, [ask.f, '--owner-yes'], noSid(cfg2));
  assert.equal(yes.status, 1, yes.stdout);
  assert.equal(kinds(ask.dir).length, n, 'nothing logged');
});

// why: catches one Yes answering a pause twice (K377 S3)
test('repeat: one Yes answers one pause, and a second use of it is refused', () => {
  const r = paused();
  const cfg = makeTemp('cfg-');
  ownerTaps(cfg, r.dir, `sweep resume ${r.code}`);
  assert.equal(approveIn(r.dir, ['--resume'], noSid(cfg)).status, 0, 'the first use');
  const second = approveIn(r.dir, ['--resume'], noSid(cfg));
  assert.equal(second.status, 1, second.stdout);
  assert.equal(kinds(r.dir).filter((k) => k === 'resume').length, 1, 'one resume line');
  // The same Yes, checked again, is named as used.
  const tap = approveIn(r.dir, ['--tap', `sweep resume ${r.code}`], noSid(cfg));
  assert.equal(tap.status, 1, tap.stdout);
  assert.match(tap.stdout, /already used/);
  // One pop-up id present in two session records is one tap: after it answered the pause, each record alone says used.
  const r2 = paused();
  const both = makeTemp('cfg-');
  ownerTaps(both, r2.dir, `sweep resume ${r2.code}`);
  const folder = path.join(both, 'projects', repoKey(r2.dir));
  const record = fs.readFileSync(path.join(folder, `${TAP_SID}.jsonl`), 'utf8');
  fs.writeFileSync(path.join(folder, `${OTHER_SID}.jsonl`), record);
  assert.equal(approveIn(r2.dir, ['--resume'], noSid(both)).status, 0, 'the pop-up answers the pause');
  for (const sid of [TAP_SID, OTHER_SID]) {
    const alone = makeTemp('cfg-');
    fs.mkdirSync(path.join(alone, 'projects', repoKey(r2.dir)), { recursive: true });
    fs.writeFileSync(path.join(alone, 'projects', repoKey(r2.dir), `${sid}.jsonl`), record);
    const again = approveIn(r2.dir, ['--tap', `sweep resume ${r2.code}`], noSid(alone));
    assert.equal(again.status, 1, `the same pop-up read through session ${sid} answered twice: ${again.stdout}`);
    assert.match(again.stdout, /already used/, sid);
  }
});

// why: catches a missing session record that resumes anyway or leaves the owner no way on (K377 S4)
test('fail-closed: no readable session record refuses, names the pop-up step, logged', () => {
  const r = paused();
  const empty = makeTemp('cfg-');
  const broken = makeTemp('cfg-');
  const dir = `${broken}/projects/${repoKey(r.dir)}`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(`${dir}/${TAP_SID}.jsonl`, '{not json\n\u0000\u0000\n');
  const guardLog = `${r.dir}/.git/kit-guard-open.log`;
  const rows = () => (fs.existsSync(guardLog) ? fs.readFileSync(guardLog, 'utf8').split('\n').filter(Boolean) : []).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
  for (const [name, cfg] of [['no session record at all', empty], ['a record that cannot be read', broken]]) {
    const before = kinds(r.dir).length;
    const rowsBefore = rows().length;
    const out = approveIn(r.dir, ['--resume'], noSid(cfg));
    // Logged: one new row in the git common dir's kit-guard-open.log, with a hook and a cause.
    const added = rows().slice(rowsBefore);
    assert.equal(added.length, 1, `${name}: one guard-open row, got ${JSON.stringify(added)}`);
    for (const k of ['hook', 'cause']) assert.ok(typeof added[0][k] === 'string' && added[0][k].length > 0, `${name}: the row has a non-empty ${k}`);
    assert.equal(out.status, 1, `${name}: ${out.stdout}`);
    assert.equal(kinds(r.dir).length, before, `${name}: no resume line`);
    assert.match(out.stdout, /AskUserQuestion pop-up/, `${name}: the refusal names the pop-up step`);
    assert.doesNotMatch(out.stdout, /CLAUDE_CODE_SESSION_ID is not set/, `${name}: the id is no longer asked for`);
  }
  // A pause with no recorded time has no pause point: even a Yes to its code resumes nothing, and the refusal is logged.
  const lone = paused();
  const logFile = `${lone.dir}/.git/kit-sweep-approvals.jsonl`;
  const line = JSON.stringify({ kind: 'pause', reason: 'no pause point', prev: '' });
  fs.writeFileSync(logFile, `${line}\n`);
  const cfg = makeTemp('cfg-');
  ownerTaps(cfg, lone.dir, `sweep resume ${crypto.createHash('sha256').update(line).digest('hex').slice(0, 6)}`);
  const guard2 = `${lone.dir}/.git/kit-guard-open.log`;
  const rows2 = () => (fs.existsSync(guard2) ? fs.readFileSync(guard2, 'utf8').split('\n').filter(Boolean) : []);
  const n0 = rows2().length;
  const blind = approveIn(lone.dir, ['--resume'], noSid(cfg));
  assert.equal(rows2().length - n0, 1, `no pause point: one guard-open row: ${blind.stdout}`);
  assert.equal(blind.status, 1, blind.stdout);
  assert.equal(fs.readFileSync(logFile, 'utf8'), `${line}\n`, 'no resume line');
});

// why: catches the session records being listed under CLAUDE_CONFIG_DIR while the Yes is read under the installed home (K377 S1)
test('an installed approve.mjs lists and reads session records under the installed home, not CLAUDE_CONFIG_DIR', () => {
  // The repo's own owner-yes.cjs is unfilled, so its home falls back to CLAUDE_CONFIG_DIR: only an installed copy has a
  // home of its own to pin.
  const home = makeTemp('home-');
  const i = spawnSync(process.execPath, [path.resolve('scripts/kit.mjs'), 'install', 'user', '--unreleased'], { encoding: 'utf8', env: { ...process.env, KIT_CLAUDE_HOME: home, CLAUDE_CODE_REMOTE: '' } });
  assert.equal(i.status, 0, i.stdout + i.stderr);
  const installed = path.join(home, 'skills', 'pre-pr-sweep', 'approve.mjs');
  const run = (dir, args, other) => spawnSync('node', [installed, ...args], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH, ...noSid(other) } });
  // A pause: a fake Yes only in the folder CLAUDE_CONFIG_DIR names is refused, and the Yes under the installed home is read.
  const p = paused();
  const other = makeTemp('cfg-');
  ownerTaps(other, p.dir, `sweep resume ${p.code}`);
  assert.equal(run(p.dir, ['--resume'], other).status, 1, 'a Yes under CLAUDE_CONFIG_DIR only');
  // The installed home's record is another session's than the fake one, so a list taken from the wrong root finds no id.
  ownerTaps(home, p.dir, `sweep resume ${p.code}`, { sid: OTHER_SID });
  const ok = run(p.dir, ['--resume'], other);
  assert.equal(ok.status, 0, `the record under the installed home was not read: ${ok.stdout}`);
  // An ask, the same way.
  const a = asked();
  ownerTaps(other, a.dir, `sweep yes ${a.code}`);
  assert.equal(run(a.dir, [a.f, '--owner-yes'], other).status, 1, 'a Yes under CLAUDE_CONFIG_DIR only');
  ownerTaps(home, a.dir, `sweep yes ${a.code}`, { sid: OTHER_SID });
  const yes = run(a.dir, [a.f, '--owner-yes'], other);
  assert.equal(yes.status, 0, `the record under the installed home was not read: ${yes.stdout}`);
});

// why: catches a later No in another worktree's or a parent folder's record leaving an earlier Yes standing (K377 S2)
// planted: {"file":"user/skills/pre-pr-sweep/approve.mjs","was":"[...new Set([...repoRoots(), ...worktreeRoots()])]","to":"[...new Set([...repoRoots()])]"}
test('a later No in a record under another worktree of this repo, or a folder above it, stops --resume', () => {
  const r = paused();
  const act = `sweep resume ${r.code}`;
  const wt = path.join(makeTemp('wt-'), 'w');
  g(r.dir, 'worktree', 'add', '-q', wt, '-b', 'wt-x');
  const cfg = makeTemp('cfg-');
  ownerTaps(cfg, r.dir, act, { at: new Date(Date.now() + 1000).toISOString() });
  ownerTaps(cfg, r.dir, act, { sid: OTHER_SID, answer: 'No', folder: repoKey(wt), at: new Date(Date.now() + 3000).toISOString() });
  const viaWt = approveIn(r.dir, ['--resume'], noSid(cfg));
  assert.equal(viaWt.status, 1, `a later No under another worktree's folder left the Yes standing: ${viaWt.stdout}`);
  assert.ok(!kinds(r.dir).includes('resume'), 'nothing logged');
  // A later No under the folder above the repo.
  const cfg2 = makeTemp('cfg-');
  ownerTaps(cfg2, r.dir, act, { at: new Date(Date.now() + 1000).toISOString() });
  ownerTaps(cfg2, r.dir, act, { sid: OTHER_SID, answer: 'No', folder: repoKey(path.dirname(fs.realpathSync.native(r.dir))), at: new Date(Date.now() + 3000).toISOString() });
  const viaAbove = approveIn(r.dir, ['--resume'], noSid(cfg2));
  assert.equal(viaAbove.status, 1, `a later No under a folder above the repo left the Yes standing: ${viaAbove.stdout}`);
  assert.ok(!kinds(r.dir).includes('resume'), 'nothing logged');
  // Control: a Yes from the other worktree's session still does not count when the shell names another session.
  const cfg3 = makeTemp('cfg-');
  ownerTaps(cfg3, r.dir, act, { sid: OTHER_SID, folder: repoKey(wt) });
  const named = approveIn(r.dir, ['--resume'], { ...noSid(cfg3), CLAUDE_CODE_SESSION_ID: TAP_SID });
  assert.equal(named.status, 1, `a Yes from another session counted: ${named.stdout}`);
  assert.ok(!kinds(r.dir).includes('resume'), 'nothing logged');
});

// why: catches a revocation that cannot be read being skipped, so a taken-back Yes still clears (K377 S2, S4)
test('fail-closed: a worktree list or a record folder that cannot be read refuses --resume and --owner-yes, logged', () => {
  const guardRows = (dir) => { const f = `${dir}/.git/kit-guard-open.log`; return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).length : 0; };
  // git worktree list fails: a worktree's entry holds a folder where git reads a file.
  const breakList = (dir) => {
    const wt = path.join(makeTemp('wt-'), 'w');
    g(dir, 'worktree', 'add', '-q', wt, '-b', 'wt-y');
    const name = fs.readdirSync(path.join(dir, '.git', 'worktrees'))[0];
    fs.mkdirSync(path.join(dir, '.git', 'worktrees', name, 'locked'));
  };
  const r = paused();
  const cfg = makeTemp('cfg-');
  ownerTaps(cfg, r.dir, `sweep resume ${r.code}`);
  breakList(r.dir);
  const n = guardRows(r.dir);
  const listed = approveIn(r.dir, ['--resume'], noSid(cfg));
  assert.equal(listed.status, 1, `--resume went on with no worktree list: ${listed.stdout}`);
  assert.equal(guardRows(r.dir) - n, 1, 'one guard-open row');
  assert.ok(!kinds(r.dir).includes('resume'), 'nothing logged');
  const a = asked();
  const cfgA = makeTemp('cfg-');
  ownerTaps(cfgA, a.dir, `sweep yes ${a.code}`);
  breakList(a.dir);
  const nA = guardRows(a.dir);
  const askedOut = approveIn(a.dir, [a.f, '--owner-yes'], noSid(cfgA));
  assert.equal(askedOut.status, 1, `--owner-yes went on with no worktree list: ${askedOut.stdout}`);
  assert.equal(guardRows(a.dir) - nA, 1, 'one guard-open row');
  // A record folder in scope that cannot be read (a file stands where the folder above the repo keeps its records).
  const p = paused();
  const cfgP = makeTemp('cfg-');
  ownerTaps(cfgP, p.dir, `sweep resume ${p.code}`);
  fs.writeFileSync(path.join(cfgP, 'projects', repoKey(path.dirname(fs.realpathSync.native(p.dir)))), 'not a folder');
  const nP = guardRows(p.dir);
  const unread = approveIn(p.dir, ['--resume'], noSid(cfgP));
  assert.equal(unread.status, 1, `--resume went on with an unreadable record folder: ${unread.stdout}`);
  assert.equal(guardRows(p.dir) - nP, 1, 'one guard-open row');
  assert.ok(!kinds(p.dir).includes('resume'), 'nothing logged');
});

// why: catches a Yes read from a folder above the repo or another worktree counting because its session id is known here (K377 S2)
test('a Yes counts only from a record under this repo\'s own folder key, with or without a session id set', () => {
  const r = paused();
  const act = `sweep resume ${r.code}`;
  const wt = path.join(makeTemp('wt-'), 'w');
  g(r.dir, 'worktree', 'add', '-q', wt, '-b', 'wt-z');
  const above = repoKey(path.dirname(fs.realpathSync.native(r.dir)));
  for (const [name, folder] of [['a folder above the repo', above], ['another worktree\'s key', repoKey(wt)]]) {
    for (const withId of [false, true]) {
      // Session TAP_SID has a record under this repo's own key that answers another act; its Yes to this act is elsewhere.
      const cfg = makeTemp('cfg-');
      ownerTaps(cfg, r.dir, 'sweep resume 000000');
      ownerTaps(cfg, r.dir, act, { folder });
      const out = approveIn(r.dir, ['--resume'], withId ? { ...noSid(cfg), CLAUDE_CODE_SESSION_ID: TAP_SID } : noSid(cfg));
      assert.equal(out.status, 1, `a Yes from ${name} counted${withId ? ' with the session id set' : ''}: ${out.stdout}`);
      assert.ok(!kinds(r.dir).includes('resume'), 'nothing logged');
    }
  }
  // Control: the same Yes under the repo's own key counts, with the session id set.
  const own = makeTemp('cfg-');
  ownerTaps(own, r.dir, act);
  assert.equal(approveIn(r.dir, ['--resume'], { ...noSid(own), CLAUDE_CODE_SESSION_ID: TAP_SID }).status, 0, 'the own-key Yes');
});

// why: catches a session record that exists but cannot be read being skipped while a Yes elsewhere clears (K377 S2, S4)
test('fail-closed: a session record in scope that exists but cannot be read refuses --resume and --owner-yes, logged', () => {
  const guardRows = (dir) => { const f = `${dir}/.git/kit-guard-open.log`; return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).length : 0; };
  // A folder stands where a record file should be (EISDIR), beside a valid own-key Yes.
  const unreadableAt = (cfg, dir, folder) => fs.mkdirSync(path.join(cfg, 'projects', folder, `${OTHER_SID}.jsonl`), { recursive: true });
  const above = (dir) => repoKey(path.dirname(fs.realpathSync.native(dir)));
  const p = paused();
  const own = makeTemp('cfg-');
  ownerTaps(own, p.dir, `sweep resume ${p.code}`);
  unreadableAt(own, p.dir, repoKey(p.dir));
  const n = guardRows(p.dir);
  const viaOwn = approveIn(p.dir, ['--resume'], noSid(own));
  assert.equal(viaOwn.status, 1, `--resume went on with an unreadable record on the own key: ${viaOwn.stdout}`);
  assert.equal(guardRows(p.dir) - n, 1, 'one guard-open row');
  assert.ok(!kinds(p.dir).includes('resume'), 'nothing logged');
  const wide = makeTemp('cfg-');
  ownerTaps(wide, p.dir, `sweep resume ${p.code}`);
  unreadableAt(wide, p.dir, above(p.dir));
  const nW = guardRows(p.dir);
  const viaWide = approveIn(p.dir, ['--resume'], noSid(wide));
  assert.equal(viaWide.status, 1, `--resume went on with an unreadable record in the wider scope: ${viaWide.stdout}`);
  assert.equal(guardRows(p.dir) - nW, 1, 'one guard-open row');
  assert.ok(!kinds(p.dir).includes('resume'), 'nothing logged');
  const a = asked();
  const cfgA = makeTemp('cfg-');
  ownerTaps(cfgA, a.dir, `sweep yes ${a.code}`);
  unreadableAt(cfgA, a.dir, repoKey(a.dir));
  const nA = guardRows(a.dir);
  const yes = approveIn(a.dir, [a.f, '--owner-yes'], noSid(cfgA));
  assert.equal(yes.status, 1, `--owner-yes went on with an unreadable record on the own key: ${yes.stdout}`);
  assert.equal(guardRows(a.dir) - nA, 1, 'one guard-open row');
});

// why: catches the own-key binding being a substring match, so text quoting a pop-up id stands for the Yes (K377 S2)
test('a Yes above the repo counts only if the own-key record parses to an accepted Yes with the same pop-up id', () => {
  const r = paused();
  const act = `sweep resume ${r.code}`;
  const above = repoKey(path.dirname(fs.realpathSync.native(r.dir)));
  const idOf = (cfg) => fs.readFileSync(path.join(cfg, 'projects', above, `${TAP_SID}.jsonl`), 'utf8').match(/toolu_[0-9a-f]+/)[0];
  const ownRecord = (cfg) => path.join(cfg, 'projects', repoKey(r.dir), `${TAP_SID}.jsonl`);
  // The own-key record quotes the winning Yes's id in a message.
  const quoted = makeTemp('cfg-');
  ownerTaps(quoted, r.dir, act, { folder: above });
  fs.mkdirSync(path.dirname(ownRecord(quoted)), { recursive: true });
  fs.writeFileSync(ownRecord(quoted), `${JSON.stringify({ type: 'assistant', isSidechain: false, message: { content: [{ type: 'text', text: `the pop-up ${idOf(quoted)} was answered` }] } })}\n`);
  const viaText = approveIn(r.dir, ['--resume'], noSid(quoted));
  assert.equal(viaText.status, 1, `a message quoting the pop-up id stood for the Yes: ${viaText.stdout}`);
  assert.ok(!kinds(r.dir).includes('resume'), 'nothing logged');
  // The own-key record holds an entry with the same id for a different act.
  const other = makeTemp('cfg-');
  ownerTaps(other, r.dir, act, { folder: above });
  fs.mkdirSync(path.dirname(ownRecord(other)), { recursive: true });
  fs.writeFileSync(ownRecord(other), fs.readFileSync(path.join(other, 'projects', above, `${TAP_SID}.jsonl`), 'utf8').split(act).join('sweep resume 000000'));
  const viaAct = approveIn(r.dir, ['--resume'], noSid(other));
  assert.equal(viaAct.status, 1, `an entry for another act with the same id stood for the Yes: ${viaAct.stdout}`);
  assert.ok(!kinds(r.dir).includes('resume'), 'nothing logged');
  // Control: a real parsed own-key Yes counts.
  const real = makeTemp('cfg-');
  ownerTaps(real, r.dir, act);
  assert.equal(approveIn(r.dir, ['--resume'], noSid(real)).status, 0, 'the parsed own-key Yes');
});

// why: catches the filesystem root's folder key counting as this repo's own key, with or without a session id (K377 pin 8)
test('a Yes that sits only under the filesystem root\'s folder key is not the own key, with and without a session id', () => {
  const r = paused();
  const act = `sweep resume ${r.code}`;
  const rootKey = path.parse(fs.realpathSync.native(r.dir)).root.replace(/[^A-Za-z0-9]/g, '-');
  for (const withId of [false, true]) {
    const cfg = makeTemp('cfg-');
    ownerTaps(cfg, r.dir, act, { folder: rootKey });
    const out = approveIn(r.dir, ['--resume'], withId ? { ...noSid(cfg), CLAUDE_CODE_SESSION_ID: TAP_SID } : noSid(cfg));
    assert.equal(out.status, 1, `a Yes under the filesystem root's key counted${withId ? ' with the session id set' : ''}: ${out.stdout}`);
    assert.ok(!kinds(r.dir).includes('resume'), 'nothing logged');
  }
});

// why: catches a log line that cannot be read leaving a pause with no pause time, so the owner's Yes resumes nothing (K377 F1)
test('a log with an unreadable line still pauses: the owner\'s Yes resumes once, and a second use is refused', () => {
  const r = paused();
  fs.appendFileSync(path.join(r.dir, '.git', 'kit-sweep-approvals.jsonl'), 'not json at all\n');
  const cfg = makeTemp('cfg-');
  // The log is still paused: the next ask goes to the owner.
  const ask = approveIn(r.dir, [r.f]);
  assert.equal(ask.status, 1, ask.stdout);
  const code = (ask.stdout.match(/`sweep resume ([0-9a-f]{6})`/) || [])[1];
  assert.ok(code, `the broken log paused with no resume code: ${ask.stdout}`);
  ownerTaps(cfg, r.dir, `sweep resume ${code}`);
  const first = approveIn(r.dir, ['--resume'], noSid(cfg));
  assert.equal(first.status, 0, `the Yes did not resume a log with an unreadable line: ${first.stdout}`);
  assert.doesNotMatch(first.stdout, /no recorded time/);
  const second = approveIn(r.dir, ['--resume'], noSid(cfg));
  assert.equal(second.status, 1, `the same Yes resumed twice: ${second.stdout}`);
});

// why: catches a Yes given before the log was broken resuming the pause that the break made (K377 F1, 08:01Z ruling)
test('a Yes stamped before the guard-log row for the broken line does not resume; a Yes after the row does, once', () => {
  const r = paused();
  const logFile = path.join(r.dir, '.git', 'kit-sweep-approvals.jsonl');
  const guardFile = path.join(r.dir, '.git', 'kit-guard-open.log');
  const guardRows = () => (fs.existsSync(guardFile) ? fs.readFileSync(guardFile, 'utf8').split('\n').filter(Boolean) : []);
  const pauseAt = (fs.readFileSync(logFile, 'utf8').trim().split('\n').map((l) => Date.parse(JSON.parse(l).time)).filter(Number.isFinite).pop());
  assert.ok(Number.isFinite(pauseAt), 'the log has a readable time before the break');
  // Time passes between the pause and the break, so a Yes can sit between them.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
  fs.appendFileSync(logFile, 'not json at all\n');
  const before = guardRows().length;
  const ask = approveIn(r.dir, [r.f]);
  const code = (ask.stdout.match(/`sweep resume ([0-9a-f]{6})`/) || [])[1];
  assert.ok(code, `the broken log paused with no resume code: ${ask.stdout}`);
  const cfg = makeTemp('cfg-');
  const act = `sweep resume ${code}`;
  // With no Yes at all, the resume refuses, and the break has its guard-log row by now.
  assert.equal(approveIn(r.dir, ['--resume'], noSid(cfg)).status, 1, 'no Yes: refused');
  const rows = guardRows().slice(before).map((l) => JSON.parse(l));
  assert.ok(rows.length >= 1 && Number.isFinite(Date.parse(rows[0].at)), `no guard-log row for the broken line: ${JSON.stringify(rows)}`);
  const rowAt = Date.parse(rows[0].at);
  // A Yes after the pause but before the break's row: it is not a Yes to this pause.
  const early = pauseAt + 700;
  assert.ok(early < rowAt, 'the early Yes sits before the row');
  ownerTaps(cfg, r.dir, act, { at: new Date(early).toISOString() });
  const old = approveIn(r.dir, ['--resume'], noSid(cfg));
  assert.equal(old.status, 1, `a Yes given before the line was broken resumed the log: ${old.stdout}`);
  assert.ok(!fs.readFileSync(logFile, 'utf8').includes('"kind":"resume"'), 'nothing logged');
  // A Yes just after the row resumes once: the pause time is the row's, not the newest time any later log line carries.
  ownerTaps(cfg, r.dir, act, { at: new Date(rowAt + 500).toISOString() });
  const ok = approveIn(r.dir, ['--resume'], noSid(cfg));
  assert.equal(ok.status, 0, `a Yes after the row did not resume: ${ok.stdout}`);
  assert.equal(approveIn(r.dir, ['--resume'], noSid(cfg)).status, 1, 'the same Yes resumed twice');
});
