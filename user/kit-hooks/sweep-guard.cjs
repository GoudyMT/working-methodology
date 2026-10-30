// The sweep guard (rule:sweep-auto-approval). A reviewer agent starts only after approve.mjs cleared the Swarm
// Contract for this HEAD: an APPROVED line, or the script's ASK followed by the owner's logged yes. Found in a course
// project: the lead asked the owner first, and the owner approved a team the script would have refused. The guard
// makes the order mechanical - script first, then the owner only when the script asks.
//
// PreToolUse on Agent and Task. Only the reviewer type is gated. The log is approve.mjs's own
// (<git common dir>/kit-sweep-approvals.jsonl), each line chained to the one before; a line that breaks the chain
// clears nothing. Outside a git repository there is no log to read, so the call goes through.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const deny = (reason) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
const RUN_FIRST = 'Run approve.mjs on the Swarm Contract before any reviewer starts (rule:sweep-auto-approval): `node <pre-pr-sweep skill folder>/approve.mjs <contract.json>`. APPROVED: post its start notice and go. ASK THE OWNER: show the table with its reasons and stop.';

function main() {
	const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
	if ((input.tool_input || {}).subagent_type !== 'reviewer') return;
	const cwd = input.cwd || process.cwd();
	const git = (...a) => spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8' });
	const common = git('rev-parse', '--path-format=absolute', '--git-common-dir');
	if (common.status !== 0) return;
	const head = git('rev-parse', '--short', 'HEAD').stdout.trim();
	const file = path.join(common.stdout.trim(), 'kit-sweep-approvals.jsonl');
	const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
	// The latest decision or owner's yes for this HEAD decides; a line off the chain is skipped.
	for (let i = lines.length - 1; i >= 0; i--) {
		let e;
		try { e = JSON.parse(lines[i]); } catch { continue; }
		if (e.kind !== 'decision' && e.kind !== 'owner-yes') continue;
		if (e.head !== head) continue;
		if (e.prev !== (i ? sha(lines[i - 1]) : '')) continue;
		let raw = null;
		try { raw = fs.readFileSync(e.contract, 'utf8'); } catch { /* moved or deleted */ }
		if (raw === null || sha(raw) !== e.hash) return deny(`The Swarm Contract changed or moved after the script ran. ${RUN_FIRST}`);
		if (e.kind === 'owner-yes' || e.decision === 'approved') return;
		return deny('approve.mjs sent this contract to the owner. Show the owner the table with its reasons; on their yes, log it with `node <pre-pr-sweep skill folder>/approve.mjs <contract.json> --owner-yes "<their words>"`, then start the reviewers.');
	}
	return deny(`No approval for this HEAD (${head || 'none'}). ${RUN_FIRST}`);
}

try { main(); } catch { /* anything unexpected lets the call through */ }
