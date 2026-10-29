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
	'2. Reply with your close-out note. First line: "Closed out: <unit id>". Then: what is done, what is half-done,',
	'   the next step, the files touched (from `git status`), and the last test run and its result.',
	'3. Then stop. The one who started you saves the hand-off and starts a fresh agent from your note.',
].join('\n');

function main() {
	const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
	const cwd = input.cwd || process.cwd();
	const found = findPhrase(cwd);
	if (!found) return 0;
	const phrase = words(found.phrase);

	if (input.hook_event_name === 'PreToolUse') {
		const t = input.tool_input || {};
		if (words([t.prompt, t.message, t.description, t.name].filter(Boolean).join(' ')).includes(phrase)) {
			log(found.commonDir, { tool: input.tool_name || 'unknown', session: input.session_id || '', result: 'leak-refused' });
			process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
				permissionDecisionReason: 'A brief or message to an agent must never carry the confirmation phrase: the agent finds it by reading its rules (rule:agent-canary). Remove it and send again.' } }));
		}
		return 0;
	}

	const who = { role: input.agent_type || 'unknown', agent: input.agent_id || '', session: input.session_id || '' };
	// The canary's own block leaves a mark, so the stop after it is told apart from a stop another hook (the
	// checker's clean-tree stop) blocked; stop_hook_active alone cannot tell them apart.
	const mark = path.join(found.commonDir, 'kit-canary-blocked', (who.agent || `${who.session}-${who.role}`).replace(/[^\w.-]/g, '_'));
	if (fs.existsSync(mark)) {
		fs.rmSync(mark, { force: true });
		// The agent was told to close out, so it may end; any other report after a miss is void all the same.
		log(found.commonDir, { ...who, result: /^\W*closed out\b/i.test(String(input.last_assistant_message || '')) ? 'closed-out' : 'void-after-miss' });
		return 0;
	}
	if (typeof input.last_assistant_message !== 'string') { log(found.commonDir, { ...who, result: 'unchecked' }); return 0; }
	const opens = words(input.last_assistant_message).startsWith(phrase);
	log(found.commonDir, { ...who, result: opens ? 'hit' : 'miss' });
	if (opens) return 0;
	fs.mkdirSync(path.dirname(mark), { recursive: true });
	fs.writeFileSync(mark, '');
	process.stderr.write(CLOSE_OUT + '\n');
	return 2;
}

try { process.exitCode = main(); } catch { process.exitCode = 0; }
