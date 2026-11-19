// Tests for install, status, scrub, snapshot, session start and the kit CLI: moved word for word from tests/kit.test.mjs (T10, build 18).

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
import { STANDARDS, addThirdParty, canary, caseKit, commitAll, copyKitCli, g, gitProject, hashTree, makeKit, makeTemp, overlayKit, read, releaseKit, released, role, scratch, sessionStartReport, shingles, status, withoutSafeSearch, words } from './kit-helpers.mjs';

// why: catches a break only Windows shows (drive paths, Git for Windows sh, junctions)
test('projectSlug matches the folder name Claude Code uses for project memory', { windows: true }, () => {
  assert.equal(
    projectSlug('D:\\Work\\Coding\\.Projects\\2026\\My App'),
    'D--Work-Coding--Projects-2026-My-App',
  );
});

// why: catches a break in scripts/kit.mjs; the only test that caught it when tagged, others catch it too since the build 14 audit
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

// K141: the kit repo is public, so the owner's profile is read from the Claude folder, never from the kit folder.
// why: catches the owner's profile being read from the public kit repo, or lost without a word when missing
test('install user takes the owner profile from the Claude folder, never the kit folder, and says when there is none', () => {
  const { kit, home } = makeKit();
  fs.writeFileSync(path.join(kit, 'owner-profile.md'), '- From the public repo\n');
  fs.writeFileSync(path.join(kit, 'kit.config.json'), JSON.stringify({ ownerName: 'Pat', ownerProfileFile: 'owner-profile.md' }));
  const r = install({ kit, home, target: 'user' });
  assert.equal(read(path.join(home, 'CLAUDE.md')), '# Global\nOwner: Pat\n- Likes tests\n');
  assert.equal(r.ownerProfile.found, true);
  const bare = makeKit();
  fs.rmSync(path.join(bare.home, 'kit-owner-profile.md'));
  const none = install({ kit: bare.kit, home: bare.home, target: 'user' });
  assert.equal(read(path.join(bare.home, 'CLAUDE.md')), '# Global\nOwner: Pat\n\n');
  assert.equal(none.ownerProfile.found, false);
  assert.equal(none.ownerProfile.path, path.join(bare.home, 'kit-owner-profile.md'));
});

// why: guards rule:owners-rules
test('install never overwrites a file the owner changed, and says so', () => {
  const { kit, home, proj } = makeKit();
  fs.writeFileSync(path.join(proj, '_Working Standards.md'), 'my own rules\n');
  const r = install({ kit, home, target: 'project', projectDir: proj });
  assert.equal(read(path.join(proj, '_Working Standards.md')), 'my own rules\n');
  assert.deepEqual(r.skipped.map((s) => s.file), ['_Working Standards.md']);
});

// why: catches a break at scripts/kit.mjs:723 that no other test catches
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

// why: catches a break at scripts/kit.mjs:849 that no other test catches
test('bump raises the version and adds a changelog entry on top', () => {
  const { kit } = makeKit();
  fs.writeFileSync(path.join(kit, 'CHANGELOG.md'), '# Changelog\n\n## 1.0.0 - 2026-01-01\n- first\n');
  const v = bump({ kit, level: 'minor', note: 'add the human-factor skill', date: '2026-10-24' });
  assert.equal(v, '1.1.0');
  assert.equal(read(path.join(kit, 'VERSION')), '1.1.0\n');
  assert.match(read(path.join(kit, 'CHANGELOG.md')), /# Changelog\n\n## 1\.1\.0 - 2026-10-24\n- add the human-factor skill\n\n## 1\.0\.0/);
});

// why: catches a break at scripts/kit.mjs:858 that no other test catches
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

// why: guards rule:security-standards; a committed chart is binary, so scrub reads its text chunks
test('scrub reads a PNG by its text chunks: a clean chart passes, a home path in its metadata is held', () => {
  const { kit } = makeKit();
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const png = (text) => Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0])),
    chunk('IDAT', Buffer.from([0x78, 0x9c, 0xff, 0xfe, 0x80, 0x00])),
    ...(text ? [chunk('tEXt', Buffer.from(text, 'latin1'))] : []),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  const file = path.join(kit, 'project/chart.png');
  fs.writeFileSync(file, png('Software\0drawn by the kit'));
  assert.deepEqual(scrub({ kit }), []);
  fs.writeFileSync(file, png('Source\0' + 'C:\\' + 'Users\\pat\\chart.svg'));
  assert.deepEqual(scrub({ kit }).map((h) => `${h.file} ${h.kind}`), ['project/chart.png path']);
});

// why: catches a break at scripts/kit.mjs:914 that no other test catches
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

// why: catches a break at scripts/kit.mjs:1013 that no other test catches
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

// T10 (build 18): the 13 MB of backups left the public kit repo for a private repo cloned beside the kit, which
// kit.config.json names; the kit keeps an index of them for its own checks.
// why: catches snapshot or restore still using the kit's own vendor folder once the config names the backup folder
test('snapshot and restore use the backup folder the config names, and the kit keeps an index of what it holds', () => {
  const ctx = makeKit();
  addThirdParty(ctx);
  const config = JSON.parse(read(path.join(ctx.kit, 'kit.config.json')));
  config.vendor.dir = '../kit-vendor';
  fs.writeFileSync(path.join(ctx.kit, 'kit.config.json'), JSON.stringify(config));
  snapshot({ kit: ctx.kit, home: ctx.home });
  const backups = path.join(path.dirname(ctx.kit), 'kit-vendor');
  assert.ok(fs.existsSync(path.join(backups, 'skills/vendor-pack/vendor-skill/SKILL.md')), 'the copy lands in the named folder');
  assert.equal(fs.existsSync(path.join(ctx.kit, 'vendor')), false, 'nothing lands in the kit');
  const index = JSON.parse(read(path.join(ctx.kit, 'vendor-index.json')));
  assert.deepEqual(index.skillGroups['vendor-pack'].skills, ['vendor-skill']);
  assert.equal(index.skillGroups['vendor-pack'].license, 'Apache-2.0');
  assert.ok(index.plugins.toolbox, 'the plugin is indexed');
  fs.rmSync(path.join(ctx.home, 'skills/vendor-skill'), { recursive: true });
  assert.deepEqual(restore({ kit: ctx.kit, home: ctx.home, name: 'vendor-pack' }), { restored: ['vendor-skill'], kept: [] });
});

// why: catches a break in scripts/kit.mjs; the only test that caught it when tagged, others catch it too since the build 14 audit
test('scrub leaves the third-party snapshot alone', () => {
  const ctx = makeKit();
  fs.mkdirSync(path.join(ctx.kit, 'vendor/plugins/x'), { recursive: true });
  fs.writeFileSync(path.join(ctx.kit, 'vendor/plugins/x/README.md'), 'caf\u00e9 by someone\n');
  assert.deepEqual(scrub({ kit: ctx.kit }), []);
});

// why: guards rule:owners-rules
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

// 1.21.1 carry 6: a main held by a ruleset alone is protected, though GitHub has no classic protection for it.
// 1.33.0 (I3, A5, the owner's ruling): protected means what the merge gate needs, from either source: a required
// check that must be up to date, no force push and no delete. Any rule at all no longer counts.
// why: guards rule:first-push-gate
test('status reads main as protected only with an up-to-date required check, no force push and no delete', () => {
  const ok = (o) => ({ status: 0, stdout: JSON.stringify(o), stderr: '' });
  const answers = (prot, rules) => (args) => (args[1].includes('/protection') ? prot : rules);
  const notProtected = { status: 1, stdout: '{"message":"Branch not protected"}', stderr: 'gh: Branch not protected (HTTP 404)' };
  const classic = (strict, force = false, del = false) => ok({ required_status_checks: { strict, contexts: ['ci'], checks: [{ context: 'ci' }] }, allow_force_pushes: { enabled: force }, allow_deletions: { enabled: del } });
  // The repo is named, so gh never reads it from a folder (the K61 security review); with no GitHub repo gh never runs.
  const mp = (gh) => mainProtection('.', gh, 'o/r');
  assert.equal(mainProtection('.', () => { throw new Error('gh ran'); }, null), null);
  assert.equal(mp((args) => (args[1].startsWith('repos/o/r/') ? ok(args[1].includes('/rules/') ? [] : {}) : { status: 1, stdout: '', stderr: 'wrong repo' })), 'unprotected');
  assert.equal(mp(answers(classic(true), ok([]))), 'protected');
  assert.equal(mp(answers(classic(false), ok([]))), 'unprotected', 'the kit template before 1.33.0: not up to date');
  assert.equal(mp(answers(classic(true, true), ok([]))), 'unprotected', 'force pushes allowed');
  assert.equal(mp(answers(classic(true, false, true), ok([]))), 'unprotected', 'deletion allowed');
  assert.equal(mp(answers(ok({}), ok([]))), 'unprotected', 'a rule that requires nothing');
  // The ruleset seen live on the probe repo, 2026-11-15: it blocked deletion only, and status called main protected.
  assert.equal(mp(answers(notProtected, ok([{ type: 'deletion' }]))), 'unprotected');
  const full = [{ type: 'deletion' }, { type: 'non_fast_forward' }, { type: 'required_status_checks', parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: 'ci' }] } }];
  assert.equal(mp(answers(notProtected, ok(full))), 'protected');
  assert.equal(mp(answers(notProtected, ok([{ type: 'required_status_checks', parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: 'ci' }] } }]))), 'unprotected', 'no force push or delete block');
  assert.equal(mp(answers(notProtected, ok([]))), 'unprotected');
  // A check from classic protection and the blocks from a ruleset hold together, as GitHub layers them.
  assert.equal(mp(answers(ok({ required_status_checks: { strict: true, contexts: ['ci'] }, allow_force_pushes: { enabled: true }, allow_deletions: { enabled: true } }), ok(full.slice(0, 2)))), 'protected');
  assert.equal(mp(answers(notProtected, { status: 1, stdout: '', stderr: 'HTTP 403' })), null);
  // The 1.22.0 sweep (T2): the real gh prints a JSON body on an error (tests/contracts/gh.json); that is no answer.
  assert.equal(mp(answers(notProtected, { status: 1, stdout: '{"message":"Forbidden"}', stderr: 'gh: Forbidden (HTTP 403)' })), null);
  assert.equal(mp(answers({ status: 1, stdout: '', stderr: 'HTTP 401' })), null);
  // The K61 sweep: up to date counts only from a source that also requires a check, a list answer is no protection,
  // and the rules are read 100 to a page (GitHub gives 30 unless asked).
  const strictNoCheck = [{ type: 'deletion' }, { type: 'non_fast_forward' }, { type: 'required_status_checks', parameters: { strict_required_status_checks_policy: true, required_status_checks: [] } }];
  assert.equal(mp(answers(ok({ required_status_checks: { strict: false, contexts: ['ci'] }, allow_force_pushes: { enabled: false }, allow_deletions: { enabled: false } }), ok(strictNoCheck))), 'unprotected', 'a strict ruleset with no check does not make classic checks up to date');
  assert.equal(mp(answers(ok([]), ok(full))), null, 'a list where an object belongs');
  const asked = [];
  mp((args) => { asked.push(args[1]); return args[1].includes('/protection') ? notProtected : ok(full); });
  assert.ok(asked.includes('repos/o/r/rules/branches/main?per_page=100'), asked.join(' '));
});

// why: guards rule:first-push-gate (the K61 sweep: a push URL set apart from origin's fetch URL named one repo while
// the work went to another)
test('a remote whose push URL names another repo names no repo', async () => {
  const { githubSlug } = await import('../scripts/safe-git.mjs');
  const dir = makeTemp('slug-');
  spawnSync('git', ['init', '-q', '-b', 'main', dir]);
  spawnSync('git', ['-C', dir, 'remote', 'add', 'origin', 'https://github.com/o/r.git']);
  assert.equal(githubSlug(dir), 'o/r');
  spawnSync('git', ['-C', dir, 'remote', 'set-url', '--push', 'origin', 'https://github.com/x/y.git']);
  assert.equal(githubSlug(dir), null);
});

// why: catches a break in scripts/kit.mjs; the only test that caught it when tagged, others catch it too since the build 14 audit
test('status warns when the temp disk runs low on inodes, and is silent when it has room or cannot tell', () => {
  const { kit, home, proj } = makeKit();
  install({ kit, home, target: 'user' });
  install({ kit, home, target: 'project', projectDir: proj });
  const at = (level, pct) => status({ kit, home, projectDir: proj, ahead: () => 0, inodes: () => ({ level, pct, text: `${pct}% of inodes used on /t` }) });
  assert.match(at('refuse', 90).text, /Temp disk: 90% of inodes[\s\S]*80%/);
  assert.match(at('warn', 60).text, /Temp disk: 60% of inodes[\s\S]*80%/);
  assert.equal(at('refuse', 90).current, true, 'disk room is not an install fault');
  assert.doesNotMatch(at('ok', 10).text, /Temp disk/);
  assert.doesNotMatch(at('unknown', null).text, /Temp disk/);
});

// S22-3: before 2.1.295 Claude Code ignores onFailure, so a guard that crashes or times out lets the command run.
// why: catches a break in scripts/kit.mjs; the only test that caught it when tagged, others catch it too since the build 14 audit
test('status and session start flag a Claude Code too old for onFailure, and stay quiet when new or unknown', () => {
  const { kit, home, proj } = makeKit();
  install({ kit, home, target: 'user' });
  install({ kit, home, target: 'project', projectDir: proj });
  const at = (v) => status({ kit, home, projectDir: proj, ahead: () => 0, claudeVersion: () => v });
  const old = at('2.1.294 (Claude Code)');
  assert.equal(old.current, false);
  assert.match(old.text, /Claude Code 2\.1\.294 is older than 2\.1\.295[\s\S]*claude update/);
  assert.match(old.text, /Not current: .*Claude Code is older than 2\.1\.295/);
  assert.match(at('2.0.999 (Claude Code)').text, /older than 2\.1\.295/);
  for (const v of ['2.1.295 (Claude Code)', '2.1.302 (Claude Code)', '3.0.0', null, 'garbage']) {
    assert.doesNotMatch(at(v).text, /older than 2\.1\.295/, String(v));
  }
  assert.equal(at('2.1.325 (Claude Code)').current, true);
  assert.match(sessionStartReport({ kit, home, projectDir: proj, claudeVersion: () => '2.1.200' }), /Claude Code 2\.1\.200 is older than 2\.1\.295/);
  assert.doesNotMatch(sessionStartReport({ kit, home, projectDir: proj, claudeVersion: () => '2.1.325' }), /older than/);
});

// K70 (1.36.0, the 2026-11-15 outside review): Claude Code 2.1.325 fixed gaps in how Bash deny and ask rules match,
// which the kit's own rules (approve.mjs --resume is denied) rely on. The npm stable channel was still 2.1.311.
// why: guards the owner's yes to K70, 2026-11-15 (card "Yes, all three into build 10"): the version floor and the warning
test('status and session start flag a Claude Code under 2.1.325, and warn when updates come from the stable channel', () => {
  const { kit, home, proj } = makeKit();
  install({ kit, home, target: 'user' });
  install({ kit, home, target: 'project', projectDir: proj });
  const at = (v) => status({ kit, home, projectDir: proj, ahead: () => 0, claudeVersion: () => v });
  const mid = at('2.1.318 (Claude Code)');
  assert.equal(mid.current, false);
  assert.match(mid.text, /Claude Code 2\.1\.318 is older than 2\.1\.325[\s\S]*Bash deny and ask rules[\s\S]*claude update/);
  // The sweep's novel lens: WinGet stayed at 2.1.318 on 2026-11-15, so the line names a path that reaches the floor.
  assert.match(mid.text, /npm i -g @anthropic-ai\/claude-code@latest/);
  assert.match(mid.text, /Not current: .*Claude Code is older than 2\.1\.325/);
  assert.doesNotMatch(mid.text, /older than 2\.1\.295/, 'one line, the floor the version misses first');
  assert.equal(at('2.1.325 (Claude Code)').current, true);
  assert.match(sessionStartReport({ kit, home, projectDir: proj, claudeVersion: () => '2.1.318' }), /older than 2\.1\.325/);
  // The stable channel: a warning, not a gap; quiet on the latest channel or with no setting.
  const settings = path.join(home, 'settings.json');
  const s = JSON.parse(fs.readFileSync(settings, 'utf8'));
  fs.writeFileSync(settings, JSON.stringify({ ...s, autoUpdatesChannel: 'stable' }));
  const stable = at('2.1.325 (Claude Code)');
  assert.match(stable.text, /autoUpdatesChannel is "stable"/);
  assert.equal(stable.current, true, 'a warning only');
  assert.match(sessionStartReport({ kit, home, projectDir: proj, claudeVersion: () => '2.1.325' }), /autoUpdatesChannel is "stable"/);
  fs.writeFileSync(settings, JSON.stringify({ ...s, autoUpdatesChannel: 'latest' }));
  assert.doesNotMatch(at('2.1.325 (Claude Code)').text, /stable/);
});

// why: catches a break only Windows shows (drive paths, Git for Windows sh, junctions)
test('the Claude Code version read never runs a claude program planted in the current folder', { windows: true, skip: process.platform !== 'win32' }, () => {
  const dir = makeTemp('planted-');
  const marker = path.join(dir, 'ran.txt');
  fs.writeFileSync(path.join(dir, 'claude.cmd'), `@echo planted> "${marker}"\r\n@echo 9.9.9\r\n`);
  const kitUrl = pathToFileURL(path.resolve('scripts/kit.mjs')).href;
  const r = spawnSync(process.execPath, ['-e', `import(${JSON.stringify(kitUrl)}).then((m) => console.log(JSON.stringify(m.installedClaudeVersion())))`], {
    cwd: dir, encoding: 'utf8', env: { ...withoutSafeSearch(process.env), PATH: `${process.env.SystemRoot}\\System32` },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(marker), false, 'the planted claude.cmd ran');
  assert.equal(r.stdout.trim(), 'null');
});

// M13 (a) (build 11, real on 1.36.1): the kit folder sits on a release tag, detached, so the old check of commits
// past its upstream branch never fired, and the tag its fix named was read before the fetch. A newer release on the
// remote is what the owner needs to hear, counted from the remote's own release tags and named from them.
// why: guards rule:owners-rules (install only from a release)
test('the release check counts and names the remote\'s newer release tags only', () => {
  assert.deepEqual(newerReleases(['v1.0.0', 'v1.1.0', 'v1.10.0', 'v1.2.0', 'v2.0.0-beta.1', 'latest'], '1.1.0'), { count: 2, newest: 'v1.10.0' });
  assert.deepEqual(newerReleases(['v1.0.0'], '1.0.0'), { count: 0, newest: null });
  const { kit, home, proj } = makeKit();
  const ahead = () => ({ count: 1, newest: 'v1.1.0' });
  assert.match(status({ kit, home, projectDir: proj, ahead }).text, /1 newer kit release\(s\), newest v1\.1\.0[^\n]*checkout v1\.1\.0/);
  assert.match(kitSessionStart({ kit, home, projectDir: proj, claudeVersion: () => null, ahead }), /1 newer kit release\(s\), newest v1\.1\.0[^\n]*checkout v1\.1\.0/);
});

// The security review of M13 (a): a fetch inside the kit folder ran with that folder's own git config, which can name
// a program (an upload-pack, a hook). The check only lists a GitHub https remote, from outside the folder.
// why: guards rule:security-standards (no kit check runs a program a repo's config names)
test('the release check never runs a program the kit folder\'s git config names, and asks no remote but GitHub https', () => {
  const { kit, home, proj } = makeKit();
  const g = (...a) => { const r = spawnSync('git', ['-C', kit, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
  g('init', '-q', '-b', 'main'); g('add', '-A'); g('commit', '-q', '-m', 'one'); g('tag', 'v1.0.0');
  const marker = path.join(path.dirname(kit), 'ran.txt');
  const prog = path.join(path.dirname(kit), 'up.sh');
  fs.writeFileSync(prog, `#!/bin/sh\necho ran > "${marker.split(path.sep).join('/')}"\nexec git-upload-pack "$@"\n`, { mode: 0o755 });
  g('remote', 'add', 'origin', path.dirname(kit));
  g('config', 'remote.origin.uploadpack', prog.split(path.sep).join('/'));
  // An upstream, so the 1.36.1 check reached its fetch (the build 11 sweep: without one it returned first).
  g('update-ref', 'refs/remotes/origin/main', 'HEAD'); g('config', 'branch.main.remote', 'origin'); g('config', 'branch.main.merge', 'refs/heads/main');
  kitSessionStart({ kit, home, projectDir: proj, claudeVersion: () => null });
  assert.equal(fs.existsSync(marker), false, 'a program the kit folder\'s config named ran');
  // The listing itself reads no GIT_ variable, no global or system config, and runs from outside the kit folder.
  const { args, opts } = lsRemoteCall('https://github.com/o/r.git', { PATH: 'p', GIT_DIR: kit, GIT_CONFIG_GLOBAL: 'evil', GIT_SSH_COMMAND: 'x', HTTPS_PROXY: 'h' });
  assert.ok(!args.includes('-C'), 'it runs from outside the kit folder');
  assert.equal(opts.env.GIT_DIR, undefined);
  assert.equal(opts.env.GIT_SSH_COMMAND, undefined);
  assert.equal(opts.env.GIT_CONFIG_NOSYSTEM, '1');
  assert.notEqual(opts.env.GIT_CONFIG_GLOBAL, 'evil');
  assert.ok(args.includes('protocol.https.allow=always') && args.includes('protocol.file.allow=never'), 'https only');
  // What the listing prints is read as tags only.
  assert.deepEqual(tagsOf(`${'a'.repeat(40)}\trefs/tags/v1.2.0\n${'b'.repeat(40)}\trefs/heads/main\n${'c'.repeat(40)}\trefs/tags/v1.3.0\n`), ['v1.2.0', 'v1.3.0']);
});

// M13 (b) (build 11, real on 1.36.1): a file only an unreleased build installed, changed here, is kept and the install
// stays unreleased; the fix line said to check out a release and reinstall, which keeps it again. The line names the
// file and the step that clears it, at status and at session start.
// why: guards rule:owners-rules (a fix line that cannot fix wastes the owner's turn)
test('a kept file from an unreleased build is named with the step that clears it', () => {
  const { kit, home, proj } = makeKit();
  fs.mkdirSync(path.join(proj, '.kit'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.kit', 'kit-version.json'), JSON.stringify({ version: '1.0.0', release: false, describe: 'v1.0.0-2-gabc', leftover: ['.claude/extra.mjs'], files: {} }));
  const r = kitStatus({ kit, home, projectDir: proj, ahead: () => 0, protection: () => null, inodes: () => ({ level: 'ok', pct: 1, text: '' }), claudeVersion: () => null });
  assert.match(r.text, /\.claude\/extra\.mjs[^\n]*remove it by hand[^\n]*then run \/methodology-kit update/);
  assert.match(kitSessionStart({ kit, home, projectDir: proj, claudeVersion: () => null }), /\.claude\/extra\.mjs[^\n]*remove it by hand/);
});

// why: guards rule:owners-rules
test('status reports a project or ~/.claude with no install record, and writes nothing', () => {
  const { kit, home, proj } = makeKit();
  const r = status({ kit, home, projectDir: proj, ahead: () => 0 });
  assert.equal(r.current, false);
  assert.match(r.text, /~\/\.claude: no kit install record/);
  assert.match(r.text, /This project: no kit install record/);
  assert.equal(fs.existsSync(path.join(proj, '.kit')), false);
});

// why: guards rule:kit-standards (item 14, the start load cap)
test('status shows the real start load against its cap, and says when it is over', () => {
  const { kit, home, proj } = makeKit();
  fs.writeFileSync(path.join(proj, 'CLAUDE.md'), 'x'.repeat(300));
  const cfg = path.join(kit, 'kit.config.json');
  fs.writeFileSync(cfg, JSON.stringify({ ...JSON.parse(fs.readFileSync(cfg, 'utf8')), caps: { realLoad: 1000 } }));
  assert.match(status({ kit, home, projectDir: proj, ahead: () => 0, protection: () => null }).text,
    /Real start load: 300 B of 1,000 \(project 300, memory index 0, global CLAUDE\.md 0, skill listings 0\)\./);
  fs.writeFileSync(path.join(proj, 'CLAUDE.md'), 'x'.repeat(1200));
  assert.match(status({ kit, home, projectDir: proj, ahead: () => 0, protection: () => null }).text,
    /Real start load: 1,200 B of 1,000 .*\. Over its cap: trim per rule:kit-standards item 14\./);
});

// why: catches a break at scripts/kit.mjs:1118 that no other test catches
test('session start names a standby plugin a turned-on case needs, and how to switch it on here', () => {
  const { kit, home, proj } = caseKit();
  const catalog = { cases: [{ id: 'ml', name: 'ML work', when: 'models or datasets', skills: [], plugin: 'huggingface-skills@claude-plugins-official' }] };
  fs.writeFileSync(path.join(proj, '.claude/kit/skill-cases.json'), JSON.stringify(catalog));
  fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ enabledPlugins: { 'huggingface-skills@claude-plugins-official': false } }));
  fs.writeFileSync(path.join(proj, '.claude/skill-cases.local.json'), JSON.stringify({ on: ['ml'] }));
  assert.match(sessionStartReport({ kit, home, projectDir: proj }),
    /Standby plugin huggingface-skills@claude-plugins-official \(ML work\) is off here\. To switch it on for this project only, add "enabledPlugins": \{ "huggingface-skills@claude-plugins-official": true \} to \.claude\/settings\.local\.json, then start a fresh session\./);
  fs.writeFileSync(path.join(proj, '.claude/settings.local.json'), JSON.stringify({ enabledPlugins: { 'huggingface-skills@claude-plugins-official': true } }));
  assert.doesNotMatch(sessionStartReport({ kit, home, projectDir: proj }), /Standby plugin/);
});

// why: guards rule:outward-acts
test('the hook script prints a user message and context for Claude, and never fails the session', async () => {
  const { spawnSync } = await import('node:child_process');
  const { kit, home, proj } = caseKit();
  fs.writeFileSync(path.join(home, 'kit-install.json'), JSON.stringify({ kitDir: kit.replace(/\\/g, '/') }));
  // The hook loads the kit's own tool from the kit folder, as it does on a real machine.
  fs.mkdirSync(path.join(kit, 'scripts'), { recursive: true });
  copyKitCli(kit);
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

// why: guards rule:kit-standards
// T10 (build 18): the backups left the public repo for a private one; the kit's index of them is what CI can read.
test('every backup in the real kit credits its source', () => {
  const index = JSON.parse(read(path.resolve('vendor-index.json')));
  const config = JSON.parse(read(path.resolve('kit.config.json'))).vendor;
  const entries = [...Object.entries(index.plugins), ...Object.entries(index.skillGroups)];
  assert.ok(entries.length > 0);
  assert.deepEqual(Object.keys(index.plugins).sort(), [...config.plugins].sort(), 'the index holds every plugin the config backs up');
  assert.deepEqual(Object.keys(index.skillGroups).sort(), config.skillGroups.map((g) => g.name).sort());
  for (const [name, src] of entries) {
    for (const field of ['author', 'license', 'repository']) {
      assert.ok(src[field] && src[field] !== 'unknown', `${name}: ${field} is missing`);
    }
    assert.ok(src.licenseFile || src.licenseNote, `${name}: no LICENSE file and no licenseNote`);
  }
});

// why: guards rule:kit-standards
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
  // T10 (build 18): the backups' skills are read from the kit's index of them.
  const index = JSON.parse(read(path.resolve('vendor-index.json')));
  const groups = new Set(Object.values(index.skillGroups).flatMap((g) => g.skills));
  for (const c of cases) {
    for (const s of c.skills) {
      const [plugin, skill] = s.includes(':') ? s.split(':') : [null, s];
      // A one-skill plugin may keep its SKILL.md at the plugin root instead of under skills/.
      const p = plugin && index.plugins[plugin];
      const found = plugin ? Boolean(p) && (p.skills.includes(skill) || (skill === plugin && p.rootSkill))
        : own.has(skill) || groups.has(skill) || BUILT_IN.has(skill);
      assert.ok(found, `case ${c.id}: skill ${s} not found`);
    }
  }
});

// why: guards rule:kit-stays-local
test('session start names only the kit files that owe a hand merge, not a project\'s own values', () => {
  const { kit, home, proj } = caseKit();
  // Changed only here: the project's own values on the current kit copy, normal use, so session start stays quiet.
  fs.writeFileSync(path.join(proj, '_Working Standards.md'), 'my own rules\n');
  assert.doesNotMatch(sessionStartReport({ kit, home, projectDir: proj }), /_Working Standards\.md/);
  // Changed here and in the kit: a merge is owed, and session start says so.
  bump({ kit, level: 'patch', note: 'x', date: '2026-02-01' });
  fs.writeFileSync(path.join(kit, 'project/_Working Standards.md'), 'kit rules, newer\n');
  assert.match(sessionStartReport({ kit, home, projectDir: proj }), /1 kit file\(s\) changed here[\s\S]*_Working Standards\.md[\s\S]*kit\.mjs install project <folder> --merged/);
});

// why: catches a break at scripts/kit.mjs:1253 that no other test catches
test('pre-compact says when an installed third-party plugin moved past its backup', () => {
  const ctx = caseKit();
  addThirdParty(ctx);
  snapshot({ kit: ctx.kit, home: ctx.home });
  assert.doesNotMatch(preCompactReport({ kit: ctx.kit, home: ctx.home, projectDir: ctx.proj }), /third-party plugin/);
  const file = path.join(ctx.home, 'plugins/installed_plugins.json');
  const data = JSON.parse(read(file));
  data.plugins['toolbox@market'][0].version = '2.1.0';
  fs.writeFileSync(file, JSON.stringify(data));
  assert.match(preCompactReport({ kit: ctx.kit, home: ctx.home, projectDir: ctx.proj }), /1 third-party plugin\(s\) changed since the backup: toolbox \(2\.0\.0 -> 2\.1\.0\)[\s\S]*run snapshot/);
});

// why: guards rule:kit-standards
test('brief templates point to the one rules block and never carry a pasted copy', () => {
  for (const t of ['builder-brief.md', 'checker-brief.md']) {
    const body = read(path.resolve('user/skills/agent-team-build/templates', t));
    // Both forms: the rule ID through the index, and the single file a project not yet moved still has.
    assert.match(body, /"Rules every brief carries"[\s\S]*rule:agent-team-adapter/);
    assert.match(body, /`<project folder>\/standards\/INDEX\.md`/);
    assert.match(body, /one standards file[\s\S]*`<project folder>\/_Working Standards\.md`/);
    assert.doesNotMatch(body, /paste the block/i);
  }
});

// why: guards rule:first-push-gate
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
  assert.match(preCompactReport({ kit, home, projectDir: proj }), /Vault backup: 1 file\(s\) changed, committed in .*vault\. Push on the owner's yes\./);
});

// why: catches a break at scripts/kit.mjs:1282 that no other test catches
test('pre-compact reminds a project with no vault backup to set one up', () => {
  const { kit, home, proj } = caseKit();
  assert.match(preCompactReport({ kit, home, projectDir: proj }), /No vault backup set up/);
});

// why: guards rule:kit-standards
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

// why: guards rule:kit-standards
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
// why: guards rule:sweep-auto-approval
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
  // T9 (1.42.0): a project's use check holds its filled copy to the same cap, so the two numbers are one.
  assert.equal(Number(/const AGENTS_CAP = (\d+);/.exec(read(path.resolve('project/.claude/use-check.mjs')))?.[1]), caps.agentsMd);
  const start = measure({ projectDir: path.resolve('project') });
  if (start.total > caps.sessionStart) over.push(`session start: ${start.total} > ${caps.sessionStart}`);
  assert.deepEqual(over, []);
  assert.deepEqual(start.unresolved, []);
});

// why: catches a break at scripts/kit.mjs:1342 that no other test catches
test('a running session hears about a new kit release once, at the next message', () => {
  const { kit, home, proj } = caseKit();
  assert.equal(promptCheckReport({ kit, projectDir: proj }), '');
  // Another project releases the kit while this session runs.
  bump({ kit, level: 'minor', note: 'from the other project', date: '2026-03-01' });
  assert.match(promptCheckReport({ kit, projectDir: proj }), /Kit 1\.1\.0 was released while this session ran[\s\S]*\(1\.0\.0\)[\s\S]*\/methodology-kit update/);
  assert.equal(promptCheckReport({ kit, projectDir: proj }), '');
  bump({ kit, level: 'patch', note: 'again', date: '2026-03-02' });
  assert.match(promptCheckReport({ kit, projectDir: proj }), /Kit 1\.1\.1 was released/);
  // Session start already said it, so the next message stays quiet.
  bump({ kit, level: 'patch', note: 'third', date: '2026-03-03' });
  sessionStartReport({ kit, home, projectDir: proj });
  assert.equal(promptCheckReport({ kit, projectDir: proj }), '');
});

// why: catches a break in scripts/kit.mjs; the only test that caught it when tagged, others catch it too since the build 14 audit
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
  git(other, 'commit', '-q', '-am', 'release'); git(other, 'tag', 'v1.2.0'); git(other, 'push', '-q', 'origin', 'main', 'v1.2.0');
  // A pull would move the kit folder onto main, off every release tag, so the line names the newest tag instead. The
  // check lists only a GitHub https remote (the security review of build 11), so this local one stands in for it.
  const say = sessionStartReport({ kit, home, projectDir: proj, ahead: () => ({ count: 1, newest: 'v1.2.0' }) });
  assert.match(say, /1 newer kit release\(s\), newest v1\.2\.0[\s\S]*git -C ".*" fetch --tags; git -C ".*" checkout v1\.2\.0\)[\s\S]*\/methodology-kit update/);
  assert.doesNotMatch(say, /git pull/);
});

// The 1.33.0 workbench verify (the owner, 2026-11-15, "Three-way merge"): a file the owner filled in and the kit also
// changed was skipped whole as "merge by hand", so no release's rule change reached it. Install now merges the two line
// by line against the version it last installed, read from the release copy's tags, and writes the result when nothing
// clashes; a clash (a line both changed, or changes on lines next to each other, as git merges) leaves the file as it
// is and names what to do.
// why: guards rule:kit-standards
test('install merges the owner\'s edits with the kit\'s changes line by line, and leaves a clash alone', () => {
  const { kit, proj, git, cli } = releaseKit();
  const rules = path.join(kit, 'project/_Working Standards.md');
  const release = (v, lines) => {
    fs.writeFileSync(rules, lines.join('\n') + '\n');
    fs.writeFileSync(path.join(kit, 'VERSION'), `${v}\n`);
    git('commit', '-q', '-am', `release ${v}`); git('tag', `v${v}`);
  };
  const mine = path.join(proj, '_Working Standards.md');
  const write = (lines) => fs.writeFileSync(mine, lines.join('\n') + '\n');
  const read = () => fs.readFileSync(mine, 'utf8').split('\n').slice(0, -1);
  // Line two is rendered at install ({{OWNER_NAME}}), so the old copy must be rendered before its hash is compared.
  release('1.0.1', ['one', 'owner {{OWNER_NAME}}', 'three', 'four', 'five']);
  assert.equal(cli('install', 'project', proj).status, 0);
  write(['one, filled in', 'owner Pat', 'three', 'four', 'five']);
  release('1.0.2', ['one', 'owner {{OWNER_NAME}}', 'three', 'four', 'five, reworded']);
  // A dry run merges nothing.
  cli('install', 'project', proj, '--dry-run');
  assert.deepEqual(read(), ['one, filled in', 'owner Pat', 'three', 'four', 'five'], 'a dry run writes nothing');
  const r = cli('install', 'project', proj);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(read(), ['one, filled in', 'owner Pat', 'three', 'four', 'five, reworded'], 'both changes kept');
  assert.match(r.stdout, /merged with your edits: _Working Standards\.md/);
  // The owner's copy is kept in the dated backup folder first.
  const backups = path.join(proj, '.kit', 'kit-backups');
  const kept = fs.readdirSync(backups).map((d) => path.join(backups, d, '_Working Standards.md')).filter((p) => fs.existsSync(p));
  assert.deepEqual(kept.map((p) => fs.readFileSync(p, 'utf8')), ['one, filled in\nowner Pat\nthree\nfour\nfive\n']);
  // The next release merges from the version just written: line five changes again and the owner's line survives.
  release('1.0.3', ['one', 'owner {{OWNER_NAME}}', 'three, new', 'four', 'five, reworded again']);
  cli('install', 'project', proj);
  assert.deepEqual(read(), ['one, filled in', 'owner Pat', 'three, new', 'four', 'five, reworded again']);
  // A line both changed is a clash: the file stays as the owner has it, and the skip says what to do.
  write(['one, filled in', 'owner Pat', 'three, mine', 'four', 'five, reworded again']);
  release('1.0.4', ['one', 'owner {{OWNER_NAME}}', 'three, newer', 'four', 'five, reworded again']);
  const c = cli('install', 'project', proj);
  assert.deepEqual(read(), ['one, filled in', 'owner Pat', 'three, mine', 'four', 'five, reworded again'], 'a clash writes nothing');
  assert.match(c.stdout, /skipped _Working Standards\.md: [^\n]*clash/);
  assert.match(c.stdout, /--merged "_Working Standards\.md"/);
});

// why: guards rule:kit-standards (the 1.33.1 sweep: a byte that is not UTF-8 came back replaced, and a file saved with
// Windows line endings clashed whole)
test('install never merges text that is not UTF-8, and keeps a file\'s Windows line endings', () => {
  const { kit, proj, git, cli } = releaseKit();
  const rules = path.join(kit, 'project/_Working Standards.md');
  const release = (v, lines) => {
    fs.writeFileSync(rules, lines.join('\n') + '\n');
    fs.writeFileSync(path.join(kit, 'VERSION'), `${v}\n`);
    git('commit', '-q', '-am', `release ${v}`); git('tag', `v${v}`);
  };
  const mine = path.join(proj, '_Working Standards.md');
  release('1.0.1', ['one', 'two', 'three', 'four', 'five']);
  cli('install', 'project', proj);
  // One byte of Windows-1252 text (an e with an accent), as a Windows editor may save it.
  const bytes = Buffer.concat([Buffer.from('one caf'), Buffer.from([0xe9]), Buffer.from('\ntwo\nthree\nfour\nfive\n')]);
  fs.writeFileSync(mine, bytes);
  release('1.0.2', ['one', 'two', 'three', 'four', 'five, new']);
  const r = cli('install', 'project', proj);
  assert.ok(fs.readFileSync(mine).equals(bytes), 'the bytes are left as they were');
  assert.match(r.stdout, /skipped _Working Standards\.md: [^\n]*not UTF-8/);
  // Windows line endings: merged as lines, and kept.
  fs.writeFileSync(mine, 'one, mine\r\ntwo\r\nthree\r\nfour\r\nfive, new\r\n');
  cli('install', 'project', proj, '--merged', '_Working Standards.md');
  release('1.0.3', ['one', 'two', 'three', 'four', 'five, newer']);
  cli('install', 'project', proj);
  assert.equal(fs.readFileSync(mine, 'utf8'), 'one, mine\r\ntwo\r\nthree\r\nfour\r\nfive, newer\r\n');
  // A kit folder that is no release is never merged from: no tag would hold its text for the next merge.
  fs.writeFileSync(rules, 'one\ntwo\nthree\nfour\nfive, unreleased\n');
  git('commit', '-q', '-am', 'branch work');
  const u = cli('install', 'project', proj, '--unreleased');
  assert.equal(fs.readFileSync(mine, 'utf8'), 'one, mine\r\ntwo\r\nthree\r\nfour\r\nfive, newer\r\n', 'nothing written');
  assert.match(u.stdout, /skipped _Working Standards\.md: [^\n]*no release/);
});

// K120 (1.42.0, reproduced on 1.41.0): a kit tool in the Claude folder changed by hand (the guard launcher itself) was
// skipped as "changed here - run fold-back", so a tampered launcher survived every reinstall. A kit tool or hook there
// is put back, as a project's guard files are, with the changed copy kept.
// why: guards rule:outward-acts
test('install user puts back a kit tool changed in the Claude folder and keeps the changed copy', () => {
  const { home, cli } = releaseKit();
  assert.equal(cli('install', 'user').status, 0);
  const launcher = path.join(home, 'kit-tools', 'kit-launch.cjs');
  const kitText = read(launcher);
  fs.appendFileSync(launcher, '// changed by hand\n');
  const r = cli('install', 'user');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(read(launcher), kitText, 'the kit copy is back');
  assert.match(r.stdout, /replaced: 1\b/);
  const kept = fs.readdirSync(path.join(home, 'kit-backups'), { recursive: true }).filter((f) => /kit-launch\.cjs$/.test(f));
  assert.equal(kept.length, 1, 'the changed copy is kept');
});

// why: guards rule:outward-acts. The 1.42.0 sweep: only .cjs and .mjs files in kit-tools and kit-hooks were put back,
// so a changed toast script (run with its policy bypassed) or sweep approval script survived every reinstall; and a
// tool replaced by a link had the kit's text written through it, into whatever file the link named.
test('install user puts back a changed toast script and skill script, and replaces a link without writing through it', () => {
  const { kit, home, git, cli } = releaseKit();
  for (const rel of ['kit-tools/watch-toast.ps1', 'skills/pre-pr-sweep/approve.mjs']) {
    fs.mkdirSync(path.dirname(path.join(kit, 'user', rel)), { recursive: true });
    fs.copyFileSync(path.resolve('user', rel), path.join(kit, 'user', rel));
  }
  fs.writeFileSync(path.join(kit, 'VERSION'), '1.0.1\n'); git('add', '-A'); git('commit', '-q', '-m', 'tools'); git('tag', 'v1.0.1');
  assert.equal(cli('install', 'user').status, 0);
  for (const rel of ['kit-tools/watch-toast.ps1', 'skills/pre-pr-sweep/approve.mjs']) {
    const file = path.join(home, rel);
    const kitText = read(file);
    fs.appendFileSync(file, '\n# changed by hand\n');
    const r = cli('install', 'user');
    assert.equal(read(file), kitText, `${rel}: the kit copy is back`);
    assert.match(r.stdout, /replaced: 1\b/, rel);
  }
  const launcher = path.join(home, 'kit-tools', 'kit-launch.cjs');
  const outside = path.join(home, 'outside.txt');
  fs.writeFileSync(outside, 'not the kit\n');
  fs.rmSync(launcher);
  try { fs.symlinkSync(outside, launcher, 'file'); } catch { return; } // no link rights on this machine
  const r = cli('install', 'user');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(read(outside), 'not the kit\n', 'nothing written through the link');
  assert.equal(fs.lstatSync(launcher).isSymbolicLink(), false, 'the link is replaced by the kit copy');
});

// K120 (1.42.0, reproduced on 1.41.0): an overlay's CLAUDE.local.md the owner edited was merged and backed up again
// on every install, with nothing new from the kit, and --merged could not stop it. It merges once when the kit's text
// changes, and is left alone otherwise.
// why: guards rule:kit-stays-local
test('an edited overlay CLAUDE.local.md is merged once when the kit changes, and left alone otherwise', () => {
  const { kit, proj, git, cli } = releaseKit();
  fs.writeFileSync(path.join(kit, 'project/CLAUDE.md'), '# Kit CLAUDE\n\none\ntwo\nthree\n');
  fs.writeFileSync(path.join(kit, 'VERSION'), '1.0.1\n'); git('add', '-A'); git('commit', '-q', '-m', 'claude'); git('tag', 'v1.0.1');
  g(proj, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(proj, 'CLAUDE.md'), "# The team's own rules\n");
  commitAll(proj, 'team', true);
  assert.equal(cli('install', 'project', proj).status, 0);
  const local = path.join(proj, 'CLAUDE.local.md');
  fs.appendFileSync(local, '\n- My own local line.\n');
  const backups = () => { try { return fs.readdirSync(path.join(proj, '.kit', 'kit-backups'), { recursive: true }).filter((f) => /CLAUDE\.local/.test(f)).length; } catch { return 0; } };
  for (let i = 0; i < 2; i++) {
    const r = cli('install', 'project', proj);
    assert.match(r.stdout, /merged: 0,/, 'nothing new from the kit: nothing merged');
    assert.doesNotMatch(r.stdout, /: CLAUDE\.local\.md\b/, 'nor skipped');
  }
  assert.equal(backups(), 0, 'no backup without a merge');
  assert.match(read(local), /My own local line/);
  // A kit change merges once, keeping the owner's line, and the next install is quiet again.
  fs.writeFileSync(path.join(kit, 'project/CLAUDE.md'), '# Kit CLAUDE\n\none, new\ntwo\nthree\n');
  fs.writeFileSync(path.join(kit, 'VERSION'), '1.0.2\n'); git('commit', '-q', '-am', 'v2'); git('tag', 'v1.0.2');
  const merged = cli('install', 'project', proj).stdout;
  assert.match(merged, /merged with your edits: CLAUDE\.local\.md/, merged);
  assert.match(read(local), /one, new[\s\S]*My own local line/);
  assert.doesNotMatch(cli('install', 'project', proj).stdout, /: CLAUDE\.local\.md\b/);
  assert.equal(backups(), 1);
});

// why: guards rule:kit-stays-local. The 1.42.0 sweep: --merged on an overlay CLAUDE.local.md left as it was when
// install named the merge was recorded as merged, and the kit's new lines were lost for good.
test('--merged on an overlay CLAUDE.local.md left unchanged since the merge was named is refused once', () => {
  const { kit, proj, git, cli } = releaseKit();
  fs.writeFileSync(path.join(kit, 'project/CLAUDE.md'), '# Kit CLAUDE\n\none\ntwo\nthree\n');
  fs.writeFileSync(path.join(kit, 'VERSION'), '1.0.1\n'); git('add', '-A'); git('commit', '-q', '-m', 'claude'); git('tag', 'v1.0.1');
  g(proj, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(proj, 'CLAUDE.md'), "# The team's own rules\n");
  commitAll(proj, 'team', true);
  assert.equal(cli('install', 'project', proj).status, 0);
  const local = path.join(proj, 'CLAUDE.local.md');
  fs.writeFileSync(local, read(local).replace('one\n', 'one, mine\n'));
  fs.writeFileSync(path.join(kit, 'project/CLAUDE.md'), '# Kit CLAUDE\n\none, kit\ntwo\nthree\n');
  fs.writeFileSync(path.join(kit, 'VERSION'), '1.0.2\n'); git('commit', '-q', '-am', 'v2'); git('tag', 'v1.0.2');
  assert.match(cli('install', 'project', proj).stdout, /skipped CLAUDE\.local\.md:[\s\S]*--merged CLAUDE\.local\.md/);
  const first = cli('install', 'project', proj, '--merged', 'CLAUDE.local.md').stdout;
  assert.match(first, /skipped CLAUDE\.local\.md: recorded as merged/, first);
  const again = cli('install', 'project', proj, '--merged', 'CLAUDE.local.md').stdout;
  assert.doesNotMatch(again, /: CLAUDE\.local\.md\b/, 'the same command again keeps it as it is');
  assert.match(read(local), /one, mine/);
});

// K120 (1.42.0): the hand-merge hint gave --merged a file name with a space unquoted, so the command it printed broke.
// why: guards rule:kit-standards
test('the hand-merge hint quotes a file name with a space', () => {
  const { kit, proj, git, cli } = releaseKit();
  const rules = path.join(kit, 'project/_Working Standards.md');
  fs.writeFileSync(rules, 'one\ntwo\n'); fs.writeFileSync(path.join(kit, 'VERSION'), '1.0.1\n'); git('commit', '-q', '-am', 'a'); git('tag', 'v1.0.1');
  cli('install', 'project', proj);
  fs.writeFileSync(path.join(proj, '_Working Standards.md'), 'one, mine\ntwo\n');
  fs.writeFileSync(rules, 'one, kit\ntwo\n'); fs.writeFileSync(path.join(kit, 'VERSION'), '1.0.2\n'); git('commit', '-q', '-am', 'b'); git('tag', 'v1.0.2');
  const r = cli('install', 'project', proj);
  assert.match(r.stdout, /--merged "_Working Standards\.md"/);
});

// K61 (the owner, 2026-11-15): merge on green had no exact steps; install prints them, each marked done or to do.
// why: guards rule:standing-grants
test('install user and install project print the merge-on-green steps', () => {
  const { proj, cli } = releaseKit();
  const u = cli('install', 'user');
  assert.equal(u.status, 0, u.stderr);
  assert.match(u.stdout, /Merge on green: 0 of 1 step done/);
  assert.ok(u.stdout.includes('/kit-tools/merge-gate.mjs arm *)",') && u.stdout.includes('"Bash(node '), u.stdout);
  const p = cli('install', 'project', proj);
  assert.match(p.stdout, /Merge on green: 0 of 4 steps done/);
  assert.doesNotMatch(cli('install', 'project', proj, '--dry-run').stdout, /Merge on green/, 'a dry run checks nothing');
});

// why: guards rule:outward-acts. K49 (a project on the kit, 2026-11-14): a settings file kept for a hand merge still ran
// the kit guards itself, the shape before 1.25.1, so every guard ran twice beside the launcher and no sweep could
// start. Status and the session notice name those entries; install takes them out, as it took out 1.25.0's guard.cjs
// entry, keeping a backup and every other line; the shape install writes is quiet.
test('a project settings file that still runs the guards itself is named, and install takes those entries out', () => {
  const { kit, home, proj, cli } = releaseKit();
  assert.equal(cli('install', 'user').status, 0);
  const quiet = [cli('install', 'project', proj).stdout, cli('status', proj).stdout, sessionStartReport({ kit, home, projectDir: proj })].join('\n');
  assert.doesNotMatch(quiet, /runs kit guards itself/);
  const settings = path.join(proj, '.claude', 'settings.json');
  const s = JSON.parse(read(settings));
  // The project's own hooks stay, whatever their file names, and a group of an odd shape is left as it is (the 1.31.0
  // sweep: a match by file name alone removed a project's own tools/hooks/guard.cjs and its Stop canary.cjs).
  s.hooks = { ...(s.hooks || {}), PreToolUse: [...((s.hooks || {}).PreToolUse || []), { matcher: 'Bash', hooks: [{ type: 'command', command: 'node tools/hooks/guard.cjs' }] }, { matcher: 'Read', hooks: 'odd' }], Stop: [{ hooks: [{ type: 'command', command: 'node scripts/canary.cjs' }] }] };
  const before = JSON.stringify(s);
  // The 1.24.0 shape: each guard as its own entry, a user-layer hook among them; and one written by hand with shell
  // punctuation around the path.
  const own = (file) => ({ type: 'command', command: 'node', args: [file.split(path.sep).join('/')] });
  s.hooks.PreToolUse = [...s.hooks.PreToolUse, { matcher: 'Agent|Task', hooks: [own(path.join(home, 'kit-hooks', 'sweep-guard.cjs'))] }, { matcher: 'Bash', hooks: [own(path.join(proj, '.claude', 'owner-proof.cjs')), { type: 'command', command: 'node .claude/guard-delete.cjs; exit 0' }] }];
  fs.writeFileSync(settings, JSON.stringify(s, null, 2));
  for (const text of [cli('status', proj).stdout, sessionStartReport({ kit, home, projectDir: proj })]) {
    assert.match(text, /\.claude\/settings\.json[^\n]*\(sweep-guard\.cjs, owner-proof\.cjs, guard-delete\.cjs\)[\s\S]*--merged \.claude\/settings\.json/);
  }
  const ins = cli('install', 'project', proj);
  assert.match(ins.stdout, /replaced \.claude\/settings\.json/);
  assert.equal(JSON.stringify(JSON.parse(read(settings))), before, 'only the old entries went; every other line stayed');
  assert.doesNotMatch(cli('status', proj).stdout + sessionStartReport({ kit, home, projectDir: proj }), /runs kit guards itself/);
});

// why: guards rule:outward-acts
test('install runs from a clean release tag and stamps it as a release', () => {
  const { kit, home, proj, cli } = releaseKit();
  const r = cli('install', 'project', proj);
  assert.equal(r.status, 0, r.stderr);
  const stamp = JSON.parse(read(path.join(proj, '.kit/kit-version.json')));
  assert.equal(stamp.release, true);
  assert.equal(stamp.describe, 'v1.0.0');
  assert.equal(stamp.dirty, undefined);
  // A file install neither copies nor reads does not block it.
  fs.writeFileSync(path.join(kit, 'notes.md'), 'scratch\n');
  const u = cli('install', 'user');
  assert.equal(u.status, 0, u.stderr);
  assert.equal(JSON.parse(read(path.join(home, 'kit-install.json'))).release, true);
});

// why: guards rule:outward-acts
test('install on the release tag itself refuses an uncommitted edit to anything it copies or reads', () => {
  const { kit, proj, git, cli } = releaseKit();
  // The owner config is rendered into the installed files, and the script decides what install does.
  for (const f of ['project/_Working Standards.md', 'kit.config.json', 'scripts/kit.mjs']) {
    fs.appendFileSync(path.join(kit, f), '\n');
    const r = cli('install', 'project', proj);
    assert.equal(r.status, 1, f);
    assert.match(r.stderr, new RegExp(`Changed or new files install would copy: ${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.`));
    assert.doesNotMatch(r.stderr, /Not on release tag/, 'HEAD is on the tag: only the change is named');
    git('checkout', '-q', '--', f);
  }
  assert.equal(fs.existsSync(path.join(proj, '.kit')), false);
});

// why: guards rule:outward-acts
test('install refuses a kit folder past its release tag, and names where it is and the two fixes', () => {
  const { kit, proj, git, cli } = releaseKit();
  // The newest tag is picked by version, not by name: v1.10.0 is newer than v1.9.0.
  git('tag', 'v1.2.0'); git('tag', 'v1.9.0'); git('tag', 'v1.10.0');
  fs.writeFileSync(path.join(kit, 'project/_Working Standards.md'), 'rules, unreleased\n');
  git('commit', '-q', '-am', 'branch work');
  for (const args of [['install', 'project', proj], ['install', 'project', proj, '--dry-run'], ['install', 'user']]) {
    const r = cli(...args);
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, /Install refused:[\s\S]*not a release/);
    assert.match(r.stderr, /Not on release tag v1\.0\.0[\s\S]*v1\.\d+\.0-1-g[0-9a-f]+/);
    assert.match(r.stderr, /\(git -C ".*" fetch --tags; git -C ".*" checkout v1\.10\.0\)/);
    assert.match(r.stderr, /--unreleased for a throwaway test install/);
  }
  assert.equal(fs.existsSync(path.join(proj, '_Working Standards.md')), false, 'nothing is installed');
  assert.equal(fs.existsSync(path.join(proj, '.kit')), false);
});

// why: guards rule:outward-acts
test('install refuses a kit folder with no git history, or one inside another repo', () => {
  const { kit, proj, home } = makeKit();
  fs.mkdirSync(path.join(kit, 'scripts'), { recursive: true });
  copyKitCli(kit);
  const run = () => spawnSync(process.execPath, [path.join(kit, 'scripts/kit.mjs'), 'install', 'project', proj], { encoding: 'utf8', env: { ...process.env, KIT_CLAUDE_HOME: home } });
  let r = run();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Not on release tag v1\.0\.0[\s\S]*no git history/);
  // A copy inside another repo would read that repo's tags.
  const outer = path.dirname(kit);
  const git = (...a) => spawnSync('git', ['-C', outer, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main'); git('add', '-A'); git('commit', '-q', '-m', 'outer'); git('tag', 'v1.0.0');
  r = run();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Not on release tag v1\.0\.0[\s\S]*inside another git repo/);
  assert.equal(fs.existsSync(path.join(proj, '.kit')), false);
});

// why: guards rule:outward-acts
test('install refuses changed, new, renamed and ignored files under the paths it copies, and names each one', () => {
  const { kit, proj, git, cli } = releaseKit();
  fs.appendFileSync(path.join(kit, 'project/_Working Standards.md'), 'uncommitted\n');
  fs.writeFileSync(path.join(kit, 'memory/new.md'), 'untracked\n');
  fs.mkdirSync(path.join(kit, 'user/node_modules'), { recursive: true });
  fs.writeFileSync(path.join(kit, 'user/node_modules/x.js'), 'ignored, but install copies it\n');
  git('mv', 'memory/style.md', 'memory/renamed.md');
  fs.writeFileSync(path.join(kit, 'VERSION'), '1.0.1\n');
  const r = cli('install', 'project', proj);
  assert.equal(r.status, 1);
  const named = r.stderr.match(/Changed or new files install would copy: (.*)\.\n/)[1].split(', ').sort();
  // A rename names its new path once, never a cut-off old one.
  assert.deepEqual(named, ['VERSION', 'memory/new.md', 'memory/renamed.md', 'project/_Working Standards.md', 'user/node_modules/x.js']);
  assert.match(r.stderr, /Not on release tag v1\.0\.1: HEAD is at v1\.0\.0\./);
  assert.equal(fs.existsSync(path.join(proj, '.kit')), false);
});

// why: catches a break at scripts/kit.mjs:1093 that no other test catches
test('status and session start show an unreleased install as a gap; an older stamp with no release field is not flagged', () => {
  const { kit, home, proj } = makeKit();
  // No release field: an install made before the check existed reads as unknown, not as unreleased.
  install({ kit, home, target: 'user' });
  install({ kit, home, target: 'project', projectDir: proj });
  assert.equal(status({ kit, home, projectDir: proj, ahead: () => 0 }).current, true);
  assert.doesNotMatch(sessionStartReport({ kit, home, projectDir: proj }), /unreleased/);
  const unreleased = { release: false, describe: 'v1.0.0-3-gabc1234', dirty: ['memory/new.md'] };
  install({ kit, home, target: 'project', projectDir: proj, release: unreleased });
  let r = status({ kit, home, projectDir: proj, ahead: () => 0 });
  assert.equal(r.current, false);
  assert.match(r.text, /~\/\.claude: 1\.0\.0, current\./);
  assert.match(r.text, /This project: 1\.0\.0, unreleased v1\.0\.0-3-gabc1234 with 1 uncommitted file\(s\)[\s\S]*fetch --tags; git -C ".*" checkout <newest v tag>\)[\s\S]*\/methodology-kit update/);
  assert.match(r.text, /^Not current: This project .*unreleased build\.$/m);
  assert.match(sessionStartReport({ kit, home, projectDir: proj }), /This project runs an unreleased kit build[\s\S]*v1\.0\.0-3-gabc1234[\s\S]*newest release tag[\s\S]*\/methodology-kit update/);
  // ~/.claude carries the rules of every project, so its unreleased build is named too.
  install({ kit, home, target: 'user', release: unreleased });
  r = status({ kit, home, projectDir: proj, ahead: () => 0 });
  assert.match(r.text, /~\/\.claude: 1\.0\.0, unreleased v1\.0\.0-3-gabc1234 with 1 uncommitted file\(s\)[\s\S]*node "[^"\n]*kit\.mjs" install user/);
  assert.match(r.text, /^Not current: ~\/\.claude .*unreleased build; This project .*unreleased build\.$/m);
  assert.match(sessionStartReport({ kit, home, projectDir: proj }), /~\/\.claude runs an unreleased kit build[\s\S]*v1\.0\.0-3-gabc1234[\s\S]*newest release tag[\s\S]*kit\.mjs" install user/);
  // Reinstalled from the release: the gap closes.
  install({ kit, home, target: 'user', release: released(kit, 'v1.0.0') });
  install({ kit, home, target: 'project', projectDir: proj, release: released(kit, 'v1.0.0') });
  r = status({ kit, home, projectDir: proj, ahead: () => 0 });
  assert.equal(r.current, true, r.text);
  assert.doesNotMatch(sessionStartReport({ kit, home, projectDir: proj }), /unreleased/);
});

// M13 (c) (build 11, real on 1.36.1): a memory file only an unreleased build had was removed while the owner's
// changed MEMORY.md, which install skips, still linked it. It stays, named, until the link goes.
// why: guards rule:tracking-file-functions (a memory index that links a missing file misleads every session)
test('a branch-only memory file that a changed MEMORY.md still links is kept and named', () => {
  const { kit, home, proj } = makeKit();
  fs.writeFileSync(path.join(kit, 'memory/branch.md'), 'branch rule\n');
  fs.writeFileSync(path.join(kit, 'memory/MEMORY.md'), '- [Style](style.md)\n- [Branch](branch.md)\n');
  install({ kit, home, target: 'project', projectDir: proj, release: { release: false, describe: 'v1.0.0-1-gabc1234' } });
  const memory = path.join(home, 'projects', projectSlug(proj), 'memory');
  fs.rmSync(path.join(kit, 'memory/branch.md'));
  fs.writeFileSync(path.join(kit, 'memory/MEMORY.md'), '- [Style](style.md)\n');
  // The owner added a line of their own, so install skips MEMORY.md, and their copy still links branch.md.
  fs.appendFileSync(path.join(memory, 'MEMORY.md'), '- [Mine](mine.md)\n');
  const r = install({ kit, home, target: 'project', projectDir: proj, release: released(kit, 'v1.0.0') });
  assert.ok(fs.existsSync(path.join(memory, 'branch.md')), 'removed while MEMORY.md still links it');
  assert.ok(r.skipped.some((s) => s.file === 'memory/branch.md' && /MEMORY\.md still links it/.test(s.reason)), JSON.stringify(r.skipped));
});

// The build 11 sweep: the link may be written in any Markdown form.
// why: guards rule:tracking-file-functions
test('a changed MEMORY.md keeps a branch-only memory file it links in any Markdown form', () => {
  for (const link of ['(./branch.md)', '(<branch.md>)', '(branch.md "the branch rule")', '\n[b]: branch.md']) {
    const { kit, home, proj } = makeKit();
    fs.writeFileSync(path.join(kit, 'memory/branch.md'), 'branch rule\n');
    install({ kit, home, target: 'project', projectDir: proj, release: { release: false, describe: 'v1.0.0-1-gabc1234' } });
    const memory = path.join(home, 'projects', projectSlug(proj), 'memory');
    fs.rmSync(path.join(kit, 'memory/branch.md'));
    fs.appendFileSync(path.join(memory, 'MEMORY.md'), `- [Mine]${link}\n`);
    install({ kit, home, target: 'project', projectDir: proj, release: released(kit, 'v1.0.0') });
    assert.ok(fs.existsSync(path.join(memory, 'branch.md')), link);
  }
});

// M13 (f) (build 11): on a file system that folds case, a file the kit renamed by case alone is the same file under its
// old name, so removing the old name removed the shipped file until the next install.
// why: guards rule:owners-rules (an install never loses a shipped file)
test('a file renamed by case alone survives the install that retires its old name', { windows: true }, () => {
  const { kit, home, proj } = makeKit();
  // A rename by case alone goes through a third name, as git does on a case-folding file system.
  const skill = (from, to) => { const d = path.join(kit, 'user/skills/human-factor'); fs.renameSync(path.join(d, from), path.join(d, 'tmp.md')); fs.renameSync(path.join(d, 'tmp.md'), path.join(d, to)); };
  skill('SKILL.md', 'skill.md');
  install({ kit, home, target: 'user', release: { release: false, describe: 'v1.0.0-1-gabc1234' } });
  skill('skill.md', 'SKILL.md');
  install({ kit, home, target: 'user', release: released(kit, 'v1.0.0') });
  assert.ok(fs.existsSync(path.join(home, 'skills/human-factor/SKILL.md')), 'the shipped file was removed under its old name');
});

// M13 (g) (build 11): a record key in the install stamp that climbs out of its folder (a hand-edited stamp) names a
// file install never wrote, and the clean-up must not touch it.
// why: guards rule:security-standards (install removes only what it put there)
test('the clean-up never removes a file outside its folder, whatever the stamp says', () => {
  const { kit, home, proj } = makeKit();
  install({ kit, home, target: 'user', release: { release: false, describe: 'v1.0.0-1-gabc1234' } });
  const outside = path.join(path.dirname(home), 'outside.txt');
  fs.writeFileSync(outside, 'owner file\n');
  const stampFile = path.join(home, 'kit-install.json');
  const stamp = JSON.parse(read(stampFile));
  stamp.files['../outside.txt'] = crypto.createHash('sha256').update('owner file\n').digest('hex');
  fs.writeFileSync(stampFile, JSON.stringify(stamp));
  install({ kit, home, target: 'user', release: released(kit, 'v1.0.0') });
  assert.ok(fs.existsSync(outside), 'a file outside ~/.claude was removed');
  // The build 11 sweep: a key that stays inside by its text but runs through a link (a junction needs no admin on
  // Windows) reaches a file outside all the same.
  install({ kit, home, target: 'user', release: { release: false, describe: 'v1.0.0-1-gabc1234' } });
  const away = path.join(path.dirname(home), 'away');
  fs.mkdirSync(away);
  fs.writeFileSync(path.join(away, 'victim.txt'), 'owner file\n');
  fs.symlinkSync(away, path.join(home, 'j'), process.platform === 'win32' ? 'junction' : 'dir');
  const linked = JSON.parse(read(stampFile));
  linked.files['j/victim.txt'] = crypto.createHash('sha256').update('owner file\n').digest('hex');
  fs.writeFileSync(stampFile, JSON.stringify(linked));
  install({ kit, home, target: 'user', release: released(kit, 'v1.0.0') });
  assert.ok(fs.existsSync(path.join(away, 'victim.txt')), 'a file reached through a link was removed');
});

// M13 (g) (build 11): status's fix line for ~/.claude named the kit folder unquoted, so a folder with a space broke it.
// why: guards rule:owners-rules (a fix line runs as typed)
test('status names the kit folder in quotes in the install user line', () => {
  const { kit, home, proj } = makeKit();
  const spaced = path.join(path.dirname(kit), 'my kit');
  fs.renameSync(kit, spaced);
  install({ kit: spaced, home, target: 'user', release: { release: false, describe: 'v1.0.0-1-gabc1234' } });
  assert.match(status({ kit: spaced, home, projectDir: proj, ahead: () => 0 }).text, /node "[^"\n]*my kit\/scripts\/kit\.mjs" install user/);
});

// why: catches a break in scripts/kit.mjs; the only test that caught it when tagged, others catch it too since the build 14 audit
test('a release install over an unreleased one removes the files only that build had, and keeps a changed one as a gap', () => {
  const { kit, home, proj } = makeKit();
  const extra = ['user/skills/branch-only/SKILL.md', 'user/agents/branch-only.md'];
  for (const f of extra) { fs.mkdirSync(path.dirname(path.join(kit, f)), { recursive: true }); fs.writeFileSync(path.join(kit, f), 'branch build\n'); }
  install({ kit, home, target: 'user', release: { release: false, describe: 'v1.0.0-1-gabc1234' } });
  for (const f of extra) fs.rmSync(path.join(kit, f));
  // The owner changed one of them: it holds their work, so it stays and is named.
  fs.writeFileSync(path.join(home, 'agents/branch-only.md'), 'branch build, edited here\n');
  const r = install({ kit, home, target: 'user', release: released(kit, 'v1.0.0') });
  assert.deepEqual(r.retired, ['skills/branch-only/SKILL.md']);
  assert.equal(fs.existsSync(path.join(home, 'skills/branch-only/SKILL.md')), false);
  assert.ok(fs.existsSync(path.join(r.backupDir, 'skills/branch-only/SKILL.md')), 'a backup is kept');
  assert.ok(r.skipped.some((s) => s.file === 'agents/branch-only.md' && /only an unreleased build installed it, and it changed here/.test(s.reason)), JSON.stringify(r.skipped));
  const stamp = JSON.parse(read(path.join(home, 'kit-install.json')));
  assert.equal(stamp.release, false, 'a kept branch-only file means this is still not a pure release');
  assert.deepEqual(stamp.leftover, ['agents/branch-only.md']);
  assert.match(status({ kit, home, projectDir: proj, ahead: () => 0 }).text, /~\/\.claude: 1\.0\.0, unreleased v1\.0\.0[\s\S]*1 file\(s\) kept from an unreleased build/);
  // Once the owner removes it, the next release install is a release again.
  fs.rmSync(path.join(home, 'agents/branch-only.md'));
  install({ kit, home, target: 'user', release: released(kit, 'v1.0.0') });
  const clean = JSON.parse(read(path.join(home, 'kit-install.json')));
  assert.equal(clean.release, true);
  assert.equal(clean.leftover, undefined);
  assert.equal(clean.files['agents/branch-only.md'], undefined);
});

// why: guards rule:outward-acts
test('install refuses when git cannot say what changed, rather than calling the folder clean', () => {
  const { kit, proj, cli } = releaseKit();
  // A corrupt index makes git status fail; that must not read as "nothing changed". (K141: the profile path that made
  // it fail before is no longer read from the kit folder.)
  fs.writeFileSync(path.join(kit, '.git', 'index'), 'not an index');
  fs.appendFileSync(path.join(kit, 'user/CLAUDE.md'), 'INJECTED\n');
  const r = cli('install', 'user');
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /git status failed in the kit folder[\s\S]*unknown: .*index/);
  assert.equal(fs.existsSync(path.join(path.dirname(kit), 'home', 'kit-install.json')), false);
});

// why: guards rule:outward-acts
test('the hook script speaks at a message only when there is news', async () => {
  const { kit, home, proj } = caseKit();
  fs.writeFileSync(path.join(home, 'kit-install.json'), JSON.stringify({ kitDir: kit.replace(/\\/g, '/') }));
  fs.mkdirSync(path.join(kit, 'scripts'), { recursive: true });
  copyKitCli(kit);
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

// why: guards rule:outward-acts
test('the load guard refuses a busy CPU and names what is using it', async () => {
  const { createRequire } = await import('node:module');
  const guard = createRequire(import.meta.url)(path.resolve('project/.claude/load-guard.cjs'));
  const busy = guard.checkLoad({ busy: 92, threshold: 70, top: ['node', 'chrome', 'vitest'] });
  assert.equal(busy.ok, false);
  assert.match(busy.message, /CPU is 92% busy \(limit 70%\)[\s\S]*node, chrome, vitest/);
  assert.equal(guard.checkLoad({ busy: 40, threshold: 70, top: [] }).ok, true);
});

// why: guards rule:outward-acts
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

// why: guards rule:outward-acts
test('the load guard defaults to 40% over a 3-second average', async () => {
  const { createRequire } = await import('node:module');
  const guard = createRequire(import.meta.url)(path.resolve('project/.claude/load-guard.cjs'));
  assert.equal(guard.DEFAULT_MAX, 40);
  assert.equal(guard.SAMPLE_MS, 3000);
});

// why: guards rule:outward-acts
test('an update retires a script once the edited audit that needed it is put back; a non-guard file still waits on an edited heir', () => {
  const { kit, home, proj } = makeKit();
  const put = (f, text) => { fs.mkdirSync(path.dirname(path.join(kit, f)), { recursive: true }); fs.writeFileSync(path.join(kit, f), text); };
  put('project/.claude/attribution.mjs', 'old\n');
  put('project/.claude/pr-body-audit.mjs', 'one\n');
  put('user/skills/human-factor/references/old.md', 'old\n');
  install({ kit, home, target: 'project', projectDir: proj });
  install({ kit, home, target: 'user' });
  const config = path.join(kit, 'kit.config.json');
  fs.writeFileSync(config, JSON.stringify({ ...JSON.parse(read(config)), retired: { project: { '.claude/attribution.mjs': ['.claude/no-such-heir.mjs', '.claude/pr-body-audit.mjs'] }, user: { 'skills/human-factor/references/old.md': 'skills/human-factor/SKILL.md' } } }));
  fs.rmSync(path.join(kit, 'project/.claude/attribution.mjs'));
  fs.rmSync(path.join(kit, 'user/skills/human-factor/references/old.md'));
  put('project/.claude/pr-body-audit.mjs', 'two\n');
  fs.appendFileSync(path.join(proj, '.claude/pr-body-audit.mjs'), 'edited here\n');
  const r = install({ kit, home, target: 'project', projectDir: proj });
  // A script in .claude is a guard file since V3 (1.25.1): the edited audit is put back (a backup keeps the edit), so
  // nothing here imports the retired script any more, and it goes.
  assert.ok(r.replaced.includes('.claude/pr-body-audit.mjs'));
  assert.equal(read(path.join(r.backupDir, '.claude/pr-body-audit.mjs')), 'one\nedited here\n');
  assert.ok(!fs.existsSync(path.join(proj, '.claude/attribution.mjs')));
  assert.deepEqual(install({ kit, home, target: 'user' }).retired, ['skills/human-factor/references/old.md']);
  // A file that is not a guard still waits on an edited heir.
  put('project/old-notes.md', 'old\n');
  install({ kit, home, target: 'project', projectDir: proj });
  fs.writeFileSync(config, JSON.stringify({ ...JSON.parse(read(config)), retired: { project: { 'old-notes.md': ['no-such-heir.md', '_Working Standards.md'] } } }));
  fs.rmSync(path.join(kit, 'project/old-notes.md'));
  fs.appendFileSync(path.join(proj, '_Working Standards.md'), 'edited here\n');
  const kept = install({ kit, home, target: 'project', projectDir: proj });
  assert.ok(fs.existsSync(path.join(proj, 'old-notes.md')), 'an edited heir still needs it');
  assert.ok(kept.skipped.some((x) => x.file === 'old-notes.md'));
  const real = JSON.parse(read(path.resolve('kit.config.json'))).retired;
  assert.deepEqual(real.project['.claude/attribution.mjs'], ['.claude/pr-body-audit.mjs', '.claude/pr-body-audit-lean.mjs']);
  assert.deepEqual(real.user['skills/plan-feature/references/explore-and-options.md'], ['skills/brainstorm/references/question-craft.md', 'skills/plan-feature/SKILL.md']);
});

// 1.20.0 carry-overs N5 and B8: a closeout that started on its own still asks before a remote branch delete, and the
// core rules send leftovers to the next build, not the roadmap.
// why: guards rule:kit-standards
test('a self-started closeout asks before a remote delete, and leftovers carry only on the owner yes', () => {
  assert.match(read(path.resolve('rules/tracking-and-handoff.md')), /merged -> retire per rule:branching[^\n]*remote delete on the owner's yes/);
  const core = read(path.resolve('rules/core.md'));
  assert.match(core, /a low or medium that cannot be finished carries only on the owner's yes, recorded; a high or critical never/); // pin: 4 the owner's carry wording
  assert.doesNotMatch(core, /design items go to the roadmap/);
});

// why: guards rule:standing-grants
test('install user lands the merge gate and its audits at the paths the rules give', () => {
  const home = makeTemp('tools-home-');
  install({ kit: path.resolve('.'), home, target: 'user' });
  assert.ok(fs.existsSync(path.join(home, 'kit-tools', 'merge-gate.mjs')));
  for (const f of ['pr-body-audit.mjs', 'pr-body-audit-lean.mjs', 'canary-phrase.mjs', 'version-bump-check.mjs', 'no-attribution.mjs', 'name-check.mjs', 'visuals.mjs']) {
    assert.ok(fs.existsSync(path.join(home, 'kit-tools', 'audits', f)), `${f} is installed beside the gate`);
    assert.equal(read(path.join(home, 'kit-tools', 'audits', f)), read(path.resolve('project/.claude', f)), f);
  }
  // The gate imports its temp helper from beside it: without the copy, the installed gate cannot start at all.
  assert.equal(read(path.join(home, 'kit-tools', 'kit-temp.cjs')), read(path.resolve('project/.claude/kit-temp.cjs')));
  const r = spawnSync(process.execPath, [path.join(home, 'kit-tools', 'merge-gate.mjs')], { encoding: 'utf8' });
  assert.equal(r.status, 2, `the installed gate starts and prints its usage: ${r.stderr}`);
});

// why: guards rule:kit-standards (a project hears of newer kit rules at session start). K11, the 1.27.0 cut took the
// only test of the session-start update line.
test('session start says when the kit has newer rules, and how many', () => {
  const { kit, home, proj } = caseKit();
  assert.doesNotMatch(sessionStartReport({ kit, home, projectDir: proj }), /newer/);
  bump({ kit, level: 'minor', note: 'one', date: '2026-02-01' });
  bump({ kit, level: 'patch', note: 'two', date: '2026-02-02' });
  assert.match(sessionStartReport({ kit, home, projectDir: proj }), /Kit 1\.1\.1 has 2 newer change\(s\)[\s\S]*\(1\.0\.0\)[\s\S]*\/methodology-kit update/);
});

// why: guards rule:failure-response (kit status is what the owner reads to trust an install; the --merged record is
// the way out of a hand merge). K11, the 1.27.0 cut took it.
test('status says current only when the kit folder, ~/.claude and the project all match, file by file', () => {
  const { kit, home, proj } = makeKit();
  install({ kit, home, target: 'user' });
  install({ kit, home, target: 'project', projectDir: proj });
  let r = status({ kit, home, projectDir: proj, ahead: () => 0 });
  assert.equal(r.current, true);
  assert.match(r.text, /Kit folder: 1\.0\.0/);
  assert.match(r.text, /~\/\.claude: 1\.0\.0, current/);
  assert.match(r.text, /This project: 1\.0\.0, current/);
  assert.match(r.text, /^Current: /m);

  // A newer kit release: both installs are behind, and each says what to run.
  bump({ kit, level: 'patch', note: 'one', date: '2026-02-01' });
  fs.writeFileSync(path.join(kit, 'project/_Working Standards.md'), 'rules, newer\n');
  r = status({ kit, home, projectDir: proj, ahead: () => 0 });
  assert.equal(r.current, false);
  assert.match(r.text, /~\/\.claude: 1\.0\.0, behind kit 1\.0\.1/);
  assert.match(r.text, /This project: 1\.0\.0, behind kit 1\.0\.1; 1 file\(s\) waiting/);
  assert.match(r.text, /Run \/methodology-kit update\./);
  assert.match(r.text, /kit\.mjs" install user\./);
  assert.match(r.text, /^Not current: /m);

  // Same version, a file carrying this project's own values on top of the current kit copy (a filled adapter row, a
  // tracking file): that is normal use, not a stale install, so status stays current and names it (the owner,
  // 2026-10-31: "current" must be reachable without wiping a project's records).
  install({ kit, home, target: 'user' });
  install({ kit, home, target: 'project', projectDir: proj });
  fs.writeFileSync(path.join(proj, '_Working Standards.md'), 'rules, edited here\n');
  r = status({ kit, home, projectDir: proj, ahead: () => 0 });
  assert.equal(r.current, true, r.text);
  assert.match(r.text, /1 file\(s\) carry[\s\S]*own values[\s\S]*_Working Standards\.md/);

  // Changed here AND in the kit: a hand merge is owed, so status is not current until the merge is recorded.
  bump({ kit, level: 'patch', note: 'two', date: '2026-02-02' });
  fs.writeFileSync(path.join(kit, 'project/_Working Standards.md'), 'rules, newest\n');
  install({ kit, home, target: 'user' });
  install({ kit, home, target: 'project', projectDir: proj });
  r = status({ kit, home, projectDir: proj, ahead: () => 0 });
  assert.equal(r.current, false);
  assert.match(r.text, /1 file\(s\) changed here and in the kit[\s\S]*_Working Standards\.md[\s\S]*by hand/);
  // T5 (1.36.0): --merged was taken on trust. A file left as it was when install named the merge was not merged.
  const unmerged = install({ kit, home, target: 'project', projectDir: proj, merged: ['_Working Standards.md'] });
  assert.deepEqual(unmerged.merged, []);
  assert.match(unmerged.skipped.find((s) => s.file === '_Working Standards.md').reason, /unchanged since install named the merge[\s\S]*again to keep it as it is/);
  assert.equal(status({ kit, home, projectDir: proj, ahead: () => 0 }).current, false);
  // The same command again is the owner keeping the file as it is (1.36.0 sweep): recorded, not refused for good.
  const before = read(path.join(proj, '_Working Standards.md'));
  const kept = install({ kit, home, target: 'project', projectDir: proj, merged: ['_Working Standards.md'] });
  assert.deepEqual(kept.merged, ['_Working Standards.md']);
  assert.equal(read(path.join(proj, '_Working Standards.md')), before);
  fs.writeFileSync(path.join(proj, '_Working Standards.md'), 'rules, newest, edited here\n');
  const m = install({ kit, home, target: 'project', projectDir: proj, merged: ['_Working Standards.md'] });
  assert.deepEqual(m.merged, ['_Working Standards.md']);
  r = status({ kit, home, projectDir: proj, ahead: () => 0 });
  assert.equal(r.current, true, r.text);
  assert.equal(read(path.join(proj, '_Working Standards.md')), 'rules, newest, edited here\n');

  // GitHub ahead of the kit folder.
  fs.writeFileSync(path.join(proj, '_Working Standards.md'), 'rules, newer\n');
  r = status({ kit, home, projectDir: proj, ahead: () => 2, newest: () => 'v1.0.3' });
  assert.equal(r.current, false);
  assert.match(r.text, /GitHub has 2 newer kit release\(s\), newest v1\.0\.3[\s\S]*git -C ".*" fetch --tags; git -C ".*" checkout v1\.0\.3/);
  assert.doesNotMatch(r.text, /git pull/);
});

// why: guards rule:kit-standards (an install never removes what it should not, and a dry run removes nothing). K11,
// the 1.27.0 cut took the only dry-run install test.
test('the branch-only clean-up runs only over an unreleased install, never removes the overlay, and a dry run removes nothing', () => {
  // A release or pre-check install over which the kit stopped shipping a file (not retired): the file stays.
  for (const tagged of [true, false]) {
    const { kit, home } = makeKit();
    fs.writeFileSync(path.join(kit, 'user/agents/dropped.md'), 'shipped once\n');
    const before = tagged ? released(kit, 'v1.0.0') : undefined;
    install({ kit, home, target: 'user', release: before });
    fs.rmSync(path.join(kit, 'user/agents/dropped.md'));
    const r = install({ kit, home, target: 'user', release: released(kit, 'v1.0.1') });
    assert.deepEqual(r.retired, [], JSON.stringify(before));
    assert.ok(fs.existsSync(path.join(home, 'agents/dropped.md')));
  }
  // The overlay CLAUDE.local.md is written by install itself, not from a kit path, so it is never branch-only.
  const { kit, home, proj } = overlayKit();
  install({ kit, home, target: 'project', projectDir: proj, overlay: true, release: { release: false, describe: 'v1.0.0-1-gabc1234' } });
  const back = install({ kit, home, target: 'project', projectDir: proj, overlay: true, release: released(kit, 'v1.0.0') });
  assert.ok(!back.retired.includes('CLAUDE.local.md'));
  assert.ok(fs.existsSync(path.join(proj, 'CLAUDE.local.md')));
  // A dry run previews the clean-up: the file and the record stay as they are.
  const d = makeKit();
  fs.writeFileSync(path.join(d.kit, 'user/agents/branch-only.md'), 'branch build\n');
  install({ kit: d.kit, home: d.home, target: 'user', release: { release: false, describe: 'v1.0.0-1-gabc1234' } });
  fs.rmSync(path.join(d.kit, 'user/agents/branch-only.md'));
  const stampBefore = read(path.join(d.home, 'kit-install.json'));
  const dry = install({ kit: d.kit, home: d.home, target: 'user', dryRun: true, release: released(d.kit, 'v1.0.0') });
  assert.deepEqual(dry.retired, ['agents/branch-only.md'], 'the preview names it');
  assert.ok(fs.existsSync(path.join(d.home, 'agents/branch-only.md')));
  assert.equal(read(path.join(d.home, 'kit-install.json')), stampBefore);
});

// why: guards rule:failure-response (status names which Claude folder it read, the first question when a kit looks
// stale). K11, the 1.27.0 cut took it.
test('status names the Claude config folder it read', () => {
  const { kit, home, proj } = makeKit();
  assert.ok(status({ kit, home, projectDir: proj, ahead: () => 0 }).text.includes(`Claude config folder: ${home.split(path.sep).join('/')}`));
});

// why: guards rule:tracking-file-functions (a session removes what it made once it has served, and lists the rest for
// the owner). The owner, 2026-11-12: the closeout cleans a thread's own probe folders as part of the process, not by a
// string of delete asks; 56 probe folders, 37 guard records and a throwaway had built up over eight releases.
test('scratch: closeout removes a thread\'s own probe folders and guard records, names the kept, lists strays', () => {
  const root = makeTemp('probes-');
  const home = makeTemp('home-');
  const made = (thread, label) => kitScratch({ root, home, cmd: 'new', thread, label }).path;
  const a = made('feat/x', 'repro');
  const b = made('feat/x', 'mutation');
  const c = made('feat/y', 'other');
  assert.ok(fs.statSync(a).isDirectory() && a.startsWith(root));
  kitScratch({ root, home, cmd: 'keep', path: b, reason: 'the next build reads its survivors' });
  fs.mkdirSync(guardDir(home, a), { recursive: true });
  fs.writeFileSync(path.join(guardDir(home, a), 'record.json'), '{}');
  const stray = path.join(root, 'old-stray');
  fs.mkdirSync(stray);
  const old = new Date(Date.now() - 5 * 86400e3);
  fs.utimesSync(stray, old, old);
  // A ledger line pointing outside the probe folder is never followed.
  const ledger = path.join(root, '.ledger.json');
  const l = JSON.parse(read(ledger));
  l.entries.push({ path: home, thread: 'feat/x', label: 'evil', created: new Date().toISOString() });
  fs.writeFileSync(ledger, JSON.stringify(l));
  const gone = [];
  const r = kitScratch({ root, home, cmd: 'clean', thread: 'feat/x', trash: (p) => gone.push(p) });
  assert.deepEqual(gone.sort(), [a, guardDir(home, a)].sort());
  assert.match(r.text, /kept: .*mutation.*the next build reads its survivors/);
  assert.match(r.text, /refused: .*outside the probe folder/);
  assert.match(r.text, /stray.*old-stray/);
  const after = JSON.parse(read(ledger)).entries.map((e) => e.path);
  assert.ok(!after.includes(a) && after.includes(b) && after.includes(c), 'the ledger lost the wrong entry');
  // The 1.28.0 sweep: a move that fails keeps that folder's ledger line and the report of what did move.
  const d = made('feat/z', 'one');
  const e = made('feat/z', 'two');
  const r2 = kitScratch({ root, home, cmd: 'clean', thread: 'feat/z', trash: (p) => { if (p === d) throw new Error('EXDEV: cross-device'); } });
  assert.match(r2.text, /not removed: .*one.*EXDEV/);
  assert.match(r2.text, /removed: .*two/);
  const kept = JSON.parse(read(ledger)).entries.map((x) => x.path);
  assert.ok(kept.includes(d) && !kept.includes(e), 'the failed move lost its ledger line');
});

// why: guards rule:security-standards. The 1.28.0 sweep: on Windows a program started by bare name is looked for in
// the current folder first, so a powershell.exe planted where closeout runs would have run in place of the real one.
test('scratch clean starts the system PowerShell, never one in the current folder', { skip: process.platform !== 'win32' }, () => {
  const here = makeTemp('plant-');
  fs.copyFileSync(process.execPath, path.join(here, 'powershell.exe'));
  const root = makeTemp('probes-');
  const home = makeTemp('home-');
  const p = kitScratch({ root, home, cmd: 'new', thread: 'feat/x', label: 'repro' }).path;
  const url = pathToFileURL(path.resolve('scripts/kit.mjs')).href;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `import { scratch } from ${JSON.stringify(url)}; scratch({ root: ${JSON.stringify(root)}, home: ${JSON.stringify(home)}, cmd: 'clean', thread: 'feat/x' });`], { cwd: here, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(p), 'the probe folder was not moved to the Recycle Bin');
});
