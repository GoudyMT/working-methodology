'use strict';
// The owner's yes for one held act (T1, the owner 2026-11-10: "Pop-up record"). A guard that holds an act refuses it
// and names it; Claude asks the owner with Claude Code's choice pop-up (AskUserQuestion), the question quoting the act
// exactly in one code span (`...`), one option labelled "Yes" and one starting "No". When the owner picks Yes, the same
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
const INSTALLED_HOME = "{{CLAUDE_HOME}}";
const home = () => (INSTALLED_HOME.startsWith('{' + '{') ? process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude') : INSTALLED_HOME);
const slash = (p) => path.resolve(p).split('\\').join('/').toLowerCase();
// The words an act is matched by: runs of spaces and tabs read as one, ends trimmed. A line break stays one: a shell
// runs a new line as a new command, so a quote on one line never stands for an act on two (the 1.25.0 sweep).
const squash = (s) => String(s).replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
// The answer that is a yes: the label "Yes" itself (with the pop-up's "(Recommended)" mark). A label that limits it
// ("Yes, but only a dry run") is not the act quoted, so it is no yes (the 1.25.0 sweep).
const YES_LABEL = /^yes(\s*\(recommended\))?$/i;

// The act as the pop-up must quote it. A write is bound to everything that decides what it writes: the place it
// replaces and the text it puts there. A tool whose input is not one of these shapes gets no act, so no yes.
function actText(input) {
	const t = (input && input.tool_input) || {};
	const name = String((input && input.tool_name) || '');
	const str = (v) => typeof v === 'string';
	if (['Bash', 'PowerShell', 'Monitor', 'mcp__terminal__run_in_terminal'].includes(name)) return str(t.command) ? squash(t.command) : '';
	if (name === 'Write' && str(t.file_path) && str(t.content)) return squash(`Write ${t.file_path}: ${t.content}`);
	// An edit whose text holds the quote's own separators would read as another edit, so it has no act and no yes: the
	// owner makes that edit (the 1.25.0 sweep, R1.5). Any "=>" or ";" at all, so no split at an edge reads two ways
	// (the review on ceecedd).
	const sep = (s) => /=>|;/.test(s);
	if (['Edit', 'MultiEdit'].includes(name) && [t.old_string, t.new_string, ...(Array.isArray(t.edits) ? t.edits.flatMap((e) => [e && e.old_string, e && e.new_string]) : [])].some((s) => str(s) && sep(s))) return '';
	if (name === 'Edit' && str(t.file_path) && str(t.old_string) && str(t.new_string)) return squash(`Edit ${t.file_path}${t.replace_all ? ' (every match)' : ''}: ${t.old_string} => ${t.new_string}`);
	if (name === 'MultiEdit' && str(t.file_path) && Array.isArray(t.edits) && t.edits.every((e) => e && str(e.old_string) && str(e.new_string))) {
		return squash(`MultiEdit ${t.file_path}: ${t.edits.map((e) => `${e.old_string} => ${e.new_string}${e.replace_all ? ' (every match)' : ''}`).join(' ; ')}`);
	}
	return '';
}

// A transcript's lines, read from its end: a yes counts only while fresh, so only the recent part can hold one, and a
// transcript past V8's string limit could otherwise never be read at all (the 1.25.0 sweep, R7.3). The first line of
// a cut read is a partial one and is dropped.
const TAIL_BYTES = 64 * 1024 * 1024;
function tailLines(file, cap = TAIL_BYTES) {
	const size = fs.statSync(file).size;
	if (size <= cap) return fs.readFileSync(file, 'utf8').split('\n');
	const buf = Buffer.alloc(cap);
	const fd = fs.openSync(file, 'r');
	try { fs.readSync(fd, buf, 0, cap, size - cap); } finally { fs.closeSync(fd); }
	return buf.toString('utf8').split('\n').slice(1);
}

// R7.1 (build 23a): the record shape a person's answer must carry to count, in one place, so the readers here and the
// use check agree (it once read only whether .decision existed, K224). Claude Code does not document this field: if
// it changes, no yes is read (fail closed) and yesCanary names why.
const YES_RECORD = (e) => { const d = e && e.permissionDecision; return Boolean(d && d.decision === 'accept' && /^user(_temporary)?$/.test(String(d.source || ''))); };

// The code spans of a question: the acts it quotes, each read whole.
const spans = (question) => [...String(question).matchAll(/`([^`]+)`/g)].map((m) => squash(m[1]));

// Every accepted Yes in a transcript, oldest first: { at, acts, line, id } for each pop-up a person answered Yes to.
// With all, every answer a person gave, each with yes true or false: the owner's latest word on an act is the one
// that counts (the build 12 sweep: a later No took nothing back).
function yeses(lines, { all = false } = {}) {
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
			if (b.type === 'tool_use' && b.name === 'AskUserQuestion' && e.type === 'assistant' && b.input && b.input.answers === undefined && Array.isArray(b.input.questions)) asked.set(b.id, { questions: b.input.questions, line: n });
			if (b.type !== 'tool_result' || e.type !== 'user' || !asked.has(b.tool_use_id)) continue;
			const r = e.toolUseResult || {};
			if (!YES_RECORD(e) || !r.answers) continue;
			const at = Date.parse(e.timestamp);
			if (!Number.isFinite(at)) continue;
			const qs = asked.get(b.tool_use_id).questions;
			for (const [k, q] of qs.entries()) {
				const answer = String(r.answers[q.question] ?? '');
				const labels = (q.options || []).map((o) => String(o.label || ''));
				// Answers are kept by question text, so two questions of one text share one answer: neither is a yes.
				const twin = qs.filter((x) => x.question === q.question).length > 1;
				const yes = !twin && YES_LABEL.test(answer) && labels.includes(answer) && labels.some((l) => /^no\b/i.test(l));
				// K144 (build 18): each question of a pop-up is its own tap, kept by the pop-up's id and the question's place;
				// a pop-up of one question keeps the plain id, as taps spent before 1.44.0 were kept.
				const id = qs.length > 1 ? `${b.tool_use_id}_q${k}` : String(b.tool_use_id);
				if (yes || all) out.push({ at, acts: spans(q.question), text: squash(q.question), line: n, asked: asked.get(b.tool_use_id).line, id, yes, answer });
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
	try { lines = tailLines(String(input.transcript_path)); } catch { return null; }
	// The owner's latest answer to a question quoting this act decides, and a yes counts only for a question that quotes
	// one act (the build 12 sweep: a later No took nothing back, and a question quoting two acts was a yes to both).
	const yes = yeses(lines, { all: true }).filter((y) => y.acts.includes(act)).pop();
	if (!yes || !yes.yes || yes.acts.length !== 1 || now - yes.at < 0 || now - yes.at > FRESH_MS) return null;
	// The yes is for the shell the held call ran in: Bash and PowerShell read the same text differently (the 1.25.0
	// sweep, R1.6). The last call of this act before the pop-up names it. With no held call before it, a question that
	// names one shell binds it (K97 and New 6, build 12: asking first cost a second tap); one naming none binds nothing.
	let tried = '';
	for (const raw of lines.slice(0, yes.asked)) {
		let e;
		try { e = JSON.parse(raw); } catch { continue; }
		if (e.isSidechain || e.type !== 'assistant') continue;
		for (const b of (e.message && Array.isArray(e.message.content) ? e.message.content : [])) {
			if (b && b.type === 'tool_use' && actText({ tool_name: b.name, tool_input: b.input }) === act) tried = String(b.name);
		}
	}
	const named = ['Bash', 'PowerShell'].filter((s) => new RegExp(`\\b${s}\\b`, 'i').test(yes.text.replace(/`[^`]*`/g, ' ')));
	if (!tried && named.length === 1) tried = named[0];
	const shell = ['Bash', 'PowerShell', 'Monitor', 'mcp__terminal__run_in_terminal'].includes(String(input.tool_name));
	if ((shell && !tried) || (tried && tried !== String(input.tool_name))) return null;
	// Spent by any run of the act after the pop-up was asked, the answer's own line or not: Claude Code writes every
	// tool call of a message before their results, so an act sent beside the pop-up sits above the answer (the 1.25.0
	// sweep: one tap ran it twice).
	for (const raw of lines.slice(yes.asked)) {
		let e;
		try { e = JSON.parse(raw); } catch { continue; }
		if (e.isSidechain || e.type !== 'assistant') continue;
		for (const b of (e.message && Array.isArray(e.message.content) ? e.message.content : [])) {
			if (b && b.type === 'tool_use' && b.id !== input.tool_use_id && actText({ tool_name: b.name, tool_input: b.input }) === act) return null;
		}
	}
	return spend(yes.id, input.tool_use_id) ? yes.at : null;
}

// One tap runs one call, across every session (the build 12 sweep: a forked session copies the transcript, tap and
// all, and each copy read it unspent). The first call a yes lets through is written in the Claude folder under the
// pop-up's id, made whole or not at all; another call finds it there. The same call asked again (each guard asks) passes.
function spend(popUp, call) {
	if (!call) return true;
	const dir = path.join(home(), 'kit-yes-spent');
	const file = path.join(dir, String(popUp).replace(/[^A-Za-z0-9_-]/g, '_'));
	// A pop-up spent before 1.44.0 was kept under its plain id, whatever question ran: each of its questions is spent.
	const plain = /_q\d+$/.test(String(popUp)) && path.join(dir, String(popUp).replace(/_q\d+$/, '').replace(/[^A-Za-z0-9_-]/g, '_'));
	if (plain && fs.existsSync(plain)) { try { return fs.readFileSync(plain, 'utf8') === String(call); } catch { return false; } }
	try {
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(file, String(call), { flag: 'wx' });
		return true;
	} catch {
		try { return fs.readFileSync(file, 'utf8') === String(call); } catch { return false; }
	}
}

// The R7.1 canary: when no yes was read for an act, whether a person's Yes to it is in the transcript all the same, on a
// record that fails YES_RECORD. That means Claude Code changed the record, not that the owner said nothing: the named
// warning, or ''. It never grants; a No, a pop-up Claude filled in itself and a subagent's answer stay quiet.
function yesCanary(input, acts = [actText(input)]) {
	const want = acts.map((a) => squash(a)).filter(Boolean);
	if (!want.length || !input || !ownTranscript(input)) return '';
	let lines;
	try { lines = tailLines(String(input.transcript_path)); } catch { return ''; }
	const asked = new Map();
	let found = '';
	for (const raw of lines) {
		let e;
		try { e = JSON.parse(raw); } catch { continue; }
		if (!e || e.isSidechain) continue;
		for (const b of (e.message && Array.isArray(e.message.content) ? e.message.content : [])) {
			if (!b) continue;
			if (b.type === 'tool_use' && b.name === 'AskUserQuestion' && e.type === 'assistant' && b.input && b.input.answers === undefined && Array.isArray(b.input.questions)) asked.set(b.id, b.input.questions);
			if (b.type !== 'tool_result' || e.type !== 'user' || !asked.has(b.tool_use_id)) continue;
			const r = e.toolUseResult || {};
			if (!r.answers || typeof r.answers !== 'object') continue;
			const said = asked.get(b.tool_use_id).some((q) => q && spans(q.question).some((a) => want.includes(a)) && YES_LABEL.test(String(r.answers[q.question] ?? '')));
			if (!said) continue;
			// The newest answer to the act decides: a later good record clears an older changed one.
			found = YES_RECORD(e) ? '' : `Canary (R7.1): a Yes to this act is in the transcript, but its record's permissionDecision is ${JSON.stringify(e.permissionDecision ?? null).slice(0, 80)}, not {decision: "accept", source: "user..."}. Claude Code may have changed the record; the guards cannot read the owner's yes until the kit follows. Report this to the kit; asking again will not help.`;
		}
	}
	return found;
}

// What Claude is told when an act is held: how to get the owner's yes, or, in a subagent, to hand it back.
// With an act, the refusal names that one act to quote and run, so the session never has two to choose from (the
// 1.26.0 sweep, C7); `lead` opens the instruction ("To run it", or a condition such as "Only for a new repo's first push").
function howToAsk(input, act = '', lead = 'To run it') {
	if (input && input.agent_id) return ' A subagent cannot get that yes: leave this out and name it in your report, so the lead asks.';
	// A shell act's question names its shell, so a yes asked before any try binds it (K97, New 6, build 12).
	const shellWords = ['Bash', 'PowerShell'].includes(String(input && input.tool_name)) ? ` and the words "in ${input.tool_name}"` : '';
	if (act) return ` ${lead}: ask the owner with the AskUserQuestion pop-up, the question quoting this act exactly in one code span: \`${act}\`${shellWords}, one option labelled "Yes" and one starting "No", and nothing else in the same message; after the owner picks Yes, run that act, once.`;
	return ` ${lead}: ask the owner with the AskUserQuestion pop-up, the question quoting the act exactly in one code span (\`<the exact command>\`, or for a file \`Edit <file>: <old text> => <new text>\`)${shellWords}, one option labelled "Yes" and one starting "No", and nothing else in the same message; after the owner picks Yes, run it again unchanged, once.`;
}

// One voice for every refusal (T16a, the owner 2026-11-11): each opens with its kind, then the limit it hit, then what
// to do. The kinds: "Owner's yes needed" (the pop-up below), "Hand back" (a subagent cannot ask), "Never by a tool"
// (no yes makes a tool do it) and "Held" (the call cannot go on until something is put right: a guard that could not
// run or read the call, guard files not as install left them, a step's rules not yet read). The openings are the
// order a session acts on.
function askText(what, input, act = '', lead = 'To run it') {
	if (input && input.agent_id) return `Hand back: a subagent cannot get the owner's yes. Leave this out (${what}) and name it in your report, so the lead asks.`;
	let canary = '';
	try { canary = yesCanary(input, [actText(input), act]); } catch { /* the refusal stands without it */ }
	return `Owner's yes needed: ${what}.` + howToAsk(input, act, lead) + (canary ? ` ${canary}` : '');
}
const heldText = (what) => `Held: ${what}.`;
const yesText = (what) => `Owner's yes given in the pop-up for this exact command: ${what}.`;
const neverText = (what) => `Never by a tool: ${what}.`;

// The destination refs of a push command the owner said yes to, and whether it forces or deletes:
// `KIT_PUSH_APPROVED=1 git push origin main` -> { dests: ['main'], force: false, del: false }.
// This folder and every folder above it: the folders a session may have run in for this repo. A sibling folder whose
// name this one starts with is not one of them (the 1.25.0 sweep: "...\working" passed for "...\working-methodology").
function above(dir) {
	const out = [];
	for (let d = path.resolve(dir); ; d = path.dirname(d)) {
		out.push(d);
		if (path.dirname(d) === d) return out;
	}
}
function pushAct(act) {
	const w = act.split(/\s+/);
	const at = w.indexOf('push');
	if (at < 0 || !w.slice(0, at).includes('git')) return null;
	const rest = w.slice(at + 1);
	const flags = rest.filter((x) => x.startsWith('-'));
	const words = rest.filter((x) => !x.startsWith('-'));
	const specs = words.slice(1);
	return {
		// The build 23a sweep: the remote the yes names, so a yes to push one remote is no yes for another.
		remote: words[0] || '',
		dests: specs.map((s) => s.replace(/^\+/, '').split(':').pop()),
		force: flags.some((f) => /^(-f|--force|--force-with-lease)/.test(f)) || specs.some((s) => s.startsWith('+')),
		del: flags.includes('-d') || flags.includes('--delete') || specs.some((s) => s.startsWith(':')),
	};
}

// Whether a yes to this act covers a push of this ref: a destination written in full (refs/heads/x, refs/tags/x) names
// only that kind of ref; a short name covers either, as git itself resolves it (the 1.25.0 sweep, R2.9: a yes to push
// a branch let a tag of the same name go).
function grantsRef(act, ref, kind = '', remote = '') {
	const p = pushAct(act);
	if (!p || (remote && p.remote !== remote)) return false;
	const short = String(ref).replace(/^refs\/(heads|tags)\//, '');
	const named = p.dests.some((d) => (/^refs\//.test(d) ? d === ref : d === short));
	return named && (kind !== 'force' || p.force) && (kind !== 'delete' || p.del);
}

// The pre-push hook's check behind the marker: this session's own transcript (Claude Code names the session in the
// tool shell), in this repo's folder of transcripts, holds a fresh Yes to a push whose destination is this ref, that
// forces or deletes only if the yes says so, and that no owner push of this ref in the push log has used yet.
// kind: '' (a plain push), 'force' or 'delete', as the hook read the ref line.
// remote: the remote the hook pushes to (its first argument), which the yes must name. maxAge: how old a yes may be, in
// minutes (the owner's own push takes 10, the build 23a sweep: a session id can name any session of the project).
function pushGrant(ref, sessionId, kind = '', common = '', repo = process.cwd(), now = Date.now(), remote = '', maxAge = FRESH_MS / 60000) {
	const name = String(ref).replace(/^refs\/(heads|tags)\//, '');
	if (!name || !/^[0-9a-f-]{36}$/i.test(String(sessionId || ''))) return false;
	const root = path.join(home(), 'projects');
	// Claude Code names a project's transcript folder by its path, every other sign a dash: the session ran in this
	// repo or a folder above it, its name ending where a part of the path ends.
	const key = (p) => path.resolve(p).replace(/[^A-Za-z0-9]/g, '-').toLowerCase();
	let real = repo;
	try { real = fs.realpathSync.native(repo); } catch { /* as given */ }
	// The build 23a sweep: the session ran in this repo (or the main checkout of this worktree), not a folder above it
	// that holds other repos too.
	const keys = [real, common ? path.dirname(path.resolve(repo, common)) : real].map(key);
	let dirs = [];
	try { dirs = fs.readdirSync(root).filter((d) => keys.includes(d.toLowerCase())); } catch { return false; }
	// The push log the hook writes, in the repo's common git folder (a worktree shares it); unreadable but present
	// refuses, so a yes is never reused by hiding its use.
	const log = path.join(common || path.join(repo, '.git'), 'kit-push.log');
	let used = [];
	// A push of either kind of ref with this name spends a yes, so one tap to a short name allows one push (the review
	// on ceecedd).
	// K215 (build 23a): the owner's own push (owner-hand) now runs on a yes too, so its log line spends one.
	const kinds = [ref, `refs/heads/${name}`, `refs/tags/${name}`];
	try { used = fs.readFileSync(log, 'utf8').split('\n').map((l) => l.split(' ')).filter((p) => (p[1] === 'owner' || p[1] === 'owner-hand') && kinds.includes(p[2])).map((p) => Date.parse(p[0])); } catch (e) { if (e.code !== 'ENOENT') return false; }
	for (const d of dirs) {
		let lines;
		try { lines = tailLines(path.join(root, d, `${sessionId}.jsonl`)); } catch { continue; }
		for (const y of yeses(lines)) {
			if (now - y.at < 0 || now - y.at > Math.min(FRESH_MS, maxAge * 60000) || used.some((t) => !Number.isFinite(t) || t >= y.at)) continue;
			for (const a of y.acts) if (grantsRef(a, ref, kind, remote)) return true;
		}
	}
	return false;
}

// The owner's latest Yes to one act in this session's own transcript, in this repo's folder of transcripts, after a
// time: { at, tap } (tap names the answer, so one answer is used once), or null. For approve.mjs: an ask or a pause
// prints the act ("sweep yes <code>"), the lead quotes it in a pop-up, and the owner's tap is the yes.
// keys: precomputed folder keys read as given (lowercase, no walk above, no realpath of a built path); faults: an array that
// receives each read error other than ENOENT. Without them the folder and each one above it are read, as before.
function sessionYeses(sessionId, repo, { all = false, keys: given, faults } = {}) {
	if (!/^[0-9a-f-]{36}$/i.test(String(sessionId || ''))) return [];
	const root = path.join(home(), 'projects');
	const key = (p) => path.resolve(p).replace(/[^A-Za-z0-9]/g, '-').toLowerCase();
	let real = repo;
	try { real = fs.realpathSync.native(repo); } catch { /* as given */ }
	const keys = Array.isArray(given) ? given.map((k) => String(k).toLowerCase()) : above(real).map(key);
	const fault = (e) => { if (Array.isArray(faults) && e && e.code !== 'ENOENT') faults.push(e.code || 'error'); };
	let dirs = [];
	try { dirs = fs.readdirSync(root).filter((d) => keys.includes(d.toLowerCase())); } catch (e) { fault(e); return []; }
	const out = [];
	for (const d of dirs) {
		let lines;
		try { lines = tailLines(path.join(root, d, `${sessionId}.jsonl`)); } catch (e) { fault(e); continue; }
		out.push(...yeses(lines, { all }));
	}
	return out;
}
// Every answer the owner gave to one act after a time (with act null, to any pop-up), oldest first, a No included:
// { at, yes, answer }. For the loop's plan shadow (T7 slice 2), which counts a plan the owner answered No to as a
// disagreement, and (K210) reads what a No said to match it against the risks the verdict named.
function sessionAnswers(act, { since = 0, sessionId = process.env.CLAUDE_CODE_SESSION_ID, repo = process.cwd(), keys, faults } = {}) {
	return sessionYeses(sessionId, repo, { all: true, keys, faults }).filter((y) => y.at > since && (act === null || y.acts.includes(squash(act)))).map((y) => ({ at: y.at, yes: y.yes, answer: y.answer })).sort((a, b) => a.at - b.at);
}
// The owner's latest answer to one act after a time, as the guards read it: { at, yes, single, tap } or null. single is
// whether the question quoted this act alone (the build 13 sweep: the loop took any Yes, the newest even after a No, and
// a question quoting several acts as a Yes to each).
function sessionLatest(act, { since = 0, sessionId = process.env.CLAUDE_CODE_SESSION_ID, repo = process.cwd(), keys, faults } = {}) {
	let best = null;
	for (const y of sessionYeses(sessionId, repo, { all: true, keys, faults })) if (y.at > since && y.acts.includes(squash(act)) && (!best || y.at >= best.at)) best = { at: y.at, yes: y.yes, single: y.acts.length === 1, tap: `${sessionId}:${y.id}` };
	return best;
}
// Whether this session's transcript is longer than the part the readers read, so an old answer may be out of sight.
function sessionCut(sessionId, repo) {
	if (!/^[0-9a-f-]{36}$/i.test(String(sessionId || ''))) return false;
	const root = path.join(home(), 'projects');
	const key = (p) => path.resolve(p).replace(/[^A-Za-z0-9]/g, '-').toLowerCase();
	let real = repo;
	try { real = fs.realpathSync.native(repo); } catch { /* as given */ }
	const keys = above(real).map(key);
	let dirs = [];
	try { dirs = fs.readdirSync(root).filter((d) => keys.includes(d.toLowerCase())); } catch { return false; }
	return dirs.some((d) => { try { return fs.statSync(path.join(root, d, `${sessionId}.jsonl`)).size > TAIL_BYTES; } catch { return false; } });
}
function sessionYes(act, { since = 0, sessionId = process.env.CLAUDE_CODE_SESSION_ID, repo = process.cwd() } = {}) {
	let best = null;
	for (const y of sessionYeses(sessionId, repo)) if (y.at > since && y.acts.includes(squash(act)) && (!best || y.at >= best.at)) best = { at: y.at, tap: `${sessionId}:${y.id}` };
	return best;
}

// Why no pop-up of this session can be read at all, or '' (New 2, build 12): a script run from the owner's terminal
// needs the session's id, and finds its transcript only from the repo that session works in.
function sessionGap({ sessionId = process.env.CLAUDE_CODE_SESSION_ID, repo = process.cwd() } = {}) {
	if (!sessionId) return 'CLAUDE_CODE_SESSION_ID is not set in this shell, so no session\'s pop-ups can be read: set it to the id of the session that asked';
	if (!/^[0-9a-f-]{36}$/i.test(String(sessionId))) return `CLAUDE_CODE_SESSION_ID (${String(sessionId).slice(0, 40)}) is not a session id`;
	const root = path.join(home(), 'projects');
	const key = (p) => path.resolve(p).replace(/[^A-Za-z0-9]/g, '-').toLowerCase();
	let real = repo;
	try { real = fs.realpathSync.native(repo); } catch { /* as given */ }
	const keys = above(real).map(key);
	let dirs = [];
	try { dirs = fs.readdirSync(root).filter((d) => keys.includes(d.toLowerCase())); } catch { /* none */ }
	if (dirs.some((d) => fs.existsSync(path.join(root, d, `${sessionId}.jsonl`)))) return '';
	return `no transcript of session ${sessionId} is kept for this repository or a folder above it: run this from the repository that session works in`;
}

// The owner's latest Yes after a time to a question that names the act without backticks around it, so it counts for
// nothing: { at } or null. A refusal names it, so the lead asks again with the act quoted (K91: build 11's resume was
// refused twice on such a Yes, and the refusal read as if the owner had not answered).
function unquotedYes(act, { since = 0, sessionId = process.env.CLAUDE_CODE_SESSION_ID, repo = process.cwd() } = {}) {
	let best = null;
	for (const y of sessionYeses(sessionId, repo)) if (y.at > since && !y.acts.includes(squash(act)) && String(y.text || '').includes(squash(act)) && (!best || y.at >= best.at)) best = { at: y.at };
	return best;
}

// The build 23a sweep (K224): a refused push names the canary when a Yes to it is there but its record changed shape.
function pushCanary(ref, sessionId, repo = process.cwd()) {
	if (!/^[0-9a-f-]{36}$/i.test(String(sessionId || ''))) return '';
	const root = path.join(home(), 'projects');
	const key = (p) => path.resolve(p).replace(/[^A-Za-z0-9]/g, '-').toLowerCase();
	let real = repo;
	try { real = fs.realpathSync.native(repo); } catch { /* as given */ }
	let dirs = [];
	try { dirs = fs.readdirSync(root).filter((d) => d.toLowerCase() === key(real)); } catch { return ''; }
	for (const d of dirs) {
		const file = path.join(root, d, `${sessionId}.jsonl`);
		let lines;
		try { lines = tailLines(file); } catch { continue; }
		// Every act a pop-up quoted, whatever its record: yeses() skips a record that fails the shape test.
		const acts = lines.flatMap((l) => { try { const e = JSON.parse(l); return (e.message && Array.isArray(e.message.content) ? e.message.content : []).filter((b) => b && b.type === 'tool_use' && b.name === 'AskUserQuestion' && b.input && Array.isArray(b.input.questions)).flatMap((b) => b.input.questions.flatMap((q) => spans(q && q.question))); } catch { return []; } }).filter((x) => grantsRef(x, ref));
		const text = acts.length ? yesCanary({ transcript_path: file, session_id: sessionId, cwd: real }, acts) : '';
		if (text) return text;
	}
	return '';
}
// K367 (U26): the owner's yes record. The owner types a name in their own terminal and the writer leaves a JSON record
// {act, target, head, at} under <home>/kit-yes-spent/records/<id>.json. The guard lets one act through for it, once,
// while it is fresh, and only for the target and head it names. Honest limit: this stops slips and written-out
// writes, not a forger with the same user's file access, the same limit as the pop-up yes above.
// CLI: node owner-yes.cjs --record <merge|squash|release> <owner/repo>[#N|@tag] <head sha>
// Only the acts guard-outward honours take a record. A tag, a delete or a force push keeps the pre-push hook's typed-name
// path, so the writer refuses those before it reads the terminal.
const crypto = require('crypto');
const ACTS = ['merge', 'squash', 'release'];
const FULL_SHA = /^[0-9a-f]{40}$/;
const recordsDir = () => path.join(home(), 'kit-yes-spent', 'records');
function recordOf(act, target, head, at) {
	const record = { act, target, head, at };
	const id = crypto.createHash('sha256').update(`${act}|${target}|${head}|${at}`).digest('hex').slice(0, 16);
	return { id, record };
}

// git by its full path, found on an absolute PATH folder: never a bare name, which a project folder could shadow.
function gitBin() {
	const exe = process.platform === 'win32' ? 'git.exe' : 'git';
	for (const d of String(process.env.PATH || '').split(path.delimiter)) {
		if (!d || !path.isAbsolute(d)) continue;
		const f = path.join(d, exe);
		try { if (fs.statSync(f).isFile()) return f; } catch { /* not here */ }
	}
	return '';
}
function gitOut(cwd, args) {
	const bin = gitBin();
	if (!bin) return '';
	const r = require('child_process').spawnSync(bin, ['-C', cwd, '-c', 'core.fsmonitor=false', ...args], { encoding: 'utf8', timeout: 3000, cwd: path.dirname(process.execPath), windowsHide: true });
	return r.status === 0 ? String(r.stdout).trim() : '';
}

// One row {at, hook, cause} in <git common dir>/kit-guard-open.log; a log that cannot be written never lifts a refusal.
function logOpen(cwd, hook, cause) {
	try {
		const common = gitOut(cwd || process.cwd(), ['rev-parse', '--path-format=absolute', '--git-common-dir']);
		if (common) fs.appendFileSync(path.join(common, 'kit-guard-open.log'), `${JSON.stringify({ at: new Date().toISOString(), hook, cause: String(cause).slice(0, 200) })}\n`);
	} catch { /* the refusal stands without the row */ }
}

// The act a plain gh merge or release command is, for a record or a pop-up yes to bind: { kind, act, target, head,
// admin }, or null when the command is anything but one simple gh command read whole. The text is a strict ASCII
// allowlist split on ASCII space only (no quotes, shell signs, @, globs, ~, %, other spaces), an option never takes a
// value that starts with -, and an option given twice or by two aliases is no act. The target names only an explicit -R
// (no origin fallback). A release takes no notes, title or other free text.
const ALIAS = { '--repo': '-R', '--squash': '-s', '--merge': '-m', '--rebase': '-r', '--delete-branch': '-d', '--body': '-b', '--subject': '-t', '--body-file': '-F', '--author-email': '-A', '--draft': '-d', '--prerelease': '-p' };
function parseAct(command) {
	const text = String(command ?? '');
	if (!/^[A-Za-z0-9 ._\/:=#-]+$/.test(text.trim())) return null;
	const w = text.trim().split(' ').filter(Boolean);
	const merge = w[0] === 'gh' && w[1] === 'pr' && w[2] === 'merge';
	const rel = w[0] === 'gh' && w[1] === 'release' && w[2] === 'create';
	if (!merge && !rel) return null;
	const valued = merge ? new Set(['-R', '--match-head-commit']) : new Set(['-R', '--target']);
	const bools = merge ? new Set(['-s', '-m', '-r', '--admin'])
		: new Set(['-d', '-p', '--latest', '--generate-notes', '--verify-tag']);
	const opt = {};
	const pos = [];
	let admin = false;
	for (let i = 3; i < w.length; i++) {
		const eq = w[i].startsWith('--') ? w[i].indexOf('=') : -1;
		const raw = eq > 0 ? w[i].slice(0, eq) : w[i];
		if (!raw.startsWith('-')) { pos.push(raw); continue; }
		const name = ALIAS[raw] || raw;
		if (name === '--admin') { admin = true; continue; }
		if (Object.prototype.hasOwnProperty.call(opt, name)) return null;
		if (valued.has(name)) {
			const v = eq > 0 ? w[i].slice(eq + 1) : w[++i];
			if (!v || v.startsWith('-')) return null;
			opt[name] = v;
		} else if (bools.has(name) && eq < 0) opt[name] = true;
		else return null;
	}
	const repo = opt['-R'] || '';
	if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
	if (pos.length !== 1) return null;
	if (merge) {
		if (!/^\d+$/.test(pos[0])) return null;
		const kinds = ['-s', '-m', '-r'].filter((k) => opt[k]);
		if (kinds.length > 1) return null;
		const head = String(opt['--match-head-commit'] || '').toLowerCase();
		return { kind: 'merge', act: opt['-s'] ? 'squash' : opt['-r'] ? 'rebase' : 'merge', target: repo ? repo + '#' + pos[0] : '', head, admin };
	}
	return { kind: 'release', act: 'release', target: repo ? repo + '@' + pos[0] : '', head: String(opt['--target'] || '').toLowerCase(), admin };
}

// A release also needs its tag absent from origin or already on the recorded head, looked up in the call's repo with
// git by its full path. A lookup that fails is no answer, so the release is held.
function tagFree(tag, head, cwd, repo = '') {
	const bin = gitBin();
	if (!bin || !cwd) return false;
	// The record counts only for the repo origin's raw configured url (before any rewrite) names: github.com over https
	// or ssh, its path exactly the -R owner/repo. A local path, a file url, another host or an unreadable url holds, and so
	// does an origin with more than one raw url. A url rewrite in the repo's own config that redirects this lookup is a
	// written-out change to that config, inside the F10 honest limit: this stops slips, not a forger with the same file access.
	const urls = gitOut(cwd, ['config', '--get-all', 'remote.origin.url']).split('\n').filter(Boolean);
	const m = urls.length === 1 ? /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(urls[0]) : null;
	if (!m || `${m[1]}/${m[2]}`.toLowerCase() !== String(repo).toLowerCase()) return false;
	const r = require('child_process').spawnSync(bin, ['-C', cwd, '-c', 'core.fsmonitor=false', '-c', 'protocol.ext.allow=never', 'ls-remote', '--tags', 'origin', tag], { encoding: 'utf8', timeout: 20000, cwd: path.dirname(process.execPath), windowsHide: true });
	if (r.error || r.status !== 0) return false;
	const refs = {};
	for (const l of String(r.stdout).split('\n').filter(Boolean)) { const [sha, ref] = l.split('\t'); refs[ref] = String(sha).toLowerCase(); }
	const on = refs['refs/tags/' + tag + '^{}'] || refs['refs/tags/' + tag];
	return !on || on === head;
}

// Whether a fresh, unspent record names this act (parseAct's answer) exactly: { id, at } and the record is spent by a
// wx create, or null. A record file that cannot be read, or a records folder that cannot be listed, throws: the act is
// refused and logged by the caller, a good record beside the bad one or not.
function recordYes(p, call, now = Date.now(), cwd = '') {
	if (!p || !p.act || !p.target || !FULL_SHA.test(p.head) || p.admin || !call) return null;
	const dir = recordsDir();
	let names;
	try { names = fs.readdirSync(dir); } catch (e) { if (e && e.code === 'ENOENT') return null; throw e; }
	const fit = [];
	for (const name of names.filter((n) => n.endsWith('.json'))) {
		let r;
		try { r = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch (e) { throw new Error(`a yes record cannot be read: ${name}`); }
		const ok = r && typeof r === 'object' && typeof r.act === 'string' && typeof r.target === 'string' && typeof r.head === 'string' && Number.isFinite(r.at) && recordOf(r.act, r.target, r.head, r.at).id + '.json' === name;
		if (!ok) throw new Error(`a yes record is not one the writer made: ${name}`);
		if (r.act === p.act && r.target.toLowerCase() === p.target.toLowerCase() && r.head.toLowerCase() === p.head && now - r.at >= 0 && now - r.at <= FRESH_MS) fit.push({ id: name.slice(0, -5), at: r.at });
	}
	if (fit.length && p.kind === 'release' && !tagFree(p.target.split('@').pop(), p.head, cwd, p.target.split('@')[0])) return null;
	for (const f of fit.sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : 1))) if (spend(f.id, call)) return f;
	return null;
}

// The typed name, read from the terminal device and never from stdin: an agent's shell has piped stdin and no terminal.
function typedAtTerminal(prompt) {
	if (!require('tty').isatty(0)) throw new Error('no terminal: the owner types the name at their own terminal, and stdin here is not one');
	let fd;
	try { fd = fs.openSync(process.platform === 'win32' ? 'CONIN$' : '/dev/tty', 'r'); } catch { throw new Error('no terminal (tty) to read a typed name from'); }
	process.stderr.write(prompt);
	const one = Buffer.alloc(1);
	let s = '';
	try { while (s.length < 300 && fs.readSync(fd, one, 0, 1, null) === 1 && one[0] !== 10) s += String.fromCharCode(one[0]); } finally { fs.closeSync(fd); }
	return s.replace(/\r$/, '');
}
function recordCli(args) {
	for (const m of ['CLAUDECODE', 'AI_AGENT']) if (process.env[m]) throw new Error('the AI shell marker ' + m + ' is set here: this is an agent shell, and a yes record is written only from the owner own terminal');
	const [act, target, head0] = args;
	const head = String(head0 || '').toLowerCase();
	if (['tag', 'delete', 'force'].includes(act)) throw new Error(`${act} is not a record act: a ${act} push keeps the pre-push hook's typed-name path (the hook asks for the ref's name); the writer takes ${ACTS.join(', ')} only`);
	const shape = act === 'release' ? /^[\w.-]+\/[\w.-]+@\S+$/ : /^[\w.-]+\/[\w.-]+#\d+$/;
	if (!ACTS.includes(act) || !shape.test(String(target)) || !FULL_SHA.test(head)) throw new Error(`usage: owner-yes.cjs --record <${ACTS.join('|')}> <owner/repo>[#N|@tag] <full head sha> (merge and squash name #N, release names @tag)`);
	const want = `${act} ${target}`;
	if (typedAtTerminal(`Yes record: type "${want}" (head ${head}) to say yes to it once: `) !== want) throw new Error('the name typed was not ' + want);
	const { id, record } = recordOf(act, target, head, Date.now());
	fs.mkdirSync(recordsDir(), { recursive: true });
	fs.writeFileSync(path.join(recordsDir(), `${id}.json`), JSON.stringify(record), { flag: 'wx' });
	process.stdout.write(`Yes recorded: ${id} (${want}, head ${head}, good for one hour, once)\n`);
}
if (require.main === module && process.argv[2] === '--record') {
	try { recordCli(process.argv.slice(3)); } catch (e) { process.stderr.write(`Not recorded: ${e.message}\n`); process.exitCode = 1; }
}
if (require.main === module && process.argv[2] === '--push') {
	const [ref, kind, common, remote, age] = process.argv.slice(3);
	const ok = pushGrant(ref, process.env.CLAUDE_CODE_SESSION_ID, kind || '', common || '', process.cwd(), Date.now(), remote || '', Number(age) || FRESH_MS / 60000);
	if (!ok) { const c = pushCanary(ref, process.env.CLAUDE_CODE_SESSION_ID); if (c) process.stderr.write(c + '\n'); }
	process.exitCode = ok ? 0 : 1;
}

module.exports = { YES_RECORD, yesCanary, home, ownerYes, actText, howToAsk, askText, yesText, neverText, heldText, pushGrant, grantsRef, sessionYes, sessionAnswers, sessionLatest, sessionCut, unquotedYes, sessionGap, tailLines, FRESH_MS, recordOf, parseAct, recordYes, logOpen };
