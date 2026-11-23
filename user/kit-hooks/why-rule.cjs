// The why rule (rule:test-value; K368, U21): what a test's why line must say, and how a test file splits into its tests.
// The edit fence and handoff-gate load this file from their own folder, and scripts/test-check.mjs imports it too, so the
// hooks and the CI check judge one rule. It requires nothing, so it loads from an installed kit's hook folder.

// The top-level test( of a line, with its name as the first quoted string.
const NAMED = /\btest\((['"`])((?:\\.|(?!\1).)*)\1/;
// A loop at the margin that makes tests: a for, or a forEach over a literal array, a named array or Object.entries/keys/values.
const LOOP = /^(for\s*\(|\[[^\n]*\]\.forEach\(|[\w$.]+\.forEach\(|Object\.(entries|keys|values)\([^\n]*\)\.forEach\()/;

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

// Each line with its strings, comments and regex literals blanked to spaces (same length), so a test( inside a string
// or a comment is never read as a call. A template literal (its ${ } holes too, nested ones included) and a block comment
// may run over many lines; all inside an outer template is blanked but read through, so its quotes balance.
function codeLines(lines) {
	const stack = []; // 'tpl' for a template's text; a number (brace depth) for a ${ } hole
	let block = false;
	return lines.map((line) => {
		let out = '';
		let prev = '';
		let k = 0;
		const put = (s) => { out += stack.length ? ' '.repeat(s.length) : s; };
		while (k < line.length) {
			const c = line[k];
			const d = line[k + 1];
			const top = stack[stack.length - 1];
			if (block) { if (c === '*' && d === '/') { block = false; out += '  '; k += 2; } else { out += ' '; k++; } continue; }
			if (top === 'tpl') {
				if (c === '\\') { out += '  '; k += 2; } else if (c === '`') { stack.pop(); put('`'); k++; prev = c; } else if (c === '$' && d === '{') { stack.push(0); out += '  '; k += 2; } else { out += ' '; k++; }
				continue;
			}
			if (c === '/' && d === '/') { out += ' '.repeat(line.length - k); break; }
			if (c === '/' && d === '*') { block = true; out += '  '; k += 2; continue; }
			if (c === '`') { put('`'); stack.push('tpl'); k++; continue; }
			if (c === '{' && typeof top === 'number') stack[stack.length - 1] = top + 1;
			if (c === '}' && typeof top === 'number') {
				if (top === 0) { stack.pop(); out += ' '; k++; continue; }
				stack[stack.length - 1] = top - 1;
			}
			if (c === '"' || c === "'") {
				put(c); k++;
				while (k < line.length && line[k] !== c) { if (line[k] === '\\') { out += ' '; k++; } out += ' '; k++; }
				if (k < line.length) { put(c); k++; }
				prev = c;
				continue;
			}
			if (c === '/' && (prev === '' || /[(,=:[!&|?{};]/.test(prev) || /(?:^|[^\w$.])(?:return|typeof|case|in|of|delete|void|throw|new|yield|await)\s*$/.test(out))) {
				let j = k + 1;
				let cls = false;
				while (j < line.length && (cls || line[j] !== '/')) { if (line[j] === '\\') j++; else if (line[j] === '[') cls = true; else if (line[j] === ']') cls = false; j++; }
				if (j < line.length) { put('/' + ' '.repeat(j - k - 1) + '/'); k = j + 1; prev = '/'; continue; }
			}
			put(c);
			if (!/\s/.test(c)) prev = c;
			k++;
		}
		return out.slice(0, line.length).padEnd(line.length, ' ');
	});
}

// The tests of a file's text, line by line: [{ i, name, loop }]. A test is a call of test( (or of a name bound to it, as
// const t = test) on any line, indented or not, outside a string or comment. Its name is its first string, or for a
// non-literal name the text of the first argument. A top-level loop that makes tests is one start at the loop's own
// line, named by its first test( inside, up to the next line at the margin that is not a closing bracket.
function testStarts(text) {
	const lines = String(text).split('\n');
	const code = codeLines(lines);
	const names = new Set(['test']);
	// The names node:test is bound to: a named import (test or it, renamed or not), a default import, or a destructure
	// of the module (import() or require(), renamed with test: t).
	const whole = String(text);
	const bind = (spec) => { for (const part of spec.split(',')) { const m = /^\s*(test|it)\s*(?:(?:as|:)\s*([\w$]+))?\s*$/.exec(part); if (m) names.add(m[2] || m[1]); } };
	for (const m of whole.matchAll(/\bimport\s+([\w$]+)?\s*,?\s*(?:\{([^}]*)\})?\s*from\s*['"](?:node:)?test['"]/g)) { if (m[1]) names.add(m[1]); if (m[2]) bind(m[2]); }
	for (const m of whole.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:await\s+)?(?:import|require)\(\s*['"](?:node:)?test['"]\s*\)/g)) bind(m[1]);
	for (const l of code) {
		for (const m of l.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*=\s*test\s*(?:;|$)/g)) names.add(m[1]);
		for (const m of l.matchAll(/\btest\s+as\s+([\w$]+)/g)) names.add(m[1]);
	}
	const call = new RegExp(`(?<![\\w$.])(?<!function\\s+)(?:${[...names].map((n) => n.replace(/\$/g, '\\$')).join('|')})\\(`);
	const nameAt = (i, from) => {
		const rest = lines[i].slice(from);
		const lit = /^[\w$]+\(\s*(['"`])((?:\\.|(?!\1).)*)\1/.exec(rest);
		if (lit) return lit[2].replace(/\\(.)/g, '$1');
		const arg = /^[\w$]+\(\s*([^,)]+?)\s*[,)]/.exec(rest);
		return arg ? arg[1] : '?';
	};
	const starts = [];
	for (let i = 0; i < lines.length; i++) {
		if (LOOP.test(code[i])) {
			let end = i + 1;
			while (end < lines.length && !/^[^\s}\])]/.test(code[end])) end++;
			let found = null;
			for (let j = i; j < end; j++) { const m = call.exec(code[j]); if (m) { found = nameAt(j, m.index); break; } }
			if (found !== null) { starts.push({ i, name: found, loop: true }); i = end - 1; continue; }
		}
		const m = call.exec(code[i]);
		if (m) starts.push({ i, name: nameAt(i, m.index), loop: false });
	}
	return starts;
}

function tests(text) {
	const lines = String(text).split('\n');
	const starts = testStarts(text).map((s) => [s.i, s.name, s.loop]);
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

module.exports = { NAMED, LOOP, headOf, isTestFile, whyFault, tests, testStarts };
