// The kit's own CI workflows, read as GitHub reads them. pin: 1 (GitHub runs these lines)
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (f) => fs.readFileSync(path.resolve(f), 'utf8');
// A job's text: from its "  <name>:" line to the next job.
const job = (text, name) => text.split(new RegExp(`^  ${name}:$`, 'm'))[1].split(/^  [a-z-]+:$/m)[0];
// A step's text: from its name to the next step.
const step = (text, name) => text.split(`- name: ${name}\n`)[1].split(/\n\s+- (?:name|uses):/)[0];

// K128 (build 17): a PR could change the script that judges it, since every gate but the recall gate ran from the PR's
// own tree. Each judging step now runs the base commit's copy, unpacked before it in the same job, and says so when the
// base has none.
// why: guards rule:outward-acts (a PR that rewrites its own gate merges unchecked)
test('every step that judges a PR runs the base commit\'s copy of its script', () => {
	const ci = read('.github/workflows/ci.yml');
	const body = read('.github/workflows/pr-body.yml');
	const judged = [
		[job(ci, 'test-check'), 'Test check', 'scripts/test-check.mjs'],
		[job(ci, 'windows-tests'), 'Test check, Windows part', 'scripts/test-check.mjs'],
		[job(ci, 'kit-tests'), 'Branch and commit names', 'project/.claude/name-check.mjs'],
		[job(ci, 'kit-tests'), 'Secret scan', 'project/.claude/secret-shapes.mjs'],
		[job(body, 'pr-body'), 'PR body audit', 'project/.claude/$A'],
		[job(body, 'pr-body'), 'The fix lines match the build record', 'scripts/build-record.mjs'],
	];
	for (const [text, name, script] of judged) {
		const unpack = text.indexOf("- name: The base commit's scripts\n");
		assert.ok(unpack >= 0 && unpack < text.indexOf(`- name: ${name}\n`), `${name}: no base unpacked before it`);
		assert.match(step(text, "The base commit's scripts"), /git archive "\$BASE_SHA" scripts project tests \| tar -x -C "\$RUNNER_TEMP\/base"/);
		assert.match(step(text, "The base commit's scripts"), /BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
		const run = step(text, name);
		const base = script.startsWith('scripts/test-check') ? '"$G/scripts/test-check.mjs"' : `$RUNNER_TEMP/base/${script}`;
		assert.ok(run.includes(base), `${name} does not run the base copy (${base})`);
		assert.ok(run.includes(`the base has no `), `${name} does not say when the base has no copy`);
		// The PR's own copy runs only in that fallback.
		const direct = run.split('\n').filter((l) => /^\s*node (scripts|project)\//.test(l));
		assert.deepEqual(direct, [], `${name} runs the PR's copy directly`);
	}
});
