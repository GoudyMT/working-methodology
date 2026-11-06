#!/usr/bin/env node
// The recall run's after-steps, kept in the repo so every release scores the same way (1.20.0 carry-over B8: the
// tools lived in the gitignored reports folder). blind: relabel runs for a blind scorer, strip what names a side, seal
// the map, and fail if anything that names a side survives. score: turn the scorer's file and the sealed map into the
// per-question table and the gate line, so no number is typed. Question count, keys and brief come from the repo.
//
// Usage: node scripts/recall-score.mjs blind <out folder> <run.md> [<run.md> ...]
//        node scripts/recall-score.mjs score <scorer output> <sealed-map.json> <label>
// Runs are named cand-*, base-* and control-* by the lead; the scorer sees only R01, R02, ...
// A candidate is 3 runs. A median of 3 exactly on the keys' bar holds the gate line: run cand-4 and cand-5, blind all 5
// together and score them, and the median of 5 decides (the owner's decision 7, 1.21.0).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentVersion, passBar, questionCount } from './recall.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// A line about the kit's own version notice marks a side (it fires only on an unreleased build): the whole line goes,
// and each removal is logged for a human to read.
const NOTICE = /unreleased|\*\*Kit (version|update|status|notice)|kit build|startup (hook|notice|check)|the notice (says|suggests|wants|recommends|may)|commits past|current build|back to the release|to the release\b/i;
const LEAK = /unreleased|kit build|the notice (says|suggests|wants|recommends|may)|\bv?\d+\.\d+\.\d+\b|kit-probes|\bcfg-[0-9a-f]{6}\b|\bbase-[0-9a-f]{6}\b/i;

export function dropNotice(text, removed = []) {
  return text.split('\n').filter((l) => {
    if (l.startsWith('Key:') || !NOTICE.test(l)) return true;
    removed.push(l);
    return false;
  }).join('\n');
}

export function scrub(text) {
  return text
    .replace(/[A-Za-z]:[\\/][^\s`'")]*kit-probes[\\/][^\s`'")]*/g, '<project>')
    .replace(/kit-probes[\\/][^\s`'")]*/g, '<project>')
    .replace(/[A-Za-z]--[\w-]*kit-probes-[\w-]*/g, '<project key>')
    .replace(/\bv?\d+\.\d+\.\d+(?:-\d+-g[0-9a-f]+)?\b/g, '<version>')
    // A commit id: hex with at least one digit and one letter, so plain words and numbers stay.
    .replace(/\bg?(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g, '<commit>')
    .replace(/\bcfg-[0-9a-f]{6}\b|\bbase-[0-9a-f]{6}\b/g, '<folder>')
    .replace(/\s*\(?unreleased[^)\n]*\)?/gi, '');
}

export function blindRun(text, removed = []) {
  const at = text.indexOf('\n## 1. ');
  if (at < 0) throw new Error('no question 1 in the run');
  return scrub(dropNotice(text.slice(at + 1), removed));
}

export function blind(out, runs, random = crypto.randomInt) {
  if (!out || !runs.length) throw new Error('usage: blind <out folder> <run.md> ...');
  fs.mkdirSync(path.join(out, 'scorer'), { recursive: true });
  const order = [...runs];
  for (let i = order.length - 1; i > 0; i--) { const j = random(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  const map = {};
  const hashes = {};
  const removedAll = [];
  order.forEach((run, i) => {
    const id = `R${String(i + 1).padStart(2, '0')}`;
    const raw = fs.readFileSync(run, 'utf8');
    const removed = [];
    const text = blindRun(raw, removed);
    removedAll.push(...removed.map((l) => `${path.basename(run, '.md')}: ${l}`));
    const left = text.split('\n').filter((l) => LEAK.test(l));
    if (left.length) throw new Error(`${path.basename(run)} still names a side:\n${left.slice(0, 5).join('\n')}`);
    map[id] = path.basename(run, '.md');
    hashes[path.basename(run)] = crypto.createHash('sha256').update(raw).digest('hex');
    fs.writeFileSync(path.join(out, 'scorer', `${id}.md`), `# ${id}\n\n${text}`);
  });
  fs.writeFileSync(path.join(out, 'removed-lines.txt'), removedAll.join('\n') + '\n');
  fs.writeFileSync(path.join(out, 'sealed-map.json'), JSON.stringify({ map, hashes }, null, 1));
  return { map };
}

export function readScores(text) {
  const scores = {};
  for (const m of text.matchAll(/^\W*(R\d\d) Q(\d+): ([01])\b/gm)) (scores[m[1]] ||= {})[Number(m[2])] = Number(m[3]);
  return scores;
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const RUNS = 3;
const MORE_RUNS = 2;

// One question is noise, so a median of 3 on the bar is too close to call. Runs added to a miss would be a second
// chance at the bar, so 5 runs count only when the first 3, in run order, reached it.
function candidate(totals, bar) {
  if (bar === null) return { candMedian: median(totals) };
  if (totals.length !== RUNS && totals.length !== RUNS + MORE_RUNS) throw new Error(`a candidate is ${RUNS} runs, or ${RUNS + MORE_RUNS} when the median of ${RUNS} lands on the bar; got ${totals.length}`);
  const first = median(totals.slice(0, RUNS));
  if (totals.length === RUNS) return { candMedian: first, ...(first === bar ? { more: MORE_RUNS } : {}) };
  if (first < bar) throw new Error(`${RUNS + MORE_RUNS} runs count only when the first ${RUNS} runs reached the bar of ${bar}; their median is ${first}`);
  return { candMedian: median(totals) };
}

/**
 * The table, the medians and the gate line from the scores and the sealed map.
 *
 * Args:
 *     scores: { R01: { 1: 0|1, ... } }; map: { R01: 'cand-1' }; count: questions per run;
 *     bar: the keys' pass bar, null for none
 *
 * Returns:
 *     { table, worse, candMedian, baseMedian, controlMedian }, and more: the runs still owed, when a median sits on the bar
 */
export function summarize(scores, map, count, bar = null) {
  const arms = { cand: [], base: [], control: [] };
  for (const [id, run] of Object.entries(map)) {
    const arm = run.split('-')[0];
    if (!arms[arm]) throw new Error(`unknown arm: ${run} (name runs cand-*, base-* or control-*)`);
    const s = scores[id];
    if (!s || Object.keys(s).length !== count) throw new Error(`${id}: expected ${count} scores`);
    arms[arm].push({ run, s, total: Object.values(s).reduce((a, b) => a + b, 0) });
  }
  for (const [name, a] of Object.entries(arms)) {
    if (!a.length) throw new Error(`no ${name} runs`);
    a.sort((x, y) => x.run.localeCompare(y.run));
  }
  const qs = Array.from({ length: count }, (_, i) => i + 1);
  const cells = (a, q) => a.map((r) => r.s[q]).join(', ');
  const table = ['| Q | Candidate | Baseline | Control |', '|---|---|---|---|', ...qs.map((q) => `| ${q} | ${cells(arms.cand, q)} | ${cells(arms.base, q)} | ${cells(arms.control, q)} |`),
    `| Total | ${arms.cand.map((r) => r.total).join(', ')} | ${arms.base.map((r) => r.total).join(', ')} | ${arms.control.map((r) => r.total).join(', ')} |`];
  // A question that fails in more candidate runs than baseline runs is a finding, even on a pass.
  const worse = qs.filter((q) => arms.cand.filter((r) => !r.s[q]).length > arms.base.filter((r) => !r.s[q]).length);
  return { table, worse, ...candidate(arms.cand.map((r) => r.total), bar), baseMedian: median(arms.base.map((r) => r.total)), controlMedian: median(arms.control.map((r) => r.total)) };
}

export function score(file, mapFile, label, kit = KIT) {
  if (!/^\w[\w.-]*$/.test(label || '')) throw new Error('usage: score <scorer output> <sealed-map.json> <label>');
  const keysText = fs.readFileSync(path.join(kit, 'docs/evals/recall-questions.md'), 'utf8');
  const keys = currentVersion(keysText);
  const brief = currentVersion(fs.readFileSync(path.join(kit, 'docs/evals/recall-scorer-brief.md'), 'utf8'));
  const bar = passBar(keysText, keys);
  const r = summarize(readScores(fs.readFileSync(file, 'utf8')), JSON.parse(fs.readFileSync(mapFile, 'utf8')).map, questionCount(keysText, keys), bar);
  return { ...r, bar, line: r.more ? null : `gate: ${label} median ${r.candMedian} baseline ${r.baseMedian} brief v${brief} keys v${keys} control ${r.controlMedian}` };
}

const realOf = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && realOf(process.argv[1]) === realOf(fileURLToPath(import.meta.url))) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'blind') {
    const { map } = blind(rest[0], rest.slice(1));
    console.log(`blinded ${Object.keys(map).length} runs into ${rest[0]}/scorer; the map is sealed in sealed-map.json`);
  } else if (cmd === 'score') {
    const r = score(...rest);
    console.log(r.table.join('\n'));
    console.log(`\nCandidate median ${r.candMedian}, baseline median ${r.baseMedian}, control median ${r.controlMedian}.`);
    console.log(`Questions failing more in candidate runs than baseline runs: ${r.worse.join(', ') || 'none'}.`);
    if (r.line) console.log(`\n${r.line}`);
    else {
      console.log(`\nThe candidate's median of 3 is ${r.candMedian}, on the bar of ${r.bar}: no gate line yet. Run cand-4 and cand-5, blind all 5 together and score them; the median of 5 decides.`);
      process.exitCode = 1;
    }
  } else {
    console.log('Usage: node scripts/recall-score.mjs blind <out> <run.md> ... | score <scorer output> <sealed-map.json> <label>');
    process.exit(2);
  }
}
