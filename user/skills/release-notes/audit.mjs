#!/usr/bin/env node
// Release notes audit (rule:release-notes): the checks a script can see in public prose. It cannot tell whether a
// claim is true; each claim is still audited by hand to the file, test or measurement that proves it.
//
// Usage: node audit.mjs <notes.md> <version>   (run from the project folder, so package.json is found)
// Exit 0 = clean; 1 = faults, one per line.
import fs from 'node:fs';
import path from 'node:path';

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
each(/\b(AI|Claude|ChatGPT|GPT|LLM|Copilot|subagents?)\b/, 'AI or tool reference');
each(/\]\((?:\.\/)?(?:_[^)]*|docs\/(?:plans|sweeps|superpowers)\/[^)]*)\)/, 'link into gitignored notes');
each(/\b\d[\d,]* (?:tests?|mutants?|findings?)\b|\b(?:vitest|playwright|eslint|test suite|lint)\b/i, 'test or tooling tally (say what users get)');

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
