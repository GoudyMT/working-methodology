// PreToolUse guard: asks the user before a shell delete that reaches outside this session's own places - its
// session folder (<temp>/claude/<project key>/<session_id>/, unique to one session) and the project tree. A
// closeout once deleted other sessions' files from a shared temp folder by wildcard; this reads each delete's
// targets the way a shell does, and anything it cannot place inside those two asks.
// Usage (settings.json): command "node", args [<this file>], onFailure "block" (a hook that crashes, times out or
// cannot start must not let the delete through).
// Reads: rm, rmdir, unlink, del, erase, rd, ri, Remove-Item, rimraf, del-cli, shred (any folder, .exe or not,
// anywhere in a command, so a wrapper such as sudo -u x or timeout 5 cannot hide one), find -delete, git clean
// (asks unless a dry run), git worktree remove, robocopy /MIR or /PURGE, rsync --delete, inline node, deno, bun,
// python, py, perl, ruby or php code that deletes, .NET Delete calls (also ForEach-Object Delete), nested shells
// (bash -c, powershell -Command), a cd to a written-out folder; an encoded PowerShell command asks. A target is
// placed after junctions and links are followed, each ".." read through the link before it, the way Git Bash does.
// Asks rather than reads: a target holding a variable, a splat, a brace expansion, a ~user form, a provider path
// (X::), a UNC path, a .git folder, a ".." after a wildcard; a command that makes a link and deletes; a delete
// next to a backtick or a cmd caret; a command over 100,000 characters.
// Limits: it is no match for a path built at run time (Invoke-Expression on joined strings, a script file it
// cannot read); Remove-Item -Recurse may follow a junction found below the target, which is not looked for; the
// session folder layout is proven on Windows only. Like guard-outward.cjs it is self-contained, so a missing
// sibling never turns the guard off.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BACKSLASH = String.fromCharCode(92);
const BACKTICK = String.fromCharCode(96);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const SEGMENT_BREAKS = new Set([';', '|', '&', '(', ')', '{', '}', '<', '>', LF]);
const MAX_DEPTH = 3;
const MAX_TEXT = 100000;

const DELETERS = new Set(['rm', 'rmdir', 'unlink', 'del', 'erase', 'rd', 'ri', 'remove-item', 'rimraf', 'del-cli', 'shred']);
const CMD_DELETERS = new Set(['del', 'erase', 'rd', 'rmdir']);
// rmdir, rd and unlink without a recursive switch remove a link itself, never what it points to.
const LINK_SAFE = new Set(['rmdir', 'rd', 'unlink']);
const DIR_CHANGERS = new Set(['cd', 'chdir', 'pushd', 'sl', 'set-location', 'push-location']);
const INTERPRETER = /(^|[\s;|&(])(node|deno|bun|python[\d.]*|py|perl|ruby|php)(\.exe)?(\s|$)/i;
const INLINE_DELETE = /\b(rmSync|rmdirSync|unlinkSync|rmtree|rm_rf|rm_r|remove_tree|removeSync|removedirs)\s*\(|\b(fs|fsp|promises|fse|os|shutil|FileUtils|Deno|File)\s*\.\s*(rm|rmdir|unlink|remove|delete)\w*\s*\(|\)\s*\.\s*(rm|rmdir|unlink|rmSync|rmdirSync|unlinkSync)\s*\(|\bunlink\b/;
// A delete word anywhere in the text, to check text the tokenizer cannot split (backticks, carets).
const DELETE_WORD = /(^|[^\w-])(rm|rmdir|unlink|del|erase|rd|ri|remove-item|rimraf|del-cli|shred)(\.exe)?(?![\w-])/i;
const MAKES_LINK = /\bmklink\b|\bln\s+-\w*s|\bsymlinkSync\b|-ItemType\s+(Junction|SymbolicLink|HardLink)\b/i;
// The read-only searchers: a delete word in their arguments is a pattern, not a command.
const SEARCHERS = new Set(['grep', 'egrep', 'fgrep', 'rg', 'findstr', 'select-string', 'sls']);
const GIT_READS = new Set(['grep', 'log', 'show', 'diff', 'blame']);
const LISTERS = new Set(['get-childitem', 'gci', 'get-item', 'gi']);
// -EncodedCommand and the short forms PowerShell accepts for it, with - or /.
const ENCODED = /^[-/](e|ec|en\w*)$/i;
// A .NET Delete on a type or a variable: [IO.Directory]::Delete, $d.Delete, (Get-Item x).Delete.
const DOTNET_DELETE = /::delete\w*$|^(\$[\w:]+)?\.delete\w*$/i;
// A brace that starts a word may be a shell brace expansion ({a,b}, {'a b',c}, {a..c}); quotes and escapes make
// its exact extent hard to read, so any brace with no space after it, in a command that deletes, asks. find's own
// {} is not one. A PowerShell script block written "{ ... }" is unaffected; one written "{...}" asks.
const BRACE_EXPANSION = /\{(?!\})\S/;
const PATH_OPTIONS = new Set(['-path', '-literalpath', '-lp', '-pspath']);
const VALUE_OPTIONS = new Set(['-erroraction', '-ea', '-include', '-exclude', '-filter', '-credential', '-stream', '-warningaction', '-wa', '-informationaction', '-infa', '-errorvariable', '-ev', '-outvariable', '-ov', '-pipelinevariable', '-pv', '-progressaction', '-proga']);
const GIT_VALUE_OPTIONS = new Set(['-c', '-C', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']);
const FIND_OPTIONS = /^-(H|L|P|O\d*)$/;
const WILDCARD = /[*?[]/;
// A session id is a plain id; anything else ("../..") could point the session folder at a shared one.
const SESSION_ID = /^[A-Za-z0-9-]+$/;

// Characters a shell reads like ASCII ones: curly quotes, Unicode dashes and spaces.
function normalize(text) {
	let out = '';
	for (const ch of text) {
		const c = ch.codePointAt(0);
		if (c >= 0x2018 && c <= 0x201b) out += "'";
		else if (c >= 0x201c && c <= 0x201e) out += '"';
		else if (c >= 0x2013 && c <= 0x2015) out += '-';
		else if (c === 0xa0 || c === 0x85 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff) out += ' ';
		else out += ch;
	}
	return out;
}

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
// read again as a nested command. Each command keeps the break that ended it, so a pipeline can be followed back.
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
	const endSegment = (end) => {
		endWord();
		if (segment.length > 0) {
			segment.end = end;
			segments.push(segment);
		} else if (segments.length > 0) {
			segments[segments.length - 1].end = end;
		}
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
			endSegment(ch);
		} else if (ch.charCodeAt(0) <= 32 || ch === ',') {
			endWord();
		} else {
			current += ch;
			inWord = true;
		}
	}
	endSegment('');
	return segments;
}

// The program a word names, whatever folder it sits in, without .exe: "C:/Git/usr/bin/rm.exe" -> "rm"; cmd
// reads a switch glued to a builtin, so "rd/s/q" -> "rd".
function programName(word) {
	const glued = word.split('/')[0].toLowerCase();
	if (word.includes('/') && CMD_DELETERS.has(glued)) return glued;
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

// Walks a written path part by part from its start, reading each ".." from where the link before it points, the
// way Git Bash and the kernel do; the last part is followed too unless keepLast.
function walk(t, ctx, keepLast) {
	const api = ctx.api;
	const root = api.isAbsolute(t) ? api.parse(t).root : '';
	let cur = root ? api.resolve(root) : ctx.cwd;
	const parts = t.slice(root.length).split(/[\\/]/).filter((part) => part !== '' && part !== '.');
	parts.forEach((part, i) => {
		const last = i === parts.length - 1;
		if (part === '..') cur = api.dirname(realOf(cur, api));
		else cur = last && keepLast ? api.join(realOf(cur, api), part) : api.join(cur, part);
	});
	return keepLast ? cur : realOf(cur, api);
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
		} else if (word.startsWith('-') && word.includes(':')) {
			// -LiteralPath:C:\x binds its value; any other -Name:value is read as a target too, the safe side,
			// except a switch set to $true or $false.
			const value = word.slice(word.indexOf(':') + 1);
			if (!/^\$(true|false)$/i.test(value)) targets.push(value);
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

// git's subcommand and where its own words start, past the options git takes before it.
function gitSub(words, start) {
	let i = start;
	while (i < words.length && words[i].startsWith('-')) i += GIT_VALUE_OPTIONS.has(words[i]) ? 2 : 1;
	return { sub: words[i], at: i + 1 };
}

// Where a delete may run without asking: strictly inside the session folder or the project; for a wildcard, the
// fixed folder before it may also be one of those roots itself.
function placeOf(target, ctx, state, keepLast = false) {
	const api = ctx.api;
	if (/[$%]/.test(target) || target.includes(BACKTICK)) return 'a target holding a variable';
	if (target.startsWith('@')) return 'a splatted target';
	// A PowerShell drive other than a disk (HKCU:, Env:, Function:) or a provider path (FileSystem::C:\x).
	if (/^[A-Za-z][A-Za-z0-9]+:/.test(target) || target.includes('::')) return 'a target on a provider path';
	if (/[{}]/.test(target)) return 'a target with a brace expansion';
	let t = target;
	if (t === '~' || t.startsWith('~/') || t.startsWith('~' + BACKSLASH)) t = ctx.home + t.slice(1);
	// ~user, ~+ and ~- name other folders the guard does not look up.
	else if (t.startsWith('~')) return 'a target with a ~ form';
	// A UNC path is outside both roots, and following links on an unreachable host outlasts the hook's timeout.
	if (/^[\\/]{2}/.test(t)) return target;
	// Git Bash spells C:/x as /c/x, and the system temp as /tmp.
	if (ctx.windows) t = t.replace(/^\/tmp(\/|$)/, ctx.tmpdir + '/').replace(/^\/([A-Za-z])(\/|$)/, '$1:/');
	if (t.split(/[\\/]/).some((part) => part.toLowerCase() === '.git')) return 'a .git folder';
	if (!api.isAbsolute(t) && state.moved) return 'a relative target after a change of folder';
	const wild = t.search(WILDCARD);
	let fixed = t;
	if (wild >= 0) {
		if (t.slice(wild).split(/[\\/]/).includes('..')) return 'a .. after a wildcard';
		const head = t.slice(0, wild);
		const cut = Math.max(head.lastIndexOf('/'), head.lastIndexOf(BACKSLASH));
		fixed = cut >= 0 ? head.slice(0, cut + 1) : '.';
	}
	const resolved = walk(fixed, { ...ctx, cwd: state.cwd }, keepLast && wild < 0);
	for (const root of ctx.roots) {
		const rel = api.relative(root, resolved);
		const inside = rel !== '' && !rel.startsWith('..') && !api.isAbsolute(rel);
		if (inside || (wild >= 0 && rel === '')) return '';
	}
	return target;
}

// A cd to a written-out folder moves where relative targets are placed; any other change of folder (a variable,
// cd -, env -C, -WorkingDirectory) makes every later relative target ask.
function changeFolder(words, p, ctx, state) {
	const next = words[p + 1];
	if (next === undefined || /[$%`~@]/.test(next) || next.startsWith('-')) {
		state.moved = true;
		return;
	}
	let t = next;
	if (ctx.windows) t = t.replace(/^\/tmp(\/|$)/, ctx.tmpdir + '/').replace(/^\/([A-Za-z])(\/|$)/, '$1:/');
	state.cwd = ctx.api.resolve(state.cwd, t);
}

// The literal folders a PowerShell listing feeds down a pipeline into a delete with no target of its own.
function listedTargets(segments, index) {
	for (let i = index - 1; i >= 0; i--) {
		const prev = segments[i];
		if (!['|', '{', '}'].includes(prev.end)) return null;
		const words = prev.map((word) => word.value);
		if (LISTERS.has(programName(words[0]))) {
			// A listing fed by a pipeline of its own lists paths the guard cannot see.
			if (i > 0 && segments[i - 1].end === '|') return null;
			const starts = targetsOf('', words, 1);
			return starts.length > 0 ? starts : ['.'];
		}
	}
	return null;
}

function findDelete(text, ctx, state, depth) {
	const segments = tokenize(joinContinuations(text));
	for (let s = 0; s < segments.length; s++) {
		const segment = segments[s];
		const words = segment.map((word) => word.value);
		const first = programName(words[0]);
		// A search's pattern is not a command; skipped only when nothing in it runs another program (rg --pre, a git
		// option before the subcommand such as -c core.pager, an external diff or pager).
		// git takes any unambiguous prefix of a long option, and short options cluster (-nO).
		const search = SEARCHERS.has(first) || (first === 'git' && words.slice(1).some((w) => GIT_READS.has(w)));
		const runsOther = words.some((w) => /^(--pre|--(o|op|ope|open|open-[w-]*)(=|$)|--ext-[w-]*|--textc[w-]*|-[A-Za-z]*O)/.test(w));
		if (search && runsOther) return 'a search option that runs another program';
		if (search && (SEARCHERS.has(first) || GIT_READS.has(words[1]))) continue;
		const skip = new Set();
		for (let i = 0; i < words.length; i++) {
			const lower = words[i].toLowerCase();
			if (DOTNET_DELETE.test(words[i])) return 'a .NET Delete call';
			if (['%', 'foreach', 'foreach-object'].includes(lower) && words.slice(i + 1).some((w) => /^delete\w*$/i.test(w))) return 'a .NET Delete call';
		}
		if (words.some((w) => ['-workingdirectory', '-wd'].includes(w.toLowerCase()))) state.moved = true;
		// Every word is read as a possible program: a wrapper with its own values (sudo -u x, timeout 5,
		// Start-Process) would otherwise hide the delete behind it. A delete named in plain text asks; that is the
		// safe side.
		for (let p = 0; p < words.length; p++) {
			if (skip.has(p)) continue;
			const name = programName(words[p]);
			const rest = words.slice(p + 1);
			if ((name === 'powershell' || name === 'pwsh') && rest.some((w) => ENCODED.test(w))) return 'an encoded PowerShell command';
			if (DIR_CHANGERS.has(name)) changeFolder(words, p, ctx, state);
			else if ((name === 'env' || name === 'sudo') && rest.some((w) => /^(-C|-D|--chdir)(=|$)/.test(w))) state.moved = true;
			else if (name === 'robocopy' && rest.some((w) => /^\/(mir|purge)$/i.test(w))) return 'robocopy that removes files';
			else if (name === 'rsync' && rest.some((w) => w.startsWith('--delete'))) return 'rsync --delete';
			else if (name === 'git') {
				const { sub, at } = gitSub(words, p + 1);
				const own = words.slice(at);
				// git's subcommand word (rm) is not the rm program; -C and the tree options move where paths are read.
				skip.add(at - 1);
				if (words.slice(p + 1, at).some((w) => /^(-C|--work-tree|--git-dir)(=|$)/.test(w))) state.moved = true;
				if (sub === 'clean' && !own.some((w) => w === '-n' || w === '--dry-run' || /^-\w*n/.test(w))) return 'git clean';
				if (sub === 'worktree' && own[0] === 'remove') {
					for (const target of targetsOf('', own, 1)) {
						const hit = placeOf(target, ctx, state);
						if (hit) return hit;
					}
				}
				if (sub === 'rm' && !own.includes('--cached')) {
					for (const target of targetsOf('', own, 0)) {
						const hit = placeOf(target, ctx, state);
						if (hit) return hit;
					}
				}
			}
			// tokenize splits a word-start brace into its own command, hiding what follows it, so find with any
			// brace asks: find with a brace is rare, and the safe side.
			else if (name === 'find' && BRACE_EXPANSION.test(text)) return 'a target with a brace expansion';
			else if (name === 'find' && rest.some((w) => w.toLowerCase() === '-delete')) {
				// find deletes what it finds below its start folders, so each is read like a folder ending in a wildcard.
				let i = p + 1;
				while (i < words.length && (FIND_OPTIONS.test(words[i]) || words[i] === '-D')) i += words[i] === '-D' ? 2 : 1;
				const starts = [];
				for (; i < words.length && !/^[-!]/.test(words[i]); i++) starts.push(words[i]);
				for (const start of starts.length > 0 ? starts : ['.']) {
					const hit = placeOf(start + '/*', ctx, state);
					if (hit) return hit === start + '/*' ? start : hit;
				}
			} else if (DELETERS.has(name)) {
				if (BRACE_EXPANSION.test(text)) return 'a target with a brace expansion';
				let targets = targetsOf(name, words, p + 1);
				let listed = false;
				if (targets.length === 0 && p === 0) {
					targets = (listedTargets(segments, s) ?? []).map((t) => t + '/*');
					listed = true;
				}
				if (targets.length === 0) return 'a delete whose targets come from elsewhere';
				const keepLast = LINK_SAFE.has(name) && !rest.some((w) => /^(\/s|-\w*r)$/i.test(w));
				for (const target of targets) {
					const hit = placeOf(target, ctx, state, keepLast);
					if (hit) return listed ? hit.slice(0, -2) : hit;
				}
			}
		}
		// Quoted text may be a whole command handed to another shell: bash -c 'rm -rf /tmp/*'.
		if (depth < MAX_DEPTH) {
			for (const word of segment) {
				if (!word.quoted) continue;
				// A quoted name=value (git -c core.pager='...') may hold a command in its value.
				const assigned = /^[\w.-]+=/.test(word.value) ? word.value.slice(word.value.indexOf('=') + 1) : '';
				const hit = findDelete(word.value, ctx, state, depth + 1) || (assigned && findDelete(assigned, ctx, state, depth + 1));
				if (hit) return hit;
			}
		}
	}
	return '';
}

// Every string the tool will run, whatever the field is called; the description is only shown, never run. The
// strings of one object are also read joined, so a command and its args array are read as one command.
function collectStrings(value, out, depth) {
	if (typeof value === 'string') {
		out.push(value);
		return;
	}
	if (!value || typeof value !== 'object') return;
	if (depth >= 5) {
		out.truncated = true;
		return;
	}
	const flat = [];
	for (const [key, inner] of Object.entries(value)) {
		if (key === 'description') continue;
		collectStrings(inner, out, depth + 1);
		if (typeof inner === 'string') flat.push(inner);
		else if (Array.isArray(inner)) flat.push(...inner.filter((item) => typeof item === 'string'));
	}
	if (flat.length > 1) out.push(flat.join(' '));
}

// where: { tmpdir, projectDir } for tests; by default the system temp and the project Claude Code names.
function decide(input, where = {}) {
	if (!input || input.tool_input === undefined || input.tool_input === null) return 'a tool call with nothing the guard can read';
	const strings = [];
	collectStrings(input.tool_input, strings, 0);
	if (strings.truncated) return 'a tool input nested deeper than the guard reads';
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
	for (const raw of strings) {
		if (raw.length > MAX_TEXT) return 'a command too long to read';
		const text = normalize(raw);
		const deletes = DELETE_WORD.test(text.split(BACKTICK).join('').split('^').join(''));
		if (deletes && (text.includes(BACKTICK) || text.includes('^'))) return 'a delete next to a backtick or caret';
		if (deletes && MAKES_LINK.test(text)) return 'a command that makes a link and deletes';
		if (INTERPRETER.test(text) && INLINE_DELETE.test(text)) return 'inline code that deletes';
		if (/\.ForEach\s*\(\s*['"]?Delete/i.test(text)) return 'a .NET Delete call';
		const hit = findDelete(text, ctx, { moved: false, cwd: ctx.cwd }, 0);
		if (hit) return hit;
	}
	return '';
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
					permissionDecisionReason: 'Possible delete outside this session\'s folder and the project (' + reason.slice(0, 200) + '): it runs only with the user saying yes.',
				},
			}));
		}
	});
}

if (require.main === module) main();

module.exports = { decide };
