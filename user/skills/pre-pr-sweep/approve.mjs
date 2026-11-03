#!/usr/bin/env node
// Sweep auto-approval (rule:sweep-auto-approval). Approves a Swarm Contract (rule:swarm-contract) that stays inside
// its tier's rules, so a routine sweep need not wait for the owner, and hands back to the owner on anything else.
// It is a script on purpose: the same contract always gets the same answer, at no token cost.
//
// The contract is a JSON file written next to the table the owner would have read:
//   { "tier": "feature" | "fix" | "triage" | "first push" | "launch gate",
//     "modifiers": ["security-sensitive" | "new-dependency" | "public-text" | "user-data"],
//     "testsChanged": true,
//     "roles": [{ "role", "kind", "question", "context": [...], "finding", "budget", "budgetReason" }] }
// A re-sweep adds "resweepOf": "<the first sweep's contract.json>" and "fixed": [{ "finding", "kind" }] (the kind of
// role that found each fixed finding). It gets one: a second re-sweep, or a re-sweep of one, is refused, and what
// is left goes to the handoff's carry-overs.
//
// Budgets are processed tokens (input + cache read + cache write + output), which the script reads itself from each
// reviewer's own transcript at --outcome. A role's budget is its model's standard; more needs a budgetReason, and
// never more than 2x. A tier's cap counts only the roles beyond its floor.
//
// What the contract says about itself is not taken on trust where the branch can show it: the diff against the base
// sets the tier's floor, adds the dependency modifier and marks changed tests. The log lives in the repo's git folder
// (never pushed, one per repo), each line chained to the one before, so a careless hand edit shows (a careful one does not; the owner reads the log at
// each trial review). The script
// pauses itself, and only the owner resumes it from a terminal no AI tool runs in, after: tokens a quarter or more
// over budget, a third or more of the findings repeated between roles, a bug that escaped a sweep it passed, or
// every 10 auto-approvals (the trial review; every 20 after two clean ones in a row). The next approval waits for the
// last sweep's outcome. Every ask and every pause writes <contract>.triage.md beside the contract: what tripped, the
// numbers, the log lines and the fix options.
//
// Usage (from inside the repo):
//   node approve.mjs <contract.json> [--base <ref>]                     decide (exit 0 approved, 1 ask the owner or refused)
//   node approve.mjs <contract.json> --outcome --agents <id,...> --findings N --real N --duplicates N [--real-mid N]
//        [--carried N (a re-sweep: findings left unfixed)] [--closed-carries N (carried findings this sweep fixed)]
//   node approve.mjs <contract.json> --owner-yes "<the owner's words>"  after an ASK, once the owner says yes
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

// A tier's cap counts only the roles beyond its floor (M12, 2026-11-03): a cap below the floor made a
// security-sensitive fix unapprovable. A project may only LOWER it, in .kit/sweep-approval.json
// ({ "caps": { "<tier>": { "maxExtras", "maxAgents", "maxRoleBudget", "maxTotalBudget" } } }); raising a cap is a
// kit change, the owner's call.
const CAPS = { feature: { maxExtras: 5 }, fix: { maxExtras: 1 }, triage: { maxExtras: 0 } };
// Standard budget per role (M11, locked 2026-11-03): the highest of five measured sweeps, rounded up, in processed
// tokens. A trial: adjusted from the log, never below the floor. A role may ask for up to SPECIAL x by naming why.
const STANDARD = { opus: 400000, sonnet: 600000 };
const SPECIAL = 2;
// The reviewer role's own model (user/agents/reviewer.md), for a role that names none.
const DEFAULT_MODEL = 'claude-opus-5-5';
const modelKey = (m) => { const s = String(m ?? DEFAULT_MODEL); return /opus/i.test(s) ? 'opus' : /sonnet/i.test(s) ? 'sonnet' : null; };
// A re-sweep (O2, the owner 2026-11-03): one blast-radius role, one role per kind with a fixed finding, one alignment role.
const RESWEEP_NEEDS = { 'blast-radius': 1, dimension: 1 };
const CARRY_HOME = 'the handoff\'s "Carry-overs from the last PR" (_Active Plan.md); the next feature build fixes them';
const AGENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
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
	const log = lines.map((l) => { try { return JSON.parse(l); } catch { return { kind: 'broken' }; } });
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

function caps(tier) {
	const top = git('rev-parse', '--show-toplevel').stdout.trim();
	const f = top && path.join(top, '.kit', 'sweep-approval.json');
	let own = {};
	try { own = (JSON.parse(fs.readFileSync(f, 'utf8')).caps || {})[tier] || {}; } catch { /* no project caps */ }
	const out = { maxAgents: Infinity, maxRoleBudget: Infinity, maxTotalBudget: Infinity, ...CAPS[tier] };
	for (const k of Object.keys(out)) if (Number.isFinite(own[k]) && (own[k] > 0 || (k === 'maxExtras' && own[k] === 0))) out[k] = Math.min(out[k], own[k]);
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

// What the branch's diff against its base says, or null when it cannot be read.
function diffFacts() {
	const want = opt('--base');
	const base = (want ? [want] : ['origin/main', 'main', 'origin/master', 'master']).find((b) => git('rev-parse', '-q', '--verify', `${b}^{commit}`).status === 0);
	if (!base) return null;
	const names = (filter) => git('diff', '--name-only', `--diff-filter=${filter}`, `${base}...HEAD`).stdout.split('\n').filter(Boolean);
	const all = names('ACDMRT');
	const added = names('A');
	const lines = git('diff', '--numstat', `${base}...HEAD`).stdout.split('\n').filter(Boolean).reduce((t, l) => t + (Number(l.split('\t')[0]) || 0) + (Number(l.split('\t')[1]) || 0), 0);
	// Work not yet committed would not be in the diff the floor reads; the contract's own folder is left out.
	const own = git('rev-parse', '--show-prefix').stdout.trim();
	const dirty = git('status', '--porcelain', '--', ':(top)', `:(top,exclude)${own || '.kit-none'}`).stdout.split('\n').filter(Boolean);
	return {
		base,
		head: git('rev-parse', '--short', 'HEAD').stdout.trim(),
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
const filled = (s, min) => typeof s === 'string' && s.replace(/[^A-Za-z0-9]/g, '').length >= min;

const rel = (f) => toPosix(path.relative(process.cwd(), f) || f);
const isCleared = (log, i) => log[i].decision === 'approved' || log.some((y, j) => j > i && y.kind === 'owner-yes' && y.contract === log[i].contract && y.hash === log[i].hash);

// A re-sweep's own floor (O2 A, revision R2). Returns the kinds it needs, or `refused` when it is past its one pass:
// a refusal is the rule working, so it neither pauses nor writes a triage report.
function resweepCheck(c, tier, roles, log, facts, why) {
	const first = path.resolve(path.dirname(contractFile), String(c.resweepOf || ''));
	let firstRaw = null;
	let firstContract = null;
	try { firstRaw = fs.readFileSync(first, 'utf8'); firstContract = JSON.parse(firstRaw); } catch { /* checked below */ }
	const at = log.map((e, i) => (e.kind === 'decision' && e.contract === first && isCleared(log, i) ? i : -1)).filter((i) => i >= 0).pop();
	if ((at !== undefined && log[at].resweepOf) || (firstContract && firstContract.resweepOf !== undefined)) return { first, refused: `${rel(first)} is itself a re-sweep` };
	// One per first sweep, keyed by its contract, however often it is cleared again. Another contract cleared as its
	// re-sweep counts; this one counts once its outcome is in (it has run), so deciding it again before that asks as
	// any contract does.
	const ran = (i) => log.some((e, j) => j > i && e.kind === 'outcome' && e.contract === log[i].contract);
	if (log.some((e, i) => e.kind === 'decision' && e.resweepOf === first && isCleared(log, i) && (e.contract !== contractFile || ran(i)))) return { first, refused: `${rel(first)} already had its re-sweep` };
	if (at === undefined) { why.push(`the sweep it re-checks (${rel(first)}) was never cleared: run approve.mjs on it first`); return { first, need: {} }; }
	const head = log[at];
	if (!ran(at)) why.push(`log the outcome of the sweep it re-checks (${rel(first)}) first`);
	if (firstRaw === null || sha(firstRaw) !== head.hash) why.push(`the sweep it re-checks (${rel(first)}) changed since it was cleared: a re-sweep reads it as it ran`);
	if (String(head.tier || '').toLowerCase() !== tier) why.push(`a re-sweep keeps its sweep's tier (${head.tier}), not ${tier}`);
	// The re-sweep's floor replaces the modifiers' roles, so it may not claim a risk the first sweep did not cover.
	const firstMods = new Set((firstContract && Array.isArray(firstContract.modifiers)) ? firstContract.modifiers : []);
	for (const m of Array.isArray(c.modifiers) ? c.modifiers : []) if (!firstMods.has(m)) why.push(`modifier "${m}" was not on the sweep it re-checks: a new risk needs the full floor, not a re-sweep`);
	if (facts && head.head) {
		const r = git('merge-base', '--is-ancestor', head.head, 'HEAD');
		if (r.status === 1) why.push(`HEAD does not descend from the HEAD the sweep it re-checks ran on (${head.head})`);
		else if (r.status !== 0) why.push(`cannot tell whether HEAD descends from ${head.head}`);
		else {
			// The re-sweep's floor skips the diff-derived modifiers, so the fixes may not bring what would have set them.
			// Contracts in the sweep folder are left out (reports are docs already); any other file there counts. Renames
			// are read as an add and a delete, and names come raw (-z), so a moved or oddly named file is still seen.
			const own = git('rev-parse', '--show-prefix').stdout.trim();
			const isContract = (f) => { try { const j = JSON.parse(git('show', `HEAD:${f}`).stdout); return typeof j.tier === 'string' && Array.isArray(j.roles); } catch { return false; } };
			const sweepFile = (f) => own && f.startsWith(own) && !f.slice(own.length).includes('/') && /\.json$/i.test(f) && !DEP_FILE.test(f) && isContract(f);
			const since = (filter) => git('diff', '--name-only', '-z', '--no-renames', `--diff-filter=${filter}`, `${head.head}..HEAD`).stdout.split('\0').filter((f) => f && !sweepFile(f));
			const dep = since('ACDMRT').find((f) => DEP_FILE.test(f) && depsChanged(head.head, f));
			const added = since('A').find((f) => !TEST_FILE.test(f) && !DOC_FILE.test(f));
			if (dep) why.push(`the fixes change a package file (${dep}) since the sweep it re-checks: a new dependency needs the full floor, not a re-sweep`);
			if (added) why.push(`the fixes add a source file (${added}) since the sweep it re-checks: new code needs the full floor, not a re-sweep`);
		}
	}
	if (roles.length > (Number(head.agents) || 0)) why.push(`${roles.length} roles, more than the ${head.agents} of the sweep it re-checks: a re-sweep never grows`);
	const fixed = Array.isArray(c.fixed) ? c.fixed : [];
	const firstKinds = new Set(((firstContract && firstContract.roles) || []).map((r) => r.kind));
	if (!fixed.length) why.push('no fixed findings listed ("fixed": [{ "finding", "kind" }]): a re-sweep checks the fixes');
	const need = { ...RESWEEP_NEEDS };
	fixed.forEach((x, i) => {
		if (!x || !filled(x.finding, 8)) why.push(`fixed finding ${i + 1}: no finding named`);
		if (!x || !firstKinds.has(x.kind)) why.push(`fixed finding ${i + 1}: kind "${x && x.kind}" had no role in the sweep it re-checks`);
		else need[x.kind] = 1;
	});
	const kinds = new Set(roles.map((r) => r.kind));
	for (const k of kinds) {
		const n = roles.filter((r) => r.kind === k).length;
		if (!need[k]) why.push(`a ${k} role: a re-sweep has only blast-radius, one role per fixed kind and dimension (alignment)`);
		else if (n > need[k]) why.push(`${n} ${k} roles: a re-sweep has one of each`);
	}
	return { first, need };
}

// Every reason this contract needs the owner (none means it is inside the rules), and the role kinds it needed.
function check(c, facts, log = []) {
	const tier = String(c.tier || '').toLowerCase();
	if (OWNER_TIERS.includes(tier)) return { why: [`the ${tier} tier is always the owner's call`], need: {} };
	// Own keys only: "constructor" or "__proto__" would otherwise find an object's built-ins and pass with no floor.
	if (!Object.hasOwn(CAPS, tier)) return { why: [`unknown tier "${c.tier}"`], need: {} };
	const why = [];
	if (!facts) why.push('cannot read the branch diff against its base (pass --base <ref>)');
	else if (facts.dirty.length) why.push(`work not committed (${facts.dirty[0].slice(3)}): commit it, so the diff shows the whole change`);
	else if (!facts.changed) why.push(`no changes against ${facts.base}: run it from the branch's own checkout, or pass the right --base`);
	else {
		if (tier !== 'feature' && facts.addedSource.length) why.push(`an added source file (${facts.addedSource[0]}) is feature work, not ${tier}`);
		if (tier === 'triage' && (facts.added.length || facts.lines > TRIAGE_MAX_LINES)) why.push(`${facts.lines} changed lines, ${facts.added.length} added files: more than a triage change`);
	}
	const roles = Array.isArray(c.roles) ? c.roles : [];
	const cap = caps(tier);
	if (!roles.length) why.push('no roles');
	if (roles.length > cap.maxAgents) why.push(`${roles.length} agents, over the project's ${tier} cap of ${cap.maxAgents}`);
	const resweep = c.resweepOf !== undefined;
	let need = { ...NEEDS[tier] };
	let first = null;
	if (resweep) {
		const r = resweepCheck(c, tier, roles, log, facts, why);
		if (r.refused) return { why: [], need: {}, refused: r.refused, first: r.first };
		({ need, first } = r);
	} else {
		const modifiers = new Set(Array.isArray(c.modifiers) ? c.modifiers : []);
		if (facts && facts.deps) modifiers.add('new-dependency');
		if (tier === 'fix' && (c.testsChanged || (facts && facts.tests))) need['test-value'] = 1;
		for (const m of modifiers) {
			if (!Object.hasOwn(MODIFIER_NEEDS, m)) { why.push(`unknown modifier "${m}"`); continue; }
			for (const [k, n] of Object.entries(MODIFIER_NEEDS[m])) need[k] = Math.max(need[k] || 0, n);
		}
	}
	const count = (k) => roles.filter((r) => r.kind === k).length;
	for (const [k, n] of Object.entries(need)) if (count(k) < n) why.push(`needs ${n} ${k} role(s), has ${count(k)}${facts && facts.deps && k === 'supply-chain' ? ' (the diff changes a package file)' : ''}`);
	// The floor's roles are always allowed; the cap limits what a sweep adds beyond them.
	const extras = roles.length - Object.entries(need).reduce((t, [k, n]) => t + Math.min(count(k), n), 0);
	if (!resweep && extras > cap.maxExtras) why.push(`${extras} roles beyond the ${tier} floor, over its cap of ${cap.maxExtras}`);
	let total = 0;
	roles.forEach((r, i) => {
		const name = `role ${i + 1} (${r.role || r.kind})`;
		if (!KINDS.includes(r.kind)) why.push(`${name}: unknown kind "${r.kind}"`);
		if (!filled(r.question, 15)) why.push(`${name}: no real question`);
		if (!Array.isArray(r.context) || !r.context.length || !r.context.every((x) => filled(x, 2))) why.push(`${name}: no context (the files, rule and spec its lens needs)`);
		else if (r.context.length > MAX_CONTEXT) why.push(`${name}: ${r.context.length} context entries, over ${MAX_CONTEXT}: a role's context is what its lens needs`);
		if (!filled(r.finding, 8)) why.push(`${name}: no finding shape`);
		// The reviewer model trial (rule:test-and-review-cadence): security and the novel lens stay on the top model.
		if (TOP_ONLY.includes(r.kind) && r.model !== undefined && !TOP_MODEL.test(String(r.model))) why.push(`${name}: a ${r.kind} role stays on the top model, not "${r.model}"`);
		const key = modelKey(r.model);
		const std = key && STANDARD[key];
		if (typeof r.budget !== 'number' || !Number.isFinite(r.budget) || r.budget <= 0) why.push(`${name}: no token budget`);
		else if (!std) why.push(`${name}: no standard budget for model "${r.model}" (standards: opus ${STANDARD.opus}, sonnet ${STANDARD.sonnet})`);
		else if (r.budget > SPECIAL * std) why.push(`${name}: budget ${r.budget} over ${SPECIAL}x the ${key} standard of ${std}`);
		else if (r.budget > std && !(filled(r.budgetReason, 15) && words(r.budgetReason).size >= 3)) why.push(`${name}: budget ${r.budget} over the ${key} standard of ${std} needs a budgetReason (why this role reads more)`);
		else if (r.budget > cap.maxRoleBudget) why.push(`${name}: budget ${r.budget} over the project's per-role cap of ${cap.maxRoleBudget}`);
		else total += r.budget;
	});
	if (total > cap.maxTotalBudget) why.push(`total budget ${total} over the project's ${tier} cap of ${cap.maxTotalBudget}`);
	for (let i = 0; i < roles.length; i++) for (let j = i + 1; j < roles.length; j++) {
		if (overlap(roles[i].question, roles[j].question) >= CLONE) why.push(`roles ${i + 1} and ${j + 1} ask the same question (a clone)`);
	}
	return { why, need, extras, cap, first };
}

// The most a contract's roles may spend: each role's special-case ceiling, under any lower project cap.
const ceiling = (c, cap) => Math.min(cap.maxTotalBudget, (c.roles || []).reduce((t, r) => t + Math.min(cap.maxRoleBudget, SPECIAL * (STANDARD[modelKey(r.model)] || 0)), 0));

// Findings a re-sweep left unfixed, still open until a later outcome closes them.
const openCarries = (log) => log.filter((e) => e.kind === 'outcome').reduce((t, e) => t + (Number(e.carried) || 0) - (Number(e.closedCarries) || 0), 0);

// What the owner reads at a stop: what tripped, the numbers, the log lines and the ways forward.
const FIXES = [
	[/paused|trial review due/, 'The owner reviews the log first (`approve.mjs --summary`), then resumes from their own terminal; until then every sweep goes to the owner.'],
	[/not committed|no changes|cannot read the branch diff/, 'Commit the work and run approve.mjs from the branch\'s own checkout (pass `--base <ref>` if it cannot find the base).'],
	[/needs \d+ \S+ role/, 'Add the missing floor role(s) and run approve.mjs again.'],
	[/beyond the \S+ floor|agents, over/, 'Drop the extra roles, or split the change into smaller PRs.'],
	[/budget/, `Set each role at its model's standard (opus ${STANDARD.opus.toLocaleString('en-US')}, sonnet ${STANDARD.sonnet.toLocaleString('en-US')}), or up to ${SPECIAL}x with a budgetReason.`],
	[/re-sweep|re-checks|fixed finding|descend/, 'Focus the re-sweep: one blast-radius role, one role per kind with a fixed finding, one dimension (alignment) role, on a HEAD that builds on the first sweep, after its outcome is logged.'],
	[/question|context|finding shape|unknown|no roles|top model/, 'Fix the named role in the contract and run approve.mjs again.'],
	[/log the outcome of the last approved sweep/, 'Log that sweep\'s outcome with --agents; if no reviewer started under it, close it with `--outcome --none-ran`.'],
	[/over the budget|repeated between roles|escaped|ran on/, 'The owner reads the sweep\'s report and the per-role numbers above, decides whether the trip was a real failure, and resumes or adjusts.'],
];
function triage(title, reasons, numbers) {
	const f = contractFile.replace(/\.json$/i, '') + '.triage.md';
	const options = [...new Set(reasons.flatMap((w) => FIXES.filter(([re]) => re.test(w)).map(([, fix]) => fix)))];
	const text = [
		`# Triage: ${title}`, '',
		`Written by approve.mjs at ${new Date().toISOString()} for ${rel(contractFile)} at HEAD ${git('rev-parse', '--short', 'HEAD').stdout.trim() || 'unknown'}.`, '',
		'## What tripped', '', ...reasons.map((w) => `- ${w}`), '',
		'## The numbers', '', ...numbers.map((n) => `- ${n}`), '',
		// The report sits in the working tree, so its log lines carry relative paths and leave out the owner's words.
		'## The log lines', '', '```json', ...rawLines().slice(-5).map((l) => { try { const { words: _w, note: _n, ...e } = JSON.parse(l); return JSON.stringify({ ...e, ...(e.contract ? { contract: rel(e.contract) } : {}), ...(e.resweepOf ? { resweepOf: rel(e.resweepOf) } : {}) }); } catch { return '(unreadable line)'; } }), '```', '',
		'## Fix options', '', ...options.map((o) => `- ${o}`),
		'- Or the owner decides: after an ask, `approve.mjs <contract.json> --owner-yes "<their words>"`; after a pause, the owner resumes from their own terminal.', '',
	].join('\n');
	fs.writeFileSync(f, text);
	return toPosix(f);
}

const budgetOf = (c) => (c.roles || []).reduce((t, r) => t + (typeof r.budget === 'number' && r.budget > 0 ? r.budget : 0), 0);

function decide() {
	const raw = fs.readFileSync(contractFile, 'utf8');
	const c = JSON.parse(raw);
	const s = state();
	const facts = diffFacts();
	const { why, need, extras, cap, first, refused } = check(c, facts, s.log);
	const head = git('rev-parse', '--short', 'HEAD').stdout.trim() || null;
	const carries = openCarries(s.log);
	const carryLine = carries > 0 ? [`Open carry-overs: ${carries} carried finding(s) open from a re-sweep, in ${CARRY_HOME}; the outcome of the sweep that fixes them closes them with --closed-carries <n>.`] : [];
	if (refused) {
		write({ kind: 'decision', contract: contractFile, hash: sha(raw), tier: c.tier, agents: (c.roles || []).length, budget: budgetOf(c), decision: 'refused', reasons: [refused], resweepOf: first, head });
		console.log(`REFUSED - one re-sweep per sweep (rule:sweep-tiers): ${refused}. No reviewer runs on this contract.`);
		console.log(`    What the re-sweep left goes to ${CARRY_HOME}. Log the re-sweep's outcome with --carried <n> if you have not.`);
		return 1;
	}
	// The last approved sweep is reported once any outcome for its contract follows it, even one logged after a later
	// ask on the same contract.
	const openAt = s.log.map((e, i) => (e.kind === 'decision' && e.decision === 'approved' ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
	const open = openAt >= 0 ? s.log[openAt] : null;
	const reported = open && s.log.some((e, i) => i > openAt && e.kind === 'outcome' && e.contract === open.contract);
	if (s.paused) why.unshift(`auto-approval is paused: ${s.paused}`);
	else if (s.approvedSinceReview >= s.reviewEvery) {
		const reason = `trial review due: ${s.reviewEvery} auto-approvals since the last review`;
		write({ kind: 'pause', reason });
		why.unshift(reason);
	} else if (open && !reported) why.unshift(`log the outcome of the last approved sweep first (${rel(open.contract)}): --agents, or --none-ran if no reviewer started under it`);
	const entry = { kind: 'decision', contract: contractFile, hash: sha(raw), tier: c.tier, agents: (c.roles || []).length, budget: budgetOf(c), decision: why.length ? 'owner' : 'approved', reasons: why, base: facts && facts.base, head, ...(first ? { resweepOf: first } : {}) };
	write(entry);
	if (why.length) {
		console.log('ASK THE OWNER - this Swarm Contract is outside the approved rules (rule:sweep-auto-approval):');
		for (const w of why) console.log(`    ${w}`);
		const now = state();
		if (now.paused) for (const l of resumeHelp(now)) console.log(l);
		const f = triage(`${c.tier} ${first ? 're-sweep' : 'sweep'} sent to the owner`, why, [
			`${entry.agents} roles, budget ${entry.budget.toLocaleString('en-US')}${first ? `, a re-sweep of ${rel(first)}` : extras === undefined ? ', no floor counted (this tier always goes to the owner)' : `, ${extras} beyond the floor (cap ${cap.maxExtras})`}`,
			...(c.roles || []).map((r, i) => `role ${i + 1}: ${r.role || r.kind} (${r.kind}, ${r.model || DEFAULT_MODEL}), budget ${r.budget}${r.budgetReason ? ` (${r.budgetReason})` : ''}`),
			...(now.paused ? [`paused since ${String(now.pausedAt || '').slice(0, 10)}: ${now.paused}`] : []),
		]);
		console.log(`    Triage report for the owner: ${f}`);
		for (const l of carryLine) console.log(l);
		return 1;
	}
	console.log(`APPROVED - ${c.tier} ${first ? `re-sweep of ${rel(first)}` : 'sweep'}, ${entry.agents} agents, budget ${entry.budget}, inside the rules. Logged to ${LOG}.`);
	console.log(notice(c, need, extras, cap, first));
	for (const l of carryLine) console.log(l);
	return 0;
}

// The owner's start notice, written from the checked contract so it carries no hand count. Post it as is.
function notice(c, need, extras, cap, first) {
	const roles = c.roles || [];
	const n = (x) => x.toLocaleString('en-US');
	const kinds = {};
	for (const r of roles) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
	return [
		'Start notice for the owner (checked by approve.mjs; post it as is):',
		`    ${c.tier} ${first ? 're-sweep' : 'sweep'}, ${roles.length} roles: ${Object.entries(kinds).map(([k, v]) => `${k} x${v}`).join(', ')}`,
		...roles.map((r, i) => `    ${i + 1}. ${r.role || r.kind} (${r.kind}, ${r.model || 'the reviewer default'}), budget ${n(r.budget)}${r.budgetReason ? ` (over standard: ${r.budgetReason})` : ''}`),
		`    Budget: ${n(budgetOf(c))} of the ${n(ceiling(c, cap))} ceiling (processed tokens; standard opus ${n(STANDARD.opus)}, sonnet ${n(STANDARD.sonnet)}, up to ${SPECIAL}x with a reason)`,
		`    Floor met: ${Object.entries(need).map(([k, v]) => `${k} ${kinds[k] || 0} of ${v} needed`).join(', ') || 'none for this tier'}`,
		first ? `    Re-sweep of ${rel(first)}: fixed ${(c.fixed || []).length} finding(s); its outcome logs --carried <n>` : `    Extras: ${extras} of ${cap.maxExtras} allowed beyond the floor`,
		'    Findings come when the sweep finishes.',
	].join('\n');
}

// The owner said yes to a contract the script sent to them. Logged only for the contract and HEAD the script asked
// about, so the reviewers' guard (sweep-guard) sees the owner's call and the order: script first, then the owner.
function ownerYes() {
	const said = opt('--owner-yes');
	if (!filled(said, 2)) { console.log("--owner-yes needs the owner's own words, quoted; nothing logged."); return 1; }
	const raw = fs.readFileSync(contractFile, 'utf8');
	const last = state().log.filter((e) => e.kind === 'decision' && e.contract === contractFile).pop();
	const head = git('rev-parse', '--short', 'HEAD').stdout.trim();
	if (!last || last.decision !== 'owner') { console.log('The script did not send this contract to the owner, so there is no ask to answer. Run approve.mjs on it first.'); return 1; }
	if (last.hash !== sha(raw) || last.head !== head) { console.log('The contract or HEAD changed since the script asked. Run approve.mjs again, then ask the owner.'); return 1; }
	write({ kind: 'owner-yes', contract: contractFile, hash: last.hash, head, agents: last.agents, words: said });
	console.log("The owner's yes is logged; the reviewers may start.");
	return 0;
}

// A pause is the owner's to clear, so every ask while paused says how, and what to review first.
function resumeHelp(s) {
	return [
		`Auto-approval is paused since ${String(s.pausedAt || '').slice(0, 10) || 'an unknown date'}: ${s.paused}.`,
		`    The owner reviews the log first (node ${toPosix(SELF)} --summary), then resumes from their own terminal:`,
		`    resume: PowerShell  $env:KIT_OWNER_RESUME='1'; node ${toPosix(SELF)} --resume`,
		`    resume: bash        KIT_OWNER_RESUME=1 node ${toPosix(SELF)} --resume`,
		'    Until then every sweep goes to the owner. Carry this into the closeout handoff.',
	];
}

// Each reviewer's spend, read from its own transcript (<config>/projects/<project>/<session>/subagents/agent-<id>.jsonl):
// every call's input + cache read + cache write + output. Streaming writes one line per content block under one
// message id, so each id counts once, at its last line. The Agent result's own number is the final context size,
// not the spend (results/m11-meter in the workbench), so it is never used. Only this sweep's own reviewers count:
// Claude Code's meta file beside the transcript says a reviewer that finished, and its first line is no older than
// the clearance. Anything else asks the owner, so a cheap or half-written transcript cannot stand in.
function spend(ids, since) {
	const root = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
	const found = new Map(ids.map((id) => [id, []]));
	const list = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(d, e.name)); } catch { return []; } };
	for (const project of list(root)) for (const session of list(project)) {
		for (const id of ids) { const f = path.join(session, 'subagents', `agent-${id}.jsonl`); if (fs.existsSync(f)) found.get(id).push(f); }
	}
	const bad = [];
	const roles = ids.map((id) => {
		const files = found.get(id);
		if (files.length !== 1) { bad.push(`${id} (${files.length ? `${files.length} transcripts` : 'no transcript'})`); return null; }
		let meta = {};
		try { meta = JSON.parse(fs.readFileSync(files[0].replace(/\.jsonl$/, '.meta.json'), 'utf8')); } catch { /* checked below */ }
		if (!/(^|:)reviewer$/i.test(String(meta.agentType || ''))) { bad.push(`${id} (not a reviewer: ${meta.agentType || 'no meta file'})`); return null; }
		const parsed = fs.readFileSync(files[0], 'utf8').split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } });
		if (meta.finished !== true || !parsed.length || parsed[parsed.length - 1] === null) { bad.push(`${id} (not finished: log the outcome once every reviewer has handed back)`); return null; }
		const started = (parsed.find((e) => e && e.timestamp) || {}).timestamp;
		if (!started || !(started >= since)) { bad.push(`${id} (started ${started || 'at no recorded time'}, before this sweep was cleared at ${since})`); return null; }
		const seen = new Map();
		for (const e of parsed) {
			const m = e && e.message;
			if (m && m.role === 'assistant' && m.usage) seen.set(m.id || e.uuid, m);
		}
		const u = (m, k) => Number(m.usage[k]) || 0;
		const tokens = [...seen.values()].reduce((t, m) => t + u(m, 'input_tokens') + u(m, 'cache_read_input_tokens') + u(m, 'cache_creation_input_tokens') + u(m, 'output_tokens'), 0);
		return { agent: id, model: [...seen.values()].map((m) => m.model).filter(Boolean).pop() || null, tokens };
	});
	return bad.length ? { root, bad } : { root, roles };
}

function outcome() {
	if (has('--tokens')) { console.log('--tokens is not taken: the script reads each role\'s spend from its own transcript. Pass --agents <id,...>, one agent id per role in the contract\'s order. Nothing logged.'); return 1; }
	const s = state();
	const lines = rawLines();
	// The decision is found by the contract's path, so an edit after approval still finds it.
	// An owner-decided sweep logs its outcome too, so the trial review sees every sweep.
	const decision = s.log.filter((e) => e.kind === 'decision' && e.contract === contractFile).pop();
	if (!decision) { console.log(`No decision for ${contractFile}; run approve.mjs on it first. Nothing logged.`); return 1; }
	if (decision.decision === 'refused') { console.log('The script refused this contract, so no reviewer ran on it. Nothing logged.'); return 1; }
	// An approval no reviewer used (a new commit or an edited contract came first) is closed without a measure, but
	// only while the sweep guard shows no reviewer started under it.
	if (has('--none-ran')) {
		const at = s.log.map((e, i) => (e.kind === 'decision' && e.contract === contractFile && e.decision === 'approved' ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
		if (at < 0) { console.log('--none-ran closes an approved sweep; this contract has none. Nothing logged.'); return 1; }
		let started = [];
		try { started = fs.readdirSync(path.join(path.dirname(LOG), 'kit-sweep-starts', sha(lines[at]))); } catch { /* none started */ }
		if (started.length) { console.log(`${started.length} reviewer(s) started under this approval, so its spend is measured: log the outcome with --agents. Nothing logged.`); return 1; }
		write({ kind: 'outcome', contract: contractFile, decisionAt: s.log[at].time, budget: s.log[at].budget, tokens: 0, findings: 0, real: 0, duplicates: 0, noneRan: true });
		console.log('Outcome logged: no reviewer ran under this approval.');
		return 0;
	}
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
		if (v === null) { console.log('A re-sweep\'s outcome needs --carried <n>: the findings left unfixed after it, from either pass. Nothing logged.'); return 1; }
		nums.carried = v;
	} else if (has('--carried')) { console.log('--carried is for a re-sweep\'s outcome; nothing logged.'); return 1; }
	if (has('--closed-carries')) {
		const v = count('closed-carries', openCarries(s.log));
		if (v === null) { console.log(`--closed-carries needs a number from 0 to the ${openCarries(s.log)} open; nothing logged.`); return 1; }
		nums.closedCarries = v;
	}
	const ids = String(opt('--agents') || '').split(',').map((x) => x.trim()).filter(Boolean);
	// Windows file names ignore case, so a1 and A1 are one transcript.
	if (!ids.length || ids.some((id) => !AGENT_ID.test(id)) || new Set(ids.map((x) => x.toLowerCase())).size !== ids.length) { console.log('--agents needs the reviewers\' agent ids, comma-separated, each once (letters, digits, - and _). Nothing logged.'); return 1; }
	if (ids.length !== Number(decision.agents)) { console.log(`--agents names ${ids.length} agent(s); the contract had ${decision.agents} role(s): one id per role, in its order. Nothing logged.`); return 1; }
	// This round of the contract began at its first decision after its last outcome.
	const lastOut = s.log.map((e, i) => (e.kind === 'outcome' && e.contract === contractFile ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
	const since = (s.log.find((e, i) => i > lastOut && e.kind === 'decision' && e.contract === contractFile) || decision).time;
	const used = new Set(s.log.filter((e) => e.kind === 'outcome').flatMap((e) => (Array.isArray(e.roles) ? e.roles : []).map((r) => String(r.agent).toLowerCase())));
	const reused = ids.filter((id) => used.has(id.toLowerCase()));
	const read = reused.length ? { bad: reused.map((id) => `${id} (already logged for an earlier outcome)`) } : spend(ids, since);
	if (read.bad) {
		const why = [`the spend cannot be read, so it is not guessed: ${read.bad.join(', ')}`];
		console.log('ASK THE OWNER - the spend cannot be read, so it is not guessed (rule:sweep-auto-approval):');
		console.log(`    ${read.bad.join(', ')}${read.root ? ` under ${toPosix(read.root)}` : ''}. Check the agent ids, or set CLAUDE_CONFIG_DIR to the config folder the session ran in. Nothing logged.`);
		console.log(`    Triage report for the owner: ${triage('a sweep outcome that cannot be measured', why, [`agents given: ${ids.join(', ')}`, `this round began at ${since}`])}`);
		return 1;
	}
	let roles = [];
	try { roles = JSON.parse(fs.readFileSync(contractFile, 'utf8')).roles || []; } catch { /* labels only */ }
	const per = read.roles.map((x, i) => ({ ...x, role: (roles[i] && roles[i].role) || `role ${i + 1}`, kind: (roles[i] && roles[i].kind) || null }));
	nums.tokens = per.reduce((t, x) => t + x.tokens, 0);
	write({ kind: 'outcome', contract: contractFile, decisionAt: decision.time, budget: decision.budget, ...nums, roles: per });
	const trips = [];
	if (decision.budget && nums.tokens >= OVERRUN * decision.budget) trips.push(`tokens ${nums.tokens} ran ${Math.round((nums.tokens / decision.budget - 1) * 100)}% over the budget of ${decision.budget}`);
	if (nums.findings > 0 && nums.duplicates * 3 >= nums.findings) trips.push(`${nums.duplicates} of ${nums.findings} findings repeated between roles`);
	// The budget standard and the top-model rule rest on the model a role names, so a reviewer on another one is the owner's.
	per.forEach((x, i) => {
		const named = roles[i] ? (roles[i].model ?? DEFAULT_MODEL) : null;
		if (named && modelKey(named) !== modelKey(x.model)) trips.push(`${x.role} ran on ${x.model}; the contract named ${named}`);
	});
	for (const t of trips) write({ kind: 'pause', reason: t });
	console.log(trips.length ? `Outcome logged; auto-approval paused: ${trips.join('; ')}` : `Outcome logged: ${nums.tokens.toLocaleString('en-US')} processed tokens over ${per.length} role(s).`);
	if (trips.length) {
		const f = triage('auto-approval paused after a sweep\'s outcome', trips, [
			`tokens ${nums.tokens} of the budget ${decision.budget} (the trip is ${OVERRUN}x)`,
			...per.map((x) => `${x.role} (${x.kind}, ${x.model}): ${x.tokens} processed tokens`),
			`findings ${nums.findings}, real ${nums.real}, repeated between roles ${nums.duplicates}`,
		]);
		console.log(`    Triage report for the owner: ${f}`);
	}
	if (nums.carried > 0) console.log(`CARRY-OVER - ${nums.carried} finding(s) left unfixed after the re-sweep go to ${CARRY_HOME}. List each there; every sweep start shows them open until that sweep's outcome closes them with --closed-carries <n>.`);
	return 0;
}

function summary() {
	const s = state();
	const d = s.log.filter((e) => e.kind === 'decision');
	const o = s.log.filter((e) => e.kind === 'outcome');
	const sum = (k) => o.reduce((t, e) => t + (Number(e[k]) || 0), 0);
	console.log(`approved: ${d.filter((e) => e.decision === 'approved').length}, sent to the owner: ${d.filter((e) => e.decision === 'owner').length}, refused: ${d.filter((e) => e.decision === 'refused').length}`);
	console.log(`outcomes: ${o.length}; tokens / budget: ${sum('budget') ? (sum('tokens') / sum('budget')).toFixed(2) : 'n/a'}; real findings: ${sum('real')} of ${sum('findings')} (from mid-model roles: ${sum('realMid')}); repeated: ${sum('duplicates')}; carried open: ${openCarries(s.log)}`);
	// Per role kind, the most one role spent against its model's standard: the data the standards are adjusted from.
	const kinds = {};
	for (const r of o.flatMap((e) => (Array.isArray(e.roles) ? e.roles : []))) {
		const k = (kinds[r.kind] ||= { n: 0, max: 0, model: null });
		k.n++;
		if (r.tokens >= k.max) { k.max = r.tokens; k.model = r.model; }
	}
	const n = (x) => x.toLocaleString('en-US');
	if (Object.keys(kinds).length) console.log(`spend by role kind (processed tokens): ${Object.entries(kinds).map(([k, v]) => `${k} x${v.n}: up to ${n(v.max)} of the ${STANDARD[modelKey(v.model)] ? `${n(STANDARD[modelKey(v.model)])} standard` : 'no standard'}`).join('; ')}`);
	console.log(`escapes: ${s.log.filter((e) => e.kind === 'escape').length}; state: ${s.paused ? `paused (${s.paused})` : `running, ${s.approvedSinceReview} of ${s.reviewEvery} since the last review`}`);
	if (s.paused) console.log(resumeHelp(s)[2].trim());
	return 0;
}

function main() {
	if (!LOG) { console.log('ASK THE OWNER - not inside a git repository, so there is no approval log.'); return 1; }
	if (has('--summary')) return summary();
	if (has('--resume')) {
		// An AI tool's shell carries one of these; the owner's own terminal does not (the push guard's same line).
		if ('CLAUDECODE' in process.env || 'AI_AGENT' in process.env || process.env.KIT_OWNER_RESUME !== '1') {
			console.log('Only the owner resumes auto-approval, from their own terminal: review the log, then run KIT_OWNER_RESUME=1 node approve.mjs --resume.');
			return 1;
		}
		write({ kind: 'resume' });
		console.log(`Auto-approval resumed; the next review comes after ${state().reviewEvery} more.`);
		return 0;
	}
	if (!contractFile) { console.log('Usage: node approve.mjs <contract.json> [--outcome ... | --escape "<note>"] [--base <ref>]'); return 2; }
	if (has('--escape')) {
		write({ kind: 'escape', contract: contractFile, note: opt('--escape') });
		const reason = `a bug escaped a passed sweep: ${opt('--escape')}`;
		write({ kind: 'pause', reason });
		console.log('Escape logged; auto-approval paused for the owner.');
		console.log(`    Triage report for the owner: ${triage('a bug escaped a passed sweep', [reason], [`escapes logged so far: ${state().log.filter((e) => e.kind === 'escape').length}`])}`);
		return 0;
	}
	if (has('--owner-yes')) return ownerYes();
	if (has('--outcome')) return outcome();
	return decide();
}

process.exitCode = main();
