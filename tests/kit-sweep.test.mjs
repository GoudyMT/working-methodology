// Tests for sweep approval, tiers, the size band, the hand-back canary and the sweep guard: moved word for word from tests/kit.test.mjs (T10, build 18).

import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { install, foldBack, bump, scrub, snapshot, restore, status as kitStatus, mainProtection, sessionStartReport as kitSessionStart, preCompactReport, promptCheckReport, vaultBackup, projectSlug, newerReleases, lsRemoteCall, tagsOf, render, sourceHooks, measure, measureReal, headings, ledger, build, parseModule, findRules, guardDir, scratch as kitScratch } from '../scripts/kit.mjs';
import { FAKE_PHRASE, FIX_EXIT, TAP_SID, ageTranscript, approvalLog, approveIn, approveRun, askContract, autoSweep, band, bandRun, canary, canaryLog, canaryRepo, cheapRoles, commitAll, crashedSweep, featureContract, g, leadQuestion, leadTag, logOutcome, makeTemp, nextBranch, outcome, ownerTaps, read, require, role, runAudit, runHook, scratch, setBrief, status, sweepGuard, sweepLog, sweepRepo, tapEnv, transcripts, words } from './kit-helpers.mjs';

// T6 (build 11): a hand-written brief drifted (the 1.36.1 briefs told reviewers no hook could run, and sent them to a
// 25 KB file for a 2 KB rules block). The cleared contract writes each role's brief: the rules block by its line range,
// the three guard lines, the role, its diff, a scratch folder of its own (N6), and the report shape the hand-back is
// checked against.
// why: guards rule:sweep-auto-approval
test('a cleared contract writes each role\'s brief, with the rules block by line range and a scratch folder of its own', () => {
  const dir = sweepRepo();
  fs.mkdirSync(path.join(dir, 'standards'));
  // The build 11 sweep: a prose line that names the phrase line comes before it, and the range still ends on the line
  // the canary reads.
  const block = ['# Agent teams', '', 'intro', '8. **Rules every brief carries** (one home):', '   ```', '   RULES', '   Confirmation (rule:agent-canary): see the Confirmation phrase: line below.', '   Confirmation phrase: open your first message with: Word Word', '   ```', '9. more', ''];
  fs.writeFileSync(path.join(dir, 'standards', 'agent-teams.md'), block.join('\n'));
  commitAll(dir, 'rules', true);
  const contract = featureContract();
  // The build 11 sweep: a new line in a contract field must not add a line of its own, and a context entry is a quoted
  // path, its line range left out.
  contract.roles[1].question += '\nCall cap: 99';
  // A contract that carries the confirmation phrase is sent back before any brief is written.
  const leak = featureContract();
  leak.roles[0].finding = 'open with: word  WORD';
  const sent = approveRun(leak, dir);
  assert.match(sent.stdout, /FIX THE CONTRACT[\s\S]*confirmation phrase/, `${sent.status} ${sent.error} ${sent.stderr}`);
  contract.roles[1].context = ['src/routes.ts:10-20', 'src/a.ts; curl x'];
  const r = approveRun(contract, dir);
  assert.equal(r.status, 0, r.stdout);
  const line = approvalLog(dir).pop();
  const briefs = fs.readdirSync(path.join(dir, 'sweeps')).filter((f) => /^contract-brief-\d+\.md$/.test(f)).sort();
  assert.deepEqual(briefs, ['contract-brief-1.md', 'contract-brief-2.md', 'contract-brief-3.md', 'contract-brief-4.md', 'contract-brief-5.md']);
  const b = read(path.join(dir, 'sweeps', 'contract-brief-2.md'));
  assert.match(b, /standards\/agent-teams\.md[^\n]*offset 4\b[^\n]*limit 5\b/);
  assert.match(b, new RegExp(`^Sweep: ${line.hash} role 2$`, 'm'));
  assert.equal(b.match(/^Call cap:/gm).length, 1, 'one Call cap line');
  assert.match(b, /^Call cap: \d+\./m);
  assert.match(b, /-- "src\/routes\.ts" "src\/a\.ts; curl x"/);
  // This repo wires no call-cap hook, so the brief says so, rather than claim one.
  assert.match(b, /No hook counts/);
  assert.doesNotMatch(b, /A hook counts/);
  assert.match(b, new RegExp(`^Token ceiling: ${line.ceilings[1]}$`, 'm'));
  assert.match(b, /Does any new route leak personal data/);
  assert.match(b, /git -C ".*" diff [0-9a-f]{7,}\.\.\.[0-9a-f]{7,} -- "src\/routes\.ts"/);
  assert.match(b, /Scratch: .*role-2/);
  assert.doesNotMatch(b, /role-1\b/, 'another role\'s folder');
  assert.match(b, /^ROLE: /m);
  assert.match(b, /Not checked:/);
  assert.doesNotMatch(b, /Word Word/, 'the brief never carries the phrase');
  assert.match(r.stdout, /contract-brief-1\.md/);
});

// The build 11 sweep: the canary reads the phrase from the main checkout, so a brief written in a worktree sends the
// reviewer to the main checkout's rules file too, by its full path (untracked notes are not in the worktree).
// why: guards rule:agent-canary
test('a brief written in a worktree names the main checkout\'s rules file', () => {
  const dir = sweepRepo();
  fs.mkdirSync(path.join(dir, 'standards'));
  fs.writeFileSync(path.join(dir, 'standards', 'agent-teams.md'), ['8. **Rules every brief carries**', '   Confirmation phrase: open with: Word Word', ''].join('\n'));
  fs.appendFileSync(path.join(dir, '.git', 'info', 'exclude'), 'standards/\n');
  const wt = path.join(path.dirname(dir), `${path.basename(dir)}-wt`);
  g(dir, 'worktree', 'add', '-q', wt, '-b', 'feat/wt');
  fs.mkdirSync(path.join(wt, 'sweeps'), { recursive: true });
  const r = approveRun(featureContract(), wt);
  assert.equal(r.status, 0, r.stdout);
  const b = read(path.join(wt, 'sweeps', 'contract-brief-1.md'));
  const mainFile = fs.realpathSync.native(path.join(dir, 'standards', 'agent-teams.md')).split(path.sep).join('/');
  assert.ok(b.toLowerCase().includes(`${mainFile.toLowerCase()} with the read tool at offset 1`), b.split('\n')[0]);
});

// E24 option C (the owner, 2026-11-07): a cloud thread loads no repo hooks, so no call-cap hook or sweep guard holds
// its reviewers; sweeps and installs stay on the owner's PC. Claude Code sets CLAUDE_CODE_REMOTE=true in a cloud VM.
// why: guards rule:sweep-auto-approval
test('a cloud session cannot clear a sweep or install the kit: both stay on the owner\'s PC', () => {
  const dir = sweepRepo();
  const f = path.join(dir, 'sweeps', 'contract.json');
  fs.writeFileSync(f, JSON.stringify(featureContract()));
  const r = approveIn(dir, [f], { CLAUDE_CODE_REMOTE: 'true' });
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /sweeps run on the owner's PC/);
  assert.equal(fs.existsSync(path.join(dir, '.git', 'kit-sweep-approvals.jsonl')), false, 'nothing logged');
  const home = makeTemp('home-');
  const i = spawnSync(process.execPath, [path.resolve('scripts/kit.mjs'), 'install', 'user', '--unreleased'], { encoding: 'utf8', env: { ...process.env, KIT_CLAUDE_HOME: home, CLAUDE_CODE_REMOTE: 'true' } });
  assert.equal(i.status, 1, i.stdout + i.stderr);
  assert.match(i.stderr, /installs run on the owner's PC/);
  assert.equal(fs.existsSync(path.join(home, 'kit-install.json')), false);
});

// S22-S1 (the 1.22.0 sweep): SendMessage to a finished reviewer resumes it, with no clearing, no slot and no spend
// read. A reviewer is never resumed: a new question is a new reviewer under a clearing.
// why: guards rule:sweep-auto-approval
test('the sweep guard refuses to resume a reviewer with SendMessage, and lets other agents be messaged', () => {
  const dir = makeTemp('resume-');
  const session = path.join(dir, 'session-1');
  fs.mkdirSync(path.join(session, 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(session, 'subagents', 'agent-r1.meta.json'), JSON.stringify({ agentType: 'reviewer', finished: true }));
  fs.writeFileSync(path.join(session, 'subagents', 'agent-b1.meta.json'), JSON.stringify({ agentType: 'builder', finished: true }));
  const send = (to) => { const r = runHook('user/kit-hooks/sweep-guard.cjs', { cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'SendMessage', transcript_path: `${session}.jsonl`, tool_input: { to, message: 'one more check' } }); assert.equal(r.status, 0, `the guard crashed: ${r.stderr}`); return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : { permissionDecision: 'allow' }; };
  const r = send('r1');
  assert.equal(r.permissionDecision, 'deny');
  assert.match(r.permissionDecisionReason, /never resumed/);
  assert.equal(send('b1').permissionDecision, 'allow');
  assert.equal(send('someone-else').permissionDecision, 'allow');
  // F36 (the 1.23.0 sweep): an agent whose transcript is there but whose type cannot be read may be a reviewer, so it
  // is refused; a name with no agent behind it (a teammate) is still messaged.
  fs.writeFileSync(path.join(session, 'subagents', 'agent-x1.jsonl'), '{}\n');
  fs.writeFileSync(path.join(session, 'subagents', 'agent-x1.meta.json'), '{not json');
  fs.writeFileSync(path.join(session, 'subagents', 'agent-x2.jsonl'), '{}\n');
  assert.equal(send('x1').permissionDecision, 'deny');
  assert.equal(send('x2').permissionDecision, 'deny');
  // The 1.24.0 sweep: a reviewer is also addressed by its name; a builder's name is still messaged.
  fs.writeFileSync(path.join(session, 'subagents', 'agent-r9.meta.json'), JSON.stringify({ agentType: 'reviewer', name: 'P2-supply-chain', finished: true }));
  fs.writeFileSync(path.join(session, 'subagents', 'agent-b9.meta.json'), JSON.stringify({ agentType: 'builder', name: 'unit-3', finished: true }));
  assert.equal(send('P2-supply-chain').permissionDecision, 'deny');
  assert.equal(send('unit-3').permissionDecision, 'allow');
});

// why: guards rule:sweep-tiers
test('the approval script approves a contract inside the tier rules and logs it in the repo', () => {
  const r = approveRun(featureContract());
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /APPROVED/);
  const line = approvalLog(r.dir).pop();
  assert.equal(line.decision, 'approved');
  assert.equal(line.agents, 5);
});

// why: guards rule:sweep-auto-approval
test('the approval script hands back to the owner on anything outside the rules, naming what broke', () => {
  for (const tier of ['first push', 'launch gate']) {
    const r = approveRun({ ...featureContract(), tier });
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /ASK THE OWNER[\s\S]*always the owner/);
    assert.equal(approvalLog(r.dir).pop().decision, 'owner');
  }
});

// why: guards rule:sweep-tiers
test('the diff sets the floor: a lighter tier or a left-out modifier goes to the owner', () => {
  const asFix = { tier: 'fix', modifiers: [], roles: [role('fix-root', 'Does the fix remove the root, and does it hold?'), role('blast-radius', 'Which callers and copies of this code does the change reach?')] };
  assert.match(approveRun(asFix).stdout, /added source file/i, 'a new source file is not a fix');
  const dep = sweepRepo({ 'src/sync.ts': 'x\n', 'package.json': '{"dependencies":{"left-pad":"1"}}\n' });
  assert.match(approveRun(featureContract(), dep).stdout, /supply-chain/i, 'a changed package file needs the supply-chain role');
  const triage = sweepRepo({ 'README.md': 'y\n' });
  const one = { tier: 'triage', modifiers: [], roles: [role('triage', 'Any secret or personal data in the diff?')] };
  assert.equal(approveRun(one, triage).status, 0, 'a one-line docs change is triage');
  assert.equal(approveRun({ ...one, roles: [...one.roles, role('triage', 'Is any dimension touched by it?')] }, sweepRepo({ 'README.md': 'y\n' })).status, 1, 'a triage sweep is one agent');
  const fix4 = { tier: 'fix', modifiers: [], roles: [...asFix.roles, role('test-value', 'Does each changed test guard a real use?'), role('modelled-on', 'Was the bug inherited from the code this copied?')] };
  assert.equal(approveRun(fix4, sweepRepo({ 'README.md': 'z\n' })).status, 1, 'a fix sweep is 2-3 agents');
});

// T2 (the owner 2026-11-10: "Pop-up record"): the typed codes of 1.23 are retired. An ask or a pause prints an act
// with its code; the lead quotes it in Claude Code's choice pop-up, and the owner's tap, in this session's own
// transcript, is the yes. Each refusal below is a way a tap that is not the owner's Yes to this ask could pass.
// why: guards rule:outward-acts
test('the owner\'s pop-up Yes to the ask\'s act clears an ask, and nothing else does', () => {
  const asked = () => { const r = approveRun(askContract()); assert.equal(r.status, 1, r.stdout); const m = r.stdout.match(/`sweep yes ([0-9a-f]{6})`/); assert.ok(m, r.stdout); return { ...r, code: m[1] }; };
  const yes = (r, cfg, env = {}) => approveIn(r.dir, [r.f, '--owner-yes'], { ...tapEnv(cfg), ...env });
  const r = asked();
  const cfg = makeTemp('cfg-');
  ownerTaps(cfg, r.dir, `sweep yes ${r.code}`);
  const ok = yes(r, cfg);
  assert.equal(ok.status, 0, ok.stdout);
  const line = approvalLog(r.dir).pop();
  assert.deepEqual([line.kind, line.proof], ['owner-yes', 'popup']);
  assert.match(line.tap, new RegExp(`^${TAP_SID}:toolu_`));
  // The ask's ceilings travel with the yes, so the reviewers' guard holds them to it (the 1.23.0 sweep).
  const decided = approvalLog(r.dir).filter((e) => e.kind === 'decision').pop();
  assert.ok(Array.isArray(decided.ceilings) && decided.ceilings.length > 0, 'the ask set ceilings');
  assert.deepEqual(line.ceilings, decided.ceilings);
  const refused = [
    ['no tap at all', () => {}],
    ['a No', (c, d, k) => ownerTaps(c, d, `sweep yes ${k}`, { answer: 'No' })],
    ['a Yes to another ask\'s act', (c, d) => ownerTaps(c, d, 'sweep yes 000000')],
    ['a Yes to an act that only holds this one', (c, d, k) => ownerTaps(c, d, `echo sweep yes ${k}`)],
    ['a tap from before the ask', (c, d, k) => ownerTaps(c, d, `sweep yes ${k}`, { at: '2020-01-01T00:00:00.000Z' })],
    ['a pop-up with no way to say no', (c, d, k) => ownerTaps(c, d, `sweep yes ${k}`, { labels: ['Yes', 'Yes, later'] })],
    ['an answer no person gave', (c, d, k) => ownerTaps(c, d, `sweep yes ${k}`, { source: 'classifier' })],
    ['another session\'s tap', (c, d, k) => ownerTaps(c, d, `sweep yes ${k}`, { sid: '9aaaaaaa-1bbb-2ccc-3ddd-4eeeeeeeeeee' })],
    ['a tap in another repo\'s sessions', (c, d, k) => ownerTaps(c, d, `sweep yes ${k}`, { folder: 'C--elsewhere' })],
  ];
  for (const [name, set] of refused) {
    const a = asked();
    const c = makeTemp('cfg-');
    set(c, a.dir, a.code);
    const before = sweepLog(a.dir).length;
    const out = yes(a, c);
    assert.equal(out.status, 1, `${name}: ${out.stdout}`);
    assert.match(out.stdout, /no Yes from the owner/, name);
    assert.equal(sweepLog(a.dir).length, before, `${name}: nothing logged`);
  }
  // One tap answers one ask: the same Yes cannot clear a second ask in this repo.
  assert.equal(approveIn(r.dir, [r.f, '--outcome', '--none-ran']).status, 0, 'the first ask\'s sweep is closed');
  const c2 = JSON.parse(read(r.f));
  c2.roles[0].question += ' Also the second ask.';
  fs.writeFileSync(r.f, JSON.stringify(c2));
  const again = approveIn(r.dir, [r.f]);
  const code2 = (again.stdout.match(/`sweep yes ([0-9a-f]{6})`/) || [])[1];
  assert.ok(code2 && code2 !== r.code, again.stdout);
  assert.equal(yes(r, cfg).status, 1, 'the first ask\'s Yes is not this ask\'s');
});

// why: guards rule:sweep-auto-approval
test('the owner resumes auto-approval with a pop-up Yes to the pause\'s act, after the pause', () => {
  const r = approveRun(featureContract());
  outcome(r, String(Math.ceil(537500 * 1.3)));
  const ask = approveIn(r.dir, [r.f]);
  const code = (ask.stdout.match(/`sweep resume ([0-9a-f]{6})`/) || [])[1];
  assert.ok(code, ask.stdout);
  const cfg = makeTemp('cfg-');
  const resume = () => approveIn(r.dir, ['--resume'], tapEnv(cfg));
  ownerTaps(cfg, r.dir, `sweep resume ${code}`, { at: '2020-01-01T00:00:00.000Z' });
  assert.equal(resume().status, 1, 'a tap from before the pause');
  ownerTaps(cfg, r.dir, 'sweep resume 000000');
  assert.equal(resume().status, 1, 'another pause\'s code');
  // No terminal way is left: the owner's variable from 1.23 resumes nothing.
  assert.equal(approveIn(r.dir, ['--resume'], { CLAUDE_CODE_SESSION_ID: TAP_SID, CLAUDE_CONFIG_DIR: cfg, KIT_OWNER_RESUME: '1' }).status, 1, 'the retired terminal resume');
  ownerTaps(cfg, r.dir, `sweep resume ${code}`);
  const ok = resume();
  assert.equal(ok.status, 0, ok.stdout);
  const line = approvalLog(r.dir).pop();
  assert.deepEqual([line.kind, line.proof], ['resume', 'popup']);
  assert.equal(resume().status, 1, 'nothing left to resume');
});

// K91 (build 11): the resume was refused twice on Yeses to pop-ups that named the act without backticks, and the
// refusal read as if the owner had not answered. It now says why, and the lead can check a Yes before handing over
// the command, without using it.
// why: guards rule:sweep-auto-approval
test('a Yes to an unquoted act is named in the refusal, and --tap checks a Yes without using it', () => {
  const r = approveRun(featureContract());
  outcome(r, String(Math.ceil(537500 * 1.3)));
  const code = (approveIn(r.dir, [r.f]).stdout.match(/`sweep resume ([0-9a-f]{6})`/) || [])[1];
  assert.ok(code);
  const act = `sweep resume ${code}`;
  const cfg = makeTemp('cfg-');
  const tap = () => approveIn(r.dir, ['--tap', act], tapEnv(cfg));
  const none = tap();
  assert.equal(none.status, 1);
  assert.match(none.stdout, /No Yes from the owner/);
  assert.doesNotMatch(none.stdout, /without backticks/, 'no Yes at all is not an unquoted one');
  ownerTaps(cfg, r.dir, act, { bare: true });
  const bare = approveIn(r.dir, ['--resume'], tapEnv(cfg));
  assert.equal(bare.status, 1, 'an unquoted act counts for nothing');
  assert.match(bare.stdout, /without backticks around it[^\n]*ask again with the act in backticks/);
  assert.match(tap().stdout, /without backticks/);
  ownerTaps(cfg, r.dir, act);
  const held = tap();
  assert.equal(held.status, 0, held.stdout);
  assert.match(held.stdout, /holds the owner's Yes/);
  assert.notEqual(approvalLog(r.dir).pop().kind, 'resume', 'the check logs nothing');
  assert.equal(approveIn(r.dir, ['--resume'], tapEnv(cfg)).status, 0, 'the Yes the check saw is still unused');
  const used = tap();
  assert.equal(used.status, 1);
  assert.match(used.stdout, /already used/);
});

// New 2 (build 7, added in build 12): a resume from the owner's terminal was refused with no session id set, or from
// a folder outside the repo, and the refusal named neither, so it read as if the owner had not answered.
// why: guards rule:sweep-auto-approval
test('a refused resume says when no session id is set, or when no transcript of that session is kept for this repo', () => {
  const r = approveRun(featureContract());
  outcome(r, String(Math.ceil(537500 * 1.3)));
  const code = (approveIn(r.dir, [r.f]).stdout.match(/`sweep resume ([0-9a-f]{6})`/) || [])[1];
  assert.ok(code);
  const cfg = makeTemp('cfg-');
  const none = approveIn(r.dir, ['--resume'], { CLAUDE_CODE_SESSION_ID: '', CLAUDE_CONFIG_DIR: cfg });
  assert.equal(none.status, 1);
  assert.match(none.stdout, /CLAUDE_CODE_SESSION_ID is not set/);
  const elsewhere = approveIn(r.dir, ['--resume'], tapEnv(cfg));
  assert.equal(elsewhere.status, 1);
  assert.ok(elsewhere.stdout.includes(TAP_SID), 'the refusal does not name the session it looked for');
  assert.match(elsewhere.stdout, /no transcript/);
  ownerTaps(cfg, r.dir, 'sweep resume 000000');
  assert.doesNotMatch(approveIn(r.dir, ['--resume'], tapEnv(cfg)).stdout, /CLAUDE_CODE_SESSION_ID|no transcript/, 'a session that is read was named as missing');
});

// The installed approve.mjs reads the owner's taps in the Claude folder install user filled in, so a caller cannot
// point it at a forged transcript through CLAUDE_CONFIG_DIR.
// why: guards rule:sweep-auto-approval
test('an installed approve.mjs reads the owner\'s taps only from the folder it was installed into', () => {
  const home = makeTemp('home-');
  const i = spawnSync(process.execPath, [path.resolve('scripts/kit.mjs'), 'install', 'user', '--unreleased'], { encoding: 'utf8', env: { ...process.env, KIT_CLAUDE_HOME: home, CLAUDE_CODE_REMOTE: '' } });
  assert.equal(i.status, 0, i.stdout + i.stderr);
  const installed = path.join(home, 'skills', 'pre-pr-sweep', 'approve.mjs');
  assert.doesNotMatch(read(path.join(home, 'kit-tools', 'owner-yes.cjs')), /\{\{CLAUDE_HOME\}\}/);
  const r = approveRun(askContract());
  const code = r.stdout.match(/`sweep yes ([0-9a-f]{6})`/)[1];
  const forged = makeTemp('cfg-');
  ownerTaps(forged, r.dir, `sweep yes ${code}`);
  const out = spawnSync('node', [installed, r.f, '--owner-yes'], { encoding: 'utf8', cwd: r.dir, env: { PATH: process.env.PATH, ...tapEnv(forged) } });
  assert.equal(out.status, 1, out.stdout);
  assert.match(out.stdout, /no Yes from the owner/);
  ownerTaps(home, r.dir, `sweep yes ${code}`);
  const real = spawnSync('node', [installed, r.f, '--owner-yes'], { encoding: 'utf8', cwd: r.dir, env: { PATH: process.env.PATH, ...tapEnv(forged) } });
  assert.equal(real.status, 0, real.stdout);
});

// Rule review 2026-10-31 (the owner approved): the trial review comes every 10 auto-approvals until two in a row
// passed clean, then every 20; any other pause (a drift trip) puts it back to 10.
// why: guards rule:sweep-auto-approval
test('the trial review widens from every 10 approvals to every 20 after two clean reviews, and a drift pause resets it', () => {
  const r = approveRun(featureContract());
  outcome(r);
  const approveN = (n) => { for (let i = 0; i < n; i++) { nextBranch(r.dir); const a = approveIn(r.dir, [r.f]); assert.equal(a.status, 0, `approval ${i + 1}: ${a.stdout}`); outcome(r); } };
  const due = (every) => { nextBranch(r.dir); const a = approveIn(r.dir, [r.f]); assert.equal(a.status, 1); assert.match(a.stdout, new RegExp(`trial review due: ${every} auto-approvals`)); };
  const resume = () => { const o = approveIn(r.dir, ['--resume'], { KIT_OWNER_RESUME: '1' }); assert.equal(o.status, 0, o.stdout); };
  approveN(9); due(10); resume();
  approveN(10); due(10); resume();
  approveN(20); due(20); resume();
  nextBranch(r.dir);
  const drift = approveIn(r.dir, [r.f]);
  assert.equal(drift.status, 0);
  outcome(r, String(Math.ceil(537500 * 1.3)));
  assert.match(approveIn(r.dir, [r.f]).stdout, /paused/i);
  resume();
  approveN(10); due(10);
});

// why: guards rule:sweep-auto-approval
test('a log line written by hand, or a raised cap, never clears the way', () => {
  const r = approveRun(featureContract());
  outcome(r, String(Math.ceil(537500 * 1.3)));
  fs.appendFileSync(path.join(r.dir, '.git', 'kit-sweep-approvals.jsonl'), JSON.stringify({ kind: 'resume' }) + '\n');
  assert.match(approveIn(r.dir, [r.f]).stdout, /changed by hand|paused/i);
  const big = sweepRepo();
  fs.mkdirSync(path.join(big, '.kit'));
  fs.writeFileSync(path.join(big, '.kit', 'sweep-approval.json'), JSON.stringify({ caps: { feature: { maxExtras: 99, maxAgents: 'lots', maxRoleBudget: 1e12, maxTotalBudget: 1e13 } } }));
  commitAll(big, 'caps', true);
  commitAll(big, 'caps', true);
  const c = featureContract();
  for (const q of ['Do stale caches keep serving removed rows forever?', 'Would renamed exports break plugin loaders downstream?', 'Can old backups restore deleted accounts silently?', 'Might retry loops double every queued payment?', 'Does daylight saving shift nightly scheduled jobs?', 'Are locked files blocking concurrent uploads anywhere?']) c.roles.push(role('modelled-on', q));
  assert.match(approveRun(c, big).stdout, /ASK THE OWNER[\s\S]*6 roles beyond the feature floor[\s\S]*cap of 5/, 'caps only go down');
});

// why: guards rule:sweep-auto-approval
test('the trial needs each outcome, rejects bad numbers, and pauses on repeats, an escape and every 10 approvals', () => {
  const r = approveRun(featureContract());
  assert.match(approveIn(r.dir, [r.f]).stdout, /outcome/i, 'the last sweep\'s outcome comes first');
  assert.notEqual(approveIn(r.dir, [r.f, '--outcome', '--tokens', 'lots']).status, 0);
  fs.writeFileSync(r.f, JSON.stringify(featureContract(), null, 2));
  outcome(r, '100000', '6', '4', '2');
  assert.match(approveIn(r.dir, [r.f]).stdout, /paused/i, 'a third repeated, found by path after an edit');
  const t = approveRun(featureContract());
  for (let i = 1; i < 10; i++) { outcome(t); nextBranch(t.dir); assert.equal(approveIn(t.dir, [t.f]).status, 0, `approval ${i + 1}`); }
  outcome(t);
  const due = approveIn(t.dir, [t.f]);
  assert.match(due.stdout, /trial review/i);
  assert.match(approveIn(t.dir, ['--summary']).stdout, /approved: 10[\s\S]*paused/);
  const e = approveRun(featureContract());
  approveIn(e.dir, [e.f, '--escape', 'a sync bug shipped in code this sweep passed']);
  assert.match(approveIn(e.dir, [e.f]).stdout, /paused/i);
});

// why: guards rule:sweep-auto-approval
test('an approval prints the owner\'s start notice from checked data, not a hand count', () => {
  const c = featureContract();
  c.roles[3].model = 'sonnet';
  const r = approveRun(c);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /Start notice/);
  assert.match(r.stdout, /security x3/);
  assert.match(r.stdout, /test-value reviewer \(test-value, sonnet\)/);
  assert.match(r.stdout, /security reviewer \(security, claude-opus-5-5\)/);
  assert.match(r.stdout, /Budget: 537,500 processed tokens/);
  assert.match(r.stdout, /Extras: 0 of 5 allowed/);
  assert.match(r.stdout, /security 3 of 3 needed/);
  assert.match(r.stdout, /Findings come when the sweep finishes/);
});

// 1.21.0 handoff item 31: a log line that is valid JSON but no entry (null, a number, a list) turned the guard off
// and crashed approve.mjs. It reads as a hand edit: the guard refuses and the script pauses.
// why: guards rule:sweep-auto-approval
test('a log line that parses to no entry pauses the sweep tools, and the guard still refuses', () => {
  for (const junk of ['null', '7', '[]']) {
    const r = approveRun(featureContract());
    assert.equal(r.status, 0, r.stdout);
    const brief = 'review. Call cap: 5.' + leadTag(r.dir, 'Call cap: 5');
    const tool_input = { subagent_type: 'reviewer', prompt: brief + leadQuestion(r.dir, brief) };
    assert.equal(sweepGuard(r.dir, { raw: true, tool_input: { ...tool_input } }).permissionDecision, 'allow', `${junk}: cleared before`);
    fs.rmSync(path.join(r.dir, '.git', 'kit-sweep-starts'), { recursive: true, force: true });
    fs.appendFileSync(path.join(r.dir, '.git', 'kit-sweep-approvals.jsonl'), `${junk}\n`);
    assert.equal(sweepGuard(r.dir, { raw: true, tool_input }).permissionDecision, 'deny', `${junk}: the guard refuses`);
    const again = approveIn(r.dir, [r.f]);
    assert.doesNotMatch(again.stderr, /TypeError/, `${junk}: approve.mjs reads it`);
    assert.match(again.stdout, /changed by hand/, `${junk}: the script pauses`);
  }
});

// why: guards rule:sweep-auto-approval
test('the owner\'s yes is logged only after the script asked, for this contract and HEAD', () => {
  const r = approveRun(askContract());
  assert.equal(r.status, 1);
  assert.notEqual(approveIn(r.dir, [r.f, '--owner-yes', '']).status, 0, 'the owner\'s words are required');
  const yes = approveIn(r.dir, [r.f, '--owner-yes', 'Yes run those 5']);
  assert.equal(yes.status, 0, yes.stdout);
  assert.equal(approvalLog(r.dir).pop().kind, 'owner-yes');
  // An approved contract has nothing for the owner to clear.
  const a = approveRun(featureContract());
  assert.notEqual(approveIn(a.dir, [a.f, '--owner-yes', 'yes']).status, 0);
  // An ask for an older version of the contract does not cover an edited one.
  const c = askContract();
  const e = approveRun(c);
  fs.writeFileSync(e.f, JSON.stringify({ ...c, roles: c.roles.slice(0, 2) }));
  assert.notEqual(approveIn(e.dir, [e.f, '--owner-yes', 'yes']).status, 0);
});

// why: guards rule:sweep-auto-approval
test('the sweep guard refuses a reviewer agent until the log clears this HEAD and this contract', () => {
  const dir = sweepRepo();
  assert.equal(sweepGuard(dir).permissionDecision, 'deny', 'no approval at all');
  assert.match(sweepGuard(dir).permissionDecisionReason, /approve\.mjs/);
  assert.equal(sweepGuard(dir, { tool_input: { subagent_type: 'builder', prompt: 'build' } }).permissionDecision, 'allow', 'only reviewers are gated');
  const r = approveRun(featureContract(), dir);
  assert.equal(r.status, 0);
  assert.equal(sweepGuard(dir).permissionDecision, 'allow', 'approved for this HEAD');
  // The contract changed after approval.
  fs.writeFileSync(r.f, JSON.stringify({ ...featureContract(), tier: 'fix' }));
  assert.equal(sweepGuard(dir).permissionDecision, 'deny');
  fs.writeFileSync(r.f, JSON.stringify(featureContract()));
  // New commits: the approval was for the old HEAD.
  fs.writeFileSync(path.join(dir, 'src', 'more.ts'), 'x\n');
  commitAll(dir, 'more', true);
  assert.equal(sweepGuard(dir).permissionDecision, 'deny', 'HEAD moved');
  // A line written by hand does not clear it.
  const head = g(dir, 'rev-parse', 'HEAD').stdout.trim();
  const logFile = path.join(dir, '.git', 'kit-sweep-approvals.jsonl');
  fs.appendFileSync(logFile, JSON.stringify({ kind: 'decision', decision: 'approved', contract: r.f, hash: 'x', head, prev: 'forged' }) + '\n');
  assert.equal(sweepGuard(dir).permissionDecision, 'deny', 'a hand-written line');
});

// why: guards rule:sweep-auto-approval
test('the sweep guard lets reviewers start after the script asked and the owner said yes', () => {
  const r = approveRun(askContract());
  assert.equal(sweepGuard(r.dir).permissionDecision, 'deny');
  assert.match(sweepGuard(r.dir).permissionDecisionReason, /--owner-yes/);
  approveIn(r.dir, [r.f, '--owner-yes', 'Yes run those 5']);
  assert.equal(sweepGuard(r.dir).permissionDecision, 'allow');
});

// Found in review of the hand-back fix: the report is the latest turn's hand-back, never an earlier turn, a message
// to another agent, or narration before a thinking-only entry.
// why: guards rule:agent-canary
test('the canary reads only the latest turn of the transcript, and prefers the hand-back', () => {
  const dir = canaryRepo();
  const say = (content) => ({ type: 'assistant', message: { role: 'assistant', content } });
  const handback = (message) => say([{ type: 'tool_use', name: 'SubagentHandback', input: { message } }]);
  const prompt = (text) => ({ type: 'user', message: { role: 'user', content: text } });
  const toolResult = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } };
  const file = (entries, tail = '') => {
    const f = path.join(makeTemp('tr-'), 'agent.jsonl');
    fs.writeFileSync(f, entries.map((l) => JSON.stringify(l)).join('\n') + '\n' + tail);
    return f;
  };
  const stop = (id, f) => canary({ cwd: dir, hook_event_name: 'SubagentStop', agent_type: 'builder', agent_id: id, agent_transcript_path: f }).status;
  // A resumed agent: its first turn's report had the phrase; this turn's does not.
  assert.equal(stop('r1', file([prompt('brief'), handback(`${FAKE_PHRASE}\nturn one`), prompt('follow-up'), say([{ type: 'text', text: 'Let me check.' }]), toolResult, handback('turn two, no phrase')])), 2);
  // A message to another agent that carries the phrase is not the report.
  assert.equal(stop('r2', file([prompt('brief'), say([{ type: 'tool_use', name: 'SendMessage', input: { to: 'peer', message: `${FAKE_PHRASE} hi` } }]), toolResult, handback('report, no phrase')])), 2);
  // A thinking-only entry after the hand-back does not send the reader back to earlier narration.
  assert.equal(stop('r3', file([prompt('brief'), say([{ type: 'text', text: 'Let me read the files.' }]), toolResult, handback(`${FAKE_PHRASE}\ndone`), say([{ type: 'thinking', thinking: '' }])])), 0);
  // Text and the hand-back in one entry: the hand-back is the report.
  assert.equal(stop('r4', file([prompt('brief'), say([{ type: 'text', text: 'Done, handing back.' }, { type: 'tool_use', name: 'SubagentHandback', input: { message: `${FAKE_PHRASE}\nok` } }])])), 0);
  // A half-written last line is skipped, not a reason to stop reading.
  assert.equal(stop('r5', file([prompt('brief'), handback(`${FAKE_PHRASE}\nok`)], '{"type":"assist')), 0);
});

// why: guards rule:outward-acts
test('the leak guard lets an agent open its own message to its tasker with the phrase, and nobody else', () => {
  const dir = canaryRepo();
  const send = (extra) => {
    const r = canary({ cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'SendMessage', tool_input: { to: 'lead', message: `${FAKE_PHRASE}\nUNIT u1 DONE` }, ...extra });
    return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : 'allow';
  };
  assert.equal(send({ agent_id: 'b1', agent_type: 'builder' }), 'allow');
  assert.equal(send({}), 'deny', 'the main session is a tasker');
  assert.equal(send({ agent_id: 'o1', agent_type: 'orchestrator' }), 'deny', 'an orchestrator tasks its own team');
  const buried = canary({ cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'SendMessage', agent_id: 'b2', agent_type: 'builder', tool_input: { to: 'lead', message: `done. ps: ${FAKE_PHRASE}` } });
  assert.match(buried.stdout, /deny/, 'only an opening line counts as the agent\'s own');
});

// Found in the re-check: the floor read only committed work in the contract's own checkout.
// why: guards rule:sweep-auto-approval
test('the approval script asks the owner when the work is not committed or the diff is empty', () => {
  const dir = sweepRepo({ 'README.md': 'w\n' });
  const one = { tier: 'triage', modifiers: [], roles: [role('triage', 'Any secret or personal data in the diff?')] };
  fs.writeFileSync(path.join(dir, 'src.js'), 'new\n');
  assert.match(approveRun(one, dir).stdout, /not committed/i);
  const empty = makeTemp('approve-');
  g(empty, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(empty, 'README.md'), 'x\n');
  commitAll(empty, 'base', true);
  fs.mkdirSync(path.join(empty, 'sweeps'));
  fs.writeFileSync(path.join(empty, '.gitignore'), 'sweeps/\n');
  commitAll(empty, 'ignore', true);
  g(empty, 'checkout', '-q', '-b', 'side');
  g(empty, 'branch', '-f', 'main', 'HEAD');
  assert.match(approveRun(one, empty).stdout, /no changes/i);
  const r = approveRun(featureContract());
  assert.equal(approveIn(r.dir, ['--resume'], { KIT_OWNER_RESUME: '1', CLAUDECODE: '' }).status, 1, 'an emptied marker is still an AI shell');
});

// why: guards rule:agent-canary
test('the canary skips a hook note after the hand-back', () => {
  const dir = canaryRepo();
  const f = path.join(makeTemp('tr-'), 'agent.jsonl');
  const lines = [
    { type: 'user', message: { content: 'brief' } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'SubagentHandback', input: { message: `${FAKE_PHRASE}\nok` } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }, { type: 'text', text: '<system-reminder>note</system-reminder>' }] } },
    { type: 'user', isMeta: true, message: { content: 'hook note' } },
  ];
  fs.writeFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  assert.equal(canary({ cwd: dir, hook_event_name: 'SubagentStop', agent_type: 'builder', agent_id: 'm1', agent_transcript_path: f }).status, 0);
  assert.equal(canaryLog(dir).pop().result, 'hit');
});

// why: guards rule:outward-acts
test('the size band refuses only a measured size past what is allowed, never a margin', () => {
  // Page grew 5,800 B: under the 106,050 allowed, though size + 10% of the growth would be over. Applied, with what
  // margin fits; on-demand grew inside its own limit and is left alone; the file count rose by 1 and is raised exactly.
  const r = bandRun('apply', { band, measured: { page: 105800, lazy: 16030, files: 81 }, limits: band.limit });
  assert.equal(r.status, 0, r.stdout);
  assert.deepEqual(r.out.limits, { page: 106050, lazy: 16040, files: 81 });
  // Past the band by measurement: a refusal with the number to re-request.
  const over = bandRun('apply', { band, measured: { page: 106051, lazy: 16030, files: 80 }, limits: band.limit });
  assert.equal(over.status, 1);
  assert.match(over.stdout, /page: measured 106,051 B, allowed 106,050 B/);
  assert.match(over.stdout, /re-request/i);
  // A line the plan did not list may not grow past its own limit.
  const lazy = bandRun('apply', { band, measured: { page: 100000, lazy: 16041, files: 80 }, limits: band.limit });
  assert.equal(lazy.status, 1);
  assert.match(lazy.stdout, /lazy/);
  const count = bandRun('apply', { band, measured: { page: 100000, lazy: 16000, files: 83 }, limits: band.limit });
  assert.equal(count.status, 1, 'a count past its raise');
});

// why: guards rule:size-budgets
// planted: {"file":"project/.claude/size-band.mjs","was":"if (!Number.isInteger(size) || size < 0) { refusals.push(`${line}: no measured size`); continue; }","to":"if (!Number.isInteger(size) && size < 0) { refusals.push(`${line}: no measured size`); continue; }"}
// planted: {"file":"project/.claude/size-band.mjs","was":"for (const line of Object.keys(next)) if (next[line] !== limits[line]) console.log(`    ${line}: ${unit(line, limits[line])} -> ${unit(line, next[line])} (measured ${unit(line, measured[line])})`);","to":"for (const line of Object.keys(next)) if (next[line] === limits[line]) console.log(`    ${line}: ${unit(line, limits[line])} -> ${unit(line, next[line])} (measured ${unit(line, measured[line])})`);"}
test('the size band end check lowers padding and fails a line over its limit', () => {
  const limits = { page: 106050, lazy: 16040, files: 82 };
  const r = bandRun('final', { band, measured: { page: 103000, lazy: 16000, files: 81 }, limits });
  assert.equal(r.status, 0, r.stdout);
  assert.deepEqual(r.out.limits, { page: 103300, lazy: 16040, files: 81 }, 'lowered to size + margin; the unlisted line kept');
  // K189 (the K160 slips): only a line that moved is listed, and a limit with no measured size is refused.
  assert.match(r.stdout, /page: /);
  assert.doesNotMatch(r.stdout, /^\s+lazy: /m, r.stdout);
  const unmeasured = bandRun('final', { band, measured: { page: 103000, files: 81 }, limits });
  assert.equal(unmeasured.status, 1, unmeasured.stdout);
  assert.match(unmeasured.stdout, /lazy: no measured size/);
  assert.equal(bandRun('final', { band, measured: { page: 106100, lazy: 16000, files: 81 }, limits }).status, 1);
});

// why: catches a break at project/.claude/size-band.mjs:47 that no other test catches
test('the size band rejects a band it cannot read as whole numbers, and a line with no limit', () => {
  const bad = (b) => bandRun('apply', { band: { ...band, ...b }, measured: { page: 101000, lazy: 16000, files: 80 }, limits: band.limit });
  for (const b of [{ limit: { lazy: 16040, files: 80 } }, { raise: { page: '6000' } }, { raise: { page: 10.5 } }, { base: { page: -1, lazy: 16000, files: 80 } }, { counts: ['fils'] }]) {
    const r = bad(b);
    assert.equal(r.status, 2, JSON.stringify(b) + r.stdout);
    assert.match(r.stdout, /band/i);
  }
  const extra = bandRun('apply', { band, measured: { page: 100000, lazy: 16000, files: 80, fonts: 9000 }, limits: band.limit });
  assert.equal(extra.status, 1);
  assert.match(extra.stdout, /fonts: no limit/);
});

// Captured live in the desktop app: the stop event fires before the agent's hand-back reaches its transcript, so a
// stop-time read finds no report. The report is checked when the agent calls the hand-back tool, where its text is
// the call's own input; a miss refuses the call with the close-out steps.
// why: guards rule:agent-canary
test('the canary checks a hand-back at the call, refuses a miss once, and lets the close-out through', () => {
  const dir = canaryRepo();
  const handback = (id, message) => {
    const r = canary({ cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', agent_type: 'builder', agent_id: id, tool_input: { message } });
    return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : { permissionDecision: 'allow' };
  };
  assert.equal(handback('p1', `${FAKE_PHRASE}\nUNIT u1 DONE`).permissionDecision, 'allow');
  const miss = handback('p2', 'UNIT u1 DONE');
  assert.equal(miss.permissionDecision, 'deny');
  assert.match(miss.permissionDecisionReason, /Closed out/);
  assert.ok(!miss.permissionDecisionReason.toLowerCase().includes(FAKE_PHRASE.toLowerCase()), 'never names the phrase');
  assert.equal(handback('p2', 'Closed out: u1\nnote').permissionDecision, 'allow');
  // The stop that follows a checked hand-back adds nothing to the log.
  canary({ cwd: dir, hook_event_name: 'SubagentStop', agent_type: 'builder', agent_id: 'p1' });
  canary({ cwd: dir, hook_event_name: 'SubagentStop', agent_type: 'builder', agent_id: 'p2' });
  assert.deepEqual(canaryLog(dir).map((e) => [e.agent, e.result]), [['p1', 'hit'], ['p2', 'miss'], ['p2', 'closed-out']]);
});

// T6 (build 11): a reviewer's report is the findings ledger's source, so its shape is checked at the hand-back: a role
// line, one line per finding in the five fields (or "No findings"), and what it did not check. A report out of shape
// is refused once with what is missing; the second goes through, logged, so a role never loops on its report.
// why: guards rule:sweep-auto-approval
// planted: {"file":"user/kit-hooks/canary.cjs","was":"return f.length < 5 ||","to":"return f.length < 5 &&"}
// planted: {"file":"user/kit-hooks/canary.cjs","was":"return run(input).out || null","to":"return run(input).out && null"}
test('a reviewer\'s hand-back is checked for the report shape once, and the second try goes through', () => {
  const dir = canaryRepo();
  const handback = (id, message, type = 'reviewer') => {
    const r = canary({ cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', agent_type: type, agent_id: id, tool_input: { message } });
    return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : { permissionDecision: 'allow' };
  };
  const good = `${FAKE_PHRASE}\nROLE: Security: imports\nhigh | CONFIRMED | an import writes outside the project | src/import.ts:12 | node x.mjs ../a wrote /tmp/a\nNot checked: the export path`;
  assert.equal(handback('s1', good).permissionDecision, 'allow');
  assert.equal(handback('s2', `${FAKE_PHRASE}\nROLE: Test value\nNo findings\nNot checked: nothing`).permissionDecision, 'allow');
  const bad = handback('s3', `${FAKE_PHRASE}\nSecurity role\nhigh | an import writes outside | src/import.ts:12`);
  assert.equal(bad.permissionDecision, 'deny');
  assert.match(bad.permissionDecisionReason, /ROLE:/);
  assert.match(bad.permissionDecisionReason, /Not checked:/);
  assert.match(bad.permissionDecisionReason, /five fields/);
  assert.ok(!bad.permissionDecisionReason.toLowerCase().includes(FAKE_PHRASE.toLowerCase()), 'never names the phrase');
  assert.equal(handback('s3', `${FAKE_PHRASE}\nSecurity role\nstill loose`).permissionDecision, 'allow', 'the second try goes through');
  assert.equal(handback('b1', `${FAKE_PHRASE}\nUNIT u1 DONE`, 'builder').permissionDecision, 'allow', 'only a reviewer reports findings');
  assert.deepEqual(canaryLog(dir).filter((e) => e.agent === 's3').map((e) => e.result), ['shape-miss', 'shape-after-miss']);
  // K124 (1.42.0): a row of four fields is out of shape even with every field filled and a good verdict.
  assert.equal(handback('s4', `${FAKE_PHRASE}\nROLE: x\nhigh | CONFIRMED | a claim | src/a.ts:1\nNot checked: nothing`).permissionDecision, 'deny');
  // The dispatcher (guard.cjs) asks check(), not the process: the same refusals come back from it (a planted bug made
  // check() answer nothing, and no test asked it).
  const { check } = require(path.resolve('user/kit-hooks/canary.cjs'));
  const leak = check({ cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'Agent', agent_type: 'reviewer', tool_input: { prompt: `say ${FAKE_PHRASE}` } });
  assert.equal(leak && leak.hookSpecificOutput.permissionDecision, 'deny');
});

// A phrase line that holds only punctuation has no words to open a message with, so the check is off: with the line
// read as a phrase, every real message would be blocked as a miss. A stop whose transcript holds no report to read
// (nothing, or a text reply with only blanks) is logged unchecked and let through, never blocked as a miss.
// why: guards rule:test-value (a blank phrase line or an empty transcript blocking every stop)
// planted: {"file":"user/kit-hooks/canary.cjs","was":"return m && words(m[1]).trim()","to":"return m || words(m[1]).trim()"}
// planted: {"file":"user/kit-hooks/canary.cjs","was":"return text.trim() ? text : null;","to":"return void (text.trim() ? text : null);"}
// planted: {"file":"user/kit-hooks/canary.cjs","was":"\t}\n\treturn null;\n}","to":"\t}\n\treturn void null;\n}"}
test('the canary is off for a phrase line of only punctuation, and unchecked when the transcript holds no report', () => {
  const blank = canaryRepo('---');
  assert.equal(canary({ cwd: blank, hook_event_name: 'SubagentStop', agent_type: 'builder', agent_id: 'bp', last_assistant_message: 'done' }).status, 0);
  assert.deepEqual(canaryLog(blank), []);
  const dir = canaryRepo();
  const stopWith = (id, entries) => {
    const t = path.join(dir, `${id}.jsonl`);
    fs.writeFileSync(t, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
    return canary({ cwd: dir, hook_event_name: 'SubagentStop', agent_type: 'builder', agent_id: id, agent_transcript_path: t }).status;
  };
  assert.equal(stopWith('e1', []), 0, 'an empty transcript');
  assert.equal(stopWith('e2', [{ type: 'assistant', message: { content: [{ type: 'text', text: '  ' }] } }]), 0, 'a blank text reply');
  assert.deepEqual(canaryLog(dir).map((e) => e.result), ['unchecked', 'unchecked']);
});

// why: guards rule:sweep-auto-approval
test('every kit role checks its hand-back call', () => {
  for (const role of ['builder', 'checker', 'scanner', 'orchestrator', 'reviewer']) {
    assert.match(read(path.resolve('user/agents', `${role}.md`)), /matcher: "SubagentHandback"\n {6}hooks:\n {8}- type: command\n {10}command: node "\{\{CLAUDE_HOME\}\}\/kit-hooks\/canary\.cjs"/, role); // pin: 1 Claude Code reads the hook block
  }
});

// I28 (1.20.0 step 6): the fix-tier example indents its findings table under a bullet, and the audit read only rows at
// column 0, so a high marked DEFERRED there passed as clean.
// why: guards rule:sweep-auto-approval
test('the sweep audit reads an indented findings table as it reads a flat one', () => {
  const dims = ['Privacy and data boundary', 'Supply chain and bundle', 'Legal and content', 'Code security', 'Gaps and scaling', 'Version goal alignment'];
  const report = (table) => `# Sweep: offline sync\n\n- **Tier:** feature\n- **Date:** 2026-03-04\n- **Branch:** feature/offline-sync at a1b2c3d\n- **Layers:** plan 2, CI 0, sweep 1, escaped 0\n\n${dims.map((d, i) => `## ${i + 1}. ${d}\n\nPASS\n`).join('\n')}\n- Findings:\n${table}\n\n**Still aligned with the version goals?** YES - only the planned scope shipped.\n`;
  const rows = (indent, disp) => [`| # | Severity | Finding | Disposition |`, `|---|---|---|---|`, `| 1 | high | token in log | ${disp} |`].map((l) => indent + l).join('\n');
  for (const indent of ['', '  ', '    ', '\t']) {
    const out = runAudit('pre-pr-sweep', report(rows(indent, 'DEFERRED next build')));
    assert.equal(out.status, 1, JSON.stringify(indent) + ': a deferred high must fail');
    assert.match(out.stdout, /finding 1/);
    assert.equal(runAudit('pre-pr-sweep', report(rows(indent, 'FIXED 9f8e7d6'))).status, 0, JSON.stringify(indent) + ': a fixed high passes');
  }
});

// Sweep tooling carry-overs from 1.18.0 (C4, C9b, C9e, C9f, C10, C11), each checked real against the code first.
// why: guards rule:sweep-auto-approval
test('C4/C9e: each brief names its sweep and role, so ids in any order count for the right role, and another sweep\'s reviewer does not', () => {
  const c = featureContract();
  c.roles[3].model = 'sonnet';
  const r = approveRun(c);
  assert.equal(r.status, 0, r.stdout);
  const hash = approvalLog(r.dir).pop().hash;
  assert.ok(r.stdout.includes(`Sweep: ${hash} role <n>`), 'the start notice gives the line');
  const ids = cheapRoles(5);
  const cfg = transcripts(Object.fromEntries(ids.map((id, i) => [id, [{ model: i === 3 ? 'claude-sonnet-5-5' : 'claude-opus-5-5', u: [0, 100, 0, 0] }]])));
  ids.forEach((id, i) => setBrief(cfg, id, (b) => `${b} Sweep: ${hash} role ${i + 1}`));
  const o = logOutcome(r, [ids[3], ids[1], ids[2], ids[0], ids[4]], cfg);
  assert.equal(o.status, 0, o.stdout);
  assert.doesNotMatch(o.stdout, /paused/, 'the sonnet reviewer is read as the sonnet role');
  const line = approvalLog(r.dir).pop();
  assert.deepEqual(line.roles.map((x) => x.kind), c.roles.map((x) => x.kind));
  assert.equal(line.roles[3].agent, ids[3]);
  const brief = (text) => { const b = approveRun(featureContract()); const ids2 = cheapRoles(5); const cfg2 = transcripts(Object.fromEntries(ids2.map((id) => [id, [[0, 100, 0, 0]]]))); const h = approvalLog(b.dir).pop().hash; ids2.forEach((id, i) => setBrief(cfg2, id, (x) => `${x} ${text(h, i)}`)); return logOutcome(b, ids2, cfg2).stdout; };
  assert.match(brief((h, i) => `Sweep: ${'0'.repeat(16)} role ${i + 1}`), /ASK THE OWNER[\s\S]*brief is for another contract/);
  assert.match(brief(() => 'Sweep: none'), /ASK THE OWNER[\s\S]*no "Sweep: <hash> role <n>" line/);
  assert.match(brief((h) => `Sweep: ${h} role 1`), /ASK THE OWNER[\s\S]*named by more than one brief/);
  assert.match(brief((h, i) => `Sweep: ${h} role ${i + 2}`), /brief names role 6; the contract has 5/);
});

// why: guards rule:sweep-auto-approval
test('C4: the guard starts each role once, by the sweep and role its brief names', () => {
  const c = featureContract();
  c.roles.forEach((x, i) => { x.calls = [5, 5, 6, 7, 8][i]; });
  const r = approveRun(c);
  const hash = approvalLog(r.dir).pop().hash;
  const start = (p) => sweepGuard(r.dir, { tool_input: { subagent_type: 'reviewer', prompt: `go. ${p}` } });
  const none = start('Call cap: 5. Sweep: none');
  assert.equal(none.permissionDecision, 'deny');
  assert.ok(none.permissionDecisionReason.includes(`Sweep: ${hash} role <n>`), none.permissionDecisionReason);
  assert.equal(start(`Call cap: 5. Sweep: ${'f'.repeat(16)} role 1`).permissionDecision, 'deny', 'another contract');
  assert.match(start(`Call cap: 6. Sweep: ${hash} role 1`).permissionDecisionReason, /call cap of 5, not 6/);
  assert.equal(start(`Call cap: 5. Sweep: ${hash} role 6`).permissionDecision, 'deny', 'no sixth role');
  assert.equal(start(`Call cap: 5. Sweep: ${hash} role 2`).permissionDecision, 'allow');
  assert.match(start(`Call cap: 5. Sweep: ${hash} role 2`).permissionDecisionReason, /Role 2 of the cleared contract[\s\S]*started already/);
  assert.equal(start(`Call cap: 5. Sweep: ${hash} role 1`).permissionDecision, 'allow', 'role 1 keeps its own slot');
});

// why: guards rule:outward-acts
test('C9f: the guard reads each folder\'s HEAD once, however long the log', () => {
  const dir = sweepRepo();
  // git's own trace counts its runs, on every system; a shim script would not run on Windows, the only CI system.
  const count = path.join(makeTemp('trace-'), 'count');
  const lines = [];
  const sha = (x) => crypto.createHash('sha256').update(x).digest('hex').slice(0, 16);
  for (let i = 0; i < 200; i++) lines.push(JSON.stringify({ kind: 'decision', contract: path.join(dir, 'sweeps', 'old.json'), hash: 'x', head: '0000000', decision: 'approved', prev: i ? sha(lines[i - 1]) : '' }));
  fs.writeFileSync(path.join(dir, '.git', 'kit-sweep-approvals.jsonl'), lines.join('\n') + '\n');
  const r = runHook('user/kit-hooks/sweep-guard.cjs', { cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'reviewer', prompt: 'go. Call cap: 5.' } }, { GIT_TRACE: count });
  assert.match(r.stdout, /No cleared Swarm Contract/);
  const runs = read(count).split('\n').filter((l) => /trace: built-in: git /.test(l)).length;
  assert.ok(runs >= 1 && runs <= 3, `${runs} git calls`);
});

// why: guards rule:sweep-auto-approval
test('C9b: an owner-cleared sweep owes its outcome before the next, and --none-ran closes one no reviewer used', () => {
  const a = approveRun(askContract());
  assert.equal(a.status, 1, a.stdout);
  assert.equal(approveIn(a.dir, [a.f, '--owner-yes', 'yes go']).status, 0);
  const next = path.join(a.dir, 'sweeps', 'next.json');
  fs.writeFileSync(next, JSON.stringify(featureContract()));
  const b = approveIn(a.dir, [next]);
  assert.equal(b.status, FIX_EXIT, b.stdout);
  assert.match(b.stdout, /approved sweep first \(sweeps\/contract\.json\)/);
  const n = approveIn(a.dir, [a.f, '--outcome', '--none-ran']);
  assert.equal(n.status, 0, n.stdout);
  assert.equal(approvalLog(a.dir).pop().budget, approvalLog(a.dir).filter((e) => e.kind === 'decision' && e.contract === a.f).pop().budget);
  assert.equal(approveIn(a.dir, [next]).status, 0);
});

// why: guards rule:outward-acts
test('C10: one owner yes answers one ask, so a second cannot open a second team', () => {
  const a = approveRun(askContract());
  assert.equal(approveIn(a.dir, [a.f, '--owner-yes', 'yes']).status, 0);
  const again = approveIn(a.dir, [a.f, '--owner-yes', 'yes again']);
  assert.equal(again.status, 1);
  assert.match(again.stdout, /already logged/);
  assert.equal(approvalLog(a.dir).filter((e) => e.kind === 'owner-yes').length, 1);
  for (let i = 0; i < 3; i++) assert.equal(sweepGuard(a.dir).permissionDecision, 'allow');
  assert.equal(sweepGuard(a.dir).permissionDecision, 'deny');
});

// why: guards rule:sweep-tiers
test('C9c: a --base off the default branch asks the owner', () => {
  const dir = sweepRepo();
  fs.writeFileSync(path.join(dir, 'src', 'more.ts'), 'export const more = 1;\n');
  commitAll(dir, 'more', true);
  const f = path.join(dir, 'sweeps', 'contract.json');
  fs.writeFileSync(f, JSON.stringify(featureContract()));
  const off = approveIn(dir, [f, '--base', 'HEAD~1']);
  assert.equal(off.status, 1, off.stdout);
  assert.match(off.stdout, /--base HEAD~1 is not on main/);
  assert.equal(approveIn(dir, [f, '--base', 'main']).status, 0);
});

// The 1.21.0 sweep's sweep-control findings: each test is the sequence the reviewer ran.
// why: guards rule:sweep-auto-approval
test('S1: a sweep closed as none ran opens no start after it', () => {
  const r = approveRun(featureContract());
  assert.equal(approveIn(r.dir, [r.f, '--outcome', '--none-ran']).status, 0);
  const late = sweepGuard(r.dir);
  assert.equal(late.permissionDecision, 'deny');
  assert.match(late.permissionDecisionReason, /outcome is logged/);
});

// why: guards rule:sweep-tiers
test('S1: a cut short closes the clearance too, and the next clearing still opens', () => {
  const r = approveRun(featureContract());
  assert.equal(sweepGuard(r.dir).permissionDecision, 'allow');
  assert.equal(approveIn(r.dir, [r.f, '--outcome', '--cut-short']).status, 0);
  assert.equal(sweepGuard(r.dir).permissionDecision, 'deny');
});

// why: guards rule:sweep-auto-approval
test('S2: while paused the outcome owed still comes first, so a yes cannot open a second set of slots', () => {
  const r = approveRun(featureContract());
  assert.equal(sweepGuard(r.dir).permissionDecision, 'allow');
  approveIn(r.dir, [r.f, '--escape', 'a bug shipped']);
  const again = approveIn(r.dir, [r.f]);
  assert.equal(again.status, 3, again.stdout);
  assert.match(again.stdout, /outcome of the last approved sweep first/);
  assert.equal(approveIn(r.dir, [r.f, '--owner-yes', 'yes']).status, 1);
});

// why: guards rule:sweep-auto-approval
test('S3: a contract beside the work does not hide uncommitted work or the size of the fixes', () => {
  const dir = sweepRepo();
  const f = path.join(dir, 'src', 'contract.json');
  fs.writeFileSync(f, JSON.stringify(featureContract()));
  fs.appendFileSync(path.join(dir, 'src', 'sync.ts'), 'export const more = 2;\n');
  const r = approveIn(dir, [f]);
  assert.equal(r.status, 3, r.stdout);
  assert.match(r.stdout, /work not committed \(src\/sync\.ts\)/);
});

// why: guards rule:sweep-auto-approval
test('S3: a report or contract in the sweep folder is still left out of what counts as work', () => {
  const r = approveRun(featureContract());
  fs.writeFileSync(path.join(r.dir, 'sweeps', 'report.md'), 'a report\n');
  assert.equal(approveIn(r.dir, [r.f, '--outcome', '--none-ran']).status, 0);
  assert.equal(approveIn(r.dir, [r.f]).status, 0);
});

// why: guards rule:sweep-tiers
test('S4: a --base older than where the branch left main asks, as one off main does', () => {
  const dir = sweepRepo();
  g(dir, 'checkout', '-q', 'main');
  fs.writeFileSync(path.join(dir, 'later.md'), 'x\n');
  commitAll(dir, 'later on main', true);
  const old = g(dir, 'rev-parse', 'HEAD~1').stdout.trim();
  g(dir, 'checkout', '-q', 'feat/sync');
  g(dir, 'merge', '-q', 'main', '-m', 'in');
  const f = path.join(dir, 'sweeps', 'contract.json');
  fs.writeFileSync(f, JSON.stringify(featureContract()));
  const r = approveIn(dir, [f, '--base', old]);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /older than where this branch left main/);
  assert.equal(approveIn(dir, [f, '--base', 'main']).status, 0);
});

// why: guards rule:sweep-auto-approval
test('S4: with no main or master a named base is the owner\'s, not a skipped check', () => {
  const dir = sweepRepo();
  g(dir, 'branch', '-m', 'main', 'trunk');
  const f = path.join(dir, 'sweeps', 'contract.json');
  fs.writeFileSync(f, JSON.stringify(featureContract()));
  const r = approveIn(dir, [f, '--base', 'HEAD~1']);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /no default branch/);
});

// why: guards rule:sweep-auto-approval
test('S5: a start carries its role\'s question, from the checkout that was cleared', () => {
  const r = approveRun(featureContract());
  const { hash } = approvalLog(r.dir).pop();
  const wrong = sweepGuard(r.dir, { raw: true, tool_input: { subagent_type: 'reviewer', prompt: `audit the billing service. Call cap: 5. Sweep: ${hash} role 1` } });
  assert.equal(wrong.permissionDecision, 'deny');
  assert.match(wrong.permissionDecisionReason, /its role's question/);
  const side = path.join(makeTemp('wt-'), 'side');
  g(r.dir, 'worktree', 'add', '-q', '--detach', side, 'main');
  const elsewhere = sweepGuard(r.dir, { cwd: side });
  assert.equal(elsewhere.permissionDecision, 'deny');
  assert.match(elsewhere.permissionDecisionReason, /checkout/);
  // 1.21.0 handoff item 30: the cleared folder is named whole, not as the start of another folder's name.
  // As git names it: on CI the temp folder is a short name (RUNNER~1) git reports long, and a lead names what git shows.
  const root = g(r.dir, 'rev-parse', '--show-toplevel').stdout.trim();
  const named = (where) => sweepGuard(r.dir, { cwd: side, tool_input: { subagent_type: 'reviewer', prompt: `review. Work in ${where}\nCall cap: 5.` } }).permissionDecision;
  assert.equal(named(`${root}-old`), 'deny', 'another folder whose name starts the same');
  assert.equal(named(`${root}2/src`), 'deny');
  assert.equal(named(`${root}/src`), 'allow', 'a folder inside the cleared checkout');
  fs.rmSync(path.join(r.dir, '.git', 'kit-sweep-starts'), { recursive: true, force: true });
  assert.equal(named(`"${root}"`), 'allow', 'the folder itself, quoted');
  fs.rmSync(path.join(r.dir, '.git', 'kit-sweep-starts'), { recursive: true, force: true });
  assert.equal(named(`${root}.`), 'allow', 'the folder at the end of a sentence');
  assert.equal(named(`${root}.bak`), 'deny', 'a folder named with a dot after it');
  fs.rmSync(path.join(r.dir, '.git', 'kit-sweep-starts'), { recursive: true, force: true });
  assert.equal(sweepGuard(r.dir).permissionDecision, 'allow');
});

// S6, changed by E27 (option A): no session logs a yes unseen. The proof is the owner's own thread message, which
// approve.mjs checks; a yes without it is refused in an AI shell and still asks the push guard. A permission prompt
// on the proven form would reach no one on the phone, so the settings no longer ask on it.
// T2: approve.mjs reads the owner's pop-up tap itself, so logging a yes needs no second pop-up for the command; a
// push beside it is held all the same, and clearing the AI shell's markers still is.
// why: guards rule:outward-acts
test('S6: the owner\'s yes runs through the guard on its own proof, and a push beside it is still held', () => {
  const ask = JSON.parse(read(path.resolve('project/.claude/settings.json'))).permissions.ask || [];
  assert.equal(ask.some((r) => /owner-yes/.test(r)), false);
  // A crash prints nothing too, and onFailure block makes it a block: only a clean exit counts as a pass.
  const guard = (command) => { const r = spawnSync('node', [path.resolve('project/.claude/guard-outward.cjs')], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }), encoding: 'utf8' }); assert.equal(r.status, 0, `the guard crashed: ${r.stderr}`); return r.stdout; };
  assert.equal(guard('node approve.mjs c.json --owner-yes'), '');
  assert.match(guard('node approve.mjs c.json --owner-yes; git push origin main'), /"deny"/);
  assert.match(guard('env -u CLAUDECODE node approve.mjs c.json --owner-yes'), /"deny"/);
});

// why: guards rule:outward-acts
test('S7: a start that cannot be recorded is refused, not let through', () => {
  const r = approveRun(featureContract());
  fs.writeFileSync(path.join(r.dir, '.git', 'kit-sweep-starts'), '');
  const start = sweepGuard(r.dir);
  assert.equal(start.permissionDecision, 'deny');
  assert.match(start.permissionDecisionReason, /could not record/);
});

// why: guards rule:sweep-auto-approval
test('L1: a crashed reviewer that wrote after its retry is named at the outcome', () => {
  const s = crashedSweep();
  assert.equal(s.start(1), 'allow');
  assert.equal(s.start(2), 'allow');
  assert.equal(s.retry(1, 'r1').status, 0);
  assert.equal(s.start(1), 'allow');
  ageTranscript(s.cfg, 'r1', { stamps: 11, file: 0 });
  transcripts({ r1b: [[0, 100, 0, 0]] }, {}, s.cfg);
  const done = logOutcome(s, ['r1b', 'r2'], s.cfg);
  assert.equal(done.status, 0, done.stdout);
  assert.match(done.stdout, /r1 wrote after its retry was logged[\s\S]*not dead/);
  // 1.21.0 handoff item 34: it is in the log too, where the trial review and the summary read.
  const out = approvalLog(s.dir).pop();
  assert.equal(out.roles[0].crashedAlive, true);
  assert.equal(out.roles[1].crashedAlive, undefined);
});

// T3: the retry rules with nothing that could fail.
// why: guards rule:sweep-tiers
test('T3: a retry after a cut short is refused, and an owner yes prints the Sweep line', () => {
  const s = crashedSweep();
  assert.equal(approveIn(s.dir, [s.f, '--outcome', '--cut-short']).status, 0);
  assert.match(s.retry(1, 'r1').stdout, /no cleared sweep is open/);
  const a = approveRun(askContract());
  assert.match(approveIn(a.dir, [a.f, '--owner-yes', 'yes go']).stdout, /Sweep: [0-9a-f]{16} role/);
});

// why: guards rule:sweep-auto-approval
test('T3: a brief held as a list of text parts still names its sweep', () => {
  const s = crashedSweep();
  const f = path.join(s.cfg, 'projects', 'C--repo', 'session-1', 'subagents', 'agent-r1.jsonl');
  const lines = read(f).split('\n');
  const first = JSON.parse(lines[0]);
  first.message.content = [{ type: 'text', text: first.message.content }];
  lines[0] = JSON.stringify(first);
  fs.writeFileSync(f, lines.join('\n'));
  ageTranscript(s.cfg, 'r1', { stamps: 11, file: 11 });
  const r = s.retry(1, 'r1');
  assert.equal(r.status, 0, r.stdout);
});

// why: guards rule:sweep-auto-approval
test('--agents auto finds this sweep\'s reviewers from their briefs, in role order, and leaves the rest out', () => {
  const { r, o, ids, n } = autoSweep(({ cfg, hash }) => {
    transcripts({ other: [[0, 999999, 0, 0]] }, {}, cfg);
    setBrief(cfg, 'other', (b) => `${b} Sweep: ${'0'.repeat(16)} role 1`);
    transcripts({ helper: [[0, 999999, 0, 0]] }, { helper: { agentType: 'general-purpose' } }, cfg);
    setBrief(cfg, 'helper', (b) => `${b} Sweep: ${hash} role 1`);
  });
  assert.equal(o.status, 0, o.stdout + o.stderr);
  const line = approvalLog(r.dir).pop();
  assert.equal(line.kind, 'outcome');
  assert.deepEqual(line.roles.map((x) => x.agent), ids);
  assert.equal(line.tokens, n * 1000);
});

// why: guards rule:sweep-auto-approval
test('--agents auto logs nothing when the briefs do not add up to the contract\'s roles', () => {
  const { r, o, ids } = autoSweep(({ cfg, ids: all }) => {
    const f = path.join(cfg, 'projects', 'C--repo', 'session-1', 'subagents', `agent-${all[0]}.jsonl`);
    fs.rmSync(f);
  });
  assert.equal(o.status, 1, o.stdout);
  assert.match(o.stdout, new RegExp(`found ${ids.length - 1} reviewer`));
  assert.match(o.stdout, /Nothing logged/);
  assert.notEqual(approvalLog(r.dir).pop().kind, 'outcome');
});

// why: guards rule:sweep-tiers
test('--agents auto skips a transcript left over from before the clearance', () => {
  const { o } = autoSweep(({ cfg, ids: all }) => {
    const f = path.join(cfg, 'projects', 'C--repo', 'session-1', 'subagents', `agent-${all[0]}.jsonl`);
    fs.utimesSync(f, new Date(0), new Date(0));
  });
  assert.equal(o.status, 1, o.stdout);
  assert.match(o.stdout, /found \d+ reviewer/);
});

// why: guards rule:sweep-auto-approval
test('a brief that names a sweep runs as a reviewer, whatever type it asks for', () => {
  const dir = sweepRepo();
  const named = sweepGuard(dir, { tool_input: { subagent_type: 'general-purpose', prompt: `look. Sweep: ${'0'.repeat(16)} role 1` } });
  assert.equal(named.permissionDecision, 'deny');
  assert.match(named.permissionDecisionReason, /reviewer role/);
  assert.equal(sweepGuard(dir, { tool_input: { subagent_type: 'general-purpose', prompt: 'look around' } }).permissionDecision, 'allow');
});

// why: guards rule:sweep-auto-approval
test('--none-ran refuses when a transcript names the sweep, though no slot was taken', () => {
  const r = approveRun(featureContract());
  const hash = approvalLog(r.dir).pop().hash;
  const cfg = transcripts({ slotless: [[0, 5000000, 0, 0]] });
  setBrief(cfg, 'slotless', (b) => `${b} Sweep: ${hash} role 1`);
  const none = approveIn(r.dir, [r.f, '--outcome', '--none-ran'], { CLAUDE_CONFIG_DIR: cfg });
  assert.equal(none.status, 1, none.stdout);
  assert.match(none.stdout, /reviewer transcript/);
  assert.notEqual(approvalLog(r.dir).pop().kind, 'outcome');
});

// why: guards rule:sweep-auto-approval
test('an owner yes on an older ask waits for the outcome of the sweep approved after it', () => {
  const dir = sweepRepo();
  const b = path.join(dir, 'sweeps', 'b.json');
  const big = featureContract();
  big.roles[0].calls = 31;
  fs.writeFileSync(b, JSON.stringify(big));
  assert.equal(approveIn(dir, [b]).status, 1);
  const a = approveRun(featureContract(), dir);
  assert.equal(a.status, 0, a.stdout);
  const yes = approveIn(dir, [b, '--owner-yes', 'yes go']);
  assert.equal(yes.status, 1, yes.stdout);
  assert.match(yes.stdout, /outcome of the last approved sweep first/);
});

// why: guards rule:outward-acts. R6.2 (the 1.25.0 sweep): no test reached the refusal of a tap that already answered
// an ask (the C10 test stops at "already logged", one check earlier). One pop-up answer is for one ask: when the
// branch moves on and the same contract is asked again, the old tap, still newer than that ask, does not clear it.
test('R6.2: a pop-up Yes that answered one ask does not answer the next ask of the same contract', () => {
  const r = approveRun(askContract());
  const code = r.stdout.match(/`sweep yes ([0-9a-f]{6})`/)[1];
  const cfg = makeTemp('cfg-');
  ownerTaps(cfg, r.dir, `sweep yes ${code}`, { at: new Date(Date.now() + 20000).toISOString() });
  assert.equal(approveIn(r.dir, [r.f, '--owner-yes'], tapEnv(cfg)).status, 0);
  fs.writeFileSync(path.join(r.dir, 'later.md'), 'later\n');
  commitAll(r.dir, 'later on the branch', true);
  assert.equal(approveIn(r.dir, [r.f, '--outcome', '--none-ran']).status, 0, 'the first sweep is closed');
  const again = approveIn(r.dir, [r.f]);
  const second = approveIn(r.dir, [r.f, '--owner-yes'], tapEnv(cfg));
  assert.equal(second.status, 1, again.stdout + second.stdout);
  assert.match(second.stdout, /that Yes already answered an ask/, again.stdout);
  assert.equal(approvalLog(r.dir).filter((e) => e.kind === 'owner-yes').length, 1);
});

// T10 sweep floor (build 18, with I9, I7 and J-R1): the floor read line counts and added files, so the 1.43.1 test
// split (20,801 moved lines, a build record) went to the owner, and a one-line CI change could pass as a fix. The
// floor now comes from what the diff touches: gate code (CI, git hooks, a guard, the kit's hooks and tools, install,
// this script) is feature work with the security modifier; docs, records, maps and tests moved unchanged stay triage
// at any size; a dependency file in any ecosystem adds the supply-chain role.
// why: guards rule:sweep-tiers (the tier follows what the change can break, not its length)
test('the floor comes from what the diff touches: gate code is a secured feature, records and moved tests stay triage', () => {
  const one = { tier: 'triage', modifiers: [], roles: [role('triage', 'Any secret or personal data in the diff?')] };
  const asFix = { tier: 'fix', modifiers: [], roles: [role('fix-root', 'Does the fix remove the root, and does it hold?'), role('blast-radius', 'Which callers does the change reach?')] };
  // Gate code: a fix contract asks, and a feature contract without the security roles is sent back.
  const ci = sweepRepo({ '.github/workflows/ci.yml': 'on: push\n' });
  const asked = approveRun(asFix, ci);
  assert.notEqual(asked.status, 0, asked.stdout);
  assert.match(asked.stdout, /needs 3 security role/, 'and the security roles the modifier brings');
  assert.match(asked.stdout, /\.github\/workflows\/ci\.yml is gate code/);
  const plain = featureContract();
  plain.roles = plain.roles.filter((r) => r.kind !== 'security');
  const thin = approveRun(plain, sweepRepo({ '.githooks/pre-push': 'exit 0\n' }));
  assert.equal(thin.status, FIX_EXIT, thin.stdout);
  assert.match(thin.stdout, /needs 3 security role/);
  // A release's record, changelog and version, however long, are triage (I9: a json under docs/ is no source file).
  const record = sweepRepo({ 'docs/builds/1.0.1.json': `${JSON.stringify({ lines: Array.from({ length: 80 }, (_, i) => `line ${i}`) }, null, 1)}\n`, 'CHANGELOG.md': '## 1.0.1\n', VERSION: '1.0.1\n' });
  const rec = approveRun(one, record);
  assert.equal(rec.status, 0, rec.stdout);
  // A test file moved unchanged is triage at any length; a test that gains 21 new lines is not.
  const moved = makeTemp('approve-');
  g(moved, 'init', '-q', '-b', 'main');
  const body = Array.from({ length: 40 }, (_, i) => `test('t${i}', () => {});`).join('\n') + '\n';
  fs.mkdirSync(path.join(moved, 'tests'));
  fs.writeFileSync(path.join(moved, 'tests', 'all.test.mjs'), `import { test } from 'node:test';\n${body}`);
  commitAll(moved, 'base', true);
  g(moved, 'checkout', '-q', '-b', 'refactor/split');
  fs.rmSync(path.join(moved, 'tests', 'all.test.mjs'));
  const lines = body.split('\n').filter(Boolean);
  fs.writeFileSync(path.join(moved, 'tests', 'a.test.mjs'), `import { test } from 'node:test';\n${lines.slice(0, 20).join('\n')}\n`);
  fs.writeFileSync(path.join(moved, 'tests', 'b.test.mjs'), `import { test } from 'node:test';\n${lines.slice(20).join('\n')}\n`);
  commitAll(moved, 'split', true);
  fs.mkdirSync(path.join(moved, 'sweeps'));
  const split = approveRun(one, moved);
  assert.equal(split.status, 0, split.stdout);
  approveIn(moved, [split.f, '--outcome', '--none-ran']);
  fs.appendFileSync(path.join(moved, 'tests', 'b.test.mjs'), Array.from({ length: 21 }, (_, i) => `test('new ${i}', () => {});`).join('\n') + '\n');
  commitAll(moved, 'more', true);
  const grown = approveRun(one, moved);
  assert.equal(grown.status, 1, grown.stdout);
  assert.match(grown.stdout, /more than a triage change/);
  // I7: a Maven, Gradle, .NET or PHP dependency file needs the supply-chain role too.
  for (const f of ['pom.xml', 'build.gradle.kts', 'src/App.csproj', 'composer.json']) {
    assert.match(approveRun(featureContract(), sweepRepo({ 'src/sync.ts': 'x\n', [f]: '<x/>\n' })).stdout, /supply-chain/i, f);
  }
});

// Found in the build 18 security review: the floor read a removed line "-- a/docs/x.md" inside a hunk as a file header
// and skipped the code after it; any docs/ folder, code included, was data; a .claude settings or bounds file was no
// gate code; and moved test lines cancelled as a set, so one removed line hid any number of added copies.
// why: guards rule:sweep-tiers (the tier follows what the change can break, and the diff is read the way git wrote it)
test('the floor reads the diff the way git wrote it: hunk text, nested docs code, .claude data and copied test lines count', () => {
  const one = { tier: 'triage', modifiers: [], roles: [role('triage', 'Any secret or personal data in the diff?')] };
  const asFix = { tier: 'fix', modifiers: [], roles: [role('fix-root', 'Does the fix remove the root, and does it hold?'), role('blast-radius', 'Which callers does the change reach?')] };
  // A branch that changes files already on main, so no new file decides the tier on its own.
  const changed = (base, next) => {
    const dir = makeTemp('approve-');
    g(dir, 'init', '-q', '-b', 'main');
    for (const [f, text] of Object.entries(base)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); }
    commitAll(dir, 'base', true);
    g(dir, 'checkout', '-q', '-b', 'fix/x');
    for (const [f, text] of Object.entries(next)) {
      if (text === null) fs.rmSync(path.join(dir, f));
      else { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); }
    }
    commitAll(dir, 'change', true);
    fs.mkdirSync(path.join(dir, 'sweeps'));
    return dir;
  };
  const code = Array.from({ length: 25 }, (_, i) => `select ${i};`).join('\n') + '\n';
  const header = approveRun(one, changed({ 'src/q.sql': '-- a/docs/x.md\n' }, { 'src/q.sql': code }));
  assert.equal(header.status, 1, `a removed "-- a/docs/x.md" is hunk text, not a header: ${header.stdout}`);
  assert.match(header.stdout, /more than a triage change/);
  const nested = approveRun(one, changed({ 'src/docs/run.mjs': 'x\n' }, { 'src/docs/run.mjs': code }));
  assert.equal(nested.status, 1, `code under a nested docs/ folder is source: ${nested.stdout}`);
  const settings = approveRun(asFix, changed({ '.claude/settings.json': '{}\n' }, { '.claude/settings.json': '{"hooks":{}}\n' }));
  assert.match(settings.stdout, /\.claude\/settings\.json is gate code/);
  const copies = approveRun(one, changed({ 'tests/a.test.mjs': 'x();\n' }, { 'tests/a.test.mjs': null, 'tests/b.test.mjs': 'x();\n'.repeat(25) }));
  assert.equal(copies.status, 1, `one removed line cancels one added copy, not 25: ${copies.stdout}`);
  // The build 18 sweep: a gate file renamed out of its folder, a script a CI workflow runs, a .claude command file,
  // code git shows as binary, and test lines moved out of a test file that stays.
  const hook = '#!/bin/sh\nexit 0\n';
  assert.match(approveRun(asFix, changed({ '.githooks/pre-push': hook }, { '.githooks/pre-push': null, 'docs/pre-push.txt': hook })).stdout, /\.githooks\/pre-push is gate code/);
  const flow = 'on: push\njobs:\n  t:\n    steps:\n      - run: node scripts/check.mjs\n';
  assert.match(approveRun(asFix, changed({ '.github/workflows/ci.yml': flow, 'scripts/check.mjs': 'x\n' }, { 'scripts/check.mjs': 'process.exit(0);\n' })).stdout, /scripts\/check\.mjs is gate code/);
  assert.match(approveRun(asFix, changed({ '.claude/commands/go.md': 'x\n' }, { '.claude/commands/go.md': '---\nallowed-tools: Bash\n---\n' })).stdout, /\.claude\/commands\/go\.md is gate code/);
  const binary = approveRun(one, changed({ 'src/a.js': 'x\n' }, { 'src/a.js': `${code}// \0\n` }));
  assert.equal(binary.status, 1, `code with a NUL byte still counts its lines: ${binary.stdout}`);
  const body = Array.from({ length: 25 }, (_, i) => `assert.equal(f(${i}), ${i});`).join('\n') + '\n';
  const emptied = approveRun(one, changed({ 'tests/g.test.mjs': body }, { 'tests/g.test.mjs': 'x\n', 'tests/dead.test.mjs': `if (false) {\n${body}}\n` }));
  assert.equal(emptied.status, 1, `lines taken out of a test that stays are a changed test: ${emptied.stdout}`);
});

// CM6 (c), K170 (the S1 replay, reproduced on 1.47.0): the build 18 plan says shipped scripts and skills are fix work
// and only tests, docs, records and maps are triage, yet a one-line edit to a shipped script or a SKILL.md outside the
// gate files was approved as triage.
// why: catches a shipped script or skill change swept at the triage floor
test('a one-line change to a shipped script or a skill is fix work, not triage (CM6)', () => {
  const one = { tier: 'triage', modifiers: [], roles: [role('triage', 'Any secret or personal data in the diff?')] };
  const edit = (f, base, next) => {
    const dir = makeTemp('approve-');
    g(dir, 'init', '-q', '-b', 'main');
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), base);
    commitAll(dir, 'base', true);
    g(dir, 'checkout', '-q', '-b', 'fix/x');
    fs.writeFileSync(path.join(dir, f), next);
    commitAll(dir, 'change', true);
    fs.mkdirSync(path.join(dir, 'sweeps'));
    return approveRun(one, dir);
  };
  for (const f of ['scripts/mutation-check.mjs', 'src/app.py', 'user/skills/tdd/SKILL.md']) {
    const r = edit(f, 'a\n', 'b\n');
    assert.equal(r.status, 1, `${f}: ${r.stdout}`);
    assert.match(r.stdout, /shipped code or a skill .* is fix work, not triage/, f);
  }
  for (const f of ['docs/guide.md', 'README.md', 'tests/a.test.mjs']) assert.equal(edit(f, 'a\n', 'b\n').status, 0, f);
});
