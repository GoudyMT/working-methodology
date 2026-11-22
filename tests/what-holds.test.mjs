// K294 (build U13): the kit says plainly which guards hold which agents. Only git hooks and CI hold an agent or tool
// outside Claude Code; the .claude guards and hooks run only inside it. The build writes project/AGENTS.md from
// rules/core.md (the body) and rules/_parts/agents-head.md, and project/standards/security.md from rules/security.md,
// so these tests read those sources, not the installed copies.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build } from '../scripts/kit.mjs';

const read = (rel) => fs.readFileSync(path.resolve(rel), 'utf8');
const CAPS = JSON.parse(read('kit.config.json')).caps;
const isAscii = (text) => /^[\x00-\x7F]*$/.test(text);

// The section headed "What holds where" in the core source: from its heading to the next "## " heading or the end.
function whatHoldsSection(core) {
  const start = /^## What holds where[^\n]*$/m.exec(core);
  if (!start) return '';
  const rest = core.slice(start.index + start[0].length);
  const next = /^## /m.exec(rest);
  return (start[0] + (next ? rest.slice(0, next.index) : rest)).trimEnd();
}

// why: catches an AGENTS.md that never says git hooks and CI are the only layers outside Claude Code
test('the AGENTS source has a What holds where section naming Claude Code, git hooks and CI, ASCII, inside the cap', () => {
  const core = read('rules/core.md');
  const section = whatHoldsSection(core);
  assert.ok(section, 'rules/core.md needs a "## What holds where" section');
  for (const word of ['Claude Code', 'git hooks', 'CI']) {
    assert.ok(section.includes(word), `the section names ${word}`);
  }
  assert.ok(isAscii(section), 'the section is ASCII only');
  assert.ok(Buffer.byteLength(section) <= 1200, `the section is short: ${Buffer.byteLength(section)} bytes`);
  // The built AGENTS.md (the build reads the same sources) stays under the cap the kit already tests.
  const agents = build({ kit: path.resolve('.') }).get('project/AGENTS.md');
  assert.ok(agents.includes(section), 'the built AGENTS.md carries the section');
  assert.ok(Buffer.byteLength(agents) <= CAPS.agentsMd, `AGENTS.md ${Buffer.byteLength(agents)} <= ${CAPS.agentsMd}`);
});

// why: guards rule:security-standards
test('the security module source has one ASCII line naming git hooks and CI as the only layers outside Claude Code', () => {
  const security = read('rules/security.md');
  const lines = security.split('\n').filter((l) => l.includes('git hooks') && l.includes('CI') && l.includes('Claude Code'));
  assert.ok(lines.length >= 1, 'rules/security.md needs a line naming git hooks, CI and Claude Code');
  assert.ok(lines.some((l) => /\bonly\b/.test(l)), 'that line says they are the only layers');
  assert.ok(lines.every(isAscii), 'the line is ASCII only');
  assert.ok(Buffer.byteLength(security) <= CAPS.module, `security module ${Buffer.byteLength(security)} <= ${CAPS.module}`);
});
