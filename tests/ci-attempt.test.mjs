// K380 (1.51.4): a CI run started again never counts as green. scripts/ci-attempt.mjs reads GITHUB_RUN_ATTEMPT and the
// run's jobs JSON, given by path; the tests run it as a child process with no network.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import kitTemp from '../project/.claude/kit-temp.cjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'ci-attempt.mjs');

kitTemp.sessionRoot();

// A missing script reads as status 127 with its own message, so each test fails on an assertion, not a crash.
function run(attempt, jobsPath) {
  if (!fs.existsSync(SCRIPT)) return { status: 127, stdout: '', stderr: 'scripts/ci-attempt.mjs is missing', out: 'scripts/ci-attempt.mjs is missing' };
  const r = spawnSync(process.execPath, [SCRIPT, jobsPath], { encoding: 'utf8', env: { ...process.env, GITHUB_RUN_ATTEMPT: attempt } });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, out: `${r.stdout}${r.stderr}` };
}

// A jobs JSON file in the shape the workflow fetches: {jobs: [{name, conclusion, steps: [{name, conclusion}]}]}.
function fixture(jobs) {
  const dir = kitTemp.makeTemp('ci-attempt-');
  const file = path.join(dir, 'jobs.json');
  fs.writeFileSync(file, JSON.stringify({ jobs }));
  return file;
}

const FAILED_STEP = [
  { name: 'unit-tests', conclusion: 'failure', steps: [{ name: 'Every test', conclusion: 'failure' }] },
  { name: 'lanes', conclusion: 'success', steps: [] },
];

// why: catches a first attempt (GITHUB_RUN_ATTEMPT=1) exits 0 and prints nothing (K380 S1)
test('a first attempt (GITHUB_RUN_ATTEMPT=1) exits 0 and prints nothing', () => {
  const r = run('1', fixture(FAILED_STEP));
  assert.equal(r.status, 0, r.out);
  assert.equal(r.out, '');
});

// why: catches GITHUB_RUN_ATTEMPT=2 exits 1 and prints the first attempt's failed job from the jobs JSON it is given (K380 S2)
test('GITHUB_RUN_ATTEMPT=2 exits 1 and prints the first attempt\'s failed job from the jobs JSON it is given', () => {
  const r = run('2', fixture(FAILED_STEP));
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /unit-tests/);
  assert.doesNotMatch(r.out, /lanes/, 'a job that passed is printed as failed');
});

// why: catches the kit-tests step runs the base commit's copy on a PR, and its own on main (K380 S3)
test('the kit-tests step runs the base commit\'s copy on a PR, and its own on main', () => {
  const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  const kit = ci.split(/^  kit-tests:$/m)[1].split(/^  [a-z-]+:$/m)[0];
  assert.ok(kit.includes('actions: read'), 'kit-tests has no actions: read token');
  const at = kit.indexOf('ci-attempt.mjs');
  assert.notEqual(at, -1, 'kit-tests never runs scripts/ci-attempt.mjs');
  const start = kit.lastIndexOf('\n      - ', at);
  const next = kit.indexOf('\n      - ', at);
  const step = kit.slice(start, next === -1 ? undefined : next);
  assert.ok(step.includes('!cancelled()'), 'the ci-attempt step does not run after a failed step');
  // The PR branch: one line under pull_request names the base copy, and the node line runs the variable it sets (or the
  // base path itself). A test -f check that names the path alone does not count.
  const lines = step.split('\n');
  const branch = lines.find((l) => l.includes('pull_request') && l.includes('$RUNNER_TEMP/base/scripts/ci-attempt.mjs'));
  assert.ok(branch, 'no pull_request branch runs the base commit\'s copy');
  const v = (branch.match(/(\w+)="\$RUNNER_TEMP\/base\/scripts\/ci-attempt\.mjs"/) || [])[1];
  const nodeLine = lines.filter((l) => /^\s*node\s/.test(l)).pop() ?? '';
  const runsBase = v ? nodeLine.includes(`"$${v}"`) : nodeLine.includes('$RUNNER_TEMP/base/scripts/ci-attempt.mjs');
  assert.ok(runsBase, `the node line does not run the base commit's copy on a PR: ${nodeLine}`);
  // The base copy's path also contains scripts/ci-attempt.mjs, so it is taken out before the own copy is looked for.
  const own = step.split('$RUNNER_TEMP/base/scripts/ci-attempt.mjs').join('');
  assert.match(own, /(?<!base\/)scripts\/ci-attempt\.mjs/, 'the ci-attempt step has no own copy for main');
  assert.ok(step.includes('pull_request'), 'the ci-attempt step does not tell a PR from main');
});

// why: catches bypass: an attempt number with spaces or a leading zero above 1 still fails (K380 S2)
test('bypass: an attempt number with spaces or a leading zero above 1 still fails', () => {
  const file = fixture(FAILED_STEP);
  for (const attempt of [' 2', '2 ', '02']) {
    const r = run(attempt, file);
    assert.equal(r.status, 1, `attempt "${attempt}": ${r.out}`);
  }
});

// why: catches repeat: the same attempt and JSON give the same answer (K380 S1)
test('repeat: the same attempt and JSON give the same answer', () => {
  const file = fixture(FAILED_STEP);
  const a = run('2', file);
  const b = run('2', file);
  assert.equal(a.status, 1, a.out);
  assert.equal(b.status, a.status);
  assert.equal(b.out, a.out);
});

// why: catches fail-closed: an unreadable jobs JSON on attempt 2 or more fails, logged (K380 S4)
test('fail-closed: an unreadable jobs JSON on attempt 2 or more fails, logged', () => {
  const dir = kitTemp.makeTemp('ci-attempt-');
  const garbage = path.join(dir, 'jobs.json');
  fs.writeFileSync(garbage, '{not json');
  for (const file of [garbage, path.join(dir, 'missing.json')]) {
    const r = run('2', file);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /jobs\.json|missing\.json/, 'the unreadable jobs JSON is not named in the log');
  }
});

// why: catches attempt 2 after a first-attempt job with no failed step exits 0 and logs the retry, and after a failed step still exits 1 (K380 CIFP)
test('attempt 2 after a first-attempt job with no failed step exits 0 and logs the retry, and after a failed step still exits 1', () => {
  const lostFile = fixture([{ name: 'unit-tests', conclusion: 'failure', steps: [] }]);
  const lost = run('2', lostFile);
  assert.equal(lost.status, 0, lost.out);
  assert.match(lost.out, /retry/i);
  // One logged retry only: a third attempt after the same lost runner is not green.
  const third = run('3', lostFile);
  assert.equal(third.status, 1, third.out);
  const failed = run('2', fixture(FAILED_STEP));
  assert.equal(failed.status, 1, failed.out);
  // A lost job first and a failed-step job second: the second is the one that still fails the run.
  const mixed = run('2', fixture([
    { name: 'unit-tests', conclusion: 'failure', steps: [] },
    { name: 'lanes', conclusion: 'failure', steps: [{ name: 'Set up', conclusion: 'failure' }] },
  ]));
  assert.equal(mixed.status, 1, mixed.out);
  assert.match(mixed.out, /lanes/);
  // The rollup jobs fail with a failed step whenever a job they need fails: that is not a second fault, so a lost
  // runner still gets its one retry.
  for (const rollup of ['kit-tests', 'test-check (all)']) {
    const r = run('2', fixture([
      { name: 'unit-tests', conclusion: 'failure', steps: [] },
      { name: rollup, conclusion: 'failure', steps: [{ name: 'Every test job passed', conclusion: 'failure' }] },
    ]));
    assert.equal(r.status, 0, `${rollup}: ${r.out}`);
    assert.match(r.out, /retry/i);
  }
});
