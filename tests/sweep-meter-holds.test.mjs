// The sweep meter (build 22): the price table, the ceiling lines in a reviewer's brief and the split slices. Each case
// is a way a reviewer ran unmetered, unstartable or unread. prices.cjs and the dollar ceilings are new on this branch,
// so a test that needs them asserts they are there before it uses them.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { FIX_EXIT, approvalLog, approveIn, approveRun, askContract, commitAll, featureContract, g, ownerTaps, read, runHook, sweepGuard, sweepRepo, tapEnv } from './kit-helpers.mjs';

kitTemp.sessionRoot();
const require = createRequire(import.meta.url);

// why: catches an unknown model metered cheaper than a known one, so a dollar ceiling lets its run go on
test('an unknown model id is priced at least as dear as every known model, in every usage kind', () => {
	let prices;
	assert.doesNotThrow(() => { prices = require('../user/kit-hooks/prices.cjs'); }, 'user/kit-hooks/prices.cjs loads');
	const KINDS = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'];
	for (const kind of KINDS) {
		const unknown = prices.dollars({ [kind]: 1e6 }, 'claude-mystery-9');
		for (const key of Object.keys(prices.PRICE)) {
			const known = prices.dollars({ [kind]: 1e6 }, key);
			assert.ok(unknown >= known, `${kind}: an unknown model costs ${unknown} per million, ${key} costs ${known}`);
		}
	}
	const empty = prices.dollars({ cache_creation_input_tokens: 1e6 }, '');
	assert.equal(empty, prices.dollars({ cache_creation_input_tokens: 1e6 }, 'claude-mystery-9'), 'no model at all is unknown too');
});

// A brief as approve.mjs writes it: the ceiling is a line of its own, and the role's question follows on one line.
const briefOf = (hash, calls, ceilingLines, question) => ['Project rules: read the rules block.', '', `Sweep: ${hash} role 1`, `Call cap: ${calls}. A call is one message.`, ...ceilingLines, '', 'Role: security reviewer (security)', `Question: ${question}`, 'Change no file in the repository.', ''].join('\n');
const QUOTING = 'Does a brief that quotes "Token ceiling: 5" and "Dollar ceiling: $9.99" in its question still start?';

// why: catches a brief unstartable because its question quotes a ceiling line (the sweep guard counted every mention)
test('the sweep guard starts a brief whose question quotes a ceiling, and still refuses two real ceiling lines', () => {
	const c = featureContract();
	c.roles[0].question = QUOTING;
	const r = approveRun(c);
	assert.equal(r.status, 0, r.stdout);
	const e = approvalLog(r.dir).pop();
	const run = (lines) => sweepGuard(r.dir, { raw: true, noCeiling: true, tool_input: { subagent_type: 'reviewer', prompt: briefOf(e.hash, e.calls[0], lines, QUOTING) } });
	const two = run([`Token ceiling: ${e.ceilings[0]}`, 'Token ceiling: 99999999']);
	assert.equal(two.permissionDecision, 'deny', 'two ceiling lines');
	assert.match(two.permissionDecisionReason, /Token ceiling: <n>/);
	assert.equal(run([`Token ceiling: ${e.ceilings[0]}`, 'Dollar ceiling: $999.00']).permissionDecision, 'deny', 'a dollar line beside the token one');
	assert.equal(run([]).permissionDecision, 'deny', 'no ceiling line at all');
	const ok = run([`Token ceiling: ${e.ceilings[0]}`]);
	assert.equal(ok.permissionDecision, 'allow', ok.permissionDecisionReason);
});

// A reviewer transcript whose first message is the brief, as the call-cap hook reads it.
function capRun(content, { calls = 3 } = {}) {
	const dir = kitTemp.makeTemp('quote-');
	const session = path.join(dir, 'session-1');
	fs.mkdirSync(path.join(session, 'subagents'), { recursive: true });
	const lines = [{ message: { role: 'user', content } }];
	for (let i = 0; i < calls; i++) lines.push({ message: { role: 'assistant', id: `m${i}`, usage: { input_tokens: 0, cache_read_input_tokens: 30000, cache_creation_input_tokens: 0, output_tokens: 0 } } });
	fs.writeFileSync(path.join(session, 'subagents', 'agent-r1.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
	const r = runHook('user/kit-hooks/call-cap.cjs', { hook_event_name: 'PreToolUse', transcript_path: `${session}.jsonl`, agent_id: 'r1', agent_type: 'reviewer', tool_name: 'Read', tool_input: { file_path: 'x', limit: 5 } });
	return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : { permissionDecision: 'allow' };
}

// why: catches every call of a reviewer refused because its question quotes a ceiling (the hook counted over the brief's JSON)
test('the call-cap hook meters a brief whose question quotes a ceiling, and refuses two real ceiling lines', () => {
	const real = (...lines) => briefOf('0123456789abcdef', 40, lines, QUOTING);
	const quoted = capRun(real('Token ceiling: 200000'));
	assert.equal(quoted.permissionDecision, 'allow', quoted.permissionDecisionReason);
	const asBlocks = capRun([{ type: 'text', text: real('Token ceiling: 200000') }]);
	assert.equal(asBlocks.permissionDecision, 'allow', 'a brief sent as content blocks reads the same');
	const metered = capRun(real('Token ceiling: 100000'));
	assert.equal(metered.permissionDecision, 'deny', 'the real line is still the ceiling: 90,000 spent of 100,000');
	assert.match(metered.permissionDecisionReason, /token ceiling reached/i);
	for (const lines of [['Token ceiling: 200000', 'Token ceiling: 99999999'], ['Token ceiling: 200000', 'Dollar ceiling: $999.00']]) {
		const two = capRun(real(...lines));
		assert.equal(two.permissionDecision, 'deny', lines.join(' + '));
		assert.match(two.permissionDecisionReason, /more than one ceiling line/);
	}
});

// why: catches a fail-open log that names a Dollar ceiling when the brief may carry either kind
test('the call-cap hook names a missing ceiling of either kind when it lets a call through', () => {
	const repo = kitTemp.makeTemp('open-');
	spawnSync('git', ['init', '-q', '-b', 'main', repo]);
	fs.mkdirSync(path.join(repo, 't', 'subagents'), { recursive: true });
	fs.writeFileSync(path.join(repo, 't', 'subagents', 'agent-r8.jsonl'), `${JSON.stringify({ message: { role: 'user', content: 'Sweep: abc role 1\nCall cap: 15' } })}\n`);
	const r = runHook('user/kit-hooks/call-cap.cjs', { hook_event_name: 'PreToolUse', cwd: repo, transcript_path: path.join(repo, 't.jsonl'), agent_id: 'r8', agent_type: 'reviewer', tool_name: 'Read', tool_input: { file_path: 'x', limit: 5 } });
	assert.equal(r.stdout, '');
	assert.match(fs.readFileSync(path.join(repo, '.git', 'kit-guard-open.log'), 'utf8'), /"cause":"no ceiling \(Dollar or Token\) line in the brief"/);
});

const bigFile = (n) => Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n';
const briefs = (dir) => fs.readdirSync(path.join(dir, 'sweeps')).filter((f) => /-brief-\d+\.md$/.test(f)).sort((a, b) => parseInt(a.match(/-brief-(\d+)/)[1], 10) - parseInt(b.match(/-brief-(\d+)/)[1], 10)).map((f) => read(path.join(dir, 'sweeps', f)));
const gitLine = (brief) => brief.split('\n').find((l) => l.startsWith('Repository:'));

// A file name git would print C-quoted (a non-ASCII byte) and one a shell would expand ($) must each reach a slice's
// diff command: a file left out is a file no reviewer of that role reads.
// why: catches a changed file with a $ or a non-ASCII byte in its path that no split slice's git diff line names
test('every changed file reaches exactly one slice of a split role, whatever its name holds', () => {
	const CAFE = 'docs/café.md';
	const ID = 'src/$id.tsx';
	const dir = sweepRepo({ [CAFE]: bigFile(300), [ID]: bigFile(300), 'src/b.ts': bigFile(300) });
	const contract = featureContract();
	contract.roles[3].context = [CAFE, ID, 'src/b.ts'];
	contract.roles[4].context = [CAFE, ID, 'src/b.ts'];
	const r = approveRun(contract, dir);
	assert.equal(r.status, 0, r.stdout);
	assert.equal(approvalLog(dir).pop().agents, 7, 'test value and the novel lens are each split in two');
	const all = briefs(dir);
	assert.equal(all.length, 7);
	for (const [first, second] of [[3, 4], [5, 6]]) {
		for (const name of [CAFE, ID, 'src/b.ts']) {
			const named = [all[first], all[second]].filter((b) => gitLine(b).includes(name));
			assert.equal(named.length, 1, `${name} is named by exactly one of briefs ${first + 1} and ${second + 1}`);
		}
	}
	// A $ is shell syntax even inside double quotes, so that name is single-quoted.
	assert.match(all.map(gitLine).join('\n'), /'src\/\$id\.tsx'/);
});

// A name no quoting carries through both bash and PowerShell cannot be put in a brief, and a slice without it would
// leave the file unread: the contract is the lead's to fix, and no reviewer starts.
// why: catches a changed file dropped from every slice because its name cannot be quoted, with the sweep approved anyway
test('a split role with a changed file whose name no shell quoting carries is sent back, not approved', () => {
	const ODD = "src/it's$x.ts";
	const dir = sweepRepo({ 'src/a.ts': bigFile(300), [ODD]: bigFile(300), 'src/b.ts': bigFile(300) });
	const contract = featureContract();
	contract.roles[3].context = ['src/a.ts', ODD, 'src/b.ts'];
	const r = approveRun(contract, dir);
	assert.equal(r.status, FIX_EXIT, r.stdout);
	assert.match(r.stdout, /FIX THE CONTRACT/);
	assert.match(r.stdout, /cannot be named safely in a reviewer's brief/);
	assert.equal(approvalLog(dir).pop().decision, 'fix');
});

// PowerShell reads U+2018 to U+201F as quote marks, so a file named with one could end the quoted path in a brief's git
// line and run what follows it: such a name is refused like any other no quoting carries.
// why: catches a slice file named with a Unicode quote that breaks out of the brief's quoted git line in PowerShell
test('a changed file whose name holds a Unicode quote is sent back, not approved', () => {
	for (const quote of ['’', '“', '‛']) {
		const odd = `src/it${quote}s.ts`;
		const dir = sweepRepo({ 'src/a.ts': bigFile(300), [odd]: bigFile(300), 'src/b.ts': bigFile(300) });
		const contract = featureContract();
		contract.roles[3].context = ['src/a.ts', odd, 'src/b.ts'];
		const r = approveRun(contract, dir);
		assert.equal(r.status, FIX_EXIT, `U+${quote.codePointAt(0).toString(16)}: ${r.stdout}`);
		assert.match(r.stdout, /cannot be named safely in a reviewer's brief/);
	}
});

// An ask over the named files, each 300 lines: the first in one commit and the rest in the next, so main can move up
// to the first and drop it from the diff. The fix role reads them all and is split into slices.
function askSplit(names, agents) {
	const dir = sweepRepo({ [names[0]]: bigFile(300) });
	for (const n of names.slice(1)) fs.writeFileSync(path.join(dir, n), bigFile(300));
	commitAll(dir, 'more', true);
	const contract = askContract();
	contract.roles[0].context = names;
	const r = approveRun(contract, dir);
	assert.equal(r.status, 1, r.stdout);
	assert.equal(approvalLog(dir).pop().agents, agents);
	const cfg = kitTemp.makeTemp('cfg-');
	ownerTaps(cfg, dir, `sweep yes ${r.stdout.match(/`sweep yes ([0-9a-f]{6})`/)[1]}`);
	return { r, dir, cfg };
}

// The owner's yes re-reads the diff to write the briefs. If the base moved since the ask, the split is not the one the
// owner was asked about, and a brief past the logged ceilings would carry "Dollar ceiling: $NaN".
// why: catches an owner's yes that writes briefs from a different split than the ask logged
test('the owner\'s yes refuses when the diff splits differently than it did at the ask', () => {
	const ask = () => askSplit(['src/a.ts', 'src/b.ts', 'src/c.ts'], 4);
	const same = ask();
	const ok = approveIn(same.dir, [same.r.f, '--owner-yes'], tapEnv(same.cfg));
	assert.equal(ok.status, 0, ok.stdout);
	assert.equal(briefs(same.dir).length, 4);
	const moved = ask();
	// main moves up to the first feature commit: the diff is now two files, which is one slice.
	assert.equal(g(moved.dir, 'branch', '-f', 'main', 'HEAD~1').status, 0);
	const refused = approveIn(moved.dir, [moved.r.f, '--owner-yes'], tapEnv(moved.cfg));
	assert.notEqual(refused.status, 0, refused.stdout);
	assert.match(refused.stdout, /splits differently[\s\S]*run approve\.mjs again/i);
	assert.equal(approvalLog(moved.dir).some((e) => e.kind === 'owner-yes'), false, 'nothing is logged');
});

// The same reviewer count and role map can hide other slices: a file dropped from one and another in its place. The
// ask's slice files are logged, and the owner's yes needs the same ones.
// why: catches an owner's yes that starts reviewers on slices whose files are not the ones the owner was asked about
test('the owner\'s yes refuses when the slice files differ though the reviewer count and role map match', () => {
	const moved = askSplit(['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'], 4);
	const decision = approvalLog(moved.dir).pop();
	// Main moves up to the first feature commit: b, c and d are left, split as [b, c] and [d] - still two slices.
	assert.equal(g(moved.dir, 'branch', '-f', 'main', 'HEAD~1').status, 0);
	const refused = approveIn(moved.dir, [moved.r.f, '--owner-yes'], tapEnv(moved.cfg));
	assert.deepEqual(decision.roleOf, [0, 0, 1, 2], 'the role map is the same');
	assert.notEqual(refused.status, 0, refused.stdout);
	assert.match(refused.stdout, /different slice files[\s\S]*run approve\.mjs again/i);
	assert.equal(approvalLog(moved.dir).some((e) => e.kind === 'owner-yes'), false, 'nothing is logged');
});
