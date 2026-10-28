#!/usr/bin/env node
// Handoff audit (rule:pre-compact-scan, the closeout skill's handoff shape): every section, in order; the first
// actions name the orientation protocol; the Git line and the Next Step are filled in; ASCII only. It cannot
// check that the state is true.
//
// Usage: node audit.mjs <handoff.md>
// Exit 0 = clean; 1 = faults, one per line.
import fs from 'node:fs';

const [file] = process.argv.slice(2);
if (!file) {
	console.log('Usage: node audit.mjs <handoff.md>');
	process.exit(2);
}
const text = fs.readFileSync(file, 'utf8');
const lines = text.split('\n');
const faults = [];

const SECTIONS = ['REQUIRED FIRST ACTIONS', 'Working Mode', 'State Snapshot', 'Newly-Established Working Standards',
	'Critical In-Flight Context', 'Reading Order', 'Next Step', 'Anti-Hallucination Discipline'];
let last = -1;
for (const s of SECTIONS) {
	const at = lines.findIndex((l) => l.startsWith(`## ${s}`));
	if (at < 0) faults.push(`missing section: ${s}`);
	else if (at < last) faults.push(`out of order: ${s}`);
	else last = at;
}
// The body of one section: the lines up to the next "## " heading.
const body = (s) => {
	const at = lines.findIndex((l) => l.startsWith(`## ${s}`));
	if (at < 0) return '';
	const end = lines.findIndex((l, i) => i > at && l.startsWith('## '));
	return lines.slice(at + 1, end < 0 ? undefined : end).join('\n');
};
if (!/orientation/i.test(body('REQUIRED FIRST ACTIONS'))) faults.push('REQUIRED FIRST ACTIONS must name the orientation protocol');
if (!/^- Git:\s*\S/m.test(body('State Snapshot'))) faults.push('State Snapshot: fill in the Git line (branch, HEAD, pushed or not, open PRs)');
if (!/What:\s*\S/.test(body('Next Step'))) faults.push('Next Step: say what comes next');
lines.forEach((l, i) => { if (/[^\x00-\x7F]/.test(l)) faults.push(`line ${i + 1}: non-ASCII character`); });

if (faults.length) {
	console.log(faults.join('\n'));
	process.exit(1);
}
console.log('Handoff audit: clean');
