// The agent canary (rule:agent-canary). Each kit agent opens every message to whoever started it with a phrase that
// lives only on the last line of the project's "Rules every brief carries" block, which the agent must open with
// Read. Role files and preloaded skills are injected automatically, so the phrase never goes there.
//
// Two jobs, by event:
// - Stop (SubagentStop for an agent): the agent's last message must open with the phrase. A miss blocks the stop
//   once with close-out steps that never name the phrase; the stop after the close-out goes through. Every result
//   is logged to <git common dir>/kit-canary.log, one JSON line each, for the run record.
// - PreToolUse on Agent, Task and SendMessage (the leak guard): a brief or message that carries the phrase is
//   denied, so no tasker can hand an agent the phrase it is meant to find by reading.
// A project with no phrase line has the check off. Anything unexpected lets the call through: the checker and the
// lead's review still stand behind it.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const git = (cwd, ...a) => spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8' });
// One spelling for comparing: lower case, any run of spaces or line breaks as one space.
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// The phrase, read from the main checkout so an agent in a worktree (where the notes may be untracked) finds it.
function findPhrase(cwd) {
	const common = git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir');
	if (common.status !== 0) return null;
	const commonDir = common.stdout.trim();
	const root = path.dirname(commonDir);
	for (const f of ['standards/agent-teams.md', '.claude/rules/agent-teams.md', 'AGENTS.md']) {
		const p = path.join(root, f);
		if (!fs.existsSync(p)) continue;
		const m = fs.readFileSync(p, 'utf8').match(/^\s*Confirmation phrase: .* with: (.+?)\s*$/m);
		if (m) return { phrase: m[1], commonDir };
	}
	return null;
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
	const phrase = norm(found.phrase);

	if (input.hook_event_name === 'PreToolUse') {
		const t = input.tool_input || {};
		const text = norm([t.prompt, t.message, t.description].filter(Boolean).join(' '));
		if (text.includes(phrase)) {
			process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
				permissionDecisionReason: 'A brief or message to an agent must never carry the confirmation phrase: the agent finds it by reading its rules (rule:agent-canary). Remove it and send again.' } }));
		}
		return 0;
	}

	const who = { role: input.agent_type || 'unknown', agent: input.agent_id || '', session: input.session_id || '' };
	// The stop after a close-out: the agent was told, so it may end; the lead starts a fresh one.
	if (input.stop_hook_active) { log(found.commonDir, { ...who, result: 'closed-out' }); return 0; }
	const opens = norm(input.last_assistant_message).startsWith(phrase);
	log(found.commonDir, { ...who, result: opens ? 'hit' : 'miss' });
	if (opens) return 0;
	process.stderr.write(CLOSE_OUT + '\n');
	return 2;
}

try { process.exitCode = main(); } catch { process.exitCode = 0; }
