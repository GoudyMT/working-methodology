#!/usr/bin/env node
// Commit messages and branch names in the house style (rule:commit-message-format, rule:branching), checked by script
// so the style holds without anyone remembering it. The commit-msg hook runs `message`; the pre-push hook runs `branch`
// for every branch it sends.
//
// Usage:
//   node .claude/name-check.mjs message <file>   one line, "type: subject", no AI or tool trailer
//   node .claude/name-check.mjs branch <name>    <type>/<plain-kebab-description>, no tool prefix or internal code
//   node .claude/name-check.mjs title <text>     a PR title: the squash commit's subject on main, same rule
//   node .claude/name-check.mjs repo <name>      a repo name: plain words in kebab case, no internal code
//   node .claude/name-check.mjs ident            the commit git is making: its author and committer are not an AI tool
import fs from 'node:fs';
import { createRequire } from 'node:module';

const TYPES = ['feat', 'fix', 'refactor', 'test', 'docs', 'chore', 'security', 'perf', 'retest'];
// T13 (the owner, 2026-11-10): one change per line; a longer subject packs a list that belongs in the PR body.
const SUBJECT_MAX = 72;
// A tracking code (K61, E12, A27, S23-4) tells a reader outside the project nothing, and a subject, title or repo name
// is public for good (the owner, 2026-11-15, on a probe repo named for its list row).
// The cloud build study (1.49.0): a code typed in lowercase (k212) or with a dot (R7.1) is the same code;
// A capital code may end in a letter or carry several dots (G1a, R7.1.2). The build 23b sweep: lowercase is a code only
// as one letter and two or three digits, or with a range or a dot (k212, r7.1), so tech words stay words (d3, m1, py312).
const CODE = /(^|[^A-Za-z0-9.])(?:[A-Z]{1,3}\d{1,3}[a-z]?(?:[-.]\d+)*|[a-z]\d{2,3}(?:[-.]\d+)*|[a-z]\d{1,3}(?:[-.]\d+)+)(?![A-Za-z0-9]|\.\d)/;
// Names the field shares, in the same letters-and-digits shape, are words, not codes (the K61 sweep: SHA256, UTF8, S3).
const KNOWN = /^(h[1-6]|h26[45]|s3|ec2|ie\d{1,2}|x11|x86|x64|sha\d{1,3}|md5|utf8|utf16|arm64|es\d{1,2}|v8|ipv[46]|css3|mp[34]|win32|win64|py[23]|go1|av1|p\d{2})$/i;
// A version (v1.33.0, v2) is a version, not a code.
const VERSION = /^v\d+([.-]\d+)*$/i;
const codeIn = (text) => [...text.matchAll(new RegExp(CODE.source, 'g'))].map((m) => m[0].replace(/^[^A-Za-z0-9]/, '')).find((c) => !KNOWN.test(c.replace(/([-.]\d+)+$/, '')) && !VERSION.test(c)) || '';
const BRANCH_TYPES = ['feature', 'feat', 'fix', 'chore', 'test', 'perf', 'security', 'docs', 'refactor'];

function message(text) {
	// Git strips comment lines and trailing blank lines before it records the message.
	const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => !l.startsWith('#'));
	while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
	const [subject = ''] = lines;
	// Git writes these itself, and a fixup is squashed away before review.
	if (/^(Merge|Revert) /.test(subject) || /^(fixup|squash|amend)! /.test(subject)) return [];
	const faults = subject.length > SUBJECT_MAX ? [`the subject is ${subject.length} characters, over ${SUBJECT_MAX}: one change per line, detail in the PR body`] : [];
	if (!new RegExp(`^(${TYPES.join('|')})(\\([a-z0-9-]+\\))?: [a-z0-9\`]`).test(subject) || /\.$/.test(subject)) {
		faults.push(`the subject must be "type: subject" - types ${TYPES.join(', ')}; lowercase; no period: "${subject}"`);
	}
	const code = codeIn(subject.replace(/^[a-z]+(\([a-z0-9-]+\))?: /, ''));
	if (code) faults.push(`the subject names an internal code (${code}): say what changes in plain words`);
	const rest = lines.slice(1);
	if (rest.some((l) => /^(Co-Authored-By|Signed-off-by|Generated-by):/i.test(l) || /generated with|claude|copilot/i.test(l))) {
		faults.push('no AI or tool trailer: detail goes in the PR body');
	}
	if (rest.some((l) => l.trim())) faults.push('one line only: no body or footer (detail goes in the PR body and the Session Log)');
	return faults;
}

// An AI tool named at the start of a word (Claude, claude-code, GitHub Copilot, 123+Copilot@users.noreply.github.com,
// ClaudeCode, claude2, claudebot), or an email at an AI maker's domain. A person whose name only holds the letters,
// with more lowercase letters after them (Claudia, Claudette, Copilotto), passes. The build 23a sweep: the text is
// folded first (NFKC, format characters dropped, Cyrillic and Greek lookalikes read as the Latin letter), and more
// makers' tools are named.
const AI_TOOLS = ['claude', 'copilot', 'chatgpt', 'openai', 'anthropic', 'gemini', 'codex', 'cursoragent'];
const AI_DOMAIN = /@([a-z0-9-]+\.)*(anthropic\.com|openai\.com|claude\.ai|claude\.com|cursor\.com)$/i;
const LOOKALIKE = { '\u0430': 'a', '\u0435': 'e', '\u043e': 'o', '\u0440': 'p', '\u0441': 'c', '\u0445': 'x', '\u0456': 'i', '\u0443': 'y', '\u0410': 'A', '\u0415': 'E', '\u041e': 'O', '\u0420': 'P', '\u0421': 'C', '\u0425': 'X', '\u0406': 'I', '\u03bf': 'o', '\u039f': 'O', '\u0391': 'A', '\u0395': 'E' };
const fold = (s) => String(s).normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/[\u0400-\u04ff\u0370-\u03ff]/g, (c) => LOOKALIKE[c] || c);
// The suffixes a tool name takes that are no person's name (ClaudeCode is caught by its capital, claudecode here).
const TOOL_TAIL = /^(code|bot|ai|agent|assistant|cli|app)/i;
function namesTool(text) {
	const t = fold(text);
	// Lowercased letter by letter, keeping the length, so an index into one is an index into the other.
	const low = Array.from(t, (c) => { const l = c.toLowerCase(); return l.length === c.length ? l : c; }).join('');
	for (const tool of AI_TOOLS) {
		for (let i = low.indexOf(tool); i >= 0; i = low.indexOf(tool, i + 1)) {
			if (i > 0 && /[\p{L}\p{N}]/u.test(t[i - 1])) continue;
			const next = t.slice(i + tool.length);
			if (!next || !/^\p{Ll}/u.test(next) || TOOL_TAIL.test(next)) return true;
		}
	}
	return false;
}

/**
 * The owner's rule (2026-11-21): no AI reference anywhere in a commit, its author and committer included; the message
 * check above covers only the text. Reads who git will record: git var, which honours --author, the GIT_AUTHOR_* and
 * GIT_COMMITTER_* variables and the config, run through the safe-spawn helper (a git.exe in the project never runs).
 * Without the helper beside this file, or where git var cannot answer, the variables git hands the hook are read.
 */
function ident() {
	const faults = [];
	let gitRead = null;
	try { gitRead = createRequire(import.meta.url)('./safe-spawn.cjs').gitRead; } catch { /* the variables alone */ }
	// The owner's own list of people who may commit though a name reads as a tool's (the build 23a sweep: a person named
	// Claude). It sits in the repo's git config, which only the owner writes (the guards hold .git/config), each entry
	// the exact "Name <email>".
	const listed = gitRead ? String((gitRead(process.cwd(), ['config', '--local', '--get-all', 'kit.allowedIdent'], { encoding: 'utf8' }) || {}).stdout || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];
	for (const who of ['author', 'committer']) {
		const KEY = who.toUpperCase();
		let name = process.env[`GIT_${KEY}_NAME`] || '';
		let email = process.env[`GIT_${KEY}_EMAIL`] || '';
		const r = gitRead ? gitRead(process.cwd(), ['var', `GIT_${KEY}_IDENT`], { encoding: 'utf8' }) : null;
		const m = r && r.status === 0 ? /^(.*) <([^>]*)>/.exec(String(r.stdout)) : null;
		if (m) [, name, email] = m;
		if (listed.includes(`${name} <${email}>`)) continue;
		if (namesTool(name) || namesTool(email.split('@')[0]) || AI_DOMAIN.test(fold(email))) {
			faults.push(`the ${who} "${name} <${email}>" names an AI tool: commit as the person who owns the work (git config user.name and user.email; for a commit replayed by amend or rebase, --reset-author or --author; unset GIT_AUTHOR_* and GIT_COMMITTER_*). A person whose own name reads this way is listed by the owner: git config --add kit.allowedIdent "Name <email>"`);
		}
	}
	return faults;
}

// A code in a kebab description: the first word as one letter and digits (b2-), any word as one letter and two or three
// digits (k212), or a code and its dotted part split by the dash (r7-1). Known words and versions are words.
const branchCode = (ws) => ws.some((w, i) => !KNOWN.test(w) && !VERSION.test(w) && ((i === 0 && /^[a-z]\d+$/.test(w)) || /^[a-z]\d{2,3}$/.test(w) || (/^[a-z]\d{1,3}$/.test(w) && /^\d+$/.test(ws[i + 1] || ''))));
function branch(name) {
	if (['main', 'master'].includes(name) || name.startsWith('dependabot/')) return [];
	const m = name.match(/^([a-z]+)\/(.+)$/);
	if (!m || !BRANCH_TYPES.includes(m[1])) return [`"${name}": a branch is <type>/<plain-kebab-description>, type one of ${BRANCH_TYPES.join(', ')}`];
	// An internal code (b2-, f9_) or a tool prefix (claude/, worktree-) tells a reader nothing.
	if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(m[2]) || branchCode(m[2].split('-'))) {
		return [`"${name}": the description is plain words in kebab case, with no internal code or tool prefix`];
	}
	return [];
}

function repo(name) {
	if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.split('-').some((w) => /^[a-z]{1,2}\d{1,3}$/.test(w) && !KNOWN.test(w) && !VERSION.test(w))) {
		return [`"${name}": a repo name is plain words in kebab case, lowercase, with no internal code`];
	}
	return [];
}

const [mode, arg] = process.argv.slice(2);
const faults = mode === 'ident' ? ident() : mode === 'message' ? message(fs.readFileSync(arg, 'utf8')) : mode === 'branch' ? branch(arg || '') : mode === 'title' ? message(arg || '') : mode === 'repo' ? repo(arg || '') : null;
if (!faults) {
	console.error('Usage: node .claude/name-check.mjs message <file> | branch <name> | title <text> | repo <name> | ident');
	process.exitCode = 2;
} else if (faults.length) {
	for (const f of faults) console.error(`name-check: ${f}`);
	process.exitCode = 1;
}
