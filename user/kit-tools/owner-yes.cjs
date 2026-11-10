'use strict';
// The owner's yes for one held act (T1, the owner 2026-11-10: "Pop-up record"). A guard that holds an act refuses it
// and names it; Claude asks the owner with Claude Code's choice pop-up (AskUserQuestion), the question quoting the act
// exactly in one code span (`...`), one option starting "Yes" and one starting "No". When the owner picks Yes, the same
// act run again passes, once. The proof is the record Claude Code writes when a person answers: the session
// transcript's answered pop-up, marked accepted by the user, for a pop-up Claude asked with no answers filled in.
// Never Claude's own account of it.
// Limits: the transcript is a file of the same user; the owner-proof guard refuses tool writes to it, but a program
// that writes it outside the tools is not stopped (the hard layer for main is GitHub's protection). A subagent never
// gets a yes: its transcript is not the owner's.
// CLI, for the pre-push hook: node owner-yes.cjs --push <ref> [force|delete] [<git common dir>]  exits 0 when the owner said yes, in this session's
// pop-up, to a push command naming that ref's branch or tag in the last hour.
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

// The act as the pop-up must quote it. A write is bound to everything that decides what it writes: the place it
// replaces and the text it puts there. A tool whose input is not one of these shapes gets no act, so no yes.
function actText(input) {
	const t = (input && input.tool_input) || {};
	const name = String((input && input.tool_name) || '');
	const str = (v) => typeof v === 'string';
	if (['Bash', 'PowerShell', 'Monitor', 'mcp__terminal__run_in_terminal'].includes(name)) return str(t.command) ? squash(t.command) : '';
	if (name === 'Write' && str(t.file_path) && str(t.content)) return squash(`Write ${t.file_path}: ${t.content}`);
	if (name === 'Edit' && str(t.file_path) && str(t.old_string) && str(t.new_string)) return squash(`Edit ${t.file_path}${t.replace_all ? ' (every match)' : ''}: ${t.old_string} => ${t.new_string}`);
	if (name === 'MultiEdit' && str(t.file_path) && Array.isArray(t.edits) && t.edits.every((e) => e && str(e.old_string) && str(e.new_string))) {
		return squash(`MultiEdit ${t.file_path}: ${t.edits.map((e) => `${e.old_string} => ${e.new_string}${e.replace_all ? ' (every match)' : ''}`).join(' ; ')}`);
	}
	return '';
}

// The code spans of a question: the acts it quotes, each read whole.
const spans = (question) => [...String(question).matchAll(/`([^`]+)`/g)].map((m) => squash(m[1]));

// Every accepted Yes in a transcript, oldest first: { at, acts, line, id } for each pop-up a person answered Yes to.
function yeses(lines) {
	const asked = new Map();
	const out = [];
	for (let n = 0; n < lines.length; n++) {
		if (!lines[n]) continue;
		let e;
		try { e = JSON.parse(lines[n]); } catch { continue; }
		if (e.isSidechain) continue;
		const c = e.message && Array.isArray(e.message.content) ? e.message.content : [];
		for (const b of c) {
			if (!b) continue;
			// A pop-up Claude filled in itself is no person's answer.
			if (b.type === 'tool_use' && b.name === 'AskUserQuestion' && e.type === 'assistant' && b.input && b.input.answers === undefined && Array.isArray(b.input.questions)) asked.set(b.id, b.input.questions);
			if (b.type !== 'tool_result' || e.type !== 'user' || !asked.has(b.tool_use_id)) continue;
			const d = e.permissionDecision || {};
			const r = e.toolUseResult || {};
			if (d.decision !== 'accept' || !/^user/.test(String(d.source || '')) || !r.answers) continue;
			const at = Date.parse(e.timestamp);
			if (!Number.isFinite(at)) continue;
			for (const q of asked.get(b.tool_use_id)) {
				const answer = String(r.answers[q.question] ?? '');
				const labels = (q.options || []).map((o) => String(o.label || ''));
				if (/^yes\b/i.test(answer) && labels.includes(answer) && labels.some((l) => /^no\b/i.test(l))) out.push({ at, acts: spans(q.question), line: n, id: String(b.tool_use_id) });
			}
		}
	}
	return out;
}

// Whether the transcript this hook names is the main session's own, in the Claude folder's transcripts.
function ownTranscript(input) {
	const file = String(input.transcript_path || '');
	if (!file || input.agent_id) return false;
	const root = slash(path.join(home(), 'projects')) + '/';
	if (!slash(file).startsWith(root)) return false;
	return !input.session_id || path.basename(file) === `${input.session_id}.jsonl`;
}

// The time of the owner's yes for this act, or null. A yes counts once: an act the session ran after the yes spends it.
function ownerYes(input, now = Date.now()) {
	const act = actText(input);
	if (!act || !ownTranscript(input)) return null;
	let lines;
	try { lines = fs.readFileSync(String(input.transcript_path), 'utf8').split('\n'); } catch { return null; }
	const yes = yeses(lines).filter((y) => y.acts.includes(act)).pop();
	if (!yes || now - yes.at < 0 || now - yes.at > FRESH_MS) return null;
	for (const raw of lines.slice(yes.line + 1)) {
		let e;
		try { e = JSON.parse(raw); } catch { continue; }
		if (e.isSidechain || e.type !== 'assistant') continue;
		for (const b of (e.message && Array.isArray(e.message.content) ? e.message.content : [])) {
			if (b && b.type === 'tool_use' && b.id !== input.tool_use_id && actText({ tool_name: b.name, tool_input: b.input }) === act) return null;
		}
	}
	return yes.at;
}

// What Claude is told when an act is held: how to get the owner's yes, or, in a subagent, to hand it back.
function howToAsk(input) {
	if (input && input.agent_id) return ' A subagent cannot get that yes: leave this out and name it in your report, so the lead asks.';
	return ' To run it: ask the owner with the AskUserQuestion pop-up, the question quoting the act exactly in one code span (`<the exact command>`, or for a file `Edit <file>: <old text> => <new text>`), one option starting "Yes" and one starting "No"; after the owner picks Yes, run it again unchanged, once.';
}

// The destination refs of a push command the owner said yes to, and whether it forces or deletes:
// `KIT_PUSH_APPROVED=1 git push origin main` -> { dests: ['main'], force: false, del: false }.
function pushAct(act) {
	const w = act.split(' ');
	const at = w.indexOf('push');
	if (at < 0 || !w.slice(0, at).includes('git')) return null;
	const rest = w.slice(at + 1);
	const flags = rest.filter((x) => x.startsWith('-'));
	const specs = rest.filter((x) => !x.startsWith('-')).slice(1);
	return {
		dests: specs.map((s) => s.replace(/^\+/, '').split(':').pop().replace(/^refs\/(heads|tags)\//, '')),
		force: flags.some((f) => /^(-f|--force|--force-with-lease)/.test(f)) || specs.some((s) => s.startsWith('+')),
		del: flags.includes('-d') || flags.includes('--delete') || specs.some((s) => s.startsWith(':')),
	};
}

// The pre-push hook's check behind the marker: this session's own transcript (Claude Code names the session in the
// tool shell), in this repo's folder of transcripts, holds a fresh Yes to a push whose destination is this ref, that
// forces or deletes only if the yes says so, and that no owner push of this ref in the push log has used yet.
// kind: '' (a plain push), 'force' or 'delete', as the hook read the ref line.
function pushGrant(ref, sessionId, kind = '', common = '', repo = process.cwd(), now = Date.now()) {
	const name = String(ref).replace(/^refs\/(heads|tags)\//, '');
	if (!name || !/^[0-9a-f-]{36}$/i.test(String(sessionId || ''))) return false;
	const root = path.join(home(), 'projects');
	// Claude Code names a project's transcript folder by its path, every other sign a dash: the session ran in this
	// repo or a folder above it, its name ending where a part of the path ends.
	const key = (p) => path.resolve(p).replace(/[^A-Za-z0-9]/g, '-').toLowerCase();
	let real = repo;
	try { real = fs.realpathSync.native(repo); } catch { /* as given */ }
	const here = key(real);
	let dirs = [];
	try { dirs = fs.readdirSync(root).filter((d) => here === d.toLowerCase() || here.startsWith(d.toLowerCase() + '-')); } catch { return false; }
	// The push log the hook writes, in the repo's common git folder (a worktree shares it); unreadable but present
	// refuses, so a yes is never reused by hiding its use.
	const log = path.join(common || path.join(repo, '.git'), 'kit-push.log');
	let used = [];
	try { used = fs.readFileSync(log, 'utf8').split('\n').map((l) => l.split(' ')).filter((p) => p[1] === 'owner' && p[2] === ref).map((p) => Date.parse(p[0])); } catch (e) { if (e.code !== 'ENOENT') return false; }
	for (const d of dirs) {
		let lines;
		try { lines = fs.readFileSync(path.join(root, d, `${sessionId}.jsonl`), 'utf8').split('\n'); } catch { continue; }
		for (const y of yeses(lines)) {
			if (now - y.at < 0 || now - y.at > FRESH_MS || used.some((t) => t >= y.at)) continue;
			for (const a of y.acts) {
				const p = pushAct(a);
				if (p && p.dests.includes(name) && (kind !== 'force' || p.force) && (kind !== 'delete' || p.del)) return true;
			}
		}
	}
	return false;
}

// The owner's latest Yes to one act in this session's own transcript, in this repo's folder of transcripts, after a
// time: { at, tap } (tap names the answer, so one answer is used once), or null. For approve.mjs: an ask or a pause
// prints the act ("sweep yes <code>"), the lead quotes it in a pop-up, and the owner's tap is the yes.
function sessionYes(act, { since = 0, sessionId = process.env.CLAUDE_CODE_SESSION_ID, repo = process.cwd() } = {}) {
	if (!/^[0-9a-f-]{36}$/i.test(String(sessionId || ''))) return null;
	const root = path.join(home(), 'projects');
	const key = (p) => path.resolve(p).replace(/[^A-Za-z0-9]/g, '-').toLowerCase();
	let real = repo;
	try { real = fs.realpathSync.native(repo); } catch { /* as given */ }
	const here = key(real);
	let dirs = [];
	try { dirs = fs.readdirSync(root).filter((d) => here === d.toLowerCase() || here.startsWith(d.toLowerCase() + '-')); } catch { return null; }
	let best = null;
	for (const d of dirs) {
		let lines;
		try { lines = fs.readFileSync(path.join(root, d, `${sessionId}.jsonl`), 'utf8').split('\n'); } catch { continue; }
		for (const y of yeses(lines)) if (y.at > since && y.acts.includes(squash(act)) && (!best || y.at >= best.at)) best = { at: y.at, tap: `${sessionId}:${y.id}` };
	}
	return best;
}

if (require.main === module && process.argv[2] === '--push') process.exitCode = pushGrant(process.argv[3], process.env.CLAUDE_CODE_SESSION_ID, process.argv[4] || '', process.argv[5] || '') ? 0 : 1;

module.exports = { ownerYes, actText, howToAsk, pushGrant, sessionYes, FRESH_MS };
