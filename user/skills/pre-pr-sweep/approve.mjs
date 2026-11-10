#!/usr/bin/env node
// Sweep auto-approval (rule:sweep-auto-approval). Approves a Swarm Contract (rule:swarm-contract) that stays inside
// its tier's rules, so a routine sweep need not wait for the owner, and hands back to the owner on anything else.
// It is a script on purpose: the same contract always gets the same answer, at no token cost.
//
// The contract is a JSON file written next to the table the owner would have read:
//   { "tier": "feature" | "fix" | "triage" | "first push" | "launch gate",
//     "modifiers": ["security-sensitive" | "new-dependency" | "public-text" | "user-data"],
//     "testsChanged": true,
//     "roles": [{ "role", "kind" (KINDS below), "question", "context": [...], "finding", "calls", "callsReason" }] }
// A re-sweep adds "resweepOf": "<the first sweep's contract.json>" and "fixed": [{ "finding", "kind" }] (the kind of
// role that found each fixed finding). Under the one-sweep loop (the owner, 2026-11-07) any pass after a sweep that
// ran on the branch asks the owner, a re-sweep included; on their yes it gets one: a second re-sweep, or a re-sweep
// of one, is refused, and what is left at medium or below goes to the handoff's carry-overs; a high or critical is
// fixed or the owner accepts it.
//
// Budgets are processed tokens (input + cache read + cache write + output), which the script reads itself from each
// reviewer's own transcript at --outcome. A role sets its call cap; the script computes its budget from that. More
// than the standard cap needs a callsReason, and more than 2x is the owner's. Each brief carries the cap ("Call cap: N"), the
// guard checks it and a hook holds the reviewer to it. A tier's cap counts only the roles beyond its floor.
//
// What the contract says about itself is not taken on trust where the branch can show it: the diff against the base
// sets the tier's floor, adds the dependency modifier and marks changed tests. The log lives in the repo's git folder
// (never pushed, one per repo), each line chained to the one before, so a careless hand edit shows (a careful one does not; the owner reads the log at
// each trial review). The script
// pauses itself, and only the owner resumes it from a terminal no AI tool runs in, after: tokens a quarter or more
// over budget, a third or more of the findings repeated between roles, a bug that escaped a sweep it passed, or
// every 10 auto-approvals (the trial review; every 20 after two clean ones in a row). The next approval waits for the
// last sweep's outcome. A mistake Claude can fix itself is not the owner's: it answers FIX THE CONTRACT, and the owner
// reads a contract only once it is whole. Every ask and every pause writes <contract>.triage.md beside the contract: what tripped, the
// numbers, the log lines and the fix options.
//
// Usage (from inside the repo):
//   node approve.mjs <contract.json> [--base <ref>]                     decide (exit 0 approved, 1 ask the owner or refused,
//                                                                       3 fix the contract: Claude's to fix and rerun)
//   node approve.mjs <contract.json> --outcome --agents <id,...> --findings N --real N --duplicates N [--real-mid N]
//        [--carried N (a re-sweep: findings left unfixed)] [--closed-carries N (carried findings this sweep fixed)]
//   node approve.mjs <contract.json> --owner-yes "<the owner's words>"  after an ASK, once the owner says yes
//   node approve.mjs <contract.json> --retry <n> --crashed <id>         one more start for role n, whose reviewer crashed
//   node approve.mjs <contract.json> --escape "<what slipped through>"
//   node approve.mjs --summary
//   KIT_OWNER_RESUME=1 node approve.mjs --resume                        the owner, in their own terminal
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const toPosix = (p) => p.split(path.sep).join('/');

// A tier's cap counts only the roles beyond its floor (2026-11-03): a cap below the floor made a
// security-sensitive fix unapprovable. A project may only LOWER it, in .kit/sweep-approval.json
// ({ "caps": { "<tier>": { "maxExtras", "maxAgents", "maxRoleBudget", "maxTotalBudget" } } }); raising a cap is a
// kit change, the owner's call.
const CAPS = { feature: { maxExtras: 5 }, fix: { maxExtras: 1 }, triage: { maxExtras: 0 } };
// A role's budget (locked 2026-11-03; it replaced the fixed standards): every call re-reads the context, so
// spend is about PER_CALL x calls + growth x calls^2 / 2, back-tested at 0.91x to 0.97x on two real sweeps. Growth is
// what each call adds; a role that must read a file over LARGE_FILE adds about twice as much (fit on one sweep: a
// guess until a second large-file sweep confirms it). STANDARD_CALLS is what the capped re-sweep of 2026-11-03 asked
// for; a role may ask for up to SPECIAL x by naming why.
const PER_CALL = 14000;
const GROWTH = 3000;
const GROWTH_LARGE = 6000;
const LARGE_FILE = 40 * 1024;
const STANDARD_CALLS = 15;
// The hook refuses tools from the cap's last two calls, so a smaller cap leaves a role no room to review.
const MIN_CALLS = 5;
const SPECIAL = 2;
const budgetFor = (calls, growth) => PER_CALL * calls + growth * calls * calls / 2;
// The reviewer role's own model (user/agents/reviewer.md), for a role that names none.
const DEFAULT_MODEL = 'claude-opus-5-5';
const modelKey = (m) => { const s = String(m ?? DEFAULT_MODEL); return /opus/i.test(s) ? 'opus' : /sonnet/i.test(s) ? 'sonnet' : null; };
// A re-sweep (the owner, 2026-11-03): one blast-radius role, one role per kind with a fixed finding, one alignment role.
const RESWEEP_NEEDS = { 'blast-radius': 1, dimension: 1 };
const CARRY_HOME = 'the handoff\'s "Carry-overs from the last PR" (_Active Plan.md); the next feature build fixes them';
const AGENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
// How long a transcript must stay unwritten before --retry reads it as a crash, not a reviewer still running.
const CRASH_QUIET_MINUTES = 10;
const OWNER_TIERS = ['first push', 'launch gate'];
const KINDS = ['security', 'test-value', 'novel-lens', 'fix-root', 'blast-radius', 'modelled-on', 'supply-chain', 'privacy', 'content', 'data-loss', 'dimension', 'triage'];
const NEEDS = {
	feature: { security: 3, 'test-value': 1, 'novel-lens': 1 },
	fix: { 'fix-root': 1, 'blast-radius': 1 },
	triage: { triage: 1 },
};
const MODIFIER_NEEDS = {
	'security-sensitive': { security: 3 },
	'new-dependency': { 'supply-chain': 1, privacy: 1 },
	'public-text': { content: 1 },
	'user-data': { 'data-loss': 1 },
};
const MAX_CONTEXT = 30;
const TOP_ONLY = ['security', 'novel-lens'];
const TOP_MODEL = /opus/i;
const OVERRUN = 1.25;
// M22 option C (the owner, 2026-11-05; workbench results/m22-budget): no pre-run guess lands within 25%, so each role is
// bounded. Its token ceiling is the p90 of the last CEILING_ROLES roles the log measured, and the call-cap hook stops a
// reviewer there. The pause then trips on drift signals, each against the log's own baseline. Before CEILING_MIN roles
// are measured there is no baseline: the ceiling is OVERRUN x the role's budget and the whole-sweep trip stays.
const CEILING_ROLES = 60;
const CEILING_MIN = 20;
const CEILING_PCT = 0.9;
// Drift: the starting context over its median by this much (rules or tool bloat; its sd was under 2%); content per
// call over the p95 (a new kind of work); more than this share of roles stopped at their ceiling (the work outgrew
// it); this many cache re-writes after a role's first call (the cache expired: dollar drift).
const START_DRIFT = 1.1;
const CONTENT_PCT = 0.95;
const STOPPED_SHARE = 1 / 3;
const REWRITES_TRIP = 2;
const TRIAL_EVERY = 10;
const TRIAL_EVERY_EARNED = 20;
// Two questions sharing this much of their words are one question asked twice. Rewording beats a word count, so the
// outcome's repeated-findings trip is the real backstop for clones.
const CLONE = 0.5;
// What the diff shows. Triage is at most this many changed lines with no new file (a starting value, like the caps).
const TRIAGE_MAX_LINES = 20;
const DEP_FILE = /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|requirements[^/]*\.txt|pyproject\.toml|poetry\.lock|Pipfile(\.lock)?|Cargo\.(toml|lock)|go\.(mod|sum)|Gemfile(\.lock)?)$/;
const TEST_FILE = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[a-z]+$|_test\.[a-z]+$/;
const DOC_FILE = /\.(md|txt|rst)$/i;
// What a sweep or a release commits about itself is not source: a committed contract, the project's caps file
// and a migration file pushed a fix or triage sweep up a tier. Any other added .json still counts.
const KIT_JSON = /^(docs\/migrations\/[^/]+\.json|\.kit\/sweep-approval\.json)$/i;
const TIER_RANK = { triage: 0, fix: 1, feature: 2, 'first push': 3, 'launch gate': 4 };
const FIX_EXIT = 3;
// A re-sweep whose fixes change more lines than this asks the owner: max(50, a quarter of the first sweep's diff).
const RESWEEP_MIN_LINES = 50;
const RESWEEP_SHARE = 0.25;
// The line each reviewer's brief carries: the cleared contract's hash and the role's place in it (the sweep guard reads it).
const SWEEP_TAG = /Sweep: ([0-9a-f]{16}) role (\d+)/;
const sweepLine = (hash) => `Each brief carries "Sweep: ${hash} role <n>" (n is the role's place in the contract), its role's "Call cap: <n>" and its "Token ceiling: <n>".`;

// The roles the log measured, the last CEILING_ROLES of them: what a ceiling and the drift baselines are read from.
// A role whose reviewer crashed and was retried counts as its retry: each run had a whole ceiling of its own.
const ownRun = (r) => (r && r.crashedTokens ? { ...r, tokens: Number(r.tokens) - Number(r.crashedTokens), calls: Number(r.calls) - Number(r.crashedCalls || 0) } : r);
const measuredRoles = (log) => log.filter((e) => e.kind === 'outcome' && Array.isArray(e.roles)).flatMap((e) => e.roles).map(ownRun).filter((r) => r && Number(r.tokens) > 0 && Number(r.calls) > 0).slice(-CEILING_ROLES);
// Nearest rank, so the value is one a real role spent.
const nearestRank = (values, p) => { const v = [...values].sort((a, b) => a - b); return v.length ? v[Math.max(0, Math.ceil(p * v.length) - 1)] : 0; };
const median = (values) => nearestRank(values, 0.5);
function ceilingsFor(log, budgets) {
	const past = measuredRoles(log);
	if (past.length < CEILING_MIN) return { ceilings: budgets.map((b) => Math.round(b * OVERRUN)), from: `${OVERRUN}x each role's budget (fewer than ${CEILING_MIN} roles measured in this repo's log)` };
	const at = nearestRank(past.map((r) => Number(r.tokens)), CEILING_PCT);
	return { ceilings: budgets.map(() => at), from: `the p90 of the last ${past.length} roles measured` };
}

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const has = (name) => args.includes(name);
const contractFile = args[0] && !args[0].startsWith('--') ? path.resolve(args[0]) : null;
const git = (...a) => spawnSync('git', ['-C', contractFile ? path.dirname(contractFile) : process.cwd(), ...a], { encoding: 'utf8' });
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

// The log: one per repo, in its git folder.
const common = git('rev-parse', '--path-format=absolute', '--git-common-dir');
const LOG = common.status === 0 ? path.join(common.stdout.trim(), 'kit-sweep-approvals.jsonl') : null;
const rawLines = () => (LOG && fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean) : []);
function write(entry) {
	const lines = rawLines();
	fs.appendFileSync(LOG, JSON.stringify({ time: new Date().toISOString(), ...entry, prev: lines.length ? sha(lines[lines.length - 1]) : '' }) + '\n');
}

// The log's state. A line whose link to the one before is wrong was written by hand; everything after it is
// distrusted until the owner resumes.
function state() {
	const lines = rawLines();
	// Valid JSON that is no object (null, a number, a list) is a hand edit, as a broken line is.
	const log = lines.map((l) => { try { const v = JSON.parse(l); return v && typeof v === 'object' && !Array.isArray(v) ? v : { kind: 'broken' }; } catch { return { kind: 'broken' }; } });
	let broken = -1;
	log.forEach((e, i) => { if (e.prev !== (i ? sha(lines[i - 1]) : '')) broken = i; });
	const lastResume = log.map((e, i) => (e.kind === 'resume' && i > broken ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
	if (broken >= 0 && lastResume < 0) return { log, paused: `the log was changed by hand at line ${broken + 1}`, pausedAt: log[broken].time };
	const lastPause = log.map((e, i) => (e.kind === 'pause' ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
	const paused = lastPause > lastResume ? log[lastPause].reason : null;
	const pausedAt = paused ? log[lastPause].time : null;
	const since = log.slice(lastResume + 1);
	// Trust earned widens the review: after two trial reviews in a row the owner resumed with no other pause between,
	// the next comes after TRIAL_EVERY_EARNED approvals. Any other pause (a drift trip, a hand-written line) resets it.
	let clean = 0;
	let pendingTrial = false;
	log.forEach((e, i) => {
		if (i <= broken) clean = 0;
		else if (e.kind === 'pause') { if (String(e.reason).startsWith('trial review due')) pendingTrial = true; else { clean = 0; pendingTrial = false; } }
		else if (e.kind === 'resume' && pendingTrial) { clean++; pendingTrial = false; }
	});
	const reviewEvery = clean >= 2 ? TRIAL_EVERY_EARNED : TRIAL_EVERY;
	return { log, paused, pausedAt, reviewEvery, approvedSinceReview: since.filter((e) => e.kind === 'decision' && e.decision === 'approved').length };
}

// The lower of the branch's caps and the base's, so a branch cannot drop a limit the project set.
function caps(tier, base) {
	const top = git('rev-parse', '--show-toplevel').stdout.trim();
	const f = top && path.join(top, '.kit', 'sweep-approval.json');
	const out = { maxAgents: Infinity, maxRoleBudget: Infinity, maxTotalBudget: Infinity, ...CAPS[tier] };
	const lower = (text) => {
		let own = {};
		try { own = (JSON.parse(text).caps || {})[tier] || {}; } catch { /* no project caps */ }
		for (const k of Object.keys(out)) if (Number.isFinite(own[k]) && (own[k] > 0 || (k === 'maxExtras' && own[k] === 0))) out[k] = Math.min(out[k], own[k]);
	};
	try { lower(fs.readFileSync(f, 'utf8')); } catch { /* no project caps */ }
	if (base) lower(git('show', `${base}:.kit/sweep-approval.json`).stdout);
	return out;
}

// A package.json change counts as a dependency change only when a dependency field changed: a version bump is not a
// new dependency. Lockfiles and other package files count on any change; an unreadable file counts as a change.
const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies', 'overrides', 'resolutions', 'pnpm'];
function depsChanged(base, file) {
	if (!/(^|\/)package\.json$/.test(file)) return true;
	const at = (ref) => { const r = git('show', `${ref}:${file}`); return r.status === 0 ? r.stdout : null; };
	try {
		const [a, b] = [at(base), at('HEAD')].map((t) => (t === null ? {} : JSON.parse(t)));
		return DEP_FIELDS.some((k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null));
	} catch { return true; }
}

// A file beside the contract counts as the sweep's own only when it parses as a contract.
const isContract = (f) => { try { const j = JSON.parse(git('show', `HEAD:${f}`).stdout); return typeof j.tier === 'string' && Array.isArray(j.roles); } catch { return false; } };
// What a sweep itself writes beside its contract: reports and contracts, never the work under review. Directly in
// the contract's folder only, and a .json only when it reads as a contract, so work kept there still counts.
function sweepPaper(f) {
	const own = git('rev-parse', '--show-prefix').stdout.trim();
	if (!own || !f.startsWith(own) || f.slice(own.length).includes('/')) return false;
	if (/\.md$/i.test(f)) return true;
	if (!/\.json$/i.test(f)) return false;
	try { const j = JSON.parse(fs.readFileSync(path.join(path.dirname(contractFile), f.slice(own.length)), 'utf8')); return typeof j.tier === 'string' && Array.isArray(j.roles); } catch { return false; }
}

function sweepOwned(f) {
	if (DEP_FILE.test(f)) return false;
	const own = git('rev-parse', '--show-prefix').stdout.trim();
	return KIT_JSON.test(f) || Boolean(own && f.startsWith(own) && !f.slice(own.length).includes('/') && /\.json$/i.test(f) && isContract(f));
}

// What the branch's diff against its base says, or null when it cannot be read.
function diffFacts() {
	const want = opt('--base');
	const known = (b) => git('rev-parse', '-q', '--verify', `${b}^{commit}`).status === 0;
	// The default branch by its full ref: git reads a plain "origin/main" as a tag of that name first, and a tag
	// could pick the base the diff is read from (1.21.0 handoff item 34). Messages keep the short name.
	const DEFAULTS = ['refs/remotes/origin/main', 'refs/heads/main', 'refs/remotes/origin/master', 'refs/heads/master'];
	const short = (b) => b.replace(/^refs\/(remotes|heads)\//, '');
	const base = (want ? [want] : DEFAULTS).find(known);
	if (!base) return null;
	// A base the lead names must sit on the default branch, or it could shrink the diff the tier is read from.
	const home = want && DEFAULTS.find(known);
	const offBase = home && git('merge-base', '--is-ancestor', base, home).status !== 0 ? short(home) : null;
	// An older commit of the default branch is on it, yet hides what the branch took from it: its caps and its hooks.
	const left = home ? git('merge-base', home, 'HEAD').stdout.trim() : '';
	const staleBase = !offBase && left && git('merge-base', '--is-ancestor', left, base).status !== 0 ? short(home) : null;
	const names = (filter) => git('diff', '--name-only', '-z', `--diff-filter=${filter}`, `${base}...HEAD`).stdout.split('\0').filter(Boolean);
	const all = names('ACDMRT');
	const added = names('A').filter((f) => !sweepOwned(f));
	const lines = git('diff', '--numstat', `${base}...HEAD`).stdout.split('\n').filter(Boolean).filter((l) => !sweepOwned(l.split('\t')[2])).reduce((t, l) => t + (Number(l.split('\t')[0]) || 0) + (Number(l.split('\t')[1]) || 0), 0);
	// Work not yet committed would not be in the diff the floor reads; the sweep's own files are left out.
	const dirty = git('status', '--porcelain', '--untracked-files=all', '--', ':(top)').stdout.split('\n').filter(Boolean).filter((l) => !sweepPaper(l.slice(3)));
	return {
		base,
		baseName: short(base),
		offBase,
		staleBase,
		noHome: Boolean(want) && !home,
		head: git('rev-parse', 'HEAD').stdout.trim(),
		dirty,
		changed: all.length,
		deps: all.filter((f) => DEP_FILE.test(f)).some((f) => depsChanged(base, f)),
		tests: all.some((f) => TEST_FILE.test(f)),
		addedSource: added.filter((f) => !TEST_FILE.test(f) && !DOC_FILE.test(f)),
		added,
		lines,
	};
}

const words = (s) => new Set(String(s || '').toLowerCase().match(/[a-z0-9]+/g) || []);
const overlap = (a, b) => { const x = words(a), y = words(b); const both = [...x].filter((w) => y.has(w)).length; return both / (new Set([...x, ...y]).size || 1); };
// A context entry is a repo path, maybe with a line; anything else (a rule name) has no size on the branch.
const readsLarge = (r) => (Array.isArray(r.context) ? r.context : []).some((x) => { const t = git('cat-file', '-s', `HEAD:${String(x).replace(/:\d+.*$/, '')}`); return t.status === 0 && Number(t.stdout) > LARGE_FILE; });
const filled = (s, min) => typeof s === 'string' && s.replace(/[^A-Za-z0-9]/g, '').length >= min;

const rel = (f) => toPosix(path.relative(process.cwd(), f) || f);
const isCleared = (log, i) => log[i].decision === 'approved' || log.some((y, j) => j > i && y.kind === 'owner-yes' && y.contract === log[i].contract && y.hash === log[i].hash);

// The branch this checkout is on, recorded with each decision: a rebase rewrites the heads, not the name.
const currentBranch = () => git('symbolic-ref', '--short', '-q', 'HEAD').stdout.trim();

// The patch ids of the branch's own commits (base..HEAD), at most PATCH_MAX: the same change after a rebase.
const PATCH_MAX = 200;
// Null when git cannot say: the caller treats that as unknown, never as "no earlier sweep".
function branchPatches(base) {
	if (!base) return [];
	const big = { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 };
	const diff = spawnSync('git', ['-C', path.dirname(contractFile), 'log', '-p', '--no-merges', `-${PATCH_MAX}`, '--format=commit %H', `${base}..HEAD`], big);
	if (diff.status !== 0 || diff.error) return null;
	if (!diff.stdout) return [];
	const ids = spawnSync('git', ['patch-id', '--stable'], { ...big, input: diff.stdout });
	return ids.status === 0 && !ids.error ? ids.stdout.split('\n').map((l) => l.split(' ')[0]).filter(Boolean) : null;
}

// The one-sweep loop (the owner, 2026-11-07): a sweep that ran on this branch, found by its HEAD on the branch (not on
// the base) or by the branch name it was cleared on, or null. A sweep closed with --none-ran ran nothing.
function secondPass(log, base) {
	const on = new Map();
	const onBranch = (h) => { if (!on.has(h)) on.set(h, git('merge-base', '--is-ancestor', h, 'HEAD').status === 0 && git('merge-base', '--is-ancestor', h, base).status !== 0); return on.get(h); };
	const branch = currentBranch();
	// A rebase gives the commits new ids and a rename a new name, but each commit keeps its patch (S22-S3).
	const read = branchPatches(base);
	const mine = new Set(read || []);
	// Patches unread here, or unread at an earlier sweep, cannot rule that sweep out: it counts.
	const samePatches = (e) => read === null || e.patches === null || (Array.isArray(e.patches) && e.patches.some((p) => mine.has(p)));
	const ran = (k) => log.some((e, j) => j > k && e.kind === 'outcome' && !e.noneRan && e.contract === log[k].contract);
	const i = log.findIndex((e, k) => e.kind === 'decision' && e.head && isCleared(log, k) && ran(k) && ((branch && e.branch === branch) || onBranch(e.head) || samePatches(e)));
	return i >= 0 ? log[i].contract : null;
}

// A re-sweep's own floor. Returns the kinds it needs, or `refused` when it is past its one pass:
// a refusal is the rule working, so it neither pauses nor writes a triage report.
function resweepCheck(c, tier, roles, log, facts, why, fix) {
	const first = path.resolve(path.dirname(contractFile), String(c.resweepOf || ''));
	let firstRaw = null;
	let firstContract = null;
	try { firstRaw = fs.readFileSync(first, 'utf8'); firstContract = JSON.parse(firstRaw); } catch { /* checked below */ }
	const at = log.map((e, i) => (e.kind === 'decision' && e.contract === first && isCleared(log, i) ? i : -1)).filter((i) => i >= 0).pop();
	if ((at !== undefined && log[at].resweepOf) || (firstContract && firstContract.resweepOf !== undefined)) return { first, refused: `${rel(first)} is itself a re-sweep` };
	// One per first sweep, keyed by its contract, however often it is cleared again. Another contract cleared as its
	// re-sweep counts; this one counts once its outcome is in (it has run), so deciding it again before that asks as
	// any contract does.
	// An approval closed with --none-ran ran no reviewer, so it neither spends the re-sweep nor gives one a base.
	const ran = (i) => log.some((e, j) => j > i && e.kind === 'outcome' && !e.noneRan && e.contract === log[i].contract);
	const unused = (i) => log.some((e, j) => j > i && e.kind === 'outcome' && e.noneRan && e.contract === log[i].contract);
	if (log.some((e, i) => e.kind === 'decision' && e.resweepOf === first && isCleared(log, i) && !unused(i) && (e.contract !== contractFile || ran(i)))) return { first, refused: `${rel(first)} already had its re-sweep` };
	if (at === undefined) { fix.push(`the sweep it re-checks (${rel(first)}) was never cleared: run approve.mjs on it first`); return { first, need: {} }; }
	const head = log[at];
	// A first sweep cut short is the owner's to close, which the ask for it says.
	if (!ran(at) && !log.some((e, i) => i > at && e.kind === 'unread' && e.contract === first)) fix.push(`log the outcome of the sweep it re-checks (${rel(first)}) first`);
	if (firstRaw === null || sha(firstRaw) !== head.hash) fix.push(`the sweep it re-checks (${rel(first)}) changed since it was cleared: a re-sweep reads it as it ran`);
	if (String(head.tier || '').toLowerCase() !== tier) fix.push(`a re-sweep keeps its sweep's tier (${head.tier}), not ${tier}`);
	// The re-sweep's floor replaces the modifiers' roles, so it may not claim a risk the first sweep did not cover.
	const firstMods = new Set((firstContract && Array.isArray(firstContract.modifiers)) ? firstContract.modifiers : []);
	for (const m of Array.isArray(c.modifiers) ? c.modifiers : []) if (!firstMods.has(m)) why.push(`modifier "${m}" was not on the sweep it re-checks: a new risk needs the full floor, not a re-sweep`);
	let testsChanged = false;
	if (facts && head.head) {
		const r = git('merge-base', '--is-ancestor', head.head, 'HEAD');
		if (r.status === 1) why.push(`HEAD does not descend from the HEAD the sweep it re-checks ran on (${head.head})`);
		else if (r.status !== 0) why.push(`cannot tell whether HEAD descends from ${head.head}`);
		else {
			// The re-sweep's floor skips the diff-derived modifiers, so the fixes may not bring what would have set them.
			// Contracts in the sweep folder are left out (reports are docs already); any other file there counts. Renames
			// are read as an add and a delete, and names come raw (-z), so a moved or oddly named file is still seen.
			const since = (filter) => git('diff', '--name-only', '-z', '--no-renames', `--diff-filter=${filter}`, `${head.head}..HEAD`).stdout.split('\0').filter((f) => f && !sweepOwned(f));
			const dep = since('ACDMRT').find((f) => DEP_FILE.test(f) && depsChanged(head.head, f));
			const added = since('A').find((f) => !TEST_FILE.test(f) && !DOC_FILE.test(f));
			// The fixes' own tests are reviewed as the first sweep's were (rule:sweep-tiers: Test Value when tests change).
			testsChanged = since('ACDMRT').some((f) => TEST_FILE.test(f));
			// What the fixes change, against the first sweep's diff: a large rewrite is new work, the owner's to see.
			const changed = git('diff', '--numstat', '--no-renames', `${head.head}..HEAD`).stdout.split('\n').filter(Boolean).filter((l) => { const f = l.split('\t')[2]; return !sweepOwned(f) && !sweepPaper(f); }).reduce((t, l) => t + (Number(l.split('\t')[0]) || 0) + (Number(l.split('\t')[1]) || 0), 0);
			const bound = Math.max(RESWEEP_MIN_LINES, Math.floor((Number(head.lines) || 0) * RESWEEP_SHARE));
			if (changed > bound) why.push(`the fixes change ${changed} lines since the sweep it re-checks, over max(${RESWEEP_MIN_LINES}, ${RESWEEP_SHARE * 100}% of its ${Number(head.lines) || 0}-line diff): a large rewrite needs the owner`);
			if (dep) why.push(`the fixes change a package file (${dep}) since the sweep it re-checks: a new dependency needs the full floor, not a re-sweep`);
			if (added) why.push(`the fixes add a source file (${added}) since the sweep it re-checks: new code needs the full floor, not a re-sweep`);
		}
	}
	const fixed = Array.isArray(c.fixed) ? c.fixed : [];
	const firstKinds = new Set(((firstContract && firstContract.roles) || []).map((r) => r.kind));
	if (!fixed.length) fix.push('no fixed findings listed ("fixed": [{ "finding", "kind" }]): a re-sweep checks the fixes');
	const need = { ...RESWEEP_NEEDS, ...(testsChanged ? { 'test-value': 1 } : {}) };
	fixed.forEach((x, i) => {
		if (!x || !filled(x.finding, 8)) fix.push(`fixed finding ${i + 1}: no finding named`);
		if (!x || !firstKinds.has(x.kind)) fix.push(`fixed finding ${i + 1}: kind "${x && x.kind}" had no role in the sweep it re-checks`);
		else need[x.kind] = 1;
	});
	// A re-sweep has only its floor's kinds, one each, so its floor is its size: always allowed, as a first sweep's is.
	const kinds = new Set(roles.map((r) => r.kind));
	for (const k of kinds) {
		const n = roles.filter((r) => r.kind === k).length;
		if (!need[k]) fix.push(`a ${k} role: a re-sweep has only blast-radius, one role per fixed kind, dimension (alignment) and test-value when the fixes change tests`);
		else if (n > need[k]) fix.push(`${n} ${k} roles: a re-sweep has one of each`);
	}
	return { first, need };
}

// Each role's budget from its call cap. Over the 2x bound is the owner's; a missing cap or reason is a mistake.
function callBudgets(roles, cap, why, fix) {
	const budgets = [];
	let total = 0;
	roles.forEach((r, i) => {
		const name = `role ${i + 1} (${r.role || r.kind})`;
		const n = r.calls;
		if (!Number.isInteger(n) || n < MIN_CALLS) { fix.push(`${name}: no call cap ("calls": a whole number of ${MIN_CALLS} or more; its budget is computed from that)`); return; }
		if (n > SPECIAL * STANDARD_CALLS) why.push(`${name}: ${n} calls, over ${SPECIAL}x the standard of ${STANDARD_CALLS}`);
		else if (n > STANDARD_CALLS && !(filled(r.callsReason, 15) && words(r.callsReason).size >= 3)) fix.push(`${name}: ${n} calls, over the standard of ${STANDARD_CALLS}, needs a callsReason (why this role needs more)`);
		budgets[i] = budgetFor(n, readsLarge(r) ? GROWTH_LARGE : GROWTH);
		if (budgets[i] > cap.maxRoleBudget) why.push(`${name}: budget ${budgets[i]} over the project's per-role cap of ${cap.maxRoleBudget}`);
		total += budgets[i];
	});
	return { budgets, total };
}

// The cap's hook and the sweep guard sit in the project's settings, and install skips a settings file the project
// changed. disableAllHooks in any layer Claude Code reads (project, local, user) turns both off.
function hookState(base) {
	const top = git('rev-parse', '--show-toplevel').stdout.trim();
	const read = (f) => { try { return fs.readFileSync(path.join(top, '.claude', f), 'utf8'); } catch { return null; } };
	const json = (text) => { try { return JSON.parse(text) || {}; } catch { return {}; } };
	const wired = (text) => { const h = JSON.stringify(json(text).hooks ?? ''); return !json(text).disableAllHooks && h.includes('kit-hooks/call-cap.cjs') && h.includes('kit-hooks/sweep-guard.cjs') && !/{{[A-Z_]+}}/.test(h); };
	const own = read('settings.json');
	const local = read('settings.local.json');
	let user = null;
	try { user = fs.readFileSync(path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json'), 'utf8'); } catch { /* no user settings */ }
	if ([own, local, user].some((t) => json(t).disableAllHooks)) return 'missing';
	if (wired(own) || wired(local)) return 'wired';
	// A branch that deletes the settings does not get out of the hook.
	return own === null && !(base && wired(git('show', `${base}:.claude/settings.json`).stdout)) ? 'none' : 'missing';
}
const HOOK_MISSING = 'the call-cap hook is not wired in .claude/settings.json, or the sweep guard is not, or a settings layer sets disableAllHooks: merge both PreToolUse entries from the kit\'s project/.claude/settings.json, with the installed path, and keep hooks on';
const HOOK_NONE = '    No project settings here, so no call-cap hook: each cap rests on the reviewer\'s own count, and only the top model held one in the probe.';

// Every reason this contract is not cleared, and the role kinds it needed. `why` is out of bounds, the owner's call;
// `fix` is a mistake Claude corrects and reruns. A reason is the owner's unless it is written to `fix` here.
function check(c, facts, log = []) {
	const tier = String(c.tier || '').toLowerCase();
	if (OWNER_TIERS.includes(tier)) {
		const why = [`the ${tier} tier is always the owner's call`];
		const fix = hookState(facts && facts.base) === 'missing' ? [HOOK_MISSING] : [];
		return { why, fix, need: {}, ...callBudgets(Array.isArray(c.roles) ? c.roles : [], { maxRoleBudget: Infinity }, why, fix) };
	}
	// Own keys only: "constructor" or "__proto__" would otherwise find an object's built-ins and pass with no floor.
	if (!Object.hasOwn(CAPS, tier)) return { why: [], fix: [`unknown tier "${c.tier}"`], need: {} };
	const why = [];
	const fix = [];
	if (!facts) why.push('cannot read the branch diff against its base (pass --base <ref>)');
	else if (facts.dirty.length) fix.push(`work not committed (${facts.dirty[0].slice(3)}): commit it, so the diff shows the whole change`);
	else if (!facts.changed) fix.push(`no changes against ${facts.baseName}: run it from the branch's own checkout, or pass the right --base`);
	else {
		if (facts.offBase) why.push(`--base ${facts.baseName} is not on ${facts.offBase}: a base off the default branch can shrink the diff the tier is read from`);
		if (facts.staleBase) why.push(`--base ${facts.baseName} is older than where this branch left ${facts.staleBase}: it hides the caps and hooks the branch took from there`);
		if (facts.noHome) why.push(`--base ${facts.baseName} cannot be checked: this repo has no default branch the script knows (main or master)`);
		if (tier !== 'feature' && facts.addedSource.length) why.push(`an added source file (${facts.addedSource[0]}) is feature work, not ${tier}`);
		if (tier === 'triage' && (facts.added.length || facts.lines > TRIAGE_MAX_LINES)) why.push(`${facts.lines} changed lines, ${facts.added.length} added files: more than a triage change`);
	}
	const roles = Array.isArray(c.roles) ? c.roles : [];
	const cap = caps(tier, facts && facts.base);
	if (hookState(facts && facts.base) === 'missing') fix.push(HOOK_MISSING);
	if (!roles.length) fix.push('no roles');
	if (roles.length > cap.maxAgents) why.push(`${roles.length} agents, over the project's ${tier} cap of ${cap.maxAgents}`);
	const resweep = c.resweepOf !== undefined;
	let need = { ...NEEDS[tier] };
	let first = null;
	if (resweep) {
		const r = resweepCheck(c, tier, roles, log, facts, why, fix);
		if (r.refused) return { why: [], fix: [], need: {}, refused: r.refused, first: r.first };
		({ need, first } = r);
		why.push(`a re-sweep is a second pass, the owner's under the one-sweep loop (rule:finding-pipeline): ${rel(first)} was this branch's sweep`);
	} else {
		// One sweep per branch: a plain contract after a sweep that ran here is a second pass, the owner's (rule:finding-pipeline).
		const done = facts && secondPass(log, facts.base);
		if (done) why.push(`a second sweep on this branch is the owner's under the one-sweep loop (rule:finding-pipeline): ${rel(done)} already ran`);
		if (c.modifiers !== undefined && !(Array.isArray(c.modifiers) && c.modifiers.every((m) => typeof m === 'string'))) fix.push('modifiers must be a list of names, like ["security-sensitive"]');
		const modifiers = new Set(Array.isArray(c.modifiers) ? c.modifiers : []);
		if (facts && facts.deps) modifiers.add('new-dependency');
		if (tier === 'fix' && (c.testsChanged || (facts && facts.tests))) need['test-value'] = 1;
		for (const m of modifiers) {
			if (!Object.hasOwn(MODIFIER_NEEDS, m)) { fix.push(`unknown modifier "${m}"`); continue; }
			for (const [k, n] of Object.entries(MODIFIER_NEEDS[m])) need[k] = Math.max(need[k] || 0, n);
		}
	}
	const count = (k) => roles.filter((r) => r.kind === k).length;
	for (const [k, n] of Object.entries(need)) if (count(k) < n) fix.push(`needs ${n} ${k} role(s), has ${count(k)}${facts && facts.deps && k === 'supply-chain' ? ' (the diff changes a package file)' : ''}`);
	// The floor's roles are always allowed; the cap limits what a sweep adds beyond them.
	const extras = roles.length - Object.entries(need).reduce((t, [k, n]) => t + Math.min(count(k), n), 0);
	if (!resweep && extras > cap.maxExtras) why.push(`${extras} roles beyond the ${tier} floor, over its cap of ${cap.maxExtras}`);
	roles.forEach((r, i) => {
		const name = `role ${i + 1} (${r.role || r.kind})`;
		if (!KINDS.includes(r.kind)) fix.push(`${name}: unknown kind "${r.kind}" (one of: ${KINDS.join(', ')})`);
		if (!filled(r.question, 15)) fix.push(`${name}: no real question`);
		if (!Array.isArray(r.context) || !r.context.length || !r.context.every((x) => filled(x, 2))) fix.push(`${name}: no context (the files, rule and spec its lens needs)`);
		else if (r.context.length > MAX_CONTEXT) why.push(`${name}: ${r.context.length} context entries, over ${MAX_CONTEXT}: a role's context is what its lens needs`);
		if (!filled(r.finding, 8)) fix.push(`${name}: no finding shape`);
		// The reviewer model trial (rule:test-and-review-cadence): security and the novel lens stay on the top model.
		if (TOP_ONLY.includes(r.kind) && r.model !== undefined && !TOP_MODEL.test(String(r.model))) fix.push(`${name}: a ${r.kind} role stays on the top model, not "${r.model}"`);
		// The reviewer trial covers these two; the budget formula was fit on them.
		if (r.model !== undefined && !modelKey(r.model)) why.push(`${name}: model "${r.model}" is outside the reviewer trial (opus, sonnet)`);
	});
	const { budgets, total } = callBudgets(roles, cap, why, fix);
	if (total > cap.maxTotalBudget) why.push(`total budget ${total} over the project's ${tier} cap of ${cap.maxTotalBudget}`);
	for (let i = 0; i < roles.length; i++) for (let j = i + 1; j < roles.length; j++) {
		if (overlap(roles[i].question, roles[j].question) >= CLONE) fix.push(`roles ${i + 1} and ${j + 1} ask the same question (a clone)`);
	}
	return { why, fix, need, extras, cap, first, budgets, total };
}

// Findings a re-sweep left unfixed, still open until a later outcome closes them.
const openCarries = (log) => log.filter((e) => e.kind === 'outcome').reduce((t, e) => t + (Number(e.carried) || 0) - (Number(e.closedCarries) || 0), 0);

// What the owner reads at a stop: what tripped, the numbers, the log lines and the ways forward.
const FIXES = [
	[/paused|trial review due/, 'The owner reviews the log first (`approve.mjs --summary`), then resumes from their own terminal; until then every sweep goes to the owner.'],
	[/not committed|no changes|cannot read the branch diff/, 'Commit the work and run approve.mjs from the branch\'s own checkout (pass `--base <ref>` if it cannot find the base).'],
	[/needs \d+ \S+ role/, 'Add the missing floor role(s) and run approve.mjs again.'],
	[/beyond the \S+ floor|agents, over/, 'Drop the extra roles, or split the change into smaller PRs.'],
	[/call cap \(|\d calls, over/, `Set each role's "calls" at ${STANDARD_CALLS} or under, or up to ${SPECIAL}x with a callsReason; the budget is computed from it.`],
	[/per-role cap|total budget/, 'Lower the roles\' "calls" until the computed budget fits the project\'s cap, or the owner decides.'],
	[/went lighter/, 'Put back what the stop named and run approve.mjs again, or the owner agrees the lighter sweep.'],
	[/outside the reviewer trial/, 'Name opus or sonnet for the role, or the owner agrees the model.'],
	[/was cut short/, 'The owner\'s yes on this contract closes that sweep unmeasured; list any findings left unfixed in the handoff by hand.'],
	[/call-cap hook/, 'Merge the PreToolUse entry for kit-hooks/call-cap.cjs into the project\'s .claude/settings.json.'],
	[/re-sweep|re-checks|fixed finding|descend/, 'Focus the re-sweep: one blast-radius role, one role per kind with a fixed finding, one dimension (alignment) role, on a HEAD that builds on the first sweep, after its outcome is logged.'],
	[/question|context|finding shape|unknown|no roles|top model/, 'Fix the named role in the contract and run approve.mjs again.'],
	[/log the outcome of the last approved sweep/, 'Log that sweep\'s outcome with --agents; if no reviewer started under it, close it with `--outcome --none-ran`.'],
	[/over the budget|repeated between roles|escaped|ran on .*; the contract named/, 'The owner reads the sweep\'s report and the per-role numbers above, decides whether the trip was a real failure, and resumes or adjusts.'],
];
const fixOptions = (reasons) => [...new Set(reasons.flatMap((w) => FIXES.filter(([re]) => re.test(w)).map(([, how]) => how)))];
function triage(title, reasons, numbers) {
	const f = contractFile.replace(/\.json$/i, '') + '.triage.md';
	const options = fixOptions(reasons);
	const text = [
		`# Triage: ${title}`, '',
		`Written by approve.mjs at ${new Date().toISOString()} for ${rel(contractFile)} at HEAD ${git('rev-parse', '--short', 'HEAD').stdout.trim() || 'unknown'}.`, '',
		'## What tripped', '', ...reasons.map((w) => `- ${w}`), '',
		'## The numbers', '', ...numbers.map((n) => `- ${n}`), '',
		// The report sits in the working tree, so its log lines carry relative paths and leave out the owner's words.
		'## The log lines', '', '```json', ...rawLines().slice(-5).map((l) => { try { const { words: _w, note: _n, ...e } = JSON.parse(l); return JSON.stringify({ ...e, ...(e.contract ? { contract: rel(e.contract) } : {}), ...(e.resweepOf ? { resweepOf: rel(e.resweepOf) } : {}) }); } catch { return '(unreadable line)'; } }), '```', '',
		'## Fix options', '', ...options.map((o) => `- ${o}`),
		'- Or the owner decides. After an ask: they answer in the thread "yes <the ask\'s code>" (the ask prints the code), and the lead logs it with `approve.mjs <contract.json> --owner-yes "yes <code>" --thread <their message id>`. After a pause: they answer "resume <the pause\'s code>" (`--summary` prints it), or the owner resumes from their own terminal.', '',
	].join('\n');
	fs.writeFileSync(f, text);
	return toPosix(f);
}

function decide() {
	const raw = fs.readFileSync(contractFile, 'utf8');
	const c = JSON.parse(raw);
	const s = state();
	const facts = diffFacts();
	const { why, fix, need, extras, cap, first, refused, budgets = [], total = 0 } = check(c, facts, s.log);
	const head = git('rev-parse', 'HEAD').stdout.trim() || null;
	// A stop is cured by adding what it named, not by asking for less: a lighter contract at the HEAD of a stop is the
	// owner's, whatever its file is called, however often it is rerun and whatever outcome came between. A new commit
	// starts clean: the guard stops slips, not a determined workaround.
	const stops = s.log.filter((e) => e.kind === 'decision' && e.head === head && (e.decision === 'fix' || e.decision === 'owner'));
	const mods = Array.isArray(c.modifiers) ? c.modifiers : [];
	const dropped = [...new Set(stops.flatMap((e) => (Array.isArray(e.modifiers) ? e.modifiers : [])))].filter((m) => Object.hasOwn(MODIFIER_NEEDS, m) && !mods.includes(m));
	const rank = (t) => TIER_RANK[String(t || '').toLowerCase()] ?? -1;
	const heaviest = stops.reduce((t, e) => (rank(e.tier) > rank(t) ? e.tier : t), c.tier);
	if (rank(heaviest) > rank(c.tier) || dropped.length) why.push(`the contract went lighter after a stop at this HEAD (${dropped.length ? `dropped ${dropped.join(', ')}` : `tier ${heaviest} to ${c.tier}`}): a lighter sweep is the owner's call`);
	const carries = openCarries(s.log);
	const carryLine = carries > 0 ? [`Open carry-overs: ${carries} carried finding(s) open from a re-sweep, in ${CARRY_HOME}; the outcome of the sweep that fixes them closes them with --closed-carries <n>.`] : [];
	if (refused) {
		write({ kind: 'decision', contract: contractFile, hash: sha(raw), tier: c.tier, agents: (c.roles || []).length, budget: 0, decision: 'refused', reasons: [refused], resweepOf: first, head });
		console.log(`REFUSED - one re-sweep per sweep (rule:sweep-tiers): ${refused}. No reviewer runs on this contract.`);
		console.log(`    What the re-sweep left at medium or below goes to ${CARRY_HOME}; a high or critical is fixed or the owner accepts it. Log the re-sweep's outcome with --carried <n> if you have not.`);
		return 1;
	}
	const { open, reported, stuck } = openSweep(s.log);
	if (stuck) why.push(`the last approved sweep was cut short (${rel(open.contract)}): ${starts(s.log, open.contract).started} of ${open.agents} reviewers started by the guard's count, and its spend is unmeasured; the owner's yes here closes it so`);
	if (s.paused) why.unshift(`auto-approval is paused: ${s.paused}`);
	else if (s.approvedSinceReview >= s.reviewEvery) {
		const reason = `trial review due: ${s.reviewEvery} auto-approvals since the last review`;
		write({ kind: 'pause', reason });
		why.unshift(reason);
	}
	// Ahead of any pause: a yes here would open a second set of slots over a round whose spend was never read.
	if (open && !reported && !stuck) fix.unshift(`log the outcome of the last approved sweep first (${rel(open.contract)}): --agents, or --none-ran if no reviewer started under it`);
	const { ceilings, from: ceilingFrom } = ceilingsFor(s.log, budgets);
	const entry = { kind: 'decision', contract: contractFile, branch: currentBranch(), hash: sha(raw), tier: c.tier, agents: (c.roles || []).length, budget: total, modifiers: Array.isArray(c.modifiers) ? c.modifiers : [], calls: (c.roles || []).map((r) => r.calls), budgets, ceilings, ceilingFrom, patches: facts ? branchPatches(facts.base) : [], models: (c.roles || []).map((r) => r.model ?? DEFAULT_MODEL), decision: fix.length ? 'fix' : why.length ? 'owner' : 'approved', reasons: [...fix, ...why], base: facts && facts.base, lines: facts && facts.lines, head, ...(first ? { resweepOf: first } : {}) };
	write(entry);
	if (fix.length) {
		console.log('FIX THE CONTRACT - Claude\'s to fix and rerun; nothing here goes to the owner (rule:sweep-auto-approval):');
		for (const w of fix) console.log(`    ${w}`);
		for (const o of fixOptions(fix)) console.log(`    How: ${o}`);
		for (const w of why) console.log(`    Then the owner decides: ${w}`);
		return FIX_EXIT;
	}
	if (why.length) {
		if (hookState(facts && facts.base) === 'none') console.log(HOOK_NONE);
		console.log('ASK THE OWNER - this Swarm Contract is outside the approved rules (rule:sweep-auto-approval):');
		for (const w of why) console.log(`    ${w}`);
		console.log(`    The owner can answer from the thread: "yes ${askCode(entry.hash)}" (the code ties the yes to this ask); log it with --owner-yes "<their words>" --thread <their message id>.`);
		const now = state();
		if (now.paused) for (const l of resumeHelp(now)) console.log(l);
		const f = triage(`${c.tier} ${first ? 're-sweep' : 'sweep'} sent to the owner`, why, [
			`${entry.agents} roles, budget ${entry.budget.toLocaleString('en-US')}${first ? `, a re-sweep of ${rel(first)}` : extras === undefined ? ', no floor counted (this tier always goes to the owner)' : `, ${extras} beyond the floor (cap ${cap.maxExtras})`}`,
			...(c.roles || []).map((r, i) => `role ${i + 1}: ${r.role || r.kind} (${r.kind}, ${r.model || DEFAULT_MODEL})${budgets[i] === undefined ? '' : `, ${r.calls} calls, budget ${budgets[i]}`}${r.callsReason ? ` (${r.callsReason})` : ''}`),
			...(now.paused ? [`paused since ${String(now.pausedAt || '').slice(0, 10)}: ${now.paused}`] : []),
		]);
		console.log(`    Triage report for the owner: ${f}`);
		for (const l of carryLine) console.log(l);
		return 1;
	}
	console.log(`APPROVED - ${c.tier} ${first ? `re-sweep of ${rel(first)}` : 'sweep'}, ${entry.agents} agents, budget ${entry.budget}, inside the rules. Logged to ${LOG}.`);
	console.log(notice(c, need, extras, cap, first, budgets, total, facts, entry.hash, ceilings, ceilingFrom));
	for (const l of carryLine) console.log(l);
	return 0;
}

// The owner's start notice, written from the checked contract so it carries no hand count. Post it as is.
function notice(c, need, extras, cap, first, budgets, total, facts, hash, ceilings, ceilingFrom) {
	const roles = c.roles || [];
	const n = (x) => x.toLocaleString('en-US');
	const kinds = {};
	for (const r of roles) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
	return [
		'Start notice for the owner (checked by approve.mjs; post it as is):',
		`    ${c.tier} ${first ? 're-sweep' : 'sweep'}, ${roles.length} roles: ${Object.entries(kinds).map(([k, v]) => `${k} x${v}`).join(', ')}`,
		`    Modifiers: ${(Array.isArray(c.modifiers) && c.modifiers.join(', ')) || 'none'}; diff against ${facts.baseName}`,
		...(hookState(facts.base) === 'none' ? [HOOK_NONE] : []),
		...roles.map((r, i) => `    ${i + 1}. ${r.role || r.kind} (${r.kind}, ${r.model || 'the reviewer default'}), ${r.calls} calls, budget ${n(budgets[i])}${r.callsReason ? ` (over standard: ${r.callsReason})` : ''}; brief: "Call cap: ${r.calls}. Token ceiling: ${ceilings[i]}."`),
		`    Budget: ${n(total)} processed tokens, computed from each role's call cap (standard ${STANDARD_CALLS} calls, up to ${SPECIAL}x with a reason); expected, not a trip once the log has a baseline`,
		`    Token ceiling per role: ${ceilingFrom}; the call-cap hook stops a reviewer there`,
		`    Floor met: ${Object.entries(need).map(([k, v]) => `${k} ${kinds[k] || 0} of ${v} needed`).join(', ') || 'none for this tier'}`,
		first ? `    Re-sweep of ${rel(first)}: fixed ${(c.fixed || []).length} finding(s); its outcome logs --carried <n>` : `    Extras: ${extras} of ${cap.maxExtras} allowed beyond the floor`,
		`    ${sweepLine(hash)}`,
		'    Findings come when the sweep finishes.',
	].join('\n');
}

// The last approved sweep is reported once any outcome for its contract follows it, even one logged after a later
// ask on the same contract. It is stuck once the lead says it was cut short: only the owner gets past that.
// A round's clearings and the reviewers the guard started under them; a reviewer run with no guard counts none.
function starts(log, contract) {
	const lines = rawLines();
	const lastOut = log.map((e, i) => (e.kind === 'outcome' && e.contract === contract ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
	const clearings = log.map((e, i) => (i > lastOut && e.contract === contract && ((e.kind === 'decision' && e.decision === 'approved') || e.kind === 'owner-yes') ? i : -1)).filter((i) => i >= 0);
	return { clearings, started: clearings.reduce((t, i) => { try { return t + fs.readdirSync(path.join(path.dirname(LOG), 'kit-sweep-starts', sha(lines[i]))).filter((f) => !f.endsWith('.retry')).length; } catch { return t; } }, 0) };
}

// An owner's yes clears a sweep as an approval does, so its outcome is owed too; it stands for the decision it answered.
const clears = (e) => (e.kind === 'decision' && e.decision === 'approved') || e.kind === 'owner-yes';
const answered = (log, i) => (log[i].kind === 'owner-yes' ? log.slice(0, i).filter((e) => e.kind === 'decision' && e.contract === log[i].contract && e.hash === log[i].hash).pop() || log[i] : log[i]);
function openSweep(log) {
	const openAt = log.map((e, i) => (clears(e) ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
	const open = openAt >= 0 ? answered(log, openAt) : null;
	const reported = open && log.some((e, i) => i > openAt && e.kind === 'outcome' && e.contract === open.contract);
	return { open, reported, stuck: Boolean(open && !reported && log.some((e, i) => i > openAt && e.kind === 'unread' && e.contract === open.contract)) };
}

// The owner's own message from the phone thread (E27, the owner 2026-11-08, option A). Claude Code writes each
// message a person sends into the session's transcript as a human turn: a wake whose triggering message names its
// sender. Only a main session's transcript counts (a subagent's is no owner's), only a turn from a session in this
// repo, never one inside a relay, and only the sender kit-owner.json names, a file in the Claude config folder the
// owner writes and turns off with "threadYes": false. Like the spend meter, it stops slips and a turn Claude writes
// as text, not a hand-forged transcript line. Returns { author, words, at } or { err }.
const MESSAGE_ID = /^cmsg_[A-Za-z0-9]{8,64}$/;
// install user fills in the Claude folder it installed into, so the installed copy reads the owner's file and the
// transcripts there whatever CLAUDE_CONFIG_DIR a caller sets. Only an uninstalled copy (the kit source's tests)
// reads the environment.
const INSTALLED_HOME = '{{CLAUDE_HOME}}';
const ownerHome = () => (INSTALLED_HOME.startsWith('{' + '{') ? process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude') : INSTALLED_HOME);
// The short code an ask or a pause prints and the owner's reply carries, so one reply answers that ask alone.
const askCode = (hash) => String(hash || '').slice(0, 6);
// S23-4 (the 1.23.0 verify): a yes or a resume with no thread proof rested on two variables any shell can clear, and
// on the push guard reading the command's spelling; a variable or a glob got past both. It now also needs a real
// terminal, where the owner types the code: an AI tool's shell has none (its stdin is no TTY), however the command is
// spelled. A process set on forging can still write the log itself (its links are not keyed): the written-down limit.
function typedAtTerminal(code, what) {
	if (!process.stdin.isTTY) return `${what} without a thread message needs the owner's own terminal, where they type its code; this shell has none. From the phone: the thread's way`;
	process.stdout.write(`Type ${code} to confirm ${what}: `);
	let line = '';
	const one = Buffer.alloc(1);
	try { while (line.length < 64 && fs.readSync(0, one, 0, 1, null) === 1 && one[0] !== 10) line += String.fromCharCode(one[0]); } catch { return 'the terminal could not be read'; }
	return line.trim().toLowerCase() === String(code).toLowerCase() ? '' : `the code typed was not ${code}`;
}
const pauseCode = (s) => { const lines = rawLines(); const i = s.log.map((e, k) => (e.kind === 'pause' ? k : -1)).reduce((a, b) => Math.max(a, b), -1); return i >= 0 ? sha(lines[i]).slice(0, 6) : ''; };
const unescapeXml = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
// setup: read the message whoever sent it, to name its author as the owner (--owner-setup).
function ownerMessage(id, setup = false) {
	const cfg = ownerHome();
	let owner = null;
	try { owner = JSON.parse(fs.readFileSync(path.join(cfg, 'kit-owner.json'), 'utf8')); } catch { /* checked below */ }
	if (!setup && (!owner || typeof owner.authorId !== 'string' || !owner.authorId)) return { err: `no owner is named in ${toPosix(path.join(cfg, 'kit-owner.json'))}. To name them from the thread, the lead runs node ${toPosix(SELF)} --owner-setup: it gives the words the owner sends, then --owner-setup --thread <that message's id> names its author the owner` };
	if (!setup && owner.threadYes !== true) return { err: 'the owner turned thread answers off in kit-owner.json ("threadYes")' };
	if (!MESSAGE_ID.test(String(id || ''))) return { err: '--thread needs the id of the owner\'s message (cmsg_...)' };
	let relayed = false;
	const repo = path.dirname(LOG).toLowerCase();
	const tag = new RegExp(`<message trigger="true" from="human" trust="principal" author-id="([^"]+)" id="${id}"[^>]*>([\\s\\S]*?)</message>`);
	for (const project of folders(path.join(cfg, 'projects'))) {
		let files = [];
		// S23-5: where Claude Code names the session this runs in, only its own transcript is read, so a turn written
		// into another session's file is no proof. A shell with no session id (the owner's terminal) reads them all.
		const session = /^[\w-]{1,128}$/.test(String(process.env.CLAUDE_CODE_SESSION_ID || '')) ? `${process.env.CLAUDE_CODE_SESSION_ID}.jsonl` : null;
		try { files = fs.readdirSync(project).filter((f) => f.endsWith('.jsonl') && (!session || f === session)).map((f) => path.join(project, f)); } catch { continue; }
		for (const f of files) {
			const text = fs.readFileSync(f, 'utf8');
			if (!text.includes(id)) continue;
			for (const line of text.split('\n')) {
				if (!line.includes(id)) continue;
				let e;
				try { e = JSON.parse(line); } catch { continue; }
				const c = e && e.message && e.message.content;
				// projectsUserTurn: Claude Code marks a turn that came from a project thread; a session started from a shell
				// (claude -p "<wake ...>") writes a human turn without it.
				if (!e || e.type !== 'user' || e.isSidechain !== false || !e.origin || e.origin.kind !== 'human' || e.projectsUserTurn !== true || typeof c !== 'string') continue;
				if (!c.startsWith('<wake ') || /<\/?(coordinator-relay|relay|project_claude_message|cited)\b/.test(c)) { relayed = true; continue; }
				const m = tag.exec(c);
				if (!m || !e.cwd) continue;
				const { GIT_DIR: _d, GIT_COMMON_DIR: _c, ...env } = process.env;
				const at = spawnSync('git', ['-C', e.cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8', env });
				if (at.status !== 0 || path.resolve(at.stdout.trim()).toLowerCase() !== repo) continue;
				if (!setup && m[1] !== owner.authorId) return { err: `message ${id} is not from the owner named in kit-owner.json` };
				return { author: m[1], words: unescapeXml(m[2]).trim(), at: e.timestamp };
			}
		}
	}
	// A relayed or cited copy is another Claude's word for it, so the owner answers in this build's own thread.
	if (relayed) return { err: `message ${id} reached this repo's sessions only as a relayed or cited copy; the owner answers in this build's own thread, and that message's id is the proof` };
	return { err: `no such message from a person in this repo's sessions: ${id}` };
}

// The owner named from the thread: the author of a message the owner sent in this repo's own thread becomes the owner
// whose yes and resume the thread proof takes. Only while kit-owner.json names no one: a change of owner is the
// owner's own edit of that file.
function ownerSetup() {
	const file = path.join(ownerHome(), 'kit-owner.json');
	if (fs.existsSync(file)) { console.log(`Refused: ${toPosix(file)} already names an owner; a change is the owner's own edit of that file. Nothing written.`); return 1; }
	// The owner's message says so in so many words, with a code this run prints, so no message they sent for another
	// reason names them (the 1.23.0 sweep's review).
	const lines = rawLines();
	const code = sha(`owner-setup ${lines.length ? lines[lines.length - 1] : ''}`).slice(0, 6);
	const since = lines.length ? (() => { try { return JSON.parse(lines[lines.length - 1]).time; } catch { return null; } })() : null;
	if (!has('--thread')) {
		console.log(`To be named the owner whose thread answers count, the owner sends in this build's thread: "setup ${code}". Then: node ${toPosix(SELF)} --owner-setup --thread <that message's id>. Nothing written.`);
		return 1;
	}
	const id = opt('--thread');
	const m = ownerMessage(id, true);
	if (m.err) { console.log(`Refused: ${m.err}. Nothing written.`); return 1; }
	if (!new RegExp(`^setup ${code}[.!]?$`, 'i').test(m.words)) { console.log(`Refused: message ${id} ("${m.words}") is not "setup ${code}". Nothing written.`); return 1; }
	if (since && !(Date.parse(m.at) > Date.parse(since))) { console.log(`Refused: message ${id} was sent before the code was given. Nothing written.`); return 1; }
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify({ authorId: m.author, threadYes: true }, null, 2) + '\n', { flag: 'wx' });
	console.log(`The owner is the author of message ${id} (${m.author}), written to ${toPosix(file)}. Their thread answers now count: "yes <code>" for an ask, "resume <code>" for a pause. To turn thread answers off, set "threadYes": false there.`);
	return 0;
}
const messageUsed = (log, id) => log.some((e) => e.message === id);

// The owner said yes to a contract the script sent to them. Logged only for the contract and HEAD the script asked
// about, so the reviewers' guard (sweep-guard) sees the owner's call and the order: script first, then the owner.
function ownerYes() {
	const said = opt('--owner-yes');
	if (!filled(said, 2)) { console.log("--owner-yes needs the owner's own words, quoted; nothing logged."); return 1; }
	const raw = fs.readFileSync(contractFile, 'utf8');
	const s = state();
	const last = s.log.filter((e) => e.kind === 'decision' && e.contract === contractFile).pop();
	const head = git('rev-parse', 'HEAD').stdout.trim();
	if (!last || last.decision !== 'owner') { console.log('The script did not send this contract to the owner, so there is no ask to answer. Run approve.mjs on it first.'); return 1; }
	if (last.hash !== sha(raw) || last.head !== head) { console.log('The contract or HEAD changed since the script asked. Run approve.mjs again, then ask the owner.'); return 1; }
	// One yes answers one ask: a second would open a second set of start slots.
	const askedAt = s.log.lastIndexOf(last);
	if (s.log.some((e, j) => j > askedAt && e.kind === 'owner-yes' && e.contract === contractFile && e.hash === last.hash && e.head === head)) { console.log("The owner's yes for this ask is already logged; its reviewers may start. A new ask needs approve.mjs again. Nothing logged."); return 1; }
	const { open, reported, stuck } = openSweep(s.log);
	// A yes on an older ask must not open a new set of starts over a sweep whose spend is still unread.
	if (open && !reported && !stuck && open.contract !== contractFile) { console.log(`Log the outcome of the last approved sweep first (${rel(open.contract)}), then run approve.mjs on this contract again. Nothing logged.`); return 1; }
	// From the thread: the owner's own message, sent after this ask, in exactly the words logged. Read before anything
	// is written, so a refusal logs nothing.
	let proof = {};
	// Without the thread's proof, the words rest on whoever typed this; from an AI tool's shell that is Claude's word.
	if (!has('--thread') && ('CLAUDECODE' in process.env || 'AI_AGENT' in process.env)) {
		console.log('Refused: from an AI tool\'s shell the owner\'s yes needs its proof, the id of the owner\'s own message: --owner-yes "<their words>" --thread <cmsg_...>. Or the owner runs it in their own terminal. Nothing logged.');
		return 1;
	}
	if (!has('--thread')) {
		const why = typedAtTerminal(askCode(last.hash), 'the owner\'s yes');
		if (why) { console.log(`Refused: ${why}. Nothing logged.`); return 1; }
	}
	if (has('--thread')) {
		const id = opt('--thread');
		const m = ownerMessage(id);
		if (m.err) { console.log(`Refused: ${m.err}. Nothing logged.`); return 1; }
		if (messageUsed(s.log, id)) { console.log(`Refused: message ${id} already answered an ask; one message answers one. Nothing logged.`); return 1; }
		if (!(Date.parse(m.at) > Date.parse(last.time))) { console.log(`Refused: message ${id} was sent before the ask (${last.time}). Nothing logged.`); return 1; }
		if (m.words !== said.trim()) { console.log(`Refused: --owner-yes must give message ${id} word for word ("${m.words}"). Nothing logged.`); return 1; }
		// The whole message is the yes and this ask's code, as the resume is: a "no abc123" or a question carrying the
		// code is no yes (the 1.23.0 sweep).
		if (!new RegExp(`^yes ${askCode(last.hash)}[.!]?$`, 'i').test(m.words)) { console.log(`Refused: message ${id} ("${m.words}") is not "yes ${askCode(last.hash)}", the yes with this ask's code. Nothing logged.`); return 1; }
		proof = { proof: 'thread', message: id };
	}
	if (stuck) { const { started } = starts(s.log, open.contract); write({ kind: 'outcome', contract: open.contract, decisionAt: open.time, budget: open.budget, tokens: 0, findings: 0, real: 0, duplicates: 0, closedByOwner: true, started, ...(started ? {} : { noneRan: true }) }); }
	// The ask's ceilings travel with the yes: the reviewers' guard reads the clearing line, and a yes without them
	// started reviewers with no ceiling at all (the 1.23.0 sweep).
	write({ kind: 'owner-yes', contract: contractFile, hash: last.hash, head, agents: last.agents, calls: last.calls, ...(Array.isArray(last.ceilings) ? { ceilings: last.ceilings } : {}), words: said, ...proof });
	console.log(`The owner's yes is logged; the reviewers may start. ${sweepLine(last.hash)}`);
	return 0;
}

// A pause is the owner's to clear, so every ask while paused says how, and what to review first.
function resumeHelp(s) {
	return [
		`Auto-approval is paused since ${String(s.pausedAt || '').slice(0, 10) || 'an unknown date'}: ${s.paused}.`,
		`    The owner reviews the log first (node ${toPosix(SELF)} --summary), then resumes from their own terminal:`,
		`    resume: PowerShell  $env:KIT_OWNER_RESUME='1'; node ${toPosix(SELF)} --resume`,
		`    resume: bash        KIT_OWNER_RESUME=1 node ${toPosix(SELF)} --resume`,
		`    Or the owner answers from the thread: "resume ${pauseCode(s)}"; log it with --resume --thread <their message id>.`,
		'    Until then every sweep goes to the owner. Carry this into the closeout handoff.',
	];
}

// Each reviewer's spend, read from its own transcript (<config>/projects/<project>/<session>/subagents/agent-<id>.jsonl):
// every call's input + cache read + cache write + output. Streaming writes one line per content block under one
// message id, so each id counts once, at its last line. The Agent result's own number is the final context size,
// not the spend (results/m11-meter in the workbench), so it is never used. Only this sweep's own reviewers count:
// Claude Code's meta file beside the transcript says a reviewer that finished, and its first line is no older than
// the clearance. Anything else asks the owner, so a slip cannot count the wrong one; a hand-written transcript still
// passes, as a forged log line does. An id in `crashed` may be unfinished: --retry reads what it spent all the same.
const transcriptRoot = () => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
const folders = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(d, e.name)); } catch { return []; } };
const briefText = (asked) => (asked ? (typeof asked.content === 'string' ? asked.content : Array.isArray(asked.content) ? asked.content.map((x) => (x && x.text) || '').join('\n') : '') : '');

// A compaction can lose the ids from the lead's context; the briefs keep the sweep's tag. --agents auto reads them
// back: the reviewers written to since the clearance whose brief names this contract, in role order. spend() still
// checks each one, and a count that does not match the contract stops the outcome.
function reviewersOf(hash, since, skip) {
	const out = [];
	const after = Date.parse(since) || 0;
	for (const project of folders(transcriptRoot())) for (const session of folders(project)) {
		const dir = path.join(session, 'subagents');
		let names = [];
		try { names = fs.readdirSync(dir); } catch { continue; }
		for (const name of names) {
			const id = (name.match(/^agent-(.+)\.jsonl$/) || [])[1];
			if (!id || !AGENT_ID.test(id) || skip(id)) continue;
			const f = path.join(dir, name);
			try {
				if (fs.statSync(f).mtimeMs < after) continue;
				if (!/(^|:)reviewer$/i.test(String(JSON.parse(fs.readFileSync(f.replace(/\.jsonl$/, '.meta.json'), 'utf8')).agentType || ''))) continue;
				const fd = fs.openSync(f, 'r');
				const head = Buffer.alloc(1 << 20);
				const size = fs.readSync(fd, head, 0, head.length, 0);
				fs.closeSync(fd);
				const first = head.toString('utf8', 0, size).split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((e) => e && e.message && e.message.role === 'user');
				const tag = first && briefText(first.message).match(SWEEP_TAG);
				if (tag && tag[1] === hash) out.push({ id, role: Number(tag[2]) });
			} catch { /* no meta file or unreadable: not a reviewer this can count */ }
		}
	}
	return out.sort((a, b) => a.role - b.role).map((x) => x.id);
}

// The tool id of each start the guard let in, per role (1-based), across a round's clearings: the first start and a
// retry's. Claude Code writes the same id into the reviewer's meta file.
function startIds(clearings) {
	const lines = rawLines();
	const ids = new Map();
	for (const i of clearings) {
		const dir = path.join(path.dirname(LOG), 'kit-sweep-starts', sha(lines[i]));
		let names = [];
		try { names = fs.readdirSync(dir); } catch { continue; }
		for (const name of names) {
			const m = name.match(/^(\d+)(\.retry)?$/);
			let id = '';
			try { id = fs.readFileSync(path.join(dir, name), 'utf8').trim(); } catch { /* unreadable: no start */ }
			if (!m || !id) continue;
			const role = Number(m[1]) + 1;
			if (!ids.has(role)) ids.set(role, new Set());
			ids.get(role).add(id);
		}
	}
	return ids;
}

function spend(ids, since, hash, team, crashed = new Set(), guardStarts = null) {
	const root = transcriptRoot();
	const found = new Map(ids.map((id) => [id, []]));
	for (const project of folders(root)) for (const session of folders(project)) {
		for (const id of ids) { const f = path.join(session, 'subagents', `agent-${id}.jsonl`); if (fs.existsSync(f)) found.get(id).push(f); }
	}
	const bad = [];
	const toolIds = new Map();
	const roles = ids.map((id) => {
		const files = found.get(id);
		if (files.length !== 1) { bad.push(`${id} (${files.length ? `${files.length} transcripts` : 'no transcript'})`); return null; }
		let meta = {};
		try { meta = JSON.parse(fs.readFileSync(files[0].replace(/\.jsonl$/, '.meta.json'), 'utf8')); } catch { /* checked below */ }
		if (!/(^|:)reviewer$/i.test(String(meta.agentType || ''))) { bad.push(`${id} (not a reviewer: ${meta.agentType || 'no meta file'})`); return null; }
		const parsed = fs.readFileSync(files[0], 'utf8').split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } });
		const finished = meta.finished === true && parsed.length > 0 && parsed[parsed.length - 1] !== null;
		if (!finished && !crashed.has(id)) { bad.push(`${id} (not finished: log the outcome once every reviewer has handed back; one that crashed: --retry <n> --crashed <id>)`); return null; }
		// The log is per repo and transcripts are per machine, so a reviewer of another repo must not count here.
		// A removed worktree is read from its nearest folder still there, and the shell's GIT_DIR must not answer for it.
		let ran = (parsed.find((e) => e && e.cwd) || {}).cwd;
		while (ran && !fs.existsSync(ran) && path.dirname(ran) !== ran) ran = path.dirname(ran);
		const { GIT_DIR: _d, GIT_COMMON_DIR: _c, ...env } = process.env;
		const at = ran && spawnSync('git', ['-C', ran, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8', env });
		if (at && at.status === 0 && path.resolve(at.stdout.trim()).toLowerCase() !== path.dirname(LOG).toLowerCase()) { bad.push(`${id} (ran in another repo)`); return null; }
		// The brief names its sweep and role, so a transcript counts only for this contract and in its role's place.
		const asked = (parsed.find((e) => e && e.message && e.message.role === 'user') || {}).message;
		const tag = briefText(asked).match(SWEEP_TAG);
		if (!tag) { bad.push(`${id} (its brief has no "Sweep: <hash> role <n>" line)`); return null; }
		if (tag[1] !== hash) { bad.push(`${id} (brief is for another contract)`); return null; }
		const index = Number(tag[2]);
		if (!(index >= 1 && index <= team)) { bad.push(`${id} (brief names role ${index}; the contract has ${team})`); return null; }
		const started = (parsed.find((e) => e && e.timestamp) || {}).timestamp;
		if (!started || !(started >= since)) { bad.push(`${id} (started ${started || 'at no recorded time'}, before this sweep was cleared at ${since})`); return null; }
		const seen = new Map();
		for (const e of parsed) {
			const m = e && e.message;
			if (m && m.role === 'assistant' && m.usage) seen.set(m.id || e.uuid, m);
		}
		const u = (m, k) => Number(m.usage[k]) || 0;
		const calls = [...seen.values()];
		const per = (m) => u(m, 'input_tokens') + u(m, 'cache_read_input_tokens') + u(m, 'cache_creation_input_tokens') + u(m, 'output_tokens');
		const tokens = calls.reduce((t, m) => t + per(m), 0);
		// The split by kind (for a dollar ceiling later: cache reads are most of the meter and few of the dollars), the
		// starting context, the largest and last call (the ceiling's margin), and the cache re-writes after the first
		// call (a call that wrote over half of what it processed: the cache had expired).
		const split = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
		for (const m of calls) { split.input += u(m, 'input_tokens'); split.cacheRead += u(m, 'cache_read_input_tokens'); split.cacheWrite += u(m, 'cache_creation_input_tokens'); split.output += u(m, 'output_tokens'); }
		const shape = {
			split,
			firstCall: calls.length ? per(calls[0]) - u(calls[0], 'output_tokens') : 0,
			maxCall: Math.max(0, ...calls.map(per)),
			lastCall: calls.length ? per(calls[calls.length - 1]) : 0,
			rewrites: calls.slice(1).filter((m) => u(m, 'cache_creation_input_tokens') * 2 > per(m)).length,
			// Stopped: the call-cap hook refused a tool at the ceiling. Its own words in the transcript say so; the spend
			// alone cannot tell a role that was stopped from one that was done.
			// Only a refusal counts, with the hook's numbers in it: a reviewer that read the hook's source or this script
			// sees the words too (the 1.23.0 sweep).
			stopped: parsed.some((e) => e && e.message && e.message.role === 'user' && Array.isArray(e.message.content) && e.message.content.some((x) => x && x.type === 'tool_result' && x.is_error === true && /Token ceiling reached \(\d[\d,]* of \d/.test(typeof x.content === 'string' ? x.content : JSON.stringify(x.content)))),
		};
		// Claude Code writes some closing messages under a <synthetic> model; the real model is the last other one.
		const stamp = Date.parse(([...parsed].reverse().find((e) => e && e.timestamp) || {}).timestamp) || 0;
		toolIds.set(id, String(meta.toolUseId || ''));
		return { index, agent: id, model: [...seen.values()].map((m) => m.model).filter((m) => m && !/synthetic/i.test(m)).pop() || null, tokens, calls: seen.size, ...shape, finished, lastWrite: Math.max(fs.statSync(files[0]).mtimeMs, stamp) };
	});
	// A crash and its retry name one role by design.
	const own = roles.filter((x) => x && !crashed.has(x.agent));
	if (!bad.length) for (const x of own) if (own.filter((y) => y.index === x.index).length > 1) bad.push(`${x.agent} (role ${x.index} is named by more than one brief)`);
	// A brief anyone can copy; the start is the guard's. Only the transcript of a start it recorded for its role counts.
	// A sweep the owner decided outside the script had no clearing, so the guard started nothing to match.
	if (!bad.length && guardStarts) for (const x of roles) if (!(guardStarts.get(x.index) || new Set()).has(toolIds.get(x.agent))) bad.push(`${x.agent} (not the reviewer the guard started for role ${x.index})`);
	return bad.length ? { root, bad } : { root, roles: roles.sort((a, b) => a.index - b.index) };
}

// Every id an outcome has counted, a crash's included, so none can stand for a later sweep.
const usedAgents = (log) => new Set(log.filter((e) => e.kind === 'outcome').flatMap((e) => (Array.isArray(e.roles) ? e.roles : []).flatMap((r) => [r.agent, r.crashed])).filter(Boolean).map((x) => String(x).toLowerCase()));
const retriesSince = (log, contract, from) => log.filter((e, i) => i > from && e.kind === 'retry' && e.contract === contract);

// A reviewer that crashed left its role with no report, and its slot is spent. The owner's decision 2 (1.21.0): one
// more start for that role under the clearance the guard reads, on the crashed transcript's own evidence. Its spend
// joins the role at --outcome. A second crash says the role itself is the trouble, so it is the owner's: --cut-short.
// A reviewer still running has no `finished` either, so a crash is read only once its transcript has gone quiet.
function retry() {
	const s = state();
	const { clearings } = starts(s.log, contractFile);
	const at = clearings[clearings.length - 1];
	if (at === undefined || s.log.some((e, i) => i > at && e.kind === 'unread' && e.contract === contractFile)) { console.log('--retry needs an open sweep: no cleared sweep is open for this contract. Nothing logged.'); return 1; }
	const clearing = s.log[at];
	const team = Number(clearing.agents) || 0;
	const asked = String(opt('--retry'));
	const n = /^\d+$/.test(asked) ? Number(asked) : 0;
	if (!(n >= 1 && n <= team)) { console.log(`--retry needs a role from 1 to ${team}, its place in the contract. Nothing logged.`); return 1; }
	const id = opt('--crashed');
	if (!id || !AGENT_ID.test(id)) { console.log('--retry needs --crashed <id>, the crashed reviewer\'s agent id. Nothing logged.'); return 1; }
	const before = retriesSince(s.log, contractFile, clearings[0]).find((e) => e.role === n);
	if (before) { console.log(`Role ${n} already had its retry (${before.crashed} crashed): a further crash is the owner's. Mark it with --outcome --cut-short, and the next contract asks them. Nothing logged.`); return 1; }
	const read = usedAgents(s.log).has(id.toLowerCase()) ? { bad: [`${id} (already logged for an earlier outcome)`] } : spend([id], clearing.time, clearing.hash, team, new Set([id]), startIds(clearings));
	if (read.bad) { console.log(`--retry needs a crashed reviewer of this sweep: ${read.bad.join(', ')}. Nothing logged.`); return 1; }
	const [x] = read.roles;
	if (x.finished) { console.log(`${id} finished, so its report stands and its role needs no retry. Nothing logged.`); return 1; }
	if (x.index !== n) { console.log(`${id}'s brief names role ${x.index}, not role ${n}. Nothing logged.`); return 1; }
	const quiet = (Date.now() - x.lastWrite) / 60000;
	if (quiet < CRASH_QUIET_MINUTES) { console.log(`${id} last wrote ${Math.max(0, Math.floor(quiet))} minute(s) ago, so it may still be running. A crash is read only after ${CRASH_QUIET_MINUTES} quiet minutes: wait, then run --retry again. Nothing logged.`); return 1; }
	write({ kind: 'retry', contract: contractFile, hash: clearing.hash, role: n, crashed: id, clearing: sha(rawLines()[at]) });
	console.log(`Retry logged: role ${n} may start once more under this clearance, with the same brief. List the new reviewer's id in --agents; the spend of ${id} joins the role at the outcome.`);
	return 0;
}

function outcome() {
	if (has('--tokens')) { console.log('--tokens is not taken: the script reads each role\'s spend from its own transcript. Pass --agents <id,...>, one agent id per role. Nothing logged.'); return 1; }
	const s = state();
	// The decision is found by the contract's path, so an edit after approval still finds it.
	// An owner-decided sweep logs its outcome too, so the trial review sees every sweep.
	// A FIX THE CONTRACT line cleared nothing, so it never stands for the sweep that ran.
	const last = s.log.filter((e) => e.kind === 'decision' && e.contract === contractFile && e.decision !== 'fix').pop();
	if (!last) { console.log(`No decision for ${contractFile}; run approve.mjs on it first. Nothing logged.`); return 1; }
	if (last.decision === 'refused') { console.log('The script refused this contract, so no reviewer ran on it. Nothing logged.'); return 1; }
	// A sweep that can be neither measured nor closed as unused (a reviewer never finished, the ids were lost) is the
	// owner's: this marks it, and the next contract's ask carries it.
	if (has('--cut-short')) {
		const { open, reported } = openSweep(s.log);
		if (!open || reported || open.contract !== contractFile) { console.log('--cut-short marks the last approved sweep while its outcome is open; this contract is not that. Nothing logged.'); return 1; }
		write({ kind: 'unread', contract: contractFile });
		console.log('Marked as cut short. Run approve.mjs on the next contract: it asks the owner, and their yes closes this sweep unmeasured. List any findings left unfixed in the handoff by hand.');
		return 0;
	}
	// An approval no reviewer used (a new commit or an edited contract came first) is closed without a measure, but
	// only while the sweep guard shows no reviewer started under it.
	if (has('--none-ran')) {
		// Every clearing of this round (an approval or the owner's yes since the contract's last outcome) has its own
		// start slots in the guard's folder; any one taken means a reviewer ran.
		const { clearings, started } = starts(s.log, contractFile);
		const at = s.log.map((e, i) => (e.contract === contractFile && clears(e) ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
		if (!clearings.length || at < 0) { console.log('--none-ran closes a cleared sweep; this contract has none. Nothing logged.'); return 1; }
		if (started) { console.log(`${started} reviewer(s) started under this round's clearances, so its spend is measured: log the outcome with --agents. Nothing logged.`); return 1; }
		const d = answered(s.log, at);
		// The slots count starts the guard saw; a transcript that names this sweep shows one it did not.
		const used = usedAgents(s.log);
		const seen = reviewersOf(d.hash, d.time, (id) => used.has(id.toLowerCase()));
		if (seen.length) { console.log(`${seen.length} reviewer transcript(s) name this sweep (${seen.join(', ')}), so its spend is measured: log the outcome with --agents. Nothing logged.`); return 1; }
		write({ kind: 'outcome', contract: contractFile, decisionAt: d.time, budget: d.budget, tokens: 0, findings: 0, real: 0, duplicates: 0, noneRan: true });
		console.log('Outcome logged: no reviewer ran under this approval.');
		return 0;
	}
	// This round began at its first clearing after the contract's last outcome: an approval or the owner's yes. The
	// reviewers ran under its latest one, as the guard reads it, so a later ask or edit changes nothing measured here.
	const roundFrom = s.log.map((e, i) => (e.kind === 'outcome' && e.contract === contractFile ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
	const clearAts = s.log.map((e, i) => (i > roundFrom && e.contract === contractFile && ((e.kind === 'decision' && e.decision === 'approved') || e.kind === 'owner-yes') ? i : -1)).filter((i) => i >= 0);
	const clearAt = clearAts.length ? clearAts[clearAts.length - 1] : -1;
	const clearing = clearAt >= 0 ? s.log[clearAt] : null;
	const decision = (clearing && clearing.kind === 'owner-yes' ? s.log.slice(0, clearAt).filter((e) => e.kind === 'decision' && e.contract === contractFile && e.hash === clearing.hash).pop() : clearing) || last;
	const nums = {};
	const count = (k, max = Infinity) => { const v = Number(opt(`--${k}`)); return Number.isFinite(v) && v >= 0 && v <= max && Number.isInteger(v) ? v : null; };
	for (const k of ['findings', 'real', 'duplicates']) {
		const v = count(k);
		if (v === null) { console.log(`--${k} needs a whole number of 0 or more; nothing logged.`); return 1; }
		nums[k] = v;
	}
	// Real findings from roles on the mid model, for the reviewer model trial; optional.
	if (opt('--real-mid') !== undefined) {
		const v = count('real-mid', nums.real);
		if (v === null) { console.log('--real-mid needs a number from 0 to --real; nothing logged.'); return 1; }
		nums.realMid = v;
	}
	// A re-sweep is the last pass: what is left unfixed after it, from either pass, is counted, so nothing falls through.
	if (decision.resweepOf) {
		const v = count('carried');
		if (v === null) { console.log('A re-sweep\'s outcome needs --carried <n>: the findings left unfixed after it, from either pass, each medium or below. Nothing logged.'); return 1; }
		nums.carried = v;
	} else if (has('--carried')) { console.log('--carried is for a re-sweep\'s outcome; nothing logged.'); return 1; }
	if (has('--closed-carries')) {
		const v = count('closed-carries', openCarries(s.log));
		if (v === null) { console.log(`--closed-carries needs a number from 0 to the ${openCarries(s.log)} open; nothing logged.`); return 1; }
		nums.closedCarries = v;
	}
	const since = (clearAts.length ? s.log[clearAts[0]] : decision).time;
	const used = usedAgents(s.log);
	// A crash's retry stands for its role; the crashed transcript's spend is added to it below.
	const lost = clearAts.length ? retriesSince(s.log, contractFile, clearAts[0]).map((e) => e.crashed) : [];
	const isLost = (id) => lost.some((x) => x.toLowerCase() === id.toLowerCase());
	const auto = opt('--agents') === 'auto';
	const ids = auto ? reviewersOf(decision.hash, since, (id) => used.has(id.toLowerCase()) || isLost(id)) : String(opt('--agents') || '').split(',').map((x) => x.trim()).filter(Boolean);
	if (auto && ids.length !== Number(decision.agents)) { console.log(`--agents auto found ${ids.length} reviewer(s) for this sweep (${ids.join(', ') || 'none'}); the contract had ${decision.agents} role(s). Name the ids by hand, or a sweep cut short: --outcome --cut-short. Nothing logged.`); return 1; }
	// Windows file names ignore case, so a1 and A1 are one transcript.
	if (!ids.length || ids.some((id) => !AGENT_ID.test(id)) || new Set(ids.map((x) => x.toLowerCase())).size !== ids.length) { console.log('--agents needs the reviewers\' agent ids, comma-separated, each once (letters, digits, - and _). Nothing logged.'); return 1; }
	if (ids.length !== Number(decision.agents)) { console.log(`--agents names ${ids.length} agent(s); the contract had ${decision.agents} role(s): one id per role (each brief's Sweep line names its role). Nothing logged. A sweep cut short: --outcome --cut-short.`); return 1; }
	const refused =[...ids.filter((id) => used.has(id.toLowerCase())).map((id) => `${id} (already logged for an earlier outcome)`), ...ids.filter(isLost).map((id) => `${id} (logged as crashed: name its retry's id)`)];
	const read = refused.length ? { bad: refused } : spend([...ids, ...lost], since, decision.hash, Number(decision.agents), new Set(lost), clearAts.length ? startIds(clearAts) : null);
	if (read.bad) {
		const why = [`the spend cannot be read, so it is not guessed: ${read.bad.join(', ')}`];
		console.log('ASK THE OWNER - the spend cannot be read, so it is not guessed (rule:sweep-auto-approval):');
		console.log(`    ${read.bad.join(', ')}${read.root ? ` under ${toPosix(read.root)}` : ''}. Check the agent ids, or set CLAUDE_CONFIG_DIR to the config folder the session ran in. Nothing logged. A sweep cut short: --outcome --cut-short.`);
		console.log(`    Triage report for the owner: ${triage('a sweep outcome that cannot be measured', why, [`agents given: ${ids.join(', ')}`, `this round began at ${since}`])}`);
		return 1;
	}
	let roles = [];
	try { roles = JSON.parse(fs.readFileSync(contractFile, 'utf8')).roles || []; } catch { /* labels only */ }
	const per = read.roles.filter((x) => !isLost(x.agent)).map(({ index, finished: _f, lastWrite: _w, lastCall: _l, ...x }, i) => {
		const c = read.roles.find((y) => isLost(y.agent) && y.index === index);
		return { ...x, ...(c ? { tokens: x.tokens + c.tokens, calls: x.calls + c.calls, crashed: c.agent, crashedCalls: c.calls, crashedTokens: c.tokens } : {}), role: (roles[i] && roles[i].role) || `role ${i + 1}`, kind: (roles[i] && roles[i].kind) || null, cap: (decision.calls || [])[i] ?? null, budget: (decision.budgets || [])[i] ?? null, ceiling: (decision.ceilings || [])[i] ?? null };
	});
	nums.tokens = per.reduce((t, x) => t + x.tokens, 0);
	// Ten quiet minutes do not prove a crash: 16 of 303 reviewer transcripts paused that long and went on. A crashed
	// reviewer that wrote after its retry was logged is marked on its role in the log, where the trial reads it.
	const alive = (clearAts.length ? retriesSince(s.log, contractFile, clearAts[0]) : []).filter((e) => { const c = read.roles.find((y) => y.agent === e.crashed); return c && c.lastWrite > Date.parse(e.time); }).map((e) => e.crashed);
	for (const x of per) if (alive.includes(x.crashed)) x.crashedAlive = true;
	write({ kind: 'outcome', contract: contractFile, decisionAt: decision.time, budget: decision.budget, ...nums, roles: per });
	const trips = [];
	// The baselines are the roles measured before this outcome. Without enough of them the old whole-sweep trip stays.
	const past = measuredRoles(s.log);
	// Bounded only when the decision's own ceilings came from that baseline: ceilings set from the budgets keep the
	// whole-sweep trip, however many roles were measured since (the 1.23.0 sweep).
	const bounded = Array.isArray(decision.ceilings) && past.length >= CEILING_MIN && /^the p90/.test(String(decision.ceilingFrom || ''));
	if (!bounded && decision.budget && nums.tokens >= OVERRUN * decision.budget) trips.push(`tokens ${nums.tokens} ran ${Math.round((nums.tokens / decision.budget - 1) * 100)}% over the budget of ${decision.budget}`);
	const n = (x) => Math.round(x).toLocaleString('en-US');
	// A crash and its retry each had the whole ceiling, so the check reads the retry alone, as the call check does.
	for (const x of per) { const own = x.tokens - (x.crashedTokens || 0); if (x.ceiling && own > x.ceiling + x.maxCall) trips.push(`the token ceiling did not hold for ${x.role}: ${n(own)} against ${n(x.ceiling)} (the hook is missing or did not fire)`); }
	// Past the cap's own stop (one call over is the hook's margin): the hook is missing or did not hold. Without a
	// baseline the whole-sweep trip covers it and this is a note; under the bound nothing else would, so it trips (the
	// 1.23.0 sweep).
	for (const x of per) {
		const calls = x.calls - (x.crashedCalls || 0);
		const said = `${x.role} ran ${calls} calls against its cap of ${x.cap}: no call-cap hook held it`;
		if (x.cap && calls > x.cap + 1) { if (bounded) trips.push(said); else console.log(`    ${said}.`); }
	}
	if (bounded) {
		const stopped = per.filter((x) => x.stopped).length;
		if (stopped > STOPPED_SHARE * per.length) trips.push(`${stopped} of ${per.length} roles stopped at their token ceiling (the work outgrew it)`);
		const firsts = past.filter((r) => Number(r.firstCall) > 0).map((r) => Number(r.firstCall));
		const start = median(per.map((x) => x.firstCall));
		if (firsts.length >= CEILING_MIN && start > START_DRIFT * median(firsts)) trips.push(`the starting context (${n(start)}) is ${Math.round((start / median(firsts) - 1) * 100)}% over its median of ${n(median(firsts))} (rules or tools grew)`);
		const content = median(per.map((x) => x.tokens / x.calls));
		const p95 = nearestRank(past.map((r) => Number(r.tokens) / Number(r.calls)), CONTENT_PCT);
		if (content > p95) trips.push(`content per call (${n(content)}) is over its p95 of ${n(p95)} (a new kind of work)`);
		const rewrites = per.reduce((t, x) => t + (x.rewrites || 0), 0);
		if (rewrites >= REWRITES_TRIP) trips.push(`${rewrites} cache re-writes after the first call (the cache expired between calls)`);
	}
	if (nums.findings > 0 && nums.duplicates * 3 >= nums.findings) trips.push(`${nums.duplicates} of ${nums.findings} findings repeated between roles`);
	// The reviewer trial and the top-model rule rest on the model a role names, so a reviewer on another one is the owner's.
	per.forEach((x, i) => {
		// The model the decision cleared, so an edit to the contract after it hides nothing.
		const named = (decision.models || [])[i] ?? (roles[i] ? (roles[i].model ?? DEFAULT_MODEL) : null);
		if (named && (!x.model || !modelKey(x.model) || modelKey(named) !== modelKey(x.model))) trips.push(`${x.role} ran on ${x.model || 'no recorded model'}; the contract named ${named}`);
	});
	for (const t of trips) write({ kind: 'pause', reason: t });
	for (const id of alive) console.log(`    ${id} wrote after its retry was logged: it was not dead, so its role had two reviewers. Its spend so far is counted.`);
	console.log(trips.length ? `Outcome logged; auto-approval paused: ${trips.join('; ')}` : `Outcome logged: ${nums.tokens.toLocaleString('en-US')} processed tokens over ${per.length} role(s).`);
	if (trips.length) {
		const f = triage('auto-approval paused after a sweep\'s outcome', trips, [
			`tokens ${nums.tokens} of the budget ${decision.budget} (the trip is ${OVERRUN}x)`,
			...per.map((x) => `${x.role} (${x.kind}, ${x.model}): ${x.tokens} processed tokens`),
			`findings ${nums.findings}, real ${nums.real}, repeated between roles ${nums.duplicates}`,
		]);
		console.log(`    Triage report for the owner: ${f}`);
	}
	if (nums.carried > 0) console.log(`CARRY-OVER - ${nums.carried} finding(s) left unfixed after the re-sweep (medium or below only; a high or critical is fixed or the owner accepts it) go to ${CARRY_HOME}. List each there; every sweep start shows them open until that sweep's outcome closes them with --closed-carries <n>.`);
	return 0;
}

function summary() {
	const s = state();
	const d = s.log.filter((e) => e.kind === 'decision');
	const o = s.log.filter((e) => e.kind === 'outcome');
	const sum = (k, list = o) => list.reduce((t, e) => t + (Number(e[k]) || 0), 0);
	// Before the meter a lead typed the tokens, so those outcomes do not compare with the rest.
	const metered = o.filter((e) => Array.isArray(e.roles));
	const typed = o.filter((e) => !Array.isArray(e.roles) && !e.noneRan && !e.closedByOwner).length;
	console.log(`approved: ${d.filter((e) => e.decision === 'approved').length}, sent to the owner: ${d.filter((e) => e.decision === 'owner').length}, sent back to fix: ${d.filter((e) => e.decision === 'fix').length}, refused: ${d.filter((e) => e.decision === 'refused').length}`);
	console.log(`outcomes: ${o.length}; tokens / budget: ${sum('budget', metered) ? (sum('tokens', metered) / sum('budget', metered)).toFixed(2) : 'n/a'}${typed ? ` (${typed} older hand-typed outcome${typed > 1 ? 's' : ''} left out)` : ''}; real findings: ${sum('real')} of ${sum('findings')} (from mid-model roles: ${sum('realMid')}); repeated: ${sum('duplicates')}; carried open: ${openCarries(s.log)}`);
	// Per role kind, the most one role spent and the calls it took: the data the growth figures are adjusted from.
	const kinds = {};
	for (const r of o.flatMap((e) => (Array.isArray(e.roles) ? e.roles : []))) {
		const k = (kinds[r.kind] ||= { n: 0, max: 0, calls: 0 });
		k.n++;
		if (r.tokens >= k.max) { k.max = r.tokens; k.calls = r.calls; }
	}
	const n = (x) => x.toLocaleString('en-US');
	if (Object.keys(kinds).length) console.log(`spend by role kind (processed tokens): ${Object.entries(kinds).map(([k, v]) => `${k} x${v.n}: up to ${n(v.max)}${v.calls ? ` over ${v.calls} calls` : ''}`).join('; ')}`);
	console.log(`escapes: ${s.log.filter((e) => e.kind === 'escape').length}; closed unmeasured by the owner: ${o.filter((e) => e.closedByOwner).length}; state: ${s.paused ? `paused (${s.paused})` : `running, ${s.approvedSinceReview} of ${s.reviewEvery} since the last review`}`);
	// Both ways to resume: the owner may be at the terminal or on the phone.
	if (s.paused) for (const line of [resumeHelp(s)[2], resumeHelp(s)[4]]) console.log(line.trim());
	return 0;
}

function main() {
	if (!LOG) { console.log('ASK THE OWNER - not inside a git repository, so there is no approval log.'); return 1; }
	if (has('--summary')) return summary();
	if (has('--owner-setup')) return ownerSetup();
	if (has('--resume') && has('--thread')) {
		// From the thread (E27): the owner's own message, after the pause, that says resume.
		const s = state();
		if (!s.paused) { console.log('Auto-approval is not paused; nothing to resume. Nothing logged.'); return 1; }
		const id = opt('--thread');
		const m = ownerMessage(id);
		if (m.err) { console.log(`Refused: ${m.err}. Nothing logged.`); return 1; }
		if (messageUsed(s.log, id)) { console.log(`Refused: message ${id} already answered; one message answers one. Nothing logged.`); return 1; }
		if (!(Date.parse(m.at) > Date.parse(s.pausedAt || 0))) { console.log(`Refused: message ${id} was sent before the pause (${s.pausedAt}). Nothing logged.`); return 1; }
		// The whole message is the resume and this pause's code, nothing hedged around it.
		const code = pauseCode(s);
		if (!new RegExp(`^resume ${code}\\.?$`, 'i').test(m.words)) { console.log(`Refused: message ${id} ("${m.words}") is not "resume <code>" with this pause's code (${code}). Nothing logged.`); return 1; }
		write({ kind: 'resume', words: m.words, proof: 'thread', message: id });
		console.log(`Auto-approval resumed on the owner's message ${id}; the next review comes after ${state().reviewEvery} more.`);
		return 0;
	}
	if (has('--resume')) {
		// An AI tool's shell carries one of these; the owner's own terminal does not (the push guard's same line).
		if ('CLAUDECODE' in process.env || 'AI_AGENT' in process.env || process.env.KIT_OWNER_RESUME !== '1') {
			console.log('Only the owner resumes auto-approval, from their own terminal: review the log, then run KIT_OWNER_RESUME=1 node approve.mjs --resume.');
			return 1;
		}
		const s = state();
		// As the thread's way: with nothing paused there is nothing to resume, and no code to type (the 1.24.0 sweep).
		if (!s.paused) { console.log('Auto-approval is not paused; nothing to resume. Nothing logged.'); return 1; }
		const why = typedAtTerminal(pauseCode(s) || 'resume', 'the resume');
		if (why) { console.log(`Refused: ${why}. Nothing logged.`); return 1; }
		write({ kind: 'resume' });
		console.log(`Auto-approval resumed; the next review comes after ${state().reviewEvery} more.`);
		return 0;
	}
	if (!contractFile) { console.log('Usage: node approve.mjs <contract.json> [--outcome ... | --escape "<note>"] [--base <ref>]'); return 2; }
	// E24 C: a cloud thread loads no repo hooks, so neither the call-cap hook nor the sweep guard would hold its
	// reviewers, and its log is not the PC's. Claude Code sets CLAUDE_CODE_REMOTE=true in a cloud VM.
	if (process.env.CLAUDE_CODE_REMOTE === 'true') { console.log('Refused: sweeps run on the owner\'s PC, where the hooks hold each reviewer. A cloud thread runs the worker jobs only (tests, builds, gate checks, research, read-only review). Nothing logged.'); return 1; }
	if (has('--escape')) {
		write({ kind: 'escape', contract: contractFile, note: opt('--escape') });
		const reason = `a bug escaped a passed sweep: ${opt('--escape')}`;
		write({ kind: 'pause', reason });
		console.log('Escape logged; auto-approval paused for the owner.');
		console.log(`    Triage report for the owner: ${triage('a bug escaped a passed sweep', [reason], [`escapes logged so far: ${state().log.filter((e) => e.kind === 'escape').length}`])}`);
		return 0;
	}
	if (has('--owner-yes')) return ownerYes();
	if (has('--retry')) return retry();
	if (has('--outcome')) return outcome();
	return decide();
}

process.exitCode = main();
