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
// One sweep per branch (the owner, 2026-11-17, D-3): there is no re-sweep. A contract that names one ("resweepOf") is
// refused; each fix after the sweep carries a failing-first test, and CI's test check is the gate (rule:finding-pipeline).
// Any other pass after a sweep that ran on the branch asks the owner.
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
// pauses itself, and only the owner resumes it, by their Yes in Claude Code's choice pop-up, after: tokens a quarter or more
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
//        [--closed-carries N (carried findings this sweep fixed)]
//   node approve.mjs <contract.json> --owner-yes                       after an ASK, once the owner tapped Yes in the pop-up
//   node approve.mjs <contract.json> --retry <n> --crashed <id>         one more start for role n, whose reviewer crashed
//   node approve.mjs <contract.json> --escape "<what slipped through>"
//   node approve.mjs --summary
//   node approve.mjs --resume                                           after a pause, once the owner tapped Yes in the pop-up
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
// The record check a hand-back's RECORD: block must pass (the kit's tools folder sits beside the skills folder).
let checkRecord = null, findingAbove = null, namedBy = null;
try { ({ check: checkRecord, findingAbove, namedBy } = await import('../../kit-tools/handoff.mjs')); } catch { /* no checker: a RECORD report is not tallied */ }
// K315: the template slots a rules block must not still hold (one list, shared with install).
import { slotsIn } from './slots.mjs';
// K182: the one price table, beside the call-cap hook that meters with it (kit-hooks sits two folders up, in the kit
// source and in the Claude folder alike).
const { price, dollars, reportDollars } = createRequire(import.meta.url)('../../kit-hooks/prices.cjs');

const SELF = fileURLToPath(import.meta.url);
// The owner's pop-up answers, read the way the guards read them (an exact copy the kit's build keeps in kit-tools).
const { sessionYes, unquotedYes, sessionGap } = createRequire(import.meta.url)('../../kit-tools/owner-yes.cjs');
// git starts from node's own folder, never the repo, through the helper the PR audits use (build 23).
const safeSpawn = createRequire(import.meta.url)('../../kit-tools/audits/safe-spawn.cjs');
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
// The reviewer role's own model (user/agents/reviewer.md), for a role that names none. K114 (1.42.0): the mid model,
// once MC3 showed mid-model reviewers find what top-model ones find at about half the cost (the trial's end).
const DEFAULT_MODEL = 'claude-sonnet-5-5';
// Security and the novel lens stay on the top model: a role of those kinds that names no model runs on it, and its
// Agent call names it (the outcome refuses a reviewer that ran on another model than the contract's).
const TOP_DEFAULT = 'claude-opus-5-5';
const modelKey = (m) => { const s = String(m ?? DEFAULT_MODEL); return /opus/i.test(s) ? 'opus' : /sonnet/i.test(s) ? 'sonnet' : null; };
const CARRY_HOME = 'the handoff\'s "Carry-overs from the last PR" (_Active Plan.md); fixed first in the next build';
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
const roleModel = (r) => r.model ?? (TOP_ONLY.includes(r.kind) ? TOP_DEFAULT : DEFAULT_MODEL);
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
// The prompt cache lives 5 minutes; a shorter gap between two calls cannot have let it expire.
const REWRITE_GAP_MS = 5 * 60 * 1000;
const TRIAL_EVERY = 10;
const TRIAL_EVERY_EARNED = 20;
// Two questions sharing this much of their words are one question asked twice. Rewording beats a word count, so the
// outcome's repeated-findings trip is the real backstop for clones.
const CLONE = 0.5;
// The changed lines a triage sweep may cover: every line of code, but none of docs or data, and none a test file
// gains that a deleted test file lost (a test file split or moved unchanged). A line taken out of a test file that
// stays is a test changed, so it counts.
function triageLines(base) {
	// The whole diff, renames off: a test split reads as a rename of one file, which hides the other side's lines.
	// --text: a file git would show as binary (a NUL byte, a -diff attribute) is read line by line, never as 0 lines.
	const d = git('diff', '-U0', '--no-color', '--no-renames', '--no-ext-diff', '--no-textconv', '--text', `${base}...HEAD`);
	if (d.status !== 0) return Infinity;
	// The file a hunk belongs to is read from its own header: "--- a/x" names a removed file, "+++ b/x" any other. A
	// header is read only before a file's first @@, since a removed line "-- x" shows as "--- x" inside a hunk. A quoted
	// name (git quotes odd characters) is not read at all: its lines count as code.
	let file = '';
	let gone = false;
	let hunk = false;
	let other = 0;
	const moved = new Map();
	for (const l of d.stdout.split('\n')) {
		if (l.startsWith('diff --git ')) { file = ''; gone = false; hunk = false; continue; }
		if (!hunk && l.startsWith('@@')) { hunk = true; continue; }
		if (!hunk && (l.startsWith('--- ') || l.startsWith('+++ '))) {
			if (l === '+++ /dev/null') gone = true;
			else if (l !== '--- /dev/null') file = l[4] === '"' ? '"' : l.slice(6);
			continue;
		}
		if (!hunk || !/^[-+]/.test(l)) continue;
		if (file !== '"' && (DOC_FILE.test(file) || DATA_FILE.test(file) || sweepOwned(file))) continue;
		if (file === '"' || !TEST_FILE.test(file) || (l[0] === '-' && !gone)) { other++; continue; }
		// A moved test line cancels one of its twin on the other side, counted, so ten copies do not hide behind one.
		const t = l.slice(1).trim();
		moved.set(t, (moved.get(t) || 0) + (l[0] === '-' ? 1 : -1));
	}
	let tests = 0;
	for (const n of moved.values()) tests += Math.abs(n);
	return other + tests;
}

// What the diff shows. Triage is at most this many changed lines with no new file (a starting value, like the caps).
const TRIAGE_MAX_LINES = 20;
// I7 (build 18): Maven, Gradle, .NET and PHP dependency files too.
const DEP_FILE = /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|requirements[^/]*\.txt|pyproject\.toml|poetry\.lock|Pipfile(\.lock)?|Cargo\.(toml|lock)|go\.(mod|sum)|Gemfile(\.lock)?|pom\.xml|(build|settings)\.gradle(\.kts)?|gradle\.lockfile|[^/]+\.csproj|packages\.lock\.json|Directory\.Packages\.props|composer\.(json|lock))$/;
// T10 (build 18): the floor comes from what the diff touches. Gate code (CI, git hooks, a guard or hook of the project's
// .claude folder, the kit's own hooks, tools and install, this script) is feature work with the security modifier.
// Any .claude file counts: settings, bounds and kit json steer the guards, and a command or agent file's front matter
// grants tools. So do the CI templates a project installs, the skills' own scripts, and any script a CI workflow runs
// (read from the workflows on both sides of the diff, ciRuns below).
const GATE_FILE = /(^|\/)\.(github|githooks|claude)\/|(^|\/)_Templates\/ci-[^/]*\.ya?ml$|^user\/(kit-hooks|kit-tools)\/|^user\/skills\/[^/]+\/[^/]+\.(c?js|mjs)$|^scripts\/kit\.mjs$|(^|\/)approve\.mjs$/;
// I9 (build 18): a release's record, its changelog and version, and the root docs/ folder's prose, data and pictures
// are not source, however long. Code under docs/ (a migration script, a page) still counts.
const DATA_FILE = /^docs\/.*\.(md|json|txt|png|svg|jpe?g|gif|csv)$|^(VERSION|CHANGELOG\.md)$|^\.kit\/[^/]+\.json$/;
const TEST_FILE = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[a-z]+$|_test\.[a-z]+$/;
const DOC_FILE = /\.(md|txt|rst)$/i;
// CM6 (c, reproduced on 1.47.0): code a project ships, and a skill's own file, are fix work however small; only tests,
// docs, records and maps are triage (the build 18 plan, section 4).
const SHIPPED_CODE = /\.(c?js|mjs|tsx?|jsx|py|sh|bash|ps1|psm1|go|rs|java|kt|rb|php|cs|swift|c|cc|cpp|h|sql|vue|svelte)$/i;
const SKILL_FILE = /(^|\/)skills\/[^/]+\/SKILL\.md$/i;
// What a sweep or a release commits about itself is not source: a committed contract, the project's caps file
// and a migration file pushed a fix or triage sweep up a tier. Any other added .json still counts.
const KIT_JSON = /^(docs\/migrations\/[^/]+\.json|\.kit\/sweep-approval\.json)$/i;
const TIER_RANK = { triage: 0, fix: 1, feature: 2, 'first push': 3, 'launch gate': 4 };
const FIX_EXIT = 3;
// The line each reviewer's brief carries: the cleared contract's hash and the role's place in it (the sweep guard reads it).
const SWEEP_TAG = /Sweep: ([0-9a-f]{16}) role (\d+)/;
const sweepLine = (hash) => `Each brief carries "Sweep: ${hash} role <n>" (n is the role's place in the contract), its role's "Call cap: <n>" and its ceiling line ("Dollar ceiling: $<x>", or "Token ceiling: <n>" on a log with no dollar baseline).`;
// K182: the brief's ceiling line, in the unit the decision set.
const ceilingLine = (unit, x) => (unit === 'dollars' ? `Dollar ceiling: $${Number(x).toFixed(2)}` : `Token ceiling: ${x}`);

// The roles the log measured, the last CEILING_ROLES of them: what a ceiling and the drift baselines are read from.
// A role whose reviewer crashed and was retried counts as its retry: each run had a whole ceiling of its own.
const ownRun = (r) => (r && r.crashedTokens ? { ...r, tokens: Number(r.tokens) - Number(r.crashedTokens), calls: Number(r.calls) - Number(r.crashedCalls || 0) } : r);
const measuredRoles = (log) => log.filter((e) => e.kind === 'outcome' && Array.isArray(e.roles)).flatMap((e) => e.roles).map(ownRun).filter((r) => r && Number(r.tokens) > 0 && Number(r.calls) > 0).slice(-CEILING_ROLES);
// Nearest rank, so the value is one a real role spent.
const nearestRank = (values, p) => { const v = [...values].sort((a, b) => a - b); return v.length ? v[Math.max(0, Math.ceil(p * v.length) - 1)] : 0; };
const median = (values) => nearestRank(values, 0.5);
// K182 (build 22): a role's ceiling in list-price dollars, forward from its own call cap: its cap x the p90 of what past
// roles on the same model spent a call, plus room for its report. A token ceiling counted cache re-reads (84% of the
// kit's reviewer tokens, 12% of its dollars) and came from other roles' totals, so a bigger diff hit it sooner: 16 roles
// stopped before their cap, where this ceiling stops 4 (bt-meter on the kit's own log, 2026-11-21). Used when every
// role's model has CEILING_MIN past roles with their spend split by kind; otherwise the token ceiling below, as before.
const dollarRoles = (log, key) => log.filter((e) => e.kind === 'outcome' && Array.isArray(e.roles)).flatMap((e) => e.roles).map(ownRun)
	.filter((r) => r && r.split && Number(r.calls) > 0 && !r.crashedTokens && price(r.model).key === key).slice(-CEILING_ROLES);
const perCall = (r) => dollars(r.split, r.model) / Number(r.calls);
const cents = (x) => Math.ceil(x * 100) / 100;
function dollarCeilings(log, roles) {
	const out = [];
	let expected = 0;
	for (const r of roles) {
		const model = roleModel(r);
		const past = dollarRoles(log, price(model).key);
		if (past.length < CEILING_MIN) return null;
		out.push(cents(Number(r.calls) * nearestRank(past.map(perCall), CEILING_PCT) + reportDollars(model)));
		expected += Number(r.calls) * median(past.map(perCall));
	}
	return { ceilings: out, unit: 'dollars', expected: cents(expected), from: `the p90 dollars a call of the last ${CEILING_ROLES} roles on each role's model, x its call cap, plus its report` };
}
function ceilingsFor(log, budgets, roles = []) {
	const d = roles.length ? dollarCeilings(log, roles) : null;
	if (d) return d;
	const past = measuredRoles(log);
	if (past.length < CEILING_MIN) return { ceilings: budgets.map((b) => Math.round(b * OVERRUN)), from: `${OVERRUN}x each role's budget (fewer than ${CEILING_MIN} roles measured in this repo's log)` };
	const at = nearestRank(past.map((r) => Number(r.tokens)), CEILING_PCT);
	return { ceilings: budgets.map(() => at), from: `the p90 of the last ${past.length} roles measured` };
}

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const has = (name) => args.includes(name);
const contractFile = args[0] && !args[0].startsWith('--') ? path.resolve(args[0]) : null;
const git = (...a) => safeSpawn.gitRead(contractFile ? path.dirname(contractFile) : process.cwd(), a, { encoding: 'utf8' });
// K218: git for the base copy of the rules, through the safe-spawn read (node's own folder, fsmonitor and every fetch
// protocol off), with lazy fetch off too: a planted git.exe or a hook program in the repo config never runs.
const baseGit = (...a) => safeSpawn.gitRead(contractFile ? path.dirname(contractFile) : process.cwd(), a, { encoding: 'utf8', env: { ...process.env, GIT_NO_LAZY_FETCH: '1' } });
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
// K357 S1: the checkout the contract sits in (a linked worktree's own, or the main checkout's); '' when git cannot read one.
const toplevel = () => { const t = git('rev-parse', '--show-toplevel'); return t.status === 0 ? t.stdout.trim() : ''; };

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

// The script files a CI workflow names, at one commit: a gate runs them, so a change to one is gate code.
function ciRuns(ref) {
	const out = new Set();
	for (const f of git('ls-tree', '-r', '--name-only', '--full-name', ref, '--', ':(top).github/workflows').stdout.split('\n').filter(Boolean)) {
		for (const m of git('show', `${ref}:${f}`).stdout.matchAll(/(?:^|[\s"'=(])(?:\.\/)?([\w.-]+(?:\/[\w.-]+)*\.(?:mjs|cjs|js|ts|py|sh|ps1))\b/g)) out.add(m[1]);
	}
	return out;
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
	// Renames off: a gate file moved out of its folder must still read as the gate file it was.
	const names = (filter) => git('diff', '--name-only', '-z', '--no-renames', `--diff-filter=${filter}`, `${base}...HEAD`).stdout.split('\0').filter(Boolean);
	const all = names('ACDMRT');
	const added = names('A').filter((f) => !sweepOwned(f));
	const lines = git('diff', '--numstat', '--text', '--no-renames', `${base}...HEAD`).stdout.split('\n').filter(Boolean).filter((l) => !sweepOwned(l.split('\t')[2])).reduce((t, l) => t + (Number(l.split('\t')[0]) || 0) + (Number(l.split('\t')[1]) || 0), 0);
	// Work not yet committed would not be in the diff the floor reads; the sweep's own files are left out.
	const dirty = git('status', '--porcelain', '--untracked-files=all', '--', ':(top)').stdout.split('\n').filter(Boolean).filter((l) => !sweepPaper(l.slice(3)));
	return {
		base,
		// The merge base the branch's diff is read from, as a commit: the log records it, so the same branch in another
		// checkout reads the same base.
		mergeBase: git('merge-base', base, 'HEAD').stdout.trim() || null,
		baseName: short(base),
		offBase,
		staleBase,
		noHome: Boolean(want) && !home,
		head: git('rev-parse', 'HEAD').stdout.trim(),
		dirty,
		changed: all.length,
		deps: all.filter((f) => DEP_FILE.test(f)).some((f) => depsChanged(base, f)),
		tests: all.some((f) => TEST_FILE.test(f)),
		addedSource: added.filter((f) => !TEST_FILE.test(f) && !DOC_FILE.test(f) && !DATA_FILE.test(f)),
		// CM6 (c): shipped code and skills are fix work at any size (the build 18 plan, section 4).
		shipped: all.filter((f) => !sweepOwned(f) && !TEST_FILE.test(f) && (SHIPPED_CODE.test(f) || SKILL_FILE.test(f))),
		added,
		lines,
		// A workflow may run a script from another folder (working-directory, cd), so a file whose name a workflow names
		// counts by its name alone: reading too much as gate code costs a heavier sweep, too little a lighter one.
		gate: (() => { const ci = new Set([...ciRuns(base), ...ciRuns('HEAD')].map((f) => f.split('/').pop())); return all.filter((f) => GATE_FILE.test(f) || ci.has(f.split('/').pop())); })(),
		// Triage reads the lines that can change behaviour: not docs, records or maps, and not a test line the same
		// change removed from another test file (a split or a move).
		triageLines: triageLines(base),
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
	const big = { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 600000 };
	const diff = safeSpawn.gitRead(path.dirname(contractFile), ['log', '-p', '--no-merges', `-${PATCH_MAX}`, '--format=commit %H', `${base}..HEAD`], big);
	if (diff.status !== 0 || diff.error) return null;
	if (!diff.stdout) return [];
	const ids = safeSpawn.tool('git', ['patch-id', '--stable'], { ...big, input: diff.stdout });
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
	// Since V3 (1.25.1) the guard launcher the user settings run loads guard.cjs, which runs the call cap and the sweep
	// guard from the Claude config folder's kit-hooks: wired when that entry is whole and both hooks are there.
	// The launcher and the folder are the ones this script was installed with (its own skills folder's home), never a
	// folder an environment variable names, so no fake launcher can answer for them (the review of fa37f84).
	const cfg = path.resolve(path.dirname(SELF), '..', '..');
	const launcher = path.join(cfg, 'kit-tools', 'kit-launch.cjs');
	try {
		const { launcherWired } = createRequire(import.meta.url)(launcher);
		const node = json(fs.readFileSync(path.join(cfg, 'kit-install.json'), 'utf8')).node;
		const own = fs.readFileSync(path.join(cfg, 'settings.json'), 'utf8');
		if (!json(own).disableAllHooks && launcherWired(json(own), launcher, node) && ['call-cap.cjs', 'sweep-guard.cjs'].every((f) => fs.existsSync(path.join(cfg, 'kit-hooks', f)))) return 'wired';
	} catch { /* no launcher: the project's own settings decide */ }
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
		if (facts.gate.length && TIER_RANK[tier] < TIER_RANK.feature) why.push(`${facts.gate[0]} is gate code (CI, a git hook, a guard, the kit's hooks, tools or install): feature work with the security-sensitive modifier, not ${tier}`);
		if (tier !== 'feature' && facts.addedSource.length) why.push(`an added source file (${facts.addedSource[0]}) is feature work, not ${tier}`);
		const addedCode = facts.added.filter((f) => !DOC_FILE.test(f) && !DATA_FILE.test(f) && !TEST_FILE.test(f));
		if (tier === 'triage' && facts.shipped.length) why.push(`shipped code or a skill (${facts.shipped[0]}) is fix work, not triage`);
		if (tier === 'triage' && (addedCode.length || facts.triageLines > TRIAGE_MAX_LINES)) why.push(`${facts.triageLines} changed lines that are not docs, records or moved tests, ${addedCode.length} added files: more than a triage change`);
	}
	const roles = Array.isArray(c.roles) ? c.roles : [];
	const cap = caps(tier, facts && facts.base);
	if (hookState(facts && facts.base) === 'missing') fix.push(HOOK_MISSING);
	if (!roles.length) fix.push('no roles');
	if (roles.length > cap.maxAgents) why.push(`${roles.length} agents, over the project's ${tier} cap of ${cap.maxAgents}`);
	// A2 (D-3): a refusal is the rule working, so it neither pauses nor writes a triage report.
	if (c.resweepOf !== undefined) return { why: [], fix: [], need: {}, refused: 'there is no re-sweep: one sweep per branch (the owner, 2026-11-17); each fix after it carries a failing-first test, and CI is the gate', first: null };
	const need = { ...NEEDS[tier] };
	const first = null;
	{
		// One sweep per branch: a plain contract after a sweep that ran here is a second pass, the owner's (rule:finding-pipeline).
		const done = facts && secondPass(log, facts.base);
		if (done) why.push(`a second sweep on this branch is the owner's under the one-sweep loop (rule:finding-pipeline): ${rel(done)} already ran`);
		if (c.modifiers !== undefined && !(Array.isArray(c.modifiers) && c.modifiers.every((m) => typeof m === 'string'))) fix.push('modifiers must be a list of names, like ["security-sensitive"]');
		const modifiers = new Set(Array.isArray(c.modifiers) ? c.modifiers : []);
		if (facts && facts.deps) modifiers.add('new-dependency');
		if (facts && facts.gate.length) modifiers.add('security-sensitive');
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
	if (extras > cap.maxExtras) why.push(`${extras} roles beyond the ${tier} floor, over its cap of ${cap.maxExtras}`);
	roles.forEach((r, i) => {
		const name = `role ${i + 1} (${r.role || r.kind})`;
		if (!KINDS.includes(r.kind)) fix.push(`${name}: unknown kind "${r.kind}" (one of: ${KINDS.join(', ')})`);
		if (!filled(r.question, 15)) fix.push(`${name}: no real question`);
		if (!Array.isArray(r.context) || !r.context.length || !r.context.every((x) => filled(x, 2))) fix.push(`${name}: no context (the files, rule and spec its lens needs)`);
		else if (r.context.length > MAX_CONTEXT) why.push(`${name}: ${r.context.length} context entries, over ${MAX_CONTEXT}: a role's context is what its lens needs`);
		if (!filled(r.finding, 8)) fix.push(`${name}: no finding shape`);
		// The reviewer model rule (rule:test-and-review-cadence): security and the novel lens stay on the top model.
		if (TOP_ONLY.includes(r.kind) && r.model !== undefined && !TOP_MODEL.test(String(r.model))) fix.push(`${name}: a ${r.kind} role stays on the top model, not "${r.model}"`);
		// The reviewer model rule names these two; the budget formula was fit on them.
		if (r.model !== undefined && !modelKey(r.model)) why.push(`${name}: model "${r.model}" is outside the reviewer model rule (opus, sonnet)`);
	});
	const { budgets, total } = callBudgets(roles, cap, why, fix);
	if (total > cap.maxTotalBudget) why.push(`total budget ${total} over the project's ${tier} cap of ${cap.maxTotalBudget}`);
	for (let i = 0; i < roles.length; i++) for (let j = i + 1; j < roles.length; j++) {
		if (overlap(roles[i].question, roles[j].question) >= CLONE) fix.push(`roles ${i + 1} and ${j + 1} ask the same question (a clone)`);
	}
	return { why, fix, need, extras, cap, first, budgets, total };
}

// Findings carried from an earlier sweep, still open until a later outcome closes them.
const openCarries = (log) => log.filter((e) => e.kind === 'outcome').reduce((t, e) => t + (Number(e.carried) || 0) - (Number(e.closedCarries) || 0), 0);

// What the owner reads at a stop: what tripped, the numbers, the log lines and the ways forward.
const FIXES = [
	[/paused|trial review due/, 'The owner reviews the log first (`approve.mjs --summary`), then resumes with a Yes in the pop-up; until then every sweep goes to the owner.'],
	[/not committed|no changes|cannot read the branch diff/, 'Commit the work and run approve.mjs from the branch\'s own checkout (pass `--base <ref>` if it cannot find the base).'],
	[/needs \d+ \S+ role/, 'Add the missing floor role(s) and run approve.mjs again.'],
	[/beyond the \S+ floor|agents, over/, 'Drop the extra roles, or split the change into smaller PRs.'],
	[/call cap \(|\d calls, over/, `Set each role's "calls" at ${STANDARD_CALLS} or under, or up to ${SPECIAL}x with a callsReason; the budget is computed from it.`],
	[/per-role cap|total budget/, 'Lower the roles\' "calls" until the computed budget fits the project\'s cap, or the owner decides.'],
	[/went lighter/, 'Put back what the stop named and run approve.mjs again, or the owner agrees the lighter sweep.'],
	[/outside the reviewer model rule/, 'Name opus or sonnet for the role, or the owner agrees the model.'],
	[/was cut short/, 'The owner\'s yes on this contract closes that sweep unmeasured; list any findings left unfixed in the handoff by hand.'],
	[/call-cap hook/, 'Merge the PreToolUse entry for kit-hooks/call-cap.cjs into the project\'s .claude/settings.json.'],
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
		'- Or the owner decides. After an ask: they tap Yes in a pop-up quoting the act the ask printed (`sweep yes <code>`), and the lead logs it with `approve.mjs <contract.json> --owner-yes`. After a pause: the same, with `sweep resume <code>` (`--summary` prints it) and `approve.mjs --resume`.', '',
	].join('\n');
	fs.writeFileSync(f, text);
	return toPosix(f);
}

// K182 (build 22; Max's pick 2026-11-21, "All of it, run the trial"): a reviewer's cost grows with the square of what it
// reads (each call re-reads it all), and builds grew about 4x while the roles stayed fixed. A role that reads the diff
// for its own lens gets one reviewer per slice of the diff, so each reviewer stays the size of a small build and the
// sweep grows in a line with the change. The cross-file lenses keep what they were given: blast radius and the
// security angles. The changed files a role's context names (every changed file when it names none) are what it
// slices. SLICE_LINES is a start value, not a measured
// one: the control-vs-split trial and the outcome log set it.
const WHOLE_DIFF = ['security', 'blast-radius', 'privacy', 'supply-chain', 'data-loss', 'triage'];
const SLICE_LINES = 600;
// A path as a brief's git line names it. An allow-list of characters, so a symbol neither bash nor PowerShell was
// checked for is never let through (PowerShell reads the Unicode quotes U+2018 to U+201F as quote marks, which a
// deny-list of ASCII quotes would miss): printable ASCII and Unicode letters and digits only, with no leading colon
// (git reads it as pathspec magic). Double quotes when nothing in the path is special inside them, else single quotes
// when it holds no single quote; null otherwise, which decide() sends back.
const NAMEABLE = /^(?!:)[\x20-\x7e\p{L}\p{N}]+$/u;
const shellName = (f) => (!NAMEABLE.test(f) ? null : !/["`$\\!]/.test(f) ? `"${f}"` : !f.includes("'") ? `'${f}'` : null);
// What a split decided, as one hash: each run role's slice files in order, for the owner's yes to match against the ask.
const sliceHash = (runRoles) => sha(JSON.stringify(runRoles.map((r) => r.sliceFiles || [])));
function splitRoles(roles, facts) {
	// -z: git prints a path with a non-ASCII byte C-quoted, so the name the numstat gives would match no changed file.
	const files = facts ? git('diff', '--numstat', '-z', '--text', '--no-renames', `${facts.base}...HEAD`).stdout.split('\0').filter(Boolean).map((r) => { const [a, d, ...p] = r.split('\t'); return [a, d, p.join('\t')]; })
		.filter((p) => p[2] && !sweepOwned(p[2])).map(([a, d, file]) => ({ file, n: (Number(a) || 0) + (Number(d) || 0) })).sort((x, y) => x.file.localeCompare(y.file)) : [];
	const lines = new Map(files.map((x) => [x.file, x.n]));
	// Files in path order, a group closed when the next file would take it past SLICE_LINES; a larger file is a group alone.
	const slices = (names) => {
		const groups = [];
		let cur = [];
		let size = 0;
		for (const f of names) { const n = lines.get(f); if (cur.length && size + n > SLICE_LINES) { groups.push(cur); cur = []; size = 0; } cur.push(f); size += n; }
		if (cur.length) groups.push(cur);
		return groups;
	};
	const out = [];
	const roleOf = [];
	const unnameable = new Set();
	roles.forEach((r, i) => {
		// A role reads the changed files its context names (the whole diff when it names none); its other context entries
		// (a rule, an unchanged file) go with every slice.
		const context = Array.isArray(r.context) ? r.context.map(String) : [];
		const own = context.length ? context.filter((x) => lines.has(x)).sort() : [...lines.keys()];
		const rest = context.filter((x) => !lines.has(x));
		const groups = WHOLE_DIFF.includes(r.kind) ? [] : slices(own);
		if (groups.length < 2) { out.push(r); roleOf.push(i); return; }
		// sliceFiles are the exact changed paths: writeBriefs names them as they are, not as a context entry with a line range.
		groups.forEach((g, k) => { g.filter((f) => !shellName(f)).forEach((f) => unnameable.add(f)); out.push({ ...r, context: [...g, ...rest], sliceFiles: g, part: `${k + 1} of ${groups.length}` }); roleOf.push(i); });
	});
	return { roles: out, roleOf: out.length > roles.length ? roleOf : null, unnameable: [...unnameable] };
}

function decide() {
	const raw = fs.readFileSync(contractFile, 'utf8');
	const c = JSON.parse(raw);
	const s = state();
	const facts = diffFacts();
	const { why, fix, need, extras, cap, first, refused, budgets = [], total = 0 } = check(c, facts, s.log);
	// K357 S6: a folder git finds but gives no work tree for (a worktree's own folder) cannot show its rule files or its
	// session, so it is a fix, logged, never an approval read from another checkout.
	if (!toplevel()) fix.unshift(`the contract's folder (${rel(path.dirname(contractFile))}) is a worktree git cannot read: git gives no work tree there, so its untracked rule files and session cannot be read; run approve.mjs on the contract from the branch's own checkout`);
	// The build 11 sweep: a contract's text goes into its briefs, so one that carries the confirmation phrase would
	// hand a reviewer what it must find by reading. Read as the canary reads it: letters and digits, any case.
	const words = (t) => ` ${String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
	const block = rulesBlock(facts);
	if (block && block.phrase && words(block.phrase).trim()) (c.roles || []).forEach((r, i) => { if (words(JSON.stringify(r)).includes(words(block.phrase))) fix.push(`role ${i + 1}'s text carries the confirmation phrase: take it out, the reviewer finds it by reading`); });
	// K315: a rules block that still holds a template slot writes no brief; the slot is named, and the sweep stops as a fix.
	if (block && block.slots && block.slots.length) fix.push(`the rules block in ${block.file} still holds ${block.slots.join(' and ')}: fill it in, then run approve.mjs again`);
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
	const carryLine = carries > 0 ? [`Open carry-overs: ${carries} carried finding(s) open from an earlier sweep, in ${CARRY_HOME}; the outcome of the sweep that fixes them closes them with --closed-carries <n>.`] : [];
	if (refused) {
		write({ kind: 'decision', contract: contractFile, hash: sha(raw), tier: c.tier, agents: (c.roles || []).length, budget: 0, decision: 'refused', reasons: [refused], resweepOf: first, head });
		console.log(`REFUSED - one sweep per branch (rule:finding-pipeline): ${refused}. No reviewer runs on this contract.`);
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
	const split = splitRoles(c.roles || [], facts);
	// A slice's brief names its files in a git line; a file it cannot name would be in no reviewer's slice.
	if (split.unnameable.length) fix.push(`changed file ${split.unnameable.slice(0, 3).map((f) => JSON.stringify(f)).join(', ')} cannot be named safely in a reviewer's brief (its name holds a Unicode quote or symbol, a control character, a leading colon, or a single quote beside another shell character): rename it, then run approve.mjs again`);
	const runRoles = split.roles;
	const runBudgets = split.roleOf ? split.roleOf.map((i) => budgets[i]) : budgets;
	const runTotal = runBudgets.reduce((t, b) => t + (Number(b) || 0), 0);
	if (split.roleOf && cap && runRoles.length > cap.maxAgents) why.push(`${runRoles.length} reviewers once the diff is split, over the project's ${c.tier} cap of ${cap.maxAgents}`);
	if (split.roleOf && cap && runTotal > cap.maxTotalBudget) why.push(`total budget ${runTotal} once the diff is split, over the project's ${c.tier} cap of ${cap.maxTotalBudget}`);
	const run = { ...c, roles: runRoles };
	const { ceilings, from: ceilingFrom, unit: ceilingUnit = 'tokens', expected } = ceilingsFor(s.log, runBudgets, runRoles);
	// K182: the reviewer count and the dollars, said before the owner's yes and in the start notice.
	const spendLine = ceilingUnit === 'dollars' ? `${runRoles.length} reviewers; about $${expected.toFixed(2)} at the median past pace, at most $${ceilings.reduce((t, x) => t + x, 0).toFixed(2)} (their dollar ceilings)` : null;
	const entry = { kind: 'decision', contract: contractFile, branch: currentBranch(), hash: sha(raw), tier: c.tier, agents: runRoles.length, budget: runTotal, modifiers: Array.isArray(c.modifiers) ? c.modifiers : [], calls: runRoles.map((r) => r.calls), budgets: runBudgets, ceilings, ceilingFrom, ceilingUnit, ...(split.roleOf ? { roleOf: split.roleOf } : {}), sliceHash: sliceHash(split.roles), patches: facts ? branchPatches(facts.base) : [], models: runRoles.map(roleModel), decision: fix.length ? 'fix' : why.length ? 'owner' : 'approved', reasons: [...fix, ...why], base: facts && facts.mergeBase, lines: facts && facts.lines, roles: runRoles.map((r) => r.role || r.kind), head };
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
		if (spendLine) console.log(`    Spend: ${spendLine}`);
		console.log(`    The owner answers in the pop-up: ${popUpHow(`sweep yes ${askCode(entry.hash)}`)}; after their Yes, log it with --owner-yes.`);
		const now = state();
		if (now.paused) for (const l of resumeHelp(now)) console.log(l);
		const f = triage(`${c.tier} sweep sent to the owner`, why, [
			`${entry.agents} roles, budget ${entry.budget.toLocaleString('en-US')}${extras === undefined ? ', no floor counted (this tier always goes to the owner)' : `, ${extras} beyond the floor (cap ${cap.maxExtras})`}`,
			...runRoles.map((r, i) => `role ${i + 1}: ${r.role || r.kind}${r.part ? ` (part ${r.part} of the diff)` : ''} (${r.kind}, ${roleModel(r)})${runBudgets[i] === undefined ? '' : `, ${r.calls} calls, budget ${runBudgets[i]}`}${r.callsReason ? ` (${r.callsReason})` : ''}`),
			...(spendLine ? [`spend: ${spendLine}`] : []),
			...(now.paused ? [`paused since ${String(now.pausedAt || '').slice(0, 10)}: ${now.paused}`] : []),
		]);
		console.log(`    Triage report for the owner: ${f}`);
		for (const l of carryLine) console.log(l);
		return 1;
	}
	console.log(`APPROVED - ${c.tier} sweep, ${entry.agents} agents, budget ${entry.budget}, inside the rules. Logged to ${LOG}.`);
	console.log(notice(run, need, extras, cap, first, runBudgets, runTotal, facts, entry.hash, ceilings, ceilingFrom, ceilingUnit, spendLine));
	console.log(`Briefs, one per role; pass each as that reviewer's prompt, as written: ${writeBriefs(run, entry.hash, ceilings, facts, ceilingUnit).join(', ')}`);
	for (const l of carryLine) console.log(l);
	return 0;
}

// The owner's start notice, written from the checked contract so it carries no hand count. Post it as is.
function notice(c, need, extras, cap, first, budgets, total, facts, hash, ceilings, ceilingFrom, unit = 'tokens', spendLine = null) {
	const roles = c.roles || [];
	const n = (x) => x.toLocaleString('en-US');
	const kinds = {};
	for (const r of roles) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
	return [
		'Start notice for the owner (checked by approve.mjs; post it as is):',
		`    ${c.tier} sweep, ${roles.length} roles: ${Object.entries(kinds).map(([k, v]) => `${k} x${v}`).join(', ')}`,
		`    Modifiers: ${(Array.isArray(c.modifiers) && c.modifiers.join(', ')) || 'none'}; diff against ${facts.baseName}`,
		...(hookState(facts.base) === 'none' ? [HOOK_NONE] : []),
		...roles.map((r, i) => `    ${i + 1}. ${r.role || r.kind} (${r.kind}, ${roleModel(r)}), ${r.calls} calls, budget ${n(budgets[i])}${r.callsReason ? ` (over standard: ${r.callsReason})` : ''}; brief: "Call cap: ${r.calls}. ${ceilingLine(unit, ceilings[i])}."`),
		`    Budget: ${n(total)} processed tokens, computed from each role's call cap (standard ${STANDARD_CALLS} calls, up to ${SPECIAL}x with a reason); expected, not a trip once the log has a baseline`,
		`    ${unit === 'dollars' ? 'Dollar' : 'Token'} ceiling per role: ${ceilingFrom}; the call-cap hook stops a reviewer there`,
		...(spendLine ? [`    Spend: ${spendLine}`] : []),
		`    Floor met: ${Object.entries(need).map(([k, v]) => `${k} ${kinds[k] || 0} of ${v} needed`).join(', ') || 'none for this tier'}`,
		`    Extras: ${extras} of ${cap.maxExtras} allowed beyond the floor`,
		`    ${sweepLine(hash)}`,
		'    Findings come when the sweep finishes.',
	].join('\n');
}

// T6 (build 11): each role's brief is written from the cleared contract, so the lines the guards and the hand-back
// check read cannot drift (the 1.36.1 briefs told reviewers no hook could run, and sent them to a 25 KB file for a
// 2 KB rules block). The lead passes each file as the reviewer's prompt, as written.
const FINDING_CAP = 8;
// Every line break a field could carry, written as escapes so this file stays ASCII.
const LINE_BREAKS = new RegExp('[\r\n\u2028\u2029]+', 'g');
// The rules block every brief points at, by file and line range, so the reviewer reads the block and not the module
// around it: the file the rule index names for rule:agent-team-adapter, else the module where the kit puts it.
// K218: a file git tracks is read as the merge base has it (the K128 pattern), so a branch cannot edit the rules its
// own reviewers work under; with a sweep hash the base copy is written to the sweep's scratch folder and the brief
// points there. A file git does not track (a project's untracked notes) is not part of the change under review, so it is
// read from the contract's own checkout (the build 11 sweep; K357: its linked worktree, not the main checkout). A file
// the branch adds has no base copy and gives no block. A file the index names outside the repo is not read.
function rulesBlock(facts, hash) {
	const commonDir = path.resolve(git('rev-parse', '--path-format=absolute', '--git-common-dir').stdout.trim() || '.git');
	const top = toplevel();
	if (!top) return null;
	const mb = facts && facts.base ? baseGit('merge-base', facts.base, 'HEAD').stdout.trim() : '';
	const tracked = (f) => baseGit('ls-files', '--error-unmatch', '--', `:(top)${f}`).status === 0 || Boolean(mb && baseGit('cat-file', '-e', `${mb}:${f}`).status === 0);
	// The build 23a commit security review: where the base holds any of the rule files, only base copies count, so an
	// untracked index or rules file in the checkout cannot name the block either.
	const atBase = (f) => Boolean(mb) && baseGit('cat-file', '-e', `${mb}:${f}`).status === 0;
	const baseRules = ['standards/INDEX.md', 'standards/agent-teams.md', 'rules/agent-teams.md'].some(atBase);
	const readRule = (f) => {
		if (baseRules && !atBase(f)) return null;
		if (tracked(f)) {
			if (!mb) return null;
			const r = baseGit('show', `${mb}:${f}`);
			return r.status === 0 ? { text: r.stdout, base: true } : null;
		}
		try { return { text: fs.readFileSync(path.join(top, f), 'utf8'), base: false }; } catch { return null; }
	};
	let file = null;
	const index = readRule('standards/INDEX.md');
	const row = index && index.text.match(/^\|\s*agent-team-adapter\s*\|[^|\n]*\|\s*`([^`]+)`/m);
	if (row) file = row[1];
	const inside = (f) => { const r = path.relative(top, path.resolve(top, f)); return r && !r.startsWith('..') && !path.isAbsolute(r); };
	for (const f of [file, 'standards/agent-teams.md', 'rules/agent-teams.md'].filter((f) => f && inside(f))) {
		const got = readRule(f);
		if (!got) continue;
		let where = toPosix(path.join(top, f));
		// The base copy sits in the git folder, which no tool writes, so it cannot be rewritten before a reviewer reads it.
		if (got.base && hash) {
			const dir = path.join(commonDir, `kit-sweep-${hash.slice(0, 8)}`);
			fs.mkdirSync(dir, { recursive: true });
			const copy = path.join(dir, `rules-base-${path.basename(f)}`);
			fs.writeFileSync(copy, got.text);
			where = toPosix(copy);
		}
		const lines = got.text.split(/\r?\n/);
		const start = lines.findIndex((l) => /\*\*Rules every brief carries\*\*/.test(l));
		// The line the canary reads the phrase from, as it reads it.
		const end = start < 0 ? -1 : lines.findIndex((l, i) => i > start && /^\s*Confirmation phrase: .* with: \S/.test(l));
		if (end > start) return { file: where, offset: start + 1, limit: end - start + 1, phrase: lines[end].replace(/^\s*Confirmation phrase: .* with: /, '').trim(), slots: slotsIn(lines.slice(start, end + 1).join('\n')) };
		return { file: where };
	}
	return null;
}
// K218: the canary checks a reviewer's first line against the file its brief names, so the file is recorded in the git
// folder with the commit it was written for; the canary reads it only while HEAD is that commit.
function recordRules(block) {
	if (common.status !== 0) return;
	const f = path.join(common.stdout.trim(), 'kit-sweep-rules.json');
	try {
		if (block && block.phrase) fs.writeFileSync(f, JSON.stringify({ head: git('rev-parse', 'HEAD').stdout.trim(), file: block.file, phrase: block.phrase }) + '\n');
		else fs.rmSync(f, { force: true });
	} catch { /* the canary then reads the main checkout, as before */ }
}
function writeBriefs(c, hash, ceilings, facts, unit = 'tokens') {
	const top = git('rev-parse', '--show-toplevel').stdout.trim();
	const block = rulesBlock(facts, hash);
	recordRules(block);
	const head = git('rev-parse', '--short', 'HEAD').stdout.trim();
	const base = git('rev-parse', '--short', facts.base).stdout.trim() || facts.baseName;
	const hooked = hookState(facts.base) !== 'none';
	const stem = contractFile.replace(/\.json$/i, '');
	const out = [];
	(c.roles || []).forEach((r, i) => {
		const n = i + 1;
		const scratch = toPosix(path.join(os.tmpdir(), `kit-sweep-${hash.slice(0, 8)}`, `role-${n}`));
		// Contract text goes in on one line, so a field cannot add a line of its own (a phrase, a second Role or Call cap
		// line; the build 11 sweep). A context entry is a path, quoted for the shell; a line range or rule after it
		// (file.md:10-20) is not part of the path git reads.
		const one = (s) => String(s ?? '').replace(LINE_BREAKS, ' ').trim();
		// A split role's slice files are exact paths; they and the context entries are quoted by shellName, and an entry
		// no quoting carries (a contract's, never a slice's: approve refuses those) is left out.
		const exact = new Set(Array.isArray(r.sliceFiles) ? r.sliceFiles : []);
		const files = (Array.isArray(r.context) ? r.context : []).map((f) => (exact.has(f) ? f : one(f).replace(/:[\w.-]*$/, ''))).filter(Boolean).map(shellName).filter(Boolean).join(' ');
		r = { ...r, role: one(r.role), kind: one(r.kind), question: one(r.question), finding: one(r.finding) };
		const text = [
			block && block.limit
				? `Project rules: read ${block.file} with the Read tool at offset ${block.offset} and limit ${block.limit} (the "Rules every brief carries" block, to its last line), and work under them; you are read-only.`
				: `Project rules: read the "Rules every brief carries" block in ${block ? block.file : 'standards/agent-teams.md'} with the Read tool, to its last line, and work under them; you are read-only.`,
			'',
			`Sweep: ${hash} role ${n}`,
			`Call cap: ${r.calls}. A call is one message from you, however many tools it runs, so run independent reads together in one message. ${hooked ? 'A hook counts your calls and refuses tools at the end of the cap; when it does, hand in your report at once, with what you did not get to as \'not checked\'.' : 'No hook counts them here, so count your own calls.'} The cap's last two calls are for the report.`,
			ceilingLine(unit, ceilings[i]),
			'',
			`Role: ${r.role || r.kind} (${r.kind})${r.part ? `, part ${r.part} of the diff: read the files named below; other reviewers of this role have the rest` : ''}`,
			`Question: ${r.question || ''}`,
			`Repository: ${toPosix(top)}, at ${head} (base ${facts.baseName}). Read the change with: git -C "${toPosix(top)}" diff ${base}...${head}${files ? ` -- ${files}` : ''}`,
			'Read more by line range as you need; never a whole file over 40 KB.',
			`Scratch: ${scratch} is yours alone for any probe that writes; write nowhere else, never in the repository or another role's folder.`,
			'',
			`Finding format: ${r.finding || 'a RECORD: line, then one JSON line per finding with the keys id, severity (critical, high, medium or low), status (confirmed or plausible), where (file:line), claim, proof (the input that breaks it, or the rule it breaks and the evidence) and fix'}. At most ${Number.isInteger(r.findingCap) ? r.findingCap : FINDING_CAP} findings, ranked by severity.`,
			'Report: hand it back with SubagentHandback. After the opening your rules require, the report is:',
			`ROLE: ${r.role || r.kind}`,
			'Not checked: <what you did not get to, or "nothing">',
			'Then a RECORD: line, its role line, one JSON line per finding and a notChecked line, as in this example (replace every <...>):',
			'RECORD:',
			`{"role":${JSON.stringify(r.role || r.kind)},"commit":"${head}"}`,
			'{"id":"<F1>","severity":"<high>","status":"<confirmed or plausible>","where":"<file:line>","claim":"<one line>","proof":"<the evidence>","fix":"<the fix>"}',
			'{"notChecked":"<what you did not get to, or nothing>"}',
			'Change no file in the repository.',
			'',
		].join('\n');
		const f = `${stem}-brief-${n}.md`;
		fs.writeFileSync(f, text);
		out.push(rel(f));
	});
	return out;
}

// T6 (build 11): the findings in a reviewer's report, read from its last hand-back in the shape its brief gives (the
// canary checks it): [{ severity, verdict, claim, where, evidence }], or null when no report in that shape is there.
// The build 11 sweep: only the hand-back that was delivered counts (a refused one never reached the lead), a run the
// canary voided counts none, and rows stop where the out-of-role notes begin.
function reportRows(parsed, want = {}) {
	const refused = new Set();
	let voided = false;
	for (const e of parsed) {
		const content = e && e.message && e.message.role === 'user' && Array.isArray(e.message.content) ? e.message.content : [];
		for (const b of content) {
			if (!b || b.type !== 'tool_result' || b.is_error !== true) continue;
			refused.add(b.tool_use_id);
			if (/this run is void/i.test(typeof b.content === 'string' ? b.content : JSON.stringify(b.content))) voided = true;
		}
	}
	if (voided) return { void: true };
	let message = null;
	for (const e of parsed) {
		const content = e && e.message && e.message.role === 'assistant' && Array.isArray(e.message.content) ? e.message.content : [];
		const h = content.find((b) => b && b.type === 'tool_use' && b.name === 'SubagentHandback' && b.input && typeof b.input.message === 'string' && !refused.has(b.id));
		if (h) message = h.input.message;
	}
	if (message === null) return null;
	const lines = message.split(/\r?\n/);
	// A RECORD: block is read by the record check: a record that fails it, or a finding that is neither confirmed nor
	// plausible, is unreadable, the same as a report in no shape.
	if (lines.some((l) => l.trim() === 'RECORD:')) {
		if (!checkRecord) return null;
		// A finding in another shape above the record is a second report: refused, not tallied beside the record.
		const last = lines.findLastIndex((l) => l.trim() === 'RECORD:');
		if (findingAbove(lines.slice(0, last).join('\n'))) return null;
		const rec = checkRecord(message);
		// Another role's or commit's record is not this round's.
		if (!rec.ok || (want.role !== undefined && !namedBy(rec.roleLine, want))) return null;
		const rows = [];
		for (const f of rec.findings) {
			if (!/^(confirmed|plausible)$/i.test(f.status)) return null;
			rows.push({ severity: f.severity, verdict: f.status.toUpperCase(), claim: f.claim, where: f.where, evidence: f.proof });
		}
		return rows;
	}
	if (!lines.some((l) => /^\s*ROLE:\s*\S/.test(l))) return null;
	const rows = [];
	for (const l of lines) {
		if (/^\W*out[- ]of[- ]role/i.test(l)) break;
		if (!/^\s*(critical|high|medium|low)\s*\|/i.test(l)) continue;
		const f = l.split('|').map((x) => x.trim());
		if (f.length < 5 || !/^(CONFIRMED|PLAUSIBLE)$/i.test(f[1])) return null;
		rows.push({ severity: f[0].toLowerCase(), verdict: f[1].toUpperCase(), claim: f[2], where: f[3], evidence: f.slice(4).join(' | ') });
	}
	return rows;
}
// Each role's finding cap, as its brief gave it.
function roleCaps() {
	try { return (JSON.parse(fs.readFileSync(contractFile, 'utf8')).roles || []).map((r) => (Number.isInteger(r.findingCap) ? r.findingCap : FINDING_CAP)); } catch { return []; }
}
// The ledger beside the contract, one row per finding, so a count the outcome logs can be read back to its reports.
function writeLedger(rows) {
	const f = `${contractFile.replace(/\.json$/i, '')}-ledger.md`;
	const cell = (s) => String(s).replace(/\|/g, '/').replace(/\s+/g, ' ');
	fs.writeFileSync(f, [`# Findings ledger: ${path.basename(contractFile)}`, '', 'Written by approve.mjs --outcome from the reviewers\' hand-backs.', '', '| Role | Severity | Verdict | Claim | Where |', '|---|---|---|---|---|',
		...rows.map((x) => `| ${x.role} | ${x.severity} | ${x.verdict} | ${cell(x.claim)} | ${cell(x.where)} |`), ''].join('\n'));
	return rel(f);
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

// The starts of this round that ran. A slot counts as never ran only on proof that its start was refused: a session
// transcript holds a refused result (is_error) for its tool id, and no agent's meta file names that id. Anything
// else counts as ran: no id to look up, no transcript found (another Claude folder, transcripts cleaned up), or a
// meta file (the 1.31.0 sweep: reading only for a meta file failed open when the folder was moved or emptied).
function ranStarts(log, contract) {
	const lines = rawLines();
	const slots = [];
	for (const i of starts(log, contract).clearings) {
		const dir = path.join(path.dirname(LOG), 'kit-sweep-starts', sha(lines[i]));
		let names = [];
		try { names = fs.readdirSync(dir); } catch { continue; }
		for (const name of names) {
			let id = '';
			try { id = fs.readFileSync(path.join(dir, name), 'utf8'); } catch { /* unreadable: counts as ran */ }
			slots.push(id);
		}
	}
	const wanted = new Set(slots.filter(Boolean));
	const metaIds = new Set();
	const refusedIds = new Set();
	if (wanted.size) for (const project of folders(transcriptRoot())) {
		let files = [];
		try { files = fs.readdirSync(project).filter((n) => n.endsWith('.jsonl')).map((n) => path.join(project, n)); } catch { /* none */ }
		for (const f of files) {
			let text = '';
			try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
			if (![...wanted].some((id) => text.includes(id))) continue;
			for (const line of text.split('\n')) {
				if (![...wanted].some((id) => line.includes(id))) continue;
				let e;
				try { e = JSON.parse(line); } catch { continue; }
				const c = e && e.type === 'user' && e.message && Array.isArray(e.message.content) ? e.message.content : [];
				for (const b of c) if (b && b.type === 'tool_result' && b.is_error === true && wanted.has(String(b.tool_use_id))) refusedIds.add(String(b.tool_use_id));
			}
		}
		for (const session of folders(project)) {
			let names = [];
			try { names = fs.readdirSync(path.join(session, 'subagents')).filter((n) => n.endsWith('.meta.json')); } catch { continue; }
			for (const n of names) { try { const id = JSON.parse(fs.readFileSync(path.join(session, 'subagents', n), 'utf8')).toolUseId; if (id) metaIds.add(String(id)); } catch { /* unreadable: not a start this can match */ } }
		}
	}
	return slots.filter((id) => !id || !refusedIds.has(id) || metaIds.has(id)).length;
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

// The owner's yes and resume (T2, the owner 2026-11-10: "Pop-up record"). An ask or a pause prints an act with its
// short code ("sweep yes <code>", "sweep resume <code>"), so one answer is for that ask alone; the lead asks the owner
// in Claude Code's choice pop-up, quoting the act in a code span, with a Yes and a No. The owner's tap, in this
// session's own transcript (in this repo's folder of them), is the proof: no code is typed and no message id copied,
// so the typed codes of 1.23 are retired. A subagent's transcript is never read. Limits: the transcript is a file of
// the same user, so a program set on forging can write it, as it can the log (its links are not keyed).
const askCode = (hash) => String(hash || '').slice(0, 6);
const pauseCode = (s) => { const lines = rawLines(); const i = s.log.map((e, k) => (e.kind === 'pause' ? k : -1)).reduce((a, b) => Math.max(a, b), -1); return i >= 0 ? sha(lines[i]).slice(0, 6) : ''; };
const popUpHow = (act) => `ask with the AskUserQuestion pop-up, the question quoting \`${act}\`, one option labelled "Yes" and one starting "No"`;
// One tap answers one ask or one pause.
const tapUsed = (log, tap) => log.some((e) => e.tap === tap);
// Why a Yes is missing: a Yes whose question names the act without backticks counts for nothing, and the refusal says
// so, or the lead reads it as no answer and asks the owner the same wrong way again (build 11's resume).
const unquotedNote = (act, since) => {
	// New 2 (build 12): with no session to read, say which part is missing, not that the owner did not answer.
	const gap = sessionGap({ repo: repoRoot() });
	if (gap) return ` No pop-up was read: ${gap}.`;
	const u = unquotedYes(act, { since, repo: repoRoot() });
	return u ? ` The owner's Yes at ${new Date(u.at).toISOString()} answered a question that names ${act} without backticks around it, so it counts for nothing: ask again with the act in backticks.` : '';
};
// K357 S1: a session's pop-ups are kept under the folder it ran in, so the lookup reads the contract's own checkout.
const repoRoot = () => toplevel() || path.dirname(path.dirname(LOG));

// The owner said yes to a contract the script sent to them. Logged only for the contract and HEAD the script asked
// about, so the reviewers' guard (sweep-guard) sees the owner's call and the order: script first, then the owner.
function ownerYes() {
	const raw = fs.readFileSync(contractFile, 'utf8');
	const s = state();
	const last = s.log.filter((e) => e.kind === 'decision' && e.contract === contractFile).pop();
	const head = git('rev-parse', 'HEAD').stdout.trim();
	if (!last || last.decision !== 'owner') { console.log('The script did not send this contract to the owner, so there is no ask to answer. Run approve.mjs on it first.'); return 1; }
	if (last.hash !== sha(raw) || last.head !== head) { console.log('The contract or HEAD changed since the script asked. Run approve.mjs again, then ask the owner.'); return 1; }
	// One yes answers one ask: a second would open a second set of start slots.
	const askedAt = s.log.lastIndexOf(last);
	if (s.log.some((e, j) => j > askedAt && e.kind === 'owner-yes' && e.contract === contractFile && e.hash === last.hash && e.head === head)) { console.log("The owner's yes for this ask is already logged; its reviewers may start. A new ask needs approve.mjs again. Nothing logged."); return 1; }
	// The briefs are written from a fresh diff. A base that moved since the ask splits the roles differently, and a brief
	// past the ask's ceilings would carry none: only the ask's own split gets its yes.
	const facts = diffFacts();
	const now = splitRoles(JSON.parse(raw).roles || [], facts);
	if (JSON.stringify(now.roleOf || null) !== JSON.stringify(last.roleOf || null) || now.roles.length !== last.agents) { console.log(`Refused: the diff now splits differently (${now.roles.length} reviewers) than at the ask (${last.agents}): the base or the changed files moved since the script asked. Run approve.mjs again, then ask the owner. Nothing logged.`); return 1; }
	// The same count and role map can hold other files, and a file no brief can name is in no slice.
	if (now.unnameable.length || (last.sliceHash !== undefined && sliceHash(now.roles) !== last.sliceHash)) { console.log(`Refused: the slices hold different slice files than at the ask${now.unnameable.length ? ' (a changed file cannot be named safely in a brief)' : ''}: the base or the changed files moved since the script asked. Run approve.mjs again, then ask the owner. Nothing logged.`); return 1; }
	const { open, reported, stuck } = openSweep(s.log);
	// A yes on an older ask must not open a new set of starts over a sweep whose spend is still unread.
	if (open && !reported && !stuck && open.contract !== contractFile) { console.log(`Log the outcome of the last approved sweep first (${rel(open.contract)}), then run approve.mjs on this contract again. Nothing logged.`); return 1; }
	// The owner's tap on this ask's act, after the ask. Read before anything is written, so a refusal logs nothing.
	const act = `sweep yes ${askCode(last.hash)}`;
	const yes = sessionYes(act, { since: Date.parse(last.time), repo: repoRoot() });
	if (!yes) { console.log(`Refused: this session holds no Yes from the owner to \`${act}\` since the ask.${unquotedNote(act, Date.parse(last.time))} ${popUpHow(act)[0].toUpperCase()}${popUpHow(act).slice(1)}; after their Yes, run this again. Nothing logged.`); return 1; }
	if (tapUsed(s.log, yes.tap)) { console.log('Refused: that Yes already answered an ask; one answer is for one ask. Nothing logged.'); return 1; }
	const proof = { proof: 'popup', tap: yes.tap, at: new Date(yes.at).toISOString() };
	if (stuck) { const { started } = starts(s.log, open.contract); write({ kind: 'outcome', contract: open.contract, decisionAt: open.time, budget: open.budget, tokens: 0, findings: 0, real: 0, duplicates: 0, closedByOwner: true, started, ...(started ? {} : { noneRan: true }) }); }
	// The ask's ceilings travel with the yes: the reviewers' guard reads the clearing line, and a yes without them
	// started reviewers with no ceiling at all (the 1.23.0 sweep).
	write({ kind: 'owner-yes', contract: contractFile, hash: last.hash, head, agents: last.agents, calls: last.calls, ...(Array.isArray(last.ceilings) ? { ceilings: last.ceilings, ...(last.ceilingUnit ? { ceilingUnit: last.ceilingUnit } : {}) } : {}), ...(Array.isArray(last.roleOf) ? { roleOf: last.roleOf } : {}), ...proof });
	console.log(`The owner's yes is logged; the reviewers may start. ${sweepLine(last.hash)}`);
	if (facts && Array.isArray(last.ceilings)) console.log(`Briefs, one per role; pass each as that reviewer's prompt, as written: ${writeBriefs({ ...JSON.parse(raw), roles: now.roles }, last.hash, last.ceilings, facts, last.ceilingUnit).join(', ')}`);
	return 0;
}

// A pause is the owner's to clear, so every ask while paused says how, and what to review first.
function resumeHelp(s) {
	// K357 S2: the resume reads the owner's Yes from the session that asked, so the line names that session's id. Unset,
	// it names the variable and leaves the id to the one who runs it.
	const sid = process.env.CLAUDE_CODE_SESSION_ID || '';
	const resume = /^[0-9a-f-]{36}$/i.test(sid) ? `CLAUDE_CODE_SESSION_ID=${sid} node ${toPosix(SELF)} --resume` : `node ${toPosix(SELF)} --resume, with CLAUDE_CODE_SESSION_ID set to the id of the session that asked`;
	return [
		`Auto-approval is paused since ${String(s.pausedAt || '').slice(0, 10) || 'an unknown date'}: ${s.paused}.`,
		`    The owner reviews the log first (node ${toPosix(SELF)} --summary), then resumes in the pop-up:`,
		`    ${popUpHow(`sweep resume ${pauseCode(s)}`)}; after their Yes, run ${resume}.`,
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

function spend(ids, since, hash, team, crashed = new Set(), guardStarts = null, want = {}) {
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
		const at = ran && safeSpawn.gitRead(ran, ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8', env });
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
		// When each call began (its first line) and ended (its last), for the gap the cache outlives.
		const began = new Map();
		const ended = new Map();
		for (const e of parsed) {
			const m = e && e.message;
			if (!(m && m.role === 'assistant' && m.usage)) continue;
			const key = m.id || e.uuid;
			seen.set(key, m);
			const at = Date.parse(e && e.timestamp);
			if (!began.has(key)) began.set(key, at);
			ended.set(key, at);
		}
		const keys = [...seen.keys()];
		const u = (m, k) => Number(m.usage[k]) || 0;
		const calls = [...seen.values()];
		const per = (m) => u(m, 'input_tokens') + u(m, 'cache_read_input_tokens') + u(m, 'cache_creation_input_tokens') + u(m, 'output_tokens');
		const tokens = calls.reduce((t, m) => t + per(m), 0);
		// The split by kind (for a dollar ceiling later: cache reads are most of the meter and few of the dollars), the
		// starting context, the largest and last call (the ceiling's margin), and the cache re-writes after the first
		// call: a call that read back under half of the context the call before it held, so the cache had expired. A call
		// that reads the whole cache and writes a large batch of new results is no re-write (build 11: every role of the
		// 1.36.1 sweep had one, and the sweep paused on 7 re-writes that were none).
		const split = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
		for (const m of calls) { split.input += u(m, 'input_tokens'); split.cacheRead += u(m, 'cache_read_input_tokens'); split.cacheWrite += u(m, 'cache_creation_input_tokens'); split.output += u(m, 'output_tokens'); }
		const shape = {
			split,
			firstCall: calls.length ? per(calls[0]) - u(calls[0], 'output_tokens') : 0,
			maxCall: Math.max(0, ...calls.map(per)),
			// K182: the role's list-price dollars and its dearest call, each call at its own model's price.
			dollars: Math.round(calls.reduce((t, m) => t + dollars(m.usage, m.model), 0) * 1e4) / 1e4,
			maxCallDollars: Math.round(Math.max(0, ...calls.map((m) => dollars(m.usage, m.model))) * 1e4) / 1e4,
			lastCall: calls.length ? per(calls[calls.length - 1]) : 0,
			// Only after a gap the cache can expire in (5 minutes): a call soon after the last that reads back less is a
			// context the model trimmed, not an expired cache. After such a gap any read short of the last context is one;
			// the old under-half bar missed a miss that read back 51% (the build 11 sweep). With no times it counts.
			rewrites: calls.slice(1).filter((m, i) => {
				const gap = began.get(keys[i + 1]) - ended.get(keys[i]);
				return u(m, 'cache_read_input_tokens') < per(calls[i]) - u(calls[i], 'output_tokens') && !(gap < REWRITE_GAP_MS);
			}).length,
			// Stopped: the call-cap hook refused a tool at the ceiling. Its own words in the transcript say so; the spend
			// alone cannot tell a role that was stopped from one that was done.
			// Only a refusal counts, with the hook's numbers in it: a reviewer that read the hook's source or this script
			// sees the words too (the 1.23.0 sweep).
			stopped: parsed.some((e) => e && e.message && e.message.role === 'user' && Array.isArray(e.message.content) && e.message.content.some((x) => x && x.type === 'tool_result' && x.is_error === true && /Token ceiling reached \(\d[\d,]* of \d|Dollar ceiling reached \(\$\d/.test(typeof x.content === 'string' ? x.content : JSON.stringify(x.content)))),
		};
		// Claude Code writes some closing messages under a <synthetic> model; the real model is the last other one.
		const stamp = Date.parse(([...parsed].reverse().find((e) => e && e.timestamp) || {}).timestamp) || 0;
		toolIds.set(id, String(meta.toolUseId || ''));
		return { index, agent: id, model: [...seen.values()].map((m) => m.model).filter((m) => m && !/synthetic/i.test(m)).pop() || null, tokens, calls: seen.size, ...shape, finished, lastWrite: Math.max(fs.statSync(files[0]).mtimeMs, stamp), ledger: reportRows(parsed, { role: (want.roles || [])[index - 1], commit: want.head }) };
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

// The role each reviewer's brief named: the decision's copy, else the contract's.
function briefNames(decision) {
	let roles = [];
	try { roles = JSON.parse(fs.readFileSync(contractFile, 'utf8')).roles || []; } catch { /* none */ }
	if (Array.isArray(decision.roleOf)) roles = decision.roleOf.map((i) => roles[i]);
	return decision.roles || roles.map((r) => r && (r.role || r.kind));
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
		const { clearings } = starts(s.log, contractFile);
		// A recorded start counts as never ran only on proof it was refused (K50, ranStarts).
		const started = ranStarts(s.log, contractFile);
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
	// Real findings from roles on the mid model, for the reviewer model rule; optional.
	if (opt('--real-mid') !== undefined) {
		const v = count('real-mid', nums.real);
		if (v === null) { console.log('--real-mid needs a number from 0 to --real; nothing logged.'); return 1; }
		nums.realMid = v;
	}
	// --carried counted what a re-sweep left; the re-sweep is retired (A2), so it is refused.
	if (has('--carried')) { console.log('--carried was a re-sweep\'s count, and there is no re-sweep now: one sweep per branch; nothing logged.'); return 1; }
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
	const read = refused.length ? { bad: refused } : spend([...ids, ...lost], since, decision.hash, Number(decision.agents), new Set(lost), clearAts.length ? startIds(clearAts) : null, { roles: briefNames(decision), head: decision.head });
	if (read.bad) {
		const why = [`the spend cannot be read, so it is not guessed: ${read.bad.join(', ')}`];
		console.log('ASK THE OWNER - the spend cannot be read, so it is not guessed (rule:sweep-auto-approval):');
		console.log(`    ${read.bad.join(', ')}${read.root ? ` under ${toPosix(read.root)}` : ''}. Check the agent ids, or set CLAUDE_CONFIG_DIR to the config folder the session ran in. Nothing logged. A sweep cut short: --outcome --cut-short.`);
		console.log(`    Triage report for the owner: ${triage('a sweep outcome that cannot be measured', why, [`agents given: ${ids.join(', ')}`, `this round began at ${since}`])}`);
		return 1;
	}
	let roles = [];
	try { roles = JSON.parse(fs.readFileSync(contractFile, 'utf8')).roles || []; } catch { /* labels only */ }
	// K182: a split role's reviewers each serve the contract role the decision maps them to.
	if (Array.isArray(decision.roleOf)) roles = decision.roleOf.map((i) => roles[i]);
	// T6 (build 11): when every role handed back a report in its shape, the findings are counted from the reports, and a
	// typed count that differs is refused; the ledger is written either way, so the count can be read back.
	const ledgers = read.roles.filter((x) => !isLost(x.agent)).map((x) => x.ledger);
	if (ledgers.length && ledgers.every(Array.isArray)) {
		const rows = ledgers.flatMap((l, i) => l.map((x) => ({ role: i + 1, ...x })));
		const where = writeLedger(rows);
		if (rows.length !== nums.findings) { console.log(`--findings ${nums.findings} does not match the ${rows.length} finding(s) the reviewers' reports hold (ledger: ${where}). Pass --findings ${rows.length}. Nothing logged.`); return 1; }
		nums.sameLine = rows.filter((x) => x.where && rows.some((y) => y !== x && y.role !== x.role && y.where === x.where)).length;
		nums.findingsChecked = true;
		// A role past its finding cap is named, never cut: its findings were delivered (the build 11 sweep).
		const caps = roleCaps();
		ledgers.forEach((l, i) => { if (caps[i] && l.length > caps[i]) console.log(`    Role ${i + 1} reported ${l.length} findings, over its cap of ${caps[i]}: rank them, and triage all of them.`); });
	} else if (ledgers.length) {
		// The build 11 sweep: one role out of shape used to switch the check off for every role, with no word.
		const off = ledgers.map((l, i) => (Array.isArray(l) ? null : `${i + 1} (${l && l.void ? 'its run was void' : 'no report in its shape'})`)).filter(Boolean);
		console.log(`    --findings is not checked against the reports: role(s) ${off.join(', ')}. Count those by hand.`);
		nums.findingsChecked = false;
	}
	const per = read.roles.filter((x) => !isLost(x.agent)).map(({ index, finished: _f, lastWrite: _w, lastCall: _l, ledger: _g, ...x }, i) => {
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
	// K182: a dollar ceiling is held to the role's own dollars (the retry's alone, read from its own transcript).
	const inDollars = decision.ceilingUnit === 'dollars';
	const usd = (x) => `$${Number(x).toFixed(2)}`;
	for (const x of per) {
		const own = inDollars ? Number(x.dollars) || 0 : x.tokens - (x.crashedTokens || 0);
		const margin = inDollars ? Number(x.maxCallDollars) || 0 : x.maxCall;
		if (x.ceiling && own > x.ceiling + margin) trips.push(`the ${inDollars ? 'dollar' : 'token'} ceiling did not hold for ${x.role}: ${inDollars ? usd(own) : n(own)} against ${inDollars ? usd(x.ceiling) : n(x.ceiling)} (${x.stopped ? 'the hook stopped it too late' : 'the hook is missing or did not fire'})`);
	}
	// K182: the sweep's whole spend in dollars, against the p95 a role of past sweeps spent x this sweep's roles: the
	// dollar watch the token ceiling claimed to be. A bigger change adds roles, so the bound grows with it in a line.
	const pastDollars = s.log.filter((e) => e.kind === 'outcome' && Array.isArray(e.roles)).flatMap((e) => e.roles).filter((r) => r && r.split && Number(r.calls) > 0).slice(-CEILING_ROLES).map((r) => dollars(r.split, r.model));
	const sweepDollars = per.reduce((t, x) => t + (Number(x.dollars) || 0), 0);
	if (pastDollars.length >= CEILING_MIN && sweepDollars > nearestRank(pastDollars, CONTENT_PCT) * per.length) trips.push(`the sweep spent ${usd(sweepDollars)}, over ${per.length} roles x the p95 a past role spent (${usd(nearestRank(pastDollars, CONTENT_PCT))})`);
	// K151 (build 20): the call-cap meter lets a call through when it cannot read the transcript, and logs why. Each such
	// line for one of this sweep's reviewers keeps auto-approval paused and names the role: a silent meter is a gap.
	let opens = [];
	try { opens = fs.readFileSync(path.join(path.dirname(LOG), 'kit-guard-open.log'), 'utf8').split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((e) => e && e.hook === 'call-cap'); } catch { /* none */ }
	for (const x of per) {
		const o = opens.filter((e) => String(e.agent).toLowerCase() === String(x.agent).toLowerCase());
		if (o.length) trips.push(`the call-cap meter let ${o.length} call(s) of ${x.role} through unread (${[...new Set(o.map((e) => e.cause))].join(', ')})`);
	}
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
		if (stopped > STOPPED_SHARE * per.length) trips.push(`${stopped} of ${per.length} roles stopped at their ${inDollars ? 'dollar' : 'token'} ceiling (the work outgrew it)`);
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
	// The reviewer model rule rests on the model a role names, so a reviewer on another one is the owner's.
	per.forEach((x, i) => {
		// The model the decision cleared, so an edit to the contract after it hides nothing.
		const named = (decision.models || [])[i] ?? (roles[i] ? roleModel(roles[i]) : null);
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
	if (s.paused) console.log(resumeHelp(s)[2].trim());
	return 0;
}

function main() {
	if (!LOG) { console.log('ASK THE OWNER - not inside a git repository, so there is no approval log.'); return 1; }
	if (has('--summary')) return summary();
	// A read-only check the lead runs before it hands the owner a command: does this session hold the owner's Yes to the
	// act? It logs nothing and uses no tap.
	if (has('--tap')) {
		const act = String(opt('--tap') || '').trim();
		if (!act) { console.log('Name the act: --tap "sweep resume <code>". Nothing logged.'); return 1; }
		const yes = sessionYes(act, { repo: repoRoot() });
		const used = yes && tapUsed(state().log, yes.tap);
		if (yes) { console.log(`This session holds the owner's Yes to \`${act}\` at ${new Date(yes.at).toISOString()}${used ? ', already used: one answer is for one ask' : ''}. Nothing logged.`); return used ? 1 : 0; }
		console.log(`No Yes from the owner to \`${act}\` in this session.${unquotedNote(act, 0)} Nothing logged.`);
		return 1;
	}
	if (has('--resume')) {
		const s = state();
		if (!s.paused) { console.log('Auto-approval is not paused; nothing to resume. Nothing logged.'); return 1; }
		// The owner's tap on this pause's act, after the pause.
		const act = `sweep resume ${pauseCode(s)}`;
		const yes = sessionYes(act, { since: Date.parse(s.pausedAt || 0), repo: repoRoot() });
		if (!yes) { console.log(`Refused: this session holds no Yes from the owner to \`${act}\` since the pause.${unquotedNote(act, Date.parse(s.pausedAt || 0))} Only the owner resumes: ${popUpHow(act)}; after their Yes, run this again. Nothing logged.`); return 1; }
		if (tapUsed(s.log, yes.tap)) { console.log('Refused: that Yes already answered; one answer is for one pause. Nothing logged.'); return 1; }
		write({ kind: 'resume', proof: 'popup', tap: yes.tap, at: new Date(yes.at).toISOString() });
		console.log(`Auto-approval resumed on the owner's Yes; the next review comes after ${state().reviewEvery} more.`);
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
