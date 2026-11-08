// The owner-proof guard (E27): the owner's yes and resume from the phone thread are read from Claude Code's session
// transcripts (<Claude folder>/projects) and the owner's kit-owner.json, so no tool call may write either. PreToolUse
// on Write, Edit, NotebookEdit and every shell. A write tool aimed inside them is refused. A shell command that names
// them is refused unless each command naming them is a plain read (cat, grep, Get-Content ...) with no redirect into
// them. Reads stay open: the sweep tools and the owner read the transcripts.
// Limits, as for every guard here: a path built at run time (a variable, joined strings) is not read, and a process
// of the same user can write any file it can reach. The guard stops slips and a written-out attempt, not a
// determined forger; approve.mjs's other checks (the ask's code, one message per ask, time after the ask) narrow
// what a forged line could do.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { plainText, joinContinuations, tokenize } = require('./guard-read.cjs');

// install user fills this in, so a caller cannot move the protected folder with CLAUDE_CONFIG_DIR.
const INSTALLED_HOME = '{{CLAUDE_HOME}}';
const home = () => (INSTALLED_HOME.startsWith('{' + '{') ? process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude') : INSTALLED_HOME);
const READERS = new Set(['cat', 'head', 'tail', 'less', 'more', 'type', 'gc', 'get-content', 'grep', 'egrep', 'fgrep', 'rg', 'findstr', 'select-string', 'sls', 'ls', 'dir', 'gci', 'get-childitem', 'wc', 'stat', 'test-path', 'file']);
const slash = (p) => p.split('\\').join('/').toLowerCase();
const deny = (reason) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
const REASON = 'The session transcripts and kit-owner.json hold the owner\'s thread answers, so no tool writes them: read them, or leave them to Claude Code and the owner.';

function insideProof(file, cwd) {
	const p = slash(path.resolve(cwd, file));
	const h = slash(path.resolve(home()));
	// The auto memory sits beside the transcripts (projects/<project>/memory/), and sessions write it.
	if (/\/projects\/[^/]+\/memory(\/|$)/.test(p)) return false;
	return p === `${h}/kit-owner.json` || p === `${h}/projects` || p.startsWith(`${h}/projects/`);
}

// Whether a shell word names the protected places, in any of the spellings a command uses for the Claude folder.
function names(word) {
	const w = slash(word).replace(/["']/g, '');
	const h = slash(path.resolve(home()));
	if (/\.claude\/projects\/[^/\s]+\/memory(\/|\s|$)/.test(w) && !/kit-owner\.json/.test(w) && !/\.claude\/projects\/[^/\s]+\/(?!memory)[^/\s]/.test(w.replace(/\.claude\/projects\/[^/\s]+\/memory\S*/g, ''))) return false;
	return /(^|[/\\]|\$\w+|~|%\w+%)\.claude\/projects(\/|$)/.test(w) || w.includes(`${h}/projects`) || /kit-owner\.json/.test(w);
}

function shellWrites(command, tool) {
	const text = plainText(joinContinuations(String(command || '')), tool);
	if (!names(text) && !names(String(command || ''))) return false;
	for (const segment of tokenize(text)) {
		const all = segment.map((x) => x.value);
		if (!all.some(names)) continue;
		const program = path.basename(slash(all[0] || '')).replace(/\.(exe|cmd|bat)$/, '');
		if (!READERS.has(program)) return true;
		if (segment.some((x) => x.redirect && names(x.value))) return true;
	}
	// Named in the text but in no command word the reader saw (a nested shell, odd quoting): the safe side.
	return !tokenize(text).some((segment) => segment.some((x) => names(x.value)));
}

function main() {
	const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
	const t = input.tool_input || {};
	const cwd = input.cwd || process.cwd();
	if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(input.tool_name)) {
		const file = t.file_path || t.notebook_path;
		if (file && insideProof(String(file), cwd)) deny(REASON);
		return;
	}
	if (['Bash', 'PowerShell', 'Monitor', 'mcp__terminal__run_in_terminal'].includes(input.tool_name)) {
		if (shellWrites(t.command, input.tool_name)) deny(REASON);
	}
}

main();
