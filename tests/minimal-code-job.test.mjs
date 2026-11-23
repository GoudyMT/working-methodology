// The minimal-code job: it sets the git identity and tags as the unit job does, needs the unit job and downloads the
// merged coverage map rather than building one, and runs flip-plan with its budget and its own time limit.
// ci.yml is read by its lines, as ci-workflows.test.mjs reads it (no YAML dependency), and is never changed here.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Comment lines are dropped first, so a commented-out line can never satisfy a check.
const CI = fs.readFileSync(path.resolve('.github/workflows/ci.yml'), 'utf8')
	.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

// Each job's text, by its "  <name>:" line under jobs:, up to the next job. A job the file lacks is absent from the result.
function jobs(text) {
	const parts = text.slice(text.search(/^jobs:$/m)).split(/^  ([a-z0-9_-]+):$/m);
	const out = {};
	for (let i = 1; i < parts.length; i += 2) out[parts[i]] = parts[i + 1];
	return out;
}

// A job's steps, each from its "- " line to the next step.
const steps = (job) => job.split(/^      - /m).slice(1);

// The job's needs as sorted names, in flow form ([a, b]) or block form (one "- name" line each), quotes dropped.
function needsOf(job) {
	const unquote = (s) => s.trim().replace(/^["']|["']$/g, '');
	const flow = job.match(/^    needs: \[(.*)\]$/m);
	if (flow) return flow[1].split(',').map(unquote).sort();
	const block = job.match(/^    needs:\n((?:      - .*\n?)+)/m);
	if (block) return block[1].split('\n').filter(Boolean).map((l) => unquote(l.replace(/^      - /, ''))).sort();
	return [];
}

// why: catches the job sets git identity and init.defaultBranch, and fetches tags (CI-B S1)
test('the job sets git identity and init.defaultBranch, and fetches tags', () => {
	const job = jobs(CI)['minimal-code'] || '';
	assert.match(job, /git config --global user\.name /, 'the job sets no git user.name');
	assert.match(job, /git config --global user\.email /, 'the job sets no git user.email');
	assert.match(job, /git config --global init\.defaultBranch main/, 'the job sets no init.defaultBranch');
	assert.match(job, /^\s+fetch-tags: true$/m, 'the job does not fetch tags');
});

// why: catches the job needs unit-tests and downloads the merged map instead of building one (CI-B S2)
test('the job needs unit-tests and downloads the merged map instead of building one', () => {
	const job = jobs(CI)['minimal-code'] || '';
	assert.ok(needsOf(job).includes('unit-tests'), 'the job does not need unit-tests');
	const downloads = steps(job).some((s) => /download-artifact@|gh run download/.test(s) && /^\s+name: test-map$|--name test-map( |$)/m.test(s));
	assert.ok(downloads, 'the job does not download the test-map artifact');
	assert.doesNotMatch(job, /test-run\.mjs --map/, 'the job still builds its own coverage map');
});

// why: catches the job runs flip-plan with --budget 150 and timeout-minutes 4 (CI-B S3)
test('the job runs flip-plan with --budget 150 and timeout-minutes 4', () => {
	const job = jobs(CI)['minimal-code'] || '';
	assert.match(job, /node scripts\/flip-plan\.mjs[^\n]*--budget 150( |$)/m, 'the job does not run flip-plan with --budget 150');
	assert.match(job, /^    timeout-minutes: 4$/m, 'the job time limit is not timeout-minutes 4');
});
