// The owner's ruling (2026-11-17, "we have the standard, now we just need to enforce it"): every test in the kit names
// the real use or failure it guards in one why line of the kit's shape (rule:test-value), old tests as well as new.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tests, whyFault } from '../scripts/test-check.mjs';

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.test.mjs') ? [path.join(d, e.name)] : []));

// why: guards rule:test-value. A test with no why line, or one of no known shape, fails here by file and name.
test('every test in the kit carries a why line of the kit\'s shape, naming a rule in the rule index', () => {
	const known = new Set([...fs.readFileSync(path.resolve('project/standards/INDEX.md'), 'utf8').matchAll(/^\| ([a-z0-9-]+) \|/gm)].map((m) => m[1]));
	const faults = [];
	let n = 0;
	for (const f of walk(path.resolve('tests'))) {
		for (const [name, body] of tests(fs.readFileSync(f, 'utf8'))) {
			n++;
			const fault = whyFault(body, known);
			if (fault) faults.push(`${path.relative(path.resolve('.'), f).replace(/\\/g, '/')}::${name}: ${fault}`);
		}
	}
	assert.ok(n > 800, `read ${n} tests`);
	assert.deepEqual(faults, []);
});

// why: catches a format check that passes a bare tag: a why line that names no failure, or a rule the kit lacks.
test('the why line check takes the three shapes and names every other', () => {
	const known = new Set(['test-value']);
	assert.equal(whyFault('// why: guards rule:test-value\ntest(', known), null);
	assert.equal(whyFault("// why: guards the owner's pick of one sweep\ntest(", known), null);
	assert.equal(whyFault('// why: catches a zero read as a positive number\ntest(', known), null);
	assert.match(whyFault("test('x', () => {});", known), /no why line/);
	assert.match(whyFault('// why: catches it\ntest(', known), /6 words/);
	assert.match(whyFault('// why: guards the lane\ntest(', known), /names no rule/);
	assert.match(whyFault('// why: guards rule:no-such-rule\ntest(', known), /rule:no-such-rule/);
	assert.match(whyFault('// why: keeps it safe\ntest(', known), /neither guards nor catches/);
});
