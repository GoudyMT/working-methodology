// PreToolUse guard: asks the user before a shell delete that reaches outside this session's own places - its
// session folder (<temp>/claude/<project key>/<session_id>/, unique to one session) and the project tree. A
// closeout once deleted other sessions' files from a shared temp folder by wildcard; this reads each delete's
// targets the way a shell does, and anything it cannot place inside those two asks.
// Usage (settings.json): command "node", args [<this file>], onFailure "block" (a hook that crashes, times out or
// cannot start must not let the delete through).
// Reads: rm, rmdir, unlink, del, erase, rd, ri, Remove-Item, rimraf, del-cli, shred (any folder, .exe or not,
// anywhere in a command, so a wrapper such as sudo -u x or timeout 5 cannot hide one), find -delete, git clean
// (asks unless a dry run), a git alias set in the same command that cleans, removes or hard-resets, git worktree
// remove, robocopy with a removing switch or a job file written out with /, // or -, rsync --delete, inline node, deno, bun, python, py, perl, ruby or
// php code that deletes, .NET Delete calls (also ForEach-Object Delete), nested shells (bash -c, powershell
// -Command), a cd to a written-out folder (trusted alone only through an && chain); an encoded
// PowerShell command asks. A target is placed after junctions and links are followed, each ".." read both through
// the link before it (Git Bash) and as written (PowerShell), and must be inside either way.
// Asks rather than reads: a target holding a variable, a splat, a brace expansion, a ~user form, a provider path
// (X::), a drive-relative path (D:x), a UNC path, a .git folder, a ".." after a wildcard; a command that makes a
// link and deletes; a delete next to a backtick or a cmd caret; a command over 100,000 characters.
// Limits: it is no match for a path built at run time (Invoke-Expression on joined strings, a script file it
// cannot read), a switch joined at run time ('/MI'+'R'), a word hidden by a shell escape in a nested shell
// (bash -c git\ clean), git run from inline code or xargs, or config that defines an alias by another route
// (include.path, a rewritten config file, HOME); Remove-Item -Recurse may follow a junction found below the target, which is not looked for; the
// session folder layout is proven on Windows only. Like guard-outward.cjs it is self-contained, so a missing
// sibling never turns the guard off.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BACKSLASH = String.fromCharCode(92);
const BACKTICK = String.fromCharCode(96);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
// < and > end a word, not a command: words after a redirection (rm a > log b) or a PowerShell block comment
// (<# x #>) are still the command's own.
const SEGMENT_BREAKS = new Set([';', '|', '&', '(', ')', '{', '}', LF]);
const MAX_DEPTH = 3;
const MAX_TEXT = 100000;

const DELETERS = new Set(['rm', 'rmdir', 'unlink', 'del', 'erase', 'rd', 'ri', 'remove-item', 'rimraf', 'del-cli', 'shred']);
const CMD_DELETERS = new Set(['del', 'erase', 'rd', 'rmdir']);
// rmdir, rd and unlink without a recursive switch remove a link itself, never what it points to.
const LINK_SAFE = new Set(['rmdir', 'rd', 'unlink']);
const DIR_CHANGERS = new Set(['cd', 'chdir', 'pushd', 'sl', 'set-location', 'push-location']);
// They go back to a folder the guard does not track.
const DIR_RETURNS = new Set(['popd', 'pop-location']);
// Named alone or by a path (.venv/Scripts/python, "C:/Program Files/nodejs/node.exe").
const INTERPRETER = /(^|[\s;|&('"\\/])(node|deno|bun|python[\d.]*|py|perl|ruby|php)(\.exe)?(['"\s]|$)/i;
const INLINE_DELETE = /\b(rmSync|rmdirSync|unlinkSync|rmtree|rm_rf|rm_r|remove_tree|removeSync|removedirs)\s*\(|\b(fs|fsp|promises|fse|os|shutil|FileUtils|Deno|File)\s*\.\s*(rm|rmdir|unlink|remove|delete)\w*\s*\(|\)\s*\.\s*(rm|rmdir|unlink|rmSync|rmdirSync|unlinkSync)\s*\(|\bunlink\b/;
// A delete word anywhere in the text, to check text the tokenizer cannot split (backticks, carets).
const DELETE_WORD = /(^|[^\w-])(rm|rmdir|unlink|del|erase|rd|ri|remove-item|rimraf|del-cli|shred)(\.exe)?(?![\w-])/i;
// New-Item takes the type however it is spelled (-ItemType "Junction", -Type:Junction), and ln takes -s anywhere.
const MAKES_LINK = /\bmklink\b|\bln(\.exe)?\s([^;|&\n]*\s)?(-[a-z]*s|--sy)|\bsymlinkSync\b|\b(new-item|ni)\b[\s\S]*\b(Junction|SymbolicLink)\b/i;
// The read-only searchers: a delete word in their arguments is a pattern, not a command.
const SEARCHERS = new Set(['grep', 'egrep', 'fgrep', 'rg', 'findstr', 'select-string', 'sls']);
const GIT_READS = new Set(['grep', 'log', 'show', 'diff', 'blame']);
// get-item and gi list the items themselves, the others what is inside them.
const LISTERS = new Set(['get-childitem', 'gci', 'get-item', 'gi']);
const ITEM_LISTERS = new Set(['get-item', 'gi']);
// The only pipeline stages that pass a listing's paths on unchanged.
const FILTERS = new Set(['where-object', 'where', '?']);
// Variables that make git or rg run another program, and ones that move git's working tree.
// Named anywhere, not only as NAME=: PowerShell sets them through Env: paths and SetEnvironmentVariable too.
const RUNS_VIA_ENV = /\b(GIT_EXTERNAL_DIFF|GIT_PAGER|PAGER|GIT_CONFIG_\w*|RIPGREP_CONFIG_PATH)\b/i;
const MOVES_GIT = /\b(GIT_WORK_TREE|GIT_DIR|GIT_COMMON_DIR)\b|core\.worktree|include\.path|includeIf\./i;
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
const GIT_VALUE_OPTIONS = new Set(['-c', '-C', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env', '--attr-source', '--shallow-file']);
// Text the tokenizer may split where a shell does not, so a word read from it proves nothing: a comma, a variable, a
// backtick, a control character, an escaped space, quote or break, an empty word, a character it folds to ASCII.
const UNCLEAR_TEXT = /[,`$\x00-\x08\x0b-\x1f\u0080-\uffff]|\\[\s";&|()<>]|""|''/;
// A clean's own words: from the word to the next break a shell would obey, so what follows it cannot make it ask.
const CLEAN_SPAN = /\bclean\b(?:\\.|[^;|&\n])*/g;
// A comma or escape in git's own options makes the tokenizer lose the subcommand: git -c x.y=a,b clean.
const LOST_CLEAN = /\bgit(\.exe)?\s+-[^;|&\n]*[,\\][^;|&\n]*\sclean\b/i;
// What an alias may run that deletes, once its quoting is off.
const DELETE_ALIAS = /(^|[\s!;&|(])(clean|rm|rm\.exe|worktree)(\s|$)|(^|[\s!;&|(])reset\s([\s\S]*\s)?--ha/;
const GIT_CLEAN_TEXT = /\bgit(\.exe)?\s+clean(\s|$|`)/i;
// robocopy takes / or - (Git Bash needs //), a word of its own or glued to the name; a job file can carry any of
// these, so it asks unread. A path segment is not a switch.
const ROBOCOPY_REMOVES = /(?:^|[\s(,=;[@]|robocopy(?:\.exe)?)(?:\/+|-)(?:mir|purge|mov|move|job)(?=$|[\s,);:\]])/i;
// A single search or a commit message names robocopy without running it.
const ONLY_READS = /^\s*(rg|grep|egrep|fgrep|findstr|select-string|sls|git\s+(commit|log|grep|show|diff))\s[^;|&\n]*$/i;
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

// The text with PowerShell block comments (<# ... #>) and line comments (a # that starts a word, to the line's
// end) cut out.
function withoutComments(text) {
	return text.replace(/<#[\s\S]*?(#>|$)/g, ' ').replace(/(^|[\s;|&(){}])#[^\n]*/g, '$1');
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
	// How much of the word came before its first quote: cmd reads cd"C:\x" as cd C:\x.
	let lead = -1;
	// The word after < or > is a redirection's file, not one of the command's own words.
	let redirect = false;
	const endWord = () => {
		if (inWord) {
			segment.push({ value: current, quoted, redirect, lead });
			redirect = false;
		}
		current = '';
		inWord = false;
		quoted = false;
		lead = -1;
	};
	const endSegment = (end) => {
		endWord();
		redirect = false;
		const last = segments[segments.length - 1];
		if (segment.length > 0) {
			segment.end = end;
			segment.opens = end === '{' ? 1 : 0;
			segment.closes = end === '}' ? 1 : 0;
			segment.endsGroup = end === ')';
			segments.push(segment);
		} else if (last) {
			// && and || are kept as one break; a pipe followed by a line break still feeds the next line.
			if ((end === '&' || end === '|') && last.end === end) last.end = end + end;
			else if (!(['|', '||', '&&'].includes(last.end) && end === LF)) last.end = end;
			if (end === '{') last.opens++;
			if (end === '}') last.closes++;
			if (end === ')') last.endsGroup = true;
		}
		segment = [];
	};
	const chars = [...text];
	for (let c = 0; c < chars.length; c++) {
		const ch = chars[c];
		if (quote) {
			if (ch === quote) quote = '';
			else current += ch;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			if (!quoted) lead = current.length;
			quoted = true;
			inWord = true;
		} else if ((ch === '&' || ch === '|') && redirect && !inWord && /[<>]/.test(chars[c - 1])) {
			// 2>&1, >&2 and >| are one redirection, not a break.
			continue;
		} else if (ch === '&' && chars[c + 1] === '>') {
			// &> sends both streams to a file.
			continue;
		} else if (SEGMENT_BREAKS.has(ch)) {
			endSegment(ch);
		} else if (ch === '<' || ch === '>') {
			// A stream number glued to the redirection (2>) is part of it, not a word. PowerShell's *> keeps its *, which
			// bash reads as a wildcard target.
			if (inWord && !quoted && /^\d+$/.test(current)) inWord = false;
			endWord();
			redirect = true;
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
function programName(raw) {
	if (raw === undefined) return '';
	// A git alias that starts with ! runs a shell command: '!rm -rf x'.
	const word = raw.replace(/^!+/, '');
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

// git clean is a dry run only when the last word that sets it says so: git reads options in order, so --no-dry-run
// undoes -n. -e and --exclude take a pattern: the rest of their letter group (-en is the pattern n) or, when nothing
// follows in the group, the next word. A long option it does not know may be an abbreviation that takes the next word.
function cleanDryRun(own) {
	let dry = false;
	for (let i = 0; i < own.length; i++) {
		const w = own[i];
		if (w === '--' || w === '--end-of-options') break;
		if (w === '--dry-run') dry = true;
		else if (/^--no-d/.test(w)) dry = false;
		else if (w === '--exclude') i++;
		else if (w.startsWith('--')) {
			if (!/^--(exclude=.*|force|quiet|interactive)$/.test(w)) return false;
		} else if (/^-[A-Za-z]+$/.test(w)) {
			for (let c = 1; c < w.length; c++) {
				if (w[c] === 'e') {
					if (c === w.length - 1) i++;
					break;
				}
				if (w[c] === 'n') dry = true;
			}
		}
	}
	return dry;
}

// An alias set in the same command (git -c alias.x=..., git config alias.x ..., --config-env) hides its subcommand
// behind a name the guard does not know, so one that runs clean, rm, worktree or reset --hard asks. git strips quotes
// and backslashes from the value, so they come off first; a value held in a variable cannot be read, so it asks.
function definesDeleteAlias(words) {
	for (let i = 0; i < words.length; i++) {
		if (/^--config-env=alias\./i.test(words[i]) || (words[i] === '--config-env' && /^alias\./i.test(words[i + 1] ?? ''))) return true;
		const m = /^alias\.[^=]+(=([\s\S]*))?$/i.exec(words[i]);
		if (!m) continue;
		const value = m[1] !== undefined ? m[2] : words[i + 1] ?? '';
		if (value.includes('$') || DELETE_ALIAS.test(value.replace(/[\\`'"]/g, ''))) return true;
	}
	return false;
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
	// D:x is relative to the current folder of drive D, which the guard does not know.
	if (ctx.windows && /^[A-Za-z]:(?![\\/])/.test(t)) return 'a drive-relative target';
	if (!api.isAbsolute(t) && state.moved) return 'a relative target after a change of folder';
	const wild = t.search(WILDCARD);
	let fixed = t;
	if (wild >= 0) {
		if (t.slice(wild).split(/[\\/]/).includes('..')) return 'a .. after a wildcard';
		const head = t.slice(0, wild);
		const cut = Math.max(head.lastIndexOf('/'), head.lastIndexOf(BACKSLASH));
		fixed = cut >= 0 ? head.slice(0, cut + 1) : '.';
	}
	const keep = keepLast && wild < 0;
	// Every folder the command may be in, and ".." read both through links (Git Bash) and as written (PowerShell).
	for (const cwd of state.cwds) {
		const asWritten = api.resolve(cwd, fixed);
		const places = [walk(fixed, { ...ctx, cwd }, keep), keep ? api.join(realOf(api.dirname(asWritten), api), api.basename(asWritten)) : realOf(asWritten, api)];
		for (const resolved of places) {
			const inRoot = ctx.roots.some((root) => {
				const rel = api.relative(root, resolved);
				const inside = rel !== '' && !rel.startsWith('..') && !api.isAbsolute(rel);
				return inside || (wild >= 0 && rel === '');
			});
			if (!inRoot) return target;
		}
	}
	return '';
}

// A cd to a written-out folder moves where relative targets are placed. It is trusted alone only when it starts its
// command and runs for sure (first, or after ; & && or a line break), and only through the && chain after it: at the
// first other break it may have failed, so the old folders come back. Otherwise both the old and the new folder are
// kept. cmd's cd without /d stays on the current drive, so a cd to another drive is not trusted either. Any other
// change of folder (a variable, cd -, popd, env -C, -WorkingDirectory) makes every later relative target ask.
function changeFolder(words, p, ctx, state, after) {
	const drive = /^\/d$/i.test(words[p + 1] ?? '');
	const next = words[p + (drive ? 2 : 1)];
	if (next === undefined || /[$%`~@]/.test(next) || next.startsWith('-')) {
		state.moved = true;
		return;
	}
	let t = next;
	if (ctx.windows) t = t.replace(/^\/tmp(\/|$)/, ctx.tmpdir + '/').replace(/^\/([A-Za-z])(\/|$)/, '$1:/');
	const moved = state.cwds.map((cwd) => ctx.api.resolve(cwd, t));
	const letter = /^([A-Za-z]):/.exec(t);
	const otherDrive = letter && !drive && state.cwds.some((cwd) => cwd[0].toLowerCase() !== letter[1].toLowerCase());
	if (p === 0 && [undefined, ';', '&', '&&', LF].includes(after) && !otherDrive) {
		// Trusted only up to the first break that is not &&: after ; or || the next command runs even if the cd failed.
		state.pending = [...new Set([...(state.pending ?? []), ...state.cwds])];
		state.cwds = moved;
	} else {
		state.cwds = [...new Set([...state.cwds, ...moved])];
	}
	state.seen = [...new Set([...state.seen, ...moved])];
}

// The literal paths a PowerShell listing feeds down a pipeline into a delete with no target of its own: a folder's
// contents (Get-ChildItem) or the items themselves (Get-Item). Only Where-Object stages may stand between them.
function listedTargets(segments, index) {
	let depth = 0;
	for (let i = index - 1; i >= 0; i--) {
		const prev = segments[i];
		const words = prev.filter((word) => !word.redirect).map((word) => word.value);
		const name = programName(words[0]);
		depth += prev.closes;
		if (prev.opens > 0) {
			// The stage that owns a script block: { ... } after Where-Object.
			depth -= prev.opens;
			if (depth < 0 || (depth === 0 && !FILTERS.has(name))) return null;
			continue;
		}
		if (depth > 0) continue;
		if (prev.end !== '|') return null;
		if (LISTERS.has(name)) {
			// Only a listing that starts its command lists paths the guard can see; one fed by anything else does not.
			// Comments and line breaks make that hard to read, so only a listing after ; or & or at the very start counts.
			if (i > 0 && ![';', '&', '&&'].includes(segments[i - 1].end)) return null;
			const starts = targetsOf('', words, 1);
			const paths = starts.length > 0 ? starts : ['.'];
			return ITEM_LISTERS.has(name) ? paths : paths.map((t) => t + '/*');
		}
		if (!FILTERS.has(name)) return null;
	}
	return null;
}

function findDelete(text, ctx, state, depth) {
	const segments = tokenize(joinContinuations(text));
	for (let s = 0; s < segments.length; s++) {
		const segment = segments[s];
		// How the command before this one ended, applied here so no skipped command can miss it. A ( ... ) group may
		// run apart (bash), so after one the command may be in any folder it has been in.
		const before = segments[s - 1];
		if (before?.endsGroup) state.cwds = [...new Set([...state.cwds, ...state.seen])];
		if (before && before.end !== '&&' && state.pending) {
			state.cwds = [...new Set([...state.cwds, ...state.pending])];
			state.pending = null;
		}
		const plain = segment.filter((word) => !word.redirect);
		const words = plain.map((word) => word.value);
		const first = programName(words[0]);
		// A search's pattern is not a command; skipped only when nothing in it runs another program (rg --pre, a git
		// option before the subcommand such as -c core.pager, an external diff or pager).
		// git takes any unambiguous prefix of a long option, and short options cluster (-nO).
		const search = SEARCHERS.has(first) || (first === 'git' && words.slice(1).some((w) => GIT_READS.has(w)));
		const runsOther = words.some((w) => /^(--pre|--hostname-bin|--o(p(e(n(-[\w-]*)?)?)?)?(=|$)|--ext-|--textc|-[A-Za-z]*O)/.test(w));
		if (search && runsOther) return 'a search option that runs another program';
		if (search && (SEARCHERS.has(first) || GIT_READS.has(words[1]))) {
			// A pattern is not run, but a $( ... ) inside a quoted one is: grep "$(rm -rf x)".
			for (const word of segment) {
				const at = word.quoted ? word.value.indexOf('$(') : -1;
				const hit = at >= 0 && depth < MAX_DEPTH ? readNested(word.value.slice(at + 2), ctx, state, depth) : '';
				if (hit) return hit;
			}
			continue;
		}
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
			// cmd also reads a cd with its folder glued on (cd.., cd/d x, cd\x, cd=x, cd"x"); it is not read for its
			// folder, and anything but a letter, digit or space after cd counts as glued (a space is a quoted command,
			// read again below).
			const lead = plain[p].lead > 0 ? words[p].slice(0, plain[p].lead) : '';
			if (/^(cd|chdir|pushd)[^A-Za-z0-9\s]/i.test(words[p]) || /^(cd|chdir|pushd)$/i.test(lead)) state.moved = true;
			else if (DIR_CHANGERS.has(name)) changeFolder(words, p, ctx, state, s > 0 ? segments[s - 1].end : undefined);
			else if (DIR_RETURNS.has(name)) state.moved = true;
			// env -C DIR, env -CDIR, sudo -D DIR, sudo --chdir=DIR, and short options clustered before them.
			else if ((name === 'env' || name === 'sudo') && rest.some((w) => /^(-[A-Za-z]*[CD]|--chdir)/.test(w))) state.moved = true;
			else if (name === 'rsync' && rest.some((w) => /^--(del|delete[\w-]*|remove-source-files)(=|$)/.test(w))) return 'rsync that removes files';
			else if (name === 'git') {
				const { sub, at } = gitSub(words, p + 1);
				const own = words.slice(at);
				// Start-Process takes the command line as one string or a list, wherever its flags put it.
				if (depth < MAX_DEPTH && words.some((w) => /^(start-process|saps)$/i.test(w))) {
					const listed = words.includes('clean') ? [words.slice(words.indexOf('clean')).join(' ')] : [];
					for (const packed of [...words.filter((w) => /\s/.test(w)), ...listed]) {
						const hit = readNested('git ' + packed, ctx, state, depth);
						if (hit) return hit;
					}
				}
				const command = String(sub ?? '').replace(/[\\`^'"]/g, '');
				if (depth === 0 && p === 0 && /\$|^@\w/.test(command)) return 'a git subcommand held in a variable';
				// git's subcommand word (rm) is not the rm program; -C and the tree options move where paths are read.
				if (p === 0) skip.add(at - 1);
				if (MOVES_GIT.test(text) || words.slice(p + 1, at).some((w) => /^(-C|--work-tree|--git-dir)(=|$)/.test(w))) state.moved = true;
				const cached = own.slice(0, own.includes('--') ? own.indexOf('--') : own.length).includes('--cached');
				if (command === 'clean' && (ctx.unclear || !cleanDryRun(own))) return 'git clean';
				if (definesDeleteAlias(words.slice(p + 1))) return 'a git alias that deletes';
				if (sub === 'worktree' && own[0] === 'remove') {
					for (const target of targetsOf('', own, 1)) {
						const hit = placeOf(target, ctx, state);
						if (hit) return hit;
					}
				}
				if (sub === 'rm' && !cached) {
					for (const target of targetsOf('', own, 0)) {
						const hit = placeOf(target, ctx, state);
						if (hit) return hit;
					}
				}
			}
			// tokenize splits a word-start brace into its own command, hiding what follows it, so find with any
			// brace asks: find with a brace is rare, and the safe side.
			else if (name === 'find' && BRACE_EXPANSION.test(text)) return 'a target with a brace expansion';
			// -delete is looked for in the whole text: a \( ... \) group splits find's words across commands.
			else if (name === 'find' && (rest.some((w) => w.toLowerCase() === '-delete') || /(^|[\s'"])-delete(?![\w-])/i.test(text))) {
				// find deletes what it finds below its start folders, so each is read like a folder ending in a wildcard.
				let i = p + 1;
				while (i < words.length && (FIND_OPTIONS.test(words[i]) || words[i] === '-D')) i += words[i] === '-D' ? 2 : 1;
				const starts = [];
				for (; i < words.length && !/^[-!\\(]/.test(words[i]); i++) starts.push(words[i]);
				for (const start of starts.length > 0 ? starts : ['.']) {
					const hit = placeOf(start + '/*', ctx, state);
					if (hit) return hit === start + '/*' ? start : hit;
				}
			} else if (DELETERS.has(name)) {
				if (BRACE_EXPANSION.test(text)) return 'a target with a brace expansion';
				let targets = targetsOf(name, words, p + 1);
				if (targets.length === 0 && p === 0) targets = listedTargets(segments, s) ?? [];
				if (targets.length === 0) return 'a delete whose targets come from elsewhere';
				// Any switch with an r in it may be recursive (-r, -Recurse, /s), and a recursive one follows the link.
				// -Recurse:$true binds a value, and cmd reads a switch glued to the builtin (rd/s/q).
				const glued = words[p].toLowerCase().split('/').slice(1);
				const keepLast = LINK_SAFE.has(name) && !glued.includes('s') && !rest.some((w) => /^(\/s|-[\w-]*r[\w-]*)(:|$)/i.test(w));
				// Redirection files are placed too: if the guard misreads one, it can only add an ask. A stream number
				// (2>&1) and the null sinks are not files.
				const redirects = segment.filter((word) => word.redirect).map((word) => word.value).filter((v) => !/^(\/dev\/null|nul|\$null|\d+|-)$/i.test(v));
				for (const target of [...targets, ...redirects]) {
					const hit = placeOf(target, ctx, state, keepLast);
					if (hit) return hit;
				}
			}
		}
		// Quoted text may be a whole command handed to another shell: bash -c 'rm -rf /tmp/*'.
		if (depth < MAX_DEPTH) {
			for (const word of segment) {
				if (!word.quoted) continue;
				// A quoted name=value (git -c core.pager='...') may hold a command in its value.
				const assigned = /^[\w.-]+=/.test(word.value) ? word.value.slice(word.value.indexOf('=') + 1) : '';
				for (const inner of [word.value, assigned].filter(Boolean)) {
					const hit = readNested(inner, ctx, state, depth);
					if (hit) return hit;
				}
			}
		}
	}
	return '';
}

// Reads text nested in a command (a quoted command, a $( ... )) from this command's folders. A folder change
// inside may or may not last (bash -c and $( ) run apart, Invoke-Expression does not), so its folders, a trusted
// cd's earlier ones included, are added to the outer command's, never put in place of them.
function readNested(inner, ctx, state, depth) {
	const own = { moved: state.moved, cwds: [...state.cwds], seen: [...state.seen], pending: null };
	const hit = findDelete(inner, ctx, own, depth + 1);
	state.moved = state.moved || own.moved;
	state.cwds = [...new Set([...state.cwds, ...own.cwds, ...(own.pending ?? [])])];
	state.seen = [...new Set([...state.seen, ...own.seen])];
	return hit;
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
		const flat = text.split(BACKTICK).join('').split('^').join('');
		ctx.unclear = (raw.match(CLEAN_SPAN) ?? []).some((span) => UNCLEAR_TEXT.test(span));
		if (LOST_CLEAN.test(raw)) return 'git clean';
		// Read in the whole text, quotes off: arrays, wrappers and strings hide the switch from a word-by-word read.
		const bare = flat.replace(/["']/g, '');
		if (/\brobocopy\b/i.test(bare) && ROBOCOPY_REMOVES.test(bare) && !ONLY_READS.test(flat)) return 'robocopy that removes files';
		const deletes = DELETE_WORD.test(flat) || GIT_CLEAN_TEXT.test(flat);
		if (deletes && (text.includes(BACKTICK) || text.includes('^'))) return 'a delete next to a backtick or caret';
		if (deletes && MAKES_LINK.test(text)) return 'a command that makes a link and deletes';
		if (INTERPRETER.test(text) && INLINE_DELETE.test(text)) return 'inline code that deletes';
		if (RUNS_VIA_ENV.test(text) && /(^|[^\w-])(git|rg)(\.exe)?(?![\w-])/i.test(text)) return 'a variable that makes git or rg run a program';
		if (/\.ForEach\s*\(\s*['"]?Delete/i.test(text)) return 'a .NET Delete call';
		// Comments are read both ways: as words, and cut out. A comment the guard misreads can then only add an ask
		// (a quote inside a comment no longer swallows the next line; a # after a comma no longer hides a target).
		const fresh = () => ({ moved: false, cwds: [ctx.cwd], seen: [ctx.cwd] });
		const hit = findDelete(text, ctx, fresh(), 0) || findDelete(withoutComments(text), ctx, fresh(), 0);
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
