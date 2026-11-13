// The owner-proof guard (E27): the owner's yes and resume from the phone thread are read from Claude Code's session
// transcripts (<Claude folder>/projects) and the owner's kit-owner.json, so no tool call may write either. T1 (1.25.0):
// the guards are held the same way. The kit's code under any .claude folder, the git hooks (.githooks, .git/hooks)
// and .git/config are never written by a tool (only kit.mjs install writes them); the settings that wire the hooks
// (.claude/settings.json, settings.local.json) are written only with the owner's pop-up yes for that act. PreToolUse
// on Write, Edit, NotebookEdit and every shell. A write tool aimed inside them is refused. A shell command that names
// them is refused unless each command naming them is a plain read (cat, grep, Get-Content ...) with no redirect into
// them. Reads stay open: the sweep tools and the owner read the transcripts.
// Limits, as for every guard here: a path built at run time (a variable, joined strings) is not read, and a process
// of the same user can write any file it can reach. The guard stops slips and a written-out attempt, not a
// determined forger; approve.mjs's other checks (the ask's code, one message per ask, time after the ask) narrow
// what a forged line could do.
// It ships in the project layer beside the guards whose command reader it uses: a hook file missing from an older
// user layer would block every call (the 1.23.0 sweep).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { plainText, joinContinuations, tokenize } = require('./guard-read.cjs');
const { ownerYes, askText } = require('./owner-yes.cjs');

// install project fills this in, so a caller cannot move the protected folder with CLAUDE_CONFIG_DIR.
// Double quotes: an installed path may hold an apostrophe (the 1.25.0 sweep).
const INSTALLED_HOME = "{{CLAUDE_HOME}}";
const findHome = () => (INSTALLED_HOME.startsWith('{' + '{') ? process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude') : INSTALLED_HOME);
// Worked out once per call: it is asked for every word, and reading the environment cost a 98 KB command most of its
// time (K14: 1.8 s of 1.9 s, near the 8 s bar on a busy CI machine).
let homeNow = null;
const home = () => homeNow ?? findHome();
// The Claude folder's parts, worked out once per folder: a long command reads it for every word.
let homeMemo = ['', []];
function homeParts() {
	const h = home();
	if (homeMemo[0] !== h) homeMemo = [h, parts(path.resolve(h))];
	return homeMemo[1];
}
// Plain readers only: rg (--pre) and less (LESSOPEN) can run another program.
const READERS = new Set(['cat', 'head', 'tail', 'type', 'gc', 'get-content', 'grep', 'egrep', 'fgrep', 'findstr', 'select-string', 'sls', 'ls', 'dir', 'gci', 'get-childitem', 'get-item', 'gi', 'jq', 'wc', 'stat', 'test-path', 'file']);
// Copiers: a transcript copied out is a read; one copied in is a write.
const COPIERS = new Set(['cp', 'copy', 'copy-item', 'cpi']);
// Programs that move a shell into a folder: a relative word after one is read from there.
const CHANGERS = new Set(['cd', 'pushd', 'chdir', 'set-location', 'sl', 'push-location', 'popd', 'pop-location']);
// A copier's options that name no destination; any other may (--t is --target-directory to cp), so it refuses.
const COPY_OPTIONS = /^(-[rRpafvni]+|--recursive|--preserve|--archive|--force|--verbose|--no-clobber|--interactive)$/;
// Programs whose quoted words are messages, not paths: a commit message or a PR body may name the file.
const MESSAGES = new Set(['git', 'gh']);
// git subcommands that read or stage a file and write none of the files they name.
const GIT_READS = new Set(['add', 'diff', 'log', 'show', 'status', 'blame', 'ls-files', 'grep', 'cat-file', 'check-ignore', 'commit']);
const slash = (p) => p.split('\\').join('/').toLowerCase();
const deny = (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
const REASON = 'Never by a tool: the session transcripts and kit-owner.json hold the owner\'s answers, so they are protected files. Read them; Claude Code and the owner write them.';
const GUARD_REASON = 'Never by a tool: the kit\'s guards, the git hooks and .git/config are protected files, written only by kit.mjs install. Read them, or ask the owner to reinstall the kit.';
const SETTINGS_REASON = 'a write to a settings file, which wires the guards';

// sed counts as a reader only as -n with one literal print of a line or a range (5p, 1,20p, 3,$p): any other
// script may hold w, W, e or an s///w that writes a file or runs a program (the plan check's P3).
// The reader splits a word at a comma (PowerShell lists), so 1,20p reaches here as 1 and 20p.
const printSed = (w) => {
	// The bare name, looked up on PATH: a path to a sed is any program a tool wrote there (the plan check's P4).
	if (w.length < 4 || !/^sed(\.exe)?$/i.test(w[0] || '') || w[1] !== '-n') return false;
	// Digits only: $p may be a variable holding any script (the 1.28.0 sweep), and quotes are gone by here.
	const at = /^\d+p$/.test(w[2]) ? 3 : /^\d+$/.test(w[2]) && /^\d+p$/.test(w[3] || '') ? 4 : 0;
	return at > 0 && w.length > at && w.slice(at).every((x) => !x.startsWith('-'));
};

// The real path, through any junction, link or short name; a file not yet written resolves through its nearest
// existing folder.
// A link whose target is not there yet is followed to that target, a few links deep.
function real(p, depth = 8) {
	const rest = [];
	while (!fs.existsSync(p) && path.dirname(p) !== p) {
		let link = null;
		try { if (fs.lstatSync(p).isSymbolicLink()) link = fs.readlinkSync(p); } catch { /* not there at all */ }
		if (link !== null && depth > 0) return real(path.join(path.resolve(path.dirname(p), link), ...rest), depth - 1);
		rest.unshift(path.basename(p));
		p = path.dirname(p);
	}
	try { return path.join(fs.realpathSync.native(p), ...rest); } catch { return path.join(p, ...rest); }
}

function insideProof(file, cwd) {
	const p = slash(real(path.resolve(cwd, file)));
	const h = slash(real(path.resolve(home())));
	// The auto memory sits beside the transcripts (projects/<project>/memory/), and sessions write it.
	if (/\/projects\/[^/]+\/memory(\/|$)/.test(p)) return false;
	return p === `${h}/kit-owner.json` || p === `${h}/projects` || p.startsWith(`${h}/projects/`);
}

// Whether one part of a path, which may hold a wildcard (* ? [...]), can be the name given.
function fits(part, name) {
	// A part marked by dotless() is a bash wildcard that never matches a name starting with a dot (K19).
	if (part.charCodeAt(0) === 1) {
		if (name.startsWith('.')) return false;
		part = part.slice(1);
	}
	if (!/[*?[]/.test(part)) return part === name;
	const rx = part.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\[[^\]]*\]?/g, '.').replace(/\*/g, '.*').replace(/\?/g, '.');
	try { return new RegExp(`^${rx}$`).test(name); } catch { return true; }
}

// The parts of a shell word read as a path: slashes one way, . and .. and doubled slashes read the way the shell
// reads them, and a short name (CLAUDE~1) as the folder it names.
// Read once per spelling: each word of a long command is read by several shapes (the T2 teardown's 98 KB command).
const partsSeen = new Map();
function parts(word) {
	const key = String(word);
	if (partsSeen.has(key)) return partsSeen.get(key).slice();
	if (partsSeen.size > 5000) partsSeen.clear();
	const out = partsOf(key);
	partsSeen.set(key, out);
	return out.slice();
}
function partsOf(word) {
	const w = path.posix.normalize(slash(word).replace(/["']/g, '')).replace(/(^|\/)claude~\d+(?=\/|$)/g, '$1.claude');
	// Any other short name (SETTIN~1.JSO, GITHOO~1) is read as the wildcard of the long names it may stand for
	// (*settin*.jso*, *githoo*: the leading dot is dropped in a short name), so it is held where it can name a
	// protected file and nowhere else (the 1.25.0 sweep; CI's RUNNER~1 temp folder names none).
	// Past a few names alike, Windows makes the short name from the first two letters and a 4-digit hex hash
	// (SE1A2B~1.JSO), so a name of that shape is read by its two letters only.
	return w.split('/').filter(Boolean).map((x) => {
		const m = /^([^~*?[]{1,6})~\d{1,6}(?:\.([^.~*?[]{1,3}))?$/.exec(x);
		if (!m) return x;
		const stem = m[1].length === 6 && /^[0-9a-f]{4}$/.test(m[1].slice(2)) ? m[1].slice(0, 2) : m[1];
		return `*${stem}*${m[2] ? `.${m[2]}*` : ''}`;
	});
}

// Whether the parts, from index i, name the transcripts (outside a project's memory) or kit-owner.json.
function protectedFrom(p, i) {
	if (i < p.length && fits(p[i], 'kit-owner.json')) return true;
	if (i >= p.length || !fits(p[i], 'projects')) return false;
	// projects/<project>/memory/..., written out with no wildcard in the memory part, is the auto memory.
	return !(p.length > i + 2 && p[i + 2] === 'memory' && !/[*?[]/.test(p[i + 1]) && p[i] === 'projects');
}

// The kit's guards by their place (T1): code under a .claude folder (not a worktree or the transcripts), the folders
// that hold it, the git hooks and .git/config. A wildcard counts when it can name one.
const CODE = /\.(cjs|mjs|js)$/;
function guardShape(p) {
	for (let i = 0; i < p.length; i++) {
		if (fits(p[i], '.githooks')) return true;
		// config.worktree too: with extensions.worktreeConfig on, git reads hooksPath there (the 1.25.1 sweep).
		if (fits(p[i], '.git') && i + 1 < p.length && (fits(p[i + 1], 'hooks') || fits(p[i + 1], 'config') || fits(p[i + 1], 'config.worktree') || fits(p[p.length - 1], 'config.worktree'))) return true;
		// The push log and the sweep log spend the owner's yes; emptied or made read-only, a yes is used again (the
		// 1.25.0 sweep).
		if (fits(p[i], '.git') && i + 1 < p.length && (/^kit-/i.test(p[i + 1]) || /[*?[]/.test(p[i + 1]))) return true;
		// The user's git config can move the hooks or where origin points, as .git/config can.
		if (i === p.length - 1 && fits(p[i], '.gitconfig')) return true;
		if (fits(p[i], '.config') && p[i + 1] === 'git' && i + 2 < p.length && fits(p[i + 2], 'config')) return true;
		// V3 (1.25.1): what the launcher trusts in the Claude config folder - the guard records and hook shims, and the
		// install record that names the kit folder - by the folder's own name too, when CLAUDE_CONFIG_DIR names another.
		const h = homeParts();
		const trusted = (r) => r.length > 0 && (fits(r[0], 'kit-guard') || fits(r[0], 'kit-install.json') || fits(r[0], 'kit-tools') || fits(r[0], 'kit-hooks'));
		if (h.length && p[i] === h[h.length - 1] && trusted(p.slice(i + 1))) return true;
		if (!fits(p[i], '.claude')) continue;
		const rest = p.slice(i + 1);
		if (rest.length === 0) return true;
		if (rest[0] === 'worktrees' || rest[0] === 'projects') continue;
		if (rest.length === 1 && (rest[0] === 'kit-hooks' || rest[0] === 'kit-tools')) return true;
		if (fits(rest[0], 'kit-guard') || fits(rest[0], 'kit-install.json')) return true;
		const last = rest[rest.length - 1];
		// A wildcard may name any guard the shell finds there (owner-pro* is owner-proof.cjs): it fails closed (S23-1, the
		// mutation check showed only guard.cjs was matched).
		if (CODE.test(last) || /[*?[]/.test(last)) return true;
	}
	return false;
}
// The settings that wire the hooks: a .claude folder's settings.json or settings.local.json.
function settingsShape(p) {
	for (let i = 0; i + 1 < p.length; i++) {
		if (fits(p[i], '.claude') && p.length === i + 2 && (fits(p[i + 1], 'settings.json') || fits(p[i + 1], 'settings.local.json') || fits(p[i + 1], 'protected-folders.json'))) return true;
	}
	return false;
}
// A shell word named by its shape, read from the folder a cd moved to. After a cd the guard cannot follow, a relative
// word may sit in a .claude folder: the safe side.
const shapeNames = (shape) => (word, cwd) => {
	const p = !rooted(word) && Array.isArray(cwd) ? parts([...cwd, word].join('/')) : parts(word);
	if (shape(p)) return true;
	return cwd === 'unknown' && !rooted(word) && shape(['.claude', ...p.filter((x) => x !== '..')]);
};

// Whether a word is written from the root, a home or a variable, so no cd before it moves where it points.
const rooted = (word) => /^([/~$%]|[a-z]:)/.test(slash(word));

// Whether a shell word names the protected places, in any of the spellings a command uses for the Claude folder.
// cwd: where a cd before it moved the shell (its parts), 'unknown' when that cannot be read, null when none did.
function proofNames(word, cwd) {
	const p = !rooted(word) && Array.isArray(cwd) ? parts([...cwd, word].join('/')) : parts(word);
	const h = homeParts();
	for (let i = 0; i < p.length; i++) {
		if (fits(p[i], '.claude') || (p[i] === h[h.length - 1] && h.length > 0)) {
			if (protectedFrom(p, i + 1)) return true;
		}
	}
	// kit-owner.json in a folder the guard cannot place (a variable, or no known folder to start from) may be the
	// owner's; one in a known folder elsewhere, or a word that only holds the name (a sed script), is not (S23-2).
	const last = p[p.length - 1];
	if (last && fits(last, 'kit-owner.json') && (/[$%]/.test(word) || (!rooted(word) && !Array.isArray(cwd)))) return true;
	// After a cd that cannot be read, a relative word may start inside the Claude folder: the safe side.
	if (cwd === 'unknown' && !rooted(word)) return protectedFrom(p, p.findIndex((x) => x !== '..'));
	return false;
}

// Where a cd, pushd or Set-Location moves the shell: its folder's parts, or 'unknown'.
function moved(segment, cwd) {
	// popd and Pop-Location go back to a folder the stack holds, which the guard does not follow.
	const prog = path.basename(slash(segment[0].value));
	if (/^(popd|pop-location)$/.test(prog)) return 'unknown';
	const args = segment.slice(1).map((x) => x.value);
	// A move through the stack or the history (pushd with no folder, pushd +1, cd -, Set-Location +) is not followed.
	if (/^(pushd|push-location)$/.test(prog) && (args.length === 0 || args.some((a) => /^[+-]\d*$/.test(a)))) return 'unknown';
	if (args.some((a) => a === '-' || a === '+')) return 'unknown';
	// Any option the guard does not model (pushd -n, -StackName) and any ~ form but home itself (~+, ~-, ~2) is
	// not followed either: fail closed on what it does not read.
	if (args.some((a, k) => a.startsWith('-') && !/^-(path|literalpath|lp)$/i.test(a) && !(k > 0 && /^-(path|literalpath|lp)$/i.test(args[k - 1])))) return 'unknown';
	if (args.some((a) => /^~[^/\\]/.test(a))) return 'unknown';
	const at = args.findIndex((a) => /^-(path|literalpath|lp)$/i.test(a));
	const arg = at >= 0 ? args[at + 1] : args.find((a) => !a.startsWith('-'));
	if (arg === undefined) return args.length ? 'unknown' : ['~'];
	if (/[$`(]/.test(arg) && !/^(\$home|\$env:userprofile|\$\{?home\}?)([/\\]|$)/i.test(arg)) return 'unknown';
	if (rooted(arg)) return parts(arg);
	return Array.isArray(cwd) ? parts([...cwd, arg].join('/')) : 'unknown';
}

// The words of a git or gh command that are a message (-m, --body, --title, --notes): text, not paths.
const MESSAGE_FLAGS = /^(-m|--message|-b|--body|-t|--title|-n|--notes)$/i;
// Programs a reader may pipe a transcript into: they read their input and write only their output.
const PIPE_READERS = new Set([...READERS, 'sort', 'uniq', 'cut', 'tr', 'select-object', 'select', 'convertfrom-json', 'measure-object', 'measure', 'out-string']);

// start: the folder the shell starts in (the hook's cwd), so a relative word is read from there too.
function shellWrites(command, tool, start, names = proofNames) {
	// Every line is read, here-document bodies too: reading a body as data was spelled around five ways in the 1.24.0
	// sweep (an end mark bash reads otherwise, a cat function, continued lines, nested quotes), so it fails closed.
	// A variable set in the command (P=~/.claude) is read as its value where it is used, before the reader splits ${P} at
	// its braces (F6, the 1.24.0 sweep: P=~/.claude; echo x > ${P}/projects/x/s.jsonl passed).
	// A default or an array element the command writes out (${U:-.claude}, ${P:=x}, P[0]=x; ${P[0]}; a whole list,
	// P=(x), is held by the variable rules below) is read as the
	// text it gives too: the command is refused if that reading writes a protected place (the 1.25.0 sweep).
	const elements = new Map();
	for (const m of String(command || '').matchAll(/(?:^|[\s;&|(])([A-Za-z_]\w*)\[([^\]\s]*)\]=([^\s;&|()'"`$]+)/g)) elements.set(`${m[1]}[${m[2]}]`, m[3]);
	const filled = String(command || '')
		.replace(/\$\{([A-Za-z_]\w*):?[-=+?]([^}]*)\}/g, (m, name, word) => word)
		.replace(/\$\{([A-Za-z_]\w*\[[^\]]*\])\}/g, (m, el) => (elements.has(el) ? elements.get(el) : m));
	if (filled !== String(command || '') && shellWrites(filled, tool, start, names)) return true;
	const given = new Map();
	for (const m of String(command || '').matchAll(/(?:^|[\s;&|(])([A-Za-z_]\w*)=([^\s;&|()'"`$]+)/g)) given.set(m[1], [...(given.get(m[1]) || []), m[2]]);
	// A variable set more than once (P=~/.claude; ... $P ...; P=x) is read as each value it is given in turn: the
	// command is refused if any reading of it writes a protected place (a security review of this build). Past 32
	// readings it fails closed.
	// The value is read ahead only in a command the guard can follow whole (a security review of this build, five passes:
	// each spelling closed showed another). When a variable set here is used, the command is refused unless it has no
	// expansion but plain uses of the variables it sets ($P, ${P}), no command or arithmetic substitution, no backslash,
	// no quoted or escaped assignment, no other way to set a variable (P+=, read, for, declare, printf -v, ${P:=x}), no
	// text run as shell (eval, source, .), and every set is a plain value.
	const usedHere = [...given.keys()].filter((name) => new RegExp(`\\$\\{${name}\\b|\\$${name}\\b`).test(String(command)));
	if (usedHere.length) {
		const text0 = String(command);
		const expansions = [...text0.matchAll(/\$(\{?)/g)].every((m) => {
			const rest = text0.slice(m.index + 1 + m[1].length);
			const name = (/^[A-Za-z_]\w*/.exec(rest) || [''])[0];
			return name !== '' && given.has(name) && (!m[1] || rest[name.length] === '}');
		});
		const sets = [...text0.matchAll(/([A-Za-z_]\w*)\+?=/g)].length === [...given.values()].reduce((n, v) => n + v.length, 0);
		const cut = [...text0.matchAll(/(?:^|[\s;&|(])[A-Za-z_]\w*=[^\s;&|()'"`$]+(.?)/g)].some((m) => /['"`$\\]/.test(m[1]));
		const setters = /\b(read|for|mapfile|readarray|unset|getopts|declare|local|typeset|printf|let|eval|source|alias|export|readonly)\b|(^|\s)\.(\s|$)/.test(text0.replace(/["']/g, ''));
		if (!expansions || !sets || cut || setters || /[`\\]|\$\(/.test(text0)) return true;
	}
	const used = (name) => new RegExp(`\\$\\{${name}\\}|\\$${name}\\b`).test(String(command || ''));
	const twice = [...given].filter(([name, values]) => new Set(values).size > 1 && used(name));
	if (twice.length) {
		if (twice.reduce((n, [, values]) => n * new Set(values).size, 1) > 32) return true;
		const [name, values] = twice[0];
		const use = new RegExp(`\\$\\{${name}\\}|\\$${name}\\b`, 'g');
		return [...new Set(values)].some((value) => shellWrites(String(command).replace(use, () => value), tool, start, names));
	}
	for (const [name, values] of given) given.set(name, values[0]);
	const source = String(command || '').replace(/\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)\b/g, (m, a, b) => (given.has(a || b) ? given.get(a || b) : m));
	// A variable glued to kit-owner.json (${P}kit-owner.json, $X/kit-owner.json) may be the Claude folder: the reader
	// splits a word at braces, so it is refused here, before the split (the 1.24.0 sweep).
	if (/[$%][{(]?[A-Za-z_][\w:]*[})%]?[\\/]?kit-owner\.json/i.test(source)) return true;
	// CDPATH moves a cd the guard cannot follow, so a cd beside it is refused (the 1.24.0 sweep).
	if (/\bCDPATH\b/.test(source) && /(^|[\s;&|(])(cd|pushd|chdir)\b/i.test(source)) return true;
	const text = plainText(joinContinuations(source), tool);
	const segments = tokenize(text);
	let cwd = start ? parts(start) : null;
	let named = false;
	// K19 (pass bar 4): bash's * and ? at the start of a path part never match a name starting with a dot while dotglob
	// is off, so tests/* cannot name .githooks or .claude. Only for an unquoted word with no escape, expansion, brace or
	// ~, in a command that names no way to turn dot globbing on; PowerShell's wildcards match dot names, so not there.
	// zsh (the Bash tool's shell where it is the user's) has the same rule, turned off by setopt or a (D) qualifier; any
	// text run as shell (eval, source, a substitution) could turn either on unseen (the review of this fix).
	const dotglob = tool !== 'Bash' || [String(command || ''), source].some((t) => /dotglob|GLOBIGNORE|BASHOPTS|shopt|bash\s+-O|\+O|setopt|glob_?dots|\(D|\beval\b|\bsource\b|(^|[\s;&|(])\.\s|\$\(|`|\balias\b|BASH_ENV|ENV=/i.test(t));
	const dotless = (word, quoted) => (dotglob || quoted || /[\\$`{}~'"]/.test(word) ? word : word.split('/').map((p) => (/^[*?]/.test(p) ? `\x01${p}` : p)).join('/'));
	// A path glued to the end of a word (sed's 1w.claude/guard.cjs writes that file, the 1.28.0 mutation run) is read
	// too: each tail of the word from a .claude, .git or .githooks part.
	// A sed w command's file, glued to an address or an s command's flags (1wfile, /x/wfile, s/a/b/gwfile), is read
	// whatever it names, a listed folder or an absolute path among them (the review of this fix).
	// Every place a w or W may start a command (after an address, !, a brace, a ;, s flags, or -e) is read as naming the
	// rest of the word: reading too much only adds holds (the review of this fix).
	const sedFile = (word) => {
		// Capped, so no word can make the match slow; a longer one is read only up to the cap.
		const body = word.slice(0, 4096).replace(/^(?:-e|--expression=)/, '');
		const out = [...body.matchAll(/(?:^|[;{}!0-9$,~+/gpiImMeE])[wW](?=\S)/g)].map((m) => body.slice(m.index + m[0].length));
		const s = /^s(.)(?:(?!\1)[^\\]|\\.)*\1(?:(?!\1)[^\\]|\\.)*\1[gpiImMeE0-9]*w(?=\S)/.exec(body);
		return s ? [...out, body.slice(s[0].length)] : out;
	};
	const tails = (word) => [word, ...sedFile(String(word)), ...[...String(word).matchAll(/(?<=[^\\/.])(?=\.(claude|git|githooks|gitconfig)(?:[\\/]|$))/gi)].map((m) => String(word).slice(m.index))];
	const hit = (x) => tails(dotless(x.value, x.quoted)).some((w) => names(w, cwd));
	// A variable set to a plain value earlier in the command (P=~/.claude/projects) is read as that value where it is
	// used, so a read through it passes and a write through it is refused (S23-2). One the guard did not see set stays
	// unread, as before.
	const vars = new Map();
	const sub = (v) => v.replace(/\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g, (m, a, b) => (vars.has(a || b) ? vars.get(a || b) : m));
	// A cd is followed only in a plain run of commands (; && or a new line), with no group anywhere: a cd in ( ), a
	// pipeline, the background or after || may not move the shell the later commands run in, so the folder is then
	// unknown, the safe side.
	const grouped = /[(){}]/.test(text);
	// A function or alias the command defines can stand in for any program name, so no program's exemption holds
	// (the 1.25.0 sweep: git() { cp x "$2"; }; git add .claude/guard.cjs overwrote the guard).
	// So can a name looked up somewhere else (hash -p, a new PATH, a sourced file, eval, PowerShell's function: drive),
	// and the list of ways has no end: the exemptions hold only when nothing runs before the program in the same shell
	// (no ;, &, || or new line; a pipe's stages are separate shells), but plain variables set and a plain cd first
	// (P=x; grep $P, cd dir && grep), and never beside a definition.
	const bare = text.replace(/^(\s*([A-Za-z_]\w*=|cd\s+)("[^"$`\\]*"|'[^']*'|[^\s;&|$`'"()\\]*)\s*(;|&&)\s*)+/, '');
	// V1 (the 1.25.0 verify): a line of nothing but plain readers, a print-only sed and a cd can redefine nothing, so
	// its ; and && do not count as a place a definition could hide.
	const onlyReads = !/[`]|\$\(|<\(/.test(text) && segments.every((g) => { const w = g.filter((x) => !x.redirect).map((x) => x.value); const p = path.basename(slash(w[0] || '')).replace(/\.(exe|cmd|bat)$/, ''); const onPath = !/[\\/]/.test(w[0] || ''); return (onPath && (READERS.has(p) || PIPE_READERS.has(p))) || CHANGERS.has(p) || printSed(w); });
	const defines = (!onlyReads && /[;&\n]|\|\|/.test(bare)) || /(^|[\s|(){}])(function\s+[\w.:-]+|[\w.:-]+\s*\(\s*\)|alias\s|set-alias\s|sal\s|new-alias\s|nal\s|enable\s|hash\s|(export\s+|\$env:)?(PATH|PATHEXT|BASH_ENV|ENV|NODE_OPTIONS)\s*\+?=)|function:|alias:/i.test(text);
	// The last command ends with no break (''): it was read as not plain, so no cd was ever followed (S23-1, the
	// mutation check's survivor at "sure").
	const plainBreak = (end) => end === undefined || end === '' || end === ';' || end === '&&' || end === '\n';
	// Any break that is not plain anywhere in the command (a later || runs on a failure too) makes every cd unsure. Read
	// once, before the loop: read per command it made a long command quadratic (98 KB took 21 s, past the hook's 10 s).
	const apart = grouped || !segments.every((g) => plainBreak(g.end));
	for (let s = 0; s < segments.length; s++) {
		const segment = segments[s].map((x) => ({ ...x, value: sub(x.value) }));
		segment.end = segments[s].end;
		// Only assignments (P=x, export P=x): nothing is written but a redirect.
		const assigns = segment.filter((x) => !x.redirect);
		const lead = /^(export|declare|local|readonly)$/.test(assigns[0]?.value || '') ? 1 : 0;
		if (assigns.length > lead && assigns.slice(lead).every((x) => /^[A-Za-z_]\w*=/.test(x.value) && !x.value.startsWith('-'))) {
			if (segment.some((x) => x.redirect && hit(x))) return true;
			for (const x of assigns.slice(lead)) vars.set(x.value.slice(0, x.value.indexOf('=')), x.value.slice(x.value.indexOf('=') + 1));
			if (tool === 'Bash' || tool === 'Monitor' || tool === 'mcp__terminal__run_in_terminal') continue;
		}
		const all = segment.map((x) => x.value);
		const program = path.basename(slash(all[0] || '')).replace(/\.(exe|cmd|bat)$/, '');
		// A message right after its flag (git commit -m "...", gh pr create --body "..."); a redirect is never one.
		const message = (x, k) => MESSAGES.has(program) && !x.redirect && k > 0 && (MESSAGE_FLAGS.test(all[k - 1]) || false);
		const inline = (x) => MESSAGES.has(program) && !x.redirect && /^(--message|--body|--title|--notes)=/i.test(x.value);
		if (segment.some((x) => hit(x) || x.value.split(/\s+/).some((w) => names(dotless(w, x.quoted), cwd)))) named = true;
		// A quoted word is read in pieces too: inline code (node -e "...writeFileSync('.claude/settings.json')") names a
		// file inside it.
		const inside = (x) => x.quoted && x.value.split(/[\s;|&<>()"'`,]+/).some((w) => w && names(w, cwd));
		const hits = segment.filter((x, k) => !message(x, k) && !inline(x) && (hit(x) || inside(x)));
		if (CHANGERS.has(program)) {
			// A cd that may fail leaves the shell where it was: only one followed by && is sure to have moved it.
			const sure = segment.end === '&&' || s === segments.length - 1;
			cwd = apart || !sure ? 'unknown' : moved(segment, cwd);
			// Into the transcripts only where the guard follows the folder: every later word is then read from there, so
			// only plain reads pass (S23-2). A move it cannot follow, into them, is refused as before.
			if (hits.length && cwd === 'unknown') return true;
			continue;
		}
		if (hits.length === 0) continue;
		if (segment.some((x) => x.redirect && hit(x))) return true;
		if (((READERS.has(program) && !/[\\/]/.test(all[0] || '')) || printSed(all)) && !defines) {
			// Piped on, the read must go to another reader.
			if (segment.end === '|' && segments[s + 1] && !PIPE_READERS.has(path.basename(slash(segments[s + 1][0]?.value || '')).replace(/\.(exe|cmd|bat)$/, ''))) return true;
			continue;
		}
		if (COPIERS.has(program) && !defines) {
			// A copy out is a read. Any option outside the known plain ones may name the destination (-t, --t...,
			// -Destination and its short forms), so the guard refuses rather than guess.
			// PowerShell takes any start of a parameter's name and some take a value, so there only a bare two-word copy
			// (source, destination) or -Recurse / -Force passes; cp takes its plain letter flags.
			// Only Bash's own cp is read by cp's rules; any other shell or copier gets the strict ones.
			const pwsh = tool !== 'Bash' || program !== 'cp';
			const options = segment.slice(1).filter((x) => x.value.startsWith('-'));
			const plain = segment.slice(1).filter((x) => !x.value.startsWith('-'));
			const risky = options.some((x) => (pwsh ? !/^-(recurse|force)$/i.test(x.value) : !COPY_OPTIONS.test(x.value)));
			const dest = plain[plain.length - 1];
			if (!risky && (pwsh ? plain.length === 2 : plain.length >= 2) && !hit(dest)) continue;
		}
		// For the guards and settings (T1): running a script is no write to it (node <file>, the file the only word named,
		// no inline code), and git reading or staging a file writes none (git diff --output does, so it is refused). The
		// transcripts keep the stricter reading they had.
		if (names !== proofNames && !defines && program === 'node' && hits.length === 1 && hits[0] === segment[1]) continue;
		// Only the subcommand right after git (no global option, which can move git or run a program), no option that runs
		// one (-O, --ext-diff, --textconv) or writes a file (--output), and the file named as a plain word, not inside one.
		if (names !== proofNames && !defines && program === 'git' && GIT_READS.has(all[1]) && hits.every((h) => hit(h)) && !all.some((a) => /^(--output|-O|--open-files-in-pager|--ext-diff|--textconv)/.test(a))) continue;
		return true;
	}
	// Named in the text but in no command word the reader saw (a nested shell, odd quoting): the safe side.
	if (named) return false;
	const raw = source;
	// Read from the folder the shell starts in, as the words above are: a bare kit-owner.json there is placed.
	return [raw, text].some((t) => {
		const quoted = /["'`\\]/.test(t);
		return t.split(/[\s;|&<>()"'`]+/).some((w) => w && names(dotless(w, quoted), start ? parts(start) : null));
	});
}

// Turning every hook off is a gate bypass, never a settings change a yes may approve (K21). JSON reads \u escapes as
// the letters they name, so they are read that way here too; an edit is read as the file it leaves, so a key made
// across the edit's edge is seen.
const HOOKS_OFF = 'Never by a tool: disableAllHooks turns every guard off, a gate bypass no yes approves. Leave it out; switching hooks off is the owner\'s own, in their own terminal.';
const hooksOff = (text) => /disableallhooks/i.test(String(text).replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16))));
function writtenText(tool, t, file) {
	if (tool === 'Write') return String(t.content ?? '');
	const edits = tool === 'MultiEdit' ? (Array.isArray(t.edits) ? t.edits : []) : [t];
	let text = '';
	try { text = fs.readFileSync(file, 'utf8'); } catch { /* a new file: the new text alone */ }
	const news = [];
	for (const e of edits) {
		const from = String((e && e.old_string) ?? '');
		const to = String((e && e.new_string) ?? '');
		news.push(to);
		text = from && e.replace_all ? text.split(from).join(to) : from ? text.replace(from, () => to) : text + to;
	}
	return `${text}\n${news.join('\n')}`;
}

// The hook's answer for one tool call: a refusal, or null to let it go on. The dispatcher (guard.cjs) calls this.
function check(input) {
	homeNow = findHome();
	try { return answer(input); } finally { homeNow = null; }
}

// E3 (rule:project-adapter A2): folders the project lists in .claude/protected-folders.json ({ "folders": [...] }) are
// never written by a tool, by an edit tool or a shell; reads stay open. The list is a settings file (the owner's
// yes), and one that cannot be read holds every write tool and shell call until the owner fixes it.
const FOLDERS_REASON = 'Never by a tool: this project lists that folder in .claude/protected-folders.json, so no tool writes there. Read it; a change there is made where that folder is worked on.';
function listedFolders(cwd) {
	const env = process.env.CLAUDE_PROJECT_DIR;
	const fold = (p) => slash(path.resolve(p));
	// The project's own list wherever the shell stands (the commit-time security review): the shell's folder only when
	// no project folder is named.
	const root = env || cwd;
	void fold;
	let raw;
	try { raw = fs.readFileSync(path.join(root, '.claude', 'protected-folders.json'), 'utf8'); } catch { return []; }
	if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
	try {
		const list = JSON.parse(raw).folders;
		// Both spellings of each folder: as written, and through any link or short name.
		if (Array.isArray(list) && list.every((x) => typeof x === 'string' && x.trim())) return list.flatMap((x) => [parts(path.resolve(root, x)), parts(real(path.resolve(root, x)))]);
	} catch { /* below */ }
	return null;
}
// A word names a listed folder when it sits inside it or above it (a parent deleted or moved takes the folder with it),
// and, after a cd the guard cannot follow, when any part of a relative word is a listed folder's own name.
const inFolders = (folders) => (raw, cwd) => {
	// The spellings a shell resolves first: Git Bash's /c/..., $PWD and $HOME or ~ (the 1.28.0 sweep).
	let word = String(raw).replace(/^\/([a-z])(?=\/|$)/i, '$1:').replace(/^~(?=\/|$)|^\$\{?HOME\}?(?=\/|$)|^\$env:USERPROFILE(?=[\\/]|$)/i, () => slash(os.homedir()));
	if (/^\$\{?PWD\}?(?=[\\/]|$)|^\$pwd(?=[\\/]|$)/i.test(word)) { if (!Array.isArray(cwd)) return folders.length > 0; word = word.replace(/^\$\{?PWD\}?|^\$pwd/i, cwd.join('/')); }
	// The root is a parent of every folder.
	if (/^([a-z]:)?[\\/]*$/i.test(word) && word.length > 0) return folders.length > 0;
	if (cwd === 'unknown' && !rooted(word)) {
		const ps = parts(word);
		if (folders.some((f) => f.length > 0 && ps.some((x) => fits(x, f[f.length - 1])))) return true;
	}
	const p = !rooted(word) && Array.isArray(cwd) ? parts([...cwd, word].join('/')) : parts(word);
	return folders.some((f) => f.length > 0 && p.length > 0 && p.every((x, i) => i >= f.length || fits(x, f[i])) && (p.length >= f.length || p.every((x, i) => fits(x, f[i]))));
};

function answer(input) {
	const t = input.tool_input || {};
	const cwd = input.cwd || process.cwd();
	const folders = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell', 'Monitor', 'mcp__terminal__run_in_terminal'].includes(input.tool_name) ? listedFolders(cwd) : [];
	if (folders === null) return deny('Held: .claude/protected-folders.json cannot be read, so no write tool or shell call runs. The owner fixes it in their own editor.');
	// The settings take the owner's pop-up yes for this exact act; a subagent never has one.
	const settings = () => (!input.agent_id && ownerYes(input) ? null : deny(askText(SETTINGS_REASON, input)));
	if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(input.tool_name)) {
		const file = t.file_path || t.notebook_path;
		if (!file) return null;
		if (insideProof(String(file), cwd)) return deny(REASON);
		if (folders.length && inFolders(folders)(slash(real(path.resolve(cwd, String(file)))), null)) return deny(FOLDERS_REASON);
		const p = parts(real(path.resolve(cwd, String(file))));
		if (guardShape(p)) return deny(GUARD_REASON);
		if (!settingsShape(p)) return null;
		if (hooksOff(writtenText(input.tool_name, t, path.resolve(cwd, String(file))))) return deny(HOOKS_OFF);
		return settings();
	}
	if (['Bash', 'PowerShell', 'Monitor', 'mcp__terminal__run_in_terminal'].includes(input.tool_name)) {
		if (shellWrites(t.command, input.tool_name, cwd)) return deny(REASON);
		if (folders.length && shellWrites(t.command, input.tool_name, cwd, inFolders(folders))) return deny(FOLDERS_REASON);
		if (shellWrites(t.command, input.tool_name, cwd, shapeNames(guardShape))) return deny(GUARD_REASON);
		if (shellWrites(t.command, input.tool_name, cwd, shapeNames(settingsShape))) return hooksOff(t.command) ? deny(HOOKS_OFF) : settings();
	}
	return null;
}

if (require.main === module) {
	const out = check(JSON.parse(fs.readFileSync(0, 'utf8') || '{}'));
	if (out) process.stdout.write(JSON.stringify(out));
}

module.exports = { check };
