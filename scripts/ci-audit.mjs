// scripts/ci-audit.mjs: K381 (U19), per-job waiting, setup and running times from CI runs. Read only.
//   node scripts/ci-audit.mjs --runs <file> --jobs <file> [--pr-target <s>]
// --runs is a JSON array of workflow runs (GitHub's run list). --jobs is a JSON object keyed by run id; each value is
// GitHub's run-jobs answer {jobs: [...]}. Prints a table, then one last line `ci-audit-json: {...}`.
// Reads files only: no network, no writes, no child process. A job's time is completed_at minus started_at, read the
// way ci-budget.mjs (K401) reads it. Waiting is started_at minus created_at. Setup is the steps whose names match
// SETUP_PATTERNS; running is the rest of the job. A job with no steps or no start time is not measured, never 0.
// The time to the required check is the run's run_started_at to REQUIRED_JOB's completed_at.
import fs from 'node:fs';

const REQUIRED_JOB = 'kit-tests';
const DEFAULT_TARGET = 90;
const USAGE = 'usage: node scripts/ci-audit.mjs --runs <file> --jobs <file> [--pr-target <s>]';
const NOT_RED = ['success', 'skipped', 'neutral'];

// A step whose name matches one of these is setup time, not running time.
const SETUP_PATTERNS = [
  { label: 'runner set-up', re: /^set up job$/i },
  { label: 'checkout', re: /checkout/i },
  { label: 'Node', re: /\bnode\b/i },
  { label: 'git identity', re: /git identity/i },
  { label: 'base scripts', re: /base scripts/i },
  { label: 'map download', re: /map download/i },
  { label: 'post steps', re: /^post |^complete job$/i },
];

// The first failed step decides a red run's cause. A failed setup step is CI bug; otherwise the first of these that matches.
const CAUSE_PATTERNS = [
  { cause: 'timing', label: 'time budget', re: /time budget/i },
  { cause: 'owed', label: 'closeout', re: /closeout/i },
  { cause: 'fails-first', label: 'test check', re: /test check/i },
  { cause: 'CI bug', label: 'workflow lint, or a failed setup step', re: /workflow lint/i },
  { cause: 'style or record', label: 'names, secret, build record, scrub, words, links, map', re: /names|secret|build record|scrub|words|links|map/i },
];
const CAUSE_LINES = [
  ...CAUSE_PATTERNS.map((p) => `  ${p.cause}: ${p.label}`),
  '  code: any other failed step',
  '  infra: no failed step (cancelled, timed out, or a failed job with no failed step)',
];

class Usage extends Error {}
class Unreadable extends Error {}

function parseArgs(args) {
  const opts = { target: DEFAULT_TARGET };
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (!['--runs', '--jobs', '--pr-target'].includes(flag) || !value || value.startsWith('--')) throw new Usage(USAGE);
    if (flag === '--runs') opts.runs = value;
    else if (flag === '--jobs') opts.jobs = value;
    else if (/^[1-9]\d*$/.test(value)) opts.target = Number(value);
    else throw new Usage(`--pr-target takes a whole number of seconds, got ${value}`);
  }
  if (opts.runs === undefined || opts.jobs === undefined) throw new Usage(USAGE);
  return opts;
}

function readJson(file, what) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new Unreadable(`cannot read ${what} ${file}: ${e.code || e.message}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Unreadable(`${what} ${file} is not JSON`);
  }
}

function loadRuns(file) {
  const runs = readJson(file, '--runs');
  if (!Array.isArray(runs) || runs.some((r) => typeof r !== 'object' || r === null)) throw new Unreadable(`--runs ${file} is not an array of runs`);
  return runs;
}

function loadJobs(file) {
  const byRun = readJson(file, '--jobs');
  if (typeof byRun !== 'object' || byRun === null || Array.isArray(byRun)) throw new Unreadable(`--jobs ${file} is not an object keyed by run id`);
  return byRun;
}

// The jobs of one run; a run with no entry in --jobs has none to measure.
function jobsOf(byRun, run) {
  const key = String(run.id);
  const answer = Object.hasOwn(byRun, key) ? byRun[key] : undefined;
  return Array.isArray(answer?.jobs) ? answer.jobs.filter((j) => typeof j === 'object' && j !== null) : [];
}

// A timestamp in ms, or undefined when it is missing or not a date.
function ms(iso) {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : undefined;
}

// Milliseconds to seconds, one decimal place.
const secs = (millis) => Math.round(millis / 100) / 10;

const isSetup = (name) => SETUP_PATTERNS.some((p) => p.re.test(String(name ?? '')));

// Nearest rank: the p50 of 3 values is the 2nd, the p95 of 3 is the 3rd.
function pct(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil((p * sorted.length) / 100) - 1];
}

function summary(values) {
  return { p50: pct(values, 50), p95: pct(values, 95) };
}

// One job's waiting, setup and running in seconds, or null when the job cannot be measured.
function measure(job) {
  const created = ms(job.created_at);
  const started = ms(job.started_at);
  const done = ms(job.completed_at);
  if (job.status !== 'completed' || !Array.isArray(job.steps) || job.steps.length === 0) return null;
  if (created === undefined || started === undefined || done === undefined || started < created || done < started) return null;
  let setupMs = 0;
  for (const step of job.steps) {
    const s = ms(step?.started_at);
    const e = ms(step?.completed_at);
    if (s === undefined || e === undefined || e < s) return null;
    if (isSetup(step.name)) setupMs += e - s;
  }
  const runningMs = done - started - setupMs;
  if (runningMs < 0) return null;
  return { waiting: secs(started - created), setup: secs(setupMs), running: secs(runningMs) };
}

// The first failed step across a run's jobs, in order, or undefined.
function firstFailed(jobs) {
  for (const job of jobs) {
    const steps = Array.isArray(job.steps) ? job.steps : [];
    const hit = steps.find((step) => step?.conclusion === 'failure');
    if (hit !== undefined) return hit;
  }
  return undefined;
}

function causeOf(step) {
  if (step === undefined) return 'infra';
  const name = String(step.name ?? '');
  if (isSetup(name)) return 'CI bug';
  const hit = CAUSE_PATTERNS.find((p) => p.re.test(name));
  return hit ? hit.cause : 'code';
}

// Minutes from a red run's end to the next push on its branch: the first later run on that branch with another head
// sha, so a rerun of the same commit is not a push. Null when the file holds no later push.
function minutesToNextPush(run, endMs, runs) {
  let next;
  for (const other of runs) {
    if (other.head_branch !== run.head_branch || other.head_sha === run.head_sha) continue;
    const created = ms(other.created_at);
    if (created !== undefined && created >= endMs && (next === undefined || created < next)) next = created;
  }
  return next === undefined ? null : Math.round((next - endMs) / 6000) / 10;
}

function audit(opts) {
  const runs = loadRuns(opts.runs);
  const byRun = loadJobs(opts.jobs);

  const perJob = new Map();
  for (const run of runs) {
    for (const job of jobsOf(byRun, run)) {
      if (typeof job.name !== 'string') continue;
      if (!perJob.has(job.name)) perJob.set(job.name, { measured: 0, notMeasured: 0, waiting: [], setup: [], running: [] });
      const rec = perJob.get(job.name);
      const m = measure(job);
      if (m === null) {
        rec.notMeasured += 1;
        continue;
      }
      rec.measured += 1;
      rec.waiting.push(m.waiting);
      rec.setup.push(m.setup);
      rec.running.push(m.running);
    }
  }
  const jobs = Object.fromEntries([...perJob.keys()].sort().map((name) => {
    const r = perJob.get(name);
    return [name, { measured: r.measured, notMeasured: r.notMeasured, waiting: summary(r.waiting), setup: summary(r.setup), running: summary(r.running) }];
  }));

  const toRequired = [];
  for (const run of runs) {
    const start = ms(run.run_started_at);
    const done = ms(jobsOf(byRun, run).find((j) => j.name === REQUIRED_JOB)?.completed_at);
    if (start !== undefined && done !== undefined && done >= start) toRequired.push(secs(done - start));
  }
  const req = summary(toRequired);
  const mergePath = { targetS: opts.target, ...req };

  const retried = runs.filter((r) => Number(r.run_attempt) > 1).map((r) => r.id);
  const reds = runs.filter((r) => r.status === 'completed' && !NOT_RED.includes(r.conclusion)).map((run) => {
    const step = firstFailed(jobsOf(byRun, run));
    const end = ms(run.updated_at);
    return {
      run: run.id,
      branch: run.head_branch ?? null,
      sha: run.head_sha ?? null,
      cause: causeOf(step),
      failedStep: step === undefined ? null : String(step.name ?? ''),
      minutesToNextPush: end === undefined ? null : minutesToNextPush(run, end, runs),
    };
  });

  const lines = [`ci audit: ${runs.length} runs, PR target ${opts.target} s`];
  const names = Object.keys(jobs);
  const w = Math.max(3, ...names.map((n) => n.length));
  const fmt = (s) => (s.p50 === null ? 'none' : `${s.p50}/${s.p95} s`);
  lines.push(`${'job'.padEnd(w)}  measured  not measured  waiting p50/p95  setup p50/p95  running p50/p95`);
  for (const name of names) {
    const j = jobs[name];
    lines.push(`${name.padEnd(w)}  ${String(j.measured).padEnd(8)}  ${String(j.notMeasured).padEnd(12)}  ${fmt(j.waiting).padEnd(16)}  ${fmt(j.setup).padEnd(14)}  ${fmt(j.running)}`);
  }
  lines.push(`required check, run start to ${REQUIRED_JOB} done: p50 ${req.p50 ?? 'none'} s, p95 ${req.p95 ?? 'none'} s over ${toRequired.length} runs`);
  lines.push(req.p50 === null ? 'merge path: no measured run' : `merge path against the ${opts.target} s PR target: p50 ${req.p50} s, ${req.p50 > opts.target ? 'over' : 'within'} it`);
  lines.push(`attempts above 1: ${retried.length ? retried.join(', ') : 'none'}`);
  lines.push(`red runs: ${reds.length}`);
  for (const r of reds) {
    const next = r.minutesToNextPush === null ? 'no later push' : `${r.minutesToNextPush} min to next push`;
    lines.push(`  run ${r.run}  ${r.cause}  ${r.failedStep ?? 'no failed step'}  ${next}`);
  }
  lines.push('setup patterns (a step whose name matches is setup time):');
  lines.push(`  ${SETUP_PATTERNS.map((p) => p.label).join(', ')}`);
  lines.push('cause patterns (the first failed step decides):');
  lines.push(...CAUSE_LINES);
  lines.push(`ci-audit-json: ${JSON.stringify({ runs: runs.length, jobs, toRequired: req, mergePath, retried, reds })}`);
  return `${lines.join('\n')}\n`;
}

function main(args) {
  let opts;
  try {
    opts = parseArgs(args);
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    return 2;
  }
  try {
    process.stdout.write(audit(opts));
    return 0;
  } catch (e) {
    const cause = e instanceof Unreadable ? e.message : `unexpected error: ${e.message}`;
    process.stderr.write(`ci-audit: ${cause}\n`);
    return 2;
  }
}

process.exitCode = main(process.argv.slice(2));
