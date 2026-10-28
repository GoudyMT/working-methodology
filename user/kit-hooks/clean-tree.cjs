// The checker's clean-tree stop (rule:agent-role-table): a checker never changes files, but it can run commands.
// On its first command (PreToolUse) this hook records the state of every worktree of the repo; when the checker
// stops (Stop, run as SubagentStop for an agent), it compares. A difference blocks the stop once (exit 2) and tells
// the checker to report what changed, so a probe that wrote a file never goes unnoticed. It never asks for a
// restore: in a parallel batch another builder may be working in one of those worktrees.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// A worktree's state: the file list plus a hash of every change's content, so a second edit to a file that was
// already changed still shows. Ignored files are left out: the unit tests a checker may run write caches there,
// and hashing node_modules on every command is too slow. A guard against accidents, not against a checker set on
// hiding its tracks: it fails open on a git error, and a checker that never ran a command (so no snapshot exists)
// cannot have changed a file, since its role has no Edit or Write.
function status(cwd) {
	const git = (...a) => spawnSync('git', ['-C', cwd, ...a], { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 });
	const list = git('status', '--porcelain');
	if (list.status !== 0) return null;
	const hash = require('crypto').createHash('sha256').update(git('diff', 'HEAD', '--binary').stdout || '');
	const others = git('ls-files', '-o', '--exclude-standard', '-z').stdout.toString().split('\0').filter(Boolean);
	for (const f of others.sort()) {
		try { hash.update(f).update(fs.readFileSync(path.join(cwd, f))); } catch { hash.update(f); }
	}
	return `${list.stdout.toString().trim()}\n#${hash.digest('hex')}`;
}

// Every worktree of the repo, since a checker reads the builder's worktree, which may not be its own cwd.
function trees(cwd) {
	const wt = spawnSync('git', ['-C', cwd, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' });
	const list = wt.status === 0 ? [...wt.stdout.matchAll(/^worktree (.+)$/gm)].map((m) => m[1].trim()) : [cwd];
	const out = {};
	for (const t of list) {
		const s = fs.existsSync(t) ? status(t) : '';
		if (s === null) return null;
		out[t] = s;
	}
	return out;
}

function main() {
	const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
	const cwd = input.cwd || process.cwd();
	// Keyed by agent too: checkers started by one session share its session_id.
	const key = `${input.session_id || 'none'}-${input.agent_id || 'main'}`.replace(/[^\w-]/g, '');
	const snap = path.join(os.tmpdir(), `kit-clean-tree-${key}.json`);
	if (input.hook_event_name === 'PreToolUse') {
		if (fs.existsSync(snap)) return 0;
		const now = trees(cwd);
		if (now) fs.writeFileSync(snap, JSON.stringify(now));
		return 0;
	}
	if (!fs.existsSync(snap)) return 0;
	const before = JSON.parse(fs.readFileSync(snap, 'utf8'));
	fs.rmSync(snap, { force: true });
	// The second stop attempt: the checker was already told, so it may finish.
	if (input.stop_hook_active) return 0;
	const now = trees(cwd);
	if (!now) return 0;
	const changed = Object.keys({ ...before, ...now }).filter((t) => before[t] !== now[t]);
	if (!changed.length) return 0;
	// Only the status lines that are new since the snapshot: earlier uncommitted work is not the checker's.
	const lines = (s) => (s || '').split('\n#')[0].split('\n').filter(Boolean);
	const detail = changed.map((t) => {
		if (!(t in now)) return `${t}\n  (worktree removed)`;
		const added = lines(now[t]).filter((l) => !lines(before[t]).includes(l));
		return `${t}\n  ${added.length ? added.join('\n  ') : '(a file that was already changed changed again)'}`;
	}).join('\n');
	process.stderr.write(`Files changed in these worktrees while you ran:\n${detail}\nA checker never changes files. Do not restore or delete anything: another agent may be working there. Report each change as a finding - name the worktree, and say whether your own command made it - then finish.\n`);
	return 2;
}

try { process.exitCode = main(); } catch { process.exitCode = 0; }
