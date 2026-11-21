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
// The folder the shell starts in, as the hook was given it, and its parts: the parts are kept in lower case (and a
// short name as a pattern), so they name no real folder where letter case counts or under a short name (CI, both
// runners). A read of the disk from where the shell started uses the folder as given.
// It moves with each cd the guard follows, and is used only while its own parts are the parts in hand, so a stale
// or mistaken one is never read from: the lower-case parts are then all there is.
let startNow = null;
// K158 (build 21): set only to ask whether a hold came from a neighbour alone (see heldBeside below).
let neighbourBlind = false;
// The two sides of the compare are kept between calls: a long command asks for every word (the 98 KB command spent
// most of its owner-proof time here, the main CI on the PR 37 merge).
const cwdKeys = new WeakMap();
const cwdKey = (cwd) => { if (!cwdKeys.has(cwd)) cwdKeys.set(cwd, JSON.stringify(cwd)); return cwdKeys.get(cwd); };
let startKey = ['', ''];
function diskBase(cwd) {
	if (!Array.isArray(cwd)) return null;
	if (startNow && startNow.dir) {
		if (startKey[0] !== startNow.dir) startKey = [startNow.dir, JSON.stringify(parts(startNow.dir))];
		if (cwdKey(cwd) === startKey[1]) return startNow.dir;
	}
	return (/^[a-z]:$/i.test(cwd[0] || '') ? '' : '/') + cwd.join('/');
}
const home = () => homeNow ?? findHome();
// The Claude folder's parts, worked out once per folder: a long command reads it for every word.
let homeMemo = ['', []];
function homeParts() {
	const h = home();
	if (homeMemo[0] !== h) homeMemo = [h, parts(path.resolve(h))];
	return homeMemo[1];
}
// Plain readers only: rg (--pre) and less (LESSOPEN) can run another program.
const READERS = new Set(['cat', 'head', 'tail', 'type', 'gc', 'get-content', 'grep', 'egrep', 'fgrep', 'findstr', 'select-string', 'sls', 'ls', 'dir', 'gci', 'get-childitem', 'get-item', 'gi', 'jq', 'wc', 'stat', 'test-path', 'file', 'get-filehash',
	// K138 (build 18): cmp compares and du counts; neither has a way to write but a redirect, which is read as a write.
	'cmp', 'du']);
// Copiers: a transcript copied out is a read; one copied in is a write.
const COPIERS = new Set(['cp', 'copy', 'copy-item', 'cpi']);
// Programs that move a shell into a folder: a relative word after one is read from there.
const CHANGERS = new Set(['cd', 'pushd', 'chdir', 'set-location', 'sl', 'push-location', 'popd', 'pop-location']);
// A copier's options that name no destination; any other may (--t is --target-directory to cp), so it refuses.
const COPY_OPTIONS = /^(-[rRpafvni]+|--recursive|--preserve|--archive|--force|--verbose|--no-clobber|--interactive)$/;
// Programs whose quoted words are messages, not paths: a commit message or a PR body may name the file.
const MESSAGES = new Set(['git', 'gh']);
// git subcommands that read or stage a file and write none of the files they name.
const GIT_READS = new Set(['add', 'diff', 'log', 'show', 'status', 'blame', 'ls-files', 'ls-tree', 'grep', 'cat-file', 'check-ignore', 'commit']);
const slash = (p) => p.split('\\').join('/').toLowerCase();
const deny = (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
const REASON = 'Never by a tool: the session transcripts and kit-owner.json hold the owner\'s answers, so they are protected files. Read them; Claude Code and the owner write them.';
const GLOB_REASON = 'Never by a tool: this for loop reads its glob where the guard cannot follow it (a folder change first and a body that writes, IFS, or an unquoted name a file splits). Quote "$f", or run the loop from the folder, or one command per file.';
const DASH_REASON = 'Never by a tool: a wildcard here matches a file whose name starts with a dash, which the shell hands on as an option (sed -i edits in place). Rename that file, or name the files you mean.';
const DASH_UNSURE = 'Never by a tool: part of this command is more than the guard reads as bash does (a folder change it cannot follow, a here-document, an extended pattern, a glob option, or text run as shell), so it cannot rule out a wildcard matching a file whose name starts with a dash. Run the wildcard from a plainly named folder, or name the files you mean.';
// K158 (build 21): the read itself is plain, but another command beside it (one the guard cannot read as plain, a
// definition, a substitution) may change what it runs, so it is held; on 1.46.1 this named the guard files instead.
const BESIDE_REASON = 'Never by a tool: this names a protected file beside another command the guard cannot read as plain (a program it does not know, a definition, a substitution), which may change what the read runs. Run the read as a command of its own.';
const GUARD_REASON = 'Never by a tool: the kit\'s guards, the git hooks and .git/config are protected files, written only by kit.mjs install; the report channel\'s kit-report.json and kit-scrub-words.json are the owner\'s, and kit-reports/ is written by kit-report.mjs. Read them, or ask the owner to reinstall the kit or change their own file.';
const SETTINGS_REASON = 'a write to a settings file, the bounds file, .mcp.json, .claude.json or an agent file, or a claude mcp add or --mcp-config, which wire the guards, the loop and the MCP servers a session starts';
// S1 (the build 23a sweep): claude mcp add (add-json, add-from-claude-desktop, remove) has Claude Code write the MCP
// servers a session starts into .claude.json or .mcp.json itself, and --mcp-config starts a session with the servers a
// file names; each takes the same yes. Read with quotes, backslashes, backticks and carets taken out, and with no
// program name needed, so a name the command builds (c=claude; $c mcp add) is held too. Only the subcommands that
// change nothing pass (list, get, serve); any other word after mcp, a variable ($S) included, is held (the commit
// security review).
const MCP_ACT = /(^|[^\w.-])mcp\s+(?!(list|get|serve)(?![\w-]))\S|--mcp-config\b/i;
const mcpCommand = (c) => MCP_ACT.test(String(c || '').replace(/["'`\\^]/g, ''));

// sed counts as a reader only as -n with one literal print of a line or a range (5p, 1,20p, 3,$p): any other
// script may hold w, W, e or an s///w that writes a file or runs a program (the plan check's P3).
// The reader splits a word at a comma (PowerShell lists), so 1,20p reaches here as 1 and 20p.
const printSed = (w) => {
	// The bare name, looked up on PATH: a path to a sed is any program a tool wrote there (the plan check's P4).
	if (w.length < 4 || !/^sed(\.exe)?$/i.test(w[0] || '') || w[1] !== '-n') return false;
	// Digits only: $p may be a variable holding any script (the 1.28.0 sweep), and quotes are gone by here.
	// K117 (1.42.0): a line range (1,40p) prints too; it was held as a write.
	const at = /^\d+(,\d+)?p$/.test(w[2]) ? 3 : /^\d+$/.test(w[2]) && /^\d+p$/.test(w[3] || '') ? 4 : 0;
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

// Windows opens a file under other names too: dots and spaces on the end of a name are dropped (settings.json. is
// settings.json), and a colon starts a stream of the same file (guard.cjs::$DATA is guard.cjs itself). Each part of a
// path is read as the file it opens, on every platform: read so, a name only ever gains a hold (the review of K34,
// reproduced on 1.28.0: PowerShell wrote the settings through settings.json. with no hold). A drive keeps its colon.
const opened = (x) => (/^[a-z]:$/i.test(x) ? x : x.replace(/:.*$/, '').replace(/[. ]+$/, '') || x);

function insideProof(file, cwd) {
	const p = slash(real(path.resolve(cwd, file))).split('/').map(opened).join('/');
	const h = slash(real(path.resolve(home())));
	// The auto memory sits beside the transcripts (projects/<project>/memory/), and sessions write it.
	if (/\/projects\/[^/]+\/memory(\/|$)/.test(p)) return false;
	// The spent taps (the build 12 sweep): removed, a tap a forked session copied would run again.
	return p === `${h}/kit-owner.json` || p === `${h}/projects` || p.startsWith(`${h}/projects/`) || p === `${h}/kit-yes-spent` || p.startsWith(`${h}/kit-yes-spent/`);
}

// Windows reaches a local file by other spellings too (the 1.29.0 sweep: \\?\C:\..., \\.\C:\..., \\?\UNC\host\C$\...
// and \\localhost\C$\... wrote inside a listed folder with no hold). Slashes are forward by here. The device prefix
// goes, and a drive's own share (C$) on any host is read as that drive: read so, a path only ever gains a hold.
const localForm = (w) => w.replace(/^\/\/[?.]\/(unc\/)?/i, (m, u) => (u ? '//' : '')).replace(/^\/\/[^/]+\/([a-z])\$(?=\/|$)/i, '$1:');
// What is still a network path after that is a share by another name, which may be any local folder.
// So may a device path that names no drive (a volume by its id, GLOBALROOT): neither can be placed.
const shareForm = (w) => { const s = slash(String(w)).replace(/["']/g, ''); return /^\/\/[?.]\/(?![a-z]:(\/|$)|unc\/)/i.test(s) || /^\/\/[^/]/.test(localForm(s)); };

// Where a word leads when a part of it is a link or a junction (the 1.29.0 sweep: a shell word through an existing
// junction to .claude was read by its own name, while the write tools followed it): the real path, or null when
// the word has no link in it, holds a wildcard or a variable, or cannot be placed.
const linkSeen = new Map();
// A path walked the way the system walks it: each part in turn, and ".." taken from where the parts before it
// really lead, so deep/../x through a link named deep is the x beside the link's target (the review of the
// link fix: resolved as text, the ".." took the link back out before it was ever followed).
function walked(written) {
	const s = String(written).split('\\').join('/');
	const root = path.parse(path.resolve(s)).root;
	let cur = /^([a-z]:)?\//i.test(s) ? root : process.cwd();
	for (const part of s.replace(/^([a-z]:)?\/+/i, '').split('/')) {
		if (!part || part === '.') continue;
		if (part === '..') { cur = path.dirname(cur); continue; }
		cur = path.join(cur, part);
		try { cur = fs.realpathSync.native(cur); } catch { /* not there yet: the name as written */ }
	}
	return cur;
}
// A file with a second name (a hard link) is the same file under both: one that is a protected file of this project
// by its other name is read as that file (the review of the sweep's hard-link fix). The project's guard files, git
// hooks and git config are few, so each is asked for its file id.
function twinOf(abs) {
	try {
		const st = fs.statSync(abs, { bigint: true });
		if (!st.isFile() || st.nlink < 2n) return null;
		const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
		const files = [path.join(root, '.git', 'config')];
		for (const d of ['.claude', '.githooks', path.join('.git', 'hooks')]) {
			try { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true }).slice(0, 400)) if (e.isFile()) files.push(path.join(root, d, e.name)); } catch { /* none */ }
		}
		for (const p of files) {
			try { const o = fs.statSync(p, { bigint: true }); if (o.ino === st.ino && o.dev === st.dev && slash(p) !== slash(abs)) return p; } catch { /* missing */ }
		}
	} catch { /* not there */ }
	return null;
}
function throughLink(word, cwd) {
	const w = String(word);
	if (!w || w.charCodeAt(0) === 1 || /[*?[\]$`~%\x01]/.test(w)) return null;
	// After a cd the guard could not follow, the word is placed from the project folder: the likeliest place, and the
	// only one known.
	const from = Array.isArray(cwd) ? diskBase(cwd) : process.env.CLAUDE_PROJECT_DIR || process.cwd();
	const written = rooted(w) ? w.replace(/^\/([a-z])(?=\/|$)/i, '$1:') : `${from}/${w}`;
	// The spelling as written is its own key first, so a word asked again skips the resolve.
	if (linkSeen.has(`\0${written}`)) return linkSeen.get(`\0${written}`);
	const abs = path.resolve(written);
	if (linkSeen.has(abs)) { linkSeen.set(`\0${written}`, linkSeen.get(abs)); return linkSeen.get(abs); }
	if (linkSeen.size > 5000) linkSeen.clear();
	let out = null;
	try { const r = walked(written); if (slash(r) !== slash(abs)) out = r; } catch { /* not placed */ }
	// A second name counts whatever the path's own spelling: under a short name the real path always differs (CI on
	// Windows), and the twin was then never asked for.
	const twin = twinOf(abs);
	if (twin !== null) out = twin;
	linkSeen.set(abs, out);
	linkSeen.set(`\0${written}`, out);
	return out;
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
	const w = path.posix.normalize(localForm(slash(word).replace(/["']/g, ''))).replace(/(^|\/)claude~\d+(?=\/|$)/g, '$1.claude');
	// Any other short name (SETTIN~1.JSO, GITHOO~1) is read as the wildcard of the long names it may stand for
	// (*settin*.jso*, *githoo*: the leading dot is dropped in a short name), so it is held where it can name a
	// protected file and nowhere else (the 1.25.0 sweep; CI's RUNNER~1 temp folder names none).
	// Past a few names alike, Windows makes the short name from the first two letters and a 4-digit hex hash
	// (SE1A2B~1.JSO), so a name of that shape is read by its two letters only.
	return w.split('/').filter(Boolean).map(opened).map((x) => {
		const m = /^([^~*?[]{1,6})~\d{1,6}(?:\.([^.~*?[]{1,3}))?$/.exec(x);
		if (!m) return x;
		const stem = m[1].length === 6 && /^[0-9a-f]{4}$/.test(m[1].slice(2)) ? m[1].slice(0, 2) : m[1];
		return `*${stem}*${m[2] ? `.${m[2]}*` : ''}`;
	});
}

// Whether the parts, from index i, name the transcripts (outside a project's memory) or kit-owner.json.
function protectedFrom(p, i) {
	if (i < p.length && (fits(p[i], 'kit-owner.json') || fits(p[i], 'kit-yes-spent'))) return true;
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
		// A move or a copy into .git itself, or into a worktree's folder under it, lands a file named config or hooks there
		// (the 1.29.0 sweep: Move-Item pay/* .git): the folder named as the place written to is held as its files are.
		if (fits(p[i], '.git') && (i === p.length - 1 || fits(p[i + 1], 'worktrees') || fits(p[i + 1], 'modules'))) return true;
		if (fits(p[i], '.ssh')) return true;
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
		// E1 (build 21): the report channel's grant (kit-report.json names the one intake repo and is its kill switch) and
		// the owner's own scrub word list are the owner's to write, as the guard records are; so are the reports kit-report.mjs
		// keeps (the commit security review: a report rewritten after the owner read it, or marked held again).
		const trusted = (r) => r.length > 0 && (fits(r[0], 'kit-guard') || fits(r[0], 'kit-install.json') || fits(r[0], 'kit-tools') || fits(r[0], 'kit-hooks') || fits(r[0], 'kit-report.json') || fits(r[0], 'kit-scrub-words.json') || fits(r[0], 'kit-reports'));
		if (h.length && p[i] === h[h.length - 1] && trusted(p.slice(i + 1))) return true;
		// The Claude folder under a name of its own (CLAUDE_CONFIG_DIR), named as the place written to.
		if (h.length && !fits(h[h.length - 1], '.claude') && i === p.length - 1 && p.length >= h.length && h.every((x, k) => p[p.length - h.length + k] === x)) return true;
		if (!fits(p[i], '.claude')) continue;
		const rest = p.slice(i + 1);
		if (rest.length === 0) return true;
		if (rest[0] === 'worktrees' || rest[0] === 'projects') continue;
		if (rest.length === 1 && (rest[0] === 'kit-hooks' || rest[0] === 'kit-tools')) return true;
		if (fits(rest[0], 'kit-guard') || fits(rest[0], 'kit-install.json') || (rest.length === 1 && (fits(rest[0], 'kit-report.json') || fits(rest[0], 'kit-scrub-words.json'))) || fits(rest[0], 'kit-reports')) return true;
		const last = rest[rest.length - 1];
		// A wildcard may name any guard the shell finds there (owner-pro* is owner-proof.cjs): it fails closed (S23-1, the
		// mutation check showed only guard.cjs was matched).
		if (CODE.test(last) || /[*?[]/.test(last)) return true;
	}
	return false;
}
// The settings that wire the hooks: a .claude folder's settings.json or settings.local.json. T7 (build 12, the owner's
// lock): the loop's bounds file, which says what a thread may do alone, takes the same yes for the exact edit.
function settingsShape(p) {
	for (let i = 0; i + 1 < p.length; i++) {
		if (fits(p[i], '.claude') && p.length === i + 2 && (fits(p[i + 1], 'settings.json') || fits(p[i + 1], 'settings.local.json') || fits(p[i + 1], 'bounds.json'))) return true;
		// S1 (the build 23a sweep): an agent file's mcpServers starts a server when the agent runs, so the agents folder
		// and every file in it take the same yes; skills and commands too, whose frontmatter can name hooks and tools (the
		// commit security review).
		if (fits(p[i], '.claude') && (fits(p[i + 1], 'agents') || fits(p[i + 1], 'skills') || fits(p[i + 1], 'commands'))) return true;
	}
	// The user's .claude.json holds the MCP servers claude mcp add writes at user and local scope (S1). Held in any folder.
	if (p.length && fits(p[p.length - 1], '.claude.json')) return true;
	// K217 (build 23a): .mcp.json names the MCP servers Claude Code starts with a session, so a planted server runs code
	// at the next start; it takes the same yes. Held in any folder, the safe side: a folder may be opened as a project.
	if (p.length && fits(p[p.length - 1], '.mcp.json')) return true;
	// The user's own settings when the Claude folder has another name (the 1.29.0 sweep).
	const h = homeParts();
	if (h.length && p.length === h.length + 1 && h.every((x, k) => p[k] === x) && (fits(p[p.length - 1], 'settings.json') || fits(p[p.length - 1], 'settings.local.json'))) return true;
	if (h.length && p.length > h.length && h.every((x, k) => p[k] === x) && (fits(p[h.length], 'agents') || fits(p[h.length], 'skills') || fits(p[h.length], 'commands'))) return true;
	return false;
}
// The folder list (E3) is the owner's to write, in their own editor: as a settings file one yes could delete it, and
// every folder on it lost its hold (K34; the plan check showed a record of it outside the project had the same one-tap
// way round, through install).
const LIST_REASON = 'Never by a tool: the folder list (.claude/protected-folders.json) names the folders no tool writes, so no tool writes, moves or deletes the list. Read it; the owner changes it in their own editor.';
function listShape(p) {
	for (let i = 0; i + 1 < p.length; i++) if (fits(p[i], '.claude') && p.length === i + 2 && fits(p[i + 1], 'protected-folders.json')) return true;
	return false;
}
// A shell word named by its shape, read from the folder a cd moved to. After a cd the guard cannot follow, a relative
// word may sit in a .claude folder: the safe side.
const shapeNames = (shape) => (word, cwd) => {
	const p = !rooted(word) && Array.isArray(cwd) ? parts([...cwd, word].join('/')) : parts(word);
	if (shape(p)) return true;
	if (cwd === 'unknown' && !rooted(word) && shape(['.claude', ...p.filter((x) => x !== '..')])) return true;
	const led = throughLink(word, cwd);
	return led !== null && shape(parts(led));
};

// Whether a word is written from the root, a home or a variable, so no cd before it moves where it points.
const rooted = (word) => /^([/~$%]|[a-z]:)/.test(slash(word));

// Whether a shell word names the protected places, in any of the spellings a command uses for the Claude folder.
// cwd: where a cd before it moved the shell (its parts), 'unknown' when that cannot be read, null when none did.
function proofNames(word, cwd) {
	if (proofNamesAsWritten(word, cwd)) return true;
	const led = throughLink(word, cwd);
	return led !== null && proofNamesAsWritten(led, null);
}
function proofNamesAsWritten(word, cwd) {
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
	if (cwd === 'unknown' && !rooted(word)) { const k = p.findIndex((x) => x !== '..'); return k >= 0 && protectedFrom(p, k); }
	return false;
}

// The same move as a real path, from the real folder before it; null when it cannot be worked out. Read only where
// moved() below followed the cd, and checked against its parts before any use.
function movedDir(segment, from) {
	if (!from) return null;
	const args = segment.slice(1).map((x) => x.value);
	const at = args.findIndex((a) => /^-(path|literalpath|lp)$/i.test(a));
	const arg = at >= 0 ? args[at + 1] : args.find((a) => !a.startsWith('-'));
	if (arg === undefined) return args.length ? null : os.homedir();
	const home = /^(~|\$home|\$env:userprofile|\$\{?home\}?)(?=[/\\]|$)/i;
	if (home.test(arg)) return path.join(os.homedir(), arg.replace(home, ''));
	if (/[$`(]/.test(arg)) return null;
	const a = arg.replace(/^\/([a-z])(?=\/|$)/i, '$1:/');
	return path.isAbsolute(a) || /^[a-z]:/i.test(a) ? path.resolve(a) : path.resolve(from, a);
}

// Whether a folder is reached through a link or a junction: each part of its path, but the parts it shares with the
// folder the shell started in (those were there before the command and are the same for every word).
function linkOnTheWay(dir, origin) {
	const stop = origin ? path.resolve(origin) : null;
	for (let p = path.resolve(dir); path.dirname(p) !== p; p = path.dirname(p)) {
		if (stop && (process.platform === 'win32' ? p.toLowerCase() === stop.toLowerCase() : p === stop)) return false;
		try { if (fs.lstatSync(p).isSymbolicLink()) return true; } catch { /* not there: a link made by the command is held where it is made */ }
	}
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
// K229 (build 23a): readers that are plain only in some forms, so they are kept out of READERS and read by their words:
// rg with no option that runs another program (--pre, --hostname-bin, a search of zipped files), find with no action
// that deletes, runs or writes (-delete, -exec, -ok, -fprint, -fls), echo (its redirect is read like any other), date
// with only a format or a display option (never -s, which sets the clock), and npm ls (npm list), which runs no script.
// The program by its plain name only: a path keeps the strict reading.
const FIND_ACTS = /^-(delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)$/;
const NPM_LS_OPTIONS = /^(--(all|json|long|parseable|global|link|unicode|no-unicode|color|no-color|package-lock-only|production|dev|workspaces|include-workspace-root|depth|omit|include|workspace|silent)(=[\w@./-]*)?|-[aglpw]+)$/;
function wordReader(w) {
	const first = String(w[0] || '');
	if (/[\\/]/.test(first)) return false;
	const p = first.toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
	const args = w.slice(1).map(String);
	if (p === 'rg') return !args.some((a) => /^--(pre|hostname-bin|search-zip)|^-[A-Za-z]*z/.test(a));
	if (p === 'find') return !args.some((a) => FIND_ACTS.test(a));
	if (p === 'echo') return true;
	if (p === 'date') return args.every((a) => /^(\+[^;&|<>`$]*|-[uRI]+|--utc|--universal|--rfc-email|--iso-8601(=\w+)?)$/.test(a));
	// R2 (the build 23a sweep): npm takes any option it knows by a short start (--userconf) and options that run code
	// (--onload-script), so npm ls is plain only with the options that change what it shows.
	if (p === 'npm') return (args[0] === 'ls' || args[0] === 'list') && args.slice(1).every((a) => NPM_LS_OPTIONS.test(a) || /^[\w@][\w@./-]*$/.test(a));
	return false;
}

// K32 (the plan check's P2): whether a word is <plain folders>/<a wildcard part>, under a folder the guard knows, and
// that folder, read from the disk, holds nothing a guard shape could name: no name that starts with a dot or kit-,
// and no link, at any depth (a delete may recurse). A folder it cannot read whole, reaches through a link, or that
// holds more than the cap answers no: the wildcard is then read the strict way.
const PLAIN_CAP = 5000;
function plainFolder(word, cwd) {
	if (!Array.isArray(cwd) || rooted(word)) return false;
	const ps = String(word).split('/');
	if (ps.length < 2 || !/[*?[]/.test(ps[ps.length - 1]) || ps.slice(0, -1).some((p) => !/^[A-Za-z0-9_-][A-Za-z0-9_. -]*$/.test(p) || /[. ]$/.test(p) || /^kit-/i.test(p))) return false;
	const base = diskBase(cwd);
	const dir = path.join(base, ...ps.slice(0, -1));
	try {
		const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
		if (!same(fs.realpathSync(dir), path.join(fs.realpathSync(base), ...ps.slice(0, -1)))) return false;
		let seen = 0;
		const stack = [dir];
		while (stack.length) {
			const d = stack.pop();
			for (const e of fs.readdirSync(d, { withFileTypes: true })) {
				if (++seen > PLAIN_CAP || e.name.startsWith('.') || /^kit-/i.test(e.name) || /~\d/.test(e.name)) return false;
				const st = fs.lstatSync(path.join(d, e.name));
				if (st.isSymbolicLink() || (!st.isDirectory() && st.nlink > 1)) return false;
				if (st.isDirectory()) stack.push(path.join(d, e.name));
			}
		}
		return true;
	} catch { return false; }
}

// Whether a filter's pattern can be the name of a file the guards live in: the files really in the project's
// .claude and .githooks folders, and the settings, the folder list and git's config and hooks by name.
function filterFits(pattern, cwd, pathWord = false) {
	const root = process.env.CLAUDE_PROJECT_DIR || (Array.isArray(cwd) ? (/^[a-z]:$/i.test(cwd[0] || '') ? '' : '/') + cwd.join('/') : process.cwd());
	const named = ['settings.json', 'settings.local.json', 'protected-folders.json', 'config', 'hooks', '.claude', '.githooks', '.git', 'kit-owner.json'];
	for (const d of ['.claude', '.githooks']) { try { named.push(...fs.readdirSync(path.join(root, d)).slice(0, 400).map((n) => n.toLowerCase())); } catch { /* none */ } }
	const p = slash(String(pattern)).replace(/^(["'])(.*)\1$/, '$2');
	// A word by position may be the path, not the filter: only its last part is held against the names.
	if (pathWord) return /[*?[]/.test(p) && named.some((n) => fits(p.split('/').pop(), n));
	// Any sign the guard does not read in a filter (a quote inside it, a variable, a short name's ~) is held.
	return /[^a-z0-9._*?-]/.test(p) || named.some((n) => fits(p, n));
}

// start: the folder the shell starts in (the hook's cwd), so a relative word is read from there too.
// K117 (1.42.0, held live on 1.41.0): a loop over plain words that runs plain steps was held as a write, since its
// for, do and done (or PowerShell's braces) read as a definition beside every step. A simple loop runs its body with
// one plain variable set to each word in turn, so it is read as its body: for v in a b; do ...; done (Bash) or
// foreach ($v in 'a','b') { ... } (PowerShell), with at most a plain folder change before it. The variable is lowercase,
// so it is never PATH or another name that moves a program (Bash names are case-sensitive; a PowerShell $v is no
// environment variable); the words hold no expansion, and the body no group, substitution or second loop. The body is
// read once for each word, the variable written out as that word, so a word that names a guard is read as written.
// K138 (build 18): a list word may hold a glob (* ?): each body is read with the glob in place of the name.
const LOOP_WORDS = /^[\w.,'" /*?-]+$/;
const LOOP_BODY = /^[^{}()`]*$/;
// The commit review on K138: a Bash for loop whose list holds a glob gets the real names the glob matches, and a body
// that uses the variable outside double quotes splits a name with a space (a file named "x .claude" becomes x and
// .claude), a path no reading of the glob word sees. Such a loop is held when a name the glob matches on disk holds a
// space or a sign the shell reads again, or when the guard cannot list what it matches. Quoted, a name stays one word,
// and the glob word is read in its place as any loop word is.
const globRe = (pat) => new RegExp(`^${pat.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
function globNamesSplit(words, from) {
	for (const w of words.split(/\s+/).map((x) => x.replace(/^['"]|['"]$/g, '')).filter((x) => /[*?[]/.test(x))) {
		const dir = path.dirname(w);
		// A wildcard in a folder part or a bracket class is more than this reading follows: held.
		if (/[*?[]/.test(dir) || /\[/.test(w)) return true;
		// The second commit review: a folder the guard cannot list (an MSYS /c/ path, a missing one) is held, not passed.
		let names;
		try { names = fs.readdirSync(path.resolve(from, dir)); } catch { return true; }
		if (names.length > 4096) return true;
		const re = globRe(path.basename(w));
		if (names.some((n) => re.test(n) && /[\s*?[\]'"\\$`]/.test(n))) return true;
	}
	return false;
}
function globSplits(command, tool, start) {
	if (tool === 'PowerShell') return false;
	const m = /(?:^|[;&|\n(]\s*|\s)for\s+([A-Za-z_]\w*)\s+in\s+([^;\n]*?)\s*[;\n]\s*do\b([\s\S]*?)\bdone\b/.exec(String(command || ''));
	if (!m || !/[*?[]/.test(m[2])) return false;
	const body = m[3];
	// The second commit review: a reader can write through a split name too (sort -o, uniq's second file), so no body is
	// exempt; IFS set anywhere splits names on any sign, and a folder change before the loop moves where the glob is read
	// from, so either holds the loop whole.
	// K145 (build 19): one plain folder change first (cd <folder> && for ...), the loop shape loopBodies reads, moves the
	// glob's folder there; it is read from that folder, when the body and anything piped after it only read (sed -n,
	// head, wc, sort with no output option): a reader cannot write through a name. Any other folder change before the
	// loop, or one before a loop that writes, still holds it (the K138 commit review).
	const lead = String(command).slice(0, m.index + m[0].indexOf('for'));
	const tail = String(command).slice(m.index + m[0].length);
	const stageRead = (s) => {
		const w = s.trim().split(/\s+/).map((x) => x.replace(/^['"]|['"]$/g, ''));
		const p = (w[0] || '').toLowerCase();
		if (p === 'sort') return w.slice(1).every((a) => !/^-(o|-output|-compress|-files0-from|-temporary-directory|T)/.test(a));
		return (READERS.has(p) && p !== 'jq') || printSed(w);
	};
	const readsOnly = !/[<>`]|\$\(|\|\|/.test(body + tail) && `${body}${/^\s*\|/.test(tail) ? tail : ''}`.split(/;|&&|\||\n/).map((x) => x.trim()).filter(Boolean).every(stageRead)
		&& (!tail.trim() || /^\s*\|/.test(tail));
	const plainCd = readsOnly && /^\s*cd\s+([^;&|`$(){}\s'"]+|'[^'`$]*'|"[^"`$]*")\s*&&\s*$/.exec(lead);
	if (/\bIFS\b/.test(command) || (!plainCd && /(^|[\s;&|(!])(cd|pushd|popd|chdir|builtin)(?![\w-])/.test(lead))) return true;
	const base = start || (startNow && startNow.dir) || process.cwd();
	const from = plainCd ? path.resolve(base, plainCd[1].replace(/^['"]|['"]$/g, '').replace(/^\/([a-z])\//i, '$1:/')) : base;
	const use = new RegExp(`^\\$(\\{${m[1]}\\b|${m[1]}(?!\\w))`);
	let q = null;
	for (let i = 0; i < body.length; i++) {
		const c = body[i];
		if (q === "'") { if (c === "'") q = null; continue; }
		if (c === '\\') { i++; continue; }
		if (c === '"') { q = q ? null : '"'; continue; }
		if (!q && c === "'") { q = "'"; continue; }
		if (!q && c === '$' && use.test(body.slice(i))) return globNamesSplit(m[2], from);
	}
	return false;
}
// The build 19 sweep: bash hands a name the wildcard matches on as a word, and one that starts with a dash is read as an
// option (a file named -i turns sed -n 1p * .claude/guard.cjs into an in-place edit). No reading of the wildcard as a
// name sees that, so a Bash command whose unquoted wildcard matches such a name, in the start folder or a folder a cd
// names, is held whole. A folder the guard cannot list is passed here; the readings after it still hold what they hold.
// K155 (build 20): the words as bash splits them. Each word is a list of [char, quoted]; quoted text, an escaped sign,
// a parameter ($?, $*, ${x}) and a here-document's body never glob. A substitution is opaque unless a wildcard is in it.
function bashWords(c) {
	const cmds = [[]];
	let word = null;
	let unsure = false;
	let ext = false;
	const heredocs = [];
	const bodies = [];
	const live = [];
	const put = (ch, q) =>{ (word ||= []).push([ch, q]); };
	let hereString = false;
	const end = () => { if (word) { cmds[cmds.length - 1].push(word); if (hereString) { bodies.push(wordText(word)); hereString = false; } } word = null; };
	const next = () => { end(); if (cmds[cmds.length - 1].length) cmds.push([]); };
	// The end of a substitution that starts at i (just past "$(" or the opening backquote), and whether a wildcard is in it.
	// K159 (build 21): a quoted or escaped ) or backquote inside does not end it; a double-quoted part that holds a
	// substitution of its own is more than this follows.
	const sub = (i, close) => {
		let depth = 1;
		let j = i;
		for (; j < c.length && depth; j++) {
			if (c[j] === '\\') { j++; continue; }
			if (close === ')' && c[j] === "'") { const k = c.indexOf("'", j + 1); j = k < 0 ? c.length : k; continue; }
			if (close === ')' && c[j] === '"') {
				let k = j + 1;
				for (; k < c.length && c[k] !== '"'; k++) {
					if (c[k] === '\\') k++;
					else if (c[k] === '`' || (c[k] === '$' && c[k + 1] === '(')) unsure = true;
				}
				j = k;
				continue;
			}
			if (close === ')' && c[j] === '(') depth++;
			else if (c[j] === close) depth--;
		}
		if (depth || /[*?[]/.test(c.slice(i, j))) unsure = true;
		return j;
	};
	for (let i = 0; i < c.length; i++) {
		const ch = c[i];
		if (ch === '\n') {
			next();
			// A here-document's body is text: its lines end at the delimiter line.
			for (const h of heredocs.splice(0)) {
				const lines = c.slice(i + 1).split('\n');
				let k = 0;
				while (k < lines.length && (h.strip ? lines[k].replace(/^\t+/, '') : lines[k]) !== h.tag) k++;
				if (k >= lines.length) unsure = true;
				bodies.push(lines.slice(0, k).join('\n'));
				if (!h.quoted) live.push(lines.slice(0, k).join('\n'));
				i +=lines.slice(0, Math.min(k + 1, lines.length)).reduce((n, l) => n + l.length + 1, 0);
			}
			continue;
		}
		if (ch === ' ' || ch === '\t') { end(); continue; }
		if (';&|()'.includes(ch)) {
			if (ch === '(' && word && word.length && !word[word.length - 1][1] && '?*+@!'.includes(word[word.length - 1][0])) ext = true;
			next();
			continue;
		}
		if (ch === '<' && c[i + 1] === '<' && c[i + 2] !== '<') {
			// The end word as bash reads it: quotes and backslashes taken out (the commit security review of this fix). One
			// the reader cannot take apart, or an end line never found below, is more than it follows.
			const m = /^<<(-?)[ \t]*([^\s;&|<>()]+)/.exec(c.slice(i));
			if (!m) { unsure = true; end(); i++; continue; }
			const tag = m[2].replace(/\\(.)/g, '$1').replace(/['"]/g, '');
			if (!tag || /[$`]/.test(m[2])) unsure = true;
			heredocs.push({ strip: m[1] === '-', tag, quoted: /['"\\]/.test(m[2]) });
			end();
			i += m[0].length - 1;
			continue;
		}
		// A here-string (<<< 'text') hands its word to the command as input, as a here-document does (K159).
		if (ch === '<' && c[i + 1] === '<' && c[i + 2] === '<') { end(); hereString = true; i += 2; continue; }
		if (ch === '<' || ch === '>') { end(); continue; }
		if (ch === '#' && !word) { while (i + 1 < c.length && c[i + 1] !== '\n') i++; continue; }
		if (ch === '\\') { if (i + 1 < c.length && c[i + 1] !== '\n') put(c[++i], true); else i++; continue; }
		if (ch === "'") { const j = c.indexOf("'", i + 1); const s = j < 0 ? c.slice(i + 1) : c.slice(i + 1, j); for (const x of s) put(x, true); if (!s) put('', true); i = j < 0 ? c.length : j; continue; }
		if (ch === '"') {
			let j = i + 1;
			put('', true);
			for (; j < c.length && c[j] !== '"'; j++) {
				if (c[j] === '\\' && j + 1 < c.length) { put(c[++j], true); continue; }
				if (c[j] === '$' && c[j + 1] === '(') { j = sub(j + 2, ')') - 1; put('$', true); continue; }
				if (c[j] === '`') { j = sub(j + 1, '`') - 1; put('$', true); continue; }
				put(c[j], true);
			}
			i = j;
			continue;
		}
		if (ch === '`') { i = sub(i + 1, '`') - 1; put('$', true); continue; }
		if (ch === '$') {
			const n = c[i + 1];
			if (n === '(') { i = sub(i + 2, ')') - 1; put('$', true); continue; }
			if (n === '{') { const j = c.indexOf('}', i); i = j < 0 ? c.length : j; put('$', true); continue; }
			if (n === "'") { const m = /^\$'((?:\\.|[^'\\])*)'?/.exec(c.slice(i)); for (const x of m[1]) put(x, true); i += m[0].length - 1; continue; }
			if (n && /[?*@#$!\-0-9]/.test(n)) { put('$', true); put(n, true); i++; continue; }
			put('$', true);
			continue;
		}
		put(ch, false);
	}
	next();
	return { cmds: cmds.filter((x) => x.length), unsure, ext, bodies, live };
}
const wordText = (w) => w.map(([ch]) => ch).join('');
// A [ is a class only with a ] after it in the same word: a lone [ or [[ is the test command.
const wordGlob = (w) => w.some(([ch, q], i) => !q && (ch === '*' || ch === '?' || (ch === '[' && w.slice(i + 1).some(([x, y]) => !y && x === ']'))));
// The build 19 sweep: bash hands a name the wildcard matches on as a word, and one that starts with a dash is read as an
// option (a file named -i turns sed -n 1p * .claude/guard.cjs into an in-place edit), so such a command is held whole.
// K155 and K156 (build 20): only a wildcard in a word's first part can make a word that starts with a dash (.claude/*
// makes .claude/-i), so only that part is read; the folders it is read in are the start folder and each cd's folder,
// followed in turn. A folder change the guard cannot follow (a bare cd, cd -, popd, a variable) says so, not "a file".
// Returns 'dash' (a dash name fits), 'unsure' (more than this reading follows) or false.
function dashGlob(command, tool, start) {
	if (tool === 'PowerShell') return false;
	const c = String(command || '');
	const from = start || (startNow && startNow.dir) || process.cwd();
	const posixDrive = (p) => p.replace(/^\/([a-z])\//i, '$1:/');
	const read = bashWords(c);
	const words = read.cmds.flat();
	// The commit security review of this fix: text run as shell (eval, bash -c, source) is read again as a command of
	// its own, since its quotes hide its wildcards and cd's from the reading above; any of it held is held.
	// The build 20 sweep: text run after a cd is read from the start folder below, and text from a variable is not
	// read at all, so a wildcard in either is unsure.
	let cdBefore = false;
	for (const cmd of read.cmds) {
		const names = cmd.map(wordText);
		const k = names.findIndex((n, j) => n === 'eval' || ((/(^|\/)(ba|z|da|k)?sh(\.exe)?$/.test(n)) && names.slice(j + 1).some((x) => /^-\w*c/.test(x))));
		if (k >= 0) {
			const text = names.slice(k + 1).filter((x) => !/^-\w*c$/.test(x)).join(' ');
			if (cdBefore && /[*?[]/.test(text)) return 'unsure';
			if (/[*?[]/.test(c) && cmd.slice(k + 1).some((w) => w.some(([ch]) => ch === '$'))) return 'unsure';
			const inner = dashGlob(text, tool, start);
			if (inner) return inner;
		}
		if (names.some((n) => /^(cd|pushd|popd|chdir)$/.test(n))) cdBefore = true;
	}
	// K159 (build 21): a here-document or here-string is text only to a plain reader; fed to anything else (bash <<E,
	// cat <<E | sh, xargs, a variable) it may run as a command of its own, so it is read the same way. A list of plain
	// readers, not of shells: the commit security review of this fix found shells such a list would miss. Only readers
	// with no option that runs a program (sort --compress-program does, the second review) are on it.
	if (read.bodies.some((b) => /[*?[]/.test(b)) && !read.cmds.every((cmd) => /^(cat|head|tail|grep|egrep|fgrep|wc|cut|tr)$/.test(wordText(cmd[0] || [])))) {
		if (cdBefore) return 'unsure';
		for (const b of read.bodies) { const inner = dashGlob(b, tool, start); if (inner) return inner; }
	}
	// A program named by a wildcard may be anything, a shell included; so may one named by a wildcard or an expansion
	// behind a wrapper and given -c (env /usr/bin/s[h] -c, ${X:-sh} -c: the build 21 sweep).
	if (/[*?[]/.test(c) && read.cmds.some((cmd) => (cmd[0] && wordGlob(cmd[0])) || cmd.some((w, j) => /^-[A-Za-z]*c[A-Za-z]*$/.test(wordText(w)) && cmd.slice(0, j).some((x) => wordGlob(x) || x.some(([ch]) => ch === '$'))))) return 'unsure';
	// The build 21 sweep: a here-document whose end word is not quoted runs the substitutions in its body, whatever
	// command reads it (cat <<E with $(sed -n 1p *) inside), so a wildcard there is more than this reading follows.
	if (read.live.some((b) => /\$\(|`/.test(b) && /[*?[]/.test(b))) return 'unsure';
	if (read.cmds.some((cmd) => /^(source|\.)$/.test(wordText(cmd[0] || [])))) read.unsure = read.unsure || words.some(wordGlob);
	// A cd the word split did not see (inside text run as shell, or glued to another word) is more than this follows.
	const cdSeen = words.filter((w) => /^(cd|pushd|popd|chdir)$/.test(wordText(w))).length;
	const cdRaw = (c.match(/(?:^|[^\w./-])(?:cd|pushd|popd|chdir)(?![\w.-])/g) || []).length;
	// A word whose first part is the wildcard: a plain first folder, a root, a drive or a ~ never starts with a dash.
	const firsts = words.filter((w) => {
		if (!wordGlob(w) || (w[0] && w[0][0] === '~' && !w[0][1])) return false;
		const cut = w.findIndex(([ch]) => ch === '/');
		const head = cut < 0 ? w : w.slice(0, cut);
		return head.length > 0 && wordGlob(head);
	});
	// The second commit review: a wildcard inside a substitution and an extended pattern (cut apart by the word split) are
	// more than this reading follows, and so are a glob option turned on, braces or a bracket class in the first part.
	// A here-document the reader cannot end hides no wildcard when the command has none (the build 20 sweep).
	if (read.ext || (read.unsure && /[*?[]/.test(c))) return 'unsure';
	if (!firsts.length) return false;
	if (cdRaw > cdSeen) return 'unsure';
	if (/(^|[^\w-])(shopt|setopt)(?![\w-])|(^|[^\w-])set\s+[-+]\w*o/.test(c)) return 'unsure';
	// Each cd in turn, from where the last one left the shell (K156); every folder reached is read, the safe side.
	const dirs = [from];
	let here = from;
	for (const cmd of read.cmds) {
		for (let k = 0; k < cmd.length; k++) {
			if (!/^(cd|pushd|popd|chdir)$/.test(wordText(cmd[k]))) continue;
			const t = cmd[k + 1];
			const text = t ? wordText(t) : '';
			if (!t || /^popd$/.test(wordText(cmd[k])) || text.startsWith('-') || wordGlob(t) || t.some(([ch, q]) => ch === '$' || (!q && ch === '~'))) return 'unsure';
			here = path.resolve(here, posixDrive(text));
			dirs.push(here);
		}
	}
	for (const w of firsts) {
		const cut = w.findIndex(([ch]) => ch === '/');
		const head = cut < 0 ? w : w.slice(0, cut);
		// An expansion before or beside the wildcard ($X*, ${X}*, $(x)*) can give any text, a dash included.
		if (head.some(([ch, q]) => (!q && (ch === '[' || ch === '{' || ch === '}')) || ch === '$')) return 'unsure';
		const re = new RegExp(`^${head.map(([ch, q]) => (!q && ch === '*' ? '.*' : !q && ch === '?' ? '.' : ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'))).join('')}$`, 'i');
		for (const d of dirs) {
			let names;
			// A folder that is not there leaves the wildcard as written, unless the same command could make it first.
			try { names = fs.readdirSync(d); } catch (e) { if (e.code === 'ENOENT' && read.cmds.length < 2) continue; return 'unsure'; }
			if (names.some((n) => n.startsWith('-') && re.test(n))) return 'dash';
		}
	}
	return false;
}
function loopBodies(command, tool) {
	const c = String(command || '');
	const m = tool === 'PowerShell'
		? /^(\s*(?:(?:cd|sl|set-location)\s+[^;&|`$(){}]+;\s*)?)foreach\s*\(\s*\$([A-Za-z_]\w*)\s+in\s+([^()]+?)\s*\)\s*\{([\s\S]*)\}\s*$/i.exec(c)
		: /^(\s*(?:cd\s+[^;&|`$(){}]+&&\s*)?)for\s+([a-z_][a-z0-9_]*)\s+in\s+([^;\n]+?)\s*[;\n]\s*do\s+([\s\S]*?)[;\n]?\s*done(?:\s*(;|&&|\|(?!\|))\s*([^\n]+?))?\s*$/.exec(c);
	// zsh ties lowercase path, cdpath, fpath and others to the environment (path is PATH as a list), so those stay strict
	// (the commit security review); _ is the last word handed on.
	if (!m || !/^[a-z_][a-z0-9_]*$/.test(m[2]) || /^(path|cdpath|fpath|module_path|manpath|mailpath|psvar|ifs|home|pwd|oldpwd|env|_)$/.test(m[2])) return null;
	const [, before, name, words] = m;
	let body = m[4];
	// K117 rest (build 17): a command after the loop (for ...; done; sed -n '1,40p' x) is read after each body, with
	// every rule a plain command meets; one that holds a second loop or names the variable keeps the strict reading.
	// K145 (build 19): a pipe after the loop (done | wc -l) is read the same way, each body piped into it: the whole
	// loop's output goes there, and each body's part of it is what a reader of that pipe can see or write.
	const after = m[5] ? ` ${m[5]} ${m[6]}` : '';
	if (after && (/\b(for|do|done|while|until)\b/.test(m[6]) || new RegExp(`\\$\\{?${name}\\b`).test(m[6]))) return null;
	// K117 rest: a PowerShell body that only reads when the file is there (if (Test-Path $f) { Get-Content $f }) is read
	// as the read inside it, under the same rules as any loop body.
	if (tool === 'PowerShell') {
		const gate = new RegExp(`^\\s*if\\s*\\(\\s*test-path\\s+(?:-(?:literal)?path\\s+)?\\$${name}\\s*\\)\\s*\\{([^{}]*)\\}\\s*$`, 'i').exec(body);
		if (gate) body = gate[1];
	}
	if (!LOOP_WORDS.test(words) || !LOOP_BODY.test(body) || /\$\(|\b(for|foreach|do|done|while|until|function|eval|source)\b|(^|[\s;&|])\.\s/i.test(body)) return null;
	// The build 17 sweep (critical): the shell keeps a body's folder change for the next body and for the command after
	// the loop, which reading each body from the start folder misses, so a body that changes folder keeps the strict reading.
	// The commit security review: read with its quotes taken out (a quoted "cd" is cd), and a command the shell runs from
	// text (&, iex, Invoke-Expression, a drive name like D:) or from a variable keeps the strict reading too.
	// The second commit review: a sign past ASCII (PowerShell's typographic quotes and dashes) keeps the strict reading,
	// and a name dot-sourced with no space (.'sl') is a name too.
	if (/[^\x20-\x7e\t\r\n]/.test(body)) return null;
	const flat = body.replace(/['"]/g, '');
	if (/(^|[\s;&|!.])(cd|pushd|popd|chdir|set-location|sl|push-location|pop-location|iex|invoke-expression|invoke-command|icm)(?![\w-])|(^|[;|!]|&&)\s*&|(^|[\s;&|!])[a-z]:(?=\s|;|$)|(^|[;&|!])\s*\$\w/i.test(flat)) return null;
	const list = words.split(tool === 'PowerShell' ? /\s*,\s*/ : /\s+/).map((w) => w.replace(/^['"]|['"]$/g, '')).filter(Boolean);
	if (!list.length || list.length > 64) return null;
	const use = new RegExp(`\\$\\{${name}\\}|\\$${name}(?!\\w)`, tool === 'PowerShell' ? 'gi' : 'g');
	// The build 16 sweep (critical): a body that sets the variable again (f=, export f, read f, printf -v f, a PowerShell
	// $f = or Set-Variable f) writes where the new value points. Only plain reads are read as the word; any other use of
	// the name keeps the strict reading.
	// The commit security review: a setter can name the variable in a spelling no pattern lists (printf -vf, read -a f,
	// $'f', f\=), so a body with any setter word, a backslash or ANSI quoting keeps the strict reading whatever it names.
	if (/\\|\$['"]|(^|[\s;&|!])(read|mapfile|readarray|declare|typeset|local|export|readonly|let|getopts|printf|unset|set|eval|source|set-variable|new-variable|sv|nv|clear-variable|remove-variable)(?![\w-])|\[ref\]/i.test(body)) return null;
	const flags = tool === 'PowerShell' ? 'i' : '';
	// K196: an option after the variable ($i --json) is a word, not the -- that lowers it.
	const reads = body.replace(new RegExp(`\\$\\{${name}\\}|\\$${name}(?!\\w)(?!\\s*(?:[-+*/%]?=(?!=)|\\+\\+|--(?![A-Za-z])|\\[))`, `g${flags}`), ' ');
	if (new RegExp(`(^|[^\\w$-])${name}(?![\\w-])|\\$${name}(?!\\w)`, flags).test(reads)) return null;
	return list.map((w) => before + body.trim().replace(use, () => w) + after);
}
// K117 rest (build 17, held live on 1.42.0): whether a bracket stands outside quotes, read as the shell reads quotes.
// In single quotes nothing is code; in double quotes $( is (and a backquote in Bash), so it counts as a bracket. A
// backslash (Bash) or backquote (PowerShell) escapes the next sign, which is then never a quote. ANSI quoting ($'),
// whose escaped quotes this reading does not follow, and a quote left open count as a bracket: the strict side.
function unquotedGroup(text, tool) {
	const t = String(text || '');
	const esc = tool === 'PowerShell' ? '`' : '\\';
	if (tool !== 'PowerShell' && /\$'/.test(t)) return true;
	let q = null;
	for (let i = 0; i < t.length; i++) {
		const c = t[i];
		if (q === "'") { if (c === "'") q = null; continue; }
		if (q === '"') {
			if (c === esc) i++;
			else if (c === '"') q = null;
			else if ((c === '$' && t[i + 1] === '(') || (c === '`' && tool !== 'PowerShell')) return true;
			continue;
		}
		if (c === esc) { i++; continue; }
		if (c === "'" || c === '"') q = c;
		else if ('(){}'.includes(c)) return true;
	}
	return q !== null;
}
// K117 rest: PowerShell reads in the shapes held live on 1.42.0, rewritten to the plain read they are. A bracketed read
// whose property is taken at the end of a statement ((Get-Item x).Length) is that read; anything after the property
// (an assignment, a method call) keeps the brackets and the strict reading.
const READ_CMDLETS = 'get-item|gi|get-filehash|get-content|gc|get-childitem|gci|test-path';
const BRACKET_READ = new RegExp(`(^|[;\\n]\\s*)\\(\\s*((?:${READ_CMDLETS})\\s[^()$\`;|&{}"\\n]*?)\\s*\\)(?:\\.[A-Za-z_]\\w*)+(?=\\s*(?:[;\\n]|$))`, 'gi');
// A variable set from a read pipeline and then only shown ($s = Get-Content x | ConvertFrom-Json; $s.a.b) is that
// read: the value is shown, never used as a path. A variable used any other way (handed to a cmdlet, piped on, set
// again) keeps the strict reading, since Get-Item's answer used as a path writes the file it names. Names PowerShell
// gives a meaning (automatic and preference variables, a drive like env: or function:) stay strict.
const PS_RESERVED = /^(ps\w*|_|args|input|this|null|true|false|host|error|ofs|home|pwd|profile|executioncontext|matches|myinvocation|stacktrace|sender|event\w*|lastexitcode|env|function|alias|variable|\w*preference)$/i;
function psShown(command) {
	const statements = String(command || '').split(/\s*[;\n]\s*/);
	// A quote split by the cut (a ; inside quotes) is no statement this reading knows.
	if (statements.some((x) => (x.split("'").length - 1) % 2 || (x.split('"').length - 1) % 2)) return null;
	const m =/^\s*\$([A-Za-z_]\w*)\s*=\s*([^$(){}`;&\n]+)$/.exec(statements[0] || '');
	if (!m || PS_RESERVED.test(m[1])) return null;
	const stages = m[2].split('|').map((x) => x.trim());
	const head = (x) => x.split(/\s+/)[0].toLowerCase();
	if (!READERS.has(head(stages[0])) || !stages.slice(1).every((x) => PIPE_READERS.has(head(x)))) return null;
	const shown = new RegExp(`^\\$${m[1]}(?:\\.[A-Za-z_]\\w*)*$`, 'i');
	const rest = statements.slice(1).filter(Boolean);
	if (rest.some((x) => !shown.test(x) && new RegExp(`\\$\\{?${m[1]}\\b`, 'i').test(x))) return null;
	return [m[2], ...rest.filter((x) => !shown.test(x))].join('; ');
}
function psReads(command) {
	const plain = String(command || '').replace(BRACKET_READ, (m, lead, read) => `${lead}${read}`);
	return psShown(plain) ?? plain;
}
function shellWrites(command, tool, start, names = proofNames) {
	if (tool === 'PowerShell') {
		const plain = psReads(command);
		if (plain !== String(command || '')) return shellWrites(plain, tool, start, names);
	}
	if (globSplits(command, tool, start)) return true;
	const bodies = loopBodies(command, tool);
	if (bodies) return bodies.some((b) => shellWrites(b, tool, start, names));
	// Each reading has its own real folder: a reading nested in this one must not leave its own behind.
	const outer = startNow;
	startNow = start ? { dir: String(start), origin: String(start) } : null;
	try { return shellWritesFrom(command, tool, start, names); } finally { startNow = outer; }
}
function shellWritesFrom(command, tool, start, names) {
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
	const mark = (word) => word.split('/').map((p) => (/^[*?]/.test(p) ? `\x01${p}` : p)).join('/');
	// K32: where dot globbing is on (PowerShell always), a wildcard still cannot name a guard when the folder it sits
	// in holds none: plainFolder reads that folder from the disk. PowerShell's own path separator is read as one.
	const dotless = (word, quoted) => {
		if (quoted) return word;
		const w = tool === 'PowerShell' ? word.replace(/\\/g, '/') : word;
		if (/[\\$`{}~'"]/.test(w)) return word;
		if (!dotglob) return mark(w);
		// Only in a command of one statement: a statement before it could make a link or a dot name in the folder after
		// the guard read it and before the wildcard is expanded (the review of this fix).
		// And only plain printable text: a carriage return or another sign PowerShell ends a line at is no break to the
		// reader, so anything but ASCII letters, signs, a space or a tab keeps the strict reading.
		const alone = segments.length === 1 && !/[;&|(){}`\n]/.test(text) && !/[^\x20-\x7e\t]/.test(String(command || ''));
		return tool !== 'Bash' && alone && plainFolder(w, cwd) ? mark(w) : word;
	};
	// A path glued to the end of a word (sed's 1w.claude/guard.cjs writes that file, the 1.28.0 mutation run) is read
	// too: each tail of the word from a .claude, .git or .githooks part.
	// An option that names what a program leaves out (--exclude=.git, --exclude-dir=.git) writes nothing there.
	const tails = (word) => (/^--?[\w-]*exclude[\w-]*=/i.test(String(word)) ? [word] : [word, ...[...String(word).matchAll(/(?<=[^\\/.])(?=\.(claude|git|githooks|gitconfig)(?:[\\/]|$))/gi)].map((m) => String(word).slice(m.index))]);
	// Read once per word and folder: a long command asks of each word several times (the 1.28.0 measure run: 98 KB
	// took 9 s under CI coverage).
	const seen = new Map();
	// A link made by this command is not on disk when the guard reads it, so nothing past it is placed for sure. Three
	// reviews of 1.29.0 each found a word the reading of it missed (d/../x, a rooted word, the last part, a folder
	// replaced, a lone redirect), so after a command that can make a link nothing more runs in the same command: it is
	// held, and runs as a command of its own, where the link is on disk and followed.
	let linkMade = false;
	// K154: inline node code read as text (its wildcards no file name), kept out of the last whole-text reading too.
	const inertCode = [];
	const hit = (x) => {
		const where = Array.isArray(cwd) ? `A${cwdKey(cwd)}` : cwd === null ? 'N' : 'U';
		const key = `${x.quoted ? 1 : 0}${where}\0${x.value}`;
		if (!seen.has(key)) seen.set(key, tails(dotless(x.value, x.quoted)).some((w) => names(w, cwd)));
		return seen.get(key);
	};
	// A variable set to a plain value earlier in the command (P=~/.claude/projects) is read as that value where it is
	// used, so a read through it passes and a write through it is refused (S23-2). One the guard did not see set stays
	// unread, as before.
	const vars = new Map();
	const sub = (v) => v.replace(/\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g, (m, a, b) => (vars.has(a || b) ? vars.get(a || b) : m));
	// A cd is followed only in a plain run of commands (; && or a new line), with no group anywhere: a cd in ( ), a
	// pipeline, the background or after || may not move the shell the later commands run in, so the folder is then
	// unknown, the safe side.
	const grouped = /[(){}]/.test(text);
	// K117 rest (build 17): a bracket inside quotes is text, so a kit script's quoted note may hold one; the exemptions
	// below read the brackets outside quotes only. That reading models plain quotes and escapes and nothing else, so a
	// command holding anything it does not model keeps the strict reading: a sign past plain ASCII (PowerShell closes
	// quotes at typographic ones), a comment (#, <#), a here-document or here-string (<<, @' or @"), or input from a file
	// (<). The commit security reviews found each of the first three.
	const bracketed = /[^\x20-\x7e\t\r\n]|[#<]|@['"]/.test(source) ? grouped : unquotedGroup(joinContinuations(source), tool);
	// A function or alias the command defines can stand in for any program name, so no program's exemption holds
	// (the 1.25.0 sweep: git() { cp x "$2"; }; git add .claude/guard.cjs overwrote the guard).
	// So can a name looked up somewhere else (hash -p, a new PATH, a sourced file, eval, PowerShell's function: drive),
	// and the list of ways has no end: the exemptions hold only when nothing runs before the program in the same shell
	// (no ;, &, || or new line; a pipe's stages are separate shells), but plain variables set and a plain cd first
	// (P=x; grep $P, cd dir && grep), and never beside a definition.
	// K77 (1.36.0): a plain PowerShell folder change (Set-Location x;) leads as a plain cd does; it defines nothing.
	// K76 (1.36.0): an output pointed at another (2>&1, >&2) writes no file, so its & is no break a definition hides
	// behind; &> and >&file still name a file and stay a redirect the words below read.
	// In PowerShell a backslash is the path separator, not a quote (K32), so a folder may hold one.
	// A new line ends a folder change as ; does (the 1.36.1 sweep).
	// K229 (build 23a): rg reads its options (--pre among them) from RIPGREP_CONFIG_PATH and npm from npm_config_*, so
	// setting either is a definition too.
	const DEFINITION = /(^|[\s|(){}])(function\s+[\w.:-]+|[\w.:-]+\s*\(\s*\)|alias\s|set-alias\s|sal\s|new-alias\s|nal\s|enable\s|hash\s|(export\s+|\$env:)?(PATH|PATHEXT|BASH_ENV|ENV|NODE_OPTIONS|RIPGREP_CONFIG_PATH|npm_config_\w+)\s*\+?=)|function:|alias:/i;
	// K87 (build 11): a kit script followed by another command was held as a write. A program's exemption holds when
	// every OTHER command beside it is plain: a reader, a folder change, a plain assignment or a git read. Those define
	// nothing before it, and after it they cannot write what it was handed. Anything else beside it may: a definition, a
	// script block run later, bash's $_ (the last word of the command before) or PowerShell's -OutVariable handed to a
	// writer (the build 11 sweep). A substitution anywhere, or a definition anywhere in the text, keeps the strict reading.
	const plainStep = (g) => {
		const w = g.filter((x) => !x.redirect).map((x) => x.value);
		const p = path.basename(slash(w[0] || '')).replace(/\.(exe|cmd|bat)$/, '');
		const onPath = !/[\\/]/.test(w[0] || '');
		// sort -o and uniq's second name write a file, and sort --compress-program runs one (the push security reviews of
		// build 11), so each is plain only in a known read-only form: sort with options from a list (its file names are
		// read), uniq as a pipe filter with no name at all.
		const SORT_SAFE = /^(-[bdfghiMnrRsuVz]+|-[kt].*|--(unique|reverse|numeric-sort|ignore-case|ignore-leading-blanks|human-numeric-sort|version-sort|stable|zero-terminated|key=.*|field-separator=.*))$/;
		const writes = (p === 'sort' && w.slice(1).some((a) => a.startsWith('-') && a !== '--' && !SORT_SAFE.test(a)))
			|| (p === 'uniq' && w.slice(1).some((a) => !/^-[cdiuDz]+$|^--(count|repeated|unique|ignore-case|zero-terminated)$/.test(a)));
		// K93 (build 12): node running one of the project's kit scripts (.claude/<name>.mjs or .cjs, which only install
		// writes) is a child process, so it defines nothing in this shell. Any other script may make a link a later copy
		// reads through (the build 12 sweep), and with an option first (inline code, a file it writes) node is not plain.
		// K117 (1.42.0): echo prints its words and defines nothing (its redirect is read below like any other).
		// K145 (build 19): a PowerShell statement that is one quoted string ("==== $i") prints it, as Write-Output does; a
		// substitution in it ($(...)) keeps the strict reading through the check below.
		// K158 (build 21): true, : and pwd print or return and define nothing (false stays strict: false || x is a test row).
		return (onPath && /^(true|:|pwd)$/.test(p) && w.slice(1).every((a) => /^-[LP]+$/.test(a))) || (onPath && ((READERS.has(p) || PIPE_READERS.has(p)) && !writes || wordReader(w) || (p === 'out-null' && w.length === 1) || /^(echo|write-output|write-host)$/.test(p))) || CHANGERS.has(p) || printSed(w)
			|| (tool === 'PowerShell' && g.length === 1 && g[0].quoted === true)
			|| (onPath && p === 'node' && w.length > 1 && /^(\.\/)?\.claude\/[\w.-]+\.(mjs|cjs)$/.test(slash(w[1])))
			// K196: git -C <folder> runs the same read from that folder.
			|| (onPath && p === 'git' && GIT_READS.has(w[1] === '-C' ? w[3] : w[1]) && !w.some((a) => /^(--output|-O|--open-files-in-pager|--ext-diff|--textconv)/.test(a)))
			|| (w.length > 0 && w.every((v) => /^[A-Za-z_]\w*=/.test(v)));
	};
	const substituted = /[`]|\$\(|<\(/.test(text);
	// $_, ${_} and !$ hand the last word of the command before to the next one, whatever that command is.
	const defined = DEFINITION.test(text) || /\$\{?_(?!\w)|!\$/.test(String(command || ''));
	const definesBefore = (s) => !neighbourBlind && (defined || (segments.length > 1 && (substituted || !segments.every((g, k) => k === s || (plainStep(g) && !g.some((x) => x.redirect && !/^(\d|\/dev\/null|\$null|nul)$/i.test(x.value)))))));
	// The last command ends with no break (''): it was read as not plain, so no cd was ever followed (S23-1, the
	// mutation check's survivor at "sure").
	const plainBreak = (end) => end === undefined || end === '' || end === ';' || end === '&&' || end === '\n';
	// A pipe at or before a cd makes it unsure (cd as a pipe stage runs apart); a pipe after it cannot undo it (K54: a
	// later pipe made cd .claude && cat guard.cjs | head a write). Any other break that is not plain, anywhere, still
	// makes every cd unsure: a || runs its right side after a cd that failed, and a & puts the cd in the background
	// (the review of this fix). Read once, before the loop: read per command it made a long command quadratic (98 KB
	// took 21 s, past the hook's 10 s).
	// A pipe after a cd counts only when every stage of every pipeline is a plain reader with no redirect: a file list
	// piped on to a writer (ls | xargs cp /dev/null) names its files where no word shows them (the sweep of this fix).
	const firstPipe = segments.findIndex((g) => g.end === '|');
	const stageReads = (g) => { const w = g.filter((x) => !x.redirect).map((x) => x.value); const p = path.basename(slash(w[0] || '')).replace(/\.(exe|cmd|bat)$/, ''); return !/[\\/]/.test(w[0] || '') && (READERS.has(p) || PIPE_READERS.has(p) || wordReader(w)) && !g.some((x) => x.redirect); };
	// K252 (build 23a): a stage that only sends its output on (node x.mjs 2>&1 | tail) runs in a shell of its own, so it
	// cannot move the folder; it counts with no redirect but one output pointed at another, and its own words are read
	// below as any command's are. Every stage that takes the pipe must still read.
	const sendsOn = (g) => g.every((x) => !x.redirect || /^\d$/.test(x.value));
	const pipesRead = segments.every((g, i) => (i > 0 && segments[i - 1].end === '|' ? stageReads(g) : g.end !== '|' || sendsOn(g)));
	const otherBreak = segments.some((g) => !plainBreak(g.end) && g.end !== '|') || (firstPipe >= 0 && !pipesRead);
	// K228 (build 23a): a bracket inside quotes ("(a.js)", node -e '...(...)') is text, so only one outside quotes, as
	// bracketed reads it (strict for anything that reading does not model), makes the cd unsure.
	const apartAt = (s) => bracketed || otherBreak || (firstPipe >= 0 && firstPipe <= s);
	for (let s = 0; s < segments.length; s++) {
		if (linkMade) return true;
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
		if (/symlink|symbolic|junction|hardlink|mklink/i.test(all.join(' ')) || all.some((w) => /^(ln|mklink|link|fsutil|tar|bsdtar|unzip|7z|7za|cpio|rsync|expand-archive)$/i.test(path.basename(slash(w)).replace(/\.(exe|cmd|bat)$/i, ''))) || all.some((w) => /^--(symbolic|link|recursive|archive|no-dereference|preserve)|^-[a-z]*[slrRaPd][a-z]*$/.test(w)) && /^(cp|gcp)$/.test(program)) linkMade = true;
		// sed writes a file wherever its script holds a w or W command (1w.claude/x, s/a/b/gwx, -e '1!w x'), and the forms
		// have no end, so every place a w or W sits is read as naming the rest of its word, gaps trimmed; a script word past
		// the cap that holds one is held (the review of this fix: fail closed, read too much rather than too little).
		// Any sed in the command words, run through a wrapper (env, nice, busybox, xargs) or by another name (gsed, a path).
		// Fail closed on the name: any word holding sed, busybox or toybox, quoted text handed to a shell among them.
		const sedHere = all.some((w) => /sed|busybox|toybox/i.test(w));
		if (sedHere && !printSed(all) && segment.some((x) => !x.redirect && /[wW]/.test(x.value) && (x.value.length > 4096 || [...x.value.matchAll(/[wW]/g)].some((m) => { const t = x.value.slice(m.index + 1).trimStart(); return t && tails(t).some((w) => names(w, cwd)); })))) return true;
		// A message right after its flag (git commit -m "...", gh pr create --body "..."); a redirect is never one.
		const message = (x, k) => MESSAGES.has(program) && !x.redirect && k > 0 && (MESSAGE_FLAGS.test(all[k - 1]) || false);
		const inline = (x) => MESSAGES.has(program) && !x.redirect && /^(--message|--body|--title|--notes)=/i.test(x.value);
		if (segment.some((x) => hit(x) || x.value.split(/\s+/).some((w) => names(dotless(w, x.quoted), cwd)))) named = true;
		// A PowerShell -Filter or -Include names files at any depth, with no path word (the 1.29.0 sweep: Get-ChildItem
		// -Recurse -Filter *folders.json | Remove-Item deleted the list). Its value is held against the names of the
		// files the guards live in; the command is a write unless it and every stage it pipes into only read.
		// PowerShell takes any clear start of a parameter's name, a value after a colon, and a filter by position; a
		// recursive listing with no filter, or with -Exclude, reaches every file (the review of this rule).
		// Any program in a shell that is not bash: a list of the commands that take these parameters has no end (a call
		// operator, a wrapper, another cmdlet), so none is kept.
		// K187 (reproduced on 1.47.0): a WMI or CIM cmdlet's -Filter is a query over objects, never a file filter, and it
		// lists no file; by its plain name only, so a path or a call operator keeps the strict reading.
		const wql = /^(get-ciminstance|gcim|get-wmiobject|gwmi)$/i.test(all[0] || '');
		const lister = tool !== 'Bash' && !wql;
		const option = (w) => /^-[a-z]/i.test(w);
		// -Depth recurses too, with no -Recurse beside it.
		const recursive = all.some((w) => /^-(r(e(c(u(r(s(e)?)?)?)?)?)?|s|de\w*)(:|$)/i.test(w));
		const filtered = all.some((w) => /^-(fi\w*|inc\w*|ex\w*)(:|$)/i.test(w));
		const reaches = lister && (
			all.some((w) => /^-ex\w*(:|$)/i.test(w))
			|| all.some((w, k) => { const m = /^-(fi\w*|inc\w*)(?::(.*))?$/i.exec(w); return m && filterFits(m[2] !== undefined ? m[2] : all[k + 1] || '*', cwd); })
			|| (recursive && all.slice(1).some((w, k) => !option(w) && !option(all[k] || '') && filterFits(w, cwd, true)))
			// With no folder named, a recursive listing starts where the shell stands and reaches everything under it.
			|| (recursive && !filtered && !all.slice(1).some((w, k) => !option(w) && !/^-de\w*$/i.test(all[k] || ''))));
		if (reaches) {
			const reads = (g) => { const w = (g || []).filter((x) => !x.redirect).map((x) => x.value); const p = path.basename(slash(w[0] || '')).replace(/\.(exe|cmd|bat)$/, ''); return !/[\\/]/.test(w[0] || '') && (READERS.has(p) || PIPE_READERS.has(p)); };
			let k = s;
			let onlyReads = reads(segments[k]) && !segment.some((x) => x.redirect);
			while (onlyReads && segments[k].end === '|') { k++; onlyReads = k < segments.length && reads(segments[k]) && !segments[k].some((x) => x.redirect); }
			if (!onlyReads) return true;
		}
		// A quoted word is read in pieces too: inline code (node -e "...writeFileSync('.claude/settings.json')") names a
		// file inside it.
		// K154 (build 23a, the owner's pick: narrow it): inline node code that can reach no file (no require, import,
		// process, a constructor, bracket access, a $ the shell may expand, or a call that writes, lists, opens or runs)
		// cannot use a wildcard, so a
		// wildcard piece in it is text; a plain name in it is still read, and the strict reading holds for any other code.
		const code = (x) => tool === 'Bash' && program === 'node' && x.quoted && /^(-e|-p|-pe|--eval|--print)$/.test(all[segment.indexOf(x) - 1] || '')
			&& !/require|import|process|module|global|constructor|prototype|eval|Function|Reflect|Deno|Bun|\bfs\b|spawn|exec|fork|glob|write|append|unlink|\brm|rename|copy|cp\b|mkdir|link|open|truncate|chmod|chown|utimes|readdir|watch|\[|\\u|\\x|`|\$/.test(x.value);
		if (segment.some(code)) inertCode.push(...segment.filter(code).map((x) => x.value));
		const inside = (x) => x.quoted && x.value.split(/[\s;|&<>()"'`,]+/).some((w) => w && !(code(x) && /[*?[\]]/.test(w)) && tails(w).some((t) => names(t, cwd)));
		const hits = segment.filter((x, k) => !message(x, k) && !inline(x) && ((!code(x) && hit(x)) || inside(x)));
		if (CHANGERS.has(program)) {
			// A cd that may fail leaves the shell where it was: only one followed by && is sure to have moved it.
			const sure = segment.end === '&&' || s === segments.length - 1;
			cwd = apartAt(s) || !sure || linkMade ? 'unknown' : moved(segment, cwd);
			if (startNow) startNow.dir = Array.isArray(cwd) ? movedDir(segment, startNow.dir) : null;
			// Through a link, the shell's ".." is the parent of the link's target, not of the folder the words show: the
			// folder is then not known, and every later relative word is read the strict way.
			if (startNow && startNow.dir && linkOnTheWay(startNow.dir, startNow.origin)) { cwd = 'unknown'; startNow.dir = null; }
			// Into the transcripts only where the guard follows the folder: every later word is then read from there, so
			// only plain reads pass (S23-2). A move it cannot follow, into them, is refused as before.
			if (hits.length && cwd === 'unknown') return true;
			continue;
		}
		if (hits.length === 0) continue;
		if (segment.some((x) => x.redirect && hit(x))) return true;
		if (((READERS.has(program) && !/[\\/]/.test(all[0] || '')) || wordReader(all) || printSed(all)) && !definesBefore(s)) {
			// Piped on, the read must go to another reader.
			const next = segments[s + 1] && segments[s + 1].filter((x) => !x.redirect).map((x) => x.value);
			if (segment.end === '|' && next && !PIPE_READERS.has(path.basename(slash(next[0] || '')).replace(/\.(exe|cmd|bat)$/, '')) && !wordReader(next)) return true;
			continue;
		}
		if (COPIERS.has(program) && !definesBefore(s)) {
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
		// The word is the script, never an option: node's own options write files (--redirect-warnings, --cpu-prof-dir,
		// --diagnostic-dir, --heap-prof-name; the 1.36.0 sweep).
		// Never with a bracket in the command: a PowerShell argument in brackets runs as code, and a path it joins from
		// pieces ('.cl'+'aude/...') is no word the reader sees (the 1.36.1 sweep).
		if (names !== proofNames && !definesBefore(s) && !bracketed && program === 'node' && hits.length === 1 && hits[0] === segment[1] && !String(segment[1].value).startsWith('-')) continue;
		// Only the subcommand right after git (no global option, which can run a program), no option that runs
		// one (-O, --ext-diff, --textconv) or writes a file (--output), and the file named as a plain word, not inside one.
		// K196 (reproduced on 1.47.0): -C <folder> only moves where the read runs, and these subcommands write no file
		// wherever they run, so it is the one global option read past.
		if (names !== proofNames && !definesBefore(s) && !bracketed && program === 'git' && GIT_READS.has(all[1] === '-C' ? all[3] : all[1]) && hits.every((h) => hit(h)) && !all.some((a) => /^(--output|-O|--open-files-in-pager|--ext-diff|--textconv)/.test(a))) continue;
		return true;
	}
	// Named in the text but in no command word the reader saw (a nested shell, odd quoting): the safe side.
	if (named) return false;
	const raw = source;
	// Read from the folder the shell starts in, as the words above are: a bare kit-owner.json there is placed.
	// K226 (build 23a): a quote anywhere once made every word here read as quoted, so a plain folder glob beside a quoted
	// pattern (grep -rn 'foo' src/**/*.ts) could match .claude. Quoting is now read per shell word: a word with no quote,
	// backtick or backslash of its own is read as the shell reads it; a word holding one is read the strict way, so a
	// dot made by quoting ('.'*) is still matched.
	const quoteSign = tool === 'PowerShell' ? /["'`]/ : /["'`\\]/;
	// The shell drops a backslash inside double quotes before a sign it keeps (\*), so each sign may follow one.
	// R1 (the build 23a sweep): each piece of inert code is taken out once, with the quotes around it, so its text
	// elsewhere in the command (a '.' took every dot out) is still read.
	const spelled = (c) => new RegExp(`(["'])${[...c].map((ch) => `\\\\?${ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).join('')}\\1`);
	const textOnly = (t) => inertCode.reduce((left, c) => left.replace(spelled(c), ' '), t);
	return [raw, text].map(textOnly).some((t) => t.split(/[\s;|&<>()]+/).some((word) => {
		const quoted = quoteSign.test(word);
		return word.split(/["'`]+/).some((w) => w && names(dotless(w, quoted), start ? parts(start) : null));
	}));
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
// never written by a tool, by an edit tool or a shell; reads stay open. The list is the owner's to write (never by
// a tool, K34), and one that cannot be read holds every write tool and shell call until the owner fixes it.
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
	// A share by a name of its own may be any local folder: with a list, a write through one is held.
	if (shareForm(raw)) return folders.length > 0;
	if (inFoldersAsWritten(folders)(raw, cwd)) return true;
	const led = throughLink(raw, cwd);
	return led !== null && inFoldersAsWritten(folders)(led, null);
};
const inFoldersAsWritten = (folders) => (raw, cwd) => {
	// The spellings a shell resolves first: Git Bash's /c/..., $PWD and $HOME or ~ (the 1.28.0 sweep).
	let word = String(raw).replace(/^\/([a-z])(?=\/|$)/i, '$1:').replace(/^~(?=\/|$)|^\$\{?HOME\}?(?=\/|$)|^\$env:USERPROFILE(?=[\\/]|$)/i, () => slash(os.homedir()));
	if (/^\$\{?PWD\}?(?=[\\/]|$)|^\$pwd(?=[\\/]|$)/i.test(word)) { if (!Array.isArray(cwd)) return folders.length > 0; word = word.replace(/^\$\{?PWD\}?|^\$pwd/i, () => (/^[a-z]:$/i.test(cwd[0] || '') ? '' : '/') + cwd.join('/')); }
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
	// K133 (build 17): with no folder given, the shell starts in the project, as the word placing below reads it.
	const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
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
		if (listShape(p)) return deny(LIST_REASON);
		if (!settingsShape(p)) return null;
		if (hooksOff(writtenText(input.tool_name, t, path.resolve(cwd, String(file))))) return deny(HOOKS_OFF);
		return settings();
	}
	if (['Bash', 'PowerShell', 'Monitor', 'mcp__terminal__run_in_terminal'].includes(input.tool_name)) {
		// K145 (build 19): a loop held for how its glob is read names no protected file, so it says so, not the first
		// protected place checked (a guard write was refused as a transcript write).
		if (globSplits(t.command, input.tool_name, cwd)) return deny(GLOB_REASON);
		const dash = dashGlob(t.command, input.tool_name, cwd);
		if (dash) return deny(dash === 'dash' ? DASH_REASON : DASH_UNSURE);
		// K158 (build 21): a hold that goes away when the commands beside the read are taken as plain came from them alone.
		const heldBeside = (names) => { neighbourBlind = true; try { return !shellWrites(t.command, input.tool_name, cwd, names); } finally { neighbourBlind = false; } };
		if (shellWrites(t.command, input.tool_name, cwd)) return deny(heldBeside(proofNames) ? BESIDE_REASON : REASON);
		if (folders.length && shellWrites(t.command, input.tool_name, cwd, inFolders(folders))) return deny(FOLDERS_REASON);
		if (shellWrites(t.command, input.tool_name, cwd, shapeNames(guardShape))) return deny(heldBeside(shapeNames(guardShape)) ? BESIDE_REASON : GUARD_REASON);
		if (shellWrites(t.command, input.tool_name, cwd, shapeNames(listShape))) return deny(heldBeside(shapeNames(listShape)) ? BESIDE_REASON : LIST_REASON);
		if (shellWrites(t.command, input.tool_name, cwd, shapeNames(settingsShape))) return hooksOff(t.command) ? deny(HOOKS_OFF) : settings();
		if (mcpCommand(t.command)) return settings();
	}
	return null;
}

if (require.main === module) {
	const out = check(JSON.parse(fs.readFileSync(0, 'utf8') || '{}'));
	if (out) process.stdout.write(JSON.stringify(out));
}

module.exports = { check };
