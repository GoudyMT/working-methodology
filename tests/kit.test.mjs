// Tests for scripts/kit.mjs - each one drives the CLI functions the way the owner does:
// a fake kit, a fake ~/.claude and a fake project in a temp folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { install, foldBack, bump, scrub, snapshot, restore, sessionStartReport, preCompactReport, promptCheckReport, vaultBackup, projectSlug, render, measure, headings, ledger, build, parseModule, findRules } from '../scripts/kit.mjs';

function makeKit() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-'));
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

test('projectSlug matches the folder name Claude Code uses for project memory', () => {
  assert.equal(
    projectSlug('D:\\Work\\Coding\\.Projects\\2026\\My App'),
    'D--Work-Coding--Projects-2026-My-App',
  );
});

test('render fills the owner name, profile and project folder', () => {
  const out = render('{{OWNER_NAME}}|{{OWNER_PROFILE}}|{{PROJECT_DIR}}', { ownerName: 'Pat', ownerProfile: '- x', projectDir: 'C:/a b' });
  assert.equal(out, 'Pat|- x|C:/a b');
});

test('install user writes rendered files into ~/.claude and stamps the version', () => {
  const { kit, home } = makeKit();
  const r = install({ kit, home, target: 'user' });
  assert.equal(read(path.join(home, 'CLAUDE.md')), '# Global\nOwner: Pat\n- Likes tests\n');
  assert.equal(read(path.join(home, 'agents/builder.md')), 'builder role\n');
  const stamp = JSON.parse(read(path.join(home, 'kit-install.json')));
  assert.equal(stamp.version, '1.0.0');
  // The kit skill finds the kit folder from this stamp.
  assert.equal(stamp.kitDir, kit.replace(/\\/g, '/'));
  assert.ok(stamp.files['CLAUDE.md']);
  assert.deepEqual(r.skipped, []);
});

test('install project copies standards, renders settings and seeds memory', () => {
  const { kit, home, proj } = makeKit();
  install({ kit, home, target: 'project', projectDir: proj });
  assert.equal(read(path.join(proj, '_Working Standards.md')), 'rules\n');
  assert.match(read(path.join(proj, '.claude/settings.json')), new RegExp(proj.replace(/\\/g, '/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const mem = path.join(home, 'projects', projectSlug(proj), 'memory', 'style.md');
  assert.equal(read(mem), 'style rule\n');
  assert.equal(JSON.parse(read(path.join(proj, '.kit/kit-version.json'))).version, '1.0.0');
});

test('install never overwrites a file the owner changed, and says so', () => {
  const { kit, home, proj } = makeKit();
  fs.writeFileSync(path.join(proj, '_Working Standards.md'), 'my own rules\n');
  const r = install({ kit, home, target: 'project', projectDir: proj });
  assert.equal(read(path.join(proj, '_Working Standards.md')), 'my own rules\n');
  assert.deepEqual(r.skipped.map((s) => s.file), ['_Working Standards.md']);
});

test('install with force replaces a changed file and keeps a backup of the old one', () => {
  const { kit, home, proj } = makeKit();
  fs.writeFileSync(path.join(proj, '_Working Standards.md'), 'my own rules\n');
  const r = install({ kit, home, target: 'project', projectDir: proj, force: true });
  assert.equal(read(path.join(proj, '_Working Standards.md')), 'rules\n');
  assert.deepEqual(r.replaced, ['_Working Standards.md']);
  assert.equal(read(path.join(r.backupDir, '_Working Standards.md')), 'my own rules\n');
});

test('a second install pulls kit updates into files the project left alone', () => {
  const { kit, home, proj } = makeKit();
  install({ kit, home, target: 'project', projectDir: proj });
  fs.writeFileSync(path.join(kit, 'project/_Working Standards.md'), 'rules v2\n');
  fs.writeFileSync(path.join(kit, 'VERSION'), '1.1.0\n');
  const r = install({ kit, home, target: 'project', projectDir: proj });
  assert.equal(read(path.join(proj, '_Working Standards.md')), 'rules v2\n');
  assert.deepEqual(r.updated, ['_Working Standards.md']);
  assert.equal(JSON.parse(read(path.join(proj, '.kit/kit-version.json'))).version, '1.1.0');
});

test('fold-back sorts each file into fold-back, update, conflict or new', () => {
  const { kit, home, proj } = makeKit();
  install({ kit, home, target: 'project', projectDir: proj });
  const memDir = path.join(home, 'projects', projectSlug(proj), 'memory');
  // The project improved a rule: a fold-back candidate.
  fs.writeFileSync(path.join(proj, '_Working Standards.md'), 'rules, improved\n');
  // The kit moved on where the project did not: an update.
  fs.writeFileSync(path.join(kit, 'project/.claude/settings.json'), '{"hook":"{{PROJECT_DIR}}/.claude/guard2.cjs"}\n');
  // Both changed: a conflict.
  fs.writeFileSync(path.join(memDir, 'style.md'), 'style, project edit\n');
  fs.writeFileSync(path.join(kit, 'memory/style.md'), 'style, kit edit\n');
  // A lesson the project learned that the kit has never seen.
  fs.writeFileSync(path.join(memDir, 'new-lesson.md'), 'lesson\n');
  const r = foldBack({ kit, home, target: 'project', projectDir: proj });
  assert.deepEqual(r.foldBack, ['_Working Standards.md']);
  assert.deepEqual(r.update, ['.claude/settings.json']);
  assert.deepEqual(r.conflict, ['memory/style.md']);
  assert.deepEqual(r.added, ['memory/new-lesson.md']);
  assert.match(r.report, /rules, improved/);
});

test('fold-back for user lists a new skill but ignores third-party skills', () => {
  const { kit, home } = makeKit();
  install({ kit, home, target: 'user' });
  fs.mkdirSync(path.join(home, 'skills/my-new-skill'), { recursive: true });
  fs.writeFileSync(path.join(home, 'skills/my-new-skill/SKILL.md'), 'new\n');
  fs.mkdirSync(path.join(home, 'skills/vendor-skill'), { recursive: true });
  fs.writeFileSync(path.join(home, 'skills/vendor-skill/SKILL.md'), 'vendor\n');
  const r = foldBack({ kit, home, target: 'user' });
  assert.deepEqual(r.added, ['skills/my-new-skill/SKILL.md']);
});

test('bump raises the version and adds a changelog entry on top', () => {
  const { kit } = makeKit();
  fs.writeFileSync(path.join(kit, 'CHANGELOG.md'), '# Changelog\n\n## 1.0.0 - 2026-01-01\n- first\n');
  const v = bump({ kit, level: 'minor', note: 'add the human-factor skill', date: '2026-10-24' });
  assert.equal(v, '1.1.0');
  assert.equal(read(path.join(kit, 'VERSION')), '1.1.0\n');
  assert.match(read(path.join(kit, 'CHANGELOG.md')), /# Changelog\n\n## 1\.1\.0 - 2026-10-24\n- add the human-factor skill\n\n## 1\.0\.0/);
});

test('scrub flags personal words, paths and non-ASCII, and passes clean files', () => {
  const { kit } = makeKit();
  fs.writeFileSync(path.join(kit, 'scrub.local.json'), JSON.stringify({ words: ['Pat', 'pat@example.com'] }));
  fs.writeFileSync(path.join(kit, 'project/leak.md'), 'Ask Pat at pat@example.com in C:\\' + 'Users\\pat - ok \u2192 x\n');
  const hits = scrub({ kit });
  const kinds = hits.filter((h) => h.file === 'project/leak.md').map((h) => h.kind).sort();
  assert.deepEqual(kinds, ['non-ascii', 'path', 'word:Pat', 'word:pat@example.com']);
  // kit.config.json and owner-profile.md hold the owner's details on purpose.
  assert.equal(hits.filter((h) => h.file === 'kit.config.json' || h.file === 'owner-profile.md').length, 0);
  fs.rmSync(path.join(kit, 'project/leak.md'));
  assert.deepEqual(scrub({ kit }), []);
});

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

test('snapshot keeps a credited copy of each third-party plugin and skill', () => {
  const ctx = makeKit();
  addThirdParty(ctx);
  const r = snapshot({ kit: ctx.kit, home: ctx.home, date: '2026-10-25' });
  const v = path.join(ctx.kit, 'vendor');
  assert.equal(read(path.join(v, 'plugins/toolbox/skills/sharpen/SKILL.md')), 'sharpen\n');
  assert.equal(fs.existsSync(path.join(v, 'plugins/toolbox/.in_use')), false);
  const src = JSON.parse(read(path.join(v, 'plugins/toolbox/SOURCE.json')));
  assert.deepEqual([src.version, src.commit, src.author, src.license], ['2.0.0', 'abc123', 'Jo Smith and Co', 'MIT']);
  assert.equal(read(path.join(v, 'skills/vendor-pack/vendor-skill/SKILL.md')), 'vendor\n');
  assert.match(read(path.join(v, 'skills/vendor-pack/LICENSE')), /MIT License/);
  const credits = read(path.join(v, 'CREDITS.md'));
  assert.match(credits, /toolbox.*Jo Smith.*MIT.*https:\/\/github\.com\/owner\/market/);
  assert.match(credits, /vendor-pack.*Pack Authors.*Apache-2\.0.*https:\/\/example\.com\/pack/);
  assert.deepEqual(r.missing, ['gone-plugin']);
});

test('restore brings a lost skill back from the snapshot and never overwrites one that exists', () => {
  const ctx = makeKit();
  addThirdParty(ctx);
  snapshot({ kit: ctx.kit, home: ctx.home });
  fs.rmSync(path.join(ctx.home, 'skills/vendor-skill'), { recursive: true });
  fs.mkdirSync(path.join(ctx.home, 'skills/sharpen'), { recursive: true });
  fs.writeFileSync(path.join(ctx.home, 'skills/sharpen/SKILL.md'), 'mine\n');
  assert.deepEqual(restore({ kit: ctx.kit, home: ctx.home, name: 'vendor-pack' }), { restored: ['vendor-skill'], kept: [] });
  assert.equal(read(path.join(ctx.home, 'skills/vendor-skill/SKILL.md')), 'vendor\n');
  assert.deepEqual(restore({ kit: ctx.kit, home: ctx.home, name: 'toolbox' }), { restored: [], kept: ['sharpen'] });
  assert.equal(read(path.join(ctx.home, 'skills/sharpen/SKILL.md')), 'mine\n');
});

test('scrub leaves the third-party snapshot alone', () => {
  const ctx = makeKit();
  fs.mkdirSync(path.join(ctx.kit, 'vendor/plugins/x'), { recursive: true });
  fs.writeFileSync(path.join(ctx.kit, 'vendor/plugins/x/README.md'), 'caf\u00e9 by someone\n');
  assert.deepEqual(scrub({ kit: ctx.kit }), []);
});

test('snapshot also finds plugins outside the plugin cache and fills a missing license', () => {
  const ctx = makeKit();
  addThirdParty(ctx);
  // A plugin delivered by the desktop app lives in its own folder, found by its plugin.json name.
  const root = path.join(ctx.home, 'app-plugins');
  const dir = path.join(root, 'org1', 'plugin_abc');
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'designer', version: '1.2.0', author: { name: 'Studio' } }));
  fs.mkdirSync(path.join(dir, 'skills/critique'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'skills/critique/SKILL.md'), 'critique\n');
  const config = JSON.parse(read(path.join(ctx.kit, 'kit.config.json')));
  config.vendor.pluginRoots = [root];
  config.vendor.plugins.push('designer');
  config.vendor.credits.designer = { repository: 'https://example.com/designer', license: 'Apache-2.0', licenseFrom: 'plugin:toolbox' };
  fs.writeFileSync(path.join(ctx.kit, 'kit.config.json'), JSON.stringify(config));
  const r = snapshot({ kit: ctx.kit, home: ctx.home });
  assert.ok(r.plugins.includes('designer'));
  const v = path.join(ctx.kit, 'vendor/plugins/designer');
  assert.equal(read(path.join(v, 'skills/critique/SKILL.md')), 'critique\n');
  assert.match(read(path.join(v, 'LICENSE')), /MIT License/);
  assert.equal(JSON.parse(read(path.join(v, 'SOURCE.json'))).repository, 'https://example.com/designer');
});

function hashTree(dir) {
  const out = {};
  const walkAll = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walkAll(p); else out[p] = read(p);
  } };
  if (fs.existsSync(dir)) walkAll(dir);
  return out;
}

test('fold-back only reports: it changes no file in the project, ~/.claude or the kit', () => {
  const { kit, home, proj } = makeKit();
  install({ kit, home, target: 'project', projectDir: proj });
  install({ kit, home, target: 'user' });
  fs.writeFileSync(path.join(proj, '_Working Standards.md'), 'rules, improved\n');
  const before = [hashTree(kit), hashTree(home), hashTree(proj)];
  foldBack({ kit, home, target: 'project', projectDir: proj });
  foldBack({ kit, home, target: 'user' });
  assert.deepEqual([hashTree(kit), hashTree(home), hashTree(proj)], before);
});

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

test('session start says when the kit has newer rules, and how many', () => {
  const { kit, home, proj } = caseKit();
  assert.doesNotMatch(sessionStartReport({ kit, home, projectDir: proj }), /newer/);
  bump({ kit, level: 'minor', note: 'one', date: '2026-02-01' });
  bump({ kit, level: 'patch', note: 'two', date: '2026-02-02' });
  assert.match(sessionStartReport({ kit, home, projectDir: proj }), /Kit 1\.1\.1 has 2 newer change\(s\) than this project \(1\.0\.0\)\. Run \/methodology-kit update\./);
});

test('session start lists the skills for the cases this project turned on', () => {
  const { kit, home, proj } = caseKit();
  assert.match(sessionStartReport({ kit, home, projectDir: proj }), /No skill cases chosen yet/);
  fs.writeFileSync(path.join(proj, '.claude/skill-cases.local.json'), JSON.stringify({ on: ['ui-ux'] }));
  const msg = sessionStartReport({ kit, home, projectDir: proj });
  assert.match(msg, /UI\/UX design or review \(a screen, flow or copy changes\): design:design-critique, human-factor/);
  assert.doesNotMatch(msg, /systematic-debugging/);
});

test('pre-compact counts what is waiting for the kit', () => {
  const { kit, home, proj } = caseKit();
  install({ kit, home, target: 'user' });
  assert.match(preCompactReport({ kit, home, projectDir: proj }), /No rule changes waiting for the kit\./);
  fs.writeFileSync(path.join(proj, '_Working Standards.md'), 'rules, improved\n');
  fs.writeFileSync(path.join(home, 'projects', projectSlug(proj), 'memory', 'new-lesson.md'), 'lesson\n');
  assert.match(preCompactReport({ kit, home, projectDir: proj }), /2 rule change\(s\) waiting for the kit: _Working Standards\.md, memory\/new-lesson\.md\. Sort them/);
});

test('the hook script prints a user message and context for Claude, and never fails the session', async () => {
  const { spawnSync } = await import('node:child_process');
  const { kit, home, proj } = caseKit();
  fs.writeFileSync(path.join(home, 'kit-install.json'), JSON.stringify({ kitDir: kit.replace(/\\/g, '/') }));
  // The hook loads the kit's own tool from the kit folder, as it does on a real machine.
  fs.mkdirSync(path.join(kit, 'scripts'), { recursive: true });
  fs.copyFileSync(path.resolve('scripts/kit.mjs'), path.join(kit, 'scripts/kit.mjs'));
  const hook = path.resolve('project/.claude/kit-hook.cjs');
  const run = (mode, env) => spawnSync(process.execPath, [hook, mode], { cwd: proj, input: '{}', encoding: 'utf8', env: { ...process.env, KIT_CLAUDE_HOME: home, CLAUDE_PROJECT_DIR: proj, ...env } });
  const start = run('session-start');
  assert.equal(start.status, 0);
  const out = JSON.parse(start.stdout);
  assert.match(out.hookSpecificOutput.additionalContext, /No skill cases chosen yet/);
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  const pre = run('pre-compact');
  assert.equal(pre.status, 0);
  assert.match(JSON.parse(pre.stdout).systemMessage, /waiting for the kit/);
  // A missing kit is a warning, not a failed session.
  const lost = run('session-start', { KIT_CLAUDE_HOME: path.join(home, 'nowhere') });
  assert.equal(lost.status, 0);
  assert.match(JSON.parse(lost.stdout).systemMessage, /kit not found/i);
});

test('every backup in the real kit credits its source', () => {
  const vendor = path.resolve('vendor');
  const credits = read(path.join(vendor, 'CREDITS.md'));
  const dirs = ['plugins', 'skills'].flatMap((d) => fs.readdirSync(path.join(vendor, d)).map((n) => path.join(vendor, d, n)));
  assert.ok(dirs.length > 0);
  for (const dir of dirs) {
    const name = path.basename(dir);
    const src = JSON.parse(read(path.join(dir, 'SOURCE.json')));
    for (const field of ['author', 'license', 'repository']) {
      assert.ok(src[field] && src[field] !== 'unknown', `${name}: ${field} is missing`);
    }
    assert.ok(fs.existsSync(path.join(dir, 'LICENSE')) || src.licenseNote, `${name}: no LICENSE file and no licenseNote`);
    assert.match(credits, new RegExp(`\\| ${name} \\|`), `${name}: not in CREDITS.md`);
  }
});

test('every skill the case map names exists in the kit, its backups or Claude Code itself', () => {
  const { cases } = JSON.parse(read(path.resolve('project/.claude/kit/skill-cases.json')));
  const BUILT_IN = new Set(['security-review']);
  const skillDirs = (root) => {
    const names = new Set();
    const look = (d) => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      if (fs.existsSync(path.join(d, e.name, 'SKILL.md'))) names.add(e.name);
      look(path.join(d, e.name));
    } };
    look(root);
    return names;
  };
  const own = skillDirs(path.resolve('user/skills'));
  const groups = skillDirs(path.resolve('vendor/skills'));
  for (const c of cases) {
    for (const s of c.skills) {
      const [plugin, skill] = s.includes(':') ? s.split(':') : [null, s];
      // A one-skill plugin may keep its SKILL.md at the plugin root instead of under skills/.
      const pluginRoot = plugin && path.resolve('vendor/plugins', plugin);
      const found = plugin ? skillDirs(path.join(pluginRoot, 'skills')).has(skill) || (skill === plugin && fs.existsSync(path.join(pluginRoot, 'SKILL.md')))
        : own.has(skill) || groups.has(skill) || BUILT_IN.has(skill);
      assert.ok(found, `case ${c.id}: skill ${s} not found`);
    }
  }
});

test('session start names the kit files this project changed, which update leaves alone', () => {
  const { kit, home, proj } = caseKit();
  fs.writeFileSync(path.join(proj, '_Working Standards.md'), 'my own rules\n');
  assert.match(sessionStartReport({ kit, home, projectDir: proj }), /1 kit file\(s\) changed in this project, so update leaves them alone: _Working Standards\.md\./);
});

test('pre-compact says when an installed third-party plugin moved past its backup', () => {
  const ctx = caseKit();
  addThirdParty(ctx);
  snapshot({ kit: ctx.kit, home: ctx.home });
  assert.doesNotMatch(preCompactReport({ kit: ctx.kit, home: ctx.home, projectDir: ctx.proj }), /third-party plugin/);
  const file = path.join(ctx.home, 'plugins/installed_plugins.json');
  const data = JSON.parse(read(file));
  data.plugins['toolbox@market'][0].version = '2.1.0';
  fs.writeFileSync(file, JSON.stringify(data));
  assert.match(preCompactReport({ kit: ctx.kit, home: ctx.home, projectDir: ctx.proj }), /1 third-party plugin\(s\) changed since the backup: toolbox \(2\.0\.0 -> 2\.1\.0\)\. Review, then run snapshot\./);
});

test('brief templates point to the one rules block and never carry a pasted copy', () => {
  for (const t of ['builder-brief.md', 'checker-brief.md']) {
    const body = read(path.resolve('user/skills/agent-team-build/templates', t));
    // Both forms: the rule ID through the index, and the single file a project not yet moved still has.
    assert.match(body, /read the "Rules every brief carries" item of rule:agent-team-adapter/);
    assert.match(body, /`<project folder>\/standards\/INDEX\.md` names its file/);
    assert.match(body, /still on one standards file keeps\nit in `<project folder>\/_Working Standards\.md`/);
    assert.doesNotMatch(body, /paste the block/i);
  }
});

function gitProject() {
  const ctx = caseKit();
  const git = (...a) => spawnSync('git', ['-C', ctx.proj, ...a], { encoding: 'utf8' });
  git('init', '-q');
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

test('vault backup copies the private notes, never a secret, and commits without pushing', () => {
  const { kit, home, proj, vault } = gitProject();
  const r = vaultBackup({ projectDir: proj, date: '2026-10-27' });
  assert.equal(read(path.join(vault, 'notes.md')), 'my notes\n');
  assert.equal(read(path.join(vault, 'notes/plan.md')), 'plan\n');
  assert.equal(read(path.join(vault, '_Working Standards.md')), 'rules\n');
  for (const secret of ['.env', '.dev.vars', 'app.js']) assert.equal(fs.existsSync(path.join(vault, secret)), false, secret);
  assert.ok(r.committed);
  const log = spawnSync('git', ['-C', vault, 'log', '--oneline'], { encoding: 'utf8' }).stdout;
  assert.match(log, /chore: vault backup 2026-10-27/);
  assert.equal(spawnSync('git', ['-C', vault, 'remote'], { encoding: 'utf8' }).stdout.trim(), '');
  // A second backup with nothing new makes no commit.
  assert.equal(vaultBackup({ projectDir: proj, date: '2026-10-27' }).committed, false);
  fs.writeFileSync(path.join(proj, 'notes.md'), 'my notes, more\n');
  assert.match(preCompactReport({ kit, home, projectDir: proj }), /Vault backup: 1 file\(s\) changed, committed in .*vault\. Push on the owner's go\./);
});

test('pre-compact reminds a project with no vault backup to set one up', () => {
  const { kit, home, proj } = caseKit();
  assert.match(preCompactReport({ kit, home, projectDir: proj }), /No vault backup set up/);
});

// The kit's own standards, checked the way Kit Standards #3 and #5 say: one home per rule, a why in every rule
// section, and size caps. These read the real rule modules in rules/, not a fixture.
const STANDARDS = () => fs.readdirSync(path.resolve('rules')).filter((n) => n.endsWith('.md')).sort()
  .map((n) => read(path.resolve('rules', n)).replace(/^---\n[\s\S]*?\n---\n/, '')).join('\n');
const words = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean);
const shingles = (w, n = 8) => { const s = new Set(); for (let i = 0; i + n <= w.length; i++) s.add(w.slice(i, i + n).join(' ')); return s; };

test('kit memory points to the standards instead of repeating them', () => {
  const ruleText = shingles(words(STANDARDS()));
  const repeats = [];
  for (const f of fs.readdirSync(path.resolve('memory')).filter((n) => n !== 'MEMORY.md')) {
    const body = read(path.resolve('memory', f)).split(/^---$/m).slice(2).join('---');
    for (const line of body.split('\n')) {
      if ([...shingles(words(line))].some((s) => ruleText.has(s))) repeats.push(`${f}: ${line.slice(0, 70)}`);
    }
  }
  assert.deepEqual(repeats, []);
});

test('every rule section in the standards says why', () => {
  const EXEMPT = new Set(['Critical Rules Priority Index', 'Handoff Message Structure', 'REQUIRED FIRST ACTIONS',
    'Working Mode: Plan (default)', 'State Snapshot', 'Newly-Established Working Standards',
    'Critical In-Flight Context (do NOT lose)', 'Reading Order (mandatory, in order)', 'Next Step (REQUIRED)',
    'Anti-Hallucination Discipline', 'Project Adapter (FILL-IN TEMPLATE)', 'What This File Is Not']);
  const missing = STANDARDS().split(/^(?=#{2,3} )/m)
    .filter((s) => /^#{2,3} /.test(s))
    .filter((s) => !EXEMPT.has(s.split('\n')[0].replace(/^#+ /, '').replace(/ \{#[^}]+\}$/, '').trim()))
    .filter((s) => !/why/i.test(s))
    .map((s) => s.split('\n')[0]);
  assert.deepEqual(missing, []);
});

// The caps the owner set (plan rule-modules): per module, for AGENTS.md, and for all a session loads at start.
test('the rules stay under their size caps and every start import resolves', () => {
  const caps = JSON.parse(read(path.resolve('kit.config.json'))).caps;
  assert.ok(caps && caps.module > 0 && caps.agentsMd > 0 && caps.sessionStart > 0, 'kit.config.json needs caps');
  const over = [];
  for (const n of fs.readdirSync(path.resolve('rules')).filter((x) => x.endsWith('.md') && x !== 'core.md')) {
    const b = Buffer.byteLength(read(path.resolve('rules', n)));
    if (b > caps.module) over.push(`${n}: ${b} > ${caps.module}`);
  }
  const agents = Buffer.byteLength(read(path.resolve('project/AGENTS.md')));
  if (agents > caps.agentsMd) over.push(`AGENTS.md: ${agents} > ${caps.agentsMd}`);
  const start = measure({ projectDir: path.resolve('project') });
  if (start.total > caps.sessionStart) over.push(`session start: ${start.total} > ${caps.sessionStart}`);
  assert.deepEqual(over, []);
  assert.deepEqual(start.unresolved, []);
});

test('a running session hears about a new kit release once, at the next message', () => {
  const { kit, home, proj } = caseKit();
  assert.equal(promptCheckReport({ kit, projectDir: proj }), '');
  // Another project releases the kit while this session runs.
  bump({ kit, level: 'minor', note: 'from the other project', date: '2026-03-01' });
  assert.match(promptCheckReport({ kit, projectDir: proj }), /Kit 1\.1\.0 was released while this session ran: 1 newer change\(s\) than this project \(1\.0\.0\)\. Run \/methodology-kit update at the next stopping point\./);
  assert.equal(promptCheckReport({ kit, projectDir: proj }), '');
  bump({ kit, level: 'patch', note: 'again', date: '2026-03-02' });
  assert.match(promptCheckReport({ kit, projectDir: proj }), /Kit 1\.1\.1 was released/);
  // Session start already said it, so the next message stays quiet.
  bump({ kit, level: 'patch', note: 'third', date: '2026-03-03' });
  sessionStartReport({ kit, home, projectDir: proj });
  assert.equal(promptCheckReport({ kit, projectDir: proj }), '');
});

test('session start says when the kit on GitHub is ahead of the kit folder', () => {
  const { kit, home, proj } = caseKit();
  const git = (cwd, ...a) => spawnSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
  git(kit, 'init', '-q', '-b', 'main'); git(kit, 'add', '-A'); git(kit, 'commit', '-q', '-m', 'kit');
  const remote = path.join(path.dirname(kit), 'remote.git');
  spawnSync('git', ['clone', '-q', '--bare', kit, remote]);
  git(kit, 'remote', 'add', 'origin', remote); git(kit, 'fetch', '-q', 'origin'); git(kit, 'branch', '-q', '-u', 'origin/main');
  assert.doesNotMatch(sessionStartReport({ kit, home, projectDir: proj }), /GitHub/);
  // A release pushed from another machine.
  const other = path.join(path.dirname(kit), 'other');
  spawnSync('git', ['clone', '-q', remote, other]);
  fs.writeFileSync(path.join(other, 'VERSION'), '1.2.0\n');
  git(other, 'commit', '-q', '-am', 'release'); git(other, 'push', '-q');
  assert.match(sessionStartReport({ kit, home, projectDir: proj }), /The kit on GitHub is 1 commit\(s\) ahead of the kit folder\. Run git pull in .* then \/methodology-kit update\./);
});

test('the hook script speaks at a message only when there is news', async () => {
  const { kit, home, proj } = caseKit();
  fs.writeFileSync(path.join(home, 'kit-install.json'), JSON.stringify({ kitDir: kit.replace(/\\/g, '/') }));
  fs.mkdirSync(path.join(kit, 'scripts'), { recursive: true });
  fs.copyFileSync(path.resolve('scripts/kit.mjs'), path.join(kit, 'scripts/kit.mjs'));
  const run = () => spawnSync(process.execPath, [path.resolve('project/.claude/kit-hook.cjs'), 'prompt'], { cwd: proj, input: '{}', encoding: 'utf8', env: { ...process.env, KIT_CLAUDE_HOME: home, CLAUDE_PROJECT_DIR: proj } });
  const quiet = run();
  assert.equal(quiet.status, 0);
  assert.equal(quiet.stdout, '');
  bump({ kit, level: 'minor', note: 'news', date: '2026-03-01' });
  const out = JSON.parse(run().stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(out.hookSpecificOutput.additionalContext, /was released while this session ran/);
  assert.match(out.systemMessage, /was released while this session ran/);
});

test('the load guard refuses a busy CPU and names what is using it', async () => {
  const { createRequire } = await import('node:module');
  const guard = createRequire(import.meta.url)(path.resolve('project/.claude/load-guard.cjs'));
  const busy = guard.checkLoad({ busy: 92, threshold: 70, top: ['node', 'chrome', 'vitest'] });
  assert.equal(busy.ok, false);
  assert.match(busy.message, /CPU is 92% busy \(limit 70%\)\. Using it most: node, chrome, vitest\. Free the CPU or wait, then run again\./);
  assert.equal(guard.checkLoad({ busy: 40, threshold: 70, top: [] }).ok, true);
});

test('the load guard script blocks or passes on the real machine', () => {
  const script = path.resolve('project/.claude/load-guard.cjs');
  const run = (max) => spawnSync(process.execPath, [script], { encoding: 'utf8', env: { ...process.env, LOAD_GUARD_MAX: String(max) } });
  const pass = run(101);
  assert.equal(pass.status, 0);
  const block = run(-1);
  assert.equal(block.status, 1);
  assert.match(block.stderr, /CPU is \d+% busy \(limit -1%\)\. Using it most: \S/);
  // --force is the owner's override: it runs even on a busy machine.
  const forced = spawnSync(process.execPath, [script, '--force'], { encoding: 'utf8', env: { ...process.env, LOAD_GUARD_MAX: '-1' } });
  assert.equal(forced.status, 0);
});

test('the load guard defaults to 40% over a 3-second average', async () => {
  const { createRequire } = await import('node:module');
  const guard = createRequire(import.meta.url)(path.resolve('project/.claude/load-guard.cjs'));
  assert.equal(guard.DEFAULT_MAX, 40);
  assert.equal(guard.SAMPLE_MS, 3000);
});

// measure models how Claude Code loads a project at session start (memory docs): CLAUDE.md, its @imports up to
// four hops, and rules with no paths field. A path in an import ends at the first unescaped space.
test('measure counts what a session loads at start, the way Claude Code reads imports', () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'measure-'));
  const w = (rel, body) => { fs.mkdirSync(path.dirname(path.join(proj, rel)), { recursive: true }); fs.writeFileSync(path.join(proj, rel), body); };
  w('CLAUDE.md', '# P\n@AGENTS.md\n@_Start Here.md\n@_Working\\ Standards.md\n`@not-an-import.md`\n```\n@in-a-fence.md\n```\n');
  w('AGENTS.md', 'core\n@AGENTS.md\n');
  w('_Start Here.md', 'start\n');
  w('_Working Standards.md', 'rules\n');
  w('not-an-import.md', 'x\n');
  w('in-a-fence.md', 'x\n');
  w('.claude/rules/always.md', 'always\n');
  w('.claude/rules/tests.md', '---\npaths:\n  - "**/*.test.*"\n---\nwhen tests\n');
  const r = measure({ projectDir: proj });
  assert.deepEqual(r.files.map((f) => f.file).sort(), ['.claude/rules/always.md', 'AGENTS.md', 'CLAUDE.md', '_Working Standards.md']);
  assert.equal(r.total, r.files.reduce((s, f) => s + f.bytes, 0));
  // An unescaped space cuts the path, so this import finds no file: the start file never loads.
  assert.deepEqual(r.unresolved, [{ from: 'CLAUDE.md', import: '_Start' }]);
});

// Plan rule-modules, Phase 1: every rule heading carries a fixed ID, so pointers survive renames and moves.
// Headings inside code blocks (the handoff template) are examples, not rules, and carry none.
const ruleFiles = () => fs.readdirSync(path.resolve('rules')).filter((n) => n.endsWith('.md')).map((n) => path.resolve('rules', n));
const moduleFiles = ruleFiles;
test('every rule heading has a unique, plain-word ID', () => {
  const seen = new Map(), bad = [];
  for (const f of ruleFiles()) {
    for (const h of headings(read(f))) {
      if (!h.id) { bad.push(`no ID: ${h.title}`); continue; }
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(h.id)) bad.push(`not plain words: ${h.id}`);
      if (seen.has(h.id)) bad.push(`duplicate: ${h.id}`);
      seen.set(h.id, f);
    }
  }
  assert.deepEqual(bad, []);
  // 70 rules came from 0.7.0 (the ledger test checks each); new rules only add to that.
  assert.ok(seen.size >= 70, `${seen.size} rule IDs`);
});

test('headings skips headings inside code blocks and reads the ID after the title', () => {
  const hs = headings('## One {#one}\n```\n## Not a rule\n```\n### Two: more (x) {#two}\n## Three\n');
  assert.deepEqual(hs.map((h) => [h.level, h.title, h.id]), [[2, 'One', 'one'], [3, 'Two: more (x)', 'two'], [2, 'Three', null]]);
});

const MODULE_MAP = () => JSON.parse(read(path.resolve('docs/migrations/1.0.0-modules.json')));
test('the saved ledger matches where each rule lives now', () => {
  const rows = [...read(path.resolve('docs/migrations/1.0.0-ledger.md')).matchAll(/^\| ([a-z0-9-]+) \| .+? \| #{2,3} \| ([a-z-]+) \| \d+ \|$/gm)];
  assert.equal(rows.length, 70);
  const wrong = rows.filter(([, id, mod]) => !headings(read(path.resolve('rules', `${mod}.md`))).some((h) => h.id === id)).map(([, id, mod]) => `${id} not in ${mod}`);
  assert.deepEqual(wrong, []);
});

test('the ledger refuses a section the map leaves out or a map entry with no section', () => {
  const map = { modules: [{ id: 'core', sections: ['a'] }] };
  assert.throws(() => ledger('## A {#a}\nx\n## B {#b}\ny\n', map), /not placed: b/);
  assert.throws(() => ledger('## A {#a}\nx\n', { modules: [{ id: 'core', sections: ['a', 'zz'] }] }), /no such section: zz/);
});

// Plan rule-modules, Phase 1: every pointer to a rule names its fixed ID, and every ID it names exists.
// A pointer to a heading by its words breaks the day the heading is renamed or moved.
const KIT_TEXT_FILES = () => {
  // tests/ holds fixture pointers to rules that exist only in temp kits.
  const skip = new Set(['.git', 'node_modules', 'vendor', 'reports', 'migrations', 'evals', 'plans', 'tests']);
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (skip.has(e.name) ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);
  return walk(path.resolve('.')).filter((f) => /\.(md|mjs|cjs|html|json)$/.test(f) && !f.endsWith('CHANGELOG.md'));
};
test('every rule pointer in the kit names a rule ID that exists', () => {
  const ids = new Set(ruleFiles().flatMap((f) => headings(read(f)).map((h) => h.id)));
  const broken = [], byWords = [];
  for (const f of KIT_TEXT_FILES()) {
    const text = read(f);
    for (const m of text.matchAll(/\brule:([a-z0-9-]+)/g)) if (!ids.has(m[1])) broken.push(`${path.relative('.', f)}: rule:${m[1]}`);
    for (const m of text.matchAll(/_Working Standards\.md`?\]?(?:\([^)]*\))?(?:,? section)? "([^"]+)"/g)) byWords.push(`${path.relative('.', f)}: "${m[1]}"`);
  }
  assert.deepEqual(broken, []);
  assert.deepEqual(byWords, []);
});

// The line-conservation check for the 1.0.0 split retired at 1.1.0, when new rules began; its result is kept in
// docs/migrations/1.0.0-coverage.md, and the ledger test below still proves every 0.7.0 rule has its home.

// Plan rule-modules, Phase 1: the kit keeps one tool-neutral source (rules/) and writes Claude Code's files from
// it. What install copies must be exactly what a fresh build writes, and each output names its source.
test('build writes AGENTS.md, path rules, on-demand modules and the index from rules/', () => {
  const out = build({ kit: path.resolve('.') });
  const mods = moduleFiles().map((f) => parseModule(read(f)).meta);
  assert.ok(out.has('project/AGENTS.md') && out.has('project/standards/INDEX.md'));
  for (const m of mods.filter((m) => m.id !== 'core')) {
    const where = m.load === 'files' ? `project/.claude/rules/${m.id}.md` : `project/standards/${m.id}.md`;
    assert.ok(out.has(where), `${m.id} -> ${where}`);
    assert.match(out.get('project/AGENTS.md'), new RegExp(`\| ${m.id} \|`), `AGENTS.md index lists ${m.id}`);
  }
  for (const [rel, text] of out) assert.match(text, /Written by kit\.mjs build from rules\//, `${rel} names its source`);
  // A path rule keeps Claude Code's paths field first, or it would load every session.
  assert.match(out.get('project/.claude/rules/testing.md'), /^---\npaths:\n  - "\*\*\/\*\.test\.\*"/);
  // Every rule ID is in the index exactly once.
  const index = out.get('project/standards/INDEX.md');
  for (const f of moduleFiles()) for (const h of headings(read(f))) {
    assert.equal(index.split(`| ${h.id} |`).length - 1, 1, `${h.id} once in the index`);
  }
});

test('the written-out files in project/ match a fresh build', () => {
  const stale = [...build({ kit: path.resolve('.') })].filter(([rel, text]) => !fs.existsSync(path.resolve(rel)) || read(path.resolve(rel)) !== text).map(([rel]) => rel);
  assert.deepEqual(stale, [], 'run node scripts/kit.mjs build');
});

test('find ranks a rule by its ID, then its title, then its text', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'find-'));
  fs.mkdirSync(path.join(root, 'rules'));
  fs.writeFileSync(path.join(root, 'rules', 'git.md'), '---\nid: git\nload: on-demand\nwhen: x\n---\n\n# Git\n\n## Branching {#branching}\nName a branch by its type.\n\n### Commit Message Format {#commit-message-format}\nOne line, type then subject.\n');
  fs.writeFileSync(path.join(root, 'rules', 'core.md'), '---\nid: core\nload: always\nwhen: x\n---\n\n## Edit Discipline {#edit-discipline}\nThink before a commit.\n');
  assert.equal(findRules({ kit: root, query: 'commit message' })[0].id, 'commit-message-format');
  assert.equal(findRules({ kit: root, query: 'what should I call my branch' })[0].id, 'branching');
  assert.deepEqual(findRules({ kit: root, query: 'edit-discipline' }).map((r) => [r.id, r.module]), [['edit-discipline', 'core']]);
  assert.deepEqual(findRules({ kit: root, query: 'nothing matches this' }), []);
});

test('find also matches the tags a module gives its rules, and every rule has tags', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'find-tags-'));
  fs.mkdirSync(path.join(root, 'rules'));
  fs.writeFileSync(path.join(root, 'rules', 'code.md'), '---\nid: code\nload: on-demand\nwhen: x\ntags:\n  size-budgets: bundle, bytes, bloat\n---\n\n## Size Budgets {#size-budgets}\nTrim first.\n\n## Naming {#naming}\nPlain names.\n');
  assert.deepEqual(parseModule(read(path.join(root, 'rules', 'code.md'))).meta.tags, { 'size-budgets': ['bundle', 'bytes', 'bloat'] });
  assert.equal(findRules({ kit: root, query: 'the bundle grew' })[0].id, 'size-budgets');
  const untagged = ruleFiles().flatMap((f) => {
    const { meta, body } = parseModule(read(f));
    return headings(body).filter((h) => !(meta.tags && meta.tags[h.id] && meta.tags[h.id].length)).map((h) => h.id);
  });
  assert.deepEqual(untagged, []);
});

// Plan rule-modules, Phase 1: when the kit retires a file it once installed, install removes it only if the
// project left it as installed (after a backup); a changed copy is reported for fold-back; a file of the same
// name that the kit never installed belongs to the project and is left alone.
function retireKit() {
  const ctx = makeKit();
  install({ kit: ctx.kit, home: ctx.home, target: 'project', projectDir: ctx.proj });
  fs.rmSync(path.join(ctx.kit, 'project/_Working Standards.md'));
  const cfg = JSON.parse(read(path.join(ctx.kit, 'kit.config.json')));
  fs.writeFileSync(path.join(ctx.kit, 'kit.config.json'), JSON.stringify({ ...cfg, retired: { project: ['_Working Standards.md'] } }));
  return ctx;
}
test('install removes a retired file the project left alone, and keeps a backup', () => {
  const { kit, home, proj } = retireKit();
  const r = install({ kit, home, target: 'project', projectDir: proj });
  assert.deepEqual(r.retired, ['_Working Standards.md']);
  assert.equal(fs.existsSync(path.join(proj, '_Working Standards.md')), false);
  assert.equal(read(path.join(r.backupDir, '_Working Standards.md')), 'rules\n');
  assert.equal(JSON.parse(read(path.join(proj, '.kit/kit-version.json'))).files['_Working Standards.md'], undefined);
});
test('install keeps a retired file the project changed, and says so', () => {
  const { kit, home, proj } = retireKit();
  fs.writeFileSync(path.join(proj, '_Working Standards.md'), 'my own rules\n');
  const r = install({ kit, home, target: 'project', projectDir: proj });
  assert.deepEqual(r.retired, []);
  assert.equal(read(path.join(proj, '_Working Standards.md')), 'my own rules\n');
  assert.match(r.skipped.find((s) => s.file === '_Working Standards.md').reason, /retired by the kit.*changed here/);
});
test('install never removes a retired name the kit did not install', () => {
  const { kit, home, proj } = makeKit();
  fs.writeFileSync(path.join(proj, 'own.md'), 'the project\'s own\n');
  const cfg = JSON.parse(read(path.join(kit, 'kit.config.json')));
  fs.writeFileSync(path.join(kit, 'kit.config.json'), JSON.stringify({ ...cfg, retired: { project: ['own.md'] } }));
  const r = install({ kit, home, target: 'project', projectDir: proj });
  assert.deepEqual(r.retired, []);
  assert.equal(read(path.join(proj, 'own.md')), 'the project\'s own\n');
});
test('install retires a user-level file the same way', () => {
  const { kit, home } = makeKit();
  install({ kit, home, target: 'user' });
  fs.rmSync(path.join(kit, 'user/agents/builder.md'));
  const cfg = JSON.parse(read(path.join(kit, 'kit.config.json')));
  fs.writeFileSync(path.join(kit, 'kit.config.json'), JSON.stringify({ ...cfg, retired: { user: ['agents/builder.md'] } }));
  const r = install({ kit, home, target: 'user' });
  assert.deepEqual(r.retired, ['agents/builder.md']);
  assert.equal(fs.existsSync(path.join(home, 'agents/builder.md')), false);
});

// Plan rule-modules, Phase 1: a project still on one standards file (the owner's main project) keeps folding
// rules back. Its sections are matched to kit rules by heading; a changed one is a fold-back candidate with its
// kit ID, and a heading the kit lacks is the project's own.
test('fold-back maps an old single standards file to kit rules by heading', () => {
  const { kit, home, proj } = makeKit();
  fs.mkdirSync(path.join(kit, 'rules'));
  fs.writeFileSync(path.join(kit, 'rules', 'core.md'), '---\nid: core\nload: always\nwhen: x\n---\n\n## Alpha Rule {#alpha}\nkit text\n\n### Sub Rule {#sub}\nsame\n\n## Beta {#beta}\nsame\n');
  fs.writeFileSync(path.join(proj, '_Working Standards.md'), '# Std\n\n## Alpha Rule\nproject text\n\n### Sub Rule\nsame\n\n## Beta\nsame\n\n## Our Own Rule\nlocal\n');
  const r = foldBack({ kit, home, target: 'project', projectDir: proj });
  assert.deepEqual(r.oldLayout.changed.map((c) => [c.id, c.module]), [['alpha', 'core']]);
  assert.deepEqual(r.oldLayout.projectOnly, ['Our Own Rule']);
  assert.match(r.report, /## Old single standards file: sections changed here \(1\)\n\n- rule:alpha \(core\): Alpha Rule/);
});

// After a compact, the post-compact orientation lives in a module that may not be loaded, so session start names it.
test('session start after a compact names the orientation rule and where it lives', () => {
  const { kit, home, proj } = caseKit();
  assert.match(sessionStartReport({ kit, home, projectDir: proj, source: 'compact' }), /rule:post-compact-orientation/);
  assert.doesNotMatch(sessionStartReport({ kit, home, projectDir: proj, source: 'startup' }), /post-compact-orientation/);
});

// The old single standards file is gone from the kit. A mention of it is allowed only where the kit speaks of a
// project still on that file (the old-layout fold-back and the brief fallback).
test('nothing in the kit points at the retired standards file, except about projects still on it', () => {
  const left = [];
  for (const f of KIT_TEXT_FILES()) {
    // A mention may wrap, so the line before it counts as its context.
    read(f).split('\n').forEach((l, i, all) => {
      const ctx = `${all[i - 1] || ''} ${l}`;
      if (l.includes('_Working Standards.md') && !/one standards file|single standards file|old layout|"retired"/i.test(ctx)) left.push(`${path.relative('.', f)}:${i + 1}`);
    });
  }
  assert.deepEqual(left, []);
});

// Review finding: retiring the old standards file before its replacement landed would leave a project with no
// core rules at session start. A retired file waits until the file that replaces it is in place.
test('install keeps a retired file while the file that replaces it was skipped', () => {
  const { kit, home, proj } = retireKit();
  fs.writeFileSync(path.join(kit, 'project/AGENTS.md'), 'core rules\n');
  const cfg = JSON.parse(read(path.join(kit, 'kit.config.json')));
  fs.writeFileSync(path.join(kit, 'kit.config.json'), JSON.stringify({ ...cfg, retired: { project: { '_Working Standards.md': 'AGENTS.md' } } }));
  fs.writeFileSync(path.join(proj, 'AGENTS.md'), 'the project\'s own agents file\n');
  const r = install({ kit, home, target: 'project', projectDir: proj });
  assert.deepEqual(r.retired, []);
  assert.equal(read(path.join(proj, '_Working Standards.md')), 'rules\n');
  assert.match(r.skipped.find((s) => s.file === '_Working Standards.md').reason, /kept while AGENTS\.md is skipped/);
});

// Review finding: a pointer written as -> "Heading Title" breaks when the heading is renamed; every rule pointer
// in the kit uses its ID instead.
test('no rule pointer in the kit names a heading by its words', () => {
  const titles = new Set(ruleFiles().flatMap((f) => headings(read(f)).map((h) => h.title)));
  const byWords = [];
  for (const f of KIT_TEXT_FILES()) {
    for (const m of read(f).matchAll(/(?:->|\bper|\bsee|\bin) "([^"]+)"/g)) if (titles.has(m[1]) || [...titles].some((t) => t.startsWith(m[1] + ' '))) byWords.push(`${path.relative('.', f)}: "${m[1]}"`);
  }
  assert.deepEqual(byWords, []);
});

// Plan rule-modules, Phase 2: one role table (rule:agent-role-table) says what each agent may use and which rules
// it starts with; the role files must match it, so access is never widened by an edit to one file alone.
const roleTable = () => {
  const text = read(path.resolve('rules/agent-teams.md'));
  const sec = text.slice(text.indexOf('{#agent-role-table}'));
  return [...sec.matchAll(/^\| (builder|checker|scanner|orchestrator) \| [^|]+ \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm)]
    .map(([, role, tools, denied, rules]) => ({ role, tools: tools.trim(), denied: denied.trim(), rules: rules.trim() }));
};
const front = (f) => Object.fromEntries([...read(f).match(/^---\n([\s\S]*?)\n---/)[1].matchAll(/^(\w+):\s*(.*)$/gm)].map(([, k, v]) => [k, v.trim()]));
test('each agent role file matches the role table: tools, denied tools and rules at start', () => {
  const rows = roleTable();
  assert.deepEqual(rows.map((r) => r.role).sort(), ['builder', 'checker', 'orchestrator', 'scanner']);
  for (const r of rows) {
    const fm = front(path.resolve('user/agents', `${r.role}.md`));
    assert.equal(fm.tools, r.tools, `${r.role} tools`);
    assert.equal(fm.disallowedTools || 'none', r.denied, `${r.role} denied tools`);
    assert.equal(fm.skills || 'none', r.rules === 'none' ? 'none' : `${r.role}-rules`, `${r.role} preloaded rules`);
  }
});

test('build writes each role its rules skill from the IDs in the role table, under its cap', () => {
  const out = build({ kit: path.resolve('.') });
  for (const r of roleTable().filter((x) => x.rules !== 'none')) {
    const skill = out.get(`user/skills/${r.role}-rules/SKILL.md`);
    assert.ok(skill, `${r.role}-rules is built`);
    assert.match(skill, new RegExp(`^---\nname: ${r.role}-rules\n`));
    assert.match(skill, /user-invocable: false/);
    assert.match(skill, /wins where it differs/);
    for (const id of r.rules.split(',').map((s) => s.trim())) assert.match(skill, new RegExp(`\{#${id}\}`), `${r.role} carries ${id}`);
    assert.ok(Buffer.byteLength(skill) <= 8000, `${r.role}-rules is ${Buffer.byteLength(skill)} bytes`);
  }
});

// Plan rule-modules, Phase 2 guards. Each is driven the way Claude Code runs it (hook input as JSON on stdin) and
// proved with a known-good and a known-bad case.
const runHook = (script, input, env = {}) => spawnSync('node', [path.resolve(script)], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, ...env } });
function gitTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fence-'));
  const g = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  g('init', '-q'); fs.writeFileSync(path.join(dir, 'a.js'), 'a\n'); g('add', '-A'); g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  return dir;
}
test('the builder edit fence allows edits in its worktree and blocks edits outside it', () => {
  const dir = gitTree();
  const ok = runHook('user/kit-hooks/edit-fence.cjs', { cwd: dir, tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'a.js') } });
  assert.equal(ok.status, 0, ok.stderr);
  const out = runHook('user/kit-hooks/edit-fence.cjs', { cwd: dir, tool_name: 'Write', tool_input: { file_path: path.join(os.tmpdir(), 'elsewhere.js') } });
  assert.equal(out.status, 2);
  assert.match(out.stderr, /outside this builder's worktree/);
});
test('the builder edit fence keeps to the unit file list in its own worktree git folder, never a tracked file', () => {
  const dir = gitTree();
  const wt = path.join(dir, '.claude', 'worktrees', 'unit-1');
  spawnSync('git', ['-C', dir, 'worktree', 'add', '-q', wt], { encoding: 'utf8' });
  // Written the way the builder brief says: into the path git names for this worktree.
  const listPath = spawnSync('git', ['-C', wt, 'rev-parse', '--path-format=absolute', '--git-path', 'kit-unit-files.txt'], { encoding: 'utf8' }).stdout.trim();
  fs.writeFileSync(listPath, 'a.js\nsrc/b.js\n');
  assert.equal(runHook('user/kit-hooks/edit-fence.cjs', { cwd: wt, tool_input: { file_path: path.join(wt, 'src', 'b.js') } }).status, 0);
  const out = runHook('user/kit-hooks/edit-fence.cjs', { cwd: wt, tool_input: { file_path: path.join(wt, 'c.js') } });
  assert.equal(out.status, 2);
  assert.match(out.stderr, /not in this unit's file list/);
  // The list never shows as a change to commit, and it binds only its own worktree.
  assert.equal(spawnSync('git', ['-C', wt, 'status', '--porcelain'], { encoding: 'utf8' }).stdout, '');
  assert.equal(runHook('user/kit-hooks/edit-fence.cjs', { cwd: dir, tool_input: { file_path: path.join(dir, 'c.js') } }).status, 0);
});
test('the checker clean-tree stop passes an untouched tree and catches a changed file', () => {
  const dir = gitTree();
  const base = { cwd: dir, session_id: `t-${Date.now()}-${Math.random()}` };
  assert.equal(runHook('user/kit-hooks/clean-tree.cjs', { ...base, hook_event_name: 'PreToolUse' }).status, 0);
  assert.equal(runHook('user/kit-hooks/clean-tree.cjs', { ...base, hook_event_name: 'Stop' }).status, 0);
  const s2 = { cwd: dir, session_id: `t-${Date.now()}-${Math.random()}` };
  runHook('user/kit-hooks/clean-tree.cjs', { ...s2, hook_event_name: 'PreToolUse' });
  fs.writeFileSync(path.join(dir, 'a.js'), 'changed by the checker\n');
  const out = runHook('user/kit-hooks/clean-tree.cjs', { ...s2, hook_event_name: 'Stop' });
  assert.equal(out.status, 2);
  assert.match(out.stderr, /a\.js/);
});
test('the git pre-push hook stops an AI agent without approval and lets the owner push', () => {
  const hook = path.resolve('project/.githooks/pre-push');
  const sh = (env) => spawnSync('sh', [hook], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
  assert.equal(sh({}).status, 0, 'the owner in a plain terminal');
  assert.notEqual(sh({ AI_AGENT: 'some-tool' }).status, 0, 'an agent without approval');
  assert.notEqual(sh({ CLAUDECODE: '1' }).status, 0, 'Claude Code without approval');
  assert.equal(sh({ CLAUDECODE: '1', KIT_PUSH_APPROVED: '1' }).status, 0, 'after the owner said go');
});

test('the builder and checker role files wire their guards to the installed hook scripts', () => {
  assert.match(read(path.resolve('user/agents/builder.md')), /matcher: "Edit\|Write\|NotebookEdit"\n      hooks:\n        - type: command\n          command: node "\{\{CLAUDE_HOME\}\}\/kit-hooks\/edit-fence\.cjs"/);
  const checker = read(path.resolve('user/agents/checker.md'));
  assert.match(checker, /matcher: "Bash\|PowerShell"[\s\S]*clean-tree\.cjs[\s\S]*Stop:[\s\S]*clean-tree\.cjs/);
  assert.equal(render('node "{{CLAUDE_HOME}}/kit-hooks/x.cjs"', { claudeHome: 'D:/home-of-pat/.claude' }), 'node "D:/home-of-pat/.claude/kit-hooks/x.cjs"');
});
test('the checker clean-tree stop also catches a second edit to a file that was already changed', () => {
  const dir = gitTree();
  fs.writeFileSync(path.join(dir, 'a.js'), 'changed by the builder, not committed\n');
  const s = { cwd: dir, session_id: `t-${Date.now()}-${Math.random()}` };
  runHook('user/kit-hooks/clean-tree.cjs', { ...s, hook_event_name: 'PreToolUse' });
  fs.writeFileSync(path.join(dir, 'a.js'), 'and changed again by the checker\n');
  assert.equal(runHook('user/kit-hooks/clean-tree.cjs', { ...s, hook_event_name: 'Stop' }).status, 2);
});
test('the checker clean-tree stop sees a change in another worktree of the same repo', () => {
  const dir = gitTree();
  const other = path.join(path.dirname(dir), `${path.basename(dir)}-wt`);
  spawnSync('git', ['-C', dir, 'worktree', 'add', '-q', other], { encoding: 'utf8' });
  const s = { cwd: dir, session_id: `t-${Date.now()}-${Math.random()}` };
  runHook('user/kit-hooks/clean-tree.cjs', { ...s, hook_event_name: 'PreToolUse' });
  fs.writeFileSync(path.join(other, 'a.js'), 'changed in the builder worktree\n');
  assert.equal(runHook('user/kit-hooks/clean-tree.cjs', { ...s, hook_event_name: 'Stop' }).status, 2);
});
