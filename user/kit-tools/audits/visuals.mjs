#!/usr/bin/env node
// The Visuals section (rule:pr-body, rule:release-notes; K125, the owner 2026-11-17): a PR body or release note that
// says a number moved shows it, and leads with what it changes for a person. One command does the work a script can:
// it measures the tracked metrics on two commits (sizes from git, never a checkout), keeps what moved, derives the
// chain (tokens, then dollars and the share of the context window), draws the chart and writes the section into the
// body file. The thread writes one why line per row; nothing else. The same file checks a section, for the PR and
// release audits.
//
// Usage: node .claude/visuals.mjs <base> <head> [--config .kit/visuals.json] [--body <file>] [--level ###|##]
//        [--before "<heading line>"] [--fold] [--out docs/visuals/<branch>]
// The config (.kit/visuals.json):
//   { "threshold": 0.01, "price": { "perMTok": 4, "date": "YYYY-MM-DD" }, "window": 400000 | { "before", "after" },
//     "sessions": 1000,
//     "metrics": [{ "name", "paths": [...] (bytes at each commit) | "unit": "tokens" | "s", "before", "after",
//                   "source", "measuredAt": [<base>, <head>];
//                   "limit"; "impact": ["cost" | "time" | "room"]; "lead": true (the outcome sentence's metric);
//                   "per": "session" (default) | "request" | ...;
//                   "tokens": { "before", "after", "source", "measuredAt": [<base>, <head>] } }] }
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import safeSpawn from './safe-spawn.cjs';

export const IMPACTS = ['cost', 'time', 'room'];
const MAX_ROWS = 6;
const BAR = 40;
const MAX_PROSE_WORDS = 400;
export const HEADER = '| Metric | Before | After | Change | Limit | Source |';
const UNIT_WORD = { B: 'bytes', '': 'tokens', $: 'dollars', s: 'seconds', '%': 'percent of the window' };
// The image line the writer makes, and the only one a section may hold (the 1.42.0 Visuals sweep): this repo's own
// raw file at a full commit, under docs/visuals/, with no "..", alt text naming the numbers.
export const CHART_LINE = /^!\[Chart: ([^\]\n]*)\]\((https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/raw\/[0-9a-f]{40}\/docs\/visuals\/((?:[\w-][\w.-]*\/)*[\w-][\w.-]*\.(?:png|svg)))\)$/;
// What must never reach public text: a home folder, an email, a token.
const PRIVATE = /[A-Za-z]:[\\/]+Users[\\/]|\/Users\/[^/\s]+|\/home\/[^/\s]+|[\w.+-]+@[\w-]+\.[\w.-]+|\b(ghp|gho|ghs|github_pat|sk|xox[abp])[-_][A-Za-z0-9_-]{10,}/;

const plural = (per) => (per === 'session' ? 'sessions' : `${per}s`);
// The owner's outcome rule (DESIGN 0a): every metric names the outcome it drives, so a size never appears alone. A
// token count is measured (a session's context report, the free counting call); bytes divided by a ratio were 30%
// low. A typed number names the two commits it was measured at, so a later PR cannot repeat this one's saving.
export function configFaults(cfg) {
	const out = [];
	const metrics = Array.isArray(cfg && cfg.metrics) ? cfg.metrics : [];
	if (!metrics.length) out.push('no metrics: list what the project tracks');
	const strings = [];
	JSON.stringify(cfg || {}, (k, v) => { if (typeof v === 'string') strings.push(v); return v; });
	const leak = strings.find((s) => PRIVATE.test(s));
	if (leak) out.push(`a config value holds a home folder, an email or a token, which would go into public text: "${leak.slice(0, 40)}"`);
	if (cfg && cfg.sessions !== undefined && !(Number.isInteger(cfg.sessions) && cfg.sessions > 0)) out.push('sessions is not a whole number above 0');
	const win = cfg && cfg.window;
	const winOk = win > 0 || (win && win.before > 0 && win.after > 0);
	if (metrics.filter((m) => m.lead).length > 1) out.push('more than one metric is marked lead');
	const typed = (x, n, what) => {
		if (typeof x.before !== 'number' || typeof x.after !== 'number' || !x.source) out.push(`${n}: ${what} needs a measured before, after and source`);
		if (!Array.isArray(x.measuredAt) || x.measuredAt.length !== 2 || !x.measuredAt.every((s) => typeof s === 'string' && /^[0-9a-f]{7,40}$/.test(s))) out.push(`${n}: ${what} names no measuredAt: [<base commit>, <head commit>] it was measured at`);
	};
	for (const m of metrics) {
		const n = m.name || '(unnamed)';
		if (!m.name) out.push('a metric has no name');
		if (m.paths && m.unit !== undefined) out.push(`${n}: a paths metric is bytes; set no unit`);
		if (!m.paths) {
			if (!['tokens', 's'].includes(m.unit)) out.push(`${n}: a typed metric is "tokens" or "s" (seconds)`);
			typed(m, n, 'a typed metric');
		}
		if (m.limit !== undefined && !(typeof m.limit === 'number' && m.limit > 0)) out.push(`${n}: limit is not a number above 0`);
		const impact = Array.isArray(m.impact) ? m.impact : [];
		if (!impact.length) { out.push(`${n}: names no impact (cost, time or room): a size never appears alone`); continue; }
		for (const i of impact) if (!IMPACTS.includes(i)) out.push(`${n}: impact "${i}" is not cost, time or room`);
		const hasTokens = m.unit === 'tokens' || (m.paths && m.tokens);
		if (m.paths && m.tokens) typed(m.tokens, n, 'tokens');
		for (const i of ['cost', 'room']) if (impact.includes(i) && !hasTokens) out.push(`${n}: ${i} needs measured tokens (tokens: { before, after, source, measuredAt }); bytes are never divided into tokens`);
		if (impact.includes('cost') && !(cfg.price && cfg.price.perMTok > 0 && cfg.price.date)) out.push(`${n}: cost needs a price ({ perMTok, date })`);
		if (impact.includes('room') && !winOk) out.push(`${n}: room needs the context window in tokens (a number, or { before, after } when it changed)`);
		if (impact.includes('room') && (m.per ?? 'session') !== 'session') out.push(`${n}: room is the share of the window used at a session's start; a metric per ${m.per} has none`);
		if (impact.includes('time') && m.unit !== 's') out.push(`${n}: time needs a measured wait in seconds (unit "s")`);
	}
	return out;
}

// Numbers as the table writes them, and read back the same way.
const num = (v, unit) => (unit === '$' ? '$' + v.toFixed(2) : unit === '%' ? v.toFixed(2) + '%' : v.toLocaleString('en-US'));
export const fmt = (v, unit) => num(v, unit) + (unit === 'B' || unit === 's' ? ' ' + unit : '');
export function parseValue(s) {
	const t = String(s).trim();
	const m = /^(\$)?(-?[\d,]+(?:\.\d+)?)(%| B| s)?$/.exec(t);
	if (!m) return null;
	return { v: Number(m[2].replace(/,/g, '')), unit: m[1] ? '$' : (m[3] || '').trim() };
}
// Half away from zero, on the decimal the table shows (0.325 points is 0.33, as a reader rounds it).
const round = (x, places) => Math.sign(x) * Math.round(Math.abs(x) * 10 ** places + 1e-9) / 10 ** places;
export function changeText(before, after, unit) {
	const d = after - before;
	const sign = d > 0 ? '+' : d < 0 ? '-' : '';
	if (unit === '%') return `${sign}${Math.abs(round(d, 2)).toFixed(2)} points`;
	const v = unit === '$' ? `${sign}$${Math.abs(round(d, 2)).toFixed(2)}` : `${sign}${Math.abs(d).toLocaleString('en-US')}${unit === 'B' || unit === 's' ? ' ' + unit : ''}`;
	return before ? `${v} (${d > 0 ? '+' : ''}${round(d / before * 100, 1).toFixed(1)}%)` : v;
}

// The headline row as text bars: the same everywhere the text goes (web, gh, email, terminal); | marks the limit.
export function textChart(r) {
	const max = Math.max(r.before, r.after, r.limit || 0);
	const at = r.limit ? Math.min(BAR - 1, Math.round(r.limit / max * BAR)) : -1;
	const bar = (v) => { const n = Math.round(v / max * BAR); let s = ''; for (let i = 0; i < BAR; i++) s += i === at ? '|' : i < n ? '#' : ' '; return s; };
	const title = `${r.metric}, ${UNIT_WORD[r.unit] ?? r.unit}${r.limit ? ` (| = limit ${r.limit.toLocaleString('en-US')})` : ''}`;
	return [title, `before  ${bar(r.before)}  ${num(r.before, r.unit)}`, `after   ${bar(r.after)}  ${num(r.after, r.unit)}`].join('\n');
}

// The rows: each moved metric, then its chain. A derived row names only the rows above it.
export function buildRows(cfg, sizes, revs) {
	const inside = (p, q) => p === q || p.startsWith(q.endsWith('/') ? q : q + '/');
	const sum = (map, paths) => [...map].filter(([p]) => paths.some((q) => inside(p, q))).reduce((a, [, n]) => a + n, 0);
	const threshold = cfg.threshold ?? 0.01;
	const sessions = cfg.sessions ?? 1000;
	const all = cfg.metrics.map((m) => (m.paths
		? { ...m, before: sum(sizes[0], m.paths), after: sum(sizes[1], m.paths), unit: 'B', source: `measured: bytes at ${revs[0]} and ${revs[1]}` }
		: { ...m, unit: m.unit === 'tokens' ? '' : m.unit, source: `measured: ${m.source}` }));
	// A move under the threshold is left out, but never a new file or a limit crossed (the 1.42.0 Visuals sweep).
	const crossed = (m) => m.limit && (m.before > m.limit) !== (m.after > m.limit);
	const moved = all.filter((m) => (m.before === 0 ? m.after > 0 : Math.abs(m.after - m.before) / m.before >= threshold) || crossed(m));
	const win = typeof cfg.window === 'object' && cfg.window ? cfg.window : { before: cfg.window, after: cfg.window };
	const rows = [];
	const outcomes = [];
	for (const m of moved) {
		const per = m.per ?? 'session';
		rows.push({ metric: m.name, before: m.before, after: m.after, unit: m.unit, limit: m.limit ?? null, source: m.source, why: null });
		const t = m.unit === '' ? { before: m.before, after: m.after } : m.tokens;
		const parts = [];
		const dir = Math.sign((t || m).after - (t || m).before);
		if (t && m.paths) {
			rows.push({ metric: `${m.name}: tokens ${per === 'session' ? 'read at each session start' : `per ${per}`}`, before: t.before, after: t.after, unit: '', limit: null, source: `measured: ${t.source}`, why: `follows from the ${m.name} size.` });
		}
		// A file's tokens are its share of the start, named as such: the whole start-up load can move less than one file.
		if (t) {
			const d = t.after - t.before;
			const n = `${Math.abs(d).toLocaleString('en-US')} ${d < 0 ? 'fewer' : 'more'} tokens`;
			parts.push(m.paths ? (per === 'session' ? `${m.name} loads ${n} at each session start` : `${m.name} uses ${n} per ${per}`)
				: per === 'session' ? `Every session starts with ${n}` : `Each ${per} uses ${n}`);
		}
		if (m.unit === 's') { const d = m.after - m.before; parts.push(`${m.name} takes ${Math.abs(d).toLocaleString('en-US')} s ${d < 0 ? 'less' : 'more'}`); }
		if (m.impact.includes('cost')) {
			const usd = (n) => round(n * sessions * cfg.price.perMTok / 1e6, 2);
			const r = { metric: `${m.name}: cost per ${sessions.toLocaleString('en-US')} ${plural(per)}`, before: usd(t.before), after: usd(t.after), unit: '$', limit: null,
				source: `derived: tokens x $${cfg.price.perMTok} per million input tokens, uncached (${cfg.price.date})`, why: 'follows from tokens at the uncached input price; cached reads cost less.' };
			rows.push(r);
			const d = round(r.after - r.before, 2);
			parts.push(`about $${Math.abs(d).toFixed(2)} ${d < 0 ? 'less' : 'more'} per ${sessions.toLocaleString('en-US')} ${plural(per)} at the uncached input price`);
		}
		if (m.impact.includes('room')) {
			// Each run against its own window: a window that changed between the two moves the share too.
			const share = (n, w) => round(n / w * 100, 2);
			const [sb, sa] = [share(t.before, win.before), share(t.after, win.after)];
			const changed = win.before !== win.after;
			const why = sa < sb ? 'less of the window goes to the start, so more is left for the work before the session compacts'
				: 'more of the window goes to the start, so less is left for the work before the session compacts';
			rows.push({ metric: `${m.name}: share of the window used at start`, before: sb, after: sa, unit: '%', limit: null,
				source: changed ? `derived: tokens / the window at each commit (${win.before.toLocaleString('en-US')}, then ${win.after.toLocaleString('en-US')})` : `derived: tokens / ${win.after.toLocaleString('en-US')}-token window`,
				why: `${why}${changed ? `; the window itself went from ${win.before.toLocaleString('en-US')} to ${win.after.toLocaleString('en-US')} tokens` : ''}.` });
			const pt = Math.abs(round(sa - sb, 2));
			parts.push(`${pt.toFixed(2)} points ${sa < sb ? 'less' : 'more'} of the window used at start${changed ? ` (the window went from ${win.before.toLocaleString('en-US')} to ${win.after.toLocaleString('en-US')} tokens)` : ''}`);
		}
		if (parts.length) outcomes.push({ parts, dir, lead: Boolean(m.lead) });
	}
	// The outcome sentence: the lead metric's chain (the one marked lead, else the first), then any other metric that
	// moved the other way, so a regression is never left out of the lead (the 1.42.0 Visuals sweep).
	const lead = outcomes.find((o) => o.lead) || outcomes[0];
	const join = (p) => (p.length > 1 ? `${p[0]}: ${p.length > 2 ? p.slice(1, -1).join(', ') + ', and ' + p[p.length - 1] : p[1]}` : p[0]);
	const against = outcomes.filter((o) => o !== lead && o.dir && lead && o.dir !== lead.dir);
	const sentence = !lead ? '' : `${join(lead.parts)}${against.map((o) => `. But ${o.parts[0][0].toLowerCase()}${o.parts[0].slice(1)}`).join('')}.`;
	return { rows, moved, all, sentence };
}

// Prose lines wrap at 110 characters, as every PR body line does; a bullet's wrapped lines indent two spaces.
const WIDTH = 110;
function wrap(text, indent = '') {
	const out = [];
	let line = '';
	for (const w of text.split(' ')) {
		if (line && (line + ' ' + w).length > WIDTH) { out.push(line); line = indent + w; } else line = line ? line + ' ' + w : w;
	}
	return [...out, line].join('\n');
}

export function section(built, { level = '###', fold = false, image = null } = {}) {
	const { rows, sentence } = built;
	const h = rows[0];
	const body = [wrap(sentence), '', ...(image ? [image, ''] : []), '```text', textChart(h), '```', '', HEADER, '|---|---|---|---|---|---|',
		...rows.map((r) => `| ${r.metric} | ${fmt(r.before, r.unit)} | ${fmt(r.after, r.unit)} | ${changeText(r.before, r.after, r.unit)} | ${r.limit == null ? 'none' : fmt(r.limit, r.unit)} | ${r.source} |`),
		'', '**Why each number moved**', '', ...rows.map((r) => wrap(`- **${r.metric}:** ${r.why || '<why>'}`, '  '))].join('\n');
	if (fold) return `<details>\n<summary>Visuals: ${h.metric} ${fmt(h.before, h.unit)} to ${fmt(h.after, h.unit)}${h.limit ? ` (cap ${fmt(h.limit, h.unit)})` : ''}</summary>\n\n${body}\n</details>\n`;
	return `${level} Visuals\n\n${body}\n`;
}

// Every Visuals section in a body: a heading named Visuals at any level, to the next heading of the same or a higher
// level, or a fold whose summary starts "Visuals:". No comment markers: the release audit reads "<!--" as a double
// hyphen.
export function locateAll(text) {
	const found = [];
	for (const m of text.matchAll(/(^|\n)<details>\s*\n\s*<summary>\s*Visuals:[^\n]*<\/summary>\n([\s\S]*?)\n<\/details>\n?/gi)) {
		found.push({ start: m.index + m[1].length, end: m.index + m[0].length, body: m[2], fold: true });
	}
	for (const m of text.matchAll(/(^|\n)(#{1,6})[ \t]*Visuals[ \t]*\n/gi)) {
		const at = m.index + m[1].length;
		if (found.some((f) => at >= f.start && at < f.end)) continue;
		const from = m.index + m[0].length;
		const next = new RegExp(`\\n#{1,${m[2].length}} `).exec(text.slice(from));
		const end = next ? from + next.index : text.length;
		found.push({ start: at, end, body: text.slice(from, end), level: m[2] });
	}
	return found.sort((a, b) => a.start - b.start);
}

// K149 (build 19): a measured figure is a number with a unit a reader pays in: bytes, tokens, time or dollars. A count
// of tests or findings has no such unit, so a tally is never one (DESIGN 5).
// The build 19 sweep: the unit spellings people write (MiB, a million tokens, 1 second, 12 mins, 2 hrs, megabytes,
// dollars), each read as one unit, and a number in groups of three so a long run of digits and commas stays linear.
const NUM = String.raw`\d+(?:,\d{3})*(?:\.\d+)?`;
const UNIT = String.raw`(?:[KMGT]i?B|B|bytes?|kilobytes?|megabytes?|gigabytes?|[kM]?\s?tokens?|ms|s|secs?|seconds?|mins?|minutes?|h|hrs?|hours?|dollars?)`;
const MS = String.raw`\$\s?${NUM}[kKM]?|\b${NUM}[kKM]?\s?${UNIT}\b`;
const MEASURED = new RegExp(MS, 'gi');
// An arrow claims a move when a figure ends the text before it and another starts the text after it ("5 s -> then kill
// after 30 s" shows a sequence, not a move).
const ENDS = new RegExp(`(${MS})[^\\d$]{0,20}$`, 'i');
const STARTS = new RegExp(`^[^\\d$]{0,12}(${MS})`, 'i');
const SAME_UNIT = [[/^(s|secs?|seconds?)$/, 's'], [/^(mins?|minutes?)$/, 'min'], [/^(h|hrs?|hours?)$/, 'h'], [/^(bytes?|b)$/, 'b'], [/^(kilobytes?|kb|kib)$/, 'kb'],
	[/^(megabytes?|mb|mib)$/, 'mb'], [/^(gigabytes?|gb|gib)$/, 'gb'], [/^tokens?$/, 'tokens'], [/^dollars?$/, '$']];
// One spelling per figure, so "720 s" and "720 seconds" read the same, and an unchanged figure is no move.
const canon = (f) => {
	const m = /^\$\s?(.+)$/.exec(f);
	if (m) return `$${m[1].toLowerCase()}`;
	const n = /^([\d,.]+)\s?(.*)$/.exec(f);
	const unit = n[2].toLowerCase().replace(/\s+/g, ' ');
	const k = /^([km]) ?tokens?$/.exec(unit);
	if (k) return `${n[1]}${k[1]} tokens`;
	return `${n[1].toLowerCase()} ${(SAME_UNIT.find(([re]) => re.test(unit)) || [null, unit])[1]}`;
};
const figures = (s) => (String(s).match(MEASURED) || []).map(canon);
const SAME_WORDS = /\b(same|unchanged|no change|as before)\b/i;

/**
 * The measured moves a body claims outside its Visuals section (DESIGN 6, row 1): a measured figure on both sides of an
 * arrow or of "<figure> to <figure>" in one sentence (lines wrapped in a paragraph read as one), or a row of a table
 * headed Before and After whose two cells differ in a measured figure. Code, fences and the Visuals section are left
 * out; a figure that stays the same is no move.
 *
 * Args:
 *     text: the body or notes, as written
 *
 * Returns:
 *     Each claim as a short quote; empty when the body claims no measured move
 */
export function claimedMoves(text) {
	let t = String(text).replace(/\r\n/g, '\n');
	for (const s of locateAll(t).reverse()) t = t.slice(0, s.start) + t.slice(s.end);
	t = t.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '').replace(/`[^`\n]*`/g, ' ');
	const out = [];
	const differ = (a, b) => (a.length || b.length) && a.join() !== b.join();
	let cols = null;
	const para = [];
	const flush = () => {
		for (const sentence of para.join(' ').split(/(?<=[.!?;])\s+/)) {
			const parts = sentence.split('->');
			let moved = parts.slice(1).some((right, i) => {
				const [a, b] = [ENDS.exec(parts[i]), STARTS.exec(right)];
				return a && b && canon(a[1]) !== canon(b[1]);
			});
			for (const m of sentence.matchAll(new RegExp(`(${MS})\\s+to\\s+(?:about\\s+|around\\s+)?(${MS})`, 'gi'))) {
				if (canon(m[1]) !== canon(m[2])) moved = true;
			}
			if (moved) out.push(sentence.trim().slice(0, 90));
		}
		para.length = 0;
	};
	for (const raw of t.split('\n')) {
		const line = raw.replace(/^\s*>\s?/, '').trim();
		const isRow = (line.match(/\|/g) || []).length >= 2;
		if (isRow) {
			flush();
			const cells = line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
			if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
			const b = cells.findIndex((c) => /^before$/i.test(c));
			const a = cells.findIndex((c) => /^after$/i.test(c));
			if (b >= 0 && a >= 0) { cols = [b, a]; continue; }
			if (!cols) continue;
			const [before, after] = [figures(cells[cols[0]] || ''), figures(cells[cols[1]] || '')];
			const still = (!before.length && SAME_WORDS.test(cells[cols[0]] || '')) || (!after.length && SAME_WORDS.test(cells[cols[1]] || ''));
			if (differ(before, after) && !still) out.push(line.slice(0, 90));
			continue;
		}
		cols = null;
		if (!line || /^#/.test(line) || /^([-*+]|\d+[.)])\s/.test(line)) flush();
		if (line) para.push(line);
	}
	flush();
	return out;
}

// The checks the audits run (DESIGN 6), and the writer runs on its own output: one section, at the right level; the
// outcome sentence's numbers in the rows; every change and derived row recomputed; the chart bounded; every row given
// its why; an image only as this repo's pinned chart; no link, no private data, the prose capped.
// opts: { require: a section must be there; repo: "owner/name" the image must come from }
export function checkSection(text, level = '###', opts = {}) {
	const all = locateAll(String(text).replace(/\r\n/g, '\n'));
	if (!all.length) return opts.require ? ['Visuals: no section found (a fold whose summary starts "Visuals:", or a Visuals heading)'] : [];
	const faults = [];
	if (all.length > 1) faults.push(`Visuals: ${all.length} Visuals sections; a body carries one`);
	const found = all[0];
	if (found.level && found.level !== level) faults.push(`Visuals: the heading is ${found.level} Visuals where ${level} Visuals belongs`);
	const lines = found.body.split('\n');
	const firstAt = lines.findIndex((l) => l.trim());
	const first = lines[firstAt];
	const lead = [];
	if (!first || /^\s*(\||!\[|```|- |\*\*|#|<)/.test(first)) faults.push('Visuals: opens with no outcome sentence (what the change saves: dollars, time, or window room)');
	else for (let i = firstAt; i < lines.length && lines[i].trim(); i++) lead.push(lines[i]);
	if (found.body.includes('<why>')) faults.push('Visuals: a <why> line is still open');
	if (PRIVATE.test(found.body)) faults.push('Visuals: holds a home folder, an email or a token');
	// Every table line is read, indented or not, and only one table may sit in the section.
	const headers = lines.filter((l) => l.trim() === HEADER).length;
	if (!headers) faults.push(`Visuals: no table with the header ${HEADER}`);
	if (headers > 1) faults.push('Visuals: more than one table');
	const rows = lines.filter((l) => /^\s*\|/.test(l) && l.trim() !== HEADER && !/^\s*\|[\s|:-]+\|\s*$/.test(l)).map((l) => l.trim().split('|').slice(1, -1).map((c) => c.trim()));
	if (rows.length > MAX_ROWS) faults.push(`Visuals: ${rows.length} rows, over ${MAX_ROWS}`);
	const shown = new Set();
	// A number ends at its last digit: "(650,000, then" names 650,000.
	const NUM = /\$?\d(?:[\d,]*\d)?(?:\.\d+)?%?/g;
	const add = (s) => { for (const n of String(s).match(NUM) || []) shown.add(n.replace(/^\$|%$/g, '')); };
	rows.forEach(([metric, before, after, change, limit, source], i) => {
		const b = parseValue(before);
		const a = parseValue(after);
		[metric, before, after, change, limit, source].forEach(add);
		if (change) add(change.replace(/^[+-]/, ''));
		if (!b || !a || b.unit !== a.unit) { faults.push(`Visuals: row ${i + 1} (${metric}): before and after are not one unit`); return; }
		const want = changeText(b.v, a.v, b.unit);
		if (change !== want) faults.push(`Visuals: row ${i + 1} (${metric}): change is ${want}, not ${change}`);
		if (!/^(measured|derived): \S/.test(source || '')) faults.push(`Visuals: row ${i + 1} (${metric}): source starts measured: or derived:`);
		if (!lines.some((l) => l.startsWith(`- **${metric}:** `))) faults.push(`Visuals: no why line for ${metric}`);
		// A derived row is recomputed from the tokens row above it that shares its metric's name.
		const tokensRow = rows.slice(0, i).reverse().find((r) => r[0].split(':')[0] === metric.split(':')[0] && parseValue(r[1])?.unit === '');
		const t = tokensRow && [parseValue(tokensRow[1]).v, parseValue(tokensRow[2]).v];
		const cost = /^derived: tokens x \$([\d.]+) per million input tokens/.exec(source || '');
		const n = /cost per ([\d,]+) /.exec(metric);
		if (cost && n && t) {
			const usd = (x) => round(x * Number(n[1].replace(/,/g, '')) * Number(cost[1]) / 1e6, 2);
			if (usd(t[0]) !== b.v || usd(t[1]) !== a.v) faults.push(`Visuals: row ${i + 1} (${metric}): tokens x price gives ${fmt(usd(t[0]), '$')} to ${fmt(usd(t[1]), '$')}`);
		}
		const w = /^derived: tokens \/ (?:([\d,]+)-token window|the window at each commit \(([\d,]+), then ([\d,]+)\))/.exec(source || '');
		if (w && t) {
			const [wb, wa] = (w[1] ? [w[1], w[1]] : [w[2], w[3]]).map((x) => Number(x.replace(/,/g, '')));
			const sb = round(t[0] / wb * 100, 2);
			const sa = round(t[1] / wa * 100, 2);
			if (sb !== b.v || sa !== a.v) faults.push(`Visuals: row ${i + 1} (${metric}): tokens / window gives ${fmt(sb, '%')} to ${fmt(sa, '%')}`);
		}
		if ((cost || w) && !t) faults.push(`Visuals: row ${i + 1} (${metric}): a derived row with no tokens row above it`);
	});
	// The outcome sentence says only numbers the rows show (a value, a change, a limit, a price or a window).
	const said = lead.join(' ').match(NUM) || [];
	for (const s of said) if (!shown.has(s.replace(/^\$|%$/g, ''))) faults.push(`Visuals: the outcome sentence names ${s}, which no row shows`);
	const fenceAt = lines.indexOf('```text');
	if (fenceAt < 0) faults.push('Visuals: no chart (a ```text block of bars)');
	else {
		const chart = lines.slice(fenceAt + 1, lines.indexOf('```', fenceAt + 1));
		if (chart.some((l) => (l.match(/#/g) || []).length > BAR)) faults.push(`Visuals: a chart bar runs past ${BAR} columns`);
		if (chart.filter((l) => l.includes('#')).length > 3) faults.push('Visuals: more than 3 chart bars');
	}
	// No image but the pinned chart, no HTML image, no link (a tracking pixel or an outside host).
	let images = 0;
	for (const l of lines) {
		if (/<img\b/i.test(l)) faults.push('Visuals: an HTML image; the chart is a markdown image of this repo\'s pinned file');
		if (!/!\[|\]\(|\]\[|https?:\/\//i.test(l)) continue;
		const img = CHART_LINE.exec(l.trim());
		if (!img) { faults.push('Visuals: a link or image other than the chart image pinned to a full commit under docs/visuals/'); continue; }
		images++;
		if (opts.repo && `${img[3]}/${img[4]}`.toLowerCase() !== opts.repo.toLowerCase()) faults.push(`Visuals: the chart image comes from ${img[3]}/${img[4]}, not this repo (${opts.repo})`);
		rows.forEach(([, before, after], i) => { if (!img[1].includes(before) || !img[1].includes(after)) faults.push(`Visuals: the chart's alt text names no number of row ${i + 1}`); });
	}
	if (images > 1) faults.push('Visuals: more than one chart image');
	// The section is off the body's word ceilings, so its own prose is capped: the sentence and the why lines.
	const prose = lines.filter((l, i) => !/^\s*\|/.test(l) && !CHART_LINE.test(l.trim()) && !(fenceAt >= 0 && i >= fenceAt && i <= lines.indexOf('```', fenceAt + 1)));
	const words = prose.join(' ').split(/\s+/).filter(Boolean).length;
	if (words > MAX_PROSE_WORDS) faults.push(`Visuals: ${words} words of prose, over ${MAX_PROSE_WORDS}`);
	return faults;
}

// The repo the chart image must come from: origin's owner and name, on GitHub.
export function repoOf(url) {
	const m = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(String(url || '').trim());
	return m ? `${m[1]}/${m[2]}` : null;
}

// The chart as an image: one panel per row, drawn as SVG and rendered to PNG by the machine's own Edge or Chrome
// (no new dependency). The thread never opens the image; the owner sees it on the PR.
function svg(title, rows) {
	const W = 760, PH = 92, padL = 16, barX = 92, barW = 520;
	const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
	const titleLines = wrap(title).replace(/\n/g, ' ').match(/.{1,86}(\s|$)/g) || [title];
	const top = 30 + titleLines.length * 20;
	const H = top + rows.length * PH + 14;
	const c = { bg: '#ffffff', fg: '#1c211e', muted: '#5b655f', before: '#b8c4bc', after: '#2f5d46', limit: '#b4442f', good: '#1f7a4a' };
	let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, Arial, sans-serif"><rect width="${W}" height="${H}" fill="${c.bg}"/>`;
	titleLines.forEach((t, i) => { s += `<text x="${padL}" y="${30 + i * 20}" font-size="16" font-weight="600" fill="${c.fg}">${esc(t.trim())}</text>`; });
	rows.forEach((m, i) => {
		const y = top + i * PH;
		const max = Math.max(m.before, m.after, m.limit || 0) * 1.05;
		const x = (v) => barX + (v / max) * barW;
		const d = m.after - m.before;
		s += `<text x="${padL}" y="${y + 16}" font-size="14" font-weight="600" fill="${c.fg}">${esc(m.metric)}</text>`;
		s += `<text x="${W - padL}" y="${y + 16}" font-size="14" font-weight="600" text-anchor="end" fill="${d < 0 ? c.good : c.limit}">${esc(changeText(m.before, m.after, m.unit))}</text>`;
		if (m.limit) {
			const lx = x(m.limit).toFixed(1);
			s += `<line x1="${lx}" y1="${y + 22}" x2="${lx}" y2="${y + 76}" stroke="${c.limit}" stroke-width="2" stroke-dasharray="4 3"/>`;
			s += `<text x="${lx}" y="${y + 88}" font-size="11" text-anchor="middle" fill="${c.limit}">limit ${esc(fmt(m.limit, m.unit))}</text>`;
		}
		[['Before', m.before, c.before, 26], ['After', m.after, c.after, 52]].forEach(([lab, v, col, off]) => {
			s += `<text x="${padL}" y="${y + off + 14}" font-size="12" fill="${c.muted}">${lab}</text><rect x="${barX}" y="${y + off}" width="${(x(v) - barX).toFixed(1)}" height="20" rx="3" fill="${col}"/>`;
			// The value sits on a white band, so a limit line behind it never strikes through the number.
			s += `<rect x="${(x(v) + 4).toFixed(1)}" y="${y + off}" width="${fmt(v, m.unit).length * 8 + 8}" height="20" fill="${c.bg}"/>`;
			s += `<text x="${(x(v) + 8).toFixed(1)}" y="${y + off + 15}" font-size="13" fill="${c.fg}">${esc(fmt(v, m.unit))}</text>`;
		});
	});
	return { text: s + '</svg>', height: H };
}
function browser() {
	const pick = process.env.VISUALS_BROWSER;
	if (pick === 'none') return null;
	const known = [pick, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
		'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
	return known.find((p) => p && fs.existsSync(p)) || null;
}

function main(args) {
	const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
	const [base, head] = args;
	if (!base || !head || /^-/.test(base) || /^-/.test(head)) { console.log('usage: node .claude/visuals.mjs <base> <head> [--config <file>] [--body <file>] [--level ###|##] [--before "<line>"] [--fold] [--out <dir>]'); return 2; }
	// git reads the repo this runs in with -C, from node's own folder: started there, a git.exe in it would run (K214).
	const git = (...a) => safeSpawn.gitRead(process.cwd(), a, { encoding: 'utf8', maxBuffer: 64 << 20 });
	const cfgFile = opt('--config', '.kit/visuals.json');
	let cfg;
	try { cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch (e) { console.log(`visuals: cannot read ${cfgFile}: ${e.message}`); return 1; }
	const bad = configFaults(cfg);
	if (bad.length) { console.log(['visuals: the config is refused, nothing measured:', ...bad.map((f) => `  ${f}`)].join('\n')); return 1; }
	const full = (rev) => git('rev-parse', '--verify', '--end-of-options', `${rev}^{commit}`).stdout.trim();
	const [baseSha, headSha] = [full(base), full(head)];
	if (!baseSha || !headSha) { console.log(`visuals: ${!baseSha ? base : head} is not a commit here`); return 1; }
	// A typed number counts only for the two commits it was measured at.
	const stale = [];
	for (const m of cfg.metrics) for (const x of [m.paths ? null : m, m.tokens].filter(Boolean)) {
		const [b, h] = x.measuredAt.map(full);
		if (b !== baseSha || h !== headSha) stale.push(`  ${m.name}: measured at ${x.measuredAt.join(' and ')}, not at ${base} and ${head}: measure it again on these two commits`);
	}
	if (stale.length) { console.log(['visuals: a typed number belongs to other commits, nothing written:', ...stale].join('\n')); return 1; }
	// Sizes from the object store: no checkout, no file read, one call per commit.
	const sizes = (sha) => {
		const r = git('ls-tree', '-r', '-l', sha);
		const out = new Map();
		for (const l of r.stdout.split('\n')) { const m = /^\d+ blob \w+\s+(\d+)\t(.+)$/.exec(l); if (m) out.set(m[2], Number(m[1])); }
		return out;
	};
	const built = buildRows(cfg, [sizes(baseSha), sizes(headSha)], [baseSha.slice(0, 7), headSha.slice(0, 7)]);
	const level = opt('--level', '###');
	const fold = args.includes('--fold');
	const bodyFile = opt('--body');
	const report = [`visuals: ${built.moved.length} of ${built.all.length} tracked metrics moved (${built.all.length - built.moved.length} under ${(cfg.threshold ?? 0.01) * 100}%: left out)`];
	const without = (body) => { for (const f of locateAll(body).reverse()) body = body.slice(0, f.start).trimEnd() + '\n' + body.slice(f.end); return body; };
	if (!built.moved.length) {
		// A section from an earlier run goes, so the body never shows numbers that no longer moved.
		if (bodyFile) { const b = fs.readFileSync(bodyFile, 'utf8').replace(/\r\n/g, '\n'); if (locateAll(b).length) fs.writeFileSync(bodyFile, without(b).trimEnd() + '\n'); }
		console.log([...report, 'no Visuals section: nothing moved'].join('\n'));
		return 0;
	}
	if (built.rows.length > MAX_ROWS) { console.log([...report, `visuals: ${built.rows.length} rows, over ${MAX_ROWS}: track fewer metrics, or fewer impacts per metric`].join('\n')); return 1; }
	// The section checks itself before any file is written.
	const own = checkSection(section(built, { level, fold }), level).filter((f) => !f.includes('<why>'));
	if (own.length) { console.log(['visuals: the section failed its own check, nothing written:', ...own].join('\n')); return 1; }
	// The chart files go to a folder per branch (its name's parts as folders), so two PRs never write one path.
	const branch = git('rev-parse', '--abbrev-ref', 'HEAD').stdout.trim().split('/').map((p) => p.replace(/[^\w.-]+/g, '-').replace(/^\.+/, '_')).join('/') || 'detached';
	const out = opt('--out', `docs/visuals/${branch}`);
	fs.mkdirSync(out, { recursive: true });
	const svgFile = path.join(out, 'chart.svg');
	const pngFile = path.join(out, 'chart.png');
	const drawn = svg(built.sentence, built.rows);
	fs.writeFileSync(svgFile, drawn.text);
	const exe = browser();
	if (exe) spawnSync(exe, ['--headless', '--disable-gpu', '--hide-scrollbars', `--screenshot=${path.resolve(pngFile)}`, `--window-size=760,${drawn.height}`, pathToFileURL(path.resolve(svgFile)).href], { timeout: 60000 });
	// The image is linked at the last commit that holds it, a full commit id, and only while that commit holds this very
	// file: a chart drawn since then is committed first. The repo is origin's, never a typed one.
	let image = null;
	let note = '';
	const rel = path.relative(git('rev-parse', '--show-toplevel').stdout.trim() || '.', path.resolve(pngFile)).split(path.sep).join('/');
	const repo = repoOf(git('remote', 'get-url', 'origin').stdout);
	if (fs.existsSync(pngFile)) {
		const at = git('log', '-1', '--format=%H', '--', pngFile).stdout.trim();
		const same = at && git('rev-parse', `${at}:${rel}`).stdout.trim() === git('hash-object', '--', pngFile).stdout.trim();
		if (!repo) note = '; origin is not a GitHub repo, so no image is linked';
		else if (!same) note = `; commit ${rel}, then run again to link it`;
		else {
			const alt = built.rows.map((r) => `${r.metric} ${fmt(r.before, r.unit)} to ${fmt(r.after, r.unit)}`).join('; ');
			image = `![Chart: ${alt}](https://github.com/${repo}/raw/${at}/${rel})`;
		}
	}
	const text = section(built, { level, fold, image });
	if (bodyFile) {
		const body = without(fs.readFileSync(bodyFile, 'utf8').replace(/\r\n/g, '\n'));
		const anchor = opt('--before');
		const i = anchor ? body.indexOf(`\n${anchor}\n`) : -1;
		fs.writeFileSync(bodyFile, i >= 0 ? `${body.slice(0, i).trimEnd()}\n\n${text}${body.slice(i)}` : `${body.trimEnd()}\n\n${text}`);
	} else console.log(text);
	for (const r of built.rows) report.push(`  ${r.metric.padEnd(48)} ${fmt(r.before, r.unit).padStart(10)} to ${fmt(r.after, r.unit).padStart(10)}`);
	report.push(`chart: ${svgFile.split(path.sep).join('/')}; png ${exe ? (fs.existsSync(pngFile) ? 'rendered' : 'not rendered') : 'not rendered (no Edge or Chrome found)'}${image ? '; image linked' : note}`);
	const open = built.rows.filter((r) => !r.why).length;
	report.push(`${bodyFile ? `section written to ${path.basename(bodyFile)}; ` : ''}fill ${open} <why> line${open === 1 ? '' : 's'}`);
	console.log(report.join('\n'));
	return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
