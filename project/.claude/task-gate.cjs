// The task gate (E30, option B, the owner 2026-11-08): a step's rules stay out of the start load and are read at the
// step. PreToolUse on the shells and the agent tools: a PR, a commit, a tag or release, and an agent fan-out wait until
// the session has read the rule module the step needs, since it started or last compacted; the refusal names the
// file, so the session reads it and runs the step again. Nothing waits on the owner: it is a refusal, never an ask.
// It reads only the transcript Claude Code names, writes nothing, and passes when it cannot read (the commit-msg
// hook, the push guard and the PR-body audit still check the output). A subagent's steps are its brief's.
// Limits: a step spelled at run time (a variable holding "commit") is not read, as with the guards; a session can
// read a file only to pass, which is the point.
const fs = require('fs');
const path = require('path');
const { plainText, joinContinuations, tokenize } = require('./guard-read.cjs');

const RELEASE = '.claude/rules/git-and-release.md';
const FINDINGS = 'standards/reviews-and-findings.md';
const TEAMS = 'standards/agent-teams.md';
// gh options that take a value before the subcommand (gh -R owner/repo pr create).
const GH_VALUE = new Set(['-R', '--repo', '--hostname']);
const GIT_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env']);

// What a shell command's step needs read: [file, why] pairs.
function needs(command, tool) {
	const out = [];
	const text = plainText(joinContinuations(String(command || '')), tool);
	for (const segment of tokenize(text)) {
		const w = segment.filter((x) => !x.redirect).map((x) => x.value);
		const name = String(w[0] || '').split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase();
		const rest = (values) => { const a = []; for (let i = 1; i < w.length; i++) { if (values.has(w[i])) { i++; continue; } if (!w[i].startsWith('-')) a.push(w[i]); } return a; };
		if (name === 'git') {
			const sub = rest(GIT_VALUE)[0];
			if (sub === 'commit' || sub === 'tag') out.push([RELEASE, `git ${sub}`]);
		} else if (name === 'gh') {
			const [group, sub] = rest(GH_VALUE);
			if (group === 'pr' && (sub === 'create' || sub === 'edit')) out.push([RELEASE, 'a PR body'], [FINDINGS, 'the sweep summary in a PR body']);
			if (group === 'release' && sub === 'create') out.push([RELEASE, 'a release']);
		}
	}
	return out;
}

// The files read since the session started or last compacted: by the Read tool, or named in a shell command.
function readSince(transcript) {
	const lines = fs.readFileSync(transcript, 'utf8').split('\n');
	let seen = [];
	for (const line of lines) {
		if (!line) continue;
		let e;
		try { e = JSON.parse(line); } catch { continue; }
		if (e.type === 'system' && e.subtype === 'compact_boundary') { seen = []; continue; }
		const c = e.message && Array.isArray(e.message.content) ? e.message.content : [];
		for (const b of c) {
			if (!b || b.type !== 'tool_use' || !b.input) continue;
			if (b.name === 'Read') seen.push(String(b.input.file_path || ''));
			else if (b.name === 'Bash' || b.name === 'PowerShell') seen.push(String(b.input.command || ''));
		}
	}
	return seen.map((s) => s.split('\\').join('/'));
}

function main() {
	const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
	if (input.agent_id) return;
	const t = input.tool_input || {};
	let want = [];
	if (input.tool_name === 'Agent' || input.tool_name === 'Task') want = [[TEAMS, 'an agent fan-out']];
	else if (['Bash', 'PowerShell', 'Monitor', 'mcp__terminal__run_in_terminal'].includes(input.tool_name)) want = needs(t.command, input.tool_name);
	// A project without the module (the kit not installed here) has nothing to read: the step goes on.
	const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
	want = want.filter(([file]) => fs.existsSync(path.join(root, file)));
	if (want.length === 0) return;
	const seen = readSince(String(input.transcript_path));
	const missing = want.filter(([file]) => !seen.some((s) => s.includes(file)));
	if (missing.length === 0) return;
	const files = [...new Set(missing.map(([f]) => f))];
	process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Before ${missing[0][1]}: read ${files.join(' and ')} (the step's rules, kept out of the start load), then run this again.` } }));
}

// A gate that cannot read the transcript passes: the output checks behind it still hold.
try { main(); } catch { /* passes */ }
