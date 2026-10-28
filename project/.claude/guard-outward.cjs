// PreToolUse guard: asks the user before any shell command that reaches outside this machine - a git push in
// any spelling, or a gh command that writes to GitHub. A permissions.ask rule matches only the literal prefix
// "git push", so "git -C <path> push" ran without a prompt; this reads the command the way a shell does.
// Usage (settings.json): command "node", args [<this file>]; an optional second arg is a log file that records
// each decision (time, tool, ask/pass - never the command), used to prove the hook fires.
// Limits: it reads ordinary spellings, nested shells (bash -c, powershell -Command) and inline aliases; it is no
// match for a command built at run time (a variable holding "push", Invoke-Expression on joined strings).
const fs = require('node:fs');

const BACKSLASH = String.fromCharCode(92);
const BACKTICK = String.fromCharCode(96);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const SEGMENT_BREAKS = new Set([';', '|', '&', '(', ')', '{', '}', '<', '>', LF]);
const MAX_DEPTH = 3;

const GIT_VALUE_OPTIONS = new Set(['-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']);
const GIT_OUTWARD = new Set(['push', 'send-pack']);
const GIT_NESTED_PUSH = new Set(['lfs', 'subtree']);

const GH_VALUE_OPTIONS = new Set(['-r', '--repo', '--hostname']);
const GH_READ_GROUPS = new Set(['search', 'status', 'browse', 'completion', 'help', 'version']);
const GH_READ_SUBS = new Set(['view', 'list', 'status', 'checks', 'diff', 'watch', 'download']);

// Line continuations (PowerShell backtick, bash backslash) join one command across lines.
function joinContinuations(text) {
	let out = text;
	for (const mark of [BACKTICK, BACKSLASH]) {
		out = out.split(mark + CR + LF).join(' ').split(mark + LF).join(' ');
	}
	return out;
}

// Splits text into commands (at ; | & ( ) { } < > and newlines) and each command into words, keeping quoted
// text in one word. Quote characters are dropped; a word that held quoted text is marked, so its content can be
// read again as a nested command.
function tokenize(text) {
	const segments = [];
	let segment = [];
	let current = '';
	let inWord = false;
	let quoted = false;
	let quote = '';
	const endWord = () => {
		if (inWord) segment.push({ value: current, quoted });
		current = '';
		inWord = false;
		quoted = false;
	};
	const endSegment = () => {
		endWord();
		if (segment.length > 0) segments.push(segment);
		segment = [];
	};
	for (const ch of text) {
		if (quote) {
			if (ch === quote) quote = '';
			else current += ch;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			quoted = true;
			inWord = true;
		} else if (SEGMENT_BREAKS.has(ch)) {
			endSegment();
		} else if (ch.charCodeAt(0) <= 32 || ch === ',') {
			endWord();
		} else {
			current += ch;
			inWord = true;
		}
	}
	endSegment();
	return segments;
}

// The program a word names, whatever folder it sits in: "C:/Program Files/Git/cmd/git.exe" -> "git.exe".
function programName(word) {
	const parts = word.split('/').join(BACKSLASH).split(BACKSLASH);
	return parts[parts.length - 1].toLowerCase();
}

function gitOutward(words, start) {
	let i = start;
	while (i < words.length && words[i].startsWith('-')) {
		// An alias defined on the command line can stand for anything, push included.
		if (words[i] === '-c' && (words[i + 1] ?? '').startsWith('alias.')) return 'git with an inline alias';
		i += GIT_VALUE_OPTIONS.has(words[i]) ? 2 : 1;
	}
	const sub = words[i];
	if (sub === undefined) return '';
	if (GIT_OUTWARD.has(sub)) return 'git ' + sub;
	if (GIT_NESTED_PUSH.has(sub) && words.slice(i + 1).includes('push')) return 'git ' + sub + ' push';
	return '';
}

function ghApiWrites(words, start) {
	for (let i = start; i < words.length; i++) {
		const word = words[i];
		let method = '';
		if (word === '-x' || word === '--method') method = words[i + 1] ?? '';
		else if (word.startsWith('--method=')) method = word.slice('--method='.length);
		else if (word.startsWith('-x')) method = word.slice(2);
		// Fields and an input body turn a gh api call into a POST unless a method says otherwise.
		else if (['-f', '--field', '--raw-field', '--input'].some((flag) => word.startsWith(flag))) return true;
		if (method && method !== 'get') return true;
	}
	return false;
}

// gh is read-only only for the subcommands listed; anything else (create, merge, edit, run, sync...) asks.
function ghOutward(words, start) {
	const named = [];
	for (let i = start; i < words.length && named.length < 2; i++) {
		if (words[i].startsWith('-')) {
			if (GH_VALUE_OPTIONS.has(words[i])) i++;
			continue;
		}
		named.push(i);
	}
	if (named.length === 0) return '';
	const group = words[named[0]];
	if (group === 'api') return ghApiWrites(words, named[0] + 1) ? 'gh api with a write method' : '';
	if (GH_READ_GROUPS.has(group)) return '';
	const sub = named.length > 1 ? words[named[1]] : undefined;
	if (sub !== undefined && GH_READ_SUBS.has(sub)) return '';
	return 'gh ' + group + (sub === undefined ? '' : ' ' + sub);
}

function findOutward(text, depth) {
	for (const segment of tokenize(joinContinuations(text))) {
		const words = segment.map((word) => word.value.toLowerCase());
		for (let i = 0; i < segment.length; i++) {
			const name = programName(segment[i].value);
			let hit = '';
			if (name === 'git' || name === 'git.exe') hit = gitOutward(words, i + 1);
			else if (name === 'gh' || name === 'gh.exe') hit = ghOutward(words, i + 1);
			if (hit) return hit;
		}
		// Quoted text may be a whole command handed to another shell: bash -c 'git push'.
		if (depth < MAX_DEPTH) {
			for (const word of segment) {
				const hit = word.quoted ? findOutward(word.value, depth + 1) : '';
				if (hit) return hit;
			}
		}
	}
	return '';
}

// Every string the tool will run, whatever the field is called; the description is only shown, never run.
function collectStrings(value, out, depth) {
	if (typeof value === 'string') out.push(value);
	else if (value && typeof value === 'object' && depth < 5) {
		for (const [key, inner] of Object.entries(value)) {
			if (key !== 'description') collectStrings(inner, out, depth + 1);
		}
	}
}

function decide(input) {
	const strings = [];
	collectStrings(input?.tool_input, strings, 0);
	return findOutward(strings.join(LF), 0);
}

function main() {
	let raw = '';
	process.stdin.setEncoding('utf8');
	process.stdin.on('data', (chunk) => {
		raw += chunk;
	});
	process.stdin.on('end', () => {
		let reason = '';
		let toolName = '';
		let prNote = '';
		try {
			const input = JSON.parse(raw);
			toolName = String(input.tool_name ?? '');
			reason = decide(input);
			// A push or a PR is where a PR body goes out: name the skill that writes and audits it.
			const command = String((input.tool_input && input.tool_input.command) ?? '');
			if (/\bgit\b[\s\S]*\bpush\b|\bgh\s+pr\s+(create|edit)\b/.test(command)) prNote = ' Before a PR: its body comes from the pr-body skill, with its audit shown (rule:pr-body).';
		} catch {
			// A guard that cannot read the command asks rather than lets it through.
			reason = 'the guard could not read this command';
		}
		if (reason) {
			const output = {
				hookSpecificOutput: {
					hookEventName: 'PreToolUse',
					permissionDecision: 'ask',
					permissionDecisionReason: 'Outward action (' + reason + '): it runs only with the user saying yes.',
				},
			};
			// The reason on an "ask" is shown to the user; added context is what reaches Claude.
			if (prNote) output.hookSpecificOutput.additionalContext = prNote.trim();
			process.stdout.write(JSON.stringify(output));
		}
		// The decision is out before the log is touched: a log that cannot be written must never cost the ask.
		const logFile = process.argv[2];
		if (logFile) {
			try {
				fs.appendFileSync(logFile, new Date().toISOString() + ' ' + toolName + ' ' + (reason ? 'ask' : 'pass') + LF);
			} catch {
				// The log is a proof aid only.
			}
		}
	});
}

if (require.main === module) main();

module.exports = { decide };
