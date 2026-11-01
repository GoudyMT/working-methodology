#!/usr/bin/env node
// Report intake (plan kit-autopilot, Phase 3): how an improvement report gets from a project to the kit, and how the
// kit sorts it before anything acts on it. Nothing here acts on a report; verifying and building is Phase 4.
//
// Why a key: a cross-session sender name is self-chosen, not an identity (code.claude.com/docs/en/cross-session-
// messaging). So install gives each project its own key, kept in the Claude folder outside every repo, and each
// filed report carries an HMAC made with it. The key and the sorting stop a report forged by something that can only
// write a file, and bind a report to the project it names; they do not stop a hostile session running as the same
// user, which can read the key. The boundary for that is Phase 4: every report is reproduced from the kit's own
// source before anything changes. A project is known only after the owner confirms it once, from their own terminal.
//
// All state lives in <Claude folder>/kit-intake/: keys/, registry/ (known.json, pending/), inbox/, then queue/,
// held/, rejected/ and duplicate/, and log.jsonl with one line per sorted report.
//
// Usage:
//   node intake.mjs register <project folder>    install does this: the key, and a pending registry entry
//   node intake.mjs file <report.md>             from inside the project: sign it into the inbox, start a run
//   node intake.mjs process-inbox                sort the inbox, one run at a time
//   node intake.mjs status                       known and pending senders, and what is in each folder
//   KIT_OWNER_CONFIRM=1 node intake.mjs confirm <id>   the owner, in their own terminal
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUDIT = path.join(KIT, 'project', '.claude', 'improvement-report.mjs');
// Starting caps, to be set from real use. An envelope carries one audited report (itself capped at 64,000 bytes).
const MAX_ENVELOPE = 96000;
const DAILY_PER_SENDER = 5;
const DAILY_ALL = 20;
const STALE_LOCK_MS = 10 * 60000;
const FOLDERS = ['queue', 'held', 'rejected', 'duplicate'];

const toPosix = (p) => p.split(path.sep).join('/');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const stateDir = (home) => path.join(home || process.env.KIT_CLAUDE_HOME || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'kit-intake');
const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };

/**
 * Who a project is: its real folder and its origin remote (without any credentials in the URL), and an id from both.
 *
 * Args:
 *     dir: any folder inside the project
 *
 * Returns:
 *     { id, folder, remote }, or null outside a git repository
 */
export function identity(dir) {
	const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
	const top = git('rev-parse', '--show-toplevel');
	if (top.status !== 0) return null;
	const folder = toPosix(real(top.stdout.trim()));
	const url = git('remote', 'get-url', 'origin');
	const remote = url.status === 0 ? url.stdout.trim().replace(/\/\/[^@/]*@/, '//') : '';
	return { id: idOf(folder, remote), folder, remote };
}
const idOf = (folder, remote) => sha(`${folder}\n${remote}`).slice(0, 16);

/**
 * Give a project its key (kept if it has one) and, unless the owner already confirmed it, a pending registry entry.
 *
 * Args:
 *     home: the Claude folder
 *     projectDir: the project folder
 *
 * Returns:
 *     the project's identity, or null when it is not a git repository (nothing is registered)
 */
export function register({ home, projectDir }) {
	const who = identity(projectDir);
	if (!who) return null;
	const s = stateDir(home);
	const key = path.join(s, 'keys', `${who.id}.key`);
	fs.mkdirSync(path.dirname(key), { recursive: true });
	try { fs.writeFileSync(key, crypto.randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); } catch { /* has one */ }
	if (!known(s)[who.id]) {
		fs.mkdirSync(path.join(s, 'registry', 'pending'), { recursive: true });
		fs.writeFileSync(path.join(s, 'registry', 'pending', `${who.id}.json`), JSON.stringify({ ...who, at: new Date().toISOString() }, null, 2) + '\n');
	}
	return who;
}

function known(s) {
	try { return JSON.parse(fs.readFileSync(path.join(s, 'registry', 'known.json'), 'utf8')) || {}; } catch { return {}; }
}
const keyOf = (s, id) => { try { return fs.readFileSync(path.join(s, 'keys', `${id}.key`), 'utf8').trim(); } catch { return null; } };
const signed = (e) => JSON.stringify([e.v, e.id, e.folder, e.remote, e.filedAt, e.name, e.report]);
const hmac = (key, e) => crypto.createHmac('sha256', key).update(signed(e)).digest('hex');
async function audit(text) {
	const { audit: check } = await import(pathToFileURL(AUDIT).href);
	return check(text);
}

async function file(reportPath) {
	const s = stateDir();
	const who = identity(process.cwd());
	const key = who && keyOf(s, who.id);
	if (!key) { console.log('There is no intake key for this project: install the kit into it (kit.mjs install project <folder>). Nothing filed.'); return 1; }
	const report = fs.readFileSync(reportPath, 'utf8');
	const faults = await audit(report);
	if (faults.length) { console.log(`The report fails its audit; nothing filed:\n    ${faults.join('\n    ')}`); return 1; }
	const e = { v: 1, ...who, filedAt: new Date().toISOString(), name: path.basename(reportPath), report };
	e.hmac = hmac(key, e);
	const inbox = path.join(s, 'inbox');
	fs.mkdirSync(inbox, { recursive: true });
	const out = path.join(inbox, `${Date.now()}-${who.id}-${crypto.randomBytes(3).toString('hex')}.json`);
	fs.writeFileSync(out, JSON.stringify(e), { flag: 'wx' });
	console.log(`Filed to the kit inbox: ${path.basename(out)}`);
	// The run is a fixed command: nothing from the report reaches its arguments.
	if (process.env.KIT_INTAKE_NO_SPAWN !== '1') {
		spawn(process.execPath, [fileURLToPath(import.meta.url), 'process-inbox'], { cwd: KIT, detached: true, stdio: 'ignore', windowsHide: true }).unref();
		console.log('The inbox run started.');
	}
	return 0;
}

// One run at a time: the lock is a file made only if absent; one older than STALE_LOCK_MS is a crashed run's.
function lock(s) {
	const f = path.join(s, 'inbox.lock');
	fs.mkdirSync(s, { recursive: true });
	for (let tries = 0; tries < 2; tries++) {
		try { fs.writeFileSync(f, String(process.pid), { flag: 'wx' }); return () => fs.rmSync(f, { force: true }); } catch { /* held */ }
		let age = 0;
		try { age = Date.now() - fs.statSync(f).mtimeMs; } catch { continue; }
		if (age < STALE_LOCK_MS) return null;
		fs.rmSync(f, { force: true });
	}
	return null;
}

async function processInbox() {
	const s = stateDir();
	const free = lock(s);
	if (!free) { console.log('Another inbox run holds the lock; this one does nothing.'); return 0; }
	try {
		const inbox = path.join(s, 'inbox');
		const names = fs.existsSync(inbox) ? fs.readdirSync(inbox).filter((n) => n.endsWith('.json')).sort() : [];
		for (const d of FOLDERS) fs.mkdirSync(path.join(s, d), { recursive: true });
		const logFile = path.join(s, 'log.jsonl');
		const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } }) : [];
		const today = new Date().toISOString().slice(0, 10);
		const queuedToday = (id) => log.filter((l) => l.outcome === 'queued' && String(l.at).startsWith(today) && (!id || l.sender === id)).length;
		const counts = {};
		for (const name of names) {
			const src = path.join(inbox, name);
			const r = await sort(s, src, log, queuedToday);
			if (r.outcome === 'waiting') { counts.waiting = (counts.waiting || 0) + 1; log.push(r.line); fs.appendFileSync(logFile, JSON.stringify(r.line) + '\n'); continue; }
			fs.renameSync(src, path.join(s, r.outcome === 'queued' ? 'queue' : r.outcome, name));
			counts[r.outcome] = (counts[r.outcome] || 0) + 1;
			log.push(r.line);
			fs.appendFileSync(logFile, JSON.stringify(r.line) + '\n');
		}
		console.log(`Inbox run: ${names.length} report(s)${Object.entries(counts).map(([k, v]) => `, ${v} ${k}`).join('')}.`);
		return 0;
	} finally { free(); }
}

// Where one envelope goes, and its log line. The report text is data: it is checked, never followed.
async function sort(s, src, log, queuedToday) {
	const at = new Date().toISOString();
	const line = (outcome, reason, e = {}) => ({ outcome, line: { at, file: path.basename(src), sender: e.id || null, reportId: e.reportId || null, outcome, reason } });
	const raw = fs.readFileSync(src, 'utf8');
	if (Buffer.byteLength(raw) > MAX_ENVELOPE) return line('rejected', `over ${MAX_ENVELOPE} bytes`);
	let e;
	try { e = JSON.parse(raw); } catch { e = null; }
	const fields = e && e.v === 1 && /^[0-9a-f]{16}$/.test(e.id) && [e.folder, e.remote, e.filedAt, e.name, e.report].every((x) => typeof x === 'string') && /^[0-9a-f]{64}$/.test(e.hmac);
	if (!fields) return line('rejected', 'not a report envelope');
	if (idOf(e.folder, e.remote) !== e.id) return line('rejected', 'the sender id does not match its folder and remote', e);
	const key = keyOf(s, e.id);
	if (!key) return line('rejected', 'no key for this sender: it was never installed here', e);
	const want = Buffer.from(hmac(key, e), 'hex');
	if (!crypto.timingSafeEqual(want, Buffer.from(e.hmac, 'hex'))) return line('rejected', 'the signature does not match: changed after filing, or not filed by this project', e);
	const reportId = (e.report.match(/^\| ID \| (IR-[a-z0-9-]+) \|$/m) || [])[1] || null;
	e.reportId = reportId;
	if (!known(s)[e.id]) {
		if (!fs.existsSync(path.join(s, 'registry', 'pending', `${e.id}.json`))) register({ home: path.dirname(s), projectDir: e.folder });
		return line('held', `unknown sender ${e.id} (${e.folder}): the owner confirms it with intake.mjs confirm ${e.id}`, e);
	}
	const faults = await audit(e.report);
	if (faults.length) return line('rejected', `the report fails its audit: ${faults[0]}`, e);
	// The same report is the same text once its status row is set aside. A gap seen from several projects is joined
	// later, by the reproduced failure (Phase 4); here only repeats are caught.
	const body = sha(e.report.replace(/^\| Status \| \S+ \|$/m, ''));
	const first = log.find((l) => l.outcome === 'queued' && (l.body === body || (l.sender === e.id && l.reportId === reportId)));
	if (first) return line('duplicate', `the same report as ${first.file}`, e);
	if (queuedToday(e.id) >= DAILY_PER_SENDER) return line('waiting', `over the daily cap of ${DAILY_PER_SENDER} for this sender: it waits in the inbox`, e);
	if (queuedToday() >= DAILY_ALL) return line('waiting', `over the daily cap of ${DAILY_ALL} for all senders: it waits in the inbox`, e);
	const r = line('queued', 'known sender, signature and audit pass', e);
	r.line.body = body;
	return r;
}

async function confirm(id) {
	// An AI tool's shell carries one of these; the owner's own terminal does not (approve.mjs --resume's same line).
	if ('CLAUDECODE' in process.env || 'AI_AGENT' in process.env || process.env.KIT_OWNER_CONFIRM !== '1' || !process.stdin.isTTY) {
		console.log('Only the owner confirms a sender, from their own terminal: KIT_OWNER_CONFIRM=1 node intake.mjs confirm <id>.');
		return 1;
	}
	const s = stateDir();
	const f = path.join(s, 'registry', 'pending', `${id}.json`);
	if (!/^[0-9a-f]{16}$/.test(String(id)) || !fs.existsSync(f)) { console.log(`No pending sender ${id}.`); return 1; }
	const entry = JSON.parse(fs.readFileSync(f, 'utf8'));
	console.log(`Sender ${id}\n    folder: ${entry.folder}\n    remote: ${entry.remote || '(none)'}`);
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	const typed = await new Promise((res) => rl.question('Type the folder name to confirm: ', (a) => { rl.close(); res(a.trim()); }));
	if (typed !== path.posix.basename(entry.folder)) { console.log('Not confirmed.'); return 1; }
	const all = known(s);
	all[id] = { ...entry, confirmedAt: new Date().toISOString() };
	fs.writeFileSync(path.join(s, 'registry', 'known.json'), JSON.stringify(all, null, 2) + '\n');
	fs.rmSync(f);
	console.log(`Confirmed ${id}. Its held reports are sorted at the next run: move them back to the inbox to resend.`);
	return 0;
}

function status() {
	const s = stateDir();
	for (const [id, e] of Object.entries(known(s))) console.log(`known     ${id}  ${e.folder}`);
	const pend = path.join(s, 'registry', 'pending');
	for (const n of fs.existsSync(pend) ? fs.readdirSync(pend) : []) console.log(`pending   ${n.replace('.json', '')}  ${JSON.parse(fs.readFileSync(path.join(pend, n), 'utf8')).folder}`);
	for (const d of ['inbox', ...FOLDERS]) {
		const p = path.join(s, d);
		console.log(`${d.padEnd(9)} ${fs.existsSync(p) ? fs.readdirSync(p).filter((n) => n.endsWith('.json')).length : 0}`);
	}
	return 0;
}

async function main([cmd, arg]) {
	if (cmd === 'register' && arg) { const who = register({ projectDir: arg }); console.log(who ? `Registered ${who.id} (${who.folder}).` : 'Not a git repository; nothing registered.'); return 0; }
	if (cmd === 'file' && arg) return file(path.resolve(arg));
	if (cmd === 'process-inbox') return processInbox();
	if (cmd === 'confirm') return confirm(arg);
	if (cmd === 'status') return status();
	console.log('Usage: node intake.mjs register <folder> | file <report.md> | process-inbox | status | confirm <id>');
	return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
