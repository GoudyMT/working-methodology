// The sweep guard (rule:sweep-auto-approval). A reviewer agent starts only after approve.mjs cleared a Swarm
// Contract at the HEAD of the checkout it was run in: an APPROVED line, or the script's ASK followed by the owner's
// logged yes. Found in a course project: the lead asked the owner first, and the owner approved a team the script
// would have refused. The guard makes the order mechanical - script first, then the owner only when the script asks.
//
// PreToolUse on Agent and Task; only the reviewer type is gated. The log is approve.mjs's own
// (<git common dir>/kit-sweep-approvals.jsonl), each line chained to the one before; a line that breaks the chain
// clears nothing. HEAD is read from the contract's own folder, so a sweep run from a worktree is judged by that
// worktree. A cleared contract lets in at most as many reviewers as it has roles (counted in
// kit-sweep-starts/ next to the log), plus one more for a role whose crash approve.mjs logged as a retry. A reviewer
// outside a git repository has no log, so it is refused; another agent type is refused only when its brief names a
// sweep or carries a role's call cap.
// It stops slips, not a determined workaround: a carefully forged log line passes it.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
// A log line as an entry: valid JSON that is no object (null, a number, a list) is a hand edit, as a broken line is.
const entry = (line) => { const v = JSON.parse(line); if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an entry'); return v; };
const git = (cwd, ...a) => spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8' });
// HEAD per folder, read once per call: the log only grows, and its lines share a few folders.
const heads = new Map();
const headOf = (d) => { if (!heads.has(d)) heads.set(d, git(d, 'rev-parse', 'HEAD').stdout.trim()); return heads.get(d); };
const deny = (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
const RUN_FIRST = 'Run approve.mjs on the Swarm Contract before any reviewer starts (rule:sweep-auto-approval): `node <pre-pr-sweep skill folder>/approve.mjs <contract.json>` (add `--base <ref>` when it cannot find the base). FIX THE CONTRACT: fix it and run it again. APPROVED: post its start notice and go. ASK THE OWNER: show the table with its reasons and stop.';

// Whether a chained outcome or cut short for this contract came after this clearing.
function closedAfter(lines, i, contract) {
	for (let j = i + 1; j < lines.length; j++) {
		let x;
		try { x = entry(lines[j]); } catch { continue; }
		if (x.prev === sha(lines[j - 1]) && x.contract === contract && (x.kind === 'outcome' || x.kind === 'unread')) return true;
	}
	return false;
}

// Whether approve.mjs logged a retry of this role under this clearing, still open: an outcome or a cut short closes it.
function retryOpen(lines, i, contract, role) {
	let open = false;
	for (let j = i + 1; j < lines.length; j++) {
		let x;
		try { x = entry(lines[j]); } catch { continue; }
		if (x.prev !== sha(lines[j - 1]) || x.contract !== contract) continue;
		if (x.kind === 'outcome' || x.kind === 'unread') open = false;
		else if (x.kind === 'retry' && x.role === role && x.clearing === sha(lines[i])) open = true;
	}
	return open;
}

// Whether a clearing of the same contract, hash and HEAD sits above line i and is still open.
function standing(lines, i, e) {
	for (let k = i - 1; k >= 0; k--) {
		let x;
		try { x = entry(lines[k]); } catch { continue; }
		if (x.contract !== e.contract || x.prev !== (k ? sha(lines[k - 1]) : '')) continue;
		if (x.kind === 'outcome' || x.kind === 'unread') return false;
		if (((x.kind === 'decision' && x.decision === 'approved') || x.kind === 'owner-yes') && x.hash === e.hash && x.head === e.head) return !closedAfter(lines, k, e.contract);
	}
	return false;
}

// The hook's answer for one tool call: a refusal, or nothing. The dispatcher (guard.cjs) calls this.
function check(input) {
	// SendMessage resumes a finished agent with its whole context: for a reviewer that is a review with no clearing,
	// no slot and no spend read (the 1.22.0 sweep, S1). Claude Code's meta file beside the transcript names its type.
	if (input.tool_name === 'SendMessage') {
		const to = String((input.tool_input || {}).to || '');
		if (!/^[A-Za-z0-9_-]{1,64}$/.test(to)) return;
		let meta = {};
		const agentDir = path.join(String(input.transcript_path).replace(/\.jsonl$/, ''), 'subagents');
		// An agent whose transcript is there but whose type cannot be read may be a reviewer (F36, the 1.23.0 sweep). A
		// name with no transcript behind it is a teammate's, and is messaged as before.
		try { meta = JSON.parse(fs.readFileSync(path.join(agentDir, `agent-${to}.meta.json`), 'utf8')); } catch { meta = fs.existsSync(path.join(agentDir, `agent-${to}.jsonl`)) ? { agentType: 'reviewer' } : {}; }
		if (!meta || typeof meta !== 'object') meta = { agentType: 'reviewer' };
		// A reviewer is also addressed by the name its meta file gives it (the 1.24.0 sweep): any agent of this session
		// by that name that is a reviewer, or whose meta cannot be read, is refused.
		if (!meta.agentType) {
			let files = [];
			try { files = fs.readdirSync(agentDir).filter((f) => f.endsWith('.meta.json')); } catch { /* no agents yet */ }
			for (const f of files) {
				let m = null;
				try { m = JSON.parse(fs.readFileSync(path.join(agentDir, f), 'utf8')); } catch { /* unreadable: checked below by name only */ }
				if (m && m.name === to && /(^|:)reviewer$/i.test(String(m.agentType || ''))) { meta = m; break; }
			}
		}
		if (/(^|:)reviewer$/i.test(String(meta.agentType || ''))) return deny('A sweep reviewer is never resumed: its spend was read for the sweep it ran. A new question is a new reviewer under a cleared contract.');
		return;
	}
	if (!/(^|:)reviewer$/i.test(String((input.tool_input || {}).subagent_type || ''))) {
		// A brief that names a sweep or carries a role's call cap is a reviewer's whatever the type says, and a slip
		// here would run with no slot and no cap.
		const brief = String((input.tool_input || {}).prompt || '');
		if (/Sweep: [0-9a-f]{16} role \d+/.test(brief)) return deny('This brief names a sweep, so it runs as the reviewer role: set subagent_type to reviewer.');
		if (/Call cap: \d+/.test(brief)) return deny('This brief carries a sweep role\'s call cap, so it runs as the reviewer role: set subagent_type to reviewer, with its "Sweep: <hash> role <n>" line.');
		return;
	}
	const common = git(input.cwd || process.cwd(), 'rev-parse', '--path-format=absolute', '--git-common-dir');
	// A sweep runs in a repository: a reviewer started outside one has no log to clear it.
	if (common.status !== 0) return deny(`A reviewer starts from the repository its Swarm Contract was cleared in, and this folder is in none. ${RUN_FIRST}`);
	const dir = common.stdout.trim();
	const file = path.join(dir, 'kit-sweep-approvals.jsonl');
	const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
	// The latest decision or owner's yes whose contract's checkout is still at the HEAD it was cleared for decides.
	for (let i = lines.length - 1; i >= 0; i--) {
		let e;
		try { e = entry(lines[i]); } catch { continue; }
		if ((e.kind !== 'decision' && e.kind !== 'owner-yes') || typeof e.contract !== 'string') continue;
		if (e.prev !== (i ? sha(lines[i - 1]) : '')) continue;
		if (!e.head || headOf(path.dirname(e.contract)) !== e.head) continue;
		let raw = null;
		try { raw = fs.readFileSync(e.contract, 'utf8'); } catch { /* moved or deleted */ }
		if (raw === null || sha(raw) !== e.hash) return deny(`The Swarm Contract changed or moved after the script ran. ${RUN_FIRST}`);
		// A line after the clearing that breaks the chain is a hand edit, and approve.mjs pauses on it: so does the guard.
		for (let j = i + 1; j < lines.length; j++) {
			let x = null;
			try { x = entry(lines[j]); } catch { /* a hand edit */ }
			if (!x || x.prev !== sha(lines[j - 1])) return deny(`The approval log was changed by hand at line ${j + 1}, after this clearing. The owner resumes the sweep tools (approve.mjs --resume), then ${RUN_FIRST}`);
		}
		if (e.kind === 'decision' && e.decision === 'refused') {
			return deny('approve.mjs refused this contract: a re-sweep the owner allowed is the last pass, and a further one is the owner\'s (a plain contract on this branch asks them). What it left at medium or below goes to the handoff\'s carry-overs for the next feature build, and a high or critical is fixed or the owner accepts it; log the re-sweep\'s outcome with --carried <n>.');
		}
		// A rerun on the same contract, unchanged at the same HEAD, while its clearing stands open (no outcome yet) is told
		// to log that outcome first; its line does not shut the clearing on the roles still to start (1.21.0 item 35).
		if (e.kind === 'decision' && e.decision !== 'approved' && e.decision !== 'refused' && standing(lines, i, e)) continue;
		if (e.kind === 'decision' && e.decision === 'fix') {
			return deny(`approve.mjs answered FIX THE CONTRACT: fix what it named, then run it again. ${RUN_FIRST}`);
		}
		if (e.kind === 'decision' && e.decision !== 'approved') {
			return deny('approve.mjs sent this contract to the owner. Show the owner the table with its reasons; the owner answers in the thread "yes <the ask\'s code>", and the lead logs it with `node <pre-pr-sweep skill folder>/approve.mjs <contract.json> --owner-yes "yes <code>" --thread <their message id>`, then starts the reviewers.');
		}
		// The budget rests on the call cap, so a brief must carry one the contract set; the call-cap hook reads it there.
		const prompt = String((input.tool_input || {}).prompt || '');
		const cap = prompt.match(/Call cap: (\d+)/);
		if (Array.isArray(e.calls) && !(cap && e.calls.includes(Number(cap[1])))) return deny(`A reviewer's brief carries its role's call cap, as the line "Call cap: <n>", from the cleared contract (${[...new Set(e.calls)].join(', ')}): the sweep skill has the wording.`);
		// The brief names this contract and its role, so its spend is read for the right role and contract.
		const team = Number(e.agents) || 0;
		const tag = prompt.match(/Sweep: ([0-9a-f]{16}) role (\d+)/);
		const n = tag ? Number(tag[2]) - 1 : -1;
		if (!tag || tag[1] !== e.hash || !(n >= 0 && n < team)) return deny(`A reviewer's brief names its sweep and role, as the line "Sweep: ${e.hash} role <n>" (n from 1 to ${team}, the role's place in the cleared contract): the sweep skill has the wording.`);
		// Each role's slot takes only its own cap, so one role cannot borrow another's.
		if (Array.isArray(e.calls) && e.calls[n] !== Number(cap[1])) return deny(`Role ${n + 1} of the cleared contract has a call cap of ${e.calls[n]}, not ${cap[1]}: the brief carries its own role's cap.`);
		// The call-cap hook stops a reviewer at the token ceiling its brief carries, so the brief carries its role's own.
		const ceiling = prompt.match(/Token ceiling: (\d+)/);
		// An owner's yes cleared an ask, and the ask's decision set the ceilings: a yes line without them still has them.
		let ceilings = e.ceilings;
		for (let k = i - 1; k >= 0 && !Array.isArray(ceilings) && e.kind === 'owner-yes'; k--) {
			let d = null;
			try { d = entry(lines[k]); } catch { /* checked above */ }
			if (d && d.kind === 'decision' && d.contract === e.contract && d.hash === e.hash) ceilings = d.ceilings;
		}
		if (Array.isArray(ceilings) && !(ceiling && Number(ceiling[1]) === ceilings[n])) return deny(`A reviewer's brief carries its role's token ceiling, as the line "Token ceiling: <n>", from the cleared contract (role ${n + 1}: ${ceilings[n]}): the start notice has it.`);
		// The slot is for this role's review of this checkout: a brief carries its question, and runs where it was cleared.
		const question = String((JSON.parse(raw).roles?.[n] || {}).question || '');
		if (question && !prompt.includes(question)) return deny(`A reviewer's brief carries its role's question as the contract wrote it. Role ${n + 1}: "${question}"`);
		// A lead in another checkout may run a worktree's sweep, so long as the brief sends the reviewer there.
		if (headOf(input.cwd || process.cwd()) !== e.head) {
			const root = git(path.dirname(e.contract), 'rev-parse', '--show-toplevel').stdout.trim();
			// Named whole: the folder or a path inside it, never the start of another folder's name (repo-old, repo2).
			const named = (text) => { const t = text.split('\\').join('/').toLowerCase(); const r = root.toLowerCase(); for (let k = t.indexOf(r); k >= 0; k = t.indexOf(r, k + 1)) { const next = t.slice(k + r.length, k + r.length + 2); if (!/^[\w-]/.test(next) && !/^\.[\w.-]/.test(next)) return true; } return false; };
			if (!root || !named(prompt)) return deny(`This reviewer would start from a checkout that is not at the cleared HEAD ${e.head}: start it from ${root || 'the checkout the contract was cleared in'}, or name that folder in its brief.`);
		}
		// A closed round has no starts left: an outcome, a none-ran or a cut short ends its clearance.
		if (closedAfter(lines, i, e.contract)) return deny(`This sweep's outcome is logged, so its clearance is closed. ${RUN_FIRST}`);
		// Each start claims its role's slot file; creating it fails if it exists, so a role starts once.
		const slots = path.join(dir, 'kit-sweep-starts', sha(lines[i]));
		try { fs.mkdirSync(slots, { recursive: true }); } catch { return deny(`The guard could not record this start in ${slots}, so it cannot hold the role to one start. Fix that folder, then start again.`); }
		// The slot holds the start's tool id, which Claude Code writes into the reviewer's meta file: the outcome counts
		// that reviewer only, so a decoy with the same brief cannot stand in.
		const claim = (name) => { const fd = fs.openSync(path.join(slots, name), 'wx'); try { fs.writeSync(fd, String(input.tool_use_id || '')); } finally { fs.closeSync(fd); } };
		try { claim(String(n)); return; } catch { /* taken */ }
		// A logged retry opens one more slot for its own role, claimed the same way.
		if (retryOpen(lines, i, e.contract, n + 1)) {
			try { claim(`${n}.retry`); return; } catch { /* taken */ }
			return deny(`Role ${n + 1} has used its one retry. A further crash is the owner's: \`approve.mjs <contract.json> --outcome --cut-short\`, and the next contract asks them.`);
		}
		return deny(`Role ${n + 1} of the cleared contract has started already. If its reviewer crashed: \`approve.mjs <contract.json> --retry ${n + 1} --crashed <id>\`. A further reviewer needs a contract that includes it: ${RUN_FIRST}`);
	}
	return deny(`No cleared Swarm Contract at its checkout's current HEAD. ${RUN_FIRST}`);
}

// Anything unexpected lets the call through.
const safeCheck = (input) => { try { return check(input) || null; } catch { return null; } };
if (require.main === module) {
	let out = null;
	try { out = safeCheck(JSON.parse(fs.readFileSync(0, 'utf8') || '{}')); } catch { /* lets it through */ }
	if (out) process.stdout.write(JSON.stringify(out));
}

module.exports = { check: safeCheck };
