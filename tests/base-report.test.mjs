// K373 (1.51.4): CI prints every main-copy check fault in one run. The checks read .github/workflows/ci.yml as text
// (the kit has no YAML parser and no network): each job and each step is cut out by its indentation.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows', 'ci.yml');
const LINES = fs.readFileSync(CI, 'utf8').split(/\r?\n/);

// The lines of one job: from below its header to the next job's header, or the end of the file.
function jobBlock(name) {
  const start = LINES.indexOf(`  ${name}:`);
  assert.notEqual(start, -1, `ci.yml has no job ${name}`);
  let end = start + 1;
  while (end < LINES.length && !/^(  [A-Za-z0-9_-]+:\s*|\S.*)$/.test(LINES[end])) end++;
  return LINES.slice(start + 1, end);
}

// Every step of a job, with its name, id, if and text. Comment lines are not part of a step.
function steps(job) {
  const groups = [];
  let cur = null;
  for (const line of job) {
    if (/^      - /.test(line)) {
      cur = [];
      groups.push(cur);
    }
    if (cur) cur.push(line);
  }
  return groups.map((lines) => {
    const body = lines.filter((l) => !/^\s*#/.test(l));
    const field = (key) => {
      const re = new RegExp(`^(?: {6}- | {8})${key}:\\s*(.*)$`);
      for (const l of body) {
        const m = l.match(re);
        if (m) return m[1].replace(/^(['"])(.*)\1$/, '$2');
      }
      return null;
    };
    return { name: field('name'), id: field('id'), if: field('if'), text: body.join('\n') };
  });
}

// A step that reads a base copy names $RUNNER_TEMP/base or the PR's base through git show. The step that unpacks the
// base (git archive) only writes it, so it is not one of these.
const READS_BASE = /RUNNER_TEMP\/(base|main)|git show "\$PR_BASE:/;
const isBaseCopy = (s) => READS_BASE.test(s.text) && !/git archive/.test(s.text);
const CANCEL_GUARD = /!cancelled\(\)/;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');

// The content checks that move to the static job (K373 CIFP), by the text each one runs.
const CONTENT = {
  'branch and commit names': /name-check\.mjs/,
  'secret scan': /secret-shapes\.mjs/,
  'build record': /build-record\.mjs/,
  scrub: /"\$K" scrub/,
  'word check': /word-check\.mjs/,
  'project map': /project-map\.mjs/,
  'rule map': /rule-map\.mjs/,
  'link scan': /link-scan\.cjs/,
  'build is fresh': /"\$K" build/,
  'workflow lint': /actionlint/,
  'recall record': /recall-gate-base\.mjs gate/,
};

// why: catches every step that runs a base copy in unit-tests, test-check, windows-tests and kit-tests runs with if !cancelled(), so one fault does not hide the next (K373 S1)
test('every step that runs a base copy in unit-tests, test-check, windows-tests and kit-tests runs with if !cancelled(), so one fault does not hide the next', () => {
  // The Windows test-check step keeps its own condition beside the guard: a part-0 step on a PR.
  const KEPT = { 'Test check, Windows part': ["github.event_name == 'pull_request'", 'matrix.part == 0'] };
  const bare = [];
  for (const job of ['unit-tests', 'test-check', 'windows-tests', 'kit-tests']) {
    const base = steps(jobBlock(job)).filter(isBaseCopy);
    assert.ok(base.length > 0, `${job} has no base-copy step to judge`);
    for (const s of base) {
      if (!CANCEL_GUARD.test(s.if ?? '')) bare.push(`${job}: ${s.name}`);
      for (const frag of KEPT[s.name] ?? []) {
        if (!(s.if ?? '').includes(frag)) bare.push(`${job}: ${s.name} lost "${frag}"`);
      }
    }
  }
  assert.deepEqual(bare, [], 'base-copy steps without if: ${{ !cancelled() }}, or without their own condition');
});

// why: catches kit-tests ends with a Base-copy report step that always runs and names every failed base-copy step in one block (K373 S2)
test('kit-tests ends with a Base-copy report step that always runs and names every failed base-copy step in one block', () => {
  const kit = steps(jobBlock('kit-tests'));
  const last = kit[kit.length - 1];
  assert.equal(last.name, 'Base-copy report', 'the last kit-tests step is not Base-copy report');
  assert.match(last.if ?? '', /always\(\)/, 'Base-copy report does not run with always()');
  // The static job lists its failed base-copy steps in one output, which the report reads.
  assert.ok(jobBlock('static').some((l) => /^    outputs:/.test(l)), 'the static job writes no job output');
  const st = steps(jobBlock('static'));
  const staticLast = st[st.length - 1];
  assert.match(staticLast.if ?? '', /always\(\)/, 'the last static step does not run with always()');
  assert.ok(staticLast.text.includes('GITHUB_OUTPUT'), 'the last static step writes no output');
  assert.ok(last.text.includes('needs.static.outputs.'), 'Base-copy report does not read the static output');
  const staticIds = st.filter(isBaseCopy).map((s) => s.id);
  assert.ok(staticIds.length > 0 && staticIds.every(Boolean), `a static base-copy step has no id: ${staticIds}`);
  const staticUnread = staticIds.filter((id) => !new RegExp(`steps\\.${escapeRe(id)}\\.outcome\\s*==\\s*'failure'`).test(staticLast.text));
  assert.deepEqual(staticUnread, [], 'the static output does not compare these steps with failure');
  // kit-tests' own base-copy steps are read by the report through their outcome.
  const ids = kit.filter(isBaseCopy).map((s) => s.id);
  assert.ok(ids.length > 0 && ids.every(Boolean), `a base-copy step in kit-tests has no id: ${ids}`);
  const unread = ids.filter((id) => !new RegExp(`steps\\.${escapeRe(id)}\\.outcome\\s*==\\s*'failure'`).test(last.text));
  assert.deepEqual(unread, [], 'Base-copy report does not compare these outcomes with failure');
  assert.match(last.text, /no base-copy faults/, 'Base-copy report has no "no base-copy faults" line');
});

// why: catches the report names the lands-first path: one patch to main holding every fault in the block (K373 S3)
test('the report names the lands-first path: one patch to main holding every fault in the block', () => {
  const report = steps(jobBlock('kit-tests')).find((s) => s.name === 'Base-copy report');
  assert.ok(report, 'kit-tests has no Base-copy report step');
  const line = "Each fault above is judged by main's copy: plan one lands-first patch to main holding all of them, then rerun this PR.";
  assert.ok(report.text.includes(line), 'Base-copy report does not end with the lands-first line');
});

// why: catches the static job holds the content checks with no needs and every step if !cancelled(), and the required rollup needs it (K373 CIFP)
test('the static job holds the content checks with no needs and every step if !cancelled(), and the required rollup needs it', () => {
  const job = jobBlock('static');
  assert.ok(!job.some((l) => /^    needs:/.test(l)), 'the static job has needs');
  const st = steps(job);
  // The static job's last step is always(), so the report runs after a failure; every other step is !cancelled().
  const bare = st.filter((s) => !/!cancelled\(\)|always\(\)/.test(s.if ?? '')).map((s) => s.name ?? '(unnamed step)');
  assert.deepEqual(bare, [], 'static steps without if: !cancelled()');
  // Steps that kept their own condition in kit-tests keep it in static, beside the guard.
  const KEPT = {
    'Branch and commit names': "github.event_name == 'pull_request'",
    'Secret scan': "github.event_name == 'pull_request'",
    'Build record': "github.event_name == 'pull_request'",
    'Rule changes carry a passing recall score': "github.event_name == 'pull_request'",
  };
  const lost = Object.entries(KEPT).filter(([name, frag]) => {
    const s = st.find((x) => x.name === name);
    return !s || !(s.if ?? '').includes(frag);
  }).map(([name]) => name);
  assert.deepEqual(lost, [], 'static steps that lost their own condition, or are missing');
  const all = st.map((s) => s.text).join('\n');
  const missing = Object.keys(CONTENT).filter((k) => !CONTENT[k].test(all));
  assert.deepEqual(missing, [], 'the static job lacks these content checks');
  // None of the content checks is left in kit-tests (K373 CIFP: the move is whole).
  const kitText = steps(jobBlock('kit-tests')).map((s) => s.text).join('\n');
  const left = Object.keys(CONTENT).filter((k) => CONTENT[k].test(kitText));
  assert.deepEqual(left, [], 'kit-tests still runs these content checks');
  const needs = jobBlock('kit-tests').find((l) => /^    needs:/.test(l)) ?? '';
  assert.match(needs, /\bstatic\b/, 'the required rollup (kit-tests) does not need static');
  // The rollup's own gate reads the test-check legs too, so a failed leg fails it (the 1.51.4 triage, F1).
  const gate = steps(jobBlock('kit-tests')).find((s) => s.name === 'Every test job passed');
  assert.ok(
    (gate?.if ?? '').includes("needs.test-check.result != 'success' && needs.test-check.result != 'skipped'"),
    'the rollup gate does not read the test-check legs',
  );
  // F2 (the 1.51.4 triage, lead answer): map-merge counts its downloaded parts against the expected count and exits
  // non-zero, naming the missing part, before map-merge.mjs runs; the budget step names its own job by id.
  const join = steps(jobBlock('map-merge')).find((s) => s.name === 'Join the map parts')?.text ?? '';
  const call = join.indexOf('map-merge.mjs');
  assert.notEqual(call, -1, 'the map-merge step does not run map-merge.mjs');
  const pre = join.slice(0, call);
  assert.match(pre, /missing/, 'map-merge does not name a missing part before it joins');
  assert.match(pre, /exit [1-9]/, 'map-merge does not exit non-zero on a missing part');
  assert.match(pre, /-(ne|lt|eq|gt)\b|!=/, 'map-merge does not compare the found parts with the expected count');
  const budget = steps(jobBlock('kit-tests')).find((s) => s.name === "Time budget of the run's jobs")?.text ?? '';
  assert.ok(budget.includes('--self "${{ github.job }}"'), 'the time budget does not leave its own job out by id');
});
