// PreToolUse guard: asks the user before a shell delete that reaches outside this session's own places - its
// session folder (<temp>/claude/<project key>/<session_id>/, unique to one session) and the project tree. A
// closeout once deleted other sessions' files from a shared temp folder by wildcard; this reads each delete's
// targets the way a shell does, and anything it cannot place inside those two asks.
// Usage (settings.json): command "node", args [<this file>].
// Reads: rm, rmdir, unlink, del, erase, rd, ri, Remove-Item (any folder, .exe or not, anywhere in a command, so a
// wrapper such as sudo -u x or timeout 5 cannot hide one), find -delete, git clean (always asks), inline node or
// python code that deletes, .NET Delete calls, nested shells (bash -c, powershell -Command); an encoded
// PowerShell command asks. A target is placed after junctions and links are followed.
// Limits: it is no match for a path built at run time (a variable, Invoke-Expression on joined strings); a target
// holding a variable, a brace expansion or a ~user form asks instead. Like guard-outward.cjs it is
// self-contained, so a missing sibling never turns the guard off.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BACKSLASH = String.fromCharCode(92);
const BACKTICK = String.fromCharCode(96);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const SEGMENT_BREAKS = new Set([';', '|', '&', '(', ')', '{', '}', '<', '>', LF]);
const MAX_DEPTH = 3;

const DELETERS = new Set(['rm', 'rmdir', 'unlink', 'del', 'erase', 'rd', 'ri', 'remove-item']);
const CMD_DELETERS = new Set(['del', 'erase', 'rd', 'rmdir']);
const DIR_CHANGERS = new Set(['cd', 'chdir', 'pushd', 'sl', 'set-location', 'push-location']);
// -EncodedCommand and the short forms PowerShell accepts for it.
const ENCODED = /^-(e|ec|en\w*)$/i;
const DOTNET_DELETE = /(\.|::)delete\w*$/i;
// A brace that starts a word may be a shell brace expansion ({a,b}, {'a b',c}, {a..c}); quotes and escapes make
// its exact extent hard to read, so any brace with no space after it, in a command that deletes, asks. A
// PowerShell script block written "{ ... }" is unaffected; one written "{...}" asks, the safe side.
const BRACE_EXPANSION = /\{\S/;
const PATH_OPTIONS = new Set(['-path', '-literalpath', '-lp', '-pspath']);
const VALUE_OPTIONS = new Set(['-erroraction', '-ea', '-include', '-exclude', '-filter', '-credential', '-stream', '-warningaction', '-wa', '-informationaction', '-infa', '-errorvariable', '-ev', '-outvariable', '-ov', '-pipelinevariable', '-pv', '-progressaction', '-proga']);
const GIT_VALUE_OPTIONS = new Set(['-c', '-C', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']);
const INLINE_DELETE = /\b(rm|rmdir|unlink|rmSync|rmdirSync|unlinkSync|remove|removedirs|rmtree)\s*\(/;
const WILDCARD = /[*?[]/;
// A session id is a plain id; anything else ("../..") could point the session folder at a shared one.
const SESSION_ID = /^[A-Za-z0-9-]+$/;

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

// The program a word names, whatever folder it sits in, without .exe: "C:/Git/usr/bin/rm.exe" -> "rm".
function programName(word) {
	const parts = word.split('/').join(BACKSLASH).split(BACKSLASH);
	return parts[parts.length - 1].toLowerCase().replace(/\.exe$/, '');
}

// The path with every junction and link in its existing part followed, so a link inside the project that points
// outside it is placed where it points. A path that does not exist yet keeps its missing tail as written.
function realOf(p, api) {
	const tail = [];
	let head = p;
	for (;;) {
		try {
			return api.join(fs.realpathSync.native(head), ...tail.reverse());
		} catch {
			const up = api.dirname(head);
			if (up === head) return p;
			tail.push(api.basename(head));
			head = up;
		}
	}
}

function targetsOf(name, words, start) {
	const targets = [];
	for (let i = start; i < words.length; i++) {
		const word = words[i];
		const lower = word.toLowerCase();
		if (word === '--') {
			targets.push(...words.slice(i + 1));
			break;
		}
		if (PATH_OPTIONS.has(lower)) {
			if (i + 1 < words.length) targets.push(words[i + 1]);
			i++;
		} else if (VALUE_OPTIONS.has(lower)) {
			i++;
		} else if (word.startsWith('-')) {
			continue;
		} else if (CMD_DELETERS.has(name) && /^\/[a-z]$/i.test(word)) {
			continue;
		} else {
			targets.push(word);
		}
	}
	return targets;
}

function gitCleans(words, start) {
	let i = start;
	while (i < words.length && words[i].startsWith('-')) i += GIT_VALUE_OPTIONS.has(words[i]) ? 2 : 1;
	return words[i] === 'clean';
}

// Where a delete may run without asking: strictly inside the session folder or the project; for a wildcard, the
// fixed folder before it may also be one of those roots itself.
function placeOf(target, ctx, state) {
	const api = ctx.api;
	if (/[$%]/.test(target) || target.includes(BACKTICK)) return 'a target holding a variable';
	// A PowerShell drive other than a disk (HKCU:, Env:, Function:) is not a file.
	if (/^[A-Za-z][A-Za-z0-9]+:/.test(target)) return 'a target on a non-file drive';
	let t = target;
	if (t === '~' || t.startsWith('~/') || t.startsWith('~' + BACKSLASH)) t = ctx.home + t.slice(1);
	// ~user, ~+ and ~- name other folders the guard does not look up.
	else if (t.startsWith('~')) return 'a target with a ~ form';
	// Git Bash spells C:/x as /c/x, and the system temp as /tmp.
	if (ctx.windows) t = t.replace(/^\/tmp(\/|$)/, ctx.tmpdir + '/').replace(/^\/([A-Za-z])(\/|$)/, '$1:/');
	if (!api.isAbsolute(t) && state.moved) return 'a relative target after a change of folder';
	const wild = t.search(WILDCARD);
	let fixed = t;
	if (wild >= 0) {
		const head = t.slice(0, wild);
		const cut = Math.max(head.lastIndexOf('/'), head.lastIndexOf(BACKSLASH));
		fixed = cut >= 0 ? head.slice(0, cut + 1) : '.';
	}
	const resolved = realOf(api.resolve(ctx.cwd, fixed), api);
	for (const root of ctx.roots) {
		const rel = api.relative(root, resolved);
		const inside = rel !== '' && !rel.startsWith('..') && !api.isAbsolute(rel);
		if (inside || (wild >= 0 && rel === '')) return '';
	}
	return target;
}

function findDelete(text, ctx, state, depth) {
	for (const segment of tokenize(joinContinuations(text))) {
		const words = segment.map((word) => word.value);
		if (words.some((word) => DOTNET_DELETE.test(word))) return 'a .NET Delete call';
		// Every word is read as a possible program: a wrapper with its own values (sudo -u x, timeout 5,
		// Start-Process) would otherwise hide the delete behind it. A delete named in plain text asks; that is the
		// safe side.
		for (let p = 0; p < words.length; p++) {
			const name = programName(words[p]);
			if ((name === 'powershell' || name === 'pwsh') && words.slice(p + 1).some((w) => ENCODED.test(w))) return 'an encoded PowerShell command';
			if (DIR_CHANGERS.has(name)) state.moved = true;
			else if (name === 'git' && gitCleans(words, p + 1)) return 'git clean';
			else if ((name === 'node' || name.startsWith('python')) && words.slice(p + 1).some((w) => INLINE_DELETE.test(w))) return 'inline ' + name + ' code that deletes';
			else if (name === 'find' && words.slice(p + 1).some((w) => w.toLowerCase() === '-delete')) {
				// find deletes what it finds below its start folders, so each is read like a folder ending in a wildcard.
				const starts = [];
				for (let i = p + 1; i < words.length && !/^[-!]/.test(words[i]); i++) starts.push(words[i]);
				for (const start of starts.length > 0 ? starts : ['.']) {
					const hit = placeOf(start + '/*', ctx, state);
					if (hit) return hit === start + '/*' ? start : hit;
				}
			} else if (DELETERS.has(name)) {
				if (BRACE_EXPANSION.test(text)) return 'a target with a brace expansion';
				const targets = targetsOf(name, words, p + 1);
				if (targets.length === 0) return 'a delete whose targets come from elsewhere';
				for (const target of targets) {
					const hit = placeOf(target, ctx, state);
					if (hit) return hit;
				}
			}
		}
		// Quoted text may be a whole command handed to another shell: bash -c 'rm -rf /tmp/*'.
		if (depth < MAX_DEPTH) {
			for (const word of segment) {
				const hit = word.quoted ? findDelete(word.value, ctx, state, depth + 1) : '';
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

// where: { tmpdir, projectDir } for tests; by default the system temp and the project Claude Code names.
function decide(input, where = {}) {
	const strings = [];
	collectStrings(input?.tool_input, strings, 0);
	if (strings.length === 0) return '';
	const projectDir = where.projectDir ?? process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
	const windows = /^[A-Za-z]:/.test(projectDir) || process.platform === 'win32';
	const api = windows ? path.win32 : path.posix;
	const tmpdir = where.tmpdir ?? os.tmpdir();
	const roots = [realOf(api.resolve(projectDir), api)];
	const id = String(input.session_id ?? '');
	if (SESSION_ID.test(id)) {
		// Claude Code names the project's folder by its path with every other character turned into a dash.
		roots.push(realOf(api.join(tmpdir, 'claude', projectDir.replace(/[^A-Za-z0-9]/g, '-'), id), api));
	}
	const ctx = { api, windows, roots, tmpdir, cwd: api.resolve(input.cwd ?? projectDir), home: os.homedir() };
	return findDelete(strings.join(LF), ctx, { moved: false }, 0);
}

function main() {
	let raw = '';
	process.stdin.setEncoding('utf8');
	process.stdin.on('data', (chunk) => {
		raw += chunk;
	});
	process.stdin.on('end', () => {
		let reason = '';
		try {
			reason = decide(JSON.parse(raw));
		} catch {
			// A guard that cannot read the command asks rather than lets it through.
			reason = 'the guard could not read this command';
		}
		if (reason) {
			process.stdout.write(JSON.stringify({
				hookSpecificOutput: {
					hookEventName: 'PreToolUse',
					permissionDecision: 'ask',
					permissionDecisionReason: "Delete outside this session's folder and the project (" + reason.slice(0, 200) + '): it runs only with the user saying yes.',
				},
			}));
		}
	});
}

if (require.main === module) main();

module.exports = { decide };
