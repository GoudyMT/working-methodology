// Tests for sweep approval, tiers, the size band, the hand-back canary and the sweep guard: moved word for word from tests/kit.test.mjs (T10, build 18).

// Tests for scripts/kit.mjs - each one drives the CLI functions the way the owner does:
// a fake kit, a fake ~/.claude and a fake project in a temp folder.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { install, foldBack, bump, scrub, snapshot, restore, status as kitStatus, mainProtection, sessionStartReport as kitSessionStart, preCompactReport, promptCheckReport, vaultBackup, projectSlug, newerReleases, lsRemoteCall, tagsOf, render, sourceHooks, measure, measureReal, headings, ledger, build, parseModule, findRules, guardDir, scratch as kitScratch } from '../scripts/kit.mjs';
// The status and session-start reports read the machine's Claude Code by default; a test names its own version, so the
// suite's result does not rest on which Claude Code is installed (the 1.23.0 sweep). A test of the version reads passes its own.
const status = (o) => kitStatus({ claudeVersion: () => '2.1.325 (Claude Code)', ...o });
const sessionStartReport = (o) => kitSessionStart({ claudeVersion: () => '2.1.325 (Claude Code)', ...o });

// Every temp folder a test makes lands under this one root, removed at exit: os.tmpdir() reads these on each call and children inherit them.
// kit-temp.cjs also removes it on a signal, and the next run sweeps it after a kill.
const tmpRoot = kitTemp.sessionRoot();
const { makeTemp } = kitTemp;

// A kit folder's CLI is scripts/kit.mjs with the temp helper it imports, as in every real kit folder.
function copyKitCli(kit) {
  fs.mkdirSync(path.join(kit, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(kit, 'project/.claude'), { recursive: true });
  fs.copyFileSync(path.resolve('scripts/kit.mjs'), path.join(kit, 'scripts/kit.mjs'));
  fs.copyFileSync(path.resolve('project/.claude/kit-temp.cjs'), path.join(kit, 'project/.claude/kit-temp.cjs'));
  // The guard launcher, which kit.mjs reads its record names and entries from (1.25.1).
  fs.mkdirSync(path.join(kit, 'user/kit-tools'), { recursive: true });
  fs.copyFileSync(path.resolve('user/kit-tools/kit-launch.cjs'), path.join(kit, 'user/kit-tools/kit-launch.cjs'));
  // The merge-on-green steps install prints (K61), which read row A27 as the merge gate does.
  for (const f of ['merge-on-green.mjs', 'safe-git.mjs']) fs.copyFileSync(path.resolve('scripts', f), path.join(kit, 'scripts', f));
  for (const f of ['merge-gate.mjs', 'kit-temp.cjs']) fs.copyFileSync(path.resolve('user/kit-tools', f), path.join(kit, 'user/kit-tools', f));
}

function makeKit() {
  const root = makeTemp('kit-');
  const kit = path.join(root, 'kit');
  const home = path.join(root, 'home');
  const proj = path.join(root, 'My App');
  const files = {
    'VERSION': '1.0.0\n',
    'CHANGELOG.md': '# Changelog\n',
    'kit.config.json': JSON.stringify({ ownerName: 'Pat', ownerProfileFile: 'owner-profile.md', thirdPartySkills: ['vendor-skill'] }),
    'owner-profile.md': '- Likes tests\n',
    'user/CLAUDE.md': '# Global\nOwner: {{OWNER_NAME}}\n{{OWNER_PROFILE}}\n',
    'user/agents/builder.md': 'builder role\n',
    'user/skills/human-factor/SKILL.md': 'skill\n',
    'project/_Working Standards.md': 'rules\n',
    'project/.claude/settings.json': '{"hook":"{{PROJECT_DIR}}/.claude/guard.cjs"}\n',
    'memory/MEMORY.md': '- [Style](style.md)\n',
    'memory/style.md': 'style rule\n',
  };
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(kit, rel)), { recursive: true });
    fs.writeFileSync(path.join(kit, rel), body);
  }
  fs.mkdirSync(proj);
  return { kit, home, proj };
}

const read = (p) => fs.readFileSync(p, 'utf8');

// A release install checks every byte against the release tag's tree (the 1.26.0 security review, S4), so a fixture
// that installs as a release commits its kit folder and hands over that commit's tree.
function released(kit, describe) {
  const g = (...a) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-C', kit, ...a], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  if (!fs.existsSync(path.join(kit, '.git'))) g('init', '-q', '-b', 'main');
  g('add', '-A');
  g('commit', '-q', '--allow-empty', '-m', describe);
  return { release: true, describe, tree: g('rev-parse', 'HEAD^{tree}') };
}

// The kit's own standards, checked the way Kit Standards #3 and #5 say: one home per rule, a why in every rule
// section, and size caps. These read the real rule modules in rules/, not a fixture.
const STANDARDS = () => fs.readdirSync(path.resolve('rules')).filter((n) => n.endsWith('.md')).sort()
  .map((n) => read(path.resolve('rules', n)).replace(/^---\n[\s\S]*?\n---\n/, '')).join('\n');
const words = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean);
const shingles = (w, n = 8) => { const s = new Set(); for (let i = 0; i + n <= w.length; i++) s.add(w.slice(i, i + n).join(' ')); return s; };

// Each format audit passes a clean piece and names every fault in a bad one.
const runAudit = (skill, text, args = [], cwd) => {
  const dir = makeTemp('audit-');
  const file = path.join(dir, 'piece.md');
  fs.writeFileSync(file, text);
  return spawnSync('node', [path.resolve('user/skills', skill, 'audit.mjs'), file, ...args], { encoding: 'utf8', cwd: cwd || dir });
};

// Plan rule-modules, Phase 2 guards. Each is driven the way Claude Code runs it (hook input as JSON on stdin) and
// proved with a known-good and a known-bad case.
const runHook = (script, input, env = {}) => spawnSync('node', [path.resolve(script)], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, ...env } });
function gitTree() {
  const dir = makeTemp('fence-');
  const g = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  g('init', '-q', '-b', 'main'); fs.writeFileSync(path.join(dir, 'a.js'), 'a\n'); g('add', '-A'); g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  return dir;
}

// Plan agent-canary: each kit agent opens every message to its tasker with a phrase it can only learn by reading
// the project's rules block itself. The fixtures use a made-up phrase; the real one has a single home in the kit.
const FAKE_PHRASE = 'Tango Lima Seven Delta';
const phraseLine = (p) => `Confirmation phrase: open your first message to whoever started you, and every message after it, with: ${p}\n`;
function canaryRepo(phrase = FAKE_PHRASE) {
  const dir = gitTree();
  fs.mkdirSync(path.join(dir, 'standards'));
  if (phrase) fs.writeFileSync(path.join(dir, 'standards', 'agent-teams.md'), `# Rules\n\n\`\`\`\nRULES EVERY AGENT FOLLOWS\n${phraseLine(phrase)}\`\`\`\n`);
  return dir;
}
const canary = (input) => runHook('user/kit-hooks/canary.cjs', input);
const canaryLog = (dir) => {
  const f = path.join(spawnSync('git', ['-C', dir, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).stdout.trim(), 'kit-canary.log');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
};

// The kit stays local (rule:kit-stays-local): the install keeps every kit path out of git in the folder's own
// exclude file, so the kit is there to use but never committed unless the owner tracks a file on purpose.
const g = (dir, ...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
// noVerify stands for a tool that skips the git hooks, so a slip still reaches history and the first push check must find it.
// Test commits use the house style, so the kit's commit-msg hook (rule:commit-message-format) lets them through.
const commitAll = (dir, msg, noVerify) => { g(dir, 'add', '-A'); return g(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', /^[a-z]+: /.test(msg) ? msg : `chore: ${msg}`, ...(noVerify ? ['--no-verify'] : [])); };
function localProject() {
  const dir = makeTemp('local-');
  g(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'main.py'), 'print(1)\n');
  return dir;
}
const excludeFile = (dir) => path.join(dir, '.git', 'info', 'exclude');
const kitInstall = (dir) => install({ kit: path.resolve('.'), target: 'project', projectDir: dir, home: makeTemp('home-') });

// Sweep auto-approval (rule:sweep-auto-approval): a script approves a Swarm Contract that stays inside the tier's
// rules, at no token cost, logs every decision, and hands back to the owner on anything outside them. The review of
// its first version showed an agent could clear its own pause, raise its own caps and pick a lighter tier, so the
// log has a fixed home, the caps only go down, the diff sets the floor, and only the owner's own terminal resumes.
const APPROVE = path.resolve('user/skills/pre-pr-sweep/approve.mjs');
const FIX_EXIT = 3;
const role = (kind, question, extra = {}) => ({ role: `${kind} reviewer`, kind, question, context: [`src/${kind}.ts`, 'rule:pre-pr-deep-sweep'], finding: 'file:line, the scenario, the proof', calls: 5, ...extra });
const featureContract = () => ({ tier: 'feature', modifiers: [], roles: [
  role('security', 'Can a crafted import file reach storage without validation?', { context: ['src/import.ts'] }),
  role('security', 'Does any new route leak personal data in logs or errors?', { context: ['src/routes.ts'] }),
  role('security', 'Is the lock screen bypassable by restoring an old backup?', { context: ['src/lock.ts'] }),
  role('test-value', 'Does each new test guard a real use through its real seam?'),
  role('novel-lens', 'What did every other role structurally miss?'),
] });
// A contract the script sends to the owner on sweepRepo's branch: a fix tier on a change that adds source.
const askContract = () => ({ tier: 'fix', modifiers: [], roles: [
  role('fix-root', 'Does the fix remove the root cause, and does it hold?'),
  role('blast-radius', 'Which callers and copies of this code does the change reach?'),
  role('test-value', 'Does each changed test fail without the fix?'),
] });
// A branch with one feature commit on top of main: a new source file and a test.
function sweepRepo(files = { 'src/sync.ts': 'export const sync = 1;\n', 'src/sync.test.ts': 'test\n' }) {
  const dir = makeTemp('approve-');
  g(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'README.md'), 'x\n');
  commitAll(dir, 'base', true);
  g(dir, 'checkout', '-q', '-b', 'feat/sync');
  for (const [f, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), text); }
  commitAll(dir, 'feature', true);
  fs.mkdirSync(path.join(dir, 'sweeps'));
  return dir;
}
// T2 (the owner 2026-11-10: "Pop-up record"): the owner's yes and resume are their tap on a Claude Code choice pop-up,
// read from the session's own transcript. Where a test stands for the owner saying yes or resuming, the owner taps Yes
// on the pop-up that quotes the ask's or the pause's act, and the call runs in that session.
const TAP_SID = '0aaaaaaa-1bbb-2ccc-3ddd-4eeeeeeeeeee';
// One answered pop-up, as Claude Code writes it in the session's transcript (shape read from a live record).
function ownerTaps(cfg, dir, act, { answer = 'Yes', labels = ['Yes', 'No'], at = new Date(Date.now() + 1000).toISOString(), source = 'user_temporary', sid = TAP_SID, folder, bare = false } = {}) {
  const where = path.join(cfg, 'projects', folder || fs.realpathSync.native(dir).replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(where, { recursive: true });
  const id = `toolu_${crypto.randomBytes(6).toString('hex')}`;
  // bare: the question names the act without backticks, as build 11's first resume pop-ups did.
  const question = bare ? `May I go on? ${act}` : `May I go on? \`${act}\``;
  const questions = [{ question, header: 'Owner yes', multiSelect: false, options: labels.map((label) => ({ label, description: '' })) }];
  fs.appendFileSync(path.join(where, `${sid}.jsonl`), [
    { type: 'assistant', isSidechain: false, timestamp: at, message: { content: [{ type: 'tool_use', id, name: 'AskUserQuestion', input: { questions } }] } },
    { type: 'user', isSidechain: false, timestamp: at, permissionDecision: { decision: 'accept', source }, toolUseResult: { questions, answers: { [question]: answer } }, message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'answered' }] } },
  ].map((l) => JSON.stringify(l)).join('\n') + '\n');
}
const tapEnv = (cfg) => ({ CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: TAP_SID, CLAUDECODE: '1' });
function asOwner(dir, args, env) {
  const owner = !('CLAUDECODE' in env) && !('AI_AGENT' in env) && !('CLAUDE_CODE_SESSION_ID' in env);
  const yes = owner && args.includes('--owner-yes') && filledWords(args[args.indexOf('--owner-yes') + 1]);
  const resume = owner && args.includes('--resume') && env.KIT_OWNER_RESUME === '1';
  if (!yes && !resume) return null;
  const log = sweepLog(dir);
  let act;
  if (yes) {
    const f = path.resolve(dir, args[0]);
    const ask = log.map((l) => JSON.parse(l)).filter((e) => e.kind === 'decision' && path.resolve(e.contract) === f).pop();
    if (!ask) return null;
    act = `sweep yes ${String(ask.hash).slice(0, 6)}`;
  } else {
    const i = log.map((l) => JSON.parse(l).kind).lastIndexOf('pause');
    if (i < 0) return null;
    act = `sweep resume ${crypto.createHash('sha256').update(log[i]).digest('hex').slice(0, 6)}`;
  }
  const cfg = env.CLAUDE_CONFIG_DIR || makeTemp('cfg-');
  ownerTaps(cfg, dir, act);
  const out = yes ? [...args.slice(0, args.indexOf('--owner-yes')), '--owner-yes', ...args.slice(args.indexOf('--owner-yes') + 2)] : ['--resume'];
  const { KIT_OWNER_RESUME: _r, ...rest } = env;
  return spawnSync('node', [APPROVE, ...out], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH, ...rest, ...tapEnv(cfg) } });
}
const filledWords = (w) => typeof w === 'string' && w.trim().split(/\s+/).filter(Boolean).length >= 1 && w.trim().length > 1;
const approveIn = (dir, args, env = {}) => {
  const owner = asOwner(dir, args, env);
  if (owner) return owner;
  if (args.includes('--outcome') && env.CLAUDE_CONFIG_DIR) leadBriefs(dir, args, env.CLAUDE_CONFIG_DIR);
  // A crashed reviewer was started by the guard too.
  const crashed = args.includes('--retry') && args[args.indexOf('--crashed') + 1];
  if (crashed && env.CLAUDE_CONFIG_DIR) startedByBrief(dir, env.CLAUDE_CONFIG_DIR, crashed);
  return spawnSync('node', [APPROVE, ...args], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH, ...env } });
};
// What a lead does: each reviewer's brief carries "Sweep: <hash> role <n>" for the contract cleared last, n in the
// order --agents lists them. A brief that already names a sweep is left as the test wrote it.
const sweepLog = (dir) => { try { return read(path.join(dir, '.git', 'kit-sweep-approvals.jsonl')).split('\n').filter(Boolean); } catch { return []; } };
const lastClearing = (dir, contract) => {
  const lines = sweepLog(dir).map((l) => [l, JSON.parse(l)]).filter(([, e]) => (e.kind === 'decision' || e.kind === 'owner-yes') && (!contract || path.resolve(e.contract) === path.resolve(contract)));
  // For an outcome, the reviewers ran under the last clearing (an approval or the owner's yes), not a later ask.
  return (contract && lines.filter(([, e]) => e.kind === 'owner-yes' || e.decision === 'approved').pop()) || lines.pop();
};
function setBrief(cfg, id, text) {
  for (const p of fs.readdirSync(path.join(cfg, 'projects'))) for (const s of fs.readdirSync(path.join(cfg, 'projects', p))) {
    const f = path.join(cfg, 'projects', p, s, 'subagents', `agent-${id}.jsonl`);
    if (!fs.existsSync(f)) continue;
    const lines = read(f).split('\n');
    const first = JSON.parse(lines[0]);
    if (!first.message || first.message.role !== 'user' || typeof first.message.content !== 'string' || first.message.content.includes('Sweep:')) continue;
    first.message.content = text(first.message.content);
    lines[0] = JSON.stringify(first);
    fs.writeFileSync(f, lines.join('\n'));
  }
}
function leadBriefs(dir, args, cfg) {
  const at = lastClearing(dir, args[0]);
  const ids = String(args[args.indexOf('--agents') + 1] || '').split(',');
  if (!at || !args.includes('--agents') || !fs.existsSync(path.join(cfg, 'projects'))) return;
  ids.forEach((id, i) => { if (/^[\w-]+$/.test(id)) setBrief(cfg, id, (b) => `${b} Sweep: ${at[1].hash} role ${i + 1}`); });
  // --agents auto: the lead started every reviewer whose brief it wrote.
  const all = ids[0] === 'auto' ? fs.readdirSync(path.join(cfg, 'projects')).flatMap((p) => fs.readdirSync(path.join(cfg, 'projects', p)).flatMap((s) => { try { return fs.readdirSync(path.join(cfg, 'projects', p, s, 'subagents')); } catch { return []; } })).map((n) => (n.match(/^agent-(.+)\.jsonl$/) || [])[1]).filter(Boolean) : ids;
  for (const id of all) startedByBrief(dir, cfg, id);
}
// The guard started a reviewer under the clearing and role its brief names.
function startedByBrief(dir, cfg, id) {
  let f = /^[\w-]+$/.test(id) && fs.existsSync(path.join(cfg, 'projects')) && transcriptOf(cfg, id);
  // The guard starts only the reviewer type; another type with a sweep's brief is refused.
  try { if (f && !/reviewer$/i.test(JSON.parse(read(f.replace(/\.jsonl$/, '.meta.json'))).agentType)) f = null; } catch { f = null; }
  const content = f && JSON.parse(read(f).split('\n')[0]).message?.content;
  const tag = f && (Array.isArray(content) ? content.map((x) => (x && x.text) || '').join('\n') : String(content || '')).match(/Sweep: ([0-9a-f]{16}) role (\d+)/);
  const clearing = tag && sweepLog(dir).filter((l) => { const e = JSON.parse(l); return e.hash === tag[1] && (e.kind === 'owner-yes' || e.decision === 'approved'); }).pop();
  if (clearing) guardStart(dir, clearing, Number(tag[2]), id);
}
const transcriptOf = (cfg, id) => {
  for (const p of fs.readdirSync(path.join(cfg, 'projects'))) for (const s of fs.readdirSync(path.join(cfg, 'projects', p))) {
    const f = path.join(cfg, 'projects', p, s, 'subagents', `agent-${id}.jsonl`);
    if (fs.existsSync(f)) return f;
  }
  return null;
};
// What the guard does at each start: the role's slot under the clearing records the start's tool id, which Claude
// Code also writes into the reviewer's meta file (toolu_lead_<id> in these transcripts). Tests try several reviewers
// for one role in turn, so a start this helper wrote gives way to the next; one the real guard wrote stays. A
// reviewer other than the crashed one, after a logged retry for its role, takes the retry slot.
function guardStart(dir, clearingLine, role, id) {
  const slots = path.join(dir, '.git', 'kit-sweep-starts', crypto.createHash('sha256').update(clearingLine).digest('hex').slice(0, 16));
  fs.mkdirSync(slots, { recursive: true });
  const retried = sweepLog(dir).some((l) => { const e = JSON.parse(l); return e.kind === 'retry' && e.role === role && e.crashed !== id; });
  const f = path.join(slots, retried ? `${role - 1}.retry` : String(role - 1));
  if (!fs.existsSync(f) || !read(f) || read(f).startsWith('toolu_lead_')) fs.writeFileSync(f, `toolu_lead_${id}`);
}

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

function approveRun(contract, dir = sweepRepo()) {
  const f = path.join(dir, 'sweeps', 'contract.json');
  fs.writeFileSync(f, JSON.stringify(contract));
  return { ...approveIn(dir, [f]), dir, f };
}
const approvalLog = (dir) => read(path.join(dir, '.git', 'kit-sweep-approvals.jsonl')).trim().split('\n').map((l) => JSON.parse(l));
// A fake Claude config folder holding one reviewer transcript per agent id, where approve.mjs reads what each role
// spent (the meter is processed tokens from the role's own transcript). Each call is [input, cache read, cache
// write, output]; a call given as { id, u } keeps its message id, so streaming's repeated lines can be written.
// Beside each transcript sits Claude Code's agent-<id>.meta.json (agent type, finished); `meta` overrides it per id,
// and `cfg` adds to an existing folder.
// `models` gives an id's calls a model other than the top one (roleModels(contract) maps ids to their roles' models).
function transcripts(spec, meta = {}, cfg = makeTemp('cfg-'), session = 'session-1', models = {}) {
  const dir = path.join(cfg, 'projects', 'C--repo', session, 'subagents');
  fs.mkdirSync(dir, { recursive: true });
  const base = Date.now();
  for (const [id, calls] of Object.entries(spec)) {
    let model = models[id] || 'claude-opus-5-5';
    // A call given as { u, gap } starts gap ms after the line before it (the cache outlives a short gap only).
    let shift = 0;
    const at0 = new Date(base).toISOString();
    const lines = calls.map((c, i) => {
      if (c && c.gap) shift += c.gap;
      const at = new Date(base + shift).toISOString();
      // { refused: text } is a hook's refusal of a tool call, as Claude Code writes it into the transcript.
      if (c && c.refused) return JSON.stringify({ type: 'user', uuid: `${id}-${i}`, timestamp: at, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${i}`, is_error: true, content: c.refused }] } });
      // { handback: text } is the reviewer's report, handed back through the hand-back tool.
      // { handback, refusedWith } is a hand-back the canary refused: the call and its error result.
      if (c && c.handback && c.refusedWith) return [JSON.stringify({ type: 'assistant', uuid: `${id}-${i}`, timestamp: at, message: { id: `msg_${id}_${i}`, role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: `toolu_r${i}`, name: 'SubagentHandback', input: { message: c.handback } }], usage: { input_tokens: 0, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0, output_tokens: 0 } } }),
        JSON.stringify({ type: 'user', uuid: `${id}-${i}r`, timestamp: at, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_r${i}`, is_error: true, content: c.refusedWith }] } })].join('\n');
      if (c && c.handback) return JSON.stringify({ type: 'assistant', uuid: `${id}-${i}`, timestamp: at, message: { id: `msg_${id}_${i}`, role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: `toolu_h${i}`, name: 'SubagentHandback', input: { message: c.handback } }], usage: { input_tokens: 0, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0, output_tokens: 0 } } });
      // { read: text } is a tool's plain answer, such as a file the reviewer read.
      if (c && c.read) return JSON.stringify({ type: 'user', uuid: `${id}-${i}`, timestamp: at, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${i}`, content: c.read }] } });
      const { id: mid = `msg_${id}_${i}`, u = c, model: m = models[id] || 'claude-opus-5-5' } = Array.isArray(c) ? { u: c } : c;
      model = m;
      return JSON.stringify({ type: 'assistant', uuid: `${id}-${i}`, timestamp: at, message: { id: mid, role: 'assistant', model: m, usage: { input_tokens: u[0], cache_read_input_tokens: u[1], cache_creation_input_tokens: u[2], output_tokens: u[3] } } });
    });
    fs.writeFileSync(path.join(dir, `agent-${id}.jsonl`), [JSON.stringify({ type: 'user', timestamp: at0, message: { role: 'user', content: 'brief' } }), ...lines].join('\n') + '\n');
    fs.writeFileSync(path.join(dir, `agent-${id}.meta.json`), JSON.stringify({ agentType: 'reviewer', toolUseId: `toolu_lead_${id}`, model: /sonnet/.test(model) ? 'sonnet' : 'opus', finished: true, ...(meta[id] || {}) }));
  }
  return cfg;
}
let agentSeq = 0;
const roleModel = (r) => r.model ?? (['security', 'novel-lens'].includes(r.kind) ? 'claude-opus-5-5' : 'claude-sonnet-5-5');
const roleModels = (ids, roles) => Object.fromEntries(ids.map((id, i) => [id, roleModel(roles[i])]));
// Logs a sweep's outcome with one transcript per role, the given total split across them.
function outcome(r, tokens = '200000', findings = '6', real = '5', dup = '0', extra = []) {
  const roles = JSON.parse(read(r.f)).roles || [];
  const n = roles.length;
  const ids = Array.from({ length: n }, () => `t${++agentSeq}`);
  const each = Math.floor(Number(tokens) / n);
  // Each transcript runs on the model its role names, as a real reviewer does.
  const cfg = transcripts(Object.fromEntries(ids.map((id, i) => [id, [{ model: roleModel(roles[i]), u: [0, each + (i ? 0 : Number(tokens) - each * n), 0, 0] }]])));
  return approveIn(r.dir, [r.f, '--outcome', '--agents', ids.join(','), '--findings', findings, '--real', real, '--duplicates', dup, ...extra], { CLAUDE_CONFIG_DIR: cfg });
}

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

// The one-sweep loop gives each branch one sweep, so a test that runs a later sweep runs it as a later branch would:
// a new branch off main with its own change. The contracts in sweeps/ come along, as they would in a real project.
let branchSeq = 0;
function nextBranch(dir, file) {
  const keep = path.join(dir, 'sweeps');
  const saved = fs.existsSync(keep) ? fs.readdirSync(keep, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => [e.name, fs.readFileSync(path.join(keep, e.name))]) : [];
  const n = ++branchSeq;
  assert.equal(g(dir, 'checkout', '-q', '-f', '-b', `feat/next-${n}`, 'main').status, 0);
  fs.mkdirSync(keep, { recursive: true });
  for (const [name, bytes] of saved) fs.writeFileSync(path.join(keep, name), bytes);
  const rel = file || `src/next${n}.ts`;
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), `next ${n}\n`);
  g(dir, 'add', rel);
  g(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', `feat: next ${n}`, '--no-verify');
}

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

// Found in a course project (2026-10-30): the lead asked the owner to approve a sweep team before running the
// script, and the owner approved a team that broke the security floor. The script now runs first and writes the
// owner's notice from checked data, and a guard refuses a reviewer agent until the log clears this HEAD.
// The lead numbers each brief: the first role of the last clearing with this cap that has not started.
function leadTag(dir, prompt) {
  const at = lastClearing(dir);
  const cap = prompt.match(/Call cap: (\d+)/);
  if (!at || !cap) return '';
  const [line, e] = at;
  const slots = path.join(dir, '.git', 'kit-sweep-starts', crypto.createHash('sha256').update(line).digest('hex').slice(0, 16));
  const team = Number(e.agents) || 0;
  const fits = [...Array(team).keys()].filter((n) => !Array.isArray(e.calls) || e.calls[n] === Number(cap[1]));
  const n = fits.find((k) => !fs.existsSync(path.join(slots, String(k)))) ?? fits[0] ?? 0;
  // The lead copies the role's token ceiling from the start notice too (M22 C).
  const ceiling = Array.isArray(e.ceilings) && !/Token ceiling: \d+/.test(prompt) ? ` Token ceiling: ${e.ceilings[n]}.` : '';
  return ` Sweep: ${e.hash} role ${n + 1}${ceiling}`;
}
// The lead also puts the role's own question in its brief; raw leaves a test's prompt as written.
function leadQuestion(dir, prompt) {
  const tag = prompt.match(/Sweep: [0-9a-f]{16} role (\d+)/);
  const at = lastClearing(dir);
  if (!tag || !at) return '';
  try { return ` ${(JSON.parse(read(at[1].contract)).roles[Number(tag[1]) - 1] || {}).question || ''}`; } catch { return ''; }
}
const sweepGuard = (dir, { raw, noCeiling, ...extra } = {}) => {
  const input = { cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'reviewer', prompt: 'review. Call cap: 5.' }, ...extra };
  const p = input.tool_input && input.tool_input.prompt;
  if (typeof p === 'string' && !p.includes('Sweep:')) input.tool_input = { ...input.tool_input, prompt: p + leadTag(dir, p) };
  // A brief that names its sweep already gets the token ceiling of the role it names, as the lead copies it.
  else if (!noCeiling && typeof p === 'string' && !/Token ceiling: \d+/.test(p)) {
    const tag = p.match(/Sweep: ([0-9a-f]{16}) role (\d+)/);
    const e = tag && sweepLog(dir).map((l) => JSON.parse(l)).filter((x) => x.hash === tag[1] && Array.isArray(x.ceilings)).pop();
    if (e) input.tool_input = { ...input.tool_input, prompt: `${p} Token ceiling: ${e.ceilings[Number(tag[2]) - 1]}.` };
  }
  if (!raw && typeof input.tool_input?.prompt === 'string') input.tool_input.prompt += leadQuestion(dir, input.tool_input.prompt);
  const r = runHook('user/kit-hooks/sweep-guard.cjs', input);
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : { permissionDecision: 'allow' };
};

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

// The size band (rule:size-budgets): one size request per plan, applied by script. A long real run showed asks the
// rule never meant: a margin demanded as if it were size, a margin demanded on lines the plan did not grow, and a
// file count that no band could raise. The script refuses only on a measured size past what is allowed.
const BAND = path.resolve('project/.claude/size-band.mjs');
function bandRun(mode, { band, measured, limits }) {
  const dir = makeTemp('band-');
  const files = { band, measured, limits };
  for (const [k, v] of Object.entries(files)) fs.writeFileSync(path.join(dir, `${k}.json`), JSON.stringify(v));
  const r = spawnSync('node', [BAND, mode, '--band', path.join(dir, 'band.json'), '--measured', path.join(dir, 'measured.json'), '--limits', path.join(dir, 'limits.json')], { encoding: 'utf8' });
  let out = null;
  try { out = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))); } catch { /* printed text only */ }
  return { ...r, out };
}
const band = { base: { page: 100000, lazy: 16000, files: 80 }, limit: { page: 100050, lazy: 16040, files: 80 }, raise: { page: 6000, files: 2 }, counts: ['files'] };

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

// why: catches a break at project/.claude/size-band.mjs:79 that no other test catches
test('the size band end check lowers padding and fails a line over its limit', () => {
  const limits = { page: 106050, lazy: 16040, files: 82 };
  const r = bandRun('final', { band, measured: { page: 103000, lazy: 16000, files: 81 }, limits });
  assert.equal(r.status, 0, r.stdout);
  assert.deepEqual(r.out.limits, { page: 103300, lazy: 16040, files: 81 }, 'lowered to size + margin; the unlisted line kept');
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

// PR 17's carry-overs (X5 to X7, X10, C7): what the meter trusts, and the tests the re-sweep found missing.
const logOutcome = (r, ids, cfg, extra = []) => approveIn(r.dir, [r.f, '--outcome', '--agents', ids.join(','), '--findings', '4', '--real', '3', '--duplicates', '0', ...extra], { CLAUDE_CONFIG_DIR: cfg });
const cheapRoles = (n) => Array.from({ length: n }, () => `t${++agentSeq}`);

// A reviewer that crashes spends real tokens and leaves its role with no report (the owner's decision 2, 1.21.0): its
// role gets one retry, the crash's spend stays on the role, and a second crash is the owner's through --cut-short.
// A transcript's age is its last write, so a test sets both clocks: the entries' timestamps and the file's mtime.
function ageTranscript(cfg, id, { stamps, file }) {
  const ago = (min) => new Date(Date.now() - min * 60000);
  const f = path.join(cfg, 'projects', 'C--repo', 'session-1', 'subagents', `agent-${id}.jsonl`);
  if (stamps !== undefined) fs.writeFileSync(f, read(f).trim().split('\n').map((l) => JSON.stringify({ ...JSON.parse(l), timestamp: ago(stamps).toISOString() })).join('\n') + '\n');
  if (file !== undefined) fs.utimesSync(f, ago(file), ago(file));
}
function crashedSweep() {
  const early = transcripts({ early: [[0, 100, 0, 0]] }, { early: { finished: false } });
  const dir = sweepRepo({ 'README.md': 'z\n' });
  const r = approveRun({ tier: 'fix', modifiers: [], roles: [role('fix-root', 'Does the fix remove the root cause, and does it hold?', { model: 'claude-opus-5-5' }), role('blast-radius', 'Which callers and copies of this code does the change reach?', { model: 'claude-opus-5-5' })] }, dir);
  assert.equal(r.status, 0, r.stdout);
  const { hash } = approvalLog(dir).pop();
  // Cleared half an hour ago, so a crash can have gone quiet since and still have started after the clearance.
  const logFile = path.join(dir, '.git', 'kit-sweep-approvals.jsonl');
  const logged = read(logFile).trim().split('\n');
  logged.push(JSON.stringify({ ...JSON.parse(logged.pop()), time: new Date(Date.now() - 30 * 60000).toISOString() }));
  fs.writeFileSync(logFile, logged.join('\n') + '\n');
  const brief = (n, h = hash) => `review. Call cap: 5. Sweep: ${h} role ${n}`;
  const cfg = transcripts({ r1: [[0, 1000, 0, 0], [0, 1000, 0, 0], [0, 500, 0, 0], [0, 500, 0, 0]], r2: [[0, 500, 0, 0]] }, { r1: { finished: false } });
  setBrief(cfg, 'r1', () => brief(1));
  setBrief(cfg, 'r2', () => brief(2));
  setBrief(early, 'early', () => brief(1));
  ageTranscript(cfg, 'r1', { stamps: 11, file: 11 });
  ageTranscript(early, 'early', { stamps: 60, file: 60 });
  const start = (n) => sweepGuard(dir, { tool_input: { subagent_type: 'reviewer', prompt: brief(n) } }).permissionDecision;
  const retry = (n, id, env = cfg) => approveIn(dir, [r.f, '--retry', String(n), '--crashed', id], { CLAUDE_CONFIG_DIR: env });
  return { ...r, hash, brief, cfg, early, start, retry };
}

// Recall probes: the runner makes its own throwaway folder, so no folder name or label can reach the result.
const HEX6 = '[0-9a-f]{6}';
const probeParts = (home, p) => path.relative(home, p).split(path.sep);
const recorder = (statuses = []) => {
  const calls = [];
  const run = (cmd, args, opts) => {
    calls.push({ cmd, args: [...args], opts: { ...opts }, dirExisted: opts && opts.cwd ? fs.existsSync(opts.cwd) : null });
    const status = statuses.length ? statuses.shift() : 0;
    return { status, stdout: '', stderr: status === 0 ? '' : 'boom' };
  };
  return { calls, run };
};
const scratch = () => path.join(makeTemp('probe-'), 'kit-probes', 'abc123', 'pdef456');

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

// Carry 17: a compaction loses the ids in the lead's context; each brief's Sweep tag does not get lost.
function autoSweep(extra = () => {}) {
  const r = approveRun(featureContract());
  const n = JSON.parse(read(r.f)).roles.length;
  const hash = approvalLog(r.dir).pop().hash;
  const ids = Array.from({ length: n }, (_, i) => `au${++agentSeq}x${i}`);
  const cfg = transcripts(Object.fromEntries(ids.map((id) => [id, [[0, 1000, 0, 0]]])), {}, undefined, undefined, roleModels(ids, featureContract().roles));
  ids.forEach((id, i) => setBrief(cfg, id, (b) => `${b} Sweep: ${hash} role ${i + 1}`));
  extra({ cfg, hash, ids });
  const o = approveIn(r.dir, [r.f, '--outcome', '--agents', 'auto', '--findings', '6', '--real', '5', '--duplicates', '0'], { CLAUDE_CONFIG_DIR: cfg });
  return { r, o, ids, n };
}

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
