// Tests for improvement reports, the PR body audits, sweep outcomes and the one-sweep loop: moved word for word from tests/kit.test.mjs (T10, build 18).

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

// Improvement reports (rule:kit-standards item 12): one format the kit owns for every process or method gap found
// while using it, filled in the session the gap shows up, handed to the kit as one file. The audit holds the bar:
// evidence on every cause, and no fix that lowers a standard.
const REPORT = path.resolve('project/.claude/improvement-report.mjs');
const reportRun = (dir, args) => spawnSync('node', [REPORT, ...args], { encoding: 'utf8', cwd: dir });
function reportRepo() {
  const dir = path.join(makeTemp('ir-'), 'course-project');
  fs.mkdirSync(path.join(dir, '.kit'), { recursive: true });
  g(dir, 'init', '-q', '-b', 'feat/generator');
  fs.writeFileSync(path.join(dir, 'README.md'), 'x\n');
  commitAll(dir, 'base', true);
  fs.writeFileSync(path.join(dir, '.kit', 'kit-version.json'), JSON.stringify({ version: '1.7.1', files: {} }));
  return dir;
}
const EXAMPLE = () => read(path.resolve('project/.claude/kit/improvement-report-example.md'));

// why: catches a break at project/.claude/improvement-report.mjs:113 that no other test catches
test('a new improvement report starts from the kit template with its facts filled in', () => {
  const dir = reportRepo();
  const r = reportRun(dir, ['new', 'Sweep approval asked before the script']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const files = fs.readdirSync(path.join(dir, '.kit', 'reports'));
  assert.equal(files.length, 1);
  assert.match(files[0], /^IR-\d{4}-\d{2}-\d{2}-sweep-approval-asked-before-the-script\.md$/);
  const text = read(path.join(dir, '.kit', 'reports', files[0]));
  assert.match(text, /^# Improvement report: .*before the script$/m);
  assert.match(text, /\| Project \| course-project \|/);
  assert.match(text, /\| Branch and commit \| feat\/generator @ [0-9a-f]{7,} \|/);
  assert.match(text, /\| Kit version \| 1\.7\.1 \|/);
  assert.match(text, /\| Status \| open \|/);
  // An unfilled report does not pass.
  const a = reportRun(dir, ['audit', path.join(dir, '.kit', 'reports', files[0])]);
  assert.equal(a.status, 1);
  assert.match(a.stdout, /placeholder/i);
});

// why: guards rule:pr-body
test('the report audit fails a missing field, an unproven cause, a lowered standard and an unclosed close', () => {
  const cases = [
    [(t) => t.replace(/^\| Severity \|.*\n/m, ''), /Severity/],
    [(t) => t.replace('| Severity | high |', '| Severity | urgent |'), /Severity/],
    [(t) => t.replace('| Type | both |', '| Type | vibes |'), /Type/],
    [(t) => t.replace(/^\| 1 \| (.*?) \| .*? \| proven \|$/m, '| 1 | $1 |  | proven |'), /evidence/i],
    [(t) => t.replace(/^(\| 2 \| .*?) \| proven \|$/m, '$1 | maybe |'), /proven or guess/i],
    [(t) => t.replace(/\| same \|$/m, '| lower |'), /owner/i],
    [(t) => t.replace(/\*\*Key cause:\*\* #\d/, '**Key cause:** #9'), /Key cause/],
    [(t) => t.replace(/^## What stays the same\n[\s\S]*?(?=^## )/m, ''), /What stays the same/],
    [(t) => t.replace('| Status | open |', '| Status | closed |'), /Closed by/],
    [(t) => t.replace(/^\| ID \|.*$/m, '| ID | report-1 |'), /ID/],
  ];
  for (const [change, why] of cases) {
    const f = path.join(makeTemp('ir-'), 'r.md');
    const text = change(EXAMPLE());
    assert.notEqual(text, EXAMPLE(), `the case for ${why} changed nothing`);
    fs.writeFileSync(f, text);
    const a = reportRun(path.dirname(f), ['audit', f]);
    assert.equal(a.status, 1, `${why}: ${a.stdout}`);
    assert.match(a.stdout, why);
  }
});

// Found in review of the sweep guard (2026-10-30).
// why: guards rule:sweep-auto-approval
test('the sweep guard holds reviewers to the cleared team size', () => {
  const dir = sweepRepo({ 'README.md': 'y\n' });
  const one = { tier: 'triage', modifiers: [], roles: [role('triage', 'Any secret or personal data in the diff?')] };
  assert.equal(approveRun(one, dir).status, 0);
  assert.equal(sweepGuard(dir).permissionDecision, 'allow', 'the one cleared reviewer');
  const second = sweepGuard(dir);
  assert.equal(second.permissionDecision, 'deny', 'a second reviewer on a one-role contract');
  assert.match(second.permissionDecisionReason, /Role 1 of the cleared contract[\s\S]*started already/);
});

// why: guards rule:sweep-auto-approval. K48 (a project on the kit, 2026-11-14): a project whose settings still ran the
// guards directly checked every start twice, and the second check of the same start found its own slot taken, so no
// reviewer could ever start. The same start (its tool id in the slot) passes again; any other start is still refused.
test('the sweep guard counts one start once, however often it is checked', () => {
  const dir = sweepRepo({ 'README.md': 'y\n' });
  const one = { tier: 'triage', modifiers: [], roles: [role('triage', 'Any secret or personal data in the diff?')] };
  assert.equal(approveRun(one, dir).status, 0);
  assert.equal(sweepGuard(dir, { tool_use_id: 'toolu_one' }).permissionDecision, 'allow');
  assert.equal(sweepGuard(dir, { tool_use_id: 'toolu_one' }).permissionDecision, 'allow', 'the same start, checked a second time');
  const other = sweepGuard(dir, { tool_use_id: 'toolu_two' });
  assert.equal(other.permissionDecision, 'deny', 'another start for the same role');
  assert.match(other.permissionDecisionReason, /started already/);
  assert.equal(sweepGuard(dir).permissionDecision, 'deny', 'a start with no tool id is never the recorded one');
});

// why: guards rule:sweep-auto-approval
test('the sweep guard reads HEAD from the contract\'s checkout, so a worktree sweep runs', () => {
  const dir = sweepRepo();
  const wt = path.join(makeTemp('wt-'), 'wt');
  g(dir, 'worktree', 'add', '-q', '-b', 'feat/other', wt, 'main');
  fs.writeFileSync(path.join(wt, 'src.ts'), 'x\n');
  commitAll(wt, 'other work', true);
  fs.mkdirSync(path.join(wt, 'sweeps'));
  const r = approveRun(featureContract(), wt);
  assert.equal(r.status, 0, r.stdout);
  assert.equal(sweepGuard(dir).permissionDecision, 'deny', 'a brief that does not say where would read the wrong checkout');
  const root = spawnSync('git', ['-C', wt, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim();
  const brief = { tool_input: { subagent_type: 'reviewer', prompt: `review ${root.split('/').join(path.sep)}. Call cap: 5.` } };
  assert.equal(sweepGuard(dir, brief).permissionDecision, 'allow', 'the lead\'s session sits in the main checkout');
});

// why: guards rule:outward-acts
test('the owner\'s yes can be logged when the script could not read the base', () => {
  const dir = sweepRepo();
  g(dir, 'branch', '-m', 'main', 'develop');
  const r = approveRun(featureContract(), dir);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /--base/);
  assert.equal(approveIn(dir, [r.f, '--owner-yes', 'yes go ahead']).status, 0);
  assert.equal(sweepGuard(dir).permissionDecision, 'allow');
});

// why: guards rule:sweep-auto-approval
test('the sweep guard gates the reviewer type in any spelling', () => {
  const dir = sweepRepo();
  for (const t of ['Reviewer', 'kit:reviewer']) assert.equal(sweepGuard(dir, { tool_input: { subagent_type: t } }).permissionDecision, 'deny', t);
});

// why: guards rule:pr-body
test('a report title with $ signs is written as typed', () => {
  const dir = reportRepo();
  assert.equal(reportRun(dir, ['new', "Cost $' and $& here"]).status, 0);
  const f = fs.readdirSync(path.join(dir, '.kit', 'reports'))[0];
  const text = read(path.join(dir, '.kit', 'reports', f));
  assert.match(text, /^# Improvement report: Cost \$' and \$& here$/m);
  assert.equal(text.match(/^## Summary$/gm).length, 1);
});

// why: guards rule:pr-body
test('the report audit reads pipes in code spans, allows angle brackets in prose, and catches a backticked placeholder', () => {
  const check = (text) => {
    const f = path.join(makeTemp('ir-'), 'r.md');
    fs.writeFileSync(f, text);
    return reportRun(path.dirname(f), ['audit', f]);
  };
  const piped = EXAMPLE().replace(/^(\| 1 \| .*? \| )(.*?)( \| proven \|)$/m, '$1`a | b` in `x.md:3`$3');
  assert.notEqual(piped, EXAMPLE());
  assert.equal(check(piped).status, 0, check(piped).stdout);
  const prose = EXAMPLE().replace('## Summary\n\n', '## Summary\n\nA `Map<string>` type and a <br> tag appear in prose.\n');
  assert.equal(check(prose).status, 0, check(prose).stdout);
  const ticked = EXAMPLE().replace(/^(\| 1 \| .*? \| ).*?( \| proven \|)$/m, '$1`<file:line, a short quote, a command output or a log line>`$2');
  assert.equal(check(ticked).status, 1);
  assert.match(check(ticked).stdout, /placeholder/);
});

// The reviewer model trial (the owner, 2026-10-30): any role but security and the novel lens may run on the mid
// model; those two stay on the top model, and the outcome log counts the real findings the mid-model roles found.
// why: guards rule:sweep-auto-approval
test('a security or novel-lens role on a cheaper model goes back to be fixed; other roles may trial it', () => {
  for (const i of [0, 4]) {
    const c = featureContract();
    c.roles[i].model = 'sonnet';
    const r = approveRun(c);
    assert.equal(r.status, FIX_EXIT, r.stdout);
    assert.match(r.stdout, /top model/);
  }
  const c = featureContract();
  c.roles[0].model = 'claude-opus-5-5';
  c.roles[3].model = 'claude-sonnet-5-5';
  const ok = approveRun(c);
  assert.equal(ok.status, 0, ok.stdout);
  assert.equal(outcome(ok, '200000', '6', '5', '0', ['--real-mid', '2']).status, 0);
  assert.equal(approvalLog(ok.dir).pop().realMid, 2);
  assert.match(approveIn(ok.dir, ['--summary']).stdout, /from mid-model roles: 2/);
  assert.notEqual(outcome(ok, '1', '1', '1', '0', ['--real-mid', 'x']).status, 0);
});

// From a project closeout (2026-10-30): a PR that changes shipped code without a version bump leaves the release after it
// nothing to cut, so the PR-body audits fail it unless the body says "No user-facing change".
const BUMP = path.resolve('project/.claude/version-bump-check.mjs');
function bumpRepo(change) {
  const dir = makeTemp('bump-');
  g(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'package.json'), '{\n  "name": "app",\n  "version": "1.0.0"\n}\n');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'export const a = 1;\n');
  commitAll(dir, 'base', true);
  g(dir, 'checkout', '-q', '-b', 'feat/x');
  change(dir);
  commitAll(dir, 'change', true);
  return dir;
}

// why: catches a break at project/.claude/version-bump-check.mjs:37 that no other test catches
test('the version bump check fails shipped code with no bump, unless the body says no user-facing change', async () => {
  const { versionBumpCheck } = await import(pathToFileURL(BUMP).href);
  const shipped = bumpRepo((d) => fs.writeFileSync(path.join(d, 'src', 'a.js'), 'export const a = 2;\n'));
  assert.equal(versionBumpCheck('Fixes a.', shipped).ok, false);
  assert.match(versionBumpCheck('Fixes a.', shipped).detail, /No user-facing change/);
  assert.equal(versionBumpCheck('No user-facing change: a refactor.', shipped).ok, true);
  const bumped = bumpRepo((d) => {
    fs.writeFileSync(path.join(d, 'src', 'a.js'), 'export const a = 2;\n');
    fs.writeFileSync(path.join(d, 'package.json'), '{\n  "name": "app",\n  "version": "1.1.0"\n}\n');
  });
  assert.equal(versionBumpCheck('Fixes a.', bumped).ok, true);
  const testsOnly = bumpRepo((d) => fs.writeFileSync(path.join(d, 'src', 'a.test.js'), 'test\n'));
  assert.equal(versionBumpCheck('Adds a test.', testsOnly).ok, true);
  assert.equal(versionBumpCheck('x', makeTemp('nogit-')).ok, true, 'outside git there is nothing to check');
  // Both PR-body audits carry the row.
  const f = path.join(shipped, 'body.md');
  fs.writeFileSync(f, 'Fixes a.\n');
  for (const audit of ['pr-body-audit.mjs', 'pr-body-audit-lean.mjs']) {
    const out = spawnSync('node', [path.resolve('project/.claude', audit), f, 'feat: a'], { encoding: 'utf8', cwd: shipped }).stdout;
    assert.match(out, /FAIL\s+version bumped, or no user-facing change/, audit);
  }
});

// The build 17 sweep: a PR could add .kit/version-bump.json naming no shipped files, and pass its own bump check.
// why: guards rule:pr-body (a PR that empties its shipped list ships code with no version bump)
test('judging a PR, the version bump check reads its settings from the base', async () => {
  const { versionBumpCheck } = await import(pathToFileURL(BUMP).href);
  const loosened = bumpRepo((d) => {
    fs.writeFileSync(path.join(d, 'src', 'a.js'), 'export const a = 2;\n');
    fs.mkdirSync(path.join(d, '.kit'));
    fs.writeFileSync(path.join(d, '.kit', 'version-bump.json'), '{"shipped":[]}\n');
  });
  const was = process.env.PR_BASE;
  try {
    process.env.PR_BASE = 'main';
    assert.equal(versionBumpCheck('Fixes a.', loosened).ok, false, 'the base names no settings file: the defaults hold');
    delete process.env.PR_BASE;
    assert.equal(versionBumpCheck('Fixes a.', loosened).ok, true, 'before a PR, the working tree\'s settings are the project\'s');
  } finally { if (was === undefined) delete process.env.PR_BASE; else process.env.PR_BASE = was; }
});

// Improvement report IR-2026-10-30-pr-body-audit-holds-checks-from-another-project: the Standard audit held one
// project's facts (its dependency-audit wording, a corpus line, web gates), so an honest body elsewhere could only
// fail or lie. Those checks now come from the project's .kit/pr-body.json; the secrets line stays fixed for all.
// T13 (the owner, 2026-11-10): the title is the squash subject (`type: subject`), the review rows are the project's
// own, and what GitHub shows (files, gates) is not repeated.
const STD_TITLE = 'feat: an alarm for online search and a data date on About';
const stdAudit = (dir, text, title = STD_TITLE) => {
  const f = path.join(dir, 'body.md');
  fs.writeFileSync(f, text);
  return spawnSync('node', [path.resolve('project/.claude/pr-body-audit.mjs'), f, title], { encoding: 'utf8', cwd: dir });
};
const honestBody = () => read(path.resolve('user/skills/pr-body/examples/standard.md'))
  .replace('; the corpus and the served documents are unchanged', '');

// why: catches a break in project/.claude/pr-body-audit.mjs; the only test that caught it when tagged, others catch it too since the build 14 audit
test('the Standard PR audit passes an honest body for a project with no corpus, no scoped ignores and no web gates', () => {
  const dir = makeTemp('prb-');
  const ok = stdAudit(dir, honestBody());
  assert.equal(ok.status, 0, ok.stdout);
  const noSecrets = stdAudit(dir, honestBody().replace('- **Secrets:** no secrets or account information in the diff.\n', ''));
  assert.equal(noSecrets.status, 1, 'the secrets line is required in every project');
  assert.match(noSecrets.stdout, /FAIL.*secrets/);
  // The title is the squash commit's subject: an area title, or one over 72, fails; the H1 carries its subject.
  for (const title of ['Live check: an alarm for online search and a data date on About', `feat: ${'x'.repeat(70)}`]) assert.match(stdAudit(dir, honestBody(), title).stdout, /FAIL\s+title is type: subject/, title);
  assert.match(stdAudit(dir, honestBody(), 'feat: something else').stdout, /FAIL\s+H1 line carries the title subject/);
  // A scope with a digit is a scope, as the commit check reads it (the 1.25.0 sweep).
  assert.doesNotMatch(stdAudit(dir, honestBody(), STD_TITLE.replace('feat:', 'feat(v2):')).stdout, /FAIL\s+title/);
});

// why: guards rule:pr-body
test('a project\'s .kit/pr-body.json sets its own review dimensions, audit line and checked lines', () => {
  const dir = makeTemp('prb-');
  fs.mkdirSync(path.join(dir, '.kit'));
  fs.writeFileSync(path.join(dir, '.kit', 'pr-body.json'), JSON.stringify({
    dimensions: ['Privacy and the PII boundary', 'Code security', 'Supply chain and bundle', 'Legal content and licensing', 'Accessibility'],
    auditLine: '0 high (3 documented scoped ignores)',
    verifiedClean: ['the corpus and the served documents are unchanged'],
  }));
  const strict = stdAudit(dir, honestBody());
  assert.equal(strict.status, 1);
  for (const why of [/missing Accessibility/, /keeps its ignores/, /corpus/]) assert.match(strict.stdout, why);
  fs.writeFileSync(path.join(dir, '.kit', 'pr-body.json'), JSON.stringify({
    dimensions: ['Privacy and the PII boundary', 'Code security', 'Supply chain and bundle', 'Legal content and licensing'],
    auditLine: '0 high (2 documented scoped ignores)',
    verifiedClean: ['the corpus and the served documents are unchanged'],
  }));
  const full = stdAudit(dir, read(path.resolve('user/skills/pr-body/examples/standard.md')));
  assert.equal(full.status, 0, full.stdout);
  // A file from before 1.25.0 names its rows "gates": the audit says so, never falling back in silence (the sweep).
  const old = makeTemp('prb-');
  fs.mkdirSync(path.join(old, '.kit'));
  fs.writeFileSync(path.join(old, '.kit', 'pr-body.json'), JSON.stringify({ gates: ['Code security', 'Accessibility'] }));
  assert.match(stdAudit(old, honestBody()).stdout, /FAIL.*"gates" is now "dimensions"/);
  // A project with no file needs only a code security row, so no row is written to say "not touched".
  const plain = makeTemp('prb-');
  const oneRow = honestBody().replace(/\| (Privacy|Supply|Legal|Test value).*\n/g, '');
  assert.equal(stdAudit(plain, oneRow).status, 0, stdAudit(plain, oneRow).stdout);
  assert.match(stdAudit(plain, oneRow.replace(/\| Code security.*\n/, '')).stdout, /missing Code security/);
});

// The build 17 sweep: CI runs the base copy of the audit, but it read .kit/pr-body.json from the PR's own tree, so a
// PR could name the rows its body is held to. Judging a PR (PR_BASE set), the file is read from the base.
// why: guards rule:pr-body (a PR that sets its own review rows passes a body with no security row)
test('judging a PR, the audit reads the project\'s review rows from the base, not the PR', () => {
  const dir = makeTemp('prb-');
  const g = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', `core.hooksPath=${os.devNull}`, ...a], { cwd: dir, encoding: 'utf8' });
  g('init', '-q', '-b', 'main'); fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n'); g('add', '.'); g('commit', '-qm', 'base');
  const base = g('rev-parse', 'HEAD').stdout.trim();
  fs.mkdirSync(path.join(dir, '.kit'));
  fs.writeFileSync(path.join(dir, '.kit', 'pr-body.json'), JSON.stringify({ dimensions: ['Style'] }));
  g('add', '.'); g('commit', '-qm', 'pr');
  const noSecurity = honestBody().replace(/\| (Privacy|Supply|Legal|Test value|Code security).*\n/g, '| Style | PASS | fine |\n');
  const f = path.join(dir, 'body.md');
  fs.writeFileSync(f, noSecurity);
  const judged = spawnSync('node', [path.resolve('project/.claude/pr-body-audit.mjs'), f, STD_TITLE], { encoding: 'utf8', cwd: dir, env: { ...process.env, PR_BASE: base } });
  assert.match(judged.stdout, /missing Code security/, judged.stdout);
  // On the owner's machine, before a PR (no PR_BASE), the working tree's file is the project's.
  const { PR_BASE, ...env } = process.env;
  assert.doesNotMatch(spawnSync('node', [path.resolve('project/.claude/pr-body-audit.mjs'), f, STD_TITLE], { encoding: 'utf8', cwd: dir, env }).stdout, /missing Code security/);
});

// The Review section carries the sweep summary a reviewer needs (the commit covered, a result per dimension, high and
// critical findings, deferred items, accepted risks), and never a link to the private report.
// why: guards rule:sweep-auto-approval
test('the Standard PR audit holds the Review section to the sweep summary and refuses a private report link', () => {
  const dir = makeTemp('prb-');
  const ok = stdAudit(dir, honestBody());
  assert.match(ok.stdout, /PASS\s+Review parts in order/);
  const noTable = stdAudit(dir, honestBody().replace(/\| Dimension \| Result \|\n\|---\|---\|\n(\|.*\n)+/, ''));
  assert.equal(noTable.status, 1);
  assert.match(noTable.stdout, /FAIL\s+Review parts in order/);
  const noCommit = stdAudit(dir, honestBody().replace('Feature review of `9a1d6e20`.', 'Feature review.'));
  assert.match(noCommit.stdout, /FAIL\s+Review parts in order/);
  // New 4 (build 13, reproduced on 1.38.0): the template's line is "<Tier> review of", and a body naming no tier passed.
  const noTier = stdAudit(dir, honestBody().replace('Feature review of `9a1d6e20`.', 'Review of `9a1d6e20`.'));
  assert.equal(noTier.status, 1);
  assert.match(noTier.stdout, /FAIL\s+Review names the sweep tier/);
  assert.match(stdAudit(dir, honestBody().replace('Feature review of', 'Fix (security-sensitive) review of')).stdout, /PASS\s+Review names the sweep tier/);
  assert.match(stdAudit(dir, honestBody().replace('Feature review of', 'Featured review of')).stdout, /FAIL\s+Review names the sweep tier/);
  // The build 13 sweep: only a parenthesis of modifiers sits between the tier and "review of".
  assert.match(stdAudit(dir, honestBody().replace('Feature review of', 'Feature flags stay off; a light review of')).stdout, /FAIL\s+Review names the sweep tier/);
  const linked = stdAudit(dir, honestBody().replace('- **Deferred:** none.', '- **Deferred:** see [the report](docs/sweeps/2026-05-14-pin.md).'));
  assert.equal(linked.status, 1);
  assert.match(linked.stdout, /FAIL\s+no vault paths/);
});

// Found in a course project closeout (2026-10-30): the lead sent the coordinator a file path instead of the handoff,
// and a new session may not read that path. The audit can print the exact text to send, so the step is checkable.
// why: guards rule:word-pins
test('the handoff audit prints the full text to send, and only for a clean handoff', () => {
  const good = '# Notes - Continuation Handoff\n\n## REQUIRED FIRST ACTIONS\nRun the Post-Compact Orientation Protocol.\n\n## Working Mode: Plan\n\n## State Snapshot\n- Git: main at a1b2c3d, pushed\n\n## Newly-Established Working Standards\nnone\n\n## Critical In-Flight Context\n- none\n\n## Reading Order\n1. _Start Here.md\n\n## Next Step\n- What: the next PR\n\n## Anti-Hallucination Discipline\n- verified\n';
  const ok = runAudit('closeout', good, ['--send']);
  assert.equal(ok.status, 0, ok.stdout);
  // pin: 2 (the order the lead follows at the stop)
  assert.match(ok.stdout, /Send the text between the lines as ONE message/);
  assert.ok(ok.stdout.includes(good.trimEnd()), 'the whole handoff, not a path');
  const bad = runAudit('closeout', good.replace('- Git: main at a1b2c3d, pushed', '- Git:'), ['--send']);
  assert.equal(bad.status, 1);
  assert.doesNotMatch(bad.stdout, /Send the text/);
});

// From a project's gap report (2026-10-30): a version-only package.json change was read as a new dependency, a
// pause stayed silent after the session that tripped it, and an owner-decided sweep could not log its outcome.
// why: catches a break in user/skills/pre-pr-sweep/approve.mjs; the only test that caught it when tagged, others catch it too since the build 14 audit
test('a version-only package.json change is not a new dependency; a dependency change still is', () => {
  const pkg = (v, deps = '{}') => `{\n  "name": "app",\n  "version": "${v}",\n  "dependencies": ${deps}\n}\n`;
  const repo = (head) => {
    const dir = makeTemp('approve-');
    g(dir, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(dir, 'package.json'), pkg('1.0.0'));
    commitAll(dir, 'base', true);
    g(dir, 'checkout', '-q', '-b', 'feat/x');
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'sync.ts'), 'x\n');
    fs.writeFileSync(path.join(dir, 'package.json'), head);
    commitAll(dir, 'feature', true);
    fs.mkdirSync(path.join(dir, 'sweeps'));
    return dir;
  };
  assert.equal(approveRun(featureContract(), repo(pkg('1.1.0'))).status, 0, 'a version bump alone');
  assert.match(approveRun(featureContract(), repo(pkg('1.1.0', '{ "left-pad": "1" }'))).stdout, /supply-chain/i, 'a new dependency');
  assert.match(approveRun(featureContract(), repo('{ not json')).stdout, /supply-chain/i, 'an unreadable package file counts as a change');
});

// why: catches a break in user/skills/pre-pr-sweep/approve.mjs; the only test that caught it when tagged, others catch it too since the build 14 audit
test('while paused, every ask says how the owner resumes and what to review first', () => {
  const r = approveRun(featureContract());
  outcome(r, String(Math.ceil(537500 * 1.3)));
  const ask = approveIn(r.dir, [r.f]);
  assert.match(ask.stdout, /paused since \d{4}-\d{2}-\d{2}/);
  assert.match(ask.stdout, /--summary/);
  // The one way to resume, the owner's pop-up Yes to the pause's act, in the ask and the summary alike.
  const code = ask.stdout.match(/`sweep resume ([0-9a-f]{6})`/)[1];
  assert.ok(approveIn(r.dir, ['--summary']).stdout.includes(`\`sweep resume ${code}\``));
  assert.doesNotMatch(ask.stdout, /KIT_OWNER_RESUME|--thread/, 'the retired ways');
});

// why: guards rule:sweep-auto-approval
test('an owner-decided sweep can log its outcome, so the trial sees every sweep', () => {
  const r = approveRun(askContract());
  assert.equal(r.status, 1);
  const o = outcome(r, '288000', '4', '3', '0');
  assert.equal(o.status, 0, o.stdout);
  assert.equal(approvalLog(r.dir).filter((e) => e.kind === 'outcome').length, 1);
});

// The owner, 2026-11-03: the meter is processed tokens, read by the script from each reviewer's own transcript. A
// hand-typed number was the Agent result's context size, so every budget tripped on the wrong meter.
// why: guards rule:sweep-auto-approval
test('the outcome reads each role\'s spend from its own transcript, counting each streamed message once', () => {
  const c = featureContract();
  c.roles[3].model = 'sonnet';
  const r = approveRun(c);
  assert.equal(r.status, 0, r.stdout);
  // a1's first message streamed as three lines with one message id (the last carries the final usage).
  const cfg = transcripts({
    a1: [{ id: 'm1', u: [3, 100, 50, 10] }, { id: 'm1', u: [3, 100, 50, 20] }, { id: 'm1', u: [3, 100, 50, 30] }, [2, 200, 0, 5]],
    a2: [[1, 1000, 100, 7]], a3: [[1, 1000, 100, 7]], a4: [{ id: 'x', model: 'claude-sonnet-5-5', u: [0, 500, 0, 0] }], a5: [[10, 10, 10, 10]],
  });
  const o = approveIn(r.dir, [r.f, '--outcome', '--agents', 'a1,a2,a3,a4,a5', '--findings', '6', '--real', '5', '--duplicates', '0'], { CLAUDE_CONFIG_DIR: cfg });
  assert.equal(o.status, 0, o.stdout);
  const line = approvalLog(r.dir).pop();
  assert.equal(line.kind, 'outcome');
  // a1: m1 once (3 + 100 + 50 + 30) plus the second call (2 + 200 + 0 + 5) = 390, as results/m11-meter/meter.mjs counts it.
  assert.deepEqual(line.roles.map((x) => x.tokens), [390, 1108, 1108, 500, 40]);
  assert.deepEqual(line.roles.map((x) => x.kind), ['security', 'security', 'security', 'test-value', 'novel-lens']);
  assert.equal(line.roles[3].model, 'claude-sonnet-5-5');
  assert.equal(line.tokens, 390 + 1108 + 1108 + 500 + 40);
  assert.match(approveIn(r.dir, ['--summary']).stdout, /security x3: up to 1,108 over 1 calls/);
});

// why: guards rule:sweep-auto-approval
test('the outcome asks the owner when a transcript is missing, and refuses a hand-typed token count', () => {
  const r = approveRun(featureContract());
  const before = approvalLog(r.dir).length;
  const cfg = transcripts({ a1: [[1, 1, 1, 1]], a2: [[1, 1, 1, 1]], a3: [[1, 1, 1, 1]], a4: [[1, 1, 1, 1]] });
  const run = (ids, more = []) => approveIn(r.dir, [r.f, '--outcome', '--agents', ids, '--findings', '6', '--real', '5', '--duplicates', '0', ...more], { CLAUDE_CONFIG_DIR: cfg });
  const missing = run('a1,a2,a3,a4,nope');
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /ASK THE OWNER[\s\S]*nope/);
  const typed = approveIn(r.dir, [r.f, '--outcome', '--tokens', '75000', '--findings', '6', '--real', '5', '--duplicates', '0']);
  assert.equal(typed.status, 1);
  assert.match(typed.stdout, /--tokens is not taken[\s\S]*--agents/);
  assert.match(run('a1,a1,a2,a3,a4').stdout, /each once/, 'one transcript cannot stand for two roles');
  assert.match(run('A1,a1,a2,a3,a4').stdout, /each once/, 'Windows file names ignore case');
  assert.match(approveIn(r.dir, [r.f, '--outcome', '--agents', 'a1,a2,a3,a4', '--findings', 'lots', '--real', '5', '--duplicates', '0'], { CLAUDE_CONFIG_DIR: cfg }).stdout, /whole number/);
  assert.equal(run('a1,a2,a3,a4').status, 1, 'one agent id per role');
  assert.equal(run('a1,a2,a3,a4,../a1').status, 1, 'an agent id is a name, not a path');
  assert.equal(approvalLog(r.dir).filter((e) => e.kind !== 'unread').length, before, 'nothing logged');
});

// Locked: a tier's cap counts only the roles beyond its floor, so no modifier mix can make the floor
// unreachable, and a sweep still cannot buy more than its extras.
function fixRepo(extra = {}) {
  const dir = makeTemp('approve-');
  const put = (files) => { for (const [f, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), t); } };
  g(dir, 'init', '-q', '-b', 'main');
  put({ 'README.md': 'x\n', 'src/page.ts': 'export const page = 1;\n', 'src/page.test.ts': 'test 1\n' });
  commitAll(dir, 'base', true);
  g(dir, 'checkout', '-q', '-b', 'fix/page');
  put({ 'src/page.ts': 'export const page = 2;\n', 'src/page.test.ts': 'test 2\n', ...extra });
  commitAll(dir, 'fix', true);
  fs.mkdirSync(path.join(dir, 'sweeps'));
  return dir;
}
const fixFloor = () => [
  role('fix-root', 'Does the fix remove the root cause, and does it hold?'),
  role('blast-radius', 'Which callers and copies of this code does the change reach?', { model: 'claude-sonnet-5-5' }),
  role('test-value', 'Does each changed test fail without the fix?', { model: 'claude-sonnet-5-5' }),
];
const threeSecurity = () => [
  role('security', 'Can a crafted page number reach the query unchecked?'),
  role('security', 'Does an error path leak the session token?'),
  role('security', 'Can the clamp be bypassed by a negative offset?'),
];

// why: guards rule:sweep-auto-approval
test('a cap counts the roles beyond the floor: a security fix with tests approves, extras past the cap ask', () => {
  const sec = { tier: 'fix', modifiers: ['security-sensitive'], roles: [...fixFloor(), ...threeSecurity()] };
  assert.equal(approveRun(sec, fixRepo()).status, 0, approveRun(sec, fixRepo()).stdout);
  const oneExtra = { ...sec, roles: [...sec.roles, role('modelled-on', 'Was the bug inherited from the code this copied?')] };
  assert.equal(approveRun(oneExtra, fixRepo()).status, 0, 'the fix tier allows 1 extra');
  const twoExtra = { ...sec, roles: [...oneExtra.roles, role('data-loss', 'Can the new clamp drop saved pages?', { model: 'claude-sonnet-5-5' })] };
  assert.match(approveRun(twoExtra, fixRepo()).stdout, /ASK THE OWNER[\s\S]*2 roles beyond the fix floor[\s\S]*cap of 1/);
  const nine = { tier: 'fix', modifiers: ['security-sensitive', 'new-dependency', 'user-data'], roles: [...fixFloor(), ...threeSecurity(),
    role('supply-chain', 'Is the new package pinned, maintained and free of install scripts?'),
    role('privacy', 'Does the package send any user data off the device?'),
    role('data-loss', 'Can a saved page be lost on upgrade?', { model: 'claude-sonnet-5-5' })] };
  const r9 = approveRun(nine, fixRepo());
  assert.equal(r9.status, 0, r9.stdout);
  assert.match(r9.stdout, /Extras: 0 of 1 allowed/);
  const more = [
    role('modelled-on', 'Was the sync loop copied from code that had this bug?'),
    role('data-loss', 'Can an interrupted sync drop a saved record?'),
    role('privacy', 'Which fields leave the device, and are they needed?'),
    role('content', 'Is every new error message plain and accurate?'),
    role('supply-chain', 'Is anything fetched at runtime from an unpinned source?'),
    role('dimension', 'Do the docs and the changelog match the behaviour?'),
  ];
  const extras = (n) => more.slice(0, n);
  assert.equal(approveRun({ ...featureContract(), roles: [...featureContract().roles, ...extras(5)] }).status, 0, 'the feature tier allows 5 extras');
  assert.match(approveRun({ ...featureContract(), roles: [...featureContract().roles, ...extras(6)] }).stdout, /6 roles beyond the feature floor[\s\S]*cap of 5/);
});

// A first sweep approved and its outcome logged, then a fix committed on top.
function firstSweep(contract = featureContract(), dir = sweepRepo()) {
  const r = approveRun(contract, dir);
  assert.equal(r.status, 0, r.stdout);
  assert.equal(outcome(r).status, 0);
  fs.writeFileSync(path.join(dir, 'README.md'), 'fixed\n');
  commitAll(dir, 'fix the sweep findings', true);
  return r;
}
// The one-sweep loop (the owner, 2026-11-07 05:06): one full sweep per branch, then CI. A second sweep however it is
// named is the owner's call; their yes clears it as any ask. Handoff item 32: a rebase or a fresh contract name does not
// hide the branch's first sweep.
const ownerYes = (r) => { const y = approveIn(r.dir, [r.f, '--owner-yes', 'yes, run that second pass']); assert.equal(y.status, 0, y.stdout); return r; };

// why: guards rule:sweep-auto-approval
// renamed from: the one-sweep loop: a re-sweep or a second sweep on the branch asks the owner, and a rebase does not hide the first
test('the one-sweep loop: a second sweep on the branch asks the owner, and a rebase does not hide the first', () => {
  const first = firstSweep();
  const second = path.join(first.dir, 'sweeps', 'second.json');
  fs.writeFileSync(second, JSON.stringify(featureContract()));
  const again = approveIn(first.dir, [second]);
  assert.equal(again.status, 1, again.stdout);
  assert.match(again.stdout, /ASK THE OWNER[\s\S]*second sweep on this branch/);
  const rebased = firstSweep();
  g(rebased.dir, 'checkout', '-q', 'main');
  fs.writeFileSync(path.join(rebased.dir, 'NOTES.md'), 'main moved\n');
  commitAll(rebased.dir, 'main moves', true);
  g(rebased.dir, 'checkout', '-q', 'feat/sync');
  assert.equal(g(rebased.dir, 'rebase', '-q', 'main').status, 0);
  fs.writeFileSync(second.replace(first.dir, rebased.dir), JSON.stringify(featureContract()));
  assert.match(approveIn(rebased.dir, [second.replace(first.dir, rebased.dir)]).stdout, /ASK THE OWNER[\s\S]*a second sweep on this branch/, 'after a rebase');
  // S22-S3: a rebase plus a new branch name, or the same commits on a detached HEAD: the commits' patches are the same.
  for (const move of ['rename', 'detach']) {
    const r = firstSweep();
    g(r.dir, 'checkout', '-q', 'main');
    fs.writeFileSync(path.join(r.dir, 'NOTES.md'), 'main moved\n');
    commitAll(r.dir, 'main moves', true);
    g(r.dir, 'checkout', '-q', 'feat/sync');
    assert.equal(g(r.dir, 'rebase', '-q', 'main').status, 0);
    if (move === 'rename') g(r.dir, 'branch', '-q', '-m', 'feat/sync-two');
    else g(r.dir, 'checkout', '-q', '--detach');
    const f = second.replace(first.dir, r.dir);
    fs.writeFileSync(f, JSON.stringify(featureContract()));
    assert.match(approveIn(r.dir, [f]).stdout, /ASK THE OWNER[\s\S]*a second sweep on this branch/, `after a rebase and a ${move}`);
  }
});

// why: guards rule:sweep-auto-approval
test('a carry already in the log shows at each sweep start until a later outcome closes it', () => {
  const first = firstSweep();
  const logFile = path.join(first.dir, '.git', 'kit-sweep-approvals.jsonl');
  fs.appendFileSync(logFile, JSON.stringify({ ...approvalLog(first.dir).pop(), carried: 2 }) + '\n');
  const next = approveIn(first.dir, [first.f]);
  assert.equal(next.status, 1, `a third pass on this branch asks the owner: ${next.stdout}`);
  assert.match(next.stdout, /2 carried finding\(s\) open/);
  assert.equal(approveIn(first.dir, [first.f, '--owner-yes', 'yes, close the carries']).status, 0);
  assert.notEqual(outcome(first, '200000', '6', '5', '0', ['--closed-carries', '3']).status, 0, 'cannot close more than are open');
  assert.equal(outcome(first, '200000', '6', '5', '0', ['--closed-carries', '2']).status, 0);
  assert.doesNotMatch(approveIn(first.dir, [first.f]).stdout, /carried finding/);
});

// The owner, 2026-11-03: every approve.mjs stop hands the owner a triage report, not just a line.
// why: guards rule:sweep-auto-approval
test('every ask and every pause writes a triage report beside the contract; an approval writes none', () => {
  const triage = (f) => f.replace(/\.json$/, '.triage.md');
  const ok = approveRun(featureContract());
  assert.ok(!fs.existsSync(triage(ok.f)), 'an approval writes none');
  const ask = approveRun(askContract());
  assert.match(ask.stdout, /contract\.triage\.md/);
  const text = read(triage(ask.f));
  assert.match(text, /added source file/);
  assert.match(text, /Fix options/);
  assert.match(text, /"decision":"owner"/, 'the log line behind it');
  const trip = approveRun(featureContract());
  fs.rmSync(triage(trip.f), { force: true });
  const o = outcome(trip, String(Math.ceil(537500 * 1.3)));
  assert.match(o.stdout, /contract\.triage\.md/);
  assert.match(read(triage(trip.f)), /30% over the budget of 537500/);
  const esc = approveRun(featureContract());
  const e = approveIn(esc.dir, [esc.f, '--escape', 'a sync bug shipped']);
  assert.match(e.stdout, /contract\.triage\.md/);
  assert.match(read(triage(esc.f)), /a sync bug shipped/);
  const t = approveRun(featureContract());
  for (let i = 1; i < 10; i++) { outcome(t); nextBranch(t.dir); approveIn(t.dir, [t.f]); }
  outcome(t);
  fs.rmSync(triage(t.f), { force: true });
  nextBranch(t.dir);
  assert.match(approveIn(t.dir, [t.f]).stdout, /trial review due[\s\S]*contract\.triage\.md/);
  assert.match(read(triage(t.f)), /trial review due/);
  assert.match(read(triage(t.f)), /resumes with a Yes in the pop-up/, 'the fix options are the report\'s point');
  // A tier that always asks still gets real numbers, and no absolute path or owner's words leak into the report.
  const fp = approveRun({ ...featureContract(), tier: 'first push' });
  const fpText = read(triage(fp.f));
  assert.doesNotMatch(fpText, /undefined/);
  assert.doesNotMatch(fpText, /approve-[A-Za-z0-9]{6}/, 'no absolute path to the repo');
});

// Found by the 1.16.0 branch's own feature sweep (2026-11-03).
// why: guards rule:sweep-tiers
test('a tier that is an object\'s built-in name is unknown, and goes back to be fixed', () => {
  for (const tier of ['constructor', '__proto__', 'toString']) {
    const r = approveRun({ ...featureContract(), tier });
    assert.equal(r.status, FIX_EXIT, `${tier}: ${r.stdout}`);
    assert.match(r.stdout, /unknown tier/);
  }
  assert.match(approveRun({ ...featureContract(), modifiers: ['constructor'] }).stdout, /unknown modifier "constructor"/);
});

// why: guards rule:sweep-auto-approval
test('the outcome reads only this sweep\'s finished reviewers, each once in the log', () => {
  const r = approveRun({ tier: 'triage', modifiers: [], roles: [role('triage', 'Any secret or personal data in the diff?', { model: 'claude-opus-5-5' })] }, sweepRepo({ 'README.md': 'y\n' }));
  assert.equal(r.status, 0, r.stdout);
  const log = (id, cfg) => approveIn(r.dir, [r.f, '--outcome', '--agents', id, '--findings', '1', '--real', '1', '--duplicates', '0'], { CLAUDE_CONFIG_DIR: cfg });
  const asks = (id, cfg, why) => { const o = log(id, cfg); assert.equal(o.status, 1, `${why}: ${o.stdout}`); assert.match(o.stdout, /ASK THE OWNER/); assert.match(o.stdout, why); };
  asks('e1', transcripts({ e1: [[1, 1, 1, 1]] }, { e1: { agentType: 'Explore' } }), /not a reviewer/);
  asks('u1', transcripts({ u1: [[1, 1, 1, 1]] }, { u1: { finished: false } }), /not finished/);
  const old = transcripts({ o1: [[1, 1, 1, 1]] });
  const of = path.join(old, 'projects', 'C--repo', 'session-1', 'subagents', 'agent-o1.jsonl');
  fs.writeFileSync(of, read(of).replace(/"timestamp":"[^"]+"/g, '"timestamp":"2026-10-27T00:00:00.000Z"'));
  asks('o1', old, /before this sweep was cleared/);
  const half = transcripts({ h1: [[1, 1, 1, 1]] });
  fs.appendFileSync(path.join(half, 'projects', 'C--repo', 'session-1', 'subagents', 'agent-h1.jsonl'), '{"type":"assist');
  asks('h1', half, /not finished/);
  const two = transcripts({ d1: [[1, 1, 1, 1]] });
  transcripts({ d1: [[1, 1, 1, 1]] }, {}, two, 'session-2');
  asks('d1', two, /2 transcripts/);
  assert.equal(r.status, 0);
  assert.equal(log('g1', transcripts({ g1: [[1, 1, 1, 1]] })).status, 0);
  nextBranch(r.dir, 'README.md');
  const again = approveIn(r.dir, [r.f]);
  assert.equal(again.status, 0, again.stdout);
  asks('g1', transcripts({ g1: [[1, 1, 1, 1]] }), /already logged/);
});

// why: guards rule:sweep-auto-approval
test('a reviewer that ran on another model than its role names pauses for the owner', () => {
  const r = approveRun(featureContract());
  const cfg = transcripts({ m1: [[1, 1, 1, 1]], m2: [[1, 1, 1, 1]], m3: [[1, 1, 1, 1]], m4: [{ model: 'claude-haiku-4-5', u: [1, 1, 1, 1] }], m5: [[1, 1, 1, 1]] });
  const o = approveIn(r.dir, [r.f, '--outcome', '--agents', 'm1,m2,m3,m4,m5', '--findings', '1', '--real', '1', '--duplicates', '0'], { CLAUDE_CONFIG_DIR: cfg });
  assert.equal(o.status, 0, o.stdout);
  assert.match(o.stdout, /paused[\s\S]*ran on claude-haiku-4-5/);
});

// why: guards rule:sweep-auto-approval
test('an approved sweep that never started can be closed with --none-ran, and only then', () => {
  const dir = sweepRepo();
  const r = approveRun(featureContract(), dir);
  assert.equal(r.status, 0);
  fs.writeFileSync(path.join(dir, 'src', 'more.ts'), 'x\n');
  commitAll(dir, 'more', true);
  assert.match(approveIn(dir, [r.f]).stdout, /outcome of the last approved sweep first/);
  const none = approveIn(dir, [r.f, '--outcome', '--none-ran']);
  assert.equal(none.status, 0, none.stdout);
  assert.equal(approveIn(dir, [r.f]).status, 0, 'the way is clear again');
  // Once a reviewer has started under the clearance, the outcome must be measured.
  assert.equal(sweepGuard(dir).permissionDecision, 'allow');
  const ran = approveIn(dir, [r.f, '--outcome', '--none-ran']);
  assert.equal(ran.status, 1);
  assert.match(ran.stdout, /started/);
});

// why: guards rule:sweep-auto-approval. K50 (reported by a project on the kit, 2026-11-14): starts the guard recorded
// but that never ran (another guard or the owner refused them) left the owner no way to close the round. A slot counts
// as never ran only on proof: the lead's transcript holds a refused result for its tool id, and no reviewer's meta file
// names it. With no transcript to read (another Claude folder, transcripts cleaned up) it counts as ran (the 1.31.0
// sweep: reading only for a meta file let an empty folder close a round whose reviewers ran).
test('--none-ran closes a round only on proof that its recorded starts were refused', () => {
  const dir = sweepRepo();
  const r = approveRun(featureContract(), dir);
  assert.equal(r.status, 0);
  assert.equal(sweepGuard(dir, { tool_use_id: 'toolu_never' }).permissionDecision, 'allow');
  // No transcript anywhere: no proof, so it ran.
  const empty = approveIn(dir, [r.f, '--outcome', '--none-ran'], { CLAUDE_CONFIG_DIR: makeTemp('cfg-') });
  assert.equal(empty.status, 1, empty.stdout);
  assert.match(empty.stdout, /started/);
  // The lead's transcript shows the start refused: it never ran.
  const cfg = makeTemp('cfg-');
  const lead = path.join(cfg, 'projects', 'C--repo');
  fs.mkdirSync(lead, { recursive: true });
  const refusal = (id) => JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: 'held by a hook' }] } });
  fs.writeFileSync(path.join(lead, 'session-1.jsonl'), refusal('toolu_never') + String.fromCharCode(10));
  const none = approveIn(dir, [r.f, '--outcome', '--none-ran'], { CLAUDE_CONFIG_DIR: cfg });
  assert.equal(none.status, 0, none.stdout);
  assert.match(none.stdout, /no reviewer ran/);
  // A refused result for a start whose reviewer has a meta file still ran.
  const r2 = approveRun(featureContract(), dir);
  assert.equal(r2.status, 0, r2.stdout);
  assert.equal(sweepGuard(dir, { tool_use_id: 'toolu_lead_seen' }).permissionDecision, 'allow');
  transcripts({ seen: [[1, 1, 1, 1]] }, {}, cfg);
  fs.appendFileSync(path.join(lead, 'session-1.jsonl'), refusal('toolu_lead_seen') + String.fromCharCode(10));
  const measured = approveIn(dir, [r2.f, '--outcome', '--none-ran'], { CLAUDE_CONFIG_DIR: cfg });
  assert.equal(measured.status, 1);
  assert.match(measured.stdout, /started/);
});

// why: guards rule:sweep-auto-approval
test('project caps lower every limit', () => {
  const lowered = (capsFor) => { const d = sweepRepo(); fs.mkdirSync(path.join(d, '.kit')); fs.writeFileSync(path.join(d, '.kit', 'sweep-approval.json'), JSON.stringify({ caps: { feature: capsFor } })); return d; };
  const plusOne = { ...featureContract(), roles: [...featureContract().roles, role('privacy', 'Which fields leave the device now?')] };
  assert.equal(approveRun(plusOne).status, 0);
  assert.match(approveRun(plusOne, lowered({ maxExtras: 0 })).stdout, /1 roles beyond the feature floor[\s\S]*cap of 0/);
  assert.match(approveRun(featureContract(), lowered({ maxRoleBudget: 50000 })).stdout, /per-role cap of 50000/);
  assert.match(approveRun(featureContract(), lowered({ maxTotalBudget: 100000 })).stdout, /cap of 100000/);
  assert.match(approveRun(featureContract(), lowered({ maxAgents: 4 })).stdout, /cap of 4/);
  assert.match(approveRun({ ...featureContract(), roles: [...featureContract().roles, role('security', 'Can a replayed token reach the import queue?')] }, lowered({ maxExtras: 0 })).stdout, /1 roles beyond the feature floor/, 'a fourth security role is an extra');
});

// K114 (1.42.0, the token proof: 92 of 119 reviewer runs since 1.31.0 were on the top model, while MC3 found mid-model
// reviewers equal): a role that names no model runs on the mid model, except security and the novel lens, which stay on
// the top model with no model named; a reviewer that ran on another model than its role's is caught at the outcome.
// why: guards rule:sweep-auto-approval
test('a sweep role with no model runs on the mid model; security and the novel lens on the top model', () => {
  const ok = approveRun(featureContract());
  assert.equal(ok.status, 0, ok.stdout);
  assert.deepEqual(approvalLog(ok.dir).pop().models, ['claude-opus-5-5', 'claude-opus-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']);
  assert.match(ok.stdout, /test-value, claude-sonnet-5-5/);
  assert.match(ok.stdout, /novel-lens, claude-opus-5-5/);
});

// why: guards rule:sweep-auto-approval
test('the default reviewer model in approve.mjs is the reviewer role\'s own model', () => {
  const m = read('user/agents/reviewer.md').match(/^model:\s*(\S+)/m)[1];
  assert.match(read(APPROVE), new RegExp(`DEFAULT_MODEL = '${m}'`));
});

// A2 (the owner, 2026-11-17, D-3): one sweep per branch, and no re-sweep. Each fix after the sweep carries a
// failing-first test, and CI's test check is the gate.
// why: guards rule:finding-pipeline
test('a re-sweep contract is refused flat with no owner override, and --carried is refused', () => {
  const first = firstSweep();
  const f = path.join(first.dir, 'sweeps', 'resweep.json');
  fs.writeFileSync(f, JSON.stringify({ ...featureContract(), resweepOf: first.f, fixed: [{ finding: 'S2: the error path logs the token', kind: 'security' }] }));
  const r2 = approveIn(first.dir, [f]);
  assert.equal(r2.status, 1, r2.stdout);
  assert.match(r2.stdout, /REFUSED - one sweep per branch[\s\S]*there is no re-sweep[\s\S]*failing-first test/);
  assert.ok(!fs.existsSync(f.replace(/\.json$/, '.triage.md')), 'a refusal is the rule working: no triage report');
  assert.ok(!approvalLog(first.dir).some((e) => e.kind === 'pause'), 'no pause');
  assert.notEqual(approveIn(first.dir, [f, '--owner-yes', 'yes, re-sweep']).status, 0, 'no yes clears it');
  const again = approveIn(first.dir, [first.f]);
  assert.match(again.stdout, /ASK THE OWNER[\s\S]*second sweep on this branch/, 'a plain second pass is still the owner\'s');
  assert.equal(approveIn(first.dir, [first.f, '--owner-yes', 'yes, a second pass']).status, 0);
  const carried = outcome(first, '200000', '1', '1', '0', ['--carried', '0']);
  assert.notEqual(carried.status, 0, carried.stdout);
  assert.match(carried.stdout, /there is no re-sweep now/);
  fs.writeFileSync(f, JSON.stringify({ ...featureContract(), resweepOf: first.f }));
  assert.match(approveIn(first.dir, [f]).stdout, /REFUSED/);
  const g = sweepGuard(first.dir);
  assert.equal(g.permissionDecision, 'deny');
  assert.match(g.permissionDecisionReason, /refused/i);
  assert.doesNotMatch(g.permissionDecisionReason, /--owner-yes/);
});

// Found by the 1.16.0 branch's re-sweep (2026-11-03): an approval closed with --none-ran is not a sweep that ran.
// why: guards rule:sweep-tiers
test('--none-ran reads every clearing of this round, and only an approved contract has one', () => {
  const dir = sweepRepo();
  const r = approveRun(featureContract(), dir);
  assert.equal(sweepGuard(dir).permissionDecision, 'allow', 'a reviewer starts under the approval');
  approveIn(dir, [r.f, '--escape', 'a bug slipped through']);
  assert.match(approveIn(dir, [r.f]).stdout, /outcome of the last approved sweep first/);
  assert.notEqual(approveIn(dir, [r.f, '--owner-yes', 'yes go']).status, 0, 'nothing was asked, so no yes opens more slots');
  const none = approveIn(dir, [r.f, '--outcome', '--none-ran']);
  assert.equal(none.status, 1, none.stdout);
  assert.match(none.stdout, /started/);
  const asked = approveRun(askContract());
  assert.match(approveIn(asked.dir, [asked.f, '--outcome', '--none-ran']).stdout, /has none/);
});

// why: guards rule:sweep-tiers
test('a modifiers value that is not a list goes back to be fixed; the fix options fit the reason', () => {
  const r = approveRun({ tier: 'fix', modifiers: 'security-sensitive', roles: fixFloor() }, fixRepo());
  assert.equal(r.status, FIX_EXIT, r.stdout);
  assert.match(r.stdout, /modifiers must be a list/);
  const budget = featureContract();
  budget.roles[0].calls = 0;
  assert.match(approveRun(budget).stdout, /How: Set each role's "calls"/);
});

// why: catches a break in user/skills/pre-pr-sweep/approve.mjs; the only test that caught it when tagged, others catch it too since the build 14 audit
test('a transcript whose last model is synthetic is read by its real model; one with no model pauses', () => {
  const r = approveRun(featureContract());
  const cfg = transcripts({ y1: [[1, 1, 1, 1], { model: '<synthetic>', u: [0, 0, 0, 0] }], y2: [[1, 1, 1, 1]], y3: [[1, 1, 1, 1]], y4: [[1, 1, 1, 1]], y5: [[1, 1, 1, 1]] }, {}, undefined, undefined, { y4: 'claude-sonnet-5-5' });
  const o = approveIn(r.dir, [r.f, '--outcome', '--agents', 'y1,y2,y3,y4,y5', '--findings', '1', '--real', '1', '--duplicates', '0'], { CLAUDE_CONFIG_DIR: cfg });
  assert.equal(o.status, 0, o.stdout);
  assert.doesNotMatch(o.stdout, /paused/);
  const n = approveRun(featureContract());
  const cfg2 = transcripts({ z1: [{ model: null, u: [1, 1, 1, 1] }], z2: [[1, 1, 1, 1]], z3: [[1, 1, 1, 1]], z4: [[1, 1, 1, 1]], z5: [[1, 1, 1, 1]] }, {}, undefined, undefined, { z4: 'claude-sonnet-5-5' });
  assert.match(approveIn(n.dir, [n.f, '--outcome', '--agents', 'z1,z2,z3,z4,z5', '--findings', '1', '--real', '1', '--duplicates', '0'], { CLAUDE_CONFIG_DIR: cfg2 }).stdout, /paused[\s\S]*ran on no recorded model/);
});

// From a project's kit-gap log (2026-10-31): a second Claude config folder (CLAUDE_CONFIG_DIR) ran without the kit,
// and a repo with its own CLAUDE.md got no pointer to the kit's rules.
// why: guards rule:outward-acts
test('the installer and the session hook honor CLAUDE_CONFIG_DIR, and the hook names the folder it checked', () => {
  const cfg = makeTemp('cfg-');
  const env = { ...process.env, CLAUDE_CONFIG_DIR: cfg };
  delete env.KIT_CLAUDE_HOME;
  const hook = spawnSync('node', [path.resolve('project/.claude/kit-hook.cjs'), 'session-start'], { input: '{}', encoding: 'utf8', env: { ...env, CLAUDE_PROJECT_DIR: cfg } });
  assert.ok(hook.stdout.includes(cfg.split(path.sep).join('/')) || hook.stdout.includes(JSON.stringify(cfg).slice(1, -1)), hook.stdout);
  // This checkout is a branch or a CI merge, not a release, so it installs by name into the throwaway config folder.
  const r = spawnSync('node', [path.resolve('scripts/kit.mjs'), 'install', 'user', '--unreleased'], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(fs.existsSync(path.join(cfg, 'kit-install.json')), 'installed into the config folder');
});
