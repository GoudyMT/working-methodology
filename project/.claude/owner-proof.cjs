// The owner-proof guard (E27): the owner's yes and resume from the phone thread are read from Claude Code's session
// transcripts (<Claude folder>/projects) and the owner's kit-owner.json, so no tool call may write either. PreToolUse
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

// install project fills this in, so a caller cannot move the protected folder with CLAUDE_CONFIG_DIR.
const INSTALLED_HOME = '{{CLAUDE_HOME}}';
const home = () => (INSTALLED_HOME.startsWith('{' + '{') ? process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude') : INSTALLED_HOME);
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
const slash = (p) => p.split('\\').join('/').toLowerCase();
const deny = (reason) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
const REASON = 'The session transcripts and kit-owner.json hold the owner\'s thread answers, so no tool writes them: read them, or leave them to Claude Code and the owner.';

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
	if (!/[*?[]/.test(part)) return part === name;
	const rx = part.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\[[^\]]*\]?/g, '.').replace(/\*/g, '.*').replace(/\?/g, '.');
	try { return new RegExp(`^${rx}$`).test(name); } catch { return true; }
}

// The parts of a shell word read as a path: slashes one way, . and .. and doubled slashes read the way the shell
// reads them, and a short name (CLAUDE~1) as the folder it names.
function parts(word) {
	const w = path.posix.normalize(slash(word).replace(/["']/g, '')).replace(/(^|\/)claude~\d+(?=\/|$)/g, '$1.claude');
	return w.split('/').filter(Boolean);
}

// Whether the parts, from index i, name the transcripts (outside a project's memory) or kit-owner.json.
function protectedFrom(p, i) {
	if (i < p.length && fits(p[i], 'kit-owner.json')) return true;
	if (i >= p.length || !fits(p[i], 'projects')) return false;
	// projects/<project>/memory/..., written out with no wildcard in the memory part, is the auto memory.
	return !(p.length > i + 2 && p[i + 2] === 'memory' && !/[*?[]/.test(p[i + 1]) && p[i] === 'projects');
}

// Whether a word is written from the root, a home or a variable, so no cd before it moves where it points.
const rooted = (word) => /^([/~$%]|[a-z]:)/.test(slash(word));

// Whether a shell word names the protected places, in any of the spellings a command uses for the Claude folder.
// cwd: where a cd before it moved the shell (its parts), 'unknown' when that cannot be read, null when none did.
function names(word, cwd) {
	const p = !rooted(word) && Array.isArray(cwd) ? parts([...cwd, word].join('/')) : parts(word);
	const h = parts(path.resolve(home()));
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
function shellWrites(command, tool, start) {
	// Every line is read, here-document bodies too: reading a body as data was spelled around five ways in the 1.24.0
	// sweep (an end mark bash reads otherwise, a cat function, continued lines, nested quotes), so it fails closed.
	const source = String(command || '');
	// A variable glued to kit-owner.json (${P}kit-owner.json, $X/kit-owner.json) may be the Claude folder: the reader
	// splits a word at braces, so it is refused here, before the split (the 1.24.0 sweep).
	if (/[$%][{(]?[A-Za-z_][\w:]*[})%]?[\\/]?kit-owner\.json/i.test(source)) return true;
	// CDPATH moves a cd the guard cannot follow, so a cd beside it is refused (the 1.24.0 sweep).
	if (/\bCDPATH\b/.test(source) && /(^|[\s;&|(])(cd|pushd|chdir)\b/i.test(source)) return true;
	const text = plainText(joinContinuations(source), tool);
	const segments = tokenize(text);
	let cwd = start ? parts(start) : null;
	let named = false;
	// A variable set to a plain value earlier in the command (P=~/.claude/projects) is read as that value where it is
	// used, so a read through it passes and a write through it is refused (S23-2). One the guard did not see set stays
	// unread, as before.
	const vars = new Map();
	const sub = (v) => v.replace(/\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g, (m, a, b) => (vars.has(a || b) ? vars.get(a || b) : m));
	// A cd is followed only in a plain run of commands (; && or a new line), with no group anywhere: a cd in ( ), a
	// pipeline, the background or after || may not move the shell the later commands run in, so the folder is then
	// unknown, the safe side.
	const grouped = /[(){}]/.test(text);
	// The last command ends with no break (''): it was read as not plain, so no cd was ever followed (S23-1, the
	// mutation check's survivor at "sure").
	const plainBreak = (end) => end === undefined || end === '' || end === ';' || end === '&&' || end === '\n';
	for (let s = 0; s < segments.length; s++) {
		const segment = segments[s].map((x) => ({ ...x, value: sub(x.value) }));
		segment.end = segments[s].end;
		// Only assignments (P=x, export P=x): nothing is written but a redirect.
		const assigns = segment.filter((x) => !x.redirect);
		const lead = /^(export|declare|local|readonly)$/.test(assigns[0]?.value || '') ? 1 : 0;
		if (assigns.length > lead && assigns.slice(lead).every((x) => /^[A-Za-z_]\w*=/.test(x.value) && !x.value.startsWith('-'))) {
			if (segment.some((x) => x.redirect && names(x.value, cwd))) return true;
			for (const x of assigns.slice(lead)) vars.set(x.value.slice(0, x.value.indexOf('=')), x.value.slice(x.value.indexOf('=') + 1));
			if (tool === 'Bash' || tool === 'Monitor' || tool === 'mcp__terminal__run_in_terminal') continue;
		}
		// Any break that is not plain anywhere in the command (a later || runs on a failure too) makes every cd unsure.
		const apart = grouped || !segments.every((g) => plainBreak(g.end));
		const all = segment.map((x) => x.value);
		const program = path.basename(slash(all[0] || '')).replace(/\.(exe|cmd|bat)$/, '');
		// A message right after its flag (git commit -m "...", gh pr create --body "..."); a redirect is never one.
		const message = (x, k) => MESSAGES.has(program) && !x.redirect && k > 0 && (MESSAGE_FLAGS.test(all[k - 1]) || false);
		const inline = (x) => MESSAGES.has(program) && !x.redirect && /^(--message|--body|--title|--notes)=/i.test(x.value);
		if (segment.some((x) => names(x.value, cwd) || x.value.split(/\s+/).some((w) => names(w, cwd)))) named = true;
		const hits = segment.filter((x, k) => !message(x, k) && !inline(x) && names(x.value, cwd));
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
		if (segment.some((x) => x.redirect && names(x.value, cwd))) return true;
		if (READERS.has(program)) {
			// Piped on, the read must go to another reader.
			if (segment.end === '|' && segments[s + 1] && !PIPE_READERS.has(path.basename(slash(segments[s + 1][0]?.value || '')).replace(/\.(exe|cmd|bat)$/, ''))) return true;
			continue;
		}
		if (COPIERS.has(program)) {
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
			if (!risky && (pwsh ? plain.length === 2 : plain.length >= 2) && !names(dest.value, cwd)) continue;
		}
		return true;
	}
	// Named in the text but in no command word the reader saw (a nested shell, odd quoting): the safe side.
	if (named) return false;
	const raw = source;
	// Read from the folder the shell starts in, as the words above are: a bare kit-owner.json there is placed.
	return [raw, text].some((t) => t.split(/[\s;|&<>()"'`]+/).some((w) => w && names(w, start ? parts(start) : null)));
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
		if (shellWrites(t.command, input.tool_name, cwd)) deny(REASON);
	}
}

main();
