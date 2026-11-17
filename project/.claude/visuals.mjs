#!/usr/bin/env node
// The Visuals section (rule:pr-body, rule:release-notes; K125, the owner 2026-11-17): a PR body or release note that
// says a number moved shows it, and leads with what it changes for a person. One command does the work a script can:
// it measures the tracked metrics on two commits (sizes from git, never a checkout), keeps what moved, derives the
// chain (tokens, then dollars and context-window room), draws the chart and writes the section into the body file.
// The thread writes one why line per row; nothing else. The same file checks a section, for the PR and release audits.
//
// Usage: node .claude/visuals.mjs <base> <head> [--config .kit/visuals.json] [--body <file>] [--level ###|##]
//        [--before "## Upgrading"] [--fold] [--out docs/visuals/<branch>]
// The config: { threshold, price: { perMTok, date }, window, sessions, linkBase, metrics: [{ name, paths | before,
// after, unit, source; limit; impact: [cost | time | room]; tokens: { before, after, source } }] }
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const IMPACTS = ['cost', 'time', 'room'];
const MAX_ROWS = 6;
const BAR = 40;
export const HEADER = '| Metric | Before | After | Change | Limit | Source |';
const UNIT_WORD = { B: 'bytes', '': 'tokens', $: 'dollars', s: 'seconds', '%': 'percent of the window' };

// Max's outcome rule (DESIGN 0a): every metric names the outcome it drives, so a size never appears alone. A token
// count is measured (a session's context report, the free counting call); bytes divided by a ratio were 30% low.
export function configFaults(cfg) {
	const out = [];
	const metrics = Array.isArray(cfg && cfg.metrics) ? cfg.metrics : [];
	if (!metrics.length) out.push('no metrics: list what the project tracks');
	for (const m of metrics) {
		const n = m.name || '(unnamed)';
		if (!m.name) out.push('a metric has no name');
		if (!m.paths && (typeof m.before !== 'number' || typeof m.after !== 'number')) out.push(`${n}: give paths, or a measured before and after`);
		if (!m.paths && !m.source) out.push(`${n}: a measured number names its source`);
		const impact = Array.isArray(m.impact) ? m.impact : [];
		if (!impact.length) { out.push(`${n}: names no impact (cost, time or room): a size never appears alone`); continue; }
		for (const i of impact) if (!IMPACTS.includes(i)) out.push(`${n}: impact "${i}" is not cost, time or room`);
		const t = m.tokens;
		const tokens = m.unit === 'tokens' || (t && typeof t.before === 'number' && typeof t.after === 'number' && t.source);
		for (const i of ['cost', 'room']) if (impact.includes(i) && !tokens) out.push(`${n}: ${i} needs measured tokens (tokens: { before, after, source }); bytes are never divided into tokens`);
		if (impact.includes('cost') && !(cfg.price && cfg.price.perMTok > 0 && cfg.price.date)) out.push(`${n}: cost needs a price ({ perMTok, date })`);
		if (impact.includes('room') && !(cfg.window > 0)) out.push(`${n}: room needs the context window in tokens`);
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
	if (unit === '%') return `${sign}${Math.abs(round(d, 2)).toFixed(2)} pt`;
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
		: { ...m, unit: m.unit === 'tokens' ? '' : (m.unit ?? ''), source: `measured: ${m.source}` }));
	const moved = all.filter((m) => m.before && Math.abs(m.after - m.before) / m.before >= threshold);
	const rows = [];
	const outcomes = [];
	for (const m of moved) {
		rows.push({ metric: m.name, before: m.before, after: m.after, unit: m.unit, limit: m.limit ?? null, source: m.source, why: null });
		const t = m.unit === '' && !m.paths ? { before: m.before, after: m.after } : m.tokens;
		const parts = [];
		if (t && m.paths) {
			rows.push({ metric: `${m.name}: tokens per session start`, before: t.before, after: t.after, unit: '', limit: null, source: `measured: ${t.source}`, why: `follows from the ${m.name} size.` });
		}
		// A file's tokens are its share of the start, named as such: the whole start-up load can move less than one file.
		if (t) {
			const d = t.after - t.before;
			const n = `${Math.abs(d).toLocaleString('en-US')} ${d < 0 ? 'fewer' : 'more'} tokens`;
			parts.push(m.paths ? `${m.name} loads ${n} at each session start` : `Every session starts with ${n}`);
		}
		if (m.unit === 's') { const d = m.after - m.before; parts.push(`${m.name} takes ${Math.abs(d).toLocaleString('en-US')} s ${d < 0 ? 'less' : 'more'}`); }
		if (m.impact.includes('cost')) {
			const usd = (n) => round(n * sessions * cfg.price.perMTok / 1e6, 2);
			const r = { metric: `${m.name}: cost per ${sessions.toLocaleString('en-US')} sessions`, before: usd(t.before), after: usd(t.after), unit: '$', limit: null, source: `derived: tokens x $${cfg.price.perMTok}/MTok input (${cfg.price.date})`, why: 'follows from tokens at the input price, before any cache discount.' };
			rows.push(r);
			const d = round(r.after - r.before, 2);
			parts.push(`$${Math.abs(d).toFixed(2)} ${d < 0 ? 'less' : 'more'} per ${sessions.toLocaleString('en-US')} sessions`);
		}
		if (m.impact.includes('room')) {
			const share = (n) => round(n / cfg.window * 100, 2);
			rows.push({ metric: `${m.name}: window used at start`, before: share(t.before), after: share(t.after), unit: '%', limit: null, source: `derived: tokens / ${cfg.window.toLocaleString('en-US')}-token window`, why: 'follows from tokens: less loaded at start leaves more room before the session compacts.' });
			// From the shares the table shows, so the sentence and the row's change never differ.
			const pt = Math.abs(round(share(t.after) - share(t.before), 2));
			parts.push(`${pt.toFixed(2)} points ${t.after < t.before ? 'more' : 'less'} of the window free`);
		}
		if (parts.length) outcomes.push(parts);
	}
	// The outcome sentence: the first metric's chain, its lead part, then the rest ("a, b, and c").
	const lead = outcomes[0] || [];
	const rest = lead.slice(1);
	const sentence = !lead.length ? '' : rest.length ? `${lead[0]}: ${rest.length > 1 ? rest.slice(0, -1).join(', ') + ', and ' + rest[rest.length - 1] : rest[0]}.` : `${lead[0]}.`;
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

// The section in a body: under its heading up to the next heading of the same or a higher level, or inside a fold
// whose summary starts "Visuals:". No comment markers: the release audit reads "<!--" as a double hyphen.
function locate(text, level) {
	const fold = /(^|\n)<details>\n<summary>Visuals:[^\n]*<\/summary>\n([\s\S]*?)\n<\/details>\n?/.exec(text);
	if (fold) return { start: fold.index + fold[1].length, end: fold.index + fold[0].length, body: fold[2] };
	const head = new RegExp(`(^|\\n)${level} Visuals\\n([\\s\\S]*?)(?=\\n#{1,${level.length}} |$)`).exec(text);
	if (head) return { start: head.index + head[1].length, end: head.index + head[0].length, body: head[2] };
	return null;
}

// The checks the audits run (DESIGN 6), and the writer runs on its own output: the numbers recomputed, the chart
// bounded, every row given its why, an image pinned to a full commit under docs/visuals/ and named in its alt text.
export function checkSection(text, level = '###') {
	const found = locate(String(text).replace(/\r\n/g, '\n'), level);
	if (!found) return [];
	const faults = [];
	const lines = found.body.split('\n');
	const first = lines.find((l) => l.trim());
	if (!first || /^\s*(\||!\[|```|- |\*\*|#|<)/.test(first)) faults.push('Visuals: opens with no outcome sentence (what the change saves: dollars, time, or window room)');
	if (found.body.includes('<why>')) faults.push('Visuals: a <why> line is still open');
	const at = lines.indexOf(HEADER);
	const rows = [];
	if (at < 0) faults.push(`Visuals: no table with the header ${HEADER}`);
	else for (let i = at + 2; i < lines.length && lines[i].startsWith('|'); i++) rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim()));
	if (rows.length > MAX_ROWS) faults.push(`Visuals: ${rows.length} rows, over ${MAX_ROWS}`);
	rows.forEach(([metric, before, after, change, , source], i) => {
		const b = parseValue(before);
		const a = parseValue(after);
		if (!b || !a || b.unit !== a.unit) { faults.push(`Visuals: row ${i + 1} (${metric}): before and after are not one unit`); return; }
		const want = changeText(b.v, a.v, b.unit);
		if (change !== want) faults.push(`Visuals: row ${i + 1} (${metric}): change is ${want}, not ${change}`);
		if (!/^(measured|derived): \S/.test(source || '')) faults.push(`Visuals: row ${i + 1} (${metric}): source starts measured: or derived:`);
		if (!lines.some((l) => l.startsWith(`- **${metric}:** `))) faults.push(`Visuals: no why line for ${metric}`);
	});
	const fenceAt = lines.indexOf('```text');
	if (fenceAt < 0) faults.push('Visuals: no chart (a ```text block of bars)');
	else {
		const chart = lines.slice(fenceAt + 1, lines.indexOf('```', fenceAt + 1));
		if (chart.some((l) => (l.match(/#/g) || []).length > BAR)) faults.push(`Visuals: a chart bar runs past ${BAR} columns`);
		if (chart.filter((l) => l.includes('#')).length > 3) faults.push('Visuals: more than 3 chart bars');
	}
	for (const l of lines) {
		const img = /^!\[([^\]]*)\]\(([^)\s]*)\)/.exec(l.trim());
		if (!img) continue;
		if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/raw\/[0-9a-f]{40}\/docs\/visuals\/[\w./-]+\.(png|svg)$/.test(img[2])) faults.push('Visuals: the chart image must link a full commit under docs/visuals/ in this repo');
		rows.forEach(([, before, after], i) => { if (!img[1].includes(before) || !img[1].includes(after)) faults.push(`Visuals: the chart's alt text names no number of row ${i + 1}`); });
	}
	return faults;
}

// The chart as an image: one panel per row, drawn as SVG and rendered to PNG by the machine's own Edge or Chrome
// (no new dependency). The thread never opens the image; the owner sees it on the PR.
function svg(title, rows) {
	const W = 760, PH = 92, top = 52, padL = 16, barX = 92, barW = 520;
	const H = top + rows.length * PH + 14;
	const c = { bg: '#ffffff', fg: '#1c211e', muted: '#5b655f', before: '#b8c4bc', after: '#2f5d46', limit: '#b4442f', good: '#1f7a4a' };
	const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
	let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, Arial, sans-serif"><rect width="${W}" height="${H}" fill="${c.bg}"/>`;
	s += `<text x="${padL}" y="30" font-size="16" font-weight="600" fill="${c.fg}">${esc(title)}</text>`;
	rows.forEach((m, i) => {
		const y = top + i * PH;
		const max = Math.max(m.before, m.after, m.limit || 0) * 1.05;
		const x = (v) => barX + (v / max) * barW;
		const d = m.after - m.before;
		s += `<text x="${padL}" y="${y + 16}" font-size="14" font-weight="600" fill="${c.fg}">${esc(m.metric)}</text>`;
		s += `<text x="${W - padL}" y="${y + 16}" font-size="14" font-weight="600" text-anchor="end" fill="${d < 0 ? c.good : c.limit}">${esc(changeText(m.before, m.after, m.unit))}</text>`;
		if (m.limit) s += `<line x1="${x(m.limit).toFixed(1)}" y1="${y + 22}" x2="${x(m.limit).toFixed(1)}" y2="${y + 76}" stroke="${c.limit}" stroke-width="2" stroke-dasharray="4 3"/>`;
		[['Before', m.before, c.before, 26], ['After', m.after, c.after, 52]].forEach(([lab, v, col, off]) => {
			s += `<text x="${padL}" y="${y + off + 14}" font-size="12" fill="${c.muted}">${lab}</text><rect x="${barX}" y="${y + off}" width="${(x(v) - barX).toFixed(1)}" height="20" rx="3" fill="${col}"/>`;
			s += `<text x="${(x(v) + 8).toFixed(1)}" y="${y + off + 15}" font-size="13" fill="${c.fg}">${esc(fmt(v, m.unit))}</text>`;
		});
	});
	return s + '</svg>';
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
	const git = (...a) => spawnSync('git', ['-c', 'core.fsmonitor=false', ...a], { encoding: 'utf8', maxBuffer: 64 << 20 });
	const cfgFile = opt('--config', '.kit/visuals.json');
	let cfg;
	try { cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch (e) { console.log(`visuals: cannot read ${cfgFile}: ${e.message}`); return 1; }
	const bad = configFaults(cfg);
	if (bad.length) { console.log(['visuals: the config is refused, nothing measured:', ...bad.map((f) => `  ${f}`)].join('\n')); return 1; }
	// Sizes from the object store: no checkout, no file read, one call per commit.
	const sizes = (rev) => {
		const r = git('ls-tree', '-r', '-l', rev);
		if (r.status !== 0) throw new Error(`git ls-tree ${rev}: ${r.stderr.trim()}`);
		const out = new Map();
		for (const l of r.stdout.split('\n')) { const m = /^\d+ blob \w+\s+(\d+)\t(.+)$/.exec(l); if (m) out.set(m[2], Number(m[1])); }
		return out;
	};
	const short = (rev) => git('rev-parse', '--short=7', `${rev}^{commit}`).stdout.trim();
	const built = buildRows(cfg, [sizes(base), sizes(head)], [short(base), short(head)]);
	const report = [`visuals: ${built.moved.length} of ${built.all.length} tracked metrics moved (${built.all.length - built.moved.length} under ${(cfg.threshold ?? 0.01) * 100}%: left out)`];
	if (!built.moved.length) { console.log([...report, 'no Visuals section: nothing moved'].join('\n')); return 0; }
	if (built.rows.length > MAX_ROWS) { console.log([...report, `visuals: ${built.rows.length} rows, over ${MAX_ROWS}: raise the threshold or track fewer metrics`].join('\n')); return 1; }
	// The chart files go to a folder per branch, so two PRs never write one path.
	const branch = git('rev-parse', '--abbrev-ref', 'HEAD').stdout.trim().replace(/[^\w.-]+/g, '-') || 'detached';
	const out = opt('--out', `docs/visuals/${branch}`);
	fs.mkdirSync(out, { recursive: true });
	const svgFile = path.join(out, 'chart.svg');
	const pngFile = path.join(out, 'chart.png');
	fs.writeFileSync(svgFile, svg(built.sentence, built.rows));
	const exe = browser();
	if (exe) spawnSync(exe, ['--headless', '--disable-gpu', '--hide-scrollbars', `--screenshot=${path.resolve(pngFile)}`, `--window-size=760,${52 + built.rows.length * 92 + 14}`, pathToFileURL(path.resolve(svgFile)).href], { timeout: 60000 });
	// The image is linked at the last commit that holds it, a full commit id, never a branch or tag that can move.
	let image = null;
	const at = fs.existsSync(pngFile) && git('log', '-1', '--format=%H', '--', pngFile).stdout.trim();
	if (at && cfg.linkBase) {
		const alt = built.rows.map((r) => `${r.metric} ${fmt(r.before, r.unit)} to ${fmt(r.after, r.unit)}`).join('; ');
		image = `![Chart: ${alt}](${cfg.linkBase.replace(/\/?$/, '/')}raw/${at}/${pngFile.split(path.sep).join('/')})`;
	}
	const level = opt('--level', '###');
	const fold = args.includes('--fold');
	const text = section(built, { level, fold, image });
	const own = checkSection(text, level).filter((f) => !f.includes('<why>'));
	if (own.length) { console.log(['visuals: the section failed its own check:', ...own].join('\n')); return 1; }
	const bodyFile = opt('--body');
	if (bodyFile) {
		let body = fs.readFileSync(bodyFile, 'utf8').replace(/\r\n/g, '\n');
		const old = locate(body, level);
		if (old) body = body.slice(0, old.start).trimEnd() + '\n' + body.slice(old.end);
		const anchor = opt('--before');
		const i = anchor ? body.indexOf(`\n${anchor}\n`) : -1;
		fs.writeFileSync(bodyFile, i >= 0 ? `${body.slice(0, i).trimEnd()}\n\n${text}${body.slice(i)}` : `${body.trimEnd()}\n\n${text}`);
	} else console.log(text);
	for (const r of built.rows) report.push(`  ${r.metric.padEnd(48)} ${fmt(r.before, r.unit).padStart(10)} to ${fmt(r.after, r.unit).padStart(10)}`);
	report.push(`chart: ${svgFile.split(path.sep).join('/')}; png ${exe ? (fs.existsSync(pngFile) ? 'rendered' : 'not rendered') : 'not rendered (no Edge or Chrome found)'}${fs.existsSync(pngFile) && !image ? `; commit ${pngFile.split(path.sep).join('/')}${cfg.linkBase ? '' : ' and set linkBase'}, then run again to link it` : ''}`);
	const open = built.rows.filter((r) => !r.why).length;
	report.push(`${bodyFile ? `section written to ${path.basename(bodyFile)}; ` : ''}fill ${open} <why> line${open === 1 ? '' : 's'}`);
	console.log(report.join('\n'));
	return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
