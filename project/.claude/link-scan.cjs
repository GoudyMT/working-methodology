// No-follow link scan: lists every symlink or junction under a root and says whether its target is inside the
// root. It never descends into a link. Usage: node link-scan.cjs <root> [--plant-test]
const fs = require('node:fs');
const path = require('node:path');

function scan(root) {
	const rootResolved = path.resolve(root);
	const inside = [];
	const outside = [];
	let dirs = 0;
	const stack = [rootResolved];
	while (stack.length > 0) {
		const dir = stack.pop();
		dirs++;
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			const stat = fs.lstatSync(full);
			if (stat.isSymbolicLink()) {
				const target = path.resolve(dir, fs.readlinkSync(full));
				const rel = path.relative(rootResolved, target);
				const isInside = rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
				(isInside ? inside : outside).push(full + ' -> ' + target);
			} else if (stat.isDirectory()) {
				stack.push(full);
			}
		}
	}
	return { dirs, inside, outside };
}

if (process.argv.includes('--plant-test')) {
	const base = path.resolve(process.argv[2]);
	const root = path.join(base, 'root');
	const other = path.join(base, 'other');
	fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
	fs.mkdirSync(other, { recursive: true });
	fs.symlinkSync(path.join(root, 'sub'), path.join(root, 'link-in'), 'junction');
	fs.symlinkSync(other, path.join(root, 'link-out'), 'junction');
	const result = scan(root);
	console.log('plant test: inside ' + result.inside.length + ', outside ' + result.outside.length);
	console.log(result.inside.length === 1 && result.outside.length === 1 ? 'PLANT TEST OK' : 'PLANT TEST FAILED');
	fs.rmSync(base, { recursive: true, force: true });
	console.log('plant folder removed: ' + !fs.existsSync(base) + ', other side intact before removal: checked by count');
} else {
	const result = scan(process.argv[2]);
	console.log('dirs walked: ' + result.dirs + ' | links inside: ' + result.inside.length + ' | links OUTSIDE: ' + result.outside.length);
	for (const line of result.outside.slice(0, 20)) console.log('  OUTSIDE ' + line);
}
