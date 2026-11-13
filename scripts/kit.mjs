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
import kitTemp from '../project/.claude/kit-temp.cjs';
import launch from '../user/kit-tools/kit-launch.cjs';

// git runs a program the config names on some commands (core.fsmonitor on git status and git ls-files, proven on Git for
// Windows, 2026-11-11), and a project's git config is the agent's to write. Install runs inside a held fix line, so
// every git it runs turns that off, and fetches nothing (a partial clone fetches a missing object through a transport the
// config names). It starts from node's own folder: on Windows a program is looked for in the current folder first, and
// the fix line runs from the project, where the agent could leave a git.exe.
// A protocol.<name>.allow in the repo config beats protocol.allow, so each transport is named too (the security review on
// 0696ddf; no lazy fetch from these commands was reproduced on git 2.56, 2026-11-11).
const NO_PROGRAMS = ['-c', 'core.fsmonitor=false', '-c', 'protocol.allow=never',
  ...['ext', 'file', 'ssh', 'git', 'http', 'https'].flatMap((p) => ['-c', `protocol.${p}.allow=never`])];
const SAFE_CWD = path.dirname(process.execPath);

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
export function render(text, { ownerName, ownerProfile, projectDir, claudeHome } = {}) {
  let out = text;
  if (ownerName !== undefined) out = out.replaceAll('{{OWNER_NAME}}', ownerName);
  if (ownerProfile !== undefined) out = out.replaceAll('{{OWNER_PROFILE}}', ownerProfile);
  if (projectDir !== undefined) out = out.replaceAll('{{PROJECT_DIR}}', projectDir);
  if (claudeHome !== undefined) out = out.replaceAll('{{CLAUDE_HOME}}', claudeHome);
  return out;
}

const thirdPartySkills = (config) => [
  ...(config.thirdPartySkills || []),
  ...((config.vendor && config.vendor.skillGroups) || []).flatMap((g) => g.skills),
];

// The kit's own inputs that install renders into every file it writes: a release install reads them from the bytes
// checked against the release tag, like the files it copies (the 1.26.0 sweep, C4).
const kitInputs = (kit) => {
  const config = JSON.parse(fs.readFileSync(path.join(kit, 'kit.config.json'), 'utf8'));
  return ['kit.config.json', config.ownerProfileFile || 'owner-profile.md', 'VERSION'].map((f) => ({ src: path.join(kit, f) })).filter((e) => fs.existsSync(e.src));
};

function loadKit(kit, checked = null) {
  const read = (p) => (checked && checked.has(p) ? checked.get(p) : fs.readFileSync(p, 'utf8'));
  const config = JSON.parse(read(path.join(kit, 'kit.config.json')));
  const profilePath = path.join(kit, config.ownerProfileFile || 'owner-profile.md');
  const ownerProfile = (checked && checked.has(profilePath)) || fs.existsSync(profilePath) ? read(profilePath).trimEnd() : '';
  const version = read(path.join(kit, 'VERSION')).trim();
  const git = spawnSync('git', ['-C', kit, ...NO_PROGRAMS, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', cwd: SAFE_CWD });
  const commit = git.status === 0 ? git.stdout.trim() : null;
  return { config, ownerProfile, version, commit };
}

// What install copies or reads: a change to any of these ships text no release holds (the owner, 2026-11-02). The
// config and owner profile are rendered into the installed files, and the script decides what install does.
const RELEASE_PATHS = ['user', 'project', 'memory', 'scripts', 'VERSION', 'kit.config.json'];

/**
 * Whether the kit folder is a release: HEAD exactly at tag v<VERSION>, and nothing changed, new or ignored under
 * the paths install copies. Only the CLI asks; install() itself also runs on fixture folders with no git.
 *
 * Returns:
 *     { describe, dirty: [files], problems: [lines] } - no problems means a release
 */
export function releaseState(kit) {
  const tag = 'v' + fs.readFileSync(path.join(kit, 'VERSION'), 'utf8').trim();
  const config = JSON.parse(fs.readFileSync(path.join(kit, 'kit.config.json'), 'utf8'));
  const paths = [...RELEASE_PATHS, config.ownerProfileFile || 'owner-profile.md'];
  // git status runs a program the config names: core.fsmonitor (off for every git install runs), or a filter that a
  // .gitattributes file names. The kit folder's own attributes and git config are in the fingerprint the held fix line
  // checks; the user's global attributes file is not read here. The rest of the global config stays (core.autocrlf
  // decides what a clean checkout looks like on Windows).
  const git = (...a) => spawnSync('git', ['-C', kit, ...NO_PROGRAMS, '-c', 'core.attributesFile=/dev/null', '-c', 'core.quotepath=false', ...a], { encoding: 'utf8', cwd: SAFE_CWD });
  // A kit folder copied inside another repo would read that repo's tags, so the kit folder must be the repo's top.
  const prefix = git('rev-parse', '--show-prefix');
  if (prefix.status !== 0) return { describe: null, dirty: [], problems: [`Not on release tag ${tag}: this kit folder has no git history.`] };
  if (prefix.stdout.trim()) return { describe: null, dirty: [], problems: [`Not on release tag ${tag}: this kit folder sits inside another git repo, not its own.`] };
  const describe = git('describe', '--tags', '--always').stdout.trim() || null;
  const problems = [];
  // HEAD is read once, as a commit id: the tag check and the tree below both name that commit, so a tag or HEAD moved
  // in between changes nothing install trusts (the 1.26.0 sweep, C3). A file moved after it no longer matches the tree.
  const head = git('rev-parse', '-q', '--verify', 'HEAD^{commit}').stdout.trim();
  if (!head || !git('tag', '--points-at', head).stdout.split(/\r?\n/).includes(tag)) problems.push(`Not on release tag ${tag}: HEAD is at ${describe}.`);
  // -z keeps names with spaces whole; a rename entry carries its old name as a second field, skipped here.
  const st = git('status', '--porcelain', '-z', '--ignored', '--untracked-files=all', '--', ...paths);
  // A failed status prints nothing, which must not read as a clean folder.
  if (st.status !== 0) problems.push(`git status failed in the kit folder, so what changed is unknown: ${(st.stderr || '').trim().split(/\r?\n/)[0] || `exit ${st.status}`}.`);
  const fields = st.status === 0 ? st.stdout.split('\0') : [];
  const dirty = [];
  for (let i = 0; i < fields.length; i++) {
    if (!fields[i]) continue;
    dirty.push(fields[i].slice(3));
    if (/^[RC]/.test(fields[i])) i++;
  }
  if (dirty.length) problems.push(`Changed or new files install would copy: ${dirty.slice(0, 10).join(', ')}${dirty.length > 10 ? `, and ${dirty.length - 10} more` : ''}.`);
  // The checked commit's tree, read here once: install checks every file it copies against this id.
  const tree = head ? git('rev-parse', '--verify', '-q', `${head}^{tree}`).stdout.trim() || null : null;
  return { describe, dirty, problems, tree };
}

/** The newest release tag the kit folder knows, or null. */
function newestTag(kit) {
  const r = spawnSync('git', ['-C', kit, ...NO_PROGRAMS, 'tag', '--list', 'v*', '--sort=-v:refname'], { encoding: 'utf8', cwd: SAFE_CWD });
  return r.status === 0 ? r.stdout.split(/\r?\n/).find((t) => /^v\d+\.\d+\.\d+$/.test(t)) || null : null;
}

/** How status names an install stamped as not a release, or null for a release or a stamp from before the check. */
function unreleasedText(stamp) {
  if (stamp.release !== false) return null;
  const dirty = (stamp.dirty || []).length;
  const left = (stamp.leftover || []).length;
  const extra = [dirty && `${dirty} uncommitted file(s)`, left && `${left} file(s) kept from an unreleased build`].filter(Boolean);
  return `unreleased ${stamp.describe || 'build'}${extra.length ? ` with ${extra.join(' and ')}` : ''}`;
}

// A git pull moves the kit folder onto main, off every release tag, so every fix line names a tag instead: one line
// that runs as typed in PowerShell and bash.
const releaseCheckout = (kit, tag) => `git -C "${toPosix(kit)}" fetch --tags; git -C "${toPosix(kit)}" checkout ${tag || '<newest v tag>'}`;

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

/**
 * Read every file a release install copies, once, and check each against the release tag's own tree (B20). The
 * release check and the fix line's fingerprint run before install reads the files, so a process left running could
 * swap one in between; the bytes install renders are the ones checked here, never read again.
 *
 * Returns:
 *     Map of source path to text
 */
function releaseBytes(kit, tree, entries) {
  const r = spawnSync('git', ['-C', kit, ...NO_PROGRAMS, 'ls-tree', '-r', '-z', '--full-tree', tree], { encoding: 'utf8', cwd: SAFE_CWD, maxBuffer: 64 * 1024 * 1024 });
  if (!/^[0-9a-f]{40,64}$/.test(String(tree)) || r.status !== 0) throw new Error('Install refused: the release tag\'s files could not be read in the kit folder.');
  const blobs = new Map();
  for (const line of r.stdout.split('\0')) {
    const m = /^\d+ blob ([0-9a-f]{40})\t(.+)$/s.exec(line);
    if (m) blobs.set(m[2], m[1]);
  }
  const out = new Map();
  const changed = [];
  for (const e of entries) {
    const rel = toPosix(path.relative(kit, e.src));
    const bytes = fs.readFileSync(e.src);
    const blob = crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (blobs.get(rel) !== blob) changed.push(rel);
    out.set(e.src, bytes.toString('utf8'));
  }
  if (changed.length) throw new Error(`Install refused: kit file(s) changed since the release check, so nothing was installed: ${changed.slice(0, 10).join(', ')}. Check out the release tag again, then rerun install.`);
  return out;
}

function renderEntry(kitInfo, entry, projectDir, home, checked = null) {
  const text = checked && checked.has(entry.src) ? checked.get(entry.src) : fs.readFileSync(entry.src, 'utf8');
  return render(text, {
    ownerName: kitInfo.config.ownerName,
    ownerProfile: kitInfo.ownerProfile,
    projectDir: projectDir ? toPosix(path.resolve(projectDir)) : undefined,
    claudeHome: home ? toPosix(path.resolve(home)) : undefined,
  });
}

const readStamp = (p) => ({ files: {}, ...(fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {}) });

// V3 (1.25.1): the files that guard a project - every script in .claude and every git hook. The launcher in the
// Claude config folder hashes them against a record kept there before every call, so one changed outside install holds
// every call; install always puts the kit's copy back, and fold-back never offers one to the kit.
export const isGuarded = (key) => /^\.claude\/[^/]+\.(cjs|mjs)$/.test(key) || /^\.githooks\/[^/]+$/.test(key);
// The kit's own git hooks, which the shims check the guard files before. Every other hook git knows gets a shim that
// runs the project's own hook of that name, so a host that keeps its hooks in .githooks keeps every one (1.25.1 sweep).
const GIT_HOOKS = ['pre-commit', 'commit-msg', 'pre-push'];
const OTHER_HOOKS = ['applypatch-msg', 'pre-applypatch', 'post-applypatch', 'pre-merge-commit', 'prepare-commit-msg', 'post-commit',
  'pre-rebase', 'post-checkout', 'post-merge', 'pre-receive', 'update', 'post-receive', 'post-update',
  'reference-transaction', 'pre-auto-gc', 'post-rewrite', 'sendemail-validate', 'fsmonitor-watchman',
  'p4-changelist', 'p4-prepare-changelist', 'p4-post-changelist', 'p4-pre-submit', 'post-index-change'];

/** Where the outside record and git hook shims of a project live (the launcher names them the same way). */
export function guardDir(home, projectDir) {
  return path.join(home, 'kit-guard', launch.recordName(projectDir));
}

/** Where 1.25.1 kept a project's record, when its name was too long for B13 to keep (C2); null when it is the same. */
function legacyGuardDir(home, projectDir) {
  const old = path.join(home, 'kit-guard', launch.legacyRecordName(projectDir));
  return old === guardDir(home, projectDir) ? null : old;
}

// A project's record, or the one 1.25.1 wrote under the long name, so an upgrade keeps the owner's accepts (C2).
const readRecord = (home, projectDir) => {
  for (const dir of [guardDir(home, projectDir), legacyGuardDir(home, projectDir)].filter(Boolean)) {
    try { return JSON.parse(fs.readFileSync(path.join(dir, 'record.json'), 'utf8')); } catch { /* next */ }
  }
  return null;
};

/**
 * Write a project's git hook shims into its record folder. Each asks the launcher first, then runs the project's own
 * hook. install project writes them; install user rewrites them for every recorded project, so a project installed
 * before a shim change never keeps an old shim that runs a hook unchecked (the 1.26.0 sweep, C9).
 *
 * Returns:
 *     the sha256 of each shim, by hook name
 */
function writeShims(home, hooks, proj) {
  fs.mkdirSync(hooks, { recursive: true });
  const launcher = toPosix(path.join(home, 'kit-tools', 'kit-launch.cjs'));
  // Single quotes, so no $, backtick or quote in a folder name is read by the shell (the 1.25.1 sweep); NODE_OPTIONS
  // cleared and node's own folder first, as the launcher's own entry does.
  const q = launch.shq;
  const head = ['#!/bin/sh', '# The kit\'s hook shim (V3): the guard files are checked from outside the project before the project\'s hook runs.',
    'NODE_OPTIONS=; export NODE_OPTIONS', `PATH=${q(launch.shellDir(path.dirname(process.execPath)))}:"$PATH"; export PATH`];
  for (const name of [...GIT_HOOKS, ...OTHER_HOOKS]) {
    const own = `${proj}/.githooks/${name}`;
    // Every shim that runs a project hook checks the guard files first (B19): a branch that carries a new hook would
    // otherwise run it in the same checkout that wrote it. The launcher then hands back a copy of the hook written from
    // the bytes it checked, and that copy runs, never the project's file read again (C11). A shim with no project hook
    // to run exits at once.
    const checkFirst = `run=$(${q(launch.shellDir(process.execPath))} ${q(launcher)} git-hook ${q(proj)} ${name} </dev/null) || exit 1`;
    // A launcher from before C11 (1.26.0) checks and prints no copy: the shim names the fix, never runs exec "" (K4).
    const older = `[ -n "$run" ] || { echo "Kit: the kit in the Claude folder is older than this project's; run kit.mjs install user from the release copy, then try again." >&2; exit 1; }`;
    const body = GIT_HOOKS.includes(name) ? [
      `[ -f ${q(own)} ] || { echo "Kit: .githooks/${name} is missing; run kit.mjs install project." >&2; exit 1; }`,
      checkFirst, older,
    ] : [`[ -x ${q(own)} ] || exit 0`, checkFirst, older];
    fs.writeFileSync(path.join(hooks, name), [...head, ...body, `KIT_HOOK_PROJECT=${q(proj)}; export KIT_HOOK_PROJECT`, 'exec "$run" "$@"', ''].join('\n'));
    fs.chmodSync(path.join(hooks, name), 0o755);
  }
  // A shim the kit no longer writes (push-to-checkout and proc-receive, dropped in 1.26.0) would still run its project
  // hook unchecked, so it goes.
  for (const e of fs.readdirSync(hooks)) if (![...GIT_HOOKS, ...OTHER_HOOKS].includes(e)) fs.rmSync(path.join(hooks, e), { force: true });
  return Object.fromEntries([...GIT_HOOKS, ...OTHER_HOOKS].map((name) => [name, crypto.createHash('sha256').update(fs.readFileSync(path.join(hooks, name))).digest('hex')]));
}

/**
 * Write the outside record and the git hook shims for a project. Each shim asks the launcher first, then runs the
 * project's own hook, so a hook swapped by a branch cannot pass the push in the same command that swapped it.
 *
 * Returns:
 *     the shims folder, in the form core.hooksPath takes
 */
function writeGuardRecord(ctx, kitInfo, files, keys, prev, isHost, skipped) {
  const dir = guardDir(ctx.home, ctx.projectDir);
  const hooks = path.join(dir, 'hooks');
  const proj = toPosix(path.resolve(ctx.projectDir));
  writeShims(ctx.home, hooks, proj);
  // A guard file the kit did not write (a host's own tracked hook it skipped) is recorded as it is, so a swap of it
  // still holds every call.
  // A host's own guard file is recorded as it stands the first time; after that a change to it stays held, even through
  // a reinstall, until the owner accepts it with --accept-host (which the held fix line may not carry).
  const guarded = {};
  const host = [];
  // Every version of a host file the owner has accepted (B15): a host hook that differs between branches would
  // otherwise hold after each plain checkout, and accepting it on one branch held the other. A version never
  // accepted still holds every call.
  const accepted = {};
  const acceptedOf = (key) => [...new Set([...((prev && prev.accepted && prev.accepted[key]) || []), ...(prev && prev.files && prev.files[key] ? [prev.files[key]] : [])])].filter((h) => /^[0-9a-f]{64}$/.test(h));
  // Every other hook in .githooks is the host's: the shims run it, so it is recorded too. One that appears after the
  // first record holds every call until the owner accepts it (the second pass on 0772397).
  let extras = [];
  try { extras = fs.readdirSync(path.join(ctx.projectDir, '.githooks'), { withFileTypes: true }).filter((e) => !e.isDirectory()).map((e) => `.githooks/${e.name}`).filter((k) => !keys.includes(k)); } catch { /* none */ }
  for (const key of [...keys.filter(isGuarded), ...extras].sort()) {
    const file = path.join(ctx.projectDir, key);
    if (extras.includes(key) && prev && !(prev.files && prev.files[key]) && !(ctx.acceptHost || []).includes(key)) {
      skipped.push({ file: key, reason: `a hook added to .githooks since the last install, so every call stays held: remove it, or the owner accepts it with install project --accept-host ${key}` });
      continue;
    }
    if (!extras.includes(key) && !isHost(key)) { if (files[key]) guarded[key] = files[key]; continue; }
    if (!fs.existsSync(file)) continue;
    host.push(key);
    // The first record (B16): with no record, "the kit never wrote this" came from the project stamp, which a branch
    // can edit in tracked mode and a script can edit in any. A file the kit ships, taken as the host's on that word
    // alone, holds every call until the owner accepts it (widened by the owner, 2026-11-11: whatever git tracks).
    // A file held this way stays in that state on later installs until one of its two ways out is taken (the 1.26.0
    // sweep: --force wrote the kit's copy and the hold stayed).
    // A file the kit ships is the host's only once the owner accepts it, on any install, not just the first (the 1.26.0
    // sweep: a guard file a later release adds, tracked by a branch first, was taken on a reinstall, C1; and a record
    // written before the owner had to accept kept its host entries, C10). The record keeps which keys the owner
    // accepted; a record with none of them holds each kit file it calls the host's until the owner accepts it.
    const ownerOk = ((prev && prev.ownerAccepted) || []).includes(key);
    const firstHold = !prev || !ownerOk || (prev.files && prev.files[key] === 'not yet accepted');
    if (firstHold && keys.includes(key) && !(ctx.acceptHost || []).includes(key)) {
      const now = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      if (files[key] && now === files[key]) {
        // The kit's own copy is there (install project --force put it back): it is the kit's file, not the host's.
        host.pop();
        guarded[key] = files[key];
        continue;
      }
      guarded[key] = 'not yet accepted';
      accepted[key] = [];
      skipped.push({ file: key, reason: `the kit ships this file and the project keeps its own, so every call stays held until the owner checks it: the owner accepts the project's file with install project --accept-host ${key}, or puts the kit's copy in its place with install project --force (that overwrites the project's file)` });
      continue;
    }
    const now = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const was = prev && prev.files && prev.files[key];
    const known = acceptedOf(key);
    if (was && !known.includes(now) && !(ctx.acceptHost || []).includes(key)) {
      guarded[key] = was;
      skipped.push({ file: key, reason: `the host's own hook changed since it was recorded, so every call stays held: restore it from git, or the owner accepts it with install project --accept-host ${key}` });
    } else guarded[key] = now;
    accepted[key] = [...new Set([...known, guarded[key]])];
  }
  const shims = Object.fromEntries([...GIT_HOOKS, ...OTHER_HOOKS].map((name) => [name, crypto.createHash('sha256').update(fs.readFileSync(path.join(hooks, name))).digest('hex')]));
  const ownerAccepted = [...new Set([...((prev && prev.ownerAccepted) || []), ...(ctx.acceptHost || [])])].filter((k) => host.includes(k)).sort();
  const record = { projectDir: proj, kitDir: toPosix(path.resolve(ctx.kit)), kitFingerprint: launch.kitFingerprint(ctx.kit), version: kitInfo.version, files: guarded, host, accepted, ownerAccepted, shims, hooksPath: null };
  fs.writeFileSync(path.join(dir, 'record.json'), JSON.stringify(record, null, 2) + '\n');
  // A record 1.25.1 kept under the long name has moved here (C2); the old folder and its shims go.
  const old = legacyGuardDir(ctx.home, ctx.projectDir);
  if (old) fs.rmSync(old, { recursive: true, force: true });
  return toPosix(hooks);
}

/** Whether a settings object still runs the project's guard.cjs itself, the way 1.25.0 wired it. */
export const runsProjectGuard = (s) => JSON.stringify(((s && s.hooks) || {}).PreToolUse || '').includes('.claude/guard.cjs');

/**
 * Take the old project-level guard entry out of .claude/settings.json and settings.local.json, keeping a backup and
 * every other line. A byte-order mark is read past (the second pass on 0772397: the parse failed and the entry stayed).
 *
 * Returns:
 *     the files that changed, relative to the project
 */
function dropProjectGuardEntry(projectDir, backupDir) {
  const changed = [];
  for (const name of ['settings.json', 'settings.local.json']) {
    const file = path.join(projectDir, '.claude', name);
    let s;
    try { s = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { continue; }
    if (!runsProjectGuard(s)) continue;
    const named = (h) => [h.command, ...(h.args || [])].join(' ').includes('.claude/guard.cjs');
    const kept = s.hooks.PreToolUse.map((e) => ({ ...e, hooks: (e.hooks || []).filter((h) => !named(h)) })).filter((e) => e.hooks.length);
    if (kept.length) s.hooks.PreToolUse = kept; else delete s.hooks.PreToolUse;
    fs.mkdirSync(path.join(backupDir, '.claude'), { recursive: true });
    fs.copyFileSync(file, path.join(backupDir, '.claude', name));
    fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
    changed.push(`.claude/${name}`);
  }
  return changed;
}

/** The node install user recorded in a Claude config folder, which the launcher entry names. */
const homeNode = (home) => { try { return JSON.parse(fs.readFileSync(path.join(home, STAMP_USER), 'utf8')).node || null; } catch { return null; } };

/** The guard faults status reports for a project: files changed outside install, hooks turned off, no launcher. */
function guardFaults(home, projectDir) {
  const rec = readRecord(home, projectDir);
  const faults = [];
  if (!rec) return [`no outside guard record in ${toPosix(path.join(home, 'kit-guard'))}`];
  // The same check the launcher runs before every call (B22): guard files, the shims, .githooks extras, links and the
  // hooks path, so status never calls current what the launcher holds.
  const v = launch.verify(path.resolve(projectDir), rec, [], path.join(guardDir(home, projectDir), 'hooks'));
  const changed = v.changed;
  if (changed.length) faults.push(`${changed.length} kit guard file(s) changed outside install: ${changed.join(', ')}`);
  if (v.hooksPath) faults.push(`core.hooksPath changed outside install (now ${v.hooksPath})`);
  for (const name of ['settings.json', 'settings.local.json']) {
    let text = null;
    try { text = fs.readFileSync(path.join(projectDir, '.claude', name), 'utf8'); } catch { continue; }
    const why = launch.settingsProblem(text);
    if (why) faults.push(`.claude/${name}: ${why}`);
  }
  let user = null;
  try { user = JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8').replace(/^\uFEFF/, '')); } catch { /* none */ }
  if (!launch.launcherWired(user, path.join(home, 'kit-tools', 'kit-launch.cjs'), homeNode(home))) faults.push('the guard launcher is not wired whole in the Claude config folder settings.json (run kit.mjs install user)');
  return faults;
}

/**
 * Wire the kit gate into the Claude config folder's own settings.json, once, keeping everything else in it. The
 * gate must run in every folder, including one with no kit files to carry a hook (the owner, 2026-10-31).
 *
 * Returns:
 *     'added', 'present', or a reason it was left alone
 */
function wireGate(home, dryRun) {
  const file = path.join(home, 'settings.json');
  let settings = {};
  if (fs.existsSync(file)) {
    try { settings = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return 'settings.json is not valid JSON, so the gate was not added: fix it and install again'; }
  }
  // V3 (1.25.1): the guard launcher runs on every tool from here, where a project file cannot reach it, and refuses a
  // settings change that would turn the hooks off mid-session.
  // The launcher starts from a shell line that clears NODE_OPTIONS and puts this node's folder first (the 1.25.1 sweep:
  // a settings env reaches every hook). An entry of an older form is replaced, never kept beside the new one.
  const launcher = path.join(home, 'kit-tools', 'kit-launch.cjs');
  const wants = [
    ['UserPromptSubmit', 'kit-gate.cjs', { hooks: [{ type: 'command', command: 'node', args: [toPosix(path.join(home, 'kit-hooks', 'kit-gate.cjs'))], timeout: 10 }] }],
    ['PreToolUse', 'kit-launch.cjs', { matcher: '.*', hooks: [{ type: 'command', command: launch.launchCommand(launcher, process.execPath), timeout: 10, onFailure: 'block' }] }],
    ['ConfigChange', 'kit-launch.cjs', { hooks: [{ type: 'command', command: launch.launchCommand(launcher, process.execPath, 'config-change'), timeout: 10 }] }],
  ];
  const before = JSON.stringify(settings);
  for (const [event, file, entry] of wants) {
    const named = (h) => [h.command, ...(h.args || [])].join(' ').includes(file);
    const list = ((settings.hooks ||= {})[event] ||= []);
    if (file === 'kit-gate.cjs') {
      if (!list.some((e) => (e.hooks || []).some(named))) list.push(entry);
      continue;
    }
    if (list.length === 1 && JSON.stringify(list[0]) === JSON.stringify(entry)) continue;
    settings.hooks[event] = [...list.filter((e) => !(e.hooks || []).some(named)), entry];
  }
  if (JSON.stringify(settings) === before) return 'present';
  if (!dryRun) {
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  }
  return 'added';
}

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
  const { entries, stampPath } = plan(ctx);
  // A release install copies only bytes that match the release tag (B20), and refuses when the release check found no
  // tree to match against (the 1.26.0 security review, S4): reading the folder then would trust whatever is there. A
  // fixture or --unreleased install has no release and reads the folder.
  const releaseRun = Boolean(ctx.release && ctx.release.release);
  if (releaseRun && !ctx.release.tree) throw new Error('Install refused: the release check found no tree for the release tag, so no kit file can be checked against it. Check out the release tag again, then rerun install.');
  const checked = releaseRun ? releaseBytes(ctx.kit, ctx.release.tree, [...entries, ...kitInputs(ctx.kit)]) : null;
  const kitInfo = loadKit(ctx.kit, checked);
  const stamp = readStamp(stampPath);
  const files = { ...stamp.files };
  // Which guard files are a host's own (the review of 670b3a2): read from the record outside the project, never from
  // the project's stamp, which a script can edit. A file the record holds as the kit's is always put back; one it does
  // not hold is the host's only when git tracks it.
  const prevRecord = ctx.target === 'project' && ctx.home ? readRecord(ctx.home, ctx.projectDir) : null;
  const gitTracks = (f) => spawnSync('git', ['-C', ctx.projectDir, ...NO_PROGRAMS, 'ls-files', '--error-unmatch', f], { encoding: 'utf8', cwd: SAFE_CWD }).status === 0;
  const isHost = (key) => ((prevRecord && prevRecord.host) || []).includes(key) || (prevRecord ? !(prevRecord.files && prevRecord.files[key]) && gitTracks(key) : !stamp.files[key] && gitTracks(key));
  const created = [], updated = [], replaced = [], skipped = [], merged = [];
  const hostOwned = new Set(stamp.hostOwned || []);
  const backupDir = path.join(path.dirname(stampPath), 'kit-backups', new Date().toISOString().replace(/[:.]/g, '-'));
  for (const entry of entries) {
    const want = renderEntry(kitInfo, entry, ctx.projectDir, ctx.home, checked);
    const wantHash = sha(want);
    const write = () => {
      if (ctx.dryRun) return;
      fs.mkdirSync(path.dirname(entry.dest), { recursive: true });
      fs.writeFileSync(entry.dest, want);
      // Git skips a hook without the execute bit on macOS and Linux (Windows ignores the bit).
      if (/(^|[\\/])\.githooks[\\/]/.test(entry.dest)) fs.chmodSync(entry.dest, 0o755);
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
    } else if (ctx.force || (ctx.target === 'project' && isGuarded(entry.key) && !isHost(entry.key))) {
      // A guard file the kit wrote and something else changed is put back (V3). One the kit never wrote (a host's own
      // tracked hook) is the host's: it is skipped below and recorded as it is (the 1.25.1 sweep).
      if (!ctx.dryRun) {
        const keep = path.join(backupDir, entry.key);
        fs.mkdirSync(path.dirname(keep), { recursive: true });
        fs.copyFileSync(entry.dest, keep);
      }
      write(); replaced.push(entry.key); files[entry.key] = wantHash;
    } else if ((ctx.merged || []).includes(entry.key)) {
      // The owner merged the kit's changes into this file by hand: its text now stands on the current kit copy.
      merged.push(entry.key); files[entry.key] = wantHash;
    } else {
      const reason = !base ? 'already exists and differs from the kit'
        : wantHash === base ? 'changed here - run fold-back'
        : 'changed here and in the kit - merge by hand';
      skipped.push({ file: entry.key, reason });
    }
  }
  // A team, client or open-source repo owns its CLAUDE.md. The kit then sits on top as an overlay: its CLAUDE.md goes
  // to a personal CLAUDE.local.md (Claude Code loads it by itself; keepKitLocal keeps it out of git), and the host
  // file is recorded as host-owned so no later check flags it. A tracked CLAUDE.md is taken as host-owned; an
  // untracked one of the owner's own is skipped unless install runs with --overlay.
  const claudeEntry = ctx.target === 'project' && skipped.find((s) => s.file === 'CLAUDE.md' && !stamp.files['CLAUDE.md']);
  const tracked = (f) => spawnSync('git', ['-C', ctx.projectDir, ...NO_PROGRAMS, 'ls-files', '--error-unmatch', f], { encoding: 'utf8', cwd: SAFE_CWD }).status === 0;
  if (claudeEntry && (hostOwned.has('CLAUDE.md') || ctx.overlay || tracked('CLAUDE.md'))) {
    skipped.splice(skipped.indexOf(claudeEntry), 1);
    hostOwned.add('CLAUDE.md');
    // The overlay imports AGENTS.md; a host-owned one would load the host's text in place of the kit's core rules.
    const agents = skipped.find((s) => s.file === 'AGENTS.md' && !stamp.files['AGENTS.md']);
    if (agents) agents.reason += "; CLAUDE.local.md imports it, so the kit's core rules are not loaded here - give them a home by hand";
    const local = path.join(ctx.projectDir, 'CLAUDE.local.md');
    const kitClaude = renderEntry(kitInfo, entries.find((e) => e.key === 'CLAUDE.md'), ctx.projectDir, ctx.home, checked);
    const text = [
      '<!-- The methodology kit\'s overlay (install --overlay); kept out of git. -->',
      '> **Kit overlay.** The CLAUDE.md here is owned by the host repo, and it wins any conflict with the kit rules',
      '> below. These rules load only on this machine: never copy them into the host\'s files. Name each sweep tier at',
      '> plan approval with the host project\'s budget in view (rule:sweep-tiers); a lighter tier than the rule gives is',
      '> the owner\'s call.',
      '',
      kitClaude,
    ].join('\n');
    const had = fs.existsSync(local) ? sha(fs.readFileSync(local, 'utf8')) : null;
    if (!had || (had === stamp.files['CLAUDE.local.md'] && had !== sha(text))) {
      if (!ctx.dryRun) fs.writeFileSync(local, text);
      (had ? updated : created).push('CLAUDE.local.md');
      files['CLAUDE.local.md'] = sha(text);
    } else if (had !== sha(text) && had !== stamp.files['CLAUDE.local.md']) {
      skipped.push({ file: 'CLAUDE.local.md', reason: 'changed here - merge the kit\'s CLAUDE.md into it by hand' });
    }
  } else if (claudeEntry) {
    claudeEntry.reason += '; if another repo or team owns this file, run install with --overlay';
  }
  // Retired files: only ones this kit installed (they are in the stamp) and the owner left as installed are
  // removed, after a backup. A changed copy holds the owner's work, so it stays and is reported.
  const retired = [];
  const { memoryDir } = plan(ctx);
  // The config lists retired files, or maps each to the file or files that replace or need it; a retired file waits
  // until those are in place, or the project would lose the rules both hold.
  const retiredList = (kitInfo.config.retired || {})[ctx.target] || [];
  const replacedBy = Array.isArray(retiredList) ? {} : retiredList;
  const retiredKeys = Array.isArray(retiredList) ? retiredList : Object.keys(retiredList);
  // Files only an unreleased build installed go the same way, so a reinstall from a release leaves only the release.
  const planned = new Set(entries.map((e) => e.key));
  const branchOnly = stamp.release !== false ? [] : Object.keys(stamp.files)
    .filter((k) => !planned.has(k) && !retiredKeys.includes(k) && k !== 'CLAUDE.local.md');
  const leftover = [];
  for (const key of [...retiredKeys, ...branchOnly]) {
    const base = stamp.files[key];
    const heir = [].concat(replacedBy[key] || []).find((h) => skipped.some((s) => s.file === h));
    const dest = key.startsWith('memory/') && memoryDir ? path.join(memoryDir, key.slice(7))
      : path.join(ctx.target === 'user' ? ctx.home : ctx.projectDir, key);
    if (heir && base && fs.existsSync(dest)) {
      skipped.push({ file: key, reason: `retired by the kit, but kept while ${heir} is skipped: merge ${heir}, then remove this file by hand` });
      continue;
    }
    if (!base || !fs.existsSync(dest)) { if (!fs.existsSync(dest)) delete files[key]; continue; }
    if (sha(fs.readFileSync(dest, 'utf8')) !== base) {
      if (branchOnly.includes(key)) {
        skipped.push({ file: key, reason: 'only an unreleased build installed it, and it changed here - keep what you need, then remove it by hand' });
        leftover.push(key);
      } else skipped.push({ file: key, reason: 'retired by the kit, but changed here - run fold-back, then remove it by hand' });
      continue;
    }
    if (!ctx.dryRun) {
      const keep = path.join(backupDir, key);
      fs.mkdirSync(path.dirname(keep), { recursive: true });
      fs.copyFileSync(dest, keep);
      fs.rmSync(dest);
    }
    retired.push(key);
    delete files[key];
  }
  if (!ctx.dryRun) {
    fs.mkdirSync(path.dirname(stampPath), { recursive: true });
    const out = { version: kitInfo.version, commit: kitInfo.commit, kitDir: toPosix(path.resolve(ctx.kit)), kitFingerprint: launch.kitFingerprint(ctx.kit), installedAt: new Date().toISOString(), files };
    if (hostOwned.size) out.hostOwned = [...hostOwned].sort();
    // The node the launcher entry names (V3): kept here so status and the launcher can check the entry is the one written.
    if (ctx.target === 'user') out.node = toPosix(process.execPath);
    // Set by the CLI's release check; a stamp without it predates the check and reads as unknown, not unreleased.
    if (ctx.release) {
      // A kept branch-only file means the folder still holds more than the release.
      out.release = ctx.release.release && !leftover.length;
      out.describe = ctx.release.describe;
      if ((ctx.release.dirty || []).length) out.dirty = ctx.release.dirty;
      if (leftover.length) out.leftover = leftover;
    }
    fs.writeFileSync(stampPath, JSON.stringify(out, null, 2) + '\n');
    if (ctx.target === 'user') {
      const gate = wireGate(ctx.home, ctx.dryRun);
      if (gate !== 'added' && gate !== 'present') skipped.push({ file: 'settings.json', reason: gate });
      // Every recorded project gets this release's shims now, not at its next install project (the 1.26.0 sweep, C9).
      let names = [];
      try { names = fs.readdirSync(path.join(ctx.home, 'kit-guard')); } catch { /* no project recorded */ }
      for (const n of names) {
        const recFile = path.join(ctx.home, 'kit-guard', n, 'record.json');
        let rec = null;
        try { rec = JSON.parse(fs.readFileSync(recFile, 'utf8')); } catch { continue; }
        if (!rec || !rec.projectDir || !rec.shims || !fs.existsSync(rec.projectDir)) continue;
        // The shims run a hook from the launcher's checked copy, and only a first-push-check that reads its project
        // from KIT_HOOK_PROJECT can run there (the 1.27.0 sweep): a project still on an older kit keeps its shims,
        // and is named, until install project brings its hooks up to this release. Only the file the record accepted
        // counts as the older kit (the security review of this fix): an edited one gets the new shims, and the
        // launcher holds it anyway.
        let fpc = null;
        try { fpc = fs.readFileSync(path.join(rec.projectDir, '.claude', 'first-push-check.mjs')); } catch { /* none */ }
        const recorded = fpc && (rec.files || {})['.claude/first-push-check.mjs'] === crypto.createHash('sha256').update(fpc).digest('hex');
        if (recorded && !fpc.toString('utf8').includes('process.env.KIT_HOOK_PROJECT')) {
          skipped.push({ file: `kit-guard/${n}`, reason: `${toPosix(path.resolve(rec.projectDir))} runs an older kit, so its git hook shims stay as they are; run install project there to bring them up to this release` });
          continue;
        }
        rec.shims = writeShims(ctx.home, path.join(ctx.home, 'kit-guard', n, 'hooks'), toPosix(path.resolve(rec.projectDir)));
        fs.writeFileSync(recFile, JSON.stringify(rec, null, 2) + '\n');
      }
    }
    if (ctx.target === 'project') {
      const keys = entries.map((e) => e.key);
      const guards = keys.some(isGuarded);
      // A settings.json the owner changed keeps the PreToolUse entry that ran .claude/guard.cjs straight from the
      // project, which V3 takes away: it comes out here, with a backup, and the owner's other changes stay.
      for (const f of dropProjectGuardEntry(ctx.projectDir, backupDir)) replaced.push(`${f} (the old guard entry)`);
      // The project's guards run only through the launcher in the Claude config folder (V3). Without it the shims could
      // not run, so the hooks stay on the project's own .githooks until install user has run.
      const launcher = fs.existsSync(path.join(ctx.home, 'kit-tools', 'kit-launch.cjs'));
      const shims = guards ? writeGuardRecord(ctx, kitInfo, files, keys, prevRecord, isHost, skipped) : null;
      const hooksPath = keepKitLocal(ctx.projectDir, Object.keys(files).filter((k) => !k.startsWith('memory/')), [...hostOwned], launcher ? shims : null);
      if (shims && hooksPath === shims) {
        const recFile = path.join(guardDir(ctx.home, ctx.projectDir), 'record.json');
        fs.writeFileSync(recFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(recFile, 'utf8')), hooksPath: shims }, null, 2) + '\n');
      }
      let user = null;
      try { user = JSON.parse(fs.readFileSync(path.join(ctx.home, 'settings.json'), 'utf8')); } catch { /* none */ }
      if (guards && (!launcher || !launch.launcherWired(user, path.join(ctx.home, 'kit-tools', 'kit-launch.cjs'), homeNode(ctx.home)))) {
        skipped.push({ file: 'guard launcher', reason: `not wired in ${toPosix(path.join(ctx.home, 'settings.json'))}, so no guard runs here: run kit.mjs install user, then install project again` });
      }
    }
  }
  return { created, updated, replaced, retired, skipped, merged, hostOwned: [...hostOwned].sort(), backupDir: replaced.length || retired.length ? backupDir : null, version: kitInfo.version };
}

/**
 * Keep the kit out of git (rule:kit-stays-local): a marked block in the repo's own exclude file lists every kit
 * path. The exclude file is never pushed, so even the list stays private. A reinstall replaces the block and keeps
 * the owner's own lines; `"kit": "tracked"` in .kit/tracking.json removes it. A folder without git is left alone.
 *
 * Args:
 *     projectDir: the project folder
 *     keys: the installed kit paths, relative to the project folder
 */
function keepKitLocal(projectDir, keys, hostOwned = [], shims = null) {
  const git = (...a) => spawnSync('git', ['-C', projectDir, ...NO_PROGRAMS, ...a], { encoding: 'utf8', cwd: SAFE_CWD });
  const common = git('rev-parse', '--path-format=absolute', '--git-common-dir');
  if (common.status !== 0) return null;
  const prefix = git('rev-parse', '--show-prefix').stdout.trim();
  const file = path.join(common.stdout.trim(), 'info', 'exclude');
  const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const own = old.replace(/\n?# kit:begin[\s\S]*?# kit:end\n?/g, '\n').replace(/^\n+/, '');
  const tracking = path.join(projectDir, '.kit', 'tracking.json');
  const cfg = fs.existsSync(tracking) ? JSON.parse(fs.readFileSync(tracking, 'utf8')) : {};
  // Anchored to the repo root; glob and comment characters in a name are escaped so each line names one path.
  const line = (p) => '/' + (prefix + p).replace(/[\\*?[\]!#]/g, (c) => '\\' + c);
  // The never list is the owner's own globs, kept here too so it stays private (a .gitignore is pushed).
  // Only the folder prefix is escaped; git drops trailing spaces from a pattern, so they are trimmed to match.
  const neverLines = (cfg.never || []).map((p) => line('') + p.trim().replace(/^\/+/, ''));
  // The local files the kit tells the owner to create (CLAUDE.local.md, .claude/*.local.json) are kept out too.
  // The kit's own CLAUDE.md and the personal local files never go public, even when the owner tracks the kit (the
  // owner, 2026-10-31); a host-owned CLAUDE.md is the host's to track.
  const privateKeys = ['CLAUDE.local.md', ...(keys.includes('CLAUDE.md') && !hostOwned.includes('CLAUDE.md') ? ['CLAUDE.md'] : [])];
  const privateLines = [...privateKeys.map(line), line('') + '.claude/*.local.json'];
  const kitLines = cfg.kit === 'tracked' ? privateLines
    : [...new Set([...keys, '.kit/', '.claude/worktrees/', ...privateKeys])].sort().map(line).concat(line('') + '.claude/*.local.json');
  const block = kitLines.length + neverLines.length ? ['# kit:begin - kept local by the methodology kit (rule:kit-stays-local); install rewrites this block',
    ...kitLines, ...neverLines, '# kit:end'].join('\n') + '\n' : '';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, (own.trimEnd() ? own.trimEnd() + '\n' : '') + block);
  // The kit's git hooks hold the line for any tool (the commit check, the push guard, the first push gate). Another
  // hook manager already set stays; the setup says to add the kit's checks to it.
  // Absolute, so an agent worktree (which has no .githooks of its own: kit files stay untracked) runs the main
  // checkout's hooks too. Since V3 (1.25.1) it names the shims outside the project, which check the guard files before
  // the project's hook runs; the values earlier installs set (.githooks, relative or absolute) are upgraded.
  const hooksNow = git('config', 'core.hooksPath').stdout.trim();
  const kitValues = ['', `${prefix}.githooks`, toPosix(path.join(path.resolve(projectDir), '.githooks'))];
  if (shims && /\/kit-guard\/[^/]+\/hooks$/.test(toPosix(hooksNow))) kitValues.push(toPosix(hooksNow));
  const want = shims || toPosix(path.join(path.resolve(projectDir), '.githooks'));
  if (kitValues.includes(toPosix(hooksNow))) git('config', 'core.hooksPath', want);
  const hooksPath = toPosix(git('config', 'core.hooksPath').stdout.trim());
  // A project whose own first commits are already on a remote had its first push before the kit came: the gate is
  // done. Sharing history is not enough: a host-made README pulled in shares history while nothing of ours is out.
  const hasRemote = git('for-each-ref', '--count=1', 'refs/remotes/').stdout.trim();
  const head = git('rev-parse', '-q', '--verify', 'HEAD').stdout.trim();
  if (hasRemote && head && !git('rev-list', '--max-parents=0', 'HEAD', '--not', '--remotes').stdout.trim()) {
    fs.writeFileSync(path.join(common.stdout.trim(), 'kit-first-push-done'), '');
  }
  return hooksPath;
}

function diffText(a, b) {
  return kitTemp.withTemp('kitdiff-', (tmp) => {
    const fa = path.join(tmp, 'kit'), fb = path.join(tmp, 'here');
    fs.writeFileSync(fa, a); fs.writeFileSync(fb, b);
    const r = spawnSync('git', ['diff', '--no-index', '--no-color', '--', fa, fb], { encoding: 'utf8' });
    return (r.stdout || '').split('\n').slice(4).join('\n');
  });
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
/**
 * Compare a project's old single standards file with the kit's rule modules, section by section. Sections are
 * matched by heading title (IDs and trailing spaces ignored); each section is its own lines up to the next heading.
 *
 * Returns:
 *     { changed: [{ id, module, title }], projectOnly: [title] }
 */
function oldLayoutFoldBack(kit, oldText) {
  const sectionsOf = (text) => {
    const lines = text.split('\n');
    const hs = headings(text);
    return hs.map((h, i) => ({ ...h, text: lines.slice(h.line, i + 1 < hs.length ? hs[i + 1].line - 1 : lines.length)
      .map((l) => l.trimEnd()).join('\n').trim() }));
  };
  const kitRules = new Map();
  const dir = path.join(kit, 'rules');
  for (const n of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const { meta, body } = parseModule(fs.readFileSync(path.join(dir, n), 'utf8'));
    for (const s of sectionsOf(body)) kitRules.set(s.title, { ...s, module: meta.id });
  }
  const changed = [], projectOnly = [];
  for (const s of sectionsOf(oldText)) {
    const k = kitRules.get(s.title);
    if (!k) projectOnly.push(s.title);
    else if (k.text !== s.text) changed.push({ id: k.id, module: k.module, title: s.title });
  }
  return { changed, projectOnly };
}

export function foldBack(ctx) {
  const kitInfo = loadKit(ctx.kit);
  const { entries, stampPath, memoryDir } = plan(ctx);
  const stamp = readStamp(stampPath);
  const out = { foldBack: [], update: [], conflict: [], added: [], missing: [], guarded: [] };
  const diffs = [];
  for (const entry of entries) {
    // A host-owned file (rule:kit-stays-local, overlay) is the host repo's, never a kit file to fold back.
    if ((stamp.hostOwned || []).includes(entry.key)) continue;
    const want = renderEntry(kitInfo, entry, ctx.projectDir, ctx.home);
    const base = stamp.files[entry.key];
    if (!fs.existsSync(entry.dest)) { if (base) out.missing.push(entry.key); continue; }
    const curText = fs.readFileSync(entry.dest, 'utf8');
    const cur = sha(curText), wantHash = sha(want);
    if (cur === wantHash) continue;
    // A guard file that differs is never the project's own work to fold back: install puts the kit's copy back (V3).
    if (ctx.target === 'project' && isGuarded(entry.key)) {
      out.guarded.push(entry.key);
      diffs.push(`### ${entry.key} (guard file, changed outside install)\n\n\`\`\`diff\n${diffText(want, curText)}\n\`\`\`\n`);
      continue;
    }
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
  // A project still on the old layout (one standards file) folds back section by section.
  const oldFile = ctx.target === 'project' ? path.join(ctx.projectDir, '_Working Standards.md') : null;
  const oldParts = [];
  if (oldFile && fs.existsSync(oldFile) && fs.existsSync(path.join(ctx.kit, 'rules'))) {
    out.oldLayout = oldLayoutFoldBack(ctx.kit, fs.readFileSync(oldFile, 'utf8'));
    oldParts.push(list('Old single standards file: sections changed here', out.oldLayout.changed.map((c) => `rule:${c.id} (${c.module}): ${c.title}`)),
      list('Old single standards file: sections the kit does not have', out.oldLayout.projectOnly));
  }
  out.report = [
    `# Fold-back report: ${where}`,
    `Kit ${kitInfo.version}; installed here at ${stamp.version || 'never'}.`,
    list('Fold back: changed here, a candidate for the kit', out.foldBack),
    list('Update: the kit moved on, run install to pull it', out.update),
    list('Conflict: merge by hand', out.conflict),
    list('New here: the kit has never seen these', out.added),
    list('Missing here: installed once, now deleted', out.missing),
    list('Guard files changed outside install: run install project to put the kit\'s copies back', out.guarded),
    ...oldParts,
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
    const copied = [];
    for (const skill of group.skills) {
      const from = path.join(home, 'skills', skill);
      // A skill on standby is not on this machine; its vendor copy is the only one left, so it stays.
      if (!fs.existsSync(from)) {
        out.missing.push(skill);
        if (fs.existsSync(path.join(dest, skill))) copied.push(skill);
        continue;
      }
      fs.rmSync(path.join(dest, skill), { recursive: true, force: true });
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

// The guards' onFailure "block" (a guard that crashes or times out stops the command) needs this Claude Code; an
// older one ignores the key, and the command runs.
const ON_FAILURE_MIN = '2.1.295';
let claudeVersionRead;
// One read per process: `claude --version`, or null where Claude Code is not on the PATH (CI, a cloud thread).
export function installedClaudeVersion() {
  if (claudeVersionRead === undefined) {
    // cmd looks in the current folder before the PATH, and session start runs in the project: from the home folder,
    // with that search turned off, only a claude on the PATH runs.
    const r = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 8000, shell: process.platform === 'win32', cwd: os.homedir(), env: { ...process.env, NoDefaultCurrentDirectoryInExePath: '1' } });
    claudeVersionRead = r.status === 0 ? r.stdout : null;
  }
  return claudeVersionRead;
}

/** The line to give when Claude Code is too old for onFailure, or '' when it is new enough or cannot be read. */
function claudeCodeTooOld(text) {
  const m = /(\d+\.\d+\.\d+)/.exec(String(text ?? ''));
  if (!m || !semverAbove(ON_FAILURE_MIN, m[1])) return '';
  return `Claude Code ${m[1]} is older than ${ON_FAILURE_MIN}: a guard that crashes or times out lets the command run. Run claude update.`;
}

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
export function sessionStartReport({ kit, home, projectDir, source, claudeVersion = installedClaudeVersion }) {
  const lines = [];
  const old = claudeCodeTooOld(claudeVersion());
  if (old) lines.push(old);
  // The orientation rule sits in a module, not the core, so after a compact it may not be in context yet.
  if (source === 'compact') lines.push('After a compact: run rule:post-compact-orientation first (standards/INDEX.md names its file) - fresh reads of the Reading Order before any edit.');
  const ahead = remoteKitAhead(kit);
  if (ahead > 0) lines.push(`The kit on GitHub is ${ahead} commit(s) ahead of the kit folder. Check out its newest release tag (${releaseCheckout(kit, newestTag(kit))}), then run /methodology-kit update.`);
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
  // Said every session, so an install made on purpose with --unreleased is never forgotten; ~/.claude carries the
  // rules of every project, so it is named too.
  const checkout = `Check out the kit's newest release tag (${releaseCheckout(kit, newestTag(kit))})`;
  const userStamp = readStamp(path.join(home, STAMP_USER));
  if (userStamp.release === false) lines.push(`~/.claude runs an unreleased kit build (${userStamp.describe || 'no git history'}). ${checkout}, then run node "${toPosix(kit)}/scripts/kit.mjs" install user.`);
  if (stamp.release === false) lines.push(`This project runs an unreleased kit build (${stamp.describe || 'no git history'}). ${checkout}, then run /methodology-kit update.`);
  if (stamp.version) {
    const r = foldBack({ kit, home, target: 'project', projectDir });
    // Only a file changed here and in the kit owes work; one changed only here holds the project's own values.
    const held = r.conflict.filter((k) => !k.startsWith('memory/'));
    if (held.length) lines.push(`${held.length} kit file(s) changed here and in the kit: ${held.join(', ')}. Merge the kit's changes by hand, then record it with kit.mjs install project <folder> --merged <file>,<file>.`);
  }
  const catalogPath = path.join(projectDir, '.claude', 'kit', 'skill-cases.json');
  const localPath = path.join(projectDir, '.claude', 'skill-cases.local.json');
  if (fs.existsSync(catalogPath)) {
    const { cases } = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    const on = fs.existsSync(localPath) ? JSON.parse(fs.readFileSync(localPath, 'utf8')).on || [] : null;
    if (!on) {
      lines.push(`No skill cases chosen yet for this project. Ask the owner which apply (${cases.map((c) => c.id).join(', ')}) and record them in .claude/skill-cases.local.json.`);
      const hint = suggestCases(projectDir).filter((id) => cases.some((c) => c.id === id));
      if (hint.length) lines.push(`Suggested from this repo: ${hint.join(', ')}. On the owner's yes, write ${JSON.stringify({ on: hint })} to .claude/skill-cases.local.json.`);
    } else {
      const active = cases.filter((c) => on.includes(c.id));
      if (active.length) {
        lines.push('Skills by case for this project - load at most two per unit of work, keep design-time, motion and review-time sets apart, and read a community skill before its first use:');
        for (const c of active) lines.push(`- ${c.name} (${c.when}): ${c.skills.join(', ')}`);
      }
      // A rarely used plugin stays off globally (its skill list costs context in every session) and is
      // switched on only in the projects whose cases need it.
      for (const c of active.filter((x) => x.plugin && !pluginEnabled(projectDir, home, x.plugin))) {
        lines.push(`Standby plugin ${c.plugin} (${c.name}) is off here. To switch it on for this project only, add "enabledPlugins": { "${c.plugin}": true } to .claude/settings.local.json, then start a fresh session.`);
      }
    }
  }
  return lines.join('\n');
}

/**
 * Whether main has a branch rule on GitHub, read with gh (rule:first-push-gate, "Protect main").
 *
 * Returns:
 *     'protected', 'unprotected', or null when it cannot tell (no GitHub remote, no gh, no access)
 */
export function mainProtection(projectDir, gh = (args) => spawnSync('gh', args, { cwd: projectDir, encoding: 'utf8', timeout: 8000 })) {
  const r = gh(['api', 'repos/{owner}/{repo}/branches/main/protection']);
  if (r.error) return null;
  if (r.status === 0) return 'protected';
  if (!/Branch not protected/i.test(`${r.stdout}${r.stderr}`)) return null;
  // A ruleset protects a branch with no classic protection: GitHub answers 404 for the one and lists the other.
  const rules = gh(['api', 'repos/{owner}/{repo}/rules/branches/main']);
  if (rules.error || rules.status !== 0) return null;
  let list = null;
  try { list = JSON.parse(rules.stdout); } catch { return null; } // an answer that is not JSON tells nothing
  return Array.isArray(list) && list.length > 0 ? 'protected' : 'unprotected';
}

/**
 * The on-demand version check: the kit folder against GitHub, and ~/.claude and the project against the
 * kit folder, file by file. A matching version number is not enough - a file the owner changed, or one
 * the kit changed since the install, also counts. It only reads.
 *
 * Args:
 *     ctx: { kit, home, projectDir, ahead } - ahead(kit) counts GitHub commits past the kit folder
 *
 * Returns:
 *     { current, text } - current is true only when every line matches
 */
export function status({ kit, home, projectDir, ahead = remoteKitAhead, protection = mainProtection, newest = newestTag, inodes = () => kitTemp.inodeUse(os.tmpdir()), claudeVersion = installedClaudeVersion }) {
  const { version, commit } = loadKit(kit);
  const lines = [`Kit folder: ${version}${commit ? ` (${commit})` : ''}.`, `Claude config folder: ${toPosix(home)}.`];
  const gaps = [];
  const old = claudeCodeTooOld(claudeVersion());
  if (old) {
    lines.push(old);
    gaps.push(`Claude Code is older than ${ON_FAILURE_MIN}`);
  }
  const n = ahead(kit);
  if (n > 0) {
    lines.push(`    GitHub has ${n} newer kit commit(s): check out its newest release tag (${releaseCheckout(kit, newest(kit))}), then update both below.`);
    gaps.push('the kit folder is behind GitHub');
  }
  const where = [
    { name: '~/.claude', target: 'user', stampPath: path.join(home, STAMP_USER), fix: `node ${toPosix(kit)}/scripts/kit.mjs install user` },
    { name: 'This project', target: 'project', stampPath: path.join(projectDir, STAMP_PROJECT), fix: '/methodology-kit update' },
  ];
  for (const w of where) {
    const stamp = readStamp(w.stampPath);
    if (!stamp.version) {
      lines.push(`${w.name}: no kit install record.`);
      gaps.push(`${w.name} has no install`);
      continue;
    }
    const r = foldBack({ kit, home, target: w.target, projectDir });
    // A file changed only here carries the project's own values on the current kit copy (normal use); a file changed
    // here and in the kit owes a hand merge.
    const own = r.foldBack.filter((k) => !k.startsWith('memory/'));
    const held = r.conflict.filter((k) => !k.startsWith('memory/'));
    const waiting = r.update.length + r.missing.length;
    const unreleased = unreleasedText(stamp);
    const parts = [unreleased || (semverAbove(version, stamp.version) ? `behind kit ${version}` : 'current')];
    if (waiting) parts.push(`${waiting} file(s) waiting`);
    const ok = parts[0] === 'current' && !waiting && !held.length;
    const fix = unreleased ? ` Check out the kit's newest release tag (${releaseCheckout(kit, newest(kit))}), then run ${w.fix}.` : ` Run ${w.fix}.`;
    lines.push(`${w.name}: ${stamp.version}, ${parts.join('; ')}.${ok ? '' : fix}`);
    if (held.length) lines.push(`    ${held.length} file(s) changed here and in the kit: ${held.join(', ')}. Merge the kit's changes by hand, then record it with kit.mjs install ${w.target === 'user' ? 'user' : 'project <folder>'} --merged <file>,<file>.`);
    if (own.length) lines.push(`    ${own.length} file(s) carry this project's own values on the current kit copy: ${own.join(', ')}. Not a gap; fold-back offers any that are portable.`);
    if (!ok) gaps.push(unreleased ? `${w.name} is an unreleased build` : `${w.name} differs from the kit`);
    // V3: read against the record outside the project, which a branch, a patch or a project script cannot rewrite.
    // Only a project whose install has guard files (a fixture or a docs-only kit has none).
    if (w.target === 'project' && Object.keys(stamp.files).some(isGuarded)) {
      for (const f of guardFaults(home, projectDir)) {
        lines.push(`    Guard fault: ${f}. Run node ${toPosix(kit)}/scripts/kit.mjs install project "${toPosix(path.resolve(projectDir))}"${/disableAllHooks/.test(f) ? ' after the owner takes the key out' : ''}.`);
        gaps.push(f);
      }
    }
  }
  // Improvement reports still open here are work for the kit, not a stale install, so they do not change the verdict.
  const reportDir = path.join(projectDir, '.kit', 'reports');
  const open = fs.existsSync(reportDir) ? fs.readdirSync(reportDir).filter((f) => /^IR-.*\.md$/.test(f)).sort()
    .filter((f) => !/^\| Status \| (closed|declined) \|/m.test(fs.readFileSync(path.join(reportDir, f), 'utf8'))) : [];
  if (protection(projectDir) === 'unprotected') lines.push('main is not protected on GitHub: run the "Protect main" step of rule:first-push-gate (an outward act; the owner says go).');
  if (open.length) lines.push(`${open.length} improvement report(s) open: ${open.join(', ')}. Hand filed ones to the kit.`);
  // A full inode table stops every shell on the disk (the Cowork VM, 2026-11-05); disk room is not an install fault.
  const disk = inodes();
  if (disk.level === 'warn' || disk.level === 'refuse') lines.push(`Temp disk: ${disk.text}. Test runs refuse above ${kitTemp.REFUSE_PCT}%: clear old temp folders.`);
  // The real load is a budget, not an install fault, so it does not change the verdict.
  const cap = (loadKit(kit).config.caps || {}).realLoad;
  if (cap) {
    const { parts, total } = measureReal({ projectDir, home });
    const n = (x) => x.toLocaleString('en-US');
    lines.push(`Real start load: ${n(total)} B of ${n(cap)} (project ${n(parts.project)}, memory index ${n(parts.memoryIndex)}, global CLAUDE.md ${n(parts.globalClaude)}, skill listings ${n(parts.userSkills + parts.plugins)}).${total > cap ? ' Over its cap: trim per rule:kit-standards item 14.' : ''}`);
    if (parts.memoryIndex > 6000) lines.push(`Memory index is ${n(parts.memoryIndex)} B (over 6,000): turn copied rules into one-line pointers (rule:kit-standards items 3 and 14).`);
  }
  // E32: the project's test lanes; over budget is a finding, never an install fault. The kit's own copy of the script
  // runs, never the project's, so status runs no code a branch of the project could have changed.
  const lanes = path.join(kit, 'project', '.claude', 'lane-state.mjs');
  if (projectDir && fs.existsSync(path.join(projectDir, '.claude', 'lane-state.mjs')) && fs.existsSync(lanes)) {
    const r = spawnSync(process.execPath, [lanes], { cwd: projectDir, encoding: 'utf8' });
    const first = String(r.stdout || '').trim().split('\n')[0];
    if (first) lines.push(`${first}${r.status === 1 ? ' - a finding: walk the lever order (rule:test-lanes).' : ''}`);
  }
  // T14: a part not present or wired is an install fault; its first line names the part.
  const use = useCheck(kit, projectDir, home);
  if (use) {
    lines.push(use.text.split('\n')[0]);
    if (use.code !== 0) gaps.push('the use check fails (run kit.mjs install project, or opt the part out in .kit/parts.json)');
  }
  const current = gaps.length === 0;
  lines.push(current ? `Current: everything matches kit ${version}.` : `Not current: ${gaps.join('; ')}.`);
  return { current, text: lines.join('\n') };
}

/** The use check (T14) from the kit's own copy, run in a project that has it installed; null where it does not. */
function useCheck(kit, projectDir, home) {
  const script = path.join(kit, 'project', '.claude', 'use-check.mjs');
  if (!projectDir || !fs.existsSync(path.join(projectDir, '.claude', 'use-check.mjs')) || !fs.existsSync(script)) return null;
  const r = spawnSync(process.execPath, [script], { cwd: projectDir, encoding: 'utf8', env: home ? { ...process.env, KIT_CLAUDE_HOME: path.resolve(home) } : process.env });
  return { code: r.status, text: String(r.stdout || r.stderr || '').trim() || 'Use check: no output' };
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
  else if (vault.committed) lines.push(`Vault backup: ${vault.changed.length} file(s) changed, committed in ${vault.dir}. Push on the owner's yes.`);
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
 * Place each rule heading of a standards file in its module, from a module map (## sections are mapped;
 * ### subsections go with their parent). The ledger is the record that every rule has one new home.
 *
 * Args:
 *     text: the standards file's text
 *     map: { modules: [{ id, sections: [## section IDs] }] }
 *
 * Returns:
 *     [{ id, title, level, module, lines }] with a `preamble` property: the line count before the first heading
 */
export function ledger(text, map) {
  const owner = new Map();
  for (const m of map.modules) for (const s of m.sections) owner.set(s, m.id);
  const hs = headings(text);
  const known = new Set(hs.filter((h) => h.level === 2).map((h) => h.id));
  for (const s of owner.keys()) if (!known.has(s)) throw new Error(`no such section: ${s}`);
  const total = text.split('\n').length;
  let parent = null;
  const rows = hs.map((h, i) => {
    if (h.level === 2) {
      if (!owner.has(h.id)) throw new Error(`not placed: ${h.id}`);
      parent = owner.get(h.id);
    }
    const end = i + 1 < hs.length ? hs[i + 1].line : total + 1;
    return { id: h.id, title: h.title, level: h.level, module: parent, lines: end - h.line };
  });
  rows.preamble = hs.length ? hs[0].line - 1 : total;
  return rows;
}

/**
 * Split a rule module into its frontmatter and its body. Frontmatter: id, load, when, a `paths` list, and a
 * `tags` block of `  <rule id>: word, word` lines - the other words people use for that rule, for search.
 */
export function parseModule(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error('rule module has no frontmatter');
  const meta = { paths: [], tags: {} };
  for (const line of m[1].split('\n')) {
    const item = line.match(/^\s+- "(.*)"$/);
    if (item) { meta.paths.push(item[1]); continue; }
    const tag = line.match(/^\s+([a-z0-9-]+):\s*(.+)$/);
    if (tag) { meta.tags[tag[1]] = tag[2].split(',').map((w) => w.trim()).filter(Boolean); continue; }
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv && kv[2]) meta[kv[1]] = kv[2];
  }
  return { meta, body: text.slice(m[0].length).replace(/^\n/, '') };
}

/**
 * Write Claude Code's files from the tool-neutral rule sources in rules/. The core becomes AGENTS.md (which
 * CLAUDE.md imports, and which other AI tools read on their own), with an index of the modules. Modules that
 * load by file pattern go to .claude/rules with a paths field; the rest go to standards/, read on demand.
 * standards/INDEX.md lists every rule ID and its file, which is how a `rule:<id>` pointer is looked up.
 *
 * Args:
 *     ctx: { kit }
 *
 * Returns:
 *     Map of kit-relative output path -> text
 */
/**
 * Turn on the kit source's own commit-message hook, once per clone: the kit source installs no kit, so nothing else
 * checks its commit messages before CI does. A hooks path the owner set is left alone.
 *
 * Returns:
 *     'set', 'present', or why it was left alone
 */
export function sourceHooks(kit) {
  if (!fs.existsSync(path.join(kit, '.githooks', 'commit-msg'))) return 'no .githooks/commit-msg';
  const now = spawnSync('git', ['-C', kit, 'config', 'core.hooksPath'], { encoding: 'utf8' }).stdout.trim();
  if (now === '.githooks') return 'present';
  if (now) return `core.hooksPath is ${now}: left alone`;
  return spawnSync('git', ['-C', kit, 'config', 'core.hooksPath', '.githooks']).status === 0 ? 'set' : 'not a git repository';
}

export function build({ kit }) {
  const dir = path.join(kit, 'rules');
  const mods = fs.readdirSync(dir).filter((n) => n.endsWith('.md')).sort()
    .map((n) => ({ src: `rules/${n}`, ...parseModule(fs.readFileSync(path.join(dir, n), 'utf8')) }));
  const core = mods.find((m) => m.meta.id === 'core');
  const rest = mods.filter((m) => m !== core);
  const where = (m) => (m === core ? 'AGENTS.md' : m.meta.load === 'files' ? `.claude/rules/${m.meta.id}.md` : `standards/${m.meta.id}.md`);
  // Install never overwrites a file the project changed, so the note says what holds in each place.
  const stamp = (srcs) => `<!-- Written by kit.mjs build from ${srcs} (layout: code.claude.com/docs/en/memory). Kit: edit the source. Project: fill adapter slots here; install keeps your changes. -->\n`;
  const out = new Map();
  const head = fs.readFileSync(path.join(dir, '_parts', 'agents-head.md'), 'utf8');
  const moduleIndex = ['## Rule Modules', '',
    'Each module below holds the rules for one kind of work. Read it at the moment the last column names; a file',
    'module also loads by itself in Claude Code when a matching file is opened. A pointer `rule:<id>` names a rule',
    'by its fixed ID; `standards/INDEX.md` lists every ID and its file.', '',
    '| Module | File | Read it |', '|---|---|---|',
    ...rest.map((m) => `| ${m.meta.id} | \`${where(m)}\` | ${m.meta.when} |`), ''];
  out.set('project/AGENTS.md', stamp('rules/_parts/agents-head.md, rules/core.md and the module list') +
    head.trimEnd() + '\n\n---\n\n' + core.body.trimEnd() + '\n\n' + moduleIndex.join('\n'));
  for (const m of rest) {
    const front = m.meta.load === 'files' ? ['---', 'paths:', ...m.meta.paths.map((p) => `  - "${p}"`), '---', ''].join('\n') : '';
    out.set(`project/${where(m)}`, front + stamp(m.src) + '\n' + m.body);
  }
  const rows = mods.flatMap((m) => headings(m.body).map((h) => `| ${h.id} | ${h.title} | \`${where(m)}\` | ${(m.meta.tags[h.id] || []).join(', ')} |`));
  // The merge gate needs the PR-body audits where no branch or session can edit them: a kit-local project keeps
  // .claude/ out of git, so its base holds none. An exact copy, so the two cannot drift.
  for (const f of ['pr-body-audit.mjs', 'pr-body-audit-lean.mjs', 'canary-phrase.mjs', 'version-bump-check.mjs', 'no-attribution.mjs']) {
    out.set(`user/kit-tools/audits/${f}`, fs.readFileSync(path.join(kit, 'project', '.claude', f), 'utf8'));
  }
  // The merge gate makes its temp folders through the one helper; the same exact-copy rule keeps them alike.
  out.set('user/kit-tools/kit-temp.cjs', fs.readFileSync(path.join(kit, 'project', '.claude', 'kit-temp.cjs'), 'utf8'));
  // approve.mjs reads the owner's pop-up answers the way the guards do (T2): the same exact-copy rule.
  out.set('user/kit-tools/owner-yes.cjs', fs.readFileSync(path.join(kit, 'project', '.claude', 'owner-yes.cjs'), 'utf8'));
  out.set('project/standards/INDEX.md', stamp('rules/ (every module)') + ['', '# Rule Index', '',
    'Every rule by its fixed ID. A pointer `rule:<id>` anywhere in this project means: find the ID here, then read',
    'that rule in the file named. To search, look for your words in the Rule and Also called columns.', '',
    '| ID | Rule | File | Also called |', '|---|---|---|---|', ...rows, ''].join('\n'));
  // Each agent role that starts with rules gets them as a skill its role file preloads (rule:agent-role-table).
  // A rule's text runs from its heading to the next heading of the same or a higher level.
  const sectionText = (id) => {
    for (const m of mods) {
      const lines = m.body.split('\n');
      const hs = headings(m.body);
      const i = hs.findIndex((h) => h.id === id);
      if (i < 0) continue;
      const next = hs.slice(i + 1).find((h) => h.level <= hs[i].level);
      return lines.slice(hs[i].line - 1, next ? next.line - 1 : lines.length).join('\n').trimEnd();
    }
    throw new Error(`role table names an unknown rule: ${id}`);
  };
  const teams = mods.find((m) => m.meta.id === 'agent-teams');
  const table = teams ? teams.body.slice(teams.body.indexOf('{#agent-role-table}')) : '';
  for (const [, role, ids] of table.matchAll(/^\| (\w+) \| [^|]+ \| [^|]+ \| [^|]+ \| ([^|]+) \|$/gm)) {
    if (ids.trim() === 'none' || role === 'Role') continue;
    const list = ids.split(',').map((s) => s.trim());
    out.set(`user/skills/${role}-rules/SKILL.md`, ['---', `name: ${role}-rules`,
      `description: The general rules a ${role} agent works under, preloaded at its start by its role file. Not for direct use.`,
      'user-invocable: false', '---', '',
      stamp(`rules/ (rule:agent-role-table; ${list.join(', ')})`).trimEnd(), '',
      `# ${role[0].toUpperCase()}${role.slice(1)} Rules`, '',
      `These are the kit's general rules for the ${role} role. The project's own filled "Rules every brief carries" block`,
      '(rule:agent-team-adapter, named in your brief) adds the project\'s values and wins where it differs.', '',
      ...list.map((id) => sectionText(id) + '\n'), ''].join('\n'));
  }
  return out;
}

// Words that say nothing about which rule is meant.
const FIND_STOP = new Set(['a', 'an', 'the', 'is', 'it', 'its', 'i', 'my', 'me', 'we', 'our', 'to', 'of', 'in', 'on',
  'for', 'and', 'or', 'do', 'does', 'what', 'how', 'when', 'where', 'should', 'can', 'could', 'be', 'from', 'with',
  'this', 'that', 'ok', 'look', 'looks', 'too', 'so', 'before', 'after', 'about', 'rule', 'rules']);
const findWords = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w && !FIND_STOP.has(w));
// A query word matches a rule word that is the same, or that one starts with the other (4+ letters): "branch" finds
// "branching", "tests" finds "test".
const wordHit = (q, w) => q === w || (q.length >= 4 && w.length >= 4 && (w.startsWith(q) || q.startsWith(w)));

/**
 * Find rules by ID or by words, across the rule modules in rules/. An exact ID returns that rule alone. Otherwise
 * each rule scores 3 per query word in its ID, 2 in its title or tags, and 1 when its own text holds the word.
 *
 * Args:
 *     ctx: { kit, query, limit }
 *
 * Returns:
 *     [{ id, title, module, score }] best first, at most `limit` (default 5)
 */
export function findRules({ kit, query, limit = 5 }) {
  const dir = path.join(kit, 'rules');
  const rules = fs.readdirSync(dir).filter((n) => n.endsWith('.md')).flatMap((n) => {
    const { meta, body } = parseModule(fs.readFileSync(path.join(dir, n), 'utf8'));
    const lines = body.split('\n');
    const hs = headings(body);
    return hs.map((h, i) => ({ id: h.id, title: h.title, module: meta.id, tags: (meta.tags[h.id] || []).join(' '),
      text: lines.slice(h.line, i + 1 < hs.length ? hs[i + 1].line - 1 : lines.length).join(' ') }));
  });
  const exact = rules.find((r) => r.id === query.trim().replace(/^rule:/, ''));
  if (exact) return [{ id: exact.id, title: exact.title, module: exact.module, score: Infinity }];
  const qs = findWords(query);
  return rules.map((r) => {
    const idw = r.id.split('-'), tw = findWords(`${r.title} ${r.tags}`), bw = findWords(r.text);
    const score = qs.reduce((s, q) => s + (idw.some((w) => wordHit(q, w)) ? 3 : 0) + (tw.some((w) => wordHit(q, w)) ? 2 : 0)
      + (bw.some((w) => wordHit(q, w)) ? 1 : 0), 0);
    return { id: r.id, title: r.title, module: r.module, score };
  }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
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

/**
 * The skill cases a repo's own files point to (rule:kit-standards item 8), so the session-start question offers a
 * list to confirm. Signals are files at the repo root only: cheap, and never a guess from reading code.
 */
function suggestCases(projectDir) {
  const read = (f) => { try { return fs.readFileSync(path.join(projectDir, f), 'utf8'); } catch { return ''; } };
  const pkg = read('package.json');
  const py = ['requirements.txt', 'pyproject.toml', 'environment.yml', 'setup.cfg'].map(read).join('\n');
  const out = [];
  if (/"(svelte|@sveltejs\/kit|react|react-dom|vue|next|astro|solid-js)"/.test(pkg)) out.push('ui-design', 'ui-review');
  if (pkg || py) out.push('feature-build', 'debugging', 'review');
  if (pkg) out.push('security');
  if (['wrangler.toml', 'wrangler.json', 'wrangler.jsonc'].some((f) => fs.existsSync(path.join(projectDir, f)))) out.push('cloudflare');
  if (/\b(torch|transformers|datasets|tensorflow|scikit-learn|sklearn|huggingface)/i.test(py)) out.push('ml-data');
  if (/\b(apache-airflow|airflow|dbt-core|dbt)\b/i.test(py)) out.push('data-pipelines');
  if (fs.existsSync(projectDir) && fs.readdirSync(projectDir).some((f) => f.endsWith('.postman_collection.json'))) out.push('api');
  return out;
}

/** Whether a plugin is on for a project: the nearest settings file that names it wins, as in Claude Code. */
function pluginEnabled(projectDir, home, plugin) {
  for (const f of [path.join(projectDir, '.claude', 'settings.local.json'), path.join(projectDir, '.claude', 'settings.json'), path.join(home, 'settings.json')]) {
    try { const v = (JSON.parse(fs.readFileSync(f, 'utf8')).enabledPlugins || {})[plugin]; if (typeof v === 'boolean') return v; } catch { /* no file */ }
  }
  return false;
}

/** A skill's listing line as Claude Code shows it: "name: description" (a folded or literal description joined by spaces). */
function skillListing(file, prefix) {
  const front = (fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---/) || [])[1] || '';
  const name = ((front.match(/^name:\s*(.+)$/m) || [])[1] || path.basename(path.dirname(file))).trim().replace(/^["']|["']$/g, '');
  const m = front.match(/^description:[ \t]*(.*)$/m);
  let desc = m ? m[1].trim() : '';
  if (/^[>|][-+]?$/.test(desc)) {
    const after = front.slice(front.indexOf(m[0]) + m[0].length).split('\n').slice(1);
    const body = [];
    for (const line of after) { if (/^\s+\S/.test(line)) body.push(line.trim()); else if (line.trim()) break; }
    desc = body.join(' ');
  }
  desc = desc.replace(/^["']|["']$/g, '');
  return Buffer.byteLength(`${prefix}${name}: ${desc}`);
}

/**
 * Measure what really loads before a session's first message (rule:kit-standards item 14): the project's own
 * start load (measure), the memory index, the global CLAUDE.md and its imports, and the listing line of every
 * user skill and every skill of a plugin enabled for this project. Plugins the desktop app delivers from an
 * organization's catalog are not on disk here and are not counted.
 *
 * Args:
 *     ctx: { projectDir, home }
 *
 * Returns:
 *     { parts: { project, memoryIndex, globalClaude, userSkills, plugins }, total }
 */
export function measureReal({ projectDir, home }) {
  const size = (p) => (fs.existsSync(p) ? fs.statSync(p).size : 0);
  const skillFiles = (root) => walk(root).filter((f) => path.basename(f) === 'SKILL.md');
  const homeLoad = fs.existsSync(path.join(home, 'CLAUDE.md')) ? measure({ projectDir: home }).files.filter((f) => !f.file.startsWith('.claude/')) : [];
  const parts = {
    project: measure({ projectDir }).total,
    memoryIndex: size(path.join(home, 'projects', projectSlug(projectDir), 'memory', 'MEMORY.md')),
    globalClaude: homeLoad.reduce((s, f) => s + f.bytes, 0),
    userSkills: skillFiles(path.join(home, 'skills')).reduce((s, f) => s + skillListing(f, ''), 0),
    plugins: 0,
  };
  let installed = {};
  try { installed = JSON.parse(fs.readFileSync(path.join(home, 'plugins', 'installed_plugins.json'), 'utf8')).plugins || {}; } catch { /* none */ }
  for (const [key, entries] of Object.entries(installed)) {
    if (!pluginEnabled(projectDir, home, key)) continue;
    const entry = [...entries].sort((a, b) => String(b.lastUpdated).localeCompare(String(a.lastUpdated)))[0];
    if (!entry || !fs.existsSync(entry.installPath)) continue;
    const prefix = key.split('@')[0] + ':';
    parts.plugins += skillFiles(path.join(entry.installPath, 'skills')).reduce((s, f) => s + skillListing(f, prefix), 0);
  }
  return { parts, total: Object.values(parts).reduce((a, b) => a + b, 0) };
}

/**
 * A thread's probe folders, kept in one ledger so its closeout removes them with no ask (the owner, 2026-11-12: "folded in
 * and a part of the cleanup process"). A session deletes what it made (AGENTS non-negotiable 7); the ledger is how it
 * knows what it made. A folder kept for later use carries its reason; one not in the ledger is a stray, listed.
 *
 * Args:
 *     root: the probe folder (KIT_PROBE_ROOT, else <home folder>/kit-probes)
 *     home: the Claude config folder, whose guard records go with their folder
 *     cmd: new | keep | clean
 *     thread, label: who makes a folder, and a short name for it (new); whose folders go (clean)
 *     path, reason: the folder kept and why (keep)
 *     trash: moves one path to the bin (the Recycle Bin on Windows, else <root>/.trash)
 *
 * Returns:
 *     { path } for new; { text } for keep and clean
 */
export function scratch({ root, home, cmd, thread, label, path: target, reason, trash = toBin }) {
  const file = path.join(root, '.ledger.json');
  let ledgerData = { entries: [] };
  try { ledgerData = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* a first folder */ }
  if (!Array.isArray(ledgerData.entries)) ledgerData.entries = [];
  const save = () => { fs.mkdirSync(root, { recursive: true }); fs.writeFileSync(file, JSON.stringify(ledgerData, null, 2) + '\n'); };
  const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
  // Only a folder directly in the probe folder, by its real path: a ledger line is data a tool could write.
  const inRoot = (p) => path.dirname(real(p)).toLowerCase() === real(root).toLowerCase();
  if (cmd === 'new') {
    if (!/^[A-Za-z0-9._/-]{1,80}$/.test(String(thread || '')) || !/^[a-z0-9-]{1,40}$/.test(String(label || ''))) throw new Error('scratch new: a plain thread name and a lower-case label');
    fs.mkdirSync(root, { recursive: true });
    // A probe folder is recorded in the ledger, not a run's temp folder, so it is made here, never by mkdtemp.
    const made = path.join(root, `${label}-${crypto.randomBytes(4).toString('hex')}`);
    fs.mkdirSync(made);
    ledgerData.entries.push({ path: made, thread, label, created: new Date().toISOString() });
    save();
    return { path: made };
  }
  if (cmd === 'keep') {
    const e = ledgerData.entries.find((x) => real(x.path) === real(String(target)));
    if (!e || !String(reason || '').trim()) throw new Error('scratch keep: a folder in the ledger, and why it is kept');
    e.keep = String(reason).trim();
    save();
    return { text: `kept: ${e.path} (${e.keep})` };
  }
  if (cmd !== 'clean') throw new Error('scratch: new, keep or clean');
  const lines = [];
  const left = [];
  for (const e of ledgerData.entries) {
    if (e.thread !== thread) { left.push(e); continue; }
    if (e.keep) { lines.push(`kept: ${e.label} at ${e.path} (${e.keep})`); left.push(e); continue; }
    if (!inRoot(e.path)) { lines.push(`refused: ${e.path} is outside the probe folder, so it is left as it is`); continue; }
    // A move that fails (another drive, a locked file) keeps the folder's ledger line and says so; the rest go on.
    let failed = false;
    for (const p of [e.path, guardDir(home, e.path)]) {
      if (!fs.existsSync(p)) continue;
      try { trash(p, root); lines.push(`removed: ${p}`); } catch (err) { failed = true; lines.push(`not removed: ${p} (${String(err && err.message).split('\n')[0]})`); }
    }
    if (failed) left.push(e);
  }
  ledgerData.entries = left;
  save();
  // Strays: folders in the probe folder no ledger line names, a few days old, listed for the owner's one tap.
  const named = new Set(ledgerData.entries.map((e) => real(e.path).toLowerCase()));
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith('.')) continue;
    const p = path.join(root, d.name);
    if (!named.has(real(p).toLowerCase()) && Date.now() - fs.statSync(p).mtimeMs > 3 * 86400e3) lines.push(`stray (no ledger line, over 3 days old): ${p}`);
  }
  return { text: lines.join('\n') || 'nothing to clean' };
}

// The bin: on Windows the Recycle Bin, so the owner can take a folder back until it is emptied; elsewhere a .trash
// folder inside the probe folder.
function toBin(p, root) {
  if (process.platform === 'win32') {
    const ps = "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($env:KIT_BIN_PATH, 'OnlyErrorDialogs', 'SendToRecycleBin')";
    // By its full path: a bare name is looked for in the current folder first on Windows (the 1.28.0 sweep).
    const shell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const r = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', env: { ...process.env, KIT_BIN_PATH: p } });
    if (r.status !== 0) throw new Error(`scratch: could not move ${p} to the Recycle Bin`);
    return;
  }
  const bin = path.join(root, '.trash', new Date().toISOString().slice(0, 10));
  fs.mkdirSync(bin, { recursive: true });
  fs.renameSync(p, path.join(bin, `${path.basename(p)}-${Date.now()}`));
}

function main(argv) {
  const kit = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  // The Claude config folder: CLAUDE_CONFIG_DIR when a second one is in use, else ~/.claude.
  const home = process.env.KIT_CLAUDE_HOME || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const [cmd, target, arg] = argv;
  const dryRun = argv.includes('--dry-run');
  const force = argv.includes('--force');
  const overlay = argv.includes('--overlay');
  const mergedAt = argv.indexOf('--merged');
  const merged = mergedAt >= 0 ? String(argv[mergedAt + 1] || '').split(',').map((s) => s.trim()).filter(Boolean) : [];
  const acceptAt = argv.indexOf('--accept-host');
  const acceptHost = acceptAt >= 0 ? String(argv[acceptAt + 1] || '').split(',').map((s) => s.trim()).filter(Boolean) : [];
  const projectDir = target === 'project' ? arg : undefined;
  if (cmd === 'install') {
    // E24 C: the kit installs only from the release copy on the owner's PC; a cloud VM has neither.
    if (process.env.CLAUDE_CODE_REMOTE === 'true') {
      console.error('Install refused: installs run on the owner\'s PC, from the release copy. A cloud thread runs the worker jobs only.');
      process.exitCode = 1;
      return;
    }
    // Installs run only from a release, or by name for a throwaway test (the owner, 2026-11-02).
    const rel = releaseState(kit);
    if (rel.problems.length && !argv.includes('--unreleased')) {
      console.error(['Install refused: this kit folder is not a release.', ...rel.problems.map((p) => '    ' + p),
        `    Fix: commit or drop any changes above, then check out the newest release tag (${releaseCheckout(kit, newestTag(kit))}), or add --unreleased for a throwaway test install.`].join('\n'));
      process.exitCode = 1;
      return;
    }
    const release = { release: !rel.problems.length, describe: rel.describe, dirty: rel.dirty, tree: rel.tree };
    const r = install({ kit, home, target, projectDir, dryRun, force, overlay, merged, release, acceptHost });
    console.log(`${dryRun ? '[dry run] ' : ''}Kit ${r.version} -> ${target}${projectDir ? ' ' + projectDir : ` (Claude config folder: ${toPosix(home)})`}`);
    if (!release.release) console.log(`    Unreleased build ${rel.describe || 'with no git history'} (--unreleased): for a throwaway test install only. Status shows it as unreleased.`);
    for (const f of r.hostOwned) console.log(`    host-owned: ${f} (the kit's CLAUDE.md is in CLAUDE.local.md)`);
    console.log(`    created: ${r.created.length}, updated: ${r.updated.length}, replaced: ${r.replaced.length}, retired: ${r.retired.length}, skipped: ${r.skipped.length}`);
    for (const f of r.merged) console.log(`    recorded as merged by hand: ${f}`);
    for (const f of r.replaced) console.log(`    replaced ${f}`);
    for (const f of r.retired) console.log(`    retired ${f} (a copy is in the backup folder)`);
    if (r.backupDir && !dryRun) console.log(`    old copies kept in ${r.backupDir}`);
    for (const s of r.skipped) console.log(`    skipped ${s.file}: ${s.reason}`);
    // T14: install is finished only when every part is present and wired. The kit's own copy runs, never the project's.
    const use = useCheck(kit, projectDir, home);
    if (target === 'project' && !dryRun && use) {
      console.log(use.text);
      if (use.code !== 0) process.exitCode = 1;
    }
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
  } else if (cmd === 'measure' && argv.includes('--real')) {
    const dir = argv.slice(1).find((a) => a !== '--real') || process.cwd();
    const r = measureReal({ projectDir: dir, home });
    for (const [k, v] of Object.entries(r.parts)) console.log(`${String(v).padStart(8)}  ${k}`);
    console.log(`${String(r.total).padStart(8)}  loaded before the first message (cap ${(loadKit(kit).config.caps || {}).realLoad || 'none'}); desktop-app catalog plugins not counted`);
  } else if (cmd === 'measure') {
    const r = measure({ projectDir: target || path.join(kit, 'project') });
    for (const f of r.files) console.log(`${String(f.bytes).padStart(8)}  ${f.file}`);
    console.log(`${String(r.total).padStart(8)}  loaded at session start`);
    for (const u of r.unresolved) console.log(`    import not found: @${u.import} (in ${u.from})`);
  } else if (cmd === 'find') {
    const hits = findRules({ kit, query: argv.slice(1).join(' ') });
    for (const h of hits) console.log(`rule:${h.id}  ${h.title}  (${h.module})`);
    if (!hits.length) console.log('No rule matched. Try other words, or read project/standards/INDEX.md.');
  } else if (cmd === 'build') {
    const out = build({ kit });
    for (const [rel, text] of out) {
      fs.mkdirSync(path.dirname(path.join(kit, rel)), { recursive: true });
      fs.writeFileSync(path.join(kit, rel), text);
    }
    console.log(`build: wrote ${out.size} file(s) from rules/; commit-msg hook: ${sourceHooks(kit)}`);
  } else if (cmd === 'status') {
    const r = status({ kit, home, projectDir: target || process.cwd() });
    console.log(r.text);
    process.exitCode = r.current ? 0 : 1;
  } else if (cmd === 'scratch') {
    // node scripts/kit.mjs scratch new <thread> <label> | keep <folder> "<why>" | clean <thread>
    const root = process.env.KIT_PROBE_ROOT || path.join(os.homedir(), 'kit-probes');
    try {
      const r = target === 'new' ? scratch({ root, home, cmd: 'new', thread: arg, label: argv[3] })
        : target === 'keep' ? scratch({ root, home, cmd: 'keep', path: arg, reason: argv[3] })
        : scratch({ root, home, cmd: target, thread: arg });
      console.log(r.path || r.text);
    } catch (e) {
      console.error(String(e.message));
      process.exitCode = 1;
    }
  } else if (cmd === 'scrub') {
    const hits = scrub({ kit });
    for (const h of hits) console.log(`${h.file}:${h.line}  ${h.kind}`);
    console.log(hits.length ? `${hits.length} hit(s)` : 'Scrub clean');
    process.exitCode = hits.length ? 1 : 0;
  } else {
    console.log('Usage: node scripts/kit.mjs install user | install project <folder> [--dry-run] [--force] [--overlay] [--merged <file>,<file>] [--unreleased]');
    console.log('       node scripts/kit.mjs fold-back user | fold-back project <folder>');
    console.log('       node scripts/kit.mjs bump major|minor|patch "<note>"');
    console.log('       node scripts/kit.mjs snapshot | restore <name>');
    console.log('       node scripts/kit.mjs build | measure [project folder] [--real] | find <words or rule ID>');
    console.log('       node scripts/kit.mjs status [project folder]');
    console.log('       node scripts/kit.mjs scrub');
    console.log('       node scripts/kit.mjs scratch new <thread> <label> | keep <folder> "<why>" | clean <thread>');
    process.exitCode = cmd ? 1 : 0;
  }
}

// Paths compared after links: run through a junction, the CLI must still run, not exit 0 having done nothing.
const realOf = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && realOf(process.argv[1]) === realOf(fileURLToPath(import.meta.url))) main(process.argv.slice(2));
