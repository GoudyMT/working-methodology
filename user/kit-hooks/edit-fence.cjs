// The builder's edit fence (rule:agent-role-table): a PreToolUse hook on Edit and Write in the builder role file.
// A builder works in its own git worktree; an edit outside it would land in someone else's checkout. When the
// worktree holds .kit/unit-files.txt (one path per line, relative to the worktree), edits are also kept to that
// list. Exit 2 blocks the tool call and tells the builder why; anything unexpected lets the call through, since
// the fence is a guard, not the only check (the checker and the lead's integration still review the unit).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function main() {
	const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
	const file = input.tool_input && (input.tool_input.file_path || input.tool_input.notebook_path);
	if (!file) return 0;
	const cwd = input.cwd || process.cwd();
	const top = spawnSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
	if (top.status !== 0) return 0;
	const root = path.resolve(top.stdout.trim());
	const target = path.resolve(cwd, file);
	const rel = path.relative(root, target);
	if (rel.startsWith('..') || path.isAbsolute(rel)) {
		process.stderr.write(`Blocked: ${target} is outside this builder's worktree (${root}). Edit only files of your unit, in your worktree.\n`);
		return 2;
	}
	const listFile = path.join(root, '.kit', 'unit-files.txt');
	if (fs.existsSync(listFile)) {
		const allowed = fs.readFileSync(listFile, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(path.sep).join('/'));
		if (!allowed.includes(rel.split(path.sep).join('/'))) {
			process.stderr.write(`Blocked: ${rel} is not in this unit's file list (.kit/unit-files.txt). Report it to the lead instead of editing it.\n`);
			return 2;
		}
	}
	return 0;
}

try { process.exitCode = main(); } catch { process.exitCode = 0; }
