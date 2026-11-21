// The kit as a Claude Code plugin (build 23b): K175 (the start-up hook finds the kit at the plugin root), E36 (one
// role table), K174 (build plugin and its launcher) and K179 (the marketplace pin and its release check).
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { caseKit, copyKitCli, makeTemp, sessionStartReport } from './kit-helpers.mjs';
import { build, buildPlugin, roleFiles } from '../scripts/kit.mjs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fwd = (p) => p.split(path.sep).join('/');

// K175 (proof sweep: "Methodology kit not found", and the prompt hook blocked every message): a plugin has no install
// step, so no Claude folder holds a kit-install.json naming the kit; the kit sits at <plugin root>/kit.
// why: guards rule:kit-standards: a plugin session that starts with no kit report and full-stops every message
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
  assert.match(JSON.parse(gate.stdout).reason, /\/kit:methodology-kit existing\b[^/]*\/kit:methodology-kit new/);
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
  // pin: 1 (Claude Code reads the frontmatter lines)
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
  assert.match(line, /^Kit roles: checker\b.*claude-c-1\b.*retiring; scanner\b.*claude-z-9\b.*not measured\b.*kit\.config\.json "roles"/);
  // A plugin's role files sit at its root.
  const root = makeTemp('plugin-root-');
  fs.mkdirSync(path.join(root, 'agents'));
  fs.writeFileSync(path.join(root, 'agents/builder.md'), '---\nname: builder\nmodel: claude-y-2\n---\n');
  assert.match(sessionStartReport({ kit, home, projectDir: proj, env: { CLAUDE_PLUGIN_ROOT: root }, ahead: () => ({ count: 0 }) }), /builder\b.*claude-y-2\b.*not measured/);
  // All measured and none retiring: no line.
  fs.writeFileSync(path.join(kit, 'kit.config.json'), JSON.stringify({ ownerName: 'Pat', roles: { builder: { model: 'claude-a-1', effort: 'high' } }, models: { measured: ['claude-a-1'], retiring: [] } }));
  assert.doesNotMatch(sessionStartReport({ kit, home, projectDir: proj, env: {}, ahead: () => ({ count: 0 }) }), /Kit roles:/);
});

// K174: one command turns the checked-out release into a plugin. The plugin root is the Claude-folder stand-in
// (kit-tools/, kit-hooks/, skills/, agents/, kit-install.json), so approve.mjs finds its helpers and the start-up
// line names real paths; the kit's own copy sits at kit/.
const RELEASE = { tag: 'v9.9.9', commit: 'a'.repeat(40) };
let built = null;
const plugin = () => {
  if (!built) { built = path.join(makeTemp('plugin-out-'), 'kit-plugin'); buildPlugin({ kit: path.resolve('.'), out: built, release: RELEASE }); }
  return built;
};
const tree = (dir) => {
  const out = {};
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out[fwd(path.relative(dir, p))] = fs.readFileSync(p).toString('base64'); } };
  walk(dir);
  return out;
};
// The launcher as Claude Code runs it: the hook input on stdin, the mode as its argument.
const launch = (root, input, mode, env = {}) => {
  const r = spawnSync(process.execPath, [path.join(root, 'launch.cjs'), ...(mode ? [mode] : [])], { input: JSON.stringify(input), encoding: 'utf8', timeout: 20000, env: { ...process.env, CLAUDE_PLUGIN_ROOT: root, ...env } });
  return { ...r, out: r.stdout.trim() ? JSON.parse(r.stdout) : null };
};
const decision = (o) => o && o.hookSpecificOutput && o.hookSpecificOutput.permissionDecision;
const reason = (o) => String(o && o.hookSpecificOutput && o.hookSpecificOutput.permissionDecisionReason);
const gitRepo = () => {
  const dir = makeTemp('plugin-repo-');
  const g = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-C', dir, ...a], { encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  g('add', '.');
  g('commit', '-q', '-m', 'first');
  return dir;
};

// why: catches a plugin build that differs between two runs on the same release, so no pinned build can be checked
test('build plugin writes the plugin layout, the same bytes on every run (K174)', () => {
  const root = plugin();
  const again = path.join(makeTemp('plugin-out-'), 'kit-plugin');
  buildPlugin({ kit: path.resolve('.'), out: again, release: RELEASE });
  const a = tree(root);
  assert.deepEqual(a, tree(again));
  const version = fs.readFileSync(path.resolve('VERSION'), 'utf8').trim();
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin/plugin.json'), 'utf8')), { name: 'kit', version, description: `Methodology kit ${version} as a Claude Code plugin (built by kit.mjs build plugin; never edited by hand)` });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'kit-build.json'), 'utf8')), { name: 'kit', version, tag: 'v9.9.9', commit: 'a'.repeat(40) });
  for (const f of ['launch.cjs', 'hooks/hooks.json', 'roles.json', 'guard-manifest.json', 'kit-install.json', 'kit-tools/kit-launch.cjs', 'kit-tools/kit-start.sh', 'kit-hooks/canary.cjs', 'skills/pre-pr-sweep/approve.mjs', 'agents/builder.md', 'kit/scripts/kit.mjs', 'kit/project/.claude/kit-hook.cjs', 'kit/project/.claude/guard.cjs']) assert.ok(a[f], f);
  assert.ok(!Object.keys(a).some((f) => f.startsWith('kit/tests/') || f.startsWith('kit/.git/')), 'no tests and no git folder in the kit copy');
  assert.equal(fs.readFileSync(path.join(root, 'launch.cjs'), 'utf8'), fs.readFileSync(path.resolve('user/kit-tools/plugin-launch.cjs'), 'utf8'));
  // Plugin agents' own hooks are ignored, so they move into roles.json, and the role file keeps the table's lines.
  const builder = fs.readFileSync(path.join(root, 'agents/builder.md'), 'utf8');
  assert.doesNotMatch(builder, /^hooks:/m);
  assert.match(builder, /^model: claude-sonnet-5-5\neffort: high$/m);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'skills/agent-team-build/SKILL.md'), 'utf8'), /\{\{CLAUDE_HOME\}\}/);
  const roles = JSON.parse(fs.readFileSync(path.join(root, 'roles.json'), 'utf8'));
  assert.deepEqual(roles.builder, { PreToolUse: [['SubagentHandback', 'canary.cjs'], ['Edit|Write|NotebookEdit', 'edit-fence.cjs']], Stop: ['canary.cjs'] });
  assert.deepEqual(roles.checker.Stop, ['canary.cjs', 'clean-tree.cjs']);
  // The manifest names every file a hook runs or loads, by its hash.
  const man = JSON.parse(fs.readFileSync(path.join(root, 'guard-manifest.json'), 'utf8')).files;
  for (const f of ['launch.cjs', 'hooks/hooks.json', 'roles.json', 'kit-install.json', 'kit-tools/kit-launch.cjs', 'kit-tools/kit-start.sh', 'kit-hooks/call-cap.cjs', 'kit/project/.claude/guard.cjs', 'kit/project/.claude/kit-hook.cjs', 'kit/scripts/kit.mjs', 'skills/pre-pr-sweep/approve.mjs']) {
    assert.equal(man[f], crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'), f);
  }
  // The stamp the kit's guard reads its user-layer hooks against.
  const stamp = JSON.parse(fs.readFileSync(path.join(root, 'kit-install.json'), 'utf8'));
  assert.equal(stamp.files['kit-hooks/call-cap.cjs'], man['kit-hooks/call-cap.cjs']);
  assert.equal(stamp.kitDir, undefined, 'no machine path: the start-up hook finds the kit at the plugin root (K175)');
});

// K216 (weekly 1120 item 1): a hook that cannot start applies a settings change, and a PreToolUse one lets the call
// through, unless the entry blocks on failure.
// why: guards rule:security-standards: a plugin hooks.json whose tool or settings guard fails open
test('the plugin hooks.json blocks on failure for PreToolUse and ConfigChange, and wires every event (K174, K216)', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(plugin(), 'hooks/hooks.json'), 'utf8')).hooks;
  assert.deepEqual(Object.keys(hooks).sort(), ['ConfigChange', 'PreToolUse', 'SessionStart', 'SubagentStop', 'UserPromptSubmit']);
  const pre = hooks.PreToolUse;
  assert.equal(pre.length, 1);
  assert.equal(pre[0].matcher, '.*');
  assert.equal(pre[0].hooks[0].onFailure, 'block');
  // K205's timed retry: every tool call starts through kit-start.sh, and a start script that cannot run still denies.
  // pin: 1 (Claude Code runs this exact line)
  assert.match(pre[0].hooks[0].command, /^NODE_OPTIONS= sh "\$\{CLAUDE_PLUGIN_ROOT\}\/kit-tools\/kit-start\.sh" "\$\(command -v node\)" "\$\{CLAUDE_PLUGIN_ROOT\}\/launch\.cjs" \|\| printf '%s' '.*"permissionDecision":"deny"/);
  assert.equal(hooks.ConfigChange[0].hooks[0].onFailure, 'block');
  assert.match(hooks.ConfigChange[0].hooks[0].command, /launch\.cjs" config-change$/);
  assert.match(hooks.SessionStart[0].hooks[0].command, /launch\.cjs" session-start$/);
  assert.match(hooks.UserPromptSubmit[0].hooks[0].command, /launch\.cjs" prompt$/);
  assert.match(hooks.SubagentStop[0].hooks[0].command, /launch\.cjs" subagent-stop$/);
  // The PreToolUse line, run as Claude Code runs it, reaches the launcher.
  const root = plugin();
  const repo = gitRepo();
  const line = pre[0].hooks[0].command.replaceAll('${CLAUDE_PLUGIN_ROOT}', root);
  const r = spawnSync('sh', ['-c', line], { input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: path.join(root, 'x.txt') }, cwd: repo }), encoding: 'utf8', timeout: 20000 });
  assert.match(reason(JSON.parse(r.stdout)), /plugin folder holds the guards/);
});

// why: guards rule:security-standards: a changed guard file in the plugin that still lets calls run
test('the plugin launcher refuses every call once one file in its manifest changed (K174)', () => {
  const src = plugin();
  const root = path.join(makeTemp('plugin-copy-'), 'kit-plugin');
  fs.cpSync(src, root, { recursive: true });
  const repo = gitRepo();
  const call = { tool_name: 'Bash', tool_input: { command: 'git status' }, cwd: repo, session_id: 's1' };
  const ok = launch(root, call);
  assert.equal(ok.status, 0, ok.stderr);
  assert.notEqual(decision(ok.out), 'deny', JSON.stringify(ok.out));
  fs.appendFileSync(path.join(root, 'kit-hooks', 'call-cap.cjs'), '\n// one line more\n');
  const held = launch(root, call);
  assert.equal(decision(held.out), 'deny');
  assert.match(reason(held.out), /differ\b.*\(kit-hooks\/call-cap\.cjs\)/);
  // A manifest that is gone holds every call too.
  fs.rmSync(path.join(root, 'guard-manifest.json'));
  assert.match(reason(launch(root, call).out), /guard-manifest\.json/);
});

// why: guards rule:security-standards: a session that edits the plugin's own guard files and so turns them off
test('the plugin launcher refuses a write into the plugin folder, and lets a kit tool run from it (K174)', () => {
  const root = plugin();
  const repo = gitRepo();
  for (const [tool, input] of [['Write', { file_path: path.join(root, 'kit-hooks', 'canary.cjs'), content: '' }], ['Edit', { file_path: path.join(root, 'launch.cjs') }], ['Bash', { command: `echo x > "${root}/launch.cjs"` }], ['Bash', { command: 'rm -rf "$CLAUDE_PLUGIN_ROOT"' }], ['Bash', { command: `node "${fwd(root)}/kit-tools/merge-gate.mjs" > "${fwd(root)}/kit-tools/x"` }]]) {
    const r = launch(root, { tool_name: tool, tool_input: input, cwd: repo });
    assert.equal(decision(r.out), 'deny', `${tool} ${JSON.stringify(input)}`);
    assert.match(reason(r.out), /plugin folder/);
  }
  const run = launch(root, { tool_name: 'Bash', tool_input: { command: `node "${fwd(root)}/skills/pre-pr-sweep/approve.mjs" --help` }, cwd: repo });
  assert.doesNotMatch(reason(run.out), /plugin folder|another Claude folder/);
});

// The build 23b sweep: the plugin launcher never ran the grant-tool hold the PC launcher runs, and it found the plugin
// folder in a command only by its exact spelling, so ./, a doubled slash, .. or a wildcard from the parent reached it.
// why: guards rule:outward-acts: a plugin worker that grants itself, or rewrites the plugin's guards by another spelling
test('the plugin launcher holds a run of the grant tool and every spelling of the plugin folder', () => {
  const root = plugin();
  const repo = gitRepo();
  const parent = fwd(path.dirname(root));
  const base = path.basename(root);
  const run = (command) => launch(root, { tool_name: 'Bash', tool_input: { command }, cwd: repo, session_id: '11111111-2222-3333-4444-555555555555' });
  const g = run(`node "${fwd(root)}/kit-tools/grant.mjs" 11111111-2222-3333-4444-555555555555 Bash "git push origin main" c1`);
  assert.equal(decision(g.out), 'deny', JSON.stringify(g.out));
  assert.match(reason(g.out), /grant\.mjs records the owner's tap/);
  // The commit security review: a home folder or variable spelled for the shell to expand reaches it too.
  const home = fwd(os.homedir());
  if (fwd(root).startsWith(`${home}/`)) for (const c of [`echo x > ~/${fwd(root).slice(home.length + 1)}/launch.cjs`, `echo x > $HOME/${fwd(root).slice(home.length + 1)}/launch.cjs`]) assert.equal(decision(run(c).out), 'deny', c);
  for (const c of [`echo x > "${parent}/{${base},other}/launch.cjs"`, `echo x > "${parent}/$X/launch.cjs"`]) assert.equal(decision(run(c).out), 'deny', c);
  for (const c of [`echo x > "${parent}/./${base}/launch.cjs"`, `echo x > "${parent}//${base}/launch.cjs"`, `echo x > "${fwd(root)}/../${base}/launch.cjs"`, `cd "${parent}" && echo x > ${base.slice(0, 4)}*/launch.cjs`]) {
    const r = run(c);
    assert.equal(decision(r.out), 'deny', c);
    assert.match(reason(r.out), /plugin folder/, c);
  }
});

// K206 P3: a kit tool from another Claude folder than the plugin's own is refused, with this session's command.
// why: guards rule:security-standards: a plugin session that runs another Claude folder's approve.mjs
test('the plugin launcher denies another Claude folder\'s approve.mjs (K174, K206)', () => {
  const root = plugin();
  const other = makeTemp('other-cfg-');
  fs.mkdirSync(path.join(other, 'skills/pre-pr-sweep'), { recursive: true });
  fs.writeFileSync(path.join(other, 'skills/pre-pr-sweep/approve.mjs'), '');
  fs.writeFileSync(path.join(other, 'kit-install.json'), '{}');
  const r = launch(root, { tool_name: 'Bash', tool_input: { command: `node "${fwd(other)}/skills/pre-pr-sweep/approve.mjs" sweeps/c.json` }, cwd: gitRepo() });
  assert.equal(decision(r.out), 'deny');
  assert.ok(reason(r.out).includes(`from another Claude folder (${fwd(other)})`), reason(r.out));
  assert.ok(reason(r.out).includes(`node ${fwd(root)}/skills/pre-pr-sweep/approve.mjs`), reason(r.out));
});

// The proof (gap-fixes r9): plugin agents ignore the hooks: block in their own file, so the launcher runs them by
// agent_type, which Claude Code hands every hook of a subagent's call.
// why: guards rule:agent-role-table: a plugin builder that edits outside its worktree, or a checker that changes files, unheld
test('the plugin launcher runs each role\'s hooks for the matching agent_type (K174)', () => {
  const root = plugin();
  const repo = gitRepo();
  const outside = path.join(makeTemp('outside-'), 'x.txt');
  const write = (agent) => launch(root, { tool_name: 'Write', tool_input: { file_path: outside, content: 'x' }, cwd: repo, agent_type: agent, agent_id: 'a1', session_id: 's2', hook_event_name: 'PreToolUse' });
  const fenced = write('kit:builder');
  assert.equal(decision(fenced.out), 'deny');
  assert.match(reason(fenced.out), /outside this builder's worktree/);
  assert.doesNotMatch(reason(write('kit:scanner').out), /outside this builder's worktree/);
  // The checker's clean-tree pair: a snapshot at its first shell call, and its stop held when files changed since.
  const sid = `s3-${process.pid}`;
  launch(root, { tool_name: 'Bash', tool_input: { command: 'git status' }, cwd: repo, agent_type: 'kit:checker', agent_id: 'c1', session_id: sid, hook_event_name: 'PreToolUse' });
  fs.writeFileSync(path.join(repo, 'a.txt'), 'changed\n');
  const stop = launch(root, { cwd: repo, agent_type: 'kit:checker', agent_id: 'c1', session_id: sid, hook_event_name: 'SubagentStop', stop_hook_active: false }, 'subagent-stop');
  assert.equal(stop.status, 2);
  assert.match(stop.stderr, /A checker never changes files/);
  // Another role's stop runs no checker hook.
  const other = launch(root, { cwd: repo, agent_type: 'kit:builder', agent_id: 'b1', session_id: sid, hook_event_name: 'SubagentStop' }, 'subagent-stop');
  assert.equal(other.status, 0);
});

// K176's hook point: a card grant may lift an "Owner's yes needed" hold for the main session's own call, never a
// subagent's; with no owner-grant.cjs beside the launcher, or one that throws, the hold stands.
// why: catches an owner's hold that a grant file lifts for a subagent, or that a broken grant file drops
test('the plugin launcher hands an owner\'s hold to owner-grant.cjs only for a main-session call (K174, K176)', () => {
  const lib = createRequire(import.meta.url)(path.resolve('user/kit-tools/plugin-launch.cjs'));
  const hold = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: "Owner's yes needed: git push origin main." } };
  const dir = makeTemp('grant-');
  assert.equal(lib.liftOwnerHold(hold, { tool_name: 'Bash' }, dir), hold, 'no grant file: the hold stands');
  fs.mkdirSync(path.join(dir, 'kit-tools'));
  fs.writeFileSync(path.join(dir, 'kit-tools', 'owner-grant.cjs'), 'exports.lift = (answer, input, home) => ({ lifted: true, home, tool: input.tool_name });');
  assert.deepEqual(lib.liftOwnerHold(hold, { tool_name: 'Bash' }, dir), { lifted: true, home: dir, tool: 'Bash' });
  assert.equal(lib.liftOwnerHold(hold, { tool_name: 'Bash', agent_id: 'a1' }, dir), hold, 'a subagent\'s call is never lifted');
  const other = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Never by a tool: x.' } };
  assert.equal(lib.liftOwnerHold(other, { tool_name: 'Bash' }, dir), other, 'only an owner\'s hold is handed over');
  const broken = makeTemp('grant-');
  fs.mkdirSync(path.join(broken, 'kit-tools'));
  fs.writeFileSync(path.join(broken, 'kit-tools', 'owner-grant.cjs'), 'exports.lift = () => { throw new Error("x"); };');
  assert.equal(lib.liftOwnerHold(hold, { tool_name: 'Bash' }, broken), hold);
});

// The build 23b sweep: the plugin's lift was tested only with a stub, and the real grant file at the plugin root could
// not load its owner-yes helper, so no grant ever lifted a hold in a plugin session. A real build, a real grant.
// why: guards rule:outward-acts: the owner's card yes that never reaches the plugin worker it was given for
test('in a built plugin a real grant lifts the owner\'s hold it names once, then the hold is back', () => {
  const root = fs.mkdtempSync(path.join(makeTemp('plugin-grant-'), 'kit-'));
  fs.rmSync(root, { recursive: true });
  buildPlugin({ kit: path.resolve('.'), out: root, release: RELEASE });
  const repo = gitRepo();
  const SID = '11111111-2222-3333-4444-555555555555';
  const act = 'git push origin main';
  const call = (id) => launch(root, { tool_name: 'Bash', tool_input: { command: act }, cwd: repo, session_id: SID, tool_use_id: id, hook_event_name: 'PreToolUse' });
  const before = call('toolu_1');
  assert.equal(decision(before.out), 'deny', JSON.stringify(before.out));
  assert.match(reason(before.out), /^Owner's yes needed/);
  createRequire(import.meta.url)(path.resolve('user/kit-tools/owner-grant.cjs')).writeGrant({ home: root, session: SID, tool: 'Bash', act, card: 'cmsg_c1' });
  const lifted = call('toolu_2');
  assert.equal(decision(lifted.out), 'allow', JSON.stringify(lifted.out));
  assert.match(reason(lifted.out), /card cmsg_c1/);
  assert.equal(decision(call('toolu_3').out), 'deny', 'spent');
});

// K179: the marketplace file pins the plugin to the release tag and the plugin repo's commit (a git-subdir source, as
// proven locally: a wrong sha refused the install), and a build is refused off a clean release.
// why: guards rule:security-standards: a marketplace entry that follows a moving branch, or a build from a changed folder
test('build plugin writes the marketplace pinned to tag and commit, and refuses a folder off its release (K179)', () => {
  const kit = path.join(makeTemp('plugin-rel-'), 'kit');
  fs.mkdirSync(kit);
  const tar = spawnSync('git', ['archive', '--format=tar', 'HEAD'], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
  spawnSync('tar', ['-x', '-C', kit], { input: tar.stdout });
  const g = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-C', kit, ...a], { encoding: 'utf8' });
  const version = fs.readFileSync(path.join(kit, 'VERSION'), 'utf8').trim();
  g('init', '-q', '-b', 'main'); g('add', '-A'); g('commit', '-q', '-m', 'release'); g('tag', `v${version}`);
  const commit = g('rev-parse', 'HEAD').stdout.trim();
  const out = path.join(makeTemp('plugin-pub-'), 'plugins', 'kit');
  const market = path.join(path.dirname(path.dirname(out)), '.claude-plugin', 'marketplace.json');
  const cli = (...a) => spawnSync(process.execPath, [path.join(kit, 'scripts/kit.mjs'), 'build', 'plugin', '--out', out, ...a], { encoding: 'utf8', timeout: 60000, env: { ...process.env, CLAUDE_CODE_REMOTE: '' } });
  const pluginSha = 'c'.repeat(40);
  const r = cli('--marketplace', market, '--sha', pluginSha);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(market, 'utf8')).plugins[0].source, { source: 'git-subdir', url: 'https://github.com/GoudyMT/kit-plugin.git', path: 'plugins/kit', ref: `v${version}`, sha: pluginSha });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'kit-build.json'), 'utf8')), { name: 'kit', version, tag: `v${version}`, commit });
  assert.match(cli('--marketplace', market, '--sha', 'main').stderr, /40 hex/);
  fs.appendFileSync(path.join(kit, 'user/kit-hooks/canary.cjs'), '\n');
  const dirty = cli();
  assert.equal(dirty.status, 1);
  assert.match(dirty.stderr, /build plugin refused: .*not a clean release/);
});
