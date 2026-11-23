// CI-D (patch 1.51.1): the project CI templates size their own shards, lane-state judges against 3 minutes, and the
// rule text says so. Templates are read line by line (no YAML library), as the kit's other CI tests read them.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import kitTemp from '../project/.claude/kit-temp.cjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES = ['ci-node.yml', 'ci-python.yml'].map((f) => ({ name: f, file: path.join(REPO, 'project', '_Templates', f) }));

// The template's lines with its comment lines dropped: a comment can say 180 or run ci-plan.mjs and mean nothing.
function codeLines(file) {
	return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n').filter((l) => !/^\s*#/.test(l));
}

// The lines of one top-level job under jobs: (its key at two spaces), up to the next job.
function jobLines(lines, job) {
	const at = lines.findIndex((l) => l === `  ${job}:`);
	if (at < 0) return [];
	const out = [];
	for (let i = at + 1; i < lines.length; i++) {
		if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i]) || /^\S/.test(lines[i])) break;
		out.push(lines[i]);
	}
	return out;
}

// The lines of the one step holding line `at`: from its "- " line to the next line at or left of that indent.
function stepOf(lines, at) {
	let start = at;
	while (start > 0 && !/^\s*- /.test(lines[start])) start--;
	const indent = lines[start].search(/\S/);
	const out = [];
	for (let i = start; i < lines.length; i++) {
		if (i > start && lines[i].trim() && lines[i].search(/\S/) <= indent) break;
		out.push(lines[i]);
	}
	return out;
}

// The lines of the one step whose name says budget, from its name line to the next step at the same indent.
function budgetStep(lines) {
	const at = lines.findIndex((l) => /^\s*- name:.*budget/i.test(l));
	if (at < 0) return [];
	return stepOf(lines, at);
}

// Runs the report from a temp project that holds the template as its one workflow.
function shapeOf(templateFile) {
	const dir = kitTemp.makeTemp('ci-shape-');
	try {
		fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
		fs.copyFileSync(templateFile, path.join(dir, '.github', 'workflows', 'ci.yml'));
		return spawnSync(process.execPath, [path.join(REPO, 'project', '.claude', 'ci-shape.mjs')], { cwd: dir, encoding: 'utf8' });
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

// why: doc claim: each project CI template has a plan job, a sized fast matrix and a budget step, and ci-shape shows 0 gaps (CI-D S1)
test('each template has a plan job, a sized fast matrix and a budget step in ci, and ci-shape shows 0 gaps', () => {
	for (const { name, file } of TEMPLATES) {
		const lines = codeLines(file);
		const plan = jobLines(lines, 'plan');
		const runAt = plan.findIndex((l) => /^\s*(- )?run:.*node \.claude\/ci-plan\.mjs/.test(l));
		assert.ok(runAt >= 0, `${name}: plan job has a run: line that runs node .claude/ci-plan.mjs`);
		const shardsOut = plan.map((l) => /^\s+shards:\s*\$\{\{\s*steps\.([\w-]+)\.outputs\.shards\s*\}\}/.exec(l)).find(Boolean);
		assert.ok(shardsOut, `${name}: plan job exposes outputs.shards from a step`);
		const planStepId = shardsOut[1];
		assert.ok(
			stepOf(plan, runAt).some((l) => new RegExp(`^\\s*(- )?id:\\s*${planStepId}\\s*$`).test(l)),
			`${name}: the ci-plan.mjs step carries id: ${planStepId}, the step the shards output reads`,
		);
		const fast = jobLines(lines, 'fast');
		assert.ok(
			fast.some((l) => /^\s+needs:\s*(plan\b|\[.*\bplan\b.*\])/.test(l)),
			`${name}: fast job needs plan`,
		);
		assert.ok(
			fast.some((l) => /^\s+matrix:\s*\$\{\{\s*fromJSON\(needs\.plan\.outputs\.shards\)\s*\}\}/.test(l)),
			`${name}: fast job matrix reads fromJSON(needs.plan.outputs.shards)`,
		);
		// 180 is seconds: on a run: line or a seconds field, never the step name and never timeout-minutes (180 minutes).
		const step = budgetStep(jobLines(lines, 'ci'));
		assert.ok(step.length > 0, `${name}: ci job holds a step whose name says budget`);
		const body = step.slice(1).filter((l) => !/timeout-minutes/.test(l));
		assert.ok(
			body.some((l) => /\b180\b/.test(l) && (/^\s*(- )?run:/.test(l) || /\bseconds?\b/i.test(l))),
			`${name}: the budget step carries 180 seconds on a run: line or a seconds field`,
		);
		// K401 (the owner's yes, 2026-11-23): a run over the budget is reported, never failed, so projects keep no per-run time gate.
		assert.ok(!body.some((l) => /\bexit [1-9]/.test(l)), `${name}: the budget step is report only, with no exit on a run over it`);
		const shape = shapeOf(file);
		assert.equal(shape.status, 0, `${name}: ci-shape exit ${shape.status} ${shape.stderr}`);
		assert.match(shape.stdout, /CI shape: 0 gap\(s\)/, `${name}: ci-shape reports gaps: ${shape.stdout}`);
	}
});

// why: guards rule:test-lanes (a fast lane with no budget set is judged against the default 3 minutes) (CI-D S2)
test('lane-state with no budget set judges against 3 minutes', () => {
	const dir = kitTemp.makeTemp('lane-state-');
	try {
		const runs = path.join(dir, 'runs.json');
		fs.writeFileSync(runs, JSON.stringify([{ minutes: 4 }, { minutes: 4 }, { minutes: 4 }]));
		const r = spawnSync(process.execPath, [path.join(REPO, 'project', '.claude', 'lane-state.mjs'), '--times', runs], { cwd: dir, encoding: 'utf8' });
		assert.match(r.stdout, /fast-lane budget 3 min/, r.stdout);
		assert.equal(r.status, 1, `three 4 minute runs are over a 3 minute budget: ${r.stdout}`);
		assert.match(r.stdout, /over-budget/, r.stdout);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

// why: doc claim: both testing.md copies say "default 3 minutes" and rules/testing.md stays at or under 14,000 bytes (CI-D S3)
test('both testing.md copies say "default 3 minutes" and rules/testing.md stays at or under 14,000 bytes', () => {
	const copies = [path.join(REPO, 'rules', 'testing.md'), path.join(REPO, 'project', '.claude', 'rules', 'testing.md')];
	for (const file of copies) {
		const text = fs.readFileSync(file, 'utf8');
		const label = path.relative(REPO, file);
		assert.ok(text.includes('default 3 minutes'), `${label} says "default 3 minutes"`);
		assert.doesNotMatch(text, /default 10 minutes/, `${label} no longer says "default 10 minutes"`);
	}
	const size = fs.statSync(path.join(REPO, 'rules', 'testing.md')).size;
	assert.ok(size <= 14000, `rules/testing.md is ${size} bytes, over the 14,000 cap`);
});
