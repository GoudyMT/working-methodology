'use strict';
// K176 (build 23b): the owner's yes from a card, for a cloud worker. A cloud worker has no pop-up, so the owner taps
// Yes on the lead thread's card, and the lead turns that tap into a one-time grant (grant.mjs): bound to one worker
// session, one tool and the exact act the guard quoted, good for one hour (the pop-up yes's own limit), spent on first
// use. The launcher (kit-launch.cjs, and the plugin launcher) lifts one "Owner's yes needed" hold with it, never a
// subagent's call and never any other refusal.
// Limits: the grants folder is on the same machine and user as the worker. The guards refuse a tool write there and
// any runtime call that names the grant code, and the content hash catches a hand edit, but a program that writes a
// whole new grant some other way is not stopped (the hash has no key the worker cannot read): a slip-catcher like the
// pop-up path, not a lock.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { actText, FRESH_MS } = require('./owner-yes.cjs');

const DIR = 'kit-grants';
const SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CARD = /^[A-Za-z0-9_.:-]{1,200}$/;
const TOOL = /^[A-Za-z0-9_]{1,100}$/;
const ID = /^[0-9a-f]{32}$/;
const ASK = "Owner's yes needed: ";
// The same squash the guards match an act by (owner-yes.cjs): runs of spaces and tabs read as one, ends trimmed.
const squash = (s) => String(s).replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
const homeOf = (env = process.env) => env.KIT_CLAUDE_HOME || env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const hashOf = (g) => crypto.createHash('sha256').update(JSON.stringify(['kit-grant/1', g.id, g.session, g.tool, g.act, g.card, g.at])).digest('hex');

// The lead's side: one grant, written whole or not at all (a temp file renamed into place).
function writeGrant({ home = homeOf(), session, tool, act, card, now = Date.now() }) {
	const a = squash(act || '');
	if (!SESSION.test(String(session || ''))) throw new Error('the session id is not a session id');
	if (!TOOL.test(String(tool || ''))) throw new Error('the tool is not a tool name');
	if (!CARD.test(String(card || ''))) throw new Error('the card id holds a sign a card id never has');
	if (!a || a.includes('`')) throw new Error('the act is empty or holds a backtick, which no guard can quote');
	const dir = path.join(home, DIR);
	fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
	if (fs.lstatSync(dir).isSymbolicLink()) throw new Error(`${dir} is a link`);
	const g = { id: crypto.randomBytes(16).toString('hex'), session: String(session), tool: String(tool), act: a, card: String(card), at: new Date(now).toISOString() };
	g.hash = hashOf(g);
	const tmp = path.join(dir, `.${g.id}.tmp`);
	fs.writeFileSync(tmp, JSON.stringify(g), { flag: 'wx', mode: 0o600 });
	fs.renameSync(tmp, path.join(dir, `${g.id}.json`));
	return g;
}

// Whether the refusal holds only for the owner's yes: every merged reason (guard.cjs joins them with " | ") opens with
// "Owner's yes needed". The act each one quotes may hold " | " itself, so its quote is taken out first; anchored on the
// words before the quote, a quote can never reach across into the next reason.
function onlyAsks(reason, act) {
	const quote = `code span: \`${act}\``;
	const parts = String(reason).split(quote).join('code span: <act>').split(' | ');
	return parts.every((p) => p.startsWith(ASK));
}

// One grant read from its file: whole, unedited, a plain file (never a link), or null.
function readGrant(dir, name) {
	const file = path.join(dir, name);
	const st = fs.lstatSync(file);
	if (!st.isFile() || st.size > 64 * 1024) return null;
	const g = JSON.parse(fs.readFileSync(file, 'utf8'));
	if (!g || g.id !== name.slice(0, -5) || g.hash !== hashOf(g)) return null;
	return g;
}

/**
 * The launcher's answer, with one "Owner's yes needed" hold lifted by a matching grant, or the answer unchanged.
 *
 * Args:
 *     answer: the guard's merged answer for this call
 *     input: the hook input
 *     home: the Claude folder that holds kit-grants/
 *     now: the clock (tests)
 */
function lift(answer, input, home, now = Date.now()) {
	try {
		const h = answer && answer.hookSpecificOutput;
		if (!h || h.permissionDecision !== 'deny' || !input || input.agent_id) return answer;
		const act = actText(input);
		const session = String(input.session_id || '');
		const tool = String(input.tool_name || '');
		if (!act || act.includes('`') || !SESSION.test(session) || !onlyAsks(h.permissionDecisionReason || '', act)) return answer;
		const dir = path.join(home, DIR);
		const st = fs.lstatSync(dir);
		if (!st.isDirectory()) return answer;
		for (const name of fs.readdirSync(dir).filter((n) => /^[0-9a-f]{32}\.json$/.test(n)).sort()) {
			let g = null;
			try { g = readGrant(dir, name); } catch { continue; }
			if (!g || g.session !== session || g.tool !== tool || g.act !== act || !CARD.test(String(g.card))) continue;
			const at = Date.parse(g.at);
			// Fresh for an hour from the tap; a grant dated ahead of this clock is no grant.
			if (!Number.isFinite(at) || now < at || now - at > FRESH_MS) continue;
			// Spent before it is used, made whole or not at all: of two calls racing for it, one creates the mark.
			try { fs.writeFileSync(path.join(dir, `${g.id}.spent`), String(input.tool_use_id || ''), { flag: 'wx' }); } catch { continue; }
			const note = `Kit: the owner's yes from card ${g.card} was used for this act, once.`;
			return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: note, additionalContext: [note, h.additionalContext].filter(Boolean).join(' ') } };
		}
	} catch { /* a missing, unreadable or bad grants folder leaves the hold in place */ }
	return answer;
}

// A worker runs no grant.mjs: a grant is the lead's record of the owner's tap, and a session that wrote its own would
// be its own yes. Held from any kit-guarded session (the lead is a cloud thread the kit does not guard).
function runsGrantTool(input) {
	if (!input || !['Bash', 'PowerShell', 'Monitor', 'mcp__terminal__run_in_terminal'].includes(String(input.tool_name))) return null;
	const command = String((input.tool_input && input.tool_input.command) ?? '');
	// The build 23b sweep: a run keyed on "node ... grant.mjs" missed its library (node -e require), a copy, a quoted
	// node path and a pipe into node. Any command that starts a JavaScript runtime and names the grant code or its folder
	// is held; naming the files with no runtime (git add, a read) is no run.
	const flat = command.replace(/["'`\\]/g, ' ');
	if (!/(^|[^A-Za-z0-9_])(node|nodejs|bun|deno)(\.exe)?([^A-Za-z0-9_]|$)/i.test(flat) || !/(^|[^A-Za-z0-9_.-])grant\.mjs\b|owner-grant\.cjs|writeGrant|kit-grants/i.test(flat)) return null;
	return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Never by a tool: grant.mjs records the owner\'s tap on a card, so only the lead thread runs it, never a session the kit guards. Hand the act back to the lead, quoted exactly.' } };
}

module.exports = { lift, writeGrant, runsGrantTool, homeOf, onlyAsks, FRESH_MS, DIR };
