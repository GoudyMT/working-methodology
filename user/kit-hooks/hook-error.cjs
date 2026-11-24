'use strict';
// K375: the one answer a hook gives when its own code throws. onError(id, error, where) appends one row to the kit's hook
// error log, then returns what the hook's tier asks: a deny for security or high, nothing for small. The log is
// kit-guard-open.log in the git common dir of `where` (the hook call's cwd), the file checklist.mjs reads for hook errors.
// A row that fails to write does not lift a deny, so a high or security hook stays refused.
const fs = require('fs');
const path = require('path');
const { tier } = require('./hold-mode.cjs');

const OPEN = 'kit-guard-open.log';
const HOLDS = path.join(__dirname, 'holds.json');

// The hook file the holds entry names for this id (spawn-list runs agent-model.cjs), else <id>.cjs.
function hookOf(id) {
  try {
    const hit = JSON.parse(fs.readFileSync(HOLDS, 'utf8')).holds.find((h) => h && h.id === id && typeof h.hook === 'string');
    return hit ? hit.hook : `${id}.cjs`;
  } catch {
    return `${id}.cjs`;
  }
}

// The git common dir of a folder, or null when the folder is in no repo. Read from the .git with fs calls only, no child
// process: a git.exe planted in a project would run in a spawn on Windows (guard.cjs gitCommonDir also reads it with fs reads only).
// Walks up from `where` to the first .git: a folder is the common dir; a file "gitdir: <path>" names a worktree's git
// folder, whose commondir file (when present) names the common dir.
function commonDir(where) {
  if (typeof where !== 'string' || where === '' || !path.isAbsolute(where)) return null;
  let dir = path.resolve(where);
  for (;;) {
    const dotGit = path.join(dir, '.git');
    let st = null;
    try { st = fs.statSync(dotGit); } catch { /* no .git here: go up */ }
    if (st && st.isDirectory()) return dotGit;
    if (st && st.isFile()) {
      const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, 'utf8'));
      if (!m) return null;
      const gitdir = path.resolve(dir, m[1].trim());
      try { return path.resolve(gitdir, fs.readFileSync(path.join(gitdir, 'commondir'), 'utf8').trim()); } catch { return gitdir; }
    }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function onError(id, error, where) {
  const hook = hookOf(id);
  const level = tier(id);
  const text = String((error && error.message) || error);
  try {
    const dir = commonDir(where);
    if (dir) {
      const row = { kind: 'hook-error', id, hook, tier: level, error: text.split('\n')[0], at: new Date().toISOString() };
      fs.appendFileSync(path.join(dir, OPEN), `${JSON.stringify(row)}\n`);
    }
  } catch {
    /* the row did not write: the answer below still stands */
  }
  if (level === 'small') return null;
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `hook error: lead review: ${hook}` } };
}

module.exports = { onError };
