import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { carriesPhrase } from './canary-phrase.mjs';
import { versionBumpCheck } from './version-bump-check.mjs';
import { attributionFaults, entities } from './no-attribution.mjs';

// The large-PR body audit: a feature or large PR body that is detailed but not a text wall. The
// changes read as a before / after table; decisions and the review stay on screen. T13 (the owner, 2026-11-10): what
// GitHub already shows (the file list on the Files tab, every gate on the Checks tab) is not repeated, and the review
// rows are the project's own (.kit/pr-body.json), so no row says "not touched".
// Small PRs (docs, chore, test, bump, a quality-of-life fix) keep their own short form: pr-body-audit-lean.mjs.
// // Usage: node .claude/pr-body-audit.mjs <body.md> "<title>"

const [file, title] = process.argv.slice(2);

// The checks that are project facts - the review dimensions that apply to it, the wording its dependency audit must
// keep, the extra lines the review must name - come from .kit/pr-body.json (rule:pr-body; adapter A16):
//   { "dimensions": ["Code security", ...], "auditLine": "0 high", "verifiedClean": ["..."] }
// Without it, code security is the one dimension required; the secrets line is required always.
const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
const root = top.status === 0 ? top.stdout.trim() : process.cwd();
let project = {};
try { project = JSON.parse(readFileSync(path.join(root, '.kit', 'pr-body.json'), 'utf8')); } catch { /* the defaults */ }
const DIMENSIONS = Array.isArray(project.dimensions) && project.dimensions.length ? project.dimensions : ['Code security'];
const AUDIT_LINE = typeof project.auditLine === 'string' && project.auditLine ? project.auditLine : null;
const CLEAN = ['secrets or account information in the diff', ...(Array.isArray(project.verifiedClean) ? project.verifiedClean : [])];
// Read as the page shows it: an entity (&#65;I) is the character it stands for.
const written = readFileSync(file, 'utf8');
const body = entities(written);
const lines = body.split(/\r?\n/);
const rows = [];
const row = (name, ok, detail) => rows.push({ name, ok, detail });
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
const subject = title.replace(/^[a-z]+(\([a-z-]+\))?: /, '');
row('title is type: subject, at most 72', /^(feat|fix|refactor|test|docs|chore|security|perf)(\([a-z-]+\))?: [a-z]/.test(title) && title.length <= 72, title);
row('H1 is <Area>: <line>, no type prefix', /^## [A-Z][A-Za-z ]+: [a-z]/.test(lines[0]) && !/^## (feat|fix|chore|security|docs)/.test(lines[0]), lines[0]);
row('H1 line carries the title subject', lines[0].endsWith(subject), `subject: ${subject}`);

const long = lines.map((l, i) => [i + 1, l]).filter(([, l]) => !isTable(l) && l.length > 110).map(([n, l]) => [n, l.length]);
row('every prose line <= 110 (tables exempt)', long.length === 0, long.length ? `over: ${JSON.stringify(long)}` : 'none over');

const nonAscii = [...body].filter((c) => c.charCodeAt(0) > 0x7e || (c.charCodeAt(0) < 0x20 && c !== '\n' && c !== '\r'));
row('0 non-ASCII characters', nonAscii.length === 0, `found ${nonAscii.length}`);

const banned = [/\bAI\b/, /\bagents?\b/i, /\bsubagents?\b/i, /\bclaude\b/i, /\banthropic\b/i, /\bswarm\b/i, /\bopus\b/i, /\bsonnet\b/i, /\bbuilders?\b/i, /\bcheckers?\b/i, /\bLLM\b/];
const bannedHits = banned.flatMap((re) => lines.flatMap((l, i) => (re.test(l) ? [`${re} @${i + 1}`] : [])));
row('no mechanism or AI words', bannedHits.length === 0, bannedHits.join(', ') || 'none');

const vault = /docs\/sweeps|docs\/superpowers|docs\/decisions|_Master|_Working|_Active|_Session|_Loop|\.claude\//;
const vaultHits = lines.flatMap((l, i) => (vault.test(l) ? [i + 1] : []));
row('no vault paths', vaultHits.length === 0, vaultHits.length ? `lines ${vaultHits}` : 'none');

const sections = lines.filter((l) => l.startsWith('### ')).map((l) => l.slice(4));
const wanted = ['Summary', 'Design decisions', 'Verification', 'Review'];
row('the four ### sections, in order', JSON.stringify(sections) === JSON.stringify(wanted), sections.join(' / '));

const framing = body.slice(body.indexOf('\n') + 1, body.indexOf('### Summary')).trim();
row('framing of 1-3 lines before Summary', framing.length > 0 && !framing.startsWith('#') && framing.split('\n').length <= 3, `${framing.split('\n').length} lines`);

row('Summary is a before / after table', /\n\| *Where *\| *Before *\| *After *\|/.test(section('Summary')), 'header | Where | Before | After |');

const verification = section('Verification');
const verificationBullets = visibleText(verification).split('\n').filter((l) => l.startsWith('- ')).length;
row('Verification: at most 4 bullets on screen', verificationBullets > 0 && verificationBullets <= 4, `${verificationBullets} bullets`);
if (AUDIT_LINE) row('Verification: the audit line keeps its ignores', verification.includes(AUDIT_LINE), `dependency audit: ${AUDIT_LINE}`);

const review = section('Review');
const order = ['review of `', '| Dimension | Result |', '**High and critical findings:**', '**Deferred:**', '**Accepted risks:**', 'Version alignment: YES.'];
const at = order.map((s) => review.indexOf(s));
row('Review parts in order', at.every((n, i) => n > 0 && (i === 0 || n > at[i - 1])), JSON.stringify(at));
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
const total = wordCount(body);
const visible = wordCount(visibleText(body));
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
