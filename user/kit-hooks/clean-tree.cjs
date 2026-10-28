// The checker's clean-tree stop (rule:agent-role-table): a checker never changes files, but it can run commands.
// On its first command (PreToolUse) this hook records `git status --porcelain` for the worktree; when the checker
// stops (Stop, run as SubagentStop for an agent), it compares. Any difference blocks the stop (exit 2) and tells
// the checker to restore the tree and report what changed, so a probe that wrote a file never goes unnoticed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// The tree's state: the file list (ignored files too) plus a hash of every change's content, so a second edit to
// a file that was already changed, or a change to an ignored file, still shows. A guard against accidents, not
// against a checker set on hiding its tracks: it fails open on a git error, and a checker that never ran a
// command (so no snapshot exists) cannot have changed a file, since its role has no Edit or Write.
function status(cwd) {
	const git = (...a) => spawnSync('git', ['-C', cwd, ...a], { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 });
	const list = git('status', '--porcelain', '--ignored');
	if (list.status !== 0) return null;
	const hash = require('crypto').createHash('sha256').update(git('diff', 'HEAD', '--binary').stdout || '');
	const others = git('ls-files', '-o', '-z').stdout.toString().split('\0').filter(Boolean);
	for (const f of others.sort()) {
		try { hash.update(f).update(fs.readFileSync(path.join(cwd, f))); } catch { hash.update(f); }
	}
	return `${list.stdout.toString().trim()}\n#${hash.digest('hex')}`;
}

function main() {
	const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
	const cwd = input.cwd || process.cwd();
	const snap = path.join(os.tmpdir(), `kit-clean-tree-${String(input.session_id || 'none').replace(/[^\w-]/g, '')}.txt`);
	// A checker works in the builder's worktree, which may not be its own cwd, so every worktree of the repo counts.
	const wt = spawnSync('git', ['-C', cwd, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' });
	const trees = wt.status === 0 ? [...wt.stdout.matchAll(/^worktree (.+)$/gm)].map((m) => m[1].trim()) : [cwd];
	const parts = trees.map((t) => { const s = fs.existsSync(t) ? status(t) : ''; return s === null ? null : `${t}\n${s}`; });
	if (parts.includes(null)) return 0;
	const now = parts.join('\n');
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
