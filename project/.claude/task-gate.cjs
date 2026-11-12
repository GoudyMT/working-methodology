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
// A shell command that reads a file: its first program is a plain reader.
const READERS = /^(cat|head|tail|less|more|type|gc|get-content|sed\s+-n|select-string|sls|grep|rg)(\.exe)?\s/i;
const GIT_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--attr-source', '--super-prefix', '--shallow-file']);

// git tag options that only list (F13); a git tag with no word after it lists too.
// These put git tag in list mode whatever follows; --sort, --format and --column list only with no tag name after them
// (the 1.25.0 sweep: git tag --sort=refname v9 makes v9).
const TAG_LISTS = /^(-l|--list|-n\d*|--contains|--no-contains|--points-at|--merged|--no-merged)(=|$)/;
const TAG_SHAPES = /^(--sort|--column|--no-column|--format)(=|$)/;
// gh pr edit options that write the body or title (F13): an edit of labels, reviewers or a milestone waits for none.
const PR_TEXT = /^(-b|--body|-F|--body-file|-t|--title)(=|$)/;
const MAX_DEPTH = 3;
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'pwsh', 'powershell', 'cmd', 'eval', 'wsl', 'git-bash']);

// What a shell command's step needs read: [file, why] pairs. git or gh is found at any word of a segment, so an env
// prefix or a wrapper before it (X=1 git commit, env, command) is read, and quoted text is read as a command another
// shell may run (bash -c "git commit") (F14).
function needs(command, tool, depth = 0) {
	const out = [];
	const text = plainText(joinContinuations(String(command || '')), tool);
	for (const segment of tokenize(text)) {
		const w = segment.filter((x) => !x.redirect).map((x) => x.value);
		for (let at = 0; at < w.length; at++) {
			const name = String(w[at] || '').split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase();
			if (name !== 'git' && name !== 'gh') continue;
			const after = w.slice(at + 1);
			const rest = (values) => { const a = []; for (let i = 0; i < after.length; i++) { if (values.has(after[i])) { i++; continue; } if (!after[i].startsWith('-')) a.push(after[i]); } return a; };
			// Help reads a manual (F13), but only as the first word after the subcommand: anywhere else it may be another
			// option's value (git tag -m -h v9, git commit -m --help make a tag and a commit; the 1.25.0 sweep).
			const help = (i) => i >= 0 && (after[i + 1] === '--help' || after[i + 1] === '-h');
			if (name === 'git') {
				const sub = rest(GIT_VALUE)[0];
				if (help(after.indexOf(sub))) continue;
				const args = after.slice(after.indexOf(sub) + 1);
				const named = args.some((x) => !x.startsWith('-'));
				const lists = sub === 'tag' && (args.length === 0 || args.some((x) => TAG_LISTS.test(x)) || (!named && args.every((x) => TAG_SHAPES.test(x))));
				if (sub === 'commit' || (sub === 'tag' && !lists)) out.push([RELEASE, `git ${sub}`]);
			} else {
				const [group, sub] = rest(GH_VALUE);
				if (help(after.indexOf(sub, after.indexOf(group) + 1))) continue;
				// gh pr new is gh pr create.
				const create = sub === 'create' || sub === 'new';
				const writes = create || after.some((x) => PR_TEXT.test(x));
				if (group === 'pr' && (create || sub === 'edit') && writes) out.push([RELEASE, 'a PR body'], [FINDINGS, 'the sweep summary in a PR body']);
				if (group === 'release' && sub === 'create') out.push([RELEASE, 'a release']);
			}
		}
		// Quoted text is read as a command only where a shell runs it (bash -c "...", eval '...'); echo "git commit" is text.
		const shells = w.some((x) => SHELLS.has(String(x).split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase()));
		if (shells && depth < MAX_DEPTH) for (const word of segment) if (word.quoted) out.push(...needs(word.value, tool, depth + 1));
	}
	return out;
}

// The files read since the session started or last compacted: by the Read tool (its path), or by a shell reader (each
// word of its command), read from the project root. Only this project's own copy counts (F12).
function readSince(transcript, root) {
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
			if (b.name === 'Read') seen.push(path.resolve(root, String(b.input.file_path || '')));
			// A shell read counts only by a reader program, never a command that merely names the file (a commit message
			// citing it, Test-Path), the gated step itself included (the 1.24.0 sweep).
			else if ((b.name === 'Bash' || b.name === 'PowerShell') && READERS.test(String(b.input.command || '').trim())) {
				for (const segment of tokenize(plainText(String(b.input.command || ''), b.name))) for (const word of segment) seen.push(path.resolve(root, word.value));
			}
		}
	}
	return seen;
}
const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);

// The gate's answer for one tool call: a refusal, or null. The dispatcher (guard.cjs) calls this.
function check(input) {
	if (input.agent_id) return null;
	const t = input.tool_input || {};
	let want = [];
	if (input.tool_name === 'Agent' || input.tool_name === 'Task') want = [[TEAMS, 'an agent fan-out']];
	else if (['Bash', 'PowerShell', 'Monitor', 'mcp__terminal__run_in_terminal'].includes(input.tool_name)) want = needs(t.command, input.tool_name);
	// A project without the module (the kit not installed here) has nothing to read: the step goes on.
	const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
	want = want.filter(([file]) => fs.existsSync(path.join(root, file)));
	if (want.length === 0) return null;
	const seen = readSince(String(input.transcript_path), path.resolve(root));
	const missing = want.filter(([file]) => !seen.some((s) => same(s, path.resolve(root, file))));
	if (missing.length === 0) return null;
	const files = [...new Set(missing.map(([f]) => f))];
	return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Held: before ${missing[0][1]}, read ${files.join(' and ')} (the step's rules, kept out of the start load), then run this again.` } };
}

// A gate that cannot read the transcript passes: the output checks behind it still hold.
const safeCheck = (input) => { try { return check(input); } catch { return null; } };
if (require.main === module) {
	let out = null;
	try { out = safeCheck(JSON.parse(fs.readFileSync(0, 'utf8') || '{}')); } catch { /* passes */ }
	if (out) process.stdout.write(JSON.stringify(out));
}

module.exports = { check: safeCheck };
