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
const CHANGERS = new Set(['cd', 'pushd', 'chdir', 'set-location', 'sl', 'push-location']);
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

// Whether a shell word names the protected places, in any of the spellings a command uses for the Claude folder.
// inHome: a cd before it moved the shell into the Claude folder, so a relative word is read from there.
function names(word, inHome) {
	const p = parts(word);
	const h = parts(path.resolve(home()));
	for (let i = 0; i < p.length; i++) {
		if (fits(p[i], '.claude') || (p[i] === h[h.length - 1] && h.length > 0)) {
			if (protectedFrom(p, i + 1)) return true;
		}
	}
	if (/kit-owner/.test(slash(word)) && p.some((x) => fits(x, 'kit-owner.json'))) return true;
	return Boolean(inHome) && !/^([/~$%]|[a-z]:)/.test(slash(word)) && protectedFrom(p, 0);
}

// Whether a word holds the Claude folder itself as its last part: a cd there moves the shell into it.
function isHome(word) {
	const p = parts(word);
	const h = parts(path.resolve(home()));
	return p.length > 0 && (fits(p[p.length - 1], '.claude') || p[p.length - 1] === h[h.length - 1]);
}

function shellWrites(command, tool) {
	const text = plainText(joinContinuations(String(command || '')), tool);
	let inHome = false;
	let named = false;
	for (const segment of tokenize(text)) {
		const all = segment.map((x) => x.value);
		const program = path.basename(slash(all[0] || '')).replace(/\.(exe|cmd|bat)$/, '');
		if (CHANGERS.has(program)) inHome = all.slice(1).some(isHome);
		// A quoted message (git commit -m "...", gh pr create --body "...") is text, not a path.
		const message = (x) => MESSAGES.has(program) && /\s/.test(x.value);
		if (segment.some((x) => names(x.value, inHome) || (message(x) && x.value.split(/\s+/).some((w) => names(w, inHome))))) named = true;
		const hits = segment.filter((x) => !message(x) && names(x.value, inHome));
		if (hits.length === 0) continue;
		if (segment.some((x) => x.redirect && names(x.value, inHome))) return true;
		if (READERS.has(program)) continue;
		if (COPIERS.has(program)) {
			// The destination: the word after -t, --target-directory or -Destination, else the last plain word.
			const plain = segment.slice(1).filter((x) => !x.value.startsWith('-'));
			const flag = segment.findIndex((x) => /^(-t|--target-directory|-destination)(=|$)/i.test(x.value));
			const dest = flag > 0 ? (segment[flag].value.includes('=') ? segment[flag] : segment[flag + 1]) : plain[plain.length - 1];
			if (plain.length >= 2 && dest && !names(dest.value.split('=').pop(), inHome)) continue;
		}
		return true;
	}
	// Named in the text but in no command word the reader saw (a nested shell, odd quoting): the safe side.
	if (named) return false;
	const raw = String(command || '');
	return [raw, text].some((t) => t.split(/[\s;|&<>()"'`]+/).some((w) => w && names(w, false)));
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
