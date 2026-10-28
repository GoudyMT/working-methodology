// The checker's clean-tree stop (rule:agent-role-table): a checker never changes files, but it can run commands.
// On its first command (PreToolUse) this hook records `git status --porcelain` for the worktree; when the checker
// stops (Stop, run as SubagentStop for an agent), it compares. Any difference blocks the stop (exit 2) and tells
// the checker to restore the tree and report what changed, so a probe that wrote a file never goes unnoticed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function status(cwd) {
	const r = spawnSync('git', ['-C', cwd, 'status', '--porcelain'], { encoding: 'utf8' });
	return r.status === 0 ? r.stdout.trim() : null;
}

function main() {
	const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
	const cwd = input.cwd || process.cwd();
	const snap = path.join(os.tmpdir(), `kit-clean-tree-${String(input.session_id || 'none').replace(/[^\w-]/g, '')}.txt`);
	const now = status(cwd);
	if (now === null) return 0;
	if (input.hook_event_name === 'PreToolUse') {
		if (!fs.existsSync(snap)) fs.writeFileSync(snap, now);
		return 0;
	}
	const before = fs.existsSync(snap) ? fs.readFileSync(snap, 'utf8') : now;
	if (before === now) { fs.rmSync(snap, { force: true }); return 0; }
	process.stderr.write(`A checker never changes files, but the worktree changed while you ran:\n${now}\n(before: ${before || 'clean'}).\nRestore it with git, then report what changed and why as a finding.\n`);
	return 2;
}

try { process.exitCode = main(); } catch { process.exitCode = 0; }
