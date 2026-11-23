// The plan job: the lanes job sizes the unit, check and mutation matrices with scripts/ci-size.mjs and exposes them, and the
// jobs that run them read their matrix from it. A push to main builds the coverage map in slices and merges them. One
// fixed-name job stands for every test-check slice, whatever the slice count, so the required check always reports.
// ci.yml is read by its lines, as ci-workflows.test.mjs reads it (no YAML dependency), and is never changed here.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Comment lines are dropped first, so a commented-out step or job name can never satisfy a check.
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

// The job's text before the named step, or null when the job has no such step.
function before(job, name) {
	const at = job.indexOf('      - name: ' + name + '\n');
	return at < 0 ? null : job.slice(0, at);
}

// The job's needs as sorted names, in flow form ([a, b]) or block form (one "- name" line each), quotes dropped.
function needsOf(job) {
	const unquote = (s) => s.trim().replace(/^["']|["']$/g, '');
	const flow = job.match(/^    needs: \[(.*)\]$/m);
	if (flow) return flow[1].split(',').map(unquote).sort();
	const block = job.match(/^    needs:\n((?:      - .*\n?)+)/m);
	if (block) return block[1].split('\n').filter(Boolean).map((l) => unquote(l.replace(/^      - /, ''))).sort();
	return [];
}

// The job-level if as its && parts, sorted; a || stays one part, so it never matches.
function ifOf(job) {
	const m = job.match(/^    if: (.*)$/m);
	return m ? m[1].split('&&').map((s) => s.trim()).sort() : [];
}

// A step's first line, named for the allowed pre-judge steps; any other head stays as written.
function tokenOf(block) {
	const head = block.split('\n')[0];
	if (head === 'name: Prepare git identity') return 'git identity';
	if (head === "name: The base commit's scripts") return 'base unpack';
	if (/^uses: actions\/checkout@/.test(head)) return 'checkout';
	if (/^uses: actions\/setup-node@/.test(head)) return 'setup-node';
	return head;
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
	const WANT = [['checkout', 'setup-node', 'git identity'], ['checkout', 'setup-node', 'git identity', 'base unpack']];
	for (const [job, key, judge] of [['unit-tests', 'unit', 'Spawn check'], ['test-check', 'check', 'Test check']]) {
		const text = J[job] || '';
		assert.ok(needsOf(text).includes('lanes'), job + ' does not need the lanes job');
		assert.match(text, new RegExp('^    strategy:\\n      matrix: \\$\\{\\{ fromJSON\\(needs\\.lanes\\.outputs\\.' + key + '\\) \\}\\}\\n', 'm'), job + ' does not take its matrix from needs.lanes.outputs.' + key + ' directly under strategy');
		assert.doesNotMatch(text, /^\s+(slice|shard): \[/m, job + ' still holds a literal matrix list');
		const pre = before(text, judge);
		assert.ok(pre !== null, job + ' has no ' + judge + ' step');
		const tokens = steps(pre).map(tokenOf);
		assert.ok(WANT.some((w) => w.length === tokens.length && w.every((t, i) => t === tokens[i])), job + ' steps before ' + judge + ': ' + JSON.stringify(tokens));
	}
});

// why: catches main push builds the map in slices and a map-merge job uploads tests/.map.json (CI-A S3)
test('main push builds the map in slices and a map-merge job uploads tests/.map.json', () => {
	const J = jobs(CI);
	const slicer = Object.keys(J).find((k) => /test-run\.mjs --map --slice/.test(J[k]));
	assert.ok(slicer, 'no job runs test-run.mjs --map --slice');
	const sliceStep = steps(J[slicer]).find((s) => /test-run\.mjs --map --slice/.test(s)) || '';
	assert.match(sliceStep, /^        if: .*github\.event_name (!= 'pull_request'|== 'push')/m, 'the sliced map step is not gated to a push to main');
	assert.doesNotMatch(CI, /test-run\.mjs --map --shards/, 'a step still builds the whole map with test-run.mjs --map --shards');
	const merger = Object.keys(J).find((k) => /map-merge\.mjs/.test(J[k]));
	assert.ok(merger, 'no job runs scripts/map-merge.mjs');
	assert.ok(needsOf(J[merger]).includes(slicer), 'the map-merge job does not wait for the ' + slicer + ' job');
	const upload = steps(J[merger]).find((s) => /uses: actions\/upload-artifact@/.test(s)) || '';
	assert.match(upload, /^          name: test-map$/m, 'the map-merge upload is not named test-map');
	assert.match(upload, /^          path: tests\/\.map\.json$/m, 'the map-merge job does not upload tests/.map.json');
	const uploads = Object.keys(J).flatMap((k) => steps(J[k])).filter((s) => /uses: actions\/upload-artifact@/.test(s) && /^          name: test-map$/m.test(s));
	assert.equal(uploads.length, 1, 'exactly one step uploads test-map, found ' + uploads.length);
	assert.equal(uploads[0], upload, 'the one test-map upload is not the map-merge job\'s');
});

// why: catches a fixed-name job "test-check (all)" needs the sized test-check matrix and fails unless every slice passed, so the required check reports for any slice count (CI-A S4)
test('a fixed-name job "test-check (all)" needs the sized test-check matrix and fails unless every slice passed, so the required check reports for any slice count', () => {
	const all = jobs(CI)['test-check-all'] || '';
	assert.match(all, /^    name: ["']?test-check \(all\)["']?$/m, 'the job test-check-all is not named test-check (all)');
	assert.deepEqual(needsOf(all), ['lanes', 'test-check'], 'test-check (all) does not need lanes and test-check');
	assert.deepEqual(ifOf(all), ['always()', "github.event_name == 'pull_request'"], 'test-check (all) is not always() && pull_request');
	assert.doesNotMatch(all, /continue-on-error/, 'test-check (all) can pass a failed slice with continue-on-error');
	const gate = steps(all).find((s) => /^        if: .*needs\.test-check\.result != 'success'/m.test(s)) || '';
	assert.ok(gate, 'no step fails unless needs.test-check.result is success');
	assert.doesNotMatch(gate.match(/^        if: (.*)$/m)[1], /skipped|cancelled/, 'the failing step passes a skipped or cancelled test-check');
	assert.match(gate, /^        run: exit 1$/m, 'the failing step does not exit 1');
});
