// The kit as a Claude Code plugin (build 23b): K175 (the start-up hook finds the kit at the plugin root), E36 (one
// role table), K174 (build plugin and its launcher) and K179 (the marketplace pin and its release check).
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { caseKit, copyKitCli, makeTemp } from './kit-helpers.mjs';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fwd = (p) => p.split(path.sep).join('/');

// K175 (proof sweep: "Methodology kit not found", and the prompt hook blocked every message): a plugin has no install
// step, so no Claude folder holds a kit-install.json naming the kit; the kit sits at <plugin root>/kit.
// why: catches a plugin session that starts with no kit report and full-stops every message
test('under a plugin the start-up hook finds the kit at the plugin root and names /kit:methodology-kit (K175)', () => {
  const { kit } = caseKit();
  copyKitCli(kit);
  const root = path.dirname(kit);
  const empty = makeTemp('plugin-cfg-');
  const fresh = makeTemp('plugin-proj-');
  const hook = path.resolve('project/.claude/kit-hook.cjs');
  const run = (mode, input, env = {}) => spawnSync(process.execPath, [hook, mode], { cwd: fresh, input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, KIT_CLAUDE_HOME: empty, CLAUDE_PROJECT_DIR: fresh, CLAUDE_PLUGIN_ROOT: root, ...env } });
  const start = run('session-start', { source: 'startup' });
  assert.equal(start.status, 0, start.stderr);
  const text = JSON.parse(start.stdout).hookSpecificOutput.additionalContext;
  assert.match(text, new RegExp(`^Kit tools this session: sweep approval node ${esc(fwd(root))}/skills/pre-pr-sweep/approve\\.mjs`, 'm'));
  assert.match(text, /Run \/kit:methodology-kit existing to adopt kit 1\.0\.0/);
  assert.doesNotMatch(text, /(^|[^:])\/methodology-kit/);
  const prompt = run('prompt', { prompt: 'go' });
  assert.equal(prompt.status, 0);
  assert.doesNotMatch(prompt.stdout, /"decision"\s*:\s*"block"/);
  // Without a plugin the same empty folder is still the full stop, and names the plain skill.
  const bare = run('prompt', { prompt: 'go' }, { CLAUDE_PLUGIN_ROOT: '' });
  assert.match(JSON.parse(bare.stdout).decision, /block/);
  // The kit gate's full stop in a folder with no kit names the plugin's skill too.
  const gate = spawnSync(process.execPath, [path.resolve('user/kit-hooks/kit-gate.cjs')], { cwd: fresh, input: JSON.stringify({ prompt: 'go', cwd: fresh }), encoding: 'utf8', env: { ...process.env, KIT_CLAUDE_HOME: empty, CLAUDE_PLUGIN_ROOT: root } });
  assert.match(JSON.parse(gate.stdout).reason, /send \/kit:methodology-kit existing here \(or \/kit:methodology-kit new/);
});
