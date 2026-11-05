#!/usr/bin/env node
// Runs the rule recall test (the current version in docs/evals/recall-questions.md) in a folder it makes itself.
//
// Why its own folder: an answer moved with the test folder's name ("recall" in the path made sessions open the
// memory folder, and that lifted Q10). The path is random, so no argument and no label can choose it, and a baseline
// is the same command with a clone at the old tag as the kit folder, so both sides get the same treatment.
//
// Why a fresh headless session per question: an answer must come only from what a new session loads and can
// read, never from an earlier answer. Only project settings load (--setting-sources project), but the run's folder sits
// under the home folder, so ~/.claude/CLAUDE.md still loads as a parent folder's file, as it does in the owner's real
// projects: every side of a comparison gets it, and a control is not a clean no-rules run (the owner, 2026-11-04). Tools are read-only, the way a careful session would look
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
// Usage: node scripts/recall.mjs <label> [kit folder]    (the kit folder defaults to this one)
//        node scripts/recall.mjs <label> --no-kit        (the control: the same path, nothing installed)
//        node scripts/recall.mjs gate <base> <head>
import crypto from 'node:crypto';
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
// What the gate guards: the rule text, and the keys, brief and harness that grade it.
const GRADED = /^(rules\/|project\/CLAUDE\.md$|scripts\/recall\.mjs$|docs\/evals\/recall-(questions|scorer-brief)\.md$)/;
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

/** How many questions a version says it has, from its "Pass: median <n> of <m>." line, so a lost row is still caught. */
export function questionCount(text, version) {
  const m = versionText(text, version).match(/\bPass: median \d+ of (\d+)\./);
  if (!m) throw new Error(`recall v${version} has no "Pass: median <n> of <m>." line`);
  return Number(m[1]);
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

/** The run's arguments, or a refusal. The old "<folder> <label>" call fails here: a label is one plain word. */
export function parseRunArgs(argv) {
  const usage = 'usage: node scripts/recall.mjs <label> [kit folder] | <label> --no-kit';
  const [label, second] = argv;
  if (argv.length < 1 || argv.length > 2 || !/^\w[\w.-]*$/.test(label)) throw new Error(usage);
  const noKit = second === '--no-kit';
  return { label, kitDir: second && !noKit ? second : null, noKit };
}

/** A fresh random folder. It takes no label, so a label can never reach the path a session sees. */
export function probePath(osHome) {
  const hex = () => crypto.randomBytes(3).toString('hex');
  return path.join(osHome, 'kit-probes', hex(), `p${hex()}`);
}

/** Refuses a kit variable a session would not follow: the layer checked must be the layer the sessions read. */
export function checkHome(env) {
  if (env.KIT_CLAUDE_HOME && env.KIT_CLAUDE_HOME !== env.CLAUDE_CONFIG_DIR) throw new Error('KIT_CLAUDE_HOME is set, but sessions read CLAUDE_CONFIG_DIR: set both to one folder, or neither');
}

/** Refuses a Claude folder that is not a released kit install, before any folder or session exists. */
export function checkUserLayer(home) {
  const user = readJson(path.join(home, 'kit-install.json'));
  if (user?.release !== true) throw new Error(`${home} is not a released kit install (kit: ${user?.version || 'none'}): run install user from a release, then run this again`);
}

/**
 * Make the run's folder: a git repo with the project layer from the kit folder, or nothing for the control.
 *
 * Args:
 *     ctx: { dir, kitDir, noKit, released, run } - released says whether the kit folder is a release, and
 *         run(cmd, args, opts) returns { status, stdout, stderr }
 */
export function setupProbe({ dir, kitDir, noKit, released, run }) {
  const must = (cmd, args, opts) => {
    const r = run(cmd, args, opts);
    if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${(r.stderr || r.stdout || '').trim().slice(0, 200)}`);
  };
  fs.mkdirSync(dir, { recursive: true });
  must('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  if (noKit) return;
  must(process.execPath, [path.join(kitDir, 'scripts', 'kit.mjs'), 'install', 'project', dir, ...(released ? [] : ['--unreleased'])], { cwd: kitDir });
}

/** What the run made: its folder and the memory install wrote for it. Nothing a later run can read is left behind. */
export function removeProbe({ dir, home, slug }) {
  if (!/kit-probes[\\/][0-9a-f]{6}[\\/]p[0-9a-f]{6}$/.test(dir)) throw new Error(`${dir} is not a probe folder`);
  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  fs.rmSync(path.join(home, 'projects', slug), { recursive: true, force: true });
}

export function runHeader({ label, keys, facts, when, cli }) {
  return [`# Recall run: ${label}`, '', `When: ${when}`, 'Path: kit-probes/<hex>/p<hex>', `CLI: ${cli}`, `Keys: v${keys}`,
    `Project kit: ${facts.project}`, `User kit: ${facts.user}`, `approve.mjs at the user path: ${facts.approve ? 'yes' : 'no'}`, ''];
}

/**
 * Whether a PR's rule text, ruler or gate line may merge, from its recorded score.
 *
 * Args:
 *     facts: { changed: file paths, added and removed: lines the PR adds to and takes from the scores file,
 *         brief, keys: current versions,
 *         was: { brief, keys, baseline } on the base, each null when the base has none, and edited when a ruler
 *         file differs from the base under the same version }
 *
 * Returns:
 *     { ok, detail }
 */
export function checkGate({ changed, added, removed = [], brief, keys, was = {} }) {
  const lines = added.map((l) => l.trim()).filter((l) => l.startsWith('gate:'));
  const dropped = removed.some((l) => /^gate:/i.test(l.trim()));
  if (!lines.length && !dropped && !changed.some((f) => GRADED.test(f))) return { ok: true, detail: 'no rule text, ruler or gate line changed' };
  if (!lines.length && dropped) return { ok: false, detail: 'this PR removes a recorded gate line: the floor rests on it. Only the owner may: add a current gate line ending in owner-accepted' };
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
    dropped && 'this PR removes a recorded gate line',
    moved && `this PR changes the ruler it is graded on (now brief v${brief} keys v${keys})`,
    !moved && was.baseline != null && Number(baseline) < was.baseline && `baseline ${baseline} is under the last recorded baseline ${was.baseline}`,
    Number(median) < Number(baseline) && `median ${median} is under the baseline ${baseline}`,
  ].filter(Boolean);
  if (!faults.length) return { ok: true, detail: `${label}: median ${median}, baseline ${baseline}` };
  return accepted ? { ok: true, detail: `${label}: ${faults.join('; ')}; the owner accepted it` } : { ok: false, detail: `${label}: ${faults.join('; ')}. Only the owner may pass this: the gate line ends in owner-accepted` };
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
  // --text: an attribute or a NUL byte must not hide the record from the check.
  const record = git('diff', '--text', '-U0', `${base}...${head}`, '--', SCORES);
  const r = checkGate({
    // Each side of a rename counts, and a name stays plain: a rule file moved away is rule text changed.
    changed: git('-c', 'core.quotepath=off', 'diff', '--no-renames', '--name-only', `${base}...${head}`),
    added: record.filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1)),
    removed: record.filter((l) => l.startsWith('-') && !l.startsWith('---')).map((l) => l.slice(1)),
    brief,
    keys,
    was: { brief: baseVersion(BRIEF), keys: baseVersion(QUESTIONS_REL), baseline: recorded.length ? Number(recorded[recorded.length - 1][3]) : null, edited },
  });
  console.log(r.detail);
  if (!r.ok) process.exitCode = 1;
}

/** What a run asks and records, or a refusal: all of it before any session starts. */
export function prepare({ projectDir, label, home, text, when, cli }) {
  checkUserLayer(home);
  const facts = installFacts({ projectDir, home });
  const keys = currentVersion(text);
  const qs = questions(text, keys);
  const count = questionCount(text, keys);
  if (!qs.length || qs.length !== count) throw new Error(`expected ${count} questions, found ${qs.length}`);
  if (qs.some((x, i) => x.n !== i + 1)) throw new Error(`the questions must be numbered 1 to ${count}`);
  return { qs, lines: runHeader({ label, keys, facts, when, cli }) };
}

/** Ask each question in a fresh session in the probe folder, and return the answers as run-file lines. */
export function askAll({ qs, projectDir, run }) {
  const lines = [];
  for (const { n, q, key } of qs) {
    const r = run('claude', ['-p', '--setting-sources', 'project', '--allowedTools', 'Read,Grep,Glob',
      '--disallowedTools', 'Edit,Write,Bash,PowerShell,WebFetch,WebSearch,Agent', '--max-turns', MAX_TURNS,
      '--no-session-persistence'], { cwd: projectDir, input: q, encoding: 'utf8', timeout: 600000 });
    const answer = (r.stdout || '').trim();
    // A failed session is not an answer: stop rather than save a run that would score as a wrong answer.
    if (r.status !== 0 || !answer || /Not logged in/i.test(answer)) {
      throw new Error(`question ${n}: no answer (exit ${r.status}): ${(answer || r.stderr || '').trim().slice(0, 200)}`);
    }
    lines.push(`## ${n}. ${q}`, '', `Key: ${key}`, '', 'Answer:', '', answer.split('\n').map((l) => '> ' + l).join('\n'), '', 'Score: _', '');
    console.log(`[${n}/${qs.length}] answered (${answer.length} chars)`);
  }
  return lines;
}

/**
 * One run, start to finish: the checks, the folder, the questions, the saved answers, and the clean up.
 *
 * Args:
 *     ctx: { label, kitDir, noKit, home, osHome, env, text, when, outDir, run, kitTools } - kitTools is kit.mjs's
 *         { releaseState, projectSlug }, and run(cmd, args, opts) returns { status, stdout, stderr }
 *
 * Returns:
 *     the path of the saved run
 */
export function recallRun({ label, kitDir, noKit, home, osHome, env, text, when, outDir, run, kitTools }) {
  checkUserLayer(home);
  checkHome(env);
  const kit = path.resolve(kitDir || KIT);
  const projectDir = probePath(osHome);
  try {
    setupProbe({ dir: projectDir, kitDir: kit, noKit, released: !noKit && !kitTools.releaseState(kit).problems.length, run });
    const cli = (run('claude', ['--version'], {}).stdout || 'unknown').trim();
    const { qs, lines } = prepare({ projectDir, label, home, text, when, cli });
    lines.push(...askAll({ qs, projectDir, run }));
    fs.mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, `${label}.md`);
    fs.writeFileSync(out, lines.join('\n'));
    return out;
  } finally {
    removeProbe({ dir: projectDir, home, slug: kitTools.projectSlug(projectDir) });
  }
}

async function main(argv) {
  const { label, kitDir, noKit } = parseRunArgs(argv);
  // The Claude config folder, found the way kit.mjs finds it.
  const home = process.env.KIT_CLAUDE_HOME || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  checkUserLayer(home);
  // Loaded here so the gate command runs only this file's code.
  const kitTools = await import('./kit.mjs');
  const run = (cmd, args, opts) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  const out = recallRun({ label, kitDir, noKit, home, osHome: os.homedir(), env: process.env, text: fs.readFileSync(QUESTIONS, 'utf8'), when: new Date().toISOString(), outDir: OUT_DIR, run, kitTools });
  console.log(`saved ${out}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === 'gate') gate(args.slice(1)); else await main(args);
}
