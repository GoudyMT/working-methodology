// The why rule (rule:test-value; K368, U21): what a test's why line must say, and how a test file splits into its tests.
// The edit fence and handoff-gate load this file from their own folder, and scripts/test-check.mjs imports it too, so the
// hooks and the CI check judge one rule. It requires nothing, so it loads from an installed kit's hook folder.

// The top-level test( of a line, with its name as the first quoted string.
const NAMED = /\btest\((['"`])((?:\\.|(?!\1).)*)\1/;
const LOOP = /^(for\s*\(|\[[^\n]*\]\.forEach\(|Object\.(entries|keys|values)\([^\n]*\)\.forEach\()/;

// A test's tags: the comment lines above it, never a line inside its body (the build 14 PR: a sample tag in a string
// was read as the test's own).
const headOf = (body) => {
	const lines = String(body).split('\n');
	const end = lines.findIndex((l) => !/^\s*\/\//.test(l));
	return lines.slice(0, end < 0 ? lines.length : end).join('\n');
};

// Test folders and test file names, the same reading for the edit fence and the hand-back gate.
const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'spec']);
const isTestFile = (rel) => {
	const parts = rel.split(/[\\/]/);
	return parts.slice(0, -1).some((d) => TEST_DIRS.has(d)) || /\.(test|spec)\./.test(parts[parts.length - 1]);
};

/**
 * A6: what is wrong with a test's why line, or null when it has one of the kit's shapes (rule:test-value; the owner,
 * 2026-11-17: "we have the standard, now we just need to enforce it").
 *
 * Args:
 *     body: the test's text with the comment lines above it
 *     known: the rule ids of the rule index, or null to leave a rule's existence to A2
 *
 * Returns:
 *     null, or the fault in words
 */
function whyFault(body, known = null) {
	const why = (/^\s*\/\/ why: (.*)$/m.exec(headOf(body)) || [])[1];
	if (why === undefined) return 'no why line: name the real use or failure it guards (// why: guards rule:<id>, or catches <the failure>)';
	if (/^guards\b/.test(why)) {
		const rules = [...why.matchAll(/\brule:([a-z0-9-]+)/g)].map((m) => m[1]);
		const unknown = known ? rules.filter((r) => !known.has(r)) : [];
		if (unknown.length) return `its why line names rule:${unknown.join(', rule:')}, which is not in the rule index`;
		return rules.length || /\bthe owner/.test(why) ? null : 'its why line says guards but names no rule (rule:<id>) and not the owner';
	}
	if (/^catches\b/.test(why)) return why.trim().split(/\s+/).length >= 6 ? null : 'its why line is too short to name the failure it catches (6 words or more)';
	// U21: the exempt shapes A2 passes without a flip (rule:test-value) name their claim, pin or proof in six words or more.
	if (/^(doc claim|pin|guard proof):/.test(why)) return why.slice(why.indexOf(':') + 1).trim().split(/\s+/).length >= 6 ? null : 'its why line is too short to name the claim, pin or proof it makes (6 words or more after the colon)';
	return 'its why line starts with neither guards nor catches';
}

function tests(text) {
	const lines = String(text).split('\n');
	const starts = [];
	lines.forEach((l, i) => {
		const m = /^test\((['"`])((?:\\.|(?!\1).)*)\1/.exec(l);
		if (m) { starts.push([i, m[2].replace(/\\(.)/g, '$1'), false]); return; }
		if (!LOOP.test(l)) return;
		// The loop's own lines: up to the next line at the margin that is not a closing bracket.
		for (let j = i; j < lines.length && (j === i || !/^[^\s}\])]/.test(lines[j])); j++) {
			const n = NAMED.exec(lines[j]);
			if (n) { starts.push([i, n[2], true]); break; }
		}
	});
	const comment = (l) => /^\s*\/\//.test(l);
	const out = new Map();
	out.loops = new Set(starts.filter((s) => s[2]).map((s) => s[1]));
	out.twice = new Set();
	starts.forEach(([i, name, loop], k) => {
		let head = i;
		while (head > 0 && comment(lines[head - 1])) head--;
		let end = k + 1 < starts.length ? starts[k + 1][0] : lines.length;
		// A plain test ends at its own closing line at the margin, so top-level code after it is not part of it (PR 51:
		// a test inserted after one read the old one as changed). A loop keeps the reach above.
		if (!loop) { const close = lines.slice(i + 1, end).findIndex((l) => /^\}\)/.test(l)); if (close >= 0) end = i + 1 + close + 1; }
		while (end - 1 > i && comment(lines[end - 1])) end--;
		// The build 17 sweep: a second test of the same name is named, never read over in silence.
		if (out.has(name)) out.twice.add(name);
		out.set(name, lines.slice(head, end).join('\n').trimEnd());
	});
	return out;
}

module.exports = { NAMED, LOOP, headOf, isTestFile, whyFault, tests };
