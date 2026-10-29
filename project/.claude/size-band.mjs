#!/usr/bin/env node
// The size band (rule:size-budgets): a plan's one approved size request, applied from measurement by script, so the
// arithmetic is never done by hand. Only for a project whose adapter row A12 names size budgets.
//
// It refuses only a MEASURED size past what is allowed: a band line's limit at approval plus its approved raise, or
// the current limit for any line the band does not list. The margin (10% of a line's growth since the plan's base) is
// headroom: written when it fits, dropped when it does not, never a reason to ask. A count (a number of files, not
// bytes) is raised or lowered exactly, with no margin.
//
// Files, all JSON objects keyed by budget line:
//   band:     { "base": {...}, "limit": {...}, "raise": {...}, "counts": ["<count line>", ...] }
//             base = the sizes when the request was asked; limit = the limits when it was approved; raise = the
//             approved raise per line (a line not listed may not grow past its limit)
//   measured: this build's sizes (from the project's own size checks, on a build that measures the same every time)
//   limits:   the limits in force now
//
// Usage: node size-band.mjs apply|final --band <file> --measured <file> --limits <file>
//   apply  after the work grows a line; final  the PR's end check (lowers padding back to size + margin).
//   Prints the new limits as JSON on its last line (exit 0), or each refusal with the number to re-request (exit 1).
//   The project writes the new limits into its own check files (A12 names them), in their own chore: commit.
import fs from 'node:fs';

const MARGIN = 0.1;

const args = process.argv.slice(2);
const mode = args[0];
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const load = (name) => JSON.parse(fs.readFileSync(opt(name), 'utf8'));
const bytes = (n) => `${n.toLocaleString('en-US')} B`;

function main() {
	if ((mode !== 'apply' && mode !== 'final') || !opt('--band') || !opt('--measured') || !opt('--limits')) {
		console.log('Usage: node size-band.mjs apply|final --band <file> --measured <file> --limits <file>');
		return 2;
	}
	const band = load('--band');
	const measured = load('--measured');
	const limits = load('--limits');
	const counts = new Set(band.counts || []);
	const raise = band.raise || {};
	// Every number the arithmetic reads must be a whole, non-negative number, or a limit could be written from a
	// string or a missing value. A band read wrong would let a limit rise past what was approved.
	const whole = (n) => Number.isInteger(n) && n >= 0;
	const wrong = [];
	for (const line of Object.keys(limits)) {
		if (!whole(limits[line])) wrong.push(`limits.${line}`);
		if (!whole(band.base?.[line])) wrong.push(`base.${line}`);
		if (!whole(band.limit?.[line])) wrong.push(`limit.${line}`);
	}
	for (const [line, n] of Object.entries(raise)) if (!whole(n) || !(line in limits)) wrong.push(`raise.${line}`);
	if (wrong.length) {
		console.log(`SIZE BAND: the band or the limits cannot be read as whole numbers: ${wrong.join(', ')}. Nothing written.`);
		return 2;
	}
	const next = { ...limits };
	const refusals = [];
	for (const line of Object.keys(measured)) if (!(line in limits)) refusals.push(`${line}: no limit for this line - add it to the limits (a new budget is the owner's call)`);
	for (const line of Object.keys(limits)) {
		const size = measured[line];
		if (!Number.isInteger(size) || size < 0) { refusals.push(`${line}: no measured size`); continue; }
		const listed = (raise[line] ?? 0) > 0;
		const margin = counts.has(line) ? 0 : Math.ceil(Math.max(0, size - band.base[line]) * MARGIN);
		if (mode === 'apply') {
			const allowed = listed ? band.limit[line] + raise[line] : limits[line];
			if (size > allowed) {
				// The whole raise to re-request over the limit at approval, margin included, rounded up to 10 B.
				const ask = counts.has(line) ? size - band.limit[line] : Math.ceil((size + margin - band.limit[line]) / 10) * 10;
				refusals.push(`${line}: measured ${bytes(size)}, allowed ${bytes(allowed)} - trim first (steps 1-2), then re-request a raise of ${ask} over the limit at approval (approved: ${raise[line] ?? 0})`);
				continue;
			}
			if (listed) next[line] = Math.max(limits[line], Math.min(size + margin, allowed));
		} else {
			if (size > limits[line]) { refusals.push(`${line}: measured ${bytes(size)}, over its limit ${bytes(limits[line])} - back to the trim pass`); continue; }
			if (listed && limits[line] - size > margin) next[line] = size + margin;
		}
	}
	if (refusals.length) {
		console.log(`SIZE BAND ${mode.toUpperCase()}: refused, nothing to write.`);
		for (const r of refusals) console.log(`    ${r}`);
		return 1;
	}
	for (const line of Object.keys(next)) if (next[line] !== limits[line]) console.log(`    ${line}: ${bytes(limits[line])} -> ${bytes(next[line])} (measured ${bytes(measured[line])})`);
	console.log(JSON.stringify({ limits: next }));
	return 0;
}

process.exitCode = main();
