#!/usr/bin/env node
// Preview test record audit (rule:preview-test): the title names the PR, the build names the branch and commit,
// the stakes call says who tested, the setup used made-up details and sent nothing, every check has a result,
// and the shots and the result (PASS or FAIL) are given. It cannot see the screen; the shots do.
//
// Usage: node audit.mjs <record.md>
// Exit 0 = clean; 1 = faults, one per line.
import fs from 'node:fs';

const [file] = process.argv.slice(2);
if (!file) {
	console.log('Usage: node audit.mjs <record.md>');
	process.exit(2);
}
const lines = fs.readFileSync(file, 'utf8').split('\n');
const faults = [];
// A field's text, with the indented lines it wraps onto.
const field = (name) => {
	const at = lines.findIndex((x) => x.includes(`**${name}:**`));
	if (at < 0) return '';
	const more = [];
	for (const l of lines.slice(at + 1)) { if (!/^\s{2,}\S/.test(l)) break; more.push(l.trim()); }
	return [lines[at].split(`**${name}:**`)[1].trim(), ...more].join(' ');
};

const title = lines.find((l) => /^#{1,2} /.test(l)) || '';
if (!/#\d+/.test(title)) faults.push('title: name the pull request ("..., #<number> (<date>)")');
if (!/\b[\w.-]+\/[\w.-]+`? at `?[0-9a-f]{7,40}\b/.test(field('Build'))) faults.push('Build: name the branch at its commit');
if (!/lead/i.test(field('Who, by stakes'))) faults.push('Who, by stakes: say who tested and why the stakes call for it');
const setup = field('Setup');
if (!/made-up/i.test(setup) || !/nothing sent/i.test(setup)) faults.push('Setup: made-up details only, and nothing sent');

// Every check table: each row after the header and the divider has a result.
const heads = lines.map((l, i) => (/^\|\s*Check\s*\|/i.test(l) ? i : -1)).filter((i) => i >= 0);
if (!heads.length) faults.push('no check table (a "| Check | Result |" header)');
for (const h of heads) {
	for (const l of lines.slice(h + 2)) {
		if (!/^\|/.test(l)) break;
		const cells = l.split('|').slice(1, -1).map((c) => c.trim());
		if (cells.slice(1).some((c) => !c)) faults.push(`check "${cells[0]}": give its result`);
	}
}

if (!field('Shots')) faults.push('Shots: list the screenshots');
// One verdict, not the template's "PASS | FAIL - <...>" placeholder.
const result = field('Result');
if (!/^(PASS|FAIL)\b/.test(result) || /PASS\s*\|\s*FAIL|<[^>]*>/.test(result)) faults.push('Result: PASS or FAIL');

if (faults.length) {
	console.log(faults.join('\n'));
	process.exit(1);
}
console.log('Preview test audit: clean');
