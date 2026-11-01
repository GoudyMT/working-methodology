#!/usr/bin/env node
// Sweep auto-approval (rule:sweep-auto-approval). Approves a Swarm Contract (rule:swarm-contract) that stays inside
// its tier's rules, so a routine sweep need not wait for the owner, and hands back to the owner on anything else.
// It is a script on purpose: the same contract always gets the same answer, at no token cost.
//
// The contract is a JSON file in the project's sweep folder (adapter A22), written next to the table the owner would
// have read:
//   { "tier": "feature" | "fix" | "triage" | "first push" | "launch gate",
//     "modifiers": ["security-sensitive" | "new-dependency" | "public-text" | "user-data"],
//     "testsChanged": true,
//     "roles": [{ "role", "kind", "question", "context": [...], "finding", "budget" }] }
//
// What the contract says about itself is not taken on trust where the branch can show it: the diff against the base
// sets the tier's floor, adds the dependency modifier and marks changed tests. The log lives in the repo's git folder
// (never pushed, one per repo), each line chained to the one before, so a careless hand edit shows (a careful one does not; the owner reads the log at
// each trial review). The script
// pauses itself, and only the owner resumes it from a terminal no AI tool runs in, after: tokens a quarter or more
// over budget, a third or more of the findings repeated between roles, a bug that escaped a sweep it passed, or
// every 10 auto-approvals (the trial review; every 20 after two clean ones in a row). The next approval waits for the
// last sweep's outcome.
//
// Usage (from inside the repo):
//   node approve.mjs <contract.json> [--base <ref>]                     decide (exit 0 approved, 1 ask the owner)
//   node approve.mjs <contract.json> --resweep <first contract.json>  the one short re-sweep after the fixes
//   node approve.mjs <contract.json> --outcome --tokens N --findings N --real N --duplicates N [--real-mid N]
//   node approve.mjs <contract.json> --owner-yes "<the owner's words>"  after an ASK, once the owner says yes
//   node approve.mjs <contract.json> --escape "<what slipped through>"
//   node approve.mjs --summary
//   KIT_OWNER_RESUME=1 node approve.mjs --resume                        the owner, in their own terminal
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const toPosix = (p) => p.split(path.sep).join('/');

// Starting caps, to be set from the trial log once real sweeps are measured. A project may only LOWER them, in
// .kit/sweep-approval.json ({ "caps": { "<tier>": { ... } } }); raising a cap is a kit change, the owner's call.
const CAPS = {
	feature: { maxAgents: 10, maxRoleBudget: 150000, maxTotalBudget: 1000000 },
	fix: { maxAgents: 3, maxRoleBudget: 100000, maxTotalBudget: 300000 },
	triage: { maxAgents: 1, maxRoleBudget: 40000, maxTotalBudget: 40000 },
};
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
	const out = { ...CAPS[tier] };
	for (const k of Object.keys(out)) if (Number.isFinite(own[k]) && own[k] > 0) out[k] = Math.min(out[k], own[k]);
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

// The project's sweep folder (adapter A22: the "Sweep reports" line of its CLAUDE.md), as a path from the repo's top
// ending in /. Contracts live there and nowhere else, and it is the one folder the floor leaves out: a contract saved
// in src/ once took src/ out of the floor with it.
const SWEEP_LINE = /\*\*Sweep reports:\*\*\s*`<?([^`>]+)>?`/;
function sweepFolder() {
	const top = git('rev-parse', '--show-toplevel').stdout.trim();
	for (const name of ['CLAUDE.md', 'CLAUDE.local.md']) {
		let text = '';
		try { text = fs.readFileSync(path.join(top, name), 'utf8'); } catch { continue; }
		const m = text.match(SWEEP_LINE);
		if (m) return m[1].trim().replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/\/*$/, '/');
	}
	return 'docs/sweeps/';
}
const inSweepFolder = (file) => {
	const top = git('rev-parse', '--show-toplevel').stdout.trim();
	const rel = toPosix(path.relative(top, file));
	return !rel.startsWith('..') && rel.toLowerCase().startsWith(sweepFolder().toLowerCase());
};

// What the branch's diff against its base says, or null when it cannot be read.
function diffFacts(want = opt('--base')) {
	const base = (want ? [want] : ['origin/main', 'main', 'origin/master', 'master']).find((b) => git('rev-parse', '-q', '--verify', `${b}^{commit}`).status === 0);
	if (!base) return null;
	const names = (filter) => git('diff', '--name-only', `--diff-filter=${filter}`, `${base}...HEAD`).stdout.split('\n').filter(Boolean);
	const all = names('ACDMRT');
	const added = names('A');
	const lines = git('diff', '--numstat', `${base}...HEAD`).stdout.split('\n').filter(Boolean).reduce((t, l) => t + (Number(l.split('\t')[0]) || 0) + (Number(l.split('\t')[1]) || 0), 0);
	// Work not yet committed would not be in the diff the floor reads; only the sweep folder is left out.
	const folder = sweepFolder();
	const dirty = git('status', '--porcelain', '--', ':(top)', `:(top,exclude)${folder}`).stdout.split('\n').filter(Boolean);
	return {
		base,
		head: git('rev-parse', '--short', 'HEAD').stdout.trim(),
		dirty,
		folder,
		files: all,
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

// Every reason this contract needs the owner (none means it is inside the rules), and the role kinds it needed. A
// re-sweep brings its own floor in place of the tier's.
function check(c, facts, floor) {
	const tier = String(c.tier || '').toLowerCase();
	if (OWNER_TIERS.includes(tier)) return { why: [`the ${tier} tier is always the owner's call`], need: {} };
	if (!CAPS[tier]) return { why: [`unknown tier "${c.tier}"`], need: {} };
	const why = [];
	if (!inSweepFolder(contractFile)) why.push(`the contract is not in the sweep folder (${sweepFolder()}, adapter A22): save it there`);
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
	const base = { ...(floor || NEEDS[tier]) };
	if (tier === 'fix' && (c.testsChanged || (facts && facts.tests))) base['test-value'] = 1;
	const need = { ...base };
	const modifiers = new Set(Array.isArray(c.modifiers) ? c.modifiers : []);
	if (facts && facts.deps) modifiers.add('new-dependency');
	for (const m of modifiers) {
		if (!MODIFIER_NEEDS[m]) { why.push(`unknown modifier "${m}"`); continue; }
		for (const [k, n] of Object.entries(MODIFIER_NEEDS[m])) need[k] = Math.max(need[k] || 0, n);
	}
	const count = (k) => roles.filter((r) => r.kind === k).length;
	// Modifiers add roles at any tier (rule:sweep-tiers), so the roles a modifier requires beyond the tier's own floor
	// come on top of the tier's role cap; the budget caps below still hold.
	const added = Object.entries(need).reduce((t, [k, n]) => t + Math.max(0, Math.min(count(k), n) - (base[k] || 0)), 0);
	if (roles.length - added > cap.maxAgents) why.push(`${roles.length - added} agents beyond the modifiers' roles, over the ${tier} cap of ${cap.maxAgents}`);
	for (const [k, n] of Object.entries(need)) if (count(k) < n) why.push(`needs ${n} ${k} role(s), has ${count(k)}${facts && facts.deps && k === 'supply-chain' ? ' (the diff changes a package file)' : ''}`);
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
		if (typeof r.budget !== 'number' || !Number.isFinite(r.budget) || r.budget <= 0) why.push(`${name}: no token budget`);
		else if (r.budget > cap.maxRoleBudget) why.push(`${name}: budget ${r.budget} over the per-role cap of ${cap.maxRoleBudget}`);
		else total += r.budget;
	});
	if (total > cap.maxTotalBudget) why.push(`total budget ${total} over the ${tier} cap of ${cap.maxTotalBudget}`);
	for (let i = 0; i < roles.length; i++) for (let j = i + 1; j < roles.length; j++) {
		if (overlap(roles[i].question, roles[j].question) >= CLONE) why.push(`roles ${i + 1} and ${j + 1} ask the same question (a clone)`);
	}
	return { why, need };
}

// The one short re-sweep after a sweep's fixes (rule:sweep-tiers). Its floor is not the tier's: every file changed
// since the first sweep's HEAD, read from git here and never from the contract, must be named in some role's
// context, and a security-sensitive first sweep keeps one security role. The first sweep must be cleared, reported,
// unedited and behind this HEAD; each sweep gets one re-sweep and a re-sweep gets none (no third pass).
const cleared = (s, d) => d.decision === 'approved' || s.log.some((e) => e.kind === 'owner-yes' && e.contract === d.contract && e.hash === d.hash && e.head === d.head);
function resweepOf(c, s, parentFile) {
	const parent = s.log.filter((e) => e.kind === 'decision' && e.contract === parentFile).pop();
	if (!parent) return { why: [`no decision for the first sweep (${parentFile}): run approve.mjs on it first`] };
	const why = [];
	if (!cleared(s, parent)) why.push('the first sweep was not cleared: neither approved nor the owner\'s yes');
	if (parent.resweepOf) why.push('the first contract is itself a re-sweep: no third pass');
	else if (s.log.some((e) => e.kind === 'decision' && e.resweepOf === parent.time && cleared(s, e))) why.push('this sweep already had its one re-sweep: no third pass');
	let raw = null;
	try { raw = fs.readFileSync(parentFile, 'utf8'); } catch { /* moved or deleted */ }
	if (raw === null || sha(raw) !== parent.hash) why.push('the first contract changed or moved since it was cleared');
	let first = {};
	try { first = JSON.parse(raw); } catch { /* reported above */ }
	if (!s.log.some((e) => e.kind === 'outcome' && e.decisionAt === parent.time)) why.push(`log the first sweep's outcome first (${parentFile})`);
	const tier = String(c.tier || '').toLowerCase();
	if (tier !== String(parent.tier || '').toLowerCase()) why.push(`the re-sweep's tier "${c.tier}" is not its first sweep's "${parent.tier}"`);
	else if (tier !== 'feature' && !OWNER_TIERS.includes(tier)) why.push(`a ${tier} sweep has no re-sweep: its fix check is a contract of its own`);
	if (!parent.head || git('merge-base', '--is-ancestor', parent.head, 'HEAD').status !== 0) {
		why.push(`the first sweep's HEAD ${parent.head} is not an ancestor of this HEAD: the history under it changed`);
		return { why, parent };
	}
	const facts = diffFacts(parent.head);
	const files = facts ? facts.files.filter((f) => !f.startsWith(facts.folder)) : [];
	// A context entry names a file by its path (a trailing :line or note allowed) or a folder ending in /.
	const named = (f) => (c.roles || []).some((r) => (Array.isArray(r.context) ? r.context : []).some((x) => {
		const p = String(x).trim().split(/\s/)[0].replace(/[:#].*$/, '').replace(/^\.\//, '');
		return p === f || (p.endsWith('/') && f.startsWith(p));
	}));
	for (const f of files) if (!named(f)) why.push(`${f} changed since the first sweep and no role names it in its context`);
	const floor = (Array.isArray(first.modifiers) ? first.modifiers : []).includes('security-sensitive') ? { security: 1 } : {};
	return { why, parent, facts, floor, files: files.length };
}

const budgetOf = (c) => (c.roles || []).reduce((t, r) => t + (typeof r.budget === 'number' && r.budget > 0 ? r.budget : 0), 0);

function decide() {
	const raw = fs.readFileSync(contractFile, 'utf8');
	const c = JSON.parse(raw);
	const s = state();
	const parentFile = opt('--resweep') && path.resolve(opt('--resweep'));
	const rs = parentFile ? resweepOf(c, s, parentFile) : null;
	const facts = (rs && rs.facts) || diffFacts();
	const { why, need } = check(c, facts, rs && rs.floor);
	if (rs) why.push(...rs.why);
	const open = s.log.filter((e) => e.kind === 'decision' && e.decision === 'approved').pop();
	const reported = open && s.log.some((e) => e.kind === 'outcome' && e.decisionAt === open.time);
	if (s.paused) why.unshift(`auto-approval is paused: ${s.paused}`);
	else if (s.approvedSinceReview >= s.reviewEvery) {
		const reason = `trial review due: ${s.reviewEvery} auto-approvals since the last review`;
		write({ kind: 'pause', reason });
		why.unshift(reason);
	} else if (open && !reported) why.unshift(`log the outcome of the last approved sweep first (${open.contract})`);
	const entry = { kind: 'decision', contract: contractFile, hash: sha(raw), tier: c.tier, agents: (c.roles || []).length, budget: budgetOf(c), decision: why.length ? 'owner' : 'approved', reasons: why, base: facts && facts.base, head: git('rev-parse', '--short', 'HEAD').stdout.trim() || null, ...(rs && rs.parent ? { resweepOf: rs.parent.time, parent: parentFile } : {}) };
	write(entry);
	if (why.length) {
		console.log('ASK THE OWNER - this Swarm Contract is outside the approved rules (rule:sweep-auto-approval):');
		for (const w of why) console.log(`    ${w}`);
		const now = state();
		if (now.paused) for (const l of resumeHelp(now)) console.log(l);
		return 1;
	}
	console.log(`APPROVED - ${c.tier} sweep, ${entry.agents} agents, budget ${entry.budget}, inside the rules. Logged to ${LOG}.`);
	console.log(notice(c, need));
	if (rs) console.log(`    Re-sweep of ${path.basename(parentFile)}: ${rs.files} changed file(s), each named by a role`);
	return 0;
}

// The owner's start notice, written from the checked contract so it carries no hand count. Post it as is.
function notice(c, need) {
	const roles = c.roles || [];
	const n = (x) => x.toLocaleString('en-US');
	const kinds = {};
	for (const r of roles) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
	return [
		'Start notice for the owner (checked by approve.mjs; post it as is):',
		`    ${c.tier} sweep, ${roles.length} roles: ${Object.entries(kinds).map(([k, v]) => `${k} x${v}`).join(', ')}`,
		...roles.map((r, i) => `    ${i + 1}. ${r.role || r.kind} (${r.kind}, ${r.model || 'the reviewer default'}), budget ${n(r.budget)}`),
		`    Budget: ${n(budgetOf(c))} of the ${n(caps(String(c.tier).toLowerCase()).maxTotalBudget)} cap`,
		`    Floor met: ${Object.entries(need).map(([k, v]) => `${k} ${kinds[k] || 0} of ${v} needed`).join(', ') || 'none for this tier'}`,
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

function outcome() {
	const nums = {};
	for (const k of ['tokens', 'findings', 'real', 'duplicates']) {
		const v = Number(opt(`--${k}`));
		if (!Number.isFinite(v) || v < 0) { console.log(`--${k} needs a number of 0 or more; nothing logged.`); return 1; }
		nums[k] = v;
	}
	// The decision is found by the contract's path, so an edit after approval still finds it.
	// An owner-decided sweep logs its outcome too, so the trial review sees every sweep.
	const decision = state().log.filter((e) => e.kind === 'decision' && e.contract === contractFile).pop();
	if (!decision) { console.log(`No decision for ${contractFile}; run approve.mjs on it first. Nothing logged.`); return 1; }
	// Real findings from roles on the mid model, for the reviewer model trial; optional.
	if (opt('--real-mid') !== undefined) {
		const v = Number(opt('--real-mid'));
		if (!Number.isFinite(v) || v < 0 || v > nums.real) { console.log('--real-mid needs a number from 0 to --real; nothing logged.'); return 1; }
		nums.realMid = v;
	}
	write({ kind: 'outcome', contract: contractFile, decisionAt: decision.time, budget: decision.budget, ...nums, ...(decision.resweepOf ? { resweepOf: decision.resweepOf } : {}) });
	const trips = [];
	if (decision.budget && nums.tokens >= OVERRUN * decision.budget) trips.push(`tokens ${nums.tokens} ran ${Math.round((nums.tokens / decision.budget - 1) * 100)}% over the budget of ${decision.budget}`);
	if (nums.findings > 0 && nums.duplicates * 3 >= nums.findings) trips.push(`${nums.duplicates} of ${nums.findings} findings repeated between roles`);
	for (const t of trips) write({ kind: 'pause', reason: t });
	console.log(trips.length ? `Outcome logged; auto-approval paused: ${trips.join('; ')}` : 'Outcome logged.');
	return 0;
}

function summary() {
	const s = state();
	const d = s.log.filter((e) => e.kind === 'decision');
	const o = s.log.filter((e) => e.kind === 'outcome');
	const sum = (k) => o.reduce((t, e) => t + (Number(e[k]) || 0), 0);
	console.log(`approved: ${d.filter((e) => e.decision === 'approved').length}, sent to the owner: ${d.filter((e) => e.decision === 'owner').length}, re-sweeps: ${d.filter((e) => e.resweepOf && cleared(s, e)).length}`);
	console.log(`outcomes: ${o.length}; tokens / budget: ${sum('budget') ? (sum('tokens') / sum('budget')).toFixed(2) : 'n/a'}; real findings: ${sum('real')} of ${sum('findings')} (from mid-model roles: ${sum('realMid')}); repeated: ${sum('duplicates')}`);
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
		write({ kind: 'pause', reason: `a bug escaped a passed sweep: ${opt('--escape')}` });
		console.log('Escape logged; auto-approval paused for the owner.');
		return 0;
	}
	if (has('--owner-yes')) return ownerYes();
	if (has('--outcome')) return outcome();
	return decide();
}

process.exitCode = main();
