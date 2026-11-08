import { readFileSync } from 'node:fs';
import { carriesPhrase } from './canary-phrase.mjs';
import { versionBumpCheck } from './version-bump-check.mjs';
import { attributionFaults, entities } from './no-attribution.mjs';

const [file, title] = process.argv.slice(2);
// Read as the page shows it: an entity (&#65;I) is the character it stands for.
const written = readFileSync(file, 'utf8');
const body = entities(written);
const lines = body.split(/\r?\n/);
const rows = [];
const row = (name, ok, detail) => rows.push({ name, ok, detail });
const attribution = attributionFaults(written);
row('no attribution block', attribution.length === 0, attribution.join(', ') || 'none');

const subject = title.replace(/^[a-z]+(\([a-z-]+\))?: /, '');
row('title is type: subject (smaller PR)', /^(feat|fix|refactor|test|docs|chore|security|perf)(\([a-z-]+\))?: [a-z]/.test(title), title);
row('H1 is <Area>: <line>, no type prefix', /^## [A-Z][A-Za-z ]+: [a-z]/.test(lines[0]) && !/^## (feat|fix|chore|security|docs)/.test(lines[0]), lines[0]);
row('H1 line carries the title subject', lines[0].endsWith(subject), `subject: ${subject}`);

const long = lines.map((l, i) => [i + 1, l.length]).filter(([, n]) => n > 110);
row('every line <= 110', long.length === 0, `max ${Math.max(...lines.map((l) => l.length))}; over: ${JSON.stringify(long)}`);

const nonAscii = [...body].filter((c) => c.charCodeAt(0) > 0x7e || (c.charCodeAt(0) < 0x20 && c !== '\n' && c !== '\r'));
row('0 non-ASCII characters', nonAscii.length === 0, `found ${nonAscii.length}`);

const banned = [/\bAI\b/, /\bagents?\b/i, /\bsubagents?\b/i, /\bclaude\b/i, /\banthropic\b/i, /\bswarm\b/i, /\bopus\b/i, /\bsonnet\b/i, /\bbuilders?\b/i, /\bcheckers?\b/i];
const bannedHits = banned.flatMap((re) => lines.flatMap((l, i) => (re.test(l) ? [`${re} @${i + 1}`] : [])));
row('no mechanism or AI words', bannedHits.length === 0, bannedHits.join(', ') || 'none');

const vault = /docs\/sweeps|docs\/superpowers|docs\/decisions|_Master|_Working|_Active|_Session|_Loop|\.claude\//;
const vaultHits = lines.flatMap((l, i) => (vault.test(l) ? [i + 1] : []));
row('no vault paths', vaultHits.length === 0, vaultHits.length ? `lines ${vaultHits}` : 'none');

const framing = body.slice(body.indexOf('\n') + 1, body.indexOf('**Changes**')).trim();
row('framing summary before Changes', framing.length > 0, `${framing.split('\n').length} lines`);

const at = ['**Changes**', '**Gates**', '**Notes** - '].map((s) => body.indexOf(s));
row('Changes / Gates / Notes, in order', at.every((n, i) => n > 0 && (i === 0 || n > at[i - 1])), JSON.stringify(at));

const gates = body.slice(at[1], at[2]).split('\n').filter((l) => l.startsWith('- ['));
row('every gate ticked', gates.length > 0 && gates.every((l) => l.startsWith('- [x]')), `${gates.length} gates`);

const dims = ['privacy', 'supply chain', 'legal', 'code security', 'secrets or account information'];
const missing = dims.filter((d) => !body.replace(/\s+/g, ' ').includes(d));
row('review names the dimensions', missing.length === 0, missing.length ? `missing ${missing}` : dims.join(', '));

// The template's own "**Notes** - " marker is structure, and inline code (`node --flag`) and fenced code blocks
// are code; every other spaced dash is prose.
const inFence = lines.map(((open) => (l) => { if (/^\s*```/.test(l)) { open = !open; return true; } return open; })(false));
const spacedDash = lines.flatMap((l, i) => (!inFence[i] && / - |--/.test(l.replace(/`[^`]*`/g, '').replace(/^- /, '').replace('**Notes** - ', '')) ? [i + 1] : []));
row('no spaced dashes in prose', spacedDash.length === 0, spacedDash.length ? `lines ${spacedDash}` : 'none');

// Every small PR (docs, chore, test, a dependency or security bump, any minor update) gets the small body: short,
// informative, never a dump. The limits were measured from a body the owner pointed to as the model (about 150
// words, 16 lines); bodies past them had drifted into dumps. Re-measure for a new project. A bump names
// only the figures it can move (the audit, the budgets) inside the one full-gate line.
const nonEmpty = lines.filter((l) => l.trim() !== '').length;
const words = body.split(/\s+/).filter(Boolean).length;
const changes = body.slice(at[0], at[1]).split('\n').filter((l) => l.startsWith('- ')).length;
row(
	'size: small body (<= 180 words, 18 lines, 3 changes, 3 gates)',
	words <= 180 && nonEmpty <= 18 && changes <= 3 && gates.length <= 3,
	`${words} words, ${nonEmpty} non-empty lines, ${changes} changes, ${gates.length} gates`
);

// The agents' confirmation phrase never goes out (rule:agent-canary).
row('no confirmation phrase', !carriesPhrase(body), 'rule:agent-canary');

// Shipped code needs a version bump, or the body says none is due (rule:release-notes).
const bump = versionBumpCheck(body);
row('version bumped, or no user-facing change', bump.ok, bump.detail);

for (const r of rows) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(38)} ${r.detail}`);
console.log(rows.every((r) => r.ok) ? 'AUDIT PASSED' : 'AUDIT FAILED');
process.exitCode = rows.every((r) => r.ok) ? 0 : 1;
