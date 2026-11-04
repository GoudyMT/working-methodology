#!/usr/bin/env node
// Runs the rule recall test (the current version in docs/evals/recall-questions.md) against one project folder.
//
// Why a fresh headless session per question: an answer must come only from what a new session loads and can
// read, never from an earlier answer. Only project settings load (--setting-sources project), so the owner's
// own ~/.claude rules do not leak into the score. Tools are read-only, the way a careful session would look
// a rule up. Answers are saved word for word; scoring is done after, by a blind scorer, under
// docs/evals/recall-scorer-brief.md.
//
// A session can still read the real Claude folder, and an answer moves with what it finds there (Q7 and approve.mjs),
// so each run records what was installed, and a run on anything but a released user layer is refused.
//
// CI cannot run the test, so it reads the score a PR records: the gate command passes rule text only when the PR's
// last added gate line shows a median no lower than the released baseline, on the current brief and keys, or carries
// the owner's marker. The numbers are typed and the runs are not in the repo, so the check holds them against main: a
// baseline may not fall under the last one recorded on the same ruler, and a PR may not move or reword its ruler,
// unmarked. The floor is the last baseline, not the last median: one question is noise, so an honest re-measure may land
// a point under the last score.
//
// Usage: node scripts/recall.mjs <project folder> <label>
//        node scripts/recall.mjs gate <base> <head>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUESTIONS = path.join(KIT, 'docs', 'evals', 'recall-questions.md');
// Raw answers quote local paths, so they stay in the gitignored reports folder; only scores are committed.
const OUT_DIR = path.join(KIT, 'reports', 'evals');
const MAX_TURNS = '8';
const SCORES = 'docs/evals/results/recall-scores.md';
const BRIEF = 'docs/evals/recall-scorer-brief.md';
const QUESTIONS_REL = 'docs/evals/recall-questions.md';
// What the gate guards: the rule text, and the keys and brief that grade it.
const GRADED = /^(rules\/|project\/CLAUDE\.md$|docs\/evals\/recall-(questions|scorer-brief)\.md$)/;
const GATE_LINE = /^gate: (\S+) median (\d+) baseline (\d+) brief v(\d+) keys v(\d+)( owner-accepted)?$/;

/** The version a keys or brief file is on, from its "Current version: v<n>" line. */
export function currentVersion(text) {
  const m = text.match(/^Current version: v(\d+)$/m);
  if (!m) throw new Error('no "Current version: v<n>" line');
  return Number(m[1]);
}

/** One version's text: everything after its "<!-- recall v<n> -->" line, up to the next version's. */
export function versionText(text, version) {
  const parts = text.split(/^<!-- recall v(\d+) -->\n/m);
  const at = parts.findIndex((p, i) => i % 2 === 1 && Number(p) === version);
  if (at < 0) throw new Error(`no recall v${version} in the questions`);
  return parts[at + 1];
}

export function questions(text, version) {
  return versionText(text, version).split('\n')
    .map((l) => l.match(/^\| (\d+) \| (.+?) \| (.+?) \|$/))
    .filter(Boolean)
    .map((m) => ({ n: Number(m[1]), q: m[2], key: m[3] }));
}

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

/**
 * What a run's answers can draw on: the kit in the project, the kit in the Claude folder, and approve.mjs.
 *
 * Args:
 *     ctx: { projectDir, home }
 *
 * Returns:
 *     { project, user, userRelease, approve }
 */
export function installFacts({ projectDir, home }) {
  const stamp = readJson(path.join(projectDir, '.kit', 'kit-version.json'));
  const user = readJson(path.join(home, 'kit-install.json'));
  return {
    project: !stamp ? 'none' : stamp.release === false ? `${stamp.version} (unreleased ${stamp.describe})` : stamp.version,
    user: user ? user.version : 'none',
    userRelease: !!user && user.release === true,
    approve: fs.existsSync(path.join(home, 'skills', 'pre-pr-sweep', 'approve.mjs')),
  };
}

export function runHeader({ label, projectDir, keys, facts, when }) {
  return [`# Recall run: ${label}`, '', `Project: ${path.basename(path.resolve(projectDir))}; ${when}`, `Keys: v${keys}`,
    `Project kit: ${facts.project}`, `User kit: ${facts.user}`, `approve.mjs at the user path: ${facts.approve ? 'yes' : 'no'}`, ''];
}

/**
 * Whether a PR's rule text, ruler or gate line may merge, from its recorded score.
 *
 * Args:
 *     facts: { changed: file paths, added: lines the PR adds to the scores file, brief, keys: current versions,
 *         was: { brief, keys, baseline } on the base, each null when the base has none, and edited when a ruler
 *         file differs from the base under the same version }
 *
 * Returns:
 *     { ok, detail }
 */
export function checkGate({ changed, added, brief, keys, was = {} }) {
  const lines = added.map((l) => l.trim()).filter((l) => l.startsWith('gate:'));
  if (!lines.length && !changed.some((f) => GRADED.test(f))) return { ok: true, detail: 'no rule text, ruler or gate line changed' };
  if (!lines.length) return { ok: false, detail: `Rule text or the ruler changed: record a recall run in ${SCORES}, ending in "gate: <label> median <n> baseline <n> brief v<n> keys v<n>"` };
  const last = lines[lines.length - 1];
  const m = last.match(GATE_LINE);
  if (!m) return { ok: false, detail: `cannot read the gate line: ${last}` };
  const [, label, median, baseline, usedBrief, usedKeys, accepted] = m;
  if (Number(usedBrief) !== brief || Number(usedKeys) !== keys) {
    return { ok: false, detail: `${label} was scored on brief v${usedBrief} keys v${usedKeys}; the current ruler is brief v${brief} keys v${keys}` };
  }
  const moved = was.edited || (was.brief != null && was.brief !== brief) || (was.keys != null && was.keys !== keys);
  const faults = [
    moved && `this PR changes the ruler it is graded on (now brief v${brief} keys v${keys})`,
    !moved && was.baseline != null && Number(baseline) < was.baseline && `baseline ${baseline} is under the last recorded baseline ${was.baseline}`,
    Number(median) < Number(baseline) && `median ${median} is under the baseline ${baseline}`,
  ].filter(Boolean);
  if (!faults.length) return { ok: true, detail: `${label}: median ${median}, baseline ${baseline}` };
  return accepted ? { ok: true, detail: `${label}: ${faults.join('; ')}; the owner accepted it` } : { ok: false, detail: `${label}: ${faults.join('; ')}` };
}

function gate([base, head]) {
  if (!base || !head) throw new Error('usage: node scripts/recall.mjs gate <base> <head>');
  const git = (...a) => {
    const g = spawnSync('git', a, { encoding: 'utf8' });
    if (g.status !== 0) throw new Error(`git ${a.join(' ')}: ${g.stderr.trim()}`);
    return g.stdout.split('\n');
  };
  const now = (rel) => fs.readFileSync(path.join(KIT, rel), 'utf8');
  const onBase = (rel) => { const g = spawnSync('git', ['show', `${base}:${rel}`], { encoding: 'utf8' }); return g.status === 0 ? g.stdout : ''; };
  const baseVersion = (rel) => { const m = onBase(rel).match(/^Current version: v(\d+)$/m); return m ? Number(m[1]) : null; };
  const [brief, keys] = [currentVersion(now(BRIEF)), currentVersion(now(QUESTIONS_REL))];
  const edited = [[BRIEF, brief], [QUESTIONS_REL, keys]].some(([rel, v]) => baseVersion(rel) === v && onBase(rel) !== now(rel));
  // The last baseline recorded on this same ruler, if the base has one.
  const recorded = onBase(SCORES).split('\n').map((l) => l.trim().match(GATE_LINE)).filter((m) => m && Number(m[4]) === brief && Number(m[5]) === keys);
  const r = checkGate({
    // Each side of a rename counts, and a name stays plain: a rule file moved away is rule text changed.
    changed: git('-c', 'core.quotepath=off', 'diff', '--no-renames', '--name-only', `${base}...${head}`),
    added: git('diff', '-U0', `${base}...${head}`, '--', SCORES).filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1)),
    brief,
    keys,
    was: { brief: baseVersion(BRIEF), keys: baseVersion(QUESTIONS_REL), baseline: recorded.length ? Number(recorded[recorded.length - 1][3]) : null, edited },
  });
  console.log(r.detail);
  if (!r.ok) process.exitCode = 1;
}

/** What a run asks and records, or a refusal: all of it before any session starts. */
export function prepare({ projectDir, label, home, text, when }) {
  const facts = installFacts({ projectDir, home });
  if (!facts.userRelease) throw new Error(`${home} is not a released kit install (kit: ${facts.user}): run install user from a release, then run this again`);
  const keys = currentVersion(text);
  const qs = questions(text, keys);
  if (qs.length !== 10) throw new Error(`expected 10 questions, found ${qs.length}`);
  return { qs, lines: runHeader({ label, projectDir, keys, facts, when }) };
}

function main([projectDir, label]) {
  if (!projectDir || !label) throw new Error('usage: node scripts/recall.mjs <project folder> <label>');
  // The Claude config folder, found the way kit.mjs finds it.
  const home = process.env.KIT_CLAUDE_HOME || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const { qs, lines } = prepare({ projectDir, label, home, text: fs.readFileSync(QUESTIONS, 'utf8'), when: new Date().toISOString() });
  for (const { n, q, key } of qs) {
    const r = spawnSync('claude', ['-p', '--setting-sources', 'project', '--allowedTools', 'Read,Grep,Glob',
      '--disallowedTools', 'Edit,Write,Bash,PowerShell,WebFetch,WebSearch,Agent', '--max-turns', MAX_TURNS,
      '--no-session-persistence'], { cwd: projectDir, input: q, encoding: 'utf8', timeout: 600000 });
    const answer = (r.stdout || '').trim();
    // A failed session is not an answer: stop rather than save a run that would score as a wrong answer.
    if (r.status !== 0 || !answer || /Not logged in/i.test(answer)) {
      throw new Error(`question ${n}: no answer (exit ${r.status}): ${(answer || r.stderr || '').trim().slice(0, 200)}`);
    }
    lines.push(`## ${n}. ${q}`, '', `Key: ${key}`, '', 'Answer:', '', answer.split('\n').map((l) => '> ' + l).join('\n'), '', 'Score: _', '');
    console.log(`[${n}/10] answered (${answer.length} chars)`);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `${label}.md`);
  fs.writeFileSync(out, lines.join('\n'));
  console.log(`saved ${out}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === 'gate') gate(args.slice(1)); else main(args);
}
