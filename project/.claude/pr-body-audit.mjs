import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { carriesPhrase } from './canary-phrase.mjs';
import { versionBumpCheck } from './version-bump-check.mjs';
import { attributionFaults, entities } from './no-attribution.mjs';
import { checkSection, locateAll, CHART_LINE, repoOf } from './visuals.mjs';

// The large-PR body audit: a feature or large PR body that is detailed but not a text wall. The
// changes read as a before / after table; decisions and the review stay on screen. T13 (the owner, 2026-11-10): what
// GitHub already shows (the file list on the Files tab, every gate on the Checks tab) is not repeated, and the review
// rows are the project's own (.kit/pr-body.json), so no row says "not touched".
// Small PRs (docs, chore, test, bump, a quality-of-life fix) keep their own short form: pr-body-audit-lean.mjs.
// // Usage: node .claude/pr-body-audit.mjs <body.md> "<title>"

const [file, title, number] = process.argv.slice(2);
// The squash subject on main is the title plus " (#n)": with no number yet, room is kept for four digits (K16).
const squash = title.length + (/^\d+$/.test(number || '') ? number.length + 4 : 8);

// The checks that are project facts - the review dimensions that apply to it, the wording its dependency audit must
// keep, the extra lines the review must name - come from .kit/pr-body.json (rule:pr-body; adapter A16):
//   { "dimensions": ["Code security", ...], "auditLine": "0 high", "verifiedClean": ["..."] }
// Without it, code security is the one dimension required; the secrets line is required always.
// No program the repo's git config names runs here (the K61 sweep).
const top = spawnSync('git', ['-c', 'core.fsmonitor=false', 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
const root = top.status === 0 ? top.stdout.trim() : process.cwd();
// The build 17 sweep: judging a PR (PR_BASE set, in CI), the file is read from the base, so a PR cannot set the rows
// its own body is held to.
const base = process.env.PR_BASE;
let project = {};
try {
	const raw = base
		? spawnSync('git', ['-c', 'core.fsmonitor=false', 'show', `${base}:.kit/pr-body.json`], { cwd: root, encoding: 'utf8' })
		: { status: 0, stdout: readFileSync(path.join(root, '.kit', 'pr-body.json'), 'utf8') };
	if (raw.status === 0) project = JSON.parse(raw.stdout) || {};
} catch { /* the defaults */ }
const DIMENSIONS = Array.isArray(project.dimensions) && project.dimensions.length ? project.dimensions : ['Code security'];
const AUDIT_LINE = typeof project.auditLine === 'string' && project.auditLine ? project.auditLine : null;
const CLEAN = ['secrets or account information in the diff', ...(Array.isArray(project.verifiedClean) ? project.verifiedClean : [])];
// Read as the page shows it: an entity (&#65;I) is the character it stands for.
const written = readFileSync(file, 'utf8');
const body = entities(written);
const lines = body.split(/\r?\n/);
const rows = [];
const row = (name, ok, detail) => rows.push({ name, ok, detail });
// 1.25.0 renamed the key; an old file would otherwise drop its rows to the default without a word.
if (project.gates !== undefined) row('.kit/pr-body.json: "gates" is now "dimensions"', false, 'rename the key');
const attribution = attributionFaults(written);
row('no attribution block', attribution.length === 0, attribution.join(', ') || 'none');
const norm = (s) => s.replace(/\s+/g, ' ');
const isTable = (l) => l.startsWith('|');
const isFoldTag = (l) => /^<\/?(details|summary)>/.test(l.trim());

// The text a reader sees before opening any fold: each <details> block shrinks to its <summary> line.
function visibleText(s) {
	let out = s;
	while (out.includes('<details>')) {
		const a = out.indexOf('<details>');
		const b = out.indexOf('</details>', a);
		if (b < 0) break;
		const summary = out.slice(a, b).match(/<summary>.*<\/summary>/)?.[0] ?? '';
		out = out.slice(0, a) + summary + out.slice(b + '</details>'.length);
	}
	return out;
}
const section = (name) => {
	const start = body.indexOf(`### ${name}`);
	if (start < 0) return '';
	const next = body.indexOf('\n### ', start + 4);
	return body.slice(start, next < 0 ? body.length : next);
};
const wordCount = (s) => s.split(/\s+/).filter(Boolean).length;

// The title is the squash commit's subject on main (T13, the owner: "type: subject"); the H1 leads with the area.
const subject = title.replace(/^[a-z]+(\([a-z0-9-]+\))?: /, '');
row('title is type: subject, at most 72 with the squash suffix', /^(feat|fix|refactor|test|docs|chore|security|perf)(\([a-z0-9-]+\))?: [a-z0-9`]/.test(title) && squash <= 72, `${title} (${squash} with the suffix)`);
row('H1 is <Area>: <line>, no type prefix', /^## [A-Z][A-Za-z ]+: [a-z]/.test(lines[0]) && !/^## (feat|fix|chore|security|docs)/.test(lines[0]), lines[0]);
row('H1 line carries the title subject', lines[0].endsWith(subject), `subject: ${subject}`);
// A heading whose area repeats the subject's first word reads twice ("Grants: grant ..."): the area names the part, the subject what changed.
const stem = (w) => String(w || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(es|s)$/, '');
const area = (/^## ([^:]+):/.exec(lines[0]) || [])[1] || '';
row('H1 area does not repeat the subject', !area || stem(area.split(/\s+/).pop()) !== stem(subject.split(/\s+/)[0]), `${area} / ${subject.split(/\s+/)[0] || ''}`);

// The Visuals chart image line is a link, not prose (K125); any other line, an image or not, keeps the limit.
const long = lines.map((l, i) => [i + 1, l]).filter(([, l]) => !isTable(l) && !CHART_LINE.test(l.trim()) && l.length > 110).map(([n, l]) => [n, l.length]);
row('every prose line <= 110 (tables exempt)', long.length === 0, long.length ? `over: ${JSON.stringify(long)}` : 'none over');

const nonAscii = [...body].filter((c) => c.charCodeAt(0) > 0x7e || (c.charCodeAt(0) < 0x20 && c !== '\n' && c !== '\r'));
row('0 non-ASCII characters', nonAscii.length === 0, `found ${nonAscii.length}`);

const banned = [/\bAI\b/, /\bagents?\b/i, /\bsubagents?\b/i, /\bclaude\b/i, /\banthropic\b/i, /\bswarm\b/i, /\bopus\b/i, /\bsonnet\b/i, /\bbuilders?\b/i, /\bcheckers?\b/i, /\bLLM\b/];
// K115 (1.42.0): a code span that quotes a path or a command (it holds a slash, a dot or a flag) is code, so its words
// pass; a span of bare words (`Claude Opus`) is still those words on the page (the 1.42.0 Visuals sweep).
// K125 (1.42.0): a file named in prose (AGENTS.md, .claude/x.mjs) is a name, not a word. Only a name with a file
// extension, or a path under a dot folder, is: "Claude/Opus" is two words (the Visuals sweep).
const codeSpan = (s) => /[/.]|(^|\s)-/.test(s.slice(1, -1));
const prose = (l) => l.replace(/`[^`]*`/g, (s) => (codeSpan(s) ? '``' : s))
	.replace(/(?:[\w~.-]*\/)*[\w-]+\.(md|mjs|cjs|js|json|ya?ml|txt|sh|ps1|py|ts|png|svg)\b|(?<![\w.])\.[a-z][\w-]*\/[\w./-]*/gi, ' ');
const bannedHits = banned.flatMap((re) => lines.flatMap((l, i) => (re.test(prose(l)) ? [`${re} @${i + 1}`] : [])));
row('no mechanism or AI words', bannedHits.length === 0, bannedHits.join(', ') || 'none');

const vault = /docs\/sweeps|docs\/superpowers|docs\/decisions|_Master|_Working|_Active|_Session|_Loop|\.claude\//;
const vaultHits = lines.flatMap((l, i) => (vault.test(l) ? [i + 1] : []));
row('no vault paths', vaultHits.length === 0, vaultHits.length ? `lines ${vaultHits}` : 'none');

const sections = lines.filter((l) => l.startsWith('### ')).map((l) => l.slice(4));
const wanted = ['Summary', 'Design decisions', 'Verification', 'Review'];
// K125: Visuals is the one optional fifth section, after Review, and its numbers are checked by the script that writes
// it (rule:pr-body).
row('the four ### sections, in order', [wanted, [...wanted, 'Visuals']].some((w) => JSON.stringify(sections) === JSON.stringify(w)), sections.join(' / '));
// The chart image must come from this repo: origin's owner and name.
const origin = spawnSync('git', ['-c', 'core.fsmonitor=false', '-C', root, 'remote', 'get-url', 'origin'], { encoding: 'utf8' });
const visualsFaults = checkSection(body.replace(/\r\n/g, '\n'), '###', { repo: repoOf(origin.stdout) });
const visualsSections = locateAll(body.replace(/\r\n/g, '\n'));
row('Visuals: numbers, chart and why lines check out', visualsFaults.length === 0, visualsFaults.join('; ') || (visualsSections.length ? 'checked' : 'no section'));

const framing = body.slice(body.indexOf('\n') + 1, body.indexOf('### Summary')).trim();
row('framing of 1-3 lines before Summary', framing.length > 0 && !framing.startsWith('#') && framing.split('\n').length <= 3, `${framing.split('\n').length} lines`);

// K139 (PR 53): a header with no rows passed; the table needs at least one row under its separator.
// CRLF line ends and a space after a row's last bar are a table still (the build 18 sweep).
const summaryRows = (/\n\| *Where *\| *Before *\| *After *\| *\n\|[-| :]+\|[ \t]*\n((?:\|.*\|[ \t]*\n?)+)/.exec(section('Summary').replace(/\r\n?/g, '\n') + '\n') || [])[1];
row('Summary is a before / after table', Boolean(summaryRows && summaryRows.trim()), summaryRows ? `${summaryRows.trim().split('\n').length} row(s)` : 'header | Where | Before | After | and at least one row');

const verification = section('Verification');
const verificationBullets = visibleText(verification).split('\n').filter((l) => l.startsWith('- ')).length;
row('Verification: at most 4 bullets on screen', verificationBullets > 0 && verificationBullets <= 4, `${verificationBullets} bullets`);
if (AUDIT_LINE) row('Verification: the audit line keeps its ignores', verification.includes(AUDIT_LINE), `dependency audit: ${AUDIT_LINE}`);

const review = section('Review');
const order = ['review of `', '| Dimension | Result |', '**High and critical findings:**', '**Deferred:**', '**Accepted risks:**', 'Version alignment: YES.'];
const at = order.map((s) => review.indexOf(s));
row('Review parts in order', at.every((n, i) => n > 0 && (i === 0 || n > at[i - 1])), JSON.stringify(at));
// The template's line is "<Tier> review of `<commit>`" (rule:sweep-tiers): a named tier is one the owner can correct.
// Only a parenthesis of modifiers may sit between the tier and "review of" (the build 13 sweep: "Feature flags stay off;
// a light review of" passed with no tier named).
const tierLine = /^(Feature|Fix|Triage|First push|Launch gate)(?: \([^)\n]*\))? review of `/m.exec(review);
row('Review names the sweep tier', Boolean(tierLine), tierLine ? tierLine[1] : 'start the review line with the tier: Feature, Fix, Triage, First push or Launch gate');
const dimRows = review.split('\n').filter((l) => l.startsWith('| ') && !/^\| *(Dimension|-+) *\|/.test(l)).map((l) => l.toLowerCase());
const missingDims = DIMENSIONS.filter((d) => !dimRows.some((l) => l.startsWith(`| ${d.toLowerCase()}`)));
row('Review has a row for each project dimension', missingDims.length === 0, missingDims.length ? `missing ${missingDims.join(', ')}` : `all ${DIMENSIONS.length}`);
const missingClean = CLEAN.filter((p) => !norm(review).toLowerCase().includes(p.toLowerCase()));
row('Review names secrets and the project lines', missingClean.length === 0, missingClean.length ? `missing: ${missingClean.join(' | ')}` : `all ${CLEAN.length}`);

const opens = (body.match(/<details>/g) ?? []).length;
const closes = (body.match(/<\/details>/g) ?? []).length;
const summaries = (body.match(/<summary>.+<\/summary>/g) ?? []).length;
// GitHub renders markdown inside a fold only after a blank line below its summary.
const blankAfter = lines.every((l, i) => !/<\/summary>$/.test(l.trim()) || lines[i + 1] === '');
row('every fold closes, has a summary and a blank line', opens === closes && opens === summaries && blankAfter, `${opens} open, ${closes} close, ${summaries} summaries`);

// Inline code (`node --flag`) and fenced code blocks are code, not a prose dash.
const inFence = lines.map(((open) => (l) => { if (/^\s*```/.test(l)) { open = !open; return true; } return open; })(false));
const dashed = lines.flatMap((l, i) => {
	if (isFoldTag(l) || inFence[i]) return [];
	const prose = l.replace(/`[^`]*`/g, '');
	if (isTable(l)) return /^\|[\s|:-]+\|$/.test(l.trim()) ? [] : / - /.test(prose) ? [i + 1] : [];
	return / - |--/.test(prose.replace(/^\s*- /, '')) ? [i + 1] : [];
});
row('no spaced dashes in prose', dashed.length === 0, dashed.length ? `lines ${dashed}` : 'none');

// A bullet with its wrapped continuation lines is one block; a long block is the start of a wall.
const blocks = [];
for (const l of lines) {
	if (/^ *- /.test(l)) blocks.push(l.trim());
	else if (/^  +[^ -]/.test(l) && blocks.length) blocks[blocks.length - 1] += ' ' + l.trim();
}
const BULLET_MAX = 240;
const longBullets = blocks.filter((b) => b.length > BULLET_MAX).map((b) => b.length);
row(`every bullet <= ${BULLET_MAX} chars`, longBullets.length === 0, longBullets.length ? `over: ${longBullets}` : `max ${Math.max(...blocks.map((b) => b.length))}`);

// Ceilings from measurement: the total came from three large bodies the owner accepted (about 1,450-1,500 words);
// the on-screen ceiling from the first body in this shape (about 800 words on screen). Re-set them after two
// large PRs in a new project have measured.
const TOTAL_MAX = 1550;
const VISIBLE_MAX = 850;
// The Visuals section has its own caps (6 rows, 3 bars, a why line per row), so it is left out of both ceilings.
// Only the one section the check reads comes off; its own prose cap holds it (the 1.42.0 Visuals sweep).
const one = visualsSections[0];
const flat = body.replace(/\r\n/g, '\n');
const counted = one ? flat.slice(0, one.start) + flat.slice(one.end) : flat;
const total = wordCount(counted);
const visible = wordCount(visibleText(counted));
row(`size: at most ${TOTAL_MAX} words in all`, total <= TOTAL_MAX, `${total} words`);
row(`size: at most ${VISIBLE_MAX} words on screen`, visible <= VISIBLE_MAX, `${visible} words`);

// The agents' confirmation phrase never goes out (rule:agent-canary).
row('no confirmation phrase', !carriesPhrase(body), 'rule:agent-canary');

// Shipped code needs a version bump, or the body says none is due (rule:release-notes).
const bump = versionBumpCheck(body);
row('version bumped, or no user-facing change', bump.ok, bump.detail);

for (const r of rows) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(46)} ${r.detail}`);
const passed = rows.every((r) => r.ok);
console.log(passed ? 'AUDIT PASSED' : 'AUDIT FAILED');
process.exitCode = passed ? 0 : 1;
