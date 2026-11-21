// The kit as a Claude Code plugin (build 23b): K175 (the start-up hook finds the kit at the plugin root), E36 (one
// role table), K174 (build plugin and its launcher) and K179 (the marketplace pin and its release check).
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { caseKit, copyKitCli, makeTemp, sessionStartReport } from './kit-helpers.mjs';
import { build, roleFiles } from '../scripts/kit.mjs';

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

// E36 (proof sweep: five model lines coded by hand, and no check when one names a model the kit never measured): one
// table in kit.config.json names each role's model and effort, and build writes the role files' lines from it.
// why: catches a role file whose model or effort line drifts from the role table
test('build writes each role file\'s model and effort lines from the role table (E36)', () => {
  const kit = makeTemp('roles-kit-');
  fs.mkdirSync(path.join(kit, 'user/agents'), { recursive: true });
  fs.writeFileSync(path.join(kit, 'kit.config.json'), JSON.stringify({ roles: { builder: { model: 'claude-new-1', effort: 'low' } } }));
  fs.writeFileSync(path.join(kit, 'user/agents/builder.md'), '---\nname: builder\nmodel: claude-old-0\neffort: high\ntools: Read\n---\n\nmodel: in the body stays\n');
  fs.writeFileSync(path.join(kit, 'user/agents/other.md'), '---\nname: other\nmodel: claude-old-0\n---\n');
  const out = roleFiles(kit);
  assert.deepEqual([...out.keys()], ['user/agents/builder.md']);
  assert.equal(out.get('user/agents/builder.md'), '---\nname: builder\nmodel: claude-new-1\neffort: low\ntools: Read\n---\n\nmodel: in the body stays\n');
  // The real kit: every role file the table names is a role file, and each carries the table's lines.
  const table = JSON.parse(fs.readFileSync(path.resolve('kit.config.json'), 'utf8')).roles;
  assert.deepEqual(Object.keys(table).sort(), fs.readdirSync(path.resolve('user/agents')).map((n) => n.replace(/\.md$/, '')).sort());
  for (const [role, { model, effort }] of Object.entries(table)) {
    const text = fs.readFileSync(path.resolve(`user/agents/${role}.md`), 'utf8');
    assert.match(text, new RegExp(`^model: ${esc(model)}\\neffort: ${esc(effort)}$`, 'm'), role);
  }
  assert.ok(build({ kit: path.resolve('.') }).has('user/agents/reviewer.md'), 'the fresh-build test holds the role files to the table');
});

// E36: a role on a model the kit never measured, or one marked retiring, is named at session start, once per role.
// why: catches a role moved to an unmeasured or retiring model with no word to the owner
test('session start names a role on a model the kit has not measured or marks retiring (E36)', () => {
  const { kit, home, proj } = caseKit();
  fs.writeFileSync(path.join(kit, 'kit.config.json'), JSON.stringify({ ownerName: 'Pat', roles: { builder: { model: 'claude-a-1', effort: 'high' }, scanner: { model: 'claude-b-1', effort: 'low' }, checker: { model: 'claude-c-1', effort: 'high' } }, models: { measured: ['claude-a-1', 'claude-b-1', 'claude-c-1'], retiring: ['claude-c-1'] } }));
  fs.mkdirSync(path.join(home, 'agents'), { recursive: true });
  // The installed role file wins over the table: the owner moved the scanner by hand.
  fs.writeFileSync(path.join(home, 'agents/scanner.md'), '---\nname: scanner\nmodel: claude-z-9\n---\n');
  const text = sessionStartReport({ kit, home, projectDir: proj, env: {}, ahead: () => ({ count: 0 }) });
  const line = text.split('\n').find((l) => l.startsWith('Kit roles:'));
  assert.equal(line, 'Kit roles: checker runs on claude-c-1, which is marked retiring; scanner runs on claude-z-9, which the kit has not measured its roles on. Move the role in kit.config.json "roles" (then build and install user), or measure the model first.');
  // A plugin's role files sit at its root.
  const root = makeTemp('plugin-root-');
  fs.mkdirSync(path.join(root, 'agents'));
  fs.writeFileSync(path.join(root, 'agents/builder.md'), '---\nname: builder\nmodel: claude-y-2\n---\n');
  assert.match(sessionStartReport({ kit, home, projectDir: proj, env: { CLAUDE_PLUGIN_ROOT: root }, ahead: () => ({ count: 0 }) }), /builder runs on claude-y-2, which the kit has not measured/);
  // All measured and none retiring: no line.
  fs.writeFileSync(path.join(kit, 'kit.config.json'), JSON.stringify({ ownerName: 'Pat', roles: { builder: { model: 'claude-a-1', effort: 'high' } }, models: { measured: ['claude-a-1'], retiring: [] } }));
  assert.doesNotMatch(sessionStartReport({ kit, home, projectDir: proj, env: {}, ahead: () => ({ count: 0 }) }), /Kit roles:/);
});
