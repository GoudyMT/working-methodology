// Mutation proofs for loop work: run from the project root.
// Usage: node .claude/mutate.cjs <spec.json>
// spec: { "cmd": "<test command>", "mutations": [{ "name", "file", "from", "to", "cmd"? }] }
// Each mutation must match its file EXACTLY ONCE; the file is restored byte-for-byte afterwards.
// The commands come only from the spec file the lead writes; nothing outside reaches the shell.
const fs = require('node:fs');
const { execSync } = require('node:child_process');

const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let failures = 0;
for (const m of spec.mutations) {
	const original = fs.readFileSync(m.file, 'utf8');
	const count = original.split(m.from).length - 1;
	if (count !== 1) {
		console.log(`REFUSED ${m.name}: target occurs ${count} times in ${m.file}`);
		failures++;
		continue;
	}
	fs.writeFileSync(m.file, original.replace(m.from, () => m.to));
	let out = '';
	let red = false;
	try {
		out = execSync(m.cmd ?? spec.cmd, { encoding: 'utf8', stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 });
	} catch (e) {
		red = true;
		out = `${e.stdout ?? ''}\n${e.stderr ?? ''}`;
	} finally {
		fs.writeFileSync(m.file, original);
	}
	const restored = fs.readFileSync(m.file, 'utf8') === original;
	const why = out
		.split('\n')
		.filter((l) => /AssertionError|Expected|Received|expected .* to |FAIL |Error:|Tests\s+\d/.test(l))
		.slice(0, 12)
		.map((l) => `    ${l.trim()}`)
		.join('\n');
	console.log(`${red ? 'RED  ' : 'GREEN'} ${m.name} (restored: ${restored})\n${why}\n`);
	if (!red || !restored) failures++;
}
process.exit(failures ? 1 : 0);
