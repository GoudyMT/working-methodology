// K294 (build U13): the kit says plainly which guards hold which agents. Only git hooks and CI hold an agent or tool
// outside Claude Code; the .claude guards and hooks run only inside it. These tests read the built files that the
// build writes from the rule sources, so what a project installs is what gets checked.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build } from '../scripts/kit.mjs';

const CAPS = JSON.parse(fs.readFileSync(path.resolve('kit.config.json'), 'utf8')).caps;
const isAscii = (text) => /^[\x00-\x7F]*$/.test(text);
const BUILT = build({ kit: path.resolve('.') });

// The section headed "What holds where" in the built AGENTS.md: from its heading to the next "## " heading or the end.
function whatHoldsSection(agents) {
  const start = /^## What holds where[^\n]*$/m.exec(agents);
  if (!start) return '';
  const rest = agents.slice(start.index + start[0].length);
  const next = /^## /m.exec(rest);
  return (start[0] + (next ? rest.slice(0, next.index) : rest)).trimEnd();
}

// why: guards rule:what-holds-where (AGENTS.md never says hooks and CI are the only outside layers)
test('the built AGENTS.md has a What holds where section that says what holds each agent, ASCII, inside the cap', () => {
  const agents = BUILT.get('project/AGENTS.md');
  const section = whatHoldsSection(agents);
  assert.ok(section, 'the built AGENTS.md needs a "## What holds where" section');
  // Sentences split on the end marks, so one sentence must carry the .claude guards and the other the git hooks and CI.
  const sentences = section.split(/(?<=[.!?])\s+/);
  const claudeSentence = sentences.some((s) => s.includes('.claude') && s.includes('Claude Code') && /\bonly\b/.test(s));
  const gitSentence = sentences.some((s) => s.includes('git hooks') && /\bCI\b/.test(s) && /\bonly\b/.test(s));
  assert.ok(claudeSentence, 'one sentence names .claude, Claude Code and only');
  assert.ok(gitSentence, 'one sentence names git hooks, CI and only');
  assert.match(section, /\bCI\b/, 'the section names CI');
  assert.ok(isAscii(section), 'the section is ASCII only');
  assert.ok(isAscii(agents), 'the built AGENTS.md is ASCII only');
  assert.ok(Buffer.byteLength(agents) <= CAPS.agentsMd, `AGENTS.md ${Buffer.byteLength(agents)} <= ${CAPS.agentsMd}`);
});

// why: guards rule:security-standards
test('the built security standards carry one ASCII line naming git hooks and CI as the only layers outside Claude Code', () => {
  const security = BUILT.get('project/standards/security.md');
  assert.ok(security, 'the build writes project/standards/security.md');
  const lines = security.split('\n').filter((l) => l.includes('git hooks') && l.includes('CI') && l.includes('Claude Code'));
  assert.ok(lines.length >= 1, 'the built security standards need a line naming git hooks, CI and Claude Code');
  assert.ok(lines.some((l) => /\bonly\b/.test(l)), 'that line says they are the only layers');
  assert.ok(isAscii(security), 'the built security standards are ASCII only');
  assert.ok(Buffer.byteLength(security) <= CAPS.module, `security standards ${Buffer.byteLength(security)} <= ${CAPS.module}`);
});
