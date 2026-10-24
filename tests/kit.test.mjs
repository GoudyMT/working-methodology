// Tests for scripts/kit.mjs - each one drives the CLI functions the way the owner does:
// a fake kit, a fake ~/.claude and a fake project in a temp folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { install, foldBack, bump, scrub, projectSlug, render } from '../scripts/kit.mjs';

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
