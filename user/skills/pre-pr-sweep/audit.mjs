#!/usr/bin/env node
// Sweep report audit (rule:milestone-sweep, "Done iff", held to the report's tier by rule:sweep-tiers): the tier, a
// date, the branch and a commit, all six dimensions named, every high or critical finding dispositioned; feature, fix,
// launch-gate and first-push reports also give the version-goal verdict (a first push also its check); a triage report names its secrets and
// personal-data check. It cannot prove the agents ran.
//
// Usage: node audit.mjs <report.md>
// Exit 0 = clean; 1 = faults, one per line.
import fs from 'node:fs';

const [file] = process.argv.slice(2);
if (!file) {
	console.log('Usage: node audit.mjs <report.md>');
	process.exit(2);
}
const text = fs.readFileSync(file, 'utf8');
const lines = text.split('\n');
const faults = [];

const tier = ((text.match(/\*\*Tier:\*\*[ \t]*(feature|fix|triage|launch gate|first push)\b/i) || [])[1] || '').toLowerCase();
if (!tier) faults.push('Tier: name it on the report - feature, fix, triage, launch gate or first push (rule:sweep-tiers)');
// The first push also proves its foundation (rule:first-push-gate): the check passed at a commit, and the owner
// reviewed what is tracked.
if (tier === 'first push') {
	if (!lines.some((l) => /first push check/i.test(l) && /\bPASS\b/.test(l) && /\b[0-9a-f]{7,40}\b/.test(l))) faults.push('first push: record the first-push-check result as PASS at <commit>');
	if (!/tracked files reviewed/i.test(text)) faults.push('first push: record that the owner reviewed the tracked files (git ls-files)');
}

if (!/\b\d{4}-\d{2}-\d{2}\b/.test(lines.slice(0, 20).join('\n'))) faults.push('no date near the top (YYYY-MM-DD)');
// The branch is named outright, or in the `type/name` at `<commit>` form reports use.
const branchLine = (l) => (/branch/i.test(l) || /\b[\w.-]+\/[\w.-]+`? at `?[0-9a-f]/.test(l)) && /\b[0-9a-f]{7,40}\b/.test(l);
if (!lines.some(branchLine)) faults.push('no line naming the branch and its commit');

// The six fixed dimensions, by the words each one is named with. Every tier names each one: a result, its findings,
// or "not touched", so a triage label cannot skip them.
const DIMENSIONS = [/privacy|data boundary/i, /supply chain|bundle|dependenc/i, /legal|content|licen[cs]e/i,
	/security/i, /gaps|scaling/i, /version goal|alignment/i];
DIMENSIONS.forEach((re, i) => { if (!re.test(text)) faults.push(`dimension ${i + 1} is not named`); });
if (tier === 'triage') {
	// A triage pass is short, but it always says the diff was checked for secrets and personal data.
	if (!/secrets?/i.test(text) || !/personal data|PII/i.test(text)) faults.push('triage: name the secrets and personal-data check of the diff');
} else if (!lines.some((l) => /align|version goal/i.test(l) && /\b(YES|NO)\b/.test(l))) {
	faults.push('the version-goal verdict must say YES or NO');
}

// Every high or critical finding carries a disposition: each row of a findings table, and each finding bullet
// ("- **S1 (high)** - ..."). A table with a Severity column is read by that column; otherwise a row's severity is
// its first severity word, so "medium (the re-check; claimed high)" counts as medium. "Low-level" is not "low".
const SEV = /\b(critical|high|medium|low)\b(?!-)/i;
const severity = (s) => ((s.match(SEV) || [])[1] || '').toLowerCase();
const disposed = (l) => /\bFIXED [0-9a-f]{7,40}\b|\bDEFERRED \S|\bACCEPTED \S/.test(l);
const flag = (id) => faults.push(`finding ${id}: a high or critical finding needs FIXED <commit>, DEFERRED <where> or ACCEPTED <why>`);
let sevCol = -1;
lines.forEach((l, i) => {
	if (/^\|/.test(l)) {
		const cells = l.split('|').slice(1, -1).map((c) => c.trim());
		// A header row (the next line is the divider) sets which column holds severity, or none.
		if (/^\|[\s|:-]+\|$/.test((lines[i + 1] || '').trim())) { sevCol = cells.findIndex((c) => /^severity$/i.test(c)); return; }
		if (/^\|[\s|:-]+\|$/.test(l.trim())) return;
		const sev = sevCol >= 0 ? severity(cells[sevCol] || '') : severity(l);
		if (['high', 'critical'].includes(sev) && !disposed(l)) flag(cells[0]);
	} else {
		sevCol = -1;
		const m = l.match(/^\s*[-*] \*\*([A-Z]+[\w.-]*\d)\b([^*]*)\*\*/);
		if (m && ['high', 'critical'].includes(severity(m[2])) && !disposed(l)) flag(m[1]);
	}
});

if (faults.length) {
	console.log(faults.join('\n'));
	process.exit(1);
}
console.log('Sweep report audit: clean');
