#!/usr/bin/env node
// Release notes audit (rule:release-notes): the checks a script can see in public prose. It cannot tell whether a
// claim is true; each claim is still audited by hand to the file, test or measurement that proves it.
//
// Usage: node audit.mjs <notes.md> <version>   (run from the project folder, so package.json is found)
// Exit 0 = clean; 1 = faults, one per line.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [file, version] = process.argv.slice(2);
if (!file || !version) {
  console.log('Usage: node audit.mjs <notes.md> <version>');
  process.exit(2);
}
const text = fs.readFileSync(file, 'utf8');
const faults = [];
const lines = text.split('\n');
const each = (re, what) => lines.forEach((l, i) => { if (re.test(l)) faults.push(`line ${i + 1}: ${what}`); });

each(/[^\x00-\x7F]/, 'non-ASCII character (public prose is ASCII)');
each(/(^|[^-])--([^-]|$)/, 'double hyphen (public prose is dash-free)');
// How the release was made is never public prose: tool names, agent words, and "written by AI" phrasing. A product
// feature that uses AI ("answers with your own AI key") is a claim about the product, so bare "AI" is not flagged.
each(/\b(Claude|ChatGPT|GPT-?\d*|Copilot|subagents?|coding agents?|AI agents?|assistant model|language model)\b/i, 'AI or tool reference');
each(/\b(written|generated|built|reviewed|drafted|made|coded) (by|with) (an? )?(AI|LLM|model|agent)/i, 'AI or tool reference (how it was made)');
each(/\]\((?:\.\.?\/)*(?:_|docs\/(?:plans|sweeps|superpowers)\/)[^)]*\)/, 'link into gitignored notes');
each(/\b\d[\d,]* (?:tests?|mutants?|findings?)\b|\b(?:fixed|closed|resolved) \d[\d,]* (?:bugs?|issues?|defects?)\b|\b(?:vitest|playwright|eslint|test suite|lint)\b/i, 'test or tooling tally (say what users get)');

// The agents' confirmation phrase never goes out (rule:agent-canary). It is read from the project's main checkout,
// from the file the rule index names for rule:agent-team-adapter, the way the project's own
// .claude/canary-phrase.mjs reads it; this skill is user level, so it keeps its own copy.
const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' });
if (common.status === 0) {
  const root = path.dirname(common.stdout.trim());
  const words = (s) => ` ${String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
  const index = path.join(root, 'standards', 'INDEX.md');
  const row = fs.existsSync(index) && fs.readFileSync(index, 'utf8').match(/^\|\s*agent-team-adapter\s*\|[^|\n]*\|\s*`([^`]+)`/m);
  const p = path.join(root, row ? row[1] : 'standards/agent-teams.md');
  const m = fs.existsSync(p) && fs.readFileSync(p, 'utf8').match(/^\s*Confirmation phrase: .* with: (.+?)\s*$/m);
  if (m && words(text).includes(words(m[1]))) faults.push('the agents\' confirmation phrase appears; it never goes in public text');
}

const pkg = path.join(process.cwd(), 'package.json');
if (fs.existsSync(pkg)) {
  const want = JSON.parse(fs.readFileSync(pkg, 'utf8')).version;
  if (want && want !== version.replace(/^v/, '')) faults.push(`version: package.json says ${want}, the release says ${version}`);
}

if (faults.length) {
  console.log(faults.join('\n'));
  process.exit(1);
}
console.log('Release notes audit: clean');
