// Tests for the recall run, its probes, the recall gate and recall-score: moved word for word from tests/kit.test.mjs (T10, build 18).

import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { install, foldBack, bump, scrub, snapshot, restore, status as kitStatus, mainProtection, sessionStartReport as kitSessionStart, preCompactReport, promptCheckReport, vaultBackup, projectSlug, newerReleases, lsRemoteCall, tagsOf, render, sourceHooks, measure, measureReal, headings, ledger, build, parseModule, findRules, guardDir, scratch as kitScratch } from '../scripts/kit.mjs';
import { GOOD_ENTRY, HEX6, RECALL, g, gateFacts, gateRepo, makeKit, makeTemp, probeParts, read, recallTools, recorder, released, ruleFiles, scratch, status, words } from './kit-helpers.mjs';

// K198 (1.48.0): the lines the fixed gate reads beside a gate line - two blind scorers, and no question worse than the
// same-day release - and a record that passes the gate command's floor of 14.
const K198_LINES = 'scorers: 2\nworse: none';
const PASS_GATE = `${K198_LINES}\ngate: a median 14 baseline 9 brief v1 keys v4 control 0`;

// why: guards rule:instruments-and-evals
test('recall v3 is v2 plus three questions, and v2 stays as it was released', async () => {
  const { versionText, currentVersion, questions, questionCount } = await recallTools();
  const text = read(path.resolve('docs/evals/recall-questions.md'));
  const released = spawnSync('git', ['show', 'v1.19.0:docs/evals/recall-questions.md'], { encoding: 'utf8' });
  assert.equal(released.status, 0, 'the v1.19.0 tag must exist locally');
  assert.equal(versionText(text, 2), versionText(released.stdout, 2));
  assert.match(versionText(text, 3), /Pass: median 12 of 13\./);
  assert.equal(questionCount(text, 3), 13);
  const [v2, v3] = [questions(text, 2), questions(text, 3)];
  assert.deepEqual(v3.slice(0, 10), v2);
  assert.deepEqual(v3.map((r) => r.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  assert.deepEqual(v3.slice(10), [
    { n: 11, q: 'The session is wrapping up. Which temp files may I delete, and where?', key: 'Only files this session made that have served, deleted only inside its own session folder, never by wildcard; anything else (a shared or uploaded copy, a file in the system temp) is listed for the owner, not deleted' },
    { n: 12, q: 'The re-sweep found a high finding I can\'t fix today. Can I carry it to the next run?', key: 'No; a high or critical finding is fixed before the PR or the owner accepts it; only medium or lower may carry to the next build' },
    { n: 13, q: 'My PR merged and its release is out. What happens next?', key: 'The closeout starts on its own, with no keyword needed' },
  ]);
});

// The owner's ruling (2026-11-05): key 3 says what rule 11 says, as a new keys version; v3 stays as released.
// why: guards rule:instruments-and-evals
test('recall v4 is v3 with key 3 aligned to rule 11, and v3 stays as it was released', async () => {
  const { versionText, currentVersion, questions, questionCount, passBar } = await recallTools();
  const text = read(path.resolve('docs/evals/recall-questions.md'));
  const released = spawnSync('git', ['show', 'v1.20.0:docs/evals/recall-questions.md'], { encoding: 'utf8' });
  assert.equal(released.status, 0, 'the v1.20.0 tag must exist locally');
  assert.equal(versionText(text, 3), versionText(released.stdout, 3));
  assert.equal(questionCount(text, 4), 13);
  assert.equal(passBar(text, 4), 12);
  const [v3, v4] = [questions(text, 3), questions(text, 4)];
  assert.deepEqual(v4.filter((r) => r.n !== 3), v3.filter((r) => r.n !== 3));
  assert.equal(v4[2].q, v3[2].q);
  assert.match(v4[2].key, /before any source-of-truth edit or agent dispatch/);
});

// The owner's ruling (2026-11-10, S22-4): v5 asks question 11 for the rule itself, and key 4 names the feature-branch
// push bound; every other row is v4's, the bar stays 12 of 13, and v4 stays as 1.24.0 released it.
// why: guards rule:instruments-and-evals
test('recall v5 is v4 with question 11 asking for the rule and key 4 naming the push bound, and v4 stays as released', async () => {
  const { versionText, currentVersion, questions, questionCount, passBar } = await recallTools();
  const text = read(path.resolve('docs/evals/recall-questions.md'));
  const released = spawnSync('git', ['show', 'v1.24.0:docs/evals/recall-questions.md'], { encoding: 'utf8' });
  assert.equal(released.status, 0, 'the v1.24.0 tag must exist locally');
  assert.equal(versionText(text, 4), versionText(released.stdout, 4));
  assert.equal(questionCount(text, 5), 13);
  assert.equal(passBar(text, 5), 12);
  const [v4, v5] = [questions(text, 4), questions(text, 5)];
  assert.deepEqual(v5.filter((r) => r.n !== 4 && r.n !== 11), v4.filter((r) => r.n !== 4 && r.n !== 11));
  assert.equal(v5[3].q, v4[3].q);
  assert.equal(v5[10].key, v4[10].key);
  assert.notEqual(v5[10].q, v4[10].q);
  assert.match(v5[10].q, /^Without looking in any folder/);
  assert.match(v5[3].key, /feature branch/);
});

// why: guards rule:instruments-and-evals
test('recall v6 is v5 with key 4 the decision only and question 14 on how a yes is asked, and v5 stays as released', async () => {
  const { versionText, currentVersion, questions, questionCount, passBar } = await recallTools();
  const text = read(path.resolve('docs/evals/recall-questions.md'));
  const released = spawnSync('git', ['show', 'v1.29.0:docs/evals/recall-questions.md'], { encoding: 'utf8' });
  assert.equal(released.status, 0, 'the v1.29.0 tag must exist locally');
  assert.equal(versionText(text, 5), versionText(released.stdout, 5));
  assert.equal(questionCount(text, 6), 14);
  assert.equal(passBar(text, 6), 13);
  const [v5, v6] = [questions(text, 5), questions(text, 6)];
  assert.deepEqual(v6.slice(0, 13).filter((r) => r.n !== 4), v5.filter((r) => r.n !== 4));
  assert.equal(v6[3].q, v5[3].q);
  assert.doesNotMatch(v6[3].key, /pop-up|name it/);
  assert.match(v6[3].key, /feature branch/);
  assert.match(v6[13].key, /choice pop-up/);
});

// why: guards rule:instruments-and-evals
test('recall v7 is v6 with key 12 following the no-carry rule, and v6 stays as written', async () => {
  const { currentVersion, questions, questionCount, passBar } = await recallTools();
  const text = read(path.resolve('docs/evals/recall-questions.md'));
  assert.equal(questionCount(text, 7), 14);
  assert.equal(passBar(text, 7), 13);
  const [v6, v7] = [questions(text, 6), questions(text, 7)];
  assert.deepEqual(v7.filter((r) => r.n !== 12 && r.n !== 14), v6.filter((r) => r.n !== 12 && r.n !== 14));
  assert.equal(v7[11].q, v6[11].q);
  assert.equal(v7[13].q, v6[13].q);
  assert.match(v7[13].key, /never typed words where a pop-up exists$/);
  assert.match(v7[11].key, /nothing carries without the owner's yes/);
  assert.match(v6[11].key, /only medium or lower may carry/);
});

// why: guards rule:post-compact-orientation
test('recall v8 and v9 move key 3 to the resume packet rule, and v7 stays as written', async () => {
  const { currentVersion, questions, questionCount, passBar } = await recallTools();
  const text = read(path.resolve('docs/evals/recall-questions.md'));
  assert.equal(questionCount(text, 8), 14);
  assert.equal(passBar(text, 8), 13);
  const [v7, v8] = [questions(text, 7), questions(text, 8)];
  assert.deepEqual(v8.filter((r) => r.n !== 3), v7.filter((r) => r.n !== 3));
  assert.equal(v8[2].q, v7[2].q);
  assert.match(v8[2].key, /^Run the resume packet check first/);
  assert.equal(passBar(text, 9), 13);
  const v9 = questions(text, 9);
  assert.deepEqual(v9.filter((r) => r.n !== 3), v8.filter((r) => r.n !== 3));
  assert.match(v9[2].key, /changed or missing \(no verdict line means the full reading\)/); // pin: 3 recall key v9, frozen
  // v10 (build 5): rule 11 names the Active Plan, and key 3 with it; every other row is v9's.
  assert.equal(passBar(text, 10), 13);
  const v10 = questions(text, 10);
  assert.deepEqual(v10.filter((r) => r.n !== 3), v9.filter((r) => r.n !== 3));
  assert.match(v10[2].key, /fresh reads of the Active Plan, of every file its resume point names/); // pin: 3 recall key v10, frozen
  // v11 (build 6, the owner's ruling 2026-11-15): key 4 frees opening the PR; every other row is v10's.
  assert.equal(passBar(text, 11), 13);
  const v11 = questions(text, 11);
  assert.deepEqual(v11.filter((r) => r.n !== 4), v10.filter((r) => r.n !== 4));
  assert.equal(v11[3].q, v10[3].q);
  assert.match(v11[3].key, /^Yes, with no yes needed: a plain push of the feature branch to origin, then opening its PR; never main, a tag, a force or a delete$/); // pin: 4 recall key v11, frozen
  // v12 (build 12, the owner's pop-up 2026-11-16, K98): key 4 says an answer noting nothing to push yet still scores.
  assert.equal(currentVersion(text), 12);
  assert.equal(passBar(text, 12), 13);
  const v12 = questions(text, 12);
  assert.deepEqual(v12.filter((r) => r.n !== 4), v11.filter((r) => r.n !== 4));
  assert.equal(v12[3].q, v11[3].q);
  assert.match(v12[3].key, /^Yes, with no yes needed: [^|]*never main, a tag, a force or a delete\. An answer that first says this folder has nothing to push yet still scores when it states that rule$/); // pin: 4 recall key v12, frozen
  assert.match(read(path.resolve('project/CLAUDE.md')), /^11\. [^\n]*resume-packet\.mjs check`, then a fresh Read of `_Active Plan\.md`[^\n]*before any source-of-truth edit or agent dispatch/m);
});

// why: guards rule:sweep-auto-approval
test('recall run header says what the run read: keys, both kit versions, and whether approve.mjs is there', async () => {
  const { installFacts, runHeader } = await recallTools();
  const { kit, home, proj } = makeKit();
  install({ kit, home, target: 'user', release: released(kit, 'v1.0.0') });
  install({ kit, home, target: 'project', projectDir: proj, release: { release: false, describe: 'abc1234' } });
  let facts = installFacts({ projectDir: proj, home });
  assert.deepEqual(facts, { project: '1.0.0 (unreleased abc1234)', user: '1.0.0 (v1.0.0)', userRelease: true, approve: false });
  fs.mkdirSync(path.join(home, 'skills/pre-pr-sweep'), { recursive: true });
  fs.writeFileSync(path.join(home, 'skills/pre-pr-sweep/approve.mjs'), '');
  facts = installFacts({ projectDir: proj, home });
  assert.equal(facts.approve, true);
  const head = runHeader({ label: 'cand-1', projectDir: proj, keys: 2, facts, when: '2026-11-04T00:00:00.000Z' }).join('\n');
  assert.match(head, /^# Recall run: cand-1$/m);
  assert.match(head, /^Keys: v2$/m);
  assert.match(head, /^Project kit: 1\.0\.0 \(unreleased abc1234\)$/m);
  assert.match(head, /^User kit: 1\.0\.0 \(v1\.0\.0\)$/m);
  assert.match(head, /^approve\.mjs at the user path: yes$/m);
  assert.match(runHeader({ label: 'x', projectDir: proj, keys: 2, facts: { ...facts, approve: false }, when: 'w' }).join('\n'), /^approve\.mjs at the user path: no$/m);
  install({ kit, home, target: 'project', projectDir: proj, release: released(kit, 'v1.0.0') });
  assert.equal(installFacts({ projectDir: proj, home }).project, '1.0.0');
  install({ kit, home, target: 'user', release: { release: false, describe: 'abc1234' } });
  assert.equal(installFacts({ projectDir: proj, home }).user, '1.0.0 (unreleased abc1234)');
  // A control has no kit in its project, and that is a fact to record, not a fault.
  const bare = makeTemp('control-');
  assert.equal(installFacts({ projectDir: bare, home }).project, 'none');
});

// why: guards rule:instruments-and-evals
test('a recall run asks the current keys and its header names them', async () => {
  const { prepare, currentVersion, questions, questionCount, passBar } = await recallTools();
  const { kit, home, proj } = makeKit();
  install({ kit, home, target: 'user', release: released(kit, 'v1.0.0') });
  const text = read(path.resolve('docs/evals/recall-questions.md'));
  const keys = currentVersion(text);
  const run = prepare({ projectDir: proj, label: 'cand-1', home, text, when: 'w' });
  assert.deepEqual(run.qs, questions(text, keys));
  assert.ok(run.lines.includes(`Keys: v${keys}`));
  assert.ok(run.lines.includes('# Recall run: cand-1'));
  const refused = (bad, why) => assert.throws(() => prepare({ projectDir: proj, label: 'x', home, text: bad, when: 'w' }), why);
  const rows = /^\| \d+ \|.*\n/gm;
  const n = questionCount(text, keys);
  const pass = `Pass: median ${passBar(text, keys)} of ${n}.`;
  const last = new RegExp(`^\\| ${n} \\|.*\\n`, 'm');
  refused(text.replace(new RegExp(last.source, 'gm'), ''), new RegExp(`expected ${n} questions, found ${n - 1}`));
  refused(text.replace(last, (row) => `${row}| ${n + 1} | One more? | A key |\n`), new RegExp(`expected ${n} questions, found ${n + 1}`));
  refused(text.replace(rows, ''), new RegExp(`expected ${n} questions, found 0`));
  refused(text.replace(rows, '').replace(pass, 'Pass: median 0 of 0.'), /expected 0 questions, found 0/);
  refused(text.replace(last, (row) => row.replace(`| ${n} |`, `| ${n - 1} |`)), new RegExp(`numbered 1 to ${n}`));
  refused(text.replace(pass, ''), /no "Pass: median <n> of <m>\." line/);
});

// why: guards rule:probe-scope
test('an unreleased user layer may run only from a throwaway folder under kit-probes', { windows: 'also' }, async () => {
  const { checkUserLayer } = await recallTools();
  const { kit } = makeKit();
  const osHome = makeTemp('oshome-');
  const layer = (home, release) => { fs.mkdirSync(home, { recursive: true }); install({ kit, home, target: 'user', release }); return home; };
  const unreleased = { release: false, describe: 'abc1234' };
  const refused = (home) => assert.throws(() => checkUserLayer(home, osHome), /not a released kit install/, home);
  checkUserLayer(layer(path.join(osHome, 'kit-probes', 'cfg-a'), unreleased), osHome);
  checkUserLayer(layer(path.join(osHome, '.claude'), released(kit, 'v1.0.0')), osHome);
  refused(layer(path.join(osHome, '.claude'), unreleased));
  refused(layer(path.join(osHome, 'kit-probes'), unreleased));
  refused(layer(path.join(osHome, 'kit-probes-x', 'cfg'), unreleased));
  refused(path.join(osHome, 'kit-probes', 'empty'));
  // A link inside kit-probes is read as where it leads.
  const link = path.join(osHome, 'kit-probes', 'cfg-link');
  fs.symlinkSync(path.join(osHome, '.claude'), link, 'junction');
  refused(link);
  // The default folder is held the same way when no home is passed.
  assert.throws(() => checkUserLayer(layer(makeTemp('plain-'), unreleased)), /not a released kit install/);
});

// why: guards rule:instruments-and-evals
test('recall refuses to run unless the Claude folder is a released kit install, before any session starts', () => {
  const { kit, home } = makeKit();
  const run = () => spawnSync(process.execPath, [RECALL, 'never-saved'], { encoding: 'utf8', env: { ...process.env, KIT_CLAUDE_HOME: home, PATH: '' } });
  const noStamp = run();
  assert.equal(noStamp.status, 1);
  assert.match(noStamp.stderr, /not a released kit install/);
  install({ kit, home, target: 'user', release: { release: false, describe: 'abc1234' } });
  const unreleased = run();
  assert.equal(unreleased.status, 1);
  assert.match(unreleased.stderr, /not a released kit install/);
  assert.equal(fs.existsSync(path.resolve('reports/evals/never-saved.md')), false);
  // The folder is found the way kit.mjs finds it.
  const viaConfig = spawnSync(process.execPath, [RECALL, 'never-saved'], { encoding: 'utf8', env: { ...process.env, KIT_CLAUDE_HOME: '', CLAUDE_CONFIG_DIR: home, PATH: '' } });
  assert.match(viaConfig.stderr, /is not a released kit install/);
  assert.ok(viaConfig.stderr.includes(home), viaConfig.stderr);
});

// why: guards rule:instruments-and-evals
test('a recall label is one plain word, so dots and flags cannot pass as one', async () => {
  const { parseRunArgs } = await recallTools();
  for (const label of ['.', '..', '--no-kit', '-x']) assert.throws(() => parseRunArgs([label]), /usage/, label);
});

// why: guards rule:ci-gate
test('recall gate passes a median at or above the baseline', async () => {
  const { checkGate } = await recallTools();
  assert.equal(checkGate(gateFacts()).ok, true);
  assert.equal(checkGate(gateFacts({ added: ['gate: a median 9 baseline 8 brief v1 keys v2'] })).ok, true);
  assert.equal(checkGate(gateFacts({ added: ['gate: a median 10 baseline 9 brief v1 keys v2'] })).ok, true);
});

// why: guards rule:ci-gate
test('recall gate fails a median under the baseline', async () => {
  const { checkGate } = await recallTools();
  const r = checkGate(gateFacts({ added: ['gate: a median 7 baseline 8 brief v1 keys v2'] }));
  assert.equal(r.ok, false);
  assert.match(r.detail, /median 7 is under the baseline 8/);
});

// why: guards rule:ci-gate
test('recall gate fails a median under the keys\' pass bar, and the owner\'s marker does not pass it', async () => {
  const { checkGate, passBar } = await recallTools();
  const text = read(path.resolve('docs/evals/recall-questions.md'));
  assert.equal(passBar(text, 3), 12);
  const line = (median, tail = '') => ({ bar: 12, added: [`gate: a median ${median} baseline 6 brief v1 keys v2${tail}`] });
  const weak = checkGate(gateFacts(line(11)));
  assert.equal(weak.ok, false);
  assert.match(weak.detail, /median 11 is under the pass bar of 12/);
  assert.equal(checkGate(gateFacts(line(12))).ok, true);
  const accepted = checkGate(gateFacts(line(11, ' owner-accepted')));
  assert.equal(accepted.ok, false);
  assert.match(accepted.detail, /override is gone/);
  // K198: the marker passes nothing, a moved ruler at the bar included.
  const moved = { was: { keys: 1 } };
  assert.equal(checkGate(gateFacts({ ...moved, ...line(11, ' owner-accepted') })).ok, false);
  assert.equal(checkGate(gateFacts({ ...moved, ...line(12, ' owner-accepted') })).ok, false);
});

// why: guards rule:instruments-and-evals
test('frozen keys with no Pass line have no bar', async () => {
  const { passBar } = await recallTools();
  const text = read(path.resolve('docs/evals/recall-questions.md'));
  assert.equal(passBar(text, 1), null);
  assert.equal(passBar(text, 2), null);
});

// why: guards rule:outward-acts
test('the gate holds a PR to the bar of its own keys, not the base\'s', () => {
  const dir = makeTemp('gatebar-');
  const git = (...a) => assert.equal(spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).status, 0, a.join(' '));
  const put = (rel, body) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); };
  const KEYS = 'docs/evals/recall-questions.md';
  const SCORES = 'docs/evals/results/recall-scores.md';
  const version = (n, median) => '<!-- recall v' + n + ' -->\nPass: median ' + median + ' of 13.\n\n';
  git('init', '-q', '-b', 'main');
  put('scripts/recall.mjs', read(RECALL));
  put('docs/evals/recall-scorer-brief.md', 'Current version: v1\n');
  put(KEYS, 'Current version: v3\n\n' + version(3, 5));
  put(SCORES, '# Scores\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  git('tag', 'base');
  put(KEYS, 'Current version: v4\n\n' + version(4, 9) + version(3, 5));
  const gate = (median) => {
    put(SCORES, `# Scores\n\n${K198_LINES}\ngate: a median ${median} baseline 1 brief v1 keys v4 control 0\n`);
    git('add', '.');
    git('commit', '-qm', 'median ' + median);
    return spawnSync('node', [path.join(dir, 'scripts/recall.mjs'), 'gate', 'base', 'HEAD'], { encoding: 'utf8', cwd: dir });
  };
  const between = gate(7);
  assert.equal(between.status, 1, between.stdout + between.stderr);
  assert.match(between.stdout, /pass bar of 9/);
  // Over the head's bar, the PR still moved its ruler, and since K198 no marker passes that.
  const atBar = gate(14);
  assert.equal(atBar.status, 1, atBar.stdout + atBar.stderr);
  assert.doesNotMatch(atBar.stdout, /pass bar/);
  assert.match(atBar.stdout, /changes the ruler/);
});

// why: guards rule:instruments-and-evals
test('recall gate fails rule text with no gate line, or a line it cannot read', async () => {
  const { checkGate } = await recallTools();
  assert.match(checkGate(gateFacts({ added: ['- a note, no gate line'] })).detail, /gate: <label> median <n>/);
  assert.match(checkGate(gateFacts({ changed: ['project/CLAUDE.md'], added: [] })).detail, /gate: <label> median <n>/);
  const bad = checkGate(gateFacts({ added: ['gate: a median nine baseline 8 brief v1 keys v2'] }));
  assert.equal(bad.ok, false);
  assert.match(bad.detail, /cannot read/);
  assert.equal(checkGate(gateFacts({ added: [GOOD_ENTRY + ' and more'] })).ok, false);
});

// why: guards rule:ci-gate
// K198 (Max's fixed gate, 2026-11-20): there is no owner override; a miss is fixed, never accepted.
test('an owner-accepted marker passes nothing: a miss is fixed, not accepted (K198)', async () => {
  const { checkGate } = await recallTools();
  const r = checkGate(gateFacts({ added: ['gate: a median 7 baseline 8 brief v1 keys v2 owner-accepted'] }));
  assert.equal(r.ok, false);
  assert.match(r.detail, /owner-accept override is gone/);
  assert.equal(checkGate(gateFacts({ added: ['gate: a median 9 baseline 8 brief v1 keys v2 owner-accepted'] })).ok, false, 'not even on a passing line');
  assert.equal(checkGate(gateFacts({ added: [GOOD_ENTRY, 'behaviour: a median 9 baseline 8 suite v2 control 0 owner-accepted'] })).ok, false, 'nor on a behaviour line');
  // A recorded line that only shows removed and added back (a file with no final newline) is history, not the PR's own.
  const old = 'gate: kit-1.17.0 median 8 baseline 8 brief v1 keys v2 owner-accepted';
  assert.equal(checkGate(gateFacts({ added: [old, GOOD_ENTRY], removed: [old] })).ok, true);
});

// why: guards rule:instruments-and-evals
test('recall gate refuses a score taken on an old brief or old keys', async () => {
  const { checkGate } = await recallTools();
  assert.match(checkGate(gateFacts({ added: ['gate: a median 9 baseline 8 brief v1 keys v1'] })).detail, /keys v2/);
  assert.match(checkGate(gateFacts({ brief: 2 })).detail, /brief v2/);
});

// why: guards rule:instruments-and-evals
test('recall gate reads the last gate line added, so a failed run can be followed by a passing one', async () => {
  const { checkGate } = await recallTools();
  const failedFirst = ['gate: a median 7 baseline 8 brief v1 keys v2', GOOD_ENTRY];
  assert.equal(checkGate(gateFacts({ added: failedFirst })).ok, true);
  assert.equal(checkGate(gateFacts({ added: [...failedFirst].reverse() })).ok, false);
});

// The owner's pick, 2026-11-21: the same-day release score is no longer held against the last one recorded (that check
// had no way out once K198 took the marker away); the floor of 14 is what stops a typed-low line.
// renamed from: a typed baseline cannot fall under the last one recorded on the same ruler
// why: guards rule:ci-gate
test('a typed-low gate line fails on the floor, not on the last recorded baseline', async () => {
  const { checkGate } = await recallTools();
  const low = { added: ['scorers: 2', 'worse: none', 'gate: a median 0 baseline 0 brief v1 keys v2'], was: { brief: 1, keys: 2 }, floor: 14 };
  const r = checkGate(gateFacts(low));
  assert.equal(r.ok, false);
  assert.match(r.detail, /median 0 is under the floor of 14/);
  assert.doesNotMatch(r.detail, /last recorded baseline/);
  assert.equal(checkGate(gateFacts({ ...low, added: ['scorers: 2', 'worse: none', 'gate: a median 0 baseline 0 brief v1 keys v2 owner-accepted'] })).ok, false);
  assert.equal(checkGate(gateFacts({ ...low, added: ['scorers: 2', 'worse: none', 'gate: a median 14 baseline 9 brief v1 keys v2'] })).ok, true);
});

// why: guards rule:ci-gate
test('a PR that moves the ruler it is graded on fails, and no marker passes it (K198)', async () => {
  const { checkGate } = await recallTools();
  const moved = { was: { brief: 1, keys: 1, baseline: 9 } };
  const r = checkGate(gateFacts(moved));
  assert.equal(r.ok, false);
  assert.match(r.detail, /changes the ruler/);
  assert.doesNotMatch(r.detail, /owner/);
  assert.equal(checkGate(gateFacts({ ...moved, added: [GOOD_ENTRY + ' owner-accepted'] })).ok, false);
  assert.equal(checkGate(gateFacts({ was: { brief: 0, keys: 2, baseline: null } })).ok, false);
  const edited = checkGate(gateFacts({ was: { brief: 1, keys: 2, baseline: null, edited: true } }));
  assert.equal(edited.ok, false);
  assert.match(edited.detail, /changes the ruler/);
  // The first ruler has no version to move from.
  assert.equal(checkGate(gateFacts({ was: { brief: null, keys: null, baseline: null } })).ok, true);
});

// why: guards rule:ci-gate
test('recall gate leaves a PR alone only when it touches no rule text, no ruler and no gate line', async () => {
  const { checkGate } = await recallTools();
  assert.equal(checkGate(gateFacts({ changed: ['scripts/test-run.mjs'], added: [] })).ok, true);
  assert.equal(checkGate(gateFacts({ changed: ['docs/rules/x.md'], added: [] })).ok, true);
  // I19 (1.42.0): what renders or ships text a session reads is graded too; the project layer's guard code is not.
  for (const f of ['scripts/kit.mjs', 'project/AGENTS.md', 'project/standards/testing.md', 'memory/style.md', 'scripts/recall-behave.mjs', 'docs/evals/behaviour-scenarios.json']) assert.equal(checkGate(gateFacts({ changed: [f], added: [] })).ok, false, f);
  assert.equal(checkGate(gateFacts({ changed: ['project/.claude/guard.cjs'], added: [] })).ok, true);
  for (const ruler of ['docs/evals/recall-questions.md', 'docs/evals/recall-scorer-brief.md']) {
    assert.equal(checkGate(gateFacts({ changed: [ruler], added: [] })).ok, false, ruler);
  }
  assert.equal(checkGate(gateFacts({ changed: ['scripts/recall.mjs'], added: [] })).ok, false);
  const removed = checkGate(gateFacts({ changed: ['docs/evals/results/recall-scores.md'], added: [], removed: [GOOD_ENTRY] }));
  assert.equal(removed.ok, false);
  assert.match(removed.detail, /removes a recorded gate line/);
  assert.doesNotMatch(removed.detail, /owner/);
  assert.equal(checkGate(gateFacts({ changed: ['docs/evals/results/recall-scores.md'], added: [GOOD_ENTRY + ' owner-accepted'], removed: [GOOD_ENTRY] })).ok, false);
  assert.equal(checkGate(gateFacts({ changed: ['docs/evals/results/recall-scores.md'], added: [GOOD_ENTRY], removed: [GOOD_ENTRY] })).ok, false);
  // The 1.24.0 build (the owner's pick B): a file with no newline at its end shows its last line removed and added
  // back unchanged when an entry is appended. That line is still recorded, so beside the PR's own new line it is no
  // drop; the re-added copy is never the PR's own line, and a changed copy is still a drop.
  const next = 'gate: kit-1.19.0 median 9 baseline 8 brief v1 keys v2';
  const kept = checkGate(gateFacts({ added: [GOOD_ENTRY, next], removed: [GOOD_ENTRY] }));
  assert.equal(kept.ok, true, kept.detail);
  assert.match(kept.detail, /^kit-1\.19\.0: median 9/);
  assert.equal(checkGate(gateFacts({ added: [GOOD_ENTRY.replace('median 8', 'median 9'), next], removed: [GOOD_ENTRY] })).ok, false, 'a changed line is a drop');
  const typed = checkGate(gateFacts({ changed: ['docs/evals/results/recall-scores.md'], added: ['scorers: 2', 'worse: none', 'gate: o median 1 baseline 1 brief v1 keys v2'], was: { brief: 1, keys: 2 }, floor: 14 }));
  assert.equal(typed.ok, false);
  assert.match(typed.detail, /under the floor of 14/);
});

// S22-1, E31: the suite runs on Linux and the Windows-only tests on Windows; the required check (kit-tests) passes
// only when both passed. A needed job that fails makes a plain dependent job SKIPPED, and GitHub counts a skipped
// required check as passed. pin: 1 (GitHub reads these lines).
// why: guards rule:word-pins
test('CI runs the suite on Linux and the Windows slice on Windows, and the required check fails unless both passed', () => {
  const ci = read(path.resolve('.github/workflows/ci.yml'));
  const job = (name) => ci.split(new RegExp(`^  ${name}:$`, 'm'))[1].split(/^  [a-z-]+:$/m)[0];
  const unit = job('unit-tests');
  assert.match(unit, /^    runs-on: ubuntu-latest$/m);
  assert.match(unit, /^\s+run: node scripts\/test-run\.mjs --shards \d+$/m);
  const win = job('windows-tests');
  assert.match(win, /^    runs-on: windows-latest$/m);
  assert.match(win, /KIT_WINDOWS_SLICE: '1'[\s\S]*run: node scripts\/test-run\.mjs --shards \d+/);
  // The guards guard a Windows machine, so their proofs run there.
  for (const proof of ['guard-outward-check.cjs', 'guard-delete-check.cjs']) assert.ok(win.includes(`node project/.claude/${proof}`), proof);
  const gate = job('kit-tests');
  // E32: the lanes job and the slow lane join the gate; a slow lane skipped for having no test passes.
  assert.match(gate, /^    needs: \[unit-tests, windows-tests, lanes, slow-tests, install-check\]$/m);
  // T15 D1/D2: the install check, skipped only when the lanes job found no install or guard change.
  assert.ok(gate.includes("if: (needs.install-check.result != 'success' && needs.install-check.result != 'skipped') || (needs.install-check.result == 'skipped' && needs.lanes.outputs.install != 'false')")); // pin: 1
  assert.match(job('install-check'), /^    if: needs\.lanes\.outputs\.install == 'true'$[\s\S]*os: \[ubuntu-latest, windows-latest\][\s\S]*run: \|[\s\S]*node scripts\/ci-install-check\.mjs$/m);
  assert.match(gate, /^    if: always\(\)$/m);
  const failed = "if: needs.unit-tests.result != 'success' || needs.windows-tests.result != 'success' || needs.lanes.result != 'success' || (needs.slow-tests.result != 'success' && needs.slow-tests.result != 'skipped')";
  assert.ok(gate.includes(failed));
  assert.match(gate.split(failed)[1], /^\s+run: exit 1$/m);
  assert.doesNotMatch(ci, /continue-on-error/);
  assert.doesNotMatch(gate, /test-run\.mjs/, 'the tests run in their jobs, not again in the gate');
});

// why: guards the owner's pick (2026-11-12, "Only what it touches") and E32 rule 4: a PR narrows its run only to the
// reached tests plus the security set, falls back to every test on any other answer, and the map it selects by comes
// from main alone. pin: 1 (GitHub reads these lines)
test('a PR runs the reached tests and the security set, or every test; main saves the map; a body edit reruns only the audit', async () => {
  const ci = read(path.resolve('.github/workflows/ci.yml'));
  const step = (name) => ci.split(`- name: ${name}\n`)[1].split(/\n\s*\n|- name:|- uses:/)[0];
  assert.doesNotMatch(ci.split('\njobs:')[0], /edited/, 'a body edit reran the whole test run');
  // Any scope but "changed" (a missing output included) runs every test.
  assert.match(step('Every test'), /steps\.scope\.outputs\.scope != 'changed'/);
  assert.match(step('The tests the change reaches'), /steps\.scope\.outputs\.scope == 'changed'[\s\S]*--changed/);
  const { SECURITY_FILES } = await import(pathToFileURL(path.resolve('scripts/test-value.mjs')).href);
  // K105: the security set joins the changed run (--always), so a security test the change reaches runs once.
  const security = step('The tests the change reaches');
  for (const f of SECURITY_FILES) assert.ok(security.includes(`--always ${f}`), `${f} left out of the security set`);
  assert.doesNotMatch(ci, /- name: The security set\n/, 'the security set runs a second time');
  // The map is kept by main's push run only, and a PR takes it from main's own push run of its base commit, never from
  // the Actions cache, which a PR's earlier run can write (the security review of this build).
  const keep = ci.split('- name: Keep the coverage map\n')[1].split('- name:')[0];
  assert.match(keep, /if: github\.event_name != 'pull_request'[\s\S]*upload-artifact@[0-9a-f]{40}[\s\S]*name: test-map/);
  const load = ci.split('- name: Load the coverage map for the base commit\n')[1].split('- name:')[0];
  assert.match(load, /rm -f tests\/\.map\.json/);
  assert.match(load, /--branch main --event push --commit "\$BASE_SHA"/); // pin: 1
  assert.match(load, /\.headSha == \\"\$BASE_SHA\\" and \.event == \\"push\\" and \.headBranch == \\"main\\"/); // pin: 1
  assert.doesNotMatch(ci, /actions\/cache/, 'the Actions cache holds entries a PR wrote');
  const body = read(path.resolve('.github/workflows/pr-body.yml'));
  assert.match(body, /types: \[[^\]]*edited[^\]]*\]/);
  // The build 17 sweep: all three in the one audit step, so pieces from different steps cannot pass it.
  const audit = body.split('- name: PR body audit\n')[1].split(/\n\s+- (?:name|uses):/)[0];
  assert.ok(audit.includes('A=pr-body-audit.mjs') && audit.includes('node "$P" "$RUNNER_TEMP/pr-body.md"') && audit.includes('PR_BODY: ${{ github.event.pull_request.body }}'));
});

// why: guards rule:instruments-and-evals
test('CI runs the recall gate on the PR\'s real diff', async () => {
  const { passBar, currentVersion, FLOOR } = await recallTools();
  const keysText = read(path.resolve('docs/evals/recall-questions.md'));
  const bar = passBar(keysText, currentVersion(keysText));
  const step = read(path.resolve('.github/workflows/ci.yml')).split('- name: Rule changes carry a passing recall score')[1].split('- name:')[0];
  // The base branch's copy judges the PR (S18-3, R-S5).
  // pin: 1 (GitHub runs these lines)
  assert.match(step, /^\s+git show "\$PR_BASE:scripts\/recall\.mjs" > scripts\/recall-gate-base\.mjs$/m);
  assert.match(step, /^\s+node scripts\/recall-gate-base\.mjs gate "\$PR_BASE" "\$PR_HEAD"$/m);
  assert.match(step, /^\s+if: github\.event_name == 'pull_request'$/m);
  assert.match(step, /^\s+PR_BASE: origin\/\$\{\{ github\.base_ref \}\}$/m);
  // pin: 1 (GitHub reads this line)
  assert.match(step, /^\s+PR_HEAD: \$\{\{ github\.event\.pull_request\.head\.sha \}\}$/m);
  assert.doesNotMatch(step, /continue-on-error/);
  const dir = makeTemp('gate-');
  const git = (...a) => assert.equal(spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' }).status, 0, a.join(' '));
  const put = (rel, body) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); };
  const headSha = () => spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  git('init', '-q', '-b', 'main');
  put('rules/core.md', 'a\n');
  // The gate reads the ruler from the head commit, so the repo carries the kit's own.
  for (const rel of ['docs/evals/recall-questions.md', 'docs/evals/recall-scorer-brief.md']) put(rel, read(path.resolve(rel)));
  put('docs/evals/results/recall-scores.md', '# Scores\n\ngate: old median 1 baseline 9 brief v1 keys v1\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  git('tag', 'base');
  put('rules/core.md', 'b\n');
  git('commit', '-qam', 'rule only');
  const gate = () => spawnSync('node', [RECALL, 'gate', 'base', 'HEAD'], { encoding: 'utf8', cwd: dir });
  const noScore = gate();
  assert.equal(noScore.status, 1, noScore.stdout + noScore.stderr);
  const keys = read(path.resolve('docs/evals/recall-questions.md')).match(/^Current version: v(\d+)$/m)[1];
  const brief = read(path.resolve('docs/evals/recall-scorer-brief.md')).match(/^Current version: v(\d+)$/m)[1];
  put('docs/evals/results/recall-scores.md', `# Scores\n\ngate: old median 1 baseline 9 brief v1 keys v1\n\n## New\n\n${K198_LINES}\ngate: new median ${FLOOR} baseline 8 brief v${brief} keys v${keys} control 0\nscored: ${headSha()}\n`);
  git('commit', '-qam', 'scores');
  const scored = gate();
  assert.equal(scored.status, 0, scored.stdout + scored.stderr);
  git('tag', 'base2');
  put('rules/core.md', 'c\n');
  put('docs/evals/results/recall-scores.md', read(path.join(dir, 'docs/evals/results/recall-scores.md')) + `\ngate: low median ${bar} baseline 1 brief v${brief} keys v${keys} control 0\n`);
  git('commit', '-qam', 'typed down');
  const typed = spawnSync('node', [RECALL, 'gate', 'base2', 'HEAD'], { encoding: 'utf8', cwd: dir });
  assert.equal(typed.status, 1, typed.stdout + typed.stderr);
  assert.match(typed.stdout, /under the floor of 14/);
  // The last baseline on the ruler counts, not the first.
  const scores = 'docs/evals/results/recall-scores.md';
  const now = `brief v${brief} keys v${keys} control 0`;
  const round = (name, base, entry) => {
    git('checkout', '-q', '-b', name, 'base2');
    put(scores, `# Scores\n\n${base}\n`);
    git('commit', '-qam', 'base of ' + name);
    git('tag', name + '-base');
    put('rules/core.md', name + '\n');
    git('commit', '-qam', name);
    put(scores, `# Scores\n\n${base}\n${entry}\nscored: ${headSha()}\n`);
    git('commit', '-qam', 'scores of ' + name);
    return spawnSync('node', [RECALL, 'gate', name + '-base', 'HEAD'], { encoding: 'utf8', cwd: dir });
  };
  // The real command reads the bar from the current keys; a median under it fails, and no marker passes anything (K198).
  const floor = `gate: a median ${bar} baseline 6 ${now}`;
  const under = round('under-bar', floor, `gate: weak median ${bar - 1} baseline 6 ${now}`);
  assert.equal(under.status, 1, under.stdout);
  assert.match(under.stdout, /under the pass bar/);
  const marked = round('under-bar-marked', floor, `gate: weak median ${bar - 1} baseline 6 ${now} owner-accepted`);
  assert.equal(marked.status, 1, marked.stdout);
  assert.match(marked.stdout, /override is gone/);
  const atBar = round('at-bar', floor, `${K198_LINES}\ngate: fine median ${FLOOR} baseline 6 ${now}`);
  assert.equal(atBar.status, 0, atBar.stdout + atBar.stderr);
  // The base's ruler reaches the check: an older version, then the same version with its text edited.
  const onRuler = (name, body, rel = 'docs/evals/recall-questions.md') => {
    git('checkout', '-q', '-b', name, 'base2');
    put(rel, body);
    git('add', '.');
    git('commit', '-qm', 'ruler on the base of ' + name, '--allow-empty');
    git('tag', name + '-base');
    put(rel, read(path.resolve(rel)));
    put('rules/core.md', name + '\n');
    git('commit', '-qam', name);
    put(scores, read(path.join(dir, scores)) + `\n${K198_LINES}\ngate: ${name} median ${FLOOR} baseline 9 ${now}\nscored: ${headSha()}\n`);
    git('commit', '-qam', 'scores of ' + name);
    return spawnSync('node', [RECALL, 'gate', name + '-base', 'HEAD'], { encoding: 'utf8', cwd: dir });
  };
  const older = onRuler('older-ruler', 'Current version: v1\n');
  assert.equal(older.status, 1, older.stdout);
  assert.match(older.stdout, /changes the ruler/);
  const reworded = onRuler('reworded-ruler', `Current version: v${keys}\nsome other key\n`);
  assert.equal(reworded.status, 1, reworded.stdout);
  assert.match(reworded.stdout, /changes the ruler/);
  const BRIEF_FILE = 'docs/evals/recall-scorer-brief.md';
  const olderBrief = onRuler('older-brief', 'Current version: v0\n', BRIEF_FILE);
  assert.equal(olderBrief.status, 1, olderBrief.stdout);
  assert.match(olderBrief.stdout, /changes the ruler/);
  const rewordedBrief = onRuler('reworded-brief', `Current version: v${brief}\nlenient\n`, BRIEF_FILE);
  assert.equal(rewordedBrief.status, 1, rewordedBrief.stdout);
  assert.match(rewordedBrief.stdout, /changes the ruler/);
  const sameRuler = onRuler('same-ruler', read(path.resolve(BRIEF_FILE)), BRIEF_FILE);
  assert.equal(sameRuler.status, 0, sameRuler.stdout + sameRuler.stderr);
  // A removed gate line takes the floor away, and an attribute cannot hide the record.
  git('checkout', '-q', '-b', 'removed-line', 'base2');
  put(scores, '# Scores\n');
  git('commit', '-qam', 'remove');
  const gone = spawnSync('node', [RECALL, 'gate', 'base2', 'HEAD'], { encoding: 'utf8', cwd: dir });
  assert.equal(gone.status, 1, gone.stdout);
  assert.match(gone.stdout, /removes a recorded gate line/);
  git('checkout', '-q', '-b', 'hidden-line', 'base2');
  put('.gitattributes', 'docs/evals/results/recall-scores.md -diff\n');
  put(scores, read(path.join(dir, scores)) + `\ngate: low median ${bar} baseline 1 ${now}\n`);
  git('add', '.');
  git('commit', '-qm', 'hide');
  const hidden = spawnSync('node', [RECALL, 'gate', 'base2', 'HEAD'], { encoding: 'utf8', cwd: dir });
  assert.equal(hidden.status, 1, hidden.stdout);
  // A plain name reaches the check, and a line on main alone is not the PR's.
  git('checkout', '-q', '-b', 'accented', 'base2');
  put('rules/caf' + String.fromCharCode(233) + '.md', 'x\n');
  git('add', '.');
  git('commit', '-qm', 'new rule');
  const accented = spawnSync('node', [RECALL, 'gate', 'base2', 'HEAD'], { encoding: 'utf8', cwd: dir });
  assert.equal(accented.status, 1, accented.stdout);
  git('checkout', '-q', '-b', 'no-score', 'base2');
  put('rules/core.md', 'no score\n');
  git('commit', '-qam', 'rule, no score');
  git('checkout', '-q', '-b', 'main-dropped', 'base2');
  put(scores, '# Scores\n');
  git('commit', '-qam', 'main dropped a line');
  const borrowed = spawnSync('node', [RECALL, 'gate', 'main-dropped', 'no-score'], { encoding: 'utf8', cwd: dir });
  assert.equal(borrowed.status, 1, borrowed.stdout);
  assert.match(borrowed.stdout, /record a recall run/);
  // A rule change on main that the PR's branch has not picked up is not this PR's.
  git('checkout', '-q', '-b', 'behind', 'base2');
  put('notes.md', 'x\n');
  git('add', '.');
  git('commit', '-qm', 'pr');
  git('checkout', '-q', '-b', 'moved-main', 'base2');
  put('rules/core.md', 'main moved\n');
  git('commit', '-qam', 'main');
  const behind = spawnSync('node', [RECALL, 'gate', 'moved-main', 'behind'], { encoding: 'utf8', cwd: dir });
  assert.equal(behind.status, 0, behind.stdout + behind.stderr);
  // A rule file moved away is still rule text changed.
  git('checkout', '-q', '-b', 'renamed', 'base2');
  fs.mkdirSync(path.join(dir, 'docs/old'), { recursive: true });
  git('mv', 'rules/core.md', 'docs/old/core.md');
  git('commit', '-qm', 'move');
  const renamed = spawnSync('node', [RECALL, 'gate', 'base2', 'HEAD'], { encoding: 'utf8', cwd: dir });
  assert.equal(renamed.status, 1, renamed.stdout);
});

// why: guards rule:pr-body
test('the rules say where approve.mjs lives, what its absence means, and that the PR body carries the sweep summary', () => {
  for (const f of ['rules/agent-teams.md', 'rules/reviews-and-findings.md']) {
    const text = read(path.resolve(f));
    // K206 (build 22): a fixed ~/.claude path sent a session on another Claude folder to the wrong copy, so the rules name
    // the tool and the start-up line names this session's full command (the PowerShell spelling included).
    assert.match(text, /`approve\.mjs` \(its command.*"Kit tools this session"\)/, f);
    // pin: 2 (the lead's order when the tool is missing)
  assert.match(text, /not there, the kit's user layer is not installed: say so; the owner says yes/, f);
  }
  // The pipeline's PR step names the sweep summary and points to the push bound, not to an owner's stop (1.41.0).
  const pipeline = read(path.resolve('rules/reviews-and-findings.md')).split('\n').find((l) => l.startsWith('**Pipeline:**')) || '';
  assert.match(pipeline, /sweep summary[^\n]*rule:outward-acts/);
});

// why: guards rule:word-pins
test('the scorer brief is versioned and carries the two calls the proof found borderline', () => {
  const brief = read(path.resolve('docs/evals/recall-scorer-brief.md'));
  assert.match(brief, /^Current version: v2$/m);
  const released = spawnSync('git', ['show', 'v1.19.0:docs/evals/recall-scorer-brief.md'], { encoding: 'utf8' });
  assert.equal(released.status, 0, 'the v1.19.0 tag must exist locally');
  const v1 = released.stdout.slice(released.stdout.indexOf('## v1 '));
  assert.ok(brief.endsWith(v1), 'v1 stays as it was written');
  const v2 = brief.slice(0, brief.indexOf('## v1 '));
  assert.match(v2, /## v2 \(2026-11-05\)/);
  assert.ok(v2.includes('"You score saved answers to the kit\'s recall questions."')); // pin: 3 (the versioned scorer brief)
  assert.match(brief, /printed checklist counts as "a visible checklist" only when the answer says it is required/); // pin: 3
  assert.match(brief, /"adversarial" may be met by "security agents from distinct angles"/); // pin: 3
});

// why: guards rule:probe-scope
test('probePath is random per call and always home/kit-probes/<6 hex>/p<6 hex>', async () => {
  const { probePath } = await recallTools();
  const home = path.join(os.tmpdir(), 'some home');
  const seen = new Set();
  for (let i = 0; i < 25; i++) {
    const p = probePath(home);
    assert.equal(typeof p, 'string');
    const parts = probeParts(home, p);
    assert.equal(parts.length, 3, p);
    assert.equal(parts[0], 'kit-probes');
    assert.match(parts[1], new RegExp(`^${HEX6}$`));
    assert.match(parts[2], new RegExp(`^p${HEX6}$`));
    assert.ok(p.startsWith(home + path.sep), p);
    assert.equal(p, path.join(home, 'kit-probes', parts[1], parts[2]));
    seen.add(p);
  }
  assert.equal(seen.size, 25, 'every call must give a new path');
  assert.notEqual(probePath(home), probePath(home));
});

// why: guards rule:probe-scope
test('probePath cannot take a label, so no label can appear in the path', async () => {
  const { probePath } = await recallTools();
  assert.equal(probePath.length, 1);
  const home = path.join(os.tmpdir(), 'h');
  for (const label of ['kit-1.19.0', 'control', 'cand-zz', 'my_label', 'no-kit', 'recall.run-9', 'xyz']) {
    // A second argument, if someone smuggles one in, must be ignored.
    for (const p of [probePath(home), probePath(home, label)]) {
      const rel = path.relative(home, p);
      assert.ok(!rel.includes(label), `${label} found in ${rel}`);
      assert.match(rel.split(path.sep).slice(1).join('/'), new RegExp(`^${HEX6}/p${HEX6}$`));
    }
  }
});

// why: catches a break in scripts/recall.mjs; the only test that caught it when tagged, others catch it too since the build 14 audit
test('parseRunArgs accepts [label], [label, kitFolder] and [label, --no-kit] and returns exactly label, kitDir, noKit', async () => {
  const { parseRunArgs } = await recallTools();
  assert.deepEqual(parseRunArgs(['cand-1']), { label: 'cand-1', kitDir: null, noKit: false });
  assert.deepEqual(parseRunArgs(['kit-1.19.0']), { label: 'kit-1.19.0', kitDir: null, noKit: false });
  assert.deepEqual(parseRunArgs(['control_2', '--no-kit']), { label: 'control_2', kitDir: null, noKit: true });
  const kit = path.resolve(os.tmpdir(), 'some kit');
  const got = parseRunArgs(['cand-1', kit]);
  assert.deepEqual(Object.keys(got).sort(), ['kitDir', 'label', 'noKit']);
  assert.equal(got.label, 'cand-1');
  assert.equal(got.noKit, false);
  assert.equal(typeof got.kitDir, 'string');
  assert.equal(path.resolve(got.kitDir), kit);
});

// why: guards rule:outward-acts
test('parseRunArgs refuses no label, a label that is a path, too many arguments, and --no-kit with a kit folder', async () => {
  const { parseRunArgs } = await recallTools();
  assert.throws(() => parseRunArgs([]));
  assert.throws(() => parseRunArgs(['']));
  for (const bad of ['C:\\x\\y', 'C:/x/y', './proj', '.\\proj', 'a/b', 'a\\b', '/abs', 'with space', 'semi;colon', 'C:']) {
    assert.throws(() => parseRunArgs([bad]), undefined, `label ${bad} must be refused`);
    assert.throws(() => parseRunArgs([bad, '--no-kit']), undefined, `label ${bad} with --no-kit must be refused`);
  }
  assert.throws(() => parseRunArgs(['a', 'b', 'c']));
  assert.throws(() => parseRunArgs(['a', 'b', 'c', 'd']));
  assert.throws(() => parseRunArgs(['a', '--no-kit', path.resolve('kit')]));
  assert.throws(() => parseRunArgs(['a', path.resolve('kit'), '--no-kit']));
  assert.throws(() => parseRunArgs(['a', '--no-kit', '--no-kit']));
});

// why: guards rule:branching
test('setupProbe makes the folder, runs git init in it, then installs the kit project layer with cwd at the kit', async () => {
  const { setupProbe } = await recallTools();
  const dir = scratch();
  const kitDir = path.join(os.tmpdir(), 'a kit');
  const { calls, run } = recorder();
  setupProbe({ dir, kitDir, noKit: false, run, released: true });
  assert.equal(fs.existsSync(dir), true, 'the probe folder must exist');
  assert.equal(calls.length, 2);
  const [git, inst] = calls;
  assert.equal(git.cmd, 'git');
  assert.ok(git.args.includes('init'));
  assert.ok(git.opts.cwd === dir || git.args.includes(dir), 'git init must target the probe folder');
  assert.equal(git.dirExisted !== false, true, 'the folder must exist before git init runs');
  assert.match(path.basename(inst.cmd), /^node(\.exe)?$/);
  const script = path.resolve(kitDir, 'scripts', 'kit.mjs');
  assert.equal(path.resolve(inst.args[0]), script);
  assert.deepEqual(inst.args.slice(1, 4), ['install', 'project', dir]);
  assert.equal(path.resolve(inst.opts.cwd), path.resolve(kitDir));
  assert.equal(inst.args.includes('--unreleased'), false, 'a released kit must not get --unreleased');
});

// why: guards rule:probe-scope
test('setupProbe adds --unreleased exactly when the kit is not a release', async () => {
  const { setupProbe } = await recallTools();
  const kitDir = path.join(os.tmpdir(), 'k');
  const a = recorder();
  setupProbe({ dir: scratch(), kitDir, noKit: false, run: a.run, released: false });
  assert.equal(a.calls.length, 2);
  assert.equal(a.calls[1].args.filter((x) => x === '--unreleased').length, 1);
  assert.equal(a.calls[0].args.includes('--unreleased'), false, 'git init never gets the flag');
  assert.deepEqual(a.calls[1].args.slice(1, 3), ['install', 'project']);
  const b = recorder();
  setupProbe({ dir: scratch(), kitDir, noKit: false, run: b.run, released: true });
  assert.equal(b.calls[1].args.includes('--unreleased'), false);
});

// why: guards rule:branching
test('setupProbe with noKit still makes the folder and git init but never calls the install', async () => {
  const { setupProbe } = await recallTools();
  for (const released of [true, false]) {
    const dir = scratch();
    const { calls, run } = recorder();
    setupProbe({ dir, kitDir: path.join(os.tmpdir(), 'k'), noKit: true, run, released });
    assert.equal(fs.existsSync(dir), true);
    assert.equal(calls.length, 1, 'only git init may run');
    assert.equal(calls[0].cmd, 'git');
    assert.ok(calls.every((c) => !c.args.some((a) => /kit\.mjs$|^install$/.test(String(a)))));
  }
  // noKit with no kitDir at all must not touch kitDir.
  const { calls, run } = recorder();
  setupProbe({ dir: scratch(), kitDir: null, noKit: true, run, released: false });
  assert.equal(calls.length, 1);
});

// why: guards rule:branching
test('setupProbe throws when git init fails and runs nothing after it', async () => {
  const { setupProbe } = await recallTools();
  const { calls, run } = recorder([1]);
  assert.throws(() => setupProbe({ dir: scratch(), kitDir: path.join(os.tmpdir(), 'k'), noKit: false, run, released: true }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, 'git');
  const again = recorder([128]);
  assert.throws(() => setupProbe({ dir: scratch(), kitDir: null, noKit: true, run: again.run, released: false }));
  assert.equal(again.calls.length, 1);
});

// why: guards rule:probe-scope
test('setupProbe throws when the kit install fails', async () => {
  const { setupProbe } = await recallTools();
  for (const released of [true, false]) {
    const { calls, run } = recorder([0, 2]);
    assert.throws(() => setupProbe({ dir: scratch(), kitDir: path.join(os.tmpdir(), 'k'), noKit: false, run, released }));
    assert.equal(calls.length, 2);
  }
});

// why: guards rule:instruments-and-evals
test('checkUserLayer throws unless kit-install.json exists and says release is exactly true', async () => {
  const { checkUserLayer } = await recallTools();
  const home = makeTemp('ul-');
  assert.throws(() => checkUserLayer(home), (e) => /is not a released kit install/.test(e.message) && e.message.includes(home));
  const stamp = path.join(home, 'kit-install.json');
  for (const body of [{ release: false }, { release: 'true' }, { release: 1 }, {}, { describe: 'v1.0.0' }]) {
    fs.writeFileSync(stamp, JSON.stringify(body));
    assert.throws(() => checkUserLayer(home), /is not a released kit install/, JSON.stringify(body));
  }
  fs.writeFileSync(stamp, '{ not json');
  assert.throws(() => checkUserLayer(home));
  fs.writeFileSync(stamp, JSON.stringify({ release: true, describe: 'v1.0.0' }));
  assert.doesNotThrow(() => checkUserLayer(home));
  // A folder with that name is not a stamp.
  const odd = makeTemp('ul-');
  fs.mkdirSync(path.join(odd, 'kit-install.json'));
  assert.throws(() => checkUserLayer(odd));
});

// why: guards rule:instruments-and-evals
test('runHeader names the path shape and the CLI, and never the real folder name', async () => {
  const { runHeader, probePath } = await recallTools();
  const home = path.join(os.tmpdir(), 'hdr-home');
  const projectDir = probePath(home);
  const [, hex1, p2] = probeParts(home, projectDir);
  const facts = { project: '1.0.0 (unreleased abc1234)', user: '1.0.0', userRelease: true, approve: true };
  const lines = runHeader({ label: 'cand-1', projectDir, keys: 2, facts, when: '2026-11-04T00:00:00.000Z', cli: 'claude' });
  assert.ok(Array.isArray(lines));
  assert.ok(lines.includes('Path: kit-probes/<hex>/p<hex>'), lines.join('\n'));
  assert.ok(lines.includes('CLI: claude'), lines.join('\n'));
  const text = lines.join('\n');
  for (const secret of [projectDir, hex1, p2, p2.slice(1), path.basename(projectDir), home]) {
    assert.ok(!text.includes(secret), `header leaks ${secret}`);
  }
  // Existing lines survive.
  assert.match(text, /^# Recall run: cand-1$/m);
  assert.match(text, /^Keys: v2$/m);
  assert.match(text, /^Project kit: 1\.0\.0 \(unreleased abc1234\)$/m);
  assert.match(text, /^User kit: 1\.0\.0$/m);
  assert.match(text, /^approve\.mjs at the user path: yes$/m);
  // The CLI line follows the argument, it is not a constant.
  const other = runHeader({ label: 'x', projectDir, keys: 2, facts, when: 'w', cli: 'other-cli' }).join('\n');
  assert.match(other, /^CLI: other-cli$/m);
  assert.doesNotMatch(other, /^CLI: claude$/m);
  // The path line is the same for every probe, whatever its random name.
  const again = runHeader({ label: 'x', projectDir: probePath(home), keys: 2, facts, when: 'w', cli: 'claude' });
  assert.ok(again.includes('Path: kit-probes/<hex>/p<hex>'));
});

// why: guards rule:instruments-and-evals
test('recall refuses the old usage and an unreleased user layer before it creates any folder', () => {
  const { kit, home } = makeKit();
  const fakeOs = makeTemp('fakeos-');
  const env = { ...process.env, KIT_CLAUDE_HOME: home, CLAUDE_CONFIG_DIR: home, HOME: fakeOs, USERPROFILE: fakeOs, PATH: '' };
  const go = (args) => spawnSync(process.execPath, [RECALL, ...args], { encoding: 'utf8', env });
  const unstamped = go(['never-saved']);
  assert.equal(unstamped.status, 1);
  assert.match(unstamped.stderr, /not a released kit install/);
  install({ kit, home, target: 'user', release: released(kit, 'v1.0.0') });
  for (const args of [['C:/some/folder', 'kit-1.19.0'], ['./folder', 'x']]) {
    const old = go(args);
    assert.equal(old.status, 1);
    assert.match(old.stderr, /usage/);
  }
  assert.equal(fs.existsSync(path.join(fakeOs, 'kit-probes')), false, 'no probe folder before the checks pass');
  assert.equal(fs.existsSync(path.resolve('reports/evals/never-saved.md')), false);
});

// why: guards rule:instruments-and-evals
test('recall checks the Claude folder a session will use, not one a variable points at', async () => {
  const { checkHome } = await recallTools();
  assert.throws(() => checkHome({ KIT_CLAUDE_HOME: 'C:/a' }), /KIT_CLAUDE_HOME/);
  assert.throws(() => checkHome({ KIT_CLAUDE_HOME: 'C:/a', CLAUDE_CONFIG_DIR: 'C:/b' }), /KIT_CLAUDE_HOME/);
  checkHome({ KIT_CLAUDE_HOME: 'C:/a', CLAUDE_CONFIG_DIR: 'C:/a' });
  checkHome({});
});

// why: guards rule:instruments-and-evals
test('every recall session runs in the probe folder with the question as its input, and a failure stops the run', async (t) => {
  const { askAll, probePath } = await recallTools();
  const said = t.mock.method(console, 'log', () => {});
  const dir = probePath(path.join(os.tmpdir(), 'osh'));
  const calls = [];
  const qs = [{ n: 1, q: 'First?', key: 'k1' }, { n: 2, q: 'Second?', key: 'k2' }];
  const lines = askAll({ qs, projectDir: dir, run: (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { status: 0, stdout: 'answer\n' }; } });
  assert.deepEqual(calls.map((c) => c.opts.cwd), [dir, dir]);
  assert.match(calls[0].opts.cwd.replace(/\\/g, '/'), /kit-probes\/[0-9a-f]{6}\/p[0-9a-f]{6}$/);
  assert.deepEqual(calls.map((c) => c.opts.input), ['First?', 'Second?']);
  assert.equal(calls[0].args[calls[0].args.indexOf('--setting-sources') + 1], 'project');
  // MC2: recall names its model and effort, pinned to what the main session really runs (workbench MEASURE.md), so a
  // saved default or a new release never moves the ruler.
  assert.equal(calls[0].args[calls[0].args.indexOf('--model') + 1], 'claude-opus-5-5');
  assert.equal(calls[0].args[calls[0].args.indexOf('--effort') + 1], 'medium');
  assert.match(calls[0].args[calls[0].args.indexOf('--disallowedTools') + 1], /Bash/);
  assert.ok(lines.includes('> answer'));
  assert.deepEqual(said.mock.calls.map((c) => c.arguments[0]), ['[1/2] answered (6 chars)', '[2/2] answered (6 chars)']);
  for (const bad of [{ status: 1, stdout: 'words' }, { status: 0, stdout: '  ' }, { status: 0, stdout: 'Not logged in' }]) {
    assert.throws(() => askAll({ qs, projectDir: dir, run: () => bad }), /question 1: no answer/, JSON.stringify(bad));
  }
  // 1.21.0 handoff item 36: a logged-out session says how to log in, for the config folder the run reads.
  assert.throws(() => askAll({ qs, projectDir: dir, run: () => ({ status: 1, stdout: 'Not logged in - Please run /login' }) }), /not logged in.*\/login.*CLAUDE_CONFIG_DIR/i);
});

// why: guards rule:instruments-and-evals
test('a whole recall run asks in a neutral folder with the kit installed, saves the answers, and cleans up after itself', async () => {
  const { recallRun, currentVersion, questionCount } = await recallTools();
  const { kit, home } = makeKit();
  install({ kit, home, target: 'user', release: released(kit, 'v1.0.0') });
  const osHome = makeTemp('osh-');
  const outDir = makeTemp('out-');
  fs.mkdirSync(path.join(home, 'projects', 'other-project'), { recursive: true });
  const text = read(path.resolve('docs/evals/recall-questions.md'));
  const calls = [];
  // K107: the run hands its probe to forget, so the guard record install wrote goes with the folder (the sweep: only
  // removeProbe was tested, and the run could drop the hand-over unseen).
  const forgot = [];
  const kitTools = { releaseState: () => ({ problems: ['not a tag'] }), projectSlug: (d) => path.basename(d), forget: ({ dir }) => { forgot.push(dir); return { removed: [dir], why: '' }; } };
  const go = (over = {}) => recallRun({ label: 'recall-cand-9', kitDir: kit, noKit: false, home, osHome, env: {}, text, when: 'w', outDir, kitTools,
    run: (cmd, args, opts) => { calls.push({ cmd, args, opts }); if (cmd === 'claude' && args[0] === 'auth') return { status: 0, stdout: JSON.stringify({ configDirectory: home }) }; if (cmd === 'claude' && args[0] === '-p') fs.mkdirSync(path.join(home, 'projects', path.basename(opts.cwd)), { recursive: true }); return { status: 0, stdout: 'an answer' }; }, ...over });
  assert.throws(() => go({ run: () => ({ status: 0, stdout: JSON.stringify({ configDirectory: osHome }) }) }), /sessions read/);
  const out = go();
  assert.match(read(out), new RegExp(`^Keys: v${currentVersion(text)}$`, 'm'));
  const asks = calls.filter((c) => c.cmd === 'claude' && c.args[0] === '-p');
  assert.equal(asks.length, questionCount(text, currentVersion(text)));
  for (const c of asks) assert.match(c.opts.cwd.replace(/\\/g, '/'), /\/kit-probes\/[0-9a-f]{6}\/p[0-9a-f]{6}$/);
  assert.equal(new Set(asks.map((c) => c.opts.cwd)).size, 1);
  assert.doesNotMatch(asks[0].opts.cwd, /recall|cand/, 'the label never reaches the path');
  assert.ok(calls.some((c) => c.args.includes('--unreleased') && c.args.includes(asks[0].opts.cwd)), 'the project layer goes into the run\'s folder');
  assert.deepEqual(fs.readdirSync(path.join(osHome, 'kit-probes')), [], 'the folder is gone');
  assert.deepEqual(forgot, [asks[0].opts.cwd], 'its guard record is forgotten');
  assert.ok(fs.existsSync(path.join(home, 'projects', 'other-project')));
  assert.equal(fs.readdirSync(path.join(home, 'projects')).some((p) => /^p[0-9a-f]{6}$/.test(p)), false, 'its memory is gone');
  assert.throws(() => go({ env: { KIT_CLAUDE_HOME: 'C:/elsewhere' } }), /KIT_CLAUDE_HOME/);
  assert.throws(() => go({ run: () => ({ status: 1, stderr: 'no' }) }), /no/);
  assert.deepEqual(fs.readdirSync(path.join(osHome, 'kit-probes')), [], 'a failed run cleans up too');
});

// why: guards rule:instruments-and-evals
test('a recall run removes what it made, and nothing else', async () => {
  const { removeProbe, probePath } = await recallTools();
  const root = makeTemp('clean-');
  const home = path.join(root, '.claude');
  const dir = probePath(root);
  const other = path.join(root, 'kit-probes', 'keepme');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(other, { recursive: true });
  const slug = path.join(home, 'projects', 'slug-1', 'memory');
  fs.mkdirSync(slug, { recursive: true });
  fs.mkdirSync(path.join(home, 'projects', 'slug-2'), { recursive: true });
  removeProbe({ dir, home, slug: 'slug-1', osHome: root });
  assert.equal(fs.existsSync(path.dirname(dir)), false);
  assert.equal(fs.existsSync(path.join(home, 'projects', 'slug-1')), false);
  assert.ok(fs.existsSync(path.join(home, 'projects', 'slug-2')), 'another project\'s memory stays');
  assert.ok(fs.existsSync(other));
  assert.throws(() => removeProbe({ dir: other, home, slug: 'x', osHome: root }), /not a probe folder/);
});

// The build 15 sweep: two templates still put the feature-branch push and its PR behind the owner's yes, against the
// push bound (the owner, 2026-11-10 and 2026-11-15), so a session starting from either stopped where no stop is owed.
// why: guards rule:outward-acts
test('no rule, template or skill puts the feature-branch push or its PR behind the owner\'s yes', () => {
  const files = [...ruleFiles(), ...fs.readdirSync(path.resolve('project/_Templates')).filter((n) => n.endsWith('.md')).map((n) => path.resolve('project/_Templates', n)),
    path.resolve('user/skills/agent-team-build/references/finishing-a-branch.md'), path.resolve('user/skills/pr-body/SKILL.md')];
  const stops = [/to the owner BEFORE any push or PR/i, /owner's yes: push, PR/i, /only auto-fix's grant pushes/i, /\(the owner runs it\)/i];
  const hits = files.flatMap((f) => read(f).split('\n').filter((l) => stops.some((s) => s.test(l))).map((l) => `${path.basename(f)}: ${l.slice(0, 80)}`));
  assert.deepEqual(hits, []);
});

// The build 15 sweep: in an overlay the host repo owns CLAUDE.md, so "the project CLAUDE.md" read as text any committer
// writes, ranked above the owner's global file. The order names the kit's own file and the rules no repo file loosens.
// why: guards rule:instruction-priority
test('the instruction order names the kit\'s CLAUDE.md and the rules no repo file loosens', () => {
  const core = read(path.resolve('rules/core.md'));
  const section = core.slice(core.indexOf('{#instruction-priority}'), core.indexOf('{#owners-rules}'));
  for (const token of ['CLAUDE.local.md', 'rule:outward-acts', 'rule:security-standards', 'rule:test-integrity']) assert.ok(section.includes(token), token);
});

// K107 (build 14): removeProbe deleted the probe and its memory but not the guard record install project wrote, so
// every recall run left one (13 after build 14), and the launcher reads every record on each shell call.
// why: catches the recall probe's guard record left behind (K107)
test('a recall run forgets its probe\'s guard record, and only that one', async () => {
  const { removeProbe, probePath } = await recallTools();
  const kitTools = await import('../scripts/kit.mjs');
  const root = makeTemp('forget-probe-');
  const home = path.join(root, '.claude');
  const dir = probePath(root);
  const keep = path.join(root, 'live-project');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(keep, { recursive: true });
  for (const d of [dir, keep]) {
    fs.mkdirSync(kitTools.guardDir(home, d), { recursive: true });
    fs.writeFileSync(path.join(kitTools.guardDir(home, d), 'record.json'), JSON.stringify({ projectDir: d }));
  }
  removeProbe({ dir, home, slug: 'slug-1', osHome: root, forget: kitTools.forget });
  assert.equal(fs.existsSync(kitTools.guardDir(home, dir)), false, 'the probe\'s guard record is gone');
  assert.ok(fs.existsSync(kitTools.guardDir(home, keep)), 'a live project\'s record stays');
});

// K116 (1.42.0, reproduced on 1.41.0): the gate passed rule text edited after the commit its run scored. A gate line
// now names that commit, and rule text that differs from it at the head is refused unless the owner accepts it.
// why: guards rule:instruments-and-evals
test('recall gate (K116): rule text changed after the scored commit, or no scored commit, is refused', () => {
  const ok = gateRepo();
  ok.record(PASS_GATE);
  assert.equal(ok.gate().status, 0, ok.gate().stdout);
  // A later rule edit is unscored.
  ok.put('rules/core.md', 'edited after the run\n');
  ok.git('commit', '-qam', 'later');
  const late = ok.gate();
  assert.equal(late.status, 1, late.stdout);
  assert.match(late.stdout, /rule text changed.*the scored commit [0-9a-f]{7}: rules\/core\.md/);
  // No scored line at all.
  const none = gateRepo();
  none.record('gate: a median 12 baseline 9 brief v1 keys v4 control 0', () => {}, false);
  assert.match(none.gate().stdout, /names no scored commit/);
  // A commit that is not on the branch scored other text.
  const off = gateRepo();
  off.record('gate: a median 12 baseline 9 brief v1 keys v4 control 0', () => {}, false);
  // A real side commit holding the head's very rule text: a diff from it would show nothing, yet it is not this branch.
  const ruleText = read(path.join(off.dir, 'rules/core.md'));
  off.git('switch', '-q', '-c', 'side', 'base');
  off.put('rules/core.md', ruleText);
  off.git('add', '.'); off.git('commit', '-qm', 'side');
  const other = off.git('rev-parse', 'HEAD').trim();
  off.git('switch', '-q', 'main');
  off.put('docs/evals/results/recall-scores.md', read(path.join(off.dir, 'docs/evals/results/recall-scores.md')) + `scored: ${other}\n`);
  off.git('commit', '-qam', 'not on the branch');
  assert.match(off.gate().stdout, new RegExp(`rule text changed.*the scored commit ${other.slice(0, 7)}: rules/core\\.md`), other);
  // K198: no marker passes it.
  const accepted = gateRepo();
  accepted.record(`${PASS_GATE} owner-accepted`, () => {}, false);
  assert.equal(accepted.gate().status, 1, accepted.gate().stdout);
});

// The build 16 sweep: a rule file under a case-changed folder (Rules/, NOTE.MD) or with a tab in its name was not
// graded, so the gate said no rule text changed; on Windows the file lands in rules/, where the build reads it.
// why: guards rule:instruments-and-evals
test('recall gate: a graded file named in another case or with a tab still needs a recall run', () => {
  // Windows cannot name a file with a tab; CI's Linux runner checks that one.
  for (const rel of ['project/NOTE.MD', 'Memory/x.md', ...(process.platform === 'win32' ? [] : ['project/a\tb.md'])]) {
    const r = gateRepo();
    r.put(rel, 'unscored rule\n');
    r.git('add', '.'); r.git('commit', '-qm', 'rule only');
    const out = r.gate();
    assert.equal(out.status, 1, `${rel}: ${out.stdout}`);
  }
});

// T10 (1.42.0): beside the wording line, a rule change records the behaviour suite's line. It is held to the suite's
// version and pass bar, to its baseline, and to a control under that baseline; the suite cannot be removed to skip it.
// why: guards rule:instruments-and-evals
test('recall gate (T10): a rule change needs a behaviour line on the current suite, at its bar and baseline', () => {
  const suite = JSON.stringify({ version: 2, pass: 10, scenarios: [] });
  const line = 'gate: a median 12 baseline 9 brief v1 keys v4 control 0';
  const run = (behave) => { const r = gateRepo({ suite }); r.record(behave ? `${line}\n${behave}` : line); return r.gate(); };
  assert.match(run(null).stdout, /records no behaviour line/);
  const pass = gateRepo({ suite });
  pass.record(`${PASS_GATE}\nbehaviour: a median 14 baseline 11 suite v2 control 3\nbehaviour worse: none`);
  assert.equal(pass.gate().status, 0, pass.gate().stdout);
  const under = run('behaviour: a median 9 baseline 8 suite v2 control 3');
  assert.equal(under.status, 1);
  assert.match(under.stdout, /under the suite's pass bar of 10/);
  assert.match(run('behaviour: a median 11 baseline 12 suite v2 control 3').stdout, /behaviour median 11 is under its baseline 12/);
  assert.match(run('behaviour: a median 12 baseline 11 suite v2 control 11').stdout, /behaviour control 11 is not under its baseline 11/);
  assert.match(run('behaviour: a median 12 baseline 11 suite v1 control 3').stdout, /suite v1; the current suite is v2/);
  // Removing the suite does not turn the gate off.
  const gone = gateRepo({ suite });
  gone.record(`${line}\nbehaviour: a median 12 baseline 11 suite v2 control 3`, (put) => put('docs/evals/behaviour-scenarios.json', ''));
  gone.git('rm', '-q', 'docs/evals/behaviour-scenarios.json'); gone.git('commit', '-qm', 'drop the suite');
  const out = gone.gate();
  assert.equal(out.status, 1);
  assert.match(out.stdout, /removes docs\/evals\/behaviour-scenarios\.json/);
  // The build 16 sweep: the PR's own suite cannot lower or drop the bar, and an edit at the same version moves the ruler.
  const edited = (next, behave) => { const r = gateRepo({ suite }); r.record(`${line}\n${behave}`, (put) => put('docs/evals/behaviour-scenarios.json', JSON.stringify(next))); return r.gate(); };
  assert.match(edited({ version: 2, pass: 1, scenarios: [] }, 'behaviour: a median 1 baseline 1 suite v2 control 0').stdout, /under the suite's pass bar of 10/);
  assert.match(edited({ version: 2, scenarios: [] }, 'behaviour: a median 1 baseline 1 suite v2 control 0').stdout, /under the suite's pass bar of 10/);
  assert.match(edited({ version: 3, pass: 1, scenarios: [] }, 'behaviour: a median 1 baseline 1 suite v3 control 0').stdout, /under the suite's pass bar of 10/);
  const moved = edited({ version: 2, pass: 10, scenarios: [{ id: 'x' }] }, 'behaviour: a median 12 baseline 11 suite v2 control 3');
  assert.equal(moved.status, 1);
  assert.match(moved.stdout, /changes the behaviour suite/);
});

// why: guards rule:instruments-and-evals
test('recall gate (B7): current keys with no Pass line cannot pass, since recall cannot run them', () => {
  const r = gateRepo({ keys: 'Current version: v4\n\n<!-- recall v4 -->\nno pass line\n\n' });
  r.record('gate: a median 12 baseline 9 brief v1 keys v4 control 0');
  const out = r.gate();
  assert.equal(out.status, 1, out.stdout + out.stderr);
  assert.match(out.stdout + out.stderr, /no "Pass: median <n> of <m>\." line/);
});

// why: guards rule:ci-gate
test('recall gate (S18-3): the ruler is read from the head commit, never the working tree', () => {
  const r = gateRepo();
  r.record('gate: a median 7 baseline 7 brief v1 keys v4 control 0');
  // An uncommitted edit lowers the bar; the gate must still hold the head's bar of 9.
  r.put('docs/evals/recall-questions.md', 'Current version: v4\n\n<!-- recall v4 -->\nPass: median 5 of 13.\n\n');
  const out = r.gate();
  assert.equal(out.status, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /pass bar of 9/);
});

// why: guards rule:instruments-and-evals
test('recall gate (S18-5): a scores file over 1 MiB on the base still sets the floor', () => {
  const big = '# Scores\n' + ('x'.repeat(100) + '\n').repeat(12000) + 'gate: old median 10 baseline 10 brief v1 keys v4\n';
  const r = gateRepo({ scores: big });
  r.record('gate: a median 10 baseline 9 brief v1 keys v4 control 0');
  const out = r.gate();
  assert.equal(out.status, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /under the floor of 14/);
});

// why: guards rule:instruments-and-evals
test('recall gate and kit.mjs (S18-2): run through a junction or link, they still run and fail as they should', { windows: true }, () => {
  const r = gateRepo();
  r.record('gate: a median 7 baseline 7 brief v1 keys v4 control 0');
  const link = path.join(r.dir, 'linked');
  fs.symlinkSync(path.join(r.dir, 'scripts'), link, 'junction');
  const out = r.gate(path.join(link, 'recall.mjs'));
  assert.equal(out.status, 1, 'through a link: ' + out.stdout + out.stderr);
  const kitLink = makeTemp('kitlink-');
  fs.symlinkSync(path.resolve('scripts'), path.join(kitLink, 's'), 'junction');
  const usage = spawnSync('node', [path.join(kitLink, 's', 'kit.mjs'), 'no-such-command'], { encoding: 'utf8' });
  assert.notEqual(usage.stdout + usage.stderr, '', 'kit.mjs through a link prints, so it ran');
});

// why: guards rule:ci-gate
test('recall gate (S18-7): a gate line on keys v4 or later names its control, and the control is under the baseline', async () => {
  const { checkGate } = await recallTools();
  const v4 = (line) => checkGate({ changed: ['rules/core.md'], added: [line], brief: 1, keys: 4, bar: 9 });
  assert.match(v4('gate: a median 10 baseline 9 brief v1 keys v4').detail, /names the control/);
  assert.equal(v4('gate: a median 10 baseline 9 brief v1 keys v4 control 2').ok, true, 'a line recorded inline still reads');
  assert.equal(v4('gate: a median 10 baseline 9 brief v1 keys v4 control 2').ok, true);
  const high = v4('gate: a median 10 baseline 9 brief v1 keys v4 control 9');
  assert.equal(high.ok, false);
  assert.match(high.detail, /control 9 is not under the baseline 9/);
  // Older keys never named it, so their lines read as before.
  assert.equal(checkGate(gateFacts()).ok, true);
});

// why: guards rule:ci-gate
test('recall gate (S18-6, K198): an old-ruler line cannot be corrected under a marker, since no marker passes', async () => {
  const { checkGate } = await recallTools();
  const old = 'gate: kit-1.18.0 median 8 baseline 8 brief v1 keys v1 owner-accepted';
  const fix = checkGate({ changed: ['docs/evals/results/recall-scores.md'], added: [old], removed: [old.replace('median 8', 'median 9')], brief: 1, keys: 2 });
  assert.equal(fix.ok, false, fix.detail);
  assert.doesNotMatch(fix.detail, /correction/);
  // Unmarked, or beside a rule change, it fails too.
  assert.equal(checkGate({ changed: ['docs/evals/results/recall-scores.md'], added: [old.replace(' owner-accepted', '')], brief: 1, keys: 2 }).ok, false);
  assert.equal(checkGate({ changed: ['rules/core.md', 'docs/evals/results/recall-scores.md'], added: [old], brief: 1, keys: 2 }).ok, false);
});

// why: guards rule:instruments-and-evals
test('recall (I20): a released user layer edited by hand is not read as released', async () => {
  const { checkUserLayer } = await recallTools();
  const { kit, home } = makeKit();
  fs.mkdirSync(home, { recursive: true });
  install({ kit, home, target: 'user', release: released(kit, 'v1.0.0') });
  checkUserLayer(home, os.tmpdir());
  fs.appendFileSync(path.join(home, 'skills', 'human-factor', 'SKILL.md'), 'a hand edit\n');
  assert.throws(() => checkUserLayer(home, os.tmpdir()), /changed by hand.*skills\/human-factor\/SKILL\.md/);
});

// why: guards rule:instruments-and-evals
test('recall (I27): removeProbe deletes only a probe under this home\'s kit-probes, and only a plain memory slug', { windows: 'also' }, async () => {
  const { removeProbe, probePath } = await recallTools();
  const osHome = makeTemp('oshome-');
  const home = path.join(osHome, '.claude');
  fs.mkdirSync(path.join(home, 'projects', 'keep'), { recursive: true });
  const elsewhere = makeTemp('elsewhere-');
  const outside = probePath(elsewhere);
  fs.mkdirSync(outside, { recursive: true });
  assert.throws(() => removeProbe({ dir: outside, home, slug: 'x', osHome }), /not a probe folder/);
  assert.ok(fs.existsSync(outside), 'a probe-shaped folder under another home stays');
  const dir = probePath(osHome);
  fs.mkdirSync(dir, { recursive: true });
  for (const slug of ['..', '', 'a/b', 'a\\b', '.']) assert.throws(() => removeProbe({ dir, home, slug, osHome }), /memory slug/, JSON.stringify(slug));
  assert.ok(fs.existsSync(home), 'the Claude folder stays');
  // A probe path that leads elsewhere through a link is not a probe.
  fs.mkdirSync(path.join(elsewhere, 'pbbbbbb'), { recursive: true });
  fs.symlinkSync(elsewhere, path.join(osHome, 'kit-probes', 'aaaaaa'), 'junction');
  assert.throws(() => removeProbe({ dir: path.join(osHome, 'kit-probes', 'aaaaaa', 'pbbbbbb'), home, slug: 'x', osHome }), /not a probe folder/);
  removeProbe({ dir, home, slug: 'keep-not', osHome });
  assert.equal(fs.existsSync(path.dirname(dir)), false);
  assert.ok(fs.existsSync(path.join(home, 'projects', 'keep')));
});

// Review R1 and R3 (1.21.0): a throwaway user layer is a real unreleased install under a kit-probes that is no link.
// why: guards rule:instruments-and-evals
test('recall (R1, R3): kit-probes may not be a link, and a throwaway layer must be a real unreleased install', { windows: 'also' }, async () => {
  const { checkUserLayer } = await recallTools();
  const osHome = makeTemp('oshome-');
  const real = path.join(osHome, '.claude');
  fs.mkdirSync(real, { recursive: true });
  fs.writeFileSync(path.join(real, 'kit-install.json'), JSON.stringify({ version: '1.0.0', release: false, describe: 'abc', files: {} }));
  // kit-probes pointing at the home folder would make the real ~/.claude a "throwaway".
  fs.symlinkSync(osHome, path.join(osHome, 'kit-probes'), 'junction');
  assert.throws(() => checkUserLayer(path.join(osHome, 'kit-probes', '.claude'), osHome), /not a released kit install/);
  fs.unlinkSync(path.join(osHome, 'kit-probes'));
  for (const body of [{}, [], { version: '1.0.0' }, { release: false }]) {
    const home = path.join(osHome, 'kit-probes', 'cfg-' + Math.random().toString(16).slice(2));
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'kit-install.json'), JSON.stringify(body));
    assert.throws(() => checkUserLayer(home, osHome), /not a released kit install/, JSON.stringify(body));
  }
});

// Review R2 (1.21.0): a throwaway run still loads the real global CLAUDE.md as a parent folder's file, so its header
// says which one.
// why: guards rule:instruments-and-evals
test('recall (R2): a run on a throwaway layer records the real global layer it also loads', async () => {
  const { installFacts, runHeader } = await recallTools();
  const osHome = makeTemp('oshome-');
  fs.mkdirSync(path.join(osHome, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(osHome, '.claude', 'kit-install.json'), JSON.stringify({ version: '1.20.0', release: true, describe: 'v1.20.0' }));
  const home = path.join(osHome, 'kit-probes', 'cfg');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'kit-install.json'), JSON.stringify({ version: '1.21.0', release: false, describe: 'abc1234' }));
  const proj = makeTemp('proj-');
  const facts = installFacts({ projectDir: proj, home, osHome });
  assert.equal(facts.global, '1.20.0 (v1.20.0)');
  assert.ok(runHeader({ label: 'x', keys: 4, facts, when: 'now', cli: 'c' }).includes('Global CLAUDE.md also loaded from ~/.claude: 1.20.0 (v1.20.0)'));
  const same = installFacts({ projectDir: proj, home: path.join(osHome, '.claude'), osHome });
  assert.equal(same.global, undefined);
});

// 1.20.0 carry-over B8, K198 (1.48.0): the blind and score tools live in the repo, take the question count from the
// current keys, read two blind scorers, and print the lines the gate reads: scorers, worse, control and the gate line.
// why: guards rule:instruments-and-evals
test('recall-score blinds runs without a side marker and scores two scorers into the lines the gate reads', async () => {
  const { blind, score, scrub } = await import('../scripts/recall-score.mjs');
  const { checkGate, FLOOR } = await recallTools();
  assert.equal(FLOOR, 14, 'K198: the floor');
  const dir = makeTemp('rscore-');
  const keysText = read(path.resolve('docs/evals/recall-questions.md'));
  const n = (await recallTools()).questionCount(keysText, (await recallTools()).currentVersion(keysText));
  const run = (name, extra) => {
    const body = ['# Recall run: ' + name, '', 'When: 2026-11-20T10:00:00.000Z', 'User kit: 1.21.0 (unreleased abc1234)', '', ...Array.from({ length: n }, (_, i) => `## ${i + 1}. q\n\nKey: k\n\nAnswer:\n\n> answer ${extra} at kit-probes/abc123/pdef456\n\nScore: _\n`)].join('\n');
    fs.writeFileSync(path.join(dir, name + '.md'), body);
    return path.join(dir, name + '.md');
  };
  const names = [...[1, 2, 3, 4, 5].map((i) => `cand-${i}`), ...[1, 2, 3, 4, 5].map((i) => `base-${i}`), 'control-1'];
  const runs = names.map((r) => run(r, 'v1.20.0 commit 8ef3733'));
  const out = path.join(dir, 'blind');
  const { map } = blind(out, runs, () => 0);
  for (const f of fs.readdirSync(path.join(out, 'scorer'))) {
    const text = read(path.join(out, 'scorer', f));
    assert.doesNotMatch(text, /cand|base-|control|1\.2[01]\.0|8ef3733|kit-probes|unreleased|When:/, f);
  }
  assert.equal(JSON.parse(read(path.join(out, 'sealed-map.json'))).when[Object.keys(map)[0]], '2026-11-20T10:00:00.000Z', 'the sealed map keeps each run\'s time, for the same-day check');
  assert.equal(scrub('see 1a2b3c4 and the word deadbeef0 and 1234567'), 'see <commit> and the word <commit> and 1234567');
  const totals = Object.fromEntries(names.map((r) => [r, r.startsWith('cand') ? n : r.startsWith('base') ? n - 1 : 0]));
  const lines = Object.entries(map).flatMap(([id, r]) => Array.from({ length: n }, (_, i) => `${id} Q${i + 1}: ${i < totals[r] ? 1 : 0}`));
  fs.writeFileSync(path.join(dir, 'a.txt'), lines.join('\n'));
  fs.writeFileSync(path.join(dir, 'b.txt'), lines.join('\n'));
  const r = score([path.join(dir, 'a.txt'), path.join(dir, 'b.txt')], path.join(out, 'sealed-map.json'), 'kit-x');
  const keys = (await recallTools()).currentVersion(keysText);
  assert.match(r.line, new RegExp(`^gate: kit-x median ${n} baseline ${n - 1} brief v\\d+ keys v${keys}$`));
  assert.deepEqual(r.lines.slice(0, 3), ['scorers: 2', 'worse: none', 'control: 0']);
  assert.equal(r.lines[3], r.line);
  assert.equal(r.pass, n >= FLOOR);
  assert.equal(checkGate({ changed: ['rules/core.md'], added: r.lines, brief: Number(r.line.match(/brief v(\d+)/)[1]), keys, bar: n - 1, floor: n }).ok, true);
  fs.writeFileSync(path.join(dir, 'short.txt'), lines.slice(1).join('\n'));
  assert.throws(() => score([path.join(dir, 'short.txt'), path.join(dir, 'b.txt')], path.join(out, 'sealed-map.json'), 'kit-x'), /expected \d+ scores/);
  assert.throws(() => score([path.join(dir, 'a.txt')], path.join(out, 'sealed-map.json'), 'kit-x'), /two blind scorers/);
});

// K198 (Max's picks, 2026-11-20): 5 runs a side, flat; the two scorers averaged with no rounding up, so a run is 14 only
// when both give 14; a question is worse when its marks over both scorers and all runs sum under the release's; the
// release arm is measured the same day.
const scoreSets = (arms, n = 14) => {
  // arms: { 'cand-1': [[scorer A misses], [scorer B misses]], ... }: the questions each scorer marked 0.
  const map = {};
  const sets = [{}, {}];
  Object.entries(arms).forEach(([run, misses], i) => {
    const id = `R${String(i + 1).padStart(2, '0')}`;
    map[id] = run;
    sets.forEach((s, k) => { s[id] = Object.fromEntries(Array.from({ length: n }, (_, q) => [q + 1, misses[k].includes(q + 1) ? 0 : 1])); });
  });
  return { map, sets };
};
const fiveEach = (cand, base = Array(5).fill([[], []])) => ({
  ...Object.fromEntries(cand.map((m, i) => [`cand-${i + 1}`, m])),
  ...Object.fromEntries(base.map((m, i) => [`base-${i + 1}`, m])),
  'control-1': [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]],
});
const sameDay = (map, iso = '2026-11-20T10:00:00.000Z') => Object.fromEntries(Object.keys(map).map((id) => [id, iso]));

// why: guards rule:ci-gate
test('recall-score (K198): two scorers are averaged with no rounding up, against the floor of 14', async () => {
  assert.equal((await import('../scripts/recall-score.mjs')).RUNS, 5, 'K198: 5 runs a side');
  const { summarize } = await import('../scripts/recall-score.mjs');
  const { FLOOR } = await recallTools();
  assert.equal(FLOOR, 14);
  const clean = [[], []];
  const split = [[3], []];
  const sum = (cand, base) => { const { map, sets } = scoreSets(fiveEach(cand, base)); return summarize(sets, map, 14, { when: sameDay(map) }); };
  const all = sum(Array(5).fill(clean));
  assert.equal(all.candMedian, 14);
  assert.equal(all.pass, true);
  // Three runs where one scorer took a point: those runs are 13.5, so the median is 13.5, under 14.
  const half = sum([clean, split, split, split, clean]);
  assert.equal(half.candMedian, 13.5);
  assert.equal(half.pass, false);
  // Two such runs of five: the median is still 14.
  assert.equal(sum([clean, split, clean, split, clean]).candMedian, 14);
  // A baseline of 13.5 is not rounded down for the candidate to clear.
  assert.equal(sum(Array(5).fill(clean), Array(5).fill(split)).baseMedian, 13.5);
});

// why: guards rule:ci-gate
test('recall-score (K198): a gate needs 5 candidate and 5 release runs, all measured the same day', async () => {
  assert.equal((await import('../scripts/recall-score.mjs')).RUNS, 5, 'K198: 5 runs a side');
  const { summarize } = await import('../scripts/recall-score.mjs');
  const clean = [[], []];
  const four = { ...fiveEach(Array(5).fill(clean)) };
  delete four['cand-5'];
  const a = scoreSets(four);
  assert.throws(() => summarize(a.sets, a.map, 14, { when: sameDay(a.map) }), /5 candidate runs and 5 release runs/);
  const b = scoreSets(fiveEach(Array(5).fill(clean)));
  const when = sameDay(b.map);
  const baseId = Object.keys(b.map).find((id) => b.map[id] === 'base-3');
  assert.throws(() => summarize(b.sets, b.map, 14, { when: { ...when, [baseId]: '2026-11-18T10:00:00.000Z' } }), /same day/);
  const missing = { ...when };
  delete missing[baseId];
  assert.throws(() => summarize(b.sets, b.map, 14, { when: missing }), /same day/);
  assert.equal(summarize(b.sets, b.map, 14, { when: { ...when, [baseId]: '2026-11-20T23:00:00.000Z' } }).pass, true, 'within a day passes');
});

// why: guards rule:ci-gate
test('recall-score (K198): a question is worse when its marks over both scorers and all runs sum under the release', async () => {
  assert.equal((await import('../scripts/recall-score.mjs')).RUNS, 5, 'K198: 5 runs a side');
  const { summarize } = await import('../scripts/recall-score.mjs');
  const clean = [[], []];
  const run = (cand, base) => { const { map, sets } = scoreSets(fiveEach(cand, base)); return summarize(sets, map, 14, { when: sameDay(map) }); };
  // One scorer docks Q4 once on the candidate: 9 of 10 against the release's 10 of 10. Seen twice (the owner's pick,
  // 2026-11-21): one look names it lower and passes nothing until it is asked again (tests/gate-seen-twice.test.mjs).
  const once = run([[[4], []], clean, clean, clean, clean]);
  assert.deepEqual(once.lower, [4]);
  assert.equal(once.pending, true);
  assert.equal(once.pass, false, 'a median of 14 with a lower question does not pass on one look');
  // The same miss on the release too: nothing lower.
  assert.deepEqual(run([[[4], []], clean, clean, clean, clean], [[[], [4]], clean, clean, clean, clean]).lower, []);
  // Better than the release is never lower.
  assert.deepEqual(run(Array(5).fill(clean), [[[7], [7]], clean, clean, clean, clean]).lower, []);
});

// why: guards rule:ci-gate
test('recall-score (K198): score prints the four lines, and a miss exits 1 saying it is fixed, not merged', () => {
  const dir = makeTemp('rk198-');
  const clean = [[], []];
  const files = (cand) => {
    const { map, sets } = scoreSets(fiveEach(cand));
    const write = (s, f) => fs.writeFileSync(path.join(dir, f), Object.entries(s).flatMap(([id, q]) => Object.entries(q).map(([k, v]) => `${id} Q${k}: ${v}`)).join('\n'));
    write(sets[0], 'a.txt'); write(sets[1], 'b.txt');
    fs.writeFileSync(path.join(dir, 'map.json'), JSON.stringify({ map, when: sameDay(map) }));
    return [path.join(dir, 'a.txt'), path.join(dir, 'b.txt'), path.join(dir, 'map.json')];
  };
  const cli = (cand) => spawnSync('node', [path.resolve('scripts/recall-score.mjs'), 'score', ...files(cand), 'kit-x'], { encoding: 'utf8' });
  const good = cli(Array(5).fill(clean));
  assert.equal(good.status, 0, good.stdout + good.stderr);
  // pin: 1 (the gate reads these lines)
  assert.match(good.stdout, /^scorers: 2\nworse: none\ncontrol: 0\ngate: kit-x median 14 baseline 14 /m);
  const miss = cli([[[2], [2]], [[2], [2]], [[2], [2]], clean, clean]);
  assert.equal(miss.status, 1);
  assert.match(miss.stdout, /^gate: kit-x median 13 /m);
  assert.match(miss.stdout, /under the floor of 14[\s\S]*fix the cause/);
  assert.doesNotMatch(miss.stdout, /cand-4|extra runs|owner/);
});

// K200 (the K181 calibration): a paired tally with no release arm was scored by hand.
// why: catches a paired run with no base arm that the score tool refused
test('recall-score (K200): runs with no release arm are tallied side by side with no gate line', () => {
  const dir = makeTemp('rk200-');
  const clean = [[], []];
  const arms = { ...Object.fromEntries([1, 2, 3, 4, 5].map((i) => [`pc-${i}`, clean])), ...Object.fromEntries([1, 2, 3, 4, 5].map((i) => [`cloud-${i}`, i === 1 ? [[9], [9]] : clean])) };
  const { map, sets } = scoreSets(arms);
  sets.forEach((s, k) => fs.writeFileSync(path.join(dir, `s${k}.txt`), Object.entries(s).flatMap(([id, q]) => Object.entries(q).map(([x, v]) => `${id} Q${x}: ${v}`)).join('\n')));
  fs.writeFileSync(path.join(dir, 'map.json'), JSON.stringify({ map }));
  const r = spawnSync('node', [path.resolve('scripts/recall-score.mjs'), 'score', path.join(dir, 's0.txt'), path.join(dir, 's1.txt'), path.join(dir, 'map.json'), 'k181'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^\| Q \| pc \| cloud \|$/m);
  assert.match(r.stdout, /^\| 9 \| 1, 1, 1, 1, 1 \| 0, 1, 1, 1, 1 \|$/m);
  assert.match(r.stdout, /pc median 14, cloud median 14/);
  assert.doesNotMatch(r.stdout, /^gate:/m);
  assert.match(r.stdout, /no gate line: a gate needs cand, base/);
});

// K199 (the K181 calibration): Windows and Linux paths told the scorer which machine wrote a run; 16 were cleared by hand.
// why: catches a run's OS path that tells a blind scorer its side
test('recall-score (K199): the blind step writes every OS path one way, so no path tells a side', async () => {
  const { scrub, blind } = await import('../scripts/recall-score.mjs');
  const win = scrub('Read C:\\Users\\Max\\.claude\\skills\\pre-pr-sweep\\approve.mjs then .claude\\guard.cjs and scripts\\recall.mjs');
  const lin = scrub('Read /home/runner/.claude/skills/pre-pr-sweep/approve.mjs then .claude/guard.cjs and scripts/recall.mjs');
  assert.equal(win, lin);
  // pin: 1 (the blind set a scorer reads)
  assert.equal(win, 'Read ~/.claude/skills/pre-pr-sweep/approve.mjs then .claude/guard.cjs and scripts/recall.mjs');
  for (const home of ['/Users/max/', 'C:/Users/Max/', '/c/Users/Max/', '$HOME/', '$env:USERPROFILE\\', '%USERPROFILE%\\', '/root/']) assert.equal(scrub(`${home}.claude/x.md`), '~/.claude/x.md', home);
  assert.equal(scrub('D:\\work\\repo\\a.md'), '/work/repo/a.md');
  assert.equal(scrub('a regex like (\\d+) or [a\\d] stays'), 'a regex like (\\d+) or [a\\d] stays');
  // A path the scrub missed still stops the blinding.
  const dir = makeTemp('k199-');
  const f = path.join(dir, 'cand-1.md');
  fs.writeFileSync(f, '# Recall run\n\n## 1. q\n\nKey: k\n\nAnswer:\n\n> see \\\\server\\share\\Users\\x\n');
  assert.throws(() => blind(path.join(dir, 'out'), [f]), /still names a side/);
});

// K198: the fixed gate in CI. The gate command holds every graded PR to a median of 14 on both suites, two blind
// scorers, and no question or scenario worse than the same-day release; nothing passes a miss.
// why: guards rule:ci-gate
test('recall gate (K198): the floor of 14, two scorers and no worse question or scenario, with no override', async () => {
  const { checkGate } = await recallTools();
  const facts = (added, extra = {}) => checkGate({ changed: ['rules/core.md'], added, brief: 1, keys: 4, bar: 9, floor: 14, ...extra });
  const gate = (m) => `gate: a median ${m} baseline 9 brief v1 keys v4 control 0`;
  assert.equal(facts(['scorers: 2', 'worse: none', gate(14)]).ok, true);
  assert.match(facts(['scorers: 2', 'worse: none', gate(13)]).detail, /median 13 is under the floor of 14/);
  assert.match(facts(['worse: none', gate(14)]).detail, /two blind scorers: add "scorers: 2"/);
  assert.match(facts(['scorers: 1', 'worse: none', gate(14)]).detail, /two blind scorers/);
  assert.match(facts(['scorers: 2', gate(14)]).detail, /add the "worse:" line/);
  assert.match(facts(['scorers: 2', 'worse: 4, 9', gate(14)]).detail, /questions 4, 9 do worse than the same-day release/);
  const behave = { behaviour: { suite: 2, bar: 11 } };
  const b = (m, worse = 'behaviour worse: none') => facts(['scorers: 2', 'worse: none', gate(14), `behaviour: a median ${m} baseline 12 suite v2 control 3`, ...(worse ? [worse] : [])], behave);
  assert.equal(b(14).ok, true);
  assert.match(b(13).detail, /behaviour median 13 is under the floor of 14/);
  assert.match(b(14, null).detail, /add the "behaviour worse:" line/);
  assert.match(b(14, 'behaviour worse: 13-closeout').detail, /scenarios 13-closeout do worse/);
  // Without the floor (an older base's call) the lines are not asked for.
  assert.equal(checkGate({ changed: ['rules/core.md'], added: [gate(10)], brief: 1, keys: 4, bar: 9 }).ok, true);
  // The gate command applies the floor itself.
  const r = gateRepo();
  r.record(`${K198_LINES}\n${gate(13)}`);
  const low = r.gate();
  assert.equal(low.status, 1, low.stdout);
  assert.match(low.stdout, /under the floor of 14/);
  const ok = gateRepo();
  ok.record(PASS_GATE);
  assert.equal(ok.gate().status, 0, ok.gate().stdout);
});

// The 1.21.0 sweep's D1: CI runs the base branch's gate, whose parser may not know a new field, so the control sits on
// its own line. Main's parser reads the gate line as it always did; the head gate reads the two together.
// why: guards rule:instruments-and-evals
test('recall gate (D1): the control may sit on its own line beside the gate line', async () => {
  const { checkGate } = await recallTools();
  const v4 = (...added) => checkGate({ changed: ['rules/core.md'], added, brief: 1, keys: 4 });
  const line = 'gate: a median 10 baseline 9 brief v1 keys v4';
  assert.equal(v4('control: 0', line).ok, true);
  assert.equal(v4(line, 'control: 0').ok, true);
  assert.match(v4(line).detail, /control: <n>/);
  assert.match(v4('control: 9', line).detail, /control 9 is not under the baseline 9/);
  assert.equal(v4(`${line} control 0`).ok, true, 'a line already recorded inline still reads');
});

// why: guards rule:instruments-and-evals
test('recall gate (D1): the recorded line is one main\'s parser reads, and score prints the pair', async () => {
  const gateLine = read(path.resolve('docs/evals/results/recall-scores.md')).split('\n').filter((l) => l.startsWith('gate:')).pop();
  assert.match(gateLine, /^gate: (\S+) median (\d+) baseline (\d+) brief v(\d+) keys v(\d+)( owner-accepted)?$/);
  assert.match(read(path.resolve('docs/evals/results/recall-scores.md')), /\ncontrol: 0\n/);
  // pin: 1 (CI's recall gate reads this line)
  assert.match(read(path.resolve('scripts/recall.mjs')), /"gate: <label> median <n> baseline <n> brief v<n> keys v<n>", with "control: <n>" beside it/);
});

// why: guards rule:instruments-and-evals
test('recall gate (T3): an edit to the score tool needs a gate line, and a git failure stops the gate', async () => {
  const { checkGate } = await recallTools();
  assert.equal(checkGate({ changed: ['scripts/recall-score.mjs'], added: [], brief: 1, keys: 4 }).ok, false);
  const r = spawnSync('node', [path.resolve('scripts/recall.mjs'), 'gate', 'no-such-ref', 'HEAD'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
});

// why: guards rule:instruments-and-evals
test('recall layer (T3): a released layer with a file missing is refused, and its memory may differ', async () => {
  const { checkUserLayer } = await recallTools();
  const home = makeTemp('layer-');
  const hash = crypto.createHash('sha256').update('a\n').digest('hex');
  fs.writeFileSync(path.join(home, 'a.md'), 'a\n');
  const stamp = (files) => fs.writeFileSync(path.join(home, 'kit-install.json'), JSON.stringify({ version: '1.0.0', release: true, files }));
  stamp({ 'a.md': hash, 'memory/x.md': 'not this' });
  checkUserLayer(home, home);
  stamp({ 'a.md': hash, 'b.md': hash });
  assert.throws(() => checkUserLayer(home, home), /changed by hand or missing since install: b\.md/);
});

// T2: what the recall's blinding promises, each by a break a reviewer showed went unseen.
// why: guards rule:instruments-and-evals
test('recall-score (T2): a marker that survives the scrub stops the blinding', async () => {
  const { blind } = await import('../scripts/recall-score.mjs');
  const dir = makeTemp('blind-');
  const f = path.join(dir, 'cand-1.md');
  fs.writeFileSync(f, '# Recall run\n\n## 1. q\n\nKey: the notice says go\n\nAnswer:\n\n> fine\n');
  assert.throws(() => blind(path.join(dir, 'out'), [f]), /still names a side/);
});

// why: guards rule:instruments-and-evals
test('recall-score (T2): a notice line goes and is logged, a Key line stays, and the order is shuffled', async () => {
  const { blind, dropNotice } = await import('../scripts/recall-score.mjs');
  const removed = [];
  assert.equal(dropNotice('Key: a kit build\n> keep\n> the notice says x', removed), 'Key: a kit build\n> keep');
  assert.deepEqual(removed, ['> the notice says x']);
  const dir = makeTemp('blind-');
  const runs = ['cand-1', 'cand-2', 'base-1'].map((n) => {
    const f = path.join(dir, `${n}.md`);
    fs.writeFileSync(f, `# Recall run: ${n}\n\n## 1. q\n\nKey: k\n\nAnswer:\n\n> ${n === 'base-1' ? 'plain' : 'the startup notice says go'}\n`);
    return f;
  });
  const out = path.join(dir, 'out');
  let calls = 0;
  const { map } = blind(out, runs, () => { calls++; return 0; });
  assert.equal(calls, 2);
  assert.notDeepEqual(Object.values(map), ['cand-1', 'cand-2', 'base-1'], 'the labels do not follow the input order');
  const sealed = JSON.parse(read(path.join(out, 'sealed-map.json')));
  assert.equal(sealed.hashes['cand-1.md'], crypto.createHash('sha256').update(read(runs[0])).digest('hex'));
  assert.match(read(path.join(out, 'removed-lines.txt')), /cand-1: > the startup notice says go/);
});

// why: guards rule:instruments-and-evals
test('recall-score (T2): the table keeps its columns and "worse" names only what the candidate lost', async () => {
  assert.equal((await import('../scripts/recall-score.mjs')).RUNS, 5, 'K198: 5 runs a side');
  const { summarize } = await import('../scripts/recall-score.mjs');
  const clean = [[], []];
  const { map, sets } = scoreSets(fiveEach([[[2], [2]], clean, clean, clean, clean], [[[1], [1]], clean, clean, clean, clean]));
  const r = summarize(sets, map, 14, { when: sameDay(map) });
  // Seen twice (the owner's pick, 2026-11-21): one look names what the candidate lost as lower.
  assert.deepEqual(r.lower, [2]);
  assert.ok(r.table.includes('| 1 | 1, 1, 1, 1, 1 | 0, 1, 1, 1, 1 | 0 |'), r.table.join('\n'));
  assert.ok(r.table.includes('| 2 | 0, 1, 1, 1, 1 | 1, 1, 1, 1, 1 | 0 |'), r.table.join('\n'));
});

// Carry 25: a second config folder can point the sessions somewhere other than the layer the gate checked.
// why: guards rule:instruments-and-evals
test('recall refuses when the CLI\'s own config folder is not the layer it checked', async () => {
  const { checkSessionHome } = await recallTools();
  const run =(out) => () => ({ status: 0, stdout: out, stderr: '' });
  const home = path.join(os.tmpdir(), 'layer-a');
  assert.throws(() => checkSessionHome(home, run(JSON.stringify({ configDirectory: path.join(os.tmpdir(), 'layer-b') }))), /sessions read .*layer-b/);
  assert.doesNotThrow(() => checkSessionHome(home, run(JSON.stringify({ configDirectory: home }))));
  assert.throws(() => checkSessionHome(home, run('not json')), /cannot read/);
  assert.throws(() => checkSessionHome(home, () => ({ status: 1, stdout: '', stderr: 'nope' })), /cannot read/);
});

// The 2026-11-21 paired run: the release arm ran on the real Claude folder, so ~/.claude/skills/pre-pr-sweep/approve.mjs
// was its own copy, while the branch arm on a throwaway reached the release's copy through the same ~ path. Every arm
// of a gate run now runs on its own throwaway Claude folder; a released real folder is refused before any session.
// why: guards rule:instruments-and-evals
test('a recall run refuses a Claude folder that is not a throwaway under kit-probes, before any session', async () => {
  const { checkGateHome } = await recallTools();
  assert.equal(typeof checkGateHome, 'function');
  const real = makeTemp('realhome-');
  fs.writeFileSync(path.join(real, 'kit-install.json'), JSON.stringify({ version: '1.47.0', release: true, files: {} }));
  const r = spawnSync(process.execPath, [RECALL, 'base-1'], { encoding: 'utf8', env: { ...process.env, KIT_CLAUDE_HOME: real, CLAUDE_CONFIG_DIR: real } });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /is not a throwaway Claude folder under .*kit-probes/);
  assert.doesNotMatch(r.stdout, /answered/);
  const probe = path.join(os.homedir(), 'kit-probes', 'abcdef', 'home');
  assert.doesNotThrow(() => checkGateHome(probe, os.homedir()));
  assert.throws(() => checkGateHome(path.join(os.homedir(), '.claude'), os.homedir()), /not a throwaway/);
});

// K137 (build 18, the 1.43.0 recall rounds): a run was made on rule text over its size cap, then trimmed, then run
// again, and extra runs were offered that decision 7 does not count. The run now refuses text over a cap before any
// session starts, and the score says when no extra run can count.
// why: catches a paid recall run started on rule text over its size cap
test('a recall run refuses rule text over its size cap before any session starts', () => {
  const kit = makeTemp('k137-');
  fs.mkdirSync(path.join(kit, 'rules'));
  fs.mkdirSync(path.join(kit, 'project'));
  fs.writeFileSync(path.join(kit, 'kit.config.json'), JSON.stringify({ caps: { module: 100, agentsMd: 200 } }));
  fs.writeFileSync(path.join(kit, 'rules', 'core.md'), 'x'.repeat(500));
  fs.writeFileSync(path.join(kit, 'rules', 'testing.md'), 'x'.repeat(101));
  fs.writeFileSync(path.join(kit, 'project', 'AGENTS.md'), 'x'.repeat(201));
  const r = spawnSync(process.execPath, [path.resolve('scripts/recall.mjs'), 'cand', kit], { encoding: 'utf8', env: { ...process.env, KIT_CLAUDE_HOME: path.join(kit, 'no-home') } });
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /testing\.md: 101 B, over its cap of 100 B/);
  assert.match(r.stderr, /AGENTS\.md: 201 B, over its cap of 200 B/);
  assert.doesNotMatch(r.stderr, /core\.md/, 'core.md has its own cap, through AGENTS.md');
  fs.writeFileSync(path.join(kit, 'rules', 'testing.md'), 'x'.repeat(100));
  fs.writeFileSync(path.join(kit, 'project', 'AGENTS.md'), 'x'.repeat(200));
  const ok = spawnSync(process.execPath, [path.resolve('scripts/recall.mjs'), 'cand', kit], { encoding: 'utf8', env: { ...process.env, KIT_CLAUDE_HOME: path.join(kit, 'no-home') } });
  assert.doesNotMatch(ok.stderr, /over its cap/, 'under the caps, the run goes on to its next check');
});
