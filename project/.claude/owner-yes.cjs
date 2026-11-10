'use strict';
// The owner's yes for one held act (T1, the owner 2026-11-10: "Pop-up record"). A guard that holds an act refuses it
// and names it; Claude asks the owner with Claude Code's choice pop-up (AskUserQuestion), the question quoting the act
// exactly, one option starting "Yes" and one starting "No". When the owner picks Yes, the same act run again passes,
// once. The proof is the record Claude Code writes when a person answers: the session transcript's answered pop-up,
// marked accepted by the user, for a pop-up Claude asked with no answers filled in. Never Claude's own account of it.
// Limits: the transcript is a file of the same user; the owner-proof guard refuses tool writes to it, but a process
// that writes it outside the tools is not stopped. A subagent never gets a yes: its transcript is not the owner's.
const fs = require('fs');
const os = require('os');
const path = require('path');

// How long a yes stays good: long enough to run the act, short enough that an old answer does not linger.
const FRESH_MS = 60 * 60 * 1000;
// install project fills this in, so a caller cannot move the transcripts with CLAUDE_CONFIG_DIR.
const INSTALLED_HOME = '{{CLAUDE_HOME}}';
const home = () => (INSTALLED_HOME.startsWith('{' + '{') ? process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude') : INSTALLED_HOME);
const slash = (p) => path.resolve(p).split('\\').join('/').toLowerCase();
// The words an act is matched by: runs of white space read as one, ends trimmed.
const squash = (s) => String(s).replace(/\s+/g, ' ').trim();

// The act as the pop-up must quote it: a shell command, or the write tool and its file with the new text.
function actText(input) {
	const t = (input && input.tool_input) || {};
	const name = String((input && input.tool_name) || '');
	if (typeof t.command === 'string') return squash(t.command);
	const file = t.file_path || t.notebook_path;
	if (!file) return '';
	const text = t.new_string ?? t.content ?? t.new_source ?? '';
	return squash(`${name} ${file} ${text}`);
}

// Whether the transcript this hook names is the main session's own, in the Claude folder's transcripts.
function ownTranscript(input) {
	const file = String(input.transcript_path || '');
	if (!file || input.agent_id) return false;
	const root = slash(path.join(home(), 'projects')) + '/';
	if (!slash(file).startsWith(root)) return false;
	return !input.session_id || path.basename(file) === `${input.session_id}.jsonl`;
}

// The time of the owner's yes for this act, or null. A yes counts once: an act the session ran after the yes uses it.
function ownerYes(input, now = Date.now()) {
	const act = actText(input);
	if (!act || !ownTranscript(input)) return null;
	let lines;
	try { lines = fs.readFileSync(String(input.transcript_path), 'utf8').split('\n'); } catch { return null; }
	const asked = new Map();
	let yes = null;
	for (const line of lines) {
		if (!line) continue;
		let e;
		try { e = JSON.parse(line); } catch { continue; }
		if (e.isSidechain) continue;
		const c = e.message && Array.isArray(e.message.content) ? e.message.content : [];
		for (const b of c) {
			if (!b) continue;
			if (b.type === 'tool_use' && b.name === 'AskUserQuestion' && e.type === 'assistant') {
				// A pop-up Claude filled in itself is no person's answer.
				if (b.input && b.input.answers === undefined && Array.isArray(b.input.questions)) asked.set(b.id, b.input.questions);
			}
			// Running the act after the yes spends it, unless this run is the one being checked.
			if (b.type === 'tool_use' && yes && b.id !== input.tool_use_id && e.type === 'assistant' && actText({ tool_name: b.name, tool_input: b.input }) === act) yes = null;
			if (b.type !== 'tool_result' || e.type !== 'user' || !asked.has(b.tool_use_id)) continue;
			const d = e.permissionDecision || {};
			const r = e.toolUseResult || {};
			if (d.decision !== 'accept' || !/^user/.test(String(d.source || '')) || !r.answers) continue;
			for (const q of asked.get(b.tool_use_id)) {
				const answer = String(r.answers[q.question] ?? '');
				const labels = (q.options || []).map((o) => String(o.label || ''));
				if (!squash(q.question).includes(act)) continue;
				if (!/^yes\b/i.test(answer) || !labels.includes(answer) || !labels.some((l) => /^no\b/i.test(l))) continue;
				const at = Date.parse(e.timestamp);
				if (Number.isFinite(at)) yes = at;
			}
		}
	}
	return yes !== null && now - yes >= 0 && now - yes <= FRESH_MS ? yes : null;
}

// What Claude is told when an act is held: how to get the owner's yes, or, in a subagent, to hand it back.
function howToAsk(input) {
	if (input && input.agent_id) return ' A subagent cannot get that yes: leave this out and name it in your report, so the lead asks.';
	return ' To run it: ask the owner with the AskUserQuestion pop-up, the question quoting this exact command (or, for a file, the tool, the file and the new text), one option starting "Yes" and one starting "No"; after the owner picks Yes, run it again unchanged, once.';
}

module.exports = { ownerYes, actText, howToAsk, FRESH_MS };
