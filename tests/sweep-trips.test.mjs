// Tests for K377 S1 to S6: only a broken safety net pauses a sweep; every other outcome trip is a logged warning.

import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { APPROVE, approveIn, approveRun, approvalLog, featureContract, leadBriefs, nextBranch, outcome, pastRole, roleModels, seedOutcomes, sweepRepo, transcripts, usual, read } from './kit-helpers.mjs';

let seq = 0;
const SAFETY_NET = /ceiling did not hold|call-cap meter let|no call-cap hook held|changed by hand|escaped/;
// A role the hook stopped at its ceiling: its refusal is in the transcript, and the hand-back is the call after it.
const atCeiling = () => [[10000, 0, 0, 0], ...Array(4).fill([0, 28000, 0, 0]), { refused: 'Token ceiling reached (122,000 of 200,000): one more call would pass it.' }, [0, 60000, 0, 0]];
// A role 60,000 a call over a 200,000 ceiling: past it by more than its largest call.
const overCeiling = () => [[10000, 0, 0, 0], ...Array(5).fill([0, 60000, 0, 0])];
const LATE = { u: [0, 0, 30000, 0], gap: 6 * 60 * 1000 };
const stateLines = (text) => text.split('\n').filter((l) => /^auto-approval: /.test(l));

// One feature sweep on a log of 25 measured roles, then its outcome from one transcript per role.
function sweep(spec, { past = Array.from({ length: 25 }, () => pastRole(200000)), opens = [], duplicates = '0' } = {}) {
  const dir = sweepRepo();
  seedOutcomes(dir, past);
  const r = approveRun(featureContract(), dir);
  assert.equal(r.status, 0, r.stdout);
  const ids = spec.map(() => `w${++seq}`);
  for (const i of opens) fs.appendFileSync(path.join(dir, '.git', 'kit-guard-open.log'), `${JSON.stringify({ at: new Date().toISOString(), hook: 'call-cap', agent: ids[i], cause: 'ENOENT' })}\n`);
  const cfg = transcripts(Object.fromEntries(ids.map((id, i) => [id, spec[i]])), {}, undefined, undefined, roleModels(ids, featureContract().roles));
  const o = approveIn(dir, [r.f, '--outcome', '--agents', ids.join(','), '--findings', '4', '--real', '3', '--duplicates', duplicates], { CLAUDE_CONFIG_DIR: cfg });
  assert.equal(o.status, 0, o.stdout);
  const log = approvalLog(dir);
  const reasons = (kind) => log.filter((e) => e.kind === kind).map((e) => e.reason);
  return { dir, r, o, log, pauses: reasons('pause'), warnings: reasons('warning') };
}

// why: catches a ceiling that did not hold, a meter that let calls through unread, or a call cap no hook held still pauses (K377 S1)
test('a ceiling that did not hold, a meter that let calls through unread, or a call cap no hook held still pauses', () => {
  // The ceiling pause stands alone: the two stopped roles beside it are a warning, not a second pause.
  const ceiling = sweep([overCeiling(), atCeiling(), atCeiling(), usual(), usual()]);
  assert.ok(ceiling.pauses.some((p) => /ceiling did not hold/.test(p)), ceiling.o.stdout);
  assert.ok(ceiling.pauses.every((p) => SAFETY_NET.test(p)), `only the safety net pauses: ${ceiling.pauses.join(' | ')}`);
  const summary = approveIn(ceiling.dir, ['--summary']).stdout;
  assert.match(summary, /^auto-approval: off \(.*ceiling did not hold.*\)$/m);
  const meter = sweep(Array(5).fill(0).map(usual), { opens: [1] });
  assert.ok(meter.pauses.some((p) => /call-cap meter let 1 call\(s\) of .* through unread/.test(p)), meter.o.stdout);
  assert.ok(meter.pauses.every((p) => SAFETY_NET.test(p)), meter.pauses.join(' | '));
  const cap = sweep([[[10000, 0, 0, 0], ...Array(7).fill([0, 10000, 0, 0])], usual(), usual(), usual(), usual()]);
  assert.ok(cap.pauses.some((p) => /ran 8 calls against its cap of 5: no call-cap hook held it/.test(p)), cap.o.stdout);
  assert.ok(cap.pauses.every((p) => SAFETY_NET.test(p)), cap.pauses.join(' | '));
});

// why: catches a stopped share over a third, repeated findings, start drift, content per call, cache re-writes and sweep dollars over the p95 log a warning and do not pause (K377 S2)
test('a stopped share over a third, repeated findings, start drift, content per call, cache re-writes and sweep dollars over the p95 log a warning and do not pause', () => {
  const dollarPast = Array.from({ length: 25 }, () => pastRole(100000, { calls: 1, split: { input: 100000, cacheRead: 0, cacheWrite: 0, output: 0 } }));
  const cases = [
    ['2 of 5 stopped', sweep([atCeiling(), atCeiling(), usual(), usual(), usual()]), /2 of 5 roles stopped at their token ceiling/],
    ['repeated findings', sweep(Array(5).fill(0).map(usual), { duplicates: '2' }), /2 of 4 findings repeated between roles/],
    ['start drift', sweep(Array(5).fill(0).map(() => [[11500, 0, 0, 0], ...Array(5).fill([0, 28000, 0, 0])])), /the starting context .*15% over its median of 10,000/],
    ['content per call', sweep(Array(5).fill(0).map(() => [[10000, 0, 0, 0], [0, 60000, 0, 0], [0, 60000, 0, 0]])), /content per call .*over its p95 of 33,333/],
    ['cache re-writes', sweep([[[10000, 0, 0, 0], [0, 28000, 0, 0], LATE], [[10000, 0, 0, 0], LATE], usual(), usual(), usual()]), /2 cache re-writes after the first call/],
    ['sweep dollars over the p95', sweep(Array(5).fill(0).map(() => [[80000, 0, 0, 0], [80000, 0, 0, 0]]), { past: dollarPast }), /the sweep spent \$.*the p95 a past role spent/],
  ];
  for (const [name, s, reason] of cases) {
    assert.ok(s.warnings.some((w) => reason.test(w)), `${name} is a logged warning: ${s.o.stdout}`);
    assert.deepEqual(s.pauses, [], `${name} does not pause`);
    assert.doesNotMatch(s.o.stdout, /auto-approval paused/, name);
    // A warning never stalls the next sweep: the state stays on and the next approval runs.
    assert.deepEqual(stateLines(approveIn(s.dir, ['--summary']).stdout), ['auto-approval: on'], `${name} leaves auto-approval on`);
    nextBranch(s.dir);
    const next = approveIn(s.dir, [s.r.f]);
    assert.equal(next.status, 0, `${name}: the next sweep runs: ${next.stdout}`);
    assert.doesNotMatch(next.stdout, /ASK THE OWNER/, name);
  }
});

// why: catches no trial review is due after any number of auto-approvals, and the approver prints one state line, auto-approval on or off (K377 S6)
test('no trial review is due after any number of auto-approvals, and the approver prints one state line, auto-approval on or off', () => {
  const t = approveRun(featureContract());
  assert.equal(t.status, 0, t.stdout);
  let last = t;
  for (let i = 1; i < 12; i++) {
    assert.equal(outcome(t).status, 0);
    nextBranch(t.dir);
    last = approveIn(t.dir, [t.f]);
    assert.equal(last.status, 0, `approval ${i + 1}: ${last.stdout}`);
  }
  assert.doesNotMatch(last.stdout, /trial review/);
  assert.equal(approvalLog(t.dir).filter((e) => e.kind === 'pause' || e.kind === 'warning').length, 0, 'no pause and no warning for a review');
  const on = approveIn(t.dir, ['--summary']).stdout;
  assert.deepEqual(stateLines(on), ['auto-approval: on']);
  assert.doesNotMatch(on, /since the last review/);
  const e = approveIn(t.dir, [t.f, '--escape', 'a sync bug shipped']);
  assert.equal(e.status, 0, e.stdout);
  const off = stateLines(approveIn(t.dir, ['--summary']).stdout);
  assert.equal(off.length, 1);
  assert.match(off[0], /^auto-approval: off \(.*a sync bug shipped.*\)$/);
});

// why: catches a warning shows in --summary and in the sweep report (K377 S3)
test('a warning shows in --summary and in the sweep report', () => {
  const s = sweep([atCeiling(), atCeiling(), usual(), usual(), usual()]);
  const reason = s.warnings.find((w) => /stopped at their token ceiling/.test(w));
  assert.ok(reason, `a stopped-share warning is logged: ${s.o.stdout}`);
  assert.ok(s.o.stdout.includes(reason), `the sweep report lists it: ${s.o.stdout}`);
  const summary = approveIn(s.dir, ['--summary']).stdout;
  assert.ok(summary.includes(reason), `--summary lists it: ${summary}`);
  const hash = s.log.filter((e) => e.kind === 'decision').pop().hash;
  const line = summary.split('\n').find((l) => l.includes(reason));
  assert.ok(line.includes(hash) || line.includes('contract.json'), `the warning's line names its sweep: ${line}`);
});

// why: catches a reviewer on another model than the contract named is the lead's to rerun, not a pause (K377 S4)
test('a reviewer on another model than the contract named is the lead\'s to rerun, not a pause', () => {
  const r = approveRun(featureContract());
  const cfg = transcripts({ m1: [[1, 1, 1, 1]], m2: [[1, 1, 1, 1]], m3: [[1, 1, 1, 1]], m4: [{ model: 'claude-haiku-4-5', u: [1, 1, 1, 1] }], m5: [[1, 1, 1, 1]] });
  const o = approveIn(r.dir, [r.f, '--outcome', '--agents', 'm1,m2,m3,m4,m5', '--findings', '1', '--real', '1', '--duplicates', '0'], { CLAUDE_CONFIG_DIR: cfg });
  assert.equal(o.status, 0, o.stdout);
  assert.match(o.stdout, /rerun test-value reviewer on claude-sonnet-5-5/, 'the lead is told which role to rerun on the model the contract named');
  assert.doesNotMatch(o.stdout, /paused/);
  assert.equal(approvalLog(r.dir).filter((e) => e.kind === 'pause').length, 0, 'no pause logged');
  assert.equal(approveIn(r.dir, ['--summary']).stdout.split('\n').filter((l) => /^auto-approval: on$/.test(l)).length, 1);
});

// why: catches bypass: a log line changed by hand still pauses (K377 S1)
test('bypass: a log line changed by hand still pauses', () => {
  for (const how of ['edit', 'delete']) {
    const r = approveRun(featureContract());
    assert.equal(outcome(r).status, 0);
    const file = path.join(r.dir, '.git', 'kit-sweep-approvals.jsonl');
    const lines = read(file).trim().split('\n');
    assert.ok(lines.length >= 2, 'a decision and the outcome that is chained to it');
    if (how === 'edit') lines[0] = lines[0].replace('"tier":"feature"', '"tier":"triage"');
    else lines.splice(0, 1);
    assert.notEqual(lines.join('\n'), read(file).trim(), `the ${how} changed the log`);
    fs.writeFileSync(file, `${lines.join('\n')}\n`);
    assert.match(approveIn(r.dir, ['--summary']).stdout, /^auto-approval: off \(the log was changed by hand at line \d+\)$/m, how); // pin: 2 the summary tells the owner auto-approval is off
    nextBranch(r.dir);
    assert.match(approveIn(r.dir, [r.f]).stdout, /ASK THE OWNER[\s\S]*changed by hand/, `${how}: the next sweep goes to the owner`);
  }
});

// why: catches repeat: the same outcome twice gives the same pauses and warnings (K377 S2)
test('repeat: the same outcome twice gives the same pauses and warnings', () => {
  const spec = () => [overCeiling(), atCeiling(), atCeiling(), usual(), usual()];
  const a = sweep(spec());
  const b = sweep(spec());
  assert.ok(a.pauses.some((p) => /ceiling did not hold/.test(p)), 'the ceiling is a pause');
  assert.ok(a.warnings.some((w) => /stopped at their token ceiling/.test(w)), `the stopped share is a warning: ${a.o.stdout}`);
  assert.ok(!a.pauses.some((p) => /stopped at their/.test(p)), 'and not a pause');
  const strip = (list) => list.map((x) => x.replace(/w\d+/g, 'w'));
  assert.deepEqual(strip(b.pauses), strip(a.pauses));
  assert.deepEqual(strip(b.warnings), strip(a.warnings));
  assert.equal(approveIn(a.dir, ['--summary']).stdout, approveIn(a.dir, ['--summary']).stdout, 'reading the log again changes nothing');
});

// why: catches fail-closed: an outcome the script cannot read pauses, logged (K377 S5)
test('fail-closed: an outcome the script cannot read pauses, logged', () => {
  const r = approveRun(featureContract());
  const cfg = transcripts({ z1: [{ model: null, u: [1, 1, 1, 1] }], z2: [[1, 1, 1, 1]], z3: [[1, 1, 1, 1]], z4: [[1, 1, 1, 1]], z5: [[1, 1, 1, 1]] }, {}, undefined, undefined, { z4: 'claude-sonnet-5-5' });
  const o = approveIn(r.dir, [r.f, '--outcome', '--agents', 'z1,z2,z3,z4,z5', '--findings', '1', '--real', '1', '--duplicates', '0'], { CLAUDE_CONFIG_DIR: cfg });
  assert.equal(o.status, 0, o.stdout);
  // Logged means one row in the kit's hook log, beside the approvals log whose integrity check reads hand edits.
  const rows = (dir) => (fs.existsSync(path.join(dir, '.git', 'kit-guard-open.log')) ? read(path.join(dir, '.git', 'kit-guard-open.log')) : '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((e) => e && e.hook === 'approve');
  assert.ok(rows(r.dir).some((e) => typeof e.cause === 'string' && e.cause.length > 0), `a role with no readable model is logged in the hook log: ${o.stdout}`);
  assert.doesNotMatch(o.stdout, /rerun/, 'a model that cannot be read is no rerun line');
  assert.match(approveIn(r.dir, ['--summary']).stdout, /^auto-approval: off \(.*no recorded model.*\)$/m);
  // A line that is no JSON at all, written before an outcome (test 6 edits and deletes valid lines; this is the unreadable one).
  const b = approveRun(featureContract());
  // The helpers read the log as JSON, so the briefs are written first and approve.mjs runs directly on the broken log.
  const ids = featureContract().roles.map(() => `w${++seq}`);
  const cfg2 = transcripts(Object.fromEntries(ids.map((id) => [id, [[0, 40000, 0, 0]]])), {}, undefined, undefined, roleModels(ids, featureContract().roles));
  const args = [b.f, '--outcome', '--agents', ids.join(','), '--findings', '6', '--real', '5', '--duplicates', '0'];
  leadBriefs(b.dir, args, cfg2);
  fs.appendFileSync(path.join(b.dir, '.git', 'kit-sweep-approvals.jsonl'), 'not json at all\n');
  const out = spawnSync('node', [APPROVE, ...args], { encoding: 'utf8', cwd: b.dir, env: { PATH: process.env.PATH, CLAUDE_CONFIG_DIR: cfg2 } });
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(approveIn(b.dir, ['--summary']).stdout, /^auto-approval: off \(.+\)$/m, 'an unreadable log line leaves auto-approval off');
  assert.ok(rows(b.dir).some((e) => typeof e.cause === 'string' && e.cause.length > 0), 'the unreadable line is logged in the hook log');
});

// why: catches a triage report for a paused ask that does not tell the owner to resume with a Yes in the pop-up
// planted: {"file":"user/skills/pre-pr-sweep/approve.mjs","was":"then resumes with a Yes in the pop-up; until then","to":"then resumes; until then"}
test('the next ask while paused writes its triage with the way forward: resume with a Yes in the pop-up', () => {
  const r = approveRun(featureContract());
  outcome(r, String(Math.ceil(537500 * 1.3)));
  const triage = r.f.replace(/\.json$/, '.triage.md');
  fs.rmSync(triage, { force: true });
  const ask = approveIn(r.dir, [r.f]);
  assert.equal(ask.status, 1, ask.stdout);
  assert.match(read(triage), /resumes with a Yes in the pop-up/, 'the paused ask\'s triage names how the owner resumes');
});
