// PreToolUse guard: asks the user before any shell command that reaches outside this machine - a git push in
// any spelling, or a gh command that writes to GitHub. A permissions.ask rule matches only the literal prefix
// "git push", so "git -C <path> push" ran without a prompt; this reads the command the way a shell does.
// Usage (settings.json): command "node", args [<this file>]; an optional second arg is a log file that records
// each decision (time, tool, ask/pass - never the command), used to prove the hook fires.
// Limits: it reads ordinary spellings, nested shells (bash -c, powershell -Command) and inline aliases; it is no
// match for a command built at run time (a variable holding "push" or part of --owner-yes, $'..' escapes,
// Invoke-Expression on joined strings).
const fs = require('node:fs');

const BACKSLASH = String.fromCharCode(92);
const BACKTICK = String.fromCharCode(96);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const MAX_DEPTH = 3;

const GIT_VALUE_OPTIONS = new Set(['-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env', '--attr-source', '--shallow-file']);
const GIT_OUTWARD = new Set(['push', 'send-pack', 'send-email']);
// A package registry is public: these subcommands change what it holds (--dry-run changes nothing).
const PACKAGERS = new Set(['npm', 'npm.cmd', 'pnpm', 'pnpm.cmd', 'yarn', 'yarn.cmd', 'bun', 'bun.exe']);
const REGISTRY_WRITES = new Set(['publish', 'unpublish', 'dist-tag', 'deprecate', 'owner']);
// HTTP clients: a method other than GET or HEAD, or a body, sends something out. In Windows PowerShell 5.1, curl and
// wget are names for Invoke-WebRequest, so its -Method and -Body count for them too.
const HTTP_CLIENTS = /^(curl|wget|invoke-webrequest|invoke-restmethod|iwr|irm)(\.exe)?$/;
const GIT_NESTED_PUSH = new Set(['lfs', 'subtree']);

const GH_VALUE_OPTIONS = new Set(['-r', '--repo', '--hostname']);
const GH_READ_GROUPS = new Set(['search', 'status', 'browse', 'completion', 'help', 'version']);
const GH_READ_SUBS = new Set(['view', 'list', 'status', 'checks', 'diff', 'watch', 'download']);

const { plainText, joinContinuations, tokenize } = require('./guard-read.cjs');

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

// npm publish, pnpm publish, yarn npm publish: a registry write among the first two subcommand words.
// An option's value may sit before the subcommand (npm --otp 1 publish), so a write word anywhere counts; asking on a
// package that happens to share the name is the safe side. --dry-run false is not a dry run.
function registryWrite(words, start) {
	const rest = words.slice(start);
	const dry = rest.some((w, i) => (w === '--dry-run' && !/^(false|0|no)$/.test(rest[i + 1] ?? '')) || /^--dry-run=(true|1|yes)$/.test(w));
	if (dry) return '';
	const hit = rest.find((w) => REGISTRY_WRITES.has(w));
	return hit ? 'a package ' + hit : '';
}

// The words as written: curl's flags are case-sensitive (-F is a form, -f is --fail; -I is HEAD, -i is headers).
function httpWrite(name, words) {
	const curl = name.startsWith('curl');
	for (let i = 0; i < words.length; i++) {
		const w = words[i];
		const lower = w.toLowerCase();
		let method = '';
		// curl clusters short flags (-sX POST, -sd x): a cluster holding d, F or T sends a body, X names a method. A
		// letter read from an attached value can only add an ask. PowerShell binds a value with a colon (-Method:Post)
		// and takes a unique prefix of a parameter (-Bo, -InF).
		const cluster = curl && /^-[A-Za-z0-9]+$/.test(w) ? w.slice(1) : '';
		const ps = lower.match(/^-(me(?:t(?:h(?:o(?:d)?)?)?)?|bo(?:d(?:y)?)?|inf(?:i(?:l(?:e)?)?)?)(?::(.*))?$/);
		if (cluster.includes('X')) method = cluster.slice(cluster.indexOf('X') + 1) || (words[i + 1] ?? '');
		else if (cluster && /[dFT]/.test(cluster)) return 'an HTTP write';
		else if (lower === '--request' || lower === '--method') method = words[i + 1] ?? '';
		else if (ps && ps[1].startsWith('me')) method = ps[2] !== undefined ? ps[2] : (words[i + 1] ?? '');
		else if (ps) return 'an HTTP write';
		else if (/^--(request|method)=/.test(lower)) method = lower.slice(lower.indexOf('=') + 1);
		else if (curl && (/^-[dFT]/.test(w) || /^--(data(-[\w-]+)?|form(-string)?|upload-file|json)(=|$)/.test(lower))) return 'an HTTP write';
		else if (/^--(post|body)-(data|file)(=|$)/.test(lower)) return 'an HTTP write';
		if (method && !/^(get|head)$/i.test(method)) return 'an HTTP write';
	}
	return '';
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
	// The owner's logged yes: the settings' ask rule reads the raw text, so any spelling with quotes, escapes or a
	// wildcard program is read here, anywhere in the command. A text that only names the flag asks too: the safe side.
	if (/--owner-yes/i.test(text.replace(/[\\`^]\r?\n/g, '').replace(/[\\`^'"]/g, ''))) return 'an owner yes for a sweep';
	if (/\bgit\b[^;|&\n]*\balias\.[\w-]+/i.test(text)) return 'git with an alias';
	// A backtick span is a command bash runs first, wherever it sits; the tokenizer splits it into words.
	if (depth < MAX_DEPTH) for (const m of text.matchAll(/`([^`]+)`/g)) { const hit = findOutward(m[1], depth + 1); if (hit) return hit; }
	for (const all of tokenize(joinContinuations(text))) {
		const segment = all.filter((word) => !word.redirect);
		const words = segment.map((word) => word.value.toLowerCase());
		for (let i = 0; i < segment.length; i++) {
			const name = programName(segment[i].value);
			let hit = '';
			if (/^git-(push|send-pack)(\.exe)?$/.test(name) || (/^git-lfs(\.exe)?$/.test(name) && words[i + 1] === 'push')) hit = name;
			else if (name === 'git' || name === 'git.exe') {
				hit = gitOutward(words, i + 1);
				// xargs hands git its subcommand from input, so a git with none after xargs could be a push.
				if (!hit && words.slice(0, i).some((w) => programName(w) === 'xargs' || programName(w) === 'xargs.exe') && !words.slice(i + 1).some((w) => !w.startsWith('-'))) hit = 'git through xargs';
			}
			else if (name === 'gh' || name === 'gh.exe') hit = ghOutward(words, i + 1);
			else if (PACKAGERS.has(name)) hit = registryWrite(words, i + 1);
			else if (HTTP_CLIENTS.test(name)) hit = httpWrite(name, segment.slice(i + 1).map((word) => word.value));
			if (hit) return hit;
		}
		// Quoted text may be a whole command handed to another shell: bash -c 'git push'. A redirect target is read too,
		// as the delete guard reads it: a here-string feeds a shell (bash <<< "git push"), and $( ) or backticks in a
		// target run before the redirect does (the 1.22.0 sweep).
		if (depth < MAX_DEPTH) {
			for (const word of all) {
				const run = word.quoted || (word.redirect && /\$\(|`/.test(word.value));
				const hit = run ? findOutward(word.value.replace(/^`|`$/g, ''), depth + 1) : '';
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
	const text = strings.join(LF);
	return findOutward(text, 0) || findOutward(plainText(text, input?.tool_name), 0);
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
