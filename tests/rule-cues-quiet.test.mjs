// Build 22 sweep fixes (B22-C): a rule cue appears only when a message is really about that rule, the closeout cue only
// for the release that just went out, and no rule line sends a session to a fixed ~/.claude path.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';

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

// why: catches a regex that runs quadratic on a large paste with no full stop, hanging every prompt
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
