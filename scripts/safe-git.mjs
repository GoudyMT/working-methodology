// How the kit's scripts run git and gh on a project folder (moved here from kit.mjs for the merge-on-green steps).
// A project's git config is the agent's to write, so every git turns off what could run a program and fetches nothing,
// and each run starts from node's own folder: on Windows a program is looked for in the current folder first, where
// the agent could leave a git.exe or gh.exe. gh then names the repo outright, never through the folder it runs in.
// A protocol.<name>.allow in the repo config beats protocol.allow, so each transport is named too (the security review on
// 0696ddf; no lazy fetch from these commands was reproduced on git 2.56, 2026-11-11).
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const NO_PROGRAMS = ['-c', 'core.fsmonitor=false', '-c', 'protocol.allow=never',
  ...['ext', 'file', 'ssh', 'git', 'http', 'https'].flatMap((p) => ['-c', `protocol.${p}.allow=never`])];
export const SAFE_CWD = path.dirname(process.execPath);

// git on a folder, hardened as above.
export const safeGit = (dir, ...args) => spawnSync('git', ['-C', path.resolve(dir), ...NO_PROGRAMS, ...args], { encoding: 'utf8', cwd: SAFE_CWD, timeout: 8000 });
// gh from node's own folder; a call names its repo itself.
export const safeGh = (args) => spawnSync('gh', args, { encoding: 'utf8', cwd: SAFE_CWD, timeout: 8000 });

/**
 * The GitHub owner/repo origin names, read with the hardened git, or null when origin is not a GitHub repo.
 */
export function githubSlug(dir) {
  const r = safeGit(dir, 'remote', 'get-url', 'origin');
  const m = r.status === 0 && /github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(\.git)?\/?$/.exec(r.stdout.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}
