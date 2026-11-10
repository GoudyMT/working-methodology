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

const { plainText, withoutComments, joinContinuations, tokenize } = require('./guard-read.cjs');
const { ownerYes, howToAsk } = require('./owner-yes.cjs');

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

// The git hooks are the last check before a commit or a push leaves: skipping them, or moving where git finds them,
// holds the command (T1: on 1.24.0 both ran with no guard, and a push then landed on main). Reading the setting passes.
function gitHooksOff(words, start, at) {
	if (words.slice(start).some((w) => w === '--no-verify' || /^--no-verify=/.test(w))) return 'git with its hooks skipped';
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
	if (words.some((w) => w.includes('hookspath'))) {
		const reads = words[at] === 'config' && words.slice(at + 1).some((w) => /^(--get|--get-all|--get-regexp|--list|-l|get|list|--show-origin|--show-scope)$/.test(w));
		if (!reads) return 'git with its hooks moved';
	}
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

function findOutward(text, depth) {
	// The owner's logged yes, in any spelling with quotes, escapes or a wildcard program, anywhere in the command. A
	// text that only names the flag asks too: the safe side. With --thread <the owner's message id> it passes:
	// approve.mjs then reads that message from the session transcript and refuses any other (E27).
	// A Claude session started from a shell with a thread message's shape writes a turn like the owner's own (E27).
	if (/(^|[\s;|&(/\\"'])claude(\.exe|\.cmd)?(\s|$)/i.test(text) && /<wake|author-id|trust=["']?principal/i.test(text)) return 'a session started with a thread message';
	// The proof must be an argument of the same command as the yes: one elsewhere on the line proves nothing.
	const flat = text.replace(/[\\`^]\r?\n/g, '').replace(/[\\`^'"]/g, '');
	// S23-4 (the 1.23.0 verify): approve.mjs takes a shell without CLAUDECODE and AI_AGENT for the owner's terminal, and
	// a variable or a glob spells the yes past the reading above. Clearing either marker, or the whole environment, asks.
	// PowerShell needs no full name (the 1.24.0 sweep): a removal on the Env: drive, by wildcard or by a filter piped
	// from it, or a .NET call that sets the environment, asks too; reading Env: or setting $env:X does not.
	const psClear = /(^|[^$\w])env:/i.test(flat) && /(^|[\s;|&(])(remove-item|ri|rm|del|erase|rd|rmdir|clear-item|cli)(\s|;|$)/i.test(flat);
	if (/\b(CLAUDECODE|AI_AGENT)\b/i.test(flat) || /\benv(\.exe)?\s+([^;|&\n]*\s)?(-i|--ignore-environment|-)(\s|$)/i.test(flat) || psClear || /\[(system\.)?environment\]::setenvironmentvariable/i.test(flat)) return 'a command that clears the AI shell\'s markers';
	// The terminal's way to resume is the owner's alone; the thread's way carries its proof, as the yes does (the 1.23.0
	// sweep: a resume with the AI shell's variables unset asked nothing).
	if (/KIT_OWNER_RESUME/i.test(flat)) return 'an owner resume of the sweep tools';
	// The pre-push hook lets an AI push to main or a tag only with this marker set, so setting it is the owner's yes.
	if (/KIT_PUSH_APPROVED/i.test(flat)) return 'the push hook\'s owner-yes marker';
	// A program or a word built at run time, then an outward verb in the same command: $G push, "$(which git)" push.
	if (/[$`%][^;|&\n]*?(^|[\s)"'`])(push|send-pack|publish|dcommit|upload)(\s|$)/i.test(flat)) return 'a command built at run time';
	const resume = /appr[^\s;|&]*\s[^;|&\n]*--resume\b/i.test(flat);
	if (/--owner-yes/i.test(flat) || resume) {
		const flag = /--owner-yes/i.test(flat) ? /^--owner-yes(=|$)/i : /^--resume$/i;
		const what = resume && !/--owner-yes/i.test(flat) ? 'an owner resume of the sweep tools' : 'an owner yes for a sweep';
		// An escape (\, a backtick, a caret, $'...') can move where a quote ends, so a yes holding one is not proven.
		if (/[\\`^]|\$'/.test(text)) return what;
		// Read with its quotes, so a quoted span stays one word: a --thread inside the yes's words is no proof. A
		// comment is cut first: the shell never hands approve.mjs a --thread after a # (the 1.23.0 sweep).
		const provenIn = (t) => tokenize(joinContinuations(t)).some((all) => {
			const w = all.filter((x) => !x.redirect).map((x) => x.value);
			const at = w.findIndex((x) => flag.test(x));
			const th = w.indexOf('--thread');
			return at >= 0 && th >= 0 && /^cmsg_[A-Za-z0-9]{8,64}$/.test(w[th + 1] ?? '');
		});
		// Proven as written and with its comments cut: cutting may only take a proof away, never make one.
		const proven = provenIn(plainText(text)) && provenIn(withoutComments(plainText(text)));
		const segments = tokenize(joinContinuations(flat)).filter((all) => all.some((x) => /--owner-yes|--resume/i.test(x.value)));
		if (!proven || segments.length !== 1) return what;
	}
	if (/\bgit\b[^;|&\n]*\balias\.[\w-]+/i.test(text)) return 'git with an alias';
	// An alias set from the environment names no git before it (GIT_CONFIG_KEY_0=alias.x, cargo's CARGO_ALIAS_X), and
	// its value may be spelled any way: any config from the environment, or cargo's --config, asks.
	if (/GIT_CONFIG_(COUNT|KEY_\d+|PARAMETERS)/i.test(text) && /\bgit\b/i.test(text)) return 'git with config from the environment';
	if (/CARGO_ALIAS_\w+/i.test(text) || (/\bcargo\b/i.test(text) && /--config\b/i.test(text))) return 'cargo with an alias or config';
	// xargs -I puts its input in place of any word, git's subcommand too; -I{} splits into two commands when read.
	if (/\bxargs(\.exe)?\b[^;|&\n]*\s(-[A-Za-z0-9]*[iIJ]|--replace)[^;|&\n]*\bgit(\.exe)?\b/.test(text)) return 'git through xargs';
	// A backtick span is a command bash runs first, wherever it sits; the tokenizer splits it into words.
	if (depth < MAX_DEPTH) for (const m of text.matchAll(/`([^`]+)`/g)) { const hit = findOutward(m[1], depth + 1); if (hit) return hit; }
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

// A push to a feature branch of origin, in the owner's bounds (T1, the owner 2026-11-10: "Tight bounds"): the whole
// command is one `git push [-u|--set-upstream] [-q|-v] origin <branch>` (or HEAD:<branch>, <branch>:<branch>), the
// branch written out, not main or master, with no force, delete, tag, mirror or skipped hooks. It goes without a yes:
// main is protected on GitHub, and the pre-push hook scans every pushed commit for secrets and logs the push.
const PUSH_FLAGS = new Set(['-u', '--set-upstream', '-q', '--quiet', '-v', '--verbose']);
const BRANCH = /^(?!-)(?!.*\.\.)(?!.*@\{)[A-Za-z0-9._/-]+$/;
function boundedPush(input) {
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

function decide(input) {
	const strings = [];
	collectStrings(input?.tool_input, strings, 0);
	const text = strings.join(LF);
	// Before any reading: the brace reader's time grows fast with a long run of signs (the 1.23.0 sweep).
	if (text.length > 100000) return 'a command too long to read';
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
		let input = null;
		let verdict = 'deny';
		let note = howToAsk(null);
		try {
			input = JSON.parse(raw);
			note = howToAsk(input);
			toolName = String(input.tool_name ?? '');
			reason = decide(input);
			// A push or a PR is where a PR body goes out: name the skill that writes and audits it.
			const command = String((input.tool_input && input.tool_input.command) ?? '');
			if (/\bgit\b[\s\S]*\bpush\b|\bgh\s+pr\s+(create|edit)\b/.test(command)) prNote = ' Before a PR: its body comes from the pr-body skill, with its audit shown (rule:pr-body).';
			// Inside the owner's bounds a feature-branch push goes without a yes; anything else held needs the owner's
			// own pop-up answer for this exact command (T1). A subagent's pop-up is no owner's, so it always hands back.
			if (reason && boundedPush(input)) reason = '';
			else if (reason && !input.agent_id && ownerYes(input)) verdict = 'allow';
		} catch {
			// A guard that cannot read the command refuses rather than lets it through.
			reason = 'the guard could not read this command';
		}
		if (reason) {
			const output = {
				hookSpecificOutput: {
					hookEventName: 'PreToolUse',
					permissionDecision: verdict,
					permissionDecisionReason: verdict === 'allow'
						? 'Outward action (' + reason + '): the owner said yes to this exact command in the pop-up.'
						: 'Outward action (' + reason + '): it runs only with the owner\'s yes.' + note,
				},
			};
			// The reason on an "ask" is shown to the user; added context is what reaches Claude.
			if (prNote) output.hookSpecificOutput.additionalContext = prNote.trim();
			process.stdout.write(JSON.stringify(output));
		} else if (prNote) {
			// A push inside the owner's bounds runs with no decision from here, and still carries the PR body note.
			process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: prNote.trim() } }));
		}
		// The decision is out before the log is touched: a log that cannot be written must never cost the ask.
		const logFile = process.argv[2];
		if (logFile) {
			try {
				fs.appendFileSync(logFile, new Date().toISOString() + ' ' + toolName + ' ' + (reason ? verdict : 'pass') + LF);
			} catch {
				// The log is a proof aid only.
			}
		}
	});
}

if (require.main === module) main();

module.exports = { decide, boundedPush };
