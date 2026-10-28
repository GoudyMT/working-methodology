// The builder's edit fence (rule:agent-role-table): a PreToolUse hook on Edit and Write in the builder role file.
// A builder works in its own git worktree; an edit outside it would land in someone else's checkout. When the
// worktree has a unit file list (one path per line, relative to the worktree) at `git rev-parse --git-path
// kit-unit-files.txt`, edits are also kept to that list. That path is inside the worktree's own git folder, so the
// list is never committed and binds only its own worktree. Exit 2 blocks the tool call and tells the builder why; anything unexpected lets the call through, since
// the fence is a guard, not the only check (the checker and the lead's integration still review the unit).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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
	const file = input.tool_input && (input.tool_input.file_path || input.tool_input.notebook_path);
	if (!file) return 0;
	const cwd = input.cwd || process.cwd();
	const top = spawnSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
	if (top.status !== 0) return 0;
	const root = real(path.resolve(top.stdout.trim()));
	const target = real(path.resolve(cwd, file));
	const rel = path.relative(root, target);
	if (rel.startsWith('..') || path.isAbsolute(rel)) {
		process.stderr.write(`Blocked: ${target} is outside this builder's worktree (${root}). Edit only files of your unit, in your worktree.\n`);
		return 2;
	}
	const gitPath = spawnSync('git', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-path', 'kit-unit-files.txt'], { encoding: 'utf8' });
	const listFile = gitPath.status === 0 ? gitPath.stdout.trim() : '';
	if (listFile && fs.existsSync(listFile)) {
		const allowed = fs.readFileSync(listFile, 'utf8').split(/\r?\n/).map(norm).filter(Boolean);
		if (!allowed.includes(norm(rel))) {
			process.stderr.write(`Blocked: ${rel} is not in this unit's file list (git rev-parse --git-path kit-unit-files.txt). Report it to the lead instead of editing it.\n`);
			return 2;
		}
	}
	return 0;
}

try { process.exitCode = main(); } catch { process.exitCode = 0; }
