// CI-D (patch 1.51.1): the project CI templates size their own shards, lane-state judges against 3 minutes, and the
// rule text says so. Templates are read line by line (no YAML library), as the kit's other CI tests read them.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES = ['ci-node.yml', 'ci-python.yml'].map((f) => ({ name: f, file: path.join(REPO, 'project', '_Templates', f) }));

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

// The lines of the one step whose name says budget, from its name line to the next step at the same indent.
function budgetStep(lines) {
	const at = lines.findIndex((l) => /^\s*- name:.*budget/i.test(l));
	if (at < 0) return [];
	const indent = lines[at].search(/\S/);
	const out = [lines[at]];
	for (let i = at + 1; i < lines.length; i++) {
		const l = lines[i];
		if (l.trim() && l.search(/\S/) < indent) break;
		if (l.search(/\S/) === indent && /^\s*- /.test(l)) break;
		out.push(l);
	}
	return out;
}

// Runs the report from a temp project that holds the template as its one workflow.
function shapeOf(templateFile) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-shape-'));
	try {
		fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
		fs.copyFileSync(templateFile, path.join(dir, '.github', 'workflows', 'ci.yml'));
		return spawnSync(process.execPath, [path.join(REPO, 'project', '.claude', 'ci-shape.mjs')], { cwd: dir, encoding: 'utf8' });
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

// why: catches each template has a plan job, a sized fast matrix and a budget step in ci, and ci-shape shows 0 gaps (CI-D S1)
test('each template has a plan job, a sized fast matrix and a budget step in ci, and ci-shape shows 0 gaps', () => {
	for (const { name, file } of TEMPLATES) {
		const lines = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n');
		const plan = jobLines(lines, 'plan');
		assert.ok(plan.some((l) => /node \.claude\/ci-plan\.mjs/.test(l)), `${name}: plan job runs node .claude/ci-plan.mjs`);
		assert.ok(
			plan.some((l) => /^\s+shards:\s*\$\{\{\s*steps\.[\w-]+\.outputs\.shards\s*\}\}/.test(l)),
			`${name}: plan job exposes outputs.shards`,
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
		const step = budgetStep(jobLines(lines, 'ci'));
		assert.ok(step.length > 0, `${name}: ci job holds a step whose name says budget`);
		assert.ok(step.some((l) => /\b180\b/.test(l)), `${name}: the budget step carries 180 in its run or timeout`);
		const shape = shapeOf(file);
		assert.equal(shape.status, 0, `${name}: ci-shape exit ${shape.status} ${shape.stderr}`);
		assert.match(shape.stdout, /CI shape: 0 gap\(s\)/, `${name}: ci-shape reports gaps: ${shape.stdout}`);
	}
});

// why: catches lane-state with no budget set judges against 3 minutes (CI-D S2)
test('lane-state with no budget set judges against 3 minutes', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-state-'));
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

// why: catches both testing.md copies say "default 3 minutes" and rules/testing.md stays at or under 14,000 bytes (CI-D S3)
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
