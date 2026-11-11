#!/usr/bin/env node
// The word check (T16a, the owner's lock 2026-11-11): one name for each thing the guards and rules talk about, so a
// session reads the same words in a rule and in the refusal that enforces it. CI runs it on every PR.
//   node scripts/word-check.mjs [kit folder]    exit 1, with file:line and the name to use, on a banned variant
// The five names: the owner's yes, outward act, the push bound, gate bypass, protected file (rules/core.md, Terms).
// Frozen text is not read: the changelog, the recall keys and results, reports, tests and vendored code. Two files
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
];
const ROOTS = ['rules', 'user', 'project', 'memory'];
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
		if (!e.isFile() || !TEXT.test(e.name) || SKIP.has(r)) continue;
		fs.readFileSync(path.join(abs, e.name), 'utf8').split(/\r?\n/).forEach((line, i) => {
			for (const [re, use] of BANNED) {
				const m = re.exec(line);
				if (m) hits.push(`${r}:${i + 1}: "${m[0]}" - write "${use}"`);
			}
		});
	}
};
for (const root of ROOTS) walk(path.join(kit, root), root);
if (hits.length) {
	console.log(`Word check: ${hits.length} banned variant(s); one name for each thing (rules/core.md, Terms):`);
	for (const h of hits) console.log(`    ${h}`);
	process.exitCode = 1;
} else console.log('Word check: every rule, skill, agent and guard text uses the five names.');
