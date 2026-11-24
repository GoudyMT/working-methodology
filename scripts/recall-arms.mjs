#!/usr/bin/env node
// Runs the score gate's two arms, the candidate (this kit) and the release, side by side, once the machine is quiet.
//
// Why side by side: both arms then share the same load, so a gap between their scores is the build's, not the hour's.
// Why a load line: a paid recall run on a busy machine is slow and its sessions can time out, so a run over the line does
// not start: it exits 3, and the same command runs it once the build's lanes have stopped.
// Why a copy of the probe login per arm: a token refresh in one arm cannot spoil the other, and the probe's own login
// file is only read, never written.
// Why the names cand-<label>-<n> and base-<label>-<n>: scripts/recall-score.mjs reads the arm from the name.
//
// Usage: node scripts/recall-arms.mjs <label> --release <kit folder> --probe <probe config folder>
// KIT_LOAD_SAMPLE, a JSON array of three { cpu, gpu } readings, replaces the live sampling (tests use it).
// KIT_RECALL_SCRIPT replaces the recall script both arms run (tests use it). KIT_RECALL_RUNS names the runs folder
// the next number is counted from; without it, the candidate's and the release's reports/evals folders are counted.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { install, releaseState } from './kit.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// A program named by its bare name starts from node's own folder, so a same-named file left in a folder never runs.
const SAFE_CWD = path.dirname(process.execPath);
const SAFE_ENV = { ...process.env, NoDefaultCurrentDirectoryInExePath: '1' };
const CPU_LINE = 40;
const GPU_LINE = 50;
const SAMPLES = 3;
const SAMPLE_MS = 1000;
const GPU_TIMEOUT_MS = 10000;
const LOGIN_FILE = '.credentials.json';
const LOGIN_STEP = 'run claude, then /login, with CLAUDE_CONFIG_DIR set to';
const USAGE = 'usage: node scripts/recall-arms.mjs <label> --release <kit folder> --probe <probe config folder>';
const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;
const EXIT_HELD = 3;

const shown = (p) => p.split(path.sep).join('/');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs(argv) {
  const value = (flag) => {
    const at = argv.indexOf(flag);
    const v = at >= 0 ? argv[at + 1] : undefined;
    return v && !v.startsWith('--') ? v : null;
  };
  const [label] = argv;
  const release = value('--release');
  const probe = value('--probe');
  if (!label || !/^\w[\w.-]*$/.test(label) || !release || !probe) return null;
  return { label, release: path.resolve(release), probe: path.resolve(probe) };
}

// The probe login is read, never written. Each arm's own copy renews an expired access token from the refresh token, so a
// login without one is the fault: its access token lapses partway through a run and nothing can renew it.
function probeLoginFault(probe) {
  let text;
  try {
    text = fs.readFileSync(path.join(probe, LOGIN_FILE), 'utf8');
  } catch (e) {
    return e.code === 'ENOENT' ? 'no probe login file' : 'the probe login cannot be read';
  }
  let refreshToken;
  try {
    refreshToken = JSON.parse(text)?.claudeAiOauth?.refreshToken;
  } catch {
    return 'the probe login cannot be read';
  }
  return typeof refreshToken === 'string' && refreshToken !== '' ? null : 'the probe login has no refresh token';
}

function recallScript(kit) {
  return process.env.KIT_RECALL_SCRIPT || path.join(kit, 'scripts', 'recall.mjs');
}

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const { times: t } of os.cpus()) {
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

// A reading that cannot be taken counts as busy, so the run waits rather than starting on a guess.
function cpuBusy(before, after) {
  const total = after.total - before.total;
  return total > 0 ? 100 * (1 - (after.idle - before.idle) / total) : 100;
}

// The busiest GPU's utilisation, or null when nvidia-smi is not installed or gives no reading.
function gpuUtil() {
  const r = spawnSync('nvidia-smi', ['--query-gpu=utilization.gpu', '--format=csv,noheader,nounits'], {
    cwd: SAFE_CWD,
    env: SAFE_ENV,
    windowsHide: true,
    timeout: GPU_TIMEOUT_MS,
    encoding: 'utf8',
  });
  if (r.error || r.status !== 0) return null;
  const readings = r.stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '').map(Number).filter(Number.isFinite);
  return readings.length ? Math.max(...readings) : null;
}

async function sampleLive() {
  const samples = [];
  for (let i = 0; i < SAMPLES; i++) {
    const before = cpuTimes();
    await sleep(SAMPLE_MS);
    samples.push({ cpu: cpuBusy(before, cpuTimes()), gpu: gpuUtil() });
  }
  return samples;
}

function readSamples() {
  const raw = process.env.KIT_LOAD_SAMPLE;
  if (raw === undefined) return sampleLive();
  let v = null;
  try {
    v = JSON.parse(raw);
  } catch {
    // Refused below with the same message as a wrong shape.
  }
  const good = Array.isArray(v) && v.length === SAMPLES
    && v.every((s) => typeof s?.cpu === 'number' && (s.gpu === null || typeof s.gpu === 'number'));
  if (!good) throw new Error('KIT_LOAD_SAMPLE must be three { cpu, gpu } readings');
  return v;
}

// One line per reading that breaks the line; none when every sample is under it.
function holdLines(samples) {
  const round = (x) => Math.round(x * 10) / 10;
  return samples.flatMap((s, i) => [
    s.cpu > CPU_LINE && `sample ${i + 1} reads CPU ${round(s.cpu)}%, over the ${CPU_LINE}% line`,
    s.gpu !== null && s.gpu >= GPU_LINE && `sample ${i + 1} reads GPU ${s.gpu}%, at the ${GPU_LINE}% line or more`,
  ].filter(Boolean));
}

// The next number for this label: one more than the highest saved cand-<label>-<n> or base-<label>-<n>.
function nextNumber(label, dirs) {
  const pattern = new RegExp(`^(?:cand|base)-${label.replace(/\./g, '\\.')}-(\\d+)\\.md$`);
  let top = 0;
  for (const dir of dirs) {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      // A folder not made yet holds no runs.
    }
    for (const f of names) {
      const m = f.match(pattern);
      if (m) top = Math.max(top, Number(m[1]));
    }
  }
  return top + 1;
}

function startArm(arm) {
  const child = spawn(process.execPath, [arm.script, arm.name, arm.kit], {
    cwd: SAFE_CWD,
    windowsHide: true,
    stdio: 'inherit',
    env: { ...process.env, CLAUDE_CONFIG_DIR: arm.configDir, KIT_CLAUDE_HOME: arm.configDir },
  });
  let settle;
  const done = new Promise((resolve) => { settle = resolve; });
  const proc = {
    name: arm.name,
    done,
    stopped: false,
    exited: false,
    stop() {
      if (proc.exited) return;
      proc.stopped = true;
      child.kill();
    },
  };
  child.on('error', () => { proc.exited = true; settle({ code: 1, signal: null }); });
  child.on('exit', (code, signal) => { proc.exited = true; settle({ code, signal }); });
  return proc;
}

// Both arms start at once. A failed arm stops the other, and each arm prints its own exit line.
async function runArms(arms) {
  const procs = arms.map(startArm);
  const codes = await Promise.all(procs.map(async (p) => {
    const e = await p.done;
    if (e.code !== 0) for (const q of procs) if (q !== p) q.stop();
    const what = e.code !== null ? String(e.code) : `signal ${e.signal}`;
    const text = p.stopped && e.code !== 0 ? `stopped after the other arm failed (${what})` : what;
    console.log(`arm ${p.name}: exit ${text}`);
    return e.code;
  }));
  return codes.every((c) => c === 0) ? EXIT_OK : EXIT_FAILED;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (!args) {
    console.error(USAGE);
    return EXIT_USAGE;
  }
  const fault = probeLoginFault(args.probe);
  if (fault) {
    console.error(`arms: ${fault}: ${LOGIN_STEP} ${shown(args.probe)}`);
    return EXIT_FAILED;
  }
  const candScript = recallScript(KIT);
  const baseScript = recallScript(args.release);
  for (const script of [candScript, baseScript]) {
    if (!fs.existsSync(script)) {
      console.error(`arms: no recall script at ${shown(script)}`);
      return EXIT_USAGE;
    }
  }
  let samples;
  try {
    samples = await readSamples();
  } catch (e) {
    console.error(`arms: ${e.message}`);
    return EXIT_USAGE;
  }
  const held = holdLines(samples);
  if (held.length) {
    console.error(`arms: held, no arm started: ${held.join('; ')}`);
    console.error(`arms: run it again once the build's lanes have stopped: node ${shown(path.join(KIT, 'scripts', 'recall-arms.mjs'))} ${args.label} --release ${shown(args.release)} --probe ${shown(args.probe)}`);
    return EXIT_HELD;
  }
  const dirs = [...new Set([
    process.env.KIT_RECALL_RUNS || path.join(KIT, 'reports', 'evals'),
    path.join(args.release, 'reports', 'evals'),
  ])];
  const n = nextNumber(args.label, dirs);
  const kitProbes = path.join(os.homedir(), 'kit-probes');
  fs.mkdirSync(kitProbes, { recursive: true });
  // A random name and an exclusive mkdir (only kit-temp.cjs calls mkdtemp); the arms' folders sit under kit-probes.
  const root = path.join(kitProbes, `arms-${randomBytes(6).toString('hex')}`);
  fs.mkdirSync(root);
  const arms = [
    { name: `cand-${args.label}-${n}`, script: candScript, kit: KIT, configDir: path.join(root, 'cand') },
    { name: `base-${args.label}-${n}`, script: baseScript, kit: args.release, configDir: path.join(root, 'base') },
  ];
  try {
    for (const arm of arms) {
      fs.mkdirSync(arm.configDir);
      fs.copyFileSync(path.join(args.probe, LOGIN_FILE), path.join(arm.configDir, LOGIN_FILE));
      // The arm's user layer comes from its own kit, stamped as the CLI stamps it (a release, or an unreleased build in
      // this throwaway folder), so recall.mjs's checkUserLayer accepts it: a stamp with no release flag is refused.
      const rel = releaseState(arm.kit);
      install({ kit: arm.kit, home: arm.configDir, target: 'user', release: { release: !rel.problems.length, describe: rel.describe, dirty: rel.dirty, tree: rel.tree } });
    }
    return await runArms(arms);
  } finally {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch (e) {
      console.error(`arms: the arm folders stay (${e.code || e.message}): ${shown(root)}`);
    }
  }
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (e) => { console.error(`arms: ${e.message}`); process.exitCode = EXIT_FAILED; },
);
