// The standing-grant check (rule:standing-grants; plan kit-autopilot, Phase 2). Before an outward act the owner granted
// (a release, a push to main), this works out whether the evidence says GO; anything missing, odd or unproven is ASK,
// and for now every act asks the owner, since the streak below is advisory.
//
// Why each part is the way it is: a session could edit any file it can see, so nothing here trusts the working copy.
// The grant and this script are read from main on the remote; the evidence (tests, scrub, the new test failing on main
// and passing here, today's releases) is run or counted here, never read from a claim; the kill switch sits outside
// every repo, in the Claude config folder. A branch that touches the grant, the gates or Tier 0 rule text always asks.
// Each check is logged with the script's verdict and the owner logs theirs; 10 straight hits (the owner agreed with
// the script) make an act auto-eligible, one miss resets it. The streak is advisory: every act still asks, and only the
// owner can change that (rule:standing-grants).
//
// Usage (from inside the repo):
//   node .claude/autonomy.mjs check <act>                        ASK (exit 1) with the script's verdict, logged
//   KIT_OWNER_VERDICT=1 node .claude/autonomy.mjs verdict <act> hit|miss   the owner, in their own terminal
//   node .claude/autonomy.mjs status                             each act's advisory streak
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Real paths: Windows can hand the same folder over as a short 8.3 name (CI runners do), and git gives the long one.
const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
const SELF = real(fileURLToPath(import.meta.url));
const GRANT_FILE = '.kit/autonomy.json';
const STREAK = 10;
const CONDITIONS = ['clean-tree', 'tests', 'scrub', 'new-test-fails-at-base', 'release-cap'];
// The grant, this check, the other gates, the hooks and settings that guard an act, the CI that runs them, and the
// rule files that hold Tier 0: a change to any of them is never granted. Whole folders and whole rule files, since a
// list of single files or chosen lines misses a new hook or a renumbered rule.
const PROTECTED = [/^\.kit\//, /(^|\/)\.claude\//, /(^|\/)\.githooks\//, /^\.github\//, /^user\/(kit-hooks|agents)\//,
	/(^|\/)approve\.mjs$/, /(^|\/)scripts\/kit\.mjs$/, /(^|\/)kit\.config\.json$/, /(^|\/)scrub\.local\.json$/, /(^|\/)package\.json$/,
	/(^|\/)(vitest|jest|playwright)\.config\./, /(^|\/)(CLAUDE|AGENTS)\.md$/, /^rules\/(core\.md|_parts\/)/];

const run = (cmd, args, cwd) => spawnSync(cmd, args, { encoding: 'utf8', cwd, maxBuffer: 256 * 1024 * 1024 });
const git = (...a) => run('git', ['-c', 'core.quotePath=false', ...a]);
const out = (r) => (r.status === 0 ? r.stdout.trim() : null);
// A fetch by URL: "--" keeps the URL from being read as an option, and the ext:: transport (which runs a command) stays
// off whatever the repo's config says.
const fetch = (url, refspec, ...opts) => git('-c', 'protocol.ext.allow=never', 'fetch', '-q', ...opts, '--', url, refspec);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const lf = (s) => s.replace(/\r\n/g, '\n');
// Every value printed to the owner's terminal comes from the ledger, the act name or git, and any of them can carry
// bytes the terminal acts on (ESC moves the cursor and can write the clipboard). Control characters (C0, DEL, C1) and
// the invisible and direction-changing marks print as "?".
const clean = (s) => [...String(s ?? '')].map((ch) => {
	const c = ch.codePointAt(0);
	return c < 0x20 || (c >= 0x7f && c < 0xa0) || (c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) ? '?' : ch;
}).join('');
const top = real(out(git('rev-parse', '--show-toplevel')) || process.cwd());
const LEDGER = path.join(out(git('rev-parse', '--path-format=absolute', '--git-common-dir')) || path.join(top, '.git'), 'kit-autonomy-ledger.jsonl');
// The kill switch is always looked for in the default Claude folder; a config folder set by env adds a place, never
// replaces it.
const SWITCHES = [...new Set([path.join(os.homedir(), '.claude'), process.env.KIT_CLAUDE_HOME, process.env.CLAUDE_CONFIG_DIR]
	.filter(Boolean).map((d) => path.join(d, 'autonomy-off')))];
// main is fetched into a ref only this check writes, right before it is read.
const MAIN_REF = 'refs/kit/main';

// The ledger: one JSON line per check and per owner verdict, each chained to the line before, so a line written by
// hand shows (a careful forger is not stopped, which is why the streak is advisory). A line that is not a JSON object
// is skipped and marks the ledger broken. When verdicts are signed, each signature must cover the check line it judges
// (its hash, not just its time), and unsigned lines already here must not count: a signed yes to a forged check is no
// proof.
function ledger() {
	const lines = fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean) : [];
	const log = lines.map((l) => {
		try { const e = JSON.parse(l); return e && typeof e === 'object' && !Array.isArray(e) ? e : { kind: 'broken' }; } catch { return { kind: 'broken' }; }
	});
	const broken = log.some((e, i) => e.kind === 'broken' || e.prev !== (i ? sha(lines[i - 1]) : ''));
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

// Releases today, counted from the remote's tags in UTC: an annotated tag by when it was made, a plain tag by its
// commit's date. A plain tag on a backdated commit escapes the count (a known limit: annotated release tags close it).
function releasesToday(url) {
	const today = new Date().toISOString().slice(0, 10);
	fetch(url, '+refs/tags/*:refs/kit/tags/*', '--prune');
	const dates = (out(git('for-each-ref', '--format=%(creatordate:iso-strict)', 'refs/kit/tags/')) || '').split('\n').filter(Boolean);
	return dates.filter((d) => new Date(d).toISOString().slice(0, 10) === today).length;
}

function check(act) {
	const ask = (reasons) => { for (const r of reasons) console.log(`ASK the owner - ${clean(r)}`); return 1; };
	const on = SWITCHES.find((f) => fs.existsSync(f));
	if (on) return ask([`the kill switch is on (${on})`]);
	// main is read from the URL the act pushes to, never from the name "origin": a fetch URL of its own, or a url rewrite
	// in git config, would let a session serve this check a main it wrote while the push still goes to GitHub.
	const url = out(git('remote', 'get-url', 'origin'));
	if (!url) return ask(['no origin remote to read main from']);
	if (url.startsWith('-')) return ask(['origin\'s url starts with "-", which git would read as an option']);
	const pushUrls = (out(git('remote', 'get-url', '--push', '--all', 'origin')) || '').split('\n').filter(Boolean);
	if (!pushUrls.length || pushUrls.some((u) => u !== url)) return ask([`origin reads main from ${url} but pushes to ${pushUrls.join(', ') || 'nowhere'}`]);
	if (out(git('config', '--get-regexp', '^url\\..*\\.(push)?insteadof$'))) return ask(['a url rewrite (insteadOf) in git config could send the fetch somewhere else']);
	if (fetch(url, `+refs/heads/main:${MAIN_REF}`).status !== 0) return ask(['could not fetch origin/main']);
	const raw = git('show', `${MAIN_REF}:${GRANT_FILE}`);
	if (raw.status !== 0) return ask([`no grant on origin/main (${GRANT_FILE}): every act asks`]);
	let grant;
	try { grant = JSON.parse(raw.stdout); } catch { return ask(['the grant on origin/main is not valid: it is not JSON']); }
	const invalid = validate(grant);
	if (invalid) return ask([`the grant on origin/main is not valid: ${invalid}`]);
	const spec = grant.acts[act];
	if (!spec) return ask([`no act "${act}" in the grant`]);

	const reasons = [];
	const rel = path.relative(top, SELF).split(path.sep).join('/');
	const mine = git('show', `${MAIN_REF}:${rel}`);
	if (mine.status !== 0 || lf(mine.stdout) !== lf(fs.readFileSync(SELF, 'utf8'))) reasons.push(`this check (${rel}) differs from origin/main`);
	const head = out(git('rev-parse', 'HEAD'));
	const base = out(git('merge-base', MAIN_REF, 'HEAD'));
	if (!head || !base) return ask(['could not find the branch and its base on main']);
	const changed = (out(git('diff', '--name-only', '--no-renames', `${base}...HEAD`)) || '').split('\n').filter(Boolean);
	for (const f of changed) if (PROTECTED.some((re) => re.test(f))) reasons.push(`protected path: ${f}`);
	if (ledger().broken) reasons.push('the ledger was changed by hand: the owner reviews it before any act');
	const c = spec.conditions;
	if (c.includes('clean-tree') && out(git('status', '--porcelain'))) reasons.push('uncommitted changes in the working tree');
	// The evidence runs even after an earlier reason, so the ledger holds the whole verdict the owner compares.
	if (c.includes('tests') && run(grant.commands.tests[0], grant.commands.tests.slice(1), top).status !== 0) reasons.push('the tests fail');
	if (c.includes('scrub') && run(grant.commands.scrub[0], grant.commands.scrub.slice(1), top).status !== 0) reasons.push('the scrub fails');
	if (c.includes('new-test-fails-at-base')) reasons.push(...newTestEvidence(grant, base));
	if (c.includes('release-cap')) { const n = releasesToday(url); if (n >= spec.releaseCapPerDay) reasons.push(`release cap: ${n} of ${spec.releaseCapPerDay} releases today`); }

	const script = reasons.length ? 'ask' : 'go';
	const s = streak(act);
	append({ kind: 'check', act, base, head, script, reasons });
	if (script === 'ask') return ask(reasons);
	// The streak is advisory: anyone who can write the git folder can write a well-chained verdict, so even 10 of 10
	// asks. Only the owner can change that (rule:standing-grants).
	return ask([`auto-eligible (advisory): ${Math.min(s, STREAK)}/${STREAK}; the script says GO for ${act} at ${head.slice(0, 7)}`]);
}

// One line typed at the terminal, read without a prompt library.
function typed() {
	const buf = Buffer.alloc(1);
	let s = '';
	while (fs.readSync(0, buf, 0, 1) === 1 && buf[0] !== 10) s += String.fromCharCode(buf[0]);
	return s.trim();
}

function verdict(act, v) {
	// The env flags, the terminal check and the typed short SHA stop a tool by accident or by habit. They do not prove
	// the owner typed the verdict: a tool can clear the flags and open a terminal of its own.
	const usage = 'A verdict is the owner\'s, typed in their own terminal: KIT_OWNER_VERDICT=1 node .claude/autonomy.mjs verdict <act> hit|miss';
	if ('CLAUDECODE' in process.env || 'AI_AGENT' in process.env || process.env.KIT_OWNER_VERDICT !== '1' || !process.stdin.isTTY) {
		console.log(usage);
		return 1;
	}
	if (!['hit', 'miss'].includes(v)) { console.log('verdict is hit (the script was right) or miss'); return 2; }
	// This prompt is the one channel outside the session, and what it shows comes from the ledger: a broken ledger
	// gives no verdict, and a check line is shown only once it is well formed and names a real commit.
	const { log, broken } = ledger();
	if (broken) { console.log('the ledger was changed by hand: no verdict until the owner has reviewed it'); return 1; }
	const last = log.map((e, i) => (e.kind === 'check' && e.act === act ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
	if (last < 0 || log.slice(last + 1).some((e) => e.kind === 'verdict' && e.act === act)) { console.log(`no check of "${clean(act)}" is waiting for a verdict`); return 1; }
	const check = log[last];
	const verified = typeof check.head === 'string' && /^[0-9a-f]{40}$/.test(check.head) && git('cat-file', '-e', `${check.head}^{commit}`).status === 0
		&& ['ask', 'go'].includes(check.script) && Array.isArray(check.reasons) && check.reasons.every((r) => typeof r === 'string');
	if (!verified) { console.log(`the last check of "${clean(act)}" cannot be verified (no real commit, or a malformed line): no verdict`); return 1; }
	const short = check.head.slice(0, 7);
	process.stdout.write(`${clean(act)} at ${short}: the script said ${check.script.toUpperCase()}${check.reasons.length ? ` (${check.reasons.map(clean).join('; ')})` : ''}.\nType ${short} to log "${v}": `);
	if (typed() !== short) { console.log('Not logged.'); return 1; }
	append({ kind: 'verdict', act, verdict: v, check: check.time });
	console.log(`${clean(act)}: ${v} logged; auto-eligible (advisory): ${Math.min(streak(act), STREAK)}/${STREAK}`);
	return 0;
}

function status() {
	const { log, broken } = ledger();
	if (broken) console.log('the ledger was changed by hand');
	for (const act of [...new Set(log.filter((e) => e.act).map((e) => e.act))]) console.log(`${clean(act)}: auto-eligible (advisory): ${Math.min(streak(act), STREAK)}/${STREAK}`);
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
		console.log(`ASK the owner - the check failed: ${clean(e.message)}`);
		return 1;
	}
}

process.exitCode = main(process.argv.slice(2));
