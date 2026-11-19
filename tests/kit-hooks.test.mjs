// Tests for git hooks, the first push check, the folder gate, commit and attribution checks: moved word for word from tests/kit.test.mjs (T10, build 18).

// Tests for scripts/kit.mjs - each one drives the CLI functions the way the owner does:
// a fake kit, a fake ~/.claude and a fake project in a temp folder.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { install, foldBack, bump, scrub, snapshot, restore, status as kitStatus, mainProtection, sessionStartReport as kitSessionStart, preCompactReport, promptCheckReport, vaultBackup, projectSlug, newerReleases, lsRemoteCall, tagsOf, render, sourceHooks, measure, measureReal, headings, ledger, build, parseModule, findRules, guardDir, scratch as kitScratch } from '../scripts/kit.mjs';
// The status and session-start reports read the machine's Claude Code by default; a test names its own version, so the
// suite's result does not rest on which Claude Code is installed (the 1.23.0 sweep). A test of the version reads passes its own.
const status = (o) => kitStatus({ claudeVersion: () => '2.1.325 (Claude Code)', ...o });
const sessionStartReport = (o) => kitSessionStart({ claudeVersion: () => '2.1.325 (Claude Code)', ...o });

// Every temp folder a test makes lands under this one root, removed at exit: os.tmpdir() reads these on each call and children inherit them.
// kit-temp.cjs also removes it on a signal, and the next run sweeps it after a kill.
const tmpRoot = kitTemp.sessionRoot();
const { makeTemp } = kitTemp;

// A kit folder's CLI is scripts/kit.mjs with the temp helper it imports, as in every real kit folder.
function copyKitCli(kit) {
  fs.mkdirSync(path.join(kit, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(kit, 'project/.claude'), { recursive: true });
  fs.copyFileSync(path.resolve('scripts/kit.mjs'), path.join(kit, 'scripts/kit.mjs'));
  fs.copyFileSync(path.resolve('project/.claude/kit-temp.cjs'), path.join(kit, 'project/.claude/kit-temp.cjs'));
  // The guard launcher, which kit.mjs reads its record names and entries from (1.25.1).
  fs.mkdirSync(path.join(kit, 'user/kit-tools'), { recursive: true });
  fs.copyFileSync(path.resolve('user/kit-tools/kit-launch.cjs'), path.join(kit, 'user/kit-tools/kit-launch.cjs'));
  // The merge-on-green steps install prints (K61), which read row A27 as the merge gate does.
  for (const f of ['merge-on-green.mjs', 'safe-git.mjs']) fs.copyFileSync(path.resolve('scripts', f), path.join(kit, 'scripts', f));
  for (const f of ['merge-gate.mjs', 'kit-temp.cjs']) fs.copyFileSync(path.resolve('user/kit-tools', f), path.join(kit, 'user/kit-tools', f));
}

function makeKit() {
  const root = makeTemp('kit-');
  const kit = path.join(root, 'kit');
  const home = path.join(root, 'home');
  const proj = path.join(root, 'My App');
  const files = {
    'VERSION': '1.0.0\n',
    'CHANGELOG.md': '# Changelog\n',
    'kit.config.json': JSON.stringify({ ownerName: 'Pat', ownerProfileFile: 'owner-profile.md', thirdPartySkills: ['vendor-skill'] }),
    'owner-profile.md': '- Likes tests\n',
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
  return { kit, home, proj };
}

const read = (p) => fs.readFileSync(p, 'utf8');

// A release install checks every byte against the release tag's tree (the 1.26.0 security review, S4), so a fixture
// that installs as a release commits its kit folder and hands over that commit's tree.
function released(kit, describe) {
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
function addThirdParty({ kit, home }) {
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

function caseKit() {
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

// The kit's own standards, checked the way Kit Standards #3 and #5 say: one home per rule, a why in every rule
// section, and size caps. These read the real rule modules in rules/, not a fixture.
const STANDARDS = () => fs.readdirSync(path.resolve('rules')).filter((n) => n.endsWith('.md')).sort()
  .map((n) => read(path.resolve('rules', n)).replace(/^---\n[\s\S]*?\n---\n/, '')).join('\n');
const words = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean);
const shingles = (w, n = 8) => { const s = new Set(); for (let i = 0; i + n <= w.length; i++) s.add(w.slice(i, i + n).join(' ')); return s; };

// Plan rule-modules, Phase 1: every rule heading carries a fixed ID, so pointers survive renames and moves.
// Headings inside code blocks (the handoff template) are examples, not rules, and carry none.
const ruleFiles = () => fs.readdirSync(path.resolve('rules')).filter((n) => n.endsWith('.md')).map((n) => path.resolve('rules', n));
const moduleFiles = ruleFiles;

// Plan rule-modules, Phase 2: one role table (rule:agent-role-table) says what each agent may use and which rules
// it starts with; the role files must match it, so access is never widened by an edit to one file alone.
const roleTable = () => {
  const text = read(path.resolve('rules/agent-teams.md'));
  const sec = text.slice(text.indexOf('{#agent-role-table}'));
  return [...sec.matchAll(/^\| (builder|checker|scanner|orchestrator|reviewer) \| [^|]+ \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm)]
    .map(([, role, tools, denied, rules]) => ({ role, tools: tools.trim(), denied: denied.trim(), rules: rules.trim() }));
};
const front = (f) => Object.fromEntries([...read(f).match(/^---\n([\s\S]*?)\n---/)[1].matchAll(/^(\w+):\s*(.*)$/gm)].map(([, k, v]) => [k, v.trim()]));

// Plan rule-modules, Phase 2 guards. Each is driven the way Claude Code runs it (hook input as JSON on stdin) and
// proved with a known-good and a known-bad case.
const runHook = (script, input, env = {}) => spawnSync('node', [path.resolve(script)], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, ...env } });
function gitTree() {
  const dir = makeTemp('fence-');
  const g = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  g('init', '-q', '-b', 'main'); fs.writeFileSync(path.join(dir, 'a.js'), 'a\n'); g('add', '-A'); g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  return dir;
}

// Plan agent-canary: each kit agent opens every message to its tasker with a phrase it can only learn by reading
// the project's rules block itself. The fixtures use a made-up phrase; the real one has a single home in the kit.
const FAKE_PHRASE = 'Tango Lima Seven Delta';
const phraseLine = (p) => `Confirmation phrase: open your first message to whoever started you, and every message after it, with: ${p}\n`;
function canaryRepo(phrase = FAKE_PHRASE) {
  const dir = gitTree();
  fs.mkdirSync(path.join(dir, 'standards'));
  if (phrase) fs.writeFileSync(path.join(dir, 'standards', 'agent-teams.md'), `# Rules\n\n\`\`\`\nRULES EVERY AGENT FOLLOWS\n${phraseLine(phrase)}\`\`\`\n`);
  return dir;
}
const canary = (input) => runHook('user/kit-hooks/canary.cjs', input);
const canaryLog = (dir) => {
  const f = path.join(spawnSync('git', ['-C', dir, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).stdout.trim(), 'kit-canary.log');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
};

// why: guards rule:outward-acts
test('the git pre-push hook is executable, in the kit and where install writes it', { windows: true }, () => {
  for (const h of ['pre-push', 'pre-commit']) assert.match(spawnSync('git', ['ls-files', '-s', `project/.githooks/${h}`], { encoding: 'utf8' }).stdout, /^100755 /, h);
  if (process.platform !== 'win32') {
    const proj = makeTemp('hookmode-');
    install({ kit: path.resolve('.'), target: 'project', projectDir: proj, home: makeTemp('home-') });
    assert.ok(fs.statSync(path.join(proj, '.githooks', 'pre-push')).mode & 0o111, 'git skips a hook without the execute bit');
  }
});

// why: guards rule:sub-agent-verification
test('the checker clean-tree stop sees a change in another worktree of the same repo', () => {
  const dir = gitTree();
  const other = path.join(path.dirname(dir), `${path.basename(dir)}-wt`);
  spawnSync('git', ['-C', dir, 'worktree', 'add', '-q', other], { encoding: 'utf8' });
  const s = { cwd: dir, session_id: `t-${Date.now()}-${Math.random()}` };
  runHook('user/kit-hooks/clean-tree.cjs', { ...s, hook_event_name: 'PreToolUse' });
  fs.writeFileSync(path.join(other, 'a.js'), 'changed in the builder worktree\n');
  assert.equal(runHook('user/kit-hooks/clean-tree.cjs', { ...s, hook_event_name: 'Stop' }).status, 2);
});

// The kit stays local (rule:kit-stays-local): the install keeps every kit path out of git in the folder's own
// exclude file, so the kit is there to use but never committed unless the owner tracks a file on purpose.
const g = (dir, ...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
// noVerify stands for a tool that skips the git hooks, so a slip still reaches history and the first push check must find it.
// Test commits use the house style, so the kit's commit-msg hook (rule:commit-message-format) lets them through.
const commitAll = (dir, msg, noVerify) => { g(dir, 'add', '-A'); return g(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', /^[a-z]+: /.test(msg) ? msg : `chore: ${msg}`, ...(noVerify ? ['--no-verify'] : [])); };
function localProject() {
  const dir = makeTemp('local-');
  g(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'main.py'), 'print(1)\n');
  return dir;
}
const excludeFile = (dir) => path.join(dir, '.git', 'info', 'exclude');
const kitInstall = (dir) => install({ kit: path.resolve('.'), target: 'project', projectDir: dir, home: makeTemp('home-') });

// why: guards rule:kit-stays-local
test('the install keeps every kit file out of git, and git status shows only the project', () => {
  const dir = localProject();
  fs.mkdirSync(path.join(dir, '.git', 'info'), { recursive: true });
  fs.writeFileSync(excludeFile(dir), '# my own line\n*.log\n');
  kitInstall(dir);
  const text = read(excludeFile(dir));
  assert.match(text, /^\*\.log$/m, 'the owner\'s own lines stay');
  assert.match(text, /^# kit:begin/m);
  assert.deepEqual(g(dir, 'status', '--porcelain', '--untracked-files=all').stdout.trim().split('\n'), ['?? main.py']);
  // A reinstall replaces the block, never adds a second one.
  kitInstall(dir);
  assert.equal(read(excludeFile(dir)).match(/# kit:begin/g).length, 1);
});

// why: guards rule:first-push-gate
test('the owner can choose to track the kit, and a folder without git is left alone', () => {
  const dir = localProject();
  kitInstall(dir);
  fs.writeFileSync(path.join(dir, '.kit', 'tracking.json'), '{ "kit": "tracked" }\n');
  kitInstall(dir);
  // Tracked: every kit file may go in the repo except the private ones (the owner, 2026-10-31).
  assert.notEqual(g(dir, 'check-ignore', '-q', 'AGENTS.md').status, 0, 'a kit file can be tracked');
  assert.equal(g(dir, 'check-ignore', '-q', 'CLAUDE.md').status, 0, "the kit's CLAUDE.md stays private");
  const plain = makeTemp('nogit-');
  kitInstall(plain);
  assert.ok(!fs.existsSync(path.join(plain, '.git')), 'the install never makes a repo');
});

// The first push gate (rule:first-push-gate): one strict check before the first push to a remote.
const firstPush = (dir) => spawnSync('node', [path.join(dir, '.claude', 'first-push-check.mjs')], { encoding: 'utf8', cwd: dir });
function readyProject(tracking) {
  const dir = localProject();
  kitInstall(dir);
  if (tracking) fs.writeFileSync(path.join(dir, '.kit', 'tracking.json'), JSON.stringify(tracking));
  commitAll(dir, 'init');
  return dir;
}

// why: guards rule:first-push-gate
test('the first push check passes a clean history and records the commit it checked', () => {
  const dir = readyProject({ track: ['main.py', '_Session Log.md'] });
  g(dir, 'add', '-f', '_Session Log.md');
  commitAll(dir, 'show growth');
  const r = firstPush(dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(read(path.join(dir, '.git', 'kit-first-push-ok')).trim(), g(dir, 'rev-parse', 'HEAD').stdout.trim());
});

// why: guards rule:first-push-gate (N9): a public repo goes out with GitHub's secret scanning and push protection
// named when either is off, and an unanswered question is never read as "on".
test('the first push check names a public GitHub repo whose secret scanning or push protection is off', async () => {
  const { scanningNotes, githubRepos } = await import(pathToFileURL(path.resolve('project/.claude/github-scanning.mjs')).href);
  const remotes = 'origin\thttps://github.com/pat/app.git (fetch)\norigin\thttps://github.com/pat/app.git (push)\nmine\tgit@github.com:pat/tool.git (push)\nlab\thttps://gitlab.com/pat/x.git (push)\nodd\thttps://github.com/pat/a;b (push)\n';
  assert.deepEqual(githubRepos(remotes), ['pat/app', 'pat/tool'], 'only plain GitHub names reach the API');
  const asked = [];
  const answers = { 'repos/pat/app': 'false disabled enabled', 'repos/pat/tool': 'false enabled enabled' };
  // K5, the 1.27.0 sweep: the call names github.com, so a GH_HOST or an enterprise-only login never gets the repo name.
  const gh = (args) => {
    const at = args.indexOf('--hostname');
    assert.equal(args[at + 1], 'github.com', 'the gh call names no host');
    const repo = args.find((a) => a.startsWith('repos/'));
    asked.push(repo);
    return { status: 0, stdout: answers[repo] + '\n', stderr: '' };
  };
  const notes = scanningNotes(remotes, gh);
  assert.deepEqual(asked, ['repos/pat/app', 'repos/pat/tool']);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /pat\/app is public.*secret scanning disabled.*push protection enabled/);
  assert.deepEqual(scanningNotes('o\thttps://github.com/pat/app (push)\n', () => ({ status: 0, stdout: 'true null null\n' })), [], 'a private repo');
  const down = scanningNotes('o\thttps://github.com/pat/app (push)\n', () => ({ status: 1, stdout: '', stderr: 'gh: not logged in\n' }));
  assert.match(down[0], /GitHub did not say whether pat\/app[\s\S]*not logged in/);
  assert.match(scanningNotes('o\thttps://github.com/pat/app (push)\n', () => ({ status: 0, stdout: '\n' }))[0], /did not say/, 'an empty answer is not "on"');
});

// why: guards rule:first-push-gate
test('the first push check fails on a kit file anywhere in history, even after it was deleted', () => {
  const dir = readyProject();
  g(dir, 'add', '-f', 'AGENTS.md');
  commitAll(dir, 'oops', true);
  g(dir, 'rm', '-q', '--cached', 'AGENTS.md');
  commitAll(dir, 'remove it');
  const r = firstPush(dir);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /AGENTS\.md/);
  assert.ok(!fs.existsSync(path.join(dir, '.git', 'kit-first-push-ok')));
});

// why: guards rule:first-push-gate
test('the first push check fails on a never path, a missing tracked file, a secret and a missing exclude block', () => {
  const dir = readyProject({ track: ['report.pdf'], never: ['school/**'] });
  fs.mkdirSync(path.join(dir, 'school'));
  fs.writeFileSync(path.join(dir, 'school', 'rubric.txt'), 'graded\n');
  const secret = 'sk-ant-' + 'a1B2'.repeat(8);
  fs.writeFileSync(path.join(dir, 'config.py'), `KEY = "${secret}"\n`);
  fs.writeFileSync(path.join(dir, '.env'), 'X=1\n');
  commitAll(dir, 'more', true);
  fs.writeFileSync(excludeFile(dir), '');
  const r = firstPush(dir);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /school\/rubric\.txt/);
  assert.match(r.stdout, /report\.pdf/);
  assert.match(r.stdout, /config\.py/);
  assert.match(r.stdout, /\.env/);
  assert.match(r.stdout, /exclude/i);
  assert.ok(!r.stdout.includes(secret), 'a secret value is never printed');
});

// why: guards rule:first-push-gate
test('the pre-push hook blocks a first push the check did not pass, and leaves later pushes alone', { windows: true }, () => {
  const dir = readyProject({ track: ['main.py'] });
  const bare = makeTemp('bare-');
  g(bare, 'init', '-q', '--bare', '-b', 'main');
  g(dir, 'remote', 'add', 'origin', bare);
  const sha = g(dir, 'rev-parse', 'HEAD').stdout.trim();
  const hook = () => spawnSync('sh', [path.join(dir, '.githooks', 'pre-push'), 'origin', bare], { encoding: 'utf8', cwd: dir,
    input: `refs/heads/main ${sha} refs/heads/main ${'0'.repeat(40)}\n`, env: { PATH: process.env.PATH } });
  const blocked = hook();
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /first-push-check/);
  assert.equal(firstPush(dir).status, 0);
  assert.equal(hook().status, 0, 'the checked commit may go');
  fs.writeFileSync(path.join(dir, 'main.py'), 'print(2)\n');
  commitAll(dir, 'after the check');
  const later = spawnSync('sh', [path.join(dir, '.githooks', 'pre-push'), 'origin', bare], { encoding: 'utf8', cwd: dir,
    input: `refs/heads/main ${g(dir, 'rev-parse', 'HEAD').stdout.trim()} refs/heads/main ${'0'.repeat(40)}\n`, env: { PATH: process.env.PATH } });
  assert.notEqual(later.status, 0, 'a commit made after the check is checked again');
  g(dir, 'update-ref', 'refs/remotes/origin/main', sha);
  const after = spawnSync('sh', [path.join(dir, '.githooks', 'pre-push'), 'origin', bare], { encoding: 'utf8', cwd: dir,
    input: `refs/heads/main ${g(dir, 'rev-parse', 'HEAD').stdout.trim()} refs/heads/main ${sha}\n`, env: { PATH: process.env.PATH } });
  assert.equal(after.status, 0, 'once the remote has a branch, the gate is done');
});

// Found while planning for other AI tools: a slip must be stopped where it happens, not only at the first push.
// why: guards rule:outward-acts
test('the install turns on the kit git hooks, and leaves another hook manager alone', () => {
  const dir = localProject();
  kitInstall(dir);
  // Absolute, so an agent worktree runs the same hooks; a relative value from an earlier install is upgraded.
  const abs = path.join(dir, '.githooks').split(path.sep).join('/');
  assert.equal(g(dir, 'config', 'core.hooksPath').stdout.trim(), abs);
  g(dir, 'config', 'core.hooksPath', '.githooks');
  kitInstall(dir);
  assert.equal(g(dir, 'config', 'core.hooksPath').stdout.trim(), abs);
  const husky = localProject();
  g(husky, 'config', 'core.hooksPath', '.husky');
  kitInstall(husky);
  assert.equal(g(husky, 'config', 'core.hooksPath').stdout.trim(), '.husky', 'the owner\'s hook manager stays; setup says to add the checks there');
});

// why: guards rule:first-push-gate
test('the pre-commit hook blocks staging a kit file, a never path or a secret file, and allows tracked choices', { windows: true }, () => {
  const dir = readyProject({ track: ['main.py', '_Session Log.md'], never: ['school/**'] });
  const commit = () => spawnSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'chore: x'], { encoding: 'utf8', env: { ...process.env } });
  g(dir, 'add', '-f', 'AGENTS.md');
  let r = commit();
  assert.notEqual(r.status, 0, 'a kit file');
  assert.match(r.stdout + r.stderr, /AGENTS\.md/);
  g(dir, 'reset', '-q');
  fs.mkdirSync(path.join(dir, 'school'));
  fs.writeFileSync(path.join(dir, 'school', 'quiz.txt'), 'q\n');
  g(dir, 'add', 'school/quiz.txt');
  assert.notEqual(commit().status, 0, 'a never path');
  g(dir, 'reset', '-q');
  fs.writeFileSync(path.join(dir, '.env'), 'X=1\n');
  g(dir, 'add', '.env');
  assert.notEqual(commit().status, 0, 'a secret file');
  g(dir, 'reset', '-q');
  g(dir, 'add', '-f', '_Session Log.md');
  assert.equal(commit().status, 0, 'a kit file the owner chose to track');
});

// why: guards rule:first-push-gate
test('the first push check fails on a never path that is in the folder but not ignored', () => {
  const dir = readyProject({ track: ['main.py'], never: ['school/**'] });
  fs.mkdirSync(path.join(dir, 'school'));
  fs.writeFileSync(path.join(dir, 'school', 'rubric.txt'), 'graded\n');
  const r = firstPush(dir);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAIL.*ignored[\s\S]*school\/rubric\.txt/);
  fs.writeFileSync(path.join(dir, '.gitignore'), 'school/\n');
  commitAll(dir, 'ignore school');
  assert.equal(firstPush(dir).status, 0, firstPush(dir).stdout);
});

// Found in review of the first push gate: each of these let a slip through or blocked a clean push.
// why: guards rule:first-push-gate
test('the first push check sees a file added while resolving a merge', () => {
  const dir = readyProject({ track: ['main.py'], never: ['school/**'] });
  g(dir, 'checkout', '-q', '-b', 'side');
  fs.writeFileSync(path.join(dir, 'side.txt'), 's\n');
  commitAll(dir, 'side');
  g(dir, 'checkout', '-q', '-');
  fs.writeFileSync(path.join(dir, 'main.py'), 'print(3)\n');
  commitAll(dir, 'main');
  g(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'merge', '-q', '--no-commit', 'side');
  fs.mkdirSync(path.join(dir, 'school'));
  fs.writeFileSync(path.join(dir, 'school', 'inmerge.txt'), 'x\n');
  g(dir, 'add', '-f', 'school/inmerge.txt');
  g(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'merge', '--no-verify');
  g(dir, 'rm', '-rq', '--cached', 'school');
  commitAll(dir, 'drop it', true);
  const r = firstPush(dir);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /school\/inmerge\.txt/);
});

// why: guards rule:first-push-gate
test('the first push check reads a folder-style never entry, and fails an empty or ignored track entry', () => {
  for (const never of ['school/', 'school']) {
    const dir = readyProject({ track: ['main.py'], never: [never] });
    fs.mkdirSync(path.join(dir, 'school'));
    fs.writeFileSync(path.join(dir, 'school', 'rubric.txt'), 'graded\n');
    g(dir, 'add', '-f', 'school/rubric.txt');
    commitAll(dir, 'slip', true);
    assert.match(firstPush(dir).stdout, /FAIL  no never-list path[\s\S]*school\/rubric\.txt/, never);
  }
  assert.match(firstPush(readyProject()).stdout, /FAIL  every file in track is tracked[\s\S]*track is empty/);
  // A file named outright in track that git ignores is a wanted file left out (ignored files inside a tracked
  // folder are fine: see the next test but one).
  const dir = readyProject({ track: ['main.py', 'src/**', 'src/b.py'] });
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'a.py'), 'a\n');
  fs.writeFileSync(path.join(dir, 'src', 'b.py'), 'b\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'src/b.py\n');
  commitAll(dir, 'src');
  assert.match(firstPush(dir).stdout, /FAIL  every file in track is tracked[\s\S]*src\/b\.py/);
});

// why: guards rule:first-push-gate
test('the first push check finds the kit\'s own folder in history and lets reviewed secret hits pass', () => {
  const dir = readyProject({ track: ['main.py'] });
  g(dir, 'add', '-f', '.kit/kit-version.json');
  commitAll(dir, 'slip', true);
  assert.match(firstPush(dir).stdout, /\.kit\/kit-version\.json/);
  const ok = readyProject({ track: ['main.py', 'robots.js'], reviewedSecrets: ['robots.js'] });
  fs.writeFileSync(path.join(ok, 'robots.js'), `const ROBOTS_TOKEN = '${'public-robots-'.repeat(2)}';\n`);
  commitAll(ok, 'robots', true);
  assert.equal(firstPush(ok).status, 0, firstPush(ok).stdout);
});

// why: guards rule:first-push-gate
test('the first push gate stays on when the new remote already has a README, and lets a tag of the cleared commit go', () => {
  const dir = readyProject({ track: ['main.py'] });
  const bare = makeTemp('bare-');
  g(bare, 'init', '-q', '--bare', '-b', 'main');
  const seed = makeTemp('seed-');
  g(seed, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(seed, 'README.md'), '# made on the host\n');
  commitAll(seed, 'readme');
  g(seed, 'push', '-q', bare, 'main');
  g(dir, 'remote', 'add', 'origin', bare);
  g(dir, 'fetch', '-q', 'origin');
  const push = (sha, ref = 'refs/heads/main') => spawnSync('sh', [path.join(dir, '.githooks', 'pre-push'), 'origin', bare], { encoding: 'utf8', cwd: dir,
    input: `${ref} ${sha} ${ref} ${'0'.repeat(40)}\n`, env: { PATH: process.env.PATH } });
  const head = g(dir, 'rev-parse', 'HEAD').stdout.trim();
  assert.notEqual(push(head).status, 0, 'the fetched README branch does not end the gate');
  assert.equal(firstPush(dir).status, 0);
  g(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'tag', '-a', 'v0.1', '-m', 'first');
  assert.equal(push(g(dir, 'rev-parse', 'v0.1').stdout.trim(), 'refs/tags/v0.1').status, 0, 'an annotated tag of the cleared commit');
  // Once the cleared commit is on the remote, later pushes are left to the commit check.
  g(dir, 'update-ref', 'refs/remotes/origin/main', head);
  fs.writeFileSync(path.join(dir, 'main.py'), 'print(9)\n');
  commitAll(dir, 'later');
  assert.equal(push(g(dir, 'rev-parse', 'HEAD').stdout.trim()).status, 0);
});

// why: guards rule:first-push-gate
test('the install keeps the never list private in the exclude block', () => {
  const dir = readyProject({ track: ['main.py'], never: ['school/**'] });
  kitInstall(dir);
  assert.match(read(excludeFile(dir)), /^\/school\/\*\*$/m);
  fs.mkdirSync(path.join(dir, 'school'));
  fs.writeFileSync(path.join(dir, 'school', 'x.txt'), 'x\n');
  assert.equal(g(dir, 'status', '--porcelain').stdout.trim(), '');
});

// why: guards rule:first-push-gate
test('a project already pushed before the kit came is not held by the first push gate', () => {
  const origin = readyProject({ track: ['main.py'] });
  const bare = makeTemp('bare-');
  // Named, so the clone checks out main whatever the machine's default branch is (CI's is master).
  g(bare, 'init', '-q', '--bare', '-b', 'main');
  g(origin, 'push', '-q', '--no-verify', bare, 'HEAD:refs/heads/main');
  const clone = makeTemp('clone-');
  g(clone, 'clone', '-q', bare, '.');
  kitInstall(clone);
  fs.writeFileSync(path.join(clone, 'main.py'), 'print(5)\n');
  commitAll(clone, 'work');
  const r = spawnSync('sh', [path.join(clone, '.githooks', 'pre-push'), 'origin', bare], { encoding: 'utf8', cwd: clone,
    input: `refs/heads/main ${g(clone, 'rev-parse', 'HEAD').stdout.trim()} refs/heads/main ${'0'.repeat(40)}\n`, env: { PATH: process.env.PATH } });
  assert.equal(r.status, 0, r.stderr);
});

// Rule review 2026-10-31: a commit made off the owner's machine skips the pre-commit secret check, so CI scans the
// branch's added lines and new file names with the same patterns, and never prints a value.
// why: guards rule:first-push-gate
test('the branch secret scan fails on a secret-shaped value or file and stays quiet on a commit hash', () => {
  const SCAN = path.resolve('project/.claude/secret-shapes.mjs');
  const repo = (files) => {
    const dir = makeTemp('shapes-');
    g(dir, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(dir, 'README.md'), 'x\n');
    commitAll(dir, 'base', true);
    g(dir, 'checkout', '-q', '-b', 'feat/x');
    for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), text);
    commitAll(dir, 'change', true);
    return spawnSync('node', [SCAN, 'main'], { encoding: 'utf8', cwd: dir });
  };
  const token = 'ghp_' + 'A1b2C3d4E5'.repeat(4);
  const leak = repo({ 'config.js': `const t = '${token}';\n` });
  assert.equal(leak.status, 1, leak.stdout);
  assert.match(leak.stdout, /github token in config\.js/);
  assert.ok(!leak.stdout.includes(token), 'the value is never printed');
  assert.equal(repo({ '.env': 'A=1\n' }).status, 1, 'a secret file name');
  // A tracked file renamed to a secret name adds no line, so only the file check can see it.
  const dir = makeTemp('shapes-');
  g(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'settings.txt'), 'A=1\nB=2\nC=3\n');
  commitAll(dir, 'base', true);
  g(dir, 'checkout', '-q', '-b', 'feat/x');
  g(dir, 'mv', 'settings.txt', '.env');
  commitAll(dir, 'rename', true);
  assert.equal(spawnSync('node', [SCAN, 'main'], { encoding: 'utf8', cwd: dir }).status, 1, 'a rename to a secret file name');
  const option = spawnSync('node', [SCAN, '--output=x'], { encoding: 'utf8', cwd: dir });
  assert.equal(option.status, 2, 'a base that reads as an option is refused');
  assert.ok(!fs.existsSync(path.join(dir, 'x...HEAD')) && !fs.existsSync(path.join(dir, 'x')));
  const clean = repo({ 'notes.md': `pinned to ${'3d3c42e5aac5ba805825da76410c181273ba90b1'}\n` });
  assert.equal(clean.status, 0, clean.stdout);
  assert.match(clean.stdout, /NO SECRET SHAPES/);
});

// Found in the re-check: the done mark and the track check each had a case that let a slip out or blocked for good.
// why: guards rule:outward-acts
test('a new project that pulled the host README before the install is still held by the gate', () => {
  const dir = readyProject({ track: ['main.py'] });
  const bare = makeTemp('bare-');
  g(bare, 'init', '-q', '--bare', '-b', 'main');
  const seed = makeTemp('seed-');
  g(seed, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(seed, 'README.md'), '# made on the host\n');
  commitAll(seed, 'readme');
  g(seed, 'push', '-q', bare, 'main');
  g(dir, 'remote', 'add', 'origin', bare);
  g(dir, 'fetch', '-q', 'origin');
  g(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'merge', '-q', '--no-verify', '--allow-unrelated-histories', '-m', 'take readme', 'origin/main');
  kitInstall(dir);
  const r = spawnSync('sh', [path.join(dir, '.githooks', 'pre-push'), 'origin', bare], { encoding: 'utf8', cwd: dir,
    input: `refs/heads/main ${g(dir, 'rev-parse', 'HEAD').stdout.trim()} refs/heads/main ${'0'.repeat(40)}\n`, env: { PATH: process.env.PATH } });
  assert.notEqual(r.status, 0, 'our own first commit is not on the host yet');
});

// why: guards rule:outward-acts
test('a project pushed by URL before the kit is let through once a fetch shows its history on the remote', () => {
  const dir = readyProject({ track: ['main.py'] });
  const bare = makeTemp('bare-');
  g(bare, 'init', '-q', '--bare', '-b', 'main');
  g(dir, 'push', '-q', '--no-verify', bare, 'HEAD:refs/heads/main');
  g(dir, 'remote', 'add', 'origin', bare);
  g(dir, 'fetch', '-q', 'origin');
  fs.writeFileSync(path.join(dir, 'main.py'), 'print(7)\n');
  commitAll(dir, 'more');
  const r = spawnSync('sh', [path.join(dir, '.githooks', 'pre-push'), 'origin', bare], { encoding: 'utf8', cwd: dir,
    input: `refs/heads/main ${g(dir, 'rev-parse', 'HEAD').stdout.trim()} refs/heads/main ${'0'.repeat(40)}\n`, env: { PATH: process.env.PATH } });
  assert.equal(r.status, 0, r.stderr);
});

// why: guards rule:first-push-gate
test('the track check accepts ignored files inside a tracked folder, and never says to force-add a secret', () => {
  const dir = readyProject({ track: ['main.py', 'src/'] });
  fs.mkdirSync(path.join(dir, 'src', '__pycache__'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.py'), 'a\n');
  fs.writeFileSync(path.join(dir, 'src', '.env'), 'X=1\n');
  fs.writeFileSync(path.join(dir, 'src', '__pycache__', 'a.pyc'), 'c\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.env\n__pycache__/\n');
  commitAll(dir, 'src');
  const r = firstPush(dir);
  assert.equal(r.status, 0, r.stdout);
});

// why: guards rule:first-push-gate
test('a stash is never pushed, so the first push check leaves it out', () => {
  const dir = readyProject({ track: ['main.py'] });
  fs.writeFileSync(path.join(dir, '.env'), 'X=1\n');
  g(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'stash', 'push', '-q', '-u');
  assert.equal(firstPush(dir).status, 0, firstPush(dir).stdout);
});

// Found in a long real run: in the desktop app an agent hands its report back through a tool call, so the stop
// event carries no text message. The canary reads the report from the agent's own transcript instead.
// why: guards rule:agent-canary
test('the canary reads a report handed back through a tool, from the agent transcript', () => {
  const dir = canaryRepo();
  const transcript = (msg) => {
    const f = path.join(makeTemp('tr-'), 'agent.jsonl');
    const lines = [
      { type: 'user', message: { role: 'user', content: 'brief' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: '' }] } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'SubagentHandback', input: { message: msg } }] } },
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
    ];
    fs.writeFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    return f;
  };
  const stop = (id, f) => canary({ cwd: dir, hook_event_name: 'SubagentStop', agent_type: 'reviewer', agent_id: id, agent_transcript_path: f }).status;
  assert.equal(stop('h1', transcript(`${FAKE_PHRASE}\nFindings: none`)), 0);
  assert.equal(stop('h2', transcript('Findings: none')), 2);
  assert.equal(stop('h3', path.join(os.tmpdir(), 'no-such-transcript.jsonl')), 0, 'no readable report stays unchecked');
  assert.deepEqual(canaryLog(dir).map((e) => e.result), ['hit', 'miss', 'unchecked']);
});

// Sweep auto-approval (rule:sweep-auto-approval): a script approves a Swarm Contract that stays inside the tier's
// rules, at no token cost, logs every decision, and hands back to the owner on anything outside them. The review of
// its first version showed an agent could clear its own pause, raise its own caps and pick a lighter tier, so the
// log has a fixed home, the caps only go down, the diff sets the floor, and only the owner's own terminal resumes.
const APPROVE = path.resolve('user/skills/pre-pr-sweep/approve.mjs');
const FIX_EXIT = 3;
const role = (kind, question, extra = {}) => ({ role: `${kind} reviewer`, kind, question, context: [`src/${kind}.ts`, 'rule:pre-pr-deep-sweep'], finding: 'file:line, the scenario, the proof', calls: 5, ...extra });
const featureContract = () => ({ tier: 'feature', modifiers: [], roles: [
  role('security', 'Can a crafted import file reach storage without validation?', { context: ['src/import.ts'] }),
  role('security', 'Does any new route leak personal data in logs or errors?', { context: ['src/routes.ts'] }),
  role('security', 'Is the lock screen bypassable by restoring an old backup?', { context: ['src/lock.ts'] }),
  role('test-value', 'Does each new test guard a real use through its real seam?'),
  role('novel-lens', 'What did every other role structurally miss?'),
] });
// A contract the script sends to the owner on sweepRepo's branch: a fix tier on a change that adds source.
const askContract = () => ({ tier: 'fix', modifiers: [], roles: [
  role('fix-root', 'Does the fix remove the root cause, and does it hold?'),
  role('blast-radius', 'Which callers and copies of this code does the change reach?'),
  role('test-value', 'Does each changed test fail without the fix?'),
] });
// A branch with one feature commit on top of main: a new source file and a test.
function sweepRepo(files = { 'src/sync.ts': 'export const sync = 1;\n', 'src/sync.test.ts': 'test\n' }) {
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
const TAP_SID = '0aaaaaaa-1bbb-2ccc-3ddd-4eeeeeeeeeee';
// One answered pop-up, as Claude Code writes it in the session's transcript (shape read from a live record).
function ownerTaps(cfg, dir, act, { answer = 'Yes', labels = ['Yes', 'No'], at = new Date(Date.now() + 1000).toISOString(), source = 'user_temporary', sid = TAP_SID, folder, bare = false } = {}) {
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
const tapEnv = (cfg) => ({ CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: TAP_SID, CLAUDECODE: '1' });
function asOwner(dir, args, env) {
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
    act = `sweep yes ${String(ask.hash).slice(0, 6)}`;
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
const filledWords = (w) => typeof w === 'string' && w.trim().split(/\s+/).filter(Boolean).length >= 1 && w.trim().length > 1;
const approveIn = (dir, args, env = {}) => {
  const owner = asOwner(dir, args, env);
  if (owner) return owner;
  if (args.includes('--outcome') && env.CLAUDE_CONFIG_DIR) leadBriefs(dir, args, env.CLAUDE_CONFIG_DIR);
  // A crashed reviewer was started by the guard too.
  const crashed = args.includes('--retry') && args[args.indexOf('--crashed') + 1];
  if (crashed && env.CLAUDE_CONFIG_DIR) startedByBrief(dir, env.CLAUDE_CONFIG_DIR, crashed);
  return spawnSync('node', [APPROVE, ...args], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH, ...env } });
};
// What a lead does: each reviewer's brief carries "Sweep: <hash> role <n>" for the contract cleared last, n in the
// order --agents lists them. A brief that already names a sweep is left as the test wrote it.
const sweepLog = (dir) => { try { return read(path.join(dir, '.git', 'kit-sweep-approvals.jsonl')).split('\n').filter(Boolean); } catch { return []; } };
const lastClearing = (dir, contract) => {
  const lines = sweepLog(dir).map((l) => [l, JSON.parse(l)]).filter(([, e]) => (e.kind === 'decision' || e.kind === 'owner-yes') && (!contract || path.resolve(e.contract) === path.resolve(contract)));
  // For an outcome, the reviewers ran under the last clearing (an approval or the owner's yes), not a later ask.
  return (contract && lines.filter(([, e]) => e.kind === 'owner-yes' || e.decision === 'approved').pop()) || lines.pop();
};
function setBrief(cfg, id, text) {
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
function leadBriefs(dir, args, cfg) {
  const at = lastClearing(dir, args[0]);
  const ids = String(args[args.indexOf('--agents') + 1] || '').split(',');
  if (!at || !args.includes('--agents') || !fs.existsSync(path.join(cfg, 'projects'))) return;
  ids.forEach((id, i) => { if (/^[\w-]+$/.test(id)) setBrief(cfg, id, (b) => `${b} Sweep: ${at[1].hash} role ${i + 1}`); });
  // --agents auto: the lead started every reviewer whose brief it wrote.
  const all = ids[0] === 'auto' ? fs.readdirSync(path.join(cfg, 'projects')).flatMap((p) => fs.readdirSync(path.join(cfg, 'projects', p)).flatMap((s) => { try { return fs.readdirSync(path.join(cfg, 'projects', p, s, 'subagents')); } catch { return []; } })).map((n) => (n.match(/^agent-(.+)\.jsonl$/) || [])[1]).filter(Boolean) : ids;
  for (const id of all) startedByBrief(dir, cfg, id);
}
// The guard started a reviewer under the clearing and role its brief names.
function startedByBrief(dir, cfg, id) {
  let f = /^[\w-]+$/.test(id) && fs.existsSync(path.join(cfg, 'projects')) && transcriptOf(cfg, id);
  // The guard starts only the reviewer type; another type with a sweep's brief is refused.
  try { if (f && !/reviewer$/i.test(JSON.parse(read(f.replace(/\.jsonl$/, '.meta.json'))).agentType)) f = null; } catch { f = null; }
  const content = f && JSON.parse(read(f).split('\n')[0]).message?.content;
  const tag = f && (Array.isArray(content) ? content.map((x) => (x && x.text) || '').join('\n') : String(content || '')).match(/Sweep: ([0-9a-f]{16}) role (\d+)/);
  const clearing = tag && sweepLog(dir).filter((l) => { const e = JSON.parse(l); return e.hash === tag[1] && (e.kind === 'owner-yes' || e.decision === 'approved'); }).pop();
  if (clearing) guardStart(dir, clearing, Number(tag[2]), id);
}
const transcriptOf = (cfg, id) => {
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
function guardStart(dir, clearingLine, role, id) {
  const slots = path.join(dir, '.git', 'kit-sweep-starts', crypto.createHash('sha256').update(clearingLine).digest('hex').slice(0, 16));
  fs.mkdirSync(slots, { recursive: true });
  const retried = sweepLog(dir).some((l) => { const e = JSON.parse(l); return e.kind === 'retry' && e.role === role && e.crashed !== id; });
  const f = path.join(slots, retried ? `${role - 1}.retry` : String(role - 1));
  if (!fs.existsSync(f) || !read(f) || read(f).startsWith('toolu_lead_')) fs.writeFileSync(f, `toolu_lead_${id}`);
}

function approveRun(contract, dir = sweepRepo()) {
  const f = path.join(dir, 'sweeps', 'contract.json');
  fs.writeFileSync(f, JSON.stringify(contract));
  return { ...approveIn(dir, [f]), dir, f };
}
const approvalLog = (dir) => read(path.join(dir, '.git', 'kit-sweep-approvals.jsonl')).trim().split('\n').map((l) => JSON.parse(l));
// A fake Claude config folder holding one reviewer transcript per agent id, where approve.mjs reads what each role
// spent (the meter is processed tokens from the role's own transcript). Each call is [input, cache read, cache
// write, output]; a call given as { id, u } keeps its message id, so streaming's repeated lines can be written.
// Beside each transcript sits Claude Code's agent-<id>.meta.json (agent type, finished); `meta` overrides it per id,
// and `cfg` adds to an existing folder.
// `models` gives an id's calls a model other than the top one (roleModels(contract) maps ids to their roles' models).
function transcripts(spec, meta = {}, cfg = makeTemp('cfg-'), session = 'session-1', models = {}) {
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
let agentSeq = 0;
const roleModel = (r) => r.model ?? (['security', 'novel-lens'].includes(r.kind) ? 'claude-opus-5-5' : 'claude-sonnet-5-5');
const roleModels = (ids, roles) => Object.fromEntries(ids.map((id, i) => [id, roleModel(roles[i])]));
// Logs a sweep's outcome with one transcript per role, the given total split across them.
function outcome(r, tokens = '200000', findings = '6', real = '5', dup = '0', extra = []) {
  const roles = JSON.parse(read(r.f)).roles || [];
  const n = roles.length;
  const ids = Array.from({ length: n }, () => `t${++agentSeq}`);
  const each = Math.floor(Number(tokens) / n);
  // Each transcript runs on the model its role names, as a real reviewer does.
  const cfg = transcripts(Object.fromEntries(ids.map((id, i) => [id, [{ model: roleModel(roles[i]), u: [0, each + (i ? 0 : Number(tokens) - each * n), 0, 0] }]])));
  return approveIn(r.dir, [r.f, '--outcome', '--agents', ids.join(','), '--findings', findings, '--real', real, '--duplicates', dup, ...extra], { CLAUDE_CONFIG_DIR: cfg });
}

// Improvement report IR-2026-10-30-pr-body-audit-holds-checks-from-another-project: the Standard audit held one
// project's facts (its dependency-audit wording, a corpus line, web gates), so an honest body elsewhere could only
// fail or lie. Those checks now come from the project's .kit/pr-body.json; the secrets line stays fixed for all.
// T13 (the owner, 2026-11-10): the title is the squash subject (`type: subject`), the review rows are the project's
// own, and what GitHub shows (files, gates) is not repeated.
const STD_TITLE = 'feat: an alarm for online search and a data date on About';
const stdAudit = (dir, text, title = STD_TITLE) => {
  const f = path.join(dir, 'body.md');
  fs.writeFileSync(f, text);
  return spawnSync('node', [path.resolve('project/.claude/pr-body-audit.mjs'), f, title], { encoding: 'utf8', cwd: dir });
};
const honestBody = () => read(path.resolve('user/skills/pr-body/examples/standard.md'))
  .replace('; the corpus and the served documents are unchanged', '');

// IR-2026-10-31-overlay-on-team-repo: a team repo keeps its tracked CLAUDE.md; the kit's own CLAUDE.md goes to a
// personal CLAUDE.local.md with a header saying the host file wins, the host file is recorded as host-owned so no
// check flags it, and the kit's local files stay out of git.
function overlayKit() {
  const ctx = makeKit();
  fs.writeFileSync(path.join(ctx.kit, 'project/CLAUDE.md'), '# Kit CLAUDE\n\n@AGENTS.md\n');
  fs.writeFileSync(path.join(ctx.kit, 'project/AGENTS.md'), '# Kit AGENTS\n');
  g(ctx.proj, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(ctx.proj, 'CLAUDE.md'), "# The team's own rules\n");
  return ctx;
}

// why: guards rule:kit-stays-local
test('a team repo with a tracked CLAUDE.md gets the kit as an overlay: CLAUDE.local.md, host-owned, nothing flagged or untracked', () => {
  const { kit, home, proj } = overlayKit();
  commitAll(proj, 'team', true);
  const r = install({ kit, home, target: 'project', projectDir: proj });
  assert.equal(read(path.join(proj, 'CLAUDE.md')), "# The team's own rules\n", 'the team file is untouched');
  assert.ok(r.created.includes('CLAUDE.local.md'));
  assert.deepEqual(r.hostOwned, ['CLAUDE.md']);
  assert.ok(!r.skipped.some((s) => s.file === 'CLAUDE.md'), 'host-owned, not skipped');
  const local = read(path.join(proj, 'CLAUDE.local.md'));
  assert.match(local, /here is owned by the host repo/);
  assert.match(local, /^@AGENTS\.md$/m);
  assert.match(local, /sweep tier/);
  assert.deepEqual(JSON.parse(read(path.join(proj, '.kit', 'kit-version.json'))).hostOwned, ['CLAUDE.md']);
  fs.writeFileSync(path.join(proj, '.claude', 'skill-cases.local.json'), '{"on":[]}');
  assert.equal(g(proj, 'status', '--porcelain').stdout.trim(), '', 'git status stays clean');
  assert.doesNotMatch(sessionStartReport({ kit, home, projectDir: proj }), /CLAUDE\.md/);
  assert.ok(!foldBack({ kit, home, target: 'project', projectDir: proj }).conflict.includes('CLAUDE.md'));
  // A second install keeps the overlay as it is.
  const again = install({ kit, home, target: 'project', projectDir: proj });
  assert.ok(!again.created.includes('CLAUDE.local.md') && !again.skipped.some((s) => s.file === 'CLAUDE.md'));
});

// why: guards rule:kit-stays-local
test("an untracked CLAUDE.md of the owner's own is skipped with a pointer to --overlay, and --overlay applies it", () => {
  const { kit, home, proj } = overlayKit();
  const r = install({ kit, home, target: 'project', projectDir: proj });
  assert.match(r.skipped.find((s) => s.file === 'CLAUDE.md').reason, /--overlay/);
  assert.equal(fs.existsSync(path.join(proj, 'CLAUDE.local.md')), false);
  const o = install({ kit, home, target: 'project', projectDir: proj, overlay: true });
  assert.ok(o.created.includes('CLAUDE.local.md'));
  const plain = makeKit();
  fs.writeFileSync(path.join(plain.kit, 'project/CLAUDE.md'), '# Kit CLAUDE\n');
  install({ kit: plain.kit, home: plain.home, target: 'project', projectDir: plain.proj });
  assert.equal(fs.existsSync(path.join(plain.proj, 'CLAUDE.local.md')), false, "no overlay where CLAUDE.md is the kit's");
});

// why: catches a break at scripts/kit.mjs:547 that no other test catches
test('an overlay on a repo that also owns its AGENTS.md says the kit core needs a home', () => {
  const { kit, home, proj } = overlayKit();
  fs.writeFileSync(path.join(proj, 'AGENTS.md'), "# The team's agents file\n");
  commitAll(proj, 'team', true);
  const r = install({ kit, home, target: 'project', projectDir: proj });
  assert.match(r.skipped.find((s) => s.file === 'AGENTS.md').reason, /CLAUDE\.local\.md imports it/);
});

// The owner, 2026-10-31: the kit's own CLAUDE.md never goes public, whatever tracking.json says, and it works beside
// a host's CLAUDE.md through the overlay.
// why: guards rule:first-push-gate
test("the kit's CLAUDE.md and CLAUDE.local.md stay out of git even when the kit is tracked or they are listed in track", () => {
  const dir = localProject();
  kitInstall(dir);
  fs.writeFileSync(path.join(dir, '.kit', 'tracking.json'), JSON.stringify({ kit: 'tracked', track: ['CLAUDE.md', 'CLAUDE.local.md', 'main.py'] }));
  kitInstall(dir);
  assert.equal(g(dir, 'check-ignore', '-q', 'CLAUDE.md').status, 0, 'still excluded in tracked mode');
  assert.equal(g(dir, 'check-ignore', '-q', 'CLAUDE.local.md').status, 0);
  // The backups install keeps hold the owner's text, private files included (the review of ccdbdee).
  assert.equal(g(dir, 'check-ignore', '-q', '.kit/kit-backups/x/CLAUDE.local.md').status, 0, 'backups stay out in tracked mode');
  g(dir, 'add', 'main.py');
  g(dir, 'add', '-f', 'CLAUDE.md');
  const staged = spawnSync('node', [path.join(dir, '.claude', 'first-push-check.mjs'), '--staged'], { encoding: 'utf8', cwd: dir });
  assert.equal(staged.status, 1, staged.stderr);
  assert.match(staged.stderr, /CLAUDE\.md:[\s\S]*never goes public/);
  commitAll(dir, 'slip', true);
  const r = firstPush(dir);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /CLAUDE\.md/);
});

// why: guards rule:first-push-gate
test("a host-owned CLAUDE.md is the host's to track", () => {
  const { kit, home, proj } = overlayKit();
  commitAll(proj, 'team', true);
  install({ kit, home, target: 'project', projectDir: proj });
  assert.notEqual(g(proj, 'check-ignore', '-q', 'CLAUDE.md').status, 0, "the host's file is not hidden");
  assert.equal(g(proj, 'check-ignore', '-q', 'CLAUDE.local.md').status, 0);
});

// The owner, 2026-10-31: a missing kit is a full stop. Each prompt in a folder without the kit, or in a session whose
// Claude config folder has no kit, is refused with the fix, until the latest kit is installed.
const promptGate = (script, input, env) => {
  const r = spawnSync('node', [script], { input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', ...input }), encoding: 'utf8', env: { ...process.env, ...env } });
  return r.stdout ? JSON.parse(r.stdout) : {};
};

// why: guards rule:outward-acts
test('the project hook stops every prompt when the Claude config folder has no kit, and lets the install through', () => {
  const proj = makeTemp('gate-');
  const empty = makeTemp('cfg-');
  const env = { KIT_CLAUDE_HOME: empty, CLAUDE_PROJECT_DIR: proj };
  const hook = path.resolve('project/.claude/kit-hook.cjs');
  const stop = spawnSync('node', [hook, 'prompt'], { input: JSON.stringify({ prompt: 'build the feature' }), encoding: 'utf8', env: { ...process.env, ...env } });
  const out = JSON.parse(stop.stdout);
  assert.equal(out.decision, 'block');
  assert.ok(out.reason.includes(empty.split(path.sep).join('/')), out.reason);
  assert.match(out.reason, /install user/);
  const fix = spawnSync('node', [hook, 'prompt'], { input: JSON.stringify({ prompt: 'run node kit.mjs install user' }), encoding: 'utf8', env: { ...process.env, ...env } });
  assert.notEqual((fix.stdout ? JSON.parse(fix.stdout) : {}).decision, 'block');
});

// why: guards rule:ci-gate
test('the user-level gate stops a prompt in a folder without the kit, until it is installed or the folder opts out', () => {
  const gate = path.resolve('user/kit-hooks/kit-gate.cjs');
  const dir = localProject();
  const stopped = promptGate(gate, { cwd: dir, prompt: 'fix the bug' });
  assert.equal(stopped.decision, 'block');
  assert.match(stopped.reason, /methodology-kit/);
  assert.notEqual(promptGate(gate, { cwd: dir, prompt: '/methodology-kit existing' }).decision, 'block', 'the fix itself runs');
  kitInstall(dir);
  assert.notEqual(promptGate(gate, { cwd: path.join(dir), prompt: 'fix the bug' }).decision, 'block', 'installed');
  const other = localProject();
  fs.mkdirSync(path.join(other, '.kit'));
  fs.writeFileSync(path.join(other, '.kit', 'no-kit'), '');
  assert.notEqual(promptGate(gate, { cwd: other, prompt: 'hi' }).decision, 'block', 'opted out');
});

// why: guards rule:ci-gate
test('the user install wires the gate into the Claude config folder settings once, keeping what is there', () => {
  const { kit, home } = makeKit();
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ model: 'x', hooks: { Stop: [{ hooks: [] }] } }));
  install({ kit, home, target: 'user' });
  install({ kit, home, target: 'user' });
  const s = JSON.parse(read(path.join(home, 'settings.json')));
  assert.equal(s.model, 'x');
  assert.ok(s.hooks.Stop);
  const gates = s.hooks.UserPromptSubmit.flatMap((h) => h.hooks).filter((h) => (h.args || []).join(' ').includes('kit-gate.cjs'));
  assert.equal(gates.length, 1);
});

// IR-2026-10-31-commit-check-cannot-see-a-worktree-s-staged-files: builders commit in their own worktrees, and the
// commit check read the main checkout's index (or, with a relative hooks path, never ran there at all).
// why: guards rule:first-push-gate
test('the commit check runs in an agent worktree and reads that worktree\'s staged files', () => {
  const dir = readyProject();
  const wt = path.join(dir, '.claude', 'worktrees', 'unit-1');
  assert.equal(g(dir, 'worktree', 'add', '-q', '-b', 'unit-1', wt).status, 0);
  fs.writeFileSync(path.join(wt, '.env'), 'X=1\n');
  g(wt, 'add', '-f', '.env');
  const blocked = g(wt, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'chore: slip');
  assert.notEqual(blocked.status, 0, 'the worktree commit is checked');
  assert.match(blocked.stderr, /\.env: a secret-shaped file/);
  g(wt, 'rm', '-q', '--cached', '.env');
  fs.writeFileSync(path.join(wt, 'ok.py'), 'print(2)\n');
  g(wt, 'add', 'ok.py');
  const ok = g(wt, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'chore: fine');
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout + ok.stderr, /Commit check: PASS/, 'a run is visible');
});

// The owner removed the PR attribution standard, so a host's two-line block fails every body audit, wherever it
// sits. The corpus came from a separate writer who never saw the check; "unclear" cases fail closed.
const ATTRIBUTION = '<!-- claude-projects-attribution: {"github_login":"someone"} -->\n_Requested by **Pat**_\n\n';
const CORPUS = JSON.parse(read(path.resolve('tests/attribution-corpus.json')));
const leanAudit = (dir, text) => {
  const lean = read(path.resolve('user/skills/pr-body/examples/lean.md'));
  const f = path.join(dir, 'lean.md');
  fs.writeFileSync(f, text(lean));
  const title = lean.split('\n')[0].replace(/^## /, '').replace(/^[A-Za-z ]+: /, 'feat: ');
  return spawnSync('node', [path.resolve('project/.claude/pr-body-audit-lean.mjs'), f, title], { encoding: 'utf8', cwd: dir });
};

// M28: CI runs this audit on every PR, and it caught 1 of 13 logic breaks. Each case is a slip a writer really makes,
// and must fail exactly its own row: a row that stops failing, or starts failing a good body, shows here.
// why: guards rule:pr-body
test('the lean PR-body audit fails each real slip on its own row, and only that row, at each limit', () => {
  const dir = makeTemp('lean-');
  const lean = read(path.resolve('user/skills/pr-body/examples/lean.md'));
  const title = lean.split('\n')[0].replace(/^## [A-Za-z ]+: /, 'feat: ');
  let last = '';
  const fails = (body, t = title) => {
    const f = path.join(dir, 'body.md');
    fs.writeFileSync(f, body);
    const r = spawnSync('node', [path.resolve('project/.claude/pr-body-audit-lean.mjs'), f, t], { encoding: 'utf8', cwd: dir });
    const out = r.stdout.split('\n').filter((l) => /^(PASS|FAIL) {2}/.test(l));
    assert.deepEqual(out.map((l) => ROWS.find((n) => l.slice(6).startsWith(n))), ROWS, 'every row is reported, in order');
    const rows = out.filter((l) => l.startsWith('FAIL')).map((l) => ROWS.find((n) => l.slice(6).startsWith(n)));
    assert.equal(r.status, rows.length ? 1 : 0, r.stdout);
    assert.match(r.stdout, rows.length ? /AUDIT FAILED\s*$/ : /AUDIT PASSED\s*$/);
    last = r.stdout;
    return rows;
  };
  const ROWS = ['no attribution block', 'title is type: subject, at most 72 with the squash suffix (smaller PR)', 'H1 is <Area>: <line>, no type prefix', 'H1 line carries the title subject',
    'H1 area does not repeat the subject', 'every line <= 110', '0 non-ASCII characters', 'no mechanism or AI words', 'no vault paths', 'framing summary before Changes',
    'Changes / Gates / Notes, in order', 'no Visuals section in a Lean body', 'every gate ticked', 'review names the dimensions', 'review names the sweep tier', 'no spaced dashes in prose',
    'size: small body (<= 180 words, 18 lines, 3 changes, 3 gates)', 'no confirmation phrase', 'version bumped, or no user-facing change'];
  const sub = (from, to) => { assert.ok(lean.includes(from), from); return lean.replace(from, to); };
  const NOTES = '**Notes** - Tooling only; the app does not change.';
  const words = lean.split(/\s+/).filter(Boolean).length;
  const lines = lean.split('\n').filter((l) => l.trim()).length;
  const cases = [
    ['the example', lean, title, []],
    ['an attribution line', `${lean}\n_Requested by **Pat**_\n`, title, ['no attribution block']],
    ['a type outside the list', lean, title.replace('feat:', 'feature:'), ['title is type: subject, at most 72 with the squash suffix (smaller PR)']],
    ['a scoped type', lean, title.replace('feat:', 'feat(hooks):'), []],
    ['a type prefix in the H1', sub('## Commit hook:', '## feat:'), title, ['H1 is <Area>: <line>, no type prefix']],
    ['an H1 that drops the title subject', lean, title.replace(' on commit', ''), ['H1 line carries the title subject']],
    // 1.33.0 (the owner, 2026-11-15): a heading whose area ends in the subject's first word reads it twice.
    ['an H1 area that repeats the subject', sub('## Commit hook:', `## Commit ${lean.split('\n')[0].replace(/^## [^:]+: /, '').split(/\s+/)[0]}:`), title, ['H1 area does not repeat the subject']],
    ['a line of 110', sub(NOTES, `**Notes** - ${'x'.repeat(98)}`), title, []],
    ['a line of 111', sub(NOTES, `**Notes** - ${'x'.repeat(99)}`), title, ['every line <= 110']],
    ['an em dash', sub('Tooling only;', `Tooling only${String.fromCharCode(0x2014)}`), title, ['0 non-ASCII characters']],
    ['a tab', sub('Tooling only;', 'Tooling\tonly;'), title, ['0 non-ASCII characters']],
    ['a vault path', sub('the app does not change.', 'see docs/sweeps/x.md.'), title, ['no vault paths']],
    ['a .claude path (its name is also a banned word)', sub('the app does not change.', 'see .claude/x.cjs.'), title, ['no mechanism or AI words', 'no vault paths']],
    ['a _Working Memory path', sub('the app does not change.', 'see _Working Memory.md.'), title, ['no vault paths']],
    ['no framing', lean.replace(/\n\nEvery commit[\s\S]*?everything\.\n/, '\n'), title, ['framing summary before Changes']],
    ['Gates before Changes', lean.replace(/(\*\*Changes\*\*[\s\S]*?)(\*\*Gates\*\*[\s\S]*?)(\*\*Notes\*\*)/, '$2$1$3'), title, ['Changes / Gates / Notes, in order']],
    ['an open gate', sub('- [x] A one-file', '- [ ] A one-file'), title, ['every gate ticked']],
    ['a missing dimension', sub('legal and licensing, ', ''), title, ['review names the dimensions']],
    // New 4 (build 13, reproduced on 1.38.0): the rule's third gate is the sweep tier and its result by dimension, and
    // a body that named no tier passed. An exemption is stated as one; a tier word in other prose is not the gate.
    ['no sweep tier', sub('- [x] Fix tier review: privacy', '- [x] Reviewed for privacy'), title, ['review names the sweep tier']],
    ['a stated exemption', sub('- [x] Fix tier review: privacy', '- [x] Sweep exempt: privacy'), title, []],
    ['a tier word outside the gates', sub('- [x] Fix tier review: privacy', '- [x] Reviewed for privacy').replace('Tooling only;', 'Tooling only, a triage tier change;'), title, ['review names the sweep tier']],
    // The build 13 sweep: the tier opens the last gate; a tier word in another gate, or a negated exemption, is no tier.
    ['a tier word in another gate', sub('- [x] Fix tier review: privacy', '- [x] Reviewed for privacy').replace('- [x] The covering tests', '- [x] The fix tier tests'), title, ['review names the sweep tier']],
    ['a negated exemption', sub('- [x] Fix tier review: privacy', '- [x] Not sweep exempt: privacy'), title, ['review names the sweep tier']],
    ['a spaced dash', sub('Tooling only;', 'Tooling only - for now;'), title, ['no spaced dashes in prose']],
    ['a double dash', sub('Tooling only;', 'Tooling only -- for now;'), title, ['no spaced dashes in prose']],
    ['a dash in inline code', sub('Tooling only;', 'Tooling only (`a - b`);'), title, []],
    [`${180 - words} words up to 180`, sub(NOTES, `${NOTES}\n${'w '.repeat(180 - words).trim()}`), title, []],
    ['181 words', sub(NOTES, `${NOTES}\n${'w '.repeat(181 - words).trim()}`), title, ['size: small body (<= 180 words, 18 lines, 3 changes, 3 gates)']],
    ['18 lines', sub(NOTES, `${NOTES}${'\nw'.repeat(18 - lines)}`), title, []],
    ['19 lines', sub(NOTES, `${NOTES}${'\nw'.repeat(19 - lines)}`), title, ['size: small body (<= 180 words, 18 lines, 3 changes, 3 gates)']],
    ['a fourth change', sub('\n\n**Gates**', '\n- One more.\n\n**Gates**'), title, ['size: small body (<= 180 words, 18 lines, 3 changes, 3 gates)']],
    ['a fourth gate', sub('\n\n**Notes**', '\n- [x] One more.\n\n**Notes**'), title, ['size: small body (<= 180 words, 18 lines, 3 changes, 3 gates)']],
  ];
  for (const word of ['AI', 'agent', 'agents', 'subagent', 'Claude', 'anthropic', 'swarm', 'Opus', 'sonnet', 'builder', 'checkers']) {
    cases.push([`the word ${word}`, sub('the app does not change.', `the ${word} does not change.`), title, ['no mechanism or AI words']]);
  }
  for (const word of ['AIR', 'reagents', 'checkerboard']) cases.push([`the word ${word}`, sub('the app does not change.', `the ${word} does not change.`), title, []]);
  // K115 (1.42.0, reproduced on 1.41.0): a body quoting a command or a file name in a code span was refused for the tool
  // word inside it. A tool word in a code span passes only as part of a path or command; a bare one, or one beside a
  // span, is still the word on the page.
  for (const span of ['`claude -p`', '`subagents.md`', '`tools/agent-roles.json`', '`agents --list`']) cases.push([`a code span ${span}`, sub('the app does not change.', `the app runs ${span} as before.`), title, []]);
  for (const text of ['the app runs `claude` as before.', 'the `-p` claude flag stays.', 'the `x` and `Opus` stay.']) cases.push([`a bare tool word: ${text}`, sub('the app does not change.', text), title, ['no mechanism or AI words']]);
  // Handoff item 15: the page shows an entity as its character, so the audit reads it that way.
  for (const word of ['&#65;I', '&#x41;I', '&#65I', 'sub&#97;gent']) cases.push([`${word} as written`, sub('the app does not change.', `the ${word} does not change.`), title, ['no mechanism or AI words']]);
  cases.push(['an em dash as an entity', sub('Tooling only;', 'Tooling only&#8212;'), title, ['0 non-ASCII characters']]);
  cases.push(['a vault path behind an entity', sub('the app does not change.', 'see docs&#47;sweeps/x.md.'), title, ['no vault paths']]);
  // A command in a fenced block is code, so its dashes pass; prose after the fence closes is read again.
  const fence = (after) => sub(NOTES, `**Notes** - Tooling.\n\n\`\`\`\nnode --test\n\`\`\`\n${after}`);
  cases.push(['dashes in a fenced block', fence('Done.'), title, []]);
  cases.push(['a spaced dash after a fenced block', fence('Done - now.'), title, ['no spaced dashes in prose']]);
  for (const [name, body, t, want] of cases) assert.deepEqual(fails(body, t), want, name);
  // The writer is sent to the line at fault.
  const at = lean.split('\n').indexOf(NOTES) + 1;
  fails(sub(NOTES, `**Notes** - ${'x'.repeat(99)}`));
  assert.match(last, new RegExp(`over: \\[\\[${at},111\\]\\]`));
  fails(sub('the app does not change.', 'the AI does not change.'));
  assert.match(last, new RegExp(`@${at}\\b`));
  fails(sub('the app does not change.', 'see docs/sweeps/x.md.'));
  assert.match(last, new RegExp(`lines ${at}\\b`));
});

const notesAudit = (dir, text) => {
  const f = path.join(dir, 'notes.md');
  fs.writeFileSync(f, text);
  return spawnSync('node', [path.resolve('user/skills/release-notes/audit.mjs'), f, '1.0.0'], { encoding: 'utf8', cwd: dir });
};

// why: guards rule:pr-body
test('the attribution check refuses every disguise in the corpus and passes prose about it', async () => {
  const { attributionFaults } = await import('../project/.claude/no-attribution.mjs');
  for (const body of [...CORPUS.mustFail, ...CORPUS.unclear.map((u) => u.s)]) assert.notDeepEqual(attributionFaults(body), [], JSON.stringify(body));
  for (const body of CORPUS.mustPass) assert.deepEqual(attributionFaults(body), [], JSON.stringify(body));
});

// Handoff item 10: judged against a base, the phrase comes from the base, so a branch cannot change it.
// why: guards rule:agent-canary
test('the PR-body canary reads the phrase from PR_BASE when one is set, and from disk when not', async () => {
  const { carriesPhrase } = await import('../project/.claude/canary-phrase.mjs');
  const dir = canaryRepo('Tango Lima Seven Delta');
  const g = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  g('add', '-A'); g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'phrase');
  const base = g('rev-parse', 'HEAD').stdout.trim();
  fs.writeFileSync(path.join(dir, 'standards', 'agent-teams.md'), `# Rules\n\n\`\`\`\nRULES EVERY AGENT FOLLOWS\n${phraseLine('Echo Golf Nine Kilo')}\`\`\`\n`);
  const body = 'Done. Tango Lima Seven Delta.';
  assert.equal(carriesPhrase(body, dir, base), true, 'the base phrase is still caught');
  assert.equal(carriesPhrase(body, dir, ''), false, 'with no base, the edited file on disk is read');
  assert.equal(carriesPhrase('Echo Golf Nine Kilo', dir, ''), true);
});

// Handoff item 15, for the Standard audit: a banned word or a dash spelled as an entity is the word on the page.
// why: guards rule:pr-body
test('the Standard PR-body audit reads an entity as the character the page shows', () => {
  const dir = makeTemp('prb-');
  assert.equal(stdAudit(dir, honestBody()).status, 0);
  const fails = (from, to) => stdAudit(dir, honestBody().replace(from, to)).stdout.split('\n').filter((l) => l.startsWith('FAIL'));
  const line = honestBody().split('\n').find((l) => / the /.test(l) && !l.startsWith('#'));
  assert.ok(line, 'the example has a prose line to change');
  assert.match(fails(line, line.replace(' the ', ' the &#67;laude ')).join('\n'), /no mechanism or AI words/);
  assert.match(fails(line, line.replace(' the ', ' the &#8212; ')).join('\n'), /0 non-ASCII characters/);
  // K115: a tool word inside a quoted command passes; a bare one in a code span still fails.
  assert.doesNotMatch(fails(line, line.replace(' the ', ' the `claude -p` ')).join('\n'), /no mechanism or AI words/);
  assert.match(fails(line, line.replace(' the ', ' the `claude` ')).join('\n'), /no mechanism or AI words/);
});

// why: guards rule:pr-body
test('both PR-body audits fail on the attribution block at the top, in the middle, or either half alone', () => {
  const dir = makeTemp('prb-');
  const FAILED = /FAIL\s+no attribution block/;
  const clean = stdAudit(dir, honestBody());
  assert.equal(clean.status, 0, 'a clean body still passes');
  assert.doesNotMatch(clean.stdout, FAILED);
  const lines = honestBody().split('\n');
  const [comment, line] = ATTRIBUTION.trimEnd().split('\n');
  for (const block of [ATTRIBUTION.trimEnd(), comment, line]) {
    assert.match(stdAudit(dir, block + '\n\n' + honestBody()).stdout, FAILED, block);
    assert.match(stdAudit(dir, [...lines.slice(0, 4), block, ...lines.slice(4)].join('\n')).stdout, FAILED, block);
  }
  assert.doesNotMatch(leanAudit(dir, (lean) => lean).stdout, FAILED);
  for (const body of [(lean) => ATTRIBUTION + lean, (lean) => lean + '\n' + line + '\n']) {
    const audit = leanAudit(dir, body);
    assert.match(audit.stdout, FAILED);
    assert.equal(audit.status, 1, audit.stdout);
  }
});

// why: guards rule:pr-body
test('the attribution check stays fast on a line of tick boxes', async () => {
  const { attributionFaults } = await import('../project/.claude/no-attribution.mjs');
  const start = Date.now();
  assert.deepEqual(attributionFaults('[ ] '.repeat(60)), []);
  assert.ok(Date.now() - start < 1000);
});

// why: guards rule:pr-body
test('the release notes audit fails on the attribution block, on the same corpus', () => {
  const dir = makeTemp('rna-');
  for (const body of [...CORPUS.mustFail, ...CORPUS.unclear.map((u) => u.s)]) assert.match(notesAudit(dir, body).stdout, /attribution block/, JSON.stringify(body));
  for (const body of CORPUS.mustPass) assert.doesNotMatch(notesAudit(dir, body).stdout, /attribution block/, JSON.stringify(body));
});

// why: guards rule:pr-body
test('the kit ships no way past the attribution check', () => {
  assert.equal(fs.existsSync(path.resolve('project/.claude/attribution.mjs')), false);
  for (const f of ['project/.claude/pr-body-audit.mjs', 'project/.claude/pr-body-audit-lean.mjs']) assert.doesNotMatch(read(path.resolve(f)), /stripAttribution|\.\/attribution\.mjs/);
});

// IR-2026-10-31-no-branch-rule-on-main-after-a-new-repo-goes-public: the first push gate made a repo public and
// stopped one step short of protecting main.
// why: guards rule:outward-acts
test('the kit ships the main branch rule as settings, and status flags an unprotected main', () => {
  const rule = JSON.parse(read(path.resolve('project/.claude/kit/branch-protection.json')));
  assert.deepEqual(Object.keys(rule).sort(), ['allow_deletions', 'allow_force_pushes', 'enforce_admins', 'required_pull_request_reviews', 'required_status_checks', 'restrictions']);
  assert.equal(rule.allow_force_pushes, false);
  assert.equal(rule.allow_deletions, false);
  assert.equal(rule.enforce_admins, false, 'admins may bypass');
  assert.equal(rule.required_pull_request_reviews, null, 'no review for a solo owner');
  assert.equal(rule.required_status_checks.contexts.length, 1, 'one gate check');
  assert.equal(rule.required_status_checks.strict, true, 'the merge gate needs a branch up to date before it merges');
  const { kit, home, proj } = makeKit();
  install({ kit, home, target: 'user' });
  install({ kit, home, target: 'project', projectDir: proj });
  const say = (state) => status({ kit, home, projectDir: proj, ahead: () => 0, protection: () => state }).text;
  assert.match(say('unprotected'), /main is not protected on GitHub/);
  assert.doesNotMatch(say('protected'), /not protected/);
  assert.doesNotMatch(say(null), /not protected/, 'no remote, no gh, or no access: nothing to say');
});

// The owner, 2026-10-31: a full stop names the kit folder and the exact install steps, read from the install records.
// why: catches a break at user/kit-hooks/kit-gate.cjs:56 that no other test catches
test('both stop messages name the kit folder and the exact steps to install it', () => {
  const kitDir = path.resolve('.').split(path.sep).join('/');
  // The folder gate reads the kit folder from the config folder's install record.
  const home = makeTemp('cfg-');
  fs.writeFileSync(path.join(home, 'kit-install.json'), JSON.stringify({ version: '1.0.0', kitDir, files: {} }));
  const dir = localProject();
  const stop = promptGate(path.resolve('user/kit-hooks/kit-gate.cjs'), { cwd: dir, prompt: 'hi' }, { KIT_CLAUDE_HOME: home });
  assert.ok(stop.reason.includes(`git -C "${kitDir}" fetch --tags`), stop.reason);
  assert.match(stop.reason, /check out the newest release tag/);
  assert.doesNotMatch(stop.reason, /pull/);
  assert.match(stop.reason, /\/methodology-kit existing/);
  // The project hook reads it from the project's install record when the config folder has none.
  const proj = localProject();
  kitInstall(proj);
  const empty = makeTemp('cfg-');
  const r = spawnSync('node', [path.resolve('project/.claude/kit-hook.cjs'), 'prompt'], { input: JSON.stringify({ prompt: 'go' }), encoding: 'utf8', env: { ...process.env, KIT_CLAUDE_HOME: empty, CLAUDE_PROJECT_DIR: proj } });
  const reason = JSON.parse(r.stdout).reason;
  assert.ok(reason.includes(`git -C "${kitDir}" fetch --tags`), reason);
  assert.match(reason, /check out the newest release tag/);
  assert.doesNotMatch(reason, /pull/);
  assert.ok(reason.includes(`node "${kitDir}/scripts/kit.mjs" install user`), reason);
});

// K124 (1.42.0): the planted-bug sweep of the folder gate. It finds its config folder from where it is installed when
// no variable names one; reads a kit project from its top folder; takes a folder with only rules/ as no kit; and
// calls the launcher broken only when the settings run it.
// why: guards rule:outward-acts
// planted: {"file":"user/kit-hooks/kit-gate.cjs","was":"(s && s.hooks && s.hooks.PreToolUse)","to":"(s || s.hooks && s.hooks.PreToolUse)"}
// planted: {"file":"user/kit-hooks/kit-gate.cjs","was":"const gateHome = process.env.KIT_CLAUDE_HOME || path.dirname","to":"const gateHome = process.env.KIT_CLAUDE_HOME && path.dirname"}
// planted: {"file":"user/kit-hooks/kit-gate.cjs","was":"top.status === 0 ? top.stdout.trim() : cwd","to":"top.status !== 0 ? top.stdout.trim() : cwd"}
// planted: {"file":"user/kit-hooks/kit-gate.cjs","was":"has('scripts/kit.mjs') && has('rules')","to":"has('scripts/kit.mjs') || has('rules')"}
test('the folder gate finds its own config folder, reads a project from its top, and names a broken launcher only when wired', () => {
  const home = makeTemp('cfg-');
  fs.mkdirSync(path.join(home, 'kit-hooks'));
  fs.copyFileSync(path.resolve('user/kit-hooks/kit-gate.cjs'), path.join(home, 'kit-hooks', 'kit-gate.cjs'));
  fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'node', args: ['kit-tools/kit-launch.cjs'] }] }] } }));
  const env = { ...process.env };
  delete env.KIT_CLAUDE_HOME;
  const gate = (cwd, settings) => {
    if (settings) fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify(settings));
    const r = spawnSync('node', [path.join(home, 'kit-hooks', 'kit-gate.cjs')], { input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', cwd, prompt: 'hi' }), encoding: 'utf8', env });
    return r.stdout ? JSON.parse(r.stdout) : {};
  };
  const proj = localProject();
  fs.mkdirSync(path.join(proj, '.kit'));
  fs.writeFileSync(path.join(proj, '.kit', 'kit-version.json'), '{}');
  fs.mkdirSync(path.join(proj, 'src'));
  assert.match(gate(proj).reason || '', /launcher .* is missing/, 'a wired launcher that is gone, with no variable naming the folder');
  const named = { permissions: { allow: ['Bash(node kit-tools/kit-launch.cjs)'] } };
  assert.equal(gate(path.join(proj, 'src'), named).decision, undefined, 'a kit project read from a subfolder, the launcher only named');
  const rulesOnly = localProject();
  fs.mkdirSync(path.join(rulesOnly, 'rules'));
  assert.equal(gate(rulesOnly).decision, 'block', 'a rules folder alone is no kit');
});

// The launcher's entry names node by the path install user recorded: a node moved away breaks every tool call, so the
// gate says so; with no record, or a node that is there, it says nothing. And settings with no hooks block at all
// are no reason to let a kit-less folder through.
// why: guards rule:test-value (a gone node goes unnamed, or a healthy install is called broken, or a folder slips the gate)
// planted: {"file":"user/kit-hooks/kit-gate.cjs","was":".node || null","to":".node && null"}
// planted: {"file":"user/kit-hooks/kit-gate.cjs","was":"if (node && !fs.existsSync(node))","to":"if (node || !fs.existsSync(node))"}
// planted: {"file":"user/kit-hooks/kit-gate.cjs","was":"s.hooks && s.hooks.PreToolUse","to":"s.hooks || s.hooks.PreToolUse"}
test('the folder gate names a launcher node that is gone, and only that', () => {
  const home = makeTemp('cfg-');
  fs.mkdirSync(path.join(home, 'kit-hooks'));
  fs.mkdirSync(path.join(home, 'kit-tools'));
  fs.copyFileSync(path.resolve('user/kit-hooks/kit-gate.cjs'), path.join(home, 'kit-hooks', 'kit-gate.cjs'));
  fs.writeFileSync(path.join(home, 'kit-tools', 'kit-launch.cjs'), 'module.exports = 1;\n');
  const wired = { hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'node', args: ['kit-tools/kit-launch.cjs'] }] }] } };
  fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify(wired));
  const env = { ...process.env };
  delete env.KIT_CLAUDE_HOME;
  const gate = (cwd) => {
    const r = spawnSync('node', [path.join(home, 'kit-hooks', 'kit-gate.cjs')], { input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', cwd, prompt: 'hi' }), encoding: 'utf8', env });
    return r.stdout ? JSON.parse(r.stdout) : {};
  };
  const proj = localProject();
  fs.mkdirSync(path.join(proj, '.kit'));
  fs.writeFileSync(path.join(proj, '.kit', 'kit-version.json'), '{}');
  assert.equal(gate(proj).decision, undefined, 'no install record: nothing to check');
  fs.writeFileSync(path.join(home, 'kit-install.json'), JSON.stringify({ node: process.execPath }));
  assert.equal(gate(proj).decision, undefined, 'the recorded node is there');
  fs.writeFileSync(path.join(home, 'kit-install.json'), JSON.stringify({ node: path.join(home, 'no-such-node') }));
  const gone = gate(proj);
  assert.equal(gone.decision, 'block');
  assert.match(gone.reason, /started by a node that is no longer there \(.*no-such-node/); // pin: 3 (the reason the verify prints)
  fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ model: 'x' }));
  assert.equal(gate(localProject()).decision, 'block', 'settings with no hooks: a folder without the kit is still stopped');
});

// The project map (owner, 2026-10-31: option A, kept simple and trackable): one data file per project, checked
// against the repo, drawn as one plain page - the goal, progress with evidence, and how the parts connect.
const MAP = path.resolve('project/.claude/project-map.mjs');
const mapRun = (dir, args) => spawnSync('node', [MAP, ...args], { encoding: 'utf8', cwd: dir });
function mapRepo(map) {
  const dir = makeTemp('map-');
  fs.mkdirSync(path.join(dir, 'src', 'ask'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'ask', 'index.ts'), 'x\n');
  fs.mkdirSync(path.join(dir, '.kit'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.kit', 'project-map.json'), JSON.stringify(map));
  return dir;
}
const GOOD_MAP = {
  project: 'Demo', goal: 'Answer a service member\'s question offline.', successBar: ['Answers cite a public source'],
  parts: [{ id: 'ask', name: 'Ask', does: 'answers questions on the device', files: ['src/ask'] },
    { id: 'corpus', name: 'Corpus', does: 'public US-gov text', files: [] }],
  links: [{ from: 'ask', to: 'corpus', verb: 'searches' }],
  progress: [{ item: 'Offline answers', state: 'done', evidence: 'PR #12' }, { item: 'Citations', state: 'doing' }, { item: 'Voice', state: 'next' }],
};

// why: catches a break at project/.claude/project-map.mjs:25 that no other test catches
test('the project map check passes a sound map and names every fault in a bad one', () => {
  assert.equal(mapRun(mapRepo(GOOD_MAP), ['check']).status, 0);
  const bad = { ...GOOD_MAP, goal: '',
    parts: [{ ...GOOD_MAP.parts[0], files: ['src/ask', 'src/gone.ts'] }, GOOD_MAP.parts[1]],
    links: [{ from: 'ask', to: 'nowhere', verb: 'calls' }, { from: 'ask', to: 'corpus', verb: '' }],
    progress: [{ item: 'Offline answers', state: 'done' }, { item: 'Citations', state: 'blocked-ish' }] };
  const r = mapRun(mapRepo(bad), ['check']);
  assert.equal(r.status, 1);
  for (const fault of [/goal is empty/, /part ask: src\/gone\.ts does not exist/, /link ask -> nowhere: unknown part nowhere/,
    /link ask -> corpus: no verb/, /progress "Offline answers": done needs evidence/, /progress "Citations": state must be done, doing, next or blocked/]) {
    assert.match(r.stdout, fault);
  }
});

// why: guards rule:visible-tracking
test('the project map renders one self-contained page with states as words, and refuses a map that fails its check', () => {
  const dir = mapRepo(GOOD_MAP);
  const out = path.join(dir, 'map.html');
  const r = mapRun(dir, ['render', out]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const html = read(out);
  assert.match(html, /<title>Demo map<\/title>/);
  assert.match(html, /Answer a service member&#39;s question offline\./);
  assert.match(html, /Offline answers[\s\S]*?Done[\s\S]*?PR #12/);
  assert.match(html, /Ask[\s\S]*?searches[\s\S]*?Corpus/);
  assert.match(html, /1 of 3 done/);
  assert.doesNotMatch(html, /<script|https?:\/\//);
  fs.writeFileSync(path.join(dir, '.kit', 'project-map.json'), JSON.stringify({ ...GOOD_MAP, goal: '' }));
  assert.equal(mapRun(dir, ['render', out]).status, 1);
});

// why: guards rule:visible-tracking
test('the project map can be checked from a draft file outside the project, with paths still held to the project', () => {
  const dir = mapRepo(GOOD_MAP);
  const draft = path.join(makeTemp('draft-'), 'map.json');
  fs.writeFileSync(draft, JSON.stringify({ ...GOOD_MAP, parts: [{ ...GOOD_MAP.parts[0], files: ['src/ask', 'src/nope'] }, GOOD_MAP.parts[1]] }));
  const r = mapRun(dir, ['check', '--map', draft]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /part ask: src\/nope does not exist/);
});

// rule:commit-message-format and rule:branching as scripts: one line, a known type, no AI or tool trailer; a branch is
// <type>/<plain-kebab> with no tool prefix or internal code.
const NAMES = path.resolve('project/.claude/name-check.mjs');
const nameRun = (args) => spawnSync('node', [NAMES, ...args], { encoding: 'utf8' });
const msgFile = (text) => { const f = path.join(makeTemp('msg-'), 'MSG'); fs.writeFileSync(f, text); return f; };

// why: guards rule:commit-message-format
test('the commit message check passes the house style and names each fault', () => {
  for (const ok of ['fix: hold the page still behind the open reader\n', 'chore(deps-dev): bump vite\n', 'Merge branch main into feature/x\n',
    'fixup! fix: hold the page\n', 'feat: add the map\n# a comment git strips\n']) assert.equal(nameRun(['message', msgFile(ok)]).status, 0, ok);
  const cases = [
    ['Fix: Hold the page.\n', /type: subject/],
    ['update stuff\n', /type: subject/],
    ['feat: add the map\n\nlonger body\n', /one line/],
    ['feat: add the map\n\nCo-Authored-By: Someone <x@y.z>\n', /AI or tool trailer/],
    ['feat: add the map\nGenerated with a tool\n', /one line/],
    // T13 (the owner, 2026-11-10: "72 limit"): one change per line, detail in the PR body.
    [`fix: ${'x'.repeat(68)}\n`, /over 72/],
  ];
  for (const [text, fault] of cases) {
    const r = nameRun(['message', msgFile(text)]);
    assert.equal(r.status, 1, text);
    assert.match(r.stderr, fault, text);
  }
  assert.equal(nameRun(['message', msgFile(`fix: ${'x'.repeat(67)}\n`)]).status, 0, '72 characters pass');
});

// T13 (the owner, 2026-11-10: "type: subject"): the PR title is the squash commit's subject on main, so it is held to
// the same rule, and a script can group the changelog from main's history.
// why: guards rule:pr-body
test('the PR title check holds a title to the commit subject rule', () => {
  assert.equal(nameRun(['title', 'fix: guards that hold']).status, 0);
  for (const bad of ['Guards: hold the six holes', 'fix: guards that hold.', `feat: ${'x'.repeat(70)}`]) assert.equal(nameRun(['title', bad]).status, 1, bad);
  // 1.33.0 (the owner, 2026-11-15): a list row's code tells a reader outside the project nothing, and it is public for good.
  for (const bad of ['chore: the K61 merge steps', 'fix: close S23-4', 'feat: E12 merges on green']) {
    const r = nameRun(['title', bad]);
    assert.equal(r.status, 1, bad);
    assert.match(r.stderr, /internal code/, bad);
  }
  // Names the field shares in the same shape are words (the K61 sweep).
  for (const ok of ['fix: the Haiku price line and its 100K warning', 'feat: guards read UTF-8 and v1.33.0', 'fix: the SHA256 check reads UTF8 on ARM64', 'feat: sync to S3 from EC2']) assert.equal(nameRun(['title', ok]).status, 0, ok);
});

// why: guards rule:branching (a repo name is public for good, like a branch name)
test('the repo name check passes plain kebab words and refuses an internal code', () => {
  // A name with a number in it is still a name (web3, vue3); a code is one or two letters and a number, on its own.
  for (const ok of ['merge-on-green-probe', 'web3-wallet', 'vue3-starter', 'notes', 'py3-tools', 's3-sync', 'ec2-scripts', 'h2-console']) assert.equal(nameRun(['repo', ok]).status, 0, ok);
  for (const bad of ['k61-probe', 'probe-e12', 'My_Repo', 'b2']) assert.equal(nameRun(['repo', bad]).status, 1, bad);
});

// why: guards rule:commit-message-format
test('the branch name check passes plain type-prefixed names and refuses tool prefixes and internal codes', () => {
  for (const ok of ['main', 'feature/branch-blind-timeline', 'fix/hold-the-reader', 'chore/bump-vite', 'feat/project-map', 'dependabot/npm_and_yarn/vite-7.1.0'])
    assert.equal(nameRun(['branch', ok]).status, 0, ok);
  for (const bad of ['claude/project-thread-fkkmfn', 'worktree-agent-a1', 'feature/b2-calendar', 'feature/F9_Timeline', 'my-branch', 'feature/'])
    assert.equal(nameRun(['branch', bad]).status, 1, bad);
});

// why: guards rule:outward-acts
test('the commit-msg hook runs the message check, and the pre-push hook refuses a badly named branch', { windows: true }, () => {
  // The commit-msg hook, run as git runs it, refuses a message out of the house style.
  const msgHook = spawnSync('sh', [path.resolve('project/.githooks/commit-msg'), msgFile('update stuff\n')], { encoding: 'utf8' });
  assert.equal(msgHook.status, 1);
  assert.match(msgHook.stderr, /type: subject/);
  // The pre-push hook, run as git runs it: a push that sends a tool-prefixed branch stops at the name check.
  const dir = makeTemp('names-');
  fs.mkdirSync(path.join(dir, '.githooks'));
  fs.mkdirSync(path.join(dir, '.claude'));
  fs.copyFileSync(path.resolve('project/.githooks/pre-push'), path.join(dir, '.githooks/pre-push'));
  fs.copyFileSync(NAMES, path.join(dir, '.claude/name-check.mjs'));
  g(dir, 'init', '-q', '-b', 'main');
  const env = { ...process.env, AI_AGENT: '', CLAUDECODE: '' };
  const push = (ref) => spawnSync('sh', [path.join(dir, '.githooks/pre-push'), 'origin', 'x'],
    { cwd: dir, env, encoding: 'utf8', input: `${ref} ${'1'.repeat(40)} ${ref} ${'0'.repeat(40)}\n` });
  const bad = push('refs/heads/claude/project-thread-x');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /name-check: "claude\/project-thread-x"/);
});

// One home per job (the owner, 2026-10-31): the kit's skills load their detail from references/ on demand, so a
// broken link is a step that silently loads nothing.
// why: guards rule:kit-standards
test('every kit skill names itself, keeps a short description, and every link it carries resolves', () => {
  const root = path.resolve('user/skills');
  for (const name of fs.readdirSync(root)) {
    const dir = path.join(root, name);
    const skill = path.join(dir, 'SKILL.md');
    if (!fs.existsSync(skill)) continue;
    const front = read(skill).match(/^---\r?\n([\s\S]*?)\r?\n---/)[1];
    assert.equal(front.match(/^name: (.*)$/m)[1].trim(), name, `${name}: name matches its folder`);
    const desc = (front.match(/^description: (.*)$/m) || [])[1] || '';
    assert.ok(desc.length > 0 && desc.length <= 1024, `${name}: description 1-1,024 characters`);
    const mds = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? mds(path.join(d, e.name)) : e.name.endsWith(".md") ? [path.join(d, e.name)] : []);
    // Examples and templates are sample pieces whose links point into other repos; the skill and its references must resolve.
    for (const f of [skill, ...(fs.existsSync(path.join(dir, "references")) ? mds(path.join(dir, "references")) : [])]) {
      for (const m of read(f).matchAll(/\]\(([^)#\s]+\.md)(#[^)]*)?\)/g)) {
        if (/^[a-z]+:/i.test(m[1])) continue;
        assert.ok(fs.existsSync(path.resolve(path.dirname(f), m[1])), `${path.relative(root, f)}: link ${m[1]} resolves`);
      }
    }
  }
});

// A standby skill (the owner, 2026-10-31): moved out of the Claude config folder to save context, it lives on only in
// vendor/, so a later snapshot must keep that copy, not wipe it.
// why: catches a break at scripts/kit.mjs:882 that no other test catches
test('snapshot keeps the vendor copy of a skill that is on standby (not on this machine)', () => {
  const ctx = makeKit();
  addThirdParty(ctx);
  snapshot({ kit: ctx.kit, home: ctx.home });
  fs.rmSync(path.join(ctx.home, 'skills/vendor-skill'), { recursive: true });
  const r = snapshot({ kit: ctx.kit, home: ctx.home });
  assert.equal(read(path.join(ctx.kit, 'vendor/skills/vendor-pack/vendor-skill/SKILL.md')), 'vendor\n');
  assert.ok(r.missing.includes('vendor-skill'));
});

// Tracking checks as a script (the owner, 2026-10-31): the whole-file caps, an empty parking lot before a sweep, and
// evidence on every done line of a plan's Progress block.
const TRACK = path.resolve('project/.claude/tracking-check.mjs');
const trackRun = (dir, args) => spawnSync('node', [TRACK, ...args], { encoding: 'utf8', cwd: dir });

// why: guards rule:sweep-auto-approval
test('the tracking check measures the whole-file caps and names each file over its cap', () => {
  const dir = makeTemp('track-');
  const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n') + '\n';
  fs.writeFileSync(path.join(dir, '_Working Memory.md'), lines(60));
  fs.writeFileSync(path.join(dir, '_Active Plan.md'), lines(70));
  fs.writeFileSync(path.join(dir, '_Session Log.md'), Array.from({ length: 10 }, (_, i) => `## Session ${i}\nx\n`).join(''));
  const ok = trackRun(dir, ['caps']);
  assert.equal(ok.status, 0, ok.stdout);
  assert.match(ok.stdout, /\| _Working Memory\.md \| 60 lines \| 60 \| ok \|/);
  fs.writeFileSync(path.join(dir, '_Active Plan.md'), lines(71));
  fs.appendFileSync(path.join(dir, '_Session Log.md'), '## Session 11\nx\n');
  const over = trackRun(dir, ['caps']);
  assert.equal(over.status, 1);
  assert.match(over.stdout, /\| _Active Plan\.md \| 71 lines \| 70 \| OVER \|/);
  assert.match(over.stdout, /\| _Session Log\.md \| 11 sessions \| 10 \| OVER \|/);
});

// why: guards rule:outward-acts
test('the tracking check refuses a non-empty parking lot and a done line with no evidence', () => {
  const dir = makeTemp('track-');
  const plan = path.join(dir, 'plan.md');
  fs.writeFileSync(plan, '# Plan\n\n## Parking Lot\n\n## Progress\n\n- DONE: gate green on `ddca2b86`, 21/21\n- [x] sweep report linked (#181)\n\n## Tasks\n');
  assert.equal(trackRun(dir, ['parking', plan]).status, 0);
  assert.equal(trackRun(dir, ['progress', plan]).status, 0);
  fs.writeFileSync(plan, '# Plan\n\n## Parking Lot\n\n- dark map tiles - home - hunch: next\n\n## Progress\n\n- [x] it works now\n- DONE: looks fine\n');
  const p = trackRun(dir, ['parking', plan]);
  assert.equal(p.status, 1);
  assert.match(p.stdout, /1 idea\(s\) in the Parking Lot[\s\S]*now, next or drop/);
  const g = trackRun(dir, ['progress', plan]);
  assert.equal(g.status, 1);
  assert.match(g.stdout, /no evidence: "- \[x\] it works now"/);
  assert.match(g.stdout, /no evidence: "- DONE: looks fine"/);
  // Other shapes the plans write (the 1.30.1 sweep): a heading with a suffix, as the kit's batch-plan template has, a
  // "* " or "1. " list, a "###" heading, and a "**Parking Lot:**" label with the ideas on its line. Each passed as empty.
  fs.writeFileSync(plan, '# Plan\n\n## Parking Lot (triage before the sweep)\n<empty at the start>\n\n## Progress (ticked with evidence)\n\n* [x] built the export\n');
  assert.equal(trackRun(dir, ['parking', plan]).status, 0);
  assert.match(trackRun(dir, ['progress', plan]).stdout, /no evidence: "\* \[x\] built the export"/);
  for (const lot of ['## Parking Lot (triage)\n* dark tiles', '### Parking Lot\n1. dark tiles', '**Parking Lot:** dark tiles; a CSV export']) {
    fs.writeFileSync(plan, `# Plan\n\n${lot}\n\n## Tasks\n`);
    assert.equal(trackRun(dir, ['parking', plan]).status, 1, lot);
  }
});

// Skill cases suggested from the repo (the owner, 2026-10-31): the session-start question names the cases the repo's
// own files point to, so the owner confirms a list instead of building one.
// why: catches a break at scripts/kit.mjs:1627 that no other test catches
test('session start suggests skill cases from the repo when none are chosen', () => {
  const { kit, home, proj } = caseKit();
  const catalog = { cases: ['ui-design', 'ui-review', 'feature-build', 'debugging', 'review', 'security', 'cloudflare', 'ml-data', 'data-pipelines', 'api', 'teaching']
    .map((id) => ({ id, name: id, when: 'x', skills: [] })) };
  fs.writeFileSync(path.join(proj, '.claude/kit/skill-cases.json'), JSON.stringify(catalog));
  fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ devDependencies: { '@sveltejs/kit': '3.0.0' } }));
  fs.writeFileSync(path.join(proj, 'wrangler.toml'), 'name = "x"\n');
  let msg = sessionStartReport({ kit, home, projectDir: proj });
  assert.deepEqual(msg.match(/Suggested from this repo: ([^.]*)\./)[1].split(', '), ['ui-design', 'ui-review', 'feature-build', 'debugging', 'review', 'security', 'cloudflare']);
  // pin: 1 (the JSON line is what the project writes to turn them on)
  assert.match(msg, /\{"on":\["ui-design","ui-review","feature-build","debugging","review","security","cloudflare"\]\}/);
  fs.rmSync(path.join(proj, 'package.json'));
  fs.rmSync(path.join(proj, 'wrangler.toml'));
  fs.writeFileSync(path.join(proj, 'requirements.txt'), 'torch==2.5\ntransformers>=4\napache-airflow\n');
  msg = sessionStartReport({ kit, home, projectDir: proj });
  assert.deepEqual(msg.match(/Suggested from this repo: ([^.]*)\./)[1].split(', '), ['feature-build', 'debugging', 'review', 'ml-data', 'data-pipelines']);
});

// why: catches a break in scripts/kit.mjs; the only test that caught it when tagged, others catch it too since the build 14 audit
test('status names a memory index past 6,000 B, which loads in every session', () => {
  const { kit, home, proj } = makeKit();
  const cfg = path.join(kit, 'kit.config.json');
  fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), caps: { realLoad: 100000 } }));
  const idx = path.join(home, 'projects', projectSlug(proj), 'memory', 'MEMORY.md');
  fs.mkdirSync(path.dirname(idx), { recursive: true });
  fs.writeFileSync(idx, 'm'.repeat(6000));
  const s = () => status({ kit, home, projectDir: proj, ahead: () => 0, protection: () => null }).text;
  assert.doesNotMatch(s(), /Memory index is/);
  fs.writeFileSync(idx, 'm'.repeat(6001));
  assert.match(s(), /Memory index is 6,001 B \(over 6,000\)[\s\S]*rule:kit-standards items 3 and 14/);
});

// Plan kit-autopilot, Phase 1: outward acts are the owner's unless a standing grant covers them. The rule lives in
// three always-read places (CLAUDE.md Hard Rule 14, AGENTS.md non-negotiable 6, rule:outward-acts) and one home for
// its detail (rule:standing-grants); a copy that drops the exception, or a Rule 14 that drifts from the owner's
// approved words (Tier 0), is the failure this guards.
// The owner, 2026-11-10 (pop-up): Rule 14 names the feature-branch push bound.
// why: guards rule:collaborative-design-locks
test('Rule 14, non-negotiable 6 and rule:outward-acts all name the standing grant, and Rule 14 is the owner\'s text', () => {
  // The owner's text, re-locked 2026-11-15 (build 6, pop-up): opening a PR from a pushed feature branch joins the push
  // bound's exception, both pointing to rule:outward-acts.
  const rule14 = '14. **Outward acts are the owner\'s unless granted.** Nothing is pushed, merged, released or published without the owner\'s yes, except a push inside the push bound and opening a PR from that branch (rule:outward-acts), and a standing grant the owner wrote and only the owner changes (adapter row A27): the grant names its acts and the conditions each must pass; every granted act is logged and reported after with proof, and a kill switch outside the repo stops the next one.';
  assert.ok(read(path.resolve('project/CLAUDE.md')).split('\n').includes(rule14), 'CLAUDE.md Hard Rule 14 is the approved text');
  const six = read(path.resolve('rules/_parts/agents-head.md')).split('\n').find((l) => l.startsWith('6. '));
  assert.match(six, /standing grant/i);
  assert.match(six, /rule:outward-acts/);
  const core = read(path.resolve('rules/core.md'));
  const outward = core.slice(core.indexOf('{#outward-acts}'), core.indexOf('{#session-workflow}'));
  assert.match(outward, /rule:standing-grants/);
  const ids = new Set(ruleFiles().flatMap((f) => headings(read(f)).map((h) => h.id)));
  assert.ok(ids.has('standing-grants'), 'rule:standing-grants has its one home');
  assert.match(read(path.resolve('rules/project-adapter.md')), /^\| A27 \| .*standing grant/im);
});

const ROWS = () => ({
  sheet: { id: 's1', title: 'One', grounding: 'Line one.\n\nLine two.' },
  questions: [
    { id: 'q2', sheet: 's1', section: 1, order: 2, sectionTitle: 'A', text: 'Second?', why: 'w2', options: [{ key: 'a', label: 'Yes', detail: 'more' }, { key: 'b', label: 'No' }], rec: 'b', recWhy: 'because' },
    { id: 'q1', sheet: 's1', section: 1, order: 1, sectionTitle: 'A', text: 'First?', options: [{ key: 'a', label: 'Up' }], rec: 'a' },
    { id: 'q3', sheet: 's1', section: 2, order: 1, sectionTitle: 'B', text: 'Third?' },
  ],
  answers: { q1: { choice: 'a' }, q2: { own: 'my   own\nwords ', thought: 'odd spelng' }, s1__finish: { missed: 'tell me more', submitted: '2026-11-04T17:52:08.656Z' } },
});

// M21: the kit source installs no kit, so before 1.21.0 nothing checked its commit messages until CI did, and the fix
// needed a history rewrite. Build turns its own hook on once per clone.
// why: guards rule:outward-acts
test('build turns on the kit source commit-msg hook, which refuses a bad message, and leaves an owner hooks path alone', { windows: true }, () => {
  const dir = makeTemp('srchooks-');
  const g = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  g('init', '-q', '-b', 'main'); g('config', 'user.name', 't'); g('config', 'user.email', 't@t');
  fs.mkdirSync(path.join(dir, '.githooks')); fs.mkdirSync(path.join(dir, 'project/.claude'), { recursive: true });
  fs.copyFileSync(path.resolve('.githooks/commit-msg'), path.join(dir, '.githooks/commit-msg'));
  fs.chmodSync(path.join(dir, '.githooks/commit-msg'), 0o755);
  fs.copyFileSync(path.resolve('project/.claude/name-check.mjs'), path.join(dir, 'project/.claude/name-check.mjs'));
  assert.equal(sourceHooks(dir), 'set');
  assert.equal(sourceHooks(dir), 'present');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
  g('add', 'a.txt');
  assert.notEqual(g('commit', '-qm', 'Rules: a squash-style subject').status, 0, 'a bad subject is refused');
  assert.equal(g('commit', '-qm', 'feat: a good subject').status, 0);
  g('config', 'core.hooksPath', 'elsewhere');
  assert.match(sourceHooks(dir), /left alone/);
  assert.equal(g('config', 'core.hooksPath').stdout.trim(), 'elsewhere');
});

// T4: the build command itself, not the helper it calls.
// why: guards rule:outward-acts
test('T4: kit.mjs build turns on the kit source commit-msg hook', { windows: true }, () => {
  const dir = path.join(makeTemp('kit-clone-'), 'k');
  assert.equal(spawnSync('git', ['clone', '-q', path.resolve('.'), dir], { encoding: 'utf8' }).status, 0);
  assert.equal(spawnSync('git', ['-C', dir, 'config', '--get', 'core.hooksPath'], { encoding: 'utf8' }).stdout.trim(), '');
  assert.equal(spawnSync('node', ['scripts/kit.mjs', 'build'], { cwd: dir, encoding: 'utf8' }).status, 0);
  assert.notEqual(spawnSync('git', ['-C', dir, 'config', '--get', 'core.hooksPath'], { encoding: 'utf8' }).stdout.trim(), '');
});

// N5: GitHub's docs promise no head pin past a writer's push, so the hook refuses a push over a head still armed.
// The kit source holds its own pushes the same way (.githooks/pre-push), so the gate can arm a PR there too.
// why: guards rule:standing-grants
for (const hook of ['project/.githooks/pre-push', '.githooks/pre-push']) test(`the pre-push hook refuses a push over an armed head until it is disarmed, for any pusher (${hook})`, { windows: true }, () => {
  const dir = makeTemp('armed-');
  assert.equal(spawnSync('git', ['init', '-q', '-b', 'main', dir]).status, 0);
  fs.mkdirSync(path.join(dir, '.githooks'));
  fs.copyFileSync(path.resolve(hook), path.join(dir, '.githooks', 'pre-push'));
  fs.writeFileSync(path.join(dir, '.git', 'kit-first-push-done'), '');
  const head = 'a'.repeat(40);
  const other = 'b'.repeat(40);
  const log = path.join(dir, '.git', 'kit-merge-gate.log');
  const push = (remote) => spawnSync('sh', [path.join(dir, '.githooks', 'pre-push'), 'origin', 'x'], { encoding: 'utf8', cwd: dir,
    input: `refs/heads/feat/x ${other} refs/heads/feat/x ${remote}\n`, env: { ...process.env, KIT_PUSH_APPROVED: '1', AI_AGENT: '', CLAUDECODE: '' } });
  assert.equal(push(head).status, 0, 'no log, no refusal');
  fs.writeFileSync(log, `t ARMED https://github.com/o/r/pull/7 ${head} required=ci\n`);
  const held = push(head);
  assert.equal(held.status, 1, held.stderr);
  assert.match(held.stderr, /disarm 7/);
  assert.equal(push(other).status, 0, 'another head is not this armed one');
  assert.equal(push('0'.repeat(40)).status, 0, 'a new branch has no armed head');
  fs.appendFileSync(log, 't DISARMED 7\n');
  assert.equal(push(head).status, 0, 'disarmed, it goes');
  fs.appendFileSync(log, `t ARMED https://github.com/o/r/pull/7 ${head} required=ci\n`);
  assert.equal(push(head).status, 1, 'armed again, it holds again');
});

// why: guards rule:outward-acts
test('the pre-push hook holds a head armed on two PRs until both are disarmed', { windows: true }, () => {
  const dir = makeTemp('armed-');
  assert.equal(spawnSync('git', ['init', '-q', '-b', 'main', dir]).status, 0);
  fs.writeFileSync(path.join(dir, '.git', 'kit-first-push-done'), '');
  const head = 'a'.repeat(40);
  const log = path.join(dir, '.git', 'kit-merge-gate.log');
  const push = () => spawnSync('sh', [path.resolve('project/.githooks/pre-push'), 'origin', 'x'], { encoding: 'utf8', cwd: dir,
    input: `refs/heads/feat/x ${'b'.repeat(40)} refs/heads/feat/x ${head}\n`, env: { ...process.env, KIT_PUSH_APPROVED: '1', AI_AGENT: '', CLAUDECODE: '' } });
  fs.writeFileSync(log, `t ARMED https://github.com/o/r/pull/7 ${head} required=ci\nt ARMED https://github.com/o/r/pull/8 ${head} required=ci\nt DISARMED 8\n`);
  assert.equal(push().status, 1, 'PR 7 is still armed');
  fs.appendFileSync(log, 't DISARMED 7\n');
  assert.equal(push().status, 0);
});

// Handoff item 23: find walks into .git where a shell's * does not, so only a name or path filter keeps it out.
// why: guards rule:outward-acts
test('find with only broad filters asks where its start folder holds .git; a name filter, or a folder without .git, passes', async () => {
  const { createRequire } = await import('node:module');
  const guard = createRequire(import.meta.url)(path.resolve('project/.claude/guard-delete.cjs'));
  const dir = gitTree();
  fs.mkdirSync(path.join(dir, 'build'));
  const asks = (command) => Boolean(guard.decide({ tool_name: 'Bash', session_id: '11111111-2222-3333-4444-555555555555', cwd: dir, tool_input: { command } }, { tmpdir: os.tmpdir(), projectDir: dir }));
  for (const command of ['find . -type f -delete', 'find . -mtime +7 -delete', `find ${dir.split(path.sep).join('/')} -size +1M -delete`, 'find -type f -delete']) assert.equal(asks(command), true, command);
  for (const command of ["find . -name '*.pyc' -delete", "find . -path './build/*' -delete", 'find build -type f -delete']) assert.equal(asks(command), false, command);
});

// M27: one reading of a command for both guards, so a spelling fixed for one is fixed for both.
// why: guards rule:outward-acts
test('both guards read a command through the one reading module, and keep no reading of their own', async () => {
  const { createRequire } = await import('node:module');
  const require2 = createRequire(import.meta.url);
  for (const f of ['guard-delete.cjs', 'guard-outward.cjs']) {
    const s = read(path.resolve('project/.claude', f));
    assert.match(s, /require\('\.\/guard-read\.cjs'\)/, `${f} loads the shared reading`);
    assert.doesNotMatch(s, /function (normalize|plainText|tokenize|joinContinuations)\b/, `${f} keeps no reading of its own`);
  }
  const read2 = require2(path.resolve('project/.claude/guard-read.cjs'));
  const words = (t) => read2.tokenize(t).map((seg) => seg.filter((w) => !w.redirect).map((w) => w.value));
  assert.deepEqual(words('git push 2>&1 > log; echo "a b" c'), [['git', 'push'], ['echo', 'a b', 'c']]);
  assert.equal(read2.plainText(`git${String.fromCharCode(0x2003)}pu\\sh`, 'Bash'), 'git push');
});

// why: guards rule:first-push-gate. K27, the 1.27.0 install review: the check took its project from KIT_HOOK_PROJECT
// whenever it was set, so a tool that set it before a git command pointed the gate at another folder.
test('the first push check reads only the repository it runs in, whatever KIT_HOOK_PROJECT names', () => {
  const run = (...a) => spawnSync(...a);
  const root = kitTemp.makeTemp('k27-');
  const mk = (name) => {
    const d = path.join(root, name);
    fs.mkdirSync(d);
    run('git', ['init', '-q', '-b', 'main', d]);
    run('git', ['-C', d, '-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-q', '--allow-empty', '-m', 'one']);
    return d;
  };
  const app = mk('app');
  const other = mk('other');
  const check = (cwd, project) => run(process.execPath, [path.resolve('project/.claude/first-push-check.mjs'), '--staged'], { cwd, encoding: 'utf8', env: { ...process.env, KIT_HOOK_PROJECT: project } });
  const r = check(app, other);
  assert.notEqual(r.status, 0, 'the gate read another repository');
  assert.match(r.stdout + r.stderr, /KIT_HOOK_PROJECT names another repository/);
  // An agent worktree of the project shares its repository: the shim's name for the main checkout stands.
  run('git', ['-C', app, 'worktree', 'add', '-q', path.join(root, 'wt'), '-b', 'feat/wt']);
  const w = check(path.join(root, 'wt'), app);
  assert.doesNotMatch(w.stdout + w.stderr, /names another repository/);
  // The 1.28.0 sweep: a folder whose .git file points at the repository shares its git folder but is no checkout of it,
  // and its own settings would clear the gate. Only a checkout git lists (the main one or a worktree) is the project.
  const decoy = path.join(root, 'decoy');
  fs.mkdirSync(decoy);
  fs.writeFileSync(path.join(decoy, '.git'), `gitdir: ${path.join(app, '.git').split(path.sep).join('/')}\n`);
  const d = check(app, decoy);
  assert.notEqual(d.status, 0, 'a decoy folder was taken for the project');
  assert.match(d.stdout + d.stderr, /KIT_HOOK_PROJECT names another repository/);
  // A copy of the script placed in the decoy and run from there is held the same way.
  fs.mkdirSync(path.join(decoy, '.claude'));
  for (const f of ['first-push-check.mjs', 'secret-patterns.mjs', 'github-scanning.mjs']) fs.copyFileSync(path.resolve('project/.claude', f), path.join(decoy, '.claude', f));
  const env = { ...process.env };
  delete env.KIT_HOOK_PROJECT;
  const c = run(process.execPath, [path.join(decoy, '.claude', 'first-push-check.mjs'), '--staged'], { cwd: app, encoding: 'utf8', env });
  assert.notEqual(c.status, 0, 'a copy of the script in a decoy folder read that folder\'s settings');
});
