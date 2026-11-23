#!/usr/bin/env node
// The build record (T15 D5, the owner's lock 2026-11-12: "Full JSON record"): one file per release,
// docs/builds/<version>.json, that the CHANGELOG entry and the PR body's Summary, Design decisions, Verification and
// Review are written from, so the three never tell different stories. The release notes skill reads it too. It never
// publishes anything: a release stays the owner's tap.
//   node scripts/build-record.mjs check [<record>]       the record is whole, ASCII, and matches VERSION and CHANGELOG
//   node scripts/build-record.mjs changelog [<record>]   prints the CHANGELOG entry
//   node scripts/build-record.mjs pr [<record>]          prints the Standard PR body
//   node scripts/build-record.mjs notes [<record>]       prints the release notes
//   node scripts/build-record.mjs release [<record>] [<file>]  writes the notes to a file (default reports/) and
//                                                        prints the one publish line, its title from the record
//   node scripts/build-record.mjs --from-plan <plan.md> --records <folder>  prints each unit's tests as file::name keys
//                                                        (JSON, no file written); a RECORD test the plan lacks is named
// With no record named, the one for the version in VERSION is read.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkSection } from '../project/.claude/visuals.mjs';
import { check } from '../user/kit-tools/handoff.mjs';
import { planUnits, testLines, testOf } from '../user/kit-tools/plan-check.mjs';
import { filesOf } from '../user/kit-tools/test-budget.mjs';
import { findingsOf } from '../user/kit-tools/closeout.mjs';
import safeSpawn from '../user/kit-tools/safe-spawn.cjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLOSEOUT = path.join(ROOT, 'user', 'kit-tools', 'closeout.mjs');
export const KINDS = { added: 'Added', changed: 'Changed', fixed: 'Fixed', security: 'Security', removed: 'Removed' };
const SEVERITIES = ['critical', 'high', 'medium', 'low'];
export const SIX_DIMENSIONS = ['Privacy', 'Supply chain', 'Legal', 'Code security', 'Gaps, scaling, test value', 'Alignment'];
// The release's title, written as data with its notes (build 20: five of eleven titles were typed as a bare tag).
export const releaseTitle = (rec) => `Methodology Kit v${rec.version}`;
export const NO_TEST = 'no test: no real input';
export const TEST_KEY = /^tests\/[^:\s]+\.test\.mjs::\S/;
// An item's test or tests entry: a string, exact, with no space around it and no glob, regex or group character in its
// path. The fix rows keep TEST_KEY; this pattern is the stricter one, since CI's test check looks each key up by its text.
const EXACT_KEY = /^tests\/[^\s:*?[\]()]+\.test\.mjs::\S(?:.*\S)?$/;
const itemKey = (v) => typeof v === 'string' && EXACT_KEY.test(v);
// A hand-typed claim that every fix or finding has its test (PR 49's line 1), which no check read.
// The quantifier names the fixes or findings themselves, so a line about the auto-fix push is not one (the build 14 sweep).
const FIX_CLAIM = /\b(each|every|all)\s+(of\s+the\s+)?(sweep\s+|high\s+|other\s+)?(findings?|fix(es)?)\b[^.]*\btests?\b/i;
// A fix row's line in the PR body: its text, its commit and whether it names a test. The key itself stays in the record:
// test names hold words the body audit reads as prose (the build 14 sweep).
export const fixLine = (f) => `${String(f.text).trim().replace(/\.$/, '')}. Fixed in ${f.commit}, ${f.test === NO_TEST ? NO_TEST : 'with a named test'}.`;
// The files whose fix owes a test whatever its severity: the guards, the hooks, the owner's yes and the gates.
export const GUARDED = /^(project\/\.claude\/[^/]+\.cjs$|project\/\.githooks\/|user\/kit-hooks\/|user\/kit-tools\/(owner-yes\.cjs|merge-gate\.mjs|kit-launch\.cjs|kit-start\.sh)$|user\/skills\/pre-pr-sweep\/approve\.mjs$|\.github\/)/;

/** The problems with a record, as plain lines; none when it is whole. */
export function problems(rec) {
	const out = [];
	const need = (cond, what) => { if (!cond) out.push(what); };
	const text = (v) => typeof v === 'string' && v.trim().length > 0;
	need(rec && typeof rec === 'object', 'the record is not a JSON object');
	if (!rec || typeof rec !== 'object') return out;
	need(/^\d+\.\d+\.\d+$/.test(rec.version || ''), 'version is not plain x.y.z');
	need(/^\d{4}-\d{2}-\d{2}$/.test(rec.date || ''), 'date is not YYYY-MM-DD');
	need(['major', 'minor', 'patch'].includes(rec.level), 'level is not major, minor or patch');
	for (const k of ['area', 'title', 'headline']) need(text(rec[k]), `${k} is missing`);
	need(/^[a-z]+: \S/.test(rec.title || '') && (rec.title || '').length <= 72, 'title is not "type: subject" within 72 characters');
	need(Array.isArray(rec.items) && rec.items.length > 0, 'items is empty');
	const [maj, min] = String(rec.version || '').split('.').map(Number);
	const from141 = maj > 1 || (maj === 1 && min >= 41);
	// K139 (PR 53): the Summary table is written from the items that name a where; with none it is a header and no rows.
	if (maj > 1 || (maj === 1 && min >= 44)) need((rec.items || []).some((it) => it && text(it.where)), 'no item names a where: the Summary table needs at least one row saying what a person meets now');
	(rec.items || []).forEach((it, i) => {
		need(text(it.id), `item ${i + 1} has no id`);
		need(Object.hasOwn(KINDS, it.kind), `item ${i + 1} kind "${it.kind}" is not one of ${Object.keys(KINDS).join(', ')}`);
		for (const k of ['text', 'evidence']) need(text(it[k]), `item ${i + 1} (${it.id}) has no ${k}`);
		need(!it.where || (text(it.before) && text(it.after)), `item ${i + 1} (${it.id}) names a where without its before and after`);
		// An item names one test in test, or many in tests, each an exact key; the message names the item, never the entry.
		const label = `item ${i + 1} (${typeof it.id === 'string' ? it.id : '?'})`;
		need(it.test === undefined || itemKey(it.test), `${label} test is not an exact test key`);
		need(it.tests === undefined || (Array.isArray(it.tests) && it.tests.every(itemKey)), `${label} tests is not a list of exact test keys`);
		// K109: a missing reach read as projects and filed a kit-only item under projects; from 1.41.0 each item says it.
		if (it.reach === undefined && from141) out.push(`item ${i + 1} (${it.id}) names no reach: projects or kit`);
		else need(it.reach === undefined || ['projects', 'kit'].includes(it.reach), `item ${i + 1} (${it.id}) reach "${it.reach}" is not projects or kit`);
	});
	need(Array.isArray(rec.verification) && rec.verification.length > 0, 'verification is empty');
	// The Standard body's four sections are all required, Design decisions among them (K15).
	need(Array.isArray(rec.decisions) && rec.decisions.length > 0 && rec.decisions.every((d) => d && text(d.decision) && text(d.why)), 'decisions is empty, or one has no decision and why');
	const s = rec.sweep;
	need(s && text(s.tier) && text(s.commit), 'sweep has no tier or commit');
	// The tier the PR body audit reads at the start of the review line (the build 13 sweep: a record could write a body
	// the audit then failed).
	need(!s || !text(s.tier) || /^(Feature|Fix|Triage|First push|Launch gate)(?: \([^)\n]*\))?$/.test(s.tier), `sweep tier "${s && s.tier}" is not Feature, Fix, Triage, First push or Launch gate, with modifiers in a parenthesis`);
	if (s) {
		need(Array.isArray(s.dimensions) && s.dimensions.length > 0, 'sweep names no dimension');
		for (const sev of SEVERITIES) need(Number.isInteger((s.findings || {})[sev]), `sweep findings has no ${sev} count`);
		// K105: the fix ledger, one row per fix. A high, critical, security or owner-rule fix names the test that fails
		// first on the code before it; a low or medium may say no real input shows the problem. CI's test check states
		// the verdict of each named test; the body's fix line is written from these rows.
		need(Array.isArray(s.fixes), 'sweep has no fixes list (one row per fix: id, severity, text, commit, test)');
		(Array.isArray(s.fixes) ? s.fixes : []).forEach((f, i) => {
			const id = (f && f.id) || `row ${i + 1}`;
			need(f && text(f.id) && SEVERITIES.includes(f.severity) && text(f.text) && text(f.commit), `fix ${id} needs an id, a severity (${SEVERITIES.join(', ')}), a text and a commit`);
			if (!f) return;
			const key = TEST_KEY.test(f.test || '');
			need(key || f.test === NO_TEST, `fix ${id} test "${f.test}" is not a test key or "${NO_TEST}"`);
			for (const flag of ['security', 'owner']) need(f[flag] === undefined || typeof f[flag] === 'boolean', `fix ${id} ${flag} is not true or false`);
			need(!text(f.text) || !text(f.commit) || fixLine(f).length <= 240, `fix ${id} writes a body line over 240 characters`);
			const owed = ['critical', 'high'].includes(f.severity) || f.security === true || f.owner === true;
			const why = [f.severity, f.security === true && 'security', f.owner === true && 'owner rule'].filter(Boolean).join(', ');
			need(!owed || key, `fix ${id} (${why}) names no test: a high, critical, security or owner-rule fix keeps a test that fails first`);
		});
		const hcRows = (Array.isArray(s.fixes) ? s.fixes : []).filter((f) => f && ['critical', 'high'].includes(f.severity)).length;
		const hcFound = ((s.findings || {}).critical || 0) + ((s.findings || {}).high || 0);
		// Only an accepted line that names a high or critical stands in for its fix row (the build 14 sweep).
		const hcAccepted = (s.accepted || []).filter((a) => /^(high|critical)\b/i.test(String(a))).length;
		need(!Array.isArray(s.fixes) || hcRows + hcAccepted >= hcFound,`sweep has ${hcFound} high or critical finding(s) but ${hcRows} high or critical fix row(s)`);
		// S5: one fix row per finding of each severity, the margin 0: a row past the findings of its severity is a fault.
		for (const sev of ['critical', 'high']) {
			const rows = (Array.isArray(s.fixes) ? s.fixes : []).filter((f) => f && f.severity === sev).length;
			const got = (s.findings || {})[sev] || 0;
			if (rows > got) out.push(`sweep has ${got} ${sev} finding(s) but ${rows} ${sev} fix row(s): one fix row per finding`);
		}
	}
	need(!(rec.verification || []).some((v) => FIX_CLAIM.test(String(v))), 'a verification line states the fix-test claim: it is written from sweep.fixes, never typed');
	need(rec.tests && Number.isInteger(rec.tests.before) && Number.isInteger(rec.tests.after), 'tests has no before and after count');
	// E1 (build 21): the kit reports a release closes; a project's kit-report.mjs status reads them to hear back.
	need(rec.reports === undefined || (Array.isArray(rec.reports) && rec.reports.every((id) => /^R-\d{8}-[0-9a-f]{8}$/.test(String(id)))), 'reports is not a list of kit report ids (R-<date>-<hex>)');
	// The record is the source of outward text: plain ASCII, as the PR body and changelog must be.
	const nonAscii = [...JSON.stringify(rec)].find((ch) => ch.charCodeAt(0) > 126);
	need(!nonAscii, `the record holds a non-ASCII character (code ${nonAscii ? nonAscii.charCodeAt(0) : ''})`);
	// What the PR body audit would fail in the text the body is written from, named here (K15): the same words, the
	// same dash rule, the same bullet size; the body adds one Tests bullet to at most 3 verification lines.
	const prose = [rec.headline, rec.alignment, ...(rec.items || []).flatMap((it) => [it.text, it.before, it.after]),
		...(rec.decisions || []).flatMap((d) => [d.decision, d.why]), ...(rec.verification || []), rec.upgrading, rec.limits, ...((s && [(s.fixes || []).map((f) => f && text(f.text) && fixLine(f)), s.deferred, s.accepted].flat()) || [])].filter(text);
	for (const p of prose) {
		const plain = p.replace(/`[^`]*`/g, '');
		const word = BANNED.find((re) => re.test(plain));
		need(!word, `"${p.slice(0, 40)}..." has a mechanism or AI word (${word})`);
		need(!/ - |--/.test(plain), `"${p.slice(0, 40)}..." has a spaced dash`);
		// The headline and the alignment line are paragraphs; every other line becomes a bullet.
		need([rec.headline, rec.alignment, rec.upgrading, rec.limits].includes(p) || p.length <= 240, `"${p.slice(0, 40)}..." is over 240 characters`);
	}
	need(!Array.isArray(rec.verification) || rec.verification.length <= 3, 'verification has more than 3 lines (the body adds the tests line; the audit shows 4)');
	need(!s || (s.dimensions || []).some((d) => /^code security$/i.test(d.name || '')), 'sweep has no Code security dimension');
	// Build 20 (the 1.45.0 record named four, so PR 58's review lost Supply chain and Legal): a Feature, First push or
	// Launch gate review names all six dimensions (rule:sweep-tiers).
	const deep = s && text(s.tier) && /^(Feature|First push|Launch gate)\b/.exec(s.tier);
	if (deep && Array.isArray(s.dimensions)) {
		const lack = SIX_DIMENSIONS.filter((n) => !s.dimensions.some((d) => d && String(d.name || '').toLowerCase().startsWith(n.split(',')[0].toLowerCase())));
		need(!lack.length, `a ${deep[1]} review names all six dimensions: missing ${lack.join(', ')}`);
	}
	// K125: the Visuals section the script wrote, checked as the PR and release audits check it.
	const v = rec.visuals;
	if (v !== undefined) {
		need(v && text(v.body) && typeof v.fold === 'boolean', 'visuals needs a body (the section visuals.mjs writes, with or without its heading) and fold true or false');
		// One line, no markup: a line break or a tag in the summary would hide the fold from every check (the Visuals sweep).
		need(!v || !v.fold || /^Visuals: [^\n<>]+$/.test(v.summary || ''), 'visuals summary is one line starting "Visuals: ", with no < or >');
		if (v && text(v.body)) out.push(...checkSection(visualsBlock(rec, 'pr'), '###', { require: true }));
	}
	return out;
}

// The PR body audit's mechanism words (project/.claude/pr-body-audit.mjs), so a record cannot write a body it fails.
const BANNED = [/\bAI\b/, /\bagents?\b/i, /\bsubagents?\b/i, /\bclaude\b/i, /\banthropic\b/i, /\bswarm\b/i, /\bopus\b/i, /\bsonnet\b/i, /\bbuilders?\b/i, /\bcheckers?\b/i, /\bLLM\b/];

// Prose wrapped to the audit's 110 characters; a bullet's later lines are indented under it.
function wrap(line, width = 110) {
	const lead = /^(\s*- )/.exec(line)?.[1] || '';
	const pad = ' '.repeat(lead.length);
	const out = [];
	let cur = '';
	for (const w of line.slice(lead.length).split(' ')) {
		const start = out.length ? pad : lead;
		if (cur && (start + cur + ' ' + w).length > width) { out.push(start + cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
	}
	out.push((out.length ? pad : lead) + cur);
	return out.join('\n');
}

// K125: the record's Visuals section, as the PR body carries it (a fold after the review, or the fifth section) and as
// the notes carry it (after the known limits). Written by visuals.mjs; its lines are kept as written, never wrapped.
export function visualsBlock(rec, where) {
	const v = rec.visuals;
	if (!v) return '';
	// The section as visuals.mjs prints it, or its inner text: a heading or fold it was written with is taken off here.
	const body = String(v.body).replace(/\r\n/g, '\n').trim()
		.replace(/^<details>\s*\n\s*<summary>[^\n]*<\/summary>\n([\s\S]*?)\n<\/details>$/, '$1').replace(/^#{1,6}[ \t]*Visuals[ \t]*\n/, '').trim();
	if (where === 'notes') return `## Visuals\n\n${body}\n`;
	return v.fold ? `<details>\n<summary>${v.summary}</summary>\n\n${body}\n</details>\n` : `### Visuals\n\n${body}\n`;
}

/** The CHANGELOG entry, items grouped by kind in a fixed order. */
export function changelog(rec) {
	const lines = [`## ${rec.version} - ${rec.date}`, '', rec.headline.trim(), ''];
	for (const [kind, heading] of Object.entries(KINDS)) {
		const items = rec.items.filter((it) => it.kind === kind);
		if (!items.length) continue;
		lines.push(`### ${heading}`);
		for (const it of items) lines.push(`- ${it.text.trim()}`);
		lines.push('');
	}
	return lines.join('\n');
}

/** The Standard PR body (rule:pr-body), written from the record. */
export function prBody(rec) {
	const subject = rec.title.replace(/^[a-z]+: /, '');
	const rows = rec.items.filter((it) => it.where);
	const s = rec.sweep;
	const count = (list) => (list && list.length ? list.map((x) => `  - ${x}`).join('\n') : null);
	const out = [`## ${rec.area}: ${subject}`, '', `${rec.headline.trim()} Releases as v${rec.version}.`, '', '### Summary', '',
		'| Where | Before | After |', '|---|---|---|', ...rows.map((it) => `| ${it.where} | ${it.before} | ${it.after} |`), ''];
	if ((rec.decisions || []).length) out.push('### Design decisions', '', ...rec.decisions.map((d) => `- **${d.decision}:** ${d.why}`), '');
	out.push('### Verification', '', ...rec.verification.map((v) => `- ${v}`), `- Tests: ${rec.tests.before} before, ${rec.tests.after} after${rec.tests.flips ? `; ${rec.tests.flips}` : ''}.`, '');
	out.push('### Review', '', `${s.tier} review of \`${s.commit}\`.`, '', '| Dimension | Result |', '|---|---|', ...s.dimensions.map((d) => `| ${d.name} | ${d.result} |`), '');
	const hc = (s.findings.critical || 0) + (s.findings.high || 0);
	const fixes = s.fixes || [];
	const hcFixes = fixes.filter((f) => ['critical', 'high'].includes(f.severity)).map(fixLine);
	const hcAccepted = (s.accepted || []).filter((a) => /^(high|critical)\b/i.test(String(a)));
	out.push(`- **High and critical findings:** ${hc ? `${hc}, each fixed here or accepted by the owner:\n${count([...hcFixes, ...hcAccepted]) || ''}` : 'none.'}`);
	// K105: the line says only what the rows hold; the verdict of each named test is CI's test check's to state.
	const tested = fixes.filter((f) => f.test !== NO_TEST).length;
	out.push(`- **Fix tests:** ${tested} ${tested === 1 ? 'names' : 'name'} a test, its verdict in CI's test check; ${fixes.length - tested} with ${NO_TEST}.`);
	out.push(`- **Deferred:** ${count(s.deferred) ? `\n${count(s.deferred)}` : 'none.'}`);
	out.push(`- **Accepted risks:** ${count(s.accepted) ? `\n${count(s.accepted)}` : 'none.'}`);
	out.push('- **Secrets:** no secrets or account information in the diff.', '', `Version alignment: YES. ${rec.alignment || `v${rec.version} is the ${rec.level} release this build plans.`}`, '');
	const text = out.map((l) => (l.startsWith('|') ? l : l.split('\n').map((x) => wrap(x)).join('\n'))).join('\n');
	return rec.visuals ? `${text}\n${visualsBlock(rec, 'pr')}` : text;
}

/**
 * The release notes draft (E14, 1.35.0), in the shape of the kit's published notes: the headline, the level and the
 * alignment, what changed for projects, what stays in the kit (an item with reach "kit"), then upgrading and known
 * limits. Notes were drafted by hand until 1.34.0, and 1.34.0's went out only when the owner asked. Publishing stays
 * the owner's tap; release-check.mjs then reads that they are out.
 */
export function notes(rec) {
	const bullet = (it) => `- ${it.text.trim()}`;
	const projects = rec.items.filter((it) => it.reach !== 'kit');
	const kit = rec.items.filter((it) => it.reach === 'kit');
	const out = [`# ${releaseTitle(rec)}`, '', rec.headline.trim(), '', `A ${rec.level} release.${rec.alignment ? ` ${rec.alignment.trim()}` : ''}`, ''];
	if (projects.length) out.push('## What changed for projects', '', ...projects.map(bullet), '');
	if (kit.length) out.push('## What changed in the kit itself', '', 'These stay in the kit and are not installed into projects.', '', ...kit.map(bullet), '');
	out.push('## Upgrading', '', (rec.upgrading || 'Run `install user` first, then `install project` in each project.').trim(), '');
	if (rec.limits) out.push(`Known limits: ${rec.limits.trim()}`, '');
	// E1 (build 21): the kit reports this release closes, so a project that sent one hears back.
	if (rec.reports && rec.reports.length) out.push(`Kit reports closed: ${rec.reports.join(', ')}`, '');
	if (rec.visuals) out.push(visualsBlock(rec, 'notes'));
	// One line per paragraph and bullet, as the published notes are: GitHub keeps a wrapped line's breaks.
	return out.join('\n');
}

/**
 * The record for the version in VERSION, its path, and the checks against VERSION and CHANGELOG.md.
 * Args:
 *     root: the repo folder
 *     file: the record's path, or none for docs/builds/<version>.json
 *     opts.closeout: run the closeout check (K369); the CLI turns it on for check only
 * Returns:
 *     {at, rec, problems}
 */
export function checkRepo(root, file, { closeout = true } = {}) {
	const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
	const at = file ? path.resolve(file) : path.join(root, 'docs', 'builds', `${version}.json`);
	let rec;
	try { rec = JSON.parse(fs.readFileSync(at, 'utf8')); } catch (e) { return { at, rec: null, problems: [`cannot read ${path.relative(root, at)}: ${e.message.split('\n')[0]}`] }; }
	const found = problems(rec);
	if (rec.version !== version) found.push(`the record is for ${rec.version}, VERSION says ${version}`);
	// The build 14 sweep: a row's severity and flags are typed, so a guard fix typed medium shipped with no test. In a
	// repo, each row's commit must resolve, and a row with no test may not change a guard or gate file.
	const inRepo = safeSpawn.gitRead(root, ['rev-parse', '--git-dir'], { encoding: 'utf8' }).status === 0;
	for (const f of (inRepo && rec.sweep && Array.isArray(rec.sweep.fixes) ? rec.sweep.fixes : [])) {
		if (!f || typeof f.commit !== 'string' || !f.commit.trim()) continue;
		const shown = safeSpawn.gitRead(root, ['show', '--name-only', '--format=', '--end-of-options', `${f.commit}^{commit}`], { encoding: 'utf8' });
		if (shown.status !== 0) { found.push(`fix ${f.id} commit ${f.commit} is not a commit here`); continue; }
		const guarded = shown.stdout.split('\n').filter((p) => GUARDED.test(p));
		if (f.test === NO_TEST && guarded.length) found.push(`fix ${f.id} changes ${guarded.join(', ')}, a guard or gate file: mark it security and name its test`);
	}
	// K369 S1: a record with a sweep runs the closeout check, and its stderr lines are this check's problems.
	if (closeout && inRepo && rec.sweep) {
		const r = spawnSync(process.execPath, [CLOSEOUT, 'check', '--root', root], { cwd: root, encoding: 'utf8' });
		const lines = String(r.stderr).split('\n').filter(Boolean);
		if (r.status !== 0) found.push(...(lines.length ? lines : [`closeout check exited ${r.status}`]));
	}
	// K369 S5: a fix row takes its finding's severity from the closeout file, never its own.
	const co = findingsOf(root, version);
	if (co && rec.sweep && Array.isArray(rec.sweep.fixes)) {
		rec.sweep.fixes.forEach((f, i) => {
			if (!f) return;
			const id = f.id || `row ${i + 1}`;
			if (!f.finding || !co.has(f.finding)) found.push(`fix ${id} names no finding the closeout file lists`);
			else if (co.get(f.finding) !== f.severity) found.push(`fix ${id} is ${f.severity} but its finding ${f.finding} is ${co.get(f.finding)}: a fix row takes its finding's severity`);
		});
	}
	const log = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n');
	const top = (log.split(/^(?=## \d)/m).find((part) => part.startsWith('## ')) || '').trimEnd();
	if (!found.length && top !== changelog(rec).trimEnd()) found.push(`the top CHANGELOG.md entry is not the one the record writes (run: node scripts/build-record.mjs changelog)`);
	return { at, rec, problems: found };
}

/**
 * The tests of each plan unit as "<first test file in its Files cell>::<test name>" keys, in the plan's order, from its
 * Tests cell. A tester RECORD's "tests" names a test the plan lacks: it goes to notes, is not added, and is not a fault.
 * Args:
 *     planText: the plan's markdown text.
 *     records: [{name, text}] for each .jsonl hand-back in the records folder.
 * Returns:
 *     {items: [{unit, tests}], notes: [stderr lines], faults: [stderr lines, which make the run exit 1]}.
 */
export function fromPlan(planText, records) {
	const items = [];
	const faults = [];
	const notes = [];
	const keysOf = new Map();
	for (const u of planUnits(planText)) {
		const file = filesOf(u.files).find((f) => /^tests\//.test(f));
		if (!file) {
			faults.push(`unit ${u.id} has no test file in its Files cell, so its tests cannot be keyed`);
			continue;
		}
		const keys = testLines(u.tests).map((l) => `${file}::${testOf(l).name}`);
		keysOf.set(u.id, keys);
		items.push({ unit: u.id, tests: keys });
	}
	for (const { name, text } of records) {
		const r = check(text);
		if (!r.ok) {
			faults.push(`record ${name} is not a valid hand-back: ${r.errors.join('; ')}`);
			continue;
		}
		const role = r.roleLine || {};
		if (role.role !== 'tester' || role.tests === undefined) continue;
		if (!Array.isArray(role.tests) || !role.tests.every((k) => typeof k === 'string')) {
			faults.push(`record ${name} has a tests value that is not a list of test keys`);
			continue;
		}
		const unit = typeof role.unit === 'string' ? role.unit.trim() : '';
		const planned = keysOf.get(unit) || [];
		for (const key of role.tests) if (!planned.includes(key)) notes.push(`not in plan: ${unit} ${key}`);
	}
	return { items, notes, faults };
}

// --from-plan <plan.md> --records <folder>: the fromPlan result on stdout (JSON) and stderr; exit 2 on bad input.
function fromPlanMain(args) {
	if (args.length !== 3 || args[1] !== '--records') {
		process.stderr.write('usage: node scripts/build-record.mjs --from-plan <plan.md> --records <folder>\n');
		return 2;
	}
	let r;
	try {
		const planText = fs.readFileSync(args[0], 'utf8');
		const records = fs.readdirSync(args[2]).filter((n) => n.endsWith('.jsonl')).sort()
			.map((name) => ({ name, text: fs.readFileSync(path.join(args[2], name), 'utf8') }));
		r = fromPlan(planText, records);
	} catch (e) {
		process.stderr.write(`build-record --from-plan: ${e.message}\n`);
		return 2;
	}
	for (const n of r.notes) process.stderr.write(`${n}\n`);
	if (r.faults.length) {
		for (const f of r.faults) process.stderr.write(`${f}\n`);
		return 1;
	}
	process.stdout.write(`${JSON.stringify({ items: r.items }, null, 2)}\n`);
	return 0;
}

const RUN_DIRECTLY = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (RUN_DIRECTLY && process.argv[2] === '--from-plan') {
	process.exitCode = fromPlanMain(process.argv.slice(3));
} else if (RUN_DIRECTLY) {
	const [cmd, file] = process.argv.slice(2);
	const root = process.env.KIT_RECORD_ROOT ? path.resolve(process.env.KIT_RECORD_ROOT) : ROOT;
	const r = checkRepo(root, cmd === 'body' ? undefined : file, { closeout: cmd === 'check' });
	if (cmd === 'body') {
		// The build 14 sweep: the published body's fix lines, from "High and critical findings" to "Deferred", must be the
		// ones the record writes; a hand edit after the record wrote them is named.
		const visualsOf = (t) => { const s = String(t).replace(/\r\n/g, '\n'); const a = s.search(/<details>\n<summary>Visuals:|\n### Visuals\n/); return a < 0 ? null : s.slice(a).replace(/\s+/g, ' ').trim(); };
		const span = (t) => { const s = String(t).replace(/\r\n/g, '\n'); const a = s.indexOf('- **High and critical findings:**'); const b = s.indexOf('- **Deferred:**', a); return a < 0 || b < 0 ? null : s.slice(a, b).replace(/\s+/g, ' ').trim(); };
		let body = null;
		try { body = fs.readFileSync(file || '', 'utf8'); } catch { /* named below */ }
		const want = r.rec && !problems(r.rec).length ? span(prBody(r.rec)) : null;
		if (body === null || want === null) { process.stderr.write(`build record body: ${body === null ? `cannot read "${file || ''}"` : 'the record is not whole'}\n`); process.exitCode = 2; }
		else if (span(body) !== want) { process.stderr.write(`build record body: the body's fix lines differ from the build record (run: node scripts/build-record.mjs pr)\n`); process.exitCode = 1; }
		// K125: the Visuals section too, from its fold or heading to the end of the body.
		else if (r.rec.visuals && visualsOf(body) !== visualsOf(prBody(r.rec))) { process.stderr.write(`build record body: the body's Visuals section differs from the build record (run: node scripts/build-record.mjs pr)\n`); process.exitCode = 1; }
		else process.stdout.write('build record body: the fix lines match the record\n');
	} else if (cmd === 'check') {
		if (r.problems.length) { process.stderr.write(`Build record ${path.relative(root, r.at)}:\n${r.problems.map((p) => `    ${p}`).join('\n')}\n`); process.exitCode = 1; }
		else process.stdout.write(`Build record ${path.relative(root, r.at)}: whole, and the changelog matches\n`);
	} else if (cmd === 'release' && r.rec && !problems(r.rec).length) {
		// Build 20: the notes file and the one publish line, title included, so neither is typed by hand; the changelog
		// output is for CHANGELOG.md only (v1.45.0 went out with it as its notes).
		const out = path.resolve(process.argv[4] || path.join(root, 'reports', `release-v${r.rec.version}.md`));
		fs.mkdirSync(path.dirname(out), { recursive: true });
		fs.writeFileSync(out, notes(r.rec));
		process.stdout.write(`gh release create v${r.rec.version} --title "${releaseTitle(r.rec)}" --notes-file "${out}"\n`);
	} else if (['changelog', 'pr', 'notes'].includes(cmd) && r.rec && !problems(r.rec).length) {
		process.stdout.write({ changelog, pr: prBody, notes }[cmd](r.rec));
	} else {
		process.stderr.write(r.rec ? `${problems(r.rec).join('\n')}\n` : 'usage: node scripts/build-record.mjs check | changelog | pr | notes [<record>] | release [<record>] [<file>] | --from-plan <plan.md> --records <folder>\n');
		process.exitCode = r.rec ? 1 : 2;
	}
}
