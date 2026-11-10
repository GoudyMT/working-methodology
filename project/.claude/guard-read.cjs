'use strict';
// How both guards (guard-delete.cjs, guard-outward.cjs) read a command, in one place (M27): a spelling read right
// here is read right by both. It reads the text the way its shell will, then splits it into commands and words;
// each guard matches its own rules on the result. A value built at run time stays unread.
const BACKSLASH = String.fromCharCode(92);
const BACKTICK = String.fromCharCode(96);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
// The longest a brace expansion may grow: groups side by side multiply (x{a,b}{c,d} is four words).
const MAX_PLAIN = 100000;
// The most brace groups read; past it the rest asks. Far more than any real command holds.
const MAX_GROUPS = 500;
// < and > start a redirection, read inside a command (its target is marked), not a break between commands.
const SEGMENT_BREAKS = new Set([';', '|', '&', '(', ')', '{', '}', LF]);

// Characters a shell reads like ASCII ones: curly quotes, Unicode dashes and spaces.
function normalize(text) {
	let out = '';
	for (const ch of text) {
		const c = ch.codePointAt(0);
		if (c >= 0x2018 && c <= 0x201b) out += "'";
		else if (c >= 0x201c && c <= 0x201e) out += '"';
		else if (c >= 0x2013 && c <= 0x2015) out += '-';
		else if (c === 0xa0 || c === 0x85 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff) out += ' ';
		else out += ch;
	}
	return out;
}

// A command the way its shell will read it: escapes, carets, empty expansions and braces gone. Each guard reads this
// beside the text as written, so one rule covers every spelling these make. Values built at run time stay unread.
function plainText(text, tool) {
	let s = normalize(text).replace(/[\\`^]\r?\n/g, '');
	s = s.replace(/`(?=\S)/g, '');
	if (!/powershell/i.test(String(tool))) s = s.split(/(\s+)/).map((w) => (/^["']?[A-Za-z]:\\/.test(w) ? w : w.replace(/\\(?!\\)/g, ''))).join('');
	if (/\bcmd\b/i.test(s)) s = s.replace(/\^(?=[\w.-])/g, '');
	s = s.replace(/\$\(\s*\)|\$\{\s*\}|\$""|\$''/g, '').replace(/\$(?=['"])/g, '').replace(/(?<=\S)(?:''|"")(?=\S)/g, '');
	if (/powershell/i.test(String(tool))) return s;
	// A group's prefix is read whole (it starts after a space, a brace, a quote or the text's start): a prefix that may
	// start anywhere made each read scan a long run of signs again from every place in it (the 1.23.0 sweep).
	const brace = /(?<![^\s{}'"])([^\s{}'"]*)\{([^\s{}]*,[^\s{}]*)\}([^\s{}'"]*)/;
	// A sequence group ({r..r}m, {1..3}, {a..e..2}) is a brace expansion too (the 1.23.0 sweep).
	const sequence = /(?<![^\s{}'"])([^\s{}'"]*)\{([A-Za-z]|-?\d+)\.\.([A-Za-z]|-?\d+)(?:\.\.(-?\d+))?\}([^\s{}'"]*)/;
	// Every group is expanded: a fixed count let decoy groups hide a later one (the 1.23.0 mutation check, M27). Each
	// pass removes one group, so it ends; the size cap stops a nested blow-up, and what is left asks (below).
	// Each pass scans the whole text, so the passes are bounded too: a hook that runs past its timeout blocks.
	// A group inside another one ({push,{origin,main}}) adds its words to the outer group, as bash reads it, so the
	// outer group is read on a later pass.
	const inGroup = (offset) => {
		const before = s.slice(Math.max(s.lastIndexOf(' ', offset), s.lastIndexOf(LF, offset), s.lastIndexOf('\t', offset)) + 1, offset);
		return before.split('{').length > before.split('}').length;
	};
	// Inside an outer group, the prefix and suffix stop at that group's commas: {push,{origin,main}} is push origin main.
	const wrap = (items, a, c, offset) => {
		if (!inGroup(offset)) return items.map((x) => a + x + c).join(' ');
		const i = a.lastIndexOf(',') + 1;
		const j = c.includes(',') ? c.indexOf(',') : c.length;
		return a.slice(0, i) + items.map((x) => a.slice(i) + x + c.slice(0, j)).join(',') + c.slice(j);
	};
	for (let pass = 0; pass < MAX_GROUPS && (brace.test(s) || sequence.test(s)) && s.length < MAX_PLAIN; pass++) {
		if (sequence.test(s)) {
			s = s.replace(sequence, (m, a, from, to, step, c, offset) => {
				const items = seqItems(from, to, step);
				return items ? wrap(items, a, c, offset) : m.replace('..', '\u0000');
			});
		} else s = s.replace(brace, (m, a, b, c, offset) => wrap(b.split(','), a, c, offset));
	}
	// Past the cap the rest is unread: a word the guards always ask on stands in for it.
	if (brace.test(s) || sequence.test(s) || s.includes('\u0000')) s = s.split('\u0000').join('..') + ' ; git push ; rm -rf /';
	return s;
}

// The words of a sequence group, or null when it is not one bash expands or holds too many to read.
function seqItems(from, to, step) {
	const letters = /^[A-Za-z]$/.test(from);
	if (letters !== /^[A-Za-z]$/.test(to)) return null;
	const a = letters ? from.charCodeAt(0) : Number(from);
	const b = letters ? to.charCodeAt(0) : Number(to);
	const by = Math.abs(Number(step || 1)) || 1;
	if (Math.abs(b - a) / by > MAX_GROUPS) return null;
	const out = [];
	for (let x = a; a <= b ? x <= b : x >= b; x += a <= b ? by : -by) out.push(letters ? String.fromCharCode(x) : String(x));
	return out;
}

// The text with PowerShell block comments (<# ... #>) and line comments (a # that starts a word, to the line's
// end) cut out.
function withoutComments(text) {
	return text.replace(/<#[\s\S]*?(#>|$)/g, ' ').replace(/(^|[\s;|&(){}])#[^\n]*/g, '$1');
}

// Line continuations (PowerShell backtick, bash backslash) join one command across lines.
function joinContinuations(text) {
	let out = text;
	for (const mark of [BACKTICK, BACKSLASH]) {
		out = out.split(mark + CR + LF).join(' ').split(mark + LF).join(' ');
	}
	return out;
}

// Splits text into commands (at ; | & ( ) { } < > and newlines) and each command into words, keeping quoted
// text in one word. Quote characters are dropped; a word that held quoted text is marked, so its content can be
// read again as a nested command. Each command keeps the break that ended it, so a pipeline can be followed back.
function tokenize(text) {
	const segments = [];
	let segment = [];
	let current = '';
	let inWord = false;
	let quoted = false;
	let quote = '';
	// How much of the word came before its first quote: cmd reads cd"C:\x" as cd C:\x.
	let lead = -1;
	// The word after < or > is a redirection's file, not one of the command's own words.
	let redirect = false;
	const endWord = () => {
		if (inWord) {
			segment.push({ value: current, quoted, redirect, lead });
			redirect = false;
		}
		current = '';
		inWord = false;
		quoted = false;
		lead = -1;
	};
	const endSegment = (end) => {
		endWord();
		redirect = false;
		const last = segments[segments.length - 1];
		if (segment.length > 0) {
			segment.end = end;
			segment.opens = end === '{' ? 1 : 0;
			segment.closes = end === '}' ? 1 : 0;
			segment.endsGroup = end === ')';
			segments.push(segment);
		} else if (last) {
			// && and || are kept as one break; a pipe followed by a line break still feeds the next line.
			if ((end === '&' || end === '|') && last.end === end) last.end = end + end;
			// |& pipes both streams, so it stays a pipe.
			else if (end === '&' && last.end === '|') last.end = '|&';
			else if (!(['|', '||', '&&'].includes(last.end) && end === LF)) last.end = end;
			if (end === '{') last.opens++;
			if (end === '}') last.closes++;
			if (end === ')') last.endsGroup = true;
		}
		segment = [];
	};
	const chars = [...text];
	for (let c = 0; c < chars.length; c++) {
		const ch = chars[c];
		if (quote) {
			if (ch === quote) quote = '';
			else current += ch;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			if (!quoted) lead = current.length;
			quoted = true;
			inWord = true;
		} else if ((ch === '&' || ch === '|') && redirect && !inWord && /[<>]/.test(chars[c - 1])) {
			// 2>&1, >&2 and >| are one redirection, not a break.
			continue;
		} else if (ch === '&' && chars[c + 1] === '>') {
			// &> sends both streams to a file.
			continue;
		} else if (SEGMENT_BREAKS.has(ch)) {
			endSegment(ch);
		} else if (ch === '<' || ch === '>') {
			// A stream number glued to the redirection (2>) is part of it, not a word. PowerShell's *> keeps its *, which
			// bash reads as a wildcard target.
			if (inWord && !quoted && /^\d+$/.test(current)) inWord = false;
			endWord();
			redirect = true;
		} else if (ch.charCodeAt(0) <= 32 || ch === ',') {
			endWord();
		} else {
			current += ch;
			inWord = true;
		}
	}
	endSegment('');
	return segments;
}

// How a guard holds a command: the main session asks the owner; a subagent (Claude Code names it in agent_id) is
// refused, because its ask reaches no one and the agent waits on it (E27: 76 of 512 live asks in ten days). The
// refusal tells it to hand the command back, so the lead asks.
function holdFor(input) {
	const sub = Boolean(input && typeof input.agent_id === 'string' && input.agent_id);
	return { decision: sub ? 'deny' : 'ask', note: sub ? ' A subagent cannot get that yes: leave this command out and name it in your report, so the lead asks.' : '' };
}

module.exports = { BACKSLASH, BACKTICK, LF, CR, normalize, plainText, withoutComments, joinContinuations, tokenize, holdFor };
