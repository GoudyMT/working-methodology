// An owner yes clears a sweep only on its own commit: the one-sweep loop reads a decision as cleared only when a yes
// for the same contract file and hash carries the decision's own head.

import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { approveRun, approvalLog, askContract, featureContract, g, read, sweepRepo } from './kit-helpers.mjs';

const OTHER_HEAD = 'b'.repeat(40);
const SECOND = /a second sweep on this branch/;

// Writes hash-chained log lines (each names a hash of the line before), as approve.mjs reads its own log.
function chain(dir, entries) {
  const f = path.join(dir, '.git', 'kit-sweep-approvals.jsonl');
  const lines = fs.existsSync(f) ? read(f).split('\n').filter(Boolean) : [];
  entries.forEach((e, i) => {
    const prev = lines.length ? crypto.createHash('sha256').update(lines[lines.length - 1]).digest('hex').slice(0, 16) : '';
    lines.push(JSON.stringify({ time: new Date(Date.now() - 3600000 + i * 1000).toISOString(), ...e, prev }));
  });
  fs.writeFileSync(f, lines.join('\n') + '\n');
}
const headOf = (dir) => g(dir, 'rev-parse', 'HEAD').stdout.trim();
const decisionAt = (dir, file, head, extra = {}) => ({ kind: 'decision', contract: file, hash: `h-${path.basename(file)}`, tier: 'feature', agents: 5, budget: 1, modifiers: [], decision: 'owner', branch: 'feat/sync', head, ...extra });
const yesFor = (file, extra = {}) => ({ kind: 'owner-yes', contract: file, hash: `h-${path.basename(file)}`, agents: 5, proof: 'popup', tap: `t-${path.basename(file)}`, ...extra });
const ranFor = (file) => ({ kind: 'outcome', contract: file, budget: 1, tokens: 1, findings: 0, real: 0, duplicates: 0, roles: [] });
const contractIn = (dir) => path.join(dir, 'sweeps', 'contract.json');

// why: catches a contract refused on branch X, then approved on branch Y, leaves X's refusal uncleared, so a first contract on X is not read as a second sweep (K357 S1)
test('a contract refused on branch X, then approved on branch Y, leaves X\'s refusal uncleared, so a first contract on X is not read as a second sweep', () => {
  const dir = sweepRepo();
  const f = contractIn(dir);
  // The refusal at X's head; the same contract file and hash then cleared by the owner's yes on Y's head, and run there.
  chain(dir, [decisionAt(dir, f, headOf(dir)), yesFor(f, { head: OTHER_HEAD }), ranFor(f)]);
  const r = approveRun(featureContract(), dir);
  assert.doesNotMatch(r.stdout, SECOND, r.stdout);
  assert.equal(r.status, 0, r.stdout);
  assert.equal(approvalLog(dir).pop().decision, 'approved');
});

// why: catches an owner yes on the same commit still clears the refusal (K357 S1)
test('an owner yes on the same commit still clears the refusal', () => {
  const dir = sweepRepo();
  const f = contractIn(dir);
  const other = path.join(dir, 'sweeps', 'other.json');
  const head = headOf(dir);
  // Control: a yes on another commit comes first in the log and clears nothing; the yes on this commit clears its own.
  chain(dir, [decisionAt(dir, other, head), yesFor(other, { head: OTHER_HEAD }), ranFor(other), decisionAt(dir, f, head), yesFor(f, { head }), ranFor(f)]);
  const r = approveRun(featureContract(), dir);
  assert.match(r.stdout, /ASK THE OWNER[\s\S]*a second sweep on this branch/, r.stdout);
  assert.match(r.stdout, /contract\.json already ran/);
  assert.doesNotMatch(r.stdout, /other\.json already ran/);
});

// why: catches an owner yes logged with no head does not clear a line that has one (K357 S2)
test('an owner yes logged with no head does not clear a line that has one', () => {
  const dir = sweepRepo();
  const f = contractIn(dir);
  chain(dir, [decisionAt(dir, f, headOf(dir)), yesFor(f), ranFor(f)]);
  const r = approveRun(featureContract(), dir);
  assert.doesNotMatch(r.stdout, SECOND, r.stdout);
  assert.equal(r.status, 0, r.stdout);
});

// why: catches the same log read twice gives the same verdict (K357 S1)
test('the same log read twice gives the same verdict', () => {
  const dir = sweepRepo();
  const f = contractIn(dir);
  chain(dir, [decisionAt(dir, f, headOf(dir)), yesFor(f, { head: OTHER_HEAD }), ranFor(f)]);
  // A fix-tier contract with an added source file goes to the owner for its own reason, both times.
  const one = approveRun(askContract(), dir);
  const two = approveRun(askContract(), dir);
  assert.equal(one.stdout.includes('ASK THE OWNER'), true, one.stdout);
  const [a, b] = approvalLog(dir).filter((e) => e.kind === 'decision').slice(-2);
  assert.deepEqual([a.decision, a.reasons], [b.decision, b.reasons]);
  assert.equal(a.reasons.some((x) => SECOND.test(x)), false, JSON.stringify(a.reasons));
  assert.doesNotMatch(two.stdout, SECOND);
});

// why: catches a decision line whose head cannot be read stays uncleared, logged (K357 S2)
test('a decision line whose head cannot be read stays uncleared, logged', () => {
  const dir = sweepRepo();
  const f = contractIn(dir);
  const odd = { not: 'a commit' };
  chain(dir, [decisionAt(dir, f, odd), yesFor(f, { head: odd }), ranFor(f)]);
  const r = approveRun(featureContract(), dir);
  assert.doesNotMatch(r.stdout, SECOND, r.stdout);
  assert.equal(r.status, 0, r.stdout);
});
