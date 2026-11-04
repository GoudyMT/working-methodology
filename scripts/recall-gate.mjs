#!/usr/bin/env node
// CI's recall gate. Rule text is graded by the recall test, which needs a signed-in session and is run by hand, so CI
// cannot run it; it reads the score the PR records. Rule text may merge only when the PR's last added gate line
// shows a median no lower than the released baseline, on the current brief and keys, or carries the owner's marker.
//
// Usage: node scripts/recall-gate.mjs <base> <head>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { currentVersion } from './recall.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCORES = 'docs/evals/results/recall-scores.md';
const RULE_TEXT = /^(rules\/|project\/CLAUDE\.md$)/;
const GATE_LINE = /^gate: (\S+) median (\d+) baseline (\d+) brief v(\d+) keys v(\d+)( owner-accepted)?$/;

/**
 * Whether a PR's rule text may merge, from its recorded score.
 *
 * Args:
 *     facts: { changed: file paths, added: lines the PR adds to the scores file, brief, keys: current versions }
 *
 * Returns:
 *     { ok, detail }
 */
export function checkGate({ changed, added, brief, keys }) {
  if (!changed.some((f) => RULE_TEXT.test(f))) return { ok: true, detail: 'no rule text changed' };
  const lines = added.map((l) => l.trim()).filter((l) => l.startsWith('gate:'));
  if (!lines.length) return { ok: false, detail: `Rule text changed: record a recall run in ${SCORES}, ending in "gate: <label> median <n> baseline <n> brief v<n> keys v<n>"` };
  const last = lines[lines.length - 1];
  const m = last.match(GATE_LINE);
  if (!m) return { ok: false, detail: `cannot read the gate line: ${last}` };
  const [, label, median, baseline, usedBrief, usedKeys, accepted] = m;
  if (Number(usedBrief) !== brief || Number(usedKeys) !== keys) {
    return { ok: false, detail: `${label} was scored on brief v${usedBrief} keys v${usedKeys}; the current ruler is brief v${brief} keys v${keys}` };
  }
  if (Number(median) >= Number(baseline)) return { ok: true, detail: `${label}: median ${median}, baseline ${baseline}` };
  if (accepted) return { ok: true, detail: `${label}: median ${median} is under the baseline ${baseline}; the owner accepted it` };
  return { ok: false, detail: `${label}: median ${median} is under the baseline ${baseline}` };
}

function main([base, head]) {
  if (!base || !head) throw new Error('usage: node scripts/recall-gate.mjs <base> <head>');
  const git = (...a) => {
    const r = spawnSync('git', a, { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr.trim()}`);
    return r.stdout.split('\n');
  };
  const version = (rel) => currentVersion(fs.readFileSync(path.join(KIT, rel), 'utf8'));
  const r = checkGate({
    changed: git('diff', '--name-only', `${base}...${head}`),
    added: git('diff', '-U0', `${base}...${head}`, '--', SCORES).filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1)),
    brief: version('docs/evals/recall-scorer-brief.md'),
    keys: version('docs/evals/recall-questions.md'),
  });
  console.log(r.detail);
  if (!r.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
