// K367 (patch 1.51.4, U27): rule and skill text say a feature-branch push never asks, and a retest commit is never held
// at push. Each test reads the text and pins distinctive phrases, never a whole sentence. A missing file reads as empty
// text, so a test fails on an assertion, never a crash. Patterns tolerate line wraps ([\s\S]{0,N}).
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => {
	const f = path.join(KIT, ...p);
	return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
};
// The "A builder never edits a locked test" paragraph: from its first words to the next blank line.
const paragraph = (text) => {
	const i = text.indexOf('A builder never edits a locked test');
	if (i < 0) return '';
	const rest = text.slice(i);
	const end = rest.search(/\r?\n\s*\r?\n/);
	return end < 0 ? rest : rest.slice(0, end);
};

// why: catches an agent-teams rule or standard that still says a retest commit is held at push, or the two copies drifting (S1)
test('both agent-teams files say a retest commit is checked by test-integrity and listed for the merge yes, never held at push', () => {
	const files = {
		'rules/agent-teams.md': paragraph(read('rules', 'agent-teams.md')),
		'project/standards/agent-teams.md': paragraph(read('project', 'standards', 'agent-teams.md')),
	};
	const phrases = [
		['names the retest commit', /`?retest`? commit/i],
		['test-integrity checks it', /test-integrity/i],
		['it is listed for the merge yes', /listed[\s\S]{0,80}merge[\s\S]{0,20}yes/i],
		['it is never held at push', /(?:never|not)[\s\S]{0,20}held[\s\S]{0,10}at (?:the )?push/i],
		['a PR title is never retest', /PR title is never `?retest`?/i],
	];
	for (const [name, text] of Object.entries(files)) {
		assert.ok(text.length > 0, `${name} has the locked-test paragraph`);
		for (const [what, re] of phrases) assert.match(text, re, `${name}: ${what}`);
		assert.doesNotMatch(text, /until the owner'?s yes/i, `${name}: the push no longer waits for the owner's yes`);
	}
	// Agreement: the two paragraphs are the same words, whitespace aside.
	const [a, b] = Object.values(files).map((x) => x.replace(/\s+/g, ' ').trim());
	assert.equal(a, b, 'the two files carry the same paragraph');
});

// why: catches a skill that does not say a feature-branch push never asks, or drops main, tags, force and deletes from the owner's yes (S2)
test('SKILL.md says a feature-branch push never asks, and main, tags, force and deletes still need the owner pop-up or yes record', () => {
	const s = read('user', 'skills', 'agent-team-build', 'SKILL.md');
	const never = /(?:feature[- ]branch push|push(?:es)? to a? ?feature[- ]branch)[\s\S]{0,120}never (?:asks?|waits?)|never (?:asks?|waits?)[\s\S]{0,120}feature[- ]branch/i;
	const m = never.exec(s);
	assert.ok(m, 'a feature-branch push never asks');
	// The sentence that holds "never ask": from the full stop before it to the next full stop after it.
	const before = s.slice(0, m.index);
	const stops = [...before.matchAll(/[.!?]\s/g)];
	const start = stops.length ? stops[stops.length - 1].index + 1 : 0;
	const after = s.slice(m.index).search(/\.\s/);
	const w = s.slice(start, after < 0 ? s.length : m.index + after);
	assert.match(w, /\bmain\b[\s\S]{0,40}\btags?\b[\s\S]{0,40}\bforce\b[\s\S]{0,40}\bdeletes?\b/i, 'the same sentence names main, tags, force and deletes');
	assert.match(w, /(?:owner|user|Max)(?:'s)?[\s\S]{0,60}(?:pop-?up|yes)/i, 'the same sentence says those need the owner pop-up or yes');
	assert.match(w, /(?:still|only)[\s\S]{0,200}(?:pop-?up|yes)|(?:pop-?up|yes)[\s\S]{0,200}(?:still|only)/i, 'the yes is still needed there');
});

// why: catches a project reader told a retest is never held at push when the project pre-push hook still holds it (S15F1)
test('both agent-teams files scope "never held at push" to the kit repo and say a project pre-push hook still holds a retest push', () => {
	const files = {
		'rules/agent-teams.md': paragraph(read('rules', 'agent-teams.md')),
		'project/standards/agent-teams.md': paragraph(read('project', 'standards', 'agent-teams.md')),
	};
	for (const [name, text] of Object.entries(files)) {
		assert.ok(text.length > 0, `${name} has the locked-test paragraph`);
		assert.match(text, /kit repo[\s\S]{0,120}(?:never|not)[\s\S]{0,20}held[\s\S]{0,10}at (?:the )?push|(?:never|not)[\s\S]{0,20}held[\s\S]{0,10}at (?:the )?push[\s\S]{0,60}kit repo/i, `${name}: never held at push is scoped to the kit repo`);
		assert.match(text, /project'?s?[\s\S]{0,40}pre-push hook[\s\S]{0,80}(?:still )?(?:holds?|pauses?)[\s\S]{0,80}retest/i, `${name}: a project pre-push hook still holds a retest push`);
		assert.match(text, /until[\s\S]{0,80}test-integrity[\s\S]{0,80}project CI template/i, `${name}: until test-integrity is in the project CI template`);
	}
});
