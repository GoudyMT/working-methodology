import { execFileSync } from 'node:child_process';

// Added lines of the branch, every file, with the file each belongs to. Values are never printed.
const diff = execFileSync('git', ['diff', 'origin/main..HEAD', '-U0', '--no-color'], {
	encoding: 'utf8',
	maxBuffer: 64 * 1024 * 1024
});
const RULES = [
	['cloudflare-account-id (repo rule)', /account_?id["']?\s*[:=]\s*["']?[0-9a-f]{32}["']?/i],
	['anthropic key', /sk-ant-[A-Za-z0-9_-]{20,}/],
	['openai-style key', /\bsk-[A-Za-z0-9]{32,}/],
	['github token', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
	['aws access key', /\bAKIA[0-9A-Z]{16}\b/],
	['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
	['assigned secret', /(api[_-]?key|secret|token|password|bearer)["']?\s*[:=]\s*["'][^"'\s]{16,}["']/i],
	['bare 32+ hex', /\b[0-9a-f]{32,}\b/i],
	['cloudflare api token shape', /\b[A-Za-z0-9_-]{40}\b(?=.*(cloudflare|cf_|CF_|api))/]
];
let file = '';
let added = 0;
const hits = [];
for (const line of diff.split('\n')) {
	if (line.startsWith('+++ b/')) file = line.slice(6);
	else if (line.startsWith('+') && !line.startsWith('+++')) {
		added++;
		for (const [name, re] of RULES) if (re.test(line)) hits.push(`${name} in ${file}`);
	}
}
console.log(`added lines scanned: ${added}`);
const counts = new Map();
for (const h of hits) counts.set(h, (counts.get(h) ?? 0) + 1);
for (const [h, n] of counts) console.log(`  ${n} x ${h}`);
console.log(hits.length === 0 ? 'NO SECRET SHAPES' : `${hits.length} hit(s) to inspect`);
