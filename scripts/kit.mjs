#!/usr/bin/env node
// The kit's one tool: install the kit into ~/.claude or a project, find what a project changed
// (fold-back), bump the version, and scrub the kit for personal details before a push.
//
// Why hashes: each install records the hash of every file it wrote. Comparing that hash with the
// file today and with the kit today tells, per file, who changed it - the project, the kit, or
// both - without the kit needing a copy of every project. A file the owner changed is never
// overwritten; it is reported so the owner decides.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const STAMP_USER = 'kit-install.json';
const STAMP_PROJECT = path.join('.kit', 'kit-version.json');
// Files that hold the owner's details on purpose, and folders that are not kit content.
const SCRUB_SKIP = new Set(['kit.config.json', 'owner-profile.md', 'scrub.local.json']);
// vendor/ holds third-party work kept as-is, with its own credits; it is not the owner's content.
const SCRUB_SKIP_DIRS = new Set(['.git', 'node_modules', 'reports', 'vendor']);
const SNAPSHOT_SKIP = new Set(['.git', 'node_modules', '.in_use']);
const PATH_PATTERN = /[A-Za-z]:\\+Users\\+|\/Users\/[^/\s]+|\/home\/[^/\s]+/;

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const toPosix = (p) => p.split(path.sep).join('/');

function walk(dir, skipDirs = new Set()) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return skipDirs.has(e.name) ? [] : walk(full, skipDirs);
    return [full];
  });
}

/** Claude Code's per-project folder name: every non-alphanumeric character becomes a dash. */
export function projectSlug(projectDir) {
  return path.resolve(projectDir).replace(/[^A-Za-z0-9]/g, '-');
}

/** Fill the kit's placeholders; a placeholder with no value is left as it is. */
export function render(text, { ownerName, ownerProfile, projectDir } = {}) {
  let out = text;
  if (ownerName !== undefined) out = out.replaceAll('{{OWNER_NAME}}', ownerName);
  if (ownerProfile !== undefined) out = out.replaceAll('{{OWNER_PROFILE}}', ownerProfile);
  if (projectDir !== undefined) out = out.replaceAll('{{PROJECT_DIR}}', projectDir);
  return out;
}

const thirdPartySkills = (config) => [
  ...(config.thirdPartySkills || []),
  ...((config.vendor && config.vendor.skillGroups) || []).flatMap((g) => g.skills),
];

function loadKit(kit) {
  const config = JSON.parse(fs.readFileSync(path.join(kit, 'kit.config.json'), 'utf8'));
  const profilePath = path.join(kit, config.ownerProfileFile || 'owner-profile.md');
  const ownerProfile = fs.existsSync(profilePath) ? fs.readFileSync(profilePath, 'utf8').trimEnd() : '';
  const version = fs.readFileSync(path.join(kit, 'VERSION'), 'utf8').trim();
  const git = spawnSync('git', ['-C', kit, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
  const commit = git.status === 0 ? git.stdout.trim() : null;
  return { config, ownerProfile, version, commit };
}

/**
 * List what the kit installs for one target.
 *
 * Args:
 *     ctx: { kit, home, target: 'user' | 'project', projectDir }
 *
 * Returns:
 *     { entries: [{ key, src, dest }], stampPath, memoryDir }
 */
function plan({ kit, home, target, projectDir }) {
  const entries = [];
  const add = (srcRoot, destRoot, prefix = '') => {
    for (const src of walk(srcRoot)) {
      const rel = toPosix(path.relative(srcRoot, src));
      entries.push({ key: prefix + rel, src, dest: path.join(destRoot, rel) });
    }
  };
  if (target === 'user') {
    add(path.join(kit, 'user'), home);
    return { entries, stampPath: path.join(home, STAMP_USER) };
  }
  if (target !== 'project' || !projectDir) throw new Error('target must be "user" or "project <folder>"');
  const memoryDir = path.join(home, 'projects', projectSlug(projectDir), 'memory');
  add(path.join(kit, 'project'), projectDir);
  add(path.join(kit, 'memory'), memoryDir, 'memory/');
  return { entries, stampPath: path.join(projectDir, STAMP_PROJECT), memoryDir };
}

function renderEntry(kitInfo, entry, projectDir) {
  const text = fs.readFileSync(entry.src, 'utf8');
  return render(text, {
    ownerName: kitInfo.config.ownerName,
    ownerProfile: kitInfo.ownerProfile,
    projectDir: projectDir ? toPosix(path.resolve(projectDir)) : undefined,
  });
}

const readStamp = (p) => ({ files: {}, ...(fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {}) });

/**
 * Copy the kit into ~/.claude (target 'user') or a project (target 'project').
 *
 * A file that is missing is created. A file the owner left as the last install wrote it is
 * updated to the kit's version. A file the owner changed is skipped and reported - unless force
 * is set, which replaces it and keeps the old copy in a dated backup folder.
 *
 * Args:
 *     ctx: { kit, home, target, projectDir, dryRun, force }
 *
 * Returns:
 *     { created, updated, replaced, skipped: [{ file, reason }], backupDir, version }
 */
export function install(ctx) {
  const kitInfo = loadKit(ctx.kit);
  const { entries, stampPath } = plan(ctx);
  const stamp = readStamp(stampPath);
  const files = { ...stamp.files };
  const created = [], updated = [], replaced = [], skipped = [];
  const backupDir = path.join(path.dirname(stampPath), 'kit-backups', new Date().toISOString().replace(/[:.]/g, '-'));
  for (const entry of entries) {
    const want = renderEntry(kitInfo, entry, ctx.projectDir);
    const wantHash = sha(want);
    const write = () => {
      if (ctx.dryRun) return;
      fs.mkdirSync(path.dirname(entry.dest), { recursive: true });
      fs.writeFileSync(entry.dest, want);
    };
    if (!fs.existsSync(entry.dest)) {
      write(); created.push(entry.key); files[entry.key] = wantHash;
      continue;
    }
    const cur = sha(fs.readFileSync(entry.dest, 'utf8'));
    const base = stamp.files[entry.key];
    if (cur === wantHash) {
      files[entry.key] = wantHash;
    } else if (base && cur === base) {
      write(); updated.push(entry.key); files[entry.key] = wantHash;
    } else if (ctx.force) {
      if (!ctx.dryRun) {
        const keep = path.join(backupDir, entry.key);
        fs.mkdirSync(path.dirname(keep), { recursive: true });
        fs.copyFileSync(entry.dest, keep);
      }
      write(); replaced.push(entry.key); files[entry.key] = wantHash;
    } else {
      const reason = !base ? 'already exists and differs from the kit'
        : wantHash === base ? 'changed here - run fold-back'
        : 'changed here and in the kit - merge by hand';
      skipped.push({ file: entry.key, reason });
    }
  }
  if (!ctx.dryRun) {
    fs.mkdirSync(path.dirname(stampPath), { recursive: true });
    const out = { version: kitInfo.version, commit: kitInfo.commit, kitDir: toPosix(path.resolve(ctx.kit)), installedAt: new Date().toISOString(), files };
    fs.writeFileSync(stampPath, JSON.stringify(out, null, 2) + '\n');
  }
  return { created, updated, replaced, skipped, backupDir: replaced.length ? backupDir : null, version: kitInfo.version };
}

function diffText(a, b) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kitdiff-'));
  const fa = path.join(tmp, 'kit'), fb = path.join(tmp, 'here');
  fs.writeFileSync(fa, a); fs.writeFileSync(fb, b);
  const r = spawnSync('git', ['diff', '--no-index', '--no-color', '--', fa, fb], { encoding: 'utf8' });
  fs.rmSync(tmp, { recursive: true, force: true });
  return (r.stdout || '').split('\n').slice(4).join('\n');
}

/**
 * Compare a target with the kit and sort each file.
 *
 * Args:
 *     ctx: { kit, home, target, projectDir }
 *
 * Returns:
 *     { foldBack, update, conflict, added, missing, report } - foldBack: changed here only (a
 *     candidate for the kit); update: changed in the kit only; conflict: changed in both, or
 *     never installed and different; added: files here the kit has never seen; report: markdown.
 */
export function foldBack(ctx) {
  const kitInfo = loadKit(ctx.kit);
  const { entries, stampPath, memoryDir } = plan(ctx);
  const stamp = readStamp(stampPath);
  const out = { foldBack: [], update: [], conflict: [], added: [], missing: [] };
  const diffs = [];
  for (const entry of entries) {
    const want = renderEntry(kitInfo, entry, ctx.projectDir);
    const base = stamp.files[entry.key];
    if (!fs.existsSync(entry.dest)) { if (base) out.missing.push(entry.key); continue; }
    const curText = fs.readFileSync(entry.dest, 'utf8');
    const cur = sha(curText), wantHash = sha(want);
    if (cur === wantHash) continue;
    let bucket;
    if (!base) bucket = 'conflict';
    else if (cur !== base && wantHash === base) bucket = 'foldBack';
    else if (cur === base) bucket = 'update';
    else bucket = 'conflict';
    out[bucket].push(entry.key);
    if (bucket !== 'update') diffs.push(`### ${entry.key} (${bucket})\n\n\`\`\`diff\n${diffText(want, curText)}\n\`\`\`\n`);
  }
  const known = new Set(entries.map((e) => e.key));
  const scan = ctx.target === 'user'
    ? ['agents', 'skills'].flatMap((d) => walk(path.join(ctx.home, d)).map((f) => toPosix(path.relative(ctx.home, f))))
        .filter((k) => !thirdPartySkills(kitInfo.config).some((s) => k.startsWith(`skills/${s}/`)))
    : walk(memoryDir).map((f) => 'memory/' + toPosix(path.relative(memoryDir, f)));
  for (const key of scan) {
    if (known.has(key)) continue;
    out.added.push(key);
    const abs = ctx.target === 'user' ? path.join(ctx.home, key) : path.join(memoryDir, key.slice('memory/'.length));
    diffs.push(`### ${key} (new here)\n\n\`\`\`\n${fs.readFileSync(abs, 'utf8')}\n\`\`\`\n`);
  }
  const where = ctx.target === 'user' ? '~/.claude' : path.basename(path.resolve(ctx.projectDir));
  const list = (title, items) => `## ${title} (${items.length})\n\n${items.map((i) => `- ${i}`).join('\n') || '- none'}\n`;
  out.report = [
    `# Fold-back report: ${where}`,
    `Kit ${kitInfo.version}; installed here at ${stamp.version || 'never'}.`,
    list('Fold back: changed here, a candidate for the kit', out.foldBack),
    list('Update: the kit moved on, run install to pull it', out.update),
    list('Conflict: merge by hand', out.conflict),
    list('New here: the kit has never seen these', out.added),
    list('Missing here: installed once, now deleted', out.missing),
    '## Details\n',
    ...diffs,
  ].join('\n\n');
  return out;
}

/** Raise VERSION by one level and add a dated entry to the top of CHANGELOG.md. */
export function bump({ kit, level, note, date = new Date().toISOString().slice(0, 10) }) {
  const [maj, min, pat] = fs.readFileSync(path.join(kit, 'VERSION'), 'utf8').trim().split('.').map(Number);
  const next = level === 'major' ? `${maj + 1}.0.0` : level === 'minor' ? `${maj}.${min + 1}.0`
    : level === 'patch' ? `${maj}.${min}.${pat + 1}` : null;
  if (!next) throw new Error('level must be major, minor or patch');
  fs.writeFileSync(path.join(kit, 'VERSION'), next + '\n');
  const logPath = path.join(kit, 'CHANGELOG.md');
  const log = fs.readFileSync(logPath, 'utf8');
  const head = '# Changelog\n';
  const rest = log.startsWith(head) ? log.slice(head.length).replace(/^\n+/, '') : log;
  fs.writeFileSync(logPath, `${head}\n## ${next} - ${date}\n- ${note}\n\n${rest}`);
  return next;
}

/**
 * Find personal details in the kit: words from scrub.local.json (kept out of git), home-folder
 * paths, and any non-ASCII byte. One hit per file and kind.
 */
export function scrub({ kit }) {
  const localPath = path.join(kit, 'scrub.local.json');
  const words = fs.existsSync(localPath) ? JSON.parse(fs.readFileSync(localPath, 'utf8')).words || [] : [];
  const hits = [];
  for (const file of walk(kit, SCRUB_SKIP_DIRS)) {
    const rel = toPosix(path.relative(kit, file));
    if (SCRUB_SKIP.has(rel)) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const seen = new Set();
    const hit = (kind, i) => { if (!seen.has(kind)) { seen.add(kind); hits.push({ file: rel, line: i + 1, kind }); } };
    lines.forEach((line, i) => {
      for (const w of words) {
        const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`(^|[^A-Za-z0-9])${esc}([^A-Za-z0-9]|$)`).test(line)) hit(`word:${w}`, i);
      }
      if (PATH_PATTERN.test(line)) hit('path', i);
      if (/[^\x00-\x7F]/.test(line)) hit('non-ascii', i);
    });
  }
  return hits;
}

/** Expand %VAR% and ${VAR} so a config path can name the user's own folders without spelling them out. */
const expandEnv = (p) => p.replace(/%([A-Za-z_]+)%|\$\{([A-Za-z_]+)\}/g, (m, a, b) => process.env[a || b] ?? m);

function copyTree(from, to) {
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true, filter: (src) => !SNAPSHOT_SKIP.has(path.basename(src)) });
}

function licenseName(dir) {
  const p = path.join(dir, 'LICENSE');
  if (!fs.existsSync(p)) return 'unknown';
  const head = fs.readFileSync(p, 'utf8').slice(0, 200);
  return /MIT License/.test(head) ? 'MIT' : /Apache License/.test(head) ? 'Apache-2.0' : 'see LICENSE';
}

/**
 * Keep a credited copy of each third-party plugin and skill in vendor/, so the kit can still
 * restore them if a source is deleted or unreachable. Each copy carries its LICENSE and a
 * SOURCE.json (version, commit, author, license, where it came from); vendor/CREDITS.md lists all.
 *
 * Args:
 *     ctx: { kit, home, date } - what to copy comes from kit.config.json "vendor"
 *
 * Returns:
 *     { plugins, skills, missing } - names copied, and names not found on this machine
 */
export function snapshot({ kit, home, date = new Date().toISOString().slice(0, 10) }) {
  const { config } = loadKit(kit);
  const want = config.vendor || {};
  const vendor = path.join(kit, 'vendor');
  const installedPath = path.join(home, 'plugins', 'installed_plugins.json');
  const installed = fs.existsSync(installedPath) ? JSON.parse(fs.readFileSync(installedPath, 'utf8')).plugins || {} : {};
  const marketsPath = path.join(home, 'plugins', 'known_marketplaces.json');
  const markets = fs.existsSync(marketsPath) ? JSON.parse(fs.readFileSync(marketsPath, 'utf8')) : {};
  const marketUrl = (m) => {
    const src = markets[m] && markets[m].source;
    return src && src.source === 'github' && src.repo ? `https://github.com/${src.repo}` : `marketplace: ${m}`;
  };
  const out = { plugins: [], skills: [], missing: [] };
  const credits = [];
  const pluginDirs = {};
  // Plugins the desktop app delivers (an organization's catalog) live outside the plugin cache, in
  // folders named by id; they are found by the name in their plugin.json.
  const rootPlugins = {};
  for (const root of (want.pluginRoots || []).map(expandEnv)) {
    for (const file of walk(root)) {
      if (!file.endsWith(path.join('.claude-plugin', 'plugin.json'))) continue;
      const dir = path.dirname(path.dirname(file));
      try { rootPlugins[JSON.parse(fs.readFileSync(file, 'utf8')).name] ??= dir; } catch { /* not a plugin */ }
    }
  }
  for (const name of want.plugins || []) {
    const key = Object.keys(installed).find((k) => k.startsWith(name + '@'));
    // One entry per scope (user, each project); the most recently updated is the copy in use.
    const entry = key ? [...installed[key]].sort((a, b) => String(b.lastUpdated).localeCompare(String(a.lastUpdated)))[0]
      : rootPlugins[name] ? { installPath: rootPlugins[name] } : null;
    if (!entry || !fs.existsSync(entry.installPath)) { out.missing.push(name); continue; }
    const dest = path.join(vendor, 'plugins', name);
    copyTree(entry.installPath, dest);
    pluginDirs[name] = dest;
    const metaPath = path.join(dest, '.claude-plugin', 'plugin.json');
    const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {};
    const market = key ? key.split('@')[1] : 'desktop app catalog';
    const source = {
      name, version: entry.version || meta.version || null, commit: entry.gitCommitSha || null,
      marketplace: market, author: (meta.author && meta.author.name) || 'unknown',
      repository: meta.repository || meta.homepage || marketUrl(market),
      license: meta.license || licenseName(dest), snapshotAt: date,
    };
    const { licenseFrom, ...credit } = (want.credits || {})[name] || {};
    Object.assign(source, credit);
    // Same rule as skill groups: no LICENSE shipped -> the standard text from a plugin with that license.
    const fromPlugin = licenseFrom && licenseFrom.startsWith('plugin:') && pluginDirs[licenseFrom.slice(7)];
    if (fromPlugin && !fs.existsSync(path.join(dest, 'LICENSE'))) fs.copyFileSync(path.join(fromPlugin, 'LICENSE'), path.join(dest, 'LICENSE'));
    fs.writeFileSync(path.join(dest, 'SOURCE.json'), JSON.stringify(source, null, 2) + '\n');
    credits.push(source);
    out.plugins.push(name);
  }
  for (const group of want.skillGroups || []) {
    const dest = path.join(vendor, 'skills', group.name);
    fs.rmSync(dest, { recursive: true, force: true });
    const copied = [];
    for (const skill of group.skills) {
      const from = path.join(home, 'skills', skill);
      if (!fs.existsSync(from)) { out.missing.push(skill); continue; }
      copyTree(from, path.join(dest, skill));
      copied.push(skill);
    }
    if (!copied.length) continue;
    // A source with no LICENSE file on this machine gets the standard text of its license, copied
    // from a plugin that ships the same license, so the credit travels with the copy.
    const fromPlugin = group.licenseFrom && group.licenseFrom.startsWith('plugin:') && pluginDirs[group.licenseFrom.slice(7)];
    if (fromPlugin && fs.existsSync(path.join(fromPlugin, 'LICENSE'))) fs.copyFileSync(path.join(fromPlugin, 'LICENSE'), path.join(dest, 'LICENSE'));
    const source = { name: group.name, version: null, commit: null, author: group.copyright, repository: group.source,
      license: group.license, skills: copied, snapshotAt: date };
    fs.writeFileSync(path.join(dest, 'SOURCE.json'), JSON.stringify(source, null, 2) + '\n');
    credits.push(source);
    out.skills.push(...copied);
  }
  const rows = credits.map((c) => `| ${c.name} | ${c.author} | ${c.license} | ${c.repository} | ${c.version || '-'} | ${c.snapshotAt} | ${[c.licenseNote, c.note].filter(Boolean).join(' ') || '-'} |`);
  fs.mkdirSync(vendor, { recursive: true });
  fs.writeFileSync(path.join(vendor, 'CREDITS.md'), [
    '# Credits',
    '',
    "These are other people's work, kept here as a backup copy under their own licenses. Each folder keeps its",
    'LICENSE and a SOURCE.json. Install from the source when it is up; restore from here only when it is not.',
    'Anything built on one of these copies credits it and records what was changed.',
    '',
    '| Name | Author | License | Source | Version | Copied | Notes |',
    '|---|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n'));
  return out;
}

/**
 * Bring a lost third-party skill back from vendor/ into ~/.claude/skills. For a plugin, its
 * skills come back as plain skills (its hooks and commands stay in vendor/plugins/<name>).
 * A skill folder that already exists is kept, never overwritten.
 *
 * Returns:
 *     { restored, kept } - skill names
 */
export function restore({ kit, home, name }) {
  const vendor = path.join(kit, 'vendor');
  const plugin = path.join(vendor, 'plugins', name, 'skills');
  const group = path.join(vendor, 'skills', name);
  const out = { restored: [], kept: [] };
  const single = path.join(vendor, 'plugins', name);
  if (!fs.existsSync(plugin) && fs.existsSync(path.join(single, 'SKILL.md'))) {
    const dest = path.join(home, 'skills', name);
    if (fs.existsSync(dest)) out.kept.push(name);
    else { fs.cpSync(single, dest, { recursive: true }); out.restored.push(name); }
    return out;
  }
  const root = fs.existsSync(plugin) ? plugin : fs.existsSync(group) ? group : null;
  if (!root) throw new Error(`no snapshot named ${name} in vendor/`);
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const dest = path.join(home, 'skills', e.name);
    if (fs.existsSync(dest)) { out.kept.push(e.name); continue; }
    fs.cpSync(path.join(root, e.name), dest, { recursive: true });
    out.restored.push(e.name);
  }
  return out;
}

const semverAbove = (a, b) => {
  const [x, y] = [a, b].map((v) => String(v).split('.').map(Number));
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

/**
 * What a session should know at start: whether the kit has moved past this project, and which
 * skills apply to the cases this project turned on. The session-start hook adds it to Claude's
 * context, so nothing depends on anyone remembering to check.
 *
 * Args:
 *     ctx: { kit, home, projectDir }
 *
 * Returns:
 *     the message text (one or more lines)
 */
export function sessionStartReport({ kit, home, projectDir }) {
  const lines = [];
  const ahead = remoteKitAhead(kit);
  if (ahead > 0) lines.push(`The kit on GitHub is ${ahead} commit(s) ahead of the kit folder. Run git pull in ${toPosix(kit)}, then /methodology-kit update.`);
  const kitVersion = fs.readFileSync(path.join(kit, 'VERSION'), 'utf8').trim();
  const stamp = readStamp(path.join(projectDir, STAMP_PROJECT));
  // Whatever session start reports covers the kit as it is now; the per-message check speaks only after this.
  if (stamp.version) writeNotice(projectDir, kitVersion);
  if (!stamp.version) {
    lines.push(`This project has no kit install record. Run /methodology-kit existing to adopt kit ${kitVersion}.`);
  } else if (semverAbove(kitVersion, stamp.version)) {
    const log = fs.readFileSync(path.join(kit, 'CHANGELOG.md'), 'utf8');
    const newer = [...log.matchAll(/^## (\d+\.\d+\.\d+)/gm)].filter((m) => semverAbove(m[1], stamp.version)).length;
    lines.push(`Kit ${kitVersion} has ${newer} newer change(s) than this project (${stamp.version}). Run /methodology-kit update.`);
  }
  if (stamp.version) {
    const r = foldBack({ kit, home, target: 'project', projectDir });
    const held = [...r.foldBack, ...r.conflict].filter((k) => !k.startsWith('memory/'));
    if (held.length) lines.push(`${held.length} kit file(s) changed in this project, so update leaves them alone: ${held.join(', ')}. Merge kit changes into them by hand.`);
  }
  const catalogPath = path.join(projectDir, '.claude', 'kit', 'skill-cases.json');
  const localPath = path.join(projectDir, '.claude', 'skill-cases.local.json');
  if (fs.existsSync(catalogPath)) {
    const { cases } = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    const on = fs.existsSync(localPath) ? JSON.parse(fs.readFileSync(localPath, 'utf8')).on || [] : null;
    if (!on) {
      lines.push(`No skill cases chosen yet for this project. Ask the owner which apply (${cases.map((c) => c.id).join(', ')}) and record them in .claude/skill-cases.local.json.`);
    } else {
      const active = cases.filter((c) => on.includes(c.id));
      if (active.length) {
        lines.push('Skills by case for this project - load at most two per unit of work, keep design-time, motion and review-time sets apart, and read a community skill before its first use:');
        for (const c of active) lines.push(`- ${c.name} (${c.when}): ${c.skills.join(', ')}`);
      }
    }
  }
  return lines.join('\n');
}

/** Installed plugins whose version differs from the backup copy in vendor/. */
export function vendorDrift({ kit, home }) {
  const installedPath = path.join(home, 'plugins', 'installed_plugins.json');
  if (!fs.existsSync(installedPath)) return [];
  const installed = JSON.parse(fs.readFileSync(installedPath, 'utf8')).plugins || {};
  const out = [];
  for (const [key, entries] of Object.entries(installed)) {
    const name = key.split('@')[0];
    const sourcePath = path.join(kit, 'vendor', 'plugins', name, 'SOURCE.json');
    if (!fs.existsSync(sourcePath)) continue;
    const newest = [...entries].sort((a, b) => String(b.lastUpdated).localeCompare(String(a.lastUpdated)))[0];
    const backup = JSON.parse(fs.readFileSync(sourcePath, 'utf8')).version;
    if (newest.version && backup && newest.version !== backup) out.push({ name, backup, installed: newest.version });
  }
  return out;
}

// Never copied into a vault, whatever the include list says: a vault is private, but a secret in git history is
// a secret forever.
const VAULT_NEVER = [/(^|\/)\.env(\.|$)/, /(^|\/)\.dev\.vars$/, /\.(key|pem|p12|pfx)$/i, /(^|\/)secrets?\//i, /(^|\/)node_modules\//];

/**
 * Back up a project's private, gitignored notes (the vault) into its own git repository, as a local commit.
 * Pushing that repository to its private remote is the owner's call, never this function's.
 *
 * Args:
 *     ctx: { projectDir, date } - the project's .kit/vault.json gives { dir, include: [git pathspecs] }
 *
 * Returns:
 *     { configured, changed, committed, dir }
 */
export function vaultBackup({ projectDir, date = new Date().toISOString().slice(0, 10) }) {
  const cfgPath = path.join(projectDir, '.kit', 'vault.json');
  if (!fs.existsSync(cfgPath)) return { configured: false, changed: [], committed: false };
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const dir = path.resolve(projectDir, cfg.dir);
  const git = (cwd, ...args) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const listed = git(projectDir, 'ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--', ...(cfg.include || ['*.md']));
  if (listed.status !== 0) throw new Error(`git ls-files failed in ${projectDir}: ${listed.stderr.trim()}`);
  const files = listed.stdout.split('\0').filter(Boolean).filter((f) => !VAULT_NEVER.some((re) => re.test(f)));
  const changed = [];
  for (const rel of files) {
    const src = path.join(projectDir, rel), dest = path.join(dir, rel);
    const body = fs.readFileSync(src);
    if (fs.existsSync(dest) && fs.readFileSync(dest).equals(body)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, body);
    changed.push(rel);
  }
  if (!fs.existsSync(path.join(dir, '.git'))) git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  const pending = git(dir, 'status', '--porcelain').stdout.trim();
  let committed = false;
  if (pending) {
    // Commit as the project's own git identity, so the vault's history matches the project's.
    const who = (k) => git(projectDir, 'config', k).stdout.trim();
    const id = [who('user.name') && `-c`, who('user.name') && `user.name=${who('user.name')}`,
      who('user.email') && `-c`, who('user.email') && `user.email=${who('user.email')}`].filter(Boolean);
    const c = spawnSync('git', [...id, '-C', dir, 'commit', '-q', '-m', `chore: vault backup ${date}`], { encoding: 'utf8' });
    committed = c.status === 0;
  }
  return { configured: true, changed, committed, dir };
}

const NOTICE = path.join('.kit', 'last-kit-notice.json');
function writeNotice(projectDir, version) {
  fs.mkdirSync(path.join(projectDir, '.kit'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, NOTICE), JSON.stringify({ version }) + '\n');
}

/**
 * How many commits the kit's upstream (its GitHub repo) has that the kit folder lacks. A fetch that fails or
 * takes too long counts as 0: an offline machine must still start its session.
 */
function remoteKitAhead(kit) {
  const git = (...a) => spawnSync('git', ['-C', kit, ...a], { encoding: 'utf8', timeout: 8000 });
  if (git('rev-parse', '--abbrev-ref', '@{u}').status !== 0) return 0;
  if (git('fetch', '--quiet').status !== 0) return 0;
  const n = Number(git('rev-list', '--count', 'HEAD..@{u}').stdout.trim());
  return Number.isFinite(n) ? n : 0;
}

/**
 * The per-message check: when the kit gets a newer release while this session runs (another project
 * folded a rule back), say so once per new version. It reads two small files, so it costs almost nothing.
 *
 * Returns:
 *     the message, or '' when there is nothing new to say
 */
export function promptCheckReport({ kit, projectDir }) {
  const stamp = readStamp(path.join(projectDir, STAMP_PROJECT));
  if (!stamp.version) return '';
  const kitVersion = fs.readFileSync(path.join(kit, 'VERSION'), 'utf8').trim();
  if (!semverAbove(kitVersion, stamp.version)) return '';
  const noticePath = path.join(projectDir, NOTICE);
  const last = fs.existsSync(noticePath) ? JSON.parse(fs.readFileSync(noticePath, 'utf8')).version : null;
  if (last === kitVersion) return '';
  writeNotice(projectDir, kitVersion);
  const log = fs.readFileSync(path.join(kit, 'CHANGELOG.md'), 'utf8');
  const newer = [...log.matchAll(/^## (\d+\.\d+\.\d+)/gm)].filter((m) => semverAbove(m[1], stamp.version)).length;
  return `Kit ${kitVersion} was released while this session ran: ${newer} newer change(s) than this project (${stamp.version}). Run /methodology-kit update at the next stopping point.`;
}

/**
 * What is waiting for the kit before a compact: fold-back in report mode for this project and
 * ~/.claude. It never changes a file outside the kit's reports/ folder; the owner sorts each item.
 */
export function preCompactReport({ kit, home, projectDir }) {
  const waiting = [];
  for (const target of ['project', 'user']) {
    if (target === 'user' && !fs.existsSync(path.join(home, STAMP_USER))) continue;
    const r = foldBack({ kit, home, target, projectDir });
    waiting.push(...r.foldBack, ...r.conflict, ...r.added);
  }
  const lines = [waiting.length
    ? `${waiting.length} rule change(s) waiting for the kit: ${waiting.join(', ')}. Sort them in the closeout's rule sort (project-only or portable), then /methodology-kit fold-back for the portable ones.`
    : 'No rule changes waiting for the kit.'];
  const vault = vaultBackup({ projectDir });
  if (!vault.configured) lines.push('No vault backup set up for this project. Set one up (NEW-PROJECT.md step 3b) so the private notes are never lost.');
  else if (vault.committed) lines.push(`Vault backup: ${vault.changed.length} file(s) changed, committed in ${vault.dir}. Push on the owner's go.`);
  const drift = vendorDrift({ kit, home });
  if (drift.length) lines.push(`${drift.length} third-party plugin(s) changed since the backup: ${drift.map((d) => `${d.name} (${d.backup} -> ${d.installed})`).join(', ')}. Review, then run snapshot.`);
  return lines.join('\n');
}

/**
 * List the rule headings (## and ###) of a standards file, with the fixed ID written after the title as
 * `{#id}`. Headings inside fenced code blocks are examples (the handoff template), not rules, and are skipped.
 *
 * Args:
 *     text: the file's text
 *
 * Returns:
 *     [{ level, title, id, line }] - id is null when the heading has none; line counts from 1
 */
export function headings(text) {
  const out = [];
  let fenced = false;
  text.split('\n').forEach((l, i) => {
    if (/^\s*```/.test(l)) { fenced = !fenced; return; }
    const m = !fenced && l.match(/^(#{2,3}) (.*?)(?: \{#([^}]+)\})?\s*$/);
    if (m) out.push({ level: m[1].length, title: m[2], id: m[3] || null, line: i + 1 });
  });
  return out;
}

/**
 * Measure what Claude Code loads for a project at session start: CLAUDE.md, its @imports, and rules with no
 * paths field. Follows the memory docs: imports nest up to four hops, a path ends at the first unescaped space,
 * and imports inside code spans or fenced blocks are skipped.
 *
 * Args:
 *     ctx: { projectDir }
 *
 * Returns:
 *     { files: [{ file, bytes }], total, unresolved: [{ from, import }] }
 */
export function measure({ projectDir }) {
  const root = path.resolve(projectDir);
  const files = [], unresolved = [], seen = new Set();
  const rel = (p) => toPosix(path.relative(root, p));
  const load = (file, depth) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = fs.readFileSync(file, 'utf8');
    files.push({ file: rel(file), bytes: Buffer.byteLength(text) });
    if (depth >= 4) return;
    let fenced = false;
    for (const line of text.split('\n')) {
      if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
      if (fenced) continue;
      for (const m of line.replace(/`[^`]*`/g, '').matchAll(/(?:^|\s)@((?:\\ |\S)+)/g)) {
        const name = m[1].replace(/\\ /g, ' ');
        const target = name.startsWith('~/') ? path.join(os.homedir(), name.slice(2)) : path.resolve(path.dirname(file), name);
        if (fs.existsSync(target) && fs.statSync(target).isFile()) load(target, depth + 1);
        else unresolved.push({ from: rel(file), import: name });
      }
    }
  };
  for (const start of ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md']) {
    const p = path.join(root, start);
    if (fs.existsSync(p)) load(p, 0);
  }
  for (const p of walk(path.join(root, '.claude', 'rules')).filter((f) => f.endsWith('.md'))) {
    const front = fs.readFileSync(p, 'utf8').match(/^---\n([\s\S]*?)\n---/);
    if (!(front && /^paths:/m.test(front[1]))) load(p, 0);
  }
  return { files, total: files.reduce((s, f) => s + f.bytes, 0), unresolved };
}

function main(argv) {
  const kit = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const home = process.env.KIT_CLAUDE_HOME || path.join(os.homedir(), '.claude');
  const [cmd, target, arg] = argv;
  const dryRun = argv.includes('--dry-run');
  const force = argv.includes('--force');
  const projectDir = target === 'project' ? arg : undefined;
  if (cmd === 'install') {
    const r = install({ kit, home, target, projectDir, dryRun, force });
    console.log(`${dryRun ? '[dry run] ' : ''}Kit ${r.version} -> ${target}${projectDir ? ' ' + projectDir : ''}`);
    console.log(`    created: ${r.created.length}, updated: ${r.updated.length}, replaced: ${r.replaced.length}, skipped: ${r.skipped.length}`);
    for (const f of r.replaced) console.log(`    replaced ${f}`);
    if (r.backupDir && !dryRun) console.log(`    old copies kept in ${r.backupDir}`);
    for (const s of r.skipped) console.log(`    skipped ${s.file}: ${s.reason}`);
  } else if (cmd === 'fold-back') {
    const r = foldBack({ kit, home, target, projectDir });
    const name = target === 'user' ? 'user' : 'project-' + path.basename(path.resolve(projectDir)).replace(/[^A-Za-z0-9]+/g, '-');
    const out = path.join(kit, 'reports', `fold-back-${name}-${new Date().toISOString().slice(0, 10)}.md`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, r.report);
    console.log(`fold back: ${r.foldBack.length}, update: ${r.update.length}, conflict: ${r.conflict.length}, new: ${r.added.length}, missing: ${r.missing.length}`);
    console.log(`    report: ${out}`);
  } else if (cmd === 'bump') {
    console.log(`Kit is now ${bump({ kit, level: target, note: arg })}`);
  } else if (cmd === 'snapshot') {
    const r = snapshot({ kit, home });
    console.log(`Snapshot: ${r.plugins.length} plugin(s), ${r.skills.length} skill(s) -> vendor/`);
    if (r.missing.length) console.log(`    not found on this machine: ${r.missing.join(', ')}`);
  } else if (cmd === 'restore') {
    const r = restore({ kit, home, name: target });
    console.log(`restored: ${r.restored.join(', ') || 'none'}; kept (already there): ${r.kept.join(', ') || 'none'}`);
  } else if (cmd === 'measure') {
    const r = measure({ projectDir: target || path.join(kit, 'project') });
    for (const f of r.files) console.log(`${String(f.bytes).padStart(8)}  ${f.file}`);
    console.log(`${String(r.total).padStart(8)}  loaded at session start`);
    for (const u of r.unresolved) console.log(`    import not found: @${u.import} (in ${u.from})`);
  } else if (cmd === 'scrub') {
    const hits = scrub({ kit });
    for (const h of hits) console.log(`${h.file}:${h.line}  ${h.kind}`);
    console.log(hits.length ? `${hits.length} hit(s)` : 'Scrub clean');
    process.exitCode = hits.length ? 1 : 0;
  } else {
    console.log('Usage: node scripts/kit.mjs install user | install project <folder> [--dry-run] [--force]');
    console.log('       node scripts/kit.mjs fold-back user | fold-back project <folder>');
    console.log('       node scripts/kit.mjs bump major|minor|patch "<note>"');
    console.log('       node scripts/kit.mjs snapshot | restore <name>');
    console.log('       node scripts/kit.mjs measure [project folder]');
    console.log('       node scripts/kit.mjs scrub');
    process.exitCode = cmd ? 1 : 0;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
