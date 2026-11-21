// Build 22 sweep fixes (B22-C): a rule cue appears only when a message is really about that rule, the closeout cue only
// for the release that just went out, and no rule line sends a session to a fixed ~/.claude path.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeTemp } from './kit-helpers.mjs';

const ids = (kitTools, prompt) => kitTools.ruleCues({ kit: path.resolve('.'), prompt }).split('\n').filter(Boolean).map((l) => l.match(/^rule:([\w-]+)/)[1]);

// why: catches a cue that fires on everyday words (a push notification, a bot's PR comments, a user-agent string) and steers a session toward an outward act or a sweep
test('a rule cue fires on its rule\'s topic and stays quiet on everyday words that share a word', async () => {
  const kitTools = await import('../scripts/kit.mjs');
  assert.equal(typeof kitTools.ruleCues, 'function', 'the rule cues exist');
  const cueing = [
    ['My branch is ready. Can I push it and open the PR?', 'outward-acts'],
    ['Push the branch and open its PR.', 'outward-acts'],
    ['Push the branch.', 'outward-acts'],
    ['git push origin my-feature', 'outward-acts'],
    ['push the changes to origin', 'outward-acts'],
    ['The feature is done and green. What review is required before its PR?', 'pre-pr-deep-sweep'],
    ['run the pre-PR sweep', 'pre-pr-deep-sweep'],
    ['I want to run five review agents at once. What do I do first?', 'swarm-contract'],
    ['fan out three subagents over src/', 'swarm-contract'],
    // An idea for later IS the parking-lot rule's case, so this cue is right, not a false alarm.
    ['I have some ideas for the logo, we can do them later', 'parking-lot'],
  ];
  for (const [prompt, rule] of cueing) assert.deepEqual(ids(kitTools, prompt), [rule], prompt);
  const quiet = [
    'the push notifications on android are broken, fix them',
    'push back if you think this design is wrong',
    'can you review the comments the bot left on PR 12',
    'set the two user agents strings in the fetch client',
    'A review agent reported 9 findings. How do I handle them?',
  ];
  for (const prompt of quiet) assert.deepEqual(ids(kitTools, prompt), [], prompt);
});

// The cue quotes the kit's own CLAUDE.md template; a project may have edited its copy, so the label may not claim it.
// why: catches a cue that labels the kit's template as the project's own CLAUDE.md
test('the sweep cue names the kit\'s CLAUDE.md template, not the project\'s own file', async () => {
  const kitTools = await import('../scripts/kit.mjs');
  assert.equal(typeof kitTools.ruleCues, 'function', 'the rule cues exist');
  const line = kitTools.ruleCues({ kit: path.resolve('.'), prompt: 'run the pre-PR sweep' });
  assert.match(line, /^rule:pre-pr-deep-sweep \(the kit's CLAUDE\.md template\): /);
});

// A pasted log with no full stop made each cue regex scan to the end of the text: quadratic, hanging every prompt.
// why: guards rule:context-engineering
test('a 200 KB prompt of repeated words returns fast with no cue', async () => {
  const kitTools = await import('../scripts/kit.mjs');
  assert.equal(typeof kitTools.ruleCues, 'function', 'the rule cues exist');
  // Both words start a [^.?!]* scan in a cue's regex; with no full stop each scan runs to the end of the paste.
  const big = 'review ideas '.repeat(16000);
  const t0 = Date.now();
  const out = kitTools.ruleCues({ kit: path.resolve('.'), prompt: big });
  const ms = Date.now() - t0;
  assert.equal(out, '', 'no cue on filler');
  assert.ok(ms < 1000, `took ${ms} ms`);
});

function gitRepo() {
  const dir = makeTemp('closeout-newest-');
  const g = (...a) => {
    const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${a.join(' ')}: ${r.stderr}`);
  };
  g('init', '-q', '-b', 'main');
  return { dir, g };
}

// why: catches a closeout cue on an old release checked out to look at, or one chosen by name order instead of version order
test('the closeout cue fires only when HEAD is the newest release tag', async () => {
  const kitTools = await import('../scripts/kit.mjs');
  assert.equal(typeof kitTools.closeoutCue, 'function', 'the closeout cue exists');
  const { dir, g } = gitRepo();
  g('commit', '-q', '--allow-empty', '-m', 'feat: one');
  g('tag', 'v1.0.0');
  g('commit', '-q', '--allow-empty', '-m', 'feat: two');
  g('tag', 'v1.1.0');
  g('checkout', '-q', 'v1.0.0');
  assert.equal(kitTools.closeoutCue({ projectDir: dir, session: 's1', env: {} }), '', 'an old release is no cue');
  g('checkout', '-q', 'v1.1.0');
  assert.match(kitTools.closeoutCue({ projectDir: dir, session: 's1', env: {} }), /HEAD is the release v1\.1\.0/);
  assert.equal(kitTools.closeoutCue({ projectDir: dir, session: 's1', env: {} }), '', 'once per release');
  // Version order, not name order: 1.10.0 is newer than 1.9.0.
  g('checkout', '-q', 'main');
  g('commit', '-q', '--allow-empty', '-m', 'feat: three');
  g('tag', 'v1.9.0');
  g('commit', '-q', '--allow-empty', '-m', 'feat: four');
  g('tag', 'v1.10.0');
  g('checkout', '-q', 'v1.9.0');
  assert.equal(kitTools.closeoutCue({ projectDir: dir, session: 's1', env: {} }), '', '1.9.0 is older than 1.10.0');
  g('checkout', '-q', 'v1.10.0');
  assert.match(kitTools.closeoutCue({ projectDir: dir, session: 's1', env: {} }), /v1\.10\.0/);
});

// why: catches a rule line that names a file under a fixed ~/.claude path in the spellings the first check missed
test('fixedHomePaths reports ~/.claude/... and ~/.claude) and passes the Claude folder by name', async () => {
  const kitTools = await import('../scripts/kit.mjs');
  assert.equal(typeof kitTools.fixedHomePaths, 'function', 'fixedHomePaths exists');
  const root = makeTemp('fixed-home-spell-');
  fs.mkdirSync(path.join(root, 'rules'));
  fs.writeFileSync(path.join(root, 'rules', 'a.md'), [
    'in each spelling (Bash `~/.claude/...`, PowerShell the full path)',
    'run `kit.mjs install user` for ~/.claude), then start fresh',
    'run `kit.mjs install user` for {{CLAUDE_HOME}}, then start fresh',
    'run `kit.mjs install user` for the Claude config folder',
    'Your Claude folder (`~/.claude` by default) holds it.',
  ].join('\n'));
  assert.deepEqual(kitTools.fixedHomePaths({ kit: root }).map((h) => `${h.file}:${h.line}`), ['rules/a.md:1', 'rules/a.md:2']);
});
