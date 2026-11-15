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
import fs from 'node:fs';

const TYPES = ['feat', 'fix', 'refactor', 'test', 'docs', 'chore', 'security', 'perf'];
// T13 (the owner, 2026-11-10): one change per line; a longer subject packs a list that belongs in the PR body.
const SUBJECT_MAX = 72;
// A tracking code (K61, E12, A27, S23-4) tells a reader outside the project nothing, and a subject, title or repo name
// is public for good (the owner, 2026-11-15, on a probe repo named for its list row).
const CODE = /(^|[^A-Za-z0-9])[A-Z]{1,3}\d{1,3}(-\d+)?(?![A-Za-z0-9])/;
// Names the field shares, in the same letters-and-digits shape, are words, not codes (the K61 sweep: SHA256, UTF8, S3).
const KNOWN = /^(h[1-6]|h26[45]|s3|ec2|ie\d{1,2}|x11|x86|x64|sha\d{1,3}|md5|utf8|utf16|arm64|es\d{1,2}|v8|ipv[46]|css3|mp[34]|win32|win64|py[23]|go1|av1)$/i;
const codeIn = (text) => [...text.matchAll(new RegExp(CODE.source, 'g'))].map((m) => m[0].replace(/^[^A-Za-z0-9]/, '')).find((c) => !KNOWN.test(c.replace(/-\d+$/, ''))) || '';
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

function branch(name) {
	if (['main', 'master'].includes(name) || name.startsWith('dependabot/')) return [];
	const m = name.match(/^([a-z]+)\/(.+)$/);
	if (!m || !BRANCH_TYPES.includes(m[1])) return [`"${name}": a branch is <type>/<plain-kebab-description>, type one of ${BRANCH_TYPES.join(', ')}`];
	// An internal code (b2-, f9_) or a tool prefix (claude/, worktree-) tells a reader nothing.
	if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(m[2]) || (/^[a-z]\d+(-|$)/.test(m[2]) && !KNOWN.test(m[2].split('-')[0]))) {
		return [`"${name}": the description is plain words in kebab case, with no internal code or tool prefix`];
	}
	return [];
}

function repo(name) {
	if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.split('-').some((w) => /^[a-z]{1,2}\d{1,3}$/.test(w) && !KNOWN.test(w))) {
		return [`"${name}": a repo name is plain words in kebab case, lowercase, with no internal code`];
	}
	return [];
}

const [mode, arg] = process.argv.slice(2);
const faults = mode === 'message' ? message(fs.readFileSync(arg, 'utf8')) : mode === 'branch' ? branch(arg || '') : mode === 'title' ? message(arg || '') : mode === 'repo' ? repo(arg || '') : null;
if (!faults) {
	console.error('Usage: node .claude/name-check.mjs message <file> | branch <name> | title <text> | repo <name>');
	process.exitCode = 2;
} else if (faults.length) {
	for (const f of faults) console.error(`name-check: ${f}`);
	process.exitCode = 1;
}
