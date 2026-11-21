// Tests for rule modules and IDs, the format audits, build, agent roles, the canary and brainstorm: moved word for word from tests/kit.test.mjs (T10, build 18).

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
import { install, foldBack, bump, scrub, snapshot, restore, status as kitStatus, mainProtection, sessionStartReport as kitSessionStart, preCompactReport, promptCheckReport, vaultBackup, projectSlug, newerReleases, lsRemoteCall, tagsOf, render, sourceHooks, measure, measureReal, headings, ledger, build, fixedHomePaths, parseModule, findRules, guardDir, scratch as kitScratch } from '../scripts/kit.mjs';
import { FAKE_PHRASE, FORMAT_SKILLS, KIT_TEXT_FILES, ROWS, SHEET, adapterRepo, answerQ3, band, canary, canaryLog, canaryRepo, caseKit, compileTools, fences, front, g, gitTree, makeKit, makeTemp, noFront, plainLine, read, require, role, roleTable, ruleFiles, runAudit, runHook, sessionStartReport, sheetTools, status, words } from './kit-helpers.mjs';

// measure models how Claude Code loads a project at session start (memory docs): CLAUDE.md, its @imports up to
// four hops, and rules with no paths field. A path in an import ends at the first unescaped space.
// why: catches a break in scripts/kit.mjs; the only test that caught it when tagged, others catch it too since the build 14 audit
test('measure counts what a session loads at start, the way Claude Code reads imports', () => {
  const proj = makeTemp('measure-');
  const w = (rel, body) => { fs.mkdirSync(path.dirname(path.join(proj, rel)), { recursive: true }); fs.writeFileSync(path.join(proj, rel), body); };
  w('CLAUDE.md', '# P\n@AGENTS.md\n@_Start Here.md\n@_Working\\ Standards.md\n`@not-an-import.md`\n```\n@in-a-fence.md\n```\n');
  w('AGENTS.md', 'core\n@AGENTS.md\n');
  w('_Start Here.md', 'start\n');
  w('_Working Standards.md', 'rules\n');
  w('not-an-import.md', 'x\n');
  w('in-a-fence.md', 'x\n');
  w('.claude/rules/always.md', 'always\n');
  w('.claude/rules/tests.md', '---\npaths:\n  - "**/*.test.*"\n---\nwhen tests\n');
  const r = measure({ projectDir: proj });
  assert.deepEqual(r.files.map((f) => f.file).sort(), ['.claude/rules/always.md', 'AGENTS.md', 'CLAUDE.md', '_Working Standards.md']);
  assert.equal(r.total, r.files.reduce((s, f) => s + f.bytes, 0));
  // An unescaped space cuts the path, so this import finds no file: the start file never loads.
  assert.deepEqual(r.unresolved, [{ from: 'CLAUDE.md', import: '_Start' }]);
});

// rule:kit-standards item 14: the cap must guard what really loads - not only CLAUDE.md, but the memory index,
// the global CLAUDE.md and the name + description of every skill an enabled plugin or the user folder lists.
// why: guards rule:kit-stays-local
test('measureReal counts the memory index, global CLAUDE.md and the skill listings of enabled plugins only', () => {
  const proj = makeTemp('real-proj-');
  const home = makeTemp('real-home-');
  const w = (root, rel, body) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), body); };
  w(proj, 'CLAUDE.md', 'p'.repeat(100));
  w(home, 'CLAUDE.md', 'g'.repeat(50));
  w(home, `projects/${projectSlug(proj)}/memory/MEMORY.md`, 'm'.repeat(30));
  w(home, 'skills/mine/SKILL.md', '---\nname: mine\ndescription: abc\n---\nbody not loaded\n');
  const plug = (name) => { const dir = path.join(home, 'plugins/cache', name); w(dir, 'skills/s/SKILL.md', `---\nname: s\ndescription: >\n  one\n  two\n---\nbody\n`); return dir; };
  w(home, 'plugins/installed_plugins.json', JSON.stringify({ plugins: {
    'on@m': [{ installPath: plug('on') }], 'off@m': [{ installPath: plug('off') }] } }));
  w(home, 'settings.json', JSON.stringify({ enabledPlugins: { 'on@m': true, 'off@m': false } }));
  const listing = (name, desc) => Buffer.byteLength(`${name}: ${desc}`);
  let r = measureReal({ projectDir: proj, home });
  assert.deepEqual(r.parts, { project: 100, memoryIndex: 30, globalClaude: 50, userSkills: listing('mine', 'abc'), plugins: listing('on:s', 'one two') });
  assert.equal(r.total, 100 + 30 + 50 + listing('mine', 'abc') + listing('on:s', 'one two'));
  // A project turning a standby plugin on counts it there.
  w(proj, '.claude/settings.local.json', JSON.stringify({ enabledPlugins: { 'off@m': true } }));
  r = measureReal({ projectDir: proj, home });
  assert.equal(r.parts.plugins, listing('on:s', 'one two') + listing('off:s', 'one two'));
});

// why: guards rule:kit-standards
test('every rule heading has a unique, plain-word ID', () => {
  const seen = new Map(), bad = [];
  for (const f of ruleFiles()) {
    for (const h of headings(read(f))) {
      if (!h.id) { bad.push(`no ID: ${h.title}`); continue; }
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(h.id)) bad.push(`not plain words: ${h.id}`);
      if (seen.has(h.id)) bad.push(`duplicate: ${h.id}`);
      seen.set(h.id, f);
    }
  }
  assert.deepEqual(bad, []);
  // 70 rules came from 0.7.0 (the ledger test checks each); new rules only add to that.
  assert.ok(seen.size >= 70, `${seen.size} rule IDs`);
});

// why: guards rule:pr-body
test('headings skips headings inside code blocks and reads the ID after the title', () => {
  const hs = headings('## One {#one}\n```\n## Not a rule\n```\n### Two: more (x) {#two}\n## Three\n');
  assert.deepEqual(hs.map((h) => [h.level, h.title, h.id]), [[2, 'One', 'one'], [3, 'Two: more (x)', 'two'], [2, 'Three', null]]);
});

// why: guards rule:kit-standards
test('the ledger refuses a section the map leaves out or a map entry with no section', () => {
  const map = { modules: [{ id: 'core', sections: ['a'] }] };
  assert.throws(() => ledger('## A {#a}\nx\n## B {#b}\ny\n', map), /not placed: b/);
  assert.throws(() => ledger('## A {#a}\nx\n', { modules: [{ id: 'core', sections: ['a', 'zz'] }] }), /no such section: zz/);
});

// why: guards rule:kit-standards
test('every rule pointer in the kit names a rule ID that exists', () => {
  const ids = new Set(ruleFiles().flatMap((f) => headings(read(f)).map((h) => h.id)));
  const broken = [], byWords = [];
  for (const f of KIT_TEXT_FILES()) {
    const text = read(f);
    for (const m of text.matchAll(/\brule:([a-z0-9-]+)/g)) if (!ids.has(m[1])) broken.push(`${path.relative('.', f)}: rule:${m[1]}`);
    for (const m of text.matchAll(/_Working Standards\.md`?\]?(?:\([^)]*\))?(?:,? section)? "([^"]+)"/g)) byWords.push(`${path.relative('.', f)}: "${m[1]}"`);
  }
  assert.deepEqual(broken, []);
  assert.deepEqual(byWords, []);
});

// why: guards rule:kit-standards
test('the format skills keep every 1.1.0 rule line exactly once', () => {
  const names = spawnSync('git', ['ls-tree', '--name-only', 'v1.1.0', 'rules/'], { encoding: 'utf8' });
  assert.equal(names.status, 0, 'the v1.1.0 tag must exist locally');
  // Every release since 1.1.0 records its reworded lines in its own file.
  const reworded = fs.readdirSync(path.resolve('docs/migrations')).filter((n) => /^1\.(?:[2-9]|\d\d)\.\d+-reworded\.json$/.test(n))
    .flatMap((n) => JSON.parse(read(path.resolve('docs/migrations', n))).lines);
  const swap = new Map(reworded.map((r) => [r.before, r.after]));
  // A line reworded in more than one release follows its records to the latest wording.
  const latest = (l) => { for (let i = 0; swap.has(l) && i < 50; i++) l = swap.get(l); return l; };
  const count = (ls) => ls.filter((l) => /[A-Za-z0-9]/.test(l)).reduce((m, l) => m.set(l, (m.get(l) || 0) + 1), new Map());
  const want = count(names.stdout.split('\n').filter((n) => n.endsWith('.md')).flatMap((n) =>
    noFront(spawnSync('git', ['show', `v1.1.0:${n}`], { encoding: 'utf8' }).stdout).split('\n').map((l) => plainLine(latest(l)))));
  const now = [...ruleFiles(), ...FORMAT_SKILLS.map((s) => path.resolve('user/skills', s, 'SKILL.md')).filter((f) => fs.existsSync(f))];
  const got = count(now.flatMap((f) => noFront(read(f)).split('\n').map(plainLine)));
  const lost = [...want].filter(([l, n]) => (got.get(l) || 0) < n).map(([l]) => l.slice(0, 80));
  const copied = [...want].filter(([l, n]) => (got.get(l) || 0) > n).map(([l]) => l.slice(0, 80));
  assert.deepEqual({ lost, copied }, { lost: [], copied: [] });
});

// why: catches a break at user/skills/release-notes/audit.mjs:89 that no other test catches
test('the release notes audit passes clean notes and names each public-prose fault', () => {
  const good = '## What is new\n\n- Plans now sync between your phone and laptop.\n- Limits: syncing needs both devices online once.\n';
  const ok = runAudit('release-notes', good, ['1.4.0']);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const bad = 'Faster sync \u2014 now with Claude help -- see [plan](_Active Plan.md). 212 tests pass.\n';
  const out = runAudit('release-notes', bad, ['1.4.0']);
  assert.equal(out.status, 1);
  for (const want of [/non-ASCII/, /double hyphen/, /AI or tool/, /gitignored/, /test or tooling/]) assert.match(out.stdout, want);
  const proj = makeTemp('pkg-');
  fs.writeFileSync(path.join(proj, 'package.json'), '{ "version": "1.3.2" }\n');
  assert.match(runAudit('release-notes', good, ['1.4.0'], proj).stdout, /package\.json says 1\.3\.2/);
  assert.equal(runAudit('release-notes', good, ['1.3.2'], proj).status, 0);
});

// why: guards rule:pr-body
test('the sweep report audit passes a done report and names each missing part', () => {
  const dims = ['Privacy and data boundary', 'Supply chain and bundle', 'Legal and content', 'Code security', 'Gaps and scaling', 'Version goal alignment'];
  const good = `# Sweep: offline sync\n\n- **Tier:** feature\n- **Date:** 2026-03-04\n- **Branch:** feature/offline-sync at a1b2c3d\n- **Layers:** plan 2, CI 0, sweep 1, escaped 0\n\n${dims.map((d, i) => `## ${i + 1}. ${d}\n\nPASS\n`).join('\n')}\n| # | Severity | Finding | Disposition |\n|---|---|---|---|\n| 1 | high | token in log | FIXED 9f8e7d6 |\n| 2 | low | slow list | DEFERRED roadmap |\n\n**Still aligned with the version goals?** YES - only the planned scope shipped.\n`;
  const ok = runAudit('pre-pr-sweep', good);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const bad = good.replace('- **Date:** 2026-03-04\n', '').replace('## 3. Legal and content', '## 3. Other').replace('FIXED 9f8e7d6', 'will fix').replace('YES - only', 'probably - only');
  const out = runAudit('pre-pr-sweep', bad);
  assert.equal(out.status, 1);
  for (const want of [/date/i, /dimension 3/i, /finding 1/i, /YES or NO/]) assert.match(out.stdout, want);
});

// why: guards rule:sweep-tiers. The sweep shape (the owner's pick, build 5): every review role stays, and each feature
// or launch-gate report counts which layer caught its highs (the plan check, CI, the sweep, or escaped to a release),
// so the next decision on the sweep's shape reads numbers, not a recount of old reports.
test('a feature report counts the layer that caught each high', () => {
  const dims = ['Privacy and data boundary', 'Supply chain and bundle', 'Legal and content', 'Code security', 'Gaps and scaling', 'Version goal alignment'];
  const report = (layers, tier = 'feature') => `# Sweep: offline sync\n\n- **Tier:** ${tier}\n- **Date:** 2026-03-04\n- **Branch:** feature/offline-sync at a1b2c3d\n${layers}${dims.map((d, i) => `## ${i + 1}. ${d}\n\nPASS\n`).join('\n')}\n**Still aligned with the version goals?** YES - only the planned scope shipped.\n`;
  assert.equal(runAudit('pre-pr-sweep', report('- **Layers:** plan 3, CI 1, sweep 2, escaped 0\n\n')).status, 0);
  for (const bad of ['\n', '- **Layers:** some\n\n', '- **Layers:** plan 3, sweep 2\n\n']) {
    const out = runAudit('pre-pr-sweep', report(bad));
    assert.equal(out.status, 1, bad);
    assert.match(out.stdout, /Layers:\*\* plan <n>, CI <n>, sweep <n>, escaped <n>/);
  }
  assert.equal(runAudit('pre-pr-sweep', report('\n', 'fix')).status, 0, 'a fix report owes no layer count');
  // A report from before 1.31.0 says it kept no count, and makes none up.
  assert.equal(runAudit('pre-pr-sweep', report('- **Layers:** not counted (swept before 1.31.0)\n\n')).status, 0);
  // The sweep and escaped counts cover every high the report lists, so the line cannot hide them (the 1.31.0 sweep).
  const rows = '| # | Severity | Finding | Disposition |\n|---|---|---|---|\n| 1 | high | token in log | FIXED 9f8e7d6 |\n| 2 | critical | key in repo | FIXED 9f8e7d6 |\n\n';
  const hidden = runAudit('pre-pr-sweep', report(`- **Layers:** plan 0, CI 0, sweep 1, escaped 0\n\n${rows}`));
  assert.equal(hidden.status, 1);
  assert.match(hidden.stdout, /lists 2 high or critical/);
  assert.equal(runAudit('pre-pr-sweep', report(`- **Layers:** plan 0, CI 0, sweep 1, escaped 1\n\n${rows}`)).status, 0);
});

// The owner's decision 6 (1.21.0): a handoff that led with fixes parked the next build behind them.
// why: guards rule:kit-standards
test('a handoff\'s first action is the next build, and a fix goes first only when high or critical', () => {
  const rule = (f) => read(path.resolve(f));
  assert.match(rule('rules/tracking-and-handoff.md'), /9\. \*\*State working mode \+ first action\.\*\*[^\n]*always the next build[^\n]*only when it is high or critical/);
  for (const f of ['rules/tracking-and-handoff.md', 'user/skills/closeout/examples/handoff-a.md', 'user/skills/closeout/examples/handoff-b.md']) {
    assert.match(rule(f), /always the next build:[^\n]*a fix first only when high or critical\)/, f);
  }
  // A run's order says the same in the rule, its built copy and the plan template, so no file still puts a fix behind.
  for (const f of ['rules/reviews-and-findings.md', 'project/standards/reviews-and-findings.md']) {
    assert.match(rule(f), /the feature comes FIRST \([^\n]*a fix first only when high or critical\)/, f);
    assert.doesNotMatch(rule(f), /even when a handoff lists fixes ahead/, f);
  }
  assert.match(rule('project/_Active Plan.md'), /the feature comes FIRST[^\n]*a fix first only when high or critical\);/);
  // The start load has no room to give, so this text stays out of what every session loads.
  for (const f of ['project/CLAUDE.md', 'project/AGENTS.md', 'project/_Start Here.md']) assert.doesNotMatch(rule(f), /always the next build/, f);
});

// why: guards rule:outward-acts
test('a first action still stops for a lock, an outward act or an open decision, and every copy says so', () => {
  const rule = (f) => read(path.resolve(f));
  assert.match(rule('rules/core.md'), /\*\*Still stop and ask:\*\*[^\n]*a plan lock or batch approval/);
  const tracking = rule('rules/tracking-and-handoff.md');
  assert.match(tracking, /9\. \*\*State working mode \+ first action\.\*\*[^\n]*a relayed note only points to it[^\n]*rule:delegated-decisions[^\n]*the rest starts\./);
  for (const f of ['rules/tracking-and-handoff.md', 'user/skills/closeout/examples/handoff-a.md', 'user/skills/closeout/examples/handoff-b.md']) {
    assert.match(rule(f), /start it; what hits a stop in [^\n]*rule:delegated-decisions[^\n]*the rest starts\.[^\n]*This handoff is a CACHE\./, f);
  }
  assert.match(tracking, /starts on its own once[^\n]*PR is merged[^\n]*Post-Merge Check has passed[^\n]*no other work open/);
  assert.match(rule('rules/git-and-release.md'), /no other work open[^\n]*closeout starts on its own \(rule:compact-ritual\)/);
  for (const f of ['rules/tracking-and-handoff.md', 'project/CLAUDE.md']) assert.match(rule(f), /session end \(the owner declares it[^\n]*closeout starts on its own: rule:compact-ritual\)/, f);
  assert.match(rule('project/_Active Plan.md'), /the feature comes FIRST[^\n]*a fix first only when high or critical\)/);
  const closeout = rule('user/skills/closeout/SKILL.md');
  // The trigger names the rule, not two of its four conditions (review D3, 1.21.0).
  assert.match(closeout, /compact ritual starts it on its own/);
  assert.doesNotMatch(closeout, /any planned release is out/);
  assert.match(closeout, /only as rule:compact-ritual says/);
});

// why: guards rule:sweep-auto-approval
test('findings are fixed in their build and only what the owner accepts carries, in the rule and in everything the sweep tools tell the lead', () => {
  const rule = (f) => read(path.resolve(f));
  const findings = rule('rules/reviews-and-findings.md');
  // pin: 4 the owner's carry wording (2026-11-14), both lines
  assert.match(findings, /Findings are fixed in the build that finds them\. A low or medium that cannot be finished carries only on the owner's yes, first next build\. A high or critical never carries: it is fixed before the PR[^\n]*or the owner accepts it/);
  assert.match(findings, /the small ones too, each through the fix check \(rule:finding-pipeline\); what carries \(the rule above\) goes to the handoff's carry-overs/);
  assert.match(findings, /in a known area \(one component, one flow\)/);
  // pin: 1 (the sweep report audit reads these dispositions)
  assert.match(findings, /every high \/ critical `FIXED <commit>` or `ACCEPTED owner <why>`/);
  // Comments off: what counts is the text the lead is shown.
  const shown = (f) => rule(f).replace(/^\s*\/\/.*$/gm, '');
  // pin: 2 (the order the lead is given at the stop)
  assert.match(shown('user/kit-hooks/sweep-guard.cjs'), /What the sweep found is fixed in this build, each fix with a failing-first test; only a low or medium the owner says yes to \(never a high or critical\) goes to the handoff\\'s carry-overs/);
  // pin: 2 (the order the lead is given at the stop)
  assert.match(rule('user/skills/pre-pr-sweep/SKILL.md'), /refuses a re-sweep contract \(`"resweepOf"`\) flat\. What the sweep found is fixed in this build; only a low or medium the owner says yes to \(never a high or critical\) goes to the handoff/);
  const approve = shown('user/skills/pre-pr-sweep/approve.mjs');
  // pin: 2 (the order the lead is given at the stop)
  assert.match(approve, /there is no re-sweep: one sweep per branch[^\n]*failing-first test, and CI is the gate/);
  assert.match(rule('project/_Templates/_PR Body Template.md'), /fixed here or\s+accepted by the owner/);
  assert.match(rule('user/skills/pre-pr-sweep/examples/feature-sweep.md'), /findings are fixed in this PR/);
});

// A high or critical is fixed before the PR or accepted by the owner, never carried to the next run
// (rule:finding-pipeline).
// why: guards rule:sweep-auto-approval
test('the sweep audit refuses a high or critical finding carried as DEFERRED', () => {
  const dims = ['Privacy and data boundary', 'Supply chain and bundle', 'Legal and content', 'Code security', 'Gaps and scaling', 'Version goal alignment'];
  const report = (rows) => `# Sweep: offline sync\n\n- **Tier:** feature\n- **Date:** 2026-03-04\n- **Branch:** feature/offline-sync at a1b2c3d\n- **Layers:** plan 2, CI 0, sweep 1, escaped 0\n\n${dims.map((d, i) => `## ${i + 1}. ${d}\n\nPASS\n`).join('\n')}\n| # | Severity | Finding | Disposition |\n|---|---|---|---|\n${rows}\n\n**Still aligned with the version goals?** YES - only the planned scope shipped.\n`;
  for (const sev of ['high', 'critical']) {
    const out = runAudit('pre-pr-sweep', report(`| 1 | ${sev} | token in log | DEFERRED next build |`));
    assert.equal(out.status, 1, sev + ' DEFERRED must fail');
    assert.match(out.stdout, /finding 1/);
    assert.match(out.stdout, /FIXED <commit> or ACCEPTED owner <why>/);
    const bullet = runAudit('pre-pr-sweep', report('| 1 | low | slow list | DEFERRED roadmap |') + `\n- **S2 (${sev})** - token in log. DEFERRED next build\n`);
    assert.equal(bullet.status, 1, sev + ' bullet DEFERRED must fail');
    assert.match(bullet.stdout, /finding S2/);
  }
  for (const disposition of ['FIXED 9f8e7d6', 'ACCEPTED owner took the risk in the PR']) {
    const out = runAudit('pre-pr-sweep', report(`| 1 | high | token in log | ${disposition} |\n| 2 | medium | slow list | DEFERRED next build |`));
    assert.equal(out.status, 0, out.stdout);
  }
  const lead = runAudit('pre-pr-sweep', report('| 1 | high | token in log | ACCEPTED too costly to fix today, the lead decided |'));
  assert.equal(lead.status, 1, 'only the owner accepts a high');
  // Review D4 (1.21.0): a one-word reason is no reason.
  for (const why of ['.', 'x', 'took it']) assert.equal(runAudit('pre-pr-sweep', report(`| 1 | high | token in log | ACCEPTED owner ${why} |`)).status, 1, why);
  const bare = runAudit('pre-pr-sweep', report('| 1 | high | token in log | ACCEPTED owner |'));
  assert.equal(bare.status, 1, 'an acceptance gives its reason');
});

// why: guards rule:sweep-tiers
test('the sweep audit holds each report to its tier', () => {
  const base = '# Sweep\n\n- **Branch:** chore/bump at a1b2c3d (2026-03-04)\n';
  const none = runAudit('pre-pr-sweep', base + '\nNo secrets or personal data in the diff.\n');
  assert.equal(none.status, 1);
  assert.match(none.stdout, /Tier/);
  // A triage report still names each dimension, "not touched" or its finding (rule:sweep-tiers).
  const bare = runAudit('pre-pr-sweep', base + '- **Tier:** triage\n\nNo secrets or personal data in the diff.\n');
  assert.equal(bare.status, 1, 'a triage label alone skips nothing');
  assert.match(bare.stdout, /dimension/);
  const triage = base + '- **Tier:** triage\n\nNo secrets or personal data in the diff. Privacy, supply chain, legal, code security, gaps and version alignment: not touched.\n';
  const ok = runAudit('pre-pr-sweep', triage);
  assert.equal(ok.status, 0, ok.stdout);
  const noCheck = runAudit('pre-pr-sweep', triage.replace('No secrets or personal data in the diff. ', ''));
  assert.equal(noCheck.status, 1);
  assert.match(noCheck.stdout, /secrets/);
  const fix = runAudit('pre-pr-sweep', base + '- **Tier:** fix\n\nPrivacy, supply chain, legal: not touched. Code security PASS. Gaps PASS.\n');
  assert.equal(fix.status, 1, 'a fix tier still gives the alignment verdict');
  assert.match(fix.stdout, /YES or NO/);
  // The first push tier (rule:first-push-gate) also records the check's result and the owner's review of what
  // is tracked.
  const first = base + '- **Tier:** first push\n\nPrivacy, supply chain, legal, code security, gaps: PASS. Version alignment: YES.\n';
  const bareFirst = runAudit('pre-pr-sweep', first);
  assert.equal(bareFirst.status, 1);
  assert.match(bareFirst.stdout, /first-push-check/);
  const fullFirst = runAudit('pre-pr-sweep', first + 'First push check: PASS at a1b2c3d. Tracked files reviewed by the owner: yes.\n');
  assert.equal(fullFirst.status, 0, fullFirst.stdout);
});

// why: catches a break at user/skills/preview-test/audit.mjs:20 that no other test catches
test('the preview test audit passes a full record and names each missing part', () => {
  const good = '## Preview test - Offline sync, #12 (2026-03-04)\n\n- **Build:** the host\'s preview for `feature/offline-sync` at `a1b2c3d`; the lead opened it first.\n- **Who, by stakes:** the lead in emulation only; no new surface, no device-only path.\n- **Setup:** phone emulation and desktop; made-up details only; nothing sent.\n\n| Check | Result |\n|---|---|\n| Headers and security policy | same as production |\n| Layout: plan list | clipped at 320 px |\n\n- **Shots:** phone-list.png, desktop-list.png\n- **Result:** FAIL - the list clip goes to the finding pipeline.\n';
  const ok = runAudit('preview-test', good);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const bad = good.replace(', #12 (', ' (').replace('`feature/offline-sync` at `a1b2c3d`', 'the branch').replace('made-up details only; nothing sent', 'real account').replace('| clipped at 320 px |', '|  |').replace('- **Shots:** phone-list.png, desktop-list.png\n', '');
  const out = runAudit('preview-test', bad);
  assert.equal(out.status, 1);
  for (const want of [/pull request/, /Build/, /made-up/, /Layout: plan list/, /Shots/]) assert.match(out.stdout, want);
});

// why: catches a break at user/skills/adr/audit.mjs:18 that no other test catches
test('the ADR audit passes a full record and names each missing part', () => {
  const good = '# ADR-007: Store plans on the device\n\n- **Status:** accepted\n- **Date:** 2026-02-01\n\n## Context and Problem Statement\nWhere do plans live?\n\n## Decision Drivers\n- Privacy\n\n## Considered Options\n1. **Option A:** device\n2. **Option B:** server\n\n## Decision Outcome\n\n**Chosen option:** Option A\n\n### Why\nPrivacy.\n\n### Dual-Horizon\n- **Impact now:** none\n- **Impact later:** sync needs a design\n\n### Consequences\n**Positive:**\n- private\n\n## Pros and Cons of the Options\n### Option A\n- good\n';
  const ok = runAudit('adr', good);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const bad = good.replace('accepted', 'maybe').replace('### Dual-Horizon\n- **Impact now:** none\n- **Impact later:** sync needs a design\n\n', '').replace('# ADR-007: Store', '# Store');
  const out = runAudit('adr', bad);
  assert.equal(out.status, 1);
  for (const want of [/Status/, /Dual-Horizon/, /ADR-NNN/]) assert.match(out.stdout, want);
});

// Found by the Phase 3 live check: a command flag in inline code (`node --flag`) is code, not a prose dash.
// why: guards rule:pr-body
test('the PR body audits read a dash inside inline code as code, and still catch a prose dash', () => {
  const dir = makeTemp('prdash-');
  const lean = (notes) => `## Math: add a subtract function\n\nThe math module can now subtract.\n\n**Changes**\n- New \`sub(a, b)\` export.\n\n**Gates**\n- [x] The test passes.\n- [x] Full local gate green.\n- [x] Sweep exempt by dimension: privacy, supply chain, legal, code security; no secrets or account information.\n\n**Notes** - ${notes}\n`;
  const dashes = (script, text, title) => {
    const f = path.join(dir, 'b.md');
    fs.writeFileSync(f, text);
    return spawnSync('node', [path.resolve('project/.claude', script), f, title], { encoding: 'utf8' }).stdout.split('\n').find((l) => l.includes('no spaced dashes'));
  };
  assert.match(dashes('pr-body-audit-lean.mjs', lean('run it with `node --experimental-default-type=module math.test.js`.'), 'feat: add a subtract function'), /^PASS/);
  assert.match(dashes('pr-body-audit-lean.mjs', lean('it runs -- for now -- by hand.'), 'feat: add a subtract function'), /^FAIL/);
  // M28, from the 1.23.0 mutation check: a prose dash before a fenced block is still prose, and the fence is code.
  const fenced = lean('it runs -- for now -- by hand.').replace('**Notes**', '```\nnode --test\n```\n\n**Notes**');
  assert.match(dashes('pr-body-audit-lean.mjs', fenced, 'feat: add a subtract function'), /^FAIL.*lines \d+$/);
  assert.match(dashes('pr-body-audit-lean.mjs', lean('it runs by hand.').replace('**Notes**', '```\nnode --test -- x\n```\n\n**Notes**'), 'feat: add a subtract function'), /^PASS/);
  // And an H1 with neither an area nor a type prefix fails its row.
  const h1 = (text) => { const f = path.join(dir, 'h.md'); fs.writeFileSync(f, text); return spawnSync('node', [path.resolve('project/.claude/pr-body-audit-lean.mjs'), f, 'feat: add a subtract function'], { encoding: 'utf8' }).stdout.split('\n').find((l) => l.includes('H1 is <Area>')); };
  assert.match(h1(lean('by hand.').replace('## Math: add', '## add')), /^FAIL/);
  assert.match(h1(lean('by hand.')), /^PASS/);
  const std =(line) => `## Math: subtract\n\nFraming.\n\n### Summary\n\n${line}\n`;
  assert.match(dashes('pr-body-audit.mjs', std('Run `node --test` to check.'), 'Math: subtract'), /^PASS/);
  assert.match(dashes('pr-body-audit.mjs', std('It runs -- for now -- by hand.'), 'Math: subtract'), /^FAIL/);
});

// why: guards rule:pr-body (the squash subject on main is the title plus " (#n)", and it must fit 72). K16, the 1.27.0
// build: a 73-character subject passed the audit locally and failed the kit's CI after the squash.
test('both PR body audits count the squash suffix against the 72-character title limit', () => {
  const dir = makeTemp('prtitle-');
  const row = (script, title, n) => {
    const f = path.join(dir, 'b.md');
    fs.writeFileSync(f, '## Math: x\n\nx\n');
    const args = [path.resolve('project/.claude', script), f, title, ...(n ? [n] : [])];
    return spawnSync('node', args, { encoding: 'utf8' }).stdout.split('\n').find((l) => l.includes('title is type: subject'));
  };
  const at = (len) => `feat: ${'a'.repeat(len - 6)}`;
  for (const script of ['pr-body-audit.mjs', 'pr-body-audit-lean.mjs']) {
    assert.match(row(script, at(66), '31'), /^PASS/, `${script}: 66 + " (#31)" is 72`);
    assert.match(row(script, at(67), '31'), /^FAIL/, `${script}: 67 + " (#31)" is 73`);
    // With no number known yet, room is kept for a four-digit one.
    assert.match(row(script, at(64)), /^PASS/, `${script}: 64 + " (#nnnn)"`);
    assert.match(row(script, at(65)), /^FAIL/, `${script}: 65 + " (#nnnn)"`);
  }
});

// why: guards rule:pr-body
test('the push guard names the PR body skill', () => {
  const ask = (command) => {
    const r = spawnSync('node', [path.resolve('project/.claude/guard-outward.cjs')], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }), encoding: 'utf8' });
    // The note goes to Claude as added context: an "ask" reason is shown to the user, not the model.
    return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext || '' : '';
  };
  assert.match(ask('gh pr create --title "x" --body-file b.md'), /pr-body skill/);
  assert.match(ask('git push -u origin feature/x'), /pr-body skill/);
  assert.doesNotMatch(ask('gh release create v1.2.0'), /pr-body skill/, 'a release is not a PR');
});

// Review findings on the 1.2.0 audits: each test is the failing input the review reported.
// why: guards rule:outward-acts
test('the handoff and ADR audits refuse empty fields that only look filled', () => {
  // The unfilled template, as rule:handoff-message-structure gives it.
  const rule = read(path.resolve('rules/tracking-and-handoff.md'));
  const template = rule.split('{#handoff-message-structure}')[1].split('```')[1];
  const out = runAudit('closeout', template);
  assert.equal(out.status, 1, 'the unfilled template is not a handoff');
  assert.match(out.stdout, /Git line/);
  assert.match(out.stdout, /Next Step/);
  const adr = '# ADR-007: Store plans on the device\n\n- **Status:** accepted\n- **Date:** 2026-02-01\n\n## Context and Problem Statement\nx\n\n## Decision Drivers\n- x\n\n## Considered Options\n\n## Decision Outcome\n\n**Chosen option:**\n\n### Dual-Horizon\n- **Impact now:**\n- **Impact later:**\n\n### Consequences\nx\n\n## Pros and Cons of the Options\nx\n';
  const a = runAudit('adr', adr);
  assert.equal(a.status, 1);
  for (const want of [/chosen option/, /Dual-Horizon/, /two options/]) assert.match(a.stdout, want);
});

// why: guards rule:sweep-auto-approval
test('the sweep audit catches an open high in a severity column or a finding bullet', () => {
  const head = '# Sweep\n\n- **Tier:** fix\n- **Branch:** feature/x at a1b2c3d (2026-03-04)\n\nPrivacy PASS. Supply chain PASS. Legal PASS. Code security PASS. Gaps PASS. Version goal alignment: YES.\n\n';
  const col = runAudit('pre-pr-sweep', head + '| ID | Finding | Severity | Disposition |\n|---|---|---|---|\n| S1 | Low-level parser lets a crafted file overwrite the key store | high | open |\n');
  assert.equal(col.status, 1);
  assert.match(col.stdout, /finding S1/);
  const bullet = runAudit('pre-pr-sweep', head + '- **S1 (high)** - the token is logged. Not yet fixed.\n');
  assert.equal(bullet.status, 1);
  assert.match(bullet.stdout, /finding S1/);
  assert.equal(runAudit('pre-pr-sweep', head + '- **S1 (high)** - the token is logged. FIXED a1b2c3d.\n').status, 0);
});

// why: guards rule:pr-body
test('the PR body audits read fenced code as code', () => {
  const dir = makeTemp('prfence-');
  const f = path.join(dir, 'b.md');
  fs.writeFileSync(f, '## Math: subtract\n\nFraming.\n\n### Summary\n\n```\nnode --test\n```\n');
  const line = spawnSync('node', [path.resolve('project/.claude/pr-body-audit.mjs'), f, 'Math: subtract'], { encoding: 'utf8' }).stdout.split('\n').find((l) => l.includes('no spaced dashes'));
  assert.match(line, /^PASS/);
});

// why: guards rule:outward-acts
test('the preview test audit refuses the template placeholder as a result', () => {
  const rec = '## Preview test - x, #1 (2026-03-04)\n\n- **Build:** the preview for `feature/x` at `a1b2c3d`\n- **Who, by stakes:** the lead in emulation only\n- **Setup:** made-up details only; nothing sent.\n\n| Check | Result |\n|---|---|\n| Layout | fine |\n\n- **Shots:** a.png\n- **Result:** PASS | FAIL - <what goes to the finding pipeline>\n';
  assert.equal(runAudit('preview-test', rec).status, 1);
});

// why: catches a break at scripts/kit.mjs:1495 that no other test catches
test('the written-out files in project/ match a fresh build', () => {
  const stale = [...build({ kit: path.resolve('.') })].filter(([rel, text]) => !fs.existsSync(path.resolve(rel)) || read(path.resolve(rel)) !== text).map(([rel]) => rel);
  assert.deepEqual(stale, [], 'run node scripts/kit.mjs build');
});

// K206 P4: instruction text that names a file under a fixed ~/.claude sends a session on another Claude folder to the
// wrong copy. The folder alone, as the default place, is fine.
// why: catches shipped rule, skill, agent or hook text that names a kit tool at a fixed ~/.claude path
test('no shipped instruction names a file under a fixed ~/.claude path, and build refuses one (K206)', () => {
  assert.deepEqual(fixedHomePaths({ kit: path.resolve('.') }), [], 'name the tool and point to the start-up line');
  const root = makeTemp('fixed-home-');
  fs.mkdirSync(path.join(root, 'rules'));
  fs.mkdirSync(path.join(root, 'project/.githooks'), { recursive: true });
  fs.writeFileSync(path.join(root, 'rules', 'a.md'), 'Your Claude folder (`~/.claude` by default) holds it.\nRun `~/.claude/skills/pre-pr-sweep/approve.mjs`.\n');
  fs.writeFileSync(path.join(root, 'project/.githooks', 'pre-push'), 'echo "run node $HOME/.claude/kit-tools/merge-gate.mjs disarm"\n');
  assert.deepEqual(fixedHomePaths({ kit: root }).map((h) => `${h.file}:${h.line}`), ['project/.githooks/pre-push:1', 'rules/a.md:2']);
});

// why: guards rule:pr-body
test('find ranks a rule by its ID, then its title, then its text', () => {
  const root = makeTemp('find-');
  fs.mkdirSync(path.join(root, 'rules'));
  fs.writeFileSync(path.join(root, 'rules', 'git.md'), '---\nid: git\nload: on-demand\nwhen: x\n---\n\n# Git\n\n## Branching {#branching}\nName a branch by its type.\n\n### Commit Message Format {#commit-message-format}\nOne line, type then subject.\n');
  fs.writeFileSync(path.join(root, 'rules', 'core.md'), '---\nid: core\nload: always\nwhen: x\n---\n\n## Edit Discipline {#edit-discipline}\nThink before a commit.\n');
  assert.equal(findRules({ kit: root, query: 'commit message' })[0].id, 'commit-message-format');
  assert.equal(findRules({ kit: root, query: 'what should I call my branch' })[0].id, 'branching');
  assert.deepEqual(findRules({ kit: root, query: 'edit-discipline' }).map((r) => [r.id, r.module]), [['edit-discipline', 'core']]);
  assert.deepEqual(findRules({ kit: root, query: 'nothing matches this' }), []);
});

// Plan rule-modules, Phase 1: a project still on one standards file (the owner's main project) keeps folding
// rules back. Its sections are matched to kit rules by heading; a changed one is a fold-back candidate with its
// kit ID, and a heading the kit lacks is the project's own.
// why: catches a break at scripts/kit.mjs:753 that no other test catches
test('fold-back maps an old single standards file to kit rules by heading', () => {
  const { kit, home, proj } = makeKit();
  fs.mkdirSync(path.join(kit, 'rules'));
  fs.writeFileSync(path.join(kit, 'rules', 'core.md'), '---\nid: core\nload: always\nwhen: x\n---\n\n## Alpha Rule {#alpha}\nkit text\n\n### Sub Rule {#sub}\nsame\n\n## Beta {#beta}\nsame\n');
  fs.writeFileSync(path.join(proj, '_Working Standards.md'), '# Std\n\n## Alpha Rule\nproject text\n\n### Sub Rule\nsame\n\n## Beta\nsame\n\n## Our Own Rule\nlocal\n');
  const r = foldBack({ kit, home, target: 'project', projectDir: proj });
  assert.deepEqual(r.oldLayout.changed.map((c) => [c.id, c.module]), [['alpha', 'core']]);
  assert.deepEqual(r.oldLayout.projectOnly, ['Our Own Rule']);
  assert.match(r.report, /## Old single standards file: sections changed here \(1\)[\s\S]*- rule:alpha \(core\): Alpha Rule/);
});

// After a compact, the post-compact orientation lives in a module that may not be loaded, so session start names it.
// why: catches a break at scripts/kit.mjs:1075 that no other test catches
test('session start after a compact names the orientation rule and where it lives', () => {
  const { kit, home, proj } = caseKit();
  assert.match(sessionStartReport({ kit, home, projectDir: proj, source: 'compact' }), /rule:post-compact-orientation/);
  assert.doesNotMatch(sessionStartReport({ kit, home, projectDir: proj, source: 'startup' }), /post-compact-orientation/);
});

// K206 (pulled into build 22 by the owner's pick, 2026-11-21): the rules named a fixed ~/.claude path, so a session on
// another Claude folder (a throwaway, a probe, a plugin) ran the home copy of a kit tool, or none. Session start names
// this session's own commands, spelled as the allow rules spell them: ~/.claude for the default folder, the full
// forward-slash path otherwise, a plugin's root under a plugin.
// why: catches a session sent to another Claude folder's approve.mjs or merge gate than its own
test('session start names this session\'s kit tool commands, in the allow rules\' spelling (K206)', () => {
  const { kit, home, proj } = caseKit();
  const full = home.split(path.sep).join('/');
  const own = sessionStartReport({ kit, home, projectDir: proj, env: {} });
  assert.match(own, new RegExp(`^Kit tools this session: sweep approval node ${full.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/skills/pre-pr-sweep/approve\\.mjs; merge gate node ${full.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/kit-tools/merge-gate\\.mjs`, 'm'));
  const tilde = sessionStartReport({ kit, home: path.join(os.homedir(), '.claude'), projectDir: proj, env: {} });
  // pin: 1 (the allow rules match this exact spelling)
  assert.match(tilde, /^Kit tools this session: sweep approval node ~\/\.claude\/skills\/pre-pr-sweep\/approve\.mjs; merge gate node ~\/\.claude\/kit-tools\/merge-gate\.mjs \(PowerShell: the full path, .*\/\.claude\/kit-tools\/merge-gate\.mjs\)/m);
  const plugin = path.join(kit, 'plugin-root');
  assert.match(sessionStartReport({ kit, home, projectDir: proj, env: { CLAUDE_PLUGIN_ROOT: plugin } }), new RegExp(`sweep approval node ${plugin.split(path.sep).join('/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/skills/`));
});

// K112 (1.42.0, the token proof: idle gaps over an hour were 86% of cache rebuild cost): one session carried many
// tasks for days. A closeout marks its task closed in the resume packet; a session resumed after that is told to start
// fresh, since a resumed session re-reads its whole old context. Nothing is said on a fresh start or with no mark.
// why: guards rule:compact-ritual
test('session start on a resumed session whose task the closeout closed says to start fresh', () => {
  const { kit, home, proj } = caseKit();
  fs.mkdirSync(path.join(proj, '.kit'), { recursive: true });
  const packet = path.join(proj, '.kit', 'resume-packet.md');
  fs.writeFileSync(packet, '# Resume packet\nwritten: 2026-11-17T10:00:00.000Z\nsession: -\n');
  assert.doesNotMatch(sessionStartReport({ kit, home, projectDir: proj, source: 'resume' }), /closed its task/, 'no mark');
  fs.writeFileSync(packet, '# Resume packet\nwritten: 2026-11-17T10:00:00.000Z\nsession: -\nclosed: 2026-11-17T10:00:00.000Z\n');
  assert.match(sessionStartReport({ kit, home, projectDir: proj, source: 'resume' }), /closed its task[\s\S]*\/clear/);
  for (const source of ['startup', 'clear', 'compact']) assert.doesNotMatch(sessionStartReport({ kit, home, projectDir: proj, source }), /closed its task/, source);
  // The build 16 sweep: the mark was tied to no session, so a session started after the close (on its own new task)
  // was told to clear its open work when it was resumed. Only a session that began before the close is told.
  fs.writeFileSync(packet, '# Resume packet\nwritten: 2026-11-17T11:00:00.000Z\nsession: -\nclosed: 2026-11-17T11:00:00.000Z\n');
  sessionStartReport({ kit, home, projectDir: proj, source: 'clear', session: 's2' });
  assert.doesNotMatch(sessionStartReport({ kit, home, projectDir: proj, source: 'resume', session: 's2' }), /closed its task/, 'a session begun after the close');
  assert.match(sessionStartReport({ kit, home, projectDir: proj, source: 'resume', session: 's1' }), /closed its task/, 'the session that closed');
  // A new close starts the list again.
  fs.writeFileSync(packet, '# Resume packet\nwritten: 2026-11-17T12:00:00.000Z\nsession: -\nclosed: 2026-11-17T12:00:00.000Z\n');
  assert.match(sessionStartReport({ kit, home, projectDir: proj, source: 'resume', session: 's2' }), /closed its task/, 's2 closed its own task');
});

// The old single standards file is gone from the kit. A mention of it is allowed only where the kit speaks of a
// project still on that file (the old-layout fold-back and the brief fallback).
// why: guards rule:kit-standards
test('nothing in the kit points at the retired standards file, except about projects still on it', () => {
  const left = [];
  for (const f of KIT_TEXT_FILES()) {
    // A mention may wrap, so the line before it counts as its context.
    read(f).split('\n').forEach((l, i, all) => {
      const ctx = `${all[i - 1] || ''} ${l}`;
      if (l.includes('_Working Standards.md') && !/one standards file|single standards file|old layout|"retired"/i.test(ctx)) left.push(`${path.relative('.', f)}:${i + 1}`);
    });
  }
  assert.deepEqual(left, []);
});

// Review finding: a pointer written as -> "Heading Title" breaks when the heading is renamed; every rule pointer
// in the kit uses its ID instead.
// why: guards rule:kit-standards
test('no rule pointer in the kit names a heading by its words', () => {
  const titles = new Set(ruleFiles().flatMap((f) => headings(read(f)).map((h) => h.title)));
  const byWords = [];
  for (const f of KIT_TEXT_FILES()) {
    for (const m of read(f).matchAll(/(?:->|\bper|\bsee|\bin) "([^"]+)"/g)) if (titles.has(m[1]) || [...titles].some((t) => t.startsWith(m[1] + ' '))) byWords.push(`${path.relative('.', f)}: "${m[1]}"`);
  }
  assert.deepEqual(byWords, []);
});

// why: guards rule:sweep-auto-approval
test('each agent role file matches the role table: tools, denied tools and rules at start', () => {
  const rows = roleTable();
  assert.deepEqual(rows.map((r) => r.role).sort(), ['builder', 'checker', 'orchestrator', 'reviewer', 'scanner']);
  for (const r of rows) {
    const fm = front(path.resolve('user/agents', `${r.role}.md`));
    assert.equal(fm.tools, r.tools, `${r.role} tools`);
    assert.equal(fm.disallowedTools || 'none', r.denied, `${r.role} denied tools`);
    assert.equal(fm.skills || 'none', r.rules === 'none' ? 'none' : `${r.role}-rules`, `${r.role} preloaded rules`);
  }
});

// why: guards rule:multi-agent-discipline. MC2: a role file with no model runs on whatever the session runs, so its cost and its
// recall move with the owner's saved pick. Every role file the kit ships names a full model id.
test('every agent role file the kit ships names its model', () => {
  const files = fs.readdirSync(path.resolve('user/agents')).filter((f) => f.endsWith('.md'));
  assert.ok(files.length >= 5);
  for (const f of files) assert.match(front(path.resolve('user/agents', f)).model || '', /^claude-[a-z]+-\d+(-\d+)?$/, `${f} names no model`);
});

// N14 (1.36.0, reproduced on AI Essentials' memory 2026-11-15): Claude Code's memory writes metadata into a memory
// file's frontmatter (node_type, originSessionId, modified) and quotes its description; fold-back then showed the file
// as the project's own change, and install skipped it, with no real edit in it.
// why: catches a real fold-back fault (N14): memory metadata read as the project's own edit, so install skipped the file
test('memory metadata the memory service adds is not a change to fold back or a reason to skip an update', () => {
  const kit = path.resolve('.');
  const home = makeTemp('n14-home-');
  const proj = makeTemp('n14-proj-');
  install({ kit, home, target: 'project', projectDir: proj });
  const memoryDir = path.join(home, 'projects', projectSlug(proj), 'memory');
  const file = fs.readdirSync(memoryDir).find((f) => f !== 'MEMORY.md' && f.endsWith('.md'));
  assert.ok(file, 'the fixture kit ships a memory file');
  const at = path.join(memoryDir, file);
  const text = read(at);
  const tagged = text.replace(/^description: (.*)$/m, (m, d) => `description: "${d}"`).replace(/^metadata:\n/m, 'metadata:\n  node_type: memory\n  originSessionId: 49209561-6213-4071-83c6-aaecdbd8d1f4\n  modified: 2026-11-12T03:19:00.195Z\n');
  assert.notEqual(tagged, text, 'the fixture file has frontmatter to tag');
  fs.writeFileSync(at, tagged);
  const r = foldBack({ kit, home, target: 'project', projectDir: proj });
  assert.ok(![...r.foldBack, ...r.conflict].includes(`memory/${file}`), JSON.stringify(r));
  // A real edit beside the metadata still counts.
  fs.writeFileSync(at, `${tagged}\n- a real line of this project\n`);
  assert.ok(foldBack({ kit, home, target: 'project', projectDir: proj }).foldBack.includes(`memory/${file}`));
});

// 1.36.0 sweep (data loss): the install half. An update over a file whose only change is the memory service's metadata
// goes ahead, and the file as it was is kept first; a real top-level key named like the metadata is a real edit.
// why: catches a real data loss (the 1.36.0 sweep): an update over a metadata-only memory file did not keep the file first
test('an update over a memory file with only metadata keeps the file as it was', () => {
  const { kit, home, proj } = makeKit();
  const front = (body) => `---\nname: style\ndescription: the style rule\nmetadata:\n  type: feedback\n---\n\n${body}\n`;
  fs.writeFileSync(path.join(kit, 'memory/style.md'), front('style rule'));
  install({ kit, home, target: 'project', projectDir: proj });
  const at = path.join(home, 'projects', projectSlug(proj), 'memory', 'style.md');
  const tagged = read(at).replace('metadata:\n', 'metadata:\n  node_type: memory\n  modified: 2026-11-12T03:19:00.195Z\n');
  fs.writeFileSync(at, tagged);
  fs.writeFileSync(path.join(kit, 'memory/style.md'), front('style rule, newer'));
  const r = install({ kit, home, target: 'project', projectDir: proj });
  assert.deepEqual(r.updated, ['memory/style.md']);
  assert.equal(read(path.join(r.backupDir, 'memory/style.md')), tagged);
  // A top-level key that only looks like the metadata (after a blank line) is the owner's text, not the service's.
  fs.writeFileSync(at, read(at).replace('metadata:\n', '\nmodified: by the owner\nmetadata:\n'));
  assert.ok(foldBack({ kit, home, target: 'project', projectDir: proj }).foldBack.includes('memory/style.md'));
});

// 1.36.1 (verifying 1.36.0 in the workbench, and the 1.36.1 sweep): the template _State.json gained two lines, and
// install three-way merged them into the project's own state, which clashed and asked for a hand merge. The state, the
// list and the decisions are the project's data from the first install on: seeded once, never merged or folded back.
// why: guards rule:kit-standards (an install never asks the owner to hand-merge the project's own data)
test('install seeds the project data files once and never merges, updates or folds them back', () => {
  const { kit, home, proj } = makeKit();
  const data = { '_State.json': '{\n  "kit": "<x.y.z>",\n  "rendered": {}\n}\n', '_List.jsonl': '', '_Decisions.jsonl': '' };
  for (const [f, t] of Object.entries(data)) fs.writeFileSync(path.join(kit, 'project', f), t);
  install({ kit, home, target: 'project', projectDir: proj });
  assert.equal(read(path.join(proj, '_State.json')), data['_State.json'], 'a new project gets the template');
  const mine = '{\n  "kit": "1.0.0",\n  "rendered": {\n    "_Master Roadmap.md#boxes": "abc"\n  }\n}\n';
  fs.writeFileSync(path.join(proj, '_State.json'), mine);
  fs.writeFileSync(path.join(proj, '_List.jsonl'), '{"id":"R1"}\n');
  // The kit changes its template data next to the project's own lines.
  fs.writeFileSync(path.join(kit, 'project', '_State.json'), '{\n  "kit": "<x.y.z>",\n  "rendered": {},\n  "roadmap": []\n}\n');
  fs.writeFileSync(path.join(kit, 'project', '_List.jsonl'), '\n');
  const r = install({ kit, home, target: 'project', projectDir: proj });
  assert.equal(read(path.join(proj, '_State.json')), mine);
  assert.equal(read(path.join(proj, '_List.jsonl')), '{"id":"R1"}\n');
  for (const f of Object.keys(data)) assert.ok(![...r.updated, ...r.skipped.map((s) => s.file), ...r.threeWayMerged].includes(f), `${f}: ${JSON.stringify(r)}`);
  const fb = foldBack({ kit, home, target: 'project', projectDir: proj });
  assert.ok(![...fb.foldBack, ...fb.conflict, ...fb.update].some((k) => k in data), JSON.stringify(fb));
});

// T7 (build 12, the owner's lock): the bounds file is the owner's from the first install on, as the data is: a kit
// change to its template never reaches a project that has one, so no install loosens what the owner set.
// why: guards rule:loop-driver
test('install seeds the loop bounds file once and never changes the owner\'s', () => {
  const { kit, home, proj } = makeKit();
  fs.mkdirSync(path.join(kit, 'project', '.claude'), { recursive: true });
  const template = (merge) => `{\n  "steps": [\n    { "step": "merge", "who": "${merge}" }\n  ],\n\n\n\n  "limits": { "fixRound": 3 }\n}\n`;
  fs.writeFileSync(path.join(kit, 'project', '.claude', 'bounds.json'), template('owner'));
  install({ kit, home, target: 'project', projectDir: proj });
  const file = path.join(proj, '.claude', 'bounds.json');
  assert.equal(read(file), template('owner'), 'a new project gets the template');
  // The owner tightens a limit; the kit's template loosens a step on a line far from it, which a merge would take.
  const mine = template('owner').replace('"fixRound": 3', '"fixRound": 2');
  fs.writeFileSync(file, mine);
  fs.writeFileSync(path.join(kit, 'project', '.claude', 'bounds.json'), template('alone'));
  const r = install({ kit, home, target: 'project', projectDir: proj });
  assert.equal(read(file), mine, 'install changed the owner\'s bounds');
  assert.ok(![...r.updated, ...r.threeWayMerged].includes('.claude/bounds.json'), JSON.stringify(r));
  // Untouched by the owner, it still stays as seeded: the owner reads every loosening before it applies.
  fs.writeFileSync(file, template('owner'));
  install({ kit, home, target: 'project', projectDir: proj });
  assert.equal(read(file), template('owner'));
});

// N5 (1.36.0): a 1.16 project ran under a 1.18 user layer whose approve.mjs needed a hook the project lacked, and
// session start said only that an update was there.
// why: catches a real gap (N5): session start never said a newer user layer can break an older project
test('session start names a user layer newer than the project for what it can break', () => {
  const { kit, home, proj } = makeKit();
  install({ kit, home, target: 'user' });
  install({ kit, home, target: 'project', projectDir: proj });
  assert.doesNotMatch(sessionStartReport({ kit, home, projectDir: proj }), /this project 1\.0\.0/);
  bump({ kit, level: 'minor', note: 'newer', date: '2026-02-01' });
  install({ kit, home, target: 'user' });
  assert.match(sessionStartReport({ kit, home, projectDir: proj }), /~\/\.claude runs kit 1\.1\.0, this project 1\.0\.0: [\s\S]*missing hook\. Run \/methodology-kit update before either\./);
  // The other way round is not this skew: a project newer than the user layer gets no such line.
  bump({ kit, level: 'minor', note: 'newest', date: '2026-02-02' });
  install({ kit, home, target: 'project', projectDir: proj });
  assert.doesNotMatch(sessionStartReport({ kit, home, projectDir: proj }), /~\/\.claude runs kit/);
});

// N8 (1.36.0; real by quote on 1.25.0: `cd src && ls` passed the installed guard, and a text rule against a lasting cd
// failed twice in AI Essentials): Claude Code returns the shell to the project after each Bash or PowerShell command
// when this is set (env-vars docs, read 2026-11-15), so a cd cannot carry into the next command.
// why: catches a real failure (N8): a cd in one shell command carried into the next command
test('the project settings keep each shell command starting in the project folder', () => {
  const s = JSON.parse(read(path.resolve('project/.claude/settings.json')));
  assert.equal(s.env.CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR, '1');
});

// MC2 and MC5 (1.36.0, the owner's pick 2026-11-15 "Roles user, Explore per project"): the built-in Explore runs on
// the session's model (Opus); a project agent named Explore overrides it (Claude Code sub-agents docs, read
// 2026-11-15). It installs into kit projects only, so a project without the kit keeps the built-in; it carries no
// hook, so the trust a project agent file's hooks need does not touch it. The five roles stay user level for theirs.
// why: guards the owner's pick "Roles user, Explore per project" (MC2, MC5)
test('the kit ships a read-only Explore on Sonnet into each kit project, and none into the Claude folder', () => {
  const fm = front(path.resolve('project/.claude/agents/Explore.md'));
  assert.equal(fm.name, 'Explore');
  assert.equal(fm.model, 'claude-sonnet-5-5');
  for (const t of ['Edit', 'Write', 'NotebookEdit', 'Agent']) assert.ok(!fm.tools.split(/,\s*/).includes(t), `Explore takes no ${t}`);
  assert.doesNotMatch(read(path.resolve('project/.claude/agents/Explore.md')), /hooks:/, 'a project agent file\'s hooks are skipped in -p, so it carries none');
  const home = makeTemp('explore-home-');
  const proj = makeTemp('explore-proj-');
  install({ kit: path.resolve('.'), home, target: 'user' });
  install({ kit: path.resolve('.'), home, target: 'project', projectDir: proj });
  assert.equal(fs.existsSync(path.join(home, 'agents', 'Explore.md')), false);
  assert.equal(front(path.join(proj, '.claude', 'agents', 'Explore.md')).model, 'claude-sonnet-5-5');
});

// why: guards rule:sweep-auto-approval
test('build writes each role its rules skill from the IDs in the role table, under its cap', () => {
  const out = build({ kit: path.resolve('.') });
  for (const r of roleTable().filter((x) => x.rules !== 'none')) {
    const skill = out.get(`user/skills/${r.role}-rules/SKILL.md`);
    assert.ok(skill, `${r.role}-rules is built`);
    assert.match(skill, new RegExp(`^---\nname: ${r.role}-rules\n`));
    assert.match(skill, /user-invocable: false/);
    assert.match(skill, /wins where it differs/);
    for (const id of r.rules.split(',').map((s) => s.trim())) assert.match(skill, new RegExp(`\{#${id}\}`), `${r.role} carries ${id}`);
    assert.ok(Buffer.byteLength(skill) <= 8000, `${r.role}-rules is ${Buffer.byteLength(skill)} bytes`);
  }
});

// why: guards rule:agent-team-adapter
test('the builder edit fence allows edits in its worktree and blocks edits outside it', () => {
  const dir = gitTree();
  const ok = runHook('user/kit-hooks/edit-fence.cjs', { cwd: dir, tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'a.js') } });
  assert.equal(ok.status, 0, ok.stderr);
  const out = runHook('user/kit-hooks/edit-fence.cjs', { cwd: dir, tool_name: 'Write', tool_input: { file_path: path.join(os.tmpdir(), 'elsewhere.js') } });
  assert.equal(out.status, 2);
  assert.match(out.stderr, /outside this builder's worktree/);
});

// why: guards rule:agent-team-adapter
test('the builder edit fence keeps to the unit file list in its own worktree git folder, never a tracked file', () => {
  const dir = gitTree();
  const wt = path.join(dir, '.claude', 'worktrees', 'unit-1');
  spawnSync('git', ['-C', dir, 'worktree', 'add', '-q', wt], { encoding: 'utf8' });
  // Written the way the builder brief says: into the path git names for this worktree.
  const listPath = spawnSync('git', ['-C', wt, 'rev-parse', '--path-format=absolute', '--git-path', 'kit-unit-files.txt'], { encoding: 'utf8' }).stdout.trim();
  fs.writeFileSync(listPath, 'a.js\nsrc/b.js\n');
  assert.equal(runHook('user/kit-hooks/edit-fence.cjs', { cwd: wt, tool_input: { file_path: path.join(wt, 'src', 'b.js') } }).status, 0);
  const out = runHook('user/kit-hooks/edit-fence.cjs', { cwd: wt, tool_input: { file_path: path.join(wt, 'c.js') } });
  assert.equal(out.status, 2);
  assert.match(out.stderr, /not in this unit's file list/);
  // The list never shows as a change to commit, and it binds only its own worktree.
  assert.equal(spawnSync('git', ['-C', wt, 'status', '--porcelain'], { encoding: 'utf8' }).stdout, '');
  assert.equal(runHook('user/kit-hooks/edit-fence.cjs', { cwd: dir, tool_input: { file_path: path.join(dir, 'c.js') } }).status, 0);
});

// why: guards rule:sub-agent-verification
test('the checker clean-tree stop passes an untouched tree and catches a changed file', () => {
  const dir = gitTree();
  const base = { cwd: dir, session_id: `t-${Date.now()}-${Math.random()}` };
  assert.equal(runHook('user/kit-hooks/clean-tree.cjs', { ...base, hook_event_name: 'PreToolUse' }).status, 0);
  assert.equal(runHook('user/kit-hooks/clean-tree.cjs', { ...base, hook_event_name: 'Stop' }).status, 0);
  const s2 = { cwd: dir, session_id: `t-${Date.now()}-${Math.random()}` };
  runHook('user/kit-hooks/clean-tree.cjs', { ...s2, hook_event_name: 'PreToolUse' });
  fs.writeFileSync(path.join(dir, 'a.js'), 'changed by the checker\n');
  const out = runHook('user/kit-hooks/clean-tree.cjs', { ...s2, hook_event_name: 'Stop' });
  assert.equal(out.status, 2);
  assert.match(out.stderr, /a\.js/);
});

// The owner, 2026-10-31: the main branch is main everywhere. A repo made without a branch name takes the machine's
// default (master on CI runners), so every git init in the kit's code, tests and instructions names its branch.
// why: guards rule:branching
test('every git init in the kit names its branch, so main never depends on the machine', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const files = ['scripts', 'project', 'user', 'tests'].flatMap((d) => walk(path.resolve(d)))
    .concat(fs.readdirSync('.').filter((f) => f.endsWith('.md')).map((f) => path.resolve(f)));
  const unnamed = [];
  for (const f of files) {
    const lines = read(f).split('\n');
    lines.forEach((l, i) => {
      const call = /(['"])init\1\s*,([^)\]]*)/.exec(l);
      if (call && !/['"](-b|--initial-branch)/.test(call[2])) unnamed.push(`${path.relative('.', f)}:${i + 1}`);
      for (const m of l.matchAll(new RegExp('`git ' + 'init([^`]*)`', 'g'))) if (!/(-b|--initial-branch=)\s?main/.test(m[1])) unnamed.push(`${path.relative('.', f)}:${i + 1}`);
    });
  }
  assert.deepEqual(unnamed, []);
});

// why: guards rule:sweep-auto-approval
test('the git pre-push hook stops every pusher without approval, a plain terminal included (K163)', { windows: true }, () => {
  const hook = path.resolve('project/.githooks/pre-push');
  const sh = (env) => spawnSync('sh', [hook], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
  assert.notEqual(sh({}).status, 0, 'no marker is no owner: a push naming nothing needs a yes (K163)');
  assert.notEqual(sh({ AI_AGENT: 'some-tool' }).status, 0, 'an agent without approval');
  assert.notEqual(sh({ CLAUDECODE: '1' }).status, 0, 'Claude Code without approval');
  assert.equal(sh({ CLAUDECODE: '1', KIT_PUSH_APPROVED: '1' }).status, 0, 'after the owner said go');
});

// why: guards rule:sweep-auto-approval
test('the builder and checker role files wire their guards to the installed hook scripts', () => {
  // pin: 1 (Claude Code reads the role file's hook block)
  assert.match(read(path.resolve('user/agents/builder.md')), /matcher: "Edit\|Write\|NotebookEdit"\n      hooks:\n        - type: command\n          command: node "\{\{CLAUDE_HOME\}\}\/kit-hooks\/edit-fence\.cjs"/);
  const checker = read(path.resolve('user/agents/checker.md'));
  assert.match(checker, /matcher: "Bash\|PowerShell"[\s\S]*clean-tree\.cjs[\s\S]*Stop:[\s\S]*clean-tree\.cjs/);
  assert.equal(render('node "{{CLAUDE_HOME}}/kit-hooks/x.cjs"', { claudeHome: 'D:/home-of-pat/.claude' }), 'node "D:/home-of-pat/.claude/kit-hooks/x.cjs"');
});

// A placeholder left in a role file's hook line points the hook at no script, and an agent would start unguarded.
// why: guards rule:sweep-auto-approval
test('install user leaves no placeholder in any rendered agent role file', () => {
  const home = makeTemp('agents-home-');
  install({ kit: path.resolve('.'), home, target: 'user' });
  const agents = fs.readdirSync(path.join(home, 'agents')).filter((n) => n.endsWith('.md'));
  assert.deepEqual(agents.sort(), fs.readdirSync(path.resolve('user/agents')).filter((n) => n.endsWith('.md')).sort());
  for (const n of agents) {
    const text = read(path.join(home, 'agents', n));
    assert.doesNotMatch(text, /\{\{/, n);
    assert.ok(text.includes(`node "${home.split(path.sep).join('/')}/kit-hooks/`), `${n}: its hooks name the installed scripts`);
  }
});

// why: guards rule:sub-agent-verification
test('the checker clean-tree stop also catches a second edit to a file that was already changed', () => {
  const dir = gitTree();
  fs.writeFileSync(path.join(dir, 'a.js'), 'changed by the builder, not committed\n');
  const s = { cwd: dir, session_id: `t-${Date.now()}-${Math.random()}` };
  runHook('user/kit-hooks/clean-tree.cjs', { ...s, hook_event_name: 'PreToolUse' });
  fs.writeFileSync(path.join(dir, 'a.js'), 'and changed again by the checker\n');
  assert.equal(runHook('user/kit-hooks/clean-tree.cjs', { ...s, hook_event_name: 'Stop' }).status, 2);
});

// Review findings on the 1.1.0 guards: each test is the failing input the review reported.
// why: guards rule:sub-agent-verification
test('the checker clean-tree stop lets the unit tests write their ignored caches', () => {
  const dir = gitTree();
  fs.writeFileSync(path.join(dir, '.gitignore'), 'cache/\n');
  spawnSync('git', ['-C', dir, 'add', '.gitignore'], { encoding: 'utf8' });
  spawnSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'ignore'], { encoding: 'utf8' });
  const s = { cwd: dir, session_id: `t-${Date.now()}-${Math.random()}` };
  runHook('user/kit-hooks/clean-tree.cjs', { ...s, hook_event_name: 'PreToolUse' });
  fs.mkdirSync(path.join(dir, 'cache'));
  fs.writeFileSync(path.join(dir, 'cache', 'run.json'), '{}\n');
  const out = runHook('user/kit-hooks/clean-tree.cjs', { ...s, hook_event_name: 'Stop' });
  assert.equal(out.status, 0, out.stderr);
});

// why: guards rule:sub-agent-verification
test('the checker clean-tree stop blocks once, never asks for a restore, and lets the stop through after', () => {
  const dir = gitTree();
  const s = { cwd: dir, session_id: `t-${Date.now()}-${Math.random()}` };
  runHook('user/kit-hooks/clean-tree.cjs', { ...s, hook_event_name: 'PreToolUse' });
  fs.writeFileSync(path.join(dir, 'b.js'), 'new\n');
  const out = runHook('user/kit-hooks/clean-tree.cjs', { ...s, hook_event_name: 'SubagentStop' });
  assert.equal(out.status, 2);
  assert.match(out.stderr, /b\.js/);
  assert.match(out.stderr, /Do not restore or delete/);
  assert.doesNotMatch(out.stderr, /Restore it/);
  // Claude Code marks the second stop attempt; the checker has been told, so it may finish.
  assert.equal(runHook('user/kit-hooks/clean-tree.cjs', { ...s, hook_event_name: 'SubagentStop', stop_hook_active: true }).status, 0);
  assert.equal(fs.readdirSync(os.tmpdir()).filter((f) => f.includes(s.session_id.replace(/[^\w-]/g, ''))).length, 0, 'no snapshot left behind');
});

// why: guards rule:sub-agent-verification
test('the checker clean-tree stop names only what changed while it ran, not earlier uncommitted work', () => {
  const dir = gitTree();
  fs.writeFileSync(path.join(dir, 'before.js'), 'the builder left this\n');
  const s = { cwd: dir, session_id: `t-${Date.now()}-${Math.random()}` };
  runHook('user/kit-hooks/clean-tree.cjs', { ...s, hook_event_name: 'PreToolUse' });
  fs.writeFileSync(path.join(dir, 'probe.txt'), 'the checker wrote this\n');
  const out = runHook('user/kit-hooks/clean-tree.cjs', { ...s, hook_event_name: 'SubagentStop' });
  assert.equal(out.status, 2);
  assert.match(out.stderr, /probe\.txt/);
  assert.doesNotMatch(out.stderr, /before\.js/);
});

// why: guards rule:sub-agent-verification
test('two checkers in one session keep separate snapshots', () => {
  const dir = gitTree();
  const sid = `t-${Date.now()}-${Math.random()}`;
  runHook('user/kit-hooks/clean-tree.cjs', { cwd: dir, session_id: sid, agent_id: 'checker-a', hook_event_name: 'PreToolUse' });
  fs.writeFileSync(path.join(dir, 'a.js'), 'changed while checker A ran\n');
  runHook('user/kit-hooks/clean-tree.cjs', { cwd: dir, session_id: sid, agent_id: 'checker-b', hook_event_name: 'PreToolUse' });
  assert.equal(runHook('user/kit-hooks/clean-tree.cjs', { cwd: dir, session_id: sid, agent_id: 'checker-b', hook_event_name: 'SubagentStop' }).status, 0);
  assert.equal(runHook('user/kit-hooks/clean-tree.cjs', { cwd: dir, session_id: sid, agent_id: 'checker-a', hook_event_name: 'SubagentStop' }).status, 2);
});

// Two sessions at once, each with a checker of the same name: a snapshot keyed by the agent alone lets the second
// session's checker start from the first one's tree and take its changes for its own.
// why: guards rule:test-value (a checker of one session blamed for another session's change)
// planted: {"file":"user/kit-hooks/clean-tree.cjs","was":"input.session_id || 'none'","to":"input.session_id && 'none'"}
test('two sessions with a checker of the same name keep separate snapshots', () => {
  const dir = gitTree();
  const base = `t-${Date.now()}-${Math.random()}`;
  const hook = (session, event) => runHook('user/kit-hooks/clean-tree.cjs', { cwd: dir, session_id: `${base}-${session}`, agent_id: 'checker', hook_event_name: event });
  hook('one', 'PreToolUse');
  fs.writeFileSync(path.join(dir, 'a.js'), 'changed while the first session ran\n');
  hook('two', 'PreToolUse');
  assert.equal(hook('two', 'SubagentStop').status, 0, 'the second session saw no change of its own');
  assert.equal(hook('one', 'SubagentStop').status, 2);
});

// A worktree gone between the first command and the stop is a change the checker must report, and the stop message
// has to name it: a blank line would tell the checker nothing to report.
// why: guards rule:test-value (a removed worktree stopped the checker with no word of what changed)
// planted: {"file":"user/kit-hooks/clean-tree.cjs","was":"if (!(t in now)) return `${t}\\n  (worktree removed)`;","to":"if (!(t in now)) return void `${t}\\n  (worktree removed)`;"}
test('the checker clean-tree stop names a worktree that was removed while it ran', () => {
  const dir = gitTree();
  const other = path.join(path.dirname(dir), `${path.basename(dir)}-gone`);
  spawnSync('git', ['-C', dir, 'worktree', 'add', '-q', other], { encoding: 'utf8' });
  const s = { cwd: dir, session_id: `t-${Date.now()}-${Math.random()}` };
  runHook('user/kit-hooks/clean-tree.cjs', { ...s, hook_event_name: 'PreToolUse' });
  spawnSync('git', ['-C', dir, 'worktree', 'remove', '--force', other], { encoding: 'utf8' });
  const out = runHook('user/kit-hooks/clean-tree.cjs', { ...s, hook_event_name: 'Stop' });
  assert.equal(out.status, 2);
  assert.match(out.stderr, /-gone\n {2}\(worktree removed\)/);
});

// Paths are matched without case on Windows only: on Linux and macOS, SRC/B.js is another file than src/b.js, so
// a list naming one must not let the other through.
// why: guards rule:test-value (a builder edits a file whose name differs from the list's only by case)
// planted: {"file":"user/kit-hooks/edit-fence.cjs","was":"process.platform === 'win32' ? s.toLowerCase() : s","to":"process.platform !== 'win32' ? s.toLowerCase() : s"}
test('the builder edit fence ignores path case on Windows and only there', () => {
  const dir = gitTree();
  const listPath = spawnSync('git', ['-C', dir, 'rev-parse', '--path-format=absolute', '--git-path', 'kit-unit-files.txt'], { encoding: 'utf8' }).stdout.trim();
  fs.writeFileSync(listPath, 'src/b.js\n');
  const upper = runHook('user/kit-hooks/edit-fence.cjs', { cwd: dir, tool_input: { file_path: path.join(dir, 'SRC', 'B.js') } });
  assert.equal(upper.status, process.platform === 'win32' ? 0 : 2, upper.stderr);
  assert.equal(runHook('user/kit-hooks/edit-fence.cjs', { cwd: dir, tool_input: { file_path: path.join(dir, 'src', 'b.js') } }).status, 0);
});

// why: guards rule:agent-team-adapter
test('the builder edit fence follows a symlinked or junctioned worktree path', { windows: true }, () => {
  const dir = gitTree();
  const link = `${dir}-link`;
  fs.symlinkSync(dir, link, 'junction');
  const out = runHook('user/kit-hooks/edit-fence.cjs', { cwd: link, tool_input: { file_path: path.join(link, 'a.js') } });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(runHook('user/kit-hooks/edit-fence.cjs', { cwd: link, tool_input: { file_path: path.join(os.tmpdir(), 'elsewhere.js') } }).status, 2);
});

// why: guards rule:agent-team-adapter
test('the builder edit fence reads hand-written unit list spellings', () => {
  const dir = gitTree();
  const listPath = spawnSync('git', ['-C', dir, 'rev-parse', '--path-format=absolute', '--git-path', 'kit-unit-files.txt'], { encoding: 'utf8' }).stdout.trim();
  fs.writeFileSync(listPath, './src/b.js\r\nlib\\c.js\n');
  assert.equal(runHook('user/kit-hooks/edit-fence.cjs', { cwd: dir, tool_input: { file_path: path.join(dir, 'src', 'b.js') } }).status, 0);
  assert.equal(runHook('user/kit-hooks/edit-fence.cjs', { cwd: dir, tool_input: { file_path: path.join(dir, 'lib', 'c.js') } }).status, 0);
  assert.equal(runHook('user/kit-hooks/edit-fence.cjs', { cwd: dir, tool_input: { file_path: path.join(dir, 'src', 'd.js') } }).status, 2);
  if (process.platform === 'win32') {
    assert.equal(runHook('user/kit-hooks/edit-fence.cjs', { cwd: dir, tool_input: { file_path: path.join(dir, 'SRC', 'B.js') } }).status, 0, 'Windows paths ignore case');
  }
});

// why: guards rule:agent-canary
test('the canary passes a message that opens with the phrase and logs a hit', () => {
  const dir = canaryRepo();
  const out = canary({ cwd: dir, hook_event_name: 'SubagentStop', agent_type: 'builder', agent_id: 'a1', last_assistant_message: `${FAKE_PHRASE}\n\nUNIT: u1 DONE` });
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(canaryLog(dir).map((e) => [e.role, e.result]), [['builder', 'hit']]);
});

// why: guards rule:agent-canary
test('the canary stops a message without the phrase once, says close out, and never names the phrase', () => {
  const dir = canaryRepo();
  const base = { cwd: dir, hook_event_name: 'SubagentStop', agent_type: 'checker', agent_id: 'a2', last_assistant_message: 'VERDICT: PASS' };
  const out = canary(base);
  assert.equal(out.status, 2);
  assert.match(out.stderr, /close out/i);
  assert.match(out.stderr, /rule:agent-canary/);
  // Found live: an isolated agent cannot write outside its worktree by any tool, so it only stops, leaves its
  // changes in place and replies with its note; the lead saves the hand-off.
  assert.match(out.stderr, /leave your changes/i);
  assert.match(out.stderr, /Closed out/);
  assert.doesNotMatch(out.stderr, /work\.patch|kit-handoff/, 'the agent is never sent to write outside its worktree');
  assert.ok(!out.stderr.toLowerCase().includes(FAKE_PHRASE.toLowerCase()), 'the hook must not leak the phrase');
  // The stop after the close-out goes through, so the agent can end.
  assert.equal(canary({ ...base, stop_hook_active: true, last_assistant_message: 'Closed out: note at x' }).status, 0);
  assert.deepEqual(canaryLog(dir).map((e) => e.result), ['miss', 'closed-out']);
  // A phrase buried later in the message is not an opening.
  assert.equal(canary({ ...base, agent_id: 'a3', last_assistant_message: `VERDICT: PASS\n${FAKE_PHRASE}` }).status, 2);
});

// why: guards rule:agent-canary
test('the canary reads the phrase from the main checkout when the agent works in a worktree', () => {
  const dir = canaryRepo();
  const wt = path.join(dir, '.claude', 'worktrees', 'unit-9');
  spawnSync('git', ['-C', dir, 'worktree', 'add', '-q', wt], { encoding: 'utf8' });
  assert.equal(canary({ cwd: wt, hook_event_name: 'SubagentStop', agent_type: 'builder', agent_id: 'w', last_assistant_message: `${FAKE_PHRASE} - done` }).status, 0);
  assert.equal(canary({ cwd: wt, hook_event_name: 'SubagentStop', agent_type: 'builder', agent_id: 'w2', last_assistant_message: 'done' }).status, 2);
});

// The canary lets any error through with exit 0, so "off" is shown against the same input in a project that has
// the phrase line: there it blocks, here it lets the stop and the brief through and logs nothing.
// why: guards rule:agent-canary
test('the canary is off in a project with no phrase line', () => {
  const stop = { hook_event_name: 'SubagentStop', agent_type: 'builder', agent_id: 'n', last_assistant_message: 'done' };
  const brief = { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { prompt: `Start your report with ${FAKE_PHRASE}.` } };
  const on = canaryRepo();
  assert.equal(canary({ ...stop, cwd: on }).status, 2, 'with the phrase line, the same stop is blocked');
  assert.match(canary({ ...brief, cwd: on }).stdout, /"permissionDecision":\s*"deny"/, 'and the same brief is denied');
  const off = canaryRepo(null);
  for (const input of [stop, brief]) {
    const r = canary({ ...input, cwd: off });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout + r.stderr, '', `${input.hook_event_name} goes through with no decision`);
  }
  assert.deepEqual(canaryLog(off), []);
});

// why: guards rule:outward-acts
test('the leak guard refuses a brief or message that carries the phrase, in any spelling', () => {
  const dir = canaryRepo();
  const ask = (tool, field, text) => {
    const r = canary({ cwd: dir, hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { [field]: text } });
    return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : 'allow';
  };
  assert.equal(ask('Agent', 'prompt', 'Build unit u1. Read the rules block first.'), 'allow');
  assert.equal(ask('Agent', 'prompt', `Start your report with ${FAKE_PHRASE}.`), 'deny');
  assert.equal(ask('Task', 'prompt', `start with tango  lima\nseven delta`), 'deny');
  assert.equal(ask('SendMessage', 'message', `Remember: ${FAKE_PHRASE.toUpperCase()}`), 'deny');
  const r = canary({ cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { prompt: FAKE_PHRASE } });
  assert.ok(!r.stdout.toLowerCase().includes(FAKE_PHRASE.toLowerCase()), 'the refusal must not repeat the phrase');
  // A leak is a tasker's failure, so the run record counts it next to the misses.
  assert.deepEqual(canaryLog(dir).map((e) => [e.tool, e.result]), [['Agent', 'leak-refused'], ['Task', 'leak-refused'], ['SendMessage', 'leak-refused'], ['Agent', 'leak-refused']]);
});

// why: guards rule:agent-canary
test('the canary and the audits read the phrase from the file the index names for the adapter', () => {
  const dir = adapterRepo(FAKE_PHRASE);
  const stop = (id, msg) => canary({ cwd: dir, hook_event_name: 'SubagentStop', agent_type: 'builder', agent_id: id, last_assistant_message: msg }).status;
  assert.equal(stop('i1', `${FAKE_PHRASE}\ndone`), 0);
  assert.equal(stop('i2', 'Stale Template Phrase\ndone'), 2);
  const f = path.join(dir, 'b.md');
  fs.writeFileSync(f, `- Plans sync now. ${FAKE_PHRASE}\n`);
  assert.match(spawnSync('node', [path.resolve('user/skills/release-notes/audit.mjs'), f, '1.0.0'], { encoding: 'utf8', cwd: dir }).stdout, /confirmation phrase/);
  const lean = spawnSync('node', [path.resolve('project/.claude/pr-body-audit-lean.mjs'), f, 'feat: subtract'], { encoding: 'utf8', cwd: dir });
  assert.match(lean.stdout, /FAIL\s+no confirmation phrase/);
  // The named file without a phrase line turns the check off; the template's line is never used instead.
  const off = adapterRepo(null);
  assert.equal(canary({ cwd: off, hook_event_name: 'SubagentStop', agent_type: 'builder', agent_id: 'o', last_assistant_message: 'done' }).status, 0);
});

// why: guards rule:agent-canary
test('a stop another hook blocked is still checked; only the canary\'s own close-out passes unchecked', () => {
  const dir = canaryRepo();
  const base = { cwd: dir, hook_event_name: 'SubagentStop', agent_type: 'checker', agent_id: 'b1' };
  // The clean-tree stop blocked first, so Claude Code marks the next stop as hook-driven.
  assert.equal(canary({ ...base, stop_hook_active: true, last_assistant_message: 'VERDICT: PASS' }).status, 2);
  // After the canary's own block the next stop ends the agent. A report that is not a close-out note is logged
  // as void, so the lead never takes it for a clean run.
  assert.equal(canary({ ...base, stop_hook_active: true, last_assistant_message: `${FAKE_PHRASE}\nVERDICT: PASS` }).status, 0);
  assert.deepEqual(canaryLog(dir).map((e) => e.result), ['miss', 'void-after-miss']);
});

// why: guards rule:agent-canary
test('the canary accepts the phrase under markdown, but not glued to other letters', () => {
  const dir = canaryRepo();
  const stop = (id, msg) => canary({ cwd: dir, hook_event_name: 'SubagentStop', agent_type: 'builder', agent_id: id, last_assistant_message: msg }).status;
  assert.equal(stop('m1', `**${FAKE_PHRASE}**\n\nUNIT: u1 DONE`), 0);
  assert.equal(stop('m2', `> ${FAKE_PHRASE}\ndone`), 0);
  assert.equal(stop('m3', `# ${FAKE_PHRASE}\ndone`), 0);
  assert.equal(stop('m4', `${FAKE_PHRASE}XYZ done`), 2);
});

// why: guards rule:agent-canary
test('the canary compares phrases in any script, not only ASCII', () => {
  // A Greek phrase, written as character codes so the source stays ASCII.
  const greek = String.fromCodePoint(0x39f, 0x3c5, 0x3b4, 0x3ad, 0x3bd, 0x20, 0x3ac, 0x3bd, 0x3b5, 0x3c5, 0x20, 0x3b1, 0x3c1, 0x3af, 0x3c3, 0x3c4, 0x3bf, 0x3c5);
  const dir = canaryRepo(greek);
  const stop = (id, msg) => canary({ cwd: dir, hook_event_name: 'SubagentStop', agent_type: 'builder', agent_id: id, last_assistant_message: msg }).status;
  assert.equal(stop('g1', `${greek}\ndone`), 0);
  assert.equal(stop('g2', 'done'), 2);
  const r = canary({ cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { prompt: '' } });
  assert.equal(r.stdout, '', 'an empty brief is never a leak');
});

// why: guards rule:sweep-auto-approval
test('without an agent id, one role\'s block never lets another role through unchecked', () => {
  const dir = canaryRepo();
  assert.equal(canary({ cwd: dir, hook_event_name: 'SubagentStop', agent_type: 'builder', session_id: 's1', last_assistant_message: 'done' }).status, 2);
  assert.equal(canary({ cwd: dir, hook_event_name: 'SubagentStop', agent_type: 'checker', session_id: 's1', last_assistant_message: 'VERDICT: PASS' }).status, 2);
});

// why: guards rule:agent-canary
test('the canary lets a stop through when the message field is missing, and logs it unchecked', () => {
  const dir = canaryRepo();
  assert.equal(canary({ cwd: dir, hook_event_name: 'SubagentStop', agent_type: 'builder', agent_id: 'x' }).status, 0);
  assert.deepEqual(canaryLog(dir).map((e) => e.result), ['unchecked']);
});

// why: guards rule:outward-acts
test('the leak guard also reads the agent name and spellings split by punctuation', () => {
  const dir = canaryRepo();
  const ask = (input) => {
    const r = canary({ cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: input });
    return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : 'allow';
  };
  assert.equal(ask({ name: FAKE_PHRASE, prompt: 'Build u1.' }), 'deny');
  assert.equal(ask({ prompt: 'Open with Tango-Lima-Seven-Delta.' }), 'deny');
  assert.equal(ask({ prompt: 'Open with **Tango Lima** Seven, Delta.' }), 'deny');
  assert.equal(ask({ prompt: 'The Tango Lima Seven Deltas are a band.' }), 'allow');
});

// why: guards rule:agent-canary
test('every kit role runs the canary at its stop, and the project settings run the leak guard', () => {
  for (const role of ['builder', 'checker', 'scanner', 'orchestrator', 'reviewer']) {
    assert.match(read(path.resolve('user/agents', `${role}.md`)), /Stop:\n {4}- hooks:\n {8}- type: command\n {10}command: node "\{\{CLAUDE_HOME\}\}\/kit-hooks\/canary\.cjs"/, `${role} wires the canary`); // pin: 1 Claude Code reads the hook block
  }
  // T2: the one guard process runs the leak guard and the sweep guard on every agent start and message.
  const { routes } = require(path.resolve('project/.claude/guard.cjs'));
  for (const tool of ['Agent', 'Task', 'SendMessage']) for (const g of ['canary.cjs', 'sweep-guard.cjs']) assert.ok(routes(tool).includes(g), `${g} on ${tool}`);
});

// why: guards rule:outward-acts
test('both guards run on every shell tool and block the call when they fail', () => {
  // T2: one entry runs the one guard process on every tool and blocks on failure (handoff item 26). Since V3 (1.25.1)
  // that entry is the launcher in the user settings (tests/guards-outside.test.mjs); a project file carries none.
  assert.equal(JSON.parse(read(path.resolve('project/.claude/settings.json'))).hooks.PreToolUse, undefined);
  const { routes } = require(path.resolve('project/.claude/guard.cjs'));
  for (const tool of ['Bash', 'PowerShell', 'Monitor', 'mcp__terminal__run_in_terminal']) for (const g of ['guard-delete.cjs', 'guard-outward.cjs']) assert.ok(routes(tool).includes(g), `${g} on ${tool}`);
});

// why: guards rule:kit-standards
test('the real phrase has one home in the kit: the last line of the rules every brief carries', () => {
  const block = read(path.resolve('rules/agent-teams.md')).split('**Rules every brief carries**')[1].split('```')[1];
  const last = block.trim().split('\n').pop().trim();
  const m = last.match(/^Confirmation phrase: .* with: (.+)$/);
  assert.ok(m, 'the block ends with the phrase line');
  const phrase = m[1].trim().toLowerCase();
  const homes = KIT_TEXT_FILES().filter((f) => read(f).toLowerCase().includes(phrase)).map((f) => path.relative('.', f).split(path.sep).join('/'));
  // The built copy of the module is the same block written out by kit.mjs build.
  assert.deepEqual(homes.sort(), ['project/standards/agent-teams.md', 'rules/agent-teams.md']);
});

// why: guards rule:pr-body
test('the PR body and release audits fail when the phrase appears', () => {
  const dir = canaryRepo();
  const f = path.join(dir, 'b.md');
  fs.writeFileSync(f, `## Math: subtract\n\nFraming. ${FAKE_PHRASE}.\n\n### Summary\n\nx\n`);
  const pr = spawnSync('node', [path.resolve('project/.claude/pr-body-audit.mjs'), f, 'Math: subtract'], { encoding: 'utf8', cwd: dir });
  assert.match(pr.stdout, /FAIL\s+no confirmation phrase/);
  const lean = spawnSync('node', [path.resolve('project/.claude/pr-body-audit-lean.mjs'), f, 'feat: subtract'], { encoding: 'utf8', cwd: dir });
  assert.match(lean.stdout, /FAIL\s+no confirmation phrase/);
  fs.writeFileSync(f, `- Plans sync now. ${FAKE_PHRASE}\n`);
  const rel = spawnSync('node', [path.resolve('user/skills/release-notes/audit.mjs'), f, '1.0.0'], { encoding: 'utf8', cwd: dir });
  assert.equal(rel.status, 1);
  assert.match(rel.stdout, /confirmation phrase/);
});

// why: guards rule:word-pins
test('a filled sheet parses into its grounding, topics, questions and answers', async () => {
  const { parseSheet } = await sheetTools();
  const s = parseSheet(SHEET);
  assert.equal(s.title, 'Export button');
  assert.equal(s.id, 'export-button');
  assert.equal(s.askedBy, 'Claude');
  assert.match(s.grounding, /^We are {2}planning[\s\S]*on the phone\.\t$/);
  assert.deepEqual(s.questions.map((q) => [q.n, q.topic]), [[1, 'Where it lives'], [2, 'Where it lives'], [3, 'Limits']]);
  assert.equal(s.questions[0].choice, 'a');
  assert.equal(s.questions[0].pick, 'a');
  assert.equal(s.questions[0].pickWhy, 'it is where people look.');
  assert.equal(s.questions[0].thought, 'i wonder abuot tablets  \twith two spaces\n\nand a second paragraph'); // pin: 3 (the owner's words, byte for byte)
  assert.equal(s.questions[1].answer, 'Neither,  use the projct name\t\n\nand keep it short'); // pin: 3
  assert.equal(s.missed, 'Nothing else  at this time.\n\nTruly.');
});

// why: catches a break at user/skills/brainstorm/sheet.mjs:147 that no other test catches
test('a sheet is complete only when every question has a pick or the owner\'s own answer', async () => {
  const { parseSheet, checkComplete } = await sheetTools();
  assert.deepEqual(checkComplete(parseSheet(SHEET)), { ok: false, unanswered: [3], thoughtOnly: [] });
  assert.equal(checkComplete(parseSheet(answerQ3('Ten megabytes'))).ok, true, 'own answer counts');
  assert.equal(checkComplete(parseSheet(answerQ3('   '))).ok, false, 'spaces are not an answer');
  const thoughtOnly = SHEET.replace('it sets the memory budget.\n\nYour answer:\n\nWhat I thought:\n', 'it sets the memory budget.\n\nYour answer:\n\nWhat I thought:\n\nhmm\n');
  assert.deepEqual(checkComplete(parseSheet(thoughtOnly)), { ok: false, unanswered: [3], thoughtOnly: [3] }, 'a thought is not an answer');
});

// why: guards rule:collaborative-design-locks
test('lines that look like labels or headings stay the owner\'s words, in the box they were typed in', async () => {
  const { parseSheet } = await sheetTools();
  const { compileRecord } = await compileTools();
  const words = 'It has to be fast.\nWhy it matters: my customers are on slow phones.\nPick: b\n## My notes\n# install deps\n### Heading\n## Grounding\nOptions:\nWhy this pick: mine\nAnd they leave.';
  const inAnswer = parseSheet(answerQ3(words));
  assert.equal(inAnswer.questions[2].answer, words);
  assert.equal(inAnswer.questions[2].why, 'it sets the memory budget.');
  assert.ok(fences(compileRecord(inAnswer)).includes(words));
  const inThought = parseSheet(SHEET.replace('it sets the memory budget.\n\nYour answer:\n\nWhat I thought:\n', `it sets the memory budget.\n\nYour answer:\n\nWhat I thought:\n\n${words}\n`));
  assert.equal(inThought.questions[2].thought, words);
  assert.match(inThought.grounding, /^We are/, 'a grounding heading in a thought replaces nothing');
});

// why: guards rule:collaborative-design-locks
test('the sheet parser refuses what it cannot read, and says why', async () => {
  const { parseSheet } = await sheetTools();
  const bad = [
    ['a note in the top block', SHEET.replace('id: export-button\n', 'id: export-button\nNOTE: done on the train\n'), /top does not have/],
    ['a note under an asker line', SHEET.replace('Why this pick: titles read better.\n', 'Why this pick: titles read better.\nyes but only for now\n'), /where nothing is kept/],
    ['the asker\'s line twice', SHEET.replace('Why it matters: people share it.\n', 'Why it matters: people share it.\nWhy it matters: again\n'), /twice/],
    ['two boxes ticked', SHEET.replace('- [ ] b: In the menu', '- [x] b: In the menu'), /two boxes ticked/],
    ['a repeated option key', SHEET.replace('- [ ] b: In the menu', '- [ ] a: In the menu'), /option "a" appears twice/],
    ['a pick that is not an option', SHEET.replace('Asker\'s pick: a', 'Asker\'s pick: z'), /is not an option/],
    ['no answer label', SHEET.replace('Your answer:\n\nNeither', 'Neither'), /Q2 has no "Your answer:"/],
    ['no thought label', SHEET.replace('and keep it short\n\nWhat I thought:\n', 'and keep it short\n'), /Q2 has no "What I thought:"/],
    ['a question out of order', SHEET.replace('### Q1. Where', '### Q5. Where'), /expected Q1/],
    ['a topic with no questions', SHEET.replace('## Topic: Limits\n\n', '## Topic: Empty\n\n## Topic: Limits\n\n'), /topic "Empty" has no questions/],
    ['the last topic with no questions', SHEET.replace('## Anything I did not ask?', '## Topic: Empty\n\n## Anything I did not ask?'), /topic "Empty" has no questions/],
    ['no grounding', SHEET.replace('## Grounding\n\nWe are  planning the export button.\n\nIt came up because exports fail on the phone.\t\n\n', ''), /no grounding/],
    ['an empty grounding', SHEET.replace('We are  planning the export button.\n\nIt came up because exports fail on the phone.\t\n\n', ''), /no grounding/],
    ['no closing box', SHEET.replace('## Anything I did not ask?\n\nNothing else  at this time.\n\nTruly.\n', ''), /no "## Anything I did not ask\?" box/],
    ['no id', SHEET.replace('id: export-button\n', ''), /no "id:" line/],
    ['no title', SHEET.replace('# Sheet: Export button', '# Export button'), /first line/],
  ];
  for (const [name, text, why] of bad) assert.throws(() => parseSheet(text), why, name);
});

// why: guards rule:collaborative-design-locks
test('a sealed sheet refuses a note on the asker\'s lines, a lost or moved question, and words filed as the closing box', async () => {
  const { parseSheet, sealOf, renderSheet } = await sheetTools();
  const base = parseSheet(SHEET);
  const sealed = renderSheet({ ...base, sealed: sealOf(base) });
  assert.equal(parseSheet(sealed).questions.length, 3);
  assert.equal(parseSheet(sealed.replace('- [ ] b: The title', '- [x] b: The title')).questions[1].choice, 'b', 'a tick is the owner\'s');
  assert.equal(parseSheet(sealed.replace('What I thought:\n\n## Topic: Limits', 'What I thought:\n\nmy thought\n\n## Topic: Limits')).questions[1].thought, 'my thought', 'a box is the owner\'s');
  const broken = {
    'a condition on a ticked option': sealed.replace('- [x] a: In the toolbar', '- [x] a: In the toolbar but only for now'),
    'a note after the reason': sealed.replace('Why this pick: titles read better.', 'Why this pick: titles read better. I disagree'),
    'a new option': sealed.replace('- [ ] b: The title', '- [ ] b: The title\n- [ ] c: A third way'),
    'a note in the grounding': sealed.replace('## Topic: Where it lives', 'This framing is wrong.\n\n## Topic: Where it lives'),
    'a note on the question': sealed.replace('### Q1. Where should the button sit?', '### Q1. Where should the button sit? is this needed'),
    'a changed pick': sealed.replace('Asker\'s pick: b', 'Asker\'s pick: a'),
    'a broken question heading': sealed.replace('### Q2. What', '### Q2 What'),
    'the closing line in a thought': sealed.replace('and a second paragraph', 'and a second paragraph\n\n## Anything I did not ask?'),
    'a deleted question': sealed.replace(/### Q3\.[^]*?(?=## Anything)/, ''),
  };
  for (const [name, text] of Object.entries(broken)) assert.throws(() => parseSheet(text), /sheet:/, name);
  assert.throws(() => parseSheet(broken['a note after the reason']), /since this sheet was sealed \(sealed: 3 questions; this reads 3\)/);
  assert.throws(() => parseSheet(broken['the closing line in a thought']), /this reads 1/);
});

// why: catches a break only Windows shows (drive paths, Git for Windows sh, junctions)
test('a sheet with Windows line ends reads the same, and the words stay whole', { windows: true }, async () => {
  const { parseSheet } = await sheetTools();
  const s = parseSheet(SHEET.replace(/\n/g, '\r\n'));
  assert.equal(s.questions[1].answer, 'Neither,  use the projct name\t\r\n\r\nand keep it short'); // pin: 3
  assert.equal(s.questions[0].choice, 'a');
  assert.equal(s.questions[0].thought, 'i wonder abuot tablets  \twith two spaces\r\n\r\nand a second paragraph'); // pin: 3
});

// why: guards rule:collaborative-design-locks
test('a sheet file saved in anything but UTF-8 is refused, and a UTF-8 mark is read past', async () => {
  const { readSheet, parseSheet } = await sheetTools();
  const dir = makeTemp('enc-');
  const f = path.join(dir, 's.sheet.md');
  fs.writeFileSync(f, Buffer.from('caf\xE9 sheet', 'latin1'));
  assert.throws(() => readSheet(f), /not saved as UTF-8/);
  fs.writeFileSync(f, Buffer.from('\uFEFFhi', 'utf16le'));
  assert.throws(() => readSheet(f), /saved as UTF-16/);
  fs.writeFileSync(f, Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(SHEET)]));
  assert.equal(parseSheet(readSheet(f)).id, 'export-button');
});

// why: catches a break at user/skills/brainstorm/sheet.mjs:188 that no other test catches
test('page rows export to a sheet that says what the rows say', async () => {
  const { sheetFromRows, parseSheet, renderSheet } = await sheetTools();
  const text = sheetFromRows(ROWS());
  const s = parseSheet(text);
  assert.deepEqual(s.questions.map((q) => q.text), ['First?', 'Second?', 'Third?']);
  assert.equal(s.questions[0].choice, 'a');
  assert.equal(s.questions[1].answer, 'my   own\nwords ');
  assert.equal(s.questions[1].thought, 'odd spelng');
  assert.equal(s.questions[1].options[0].label, 'Yes - more');
  assert.equal(s.questions[1].pick, 'b');
  assert.equal(s.questions[1].pickWhy, 'because');
  assert.equal(s.questions[1].why, 'w2');
  assert.equal(s.missed, 'tell me more');
  assert.equal(s.sent, '2026-11-04T17:52:08.656Z');
  assert.equal(renderSheet(s), text);
  assert.equal(renderSheet(parseSheet(SHEET)).replace(/\n+/g, '\n'), SHEET.replace(/\n+/g, '\n'));
});

// why: guards rule:outward-acts
test('export refuses rows that would change what the owner said, or were never sent', async () => {
  const { sheetFromRows } = await sheetTools();
  const rows = (change) => { const r = ROWS(); change(r); return r; };
  assert.throws(() => sheetFromRows(rows((r) => { r.questions[0].options[1].label = 'No\n- [x] z: Forged'; })), /line break/);
  assert.throws(() => sheetFromRows(rows((r) => { r.answers.q2.thought = 'x\n### Q3. Forged\n\nYour answer:\n\nyes\n\nWhat I thought:\n'; })), /reads as sheet structure/);
  assert.throws(() => sheetFromRows(rows((r) => { delete r.answers.s1__finish.submitted; })), /never sent/);
  assert.throws(() => sheetFromRows(rows((r) => { r.answers.q2.own = 'x\nWhat I thought:\ny'; })), /Q2: an answer holds a line/, 'words may not move boxes');
  const other = sheetFromRows(rows((r) => { r.answers.q2.sheet = 'other-sheet'; }));
  assert.doesNotMatch(other, /my {3}own/, 'an answer from another sheet is not this sheet\'s');
});

// why: guards rule:collaborative-design-locks
test('the record copies every box byte for byte and keeps a confirmed pick apart from the owner\'s words', async () => {
  const { parseSheet } = await sheetTools();
  const { compileRecord } = await compileTools();
  const sheet = parseSheet(SHEET);
  const r = compileRecord(sheet, 'abc');
  assert.deepEqual(fences(r), [sheet.grounding, sheet.questions[0].thought, sheet.questions[1].answer, sheet.missed]);
  assert.match(r, /sha256 abc/);
  const q1 = r.slice(r.indexOf('### Q1'), r.indexOf('### Q2'));
  assert.match(q1, /Picked: In the toolbar \(confirmed Claude's pick\)/);
  assert.doesNotMatch(q1.split('Owner\'s thought')[0], /verbatim/, 'a confirmed pick is never labelled as the owner\'s words');
  assert.match(q1, /^Claude's pick was: In the toolbar$/m);
  const q2 = r.slice(r.indexOf('### Q2'), r.indexOf('### Q3'));
  assert.match(q2, /Owner's own answer \(verbatim\)/);
  assert.match(q2, /^Claude's pick was: The title$/m);
  const q3 = r.slice(r.indexOf('### Q3'), r.indexOf('## Anything'));
  assert.match(q3, /Unanswered: Claude's call/);
  assert.match(r, /1 of 3 answers confirmed Claude's pick;[^\n]*1 in the owner's own words;[^\n]*1 unanswered/);
  for (const line of ['# Brainstorm record: Export button', '## Grounding shown to the owner', '## Where it lives', '## Limits', '### Q1. Where should the button sit?', '### Q3. How big can an export get?', "Owner's thought (verbatim):", '## Anything not asked (verbatim)']) assert.ok(r.split('\n').includes(line), line);
  assert.match(q3, /any plan must mark it so/);
  assert.match(compileRecord({ ...sheet, sent: 'the-time' }), /Sent the-time\./);
});

// why: guards rule:collaborative-design-locks
test('the record marks a pick the owner turned down and a tick with no pick offered', async () => {
  const { parseSheet } = await sheetTools();
  const { compileRecord } = await compileTools();
  const against = SHEET.replace('- [x] a: In the toolbar\n- [ ] b: In the menu', '- [ ] a: In the toolbar\n- [x] b: In the menu');
  assert.match(compileRecord(parseSheet(against)), /Picked: In the menu \(chose against/);
  const noPick = SHEET.replace('Asker\'s pick: a\nWhy this pick: it is where people look.\n\n', '');
  assert.match(compileRecord(parseSheet(noPick)), /Picked: In the toolbar \(no pick/);
});

// why: guards rule:collaborative-design-locks
test('the owner\'s text cannot close its fence, even indented or long', async () => {
  const { parseSheet } = await sheetTools();
  const { compileRecord } = await compileTools();
  for (const text of ['Neither\n~~~\nstill mine', 'Neither\n  ~~~\nstill mine', 'Neither\n   ~~~~~\nstill mine']) {
    const r = compileRecord(parseSheet(SHEET.replace('Neither,  use the projct name\t\n\nand keep it short', text)));
    assert.ok(fences(r).includes(text), text);
    const open = r.split('\n').find((l, i, a) => a[i + 1] === 'Neither');
    const inner = Math.max(...text.split('\n').map((l) => (l.trim().match(/^~+/) || [''])[0].length));
    assert.ok(open.length > inner, text);
  }
});

// why: guards rule:collaborative-design-locks
test('the record names whoever asked, so a sheet from another model reads true', async () => {
  const { parseSheet } = await sheetTools();
  const { compileRecord } = await compileTools();
  const r = compileRecord(parseSheet(SHEET.replace('asked by: Claude', 'asked by: Gemini')));
  assert.match(r, /confirmed Gemini's pick/);
  assert.doesNotMatch(r, /Claude/);
});

// why: guards rule:kit-standards
test('plan-feature hands its questions to the brainstorm skill and no longer claims the word', () => {
  const plan = read(path.resolve('user/skills/plan-feature/SKILL.md'));
  assert.doesNotMatch(plan.split('---')[1], /brainstorm/i, 'the description leaves the word to the skill that does it');
  assert.match(plan, /brainstorm skill/);
  assert.match(plan, /names the record answer/);
  assert.equal(fs.existsSync(path.resolve('user/skills/plan-feature/references/explore-and-options.md')), false);
  assert.ok(fs.existsSync(path.resolve('user/skills/brainstorm/references/question-craft.md')));
  const skill = read(path.resolve('user/skills/brainstorm/SKILL.md'));
  assert.match(skill.split('---')[1], /^name: brainstorm$/m);
  const cases = JSON.parse(read(path.resolve('project/.claude/kit/skill-cases.json')));
  assert.ok(JSON.stringify(cases).includes('"brainstorm"'), 'session start can name it');
});

// why: guards rule:kit-standards
test('the sheet page ships no private data, calls no third party, and writes the fields the export reads', () => {
  const page = read(path.resolve('user/skills/brainstorm/assets/sheet-page.html'));
  assert.doesNotMatch(page, /[^\x00-\x7F]/, 'ASCII like every kit file');
  assert.doesNotMatch(page, /\bMax\b|goudy|googleapis/);
  const written = new Set([...page.matchAll(/area\(q(?:id)?\.id,'(\w+)'/g), ...page.matchAll(/save\(q\.id, \{(\w+):/g), ...page.matchAll(/saveFinish\(sid,\{(\w+):/g)].map((m) => m[1]));
  for (const field of ['choice', 'own', 'thought', 'missed']) assert.ok(written.has(field), field);
  assert.match(page, /saveFinish\(sid,\{missed:t\.value, submitted:when/, 'export refuses a sheet with no sent time');
  assert.match(page, /const sid = current \+ '__finish'/);
  assert.match(page, /collection\('answers'\)\.doc\(qid\)\.set/);
  for (const field of ['grounding', 'sectionTitle', 'recWhy', 'submitted']) assert.ok(page.includes(field), field);
});
