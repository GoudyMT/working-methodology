// The agent canary (rule:agent-canary). Each kit agent opens every message with a phrase found only on the last line
// of the project's "Rules every brief carries" block, which it must Read; role files and skills never carry it.
// - Stop (SubagentStop): the last message opens with the phrase. A miss blocks the stop once with close-out steps that
//   never name it; the next stop goes through. Each result is one line in <git common dir>/kit-canary.log.
// - PreToolUse on Agent, Task and SendMessage (leak guard): a brief or message carrying the phrase is denied, logged.
// A project with no phrase line has the check off. A hook that throws answers by its tier (hook-error.cjs).
const fs = require('fs');
const path = require('path');
// Kit modules load in run(), inside the caller's try, so a load crash answers by the tier (K375).
let safeSpawn = null;
let recordCounts = null;
function load() {
	if (!safeSpawn) [recordCounts, safeSpawn] = [require('./record-counts.cjs').recordCounts, require('./safe-spawn.cjs')];
}

// git from node's own folder, never the project.
const git = (cwd, ...a) => safeSpawn.gitRead(cwd, a, { encoding: 'utf8' });
// One spelling for comparing: lower case letters and digits, other runs as one space.
const words = (s) => ` ${String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;

// The phrase: the rule index's file for rule:agent-team-adapter, else standards/agent-teams.md, from the main checkout.
function findPhrase(cwd) {
	const common = git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir');
	if (common.status !== 0) return null;
	const commonDir = common.stdout.trim();
	const root = path.dirname(commonDir);
	// In a sweep, approve.mjs's base copy is read (HEAD at its commit): a branch cannot swap the phrase.
	try {
		const rec = JSON.parse(fs.readFileSync(path.join(commonDir, 'kit-sweep-rules.json'), 'utf8'));
		const head = git(cwd, 'rev-parse', 'HEAD');
		if (rec && typeof rec.phrase === 'string' && words(rec.phrase).trim() && head.status === 0 && rec.head === head.stdout.trim()) return { phrase: rec.phrase, commonDir };
		if (rec && typeof rec.file === 'string' && head.status === 0 && rec.head === head.stdout.trim()) {
			const m = fs.readFileSync(rec.file, 'utf8').match(/^\s*Confirmation phrase: .* with: (.+?)\s*$/m);
			if (m && words(m[1]).trim()) return { phrase: m[1], commonDir };
		}
	} catch { /* no sweep record, or its copy is gone: read the main checkout */ }
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
	try { fs.appendFileSync(path.join(commonDir, 'kit-canary.log'), JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n'); } catch { /* a log that cannot be written never blocks */ }
}

const CLOSE_OUT = [
	'Your message did not open the way your rules require, so this run is void (rule:agent-canary). Close out now:',
	'1. Stop editing. Commit nothing half-done, and leave your changes where they are.',
	'2. Send your close-out note as your report (your reply, or your hand-back). First line: "Closed out: <unit id>". Then: what is done, what is half-done,',
	'   the next step, the files touched (from `git status`), and the last test run and its result.',
	'3. Then stop. The one who started you saves the hand-off and starts a fresh agent from your note.',
].join('\n');

// The final report: last_assistant_message, else the transcript's latest turn: its first assistant entry with content
// decides, its hand-back message, else its text when it calls no tool.
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

// A reviewer report needs a "ROLE:" line, five-field finding lines (severity | CONFIRMED or PLAUSIBLE |
// claim | file:line | evidence) or "No findings", and a "Not checked:" line.
const SEVERITY_ROW = /^\s*(critical|high|medium|low)\s*\|/i;
// A RECORD: block meets the same shape in JSON (record-counts.cjs recordCounts).
function countRecord(report, where) {
	try { return { record: recordCounts(report) }; } catch (e) { return { failed: true, held: fail('record-counts', e, where) }; }
}
function reportFaults(report, record) {
	const lines = String(report).split(/\r?\n/);
	const faults = [];
	if (!record && !lines.some((l) => /^\s*ROLE:\s*\S/.test(l))) faults.push('a "ROLE: <your role>" line');
	const rows = lines.filter((l) => SEVERITY_ROW.test(l));
	if (!record && !rows.length && !lines.some((l) => /^\s*No findings\b/i.test(l))) faults.push('one line per finding, or "No findings"');
	const loose = rows.filter((l) => { const f = l.split('|').map((x) => x.trim()); return f.length < 5 || f.slice(0, 5).some((x) => !x) || !/^(CONFIRMED|PLAUSIBLE)$/i.test(f[1]); });
	if (loose.length) faults.push(`each finding in five fields, "<severity> | <CONFIRMED or PLAUSIBLE> | <claim> | <file:line> | <evidence>" (${loose.length} line(s) are not)`);
	const noted = lines.some((l) => /^\s*Not checked:/i.test(l)) || (record !== null && record.notChecked > 0);
	if (!noted) faults.push('a "Not checked:" line (what you did not get to, or "nothing")');
	return faults;
}

// Kit roles that report up and task no one; an orchestrator and the main session are taskers.
const REPORTING_ROLES = ['builder', 'checker', 'scanner', 'reviewer', 'tester', 'test-reviewer', 'researcher', 'drafter', 'writer'];

// One event's answer: { out } refuses a tool call (via guard.cjs), { code: 2 } holds a stop.
function run(input) {
	load();
	const cwd = input.cwd || process.cwd();
	const found = findPhrase(cwd);
	if (!found) return {};
	const phrase = words(found.phrase);

	const who = { role: input.agent_type || 'unknown', agent: String(input.agent_id || ''), session: input.session_id || '' };
	const key = (who.agent || `${who.session}-${who.role}`).replace(/[^\w.-]/g, '_');
	// The canary's own block leaves a mark, so the report after it is told apart from a first one.
	const mark = path.join(found.commonDir, 'kit-canary-blocked', key);
	// A hand-back checked at its call leaves a seen mark, so the stops after it add nothing to the log.
	const seen = path.join(found.commonDir, 'kit-canary-seen', key);
	const touch = (f) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ''); };

	// The desktop app's hand-back, checked at the call: the stop fires before it reaches the transcript.
	if (input.hook_event_name === 'PreToolUse' && input.tool_name === 'SubagentHandback') {
		const report = String((input.tool_input || {}).message || '');
		if (fs.existsSync(mark)) {
			fs.rmSync(mark, { force: true });
			touch(seen);
			log(found.commonDir, { ...who, result: /^\W*closed out\b/i.test(report) ? 'closed-out' : 'void-after-miss' });
			return {};
		}
		const opens = words(report).startsWith(phrase);
		// A reviewer's report feeds the ledger: its shape is checked once; a second try passes, logged.
		if (opens && input.agent_type === 'reviewer') {
			const counted = countRecord(report, cwd);
			if (counted.failed) return counted.held ? { out: counted.held } : {};
			const shaped = path.join(found.commonDir, 'kit-canary-shape', key);
			if (fs.existsSync(shaped)) {
				fs.rmSync(shaped, { force: true });
				log(found.commonDir, { ...who, result: reportFaults(report, counted.record).length ? 'shape-after-miss' : 'hit' });
				touch(seen);
				return {};
			}
			const faults = reportFaults(report, counted.record);
			if (faults.length) {
				log(found.commonDir, { ...who, result: 'shape-miss' });
				touch(shaped);
				return { out: { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Your report is out of the shape your brief gives, so the sweep cannot count it. Send it again with: ${faults.join('; ')}.` } } };
			}
		}
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

// A throw answers by its tier (hook-error.cjs); without it, a deny and one row (fs-only walk).
const fail = (id, e, cwd) => {
	let h = null;
	try { h = require('./hook-error.cjs'); } catch { /* missing: denied below */ }
	if (h) return h.onError(id, e, cwd || process.cwd());
	try {
		let d = path.resolve(cwd || process.cwd()), g;
		while (!fs.existsSync(g = path.join(d, '.git')) && path.dirname(d) !== d) d = path.dirname(d);
		if (fs.statSync(g).isFile()) { const x = path.resolve(d, /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(g, 'utf8'))[1].trim()); try { g = path.resolve(x, fs.readFileSync(path.join(x, 'commondir'), 'utf8').trim()); } catch { g = x; } }
		fs.appendFileSync(path.join(g, 'kit-guard-open.log'), JSON.stringify({ kind: 'hook-error', id: 'hook-error', hook: 'canary.cjs', error: 'hook-error.cjs is missing', at: new Date().toISOString() }) + '\n');
	} catch { /* the deny stands without its row */ }
	return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'hook error: lead review: hook-error.cjs is missing' } };
};
const check = (input) => { try { return run(input).out || null; } catch (e) { return fail('canary', e, input && input.cwd); } };

if (require.main === module) {
	try {
		const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
		const pre = input.hook_event_name === 'PreToolUse';
		// A repeated stop that crashes again goes through, its row written (K375).
		const stopRetry = !pre && input.stop_hook_active === true;
		// The hand-back gate follows its hold's mode; one deny carries both reasons.
		let gate = null;
		if (pre && input.tool_name === 'SubagentHandback') { try { gate = require('./handoff-gate.cjs').run(input); } catch (e) { gate = fail('handoff-gate', e, input.cwd); } }
		let held = null;
		let r = {};
		try { r = run(input); } catch (e) { held = fail('canary', e, input.cwd); }
		const denies = [gate, r.out, pre ? held : null].filter(Boolean);
		if (denies.length) process.stdout.write(JSON.stringify({ hookSpecificOutput: { ...denies[0].hookSpecificOutput, permissionDecisionReason: denies.map((o) => o.hookSpecificOutput.permissionDecisionReason).join(' ') } }));
		if (r.code === 2) process.stderr.write(CLOSE_OUT + '\n');
		process.exitCode = r.code || 0;
		if (held && !pre && !stopRetry) { process.stderr.write(`${held.hookSpecificOutput.permissionDecisionReason}\n`); process.exitCode = 2; }
	} catch (e) {
		const held = fail('canary', e);
		if (held) { process.stderr.write(`${held.hookSpecificOutput.permissionDecisionReason}\n`); process.exitCode = 2; }
	}
}

module.exports = { check };
