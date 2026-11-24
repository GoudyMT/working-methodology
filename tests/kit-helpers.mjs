// The helpers the kit-*.test.mjs files share, moved out of tests/kit.test.mjs whole (T10, build 18).
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
// Tests for scripts/kit.mjs - each one drives the CLI functions the way the owner does:
// a fake kit, a fake ~/.claude and a fake project in a temp folder.
export const require = createRequire(import.meta.url);
// The status and session-start reports read the machine's Claude Code by default; a test names its own version, so the
// suite's result does not rest on which Claude Code is installed (the 1.23.0 sweep). A test of the version reads passes its own.
export const status = (o) => kitStatus({ claudeVersion: () => '2.1.325 (Claude Code)', ...o });
export const sessionStartReport = (o) => kitSessionStart({ claudeVersion: () => '2.1.325 (Claude Code)', ...o });

// Every temp folder a test makes lands under this one root, removed at exit: os.tmpdir() reads these on each call and children inherit them.
// kit-temp.cjs also removes it on a signal, and the next run sweeps it after a kill.
export const tmpRoot = kitTemp.sessionRoot();
export const { makeTemp } = kitTemp;

// A kit folder's CLI is scripts/kit.mjs with the temp helper it imports, as in every real kit folder.
export function copyKitCli(kit) {
  fs.mkdirSync(path.join(kit, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(kit, 'project/.claude'), { recursive: true });
  fs.copyFileSync(path.resolve('scripts/kit.mjs'), path.join(kit, 'scripts/kit.mjs'));
  fs.copyFileSync(path.resolve('project/.claude/kit-temp.cjs'), path.join(kit, 'project/.claude/kit-temp.cjs'));
  // The retired-wording check the session-start report reads (build 20).
  for (const f of ['retired-check.mjs', 'retired-wording.json']) fs.copyFileSync(path.resolve('project/.claude', f), path.join(kit, 'project/.claude', f));
  // The report channel's start-up lines (build 21) and what it imports.
  for (const f of ['kit-report.mjs', 'report-scrub.mjs', 'list-data.mjs', 'secret-patterns.mjs', 'owner-yes.cjs', 'safe-spawn.cjs']) fs.copyFileSync(path.resolve('project/.claude', f), path.join(kit, 'project/.claude', f));
  // The guard launcher, which kit.mjs reads its record names and entries from (1.25.1).
  fs.mkdirSync(path.join(kit, 'user/kit-tools'), { recursive: true });
  fs.copyFileSync(path.resolve('user/kit-tools/kit-launch.cjs'), path.join(kit, 'user/kit-tools/kit-launch.cjs'));
  // The merge-on-green steps install prints (K61), which read row A27 as the merge gate does.
  for (const f of ['merge-on-green.mjs', 'safe-git.mjs']) fs.copyFileSync(path.resolve('scripts', f), path.join(kit, 'scripts', f));
  for (const f of ['merge-gate.mjs', 'kit-temp.cjs']) fs.copyFileSync(path.resolve('user/kit-tools', f), path.join(kit, 'user/kit-tools', f));
  // The slot list module (K315, build 24): copied only where it exists, so the other fixtures still install before it is built.
  if (fs.existsSync(path.resolve('user/skills/pre-pr-sweep/slots.mjs'))) {
    fs.mkdirSync(path.join(kit, 'user/skills/pre-pr-sweep'), { recursive: true });
    fs.copyFileSync(path.resolve('user/skills/pre-pr-sweep/slots.mjs'), path.join(kit, 'user/skills/pre-pr-sweep/slots.mjs'));
  }
}

export function makeKit() {
  const root = makeTemp('kit-');
  const kit = path.join(root, 'kit');
  const home = path.join(root, 'home');
  const proj = path.join(root, 'My App');
  const files = {
    'VERSION': '1.0.0\n',
    'CHANGELOG.md': '# Changelog\n',
    'kit.config.json': JSON.stringify({ ownerName: 'Pat', thirdPartySkills: ['vendor-skill'] }),
    'user/CLAUDE.md': '# Global\nOwner: {{OWNER_NAME}}\n{{OWNER_PROFILE}}\n',
    'user/agents/builder.md': 'builder role\n',
    'user/skills/human-factor/SKILL.md': 'skill\n',
    'project/_Working Standards.md': 'rules\n',
    'project/.claude/settings.json': '{"hook":"{{PROJECT_DIR}}/.claude/guard.cjs"}\n',
    'memory/MEMORY.md': '- [Style](style.md)\n',
    'memory/style.md': 'style rule\n',
  };
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(kit, rel)), { recursive: true });
    fs.writeFileSync(path.join(kit, rel), body);
  }
  fs.mkdirSync(proj);
  // K141: the owner's profile lives in the Claude folder, outside the kit repo, which is public.
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'kit-owner-profile.md'), '- Likes tests\n');
  return { kit, home, proj };
}

export const read = (p) => fs.readFileSync(p, 'utf8');

// A release install checks every byte against the release tag's tree (the 1.26.0 security review, S4), so a fixture
// that installs as a release commits its kit folder and hands over that commit's tree.
export function released(kit, describe) {
  const g = (...a) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-C', kit, ...a], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  if (!fs.existsSync(path.join(kit, '.git'))) g('init', '-q', '-b', 'main');
  g('add', '-A');
  g('commit', '-q', '--allow-empty', '-m', describe);
  return { release: true, describe, tree: g('rev-parse', 'HEAD^{tree}') };
}

// Snapshot fixtures: a fake installed plugin and a fake third-party skill, laid out the way
// Claude Code stores them (plugins/installed_plugins.json -> installPath; skills/<name>/).
export function addThirdParty({ kit, home }) {
  const pluginDir = path.join(home, 'plugins/cache/market/toolbox/2.0.0');
  const put = (p, body) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); };
  put(path.join(pluginDir, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'toolbox', version: '2.0.0', author: { name: 'Jo Smith' } }));
  put(path.join(pluginDir, 'LICENSE'), 'MIT License\n\nCopyright (c) Jo Smith\n');
  put(path.join(pluginDir, 'skills/sharpen/SKILL.md'), 'sharpen\n');
  put(path.join(pluginDir, '.in_use'), 'lock\n');
  put(path.join(home, 'plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: {
    // Claude Code keeps one entry per scope; the newest one is the copy in use.
    'toolbox@market': [
      { scope: 'user', installPath: pluginDir, version: '2.0.0', gitCommitSha: 'abc123', lastUpdated: '2026-10-20T00:00:00Z' },
      { scope: 'project', installPath: pluginDir, version: '1.0.0', gitCommitSha: 'old', lastUpdated: '2026-01-01T00:00:00Z' },
    ],
  } }));
  put(path.join(home, 'plugins/known_marketplaces.json'), JSON.stringify({ market: { source: { source: 'github', repo: 'owner/market' } } }));
  put(path.join(home, 'skills/vendor-skill/SKILL.md'), 'vendor\n');
  const config = JSON.parse(read(path.join(kit, 'kit.config.json')));
  config.vendor = {
    plugins: ['toolbox', 'gone-plugin'],
    skillGroups: [{ name: 'vendor-pack', source: 'https://example.com/pack', license: 'Apache-2.0',
      copyright: 'Pack Authors', licenseFrom: 'plugin:toolbox', skills: ['vendor-skill'] }],
    // A plugin whose metadata leaves out its maker gets the credit written in by hand.
    credits: { toolbox: { author: 'Jo Smith and Co' } },
  };
  fs.writeFileSync(path.join(kit, 'kit.config.json'), JSON.stringify(config));
}

export function hashTree(dir) {
  const out = {};
  const walkAll = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walkAll(p); else out[p] = read(p);
  } };
  if (fs.existsSync(dir)) walkAll(dir);
  return out;
}

export function caseKit() {
  const ctx = makeKit();
  const catalog = { cases: [
    { id: 'ui-ux', name: 'UI/UX design or review', when: 'a screen, flow or copy changes', skills: ['design:design-critique', 'human-factor'] },
    { id: 'debugging', name: 'Debugging', when: 'a bug or failing test', skills: ['superpowers:systematic-debugging'] },
  ] };
  fs.mkdirSync(path.join(ctx.kit, 'project/.claude/kit'), { recursive: true });
  fs.writeFileSync(path.join(ctx.kit, 'project/.claude/kit/skill-cases.json'), JSON.stringify(catalog));
  fs.writeFileSync(path.join(ctx.kit, 'CHANGELOG.md'), '# Changelog\n\n## 1.0.0 - 2026-01-01\n- first\n');
  install({ kit: ctx.kit, home: ctx.home, target: 'project', projectDir: ctx.proj });
  return ctx;
}

// The 1.23.0 security review: on Windows cmd looks in the current folder first, and session start runs in the
// project, so a claude.cmd planted there would run on every session start.
// A machine as it ships: this sandbox sets NoDefaultCurrentDirectoryInExePath; most machines do not.
export const withoutSafeSearch = (env) => Object.fromEntries(Object.entries(env).filter(([k]) => k.toLowerCase() !== 'nodefaultcurrentdirectoryinexepath'));

export function gitProject() {
  const ctx = caseKit();
  const git = (...a) => spawnSync('git', ['-C', ctx.proj, ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(ctx.proj, '.gitignore'), '*.md\n.env\n.dev.vars\nnotes/\n');
  fs.writeFileSync(path.join(ctx.proj, 'notes.md'), 'my notes\n');
  fs.mkdirSync(path.join(ctx.proj, 'notes'));
  fs.writeFileSync(path.join(ctx.proj, 'notes/plan.md'), 'plan\n');
  fs.writeFileSync(path.join(ctx.proj, '.env'), 'API_KEY=secret\n');
  fs.writeFileSync(path.join(ctx.proj, '.dev.vars'), 'TOKEN=secret\n');
  fs.writeFileSync(path.join(ctx.proj, 'app.js'), 'code\n');
  ctx.vault = path.join(path.dirname(ctx.proj), 'vault');
  // A careless include list that names secret files must still never copy them.
  fs.writeFileSync(path.join(ctx.proj, '.kit/vault.json'), JSON.stringify({ dir: ctx.vault, include: ['*.md', '.env', '.dev.vars'] }));
  return ctx;
}

// The kit's own standards, checked the way Kit Standards #3 and #5 say: one home per rule, a why in every rule
// section, and size caps. These read the real rule modules in rules/, not a fixture.
export const STANDARDS = () => fs.readdirSync(path.resolve('rules')).filter((n) => n.endsWith('.md')).sort()
  .map((n) => read(path.resolve('rules', n)).replace(/^---\n[\s\S]*?\n---\n/, '')).join('\n');
export const words = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean);
export const shingles = (w, n = 8) => { const s = new Set(); for (let i = 0; i + n <= w.length; i++) s.add(w.slice(i, i + n).join(' ')); return s; };

// The owner, 2026-11-02 (option B): installs run only from a clean release tag, or by name with --unreleased.
// The check sits in the CLI, not in install(), so these tests drive the CLI copied into a tagged git fixture, the
// way the release copy holds it.
export function releaseKit() {
  const ctx = makeKit();
  const { kit } = ctx;
  fs.mkdirSync(path.join(kit, 'scripts'), { recursive: true });
  copyKitCli(kit);
  fs.writeFileSync(path.join(kit, '.gitignore'), 'node_modules/\n');
  const git = (...a) => spawnSync('git', ['-C', kit, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main'); git('add', '-A'); git('commit', '-q', '-m', 'kit'); git('tag', 'v1.0.0');
  const cli = (...args) => spawnSync(process.execPath, [path.join(kit, 'scripts/kit.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, KIT_CLAUDE_HOME: ctx.home } });
  return { ...ctx, git, cli };
}

// Plan rule-modules, Phase 1: every rule heading carries a fixed ID, so pointers survive renames and moves.
// Headings inside code blocks (the handoff template) are examples, not rules, and carry none.
export const ruleFiles = () => fs.readdirSync(path.resolve('rules')).filter((n) => n.endsWith('.md')).map((n) => path.resolve('rules', n));
export const moduleFiles = ruleFiles;

export const MODULE_MAP = () => JSON.parse(read(path.resolve('docs/migrations/1.0.0-modules.json')));

// Plan rule-modules, Phase 1: every pointer to a rule names its fixed ID, and every ID it names exists.
// A pointer to a heading by its words breaks the day the heading is renamed or moved.
export const KIT_TEXT_FILES = () => {
  // tests/ holds fixture pointers to rules that exist only in temp kits.
  const skip = new Set(['.git', 'node_modules', 'vendor', 'reports', 'migrations', 'evals', 'plans', 'tests']);
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (skip.has(e.name) ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);
  return walk(path.resolve('.')).filter((f) => /\.(md|mjs|cjs|html|json)$/.test(f) && !f.endsWith('CHANGELOG.md'));
};

// The line-conservation check for the 1.0.0 split retired at 1.1.0, when new rules began; its result is kept in
// docs/migrations/1.0.0-coverage.md, and the ledger test below still proves every 0.7.0 rule has its home.

// Plan rule-modules, Phase 3: six formats get skills, and the rules stay in the modules (the owner chose this over
// moving them, so every tool keeps every rule). Every rule line of 1.1.0 must still appear exactly as often across
// the modules and those skills (none lost, none copied into a skill), except
// the lines recorded as reworded. New lines (a skill's steps, a module's one-line pointer) are free. Lines with no
// word in them (a table divider, a code fence) carry no rule, and every skill reuses them, so they are not counted.
export const FORMAT_SKILLS = ['pr-body', 'release-notes', 'closeout', 'preview-test', 'pre-pr-sweep', 'adr'];
export const noFront = (t) => t.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
export const plainLine = (l) => l.replace(/^(#{1,4} .*?) \{#[^}]+\}$/, '$1');
// Each format audit passes a clean piece and names every fault in a bad one.
export const runAudit = (skill, text, args = [], cwd) => {
  const dir = makeTemp('audit-');
  const file = path.join(dir, 'piece.md');
  fs.writeFileSync(file, text);
  return spawnSync('node', [path.resolve('user/skills', skill, 'audit.mjs'), file, ...args], { encoding: 'utf8', cwd: cwd || dir });
};

// Plan rule-modules, Phase 1: when the kit retires a file it once installed, install removes it only if the
// project left it as installed (after a backup); a changed copy is reported for fold-back; a file of the same
// name that the kit never installed belongs to the project and is left alone.
export function retireKit() {
  const ctx = makeKit();
  install({ kit: ctx.kit, home: ctx.home, target: 'project', projectDir: ctx.proj });
  fs.rmSync(path.join(ctx.kit, 'project/_Working Standards.md'));
  const cfg = JSON.parse(read(path.join(ctx.kit, 'kit.config.json')));
  fs.writeFileSync(path.join(ctx.kit, 'kit.config.json'), JSON.stringify({ ...cfg, retired: { project: ['_Working Standards.md'] } }));
  return ctx;
}

// Plan rule-modules, Phase 2: one role table (rule:agent-role-table) says what each agent may use and which rules
// it starts with; the role files must match it, so access is never widened by an edit to one file alone. The table
// lives in kit.config.json roles; each entry is shaped as the old markdown row was ('none' for an empty list).
export const roleTable = () => {
  const roles = JSON.parse(read(path.resolve('kit.config.json'))).roles;
  const list = (xs) => (xs.length ? xs.join(', ') : 'none');
  return Object.entries(roles).map(([role, r]) => ({ role, tools: r.tools.join(', '), denied: list(r.denied), rules: list(r.rules) }));
};
export const front = (f) => Object.fromEntries([...read(f).match(/^---\n([\s\S]*?)\n---/)[1].matchAll(/^(\w+):\s*(.*)$/gm)].map(([, k, v]) => [k, v.trim()]));

// Plan rule-modules, Phase 2 guards. Each is driven the way Claude Code runs it (hook input as JSON on stdin) and
// proved with a known-good and a known-bad case.
export const runHook = (script, input, env = {}) => spawnSync('node', [path.resolve(script)], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, ...env } });
export function gitTree() {
  const dir = makeTemp('fence-');
  const g = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  g('init', '-q', '-b', 'main'); fs.writeFileSync(path.join(dir, 'a.js'), 'a\n'); g('add', '-A'); g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  return dir;
}

// Plan agent-canary: each kit agent opens every message to its tasker with a phrase it can only learn by reading
// the project's rules block itself. The fixtures use a made-up phrase; the real one has a single home in the kit.
export const FAKE_PHRASE = 'Tango Lima Seven Delta';
export const phraseLine = (p) => `Confirmation phrase: open your first message to whoever started you, and every message after it, with: ${p}\n`;
export function canaryRepo(phrase = FAKE_PHRASE) {
  const dir = gitTree();
  fs.mkdirSync(path.join(dir, 'standards'));
  if (phrase) fs.writeFileSync(path.join(dir, 'standards', 'agent-teams.md'), `# Rules\n\n\`\`\`\nRULES EVERY AGENT FOLLOWS\n${phraseLine(phrase)}\`\`\`\n`);
  return dir;
}
export const canary = (input) => runHook('user/kit-hooks/canary.cjs', input);
export const canaryLog = (dir) => {
  const f = path.join(spawnSync('git', ['-C', dir, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).stdout.trim(), 'kit-canary.log');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
};
// Found in review: a project that fills its adapter in its own file (the index row for rule:agent-team-adapter
// names it) must be checked against that file, the one the agent is sent to, never the kit's template.
export function adapterRepo(phrase) {
  const dir = canaryRepo('Stale Template Phrase');
  fs.writeFileSync(path.join(dir, 'standards', 'INDEX.md'), '| ID | Rule | File | Also called |\n|---|---|---|---|\n| agent-team-adapter | Agent-Team Build: Project Adapter | `standards/project-adapter.md` | agent team |\n');
  fs.writeFileSync(path.join(dir, 'standards', 'project-adapter.md'), `# Adapter\n\n\`\`\`\nRULES\n${phrase ? phraseLine(phrase) : ''}\`\`\`\n`);
  return dir;
}

// The kit stays local (rule:kit-stays-local): the install keeps every kit path out of git in the folder's own
// exclude file, so the kit is there to use but never committed unless the owner tracks a file on purpose.
export const g = (dir, ...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
// noVerify stands for a tool that skips the git hooks, so a slip still reaches history and the first push check must find it.
// Test commits use the house style, so the kit's commit-msg hook (rule:commit-message-format) lets them through.
export const commitAll = (dir, msg, noVerify) => { g(dir, 'add', '-A'); return g(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', /^[a-z]+: /.test(msg) ? msg : `chore: ${msg}`, ...(noVerify ? ['--no-verify'] : [])); };
export function localProject() {
  const dir = makeTemp('local-');
  g(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'main.py'), 'print(1)\n');
  return dir;
}
export const excludeFile = (dir) => path.join(dir, '.git', 'info', 'exclude');
export const kitInstall = (dir) => install({ kit: path.resolve('.'), target: 'project', projectDir: dir, home: makeTemp('home-') });

// The first push gate (rule:first-push-gate): one strict check before the first push to a remote.
export const firstPush = (dir) => spawnSync('node', [path.join(dir, '.claude', 'first-push-check.mjs')], { encoding: 'utf8', cwd: dir });
export function readyProject(tracking) {
  const dir = localProject();
  kitInstall(dir);
  if (tracking) fs.writeFileSync(path.join(dir, '.kit', 'tracking.json'), JSON.stringify(tracking));
  commitAll(dir, 'init');
  return dir;
}

// Sweep auto-approval (rule:sweep-auto-approval): a script approves a Swarm Contract that stays inside the tier's
// rules, at no token cost, logs every decision, and hands back to the owner on anything outside them. The review of
// its first version showed an agent could clear its own pause, raise its own caps and pick a lighter tier, so the
// log has a fixed home, the caps only go down, the diff sets the floor, and only the owner's own terminal resumes.
export const APPROVE = path.resolve('user/skills/pre-pr-sweep/approve.mjs');
export const FIX_EXIT = 3;
export const role = (kind, question, extra = {}) => ({ role: `${kind} reviewer`, kind, question, context: [`src/${kind}.ts`, 'rule:pre-pr-deep-sweep'], finding: 'file:line, the scenario, the proof', calls: 5, ...extra });
export const featureContract = () => ({ tier: 'feature', modifiers: [], roles: [
  role('security', 'Can a crafted import file reach storage without validation?', { context: ['src/import.ts'] }),
  role('security', 'Does any new route leak personal data in logs or errors?', { context: ['src/routes.ts'] }),
  role('security', 'Is the lock screen bypassable by restoring an old backup?', { context: ['src/lock.ts'] }),
  role('test-value', 'Does each new test guard a real use through its real seam?'),
  role('novel-lens', 'What did every other role structurally miss?'),
] });
// A contract the script sends to the owner on sweepRepo's branch: a fix tier on a change that adds source.
export const askContract = () => ({ tier: 'fix', modifiers: [], roles: [
  role('fix-root', 'Does the fix remove the root cause, and does it hold?'),
  role('blast-radius', 'Which callers and copies of this code does the change reach?'),
  role('test-value', 'Does each changed test fail without the fix?'),
] });
// A branch with one feature commit on top of main: a new source file and a test.
export function sweepRepo(files = { 'src/sync.ts': 'export const sync = 1;\n', 'src/sync.test.ts': 'test\n' }) {
  const dir = makeTemp('approve-');
  g(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'README.md'), 'x\n');
  commitAll(dir, 'base', true);
  g(dir, 'checkout', '-q', '-b', 'feat/sync');
  for (const [f, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); }
  commitAll(dir, 'feature', true);
  fs.mkdirSync(path.join(dir, 'sweeps'));
  return dir;
}
// T2 (the owner 2026-11-10: "Pop-up record"): the owner's yes and resume are their tap on a Claude Code choice pop-up,
// read from the session's own transcript. Where a test stands for the owner saying yes or resuming, the owner taps Yes
// on the pop-up that quotes the ask's or the pause's act, and the call runs in that session.
export const TAP_SID = '0aaaaaaa-1bbb-2ccc-3ddd-4eeeeeeeeeee';
// One answered pop-up, as Claude Code writes it in the session's transcript (shape read from a live record).
export function ownerTaps(cfg, dir, act, { answer = 'Yes', labels = ['Yes', 'No'], at = new Date(Date.now() + 1000).toISOString(), source = 'user_temporary', sid = TAP_SID, folder, bare = false } = {}) {
  const where = path.join(cfg, 'projects', folder || fs.realpathSync.native(dir).replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(where, { recursive: true });
  const id = `toolu_${crypto.randomBytes(6).toString('hex')}`;
  // bare: the question names the act without backticks, as build 11's first resume pop-ups did.
  const question = bare ? `May I go on? ${act}` : `May I go on? \`${act}\``;
  const questions = [{ question, header: 'Owner yes', multiSelect: false, options: labels.map((label) => ({ label, description: '' })) }];
  fs.appendFileSync(path.join(where, `${sid}.jsonl`), [
    { type: 'assistant', isSidechain: false, timestamp: at, message: { content: [{ type: 'tool_use', id, name: 'AskUserQuestion', input: { questions } }] } },
    { type: 'user', isSidechain: false, timestamp: at, permissionDecision: { decision: 'accept', source }, toolUseResult: { questions, answers: { [question]: answer } }, message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'answered' }] } },
  ].map((l) => JSON.stringify(l)).join('\n') + '\n');
}
export const tapEnv = (cfg) => ({ CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: TAP_SID, CLAUDECODE: '1' });
// The ask code approve.mjs printed for each contract, read from that run's own output (a second run to read it would log another ask).
const askedCodes = new Map();
export function asOwner(dir, args, env) {
  const owner = !('CLAUDECODE' in env) && !('AI_AGENT' in env) && !('CLAUDE_CODE_SESSION_ID' in env);
  const yes = owner && args.includes('--owner-yes') && filledWords(args[args.indexOf('--owner-yes') + 1]);
  const resume = owner && args.includes('--resume') && env.KIT_OWNER_RESUME === '1';
  if (!yes && !resume) return null;
  const log = sweepLog(dir);
  let act;
  if (yes) {
    const f = path.resolve(dir, args[0]);
    const ask = log.map((l) => JSON.parse(l)).filter((e) => e.kind === 'decision' && path.resolve(e.contract) === f).pop();
    if (!ask) return null;
    const code = askedCodes.get(`${dir}|${f}`);
    if (!code) return null;
    act = `sweep yes ${code}`;
  } else {
    const i = log.map((l) => JSON.parse(l).kind).lastIndexOf('pause');
    if (i < 0) return null;
    act = `sweep resume ${crypto.createHash('sha256').update(log[i]).digest('hex').slice(0, 6)}`;
  }
  const cfg = env.CLAUDE_CONFIG_DIR || makeTemp('cfg-');
  ownerTaps(cfg, dir, act);
  const out = yes ? [...args.slice(0, args.indexOf('--owner-yes')), '--owner-yes', ...args.slice(args.indexOf('--owner-yes') + 2)] : ['--resume'];
  const { KIT_OWNER_RESUME: _r, ...rest } = env;
  return spawnSync('node', [APPROVE, ...out], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH, ...rest, ...tapEnv(cfg) } });
}
export const filledWords = (w) => typeof w === 'string' && w.trim().split(/\s+/).filter(Boolean).length >= 1 && w.trim().length > 1;
export const approveIn = (dir, args, env = {}) => {
  const owner = asOwner(dir, args, env);
  if (owner) return owner;
  if (args.includes('--outcome') && env.CLAUDE_CONFIG_DIR) leadBriefs(dir, args, env.CLAUDE_CONFIG_DIR);
  // A crashed reviewer was started by the guard too.
  const crashed = args.includes('--retry') && args[args.indexOf('--crashed') + 1];
  if (crashed && env.CLAUDE_CONFIG_DIR) startedByBrief(dir, env.CLAUDE_CONFIG_DIR, crashed);
  const ran = spawnSync('node', [APPROVE, ...args], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH, ...env } });
  const printed = /`sweep yes ([0-9a-f]{6})`/.exec(ran.stdout || '');
  if (printed && args.length && !String(args[0]).startsWith('-')) askedCodes.set(`${dir}|${path.resolve(dir, args[0])}`, printed[1]);
  return ran;
};
// What a lead does: each reviewer's brief carries "Sweep: <hash> role <n>" for the contract cleared last, n in the
// order --agents lists them. A brief that already names a sweep is left as the test wrote it.
export const sweepLog = (dir) => { try { return read(path.join(dir, '.git', 'kit-sweep-approvals.jsonl')).split('\n').filter(Boolean); } catch { return []; } };
export const lastClearing = (dir, contract) => {
  const lines = sweepLog(dir).map((l) => [l, JSON.parse(l)]).filter(([, e]) => (e.kind === 'decision' || e.kind === 'owner-yes') && (!contract || path.resolve(e.contract) === path.resolve(contract)));
  // For an outcome, the reviewers ran under the last clearing (an approval or the owner's yes), not a later ask.
  return (contract && lines.filter(([, e]) => e.kind === 'owner-yes' || e.decision === 'approved').pop()) || lines.pop();
};
export function setBrief(cfg, id, text) {
  for (const p of fs.readdirSync(path.join(cfg, 'projects'))) for (const s of fs.readdirSync(path.join(cfg, 'projects', p))) {
    const f = path.join(cfg, 'projects', p, s, 'subagents', `agent-${id}.jsonl`);
    if (!fs.existsSync(f)) continue;
    const lines = read(f).split('\n');
    const first = JSON.parse(lines[0]);
    if (!first.message || first.message.role !== 'user' || typeof first.message.content !== 'string' || first.message.content.includes('Sweep:')) continue;
    first.message.content = text(first.message.content);
    lines[0] = JSON.stringify(first);
    fs.writeFileSync(f, lines.join('\n'));
  }
}
export function leadBriefs(dir, args, cfg) {
  const at = lastClearing(dir, args[0]);
  const ids = String(args[args.indexOf('--agents') + 1] || '').split(',');
  if (!at || !args.includes('--agents') || !fs.existsSync(path.join(cfg, 'projects'))) return;
  ids.forEach((id, i) => { if (/^[\w-]+$/.test(id)) setBrief(cfg, id, (b) => `${b} Sweep: ${at[1].hash} role ${i + 1}`); });
  // --agents auto: the lead started every reviewer whose brief it wrote.
  const all = ids[0] === 'auto' ? fs.readdirSync(path.join(cfg, 'projects')).flatMap((p) => fs.readdirSync(path.join(cfg, 'projects', p)).flatMap((s) => { try { return fs.readdirSync(path.join(cfg, 'projects', p, s, 'subagents')); } catch { return []; } })).map((n) => (n.match(/^agent-(.+)\.jsonl$/) || [])[1]).filter(Boolean) : ids;
  for (const id of all) startedByBrief(dir, cfg, id);
}
// The guard started a reviewer under the clearing and role its brief names.
export function startedByBrief(dir, cfg, id) {
  let f = /^[\w-]+$/.test(id) && fs.existsSync(path.join(cfg, 'projects')) && transcriptOf(cfg, id);
  // The guard starts only the reviewer type; another type with a sweep's brief is refused.
  try { if (f && !/reviewer$/i.test(JSON.parse(read(f.replace(/\.jsonl$/, '.meta.json'))).agentType)) f = null; } catch { f = null; }
  const content = f && JSON.parse(read(f).split('\n')[0]).message?.content;
  const tag = f && (Array.isArray(content) ? content.map((x) => (x && x.text) || '').join('\n') : String(content || '')).match(/Sweep: ([0-9a-f]{16}) role (\d+)/);
  const clearing = tag && sweepLog(dir).filter((l) => { const e = JSON.parse(l); return e.hash === tag[1] && (e.kind === 'owner-yes' || e.decision === 'approved'); }).pop();
  if (clearing) guardStart(dir, clearing, Number(tag[2]), id);
}
export const transcriptOf = (cfg, id) => {
  for (const p of fs.readdirSync(path.join(cfg, 'projects'))) for (const s of fs.readdirSync(path.join(cfg, 'projects', p))) {
    const f = path.join(cfg, 'projects', p, s, 'subagents', `agent-${id}.jsonl`);
    if (fs.existsSync(f)) return f;
  }
  return null;
};
// What the guard does at each start: the role's slot under the clearing records the start's tool id, which Claude
// Code also writes into the reviewer's meta file (toolu_lead_<id> in these transcripts). Tests try several reviewers
// for one role in turn, so a start this helper wrote gives way to the next; one the real guard wrote stays. A
// reviewer other than the crashed one, after a logged retry for its role, takes the retry slot.
export function guardStart(dir, clearingLine, role, id) {
  const slots = path.join(dir, '.git', 'kit-sweep-starts', crypto.createHash('sha256').update(clearingLine).digest('hex').slice(0, 16));
  fs.mkdirSync(slots, { recursive: true });
  const retried = sweepLog(dir).some((l) => { const e = JSON.parse(l); return e.kind === 'retry' && e.role === role && e.crashed !== id; });
  const f = path.join(slots, retried ? `${role - 1}.retry` : String(role - 1));
  if (!fs.existsSync(f) || !read(f) || read(f).startsWith('toolu_lead_')) fs.writeFileSync(f, `toolu_lead_${id}`);
}

export function approveRun(contract, dir = sweepRepo()) {
  const f = path.join(dir, 'sweeps', 'contract.json');
  fs.writeFileSync(f, JSON.stringify(contract));
  return { ...approveIn(dir, [f]), dir, f };
}
export const approvalLog = (dir) => read(path.join(dir, '.git', 'kit-sweep-approvals.jsonl')).trim().split('\n').map((l) => JSON.parse(l));
// A fake Claude config folder holding one reviewer transcript per agent id, where approve.mjs reads what each role
// spent (the meter is processed tokens from the role's own transcript). Each call is [input, cache read, cache
// write, output]; a call given as { id, u } keeps its message id, so streaming's repeated lines can be written.
// Beside each transcript sits Claude Code's agent-<id>.meta.json (agent type, finished); `meta` overrides it per id,
// and `cfg` adds to an existing folder.
// `models` gives an id's calls a model other than the top one (roleModels(contract) maps ids to their roles' models).
export function transcripts(spec, meta = {}, cfg = makeTemp('cfg-'), session = 'session-1', models = {}) {
  const dir = path.join(cfg, 'projects', 'C--repo', session, 'subagents');
  fs.mkdirSync(dir, { recursive: true });
  const base = Date.now();
  for (const [id, calls] of Object.entries(spec)) {
    let model = models[id] || 'claude-opus-5-5';
    // A call given as { u, gap } starts gap ms after the line before it (the cache outlives a short gap only).
    let shift = 0;
    const at0 = new Date(base).toISOString();
    const lines = calls.map((c, i) => {
      if (c && c.gap) shift += c.gap;
      const at = new Date(base + shift).toISOString();
      // { refused: text } is a hook's refusal of a tool call, as Claude Code writes it into the transcript.
      if (c && c.refused) return JSON.stringify({ type: 'user', uuid: `${id}-${i}`, timestamp: at, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${i}`, is_error: true, content: c.refused }] } });
      // { handback: text } is the reviewer's report, handed back through the hand-back tool.
      // { handback, refusedWith } is a hand-back the canary refused: the call and its error result.
      if (c && c.handback && c.refusedWith) return [JSON.stringify({ type: 'assistant', uuid: `${id}-${i}`, timestamp: at, message: { id: `msg_${id}_${i}`, role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: `toolu_r${i}`, name: 'SubagentHandback', input: { message: c.handback } }], usage: { input_tokens: 0, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0, output_tokens: 0 } } }),
        JSON.stringify({ type: 'user', uuid: `${id}-${i}r`, timestamp: at, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_r${i}`, is_error: true, content: c.refusedWith }] } })].join('\n');
      if (c && c.handback) return JSON.stringify({ type: 'assistant', uuid: `${id}-${i}`, timestamp: at, message: { id: `msg_${id}_${i}`, role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: `toolu_h${i}`, name: 'SubagentHandback', input: { message: c.handback } }], usage: { input_tokens: 0, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0, output_tokens: 0 } } });
      // { read: text } is a tool's plain answer, such as a file the reviewer read.
      if (c && c.read) return JSON.stringify({ type: 'user', uuid: `${id}-${i}`, timestamp: at, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${i}`, content: c.read }] } });
      const { id: mid = `msg_${id}_${i}`, u = c, model: m = models[id] || 'claude-opus-5-5' } = Array.isArray(c) ? { u: c } : c;
      model = m;
      return JSON.stringify({ type: 'assistant', uuid: `${id}-${i}`, timestamp: at, message: { id: mid, role: 'assistant', model: m, usage: { input_tokens: u[0], cache_read_input_tokens: u[1], cache_creation_input_tokens: u[2], output_tokens: u[3] } } });
    });
    fs.writeFileSync(path.join(dir, `agent-${id}.jsonl`), [JSON.stringify({ type: 'user', timestamp: at0, message: { role: 'user', content: 'brief' } }), ...lines].join('\n') + '\n');
    fs.writeFileSync(path.join(dir, `agent-${id}.meta.json`), JSON.stringify({ agentType: 'reviewer', toolUseId: `toolu_lead_${id}`, model: /sonnet/.test(model) ? 'sonnet' : 'opus', finished: true, ...(meta[id] || {}) }));
  }
  return cfg;
}
export let agentSeq = 0;
export const roleModel = (r) => r.model ?? (['security', 'novel-lens'].includes(r.kind) ? 'claude-opus-5-5' : 'claude-sonnet-5-5');
export const roleModels = (ids, roles) => Object.fromEntries(ids.map((id, i) => [id, roleModel(roles[i])]));
// Logs a sweep's outcome with one transcript per role, the given total split across them.
export function outcome(r, tokens = '200000', findings = '6', real = '5', dup = '0', extra = []) {
  const roles = JSON.parse(read(r.f)).roles || [];
  const n = roles.length;
  const ids = Array.from({ length: n }, () => `t${++agentSeq}`);
  const each = Math.floor(Number(tokens) / n);
  // Each transcript runs on the model its role names, as a real reviewer does.
  const cfg = transcripts(Object.fromEntries(ids.map((id, i) => [id, [{ model: roleModel(roles[i]), u: [0, each + (i ? 0 : Number(tokens) - each * n), 0, 0] }]])));
  return approveIn(r.dir, [r.f, '--outcome', '--agents', ids.join(','), '--findings', findings, '--real', real, '--duplicates', dup, ...extra], { CLAUDE_CONFIG_DIR: cfg });
}

// The one-sweep loop gives each branch one sweep, so a test that runs a later sweep runs it as a later branch would:
// a new branch off main with its own change. The contracts in sweeps/ come along, as they would in a real project.
export let branchSeq = 0;
export function nextBranch(dir, file) {
  const keep = path.join(dir, 'sweeps');
  const saved = fs.existsSync(keep) ? fs.readdirSync(keep, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => [e.name, fs.readFileSync(path.join(keep, e.name))]) : [];
  const n = ++branchSeq;
  assert.equal(g(dir, 'checkout', '-q', '-f', '-b', `feat/next-${n}`, 'main').status, 0);
  fs.mkdirSync(keep, { recursive: true });
  for (const [name, bytes] of saved) fs.writeFileSync(path.join(keep, name), bytes);
  const rel = file || `src/next${n}.ts`;
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), `next ${n}\n`);
  g(dir, 'add', rel);
  g(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', `feat: next ${n}`, '--no-verify');
}

// Found in a course project (2026-10-30): the lead asked the owner to approve a sweep team before running the
// script, and the owner approved a team that broke the security floor. The script now runs first and writes the
// owner's notice from checked data, and a guard refuses a reviewer agent until the log clears this HEAD.
// The lead numbers each brief: the first role of the last clearing with this cap that has not started.
export function leadTag(dir, prompt) {
  const at = lastClearing(dir);
  const cap = prompt.match(/Call cap: (\d+)/);
  if (!at || !cap) return '';
  const [line, e] = at;
  const slots = path.join(dir, '.git', 'kit-sweep-starts', crypto.createHash('sha256').update(line).digest('hex').slice(0, 16));
  const team = Number(e.agents) || 0;
  const fits = [...Array(team).keys()].filter((n) => !Array.isArray(e.calls) || e.calls[n] === Number(cap[1]));
  const n = fits.find((k) => !fs.existsSync(path.join(slots, String(k)))) ?? fits[0] ?? 0;
  // The lead copies the role's token ceiling from the start notice too (M22 C).
  const ceiling = Array.isArray(e.ceilings) && !/Token ceiling: \d+/.test(prompt) ? ` Token ceiling: ${e.ceilings[n]}.` : '';
  return ` Sweep: ${e.hash} role ${n + 1}${ceiling}`;
}
// The lead also puts the role's own question in its brief; raw leaves a test's prompt as written.
export function leadQuestion(dir, prompt) {
  const tag = prompt.match(/Sweep: [0-9a-f]{16} role (\d+)/);
  const at = lastClearing(dir);
  if (!tag || !at) return '';
  try { return ` ${(JSON.parse(read(at[1].contract)).roles[Number(tag[1]) - 1] || {}).question || ''}`; } catch { return ''; }
}
const GUARD_CFG = makeTemp('guard-cfg-');
export const sweepGuard = (dir,{ raw, noCeiling, ...extra } = {}) => {
  const input = { cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'reviewer', prompt: 'review. Call cap: 5.' }, ...extra };
  const p = input.tool_input && input.tool_input.prompt;
  if (typeof p === 'string' && !p.includes('Sweep:')) input.tool_input = { ...input.tool_input, prompt: p + leadTag(dir, p) };
  // A brief that names its sweep already gets the token ceiling of the role it names, as the lead copies it.
  else if (!noCeiling && typeof p === 'string' && !/Token ceiling: \d+/.test(p)) {
    const tag = p.match(/Sweep: ([0-9a-f]{16}) role (\d+)/);
    const e = tag && sweepLog(dir).map((l) => JSON.parse(l)).filter((x) => x.hash === tag[1] && Array.isArray(x.ceilings)).pop();
    if (e) input.tool_input = { ...input.tool_input, prompt: `${p} Token ceiling: ${e.ceilings[Number(tag[2]) - 1]}.` };
  }
  if (!raw && typeof input.tool_input?.prompt === 'string') input.tool_input.prompt += leadQuestion(dir, input.tool_input.prompt);
  // A Claude folder of its own, so the owner's real reviewer file never decides a test's start (K266).
  const r = runHook('user/kit-hooks/sweep-guard.cjs', input, { CLAUDE_CONFIG_DIR: GUARD_CFG });
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : { permissionDecision: 'allow' };
};

// The size band (rule:size-budgets): one size request per plan, applied by script. A long real run showed asks the
// rule never meant: a margin demanded as if it were size, a margin demanded on lines the plan did not grow, and a
// file count that no band could raise. The script refuses only on a measured size past what is allowed.
export const BAND = path.resolve('project/.claude/size-band.mjs');
export function bandRun(mode, { band, measured, limits }) {
  const dir = makeTemp('band-');
  const files = { band, measured, limits };
  for (const [k, v] of Object.entries(files)) fs.writeFileSync(path.join(dir, `${k}.json`), JSON.stringify(v));
  const r = spawnSync('node', [BAND, mode, '--band', path.join(dir, 'band.json'), '--measured', path.join(dir, 'measured.json'), '--limits', path.join(dir, 'limits.json')], { encoding: 'utf8' });
  let out = null;
  try { out = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))); } catch { /* printed text only */ }
  return { ...r, out };
}
export const band = { base: { page: 100000, lazy: 16000, files: 80 }, limit: { page: 100050, lazy: 16040, files: 80 }, raise: { page: 6000, files: 2 }, counts: ['files'] };

// Improvement reports (rule:kit-standards item 12): one format the kit owns for every process or method gap found
// while using it, filled in the session the gap shows up, handed to the kit as one file. The audit holds the bar:
// evidence on every cause, and no fix that lowers a standard.
export const REPORT = path.resolve('project/.claude/improvement-report.mjs');
export const reportRun = (dir, args) => spawnSync('node', [REPORT, ...args], { encoding: 'utf8', cwd: dir });
export function reportRepo() {
  const dir = path.join(makeTemp('ir-'), 'course-project');
  fs.mkdirSync(path.join(dir, '.kit'), { recursive: true });
  g(dir, 'init', '-q', '-b', 'feat/generator');
  fs.writeFileSync(path.join(dir, 'README.md'), 'x\n');
  commitAll(dir, 'base', true);
  fs.writeFileSync(path.join(dir, '.kit', 'kit-version.json'), JSON.stringify({ version: '1.7.1', files: {} }));
  return dir;
}
export const EXAMPLE = () => read(path.resolve('project/.claude/kit/improvement-report-example.md'));

// From a project closeout (2026-10-30): a PR that changes shipped code without a version bump leaves the release after it
// nothing to cut, so the PR-body audits fail it unless the body says "No user-facing change".
export const BUMP = path.resolve('project/.claude/version-bump-check.mjs');
export function bumpRepo(change) {
  const dir = makeTemp('bump-');
  g(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'package.json'), '{\n  "name": "app",\n  "version": "1.0.0"\n}\n');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'export const a = 1;\n');
  commitAll(dir, 'base', true);
  g(dir, 'checkout', '-q', '-b', 'feat/x');
  change(dir);
  commitAll(dir, 'change', true);
  return dir;
}

// Improvement report IR-2026-10-30-pr-body-audit-holds-checks-from-another-project: the Standard audit held one
// project's facts (its dependency-audit wording, a corpus line, web gates), so an honest body elsewhere could only
// fail or lie. Those checks now come from the project's .kit/pr-body.json; the secrets line stays fixed for all.
// T13 (the owner, 2026-11-10): the title is the squash subject (`type: subject`), the review rows are the project's
// own, and what GitHub shows (files, gates) is not repeated.
export const STD_TITLE = 'feat: an alarm for online search and a data date on About';
export const stdAudit = (dir, text, title = STD_TITLE) => {
  const f = path.join(dir, 'body.md');
  fs.writeFileSync(f, text);
  return spawnSync('node', [path.resolve('project/.claude/pr-body-audit.mjs'), f, title], { encoding: 'utf8', cwd: dir });
};
export const honestBody = () => read(path.resolve('user/skills/pr-body/examples/standard.md'))
  .replace('; the corpus and the served documents are unchanged', '');

// Locked: a tier's cap counts only the roles beyond its floor, so no modifier mix can make the floor
// unreachable, and a sweep still cannot buy more than its extras.
export function fixRepo(extra = {}) {
  const dir = makeTemp('approve-');
  const put = (files) => { for (const [f, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), t); } };
  g(dir, 'init', '-q', '-b', 'main');
  put({ 'README.md': 'x\n', 'src/page.ts': 'export const page = 1;\n', 'src/page.test.ts': 'test 1\n' });
  commitAll(dir, 'base', true);
  g(dir, 'checkout', '-q', '-b', 'fix/page');
  put({ 'src/page.ts': 'export const page = 2;\n', 'src/page.test.ts': 'test 2\n', ...extra });
  commitAll(dir, 'fix', true);
  fs.mkdirSync(path.join(dir, 'sweeps'));
  return dir;
}
export const fixFloor = () => [
  role('fix-root', 'Does the fix remove the root cause, and does it hold?'),
  role('blast-radius', 'Which callers and copies of this code does the change reach?', { model: 'claude-sonnet-5-5' }),
  role('test-value', 'Does each changed test fail without the fix?', { model: 'claude-sonnet-5-5' }),
];
export const threeSecurity = () => [
  role('security', 'Can a crafted page number reach the query unchecked?'),
  role('security', 'Does an error path leak the session token?'),
  role('security', 'Can the clamp be bypassed by a negative offset?'),
];

// A first sweep approved and its outcome logged, then a fix committed on top.
export function firstSweep(contract = featureContract(), dir = sweepRepo()) {
  const r = approveRun(contract, dir);
  assert.equal(r.status, 0, r.stdout);
  assert.equal(outcome(r).status, 0);
  fs.writeFileSync(path.join(dir, 'README.md'), 'fixed\n');
  commitAll(dir, 'fix the sweep findings', true);
  return r;
}
// The one-sweep loop (the owner, 2026-11-07 05:06): one full sweep per branch, then CI. A second sweep however it is
// named is the owner's call; their yes clears it as any ask. Handoff item 32: a rebase or a fresh contract name does not
// hide the branch's first sweep.
export const ownerYes = (r) => { const y = approveIn(r.dir, [r.f, '--owner-yes', 'yes, run that second pass']); assert.equal(y.status, 0, y.stdout); return r; };

// IR-2026-10-31-overlay-on-team-repo: a team repo keeps its tracked CLAUDE.md; the kit's own CLAUDE.md goes to a
// personal CLAUDE.local.md with a header saying the host file wins, the host file is recorded as host-owned so no
// check flags it, and the kit's local files stay out of git.
export function overlayKit() {
  const ctx = makeKit();
  fs.writeFileSync(path.join(ctx.kit, 'project/CLAUDE.md'), '# Kit CLAUDE\n\n@AGENTS.md\n');
  fs.writeFileSync(path.join(ctx.kit, 'project/AGENTS.md'), '# Kit AGENTS\n');
  g(ctx.proj, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(ctx.proj, 'CLAUDE.md'), "# The team's own rules\n");
  return ctx;
}

// The owner, 2026-10-31: a missing kit is a full stop. Each prompt in a folder without the kit, or in a session whose
// Claude config folder has no kit, is refused with the fix, until the latest kit is installed.
export const promptGate = (script, input, env) => {
  const r = spawnSync('node', [script], { input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', ...input }), encoding: 'utf8', env: { ...process.env, ...env } });
  return r.stdout ? JSON.parse(r.stdout) : {};
};

// The owner removed the PR attribution standard, so a host's two-line block fails every body audit, wherever it
// sits. The corpus came from a separate writer who never saw the check; "unclear" cases fail closed.
export const ATTRIBUTION = '<!-- claude-projects-attribution: {"github_login":"someone"} -->\n_Requested by **Pat**_\n\n';
export const CORPUS = JSON.parse(read(path.resolve('tests/attribution-corpus.json')));
export const leanAudit = (dir, text) => {
  const lean = read(path.resolve('user/skills/pr-body/examples/lean.md'));
  const f = path.join(dir, 'lean.md');
  fs.writeFileSync(f, text(lean));
  const title = lean.split('\n')[0].replace(/^## /, '').replace(/^[A-Za-z ]+: /, 'feat: ');
  return spawnSync('node', [path.resolve('project/.claude/pr-body-audit-lean.mjs'), f, title], { encoding: 'utf8', cwd: dir });
};

export const notesAudit = (dir, text) => {
  const f = path.join(dir, 'notes.md');
  fs.writeFileSync(f, text);
  return spawnSync('node', [path.resolve('user/skills/release-notes/audit.mjs'), f, '1.0.0'], { encoding: 'utf8', cwd: dir });
};

// The project map (owner, 2026-10-31: option A, kept simple and trackable): one data file per project, checked
// against the repo, drawn as one plain page - the goal, progress with evidence, and how the parts connect.
export const MAP = path.resolve('project/.claude/project-map.mjs');
export const mapRun = (dir, args) => spawnSync('node', [MAP, ...args], { encoding: 'utf8', cwd: dir });
export function mapRepo(map) {
  const dir = makeTemp('map-');
  fs.mkdirSync(path.join(dir, 'src', 'ask'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'ask', 'index.ts'), 'x\n');
  fs.mkdirSync(path.join(dir, '.kit'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.kit', 'project-map.json'), JSON.stringify(map));
  return dir;
}
export const GOOD_MAP = {
  project: 'Demo', goal: 'Answer a service member\'s question offline.', successBar: ['Answers cite a public source'],
  parts: [{ id: 'ask', name: 'Ask', does: 'answers questions on the device', files: ['src/ask'] },
    { id: 'corpus', name: 'Corpus', does: 'public US-gov text', files: [] }],
  links: [{ from: 'ask', to: 'corpus', verb: 'searches' }],
  progress: [{ item: 'Offline answers', state: 'done', evidence: 'PR #12' }, { item: 'Citations', state: 'doing' }, { item: 'Voice', state: 'next' }],
};

// rule:commit-message-format and rule:branching as scripts: one line, a known type, no AI or tool trailer; a branch is
// <type>/<plain-kebab> with no tool prefix or internal code.
export const NAMES = path.resolve('project/.claude/name-check.mjs');
export const nameRun = (args) => spawnSync('node', [NAMES, ...args], { encoding: 'utf8' });
export const msgFile = (text) => { const f = path.join(makeTemp('msg-'), 'MSG'); fs.writeFileSync(f, text); return f; };

// Tracking checks as a script (the owner, 2026-10-31): the whole-file caps, an empty parking lot before a sweep, and
// evidence on every done line of a plan's Progress block.
export const TRACK = path.resolve('project/.claude/tracking-check.mjs');
export const trackRun = (dir, args) => spawnSync('node', [TRACK, ...args], { encoding: 'utf8', cwd: dir });

// What the sweep itself commits is not source. The contract, the project's caps file and a file under docs/ used
// to count as added source, so a fix or triage sweep went to the owner the moment its contract was committed.
export const fixContract = () => ({ tier: 'fix', modifiers: [], roles: fixFloor() });

export const capHook = (dir, calls, cap, extra = {}) => {
  const session = path.join(dir, 'session-1');
  fs.mkdirSync(path.join(session, 'subagents'), { recursive: true });
  const lines = [{ message: { role: 'user', content: cap === null ? 'a brief' : `a brief. Call cap: ${cap}. A call is one message.` } }];
  for (let i = 0; i < calls; i++) for (const part of [0, 1]) lines.push({ message: { role: 'assistant', id: `m${i}`, usage: { input_tokens: 1 }, content: [{ type: 'text', text: String(part) }] } });
  fs.writeFileSync(path.join(session, 'subagents', 'agent-r1.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const r = runHook('user/kit-hooks/call-cap.cjs', { hook_event_name: 'PreToolUse', transcript_path: `${session}.jsonl`, agent_id: 'r1', agent_type: 'reviewer', tool_name: 'Bash', tool_input: {}, ...extra });
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : { permissionDecision: 'allow' };
};

// M22 option C (the owner, 2026-11-05): a pre-run budget guess cannot land within 25% (sd(log) 0.35+ per sweep), so
// each role is bounded instead. Its token ceiling is the p90 of the last 60 roles the log measured; the hook stops a
// reviewer there, and the pause trips on drift signals. With under 20 roles measured there is no baseline yet, so
// the ceiling is 1.25x the role's budget and the whole-sweep 25% trip stays.
// Past outcomes, as the log holds them: chained lines (each names a hash of the line before), five roles a line.
export function seedOutcomes(dir, roles) {
  const f = path.join(dir, '.git', 'kit-sweep-approvals.jsonl');
  const lines = fs.existsSync(f) ? read(f).split('\n').filter(Boolean) : [];
  for (let i = 0; i < roles.length; i += 5) {
    const prev = lines.length ? crypto.createHash('sha256').update(lines[lines.length - 1]).digest('hex').slice(0, 16) : '';
    lines.push(JSON.stringify({ time: new Date(Date.now() - 86400000).toISOString(), kind: 'outcome', contract: path.join(dir, 'sweeps', `old-${i}.json`), budget: 1, tokens: 1, findings: 0, real: 0, duplicates: 0, roles: roles.slice(i, i + 5), prev }));
  }
  fs.writeFileSync(f, lines.join('\n') + '\n');
}
export const pastRole = (tokens, extra = {}) => ({ role: 'r', kind: 'security', model: 'claude-opus-5-5', tokens, calls: 6, firstCall: 10000, ...extra });

// Each sweep below runs on a log of 25 measured roles of 200,000 tokens over 6 calls, starting at 10,000: the
// ceiling is 200,000, content per call 33,333, and every baseline the drift signals read exists. Each role's cap is 5.
export function driftSweep(spec, { opens = [] } = {}) {
  const dir = sweepRepo();
  seedOutcomes(dir, Array.from({ length: 25 }, () => pastRole(200000)));
  const r = approveRun(featureContract(), dir);
  assert.equal(r.status, 0, r.stdout);
  const ids = spec.map(() => `t${++agentSeq}`);
  // K151: the line the call-cap meter writes when it lets a call through unread, for the roles named by place.
  for (const i of opens) fs.appendFileSync(path.join(dir, '.git', 'kit-guard-open.log'), `${JSON.stringify({ at: new Date().toISOString(), hook: 'call-cap', agent: ids[i], cause: 'ENOENT' })}\n`);
  const cfg = transcripts(Object.fromEntries(ids.map((id, i) => [id, spec[i]])), {}, undefined, undefined, roleModels(ids, featureContract().roles));
  const o = approveIn(dir, [r.f, '--outcome', '--agents', ids.join(','), '--findings', '4', '--real', '3', '--duplicates', '0'], { CLAUDE_CONFIG_DIR: cfg });
  assert.equal(o.status, 0, o.stdout);
  return { o, line: approvalLog(dir).filter((e) => e.kind === 'outcome').pop() };
}
// A role that starts at 10,000 and reads 28,000 on each of 5 more calls: 150,000, well inside its ceiling.
export const usual = () => [[10000, 0, 0, 0], ...Array(5).fill([0, 28000, 0, 0])];

// PR 17's carry-overs (X5 to X7, X10, C7): what the meter trusts, and the tests the re-sweep found missing.
export const logOutcome = (r, ids, cfg, extra = []) => approveIn(r.dir, [r.f, '--outcome', '--agents', ids.join(','), '--findings', '4', '--real', '3', '--duplicates', '0', ...extra], { CLAUDE_CONFIG_DIR: cfg });
export const cheapRoles = (n) => Array.from({ length: n }, () => `t${++agentSeq}`);

// A reviewer that crashes spends real tokens and leaves its role with no report (the owner's decision 2, 1.21.0): its
// role gets one retry, the crash's spend stays on the role, and a second crash is the owner's through --cut-short.
// A transcript's age is its last write, so a test sets both clocks: the entries' timestamps and the file's mtime.
export function ageTranscript(cfg, id, { stamps, file }) {
  const ago = (min) => new Date(Date.now() - min * 60000);
  const f = path.join(cfg, 'projects', 'C--repo', 'session-1', 'subagents', `agent-${id}.jsonl`);
  if (stamps !== undefined) fs.writeFileSync(f, read(f).trim().split('\n').map((l) => JSON.stringify({ ...JSON.parse(l), timestamp: ago(stamps).toISOString() })).join('\n') + '\n');
  if (file !== undefined) fs.utimesSync(f, ago(file), ago(file));
}
export function crashedSweep() {
  const early = transcripts({ early: [[0, 100, 0, 0]] }, { early: { finished: false } });
  const dir = sweepRepo({ 'README.md': 'z\n' });
  const r = approveRun({ tier: 'fix', modifiers: [], roles: [role('fix-root', 'Does the fix remove the root cause, and does it hold?', { model: 'claude-opus-5-5' }), role('blast-radius', 'Which callers and copies of this code does the change reach?', { model: 'claude-opus-5-5' })] }, dir);
  assert.equal(r.status, 0, r.stdout);
  const { hash } = approvalLog(dir).pop();
  // Cleared half an hour ago, so a crash can have gone quiet since and still have started after the clearance.
  const logFile = path.join(dir, '.git', 'kit-sweep-approvals.jsonl');
  const logged = read(logFile).trim().split('\n');
  logged.push(JSON.stringify({ ...JSON.parse(logged.pop()), time: new Date(Date.now() - 30 * 60000).toISOString() }));
  fs.writeFileSync(logFile, logged.join('\n') + '\n');
  const brief = (n, h = hash) => `review. Call cap: 5. Sweep: ${h} role ${n}`;
  const cfg = transcripts({ r1: [[0, 1000, 0, 0], [0, 1000, 0, 0], [0, 500, 0, 0], [0, 500, 0, 0]], r2: [[0, 500, 0, 0]] }, { r1: { finished: false } });
  setBrief(cfg, 'r1', () => brief(1));
  setBrief(cfg, 'r2', () => brief(2));
  setBrief(early, 'early', () => brief(1));
  ageTranscript(cfg, 'r1', { stamps: 11, file: 11 });
  ageTranscript(early, 'early', { stamps: 60, file: 60 });
  const start = (n) => sweepGuard(dir, { tool_input: { subagent_type: 'reviewer', prompt: brief(n) } }).permissionDecision;
  const retry = (n, id, env = cfg) => approveIn(dir, [r.f, '--retry', String(n), '--crashed', id], { CLAUDE_CONFIG_DIR: env });
  return { ...r, hash, brief, cfg, early, start, retry };
}

// The recall gate: one ruler every time (versioned keys and brief), a run that records what it read, and a CI check
// that reads the recorded median instead of only seeing that the scores file changed.
export const recallTools = () => import('../scripts/recall.mjs');
export const RECALL = path.resolve('scripts/recall.mjs');
export const GOOD_ENTRY = 'gate: kit-1.18.0 median 8 baseline 8 brief v1 keys v2';export const gateFacts = (over = {}) => ({ changed: ['rules/core.md', 'docs/evals/results/recall-scores.md'], added: [GOOD_ENTRY], brief: 1, keys: 2, ...over });

// Recall probes: the runner makes its own throwaway folder, so no folder name or label can reach the result.
export const HEX6 = '[0-9a-f]{6}';
export const probeParts = (home, p) => path.relative(home, p).split(path.sep);
export const recorder = (statuses = []) => {
  const calls = [];
  const run = (cmd, args, opts) => {
    calls.push({ cmd, args: [...args], opts: { ...opts }, dirExisted: opts && opts.cwd ? fs.existsSync(opts.cwd) : null });
    const status = statuses.length ? statuses.shift() : 0;
    return { status, stdout: '', stderr: status === 0 ? '' : 'boom' };
  };
  return { calls, run };
};
export const scratch = () => path.join(makeTemp('probe-'), 'kit-probes', 'abc123', 'pdef456');

// The brainstorm skill. The sheet file is the one truth; the record copies the owner's words exactly.
export const sheetTools = () => import('../user/skills/brainstorm/sheet.mjs');
export const compileTools = () => import('../user/skills/brainstorm/compile-record.mjs');
export const SHEET = `# Sheet: Export button

id: export-button
asked by: Claude

## Grounding

We are  planning the export button.

It came up because exports fail on the phone.\t

## Topic: Where it lives

### Q1. Where should the button sit?

Why it matters: it sets what people find first.

Options:
- [x] a: In the toolbar
- [ ] b: In the menu

Asker's pick: a
Why this pick: it is where people look.

Your answer:

What I thought:

i wonder abuot tablets  \twith two spaces

and a second paragraph

### Q2. What should the file be called?

Why it matters: people share it.

Options:
- [ ] a: The date
- [ ] b: The title

Asker's pick: b
Why this pick: titles read better.

Your answer:

Neither,  use the projct name\t

and keep it short

What I thought:

## Topic: Limits

### Q3. How big can an export get?

Why it matters: it sets the memory budget.

Your answer:

What I thought:

## Anything I did not ask?

Nothing else  at this time.

Truly.
`;
export const fences = (record) => [...record.matchAll(/^(~{3,})\n([\s\S]*?)\n\1$/gm)].map((m) => m[2]);
export const answerQ3 = (text) => SHEET.replace('it sets the memory budget.\n\nYour answer:\n', `it sets the memory budget.\n\nYour answer:\n\n${text}\n`);

export const ROWS = () => ({
  sheet: { id: 's1', title: 'One', grounding: 'Line one.\n\nLine two.' },
  questions: [
    { id: 'q2', sheet: 's1', section: 1, order: 2, sectionTitle: 'A', text: 'Second?', why: 'w2', options: [{ key: 'a', label: 'Yes', detail: 'more' }, { key: 'b', label: 'No' }], rec: 'b', recWhy: 'because' },
    { id: 'q1', sheet: 's1', section: 1, order: 1, sectionTitle: 'A', text: 'First?', options: [{ key: 'a', label: 'Up' }], rec: 'a' },
    { id: 'q3', sheet: 's1', section: 2, order: 1, sectionTitle: 'B', text: 'Third?' },
  ],
  answers: { q1: { choice: 'a' }, q2: { own: 'my   own\nwords ', thought: 'odd spelng' }, s1__finish: { missed: 'tell me more', submitted: '2026-11-04T17:52:08.656Z' } },
});

// Carry-overs closed in 1.21.0 for the recall gate and runs (S18-2, S18-3, S18-5, S18-6, S18-7, B7, I20, I27).
// A small repo with recall.mjs, a ruler and a scores file, gated base..HEAD as CI does.
export function gateRepo({ keys = 'Current version: v4\n\n<!-- recall v4 -->\nPass: median 9 of 13.\n\n', scores = '# Scores\n', suite = null } = {}) {
  const dir = makeTemp('gate11-');
  const git = (...a) => { const r = spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' }); assert.equal(r.status, 0, a.join(' ') + r.stderr); return r.stdout; };
  const put = (rel, body) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); };
  git('init', '-q', '-b', 'main');
  put('scripts/recall.mjs', read(RECALL));
  put('docs/evals/recall-scorer-brief.md', 'Current version: v1\n');
  put('docs/evals/recall-questions.md', keys);
  put('docs/evals/results/recall-scores.md', scores);
  if (suite) put('docs/evals/behaviour-scenarios.json', suite);
  git('add', '.'); git('commit', '-qm', 'base'); git('tag', 'base');
  // The rule edit, then the score of that commit (K116: a gate line names the commit it scored), as a real run goes.
  const record = (line, extra = () => {}, scored = true) => {
    put('rules/core.md', 'a rule ' + Math.random() + '\n');
    extra(put);
    git('add', '.'); git('commit', '-qm', 'rules');
    const at = git('rev-parse', 'HEAD').trim();
    put('docs/evals/results/recall-scores.md', scores + '\n' + line + '\n' + (scored ? `scored: ${at}\n` : ''));
    git('add', '.'); git('commit', '-qm', 'record');
  };
  const gate = (script = path.join(dir, 'scripts/recall.mjs')) => spawnSync('node', [script, 'gate', 'base', 'HEAD'], { encoding: 'utf8', cwd: dir });
  return { dir, put, git, record, gate };
}

// Carry 17: a compaction loses the ids in the lead's context; each brief's Sweep tag does not get lost.
export function autoSweep(extra = () => {}) {
  const r = approveRun(featureContract());
  const n = JSON.parse(read(r.f)).roles.length;
  const hash = approvalLog(r.dir).pop().hash;
  const ids = Array.from({ length: n }, (_, i) => `au${++agentSeq}x${i}`);
  const cfg = transcripts(Object.fromEntries(ids.map((id) => [id, [[0, 1000, 0, 0]]])), {}, undefined, undefined, roleModels(ids, featureContract().roles));
  ids.forEach((id, i) => setBrief(cfg, id, (b) => `${b} Sweep: ${hash} role ${i + 1}`));
  extra({ cfg, hash, ids });
  const o = approveIn(r.dir, [r.f, '--outcome', '--agents', 'auto', '--findings', '6', '--real', '5', '--duplicates', '0'], { CLAUDE_CONFIG_DIR: cfg });
  return { r, o, ids, n };
}
