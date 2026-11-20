// The report scrub (E1, build 21): what a kit report may carry when it leaves a project. A report is about the kit,
// never about the project, so only fixed fields pass, and the two text fields (title, note) are refused when they hold
// anything that can name the project or its owner: a path, a link, an email address, a secret shape, a sign past plain
// ASCII, a code block, or a word the project or the machine is known by (its folder, its git remote and user, the
// account and computer names, and the owner's own word list). It fails closed: a field it does not know, a value
// outside its list, or text it cannot judge is a refusal with the reason, and the report stays on the PC.
//   node .claude/report-scrub.mjs <record.json>    PASS, or every reason (exit 1)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { SECRET_VALUE } from './secret-patterns.mjs';

export const AREAS = ['guards', 'install', 'rules', 'skills', 'tools', 'templates', 'ci', 'docs', 'other'];
export const SEVERITIES = ['critical', 'high', 'medium', 'low'];
export const FIELDS = ['id', 'kind', 'kit_version', 'area', 'severity', 'title', 'note', 'kit_file', 'kit_line', 'project', 'created'];
const ID = /^R-\d{8}-[0-9a-f]{8}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
// A kit file as the kit ships it: a relative path under one of the kit's own folders, with no step up.
const KIT_FILE = /^(\.claude|\.githooks|_Templates|standards|user|scripts|project|docs)\/[\w.-]+(\/[\w.-]+)*$/;
const CAP = { title: 120, note: 1500 };
// A path in any spelling a shell or a person writes one: a drive, a share, a home or user folder, a variable for one.
const PATHLIKE = /(^|[^\w])([A-Za-z]:[\\/]|\\\\[\w.-]+|~[\\/]|\/(Users|home|mnt|var|tmp|etc|opt|srv|root|private)\/|%[A-Za-z_]+%|\$(HOME|env:|USERPROFILE|PWD|\{))/i;
const LINK = /[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\b[\w-]+\.(com|org|net|io|dev|app|ai)\b/i;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const FENCE = /```|~~~/;

/**
 * The words that name this project or this machine, each 3 or more characters, lowercased.
 *
 * Args:
 *     projectDir: the project folder
 *     home: the Claude folder, which may hold kit-scrub-words.json ({ "words": [...] }), the owner's own list
 *
 * Returns:
 *     the words, unique
 */
export function knownWords(projectDir, home) {
	const out = [];
	const git = (...a) => { const r = spawnSync('git', a, { cwd: projectDir, encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : ''; };
	out.push(path.basename(path.resolve(projectDir)));
	const top = git('rev-parse', '--show-toplevel');
	if (top) out.push(path.basename(top));
	// Every remote's owner and repository name.
	for (const url of git('remote', '-v').split('\n').map((l) => l.split(/\s+/)[1]).filter(Boolean)) {
		for (const p of url.replace(/\.git$/, '').split(/[/:@]+/).slice(-2)) out.push(p);
	}
	out.push(git('config', 'user.name'), git('config', 'user.email'));
	try { out.push(os.userInfo().username); } catch { /* no account name */ }
	out.push(os.hostname());
	try {
		const own = JSON.parse(fs.readFileSync(path.join(home, 'kit-scrub-words.json'), 'utf8')).words;
		if (Array.isArray(own)) out.push(...own.map(String));
	} catch { /* no list of the owner's own */ }
	// A name is read by its parts too: a remote my-app-server is my, app and server, and my-app-server.
	const words = out.flatMap((w) => [w, ...String(w).split(/[\s._-]+/)]).map((w) => String(w).toLowerCase().trim()).filter((w) => w.length >= 3);
	return [...new Set(words)];
}

/**
 * Check one report record.
 *
 * Args:
 *     record: the report as it would leave the PC
 *     words: the words that name the project or machine (knownWords)
 *
 * Returns:
 *     the reasons it is refused; empty when it passes
 */
export function scrub(record, words = []) {
	const why = [];
	if (!record || typeof record !== 'object' || Array.isArray(record)) return ['the report is not one JSON object'];
	for (const k of Object.keys(record)) if (!FIELDS.includes(k)) why.push(`field "${k.slice(0, 30)}" is not one a report carries`);
	if (!ID.test(String(record.id))) why.push('id is not in the R-<date>-<hex> shape');
	if (record.kind !== 'report') why.push('kind is not report');
	if (!VERSION.test(String(record.kit_version))) why.push('kit_version is not a version');
	if (!AREAS.includes(record.area)) why.push(`area is not one of ${AREAS.join(', ')}`);
	if (!SEVERITIES.includes(record.severity)) why.push(`severity is not one of ${SEVERITIES.join(', ')}`);
	if (!/^[0-9a-f]{12}$/.test(String(record.project))) why.push('project is not a 12-sign one-way hash');
	if (Number.isNaN(Date.parse(record.created)) || !/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(String(record.created))) why.push('created is not a UTC time');
	if (record.kit_file != null && (!KIT_FILE.test(String(record.kit_file)) || String(record.kit_file).split('/').includes('..'))) why.push('kit_file is not a path inside the kit');
	if (record.kit_line != null && !(Number.isInteger(record.kit_line) && record.kit_line > 0 && record.kit_line < 100000)) why.push('kit_line is not a line number');
	if (record.kit_line != null && record.kit_file == null) why.push('kit_line names no kit_file');
	if (typeof record.title !== 'string' || !record.title.trim()) why.push('title is empty');
	for (const field of ['title', 'note']) {
		const v = record[field];
		if (v == null) continue;
		if (typeof v !== 'string') { why.push(`${field} is not text`); continue; }
		if (v.length > CAP[field]) why.push(`${field} is over ${CAP[field]} characters`);
		if (/[^\x20-\x7e\n]/.test(v) || (field === 'title' && v.includes('\n'))) why.push(`${field} holds a sign past plain ASCII or a control sign`);
		if (PATHLIKE.test(v)) why.push(`${field} holds a path`);
		if (LINK.test(v)) why.push(`${field} holds a link`);
		if (EMAIL.test(v)) why.push(`${field} holds an email address`);
		if (FENCE.test(v)) why.push(`${field} holds a code block`);
		for (const [name, re] of SECRET_VALUE) if (re.test(v)) why.push(`${field} holds a ${name}`);
		const lower = v.toLowerCase();
		for (const w of words) {
			const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			if (new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`).test(lower)) { why.push(`${field} holds a word that names this project or machine`); break; }
		}
	}
	return why;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	let record;
	try { record = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); } catch { console.log('report-scrub: give a report record file'); process.exit(2); }
	const home = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
	const why = scrub(record, knownWords(process.cwd(), home));
	console.log(why.length ? why.map((w) => `REFUSED: ${w}`).join('\n') : 'PASS');
	process.exitCode = why.length ? 1 : 0;
}
