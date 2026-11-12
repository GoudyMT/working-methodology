// The pin check (E31, rule:test-value): a test pins a whole sentence (8 or more words in one regex or string) only
// when the words are the behaviour, and says which of the four cases with "pin: <n>" on its line or the two above.
// 175 of 527 tests pinned whole sentences before 1.24.0; a rewording turned them red with nothing broken.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const WORDS = 8;
// A sentence is one unbroken run of words: tokens joined by a wildcard (.*, [\s\S]*) are separate checks, not one.
const words = (s) => Math.max(0, ...s.replace(/\$\{[^}]*\}/g, '').split(/\.[*+]\??|\[[^\]]*\][*+]\??/).map((run) => (run.replace(/\\[sSdDwWbB]/g, ' ').match(/[A-Za-z][A-Za-z'-]+/g) || []).length));

// The whole-sentence literals asserted on one line: a regex or string in assert.match / doesNotMatch, an includes(),
// or the expected side of assert.equal.
// Where the first argument of a call opened at `at` ends: the first comma outside brackets and quotes (the 1.24.0
// sweep: a first argument holding a comma, fn(a, b), hid the pin after it).
function afterFirst(line, at) {
	let depth = 0;
	for (let i = at; i < line.length; i++) {
		const c = line[i];
		if (c === '\'' || c === '"' || c === '`') { const q = c; for (i++; i < line.length && line[i] !== q; i++) if (line[i] === '\\') i++; continue; }
		if ('([{'.includes(c)) depth++;
		else if (')]}'.includes(c)) { if (depth === 0) return -1; depth--; }
		else if (c === ',' && depth === 0) return i + 1;
	}
	return -1;
}

function sentences(line) {
	const found = [];
	for (const a of line.matchAll(/assert\.(match|doesNotMatch|equal|strictEqual)\(/g)) {
		const rest = afterFirst(line, a.index + a[0].length);
		if (rest < 0) continue;
		const second = line.slice(rest).trimStart();
		const m = /^(match|doesNotMatch)$/.test(a[1]) ? /^\/((?:\\.|\[(?:\\.|[^\]])*\]|[^/\\[])+)\//.exec(second) : /^(['"`])((?:\\.|(?!\1).)*)\1/.exec(second);
		if (m) found.push(m[m.length - 1]);
	}
	if (/assert/.test(line)) for (const a of line.matchAll(/\.includes\((['"`])((?:\\.|(?!\1).)*)\1\)/g)) found.push(a[2]);
	return found.filter((s) => words(s) >= WORDS);
}

export function unmarked(text) {
	const lines = text.split('\n');
	const out = [];
	lines.forEach((l, i) => {
		if (!sentences(l).length) return;
		if ([l, lines[i - 1] || '', lines[i - 2] || ''].some((x) => /\bpin: [1-4]\b/.test(x))) return;
		out.push(i + 1);
	});
	return out;
}

// why: guards rule:word-pins
test('a test pins a whole sentence only with the case that makes the words the behaviour', () => {
	const dir = path.resolve('tests');
	const bad = [];
	for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.test.mjs') && x !== 'pin-check.test.mjs')) {
		for (const n of unmarked(fs.readFileSync(path.join(dir, f), 'utf8'))) bad.push(`tests/${f}:${n}`);
	}
	assert.deepEqual(bad, [], 'pin the stable tokens (an ID, a verdict, a path, a number, the command), or name the case: pin: 1 a machine reads it, 2 a stop\'s order, 3 frozen text, 4 owner-locked words');
});

// why: guards rule:word-pins
test('the pin check sees a whole-sentence regex, string or includes, and passes a short token or a named case', () => {
	const sentence = 'the quick brown fox jumps over the lazy dog again';
	assert.deepEqual(unmarked(`assert.match(out, /${sentence}/);`), [1]);
	assert.deepEqual(unmarked(`assert.equal(out, '${sentence}');`), [1]);
	assert.deepEqual(unmarked(`assert.ok(out.includes('${sentence}'));`), [1]);
	assert.deepEqual(unmarked('assert.match(out, /Install refused/);'), []);
	// The 1.24.0 sweep: a first argument with a comma in it, and a string that is an input to the actual side.
	assert.deepEqual(unmarked(`assert.match(run(a, b).stdout, /${sentence}/);`), [1]);
	assert.deepEqual(unmarked(`assert.equal(hook(x, '${sentence}'), '');`), []);
	assert.deepEqual(unmarked(`// pin: 2 (the stop's order)\nassert.match(out, /${sentence}/);`), []);
	assert.deepEqual(unmarked(`assert.match(out, /${sentence}/); // pin: 1 the hook reads it`), []);
	assert.deepEqual(unmarked(`// pin: 5\nassert.match(out, /${sentence}/);`), [2], 'only the four cases');
});
