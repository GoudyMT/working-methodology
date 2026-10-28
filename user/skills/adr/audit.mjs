#!/usr/bin/env node
// ADR audit (rule:sdd-triangle, the project's _Templates/_Decision Record Template.md): the title form, a valid
// status and a date, the MADR sections, the chosen option, and the Dual-Horizon block. It cannot judge the case.
//
// Usage: node audit.mjs <adr.md>
// Exit 0 = clean; 1 = faults, one per line.
import fs from 'node:fs';

const [file] = process.argv.slice(2);
if (!file) {
	console.log('Usage: node audit.mjs <adr.md>');
	process.exit(2);
}
const text = fs.readFileSync(file, 'utf8');
const faults = [];

if (!/^# ADR-\d{3}: \S/m.test(text)) faults.push('title: "# ADR-NNN: <short decision title>", NNN zero-padded');
const status = (text.match(/\*\*Status:\*\*\s*(.+)/) || [])[1] || '';
if (!/^(proposed|accepted|deprecated|rejected|superseded by \S)/.test(status.trim())) faults.push('Status: proposed, accepted, deprecated, rejected or "superseded by <link>"');
if (!/\*\*Date:\*\*\s*\d{4}-\d{2}-\d{2}/.test(text)) faults.push('Date: YYYY-MM-DD');
for (const s of ['Context and Problem Statement', 'Decision Drivers', 'Considered Options', 'Decision Outcome', 'Pros and Cons of the Options']) {
	if (!new RegExp(`^## ${s}`, 'm').test(text)) faults.push(`missing section: ${s}`);
}
// "[ \t]" and not "\s": a filled field has text on its own line, not the next line's text.
if (!/\*\*Chosen option:\*\*[ \t]*\S/.test(text)) faults.push('Decision Outcome: name the chosen option');
if (!/^### Dual-Horizon/m.test(text) || !/Impact now:\*\*[ \t]*\S/.test(text) || !/Impact later:\*\*[ \t]*\S/.test(text)) faults.push('Dual-Horizon: fill in the impact now and later');
// At least two real options: numbered lines under Considered Options.
const options = (text.split(/^## Considered Options/m)[1] || '').split(/^## /m)[0].match(/^\d+\. \S/gm) || [];
if (options.length < 2) faults.push('Considered Options: list at least two options');
if (!/^### Consequences/m.test(text)) faults.push('missing section: Consequences');

if (faults.length) {
	console.log(faults.join('\n'));
	process.exit(1);
}
console.log('ADR audit: clean');
