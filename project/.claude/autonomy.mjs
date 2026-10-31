// The standing-grant check (rule:standing-grants; plan kit-autopilot, Phase 2). Before an outward act the owner granted
// (a release, a push to main), this decides GO or ASK, and anything missing, odd or unproven is ASK.
//
// Why each part is the way it is: a session could edit any file it can see, so nothing here trusts the working copy.
// The grant and this script are read from main on the remote; the evidence (tests, scrub, the new test failing on main
// and passing here, today's releases) is run or counted here, never read from a claim; the kill switch sits outside
// every repo, in the Claude config folder. A branch that touches the grant, the gates or Tier 0 rule text always asks.
// Trust is earned per act: each check is logged with the script's verdict, the owner logs theirs from their own
// terminal, and only after 10 straight hits (the owner agreed with the script) does an act run without the owner;
// one miss puts it back to verify.
//
// Usage (from inside the repo):
//   node .claude/autonomy.mjs check <act>                        GO (exit 0) or ASK (exit 1), logged
//   KIT_OWNER_VERDICT=1 node .claude/autonomy.mjs verdict <act> hit|miss   the owner, in their own terminal
//   node .claude/autonomy.mjs status                             each act's streak
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const MAIN = 'origin/main';
const GRANT_FILE = '.kit/autonomy.json';
const STREAK = 10;
const CONDITIONS = ['clean-tree', 'tests', 'scrub', 'new-test-fails-at-base', 'release-cap'];
// The grant, this check, the other gates and the CI that runs them: a change to any of them is never granted.
const PROTECTED = [/^\.kit\//, /(^|\/)autonomy\.mjs$/, /(^|\/)approve\.mjs$/, /^\.github\/workflows\//, /(^|\/)scripts\/kit\.mjs$/,
	/(^|\/)kit\.config\.json$/, /(^|\/)scrub\.local\.json$/, /(^|\/)package\.json$/, /(^|\/)(vitest|jest|playwright)\.config\./,
	/(^|\/)secret-(patterns|shapes)\.mjs$/, /(^|\/)name-check\.mjs$/, /(^|\/)pr-body-audit(-lean)?\.mjs$/];
// Tier 0 text, by file: the Hard Rules on privacy, domain boundaries, sourcing, the security baseline and outward
// acts, and the Tier 0 block of the priority index.
const TIER0 = {
	'CLAUDE.md': (t) => t.split('\n').filter((l) => /^(3|4|5|6|14)\. /.test(l)),
	'project/CLAUDE.md': (t) => t.split('\n').filter((l) => /^(3|4|5|6|14)\. /.test(l)),
	'rules/core.md': (t) => [t.slice(t.indexOf('**Tier 0'), t.indexOf('**Tier 1'))],
	'AGENTS.md': (t) => [t.slice(t.indexOf('**Tier 0'), t.indexOf('**Tier 1'))],
	'project/AGENTS.md': (t) => [t.slice(t.indexOf('**Tier 0'), t.indexOf('**Tier 1'))],
};

const run = (cmd, args, cwd) => spawnSync(cmd, args, { encoding: 'utf8', cwd, maxBuffer: 256 * 1024 * 1024 });
const git = (...a) => run('git', ['-c', 'core.quotePath=false', ...a]);
const out = (r) => (r.status === 0 ? r.stdout.trim() : null);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const lf = (s) => s.replace(/\r\n/g, '\n');
const top = path.resolve(out(git('rev-parse', '--show-toplevel')) || process.cwd());
const LEDGER = path.join(out(git('rev-parse', '--path-format=absolute', '--git-common-dir')) || path.join(top, '.git'), 'kit-autonomy-ledger.jsonl');
const home = process.env.KIT_CLAUDE_HOME || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

// The ledger: one JSON line per check and per owner verdict, each chained to the line before, so a line written by
// hand shows (a careful forger is not stopped; the owner reads the ledger when giving verdicts).
function ledger() {
	const lines = fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean) : [];
	const log = lines.map((l) => { try { return JSON.parse(l); } catch { return { kind: 'broken' }; } });
	const broken = log.some((e, i) => e.prev !== (i ? sha(lines[i - 1]) : ''));
	return { lines, log, broken };
}
function append(entry) {
	const { lines } = ledger();
	fs.appendFileSync(LEDGER, JSON.stringify({ ...entry, time: new Date().toISOString(), prev: lines.length ? sha(lines[lines.length - 1]) : '' }) + '\n');
}
function streak(act) {
	const { log, broken } = ledger();
	if (broken) return 0;
	let s = 0;
	for (const e of log) if (e.kind === 'verdict' && e.act === act) s = e.verdict === 'hit' ? s + 1 : 0;
	return s;
}

function validate(grant) {
	if (!grant || grant.version !== 1 || typeof grant.acts !== 'object' || !grant.acts) return 'needs version 1 and an acts object';
	for (const [name, act] of Object.entries(grant.acts)) {
		if (!Array.isArray(act.conditions) || !act.conditions.length) return `act "${name}" has no conditions`;
		const unknown = act.conditions.filter((c) => !CONDITIONS.includes(c));
		if (unknown.length) return `act "${name}" names unknown conditions: ${unknown.join(', ')}`;
		if (act.conditions.includes('release-cap') && !(Number.isInteger(act.releaseCapPerDay) && act.releaseCapPerDay > 0)) return `act "${name}" needs releaseCapPerDay`;
		for (const c of ['tests', 'scrub']) if (act.conditions.includes(c) && !Array.isArray(grant.commands?.[c])) return `commands.${c} is missing`;
		if (act.conditions.includes('new-test-fails-at-base') && (!Array.isArray(grant.commands?.testFile) || typeof grant.testPattern !== 'string')) return 'commands.testFile and testPattern are needed';
	}
	return null;
}

// The branch's new or changed tests must fail on main and pass here: proof the fix is what makes them pass.
function newTestEvidence(grant, base) {
	const pattern = new RegExp(grant.testPattern);
	const files = (out(git('diff', '--name-only', '--diff-filter=AM', `${base}...HEAD`)) || '').split('\n').filter((f) => f && pattern.test(f));
	if (!files.length) return ['no new or changed test'];
	const [cmd, ...args] = grant.commands.testFile;
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-base-'));
	const reasons = [];
	try {
		if (git('worktree', 'add', '-q', '--detach', tmp, base).status !== 0) return ['could not check out main to run the new test'];
		for (const f of files) {
			fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true });
			fs.writeFileSync(path.join(tmp, f), out(git('show', `HEAD:${f}`)) ?? '');
			if (run(cmd, [...args, f], tmp).status === 0) reasons.push(`the new test does not fail on main: ${f}`);
			if (run(cmd, [...args, f], top).status !== 0) reasons.push(`the new test fails here: ${f}`);
		}
	} finally {
		git('worktree', 'remove', '--force', tmp);
		fs.rmSync(tmp, { recursive: true, force: true });
	}
	return reasons;
}

// Releases today, counted from the remote's tags (the commit each tag names, dated in UTC).
function releasesToday() {
	const today = new Date().toISOString().slice(0, 10);
	git('fetch', '-q', 'origin', '--tags');
	const refs = (out(git('ls-remote', '--tags', 'origin')) || '').split('\n').filter((l) => l && !l.endsWith('^{}'));
	let n = 0;
	for (const l of refs) {
		const date = out(git('log', '-1', '--format=%cI', l.split('\t')[0]));
		if (date && new Date(date).toISOString().slice(0, 10) === today) n++;
	}
	return n;
}

function check(act) {
	const ask = (reasons) => { for (const r of reasons) console.log(`ASK the owner - ${r}`); return 1; };
	if (fs.existsSync(path.join(home, 'autonomy-off'))) return ask([`the kill switch is on (${path.join(home, 'autonomy-off')})`]);
	if (git('remote', 'get-url', 'origin').status === 0 && git('fetch', '-q', 'origin', 'main').status !== 0) return ask(['could not fetch origin/main']);
	if (!out(git('rev-parse', '--verify', '-q', `${MAIN}^{commit}`))) return ask(['no origin/main to read the grant from']);
	const raw = git('show', `${MAIN}:${GRANT_FILE}`);
	if (raw.status !== 0) return ask([`no grant on origin/main (${GRANT_FILE}): every act asks`]);
	let grant;
	try { grant = JSON.parse(raw.stdout); } catch { return ask(['the grant on origin/main is not valid: it is not JSON']); }
	const invalid = validate(grant);
	if (invalid) return ask([`the grant on origin/main is not valid: ${invalid}`]);
	const spec = grant.acts[act];
	if (!spec) return ask([`no act "${act}" in the grant`]);

	const reasons = [];
	const rel = path.relative(top, SELF).split(path.sep).join('/');
	const mine = git('show', `${MAIN}:${rel}`);
	if (mine.status !== 0 || lf(mine.stdout) !== lf(fs.readFileSync(SELF, 'utf8'))) reasons.push(`this check (${rel}) differs from origin/main`);
	const head = out(git('rev-parse', 'HEAD'));
	const base = out(git('merge-base', MAIN, 'HEAD'));
	if (!head || !base) return ask(['could not find the branch and its base on main']);
	const changed = (out(git('diff', '--name-only', '--no-renames', `${base}...HEAD`)) || '').split('\n').filter(Boolean);
	for (const f of changed) if (PROTECTED.some((re) => re.test(f))) reasons.push(`protected path: ${f}`);
	for (const [f, pick] of Object.entries(TIER0)) {
		const at = (ref) => { const r = git('show', `${ref}:${f}`); return r.status === 0 ? sha(pick(lf(r.stdout)).join('\n')) : null; };
		if (at(base) !== at(head)) reasons.push(`Tier 0 text changed in ${f}`);
	}
	if (ledger().broken) reasons.push('the ledger was changed by hand: the owner reviews it before any act');
	const c = spec.conditions;
	if (c.includes('clean-tree') && out(git('status', '--porcelain'))) reasons.push('uncommitted changes in the working tree');
	// The evidence runs even after an earlier reason, so the ledger holds the whole verdict the owner compares.
	if (c.includes('tests') && run(grant.commands.tests[0], grant.commands.tests.slice(1), top).status !== 0) reasons.push('the tests fail');
	if (c.includes('scrub') && run(grant.commands.scrub[0], grant.commands.scrub.slice(1), top).status !== 0) reasons.push('the scrub fails');
	if (c.includes('new-test-fails-at-base')) reasons.push(...newTestEvidence(grant, base));
	if (c.includes('release-cap')) { const n = releasesToday(); if (n >= spec.releaseCapPerDay) reasons.push(`release cap: ${n} of ${spec.releaseCapPerDay} releases today`); }

	const script = reasons.length ? 'ask' : 'go';
	const s = streak(act);
	append({ kind: 'check', act, base, head, script, reasons });
	if (script === 'ask') return ask(reasons);
	if (s < STREAK) return ask([`verify mode: ${s} of ${STREAK} straight hits; the script says GO for ${act} at ${head.slice(0, 7)}`]);
	console.log(`GO ${act} at ${head.slice(0, 7)} (${s} straight owner-confirmed hits)`);
	return 0;
}

function verdict(act, v) {
	// An AI tool's shell carries one of these; the owner's own terminal does not (the push guard's same line).
	if ('CLAUDECODE' in process.env || 'AI_AGENT' in process.env || process.env.KIT_OWNER_VERDICT !== '1') {
		console.log('Only the owner gives a verdict, from their own terminal: KIT_OWNER_VERDICT=1 node .claude/autonomy.mjs verdict <act> hit|miss');
		return 1;
	}
	if (!['hit', 'miss'].includes(v)) { console.log('verdict is hit (the script was right) or miss'); return 2; }
	const { log } = ledger();
	const last = log.map((e, i) => (e.kind === 'check' && e.act === act ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
	if (last < 0 || log.slice(last + 1).some((e) => e.kind === 'verdict' && e.act === act)) { console.log(`no check of "${act}" is waiting for a verdict`); return 1; }
	append({ kind: 'verdict', act, verdict: v, check: log[last].time });
	console.log(`${act}: ${v} logged; ${streak(act)} of ${STREAK} straight hits`);
	return 0;
}

function status() {
	const { log, broken } = ledger();
	if (broken) console.log('the ledger was changed by hand');
	for (const act of [...new Set(log.filter((e) => e.act).map((e) => e.act))]) console.log(`${act}: ${streak(act)} of ${STREAK} straight hits (${streak(act) >= STREAK ? 'auto' : 'verify'})`);
	return 0;
}

function main([cmd, act, v]) {
	try {
		if (cmd === 'check' && act) return check(act);
		if (cmd === 'verdict' && act) return verdict(act, v);
		if (cmd === 'status') return status();
		console.log('Usage: node .claude/autonomy.mjs check <act> | verdict <act> hit|miss | status');
		return 2;
	} catch (e) {
		// Fail closed: an error is never a GO.
		console.log(`ASK the owner - the check failed: ${e.message}`);
		return 1;
	}
}

process.exitCode = main(process.argv.slice(2));
