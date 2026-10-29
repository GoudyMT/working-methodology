#!/usr/bin/env node
// Sweep auto-approval (rule:sweep-auto-approval). Approves a Swarm Contract (rule:swarm-contract) that stays inside
// its tier's rules, so a routine sweep need not wait for the owner, and hands back to the owner on anything else.
// It is a script on purpose: the same contract always gets the same answer, at no token cost.
//
// The contract is a JSON file written next to the table the owner would have read:
//   { "tier": "feature" | "fix" | "triage" | "first push" | "launch gate",
//     "modifiers": ["security-sensitive" | "new-dependency" | "public-text" | "user-data"],
//     "testsChanged": true,
//     "roles": [{ "role", "kind", "question", "context": [...], "finding", "budget" }] }
//
// Every decision and outcome goes to the log, one JSON line each, so the trial can be watched. The script pauses
// itself, and only the owner resumes it (KIT_OWNER_RESUME=1), after: tokens a quarter or more over budget, a third
// or more of the findings repeated between roles, a bug that escaped a sweep it passed, or every 10 auto-approvals.
//
// Usage:
//   node approve.mjs <contract.json> [--log <file>]                     decide (exit 0 approved, 1 ask the owner)
//   node approve.mjs <contract.json> --outcome --tokens N --findings N --real N --duplicates N [--log <file>]
//   node approve.mjs <contract.json> --escape "<what slipped through>" [--log <file>]
//   node approve.mjs --summary [--log <file>]
//   KIT_OWNER_RESUME=1 node approve.mjs --resume [--log <file>]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

// Starting caps, to be set from the trial log once real sweeps are measured; a project overrides them in
// .kit/sweep-approval.json ({ "caps": { "<tier>": { ... } } }).
const CAPS = {
	feature: { maxAgents: 10, maxRoleBudget: 150000, maxTotalBudget: 1000000 },
	fix: { maxAgents: 4, maxRoleBudget: 100000, maxTotalBudget: 300000 },
	triage: { maxAgents: 1, maxRoleBudget: 40000, maxTotalBudget: 40000 },
};
const OWNER_TIERS = ['first push', 'launch gate'];
const KINDS = ['security', 'test-value', 'novel-lens', 'fix-root', 'blast-radius', 'modelled-on', 'supply-chain', 'privacy', 'content', 'data-loss', 'dimension', 'triage'];
// What each tier and modifier needs at least, by role kind.
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
const OVERRUN = 1.25;
const TRIAL_EVERY = 10;
// Two questions sharing this much of their words are one question asked twice (rule:swarm-contract, no clones).
const CLONE = 0.6;

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const has = (name) => args.includes(name);
const contractFile = args[0] && !args[0].startsWith('--') ? args[0] : null;
const logFile = opt('--log') || path.join(contractFile ? path.dirname(contractFile) : '.', 'sweep-approvals.jsonl');

const readLog = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const write = (entry) => fs.appendFileSync(logFile, JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n');
const words = (s) => new Set(String(s || '').toLowerCase().match(/[a-z0-9]+/g) || []);
const overlap = (a, b) => { const x = words(a), y = words(b); const both = [...x].filter((w) => y.has(w)).length; return both / (new Set([...x, ...y]).size || 1); };

function state(log) {
	const last = log.filter((e) => e.kind === 'pause' || e.kind === 'resume').pop();
	const since = log.slice(last && last.kind === 'resume' ? log.lastIndexOf(last) : 0);
	return { paused: last && last.kind === 'pause' ? last.reason : null, approvedSinceReview: since.filter((e) => e.kind === 'decision' && e.decision === 'approved').length };
}

function caps(tier) {
	const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim();
	const f = top && path.join(top, '.kit', 'sweep-approval.json');
	const own = f && fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')).caps || {})[tier] : null;
	return { ...CAPS[tier], ...own };
}

// Every reason this contract needs the owner; none means it is inside the rules.
function check(c) {
	const tier = String(c.tier || '').toLowerCase();
	if (OWNER_TIERS.includes(tier)) return [`the ${tier} tier is always the owner's call`];
	if (!CAPS[tier]) return [`unknown tier "${c.tier}"`];
	const roles = Array.isArray(c.roles) ? c.roles : [];
	const why = [];
	const cap = caps(tier);
	if (!roles.length) why.push('no roles');
	if (roles.length > cap.maxAgents) why.push(`${roles.length} agents, over the ${tier} cap of ${cap.maxAgents}`);
	const need = { ...NEEDS[tier] };
	if (tier === 'fix' && c.testsChanged) need['test-value'] = 1;
	for (const m of c.modifiers || []) {
		if (!MODIFIER_NEEDS[m]) { why.push(`unknown modifier "${m}"`); continue; }
		for (const [k, n] of Object.entries(MODIFIER_NEEDS[m])) need[k] = Math.max(need[k] || 0, n);
	}
	const count = (k) => roles.filter((r) => r.kind === k).length;
	for (const [k, n] of Object.entries(need)) if (count(k) < n) why.push(`needs ${n} ${k} role(s), has ${count(k)}`);
	let total = 0;
	roles.forEach((r, i) => {
		const name = `role ${i + 1} (${r.role || r.kind})`;
		if (!KINDS.includes(r.kind)) why.push(`${name}: unknown kind "${r.kind}"`);
		if (!String(r.question || '').trim()) why.push(`${name}: no question`);
		if (!Array.isArray(r.context) || !r.context.length) why.push(`${name}: no context (the files, rule and spec its lens needs)`);
		if (!String(r.finding || '').trim()) why.push(`${name}: no finding shape`);
		const b = Number(r.budget);
		if (!(b > 0)) why.push(`${name}: no token budget`);
		else if (b > cap.maxRoleBudget) why.push(`${name}: budget ${b} over the per-role cap of ${cap.maxRoleBudget}`);
		total += b > 0 ? b : 0;
	});
	if (total > cap.maxTotalBudget) why.push(`total budget ${total} over the ${tier} cap of ${cap.maxTotalBudget}`);
	for (let i = 0; i < roles.length; i++) for (let j = i + 1; j < roles.length; j++) {
		if (overlap(roles[i].question, roles[j].question) >= CLONE) why.push(`roles ${i + 1} and ${j + 1} ask the same question (a clone)`);
	}
	return why;
}

function decide() {
	const raw = fs.readFileSync(contractFile, 'utf8');
	const c = JSON.parse(raw);
	const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12);
	const log = readLog();
	const s = state(log);
	const why = check(c);
	if (s.paused) why.unshift(`auto-approval is paused: ${s.paused}`);
	else if (s.approvedSinceReview >= TRIAL_EVERY) why.unshift(`trial review due: ${TRIAL_EVERY} auto-approvals since the last review`);
	const budget = (c.roles || []).reduce((t, r) => t + (Number(r.budget) > 0 ? Number(r.budget) : 0), 0);
	const entry = { kind: 'decision', contract: contractFile, hash, tier: c.tier, agents: (c.roles || []).length, budget, decision: why.length ? 'owner' : 'approved', reasons: why };
	write(entry);
	if (why.length) {
		console.log('ASK THE OWNER - this Swarm Contract is outside the approved rules (rule:sweep-auto-approval):');
		for (const w of why) console.log(`    ${w}`);
		return 1;
	}
	console.log(`APPROVED - ${c.tier} sweep, ${entry.agents} agents, budget ${budget}, inside the rules. Logged to ${logFile}.`);
	return 0;
}

function outcome() {
	const hash = crypto.createHash('sha256').update(fs.readFileSync(contractFile, 'utf8')).digest('hex').slice(0, 12);
	const decision = readLog().filter((e) => e.kind === 'decision' && e.hash === hash).pop();
	const o = { kind: 'outcome', hash, tokens: Number(opt('--tokens')), findings: Number(opt('--findings')), real: Number(opt('--real')), duplicates: Number(opt('--duplicates')), budget: decision ? decision.budget : null };
	write(o);
	const trips = [];
	if (o.budget && o.tokens >= OVERRUN * o.budget) trips.push(`tokens ${o.tokens} ran ${Math.round((o.tokens / o.budget - 1) * 100)}% over the budget of ${o.budget}`);
	if (o.findings > 0 && o.duplicates * 3 >= o.findings) trips.push(`${o.duplicates} of ${o.findings} findings repeated between roles`);
	for (const t of trips) write({ kind: 'pause', reason: t });
	console.log(trips.length ? `Outcome logged; auto-approval paused: ${trips.join('; ')}` : 'Outcome logged.');
	return 0;
}

function summary() {
	const log = readLog();
	const d = log.filter((e) => e.kind === 'decision');
	const o = log.filter((e) => e.kind === 'outcome');
	const s = state(log);
	const sum = (k) => o.reduce((t, e) => t + (Number(e[k]) || 0), 0);
	console.log(`approved: ${d.filter((e) => e.decision === 'approved').length}, sent to the owner: ${d.filter((e) => e.decision === 'owner').length}`);
	console.log(`outcomes: ${o.length}; tokens / budget: ${sum('budget') ? (sum('tokens') / sum('budget')).toFixed(2) : 'n/a'}; real findings: ${sum('real')} of ${sum('findings')}; repeated: ${sum('duplicates')}`);
	console.log(`escapes: ${log.filter((e) => e.kind === 'escape').length}; state: ${s.paused ? `paused (${s.paused})` : `running, ${s.approvedSinceReview} of ${TRIAL_EVERY} since the last review`}`);
	return 0;
}

function main() {
	if (has('--summary')) return summary();
	if (has('--resume')) {
		if (process.env.KIT_OWNER_RESUME !== '1') { console.log('Only the owner resumes auto-approval: run with KIT_OWNER_RESUME=1 after reviewing the log.'); return 1; }
		write({ kind: 'resume' });
		console.log('Auto-approval resumed; the next review comes after 10 more.');
		return 0;
	}
	if (!contractFile) { console.log('Usage: node approve.mjs <contract.json> [--outcome ... | --escape "<note>"] [--log <file>]'); return 2; }
	if (has('--escape')) { write({ kind: 'escape', note: opt('--escape') }); write({ kind: 'pause', reason: `a bug escaped a passed sweep: ${opt('--escape')}` }); console.log('Escape logged; auto-approval paused for the owner.'); return 0; }
	if (has('--outcome')) return outcome();
	return decide();
}

process.exitCode = main();
