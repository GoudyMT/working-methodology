// The agent canary (rule:agent-canary). Each kit agent opens every message to whoever started it with a phrase that
// lives only on the last line of the project's "Rules every brief carries" block, which the agent must open with
// Read. Role files and preloaded skills are injected automatically, so the phrase never goes there.
//
// Two jobs, by event:
// - Stop (SubagentStop for an agent): the agent's last message must open with the phrase. A miss blocks the stop
//   once with close-out steps that never name the phrase; the stop after the canary's own block goes through.
//   Every result is logged to <git common dir>/kit-canary.log, one JSON line each, for the run record.
// - PreToolUse on Agent, Task and SendMessage (the leak guard): a brief or message that carries the phrase is
//   denied and logged, so no tasker can hand an agent the phrase it is meant to find by reading.
// A project with no phrase line has the check off. Anything unexpected lets the call through: the checker and the
// lead's review still stand behind it.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const git = (cwd, ...a) => spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8' });
// One spelling for comparing: lower case letters and digits in any script, every run of anything else as one space. Markdown
// around the phrase (bold, a quote, a heading) and hyphens inside it then compare the same; the space padding
// keeps a word boundary on both sides.
const words = (s) => ` ${String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;

// The phrase lives in the file the agent is sent to: the one the rule index names for rule:agent-team-adapter
// (a project may fill its adapter in its own module), else the kit's agent-teams module. It is read from the main
// checkout, so an agent in a worktree (where the notes may be untracked) finds it.
function findPhrase(cwd) {
	const common = git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir');
	if (common.status !== 0) return null;
	const commonDir = common.stdout.trim();
	const root = path.dirname(commonDir);
	let file = 'standards/agent-teams.md';
	const index = path.join(root, 'standards', 'INDEX.md');
	if (fs.existsSync(index)) {
		const row = fs.readFileSync(index, 'utf8').match(/^\|\s*agent-team-adapter\s*\|[^|\n]*\|\s*`([^`]+)`/m);
		if (row) file = row[1];
	}
	const p = path.join(root, file);
	if (!fs.existsSync(p)) return null;
	const m = fs.readFileSync(p, 'utf8').match(/^\s*Confirmation phrase: .* with: (.+?)\s*$/m);
	return m && words(m[1]).trim() ? { phrase: m[1], commonDir } : null;
}

function log(commonDir, entry) {
	try { fs.appendFileSync(path.join(commonDir, 'kit-canary.log'), JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n'); } catch { /* a log that cannot be written never blocks the work */ }
}

const CLOSE_OUT = [
	'Your message did not open the way your rules require, so this run is void (rule:agent-canary). Close out now:',
	'1. Stop editing. Commit nothing half-done, and leave your changes where they are.',
	'2. Send your close-out note as your report (your reply, or your hand-back). First line: "Closed out: <unit id>". Then: what is done, what is half-done,',
	'   the next step, the files touched (from `git status`), and the last test run and its result.',
	'3. Then stop. The one who started you saves the hand-off and starts a fresh agent from your note.',
].join('\n');

// The agent's final report. A text reply arrives as last_assistant_message. Where the agent hands its report back
// through a tool call instead (the desktop app's hand-back tool), the stop event carries no text, so the report is
// read from the end of the agent's own transcript, within its latest turn only: walking back past tool results and
// thinking-only entries, the first assistant entry with content decides. Its hand-back message is the report; else
// its text, when it calls no tool (text before a tool call is narration). A message to another agent is never the
// report. Null when there is no report to read (logged "unchecked").
function finalReport(input) {
	if (typeof input.last_assistant_message === 'string' && input.last_assistant_message.trim()) return input.last_assistant_message;
	let lines;
	try { lines = fs.readFileSync(input.agent_transcript_path, 'utf8').split('\n'); } catch { return null; }
	for (let i = lines.length - 1; i >= 0; i--) {
		let entry;
		try { entry = JSON.parse(lines[i]); } catch { continue; } // a half-written line
		const content = entry.message && entry.message.content;
		if (entry.type === 'user') {
			// Tool results (with any note riding on them) and hook notes are not a new prompt.
			if (entry.isMeta || (Array.isArray(content) && content.some((b) => b.type === 'tool_result'))) continue;
			return null; // a real prompt: the latest turn has no report yet
		}
		if (entry.type !== 'assistant' || !Array.isArray(content)) continue;
		if (content.every((b) => b.type === 'thinking' || b.type === 'redacted_thinking')) continue;
		const handback = content.find((b) => b.type === 'tool_use' && b.name === 'SubagentHandback' && b.input && typeof b.input.message === 'string');
		if (handback) return handback.input.message;
		if (content.some((b) => b.type === 'tool_use')) return null;
		const text = content.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
		return text.trim() ? text : null;
	}
	return null;
}

// Kit roles that report up and task no one; an orchestrator and the main session are taskers.
const REPORTING_ROLES = ['builder', 'checker', 'scanner', 'reviewer'];

// One event's answer: { out } for a tool call to refuse, { code: 2 } for a stop to hold. The dispatcher (guard.cjs)
// calls it for tool calls; Claude Code runs this file itself for the stop events.
function run(input) {
	const cwd = input.cwd || process.cwd();
	const found = findPhrase(cwd);
	if (!found) return {};
	const phrase = words(found.phrase);

	const who = { role: input.agent_type || 'unknown', agent: input.agent_id || '', session: input.session_id || '' };
	const key = (who.agent || `${who.session}-${who.role}`).replace(/[^\w.-]/g, '_');
	// The canary's own block leaves a mark, so the report after it is told apart from a first report (and a stop that
	// another hook, like the checker's clean-tree stop, blocked; stop_hook_active alone cannot tell them apart).
	const mark = path.join(found.commonDir, 'kit-canary-blocked', key);
	// A hand-back already checked at its call leaves a seen mark, so the stops after it (one more if another hook,
	// like the checker's clean-tree stop, blocks the first) add nothing to the log. The next hand-back is checked anew.
	const seen = path.join(found.commonDir, 'kit-canary-seen', key);
	const touch = (f) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ''); };

	// The desktop app's hand-back: the report is the call's own message. Checked here, at the call, because the stop
	// event fires before the hand-back reaches the agent's transcript (captured live).
	if (input.hook_event_name === 'PreToolUse' && input.tool_name === 'SubagentHandback') {
		const report = String((input.tool_input || {}).message || '');
		if (fs.existsSync(mark)) {
			fs.rmSync(mark, { force: true });
			touch(seen);
			log(found.commonDir, { ...who, result: /^\W*closed out\b/i.test(report) ? 'closed-out' : 'void-after-miss' });
			return {};
		}
		const opens = words(report).startsWith(phrase);
		log(found.commonDir, { ...who, result: opens ? 'hit' : 'miss' });
		if (opens) { touch(seen); return {}; }
		touch(mark);
		return { out: { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: CLOSE_OUT } } };
	}

	if (input.hook_event_name === 'PreToolUse') {
		const t = input.tool_input || {};
		// An agent's own message to its tasker opens with the phrase, as its rules say: that is the check, not a leak.
		const ownReport = input.tool_name === 'SendMessage' && REPORTING_ROLES.includes(input.agent_type) && words(t.message).startsWith(phrase);
		if (!ownReport && words([t.prompt, t.message, t.description, t.name].filter(Boolean).join(' ')).includes(phrase)) {
			log(found.commonDir, { tool: input.tool_name || 'unknown', session: input.session_id || '', result: 'leak-refused' });
			return { out: { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
				permissionDecisionReason: 'A brief or message to an agent must never carry the confirmation phrase: the agent finds it by reading its rules (rule:agent-canary). Remove it and send again.' } } };
		}
		return {};
	}

	if (fs.existsSync(seen)) return {};
	if (fs.existsSync(mark)) {
		fs.rmSync(mark, { force: true });
		// The agent was told to close out, so it may end; any other report after a miss is void all the same.
		log(found.commonDir, { ...who, result: /^\W*closed out\b/i.test(finalReport(input) || '') ? 'closed-out' : 'void-after-miss' });
		return {};
	}
	const report = finalReport(input);
	if (report === null) { log(found.commonDir, { ...who, result: 'unchecked' }); return {}; }
	const opens = words(report).startsWith(phrase);
	log(found.commonDir, { ...who, result: opens ? 'hit' : 'miss' });
	if (opens) return {};
	fs.mkdirSync(path.dirname(mark), { recursive: true });
	fs.writeFileSync(mark, '');
	return { code: 2 };
}

// A tool call's answer for the dispatcher: a refusal, or null. Anything unexpected lets the call through.
const check = (input) => { try { return run(input).out || null; } catch { return null; } };

if (require.main === module) {
	try {
		const r = run(JSON.parse(fs.readFileSync(0, 'utf8') || '{}'));
		if (r.out) process.stdout.write(JSON.stringify(r.out));
		if (r.code === 2) process.stderr.write(CLOSE_OUT + '\n');
		process.exitCode = r.code || 0;
	} catch { process.exitCode = 0; }
}

module.exports = { check };
