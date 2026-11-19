// Tests for sweep budgets, call caps, token ceilings, retries and the hook check: moved word for word from tests/kit.test.mjs (T10, build 18).

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

// What the sweep itself commits is not source. The contract, the project's caps file and a file under docs/ used
// to count as added source, so a fix or triage sweep went to the owner the moment its contract was committed.
const fixContract = () => ({ tier: 'fix', modifiers: [], roles: fixFloor() });

// why: guards rule:sweep-tiers
test('a committed contract, the caps file and a docs json do not move a fix or triage sweep up a tier', () => {
  const dir = fixRepo({ '.kit/sweep-approval.json': '{"caps":{}}\n', 'docs/migrations/1.0.0.json': '{"a":1}\n' });
  const f = path.join(dir, 'sweeps', 'contract.json');
  fs.writeFileSync(f, JSON.stringify(fixContract(), null, 2));
  commitAll(dir, 'contract', true);
  const r = approveIn(dir, [f]);
  assert.equal(r.status, 0, r.stdout);
  const t = sweepRepo({ 'README.md': 'y\n' });
  const tf = path.join(t, 'sweeps', 'contract.json');
  fs.writeFileSync(tf, JSON.stringify({ tier: 'triage', modifiers: [], roles: [role('triage', 'Any secret or personal data in the diff?')] }, null, 2));
  commitAll(t, 'contract', true);
  assert.equal(approveIn(t, [tf]).status, 0, 'a triage sweep counts neither the contract file nor its lines');
});

// why: guards rule:sweep-tiers
test('any other added json is still source: a fix tier asks the owner', () => {
  const r = approveRun(fixContract(), fixRepo({ 'src/schema.json': '{}\n' }));
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /ASK THE OWNER[\s\S]*added source file \(src\/schema\.json\)/);
  const other = fixRepo();
  fs.writeFileSync(path.join(other, 'sweeps', 'data.json'), '{"tier":1}\n');
  commitAll(other, 'data', true);
  assert.match(approveRun(fixContract(), other).stdout, /added source file \(sweeps\/data\.json\)/, 'beside the contract, only a contract is left out');
});

// A mistake Claude can fix is not the owner's. Its own answer and exit code, no triage report, no owner yes.
// why: guards rule:sweep-auto-approval
test('a contract mistake answers FIX THE CONTRACT with its own exit code, and the owner is not asked', () => {
  const cases = [
    [(c) => { c.roles.pop(); }, /novel/i],
    [(c) => { c.roles.splice(0, 1); }, /security/i],
    [(c) => { c.roles[1].question = c.roles[0].question.replace('Can', 'Could'); }, /same question/i],
    [(c) => { c.roles.push(role('astrology', 'What do the stars say about this diff?')); }, /kind/i],
    [(c) => { c.roles[0].calls = true; }, /call cap/i],
    [(c) => { c.roles[2].context = []; }, /context/i],
    [(c) => { c.roles[2].context = ['']; }, /context/i],
    [(c) => { c.roles[2].finding = ' .'; }, /finding/i],
    [(c) => { c.modifiers = ['new-dependency']; }, /supply-chain/i],
    [(c) => { c.modifiers = ['nope']; }, /unknown modifier/i],
    [(c) => { c.tier = 'nonsense'; }, /unknown tier/i],
    [(c) => { c.tier = 'constructor'; }, /unknown tier/i],
  ];
  for (const [change, why] of cases) {
    const c = featureContract();
    change(c);
    const r = approveRun(c);
    assert.equal(r.status, FIX_EXIT, `${why}: ${r.stdout}`);
    assert.match(r.stdout, /FIX THE CONTRACT/);
    assert.doesNotMatch(r.stdout, /ASK THE OWNER/);
    assert.match(r.stdout, why);
    assert.equal(approvalLog(r.dir).pop().decision, 'fix');
    assert.equal(fs.existsSync(r.f.replace(/\.json$/, '.triage.md')), false, 'nothing for the owner to read');
  }
});

// why: guards rule:sweep-auto-approval
test('work not committed and a run from the wrong checkout are Claude\'s to fix', () => {
  const dir = fixRepo();
  fs.writeFileSync(path.join(dir, 'src/page.ts'), 'export const page = 3;\n');
  const dirty = approveRun(fixContract(), dir);
  assert.equal(dirty.status, FIX_EXIT, dirty.stdout);
  assert.match(dirty.stdout, /not committed/);
  const main = fixRepo();
  g(main, 'checkout', '-q', 'main');
  fs.mkdirSync(path.join(main, 'sweeps'), { recursive: true });
  const r = approveRun(fixContract(), main);
  assert.equal(r.status, FIX_EXIT, r.stdout);
  assert.match(r.stdout, /no changes against/);
});

// why: guards rule:sweep-auto-approval
test('the last sweep\'s missing outcome is Claude\'s to log, not an owner ask', () => {
  const r = approveRun(featureContract());
  assert.equal(r.status, 0, r.stdout);
  const next = approveIn(r.dir, [r.f]);
  assert.equal(next.status, FIX_EXIT, next.stdout);
  assert.match(next.stdout, /FIX THE CONTRACT[\s\S]*outcome of the last approved sweep/);
});

// why: guards rule:sweep-auto-approval
test('a real out-of-bounds reason still asks the owner, and a fixable mistake beside it is fixed first', () => {
  const asFix = { tier: 'fix', modifiers: [], roles: fixFloor() };
  const r = approveRun(asFix, sweepRepo());
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /ASK THE OWNER[\s\S]*added source file/);
  const both = approveRun({ ...asFix, roles: asFix.roles.slice(0, 1) }, sweepRepo());
  assert.equal(both.status, FIX_EXIT, 'the owner reads a contract only once it is whole');
  assert.match(both.stdout, /FIX THE CONTRACT[\s\S]*owner decides: an added source file/);
  assert.equal(approveRun({ tier: 'first push', roles: [] }).status, 1, 'an owner tier is always the owner\'s');
});

// why: guards rule:sweep-auto-approval
test('FIX THE CONTRACT clears nothing: the guard refuses a reviewer and there is no owner yes to log', () => {
  const c = featureContract();
  c.roles.pop();
  const r = approveRun(c);
  assert.equal(r.status, FIX_EXIT, r.stdout);
  const d = sweepGuard(r.dir);
  assert.equal(d.permissionDecision, 'deny');
  assert.match(d.permissionDecisionReason, /fix the contract/i);
  assert.doesNotMatch(d.permissionDecisionReason, /--owner-yes/);
  assert.notEqual(approveIn(r.dir, [r.f, '--owner-yes', 'yes go']).status, 0, 'no ask, so no yes');
});

// The owner, 2026-11-03 (option B) and 2026-11-04 (the hook): a role's spend is about 14k x calls + g x calls^2 / 2,
// so its budget comes from a call cap the script computes from, never a typed number.
// why: guards rule:sweep-auto-approval
test('a role\'s budget is computed from its call cap, and a typed budget changes nothing', () => {
  const c = featureContract();
  c.roles.forEach((x) => { x.calls = 12; x.budget = 1; });
  const r = approveRun(c);
  assert.equal(r.status, 0, r.stdout);
  const line = approvalLog(r.dir).pop();
  assert.equal(line.budget, 5 * (14000 * 12 + 3000 * 12 * 12 / 2));
  assert.deepEqual(line.calls, [12, 12, 12, 12, 12]);
  assert.match(r.stdout, /12 calls, budget 384,000/);
});

// why: guards rule:sweep-auto-approval
test('a role that must read a file over 40 KB gets the larger growth, read from the branch and not the contract', () => {
  const dir = sweepRepo({ 'src/big.ts': 'x'.repeat(41 * 1024), 'src/small.ts': 'x\n', 'src/sync.test.ts': 'test\n' });
  const c = featureContract();
  c.roles.forEach((x) => { x.calls = 12; });
  c.roles[0].context = ['src/big.ts:120', 'rule:pre-pr-deep-sweep'];
  c.roles[1].context = ['src/small.ts'];
  const r = approveRun(c, dir);
  assert.equal(r.status, 0, r.stdout);
  assert.equal(approvalLog(dir).pop().budget, (14000 * 12 + 6000 * 72) + 4 * (14000 * 12 + 3000 * 72));
});

// why: guards rule:sweep-auto-approval
test('a call cap is a whole number; over the standard needs a reason; never over 2x', () => {
  for (const bad of [undefined, 0, 4, 1.5, '12', true]) {
    const c = featureContract();
    c.roles[0].calls = bad;
    const r = approveRun(c);
    assert.equal(r.status, FIX_EXIT, `${bad}: ${r.stdout}`);
    assert.match(r.stdout, /no call cap/);
  }
  const over = featureContract();
  over.roles[0].calls = 16;
  assert.match(approveRun(over).stdout, /FIX THE CONTRACT[\s\S]*callsReason/);
  over.roles[0].callsReason = 'xxxxxxxxxxxxxxx';
  assert.match(approveRun(over).stdout, /callsReason/, 'a padded reason is no reason');
  const reason = featureContract();
  reason.roles[0].calls = 30;
  reason.roles[0].callsReason = 'a 40-file diff across the import parser';
  assert.equal(approveRun(reason).status, 0);
  reason.roles[0].calls = 31;
  const beyond = approveRun(reason);
  assert.equal(beyond.status, 1, 'the 2x bound is the owner\'s');
  assert.match(beyond.stdout, /ASK THE OWNER[\s\S]*over 2x the standard of 15/);
});

// why: guards rule:sweep-auto-approval
test('the 25% trip stays on the whole sweep: one role over its own budget does not pause', () => {
  const r = approveRun(featureContract());
  const budget = approvalLog(r.dir).pop().budget;
  const roles = JSON.parse(read(r.f)).roles;
  const ids = roles.map(() => `t${++agentSeq}`);
  const cfg = transcripts(Object.fromEntries(ids.map((id, i) => [id, [[0, i ? 1000 : Math.floor(budget * 0.9), 0, 0], [0, 1, 0, 0]]])), {}, undefined, undefined, roleModels(ids, roles));
  const o = approveIn(r.dir, [r.f, '--outcome', '--agents', ids.join(','), '--findings', '4', '--real', '3', '--duplicates', '0'], { CLAUDE_CONFIG_DIR: cfg });
  assert.equal(o.status, 0, o.stdout);
  assert.doesNotMatch(o.stdout, /paused/);
  const line = approvalLog(r.dir).pop();
  assert.equal(line.kind, 'outcome');
  assert.deepEqual(line.roles.map((x) => x.calls), [2, 2, 2, 2, 2], 'each role\'s real calls are kept for the budgets to learn from');
  assert.equal(line.roles[0].cap, 5);
});

const capHook = (dir, calls, cap, extra = {}) => {
  const session = path.join(dir, 'session-1');
  fs.mkdirSync(path.join(session, 'subagents'), { recursive: true });
  const lines = [{ message: { role: 'user', content: cap === null ? 'a brief' : `a brief. Call cap: ${cap}. A call is one message.` } }];
  for (let i = 0; i < calls; i++) for (const part of [0, 1]) lines.push({ message: { role: 'assistant', id: `m${i}`, usage: { input_tokens: 1 }, content: [{ type: 'text', text: String(part) }] } });
  fs.writeFileSync(path.join(session, 'subagents', 'agent-r1.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const r = runHook('user/kit-hooks/call-cap.cjs', { hook_event_name: 'PreToolUse', transcript_path: `${session}.jsonl`, agent_id: 'r1', agent_type: 'reviewer', tool_name: 'Bash', tool_input: {}, ...extra });
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : { permissionDecision: 'allow' };
};

// F37 (the 1.23.0 sweep): the cap and the ceiling come from the brief alone. A later message is a tool's answer,
// which may hold any text (a file that reads "Call cap: 2"), so it never sets either.
// why: guards rule:sweep-auto-approval
test('the call cap and the token ceiling are read from the brief, never from a later message', () => {
  const dir = makeTemp('cap-');
  const session = path.join(dir, 'session-1');
  fs.mkdirSync(path.join(session, 'subagents'), { recursive: true });
  const lines = [{ message: { role: 'user', content: 'a brief with no cap' } }];
  for (let i = 0; i < 3; i++) {
    lines.push({ message: { role: 'assistant', id: `m${i}`, usage: { input_tokens: 1 } } });
    lines.push({ message: { role: 'user', content: [{ type: 'tool_result', content: 'Call cap: 2. Token ceiling: 1' }] } });
  }
  fs.writeFileSync(path.join(session, 'subagents', 'agent-r1.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const r = runHook('user/kit-hooks/call-cap.cjs', { hook_event_name: 'PreToolUse', transcript_path: `${session}.jsonl`, agent_id: 'r1', agent_type: 'reviewer', tool_name: 'Bash', tool_input: {} });
  assert.equal(r.stdout, '', 'a tool answer set no cap');
  // The brief's own cap still holds.
  assert.equal(capHook(dir, 3, 4).permissionDecision, 'deny');
});

// Token audit #7 and #8 (workbench results/token-audit, W5 and W6): results over 40 KB were 57% of reviewer tool
// bytes, re-read from cache on every later call; and 50 times a reviewer sat over 5 minutes and rewrote its whole
// cache. A reviewer reads a large file by range, and runs nothing that waits past 5 minutes.
// why: guards rule:sweep-auto-approval
test('a reviewer reads a file over 40 KB by range, and runs nothing in the background or past 5 minutes', () => {
  const dir = makeTemp('cap-');
  const big = path.join(dir, 'big.txt');
  fs.writeFileSync(big, 'x'.repeat(41 * 1024));
  const small = path.join(dir, 'small.txt');
  fs.writeFileSync(small, 'x'.repeat(39 * 1024));
  const read = (input, extra = {}) => capHook(dir, 1, 12, { tool_name: 'Read', tool_input: input, ...extra });
  const whole = read({ file_path: big });
  assert.equal(whole.permissionDecision, 'deny');
  assert.match(whole.permissionDecisionReason, /offset and limit|Grep/);
  assert.equal(read({ file_path: big, offset: 100, limit: 200 }).permissionDecision, 'allow', 'a range of it');
  assert.equal(read({ file_path: big, limit: 200 }).permissionDecision, 'allow');
  assert.equal(read({ file_path: small }).permissionDecision, 'allow', 'a file under 40 KB, whole');
  assert.equal(read({ file_path: path.join(dir, 'missing.txt') }).permissionDecision, 'allow', 'Read says it is missing');
  assert.equal(read({ file_path: big }, { agent_type: 'builder' }).permissionDecision, 'allow', 'only reviewers');
  for (const tool of ['Bash', 'PowerShell']) {
    const run = (input) => capHook(dir, 1, 12, { tool_name: tool, tool_input: { command: 'npm test', ...input } });
    assert.equal(run({ run_in_background: true }).permissionDecision, 'deny', `${tool} in the background`);
    const long = run({ timeout: 600000 });
    assert.equal(long.permissionDecision, 'deny', `${tool} past 5 minutes`);
    assert.match(long.permissionDecisionReason, /5 minutes/);
    assert.equal(run({ timeout: 300000 }).permissionDecision, 'allow', `${tool} at 5 minutes`);
    assert.equal(run({}).permissionDecision, 'allow', `${tool} with the default timeout`);
  }
  assert.equal(capHook(dir, 1, 12, { tool_name: 'Monitor', tool_input: { command: 'tail -f x' } }).permissionDecision, 'deny', 'a monitor waits');
});

// N1's other half: a checker reads like a reviewer, so it waits on nothing past 5 minutes either; a builder's own
// test run may be long, but a background run or a monitor leaves it idle, and its cache is written again.
// why: guards rule:sub-agent-verification
test('a checker runs nothing that waits past 5 minutes, and a builder runs nothing in the background', () => {
  const dir = makeTemp('cap-');
  const as = (type, tool, input) => capHook(dir, 1, 12, { agent_type: type, tool_name: tool, tool_input: { command: 'npm test', ...input } }).permissionDecision;
  assert.equal(as('checker', 'Bash', { run_in_background: true }), 'deny');
  assert.equal(as('checker', 'PowerShell', { timeout: 600000 }), 'deny');
  assert.equal(as('checker', 'Monitor', {}), 'deny');
  assert.equal(as('checker', 'Bash', {}), 'allow');
  assert.equal(as('builder', 'Bash', { run_in_background: true }), 'deny');
  assert.equal(as('builder', 'Monitor', {}), 'deny');
  assert.equal(as('builder', 'Bash', { timeout: 600000 }), 'allow', 'a builder\'s long test run is its job');
  assert.equal(as('builder', 'Bash', {}), 'allow');
  assert.equal(capHook(dir, 20, 12, { agent_type: 'checker' }).permissionDecision, 'allow', 'no call cap outside a sweep');
});

// E27: the owner's yes and resume are the owner's; no agent the lead starts (reviewer, checker, builder) may log one.
// why: guards rule:outward-acts
test('no agent may log the owner\'s yes or a resume, in any shell', () => {
  const dir = makeTemp('cap-');
  for (const type of ['reviewer', 'checker', 'builder', 'general-purpose'])
    for (const [tool, command] of [['Bash', 'node ~/.claude/skills/pre-pr-sweep/approve.mjs c.json --owner-yes "yes" --thread cmsg_Abcdefgh'], ['PowerShell', 'node "$HOME\\.claude\\skills\\pre-pr-sweep\\approve.mjs" --resume --thread cmsg_Abcdefgh'], ['Bash', 'node approve.mjs --owner-setup --thread cmsg_Abcdefgh']]) {
      const r = capHook(dir, 1, 12, { agent_type: type, tool_name: tool, tool_input: { command } });
      assert.equal(r.permissionDecision, 'deny', `${type} ${tool}`);
      assert.match(r.permissionDecisionReason, /the owner's/);
    }
  assert.equal(capHook(dir, 1, 12, { agent_type: 'reviewer', tool_name: 'Bash', tool_input: { command: 'node approve.mjs c.json --outcome --agents a' } }).permissionDecision, 'allow');
});

// why: guards rule:sweep-auto-approval
test('the call-cap hook counts real calls and refuses tools near the cap, but never the report', () => {
  const dir = makeTemp('cap-');
  // The hook sees the calls before the one it is asked about, and that one is spent already: refused, it still costs a
  // call, and the report is one more. So the cap's last two calls are the refused one and the report (build 11: the
  // 1.36.1 sweep's role 6 ran 16 calls against 15, refused at its 16th).
  assert.equal(capHook(dir, 9, 12).permissionDecision, 'allow', 'each message id counts once, however many lines it wrote');
  const stop = capHook(dir, 10, 12);
  assert.equal(stop.permissionDecision, 'deny');
  assert.match(stop.permissionDecisionReason, /hand in your report/);
  assert.equal(capHook(dir, 11, 12, { tool_name: 'SubagentHandback' }).permissionDecision, 'allow');
  assert.equal(capHook(dir, 20, 12, { agent_type: 'builder' }).permissionDecision, 'allow', 'only reviewers are held');
  assert.equal(capHook(dir, 20, null).permissionDecision, 'allow', 'no cap line: the sweep guard stops that at the start');
  assert.equal(capHook(dir, 20, 12, { agent_id: undefined }).permissionDecision, 'allow', 'the lead is never held');
  assert.equal(capHook(dir, 20, 12, { transcript_path: path.join(dir, 'nope.jsonl') }).permissionDecision, 'allow', 'no transcript: the sweep trip stands behind it');
});

// why: guards rule:sweep-auto-approval
test('the sweep guard starts a reviewer only with a brief that carries a call cap from the cleared contract', () => {
  const r = approveRun(featureContract());
  const run = (prompt) => sweepGuard(r.dir, { tool_input: { subagent_type: 'reviewer', prompt } });
  const none = run('review this');
  assert.equal(none.permissionDecision, 'deny');
  assert.match(none.permissionDecisionReason, /Call cap: <n>/);
  assert.equal(run('review this. Call cap: 40.').permissionDecision, 'deny', 'a cap the contract never set');
  assert.equal(run('review this. Call cap: 5.').permissionDecision, 'allow');
});

// M22 option C (the owner, 2026-11-05): a pre-run budget guess cannot land within 25% (sd(log) 0.35+ per sweep), so
// each role is bounded instead. Its token ceiling is the p90 of the last 60 roles the log measured; the hook stops a
// reviewer there, and the pause trips on drift signals. With under 20 roles measured there is no baseline yet, so
// the ceiling is 1.25x the role's budget and the whole-sweep 25% trip stays.
// Past outcomes, as the log holds them: chained lines (each names a hash of the line before), five roles a line.
function seedOutcomes(dir, roles) {
  const f = path.join(dir, '.git', 'kit-sweep-approvals.jsonl');
  const lines = fs.existsSync(f) ? read(f).split('\n').filter(Boolean) : [];
  for (let i = 0; i < roles.length; i += 5) {
    const prev = lines.length ? crypto.createHash('sha256').update(lines[lines.length - 1]).digest('hex').slice(0, 16) : '';
    lines.push(JSON.stringify({ time: new Date(Date.now() - 86400000).toISOString(), kind: 'outcome', contract: path.join(dir, 'sweeps', `old-${i}.json`), budget: 1, tokens: 1, findings: 0, real: 0, duplicates: 0, roles: roles.slice(i, i + 5), prev }));
  }
  fs.writeFileSync(f, lines.join('\n') + '\n');
}
const pastRole = (tokens, extra = {}) => ({ role: 'r', kind: 'security', model: 'claude-opus-5-5', tokens, calls: 6, firstCall: 10000, ...extra });

// why: guards rule:sweep-auto-approval
test('a role\'s token ceiling is the p90 of the last 60 roles measured, or 1.25x its budget before 20 are', () => {
  const dir = sweepRepo();
  // Ten old roles far over everything, then 60 from 10,000 to 600,000: only the last 60 count.
  seedOutcomes(dir, [...Array(10).fill(0).map(() => pastRole(9000000)), ...Array.from({ length: 60 }, (_, i) => pastRole((i + 1) * 10000))]);
  const r = approveRun(featureContract(), dir);
  assert.equal(r.status, 0, r.stdout);
  const d = approvalLog(dir).pop();
  assert.deepEqual(d.ceilings, Array(5).fill(540000));
  assert.match(r.stdout, /Token ceiling: 540000/);
  assert.match(r.stdout, /p90 of the last 60 roles measured/);
  const cold = approveRun(featureContract());
  const c = approvalLog(cold.dir).pop();
  assert.deepEqual(c.ceilings, c.budgets.map((b) => Math.round(b * 1.25)));
  assert.match(cold.stdout, /fewer than 20 roles measured/);
});

// why: guards rule:sweep-auto-approval
test('the sweep guard starts a reviewer only with its role\'s token ceiling from the cleared contract', () => {
  // Role 2 has a larger cap, so a larger budget and ceiling than role 1's.
  const contract = featureContract();
  contract.roles[1].calls = 8;
  const r = approveRun(contract);
  const e = approvalLog(r.dir).pop();
  const brief = (ceiling) => `review. Call cap: 5. Sweep: ${e.hash} role 1.${ceiling} ${JSON.parse(read(r.f)).roles[0].question}`;
  const run = (prompt) => sweepGuard(r.dir, { raw: true, noCeiling: true, tool_input: { subagent_type: 'reviewer', prompt } });
  const none = run(brief(''));
  assert.equal(none.permissionDecision, 'deny');
  assert.match(none.permissionDecisionReason, /Token ceiling: <n>/);
  assert.equal(run(brief(` Token ceiling: ${e.ceilings[0] + 1}.`)).permissionDecision, 'deny', 'a ceiling the contract never set');
  // Another role's ceiling is not this role's (the 1.23.0 sweep: only a ceiling plus one was tried). Checked before
  // the allow below, which takes role 1's one start.
  const other = e.ceilings.find((x) => x !== e.ceilings[0]);
  assert.ok(other, `the roles' ceilings differ: ${e.ceilings}`);
  const borrowed = run(brief(` Token ceiling: ${other}.`));
  assert.equal(borrowed.permissionDecision, 'deny', 'another role\'s ceiling');
  assert.match(borrowed.permissionDecisionReason, /token ceiling/i);
  assert.equal(run(brief(` Token ceiling: ${e.ceilings[0]}.`)).permissionDecision, 'allow');
});

// why: guards rule:sweep-auto-approval
test('a sweep the owner cleared in the pop-up starts its reviewers under the ask\'s token ceilings', () => {
  const r = approveRun(askContract());
  const code = r.stdout.match(/`sweep yes ([0-9a-f]{6})`/)[1];
  const cfg = makeTemp('cfg-');
  ownerTaps(cfg, r.dir, `sweep yes ${code}`);
  const ok = approveIn(r.dir, [r.f, '--owner-yes'], tapEnv(cfg));
  assert.equal(ok.status, 0, ok.stdout);
  const d = approvalLog(r.dir).filter((e) => e.kind === 'decision').pop();
  const c = JSON.parse(read(r.f));
  const brief = (ceiling) => `review. Call cap: ${d.calls[0]}. Sweep: ${d.hash} role 1.${ceiling} ${c.roles[0].question}`;
  const run = (prompt) => sweepGuard(r.dir, { raw: true, noCeiling: true, tool_input: { subagent_type: 'reviewer', prompt } });
  assert.equal(run(brief('')).permissionDecision, 'deny', 'no ceiling in the brief');
  assert.equal(run(brief(` Token ceiling: ${d.ceilings[0] * 10}.`)).permissionDecision, 'deny', 'a ceiling the ask never set');
  assert.equal(run(brief(` Token ceiling: ${d.ceilings[0]}.`)).permissionDecision, 'allow');
});

// A yes line written without ceilings (an older approve.mjs) still has them: the guard reads them from the ask's
// decision line before it, so a brief with a ceiling the ask never set is still refused.
// why: guards rule:test-value (a reviewer started under no ceiling because the owner's yes line carried none)
// planted: {"file":"user/kit-hooks/sweep-guard.cjs","was":"!Array.isArray(ceilings) && e.kind === 'owner-yes'","to":"!Array.isArray(ceilings) && e.kind !== 'owner-yes'"}
test('a pop-up yes line with no ceilings of its own still holds its reviewers to the ask\'s ceilings', () => {
  const r = approveRun(askContract());
  const code = r.stdout.match(/`sweep yes ([0-9a-f]{6})`/)[1];
  const cfg = makeTemp('cfg-');
  ownerTaps(cfg, r.dir, `sweep yes ${code}`);
  assert.equal(approveIn(r.dir, [r.f, '--owner-yes'], tapEnv(cfg)).status, 0);
  const logFile = path.join(r.dir, '.git', 'kit-sweep-approvals.jsonl');
  const lines = read(logFile).trim().split('\n');
  const yes = JSON.parse(lines[lines.length - 1]);
  assert.equal(yes.kind, 'owner-yes');
  delete yes.ceilings;
  lines[lines.length - 1] = JSON.stringify(yes);
  fs.writeFileSync(logFile, lines.join('\n') + '\n');
  const d = approvalLog(r.dir).filter((e) => e.kind === 'decision').pop();
  const c = JSON.parse(read(r.f));
  const brief = (ceiling) => `review. Call cap: ${d.calls[0]}. Sweep: ${d.hash} role 1.${ceiling} ${c.roles[0].question}`;
  const run = (prompt) => sweepGuard(r.dir, { raw: true, noCeiling: true, tool_input: { subagent_type: 'reviewer', prompt } });
  assert.equal(run(brief('')).permissionDecision, 'deny', 'no ceiling in the brief');
  assert.equal(run(brief(` Token ceiling: ${d.ceilings[0] * 10}.`)).permissionDecision, 'deny', 'a ceiling the ask never set');
  assert.equal(run(brief(` Token ceiling: ${d.ceilings[0]}.`)).permissionDecision, 'allow');
});

// why: guards rule:sweep-auto-approval
test('the call-cap hook stops a reviewer before a call would take it past its token ceiling', () => {
  const dir = makeTemp('ceil-');
  const session = path.join(dir, 'session-1');
  fs.mkdirSync(path.join(session, 'subagents'), { recursive: true });
  const hook = (calls, extra = {}, sizes = Array(calls).fill(30000), ceiling = 200000) => {
    const lines = [{ message: { role: 'user', content: `a brief. Call cap: 40. Token ceiling: ${ceiling}.` } }];
    // Streaming writes a message's id on several lines; it counts once, at its last line.
    for (let i = 0; i < calls; i++) for (const part of [1, sizes[i]]) lines.push({ message: { role: 'assistant', id: `m${i}`, usage: { input_tokens: 0, cache_read_input_tokens: part, cache_creation_input_tokens: 0, output_tokens: 0 } } });
    fs.writeFileSync(path.join(session, 'subagents', 'agent-r1.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const r = runHook('user/kit-hooks/call-cap.cjs', { hook_event_name: 'PreToolUse', transcript_path: `${session}.jsonl`, agent_id: 'r1', agent_type: 'reviewer', tool_name: 'Read', tool_input: { file_path: 'x', limit: 5 }, ...extra });
    return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : { permissionDecision: 'allow' };
  };
  // The call asked about is spent already; refused, the report follows it. Allowed, one more call and then the report.
  assert.equal(hook(3).permissionDecision, 'allow', '90,000 spent; this call, one more and the report: 180,000');
  const stop = hook(4);
  assert.equal(stop.permissionDecision, 'deny', '120,000 spent; this call, one more and the report would pass 200,000');
  assert.match(stop.permissionDecisionReason, /token ceiling reached \(120,000 of 200,000\)[\s\S]*hand in your report/i);
  assert.equal(hook(4, { tool_name: 'SubagentHandback' }).permissionDecision, 'allow', 'the report always goes');
  assert.equal(hook(4, { agent_type: 'builder' }).permissionDecision, 'allow', 'only reviewers');
  // Build 11: a real role of the 1.36.0 sweep (its call sizes, in order) ran to 974,950 against 827,461. Replayed, the
  // hook stops it where the call it refuses and the report still land under the ceiling.
  const real = [14198, 17438, 21162, 43440, 46640, 71479, 73781, 80176, 80788, 83380, 85567, 86987, 87435, 89919, 92561];
  let n = 1;
  while (n < real.length && hook(n, {}, real, 827461).permissionDecision === 'allow') n++;
  const spent = real.slice(0, n + 2).reduce((t, x) => t + x, 0);
  assert.ok(n < real.length - 2, `stopped at call ${n + 1}`);
  assert.ok(spent <= 827461, `the refused call and the report end at ${spent}, under 827,461`);
  // The build 11 sweep: the context grows each call, so a jump (a large file read) makes the next calls cost more than
  // the last did. 50,000 spent with a last call of 30,000 after 10,000: three flat calls fit, three growing ones do not.
  const grow = hook(3, {}, [10000, 10000, 30000]);
  assert.equal(grow.permissionDecision, 'deny', 'the next calls grow as the last one did');
  assert.equal(hook(3, {}, [30000, 30000, 30000], 230000).permissionDecision, 'allow', 'flat calls under the same room');
});

// The build 11 sweep: the message making a call may be in the transcript when the hook reads it, or not yet. A call
// still waiting on its answer is the one asked about, so it never counts twice and the cap lands on the same call.
// why: guards rule:sweep-auto-approval
test('the call cap counts the calls before this one, whether or not this one is written yet', () => {
  const dir = makeTemp('cap-');
  const session = path.join(dir, 'session-1');
  fs.mkdirSync(path.join(session, 'subagents'), { recursive: true });
  const hook = (calls, current, extra = {}) => {
    const lines = [{ message: { role: 'user', content: 'a brief. Call cap: 12.' } }];
    for (let i = 0; i < calls; i++) {
      lines.push({ message: { role: 'assistant', id: `m${i}`, usage: { input_tokens: 1 }, content: [{ type: 'tool_use', id: `t${i}`, name: 'Read', input: {} }] } });
      lines.push({ message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: 'ok' }] } });
    }
    if (current) lines.push({ message: { role: 'assistant', id: 'mc', usage: { input_tokens: 1 }, content: [{ type: 'tool_use', id: 'tc', name: 'Read', input: {} }] } });
    fs.writeFileSync(path.join(session, 'subagents', 'agent-r1.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const r = runHook('user/kit-hooks/call-cap.cjs', { hook_event_name: 'PreToolUse', transcript_path: `${session}.jsonl`, agent_id: 'r1', agent_type: 'reviewer', tool_name: 'Bash', tool_input: {}, tool_use_id: 'tc', ...extra });
    return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : 'allow';
  };
  for (const current of [false, true]) {
    assert.equal(hook(9, current), 'allow', `nine before it, this one ${current ? '' : 'not '}written`);
    assert.equal(hook(10, current), 'deny', `ten before it, this one ${current ? '' : 'not '}written`);
  }
  assert.equal(hook(9, true, { tool_use_id: undefined }), 'allow', 'with no call id, the last call still waiting is this one');
});

// Calls started together are written before any answer: the call asked about is then not the last message, and it
// is found by its own id. Counted instead as "the last one", a later answered call would be left out and this one
// counted, a call too many against the cap.
// why: guards rule:test-value (a reviewer stopped one call early when the call asked about is not the last message)
// planted: {"file":"user/kit-hooks/call-cap.cjs","was":"input.tool_use_id || ''","to":"input.tool_use_id && ''"}
test('the call cap leaves out the call asked about by its id, even when a later call is already answered', () => {
  const dir = makeTemp('cap-');
  const session = path.join(dir, 'session-1');
  fs.mkdirSync(path.join(session, 'subagents'), { recursive: true });
  const call = (id) => ({ message: { role: 'assistant', id: `m-${id}`, usage: { input_tokens: 1 }, content: [{ type: 'tool_use', id, name: 'Read', input: {} }] } });
  const answer = (id) => ({ message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
  // Cap 5 stops at 3 calls counted. Two answered calls and the one asked about make three written; it is left out.
  const lines = [{ message: { role: 'user', content: 'a brief. Call cap: 5.' } }, call('t1'), answer('t1'), call('t2'), call('t3'), answer('t3')];
  fs.writeFileSync(path.join(session, 'subagents', 'agent-r1.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const r = runHook('user/kit-hooks/call-cap.cjs', { hook_event_name: 'PreToolUse', transcript_path: `${session}.jsonl`, agent_id: 'r1', agent_type: 'reviewer', tool_name: 'Bash', tool_input: {}, tool_use_id: 't2' });
  assert.equal(r.stdout, '', 'two calls before this one, under the cap');
});

// Each sweep below runs on a log of 25 measured roles of 200,000 tokens over 6 calls, starting at 10,000: the
// ceiling is 200,000, content per call 33,333, and every baseline the drift signals read exists. Each role's cap is 5.
function driftSweep(spec) {
  const dir = sweepRepo();
  seedOutcomes(dir, Array.from({ length: 25 }, () => pastRole(200000)));
  const r = approveRun(featureContract(), dir);
  assert.equal(r.status, 0, r.stdout);
  const ids = spec.map(() => `t${++agentSeq}`);
  const cfg = transcripts(Object.fromEntries(ids.map((id, i) => [id, spec[i]])), {}, undefined, undefined, roleModels(ids, featureContract().roles));
  const o = approveIn(dir, [r.f, '--outcome', '--agents', ids.join(','), '--findings', '4', '--real', '3', '--duplicates', '0'], { CLAUDE_CONFIG_DIR: cfg });
  assert.equal(o.status, 0, o.stdout);
  return { o, line: approvalLog(dir).filter((e) => e.kind === 'outcome').pop() };
}
// A role that starts at 10,000 and reads 28,000 on each of 5 more calls: 150,000, well inside its ceiling.
const usual = () => [[10000, 0, 0, 0], ...Array(5).fill([0, 28000, 0, 0])];

// why: guards rule:sweep-auto-approval
test('under token ceilings a sweep 40% over its budget does not pause: the bound holds each role instead', () => {
  const { o, line } = driftSweep(Array(5).fill(0).map(usual));
  assert.equal(line.tokens, 750000, 'over 1.25x the 537,500 budget');
  assert.doesNotMatch(o.stdout, /paused/);
  assert.deepEqual(line.roles[0].split, { input: 10000, cacheRead: 140000, cacheWrite: 0, output: 0 }, 'the split is logged, for a dollar ceiling later');
  assert.equal(line.roles[0].ceiling, 200000);
  assert.equal(line.roles[0].firstCall, 10000);
  assert.equal(line.roles[0].stopped, false);
});

// why: guards rule:sweep-auto-approval
test('the drift signals pause a sweep, each by name', () => {
  const over = driftSweep([[[10000, 0, 0, 0], ...Array(5).fill([0, 60000, 0, 0])], usual(), usual(), usual(), usual()]);
  assert.match(over.o.stdout, /paused: .*ceiling did not hold[^\n]*310,000 against 200,000/, '310,000 is past 200,000 plus one 60,000 call');
  // A role the hook stopped: its refusal is in the transcript, and the hand-back is the call after it.
  const atCeiling = () => [[10000, 0, 0, 0], ...Array(4).fill([0, 28000, 0, 0]), { refused: 'Token ceiling reached (122,000 of 200,000): one more call would pass it.' }, [0, 60000, 0, 0]];
  // One call that would double a role's spend is no stop when the role finished without one.
  assert.doesNotMatch(driftSweep(Array(5).fill(0).map(() => [[10000, 0, 0, 0], [0, 120000, 0, 0]])).o.stdout, /stopped at their token ceiling/);
  const stopped = [atCeiling(), atCeiling(), usual(), usual(), usual()];
  assert.match(driftSweep(stopped).o.stdout, /paused: .*2 of 5 roles stopped at their token ceiling/);
  assert.doesNotMatch(driftSweep([stopped[0], usual(), usual(), usual(), usual()]).o.stdout, /paused/, 'one of five is no drift');
  const start = Array(5).fill(0).map(() => [[11500, 0, 0, 0], ...Array(5).fill([0, 28000, 0, 0])]);
  assert.match(driftSweep(start).o.stdout, /paused: .*the starting context .*15% over its median of 10,000/);
  const late = { u: [0, 0, 30000, 0], gap: 6 * 60 * 1000 };
  const rewrite = [[[10000, 0, 0, 0], [0, 28000, 0, 0], late], [[10000, 0, 0, 0], late], usual(), usual(), usual()];
  assert.match(driftSweep(rewrite).o.stdout, /paused: .*2 cache re-writes after the first call/);
  // The build 11 sweep: a call soon after the last that reads back less is a context the model trimmed, not an
  // expired cache: the cache lives 5 minutes.
  const soon = { u: [0, 0, 30000, 0], gap: 4 * 60 * 1000 };
  assert.doesNotMatch(driftSweep([[[10000, 0, 0, 0], [0, 28000, 0, 0], soon], [[10000, 0, 0, 0], soon], usual(), usual(), usual()]).o.stdout, /cache re-writes/);
  // After the gap, a miss that still read back just over half the context is one too (the sweep's case: 51.5%).
  const half = { u: [0, 15000, 14000, 0], gap: 6 * 60 * 1000 };
  assert.match(driftSweep([[[10000, 0, 0, 0], [0, 28000, 0, 0], half], [[10000, 0, 0, 0], [0, 28000, 0, 0], half], usual(), usual(), usual()]).o.stdout, /paused: .*2 cache re-writes/);
  // Build 11: a call that reads the whole cache and writes a large batch of new results (a dozen reads at once) is no
  // expired cache. Every role of the 1.36.1 sweep had one such call, and the sweep paused on 7 re-writes that were none.
  const batch = () => [[2, 0, 13600, 323], [2, 13600, 22659, 828], [2, 36259, 2506, 674], ...Array(3).fill([0, 40000, 0, 0])];
  assert.doesNotMatch(driftSweep([batch(), batch(), usual(), usual(), usual()]).o.stdout, /cache re-writes/);
  const heavy = Array(5).fill(0).map(() => [[10000, 0, 0, 0], [0, 60000, 0, 0], [0, 60000, 0, 0]]);
  assert.match(driftSweep(heavy).o.stdout, /paused: .*content per call .*over its p95 of 33,333/);
});

// T6 (build 11): the finding counts were typed by the lead. The reports are now in a checked shape, so the outcome
// counts the findings from them, writes the ledger beside the contract, and refuses a typed count that differs.
// why: guards rule:finding-pipeline
test('the outcome counts the findings from the reviewers\' reports, writes the ledger, and refuses a typed count that differs', () => {
  const dir = sweepRepo();
  const r = approveRun(featureContract(), dir);
  assert.equal(r.status, 0, r.stdout);
  const report = (rows) => ({ handback: ['P', 'ROLE: a role', ...rows, 'Not checked: nothing'].join('\n') });
  const two = report(['high | CONFIRMED | an import writes outside | src/import.ts:12 | ran it', 'low | PLAUSIBLE | a log names a path | src/routes.ts:4 | read it']);
  const same = report(['medium | CONFIRMED | the same import write | src/import.ts:12 | ran it too']);
  const none = report(['No findings']);
  const ids = Array(5).fill(0).map(() => `t${++agentSeq}`);
  const cfg = transcripts({ [ids[0]]: [[10000, 0, 0, 0], two], [ids[1]]: [[10000, 0, 0, 0], same], [ids[2]]: [[10000, 0, 0, 0], none], [ids[3]]: [[10000, 0, 0, 0], none], [ids[4]]: [[10000, 0, 0, 0], none] });
  const run = (findings) => approveIn(dir, [r.f, '--outcome', '--agents', ids.join(','), '--findings', String(findings), '--real', '2', '--duplicates', '1'], { CLAUDE_CONFIG_DIR: cfg });
  const wrong = run(4);
  assert.equal(wrong.status, 1);
  assert.match(wrong.stdout, /--findings 4\b[^\n]*\b3 finding[\s\S]*--findings 3\b/);
  assert.equal(approvalLog(dir).filter((e) => e.kind === 'outcome').length, 0, 'nothing logged');
  const ok = run(3);
  assert.equal(ok.status, 0, ok.stdout);
  const line = approvalLog(dir).filter((e) => e.kind === 'outcome').pop();
  assert.equal(line.findings, 3);
  assert.equal(line.sameLine, 2, 'two roles named src/import.ts:12');
  const ledger = read(path.join(dir, 'sweeps', 'contract-ledger.md'));
  assert.match(ledger, /^\| 1 \| high \| CONFIRMED \|[^\n]*\| src\/import\.ts:12 \|$/m);
  assert.match(ledger, /^\| 2 \| medium \| CONFIRMED \|[^\n]*\| src\/import\.ts:12 \|$/m);
  assert.equal(ledger.split('\n').filter((l) => /^\| \d/.test(l)).length, 3);
});

// The build 11 sweep: only a delivered report counts. A hand-back the canary refused never reached the lead, a run it
// voided counts none, notes out of role are not findings, and one role out of shape is named, never a silent pass.
// why: guards rule:finding-pipeline
test('the findings count reads only delivered reports, skips out-of-role notes, and names a role it cannot read', () => {
  const dir = sweepRepo();
  const r = approveRun(featureContract(), dir);
  assert.equal(r.status, 0, r.stdout);
  const shaped = (rows) => ['P', 'ROLE: a role', ...rows, 'Not checked: nothing'].join('\n');
  const one = 'high | CONFIRMED | a write outside | src/import.ts:12 | ran it';
  const ids = Array(5).fill(0).map(() => `t${++agentSeq}`);
  const spec = {
    // Refused (no Not checked line), then a plain reply: nothing was delivered as a report.
    [ids[0]]: [[10000, 0, 0, 0], { handback: ['P', 'ROLE: a role', one, one, one].join('\n'), refusedWith: 'Your report is out of the shape your brief gives' }, { handback: shaped(['No findings']) }],
    // Out-of-role notes after the findings.
    [ids[1]]: [[10000, 0, 0, 0], { handback: shaped([one, 'Out of role:', 'low | PLAUSIBLE | another area | g:1 | note']) }],
    [ids[2]]: [[10000, 0, 0, 0], { handback: shaped(['No findings']) }],
    [ids[3]]: [[10000, 0, 0, 0], { handback: shaped(['No findings']) }],
    [ids[4]]: [[10000, 0, 0, 0], { handback: shaped(['No findings']) }],
  };
  const run = (cfgSpec, findings) => approveIn(dir, [r.f, '--outcome', '--agents', ids.join(','), '--findings', String(findings), '--real', '1', '--duplicates', '0'], { CLAUDE_CONFIG_DIR: transcripts(cfgSpec) });
  const wrong = run(spec, 4);
  assert.match(wrong.stdout, /hold \(ledger[\s\S]*--findings 1\b/);
  // A void run, and a role whose report is out of shape: the count is not checked, and the roles are named.
  const voided = { ...spec, [ids[0]]: [[10000, 0, 0, 0], { refused: 'Your message did not open the way your rules require, so this run is void' }, { handback: shaped([one]) }] };
  const named = run(voided, 7);
  assert.equal(named.status, 0, named.stdout);
  assert.match(named.stdout, /--findings[^\n]*not checked[^\n]*\b1 \([^)\n]*void/);
  assert.equal(approvalLog(dir).filter((e) => e.kind === 'outcome').pop().findingsChecked, false);
});

// The 1.23.0 sweep's findings on the drift signals.
// why: guards rule:sweep-auto-approval
test('a reviewer that only read the hook\'s words was not stopped: only the hook\'s refusal counts', () => {
  // Roles that read call-cap.cjs or this script see the words in a tool's plain answer.
  const reader = () => [[10000, 0, 0, 0], { read: 'deny(`Token ceiling reached (${n(used)} of ${n(ceiling)}): ...`)' }, { read: 'Token ceiling reached (122,000 of 200,000)' }, ...Array(5).fill([0, 28000, 0, 0])];
  const { o, line } = driftSweep([reader(), reader(), usual(), usual(), usual()]);
  assert.doesNotMatch(o.stdout, /stopped at their token ceiling/);
  assert.equal(line.roles[0].stopped, false);
});

// why: guards rule:outward-acts
test('the ceiling\'s check allows one call past it, the margin the hook works with, and no more', () => {
  // 10,000 + 4 x 28,000 + 100,000 = 222,000: past the 200,000 ceiling by less than its largest call.
  const margin = driftSweep([[[10000, 0, 0, 0], ...Array(4).fill([0, 28000, 0, 0]), [0, 100000, 0, 0]], usual(), usual(), usual(), usual()]);
  assert.doesNotMatch(margin.o.stdout, /did not hold/);
});

// Build 11: the 1.36.0 triage said "the hook is missing or did not fire" for roles whose transcripts held the hook's
// own refusal. A role the hook did stop is named as stopped too late, which points at the hook's margin, not its wiring.
// why: guards rule:sweep-auto-approval
test('a role past its ceiling that the hook did stop is named as stopped too late, not as unhooked', () => {
  const late = [[10000, 0, 0, 0], ...Array(4).fill([0, 50000, 0, 0]), { refused: 'Token ceiling reached (210,000 of 200,000): one more call would pass it.' }, [0, 60000, 0, 0], [0, 70000, 0, 0]];
  const { o } = driftSweep([late, usual(), usual(), usual(), usual()]);
  assert.match(o.stdout, /ceiling did not hold[^\n]*340,000 against 200,000 \(the hook stopped it too late\)/);
  assert.doesNotMatch(o.stdout, /340,000 against 200,000 \(the hook is missing/);
});

// why: guards rule:sweep-auto-approval
test('a role past its call cap pauses the sweep under ceilings too: the cap did not hold', () => {
  // 8 calls of 10,000 against a cap of 5: inside the token ceiling, past the cap's one-call margin.
  const { o } = driftSweep([[[10000, 0, 0, 0], ...Array(7).fill([0, 10000, 0, 0])], usual(), usual(), usual(), usual()]);
  assert.match(o.stdout, /paused: .*ran 8 calls against its cap of 5[^\n]*no call-cap hook/);
});

// why: guards rule:sweep-auto-approval
test('ceilings set from the budgets keep the whole-sweep trip, however many roles were measured since', () => {
  const dir = sweepRepo();
  const r = approveRun(featureContract(), dir);
  assert.match(approvalLog(dir).pop().ceilingFrom, /x each role's budget/);
  // Twenty-five roles are measured after this decision and before its outcome.
  seedOutcomes(dir, Array.from({ length: 25 }, () => pastRole(200000)));
  const ids = Array(5).fill(0).map(() => `t${++agentSeq}`);
  const cfg = transcripts(Object.fromEntries(ids.map((id) => [id, [[10000, 0, 0, 0], ...Array(5).fill([0, 28000, 0, 0])]])));
  const o = approveIn(dir, [r.f, '--outcome', '--agents', ids.join(','), '--findings', '4', '--real', '3', '--duplicates', '0'], { CLAUDE_CONFIG_DIR: cfg });
  assert.match(o.stdout, /paused: .*tokens 750000 ran 40% over the budget/);
});

// why: guards rule:sweep-auto-approval
test('the one guard process runs the call-cap hook on every tool an agent calls, and never for the main session', () => {
  const { routes } = require(path.resolve('project/.claude/guard.cjs'));
  for (const tool of ['Read', 'Grep', 'Bash', 'Agent']) assert.ok(routes(tool, { agent_id: 'a1' }).includes('call-cap.cjs'), tool);
  assert.ok(!routes('Read').includes('call-cap.cjs'), 'the main session');
});

// why: guards rule:sweep-auto-approval
// From 1.37.0 (T6) the wording is in the brief approve.mjs writes (checked in the brief test); the skill sends the lead there.
test('the sweep skill gives the lead the brief\'s call-cap wording', () => {
  const skill = read(path.resolve('user/skills/pre-pr-sweep/SKILL.md'));
  assert.match(skill, /<contract>-brief-<n>\.md/);
  assert.match(skill, /FIX THE CONTRACT/);
});

// PR 17's carry-overs (X5 to X7, X10, C7): what the meter trusts, and the tests the re-sweep found missing.
const logOutcome = (r, ids, cfg, extra = []) => approveIn(r.dir, [r.f, '--outcome', '--agents', ids.join(','), '--findings', '4', '--real', '3', '--duplicates', '0', ...extra], { CLAUDE_CONFIG_DIR: cfg });
const cheapRoles = (n) => Array.from({ length: n }, () => `t${++agentSeq}`);

// why: guards rule:sweep-auto-approval
test('a transcript from another repo is not this sweep\'s spend', () => {
  const r = approveRun(featureContract());
  const ids = cheapRoles(5);
  const cfg = transcripts(Object.fromEntries(ids.map((id) => [id, [[0, 100, 0, 0]]])));
  const other = sweepRepo();
  const f = path.join(cfg, 'projects', 'C--repo', 'session-1', 'subagents', `agent-${ids[0]}.jsonl`);
  fs.writeFileSync(f, read(f).split('\n').map((l) => { if (!l) return l; const e = JSON.parse(l); e.cwd = other; return JSON.stringify(e); }).join('\n'));
  const o = logOutcome(r, ids, cfg);
  assert.equal(o.status, 1, o.stdout);
  assert.match(o.stdout, /ASK THE OWNER[\s\S]*ran in another repo/);
  fs.writeFileSync(f, read(f).split('\n').map((l) => { if (!l) return l; const e = JSON.parse(l); e.cwd = r.dir; return JSON.stringify(e); }).join('\n'));
  const ok = logOutcome(r, ids, cfg);
  assert.equal(ok.status, 0, ok.stdout);
});

// why: guards rule:sweep-tiers
test('a round starts at its clearing, so a reviewer started before it is not this sweep\'s', () => {
  const dir = sweepRepo();
  const bad = featureContract();
  bad.roles.pop();
  const first = approveRun(bad, dir);
  assert.equal(first.status, FIX_EXIT);
  const ids = cheapRoles(5);
  const cfg = transcripts(Object.fromEntries(ids.map((id) => [id, [[0, 100, 0, 0]]])));
  const r = approveRun(featureContract(), dir);
  assert.equal(r.status, 0, r.stdout);
  const o = logOutcome(r, ids, cfg);
  assert.match(o.stdout, /ASK THE OWNER[\s\S]*before this sweep was cleared/);
});

// why: catches a break in user/skills/pre-pr-sweep/approve.mjs; the only test that caught it when tagged, others catch it too since the build 14 audit
test('the model check reads what the decision cleared, in both directions', () => {
  const c = featureContract();
  const r = approveRun(c);
  const edited = JSON.parse(read(r.f));
  edited.roles[0].model = 'claude-sonnet-5-5';
  fs.writeFileSync(r.f, JSON.stringify(edited));
  const ids = cheapRoles(5);
  const cfg = transcripts(Object.fromEntries(ids.map((id, i) => [id, [{ model: i === 0 ? 'claude-sonnet-5-5' : roleModel(c.roles[i]), u: [0, 100, 0, 0] }]])));
  assert.match(logOutcome(r, ids, cfg).stdout, /ran on claude-sonnet-5-5; the contract named claude-opus-5-5/, 'an edit after approval hides nothing');
  const named = featureContract();
  named.roles[3].model = 'claude-sonnet-5-5';
  const s = approveRun(named);
  const ids2 = cheapRoles(5);
  const cfg2 = transcripts(Object.fromEntries(ids2.map((id) => [id, [[0, 100, 0, 0]]])));
  assert.match(logOutcome(s, ids2, cfg2).stdout, /ran on claude-opus-5-5; the contract named claude-sonnet-5-5/, 'a role on a higher model than named stops too');
});

// why: guards rule:sweep-auto-approval
test('outcome numbers are whole and not negative; a reused id is caught in any case', () => {
  const r = approveRun(featureContract());
  const ids = cheapRoles(5);
  const cfg = transcripts(Object.fromEntries(ids.map((id) => [id, [[0, 100, 0, 0]]])), {}, undefined, undefined, roleModels(ids, featureContract().roles));
  for (const bad of ['-1', '1.5']) {
    const o = approveIn(r.dir, [r.f, '--outcome', '--agents', ids.join(','), '--findings', bad, '--real', '0', '--duplicates', '0'], { CLAUDE_CONFIG_DIR: cfg });
    assert.equal(o.status, 1, bad);
    assert.match(o.stdout, /--findings needs a whole number/);
  }
  assert.equal(logOutcome(r, ids, cfg).status, 0);
  nextBranch(r.dir);
  const again = approveRun(featureContract(), r.dir);
  assert.equal(again.status, 0, again.stdout);
  const o = logOutcome(again, ids.map((id) => id.toUpperCase()), cfg);
  assert.match(o.stdout, /already logged for an earlier outcome/);
});

// why: guards rule:sweep-auto-approval
test('--none-ran needs an approval, and an unreadable spend writes its triage report', () => {
  const dir = sweepRepo();
  const c = featureContract();
  const r = approveRun(c, dir);
  const o = logOutcome(r, ['nope1', 'nope2', 'nope3', 'nope4', 'nope5'], transcripts({}));
  assert.equal(o.status, 1, o.stdout);
  const text = read(r.f.replace(/\.json$/, '.triage.md'));
  assert.match(text, /a sweep outcome that cannot be measured/);
  assert.match(text, /agents given: nope1/);
  assert.equal(approveIn(dir, [r.f, '--outcome', '--none-ran']).status, 0);
  assert.match(approveIn(dir, [r.f, '--outcome', '--none-ran']).stdout, /has none/, 'closed once, there is nothing left to close');
});

// why: guards rule:sweep-auto-approval
test('the summary leaves old hand-typed outcomes out of tokens against budget', () => {
  const r = approveRun(featureContract());
  outcome(r, '200000');
  const file = path.join(r.dir, '.git', 'kit-sweep-approvals.jsonl');
  const last = read(file).trim().split('\n').pop();
  const prev = crypto.createHash('sha256').update(last).digest('hex').slice(0, 16);
  fs.appendFileSync(file, JSON.stringify({ kind: 'outcome', contract: r.f, budget: 100, tokens: 90000000, findings: 1, real: 1, duplicates: 0, prev }) + '\n');
  const s = approveIn(r.dir, ['--summary']).stdout;
  assert.match(s, /tokens \/ budget: 0\.37 \(1 older hand-typed outcome left out\)/);
});

// The 1.17.0 sweep's fix round. Each test names what the sweep found.
// why: guards rule:sweep-tiers
test('an owner tier gets a real budget, its trip fires, and its call caps are checked', () => {
  const r = approveRun({ ...featureContract(), tier: 'first push' });
  assert.equal(r.status, 1, r.stdout);
  assert.equal(approvalLog(r.dir).pop().budget, 537500);
  assert.match(read(r.f.replace(/\.json$/, '.triage.md')), /5 calls, budget 107500/);
  assert.equal(approveIn(r.dir, [r.f, '--owner-yes', 'yes go']).status, 0);
  const o = outcome(r, String(Math.ceil(537500 * 1.3)));
  assert.match(o.stdout, /paused: tokens/);
  const bare = featureContract();
  delete bare.roles[0].calls;
  const b = approveRun({ ...bare, tier: 'launch gate' });
  assert.equal(b.status, FIX_EXIT, b.stdout);
  assert.match(b.stdout, /no call cap[\s\S]*owner decides: the launch gate tier/);
});

// why: guards rule:sweep-auto-approval
test('a model outside the reviewer model rule asks the owner, and an unknown model at the outcome pauses', () => {
  for (const model of ['claude-haiku-5-5', '']) {
    const c = featureContract();
    c.roles[3].model = model;
    const r = approveRun(c);
    assert.equal(r.status, 1, `${model}: ${r.stdout}`);
    assert.match(r.stdout, /ASK THE OWNER[\s\S]*outside the reviewer model rule/);
  }
  const r = approveRun(featureContract());
  const ids = cheapRoles(5);
  const cfg = transcripts(Object.fromEntries(ids.map((id, i) => [id, [{ model: i ? 'claude-opus-5-5' : 'claude-haiku-5-5', u: [0, 100, 0, 0] }]])));
  assert.match(logOutcome(r, ids, cfg).stdout, /paused[\s\S]*ran on claude-haiku-5-5/);
});

// why: guards rule:sweep-auto-approval
test('the guard binds each start to one role\'s cap, and the owner\'s yes carries the caps', () => {
  const c = featureContract();
  c.roles.forEach((x, i) => { x.calls = [5, 5, 6, 7, 8][i]; });
  const r = approveRun(c);
  assert.equal(r.status, 0, r.stdout);
  const start = (n) => sweepGuard(r.dir, { tool_input: { subagent_type: 'reviewer', prompt: `go. Call cap: ${n}.` } }).permissionDecision;
  assert.equal(start(8), 'allow');
  assert.equal(start(8), 'deny', 'one role had 8, and it has started');
  assert.equal(start(5), 'allow');
  assert.equal(start(5), 'allow');
  assert.equal(start(5), 'deny');
  assert.equal(start(7), 'allow', 'not only the first role\'s cap');
  const a = approveRun(askContract());
  approveIn(a.dir, [a.f, '--owner-yes', 'yes go']);
  assert.deepEqual(approvalLog(a.dir).pop().calls, [5, 5, 5]);
  assert.equal(sweepGuard(a.dir, { tool_input: { subagent_type: 'reviewer', prompt: 'no cap line' } }).permissionDecision, 'deny');
});

// why: guards rule:sweep-auto-approval
test('M14 stays narrow: only docs/migrations is left out, and a contract\'s own lines never count against triage', () => {
  const big = sweepRepo({ 'README.md': 'y\n', 'docs/site.json': '{}\n' });
  const t = { tier: 'triage', modifiers: [], roles: [role('triage', 'Any secret or personal data in the diff?')] };
  assert.match(approveRun(t, big).stdout, /ASK THE OWNER[\s\S]*1 added files/);
  const dir = sweepRepo({ 'README.md': 'y\n' });
  const f = path.join(dir, 'sweeps', 'contract.json');
  fs.writeFileSync(f, JSON.stringify({ ...t, note: Array.from({ length: 40 }, (_, i) => `line ${i}`) }, null, 2));
  commitAll(dir, 'contract', true);
  const r = approveIn(dir, [f]);
  assert.equal(r.status, 0, r.stdout);
  const nested = sweepRepo({ 'README.md': 'y\n', 'other/contract.json': JSON.stringify(t) });
  assert.match(approveRun(t, nested).stdout, /ASK THE OWNER/, 'a contract in another folder is not this sweep\'s');
});

// why: guards rule:sweep-auto-approval
test('a branch cannot drop a cap the project set on its base', () => {
  const dir = makeTemp('approve-');
  const put = (f, t) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), t); };
  g(dir, 'init', '-q', '-b', 'main');
  put('src/page.ts', '1\n'); put('src/page.test.ts', '1\n'); put('.kit/sweep-approval.json', '{"caps":{"fix":{"maxExtras":0}}}\n');
  commitAll(dir, 'base', true);
  g(dir, 'checkout', '-q', '-b', 'fix/page');
  put('src/page.ts', '2\n'); put('src/page.test.ts', '2\n');
  fs.rmSync(path.join(dir, '.kit', 'sweep-approval.json'));
  commitAll(dir, 'fix', true);
  fs.mkdirSync(path.join(dir, 'sweeps'));
  const c = { tier: 'fix', modifiers: [], roles: [...fixFloor(), role('modelled-on', 'Was the bug inherited from the code this copied?')] };
  const r = approveRun(c, dir);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /over its cap of 0/);
});

// why: guards rule:sweep-auto-approval
test('going lighter after FIX THE CONTRACT is the owner\'s; adding what it named is not', () => {
  const sec = { tier: 'fix', modifiers: ['security-sensitive'], roles: fixFloor() };
  const a = approveRun(sec, fixRepo());
  assert.equal(a.status, FIX_EXIT, a.stdout);
  fs.writeFileSync(a.f, JSON.stringify({ ...sec, modifiers: [] }));
  assert.match(approveIn(a.dir, [a.f]).stdout, /ASK THE OWNER[\s\S]*went lighter[\s\S]*security-sensitive/);
  const b = featureContract();
  b.roles.pop();
  const f = approveRun(b, fixRepo());
  fs.writeFileSync(f.f, JSON.stringify({ tier: 'fix', modifiers: [], roles: fixFloor() }));
  assert.match(approveIn(f.dir, [f.f]).stdout, /ASK THE OWNER[\s\S]*tier feature to fix/);
  const d = approveRun(sec, fixRepo());
  fs.writeFileSync(d.f, JSON.stringify({ ...sec, roles: [...sec.roles, ...threeSecurity()] }));
  assert.equal(approveIn(d.dir, [d.f]).status, 0);
  assert.match(approveIn(d.dir, ['--summary']).stdout, /sent back to fix: 1/);
});

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

// why: guards rule:sweep-auto-approval
test('a crashed reviewer gets one more start for its role, and its spend stays on that role', () => {
  const s = crashedSweep();
  assert.equal(s.start(1), 'allow');
  assert.equal(s.start(2), 'allow');
  assert.equal(s.start(1), 'deny', 'no second start before a retry is logged');
  const ok = s.retry(1, 'r1');
  assert.equal(ok.status, 0, ok.stdout);
  const line = approvalLog(s.dir).pop();
  assert.equal(line.kind, 'retry');
  assert.equal(line.role, 1);
  assert.equal(line.crashed, 'r1');
  assert.equal(s.start(2), 'deny', 'the retry is for its own role');
  assert.equal(s.start(1), 'allow');
  assert.equal(s.start(1), 'deny', 'exactly one extra start');
  const slots = fs.readdirSync(path.join(s.dir, '.git', 'kit-sweep-starts')).map((d) => fs.readdirSync(path.join(s.dir, '.git', 'kit-sweep-starts', d)));
  assert.deepEqual(slots.flat().sort(), ['0', '0.retry', '1']);
  transcripts({ r1b: [[0, 1000, 0, 0], [0, 1000, 0, 0], [0, 1000, 0, 0], [0, 1000, 0, 0]] }, {}, s.cfg);
  const done = logOutcome(s, ['r1b', 'r2'], s.cfg);
  assert.equal(done.status, 0, done.stdout);
  assert.doesNotMatch(done.stdout, /no call-cap hook held it/, 'each start had its own cap');
  const out = approvalLog(s.dir).pop();
  assert.equal(out.kind, 'outcome');
  assert.equal(out.tokens, 7500);
  assert.equal(out.roles[0].agent, 'r1b');
  assert.equal(out.roles[0].crashed, 'r1');
  assert.equal(out.roles[0].tokens, 7000, 'the crash\'s tokens plus the retry\'s');
  assert.equal(out.roles[0].calls, 8, 'the crash\'s calls plus the retry\'s');
  assert.equal(out.roles[1].tokens, 500);
  assert.equal(out.roles[1].crashed, undefined);
  assert.equal(s.start(1), 'deny', 'a closed round has no retry left');
  nextBranch(s.dir, 'NOTES.md');
  assert.equal(approveIn(s.dir, [s.f]).status, 0);
  assert.match(logOutcome(s, ['r1', 'r2x'], s.cfg).stdout, /r1 \(already logged/, 'the crashed id counts as used');
  assert.match(s.retry(1, 'r1').stdout, /r1 \(already logged/);
});

// why: guards rule:sweep-auto-approval
test('a crash and its retry each had the whole token ceiling: the check reads the retry alone (the 1.23.0 sweep)', () => {
  const s = crashedSweep();
  const ceiling = approvalLog(s.dir).filter((e) => e.kind === 'decision').pop().ceilings[0];
  // The crash spent 70% of the ceiling, the retry 60% in four calls: 130% together, each inside its own.
  const part = (share, n) => Array(n).fill([0, Math.round((ceiling * share) / n), 0, 0]);
  transcripts({ r1: part(0.7, 4) }, { r1: { finished: false } }, s.cfg);
  setBrief(s.cfg, 'r1', () => s.brief(1));
  ageTranscript(s.cfg, 'r1', { stamps: 11, file: 11 });
  assert.equal(s.start(1), 'allow');
  assert.equal(s.start(2), 'allow');
  assert.equal(s.retry(1, 'r1').status, 0);
  assert.equal(s.start(1), 'allow');
  transcripts({ r1c: part(0.6, 4) }, {}, s.cfg);
  const done = logOutcome(s, ['r1c', 'r2'], s.cfg);
  assert.equal(done.status, 0, done.stdout);
  assert.doesNotMatch(done.stdout, /did not hold/);
});

// A still-running reviewer has no `finished` either, so only a quiet transcript reads as a crash. Both clocks must be
// old: the file's mtime and the last entry's timestamp, whichever is later.
// why: guards rule:sweep-auto-approval
test('a reviewer that may still be running is refused a retry until its transcript has gone quiet', () => {
  const s = crashedSweep();
  const before = sweepLog(s.dir).length;
  const refused = (clocks) => {
    ageTranscript(s.cfg, 'r1', clocks);
    const r = s.retry(1, 'r1');
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /r1 last wrote \d+ minute\(s\) ago[\s\S]*still be running[\s\S]*10 quiet minutes[\s\S]*Nothing logged/);
  };
  refused({ stamps: 0, file: 0 });
  refused({ stamps: 9, file: 9 });
  refused({ stamps: 11, file: 0 });
  refused({ stamps: 0, file: 11 });
  assert.equal(sweepLog(s.dir).length, before, 'a refusal logs nothing');
  ageTranscript(s.cfg, 'r1', { stamps: 11, file: 11 });
  const ok = s.retry(1, 'r1');
  assert.equal(ok.status, 0, ok.stdout);
  assert.equal(approvalLog(s.dir).pop().kind, 'retry');
  assert.match(read(path.resolve('user/skills/pre-pr-sweep/approve.mjs')), /^const CRASH_QUIET_MINUTES = 10;$/m);
  assert.match(read(path.resolve('user/skills/pre-pr-sweep/SKILL.md')), /its transcript quiet for 10 minutes\)[^\n]*A crash's tokens count against its role's budget;/);
});

// why: guards rule:sweep-auto-approval
test('a second retry of a role is refused and goes to the owner through --cut-short', () => {
  const s = crashedSweep();
  transcripts({ r1b: [[0, 100, 0, 0]] }, { r1b: { finished: false } }, s.cfg);
  setBrief(s.cfg, 'r1b', () => s.brief(1));
  assert.equal(s.retry(1, 'r1').status, 0);
  const before = sweepLog(s.dir).length;
  for (const id of ['r1', 'r1b']) {
    const again = s.retry(1, id);
    assert.equal(again.status, 1, again.stdout);
    assert.match(again.stdout, /already had its retry[\s\S]*--outcome --cut-short/);
  }
  assert.equal(sweepLog(s.dir).length, before, 'a refusal logs nothing');
  assert.equal(approveIn(s.dir, [s.f, '--outcome', '--cut-short']).status, 0);
});

// why: guards rule:sweep-auto-approval
test('a retry needs a crashed reviewer of this sweep, in the role it names', () => {
  const s = crashedSweep();
  const refused = (r, re) => { assert.equal(r.status, 1, r.stdout); assert.match(r.stdout, re); };
  const before = sweepLog(s.dir).length;
  transcripts({ b1: [[0, 100, 0, 0]], b2: [[0, 100, 0, 0]], b3: [[0, 100, 0, 0]] }, { b1: { agentType: 'builder', finished: false }, b2: { finished: false }, b3: { finished: false } }, s.cfg);
  setBrief(s.cfg, 'b1', () => s.brief(1));
  setBrief(s.cfg, 'b3', () => s.brief(1, 'f'.repeat(16)));
  refused(s.retry(1, 'nope'), /nope \(no transcript\)/);
  refused(s.retry(1, 'b1'), /b1 \(not a reviewer: builder\)/);
  refused(s.retry(1, 'b2'), /b2 \(its brief has no "Sweep: <hash> role <n>" line\)/);
  refused(s.retry(1, 'b3'), /b3 \(brief is for another contract\)/);
  refused(s.retry(2, 'r2'), /r2 finished/);
  refused(s.retry(2, 'r1'), /r1's brief names role 1, not role 2/);
  refused(s.retry(1, 'early', s.early), /early \(started .*before this sweep was cleared/);
  for (const n of ['0', '3', 'x']) refused(s.retry(n, 'r1'), /--retry needs a role from 1 to 2/);
  refused(approveIn(s.dir, [s.f, '--retry', '1'], { CLAUDE_CONFIG_DIR: s.cfg }), /--crashed/);
  assert.equal(sweepLog(s.dir).length, before, 'a refusal logs nothing');
});

// why: guards rule:sweep-auto-approval
test('a retry needs an open sweep, and the crashed id cannot also stand as the role\'s report', () => {
  const s = crashedSweep();
  assert.equal(s.retry(1, 'r1').status, 0);
  const metaFile = path.join(s.cfg, 'projects', 'C--repo', 'session-1', 'subagents', 'agent-r1.meta.json');
  fs.writeFileSync(metaFile, JSON.stringify({ agentType: 'reviewer', toolUseId: 'toolu_lead_r1', finished: true }));
  assert.match(logOutcome(s, ['r1', 'r2'], s.cfg).stdout, /r1 \(logged as crashed/);
  fs.writeFileSync(metaFile, JSON.stringify({ agentType: 'reviewer', toolUseId: 'toolu_lead_r1', finished: false }));
  transcripts({ r1b: [[0, 100, 0, 0]] }, {}, s.cfg);
  assert.equal(logOutcome(s, ['r1b', 'r2'], s.cfg).status, 0);
  const late = s.retry(2, 'r2');
  assert.equal(late.status, 1, late.stdout);
  assert.match(late.stdout, /no cleared sweep is open/);
});

// why: guards rule:sweep-tiers
test('a sweep cut short has a way out: the next contract asks the owner, and the yes closes it unmeasured', () => {
  const dir = sweepRepo();
  const r = approveRun(featureContract(), dir);
  const ids = cheapRoles(5);
  const cfg = transcripts(Object.fromEntries(ids.map((id) => [id, [[0, 100, 0, 0]]])), { [ids[0]]: { finished: false } });
  assert.match(logOutcome(r, ids, cfg).stdout, /ASK THE OWNER[\s\S]*not finished[\s\S]*--cut-short/);
  assert.equal(approveIn(dir, [r.f, '--outcome', '--cut-short']).status, 0);
  const next = path.join(dir, 'sweeps', 'next.json');
  fs.writeFileSync(next, JSON.stringify(featureContract()));
  const ask = approveIn(dir, [next]);
  assert.equal(ask.status, 1, ask.stdout);
  assert.match(ask.stdout, /ASK THE OWNER[\s\S]*was cut short/);
  assert.equal(approveIn(dir, [next, '--owner-yes', 'yes close it']).status, 0);
  const closed = approvalLog(dir).find((e) => e.kind === 'outcome');
  assert.equal(closed.closedByOwner, true);
  assert.equal(closed.contract.replace(/\\/g, '/').endsWith('sweeps/contract.json'), true);
  const short = approveRun(featureContract());
  assert.notEqual(approveIn(short.dir, [short.f, '--outcome', '--agents', 'a1,a2', '--findings', '1', '--real', '1', '--duplicates', '0']).status, 0);
  const n2 = path.join(short.dir, 'sweeps', 'next.json');
  fs.writeFileSync(n2, JSON.stringify(featureContract()));
  assert.equal(approveIn(short.dir, [n2]).status, FIX_EXIT, 'a wrong id count alone marks nothing');
});

// why: guards rule:sweep-tiers
test('an outcome is measured against the clearing, whatever is decided after it', () => {
  const r = approveRun(featureContract());
  approveIn(r.dir, [r.f, '--escape', 'a bug slipped through']);
  const edited = JSON.parse(read(r.f));
  edited.roles.forEach((x) => { x.calls = 15; });
  fs.writeFileSync(r.f, JSON.stringify(edited));
  assert.equal(approveIn(r.dir, [r.f]).status, FIX_EXIT);
  outcome(r, '200000');
  assert.equal(approvalLog(r.dir).filter((e) => e.kind === 'outcome').pop().budget, 537500);
  const f = approveRun(featureContract());
  const bad = JSON.parse(read(f.f));
  bad.roles.pop();
  const ids = cheapRoles(5);
  const cfg = transcripts(Object.fromEntries(ids.map((id) => [id, [[0, 100, 0, 0]]])));
  fs.writeFileSync(f.f, JSON.stringify(bad));
  assert.equal(approveIn(f.dir, [f.f]).status, FIX_EXIT);
  assert.equal(logOutcome(f, ids, cfg).status, 0, 'a later FIX line never stands for the sweep that ran');
});

// why: guards rule:sweep-auto-approval
test('a reviewer started before the owner\'s yes is not this round\'s, and a second round starts fresh', () => {
  const a = approveRun(askContract());
  const ids = cheapRoles(3);
  const cfg = transcripts(Object.fromEntries(ids.map((id) => [id, [[0, 100, 0, 0]]])));
  assert.equal(approveIn(a.dir, [a.f, '--owner-yes', 'yes go']).status, 0);
  assert.match(logOutcome(a, ids, cfg).stdout, /before this sweep was cleared/);
  const r = approveRun(featureContract());
  outcome(r, '200000');
  const old = cheapRoles(5);
  const oldCfg = transcripts(Object.fromEntries(old.map((id) => [id, [[0, 100, 0, 0]]])));
  nextBranch(r.dir);
  assert.equal(approveIn(r.dir, [r.f]).status, 0);
  assert.match(logOutcome(r, old, oldCfg).stdout, /before this sweep was cleared/, 'the first clearing after the last outcome');
});

// why: guards rule:sweep-auto-approval
// renamed from: what the rules bound stays with the owner: a re-sweep that grows, a rebased HEAD, project caps, a big triage
test('what the rules bound stays with the owner: context over the limit, project caps, a big triage', () => {
  const c = featureContract();
  c.roles[2].context = Array.from({ length: 31 }, (_, i) => `f${i}.ts`);
  assert.equal(approveRun(c).status, 1, 'context over the limit');
  const d = sweepRepo();
  fs.mkdirSync(path.join(d, '.kit'));
  fs.writeFileSync(path.join(d, '.kit', 'sweep-approval.json'), JSON.stringify({ caps: { feature: { maxRoleBudget: 50000 } } }));
  commitAll(d, 'caps', true);
  assert.equal(approveRun(featureContract(), d).status, 1, 'a project cap');
  const t = { tier: 'triage', modifiers: [], roles: [role('triage', 'Any secret or personal data in the diff?')] };
  assert.equal(approveRun(t, sweepRepo({ 'README.md': Array.from({ length: 30 }, (_, i) => `row ${i}`).join('\n') })).status, 1, 'a triage over its lines');
});

// why: guards rule:sweep-auto-approval
test('the 25% trip sits at 25%', () => {
  const under = approveRun(featureContract());
  assert.doesNotMatch(outcome(under, String(Math.floor(537500 * 1.25) - 1)).stdout, /paused/);
  const at = approveRun(featureContract());
  assert.match(outcome(at, String(Math.ceil(537500 * 1.25))).stdout, /paused/);
});

// why: guards rule:sweep-auto-approval
test('a project whose settings lack the call-cap hook is sent back to wire it', () => {
  const dir = sweepRepo();
  fs.mkdirSync(path.join(dir, '.claude'));
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), '{"permissions":{}}\n');
  commitAll(dir, 'settings', true);
  const r = approveRun(featureContract(), dir);
  assert.equal(r.status, FIX_EXIT, r.stdout);
  assert.match(r.stdout, /call-cap hook is not wired/);
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), '{"hooks":{"PreToolUse":[{"args":["/opt/kit/kit-hooks/call-cap.cjs"]},{"args":["/opt/kit/kit-hooks/sweep-guard.cjs"]}]}}\n');
  commitAll(dir, 'wired', true);
  assert.equal(approveIn(dir, [r.f]).status, 0);
});

// why: guards rule:sweep-auto-approval
test('the call-cap hook reads a real transcript: other lines, a half-written line, and a quoted cap change nothing', () => {
  const dir = makeTemp('cap-');
  const session = path.join(dir, 's');
  fs.mkdirSync(path.join(session, 'subagents'), { recursive: true });
  const brief = JSON.stringify({ message: { role: 'user', content: 'Call cap: 6.' } });
  const call = (i) => JSON.stringify({ message: { role: 'assistant', id: `m${i}`, usage: {}, content: [] } });
  const noise = [JSON.stringify({ type: 'attachment' }), JSON.stringify({ message: { role: 'user', content: 'tool said: Call cap: 99' } }), '{"message":{"role":"assi'];
  fs.writeFileSync(path.join(session, 'subagents', 'agent-r1.jsonl'), [brief, ...noise.slice(0, 2), call(1), call(2), call(3), call(4), call(5), noise[2]].join('\n'));
  const hook = (extra) => { const r = runHook('user/kit-hooks/call-cap.cjs', { transcript_path: `${session}.jsonl`, agent_id: 'r1', agent_type: 'reviewer', tool_name: 'Bash', ...extra }); return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : 'allow'; };
  assert.equal(hook({}), 'deny');
  assert.equal(hook({ agent_type: 'kit:reviewer' }), 'deny', 'a plugin-named reviewer is held');
  assert.equal(hook({ agent_type: 'Reviewer' }), 'deny');
  assert.equal(hook({ agent_type: 'not-a-reviewer' }), 'allow');
  const said = runHook('user/kit-hooks/call-cap.cjs', { transcript_path: `${session}.jsonl`, agent_id: 'r1', agent_type: 'reviewer', tool_name: 'Bash' });
  assert.match(JSON.parse(said.stdout).hookSpecificOutput.permissionDecisionReason, /Only your hand-back still works/);
});

// why: guards rule:outward-acts
test('the settings wire the hook at its installed path', () => {
  // What install makes of the guard's home path is read on an installed kit (guards-outside, R6.4).
  assert.ok(fs.existsSync(path.resolve('user/kit-hooks/call-cap.cjs')));
});

// why: guards rule:sweep-tiers
test('a reviewer past its cap is named at the outcome, and the notice shows modifiers and base', () => {
  const r = approveRun(featureContract());
  assert.match(r.stdout, /Modifiers: none; diff against main/);
  const ids = cheapRoles(5);
  const cfg = transcripts(Object.fromEntries(ids.map((id, i) => [id, Array.from({ length: i ? 1 : 7 }, () => [0, 10, 0, 0])])), {}, undefined, undefined, roleModels(ids, featureContract().roles));
  const o = logOutcome(r, ids, cfg);
  assert.match(o.stdout, /ran 7 calls against its cap of 5[^\n]*no call-cap hook/);
  assert.doesNotMatch(o.stdout, /paused/, 'the trip stays on the whole sweep');
  const k = featureContract();
  k.roles.push(role('astrology', 'What do the stars say about this diff?'));
  assert.match(approveRun(k).stdout, /one of: security, test-value/);
});

// why: catches a break in user/skills/pre-pr-sweep/approve.mjs; the only test that caught it when tagged, others catch it too since the build 14 audit
test('a removed worktree is read from its nearest folder, and the shell\'s GIT_DIR does not answer for another repo', () => {
  const r = approveRun(featureContract());
  const other = sweepRepo();
  const place = (cfg, id, cwd) => { const f = path.join(cfg, 'projects', 'C--repo', 'session-1', 'subagents', `agent-${id}.jsonl`); fs.writeFileSync(f, read(f).split('\n').map((l) => { if (!l) return l; const e = JSON.parse(l); e.cwd = cwd; return JSON.stringify(e); }).join('\n')); };
  const ids = cheapRoles(5);
  const cfg = transcripts(Object.fromEntries(ids.map((id) => [id, [[0, 100, 0, 0]]])));
  place(cfg, ids[0], path.join(other, 'gone', 'deep'));
  assert.match(logOutcome(r, ids, cfg).stdout, /ran in another repo/);
  place(cfg, ids[0], other);
  const env = approveIn(r.dir, [r.f, '--outcome', '--agents', ids.join(','), '--findings', '4', '--real', '3', '--duplicates', '0'], { CLAUDE_CONFIG_DIR: cfg, GIT_DIR: path.join(r.dir, '.git') });
  assert.match(env.stdout, /ran in another repo/);
  place(cfg, ids[0], path.join(r.dir, 'gone'));
  assert.equal(logOutcome(r, ids, cfg).status, 0);
});

// The 1.17.0 re-sweep's fixes and test gaps.
// why: guards rule:sweep-auto-approval
test('a lighter sweep stays the owner\'s across reruns, a second mistake and a new file name', () => {
  const sec = { tier: 'fix', modifiers: ['security-sensitive'], roles: fixFloor() };
  const a = approveRun(sec, fixRepo());
  assert.equal(a.status, FIX_EXIT);
  fs.writeFileSync(a.f, JSON.stringify({ ...sec, modifiers: [] }));
  assert.equal(approveIn(a.dir, [a.f]).status, 1);
  assert.equal(approveIn(a.dir, [a.f]).status, 1, 'the same contract gets the same answer');
  const b = approveRun(sec, fixRepo());
  const broken = { ...sec, modifiers: [], roles: [...fixFloor().slice(0, 2)] };
  fs.writeFileSync(b.f, JSON.stringify(broken));
  assert.equal(approveIn(b.dir, [b.f]).status, FIX_EXIT);
  fs.writeFileSync(b.f, JSON.stringify({ ...sec, modifiers: [] }));
  assert.match(approveIn(b.dir, [b.f]).stdout, /ASK THE OWNER[\s\S]*dropped security-sensitive/, 'a second mistake launders nothing');
  const n = approveRun(sec, fixRepo());
  const other = path.join(n.dir, 'sweeps', 'other.json');
  fs.writeFileSync(other, JSON.stringify({ ...sec, modifiers: [] }));
  assert.match(approveIn(n.dir, [other]).stdout, /ASK THE OWNER[\s\S]*went lighter/, 'a new name changes nothing');
  const y = approveRun(sec, fixRepo());
  fs.writeFileSync(y.f, JSON.stringify({ ...sec, modifiers: [] }));
  approveIn(y.dir, [y.f]);
  assert.equal(approveIn(y.dir, [y.f, '--owner-yes', 'yes lighter is right']).status, 0, 'the owner can agree');
});

// why: guards rule:sweep-auto-approval
test('with no project settings the notice says the cap has no hook; a hook in the local settings counts', () => {
  const r = approveRun(featureContract());
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /no call-cap hook[\s\S]*reviewer's own count/);
  const dir = sweepRepo();
  fs.mkdirSync(path.join(dir, '.claude'));
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), '{}\n');
  fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), '{"hooks":{"PreToolUse":[{"args":["/opt/kit/kit-hooks/call-cap.cjs"]},{"args":["/opt/kit/kit-hooks/sweep-guard.cjs"]}]}}\n');
  commitAll(dir, 'settings', true);
  const w = approveRun(featureContract(), dir);
  assert.equal(w.status, 0, w.stdout);
  assert.doesNotMatch(w.stdout, /no call-cap hook/);
});

// why: guards rule:sweep-auto-approval
test('an out-of-trial model cleared by the owner still pauses at the outcome', () => {
  const c = askContract();
  c.roles[1].model = 'claude-haiku-5-5';
  const r = approveRun(c);
  assert.equal(r.status, 1, r.stdout);
  assert.equal(approveIn(r.dir, [r.f, '--owner-yes', 'yes go']).status, 0);
  const ids = cheapRoles(3);
  const cfg = transcripts(Object.fromEntries(ids.map((id, i) => [id, [{ model: i === 1 ? 'claude-haiku-5-5' : 'claude-opus-5-5', u: [0, 100, 0, 0] }]])));
  assert.match(logOutcome(r, ids, cfg).stdout, /paused[\s\S]*ran on claude-haiku-5-5/);
});

// why: guards rule:sweep-tiers
test('a branch cannot raise a cap it inherited, and the outcome holds to an owner\'s clearing', () => {
  const dir = makeTemp('approve-');
  const put = (f, t) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), t); };
  g(dir, 'init', '-q', '-b', 'main');
  put('src/page.ts', '1\n'); put('src/page.test.ts', '1\n'); put('.kit/sweep-approval.json', '{"caps":{"fix":{"maxExtras":0}}}\n');
  commitAll(dir, 'base', true);
  g(dir, 'checkout', '-q', '-b', 'fix/page');
  put('src/page.ts', '2\n'); put('src/page.test.ts', '2\n'); put('.kit/sweep-approval.json', '{"caps":{"fix":{"maxExtras":5}}}\n');
  commitAll(dir, 'fix', true);
  fs.mkdirSync(path.join(dir, 'sweeps'));
  assert.match(approveRun({ tier: 'fix', modifiers: [], roles: [...fixFloor(), role('modelled-on', 'Was the bug inherited from the code this copied?')] }, dir).stdout, /over its cap of 0/);
  const a = approveRun(askContract());
  approveIn(a.dir, [a.f, '--owner-yes', 'yes go']);
  const budget = approvalLog(a.dir).filter((e) => e.kind === 'decision').pop().budget;
  const edited = JSON.parse(read(a.f));
  edited.roles.forEach((x) => { x.calls = 15; });
  fs.writeFileSync(a.f, JSON.stringify(edited));
  approveIn(a.dir, [a.f]);
  outcome(a, '200000');
  assert.equal(approvalLog(a.dir).filter((e) => e.kind === 'outcome').pop().budget, budget);
});

// why: guards rule:sweep-tiers
test('the notice prints the real modifiers, M14 leaves no other docs folder out, and a quoted path still counts', () => {
  const sec = { ...featureContract(), modifiers: ['security-sensitive'] };
  assert.match(approveRun(sec).stdout, /Modifiers: security-sensitive; diff against main/);
  const t = { tier: 'triage', modifiers: [], roles: [role('triage', 'Any secret or personal data in the diff?')] };
  assert.match(approveRun(t, sweepRepo({ 'README.md': 'y\n', 'docs/data/site.json': '{}\n' })).stdout, /ASK THE OWNER/);
  assert.match(approveRun(t, sweepRepo({ 'README.md': 'y\n', 'docs/migrations/old/1.json': '{}\n' })).stdout, /ASK THE OWNER/);
  const dep = fixRepo({ [`pk${String.fromCharCode(233)}/yarn.lock`]: 'x\n' });
  const r = approveRun({ tier: 'fix', modifiers: [], roles: fixFloor() }, dep);
  assert.match(r.stdout, /supply-chain/, 'a lockfile in a non-ASCII folder is still a package file');
});

// The 1.17.0 re-sweep's second half. Covered by tests; by the owner's rule there is no third pass.
// why: guards rule:sweep-auto-approval
test('a stop at this HEAD binds whatever comes after it: an outcome, an ask, a typo fixed, another branch', () => {
  const dir = fixRepo();
  const a = approveRun({ tier: 'fix', modifiers: [], roles: fixFloor() }, dir);
  assert.equal(a.status, 0, a.stdout);
  const b = path.join(dir, 'sweeps', 'b.json');
  const sec = { tier: 'fix', modifiers: ['security-sensitive'], roles: fixFloor() };
  fs.writeFileSync(b, JSON.stringify(sec));
  assert.equal(approveIn(dir, [b]).status, FIX_EXIT);
  assert.equal(approveIn(dir, [a.f, '--outcome', '--none-ran']).status, 0);
  fs.writeFileSync(b, JSON.stringify({ ...sec, modifiers: [] }));
  assert.match(approveIn(dir, [b]).stdout, /ASK THE OWNER[\s\S]*went lighter/, 'the stop\'s own instruction does not clear it');
  const big = featureContract();
  big.roles[2].context = Array.from({ length: 31 }, (_, i) => `f${i}.ts`);
  const ask = approveRun({ ...big, modifiers: ['security-sensitive'] }, fixRepo());
  assert.equal(ask.status, 1, ask.stdout);
  fs.writeFileSync(ask.f, JSON.stringify({ tier: 'fix', modifiers: [], roles: fixFloor() }));
  assert.match(approveIn(ask.dir, [ask.f]).stdout, /went lighter/, 'an ask binds too');
  const typo = approveRun({ tier: 'fix', modifiers: ['security-sensitiv'], roles: [...fixFloor(), ...threeSecurity()] }, fixRepo());
  assert.equal(typo.status, FIX_EXIT);
  fs.writeFileSync(typo.f, JSON.stringify({ tier: 'fix', modifiers: ['security-sensitive'], roles: [...fixFloor(), ...threeSecurity()] }));
  assert.equal(approveIn(typo.dir, [typo.f]).status, 0, 'a typo fixed is not going lighter');
  const moved = fixRepo();
  const m = approveRun(sec, moved);
  assert.equal(m.status, FIX_EXIT);
  fs.writeFileSync(path.join(moved, 'src/page.ts'), 'export const page = 9;\n');
  commitAll(moved, 'more', true);
  fs.writeFileSync(m.f, JSON.stringify({ ...sec, modifiers: [] }));
  assert.equal(approveIn(moved, [m.f]).status, 0, 'a new commit starts clean');
});

// why: guards rule:sweep-tiers
test('closing a sweep cut short says what started, and a sweep that ran is not logged as none ran', () => {
  const dir = sweepRepo();
  const r = approveRun(featureContract(), dir);
  sweepGuard(dir);
  sweepGuard(dir);
  assert.equal(approveIn(dir, [r.f, '--outcome', '--cut-short']).status, 0);
  const next = path.join(dir, 'sweeps', 'next.json');
  fs.writeFileSync(next, JSON.stringify(featureContract()));
  assert.match(approveIn(dir, [next]).stdout, /cut short[\s\S]*2 of 5 reviewers started/);
  assert.equal(approveIn(dir, [next, '--owner-yes', 'yes close it']).status, 0);
  const closed = approvalLog(dir).find((e) => e.kind === 'outcome');
  assert.equal(closed.started, 2);
  assert.equal(closed.noneRan, undefined);
  assert.match(approveIn(dir, ['--summary']).stdout, /closed unmeasured by the owner: 1/);
  const paused = approveRun(featureContract());
  approveIn(paused.dir, [paused.f, '--outcome', '--cut-short']);
  approveIn(paused.dir, [paused.f, '--escape', 'a bug slipped through']);
  const n2 = path.join(paused.dir, 'sweeps', 'next.json');
  fs.writeFileSync(n2, JSON.stringify(featureContract()));
  assert.match(approveIn(paused.dir, [n2]).stdout, /cut short/, 'a pause does not hide it');
  const other = approveRun(askContract());
  assert.equal(approveIn(other.dir, [other.f, '--outcome', '--cut-short']).status, 1, 'only the open approved sweep can be marked');
});

// 1.21.0 handoff item 28: the sweep guard must be wired beside the call cap, and no settings layer may turn hooks off.
// 1.21.0 handoff item 29: an outcome named any reviewer transcript whose brief carried the tag, so a cheap decoy
// could stand in for the reviewer the guard started. The guard writes the start's tool id into the role's slot, and
// the outcome counts only the transcript Claude Code wrote for that start.
// why: guards rule:sweep-auto-approval
test('an outcome counts only the reviewer the guard started for each role, not a decoy with the same tag', () => {
  const r = approveRun(featureContract());
  const at = lastClearing(r.dir);
  const slots = path.join(r.dir, '.git', 'kit-sweep-starts', crypto.createHash('sha256').update(at[0]).digest('hex').slice(0, 16));
  const brief = 'review. Call cap: 5.' + leadTag(r.dir, 'Call cap: 5');
  const started = sweepGuard(r.dir, { raw: true, tool_use_id: 'toolu_real1', tool_input: { subagent_type: 'reviewer', prompt: brief + leadQuestion(r.dir, brief) } });
  assert.equal(started.permissionDecision, 'allow');
  assert.equal(read(path.join(slots, '0')), 'toolu_real1', 'the guard records which start took the slot');
  const ids = ['real1', 'b2', 'b3', 'b4', 'b5'];
  const cfg = transcripts(Object.fromEntries([...ids, 'decoy'].map((id) => [id, [[0, 1000, 0, 0]]])), { real1: { toolUseId: 'toolu_real1' } });
  const run = (names) => approveIn(r.dir, [r.f, '--outcome', '--agents', names.join(','), '--findings', '1', '--real', '1', '--duplicates', '0'], { CLAUDE_CONFIG_DIR: cfg });
  setBrief(cfg, 'decoy', (b) => `${b} Sweep: ${at[1].hash} role 1`);
  const bad = run(['decoy', ...ids.slice(1)]);
  assert.equal(bad.status, 1, bad.stdout);
  assert.match(bad.stdout, /decoy \(not the reviewer the guard started[\s\S]*for role 1\)/);
  assert.equal(run(ids).status, 0, 'the started reviewer counts');
});

// 1.21.0 handoff item 35: a second run on a contract already cleared at this HEAD, with reviewers still to start, is
// told to log the outcome first, and its line leaves the clearing standing for the roles still to start.
// why: guards rule:sweep-tiers
test('running approve.mjs again on a live cleared contract keeps its clearing, so the other roles still start', () => {
  const r = approveRun(featureContract());
  assert.equal(r.status, 0, r.stdout);
  assert.equal(sweepGuard(r.dir).permissionDecision, 'allow');
  const again = approveIn(r.dir, [r.f]);
  assert.equal(again.status, FIX_EXIT, again.stdout);
  assert.match(again.stdout, /outcome of the last approved sweep first/);
  const hash = approvalLog(r.dir).find((e) => e.decision === 'approved').hash;
  const brief = `review. Call cap: 5. Sweep: ${hash} role 2`;
  const role2 = { subagent_type: 'reviewer', prompt: brief + leadQuestion(r.dir, brief) };
  assert.equal(sweepGuard(r.dir, { raw: true, tool_input: role2 }).permissionDecision, 'allow', 'the next role still starts');
  // An edited contract is a new decision, and its line does decide.
  fs.writeFileSync(r.f, JSON.stringify({ ...featureContract(), modifiers: ['user-data'] }));
  approveIn(r.dir, [r.f]);
  assert.equal(sweepGuard(r.dir).permissionDecision, 'deny');
});

// 1.21.0 handoff item 34: git reads a plain "main" or "origin/main" as a tag of that name first.
// why: guards rule:sweep-tiers
test('a tag named like the default branch does not pick the base the diff is read from', () => {
  for (const tag of ['main', 'origin/main']) {
    const dir = sweepRepo();
    g(dir, 'tag', tag, 'HEAD');
    const r = approveRun(featureContract(), dir);
    assert.equal(r.status, 0, `${tag}: ${r.stdout}`);
    assert.match(r.stdout, /diff against main/);
  }
});

// 1.21.0 handoff item 33: the uncommitted check skipped every .md and .json under the contract's folder, so work
// kept there passed unseen. Only the sweep's own paper beside the contract is left out: reports, and contracts.
// why: guards rule:sweep-auto-approval
test('uncommitted work in the contract\'s folder counts, except the reports and contracts beside the contract', () => {
  for (const [file, text, counts] of [
    ['sweeps/settings.json', '{"apiUrl":"https://example.test"}\n', true],
    ['sweeps/data/rows.json', '[1,2]\n', true],
    ['sweeps/deep/notes.md', 'x\n', true],
    ['sweeps/2026-11-07-report.md', '# report\n', false],
    ['sweeps/other.json', JSON.stringify(featureContract()), false],
  ]) {
    const dir = sweepRepo();
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
    const r = approveRun(featureContract(), dir);
    if (counts) { assert.equal(r.status, FIX_EXIT, `${file}: ${r.stdout}`); assert.match(r.stdout, /work not committed/, file); } else assert.equal(r.status, 0, `${file}: ${r.stdout}`);
  }
});

// The 1.22.0 sweep (T1): the helper above plays the guard for every outcome, so this one runs approve.mjs itself: a
// tagged reviewer the guard never started (no slot at all) is not counted.
// why: guards rule:sweep-auto-approval
test('an outcome refuses a tagged reviewer when the guard recorded no start for its role', () => {
  const r = approveRun(featureContract());
  const hash = approvalLog(r.dir).pop().hash;
  const ids = cheapRoles(5);
  const cfg = transcripts(Object.fromEntries(ids.map((id) => [id, [[0, 100, 0, 0]]])));
  ids.forEach((id, i) => setBrief(cfg, id, (b) => `${b} Sweep: ${hash} role ${i + 1}`));
  const o = spawnSync('node', [APPROVE, r.f, '--outcome', '--agents', ids.join(','), '--findings', '1', '--real', '1', '--duplicates', '0'], { encoding: 'utf8', cwd: r.dir, env: { PATH: process.env.PATH, CLAUDE_CONFIG_DIR: cfg } });
  assert.equal(o.status, 1, o.stdout);
  assert.match(o.stdout, /reviewer the guard started for role 1/);
});

// why: guards rule:sweep-auto-approval
test('the sweep guard refuses a reviewer brief under another agent type, and a reviewer started outside git', () => {
  const dir = makeTemp('guard-');
  const r = approveRun(featureContract());
  for (const type of ['general-purpose', 'Explore', 'claude', '']) {
    const out = runHook('user/kit-hooks/sweep-guard.cjs', { cwd: r.dir, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: type, prompt: 'Review the diff for injection. Call cap: 5.' } }).stdout;
    const d = out ? JSON.parse(out).hookSpecificOutput : { permissionDecision: 'allow' };
    assert.equal(d.permissionDecision, 'deny', `${type || 'no type'} with a call cap`);
    assert.match(d.permissionDecisionReason, /reviewer/);
  }
  assert.equal(sweepGuard(r.dir, { raw: true, tool_input: { subagent_type: 'general-purpose', prompt: 'Find every caller of approve().' } }).permissionDecision, 'allow', 'other work starts freely');
  assert.equal(sweepGuard(dir).permissionDecision, 'deny', 'a reviewer outside git has no log to clear it');
});

// why: guards rule:sweep-auto-approval
test('the hook check needs the sweep guard too, and hooks off in the local or user settings is not wired', () => {
  const both = '{"hooks":{"PreToolUse":[{"args":["/opt/kit/kit-hooks/call-cap.cjs"]},{"args":["/opt/kit/kit-hooks/sweep-guard.cjs"]}]}}\n';
  const setUp = (text) => {
    const dir = sweepRepo();
    fs.mkdirSync(path.join(dir, '.claude'));
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), text);
    commitAll(dir, 'settings', true);
    return dir;
  };
  const cfg = makeTemp('approve-cfg-');
  const capOnly = setUp('{"hooks":{"PreToolUse":[{"args":["/opt/kit/kit-hooks/call-cap.cjs"]}]}}\n');
  const r = approveRun(featureContract(), capOnly);
  assert.equal(r.status, FIX_EXIT, r.stdout);
  assert.match(r.stdout, /sweep guard/);
  const dir = setUp(both);
  const ok = approveRun(featureContract(), dir);
  assert.equal(ok.status, 0, ok.stdout);
  approveIn(dir, [ok.f, '--outcome', '--none-ran']);
  fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), '{"disableAllHooks":true}\n');
  assert.equal(approveIn(dir, [ok.f], { CLAUDE_CONFIG_DIR: cfg }).status, FIX_EXIT, 'hooks off in the local settings');
  fs.rmSync(path.join(dir, '.claude', 'settings.local.json'));
  fs.writeFileSync(path.join(cfg, 'settings.json'), '{"disableAllHooks":true}\n');
  assert.equal(approveIn(dir, [ok.f], { CLAUDE_CONFIG_DIR: cfg }).status, FIX_EXIT, 'hooks off in the user settings');
  fs.writeFileSync(path.join(cfg, 'settings.json'), '{}\n');
  assert.equal(approveIn(dir, [ok.f], { CLAUDE_CONFIG_DIR: cfg }).status, 0, 'and on again');
});

// The 1.25.1 sweep: since V3 the call cap and the sweep guard run through the launcher the user settings wire (and
// guard.cjs before it), never from a project's settings, so the hook check reads that wiring too.
// why: guards rule:sweep-auto-approval
test('the hook check reads the call cap and sweep guard the guard launcher runs from the Claude config folder', () => {
  const dir = sweepRepo();
  fs.mkdirSync(path.join(dir, '.claude'));
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), read(path.resolve('project/.claude/settings.json')));
  commitAll(dir, 'settings', true);
  const cfg = path.join(makeTemp('approve-home-'), '.claude');
  install({ kit: path.resolve('.'), home: cfg, target: 'user' });
  const f = path.join(dir, 'sweeps', 'contract.json');
  fs.writeFileSync(f, JSON.stringify(featureContract()));
  // The installed copy, as a session runs it: it reads the launcher and settings of the folder it sits in.
  const installed = (env = {}) => spawnSync('node', [path.join(cfg, 'skills', 'pre-pr-sweep', 'approve.mjs'), f], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH, CLAUDE_CONFIG_DIR: cfg, ...env } });
  const r = installed();
  assert.equal(r.status, 0, r.stdout);
  spawnSync('node', [path.join(cfg, 'skills', 'pre-pr-sweep', 'approve.mjs'), f, '--outcome', '--none-ran'], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH, CLAUDE_CONFIG_DIR: cfg } });
  // A config folder an env variable names, holding a launcher that says yes to anything, proves nothing (the review of fa37f84).
  const fake = makeTemp('approve-fake-');
  fs.mkdirSync(path.join(fake, 'kit-tools'));
  fs.mkdirSync(path.join(fake, 'kit-hooks'));
  fs.writeFileSync(path.join(fake, 'kit-tools', 'kit-launch.cjs'), 'exports.launcherWired = () => true;\n');
  for (const h of ['call-cap.cjs', 'sweep-guard.cjs']) fs.writeFileSync(path.join(fake, 'kit-hooks', h), '');
  fs.writeFileSync(path.join(fake, 'settings.json'), '{}');
  fs.writeFileSync(path.join(fake, 'kit-install.json'), '{}');
  fs.rmSync(path.join(cfg, 'kit-hooks', 'call-cap.cjs'));
  assert.equal(installed({ CLAUDE_CONFIG_DIR: fake }).status, FIX_EXIT, 'a fake launcher named by CLAUDE_CONFIG_DIR');
  assert.equal(installed().status, FIX_EXIT, 'the launcher wired but the call cap gone');
});

// B18 (the 1.25.1 sweep): the clause "the install folder's own settings turn hooks off" had no test; taking it out left
// every hook-check test green. Here CLAUDE_CONFIG_DIR names another folder, so only that clause can see it.
// why: guards rule:outward-acts
test('the hook check is not wired when the settings of the folder it was installed in turn hooks off', () => {
  const dir = sweepRepo();
  fs.mkdirSync(path.join(dir, '.claude'));
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), read(path.resolve('project/.claude/settings.json')));
  commitAll(dir, 'settings', true);
  const cfg = path.join(makeTemp('approve-home-'), '.claude');
  install({ kit: path.resolve('.'), home: cfg, target: 'user' });
  const other = makeTemp('approve-other-');
  const f = path.join(dir, 'sweeps', 'contract.json');
  fs.writeFileSync(f, JSON.stringify(featureContract()));
  const installed = () => spawnSync('node', [path.join(cfg, 'skills', 'pre-pr-sweep', 'approve.mjs'), f], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH, CLAUDE_CONFIG_DIR: other } });
  const r = installed();
  assert.equal(r.status, 0, r.stdout);
  spawnSync('node', [path.join(cfg, 'skills', 'pre-pr-sweep', 'approve.mjs'), f, '--outcome', '--none-ran'], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH, CLAUDE_CONFIG_DIR: other } });
  const settings = JSON.parse(read(path.join(cfg, 'settings.json')));
  fs.writeFileSync(path.join(cfg, 'settings.json'), JSON.stringify({ ...settings, disableAllHooks: true }));
  assert.equal(installed().status, FIX_EXIT, 'hooks off in the install folder\'s own settings read as wired');
});

// why: guards rule:outward-acts
test('the hook check reads real wiring, and a branch cannot delete its way out of it', () => {
  const put = (dir, text) => { fs.mkdirSync(path.join(dir, '.claude'), { recursive: true }); fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), text); commitAll(dir, 'settings', true); };
  const wiredText = '{"hooks":{"PreToolUse":[{"args":["/opt/kit/kit-hooks/call-cap.cjs"]},{"args":["/opt/kit/kit-hooks/sweep-guard.cjs"]}]}}\n';
  for (const bad of ['{"hooks":{"PreToolUse":[{"args":["{{CLAUDE_HOME}}/kit-hooks/call-cap.cjs"]}]}}\n', `{"disableAllHooks":true,${wiredText.slice(1)}`, '{"note":"call-cap.cjs removed on purpose"}\n']) {
    const dir = sweepRepo();
    put(dir, bad);
    assert.equal(approveRun(featureContract(), dir).status, FIX_EXIT, bad);
  }
  const dir = makeTemp('approve-');
  g(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'README.md'), 'x\n');
  put(dir, wiredText);
  g(dir, 'checkout', '-q', '-b', 'feat/x');
  fs.rmSync(path.join(dir, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'x.ts'), 'x\n');
  commitAll(dir, 'drop', true);
  fs.mkdirSync(path.join(dir, 'sweeps'));
  assert.equal(approveRun(featureContract(), dir).status, FIX_EXIT, 'the base has the hook');
  const owner = sweepRepo();
  put(owner, '{}\n');
  assert.match(approveRun({ ...featureContract(), tier: 'first push' }, owner).stdout, /FIX THE CONTRACT[\s\S]*not wired/);
  assert.match(approveRun(askContract()).stdout, /no call-cap hook/, 'an ask says it too');
});

// why: guards rule:sweep-tiers
test('a smaller contract tried while an outcome is owed opens no second clearing, and the outcome measures the first', () => {
  const big = featureContract();
  big.roles.forEach((x) => { x.calls = 15; });
  const dir = sweepRepo();
  const r = approveRun(big, dir);
  assert.equal(r.status, 0, r.stdout);
  approveIn(dir, [r.f, '--escape', 'a bug slipped through']);
  assert.equal(approveIn(dir, [r.f]).status, FIX_EXIT);
  assert.notEqual(approveIn(dir, [r.f, '--owner-yes', 'yes go']).status, 0);
  const small = featureContract();
  fs.writeFileSync(r.f, JSON.stringify(small));
  assert.equal(approveIn(dir, [r.f]).status, FIX_EXIT);
  assert.notEqual(approveIn(dir, [r.f, '--owner-yes', 'yes the smaller one']).status, 0);
  outcome({ ...r, f: r.f }, '200000');
  assert.equal(approvalLog(dir).filter((e) => e.kind === 'outcome').pop().budget, 2737500, 'the big contract is the only clearing');
});

// why: guards rule:sweep-auto-approval
test('the reviewer role keeps clear of the prompt it cannot answer', () => {
  // pin: 2 (the reviewer's order: it never logs an owner yes)
  assert.match(read(path.resolve('user/agents/reviewer.md')), /Never run a shell command naming `approve\.mjs` with `--owner-yes`/);
});

// why: guards rule:outward-acts
test('install does not rewrite the hook check: an installed script reads an installed project as wired', () => {
  const home = makeTemp('home-');
  install({ kit: path.resolve('.'), target: 'user', home });
  const dir = sweepRepo();
  fs.mkdirSync(path.join(dir, '.claude'));
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: ['call-cap.cjs', 'sweep-guard.cjs'].map((h) => ({ args: [path.join(home, 'kit-hooks', h).split(path.sep).join('/')] })) } }));
  commitAll(dir, 'settings', true);
  const f = path.join(dir, 'sweeps', 'contract.json');
  fs.writeFileSync(f, JSON.stringify(featureContract()));
  const r = spawnSync('node', [path.join(home, 'skills', 'pre-pr-sweep', 'approve.mjs'), f], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH } });
  assert.equal(r.status, 0, r.stdout);
});

// The recall gate: one ruler every time (versioned keys and brief), a run that records what it read, and a CI check
// that reads the recorded median instead of only seeing that the scores file changed.
const recallTools = () => import('../scripts/recall.mjs');
const RECALL = path.resolve('scripts/recall.mjs');
const GOOD_ENTRY = 'gate: kit-1.18.0 median 8 baseline 8 brief v1 keys v2';
const gateFacts = (over = {}) => ({ changed: ['rules/core.md', 'docs/evals/results/recall-scores.md'], added: [GOOD_ENTRY], brief: 1, keys: 2, ...over });

// why: guards rule:instruments-and-evals
test('recall v1 stays byte for byte what was frozen, and v2 changes only Q3\'s question and Q7\'s key', async () => {
  const { versionText, questions } = await recallTools();
  const text = read(path.resolve('docs/evals/recall-questions.md'));
  const frozen = spawnSync('git', ['show', 'v1.17.0:docs/evals/recall-questions.md'], { encoding: 'utf8' });
  assert.equal(frozen.status, 0, 'the v1.17.0 tag must exist locally');
  assert.equal(versionText(text, 1), frozen.stdout);
  const [v1, v2] = [questions(text, 1), questions(text, 2)];
  assert.equal(v2.length, 10);
  const changed = v2.flatMap((row, i) => ['q', 'key'].filter((f) => row[f] !== v1[i][f]).map((f) => `${row.n}.${f}`));
  assert.deepEqual(changed, ['3.q', '7.key']);
  assert.match(v2[6].key, /approve\.mjs/);
  assert.match(v2[6].key, /ASK goes to the owner/);
});
