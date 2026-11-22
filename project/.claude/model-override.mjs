// K341 (build 24): a project may override a step's model in .kit/models.json. An override is refused when it names a
// model below the step's floor, or changes a never-drop step. The kit's install runs the same rule before it writes
// anything (scripts/kit.mjs), and this installed copy is what the project's CI runs: node .claude/model-override.mjs check
// Exit 0: clean, or no .kit/models.json. 1: a step breaks its floor or never-drop row (each named). 2: the override
// or model-floors.json cannot be read or is the wrong shape (named). The floors come from model-floors.json, which install
// writes beside this file from the kit's step table.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// The rank of a model family: opus 3, sonnet 2, haiku 1; anything else 0 (as user/kit-tools/model-table.mjs).
function rank(model) {
  const m = String(model ?? '').toLowerCase();
  if (m.includes('opus')) return 3;
  if (m.includes('sonnet')) return 2;
  if (m.includes('haiku')) return 1;
  return 0;
}

// The generation of a model id: the numbers after its family, e.g. claude-opus-5-4 -> [5, 4].
function generation(model) {
  const m = /-(\d+(?:-\d+)*)$/.exec(String(model ?? '').toLowerCase());
  return m ? m[1].split('-').map(Number) : [];
}

// A model meets a floor when its family ranks higher, or its family is the same and its generation is at least as high.
function meetsFloor(model, floor) {
  if (rank(floor) === 0) return false;
  if (rank(model) !== rank(floor)) return rank(model) > rank(floor);
  const a = generation(model);
  const b = generation(floor);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// The steps of an override file, or a throw naming models.json when the text is not { "steps": { "<step>": { "model": "<id>" } } }.
function parseOverride(text) {
  const bad = (why) => new Error(`models.json is not usable: ${why}. Its shape is {"steps":{"<step>":{"model":"<id>"}}}.`);
  let data;
  try {
    data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (e) {
    throw bad(`it does not parse (${e.message})`);
  }
  if (!isObject(data) || !isObject(data.steps)) throw bad('it needs a steps object');
  for (const [name, row] of Object.entries(data.steps)) {
    if (!isObject(row) || typeof row.model !== 'string' || !row.model.trim()) throw bad(`step ${name} needs a model string`);
  }
  return data.steps;
}

// The floors file install wrote: { "steps": { "<step>": { model, floor?, neverDrop? } } }, read only when an override exists.
function readFloors() {
  const file = path.join(HERE, 'model-floors.json');
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`model-floors.json cannot be read: ${e.message}. Run install project again.`);
  }
  if (!isObject(data) || !isObject(data.steps)) throw new Error('model-floors.json is not usable: it needs a steps object. Run install project again.');
  return data.steps;
}

// One fault per step: a never-drop step may not change model, and a floored step may not drop below its floor.
function overrideFaults(steps, floors) {
  const faults = [];
  for (const [name, row] of Object.entries(steps)) {
    const f = Object.hasOwn(floors, name) ? floors[name] : null;
    if (!f) continue;
    if (f.neverDrop === true && row.model !== f.model) faults.push(`step ${name} is never-drop (${f.model}): an override to ${row.model} is refused`);
    if (f.floor !== undefined && !meetsFloor(row.model, f.floor)) faults.push(`step ${name}: model ${row.model} is below its floor ${f.floor}`);
  }
  return faults;
}

// The check: exit 0 clean or no override file, 1 with each fault on stderr, 2 when a file cannot be read or is the wrong shape.
function main(argv) {
  if (argv.length !== 1 || argv[0] !== 'check') {
    console.error('Usage: node .claude/model-override.mjs check');
    return 2;
  }
  const projectDir = path.resolve(HERE, '..');
  const file = path.join(projectDir, '.kit', 'models.json');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.log('model override: no .kit/models.json, nothing to check');
      return 0;
    }
    console.error(`models.json cannot be read: ${e.message}`);
    return 2;
  }
  let steps;
  let floors;
  try {
    steps = parseOverride(text);
    floors = readFloors();
  } catch (e) {
    console.error(e.message);
    return 2;
  }
  const faults = overrideFaults(steps, floors);
  if (faults.length) {
    for (const f of faults) console.error(f);
    return 1;
  }
  console.log(`model override ok: ${Object.keys(steps).length} step(s) checked`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
