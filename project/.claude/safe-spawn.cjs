'use strict';
// How every installed kit file starts a program by its bare name (git, gh, ps, ...): build 23, K212-K214 and the class
// behind them. On Windows a bare name is looked for in the folder the child starts in before PATH, so a git.exe or
// gh.exe left in a project would run in place of the real one, as the user, outside Claude Code's prompts. Each run
// here starts from node's own folder, hides its window, has a time limit, and sets NoDefaultCurrentDirectoryInExePath
// for anything it starts in turn. git names its folder with -C and never runs the fsmonitor program a repo's config
// can name; a read also turns every fetch protocol off (as scripts/safe-git.mjs does in the kit's own scripts).
// One file, three installed copies, byte for byte (tests/safe-spawn.test.mjs): .claude/ in each project, and
// kit-tools/audits/ and kit-hooks/ in the Claude config folder, since a hook or an audit loads only its own folder.
// Guards that must load alone keep the same options inline; scripts/spawn-check.mjs holds every launch to this.
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const SAFE_CWD = path.dirname(process.execPath);
const TIMEOUT = 60000;
const NO_FSMONITOR = ['-c', 'core.fsmonitor=false'];
const NO_PROGRAMS = [...NO_FSMONITOR, '-c', 'protocol.allow=never',
	...['ext', 'file', 'ssh', 'git', 'http', 'https'].flatMap((p) => ['-c', `protocol.${p}.allow=never`])];

/** The options every launch gets: the caller's, with the folder, window, time limit and lookup setting fixed. */
function options(opts = {}) {
	return {
		...opts,
		cwd: SAFE_CWD,
		windowsHide: true,
		timeout: opts.timeout || TIMEOUT,
		env: { ...(opts.env || process.env), NoDefaultCurrentDirectoryInExePath: '1' },
	};
}

/** spawnSync of a program by name, from node's own folder. Same result shape as spawnSync. */
const tool = (name, args = [], opts = {}) => spawnSync(name, args, options(opts));

/** execFileSync of a program by name, from node's own folder: its output, or a throw on failure, as execFileSync. */
const toolOut = (name, args = [], opts = {}) => execFileSync(name, args, options(opts));

/** git on a folder: git -C <dir> -c core.fsmonitor=false <args>. For a command that may fetch or push. */
const git = (dir, args = [], opts = {}) => tool('git', ['-C', path.resolve(String(dir)), ...NO_FSMONITOR, ...args], opts);

/** git that only reads: as git(), with every fetch protocol off too. */
const gitRead = (dir, args = [], opts = {}) => tool('git', ['-C', path.resolve(String(dir)), ...NO_PROGRAMS, ...args], opts);

module.exports = { SAFE_CWD, TIMEOUT, NO_FSMONITOR, NO_PROGRAMS, options, tool, toolOut, git, gitRead };
