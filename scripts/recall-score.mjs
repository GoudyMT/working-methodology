#!/usr/bin/env node
// The recall run's after-steps, kept in the repo so every release scores the same way (1.20.0 carry-over B8: the
// tools lived in the gitignored reports folder). blind: relabel runs for a blind scorer, strip what names a side, seal
// the map, and fail if anything that names a side survives. score: turn the two scorers' files and the sealed map into
// the per-question table and the lines the gate reads, so no number is typed. Question count, keys and brief come from
// the repo.
//
// Usage: node scripts/recall-score.mjs blind <out folder> <run.md> [<run.md> ...]
//        node scripts/recall-score.mjs score <scorer A output> <scorer B output> <sealed-map.json> <label>
//             [--again <scorer A output> <scorer B output> <sealed-map.json>]
// Runs are named cand-*, base-* and control-* by the lead; the scorer sees only R01, R02, ...
// K198 (Max's fixed gate and his picks, 2026-11-20): a gate is 5 candidate runs and 5 runs of the release measured the
// same day, flat; two blind scorers read every run and a run's score is their average, never rounded up; the candidate's
// median must reach 14 and no question may be worse than on the release.
// Seen twice (Max's pick, 2026-11-21, after four paired runs): on one look the release scored "worse" than itself. Its
// two sets of five runs that day differed by a run on Q6 one way and on Q7 and Q14 the other, the same five answers got
// 7, 9 and 10 marks of 10 on Q10 from three pairs of scorers, and a build that changed nothing failed the check about
// four times in five. So a question that sums lower, over both scorers and all runs, is asked again alone (recall.mjs
// --only), 5 new sessions a side the same day with two new blind scorers, and is worse only when it sums lower again.
// One look prints no gate line; --again scores both looks together.
// K200: runs named any other way (pc-*, cloud-*) are tallied side by side with no gate line.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentVersion, FLOOR, GATE_PIN, questionCount } from './recall.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// A line about the kit's own version notice marks a side (it fires only on an unreleased build): the whole line goes,
// and each removal is logged for a human to read.
const NOTICE = /unreleased|\*\*Kit (version|update|status|notice)|kit build|startup (hook|notice|check)|the notice (says|suggests|wants|recommends|may)|commits past|back to the release|to the release\b/i;
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

// Any home or drive before it, kit-probes, one folder (a probe's p<hex> too), then the rest of the path kept apart.
const SEG = "[^\\s`'\"()<>\\\\/]+";
const PROBE = new RegExp(`(?:[A-Za-z]:|~|\\$HOME|%USERPROFILE%)?(?:[\\\\/]${SEG})*?[\\\\/]?kit-probes[\\\\/]${SEG}(?:[\\\\/]p[0-9a-f]{6}(?=[\\\\/\\s\`'")]|$))?((?:[\\\\/]${SEG})*)`, 'g');

export function scrub(text) {
  return normalizePaths(text
    // The probe or throwaway folder under kit-probes names a side; only it goes. The file a session named after it stays,
    // forward-slashed (the 2026-11-21 rerun: the whole path went, so "node <project>" hid which approve.mjs it ran).
    .replace(PROBE, (m, rest) => `<project>${(rest || '').replace(/\\/g, '/')}`)
    .replace(/[A-Za-z]--[\w-]*kit-probes-[\w-]*/g, '<project key>')
    .replace(/\bv?\d+\.\d+\.\d+(?:-\d+-g[0-9a-f]+)?\b/g, '<version>')
    // A commit id: hex with at least one digit and one letter, so plain words and numbers stay.
    .replace(/\bg?(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g, '<commit>')
    .replace(/\bcfg-[0-9a-f]{6}\b|\bbase-[0-9a-f]{6}\b/g, '<folder>')
    .replace(/\s*\(?unreleased[^)\n]*\)?/gi, ''));
}

export function blindRun(text, removed = []) {
  // From the first question on: a second look asks one question alone, so its run starts at that question.
  const at = text.search(/\n## \d+\. /);
  if (at < 0) throw new Error('no question in the run');
  return scrub(dropNotice(text.slice(at + 1), removed));
}

export function blind(out, runs, random = crypto.randomInt) {
  if (!out || !runs.length) throw new Error('usage: blind <out folder> <run.md> ...');
  // The build 22 sweep: a second blind step into the same folder would replace the sealed map a look is scored by.
  const scorer = path.join(out, 'scorer');
  if (fs.existsSync(path.join(out, 'sealed-map.json')) || (fs.existsSync(scorer) && fs.readdirSync(scorer).length)) throw new Error(`${out} already holds a blind step: blind each look into a new folder`);
  fs.mkdirSync(path.join(out, 'scorer'), { recursive: true });
  const order = [...runs];
  for (let i = order.length - 1; i > 0; i--) { const j = random(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  const map = {};
  const when = {};
  const hashes = {};
  const only = {};
  // K428: each run's model from its CLI header, sealed with the map and never in the scorer's text.
  const model = {};
  // K231: each run's "User layer:" header, sealed with the map, so the score says whether the user layer was measured.
  const userLayer = {};
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
    // A run that asked named questions alone (recall.mjs --only), sealed for the second-look check at scoring.
    const asked = raw.match(/^Only: (.+)$/m);
    if (asked) only[id] = asked[1].split(/,\s*/).map(Number);
    const ranOn = raw.match(/^CLI: .*; model (\S+), effort /m);
    if (ranOn) model[id] = ranOn[1];
    userLayer[id] = (raw.match(/^User layer: (.*)$/m) || [])[1] ?? '';
    hashes[path.basename(run)] = crypto.createHash('sha256').update(raw).digest('hex');
    fs.writeFileSync(path.join(out, 'scorer', `${id}.md`), `# ${id}\n\n${text}`);
  });
  fs.writeFileSync(path.join(out, 'removed-lines.txt'), removedAll.join('\n') + '\n');
  fs.writeFileSync(path.join(out, 'sealed-map.json'), JSON.stringify({ map, when, hashes, only, userLayer, model }, null, 1));
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
function sameDay(times) {
  if (times.some(Number.isNaN)) throw new Error('the release arm must be measured the same day as the candidate: every candidate and release run needs its "When:" time in the sealed map (blind it with this tool)');
  if (Math.max(...times) - Math.min(...times) > DAY_MS) throw new Error('the release arm must be measured the same day as the candidate: these runs are more than a day apart');
}
const timesOf = (runs, when) => runs.map((r) => Date.parse(when?.[r.id] ?? ''));

/**
 * The second look at the questions that summed lower on the first: 5 new runs a side that asked those questions alone,
 * marked by two new blind scorers, the same day as the first look.
 *
 * Args:
 *     lower: the question numbers the first look names; first: (arm, q) => that look's sum;
 *     again: { sets, map, when } of the second look; firstTimes: the first look's run times
 *
 * Returns:
 *     { asked: [{ q, first: [candidate sum, release sum], second: [...] }], worse: the questions lower both times }
 */
function secondLook(lower, first, again, firstTimes) {
  if (!Array.isArray(again.sets) || again.sets.length !== SCORERS) throw new Error(`a second look needs ${SCORERS} blind scorers' files; got ${Array.isArray(again.sets) ? again.sets.length : 0}`);
  const arms = { cand: [], base: [] };
  for (const [id, run] of Object.entries(again.map || {})) {
    const arm = run.split('-')[0];
    if (!arms[arm]) throw new Error(`a second look is candidate and release runs only, named cand-... and base-... (cand-<x>-<n>, base-<x>-<n>); got ${run}`);
    const per = again.sets.map((x) => x[id]);
    for (const q of lower) if (per.some((x) => !x || x[q] === undefined)) throw new Error(`${id}: the second look has no score for question ${q} from each scorer; ask every lower question again (recall.mjs --only ${lower.join(',')})`);
    // The build 22 sweep: each run asked the lower questions alone (its sealed Only: line), not every question again.
    if (again.only && (again.only[id] || []).join(',') !== lower.join(',')) throw new Error(`${run}: a second look asks the lower questions alone; run it with recall.mjs <label> [kit folder] --only ${lower.join(',')}`);
    arms[arm].push({ id, s: Object.fromEntries(lower.map((q) => [q, per.reduce((n, x) => n + x[q], 0)])) });
  }
  if (arms.cand.length !== RUNS || arms.base.length !== RUNS) throw new Error(`a second look is ${RUNS} candidate runs and ${RUNS} release runs, flat; got ${arms.cand.length} and ${arms.base.length}`);
  sameDay([...firstTimes, ...timesOf([...arms.cand, ...arms.base], again.when)]);
  const sum = (a, q) => arms[a].reduce((n, r) => n + r.s[q], 0);
  const asked = lower.map((q) => ({ q, first: [first('cand', q), first('base', q)], second: [sum('cand', q), sum('base', q)] }));
  return { asked, worse: asked.filter((x) => x.second[0] < x.second[1]).map((x) => x.q) };
}

/**
 * The table, the medians, the worse questions and the verdict from both scorers and the sealed map.
 *
 * Args:
 *     sets: one { R01: { 1: 0|1, ... } } per scorer; map: { R01: 'cand-1' }; count: questions per run;
 *     opts: { when: { R01: ISO time } } from the sealed map, and again: { sets, map, when } of a second look
 *
 * Returns:
 *     { table, medians, lower, worse, gate }; with cand, base and control runs, also candMedian, baseMedian,
 *     controlMedian, pending (a question summed lower and has not been asked again), asked (both looks of each such
 *     question) and pass (the median reaches the floor, nothing is pending and no question is worse)
 */
export function summarize(sets, map, count, { when, again } = {}) {
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
  if (!gate) return { table, medians, lower: [], worse: [], gate };
  if (arms.cand.length !== RUNS || arms.base.length !== RUNS) throw new Error(`a gate is ${RUNS} candidate runs and ${RUNS} release runs, flat; got ${arms.cand.length} and ${arms.base.length}`);
  const firstTimes = timesOf([...arms.cand, ...arms.base], when);
  sameDay(firstTimes);
  // A question that sums lower over both scorers and all candidate runs than over the release's is asked again; it is
  // worse only when the second look shows it lower too (seen twice).
  const sum = (a, q) => arms[a].reduce((n, r) => n + r.s[q], 0);
  const lower = qs.filter((q) => sum('cand', q) < sum('base', q));
  if (again && !lower.length) throw new Error('nothing summed lower on the first look, so no second look is owed: score the first look alone');
  const { asked, worse } = again ? secondLook(lower, sum, again, firstTimes) : { asked: [], worse: [] };
  const candMedian = medians.cand;
  // Under the floor the build fails whatever a second look shows, so none is asked for.
  const pending = lower.length > 0 && !again && candMedian >= FLOOR;
  return { table, medians, lower, asked, worse, pending, gate, candMedian, baseMedian: medians.base, controlMedian: medians.control, pass: candMedian >= FLOOR && !pending && !worse.length };
}

/**
 * The lines the gate reads, from the scorers' files and the sealed map.
 *
 * The gate line is in whole points, as the base branch's parser reads: the candidate's median rounded down and the
 * release's and control's rounded up, so a half point never helps the candidate.
 */
// again: { files: [scorer A, scorer B], mapFile } of the second look, when a question summed lower on the first.
export function score(files, mapFile, label, kit = KIT, again = null) {
  if (!/^\w[\w.-]*$/.test(label || '')) throw new Error('usage: score <scorer A output> <scorer B output> <sealed-map.json> <label> [--again <scorer A output> <scorer B output> <sealed-map.json>]');
  if (!Array.isArray(files) || files.length !== SCORERS) throw new Error(`a score needs two blind scorers' files; got ${Array.isArray(files) ? files.length : 0}`);
  const keysText = fs.readFileSync(path.join(kit, 'docs/evals/recall-questions.md'), 'utf8');
  const keys = currentVersion(keysText);
  const brief = currentVersion(fs.readFileSync(path.join(kit, 'docs/evals/recall-scorer-brief.md'), 'utf8'));
  const sealed = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  // K428: one score is one model, the second look's runs too; a run whose header names none ran on the pin.
  const modelsOf = (m) => Object.keys(m.map || {}).map((id) => m.model?.[id] ?? GATE_PIN);
  const models = new Set([...modelsOf(sealed), ...(again ? modelsOf(JSON.parse(fs.readFileSync(again.mapFile, 'utf8'))) : [])]);
  if (models.size > 1) throw new Error(`runs on more than one model: ${[...models].join(', ')}`);
  const second = again && (() => {
    if (!Array.isArray(again.files) || again.files.length !== SCORERS) throw new Error(`a second look needs two blind scorers' files; got ${Array.isArray(again.files) ? again.files.length : 0}`);
    const map2 = JSON.parse(fs.readFileSync(again.mapFile, 'utf8'));
    // The build 22 sweep: a second look is new sessions, so no run of the first look may be scored again as one.
    if (!map2.hashes || !sealed.hashes) throw new Error('a sealed map has no run hashes: blind both looks with this tool');
    const seen = new Set(Object.values(sealed.hashes));
    const reused = Object.entries(map2.hashes).filter(([, h]) => seen.has(h)).map(([f]) => f);
    if (reused.length) throw new Error(`a second look is new sessions; ${reused.join(', ')} ${reused.length > 1 ? 'were' : 'was'} scored in the first look`);
    return { sets: again.files.map((f) => readScores(fs.readFileSync(f, 'utf8'))), map: map2.map, when: map2.when, only: map2.only || {} };
  })();
  const r = summarize(files.map((f) => readScores(fs.readFileSync(f, 'utf8'))), sealed.map, questionCount(keysText, keys), { when: sealed.when, again: second || undefined });
  if (!r.gate) return { ...r, line: null, lines: [] };
  // One look with a lower question decides nothing: no gate line until it is asked again.
  if (r.pending) return { ...r, line: null, lines: [], lowerLine: `lower once: ${r.lower.join(', ')}` };
  const line = `gate: ${label} median ${Math.floor(r.candMedian)} baseline ${Math.ceil(r.baseMedian)} brief v${brief} keys v${keys}`;
  const top = SCORERS * RUNS;
  const askedLine = r.asked.length ? [`asked again: ${r.asked.map((x) => `${x.q} (${x.first[0]} of ${top} against ${x.first[1]}, then ${x.second[0]} of ${top} against ${x.second[1]})`).join('; ')}`] : [];
  const controlLine = `control: ${Math.ceil(r.controlMedian)}`;
  // Lower on one look, under the floor: named, though the floor already decides.
  const onceLine = !r.asked.length && r.lower.length ? [`lower once: ${r.lower.join(', ')}`] : [];
  const modelLine = models.size && [...models][0] !== GATE_PIN ? [`model: ${[...models][0]}`] : [];
  const lines = [...modelLine, `scorers: ${SCORERS}`, ...askedLine, ...onceLine, `worse: ${r.worse.join(', ') || 'none'}`, controlLine, line];
  // K231 (S7): the user layer counts as measured only when every candidate and release run carried only its own CLAUDE.md.
  // Named by arm and reason, never by run, as the rest of the score is.
  const notOwn = {};
  for (const [id, run] of Object.entries(sealed.map)) {
    const arm = run.split('-')[0];
    const l = sealed.userLayer?.[id] || 'no User layer line';
    if ((arm === 'cand' || arm === 'base') && !/^own \(/.test(l)) (notOwn[arm] ||= new Set()).add(l);
  }
  const userLayerNote = Object.keys(notOwn).length ? `Not measured: the user layer (${['cand', 'base'].filter((a) => notOwn[a]).map((a) => `${a}: ${[...notOwn[a]].join(', ')}`).join('; ')})` : null;
  return { ...r, line, lines, controlLine, userLayerNote };
}

const realOf = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && realOf(process.argv[1]) === realOf(fileURLToPath(import.meta.url))) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'blind') {
    const { map } = blind(rest[0], rest.slice(1));
    console.log(`blinded ${Object.keys(map).length} runs into ${rest[0]}/scorer; the map is sealed in sealed-map.json`);
  } else if (cmd === 'score') {
    const USAGE = 'Usage: node scripts/recall-score.mjs score <scorer A output> <scorer B output> <sealed-map.json> <label> [--again <scorer A output> <scorer B output> <sealed-map.json>]';
    if (!(rest.length === 4 || (rest.length === 8 && rest[4] === '--again'))) {
      console.log(USAGE);
      process.exit(2);
    }
    const r = score(rest.slice(0, 2), rest[2], rest[3], KIT, rest.length === 8 ? { files: rest.slice(5, 7), mapFile: rest[7] } : null);
    console.log(r.table.join('\n'));
    console.log(`\n${Object.entries(r.medians).map(([a, m]) => `${a} median ${m}`).join(', ')}.`);
    if (!r.gate) console.log('\nno gate line: a gate needs cand, base and control runs.');
    else if (r.pending) {
      const list = r.lower.join(',');
      console.log(`Questions summing lower over both scorers than on the release, on this one look: ${r.lower.join(', ')}.`);
      console.log(`\n${r.lowerLine}`);
      console.log(`\nNo gate line yet. One look cannot tell a break from one unlucky answer (the release scores lower than itself this way), so ask ${r.lower.length > 1 ? 'these questions' : 'this question'} again alone, today, 5 new sessions on each side:`);
      console.log(`  node scripts/recall.mjs <label> [kit folder] --only ${list}     (5 labels named cand-<x>-<n> on the candidate, 5 named base-<x>-<n> on the release)`);
      console.log('Blind those ten runs, have two new blind scorers mark them, and score both looks together:');
      console.log(`  node scripts/recall-score.mjs score <scorer A output> <scorer B output> <sealed-map.json> <label> --again <scorer A output> <scorer B output> <sealed-map.json>`);
      console.log('A question is worse only when it sums lower again.');
      process.exitCode = 1;
    } else {
      console.log(`Questions summing lower over both scorers than on the release: ${r.lower.join(', ') || 'none'}${r.asked.length ? `; lower again when asked alone: ${r.worse.join(', ') || 'none'}` : ''}.`);
      console.log(`\n${r.lines.join('\n')}`);
      if (r.userLayerNote) console.log(`\n${r.userLayerNote}`);
      if (!r.pass) {
        const why = [r.candMedian < FLOOR && `the candidate's median of ${r.candMedian} is under the floor of ${FLOOR}`, r.worse.length && `questions ${r.worse.join(', ')} do worse than the release on two looks`].filter(Boolean);
        console.log(`\nThis build does not pass: ${why.join('; ')}. There is no override (K198): fix the cause, then run a new candidate.`);
        process.exitCode = 1;
      }
    }
  } else {
    console.log('Usage: node scripts/recall-score.mjs blind <out> <run.md> ... | score <scorer A output> <scorer B output> <sealed-map.json> <label> [--again <scorer A output> <scorer B output> <sealed-map.json>]');
    process.exit(2);
  }
}
