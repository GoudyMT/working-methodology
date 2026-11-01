// The sweep guard (rule:sweep-auto-approval). A reviewer agent starts only after approve.mjs cleared a Swarm
// Contract at the HEAD of the checkout it was run in: an APPROVED line, or the script's ASK followed by the owner's
// logged yes. Found in a course project: the lead asked the owner first, and the owner approved a team the script
// would have refused. The guard makes the order mechanical - script first, then the owner only when the script asks.
//
// PreToolUse on Agent and Task; only the reviewer type is gated. The log is approve.mjs's own
// (<git common dir>/kit-sweep-approvals.jsonl), each line chained to the one before; a line that breaks the chain
// clears nothing. HEAD is read from the contract's own folder, so a sweep run from a worktree is judged by that
// worktree, and a checkout with sweeps of its own is judged by its own lines only. A cleared contract lets in at
// most as many reviewers as it has roles (counted in
// kit-sweep-starts/ next to the log). Outside a git repository there is no log, so the call goes through.
// It stops slips, not a determined workaround: a carefully forged log line passes it.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const git = (cwd, ...a) => spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8' });
const deny = (reason) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
const RUN_FIRST = 'Run approve.mjs on the Swarm Contract before any reviewer starts (rule:sweep-auto-approval): `node <pre-pr-sweep skill folder>/approve.mjs <contract.json>` (add `--base <ref>` when it cannot find the base). APPROVED: post its start notice and go. ASK THE OWNER: show the table with its reasons and stop.';

function main() {
	const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
	if (!/(^|:)reviewer$/i.test(String((input.tool_input || {}).subagent_type || ''))) return;
	const common = git(input.cwd || process.cwd(), 'rev-parse', '--path-format=absolute', '--git-common-dir');
	if (common.status !== 0) return;
	const dir = common.stdout.trim();
	const file = path.join(dir, 'kit-sweep-approvals.jsonl');
	const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
	// The log is shared by every worktree of the repo. A checkout with sweeps of its own is judged by its own lines only:
	// taking the newest line from any worktree once let a worktree whose contract was refused start reviewers on
	// another's approval. A checkout with none (the lead's session in the main checkout) still reads them all.
	const top = (cwd) => git(cwd, 'rev-parse', '--show-toplevel').stdout.trim().toLowerCase();
	const here = top(input.cwd || process.cwd());
	const tops = lines.map((l) => { try { const e = JSON.parse(l); return typeof e.contract === 'string' ? top(path.dirname(e.contract)) : null; } catch { return null; } });
	const own = tops.includes(here);
	// The latest decision or owner's yes whose contract's checkout is still at the HEAD it was cleared for decides.
	for (let i = lines.length - 1; i >= 0; i--) {
		let e;
		try { e = JSON.parse(lines[i]); } catch { continue; }
		if ((e.kind !== 'decision' && e.kind !== 'owner-yes') || typeof e.contract !== 'string') continue;
		if (own && tops[i] !== here) continue;
		if (e.prev !== (i ? sha(lines[i - 1]) : '')) continue;
		if (!e.head || git(path.dirname(e.contract), 'rev-parse', '--short', 'HEAD').stdout.trim() !== e.head) continue;
		let raw = null;
		try { raw = fs.readFileSync(e.contract, 'utf8'); } catch { /* moved or deleted */ }
		if (raw === null || sha(raw) !== e.hash) return deny(`The Swarm Contract changed or moved after the script ran. ${RUN_FIRST}`);
		if (e.kind === 'decision' && e.decision !== 'approved') {
			return deny('approve.mjs sent this contract to the owner. Show the owner the table with its reasons; on their yes, log it with `node <pre-pr-sweep skill folder>/approve.mjs <contract.json> --owner-yes "<their words>"`, then start the reviewers.');
		}
		// Each start claims one numbered slot file; creating it fails if it exists, so reviewers started at the same
		// moment cannot share a slot.
		const slots = path.join(dir, 'kit-sweep-starts', sha(lines[i]));
		const team = Number(e.agents) || 0;
		fs.mkdirSync(slots, { recursive: true });
		for (let n = 0; n < team; n++) {
			try { fs.closeSync(fs.openSync(path.join(slots, String(n)), 'wx')); return; } catch { /* taken */ }
		}
		return deny(`The cleared contract has ${team} reviewer role(s), and all have started. A further reviewer needs a contract that includes it: ${RUN_FIRST}`);
	}
	return deny(`No cleared Swarm Contract at its checkout's current HEAD. ${RUN_FIRST}`);
}

try { main(); } catch { /* anything unexpected lets the call through */ }
