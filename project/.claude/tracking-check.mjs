#!/usr/bin/env node
// Tracking checks that were counted by hand (rule:tracking-file-size-caps, rule:parking-lot, rule:tracking-file-functions),
// as a script: the same answer every time, at no token cost. The closeout runs `caps`; the sweep runs `parking` first;
// a plan's Progress block passes `progress` before a tick is trusted.
//
// Usage (from the project folder):
//   node .claude/tracking-check.mjs caps                 the whole-file rows of the cap table
//   node .claude/tracking-check.mjs parking <plan.md>    the plan's Parking Lot is empty
//   node .claude/tracking-check.mjs progress <plan.md>   every done line in ## Progress carries evidence
import fs from 'node:fs';
import path from 'node:path';

// The whole-file rows of rule:tracking-file-size-caps.
const CAPS = [
	{ file: '_Working Memory.md', unit: 'lines', cap: 60, count: (t) => t.split('\n').filter((l, i, a) => i < a.length - 1 || l).length },
	{ file: '_Active Plan.md', unit: 'lines', cap: 70, count: (t) => t.split('\n').filter((l, i, a) => i < a.length - 1 || l).length },
	{ file: '_Session Log.md', unit: 'sessions', cap: 10, count: (t) => (t.match(/^## /gm) || []).length },
];

// The lines of one "## <name>" or "### <name>" section (a suffix such as "(ticked with evidence)" allowed), up to the
// next heading of the same or a higher level; or the text of a "**<name>:**" label and the lines under it. A shape
// the check does not see would pass as empty (the 1.30.1 sweep: the kit's own batch-plan heading has a suffix).
function section(text, name) {
	const lines = text.replace(/\r\n/g, '\n').split('\n');
	const start = lines.findIndex((l) => new RegExp(`^#{2,3} ${name}\\b`).test(l.trim()));
	if (start >= 0) {
		const level = lines[start].trim().match(/^#+/)[0].length;
		const end = lines.findIndex((l, i) => i > start && new RegExp(`^#{1,${level}} `).test(l));
		return lines.slice(start + 1, end < 0 ? undefined : end);
	}
	const label = new RegExp(`^\\*\\*${name}(?::\\*\\*|\\*\\*:)`);
	const at = lines.findIndex((l) => label.test(l));
	if (at < 0) return [];
	const out = [lines[at].replace(label, '')];
	for (const l of lines.slice(at + 1)) { if (!l.trim() || /^(\*\*[^*]+(?::\*\*|\*\*:)|#{1,6} )/.test(l)) break; out.push(l); }
	return out;
}
// A list line in any Markdown form: "- ", "* ", "+ ", "1. " or "1) ".
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;

// Evidence a reader can check: a PR or issue number, a commit, a code span (command, test, file:line), or a measurement.
const EVIDENCE = /#\d+|\b[0-9a-f]{7,40}\b|`[^`]+`|\d/;

function main([mode, file]) {
	const root = process.cwd();
	if (mode === 'caps') {
		console.log('| item | size | cap | status |\n|---|---|---|---|');
		let over = 0;
		for (const c of CAPS) {
			const p = path.join(root, c.file);
			if (!fs.existsSync(p)) { console.log(`| ${c.file} | missing | ${c.cap} | - |`); continue; }
			const n = c.count(fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'));
			if (n > c.cap) over++;
			console.log(`| ${c.file} | ${n} ${c.unit} | ${c.cap} | ${n > c.cap ? 'OVER' : 'ok'} |`);
		}
		if (over) console.log(`${over} file(s) OVER: move the oldest content to _Archive/ (rule:tracking-file-size-caps), never delete.`);
		process.exitCode = over ? 1 : 0;
		return;
	}
	if ((mode === 'parking' || mode === 'progress') && file) {
		const text = fs.readFileSync(path.resolve(root, file), 'utf8');
		if (mode === 'parking') {
			// Any written line is an idea; only the template's "<...>" placeholder and comments are not.
			const ideas = section(text, 'Parking Lot').filter((l) => l.trim() && !/^\s*(<[^>]*>|<!--.*-->)\s*$/.test(l));
			if (ideas.length) {
				console.log(`${ideas.length} idea(s) in the Parking Lot: triage each now, next or drop before the sweep (rule:parking-lot).`);
				process.exitCode = 1;
			} else console.log('PASS parking lot empty');
			return;
		}
		const done = section(text, 'Progress').filter((l) => ITEM.test(l) && /^(\[x\]|DONE\b)/i.test(l.replace(ITEM, '')));
		const bare = done.filter((l) => !EVIDENCE.test(l));
		for (const l of bare) console.log(`no evidence: "${l.trim()}"`);
		if (bare.length) process.exitCode = 1;
		else console.log(`PASS ${done.length} done line(s), each with evidence`);
		return;
	}
	console.log('Usage: node .claude/tracking-check.mjs caps | parking <plan.md> | progress <plan.md>');
	process.exitCode = 2;
}

main(process.argv.slice(2));
