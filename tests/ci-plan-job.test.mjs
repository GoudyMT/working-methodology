// The plan job: the lanes job sizes the unit, check and mutation matrices with scripts/ci-size.mjs and exposes them, and the
// jobs that run them read their matrix from it. A push to main builds the coverage map in slices and merges them. One
// fixed-name job stands for every test-check slice, whatever the slice count, so the required check always reports.
// ci.yml is read by its lines, as ci-workflows.test.mjs reads it (no YAML dependency), and is never changed here.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const CI = fs.readFileSync(path.resolve('.github/workflows/ci.yml'), 'utf8');

// Each job's text, by its "  <name>:" line under jobs:, up to the next job. A job the file lacks is absent from the result.
function jobs(text) {
	const parts = text.slice(text.search(/^jobs:$/m)).split(/^  ([a-z][a-z-]*):$/m);
	const out = {};
	for (let i = 1; i < parts.length; i += 2) out[parts[i]] = parts[i + 1];
	return out;
}

// A job's steps, each from its "- " line to the next step.
const steps = (job) => job.split(/^      - /m).slice(1);

// The job's text before the named step, or null when the job has no such step.
function before(job, name) {
	const at = job.indexOf('      - name: ' + name + '\n');
	return at < 0 ? null : job.slice(0, at);
}

// why: catches lanes job runs ci-size.mjs and exposes the matrices as outputs (CI-A S1)
test('lanes job runs ci-size.mjs and exposes the matrices as outputs', () => {
	const lanes = jobs(CI).lanes || '';
	assert.match(lanes, /\bnode scripts\/ci-size\.mjs\b/, 'the lanes job does not run scripts/ci-size.mjs');
	for (const key of ['unit', 'check', 'mutation']) {
		assert.match(lanes, new RegExp('^\\s+' + key + ': \\$\\{\\{ steps\\.[\\w-]+\\.outputs\\.' + key + ' \\}\\}$', 'm'), 'the lanes job does not expose the ' + key + ' matrix as an output');
	}
});

// why: catches unit-tests and test-check read their matrix from needs.lanes.outputs, with no new step before the judges (CI-A S2)
test('unit-tests and test-check read their matrix from needs.lanes.outputs, with no new step before the judges', () => {
	const J = jobs(CI);
	const SAFE = ['Prepare git identity', "The base commit's scripts"];
	for (const [job, key, judge] of [['unit-tests', 'unit', 'Spawn check'], ['test-check', 'check', 'Test check']]) {
		const text = J[job] || '';
		assert.match(text, /^    needs: .*\blanes\b/m, job + ' does not need the lanes job');
		assert.match(text, new RegExp('^\\s+matrix: \\$\\{\\{ fromJSON\\(needs\\.lanes\\.outputs\\.' + key + '\\) \\}\\}$', 'm'), job + ' does not take its matrix from needs.lanes.outputs.' + key);
		const pre = before(text, judge);
		assert.ok(pre !== null, job + ' has no ' + judge + ' step');
		for (const [, kind, what] of pre.matchAll(/^      - (name|uses): (.+)$/gm)) {
			if (kind === 'uses') assert.match(what, /^actions\/(checkout|setup-node)@/, job + ' runs ' + what + ' before ' + judge);
			else assert.ok(SAFE.includes(what), job + ' runs the step "' + what + '" before ' + judge);
		}
	}
});

// why: catches main push builds the map in slices and a map-merge job uploads tests/.map.json (CI-A S3)
test('main push builds the map in slices and a map-merge job uploads tests/.map.json', () => {
	const J = jobs(CI);
	const slicer = Object.keys(J).find((k) => /test-run\.mjs --map --slice/.test(J[k]));
	assert.ok(slicer, 'no job runs test-run.mjs --map --slice');
	const sliceStep = steps(J[slicer]).find((s) => /test-run\.mjs --map --slice/.test(s)) || '';
	assert.match(sliceStep, /^        if: .*github\.event_name (!= 'pull_request'|== 'push')/m, 'the sliced map step is not gated to a push to main');
	const merger = Object.keys(J).find((k) => /map-merge\.mjs/.test(J[k]));
	assert.ok(merger, 'no job runs scripts/map-merge.mjs');
	const needs = (J[merger].match(/^    needs: (.*)$/m) || [, ''])[1];
	assert.ok(needs.includes(slicer), 'the map-merge job does not wait for the ' + slicer + ' job');
	assert.match(J[merger], /uses: actions\/upload-artifact@/, 'the map-merge job does not upload an artifact');
	assert.match(J[merger], /^\s+path: tests\/\.map\.json$/m, 'the map-merge job does not upload tests/.map.json');
});

// why: catches a fixed-name job "test-check (all)" needs the sized test-check matrix and fails unless every slice passed, so the required check reports for any slice count (CI-A S4)
test('a fixed-name job "test-check (all)" needs the sized test-check matrix and fails unless every slice passed, so the required check reports for any slice count', () => {
	const all = jobs(CI)['test-check-all'] || '';
	assert.match(all, /^    name: test-check \(all\)$/m, 'the job test-check-all is not named test-check (all)');
	const needs = (all.match(/^    needs: \[(.*)\]$/m) || [, ''])[1].split(',').map((s) => s.trim()).sort();
	assert.deepEqual(needs, ['lanes', 'test-check'], 'test-check (all) does not need lanes and test-check');
	const jobIf = (all.match(/^    if: (.*)$/m) || [, ''])[1];
	assert.match(jobIf, /always\(\)/, 'test-check (all) is not if: always()');
	assert.match(jobIf, /github\.event_name == 'pull_request'/, 'test-check (all) does not run on pull requests');
	assert.match(all, /^\s+if: .*needs\.test-check\.result != 'success'/m, 'test-check (all) does not test needs.test-check.result');
	assert.match(all, /\bexit 1\b/, 'test-check (all) never fails');
});
