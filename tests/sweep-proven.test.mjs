// K377 S1-S3: --summary counts the sweeps in a row that ran clean, and 5 in a row is proven.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { APPROVE, g, makeTemp } from './kit-helpers.mjs';

// One repo with an approvals log built by hand: each line chained to the one before, as approve.mjs writes them.
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const role = (extra) => ({ role: 'r', kind: 'fix-root', tokens: 500, calls: 6, ceiling: 1000, stopped: false, ...extra });
const outcome = (roles) => ({ kind: 'outcome', contract: 'c.json', decisionAt: '2026-11-23T10:00:00.000Z', budget: 1000, tokens: 500, findings: 0, real: 0, duplicates: 0, roles });
const clean = () => outcome([role()]);
// A reviewer the call-cap hook stopped at `spent` of its ceiling of 1000 tokens.
const stopped = (spent) => outcome([role({ tokens: spent, stopped: true })]);
// The same, in a dollar unit: the role logs its own dollars against a dollar ceiling of $1.00 (its tokens alone would read as clean).
const stoppedUsd = (spent) => outcome([role({ ceilingUnit: 'dollars', tokens: 900000, dollars: spent, ceiling: 1, stopped: true })]);
// The lines approve.mjs writes between sweeps: the decision that cleared one, the owner's resume after a pause.
const decision = () => ({ kind: 'decision', contract: 'c.json', branch: 'feat/x', hash: 'abc123abc123abcd', tier: 'fix', agents: 1, budget: 1000, decision: 'approved', reasons: [], head: 'a'.repeat(40) });
const pause = () => ({ kind: 'pause', reason: 'tokens 5000 ran 400% over the budget of 1000' });
const resume = () => ({ kind: 'resume', proof: 'popup', tap: 'tap-1', at: '2026-11-23T11:00:00.000Z' });
const warning = () => ({ kind: 'warning', contract: 'c.json', hash: 'abc123abc123abcd', reason: '2 cache re-writes after the first call' });
// A sweep closed with no reviewer started, and one the owner closed unmeasured: neither measured anything.
const noneRan = () => ({ kind: 'outcome', contract: 'c.json', decisionAt: '2026-11-23T10:00:00.000Z', budget: 1000, tokens: 0, findings: 0, real: 0, duplicates: 0, noneRan: true });
const ownerClosed = () => ({ kind: 'outcome', contract: 'c.json', decisionAt: '2026-11-23T10:00:00.000Z', budget: 1000, tokens: 0, findings: 0, real: 0, duplicates: 0, closedByOwner: true, started: 1 });

// An entry is a log object, a raw string (a line nobody could read), or an object with `_prev` naming a wrong chain link.
function repoWith(entries) {
  const dir = makeTemp('proven-');
  g(dir, 'init', '-q', '-b', 'main');
  const lines = [];
  for (const e of entries) {
    if (typeof e === 'string') { lines.push(e); continue; }
    const { _prev, ...own } = e;
    lines.push(JSON.stringify({ time: new Date().toISOString(), ...own, prev: _prev !== undefined ? _prev : (lines.length ? sha(lines[lines.length - 1]) : '') }));
  }
  fs.writeFileSync(path.join(dir, '.git', 'kit-sweep-approvals.jsonl'), lines.join('\n') + '\n');
  return dir;
}
const summary = (dir) => spawnSync('node', [APPROVE, '--summary'], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH } }).stdout;
const runOf = (entries) => { const out = summary(repoWith(entries)); return { n: (out.match(/clean sweeps in a row: (\d+)/) || [])[1], out }; };
const guardRows = (dir) => { try { return fs.readFileSync(path.join(dir, '.git', 'kit-guard-open.log'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

// why: catches a summary that never prints the run of clean sweeps (K377 S1)
test('--summary prints the run of sweeps with no pause and no reviewer stopped under 80% of its ceiling', () => {
  // A reviewer stopped at 95% of its ceiling is the ceiling working (clean); stopped at 70% is not.
  assert.equal(runOf([decision(), clean(), decision(), stopped(950), decision(), stopped(700), decision(), clean(), decision(), stopped(950)]).n, '2');
  // The line is exactly 80%: 800 of 1000 is clean, 799 is not.
  assert.equal(runOf([clean(), stopped(800)]).n, '2');
  assert.equal(runOf([clean(), clean(), stopped(799)]).n, '0');
  // One sweep with two reviewers, one clean and one stopped at 70%, is not clean.
  assert.equal(runOf([clean(), outcome([role(), role({ tokens: 700, stopped: true })])]).n, '0');
  // A role in the dollar unit is read in dollars: $0.50 of $1.00 breaks the run, $0.85 does not.
  assert.equal(runOf([clean(), stoppedUsd(0.5)]).n, '0');
  assert.equal(runOf([clean(), stoppedUsd(0.85)]).n, '2');
  // A sweep that ran nothing, and one the owner closed unmeasured, are not there: they neither count nor reset.
  assert.equal(runOf([clean(), noneRan(), clean(), ownerClosed(), clean()]).n, '3');
});

// why: catches five clean sweeps in a row that are never called proven (K377 S2)
test('5 clean sweeps in a row prints "proven: 5 clean sweeps in a row"', () => {
  assert.doesNotMatch(runOf([clean(), clean(), clean(), clean()]).out, /proven: 5 clean sweeps in a row/);
  const five = runOf([clean(), clean(), clean(), clean(), clean()]);
  assert.equal(five.n, '5');
  assert.match(five.out, /proven: 5 clean sweeps in a row/);
  // Six is still proven, and the count keeps going.
  const six = runOf([clean(), clean(), clean(), clean(), clean(), clean()]);
  assert.equal(six.n, '6');
  assert.match(six.out, /proven: 5 clean sweeps in a row/);
  // Five clean sweeps and then a pause: the run is 0 and nothing is proven.
  const paused = runOf([clean(), clean(), clean(), clean(), clean(), pause()]);
  assert.equal(paused.n, '0');
  assert.doesNotMatch(paused.out, /proven: 5 clean sweeps in a row/);
});

// why: catches a pause that leaves the run of clean sweeps standing (K377 S1)
test('a pause resets the run to 0', () => {
  assert.equal(runOf([decision(), clean(), decision(), clean(), pause(), decision(), clean()]).n, '1');
  assert.equal(runOf([clean(), clean(), pause()]).n, '0');
  // The owner's resume lifts the pause, not the count: the sweep before it stays behind it.
  assert.equal(runOf([clean(), clean(), pause(), resume(), decision(), clean()]).n, '1');
});

// why: catches a warning that wrongly breaks the run of clean sweeps (K377 S1)
test('a warning alone does not reset the run', () => {
  assert.equal(runOf([clean(), clean(), warning(), clean()]).n, '3');
});

// why: catches a hand-logged pause between clean sweeps that the count skips (K377 S1)
test('bypass: a pause logged by hand between two clean sweeps still resets the run', () => {
  // The pause line was written by hand: its chain link is wrong, as a hand edit leaves it. It still ends the run.
  assert.equal(runOf([clean(), clean(), { ...pause(), _prev: 'deadbeefdeadbeef' }, clean()]).n, '1');
});

// why: catches a pause line deleted by hand letting five clean sweeps across the break count as proven (K377 F8)
test('bypass: a pause line deleted by hand breaks the chain and ends the run at that line, so nothing is proven across it', () => {
  const dir = repoWith([clean(), clean(), clean(), pause(), clean(), clean()]);
  const file = path.join(dir, '.git', 'kit-sweep-approvals.jsonl');
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(JSON.parse(lines[3]).kind, 'pause', 'the line cut out is the pause');
  lines.splice(3, 1);
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  const out = summary(dir);
  const n = Number((out.match(/clean sweeps in a row: (\d+)/) || [])[1]);
  assert.ok(n < 5, `five clean sweeps across a broken chain counted as ${n} in a row: ${out}`);
  assert.doesNotMatch(out, /proven: 5 clean sweeps in a row/);
});

// why: catches a decision line with a broken chain link leaving the old ceiling unit to call stopped reviewers clean (K377 F8)
test('bypass: a dollars decision line with a broken link leaves the unit unknown, so a stopped role with no unit of its own is not clean', () => {
  // Spent $0.50 of a $1.00 ceiling is under 80% in dollars, yet 900000 tokens of that same ceiling of 1 reads as over 80% in tokens.
  const mixed = () => outcome([role({ tokens: 900000, dollars: 0.5, ceiling: 1, stopped: true })]);
  const dollars = () => ({ ...decision(), ceilingUnit: 'dollars' });
  // Premise: read in tokens the role is clean, read in dollars it is not.
  assert.equal(runOf([decision(), mixed()]).n, '1');
  assert.equal(runOf([dollars(), mixed()]).n, '0');
  // The dollars decision line's link is broken: its unit cannot be trusted, and the old unit must not stand in for it.
  assert.equal(runOf([clean(), decision(), { ...dollars(), _prev: 'deadbeefdeadbeef' }, mixed(), mixed()]).n, '0');
  // The next intact decision line says the unit again, and a clean run counts from there.
  assert.equal(runOf([clean(), decision(), { ...dollars(), _prev: 'deadbeefdeadbeef' }, mixed(), decision(), mixed()]).n, '1');
  // A role that names its own unit does not need the decision line's.
  assert.equal(runOf([clean(), decision(), { ...dollars(), _prev: 'deadbeefdeadbeef' }, stoppedUsd(0.85)]).n, '1');
});

// why: catches a summary whose count changes when the same log is read again (K377 S1)
test('repeat: the same log read twice gives the same count', () => {
  const dir = repoWith([clean(), clean(), clean()]);
  const file = path.join(dir, '.git', 'kit-sweep-approvals.jsonl');
  const before = fs.readFileSync(file, 'utf8');
  const first = (summary(dir).match(/clean sweeps in a row: (\d+)/) || [])[1];
  const second = (summary(dir).match(/clean sweeps in a row: (\d+)/) || [])[1];
  assert.equal(first, '3');
  assert.equal(second, first);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'reading the summary leaves the log as it was');
});

// why: catches an unreadable log line that is counted as clean without a trace (K377 S3)
test('fail-closed: a log line the summary cannot read ends the run at 0, logged', () => {
  const dir = repoWith([clean(), clean(), clean(), '{this line is not json']);
  const out = summary(dir);
  assert.equal((out.match(/clean sweeps in a row: (\d+)/) || [])[1], '0');
  assert.doesNotMatch(out, /proven: 5 clean sweeps in a row/);
  // One row {at, hook, cause} in the git common dir's kit-guard-open.log that names the unreadable line (not the hand-edit pause).
  const row = guardRows(dir).find((r) => /unreadable|cannot be read/i.test(String(r.cause)));
  assert.ok(row, 'a guard-open row names the unreadable line');
  assert.ok(row.at && row.hook, 'the row carries at and hook');
  // A clean sweep after the unreadable line starts a new run: it ends the run, it does not end the count.
  const after = repoWith([clean(), clean(), '{this line is not json', clean()]);
  assert.equal((summary(after).match(/clean sweeps in a row: (\d+)/) || [])[1], '1');
  assert.ok(guardRows(after).some((r) => /unreadable|cannot be read/i.test(String(r.cause))), 'the unreadable line in the middle is logged too');
});

// why: catches a reviewer on another model still counted as a clean sweep
test('a reviewer on another or unread model writes a warning row and leaves the sweep out of the clean run', async () => {
  const { approveIn, approveRun, approvalLog, featureContract, transcripts } = await import('./kit-helpers.mjs');
  const r = approveRun(featureContract());
  assert.equal(r.status, 0, r.stdout);
  const cfg = transcripts({ m1: [[1, 1, 1, 1]], m2: [[1, 1, 1, 1]], m3: [[1, 1, 1, 1]], m4: [{ model: 'claude-haiku-4-5', u: [1, 1, 1, 1] }], m5: [[1, 1, 1, 1]] });
  const o = approveIn(r.dir, [r.f, '--outcome', '--agents', 'm1,m2,m3,m4,m5', '--findings', '1', '--real', '1', '--duplicates', '0'], { CLAUDE_CONFIG_DIR: cfg });
  assert.equal(o.status, 0, o.stdout);
  assert.match(o.stdout, /rerun .+ on \S+: it ran on claude-haiku-4-5/);
  const rows = approvalLog(r.dir);
  assert.ok(rows.some((e) => e.kind === 'warning' && /claude-haiku-4-5|another model|model the contract named/.test(String(e.reason))), `no warning row for the mismatch: ${JSON.stringify(rows.map((e) => e.kind))}`);
  assert.equal((summary(r.dir).match(/clean sweeps in a row: (\d+)/) || [])[1], '0', 'a mismatched sweep is no clean sweep');
});
