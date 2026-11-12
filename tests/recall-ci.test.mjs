// T15 D6 (the owner's locks, 2026-11-12): the recall test may run in CI only as the owner's act, from main, through
// federation with no stored key, and only once the owner has set it up.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// why: guards rule:outward-acts and rule:security-standards: a run spends model tokens, so only the owner starts it;
// a branch cannot edit its way to a token; no key sits in the repo. pin: 1 (GitHub reads these lines)
test('the CI recall job runs only by hand from main, through federation with no stored key', () => {
	const wf = fs.readFileSync(path.resolve('.github/workflows/recall.yml'), 'utf8');
	const on = wf.split('\non:')[1].split('\npermissions:')[0];
	assert.match(on, /^\s+workflow_dispatch:/m);
	assert.doesNotMatch(on, /pull_request|push:|schedule:|workflow_run/, 'a trigger the owner does not press');
	assert.equal((wf.match(/^ {4}if: github\.ref == 'refs\/heads\/main' && vars\.ANTHROPIC_FEDERATION_RULE_ID != ''$/gm) || []).length, 3); // pin: 1
	// The token permission sits on the job alone; the workflow default stays read-only.
	assert.match(wf.split('\njobs:')[0], /permissions:\n {2}contents: read\n/);
	assert.equal((wf.match(/id-token: write/g) || []).length, 3);
	assert.doesNotMatch(wf, /secrets\.|ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN/, 'a stored key');
	// Claude Code is pinned, and a branch's name reaches the shell only through env, never into the script text.
	assert.match(wf, /@anthropic-ai\/claude-code@\d+\.\d+\.\d+\b/);
	// With install scripts off, the package's bin is a stub that only errors (the 1.27.0 sweep, high): its own
	// installer places the binary, and the job proves the CLI runs before any recall run.
	assert.match(wf, /--ignore-scripts @anthropic-ai\/claude-code@[\d.]+\n\s+node "\$\(npm root -g\)\/@anthropic-ai\/claude-code\/install\.cjs"\n\s+claude --version/); // pin: 1
	for (const run of wf.split(/\n\s+run: \|/).slice(1)) assert.doesNotMatch(run.split(/\n\s+- /)[0], /\$\{\{/, 'an expression inside a run script');
	// Only a plain branch of this repo is measured, and the token folder is never uploaded nor in the scorer's reach.
	assert.match(wf, /ref: refs\/heads\/\$\{\{ inputs\.ref \}\}/);
	assert.match(wf, /\$MEASURE_REF" =~ \^\[A-Za-z0-9\]/);
	assert.match(wf.split('- name: Keep the runs')[1], /path: \$\{\{ runner\.temp \}\}\/recall\n/);
	// The scorer's desk is readable; the sealed map, the raw runs and the token are not (a blanket deny beat the allow).
	assert.doesNotMatch(wf, /Read\(\/\/\*\*\)/);
	assert.ok(wf.includes('"$desk" "$out" "$GITHUB_WORKSPACE" "$RUNNER_TEMP/oidc"'), 'the scorer may read the map, the runs or the token');
	// The harness, keys and brief that judge are main's; the candidate is only data.
	assert.match(wf, /node base\/scripts\/recall\.mjs "cand-\$i" cand/);
	assert.match(wf, /node base\/scripts\/recall-score\.mjs score/);
});

// why: guards rule:security-standards. K7, the 1.27.0 sweep: the candidate branch's code ran in the job that held the
// token, the baseline runs and the scorer, so it could reach what judges it. Now each is its own machine.
test('the CI recall job runs the candidate, the baseline and the scorer on three machines', () => {
	const wf = fs.readFileSync(path.resolve('.github/workflows/recall.yml'), 'utf8');
	const job = (name) => wf.split(`\n  ${name}:\n`)[1].split(/\n  [a-z]+:\n/)[0];
	const cand = job('candidate');
	const base = job('baseline');
	const score = job('score');
	assert.match(cand, /recall\.mjs "cand-\$i" cand/);
	assert.doesNotMatch(cand, /base-\$i|control-1|recall-score|sealed-map/, 'the candidate job holds what judges it');
	assert.doesNotMatch(base, /path: cand|recall\.mjs "cand-/, 'the baseline job runs the candidate');
	assert.doesNotMatch(score, /path: cand|recall\.mjs "/, 'the scorer runs a session of the candidate');
	assert.match(score, /needs: \[candidate, baseline\]/);
	assert.match(score, /recall-score\.mjs blind/);
});
