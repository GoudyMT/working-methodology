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
// projects: every side of a comparison gets it, and a control is not a clean no-rules run (the owner, 2026-11-04). Each
// kit arm also carries its own Claude folder's CLAUDE.md as the probe's parent file (K231). Tools are read-only, the way a careful session would look
// a rule up. Answers are saved word for word; scoring is done after, by a blind scorer, under
// docs/evals/recall-scorer-brief.md.
//
// A session can still read the real Claude folder, and an answer moves with what it finds there (Q7 and approve.mjs),
// so each run records what was installed, and a run on anything but a released user layer is refused, unless the
// Claude folder is a throwaway under kit-probes: a build's new skills can then be measured without touching ~/.claude.
//
// CI cannot run the test, so it reads the score a PR records: the gate command passes rule text only when the PR's
// last added gate line shows a median of 14 or more (K198), no lower than the release measured the same day, on the
// current brief and keys, with two blind scorers and no question worse than that release; the behaviour line is held
// the same way. No marker passes a miss (K198 removed the owner's): a miss is fixed. The numbers are typed and the runs
// are not in the repo, so a PR may not move or reword its ruler.
// A question or scenario is worse only when it is lower on two looks (the owner's pick, 2026-11-21; recall-score.mjs
// says why): one that sums lower is asked again alone, with --only here, and the score tools print the "worse" lines
// only once both looks are in.
//
// Usage: node scripts/recall.mjs <label> [kit folder]    (the kit folder defaults to this one)
//        node scripts/recall.mjs <label> --no-kit        (the control: the same path, nothing installed)
//        node scripts/recall.mjs <label> [kit folder] --only <n,...>   (a second look: those questions alone)
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
// MC2: each session names its model and effort, so neither a saved default nor a new release moves the ruler. Pinned to
// what the owner's main sessions really run (Opus 5.5 at medium, read from the session records on 2026-11-14), never
// to a setting they do not reach. A change here is a new ruler: it needs its own baseline.
const RECALL_MODEL = 'claude-opus-5-5';
const RECALL_EFFORT = 'medium';
// K428 (the owner's pick, 2026-11-24): the model a gate's sessions run on. The pin is the default; KIT_GATE_MODEL names
// another for a whole gate, and every run's record carries it. Only these spellings run: a typo must not move the ruler.
const GATE_MODELS = [RECALL_MODEL, 'claude-sonnet-5-5'];
export const GATE_PIN = RECALL_MODEL;
export function gateModel(env = process.env) {
  if (env.KIT_GATE_MODEL === undefined) return RECALL_MODEL;
  if (!GATE_MODELS.includes(env.KIT_GATE_MODEL)) throw new Error(`KIT_GATE_MODEL "${env.KIT_GATE_MODEL}" is not a gate model: ${GATE_MODELS.join(' or ')}`);
  return env.KIT_GATE_MODEL;
}
const SCORES = 'docs/evals/results/recall-scores.md';
const BRIEF = 'docs/evals/recall-scorer-brief.md';
const QUESTIONS_REL = 'docs/evals/recall-questions.md';
// What the gate guards: the rule text, and the keys, brief and harness that grade it.
// I19 (1.42.0): also what renders or ships text a session reads - the project layer's own text, the memory, kit.mjs that
// renders them - and the behaviour suite and its runner. The project layer's code (the guards) is graded by its tests.
// K231 (S7, flag F5): the global CLAUDE.md is in every session's start text, and each arm now carries its own, so a
// change to it is graded too.
const GRADED = /^(rules\/|project\/.*\.md$|memory\/|user\/CLAUDE\.md$|scripts\/(kit|recall|recall-score|recall-behave)\.mjs$|docs\/evals\/(recall-(questions|scorer-brief)\.md|behaviour-scenarios\.json)$)/i;
// The test set (the owner's plan yes, 2026-11-24): the keys, the brief, the suite and the scripts that run and score them.
const RULER = /^(scripts\/(recall|recall-score|recall-behave)\.mjs$|docs\/evals\/(recall-(questions|scorer-brief)\.md|behaviour-scenarios\.json)$)/i;
// T10 (1.42.0): beside the wording gate line, a rule change records the behaviour suite's line, written by
// recall-behave.mjs line from the saved runs. The base branch's gate reads only the gate line, so this sits apart.
const BEHAVE_LINE = /^behaviour: (\S+) median (\d+) baseline (\d+) suite v(\d+) control (\d+)( owner-accepted)?$/;
const SUITE_REL = 'docs/evals/behaviour-scenarios.json';
// From keys v4 a line names the control's median too (S18-7), so CI can see the control sits clearly under the kit.
const GATE_LINE = /^gate: (\S+) median (\d+) baseline (\d+) brief v(\d+) keys v(\d+)(?: control (\d+))?( owner-accepted)?$/;
const CONTROL_LINE = /^control: (\d+)$/;
// K116 (1.42.0): the commit a run scored, on its own line beside the gate line (the base branch's gate reads only the
// gate line). Rule text changed after it ships unscored, so the gate refuses it.
const SCORED_LINE = /^scored: ([0-9a-f]{40})$/;
const CONTROL_FROM = 4;
// K198 (Max's fixed gate, 2026-11-20): every graded PR needs a median of 14 or more on both suites, two blind scorers
// on the wording runs, and no question or scenario worse than the release measured the same day. There is no owner
// override: a miss is fixed, never accepted. The floor sits here, not in the keys' Pass line, so the ruler does not move;
// CI runs the base branch's copy, so a PR cannot lower it. Each fact sits on its own line, as the control does (D1).
export const FLOOR = 14;
const SCORERS_LINE = /^scorers: (\d+)$/;
const WORSE_LINE = /^worse: (.+)$/;
const BEHAVE_WORSE_LINE = /^behaviour worse: (.+)$/;
// Seen twice: a line the score tools print when a question or scenario was lower on the first look.
const ONCE_LINE = /^(?:behaviour )?lower once: (.+)$/;
const ASKED_LINE = /^(behaviour )?asked again: (.+)$/;
const ASKED_ITEM = /^(\S+) \((\d+) of \d+ against (\d+), then (\d+) of \d+ against (\d+)\)$/;
const OWNER_MARK = /\sowner-accepted\s*$/;

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

const passLine = (text, version) => versionText(text, version).match(/\bPass: median (\d+) of (\d+)\./);

/** How many questions a version says it has, from its "Pass: median <n> of <m>." line, so a lost row is still caught. */
export function questionCount(text, version) {
  const m = passLine(text, version);
  if (!m) throw new Error(`recall v${version} has no "Pass: median <n> of <m>." line`);
  return Number(m[2]);
}

/** The median a version must reach, or null for frozen keys that have no Pass line. */
export function passBar(text, version) {
  const m = passLine(text, version);
  return m ? Number(m[1]) : null;
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
export function installFacts({ projectDir, home, osHome = os.homedir() }) {
  const stamp = readJson(path.join(projectDir, '.kit', 'kit-version.json'));
  const user = readJson(path.join(home, 'kit-install.json'));
  // A throwaway run still loads ~/.claude/CLAUDE.md as a parent folder's file (R2): its version is recorded too.
  const real = isThrowaway(home, osHome) ? readJson(path.join(osHome, '.claude', 'kit-install.json')) : undefined;
  const global = real === undefined ? undefined : !real ? 'none' : `${real.version} (${real.describe})`;
  return {
    ...(global === undefined ? {} : { global }),
    project: !stamp ? 'none' : stamp.release === false ? `${stamp.version} (unreleased ${stamp.describe})` : stamp.version,
    user: !user ? 'none' : user.release === false ? `${user.version} (unreleased ${user.describe})` : `${user.version} (${user.describe})`,
    userRelease: !!user && user.release === true,
    approve: fs.existsSync(path.join(home, 'skills', 'pre-pr-sweep', 'approve.mjs')),
  };
}

/** The run's arguments, or a refusal. The old "<folder> <label>" call fails here: a label is one plain word. */
export function parseRunArgs(argv) {
  const usage = 'usage: node scripts/recall.mjs <label> [kit folder] [--only <n,...>] | <label> --no-kit';
  // --only <n,...>: a second look asks the named questions alone (seen twice); a plain run carries no such field.
  const at = argv.indexOf('--only');
  let only = null;
  let rest = argv;
  if (at >= 0) {
    const list = String(argv[at + 1] ?? '');
    if (!/^[1-9]\d*(,[1-9]\d*)*$/.test(list)) throw new Error(usage);
    only = [...new Set(list.split(',').map(Number))].sort((a, b) => a - b);
    rest = [...argv.slice(0, at), ...argv.slice(at + 2)];
  }
  const [label, second] = rest;
  if (rest.length < 1 || rest.length > 2 || !/^\w[\w.-]*$/.test(label)) throw new Error(usage);
  const noKit = second === '--no-kit';
  return { label, kitDir: second && !noKit ? second : null, noKit, ...(only ? { only } : {}) };
}

/**
 * K137 (build 18): the rule files of a kit folder over their size caps (kit.config.json caps), as lines. The 1.43.0
 * recall rounds ran on text over a cap, which CI then failed, so every paid session of that run was wasted.
 *
 * Args:
 *     kitDir: the kit folder the run installs
 *
 * Returns:
 *     one line per file over its cap; none when all fit or the folder sets no caps
 */
export function capFaults(kitDir) {
  let caps;
  try { caps = JSON.parse(fs.readFileSync(path.join(kitDir, 'kit.config.json'), 'utf8')).caps || {}; } catch { return []; }
  const out = [];
  const size = (p) => { try { return fs.statSync(p).size; } catch { return null; } };
  if (caps.module > 0) {
    let names = [];
    try { names = fs.readdirSync(path.join(kitDir, 'rules')).filter((n) => n.endsWith('.md') && n !== 'core.md'); } catch { /* no rules */ }
    for (const n of names.sort()) { const b = size(path.join(kitDir, 'rules', n)); if (b > caps.module) out.push(`rules/${n}: ${b} B, over its cap of ${caps.module} B`); }
  }
  const agents = size(path.join(kitDir, 'project', 'AGENTS.md'));
  if (caps.agentsMd > 0 && agents > caps.agentsMd) out.push(`project/AGENTS.md: ${agents} B, over its cap of ${caps.agentsMd} B`);
  return out;
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

/** Refuses a run whose sessions would read another folder than the layer checked: the CLI itself says which it reads. */
export function checkSessionHome(home, run) {
  const r = run('claude', ['auth', 'status'], {});
  let dir;
  try { dir = JSON.parse(r.stdout).configDirectory; } catch { /* reported below */ }
  if (r.status !== 0 || !dir) throw new Error(`cannot read the sessions' config folder from claude auth status: ${(r.stderr || r.stdout || '').trim().slice(0, 200)}`);
  const real = (p) => { let x; try { x = fs.realpathSync(p); } catch { x = path.resolve(p); } return process.platform === 'win32' ? x.toLowerCase() : x; };
  if (real(dir) !== real(home)) throw new Error(`sessions read ${dir}, but the layer checked is ${home}: set CLAUDE_CONFIG_DIR and KIT_CLAUDE_HOME to one folder`);
}

/** Whether a Claude folder sits strictly inside kit-probes under the home folder, links followed. */
function isThrowaway(home, osHome) {
  const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  // kit-probes itself a link (to the home folder, say) would make the real Claude folder a throwaway (R1).
  try { if (fs.lstatSync(path.join(osHome, 'kit-probes')).isSymbolicLink()) return false; } catch { /* absent: nothing inside it either */ }
  const inside = path.relative(real(path.join(osHome, 'kit-probes')), real(home));
  return Boolean(inside) && !inside.startsWith('..') && !path.isAbsolute(inside);
}

/**
 * The 2026-11-21 paired run: the rules name ~/.claude/skills/pre-pr-sweep/approve.mjs, and ~ is always the owner's real
 * home, so an arm on a throwaway folder reached the real folder's approve.mjs while the release arm on the real folder
 * reached its own. Every arm of a gate run now runs on its own throwaway Claude folder under kit-probes (gates run in
 * clean throwaway installs only), so ~ never names a layer one arm has and the other does not.
 */
export function checkGateHome(home, osHome = os.homedir()) {
  if (!isThrowaway(home, osHome)) throw new Error(`${home} is not a throwaway Claude folder under ${path.join(osHome, 'kit-probes')}: every arm of a gate run (candidate, release and control) runs on its own throwaway folder, with install user from that arm's kit and its own login`);
}

/** Refuses a Claude folder that is not a released kit install or a throwaway one, before any folder or session exists. */
export function checkUserLayer(home, osHome = os.homedir()) {
  const user = readJson(path.join(home, 'kit-install.json'));
  // A throwaway still holds a real install: release false and a version (R3).
  const unreleasedInstall = user?.release === false && typeof user?.version === 'string';
  if (user?.release !== true && !(unreleasedInstall && isThrowaway(home, osHome))) throw new Error(`${home} is not a released kit install (kit: ${user?.version || 'none'}): run install user from a release, then run this again`);
  // release: true is a flag; a file edited after the install no longer reads as that release (I20).
  if (user?.release === true) {
    const edited = Object.entries(user.files || {}).filter(([key, hash]) => {
      if (key.startsWith('memory/')) return false;
      try { return crypto.createHash('sha256').update(fs.readFileSync(path.join(home, key), 'utf8')).digest('hex') !== hash; } catch { return true; }
    }).map(([key]) => key);
    if (edited.length) throw new Error(`${home} is not a released kit install: changed by hand or missing since install: ${edited.join(', ')}`);
  }
}

/**
 * K231 (S7, build 23b): sessions run with project settings only never read the Claude folder's own CLAUDE.md, so every
 * arm was scored on whatever global file sat at the real ~/.claude, and a user-layer change was never measured. An arm
 * now carries the CLAUDE.md its own Claude folder holds, but only when that file is the one install wrote (its install
 * record's hash) and it is this arm's kit source with only the placeholders filled; anything else is refused, so a
 * hand-edited folder still cannot be scored. The release arm's folder is a release install, which checkUserLayer holds.
 *
 * Args:
 *     ctx: { home, kitDir, noKit, osHome }
 *
 * Returns:
 *     { text, line }: the text to carry (null when none) and the run header's "User layer:" value
 */
export function armUserLayer({ home, kitDir, noKit, osHome = os.homedir() }) {
  if (noKit) return { text: null, line: 'none (control)' };
  const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  const globalFile = path.join(osHome, '.claude', 'CLAUDE.md');
  // The real ~/.claude is already read as a parent folder's file; carrying it again would load it twice.
  if (real(home) === real(path.join(osHome, '.claude'))) return { text: null, line: 'the real ~/.claude/CLAUDE.md' };
  const file = path.join(home, 'CLAUDE.md');
  if (!fs.existsSync(file)) return { text: null, line: 'none: the Claude folder holds no CLAUDE.md' };
  const norm = (t) => t.replace(/\r\n/g, '\n');
  const text = fs.readFileSync(file, 'utf8');
  let source = null;
  try { source = fs.readFileSync(path.join(kitDir, 'user', 'CLAUDE.md'), 'utf8'); } catch { /* refused below */ }
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fromSource = source !== null && new RegExp(`^${norm(source).split(/\{\{[A-Z_]+\}\}/).map(esc).join('[\\s\\S]*?')}$`).test(norm(text));
  const hash = crypto.createHash('sha256').update(text).digest('hex');
  const recorded = readJson(path.join(home, 'kit-install.json'))?.files?.['CLAUDE.md'];
  if (!fromSource || recorded !== hash) throw new Error(`${home} is not this arm's own user layer: CLAUDE.md changed by hand or installed from another kit than ${kitDir}. Run install user from that kit into this throwaway folder, then run this again`);
  const beside = fs.existsSync(globalFile) ? ' beside the real ~/.claude/CLAUDE.md' : '';
  return { text, line: `own${beside} (CLAUDE.md sha256 ${hash.slice(0, 12)})` };
}

/** K231: the arm's own global CLAUDE.md as a parent folder's file of its probe, the way ~/.claude/CLAUDE.md loads. */
export function carryUserLayer(dir, layer) {
  if (layer?.text != null) fs.writeFileSync(path.join(path.dirname(dir), 'CLAUDE.md'), layer.text);
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

/**
 * What the run made: its folder, the memory install wrote for it and its guard record. Nothing a later run can read
 * is left behind (K107: the guard record stayed, and the launcher reads every record on each shell call).
 */
export function removeProbe({ dir, home, slug, osHome = os.homedir(), forget }) {
  // The probe's shape, under this home's own kit-probes, links followed: a probe-shaped folder anywhere else stays.
  const inside = path.relative(path.join(osHome, 'kit-probes'), path.resolve(dir));
  if (!/kit-probes[\\/][0-9a-f]{6}[\\/]p[0-9a-f]{6}$/.test(dir) || !/^[0-9a-f]{6}[\\/]p[0-9a-f]{6}$/.test(inside) || !isThrowaway(dir, osHome)) throw new Error(`${dir} is not a probe folder`);
  // One plain folder name: "..", "" or a path would reach the Claude folder itself.
  if (!/^[\w.-]+$/.test(slug || '') || /^\.+$/.test(slug)) throw new Error(`${JSON.stringify(slug)} is not a memory slug`);
  // Every removal below is named when it fails, never thrown: this runs in the run's finally, where a throw would hide
  // the run's own error (the build 15 sweep: a child process still in the folder made rmSync throw EPERM).
  const tryRm = (p, what) => { try { fs.rmSync(p, { recursive: true, force: true }); return true; } catch (e) { process.stderr.write(`recall: ${what} stays (${e.code || e.message}): ${p}\n`); return false; } };
  const gone = tryRm(path.dirname(dir), 'the probe folder');
  tryRm(path.join(home, 'projects', slug), 'the probe memory');
  // Only once the folder is gone: forget refuses a project that is still there.
  if (forget && !gone) process.stderr.write(`recall: the probe's guard record stays with its folder; once that is gone, run kit.mjs forget on ${dir}\n`);
  else if (forget) {
    try {
      const r = forget({ home, dir });
      if (!r.removed.length && !/no guard record names/.test(r.why)) process.stderr.write(`recall: the probe's guard record stays: ${r.why}\n`);
    } catch (e) { process.stderr.write(`recall: the probe's guard record stays (${e.message}); run kit.mjs forget on ${dir}\n`); }
  }
}

export function runHeader({ label, keys, facts, when, cli, only = null, userLayer }) {
  return [`# Recall run: ${label}`, '', `When: ${when}`, 'Path: kit-probes/<hex>/p<hex>', `CLI: ${cli}`, `Keys: v${keys}`, ...(only ? [`Only: ${only.join(', ')}`] : []),
    `Project kit: ${facts.project}`, `User kit: ${facts.user}`, ...(facts.global ? [`Global CLAUDE.md also loaded from ~/.claude: ${facts.global}`] : []),
    ...(userLayer ? [`User layer: ${userLayer}`] : []), `approve.mjs at the user path: ${facts.approve ? 'yes' : 'no'}`, ''];
}

/**
 * Whether a PR's rule text, ruler or gate line may merge, from its recorded score.
 *
 * Args:
 *     facts: { changed: file paths, added and removed: lines the PR adds to and takes from the scores file,
 *         brief, keys: current versions, bar: the current keys' pass bar, null when they have none,
 *         was: { brief, keys } on the base, each null when the base has none, and edited when a ruler
 *         file differs from the base under the same version }
 *
 * Returns:
 *     { ok, detail }
 */
// scored is the commit the run measured (null when the PR names none); left out, the caller read no scored line and
// the K116 check is not asked for (the gate command always reads it).
// behaviour is { suite, bar } from the head's suite when the caller reads the behaviour line; left out, it is not asked.
// floor is the K198 floor the gate command passes; left out (a direct call), the K198 lines are not asked for.
export function checkGate({ changed, added, removed = [], brief, keys, bar = null, was = {}, scored, after = [], behaviour, floor, count = null }) {
  const all = added.map((l) => l.trim()).filter((l) => l.startsWith('gate:'));
  // A file with no newline at its end shows its last line removed and added back unchanged when an entry is
  // appended (the 1.24.0 build). Beside the PR's own new line, that line is still recorded, so it is no
  // drop, and the re-added copy is never the PR's own line. With no new line of its own, a re-add stays a drop.
  const removedLines = removed.map((l) => l.trim());
  const removedGate = removedLines.filter((l) => /^gate:/i.test(l));
  const own = all.filter((l) => !removedGate.includes(l));
  const lines = own.length ? own : all;
  const dropped = removedGate.some((l) => !(own.length && all.includes(l)));
  const graded = changed.some((f) => GRADED.test(f));
  if (!lines.length && !dropped && !graded) return { ok: true, detail: 'no rule text, ruler or gate line changed' };
  // K198: no line the PR adds may carry the owner's marker; a recorded line only shown again is history.
  const marked = added.map((l) => l.trim()).filter((l) => /^(gate|behaviour):/.test(l) && OWNER_MARK.test(l) && !removedLines.includes(l));
  if (marked.length) return { ok: false, detail: `the owner-accept override is gone (K198): a miss is fixed, never accepted, so no line may end in owner-accepted: ${marked[marked.length - 1]}` };
  if (!lines.length && dropped) return { ok: false, detail: 'this PR removes a recorded gate line: the record of past scores stays' };
  if (!lines.length) return { ok: false, detail: `Rule text or the ruler changed: record a recall run in ${SCORES}, ending in "gate: <label> median <n> baseline <n> brief v<n> keys v<n>", with "control: <n>" beside it` };
  const last = lines[lines.length - 1];
  const m = last.match(GATE_LINE);
  if (!m) return { ok: false, detail: `cannot read the gate line: ${last}` };
  const [, label, median, baseline, usedBrief, usedKeys, inline] = m;
  // CI runs the base branch's gate, which reads only the gate line, so the control sits on its own line.
  const control = inline ?? added.map((l) => l.trim().match(CONTROL_LINE)).filter(Boolean).pop()?.[1];
  if (Number(usedBrief) !== brief || Number(usedKeys) !== keys) {
    return { ok: false, detail: `${label} was scored on brief v${usedBrief} keys v${usedKeys}; the current ruler is brief v${brief} keys v${keys}` };
  }
  if (Number(usedKeys) >= CONTROL_FROM && control == null) return { ok: false, detail: `${label}: from keys v${CONTROL_FROM} a gate line names the control, on its own line beside it: "control: <n>"` };
  if (control != null && Number(control) >= Number(baseline)) return { ok: false, detail: `${label}: control ${control} is not under the baseline ${baseline}, so the score does not show the rules` };
  if (bar !== null && Number(median) < bar) return { ok: false, detail: `${label}: median ${median} is under the pass bar of ${bar} on keys v${keys}` };
  const moved = was.edited || (was.brief != null && was.brief !== brief) || (was.keys != null && was.keys !== keys);
  const scoredAsked = scored !== undefined && graded;
  const behave = behaviour && graded ? added.map((l) => l.trim().match(BEHAVE_LINE)).filter(Boolean).pop() : null;
  if (behave && Number(behave[2]) < behaviour.bar) return { ok: false, detail: `${behave[1]}: behaviour median ${behave[2]} is under the suite's pass bar of ${behaviour.bar}` };
  const behaviourFaults = !behaviour || !graded ? [] : !behave
    ? ['it records no behaviour line: add the line recall-behave.mjs line prints for the candidate, baseline and control runs']
    : [
      Number(behave[4]) !== behaviour.suite && `the behaviour runs were on suite v${behave[4]}; the current suite is v${behaviour.suite}`,
      Number(behave[2]) < Number(behave[3]) && `behaviour median ${behave[2]} is under its baseline ${behave[3]}`,
      Number(behave[5]) >= Number(behave[3]) && `behaviour control ${behave[5]} is not under its baseline ${behave[3]}`,
    ].filter(Boolean);
  // K198: the fixed gate's own facts, each from the line the score tools print beside the gate line.
  const lastOf = (re) => added.map((l) => l.trim().match(re)).filter(Boolean).pop();
  const scorers = lastOf(SCORERS_LINE);
  const worse = lastOf(WORSE_LINE);
  const behaveWorse = lastOf(BEHAVE_WORSE_LINE);
  // The floor is the whole test set, never under FLOOR: a score of 14 on a bigger set is not a pass.
  const top = Math.max(floor ?? 0, count ?? 0);
  const behaveTop = Math.max(floor ?? 0, behaviour?.count ?? 0);
  // A PR that changes only the test set, each changed file on a later version, is judged on the new set (newSet below);
  // any rule text beside it, an edit at one version or a step back keeps the refusal.
  const suiteMoved = !!behaviour && behaviour.base != null && behaviour.base !== behaviour.suite;
  const forward = !was.edited && !(behaviour && behaviour.moved) && (was.brief == null || brief >= was.brief) && (was.keys == null || keys >= was.keys) && !(suiteMoved && behaviour.suite < behaviour.base);
  const onlySet = changed.filter((f) => GRADED.test(f)).every((f) => RULER.test(f));
  const newSet = (moved || suiteMoved) && forward && onlySet && floor != null;
  const fixed = floor == null ? [] : [
    Number(median) < top && `median ${median} is under the floor of ${top}`,
    (!scorers || Number(scorers[1]) !== 2) && 'the wording runs need two blind scorers: add "scorers: 2", as recall-score.mjs score prints it',
    !worse ? 'add the "worse:" line recall-score.mjs score prints' : worse[1].trim() !== 'none' && `questions ${worse[1].trim()} do worse than the same-day release`,
    behave && Number(behave[2]) < behaveTop && `behaviour median ${behave[2]} is under the floor of ${behaveTop} (${behaviour.count} scenarios)`,
    behave && (!behaveWorse ? 'add the "behaviour worse:" line recall-behave.mjs line prints' : behaveWorse[1].trim() !== 'none' && `scenarios ${behaveWorse[1].trim()} do worse than the same-day release`),
    // The build 22 sweep: the worse line is typed beside the lines it sums, so those lines are read too.
    ...added.map((l) => l.trim().match(ONCE_LINE)).filter(Boolean).map((o) => `${o[1].trim()} summed lower on one look and has not been asked again: ask it again alone, then record both looks`),
    ...added.map((l) => l.trim().match(ASKED_LINE)).filter(Boolean).flatMap((a) => a[2].split('; ').map((item) => {
      const m = item.trim().match(ASKED_ITEM);
      if (!m) return `cannot read the ${a[1] ? 'behaviour ' : ''}asked again line: ${item}`;
      return Number(m[4]) < Number(m[5]) && `${m[1]} was lower on both looks (${item.trim()}), so it is worse`;
    })),
    behave && behaviour.count != null && behaviour.count < floor && `the behaviour suite has ${behaviour.count} scenarios, under the floor of ${floor}: a test set never shrinks under it`,
    newSet && count != null && count < floor && `the keys hold ${count} questions, under the floor of ${floor}: a test set never shrinks under it`,
    ...(newSet ? [
      Number(baseline) < top && `a new test set: the release's baseline ${baseline} is under the floor of ${top}`,
      Number(control) !== 0 && `a new test set: the control ${control ?? 'is not recorded'} is not 0`,
      behave && Number(behave[3]) < behaveTop && `a new test set: behaviour baseline ${behave[3]} is under the floor of ${behaveTop}`,
      behave && Number(behave[5]) !== 0 && `a new test set: behaviour control ${behave[5]} is not 0`,
    ] : []),
  ].filter(Boolean);
  const faults = [
    ...fixed,
    ...behaviourFaults,
    behaviour && (behaviour.moved || suiteMoved) && !newSet && graded && `this PR changes the behaviour suite it is graded on (suite v${behaviour.suite})`,
    scoredAsked && !scored && 'it names no scored commit: add "scored: <the full commit id the run measured>" beside the gate line',
    scoredAsked && scored && after.length && `rule text changed after the scored commit ${scored.slice(0, 7)}: ${after.join(', ')}`,
    dropped && 'this PR removes a recorded gate line',
    moved && !newSet && `this PR changes the ruler it is graded on (now brief v${brief} keys v${keys})`,
    // The owner's pick, 2026-11-21: the same-day release score is no longer held against the last one recorded. With no
    // marker left to pass a miss that check had no way out (1.47.0 scored 12 that day against its recorded 13), and at a
    // floor of 14 of 14 a typed-low baseline cannot help a candidate pass. A floor under the top score would need it back
    // (tests/gate-seen-twice.test.mjs holds the floor to the top score).
    Number(median) < Number(baseline) && `median ${median} is under the baseline ${baseline}`,
  ].filter(Boolean);
  if (!faults.length) return { ok: true, detail: `${label}: median ${median}, baseline ${baseline}` };
  return { ok: false, detail: `${label}: ${faults.join('; ')}. A miss is fixed, not accepted (K198)` };
}

function gate([base, head]) {
  if (!base || !head) throw new Error('usage: node scripts/recall.mjs gate <base> <head>');
  // No output cap: a capped read fails, and a failed read of the base would drop the floor (S18-5).
  const opts = { encoding: 'utf8', maxBuffer: 1 << 30 };
  const git = (...a) => {
    const g = spawnSync('git', a, opts);
    if (g.status !== 0) throw new Error(`git ${a.join(' ')}: ${(g.stderr || String(g.error)).trim()}`);
    return g.stdout.split('\n');
  };
  // Changed names, read with -z (the build 16 sweep: a quoted name with a tab in it was never graded).
  const names = (...a) => {
    const g = spawnSync('git', ['diff', '-z', '--no-renames', '--name-only', ...a], opts);
    if (g.status !== 0) throw new Error(`git diff ${a.join(' ')}: ${(g.stderr || String(g.error)).trim()}`);
    return g.stdout.split('\0').filter(Boolean);
  };
  // A file at a commit, or '' when that commit has none; any other failure stops the gate.
  const at = (ref, rel) => {
    const g = spawnSync('git', ['show', `${ref}:${rel}`], opts);
    if (g.status === 0) return g.stdout;
    if (g.error || !/does not exist|exists on disk, but not in|bad revision|invalid object name/i.test(g.stderr)) throw new Error(`git show ${ref}:${rel}: ${(g.stderr || String(g.error)).trim()}`);
    return '';
  };
  // The ruler is the head commit's, never the working tree's (S18-3).
  const now = (rel) => at(head, rel);
  const onBase = (rel) => at(base, rel);
  const baseVersion = (rel) => { const m = onBase(rel).match(/^Current version: v(\d+)$/m); return m ? Number(m[1]) : null; };
  const [brief, keys] = [currentVersion(now(BRIEF)), currentVersion(now(QUESTIONS_REL))];
  const edited = [[BRIEF, brief], [QUESTIONS_REL, keys]].some(([rel, v]) => baseVersion(rel) === v && onBase(rel) !== now(rel));
  // --text: an attribute or a NUL byte must not hide the record from the check.
  const record = git('diff', '--text', '-U0', `${base}...${head}`, '--', SCORES);
  // K116: the graded files that differ between the commit the run scored and the head. A commit that is not on the
  // branch scored other text, so every graded file the PR changes counts.
  const recordAdded = record.filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1).trim());
  const scored = recordAdded.map((l) => l.match(SCORED_LINE)).filter(Boolean).pop()?.[1] ?? null;
  const prChanged = names(`${base}...${head}`);
  const onBranch = scored && spawnSync('git', ['merge-base', '--is-ancestor', scored, head], opts).status === 0;
  const after = !scored ? [] : onBranch
    ? names(scored, head).filter((f) => GRADED.test(f))
    : prChanged.filter((f) => GRADED.test(f));
  // The behaviour suite is the head's, as the ruler is; a head with no suite file asks for no behaviour line.
  const suiteText = at(head, SUITE_REL);
  // Removing the suite would turn its gate off: only a head that still has it, or a base that never had it, goes on.
  if (!suiteText && onBase(SUITE_REL)) { console.log(`this PR removes ${SUITE_REL}, the behaviour suite the gate reads`); process.exitCode = 1; return; }
  // The build 16 sweep: the head's suite is the PR's own text, so it cannot set its own bar. The bar is never under the
  // base's, a head with no bar keeps the base's, and an edit at the same version moves the ruler (the owner's to accept).
  const baseSuite = onBase(SUITE_REL);
  const behaviour = suiteText ? (() => {
    const s = JSON.parse(suiteText);
    const b = baseSuite ? JSON.parse(baseSuite) : {};
    const bar = Math.max(Number.isInteger(s.pass) ? s.pass : 0, Number.isInteger(b.pass) ? b.pass : 0);
    return { suite: s.version, base: Number.isInteger(b.version) ? b.version : null, bar: bar || Infinity, count: (s.scenarios || []).length || null, moved: !!baseSuite && b.version === s.version && baseSuite !== suiteText };
  })() : undefined;
  const r = checkGate({
    floor: FLOOR,
    count: questionCount(now(QUESTIONS_REL), keys),
    behaviour,
    scored,
    after,
    // Each side of a rename counts, and a name stays plain: a rule file moved away is rule text changed.
    changed: names(`${base}...${head}`),
    added: record.filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1)),
    removed: record.filter((l) => l.startsWith('-') && !l.startsWith('---')).map((l) => l.slice(1)),
    brief,
    keys,
    // Keys recall cannot run (no Pass line) cannot grade a PR (B7).
    bar: (() => { questionCount(now(QUESTIONS_REL), keys); return passBar(now(QUESTIONS_REL), keys); })(),
    was: { brief: baseVersion(BRIEF), keys: baseVersion(QUESTIONS_REL), edited },
  });
  console.log(r.detail);
  if (!r.ok) process.exitCode = 1;
}

/** What a run asks and records, or a refusal: all of it before any session starts. */
export function prepare({ projectDir, label, home, osHome, text, when, cli, only = null, userLayer }) {
  checkUserLayer(home, osHome);
  const facts = installFacts({ projectDir, home, osHome });
  const keys = currentVersion(text);
  const qs = questions(text, keys);
  const count = questionCount(text, keys);
  if (!qs.length || qs.length !== count) throw new Error(`expected ${count} questions, found ${qs.length}`);
  if (qs.some((x, i) => x.n !== i + 1)) throw new Error(`the questions must be numbered 1 to ${count}`);
  // A second look asks only the questions that summed lower on the first, each still in its own fresh session.
  const missing = (only || []).find((n) => !qs.some((x) => x.n === n));
  if (missing !== undefined) throw new Error(`--only: no question ${missing} on keys v${keys}`);
  return { qs: only ? qs.filter((x) => only.includes(x.n)) : qs, lines: runHeader({ label, keys, facts, when, cli, only, userLayer }) };
}

/** Ask each question in a fresh session in the probe folder, and return the answers as run-file lines. */
export function askAll({ qs, projectDir, run, model = RECALL_MODEL }) {
  const lines = [];
  for (const { n, q, key } of qs) {
    const r = run('claude', ['-p', '--model', model, '--effort', RECALL_EFFORT, '--setting-sources', 'project', '--strict-mcp-config', '--allowedTools', 'Read,Grep,Glob',
      '--disallowedTools', 'Edit,Write,Bash,PowerShell,WebFetch,WebSearch,Agent', '--max-turns', MAX_TURNS,
      '--no-session-persistence'], { cwd: projectDir, input: q, encoding: 'utf8', timeout: 600000 });
    const answer = (r.stdout || '').trim();
    // A failed session is not an answer: stop rather than save a run that would score as a wrong answer.
    if (/Not logged in/i.test(answer)) {
      const folder = (process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')).split(path.sep).join('/');
      throw new Error(`question ${n}: no answer: Claude Code is not logged in for the config folder ${folder}. Run claude, then /login, with CLAUDE_CONFIG_DIR set to that folder, and run recall again.`);
    }
    if (r.status !== 0 || !answer) {
      throw new Error(`question ${n}: no answer (exit ${r.status}): ${(answer || r.stderr || '').trim().slice(0, 200)}`);
    }
    lines.push(`## ${n}. ${q}`, '', `Key: ${key}`, '', 'Answer:', '', answer.split('\n').map((l) => '> ' + l).join('\n'), '', 'Score: _', '');
    // Counted, not numbered: a second look asks only some questions (--only).
    console.log(`[${lines.length / 10}/${qs.length}] answered (${answer.length} chars)`);
  }
  return lines;
}

/**
 * One run, start to finish: the checks, the folder, the questions, the saved answers, and the clean up.
 *
 * Args:
 *     ctx: { label, kitDir, noKit, home, osHome, env, text, when, outDir, run, kitTools } - kitTools is kit.mjs's
 *         { releaseState, projectSlug, forget }, and run(cmd, args, opts) returns { status, stdout, stderr }
 *
 * Returns:
 *     the path of the saved run
 */
export function recallRun({ label, kitDir, noKit, home, osHome, env, text, when, outDir, run, kitTools, only = null }) {
  // The build 22 sweep: a saved run is paid for; a rerun or a second look takes a new label.
  if (fs.existsSync(path.join(outDir, `${label}.md`))) throw new Error(`${label} is already saved in ${outDir}: give this run a new label (a second look: cand-<x>-<n>, base-<x>-<n>)`);
  checkUserLayer(home, osHome);
  checkHome(env);
  checkSessionHome(home, run);
  const kit = path.resolve(kitDir || KIT);
  const model = gateModel(env);
  // K231: checked before the probe exists, so a refused layer leaves nothing behind.
  const layer = armUserLayer({ home, kitDir: kit, noKit, osHome });
  const projectDir = probePath(osHome);
  try {
    setupProbe({ dir: projectDir, kitDir: kit, noKit, released: !noKit && !kitTools.releaseState(kit).problems.length, run });
    carryUserLayer(projectDir, layer);
    const cli = `${(run('claude', ['--version'], {}).stdout || 'unknown').trim()}; model ${model}, effort ${RECALL_EFFORT}`;
    const { qs, lines } = prepare({ projectDir, label, home, osHome, text, when, cli, only, userLayer: layer.line });
    lines.push(...askAll({ qs, projectDir, run, model }));
    fs.mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, `${label}.md`);
    fs.writeFileSync(out, lines.join('\n'));
    return out;
  } finally {
    removeProbe({ dir: projectDir, home, slug: kitTools.projectSlug(projectDir), osHome, forget: kitTools.forget });
  }
}

// K137: checked before anything else a run does, so no session is paid for on text CI would refuse.
export function refuseOverCap(kitDir, noKit) {
  if (noKit) return;
  const over = capFaults(kitDir || KIT);
  if (!over.length) return;
  process.stderr.write(`Refused: rule text over its size cap, which CI fails, so a recall run on it would be wasted. Trim it first:\n${over.map((l) => `  ${l}`).join('\n')}\n`);
  process.exit(1);
}

async function main(argv) {
  const { label, kitDir, noKit, only } = parseRunArgs(argv);
  refuseOverCap(kitDir, noKit);
  // The Claude config folder, found the way kit.mjs finds it.
  const home = process.env.KIT_CLAUDE_HOME || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  checkUserLayer(home);
  checkGateHome(home);
  // Loaded here so the gate command runs only this file's code.
  const kitTools = await import('./kit.mjs');
  const run = (cmd, args, opts) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  const out = recallRun({ label, kitDir, noKit, home, osHome: os.homedir(), env: process.env, text: fs.readFileSync(QUESTIONS, 'utf8'), when: new Date().toISOString(), outDir: OUT_DIR, run, kitTools, only });
  console.log(`saved ${out}`);
}

// Paths compared after links: run through a junction, the script must still run, not exit 0 having done nothing (S18-2).
const realOf = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && realOf(process.argv[1]) === realOf(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  if (args[0] === 'gate') gate(args.slice(1)); else await main(args);
}
