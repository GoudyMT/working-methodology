#!/usr/bin/env node
// The word check (T16a, the owner's lock 2026-11-11): one name for each thing the guards and rules talk about, so a
// session reads the same words in a rule and in the refusal that enforces it. CI runs it on every PR.
//   node scripts/word-check.mjs [kit folder]    exit 1, with file:line and the name to use, on a banned variant
// The five names: the owner's yes, outward act, the push bound, gate bypass, protected file (rules/core.md, Terms).
// It reads rules, user, project (git hooks too), memory, scripts and the top-level docs. Frozen text is not read: the changelog, the recall keys and results, reports, tests and vendored code. Two files
// quote another source word for word and are skipped by name.
import fs from 'node:fs';
import path from 'node:path';

const BANNED = [
	[/\bowner's go\b/i, "the owner's yes"],
	[/\bowner's word\b/i, "the owner's yes"],
	[/\bexplicit yes\b/i, "the owner's yes"],
	[/\bowner approves\b/i, "the owner's yes"],
	[/\bowner's approval\b/i, "the owner's yes"],
	[/\boutward action\b/i, 'outward act'],
	// The other three names (the 1.26.0 sweep, C8).
	[/\bowner's bounds\b/i, 'the push bound'],
	[/\bpush (bounds|boundary|boundaries)\b/i, 'the push bound'],
	[/\bhooks? bypass(es)?\b/i, 'gate bypass'],
	[/\bbypass(ing)? the (git )?hooks\b/i, 'gate bypass'],
	[/\bguarded files?\b/i, 'protected file'],
	[/\bprotected paths?\b/i, 'protected file'],
];
const ROOTS = ['rules', 'user', 'project', 'memory', 'scripts'];
// The top-level docs a reader meets first (C20); the changelog is frozen text and stays out.
const DOCS = ['README.md', 'NEW-PROJECT.md', 'EXISTING-PROJECT.md', 'TRIALS.md'];
const SKIP = new Set(['user/skills/agent-team-build/references/SOURCES.md', 'project/.claude/kit/improvement-report-example.md']);
const TEXT = /\.(md|cjs|mjs|js|json)$/;

const kit = path.resolve(process.argv[2] || '.');
const hits = [];
const walk = (abs, rel) => {
	let entries = [];
	try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
	for (const e of entries) {
		const r = rel ? `${rel}/${e.name}` : e.name;
		if (e.isDirectory()) { if (e.name !== 'node_modules') walk(path.join(abs, e.name), r); continue; }
		if (!e.isFile() || !(TEXT.test(e.name) || /(^|\/)\.githooks$/.test(rel)) || SKIP.has(r)) continue;
		scan(path.join(abs, e.name), r);
	}
};
function scan(file, r) {
	fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
		for (const [re, use] of BANNED) {
			const m = re.exec(line);
			if (m) hits.push(`${r}:${i + 1}: "${m[0]}" - write "${use}"`);
		}
	});
}
for (const root of ROOTS) walk(path.join(kit, root), root);
for (const doc of DOCS) if (fs.existsSync(path.join(kit, doc))) scan(path.join(kit, doc), doc);
if (hits.length) {
	console.log(`Word check: ${hits.length} banned variant(s); one name for each thing (rules/core.md, Terms):`);
	for (const h of hits) console.log(`    ${h}`);
	process.exitCode = 1;
} else console.log('Word check: no banned variant in the rules, skills, agents, guard texts, scripts or top-level docs.');
