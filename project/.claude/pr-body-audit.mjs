import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { carriesPhrase } from './canary-phrase.mjs';
import { versionBumpCheck } from './version-bump-check.mjs';

// The large-PR body audit: a feature or large PR body that is detailed but not a text wall. The
// changes read as a before / after table; decisions and the review stay on screen; the gate figures, the file
// list and the enumerated checks sit in folds (<details>), so nothing is cut and little is in the way.
// Small PRs (docs, chore, test, bump, a quality-of-life fix) keep their own short form: pr-body-audit-lean.mjs.
// // Usage: node .claude/pr-body-audit.mjs <body.md> "<title>"

const [file, title] = process.argv.slice(2);

// The checks that are project facts - which gates the project runs, the wording its dependency audit must keep, the
// extra lines "Verified clean" must name - come from .kit/pr-body.json (rule:pr-body; adapter A16):
//   { "gates": ["Dependency audit", ...], "auditLine": "0 high", "verifiedClean": ["..."] }
// Without it, the gates every project runs are required and nothing else; the secrets line is required always.
const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
const root = top.status === 0 ? top.stdout.trim() : process.cwd();
let project = {};
try { project = JSON.parse(readFileSync(path.join(root, '.kit', 'pr-body.json'), 'utf8')); } catch { /* the defaults */ }
const GATES = Array.isArray(project.gates) && project.gates.length ? project.gates : ['Dependency audit', 'Lint; type check', 'Unit'];
const AUDIT_LINE = typeof project.auditLine === 'string' && project.auditLine ? project.auditLine : null;
const CLEAN = ['secrets or account information in the diff', ...(Array.isArray(project.verifiedClean) ? project.verifiedClean : [])];
const body = readFileSync(file, 'utf8');
const lines = body.split(/\r?\n/);
const rows = [];
const row = (name, ok, detail) => rows.push({ name, ok, detail });
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

row('H1 equals the title', lines[0] === `## ${title}`, lines[0]);
row('title is <Area>: <line>', /^[A-Z][A-Za-z ]+: [a-z]/.test(title), title);

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
const wanted = ['Summary', 'Included', 'Design decisions', 'Verification', 'Review'];
row('the five ### sections, in order', JSON.stringify(sections) === JSON.stringify(wanted), sections.join(' / '));

const framing = body.slice(body.indexOf('\n') + 1, body.indexOf('### Summary')).trim();
row('framing of 1-3 lines before Summary', framing.length > 0 && !framing.startsWith('#') && framing.split('\n').length <= 3, `${framing.split('\n').length} lines`);

row('Summary is a before / after table', /\n\| *Where *\| *Before *\| *After *\|/.test(section('Summary')), 'header | Where | Before | After |');

row('Included sits in a fold', section('Included').includes('<details>'), section('Included').includes('<details>') ? 'folded' : 'not folded');

const verification = section('Verification');
const verificationBullets = visibleText(verification).split('\n').filter((l) => l.startsWith('- ')).length;
row('Verification: at most 4 bullets on screen', verificationBullets > 0 && verificationBullets <= 4, `${verificationBullets} bullets`);
const gateLabels = GATES;
const folded = verification.slice(verification.indexOf('<details>'));
const missingGates = gateLabels.filter((g) => !folded.includes(`| ${g} |`));
row('Verification: every gate in a folded table', verification.includes('<details>') && missingGates.length === 0, missingGates.length ? `missing ${missingGates.join(', ')}` : `${gateLabels.length} gate rows`);
if (AUDIT_LINE) row('Verification: the audit line keeps its ignores', folded.includes(AUDIT_LINE), `Dependency audit row: ${AUDIT_LINE}`);

const review = section('Review');
const order = ['Reviewed across', 'Result:', '| Pass |', 'Verified clean and enumerated rather than asserted', 'Scaling:', 'Version alignment: YES.'];
const at = order.map((s) => review.indexOf(s));
row('Review parts in order', at.every((n, i) => n > 0 && (i === 0 || n > at[i - 1])), JSON.stringify(at));
const dims = ['privacy and the PII boundary', 'supply chain and bundle', 'legal content and licensing', 'code security', 'scaling', 'version alignment'];
const missingDims = dims.filter((d) => !norm(review).toLowerCase().includes(d.toLowerCase()));
row('Review names every standard dimension', missingDims.length === 0, missingDims.length ? `missing ${missingDims}` : 'all six');
const clean = CLEAN;
const missingClean = clean.filter((p) => !norm(review).toLowerCase().includes(p.toLowerCase()));
row('Verified clean names secrets and the project lines', missingClean.length === 0, missingClean.length ? `missing: ${missingClean.join(' | ')}` : `all ${clean.length}`);

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
