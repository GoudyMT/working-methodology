// A lead's guard ruling carries its proof. Each test drives handoff.mjs check on a RECORD written to stdin, as the lead
// runs it (`handoff.mjs check - --role tester`), so the test reads the same output the lead reads. Nothing here calls a model.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HANDOFF = fileURLToPath(new URL('../user/kit-tools/handoff.mjs', import.meta.url));

// A hand-back as the lead saves it: prose, RECORD:, the role line, then the note lines.
const record = (...notes) => ['Prose.', 'RECORD:', JSON.stringify({ role: 'tester', agent: 'agent-test', unit: 'U15', commit: 'f239215', clarity: 'clear' }), ...notes].join('\n') + '\n';
// A lead note line; the proof key is given only when the test passes one.
const note = (text, proof) => JSON.stringify({ note: text, writer: 'lead', ...(proof === undefined ? {} : { proof }) });

// Runs handoff.mjs check on the text from stdin, as `handoff.mjs check - --role tester`.
function checkRun(text) {
	assert.ok(fs.existsSync(HANDOFF), 'user/kit-tools/handoff.mjs is missing');
	const r = spawnSync(process.execPath, [HANDOFF, 'check', '-', '--role', 'tester'], { input: text, encoding: 'utf8' });
	const out = `${r.stdout}${r.stderr}`;
	assert.ok(!/node:internal|MODULE_NOT_FOUND|SyntaxError/.test(out), `handoff.mjs ran without crashing: ${out}`);
	return { status: r.status, out, err: r.stderr };
}

// why: catches a note "lead ruling: ..." with no proof key fails check with "missing `proof`" (K363 S1)
test('a note "lead ruling: ..." with no proof key fails check with "missing `proof`"', () => {
	const plain = checkRun(record(note('lead answer: use the stored sha, not the branch name')));
	assert.equal(plain.status, 0, plain.out);
	const res = checkRun(record(note('lead ruling: the guard refuses a force push in any spelling')));
	assert.equal(res.status, 1, res.out);
	assert.match(res.err, /missing `proof`/);
});

// why: catches the same note with a proof naming a test or a probe passes (K363 S2)
test('the same note with a proof naming a test or a probe passes', () => {
	const byTest = checkRun(record(note('lead ruling: the guard refuses a force push in any spelling', 'tests/guard.test.mjs: the force-push case is refused')));
	assert.equal(byTest.status, 0, byTest.out);
	const byProbe = checkRun(record(note('lead ruling: the guard refuses a force push in any spelling', 'probe: node user/kit-tools/handoff.mjs check on the saved record, exit 0')));
	assert.equal(byProbe.status, 0, byProbe.out);
});
