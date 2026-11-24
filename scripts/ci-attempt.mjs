// K380 (1.51.4): a CI run started again never counts as green. Run by kit-tests with the first attempt's jobs JSON:
//   node scripts/ci-attempt.mjs <jobs.json>, with GITHUB_RUN_ATTEMPT set by GitHub.
// Attempt 1 passes silently. Attempt 2 passes only when every failed job of the first attempt failed no step (a lost
// runner or a setup error), and then only once, logged. A failed step never counts green; attempt 3 or more always fails.
import fs from 'node:fs';

const file = process.argv[2] ?? '';
const attempt = String(process.env.GITHUB_RUN_ATTEMPT ?? '').trim();

function refuse(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

if (!/^[0-9]+$/.test(attempt)) {
  refuse(`GITHUB_RUN_ATTEMPT "${attempt}" is not a whole number: the run does not count as green`);
} else if (Number(attempt) === 1) {
  // The first attempt: nothing to judge here, and nothing printed.
} else if (Number(attempt) >= 3) {
  refuse(`attempt ${Number(attempt)}: a run started again more than once is not green; fix it by a new push`);
} else {
  judgeSecondAttempt();
}

function judgeSecondAttempt() {
  let jobs;
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!doc || !Array.isArray(doc.jobs)) throw new Error('no jobs list');
    jobs = doc.jobs;
  } catch (error) {
    refuse(`cannot read the first attempt's jobs from ${file}: ${error.message}`);
    return;
  }
  // The rollup jobs fail with a failed step whenever a job they need fails: that is a report of the other fault, not one.
  const ROLLUPS = ['kit-tests', 'test-check (all)'];
  const failed = jobs.filter((job) => job && !ROLLUPS.includes(job.name) && job.conclusion !== 'success' && job.conclusion !== 'skipped');
  if (failed.length === 0) {
    refuse('attempt 2: the first attempt has no failed job to retry; the run is not green');
    return;
  }
  // A job that failed a step, or ended in any state but failure (cancelled, timed out), is never retried.
  const named = failed.filter((job) => job.conclusion !== 'failure' || (job.steps ?? []).some((s) => s.conclusion === 'failure'));
  if (named.length > 0) {
    for (const job of named) refuse(`attempt 2: the first attempt's job "${job.name}" failed a step: fix it by a new push`);
    return;
  }
  const lost = failed.map((job) => job.name).join(', ');
  process.stdout.write(`retry logged: attempt 2 after a lost runner in the first attempt (${lost}); no failed step\n`);
}
