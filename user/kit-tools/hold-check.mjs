#!/usr/bin/env node
// E36/U9 (build 24): the hold check a release runs. A hold either logs or enforces (user/kit-hooks/holds.json, read by
// hold-mode.cjs). A release may not turn an enforced hold to log or drop it, and every hold must name a hook file on disk,
// or it guards nothing. Usage: node hold-check.mjs [kitDir] [--base <ref>]. kitDir defaults to the folder run from; the
// base defaults to the latest v* release tag by version. Exit 0 when the holds pass, when the base has no holds.json, or
// when there is no release tag to compare; exit 1 naming each hold that fails; exit 2 when kitDir is not a git repository,
// the base is not a commit, or the base's holds.json does not read as a holds list.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const HOLDS = 'user/kit-hooks/holds.json';
const HOOKS = 'user/kit-hooks';
const RELEASE = /^v\d+(\.\d+)*$/;

// git in the kit folder, started from node's own folder with the lookup switched off, as pr-size.mjs starts it.
const git = (kit, args) => spawnSync('git', ['-C', kit, '-c', 'core.fsmonitor=false', ...args], {
  encoding: 'utf8',
  timeout: 60000,
  windowsHide: true,
  cwd: path.dirname(process.execPath),
  env: { ...process.env, NoDefaultCurrentDirectoryInExePath: '1' },
});

// The holds of a holds.json text: the entries that are objects with a string id. Null when the text is no holds list.
function holdsOf(text) {
  let data;
  try { data = JSON.parse(text); } catch { return null; }
  if (!data || typeof data !== 'object' || !Array.isArray(data.holds)) return null;
  return data.holds.filter((h) => h && typeof h === 'object' && typeof h.id === 'string');
}

// The mode a list gives an id, as hold-mode.cjs reads it: log only when every entry for the id says log. 'gone' when none names it.
function modeIn(holds, id) {
  const mine = holds.filter((h) => h.id === id);
  if (mine.length === 0) return 'gone';
  return mine.every((h) => h.mode === 'log') ? 'log' : 'enforce';
}

// The holds in a working-tree file: a missing, unreadable or malformed file lists none.
function listAt(file) {
  try { return holdsOf(fs.readFileSync(file, 'utf8')) ?? []; } catch { return []; }
}

// A hold's hook file must be a plain name in user/kit-hooks on disk; a name that climbs out of that folder is no file there.
function hookExists(kit, hook) {
  if (typeof hook !== 'string' || path.basename(hook) !== hook) return false;
  try { return fs.statSync(path.join(kit, HOOKS, hook)).isFile(); } catch { return false; }
}

function parse(argv) {
  let kit = null;
  let base = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') {
      base = argv[++i];
      if (base === undefined || base.startsWith('-')) return { error: '--base needs a ref name' };
    } else if (a.startsWith('-') || kit !== null) {
      return { error: `unknown argument ${a}` };
    } else kit = a;
  }
  return { kit: path.resolve(kit ?? '.'), base };
}

function main(argv) {
  const args = parse(argv);
  if (args.error) {
    console.error(`hold-check: ${args.error}; usage: hold-check.mjs [kitDir] [--base <ref>]`);
    return 2;
  }
  const { kit } = args;
  const inside = git(kit, ['rev-parse', '--is-inside-work-tree']);
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') {
    console.error(`hold-check: ${kit} is not inside a git repository`);
    return 2;
  }
  let ref = args.base;
  if (ref === null) {
    const tags = git(kit, ['tag', '--list', 'v*', '--sort=-v:refname']);
    if (tags.status !== 0) {
      console.error(`hold-check: cannot list the tags of ${kit}: ${String(tags.stderr).trim()}`);
      return 2;
    }
    ref = tags.stdout.split('\n').map((t) => t.trim()).find((t) => RELEASE.test(t));
    if (ref === undefined) {
      console.log('hold-check: no v* release tag to compare, so nothing to check');
      return 0;
    }
  }
  if (git(kit, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).status !== 0) {
    console.error(`hold-check: ${ref} is not a commit in ${kit}`);
    return 2;
  }
  const shown = git(kit, ['show', `${ref}:./${HOLDS}`]);
  const before = shown.status === 0 ? holdsOf(shown.stdout) : [];
  if (before === null) {
    console.error(`hold-check: ${ref}:${HOLDS} does not read as a holds list`);
    return 2;
  }
  const after = listAt(path.join(kit, HOLDS));
  const problems = [];
  for (const id of new Set(before.map((h) => h.id))) {
    if (modeIn(before, id) !== 'enforce') continue;
    const now = modeIn(after, id);
    if (now === 'log') problems.push(`${id} is enforce at ${ref} and log now`);
    if (now === 'gone') problems.push(`${id} is enforce at ${ref} and gone from ${HOLDS}`);
  }
  for (const h of after) {
    if (!hookExists(kit, h.hook)) problems.push(`${h.id} names the hook file ${h.hook}, which is missing from ${HOOKS}`);
  }
  if (problems.length > 0) {
    for (const p of new Set(problems)) console.error(`hold-check: ${p}`);
    return 1;
  }
  console.log(`hold-check: the holds pass against ${ref}`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
