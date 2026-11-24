// Tests for U14 (K377), pin ruling 8: owner-yes.cjs readers take an exact-key option (`keys`, read as given, no walk
// above the folder) and a faults option (`faults`, an array that receives each read error other than ENOENT).

import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { TAP_SID, makeTemp, ownerTaps } from './kit-helpers.mjs';

const ownerYes = createRequire(import.meta.url)(path.resolve('project/.claude/owner-yes.cjs'));
const ACT = 'sweep resume abc123';
// Folder keys are lowercase, as owner-yes.cjs compares them.
const OWN = 'c--exact-own';
const ABOVE = 'c--exact';

// why: catches an exact-key read that still walks to a folder above, or that reports no read error (K377 pin 8)
test('sessionLatest and sessionAnswers with keys read only the given folder key, and faults gets each read error but ENOENT', () => {
  const cfg = makeTemp('cfg-');
  const repo = makeTemp('repo-');
  const saved = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = cfg;
  try {
    const opts = (o) => ({ sessionId: TAP_SID, repo, ...o });
    // Control: with no keys, the repo's own folder and each one above it are read, as before.
    const aboveRepo = path.dirname(fs.realpathSync.native(repo)).replace(/[^A-Za-z0-9]/g, '-');
    ownerTaps(cfg, repo, ACT, { folder: aboveRepo });
    const walked = ownerYes.sessionLatest(ACT, opts({}));
    assert.ok(walked && walked.yes, 'the default read no longer finds a Yes in a folder above');
    // With keys naming a folder that holds nothing, the Yes above the repo is not read.
    fs.mkdirSync(path.join(cfg, 'projects', OWN), { recursive: true });
    assert.equal(ownerYes.sessionLatest(ACT, opts({ keys: [OWN] })), null, 'a folder above the given key was read');
    assert.deepEqual(ownerYes.sessionAnswers(ACT, opts({ keys: [OWN] })), [], 'sessionAnswers read a folder above the given key');
    // The Yes under exactly the given key is read, and the other folder's is not.
    ownerTaps(cfg, repo, ACT, { folder: OWN });
    ownerTaps(cfg, repo, ACT, { folder: ABOVE });
    const own = ownerYes.sessionLatest(ACT, opts({ keys: [OWN] }));
    assert.ok(own && own.yes && own.tap.startsWith(`${TAP_SID}:`), 'the Yes under the given key was not read');
    assert.equal(ownerYes.sessionAnswers(ACT, opts({ keys: [OWN] })).length, 1, 'sessionAnswers did not read the given key alone');
    // faults: a folder where the record file should be is a read error; a record that is not there is not.
    const faults = [];
    fs.mkdirSync(path.join(cfg, 'projects', 'c--exact-bad', `${TAP_SID}.jsonl`), { recursive: true });
    fs.mkdirSync(path.join(cfg, 'projects', 'c--exact-none'), { recursive: true });
    ownerYes.sessionLatest(ACT, opts({ keys: ['c--exact-none', 'c--exact-missing'], faults }));
    assert.deepEqual(faults, [], 'a record that is not there was reported as a fault');
    ownerYes.sessionLatest(ACT, opts({ keys: ['c--exact-bad'], faults }));
    assert.ok(faults.length >= 1, 'a record that cannot be read (a folder at the record file) was not reported');
    const more = [];
    ownerYes.sessionAnswers(ACT, opts({ keys: ['c--exact-bad'], faults: more }));
    assert.ok(more.length >= 1, 'sessionAnswers did not report a record that cannot be read');
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = saved;
  }
});
