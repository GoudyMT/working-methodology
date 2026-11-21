// K206 (pulled into build 22 by the owner's pick, 2026-11-21): kit text named tools at a fixed ~/.claude path, and ~ is
// always the real home, so a session on another Claude folder (a throwaway, a probe, a plugin) ran the wrong copy.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fixedHomePaths } from '../scripts/kit.mjs';
import { caseKit, makeTemp, sessionStartReport } from './kit-helpers.mjs';

// P1: session start names this session's own commands, spelled as the allow rules spell them: ~/.claude for the
// default folder, the full forward-slash path otherwise, a plugin's root under a plugin.
// why: catches a session sent to another Claude folder's approve.mjs or merge gate than its own
test('session start names this session\'s kit tool commands, in the allow rules\' spelling (K206)', () => {
  const { kit, home, proj } = caseKit();
  const full = home.split(path.sep).join('/');
  const own = sessionStartReport({ kit, home, projectDir: proj, env: {} });
  assert.match(own, new RegExp(`^Kit tools this session: sweep approval node ${full.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/skills/pre-pr-sweep/approve\\.mjs; merge gate node ${full.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/kit-tools/merge-gate\\.mjs`, 'm'));
  const tilde = sessionStartReport({ kit, home: path.join(os.homedir(), '.claude'), projectDir: proj, env: {} });
  // pin: 1 (the allow rules match this exact spelling)
  assert.match(tilde, /^Kit tools this session: sweep approval node ~\/\.claude\/skills\/pre-pr-sweep\/approve\.mjs; merge gate node ~\/\.claude\/kit-tools\/merge-gate\.mjs \(PowerShell: the full paths, .*\/\.claude\/skills\/pre-pr-sweep\/approve\.mjs and .*\/\.claude\/kit-tools\/merge-gate\.mjs\)/m);
  const plugin = path.join(kit, 'plugin-root');
  assert.match(sessionStartReport({ kit, home, projectDir: proj, env: { CLAUDE_PLUGIN_ROOT: plugin } }), new RegExp(`sweep approval node ${plugin.split(path.sep).join('/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/skills/`));
});

// K206 P4: instruction text that names a file under a fixed ~/.claude sends a session on another Claude folder to the
// wrong copy. The folder alone, as the default place, is fine.
// why: catches shipped rule, skill, agent or hook text that names a kit tool at a fixed ~/.claude path
test('no shipped instruction names a file under a fixed ~/.claude path, and build refuses one (K206)', () => {
  assert.deepEqual(fixedHomePaths({ kit: path.resolve('.') }), [], 'name the tool and point to the start-up line');
  const root = makeTemp('fixed-home-');
  fs.mkdirSync(path.join(root, 'rules'));
  fs.mkdirSync(path.join(root, 'project/.githooks'), { recursive: true });
  fs.writeFileSync(path.join(root, 'rules', 'a.md'), 'Your Claude folder (`~/.claude` by default) holds it.\nRun `~/.claude/skills/pre-pr-sweep/approve.mjs`.\n');
  fs.writeFileSync(path.join(root, 'project/.githooks', 'pre-push'), 'echo "run node $HOME/.claude/kit-tools/merge-gate.mjs disarm"\n');
  assert.deepEqual(fixedHomePaths({ kit: root }).map((h) => `${h.file}:${h.line}`), ['project/.githooks/pre-push:1', 'rules/a.md:2']);
});
