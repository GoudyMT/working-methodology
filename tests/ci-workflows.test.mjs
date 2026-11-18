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
// The build 17 sweep: PR code that ran before the unpack could plant a replace ref, so git archive handed back the PR's
// own blob as the base's (or swap the unpacked copy, or the tools on the path); the build record still ran the PR's copy;
// and a check that only looked for the base path anywhere in the step passed a step that named it in a message. Each
// judging step now comes before any step that runs the PR's code, the unpack ignores replace refs, and every node line
// in it runs a copy set from the base.
// why: guards rule:outward-acts (a PR that rewrites its own gate merges unchecked)
test('every step that judges a PR runs the base commit\'s copy of its script, before any of the PR\'s code runs', () => {
	const ci = read('.github/workflows/ci.yml');
	const body = read('.github/workflows/pr-body.yml');
	const judged = [
		[job(ci, 'test-check'), 'Test check'],
		[job(ci, 'windows-tests'), 'Test check, Windows part'],
		[job(ci, 'kit-tests'), 'Branch and commit names'],
		[job(ci, 'kit-tests'), 'Secret scan'],
		[job(ci, 'kit-tests'), 'Build record'],
		[job(body, 'pr-body'), 'PR body audit'],
		[job(body, 'pr-body'), 'The fix lines match the build record'],
	];
	// What may run before a judge: the checkout, node, git settings, a step that only fails the job, the unpack, a judge.
	const safe = new Set(['Prepare git identity', 'Prepare the shell and git identity', 'Every test job passed', 'The install check passed or was not owed', "The base commit's scripts", ...judged.map(([, n]) => n)]);
	for (const [text, name] of judged) {
		const at = text.indexOf(`- name: ${name}\n`);
		const unpack = text.indexOf("- name: The base commit's scripts\n");
		assert.ok(unpack >= 0 && unpack < at, `${name}: no base unpacked before it`);
		const u = step(text, "The base commit's scripts");
		assert.match(u, /git archive "\$BASE_SHA" scripts project tests \| tar -x -C "\$RUNNER_TEMP\/base"/);
		assert.match(u, /BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
		assert.match(u, /GIT_NO_REPLACE_OBJECTS: '1'/, `${name}: the unpack reads replace refs`);
		for (const [, kind, what] of text.slice(0, at).matchAll(/^\s+- (name|uses|run): (.+)$/gm)) {
			if (kind === 'uses') assert.match(what, /^actions\/(checkout|setup-node)@/, `${name}: ${what} runs before it`);
			else if (kind === 'run') assert.match(what, /^git config /, `${name}: ${what} runs before it`);
			else assert.ok(safe.has(what), `${name}: the step "${what}" runs before it`);
		}
		const run = step(text, name);
		assert.ok(run.includes('the base has no '), `${name} does not say when the base has no copy`);
		// The audits read the project's settings and the canary phrase from PR_BASE (the build 17 sweep).
		if (name === 'PR body audit') assert.match(run, /PR_BASE: origin\/\$\{\{ github\.base_ref \}\}/);
		// Every node line runs a script named by a variable set from the base copy (the PR's copy only in the fallback),
		// or the base's pr-scope.mjs; node -e runs no file.
		const lines = run.split('\n').filter((l) => /\bnode\s/.test(l) && !/^\s*#/.test(l) && !/\bnode -e\b/.test(l));
		assert.ok(lines.length > 0, `${name} runs nothing`);
		for (const l of lines) {
			if (l.includes('node "$RUNNER_TEMP/pr-scope.mjs"')) { assert.match(run, /git show "\$PR_BASE:scripts\/pr-scope\.mjs" > "\$RUNNER_TEMP\/pr-scope\.mjs"/); continue; }
			const m = /\bnode\s+"\$(\w+)/.exec(l);
			assert.ok(m, `${name} runs a script by its own path: ${l.trim()}`);
			assert.match(run, new RegExp(`(^|[\\s;])${m[1]}="\\$RUNNER_TEMP/base[/"]`), `${name}: $${m[1]} is not set from the base copy`);
		}
	}
});
