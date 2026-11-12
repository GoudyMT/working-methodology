'use strict';
// The one guard process (T2, the owner 2026-11-10: "One process, every tool"). Claude Code runs this once per tool
// call; it reads the hook input once and asks each guard in the same process, where 1.24.0 started five node processes
// for a Bash call (209 ms summed on Windows, workbench results/v2-prep B0).
//   project guards (this folder): owner-proof, task-gate, guard-outward, guard-delete. One missing or broken refuses
//     the call, with the fix: they hold the owner's acts, so they fail closed.
//   agent-team checks (the Claude folder's kit-hooks): call-cap, canary, sweep-guard. One missing is skipped: they
//     are slip-catchers for agent teams, and a broken user layer must never stop the session (teardown, "brick mode").
// The answers are merged the way Claude Code merges several hooks: a refusal wins, then an ask, then an allow (only an
// owner's pop-up yes allows); the added context of each is kept.
// Usage: the launcher in the Claude config folder (kit-tools/kit-launch.cjs, V3 in 1.25.1) loads this file after it has
// checked every guard file against the record outside the project; the project's own settings no longer run it.
const fs = require('fs');
const path = require('path');

// install project fills this in: where the user layer's kit-hooks sit.
const INSTALLED_HOME = "{{CLAUDE_HOME}}";
const SHELLS = ['Bash', 'PowerShell', 'Monitor', 'mcp__terminal__run_in_terminal'];
const WRITES = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
const AGENTS = ['Agent', 'Task'];

// Which guard reads which tool, as the separate hook entries did before.
const PROJECT = [
	['owner-proof.cjs', (t) => WRITES.includes(t) || SHELLS.includes(t)],
	['task-gate.cjs', (t) => SHELLS.includes(t) || AGENTS.includes(t)],
	['guard-outward.cjs', (t) => SHELLS.includes(t)],
	['guard-delete.cjs', (t) => SHELLS.includes(t)],
];
const USER = [
	// Only an agent is held to a call cap; the main session pays nothing for it.
	['call-cap.cjs', (t, input) => Boolean(input.agent_id)],
	['canary.cjs', (t) => AGENTS.includes(t) || t === 'SendMessage'],
	['sweep-guard.cjs', (t) => AGENTS.includes(t) || t === 'SendMessage'],
];

const refuse = (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });

function userHooks() {
	const home = INSTALLED_HOME.startsWith('{' + '{') ? process.env.KIT_CLAUDE_HOME || process.env.CLAUDE_CONFIG_DIR || path.join(require('os').homedir(), '.claude') : INSTALLED_HOME;
	return path.join(home, 'kit-hooks');
}

// Every answer for this call, in order: [name, output or null].
function answers(input) {
	const tool = String(input.tool_name || '');
	const out = [];
	for (const [file, reads] of PROJECT) {
		if (!reads(tool, input)) continue;
		try {
			out.push([file, require(path.join(__dirname, file)).check(input)]);
		} catch (e) {
			out.push([file, refuse(`Held: the kit guard ${file} could not run (${String(e && e.message).slice(0, 120)}). The owner reinstalls the kit with install project.`)]);
		}
	}
	// The kit hooks run only with the bytes install user recorded (B23, and the 1.26.0 sweep: one in the old shape ran
	// as its own process, past the loader's check). A changed or unrecorded one is skipped, never run.
	let stamp = {};
	try { stamp = JSON.parse(fs.readFileSync(path.join(path.dirname(userHooks()), 'kit-install.json'), 'utf8')).files || {}; } catch { /* none */ }
	for (const [file, reads] of USER) {
		if (!reads(tool, input)) continue;
		const where = path.join(userHooks(), file);
		if (!fs.existsSync(where)) continue;
		try {
			const bytes = fs.readFileSync(where);
			// A kit hook kept or merged by hand no longer matches what install user recorded: it is skipped, and the session
			// is told so, never left to lose it in silence (the 1.26.0 sweep, C12).
			if (require('crypto').createHash('sha256').update(bytes).digest('hex') !== stamp[`kit-hooks/${file}`]) {
				out.push([file, { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: `Kit: the kit hook ${file} differs from what install user recorded, so it did not run; the owner runs install user to put it back.` } }]);
				continue;
			}
			const text = bytes.toString('utf8');
			// A user layer from before the one process (1.24.0) has hooks that read stdin and export no check: loading one
			// would run it here with no input, so it runs as its own process, from the checked bytes (the 1.25.0 sweep).
			if (/\bexports\.check\b|module\.exports\s*=\s*\{[^}]*\bcheck\b/.test(text)) out.push([file, require(where).check(input)]);
			else {
				const r = require('child_process').spawnSync(process.execPath, ['-e', text], { input: JSON.stringify(input), encoding: 'utf8', timeout: 5000 });
				out.push([file, r.stdout && r.stdout.trim() ? JSON.parse(r.stdout) : null]);
			}
		} catch { /* a slip-catcher that fails lets the call through */ }
	}
	return out;
}

// The merged answer: the strictest decision, with every reason that holds it and every note.
function merge(list) {
	const outs = list.map(([, o]) => o && o.hookSpecificOutput).filter(Boolean);
	const rank = { deny: 3, ask: 2, allow: 1 };
	let decision = '';
	for (const o of outs) if (o.permissionDecision && (rank[o.permissionDecision] || 0) > (rank[decision] || 0)) decision = o.permissionDecision;
	const notes = outs.map((o) => o.additionalContext).filter(Boolean);
	if (!decision && notes.length === 0) return null;
	const h = { hookEventName: 'PreToolUse' };
	if (decision) {
		h.permissionDecision = decision;
		h.permissionDecisionReason = outs.filter((o) => o.permissionDecision === decision).map((o) => o.permissionDecisionReason).join(' | ');
	}
	if (notes.length) h.additionalContext = notes.join(' ');
	return { hookSpecificOutput: h };
}

function check(input) {
	if (!input || typeof input !== 'object') return refuse('Held: the kit guard could not read this call.');
	return merge(answers(input));
}

if (require.main === module) {
	let input = null;
	try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { /* held below */ }
	const out = check(input);
	if (out) process.stdout.write(JSON.stringify(out));
}

// The guard files that read a tool call, by name, for the wiring tests.
const routes = (tool, input = {}) => [...PROJECT, ...USER].filter(([, reads]) => reads(tool, input)).map(([file]) => file);

module.exports = { check, merge, routes };
