#!/usr/bin/env node
// The recall run's after-steps, kept in the repo so every release scores the same way (1.20.0 carry-over B8: the
// tools lived in the gitignored reports folder). blind: relabel runs for a blind scorer, strip what names a side, seal
// the map, and fail if anything that names a side survives. score: turn the two scorers' files and the sealed map into
// the per-question table and the lines the gate reads, so no number is typed. Question count, keys and brief come from
// the repo.
//
// Usage: node scripts/recall-score.mjs blind <out folder> <run.md> [<run.md> ...]
//        node scripts/recall-score.mjs score <scorer A output> <scorer B output> <sealed-map.json> <label>
// Runs are named cand-*, base-* and control-* by the lead; the scorer sees only R01, R02, ...
// K198 (Max's fixed gate and his picks, 2026-11-20): a gate is 5 candidate runs and 5 runs of the release measured the
// same day, flat; two blind scorers read every run and a run's score is their average, never rounded up; the candidate's
// median must reach 14 and no question may sum lower, over both scorers and all runs, than on the release.
// K200: runs named any other way (pc-*, cloud-*) are tallied side by side with no gate line.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentVersion, FLOOR, questionCount } from './recall.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// A line about the kit's own version notice marks a side (it fires only on an unreleased build): the whole line goes,
// and each removal is logged for a human to read.
const NOTICE = /unreleased|\*\*Kit (version|update|status|notice)|kit build|startup (hook|notice|check)|the notice (says|suggests|wants|recommends|may)|commits past|current build|back to the release|to the release\b/i;
// K199: a drive letter, a home folder or a share left in a path tells the machine, so the arm.
const LEAK = /unreleased|kit build|the notice (says|suggests|wants|recommends|may)|\bv?\d+\.\d+\.\d+\b|kit-probes|\bcfg-[0-9a-f]{6}\b|\bbase-[0-9a-f]{6}\b|\b[A-Za-z]:[\\/]|(?:^|[\s(`'"])\/(?:home|Users|c)\/|\\\\[\w.$-]+[\\/]/i;

export function dropNotice(text, removed = []) {
  return text.split('\n').filter((l) => {
    if (l.startsWith('Key:') || !NOTICE.test(l)) return true;
    removed.push(l);
    return false;
  }).join('\n');
}

// K199 (the K181 calibration: 16 paths cleared by hand): every home folder is written ~, every temp folder <temp>, a
// drive letter goes, and a backslash in a path is a slash, so a Windows and a Linux answer read the same.
const HOME = /(?:[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^\\/\s`'")]+|\/c\/Users\/[^/\s`'")]+|\/(?:home|Users)\/[^/\s`'")]+|\/root|\$HOME|\$env:USERPROFILE|%USERPROFILE%|\$\{HOME\})(?=[\\/])[\\/]/g;
const TEMP = /(?:~\/AppData[\\/]Local[\\/]Temp|\$env:TEMP|%TEMP%|\/tmp)(?=[\\/\s`'")]|$)/g;
const DRIVE = /\b[A-Za-z]:[\\/]/g;
// A token with backslashes is a path when it has two of them, starts at . or ~ or /, or ends in a file name.
const BACKSLASHED = /[\w.~$%/-]+(?:\\[\w.$%-]+)+\\?/g;
const isPath = (t) => (t.match(/\\/g) || []).length >= 2 || /^[.~/]/.test(t) || /\.\w{1,5}\\?$/.test(t);

export function normalizePaths(text) {
  return text
    .replace(HOME, '~/')
    .replace(DRIVE, '/')
    .replace(BACKSLASHED, (t) => (isPath(t) ? t.replace(/\\/g, '/') : t))
    .replace(TEMP, '<temp>');
}

export function scrub(text) {
  return normalizePaths(text
    .replace(/[A-Za-z]:[\\/][^\s`'")]*kit-probes[\\/][^\s`'")]*/g, '<project>')
    .replace(/kit-probes[\\/][^\s`'")]*/g, '<project>')
    .replace(/[A-Za-z]--[\w-]*kit-probes-[\w-]*/g, '<project key>')
    .replace(/\bv?\d+\.\d+\.\d+(?:-\d+-g[0-9a-f]+)?\b/g, '<version>')
    // A commit id: hex with at least one digit and one letter, so plain words and numbers stay.
    .replace(/\bg?(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g, '<commit>')
    .replace(/\bcfg-[0-9a-f]{6}\b|\bbase-[0-9a-f]{6}\b/g, '<folder>')
    .replace(/\s*\(?unreleased[^)\n]*\)?/gi, ''));
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
  const when = {};
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
    // K198: the run's own header time, sealed with the map, for the same-day check at scoring.
    const at = raw.match(/^When: (\S+)$/m);
    if (at) when[id] = at[1];
    hashes[path.basename(run)] = crypto.createHash('sha256').update(raw).digest('hex');
    fs.writeFileSync(path.join(out, 'scorer', `${id}.md`), `# ${id}\n\n${text}`);
  });
  fs.writeFileSync(path.join(out, 'removed-lines.txt'), removedAll.join('\n') + '\n');
  fs.writeFileSync(path.join(out, 'sealed-map.json'), JSON.stringify({ map, when, hashes }, null, 1));
  return { map };
}

export function readScores(text) {
  const scores = {};
  for (const m of text.matchAll(/^\W*(R\d\d) Q(\d+): ([01])\b/gm)) (scores[m[1]] ||= {})[Number(m[2])] = Number(m[3]);
  return scores;
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

export const RUNS = 5;
export const SCORERS = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
const GATE_ARMS = ['cand', 'base', 'control'];
const TITLES = { cand: 'Candidate', base: 'Baseline', control: 'Control' };

/** K198: every candidate and release run measured within one day of every other; a run with no time fails. */
function sameDay(arms, when) {
  const times = [...arms.cand, ...arms.base].map((r) => Date.parse(when?.[r.id] ?? ''));
  if (times.some(Number.isNaN)) throw new Error('the release arm must be measured the same day as the candidate: every candidate and release run needs its "When:" time in the sealed map (blind it with this tool)');
  if (Math.max(...times) - Math.min(...times) > DAY_MS) throw new Error('the release arm must be measured the same day as the candidate: these runs are more than a day apart');
}

/**
 * The table, the medians, the worse questions and the verdict from both scorers and the sealed map.
 *
 * Args:
 *     sets: one { R01: { 1: 0|1, ... } } per scorer; map: { R01: 'cand-1' }; count: questions per run;
 *     opts: { when: { R01: ISO time } } from the sealed map
 *
 * Returns:
 *     { table, medians, worse, gate }; with cand, base and control runs, also candMedian, baseMedian,
 *     controlMedian and pass (the median reaches the floor and no question is worse)
 */
export function summarize(sets, map, count, { when } = {}) {
  if (!Array.isArray(sets) || sets.length !== SCORERS) throw new Error(`a score needs ${SCORERS} blind scorers' files; got ${Array.isArray(sets) ? sets.length : 0}`);
  const arms = {};
  for (const [id, run] of Object.entries(map)) {
    const arm = run.split('-')[0];
    if (!/^\w+$/.test(arm) || !run.includes('-')) throw new Error(`cannot read the arm of ${run}: name runs <arm>-<n>, such as cand-1, base-1, control-1`);
    const per = sets.map((s) => s[id]);
    if (per.some((s) => !s || Object.keys(s).length !== count)) throw new Error(`${id}: expected ${count} scores from each scorer`);
    // Marks per question summed over both scorers (0 to 2); the run's score is their average.
    const s = Object.fromEntries(Array.from({ length: count }, (_, q) => [q + 1, per.reduce((n, x) => n + x[q + 1], 0)]));
    (arms[arm] ||= []).push({ id, run, s, total: Object.values(s).reduce((a, b) => a + b, 0) / SCORERS });
  }
  const names = [...GATE_ARMS.filter((a) => arms[a]), ...Object.keys(arms).filter((a) => !GATE_ARMS.includes(a))];
  for (const a of names) arms[a].sort((x, y) => x.run.localeCompare(y.run, undefined, { numeric: true }));
  const qs = Array.from({ length: count }, (_, i) => i + 1);
  const cell = (v) => String(v / SCORERS);
  const table = [`| Q | ${names.map((a) => TITLES[a] || a).join(' | ')} |`, `|---|${names.map(() => '---|').join('')}`,
    ...qs.map((q) => `| ${q} | ${names.map((a) => arms[a].map((r) => cell(r.s[q])).join(', ')).join(' | ')} |`),
    `| Total | ${names.map((a) => arms[a].map((r) => r.total).join(', ')).join(' | ')} |`];
  const medians = Object.fromEntries(names.map((a) => [a, median(arms[a].map((r) => r.total))]));
  const gate = GATE_ARMS.every((a) => arms[a]);
  if (!gate) return { table, medians, worse: [], gate };
  if (arms.cand.length !== RUNS || arms.base.length !== RUNS) throw new Error(`a gate is ${RUNS} candidate runs and ${RUNS} release runs, flat; got ${arms.cand.length} and ${arms.base.length}`);
  sameDay(arms, when);
  // A question that sums lower over both scorers and all candidate runs than over the release's is worse (K198).
  const sum = (a, q) => arms[a].reduce((n, r) => n + r.s[q], 0);
  const worse = qs.filter((q) => sum('cand', q) < sum('base', q));
  const candMedian = medians.cand;
  return { table, medians, worse, gate, candMedian, baseMedian: medians.base, controlMedian: medians.control, pass: candMedian >= FLOOR && !worse.length };
}

/**
 * The lines the gate reads, from the scorers' files and the sealed map.
 *
 * The gate line is in whole points, as the base branch's parser reads: the candidate's median rounded down and the
 * release's and control's rounded up, so a half point never helps the candidate.
 */
export function score(files, mapFile, label, kit = KIT) {
  if (!/^\w[\w.-]*$/.test(label || '')) throw new Error('usage: score <scorer A output> <scorer B output> <sealed-map.json> <label>');
  if (!Array.isArray(files) || files.length !== SCORERS) throw new Error(`a score needs two blind scorers' files; got ${Array.isArray(files) ? files.length : 0}`);
  const keysText = fs.readFileSync(path.join(kit, 'docs/evals/recall-questions.md'), 'utf8');
  const keys = currentVersion(keysText);
  const brief = currentVersion(fs.readFileSync(path.join(kit, 'docs/evals/recall-scorer-brief.md'), 'utf8'));
  const sealed = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  const r = summarize(files.map((f) => readScores(fs.readFileSync(f, 'utf8'))), sealed.map, questionCount(keysText, keys), { when: sealed.when });
  if (!r.gate) return { ...r, line: null, lines: [] };
  const line = `gate: ${label} median ${Math.floor(r.candMedian)} baseline ${Math.ceil(r.baseMedian)} brief v${brief} keys v${keys}`;
  const lines = [`scorers: ${SCORERS}`, `worse: ${r.worse.join(', ') || 'none'}`, `control: ${Math.ceil(r.controlMedian)}`, line];
  return { ...r, line, lines, controlLine: lines[2] };
}

const realOf = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && realOf(process.argv[1]) === realOf(fileURLToPath(import.meta.url))) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'blind') {
    const { map } = blind(rest[0], rest.slice(1));
    console.log(`blinded ${Object.keys(map).length} runs into ${rest[0]}/scorer; the map is sealed in sealed-map.json`);
  } else if (cmd === 'score') {
    if (rest.length !== 4) {
      console.log('Usage: node scripts/recall-score.mjs score <scorer A output> <scorer B output> <sealed-map.json> <label>');
      process.exit(2);
    }
    const r = score(rest.slice(0, 2), rest[2], rest[3]);
    console.log(r.table.join('\n'));
    console.log(`\n${Object.entries(r.medians).map(([a, m]) => `${a} median ${m}`).join(', ')}.`);
    if (!r.gate) console.log('\nno gate line: a gate needs cand, base and control runs.');
    else {
      console.log(`Questions summing lower over both scorers than on the release: ${r.worse.join(', ') || 'none'}.`);
      console.log(`\n${r.lines.join('\n')}`);
      if (!r.pass) {
        const why = [r.candMedian < FLOOR && `the candidate's median of ${r.candMedian} is under the floor of ${FLOOR}`, r.worse.length && `questions ${r.worse.join(', ')} do worse than the release`].filter(Boolean);
        console.log(`\nThis build does not pass: ${why.join('; ')}. There is no override (K198): fix the cause, then run a new candidate.`);
        process.exitCode = 1;
      }
    }
  } else {
    console.log('Usage: node scripts/recall-score.mjs blind <out> <run.md> ... | score <scorer A output> <scorer B output> <sealed-map.json> <label>');
    process.exit(2);
  }
}
