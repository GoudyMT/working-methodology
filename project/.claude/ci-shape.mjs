#!/usr/bin/env node
// The CI shape report (K44, 1.36.0; the owner's option A, 2026-11-13). The kit's own scoped CI cannot reach a project
// (a project's repo holds no kit file), so a project gets the shape as a template per stack (_Templates/ci-<stack>.yml)
// and this report of what its workflows lack. On 2026-11-13 AI Essentials ran its whole CI twice per PR push (push
// and pull_request with no branch filter) and cancelled no stale run (workbench results/fast-ci-standard/RESULT.md).
//
// It reads .github/workflows/*.yml and *.yaml line by line (no YAML library: the kit installs none) for:
//   triggers       push and pull_request never both run on a PR branch push (push names its branches)
//   stale runs     a concurrency group with cancel-in-progress
//   one required   a summary job that needs the others and runs always(), so one check can be required
//   scoped PR run  a job-level if on the changed parts, or the stack's own selection (vitest related, --changed,
//                  --findRelatedTests, pytest --testmon); reported as a lever only, never a gap (the lane report
//                  calls for it when the fast lane runs over its budget)
// It reports and never edits, and it never fails a run. Usage (from the project folder):
//   node .claude/ci-shape.mjs [--json]
// Exit 0 reported, 2 it could not run.
import fs from 'node:fs';
import path from 'node:path';

const dir = process.cwd();
const FOLDER = path.join(dir, '.github', 'workflows');

/** A top-level block's lines (its key at column 0 or under on:), as written. */
function block(lines, key, indent) {
	const at = lines.findIndex((l) => new RegExp(`^${' '.repeat(indent)}${key}:`).test(l));
	if (at < 0) return null;
	const out = [lines[at]];
	for (let i = at + 1; i < lines.length; i++) {
		const l = lines[i];
		if (l.trim() && !l.startsWith(' '.repeat(indent + 1)) && !l.trimStart().startsWith('#')) break;
		out.push(l);
	}
	return out;
}

/** The gaps and levers of one workflow file. */
export function shapeOf(text) {
	const lines = text.replace(/\r\n/g, '\n').split('\n');
	const gaps = [];
	const levers = [];
	const on = block(lines, 'on', 0) || block(lines, '"on"', 0) || [];
	const onText = on.join('\n');
	// on: [push, pull_request] or on: push / pull_request with no branches under push.
	const inline = /^on:\s*\[([^\]]*)\]/m.exec(onText);
	const hasPush = inline ? /\bpush\b/.test(inline[1]) : /^\s{2}push:/m.test(onText);
	const hasPr = inline ? /\bpull_request\b/.test(inline[1]) : /^\s{2}pull_request:/m.test(onText);
	const push = inline ? null : block(on.slice(1), 'push', 2);
	const pushBranches = push ? /^\s+branches:/m.test(push.join('\n')) : false;
	if (hasPush && hasPr && !pushBranches) gaps.push('triggers: push and pull_request both run on a PR branch push (name main under push: branches)');
	if (!/^concurrency:/m.test(text) || !/cancel-in-progress:\s*(true|\$\{\{)/.test(text)) gaps.push('stale runs: no concurrency group with cancel-in-progress');
	const jobs = text.split(/\n(?=  [A-Za-z0-9_-]+:\s*$)/m);
	const summary = jobs.some((j) => /^\s{4}needs:/m.test(j) && /^\s{4}if:\s*\$?\{?\{?\s*always\(\)/m.test(j));
	if (!summary) gaps.push('one required check: no summary job that needs the others and runs always()');
	if (!/(^\s{4}if:.*(changes|outputs|paths)|vitest related|--changed|--findRelatedTests|--testmon)/m.test(text)) levers.push('scoped PR run: none yet (a job-level if by folder, then the stack\'s own selection); the lane report calls for it');
	if (/^\s{4}paths(-ignore)?:/m.test(onText)) gaps.push('triggers: a workflow path filter can skip the required check; use a job-level if');
	return { gaps, levers };
}

function main() {
	let files = [];
	try { files = fs.readdirSync(FOLDER).filter((f) => /\.ya?ml$/.test(f)).sort(); } catch { /* none */ }
	const workflows = files.map((f) => ({ file: f, ...shapeOf(fs.readFileSync(path.join(FOLDER, f), 'utf8')) }));
	const gaps = workflows.reduce((n, w) => n + w.gaps.length, 0);
	if (process.argv.includes('--json')) return console.log(JSON.stringify({ workflows, gaps }, null, 2));
	if (!workflows.length) return console.log('CI shape: no workflow in .github/workflows: start from _Templates/ci-<stack>.yml (node or python).');
	console.log(`CI shape: ${gaps} gap(s) in ${workflows.length} workflow(s). Report only; nothing was changed.`);
	for (const w of workflows) {
		for (const g of w.gaps) console.log(`    ${w.file}: MISSING ${g}`);
		for (const l of w.levers) console.log(`    ${w.file}: lever ${l}`);
	}
	return undefined;
}

try { main(); } catch (e) { console.error(`ci shape: ${e.message}`); process.exitCode = 2; }
