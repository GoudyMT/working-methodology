// The builder's edit fence (rule:agent-role-table): a PreToolUse hook on Edit and Write in the builder role file.
// A builder works in its own git worktree; an edit outside it would land in someone else's checkout. When the
// worktree has a unit file list (one path per line, relative to the worktree) at `git rev-parse --git-path
// kit-unit-files.txt`, edits are also kept to that list. That path is inside the worktree's own git folder, so the
// list is never committed and binds only its own worktree. Exit 2 blocks the tool call and tells the builder why; anything unexpected lets the call through, since
// the fence is a guard, not the only check (the checker and the lead's integration still review the unit).
const fs = require('fs');
const path = require('path');
const safeSpawn = require('./safe-spawn.cjs');

// Roles whose edits need the lead's file list (their role bodies say so); a builder without one edits its worktree as before.
// A plugin role is named kit:builder, so a role matches by its last name after a colon, as sweep-guard matches it.
const LISTED_ROLE = /(^|:)(tester|writer)$/i;
const BUILDER_ROLE = /(^|:)builder$/i;
// U4 (build 24): the unit list's name, and unit-check's test-file rule (a test folder, or *.test.* / *.spec.*): a builder
// edits neither, whatever list there is.
const LIST = 'kit-unit-files.txt';
const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'spec']);
const isTestFile = (rel) => {
	const parts = rel.split(/[\\/]/);
	return parts.slice(0, -1).some((d) => TEST_DIRS.has(d)) || /\.(test|spec)\./.test(parts[parts.length - 1]);
};

// The real path, through any symlink or junction: git reports the worktree's real path, so the target must be
// compared the same way. A file not yet written resolves through its nearest existing folder.
function real(p) {
	const rest = [];
	while (!fs.existsSync(p) && path.dirname(p) !== p) { rest.unshift(path.basename(p)); p = path.dirname(p); }
	return path.join(fs.realpathSync.native(p), ...rest);
}

// One spelling for a path inside the worktree: forward slashes, no leading ./, and no case on Windows.
const norm = (p) => {
	const s = p.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '');
	return process.platform === 'win32' ? s.toLowerCase() : s;
};

function main() {
	const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
	agentType = input.agent_type || '';
	const file = input.tool_input && (input.tool_input.file_path || input.tool_input.notebook_path);
	if (!file) return 0;
	const cwd = input.cwd || process.cwd();
	// git from node's own folder, never the worktree (build 23).
	const top = safeSpawn.gitRead(cwd, ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
	if (top.status !== 0) {
		// No git top level means no file list to check a tester or writer against: stop it, as with a missing list.
		if (LISTED_ROLE.test(String(input.agent_type))) {
			process.stderr.write(`Blocked: ${input.agent_type} edit has no git worktree to check its file list against. Stop and report it.\n`);
			return 2;
		}
		return 0;
	}
	const root = real(path.resolve(top.stdout.trim()));
	const target = real(path.resolve(cwd, file));
	const rel = path.relative(root, target);
	if (rel.startsWith('..') || path.isAbsolute(rel)) {
		process.stderr.write(`Blocked: ${target} is outside this builder's worktree (${root}). Edit only files of your unit, in your worktree.\n`);
		return 2;
	}
	if (BUILDER_ROLE.test(String(input.agent_type)) && (isTestFile(rel) || path.basename(rel) === LIST)) {
		process.stderr.write(`Blocked: ${rel} is a test file or the unit list, which a builder does not edit. Report it to the lead instead of editing it.\n`);
		return 2;
	}
	const gitPath = safeSpawn.gitRead(root, ['rev-parse', '--path-format=absolute', '--git-path', LIST], { encoding: 'utf8' });
	const listFile = gitPath.status === 0 ? gitPath.stdout.trim() : '';
	if (listFile && fs.existsSync(listFile)) {
		const allowed = fs.readFileSync(listFile, 'utf8').split(/\r?\n/).map(norm).filter((p) => p && !p.startsWith('#'));
		if (!allowed.includes(norm(rel))) {
			process.stderr.write(`Blocked: ${rel} is not in this unit's file list (git rev-parse --git-path kit-unit-files.txt). Report it to the lead instead of editing it.\n`);
			return 2;
		}
	} else if (LISTED_ROLE.test(String(input.agent_type))) {
		// A tester or writer edits only what the lead listed, so with no list it stops (a builder keeps its worktree edits).
		process.stderr.write(`Blocked: ${input.agent_type} has no file list. The lead writes kit-unit-files.txt before the unit starts; stop and report it.\n`);
		return 2;
	}
	return 0;
}

// A listed role whose check fails stops too: an unchecked tester or writer edit never gets through.
let agentType = '';
try {
	process.exitCode = main();
} catch {
	if (LISTED_ROLE.test(agentType)) {
		process.stderr.write(`Blocked: ${agentType} edit could not be checked against its file list. Stop and report it.\n`);
		process.exitCode = 2;
	} else {
		process.exitCode = 0;
	}
}
