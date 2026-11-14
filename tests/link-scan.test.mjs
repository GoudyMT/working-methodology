// The link scan is a CI gate (the "Link scan" step fails on any link that leaves the repo) and a closeout check. J8
// (every gate can fail): it had no test, so a scan that stopped seeing links would have passed for ever.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const SCAN = path.resolve('project/.claude/link-scan.cjs');

// why: guards rule:security-standards
test('the link scan counts a link that leaves the folder and one that stays, and never walks through either', { windows: 'also' }, () => {
	const base = kitTemp.makeTemp('links-');
	const root = path.join(base, 'root');
	const other = path.join(base, 'other');
	fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
	fs.mkdirSync(path.join(other, 'deep'), { recursive: true });
	const scan = () => spawnSync(process.execPath, [SCAN, root], { encoding: 'utf8' }).stdout;
	assert.match(scan(), /dirs walked: 2 \| links inside: 0 \| links OUTSIDE: 0$/m);
	fs.symlinkSync(path.join(root, 'sub'), path.join(root, 'link-in'), 'junction');
	fs.symlinkSync(other, path.join(root, 'link-out'), 'junction');
	const out = scan();
	// Two folders walked still: the scan went into neither link.
	assert.match(out, /dirs walked: 2 \| links inside: 1 \| links OUTSIDE: 1$/m);
	assert.match(out, /OUTSIDE .*link-out -> /);
});
