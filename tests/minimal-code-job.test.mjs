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

// Backslash continuation lines joined, so a command split over lines is read as one line.
const joined = (text) => text.replace(/\\\n\s*/g, ' ');

// The job's needs as sorted names: flow form ([a, b], a trailing comment allowed), scalar form (needs: a), or block
// form (one "- name" line each). Quotes and trailing comments are dropped.
function needsOf(job) {
	const unquote = (s) => s.trim().replace(/^["']|["']$/g, '');
	const flow = job.match(/^    needs: \[([^\]]*)\]/m);
	if (flow) return flow[1].split(',').map(unquote).filter(Boolean).sort();
	const scalar = job.match(/^    needs: ([^[\n]+)$/m);
	if (scalar) return [unquote(scalar[1].replace(/\s#.*$/, ''))];
	const block = job.match(/^    needs:\n((?:      - .*\n?)+)/m);
	if (block) return block[1].split('\n').filter(Boolean).map((l) => unquote(l.replace(/^      - /, '').replace(/\s#.*$/, ''))).sort();
	return [];
}

// The download of the merged map: the step that gets the test-map artifact from the PR base's own map run.
const isDownload = (s) => /--name test-map --dir tests/.test(s);

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
	const dl = steps(job).find(isDownload) || '';
	assert.ok(dl, 'the job does not download the test-map artifact with --name test-map --dir tests');
	assert.match(dl, /gh run download/, 'the download is not a gh run download');
	assert.match(dl, /--commit/, 'the download does not look up a run by commit');
	assert.match(dl, /github\.event\.pull_request\.base\.sha/, 'the download does not name the PR base sha');
	assert.doesNotMatch(job, /github\.run_id/, 'the download names the current run, not the base run');
	assert.doesNotMatch(joined(job), /test-run\.mjs[^\n]*--map\b/, 'the job still builds its own coverage map');
});

// why: catches the job runs flip-plan with --budget 150 and timeout-minutes 4 (CI-B S3)
test('the job runs flip-plan with --budget 150 and timeout-minutes 4', () => {
	const job = jobs(CI)['minimal-code'] || '';
	assert.match(job, /^    if: github\.event_name == 'pull_request'$/m, 'the job no longer runs only on pull requests');
	const steplist = steps(job).map(joined);
	const flip = steplist.findIndex((s) => /node scripts\/flip-plan\.mjs/.test(s));
	assert.ok(flip >= 0, 'the job does not run scripts/flip-plan.mjs');
	assert.match(steplist[flip], /node scripts\/flip-plan\.mjs[^\n]*--budget 150( |$)/m, 'the job does not run flip-plan with --budget 150');
	const dl = steps(job).findIndex(isDownload);
	assert.ok(dl >= 0 && dl < flip, 'flip-plan does not run after the map download');
	assert.match(job, /^    timeout-minutes: 4$/m, 'the job time limit is not timeout-minutes 4');
});
