// Sizes a project's CI test shards from its test report. A jest or vitest --json report gives each
// file's seconds; a pytest --durations=0 listing gives each test's seconds, summed per file. One shard
// runs about 110 s, and more than 6 shards is refused, so a slow suite fails loudly instead of growing CI.
import fs from 'node:fs';

const SHARD_SECONDS = 110;
const MAX_SHARDS = 6;
const SLOWEST_SHOWN = 5;
const PYTEST_LINE = /^\s*(\d+(?:\.\d+)?)s\s+\S+\s+(\S+)/;

function usage(message) {
	process.stderr.write(`ci-plan: ${message}\n`);
	process.exit(2);
}

function parseArgs(argv) {
	const opts = { report: null, githubOutput: null };
	for (let i = 0; i < argv.length; i += 2) {
		const flag = argv[i];
		const value = argv[i + 1];
		if (value === undefined) usage(`${flag} needs a value`);
		if (flag === '--report') opts.report = value;
		else if (flag === '--github-output') opts.githubOutput = value;
		else usage(`unknown argument ${flag}`);
	}
	return opts;
}

// Seconds per file. Returns null when there is no report or it holds no timings: "not measured".
function readSeconds(file) {
	if (file === null || !fs.existsSync(file)) return null;
	const text = fs.readFileSync(file, 'utf8').trim();
	const perFile = new Map();
	const add = (name, seconds) => perFile.set(name, (perFile.get(name) ?? 0) + seconds);
	if (text.startsWith('{') || text.startsWith('[')) {
		let parsed;
		try {
			parsed = JSON.parse(text);
		} catch {
			usage(`${file} is not readable JSON`);
		}
		if (!Array.isArray(parsed?.testResults)) usage(`${file} has no testResults list`);
		for (const entry of parsed.testResults) {
			const seconds = (entry.endTime - entry.startTime) / 1000;
			if (!Number.isFinite(seconds)) usage(`${file} has an entry with no startTime or endTime`);
			add(entry.name, seconds);
		}
	} else {
		for (const line of text.split('\n')) {
			const match = PYTEST_LINE.exec(line);
			if (match) add(match[2].split('::')[0], Number(match[1]));
		}
	}
	return perFile.size === 0 ? null : perFile;
}

const shown = (seconds) => String(Math.round(seconds * 10) / 10);

function main() {
	const opts = parseArgs(process.argv.slice(2));
	const perFile = readSeconds(opts.report);
	const outputLines = [];
	if (perFile === null) {
		process.stdout.write('ci-plan: not measured, 1 shard\n');
		outputLines.push('total=0', 'shards={"shard":[1]}');
	} else {
		const total = [...perFile.values()].reduce((sum, s) => sum + s, 0);
		if (total > MAX_SHARDS * SHARD_SECONDS) {
			const slowest = [...perFile.entries()]
				.sort((a, b) => b[1] - a[1])
				.slice(0, SLOWEST_SHOWN)
				.map(([name, s]) => `${name} (${shown(s)} s)`)
				.join(', ');
			process.stderr.write(
				`ci-plan: ${shown(total)} s is over ${MAX_SHARDS} shards at ${SHARD_SECONDS} s; slowest: ${slowest}\n`,
			);
			process.exit(1);
		}
		const count = Math.min(MAX_SHARDS, Math.max(1, Math.ceil(total / SHARD_SECONDS)));
		const shards = Array.from({ length: count }, (_, i) => i + 1);
		outputLines.push(`total=${shown(total)}`, `shards={"shard":[${shards.join(',')}]}`);
	}
	const sink = opts.githubOutput || process.env.GITHUB_OUTPUT;
	if (sink) fs.appendFileSync(sink, outputLines.join('\n') + '\n');
	else process.stdout.write(outputLines.join('\n') + '\n');
}

main();
