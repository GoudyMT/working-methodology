#!/usr/bin/env node
// Sweep report audit (rule:milestone-sweep, "Done iff"): a date, the branch and a commit, all six dimensions, every
// high or critical finding dispositioned, and the version-goal verdict. It cannot prove the agents ran.
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

if (!/\b\d{4}-\d{2}-\d{2}\b/.test(lines.slice(0, 20).join('\n'))) faults.push('no date near the top (YYYY-MM-DD)');
// The branch is named outright, or in the `type/name` at `<commit>` form reports use.
const branchLine = (l) => (/branch/i.test(l) || /\b[\w.-]+\/[\w.-]+`? at `?[0-9a-f]/.test(l)) && /\b[0-9a-f]{7,40}\b/.test(l);
if (!lines.some(branchLine)) faults.push('no line naming the branch and its commit');

// The six fixed dimensions, by the words each one is named with.
const DIMENSIONS = [/privacy|data boundary/i, /supply chain|bundle|dependenc/i, /legal|content|licen[cs]e/i,
	/security/i, /gaps|scaling/i, /version goal|alignment/i];
DIMENSIONS.forEach((re, i) => { if (!re.test(text)) faults.push(`dimension ${i + 1} is not named`); });

// Every high or critical row of a findings table carries a disposition. A row's severity is its first severity
// word, so "medium (the re-check; claimed high)" counts as medium.
const severity = (l) => ((l.match(/\b(critical|high|medium|low)\b/i) || [])[1] || '').toLowerCase();
for (const l of lines.filter((l) => /^\|/.test(l) && ['high', 'critical'].includes(severity(l)))) {
	if (!/\bFIXED [0-9a-f]{7,40}\b|\bDEFERRED \S|\bACCEPTED \S/.test(l)) {
		const id = l.split('|')[1].trim();
		faults.push(`finding ${id}: a high or critical finding needs FIXED <commit>, DEFERRED <where> or ACCEPTED <why>`);
	}
}

if (!lines.some((l) => /align|version goal/i.test(l) && /\b(YES|NO)\b/.test(l))) faults.push('the version-goal verdict must say YES or NO');

if (faults.length) {
	console.log(faults.join('\n'));
	process.exit(1);
}
console.log('Sweep report audit: clean');
