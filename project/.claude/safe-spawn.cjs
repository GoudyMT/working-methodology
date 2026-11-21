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
// The environment a kit git runs in (the build 23a sweep): a GIT_* variable a project's settings set can name a program
// (GIT_EXTERNAL_DIFF, GIT_PAGER, GIT_SSH_COMMAND, GIT_CONFIG_*), so only the ones that name who a commit is by, the
// index a commit uses, and lazy fetch are kept. The attributes come from the empty tree, so a .gitattributes in the
// project names no textconv, diff or filter program, and optional locks are off, so a read writes no index and runs no
// post-index-change hook. A git older than 2.40 ignores GIT_ATTR_SOURCE.
const KEEP_GIT_ENV = /^GIT_(AUTHOR_(NAME|EMAIL|DATE)|COMMITTER_(NAME|EMAIL|DATE)|INDEX_FILE|NO_LAZY_FETCH)$/;
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
// The build 23a sweep: a diff program the repo's config names (diff.external) never runs either. An empty
// diff.external makes git diff fail, so a diff takes --no-ext-diff, after any -c or -C options before it.
function gitArgs(args) {
	let i = 0;
	while (i < args.length && String(args[i]).startsWith('-')) i += args[i] === '-c' || args[i] === '-C' ? 2 : 1;
	return args[i] === 'diff' ? [...args.slice(0, i + 1), '--no-ext-diff', ...args.slice(i + 1)] : args;
}
function gitEnv(env = process.env) {
	const out = {};
	for (const [k, v] of Object.entries(env || {})) if (!/^GIT_/i.test(k) || KEEP_GIT_ENV.test(k)) out[k] = v;
	return { ...out, GIT_OPTIONAL_LOCKS: '0', GIT_ATTR_SOURCE: EMPTY_TREE };
}

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

/** git on a folder: git -C <dir>, no repo-named program, in gitEnv. For a command that may fetch or push. */
const git = (dir, args = [], opts = {}) => tool('git', ['-C', path.resolve(String(dir)), ...NO_FSMONITOR, ...gitArgs(args)], { ...opts, env: gitEnv(opts.env) });

/** git that only reads: as git(), with every fetch protocol off too. */
const gitRead = (dir, args = [], opts = {}) => tool('git', ['-C', path.resolve(String(dir)), ...NO_PROGRAMS, ...gitArgs(args)], { ...opts, env: gitEnv(opts.env) });

module.exports = { SAFE_CWD, TIMEOUT, NO_FSMONITOR, NO_PROGRAMS, gitArgs, gitEnv, options, tool, toolOut, git, gitRead };
