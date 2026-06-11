#!/usr/bin/env node
/**
 * Generate TypeScript declarations from bindings/bindings.h
 *
 * Usage: node scripts/generate-types.js > bindings/bindings.d.ts
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const headerPath = join(__dirname, '..', 'bindings', 'bindings.h');
const header = readFileSync(headerPath, 'utf-8');

// Parse C function declarations: int|void sa_xxx(...);
const funcRegex = /^(int|void)\s+(sa_\w+)\s*\(([^)]*)\);/gm;

// Map C types to TS types for parameters
function cTypeToTs(type) {
  type = type.trim();
  // remove const
  type = type.replace(/^const\s+/, '');
  // pointers
  if (type.includes('**')) return 'number'; // double pointer (out params)
  if (type.includes('*')) {
    if (type === 'float*' || type === 'int*') return 'number'; // WASM heap pointer
    if (type === 'void**') return 'number';
    if (type === 'char*') return 'string';
    return 'number';
  }
  if (type === 'int' || type === 'float') return 'number';
  if (type === 'void') return 'void';
  return 'number';
}

// Extract parameter name and type
function parseParams(sig) {
  if (!sig.trim()) return [];
  return sig.split(',').map(p => {
    p = p.trim();
    // match "const float* name" or "int name" etc.
    const m = p.match(/^(.*?)\s+(\w+)$/);
    if (!m) return null;
    let [, type, name] = m;
    return { name, tsType: cTypeToTs(type), cType: type.trim() };
  }).filter(Boolean);
}

const functions = [];
let m;
while ((m = funcRegex.exec(header)) !== null) {
  const [, retType, name, params] = m;
  functions.push({ retType, name, params: parseParams(params) });
}

// Generate d.ts
let output = `// Auto-generated from bindings/bindings.h
// Do not edit manually. Run: node scripts/generate-types.js

export interface SteamAudioBindings extends EmscriptenModule {
`;

for (const fn of functions) {
  const args = fn.params.map(p => `${p.name}: ${p.tsType}`).join(', ');
  const ret = fn.retType === 'void' ? 'void' : 'number';
  output += `  _${fn.name}(${args}): ${ret};\n`;
}

output += `}

// The default export is an async factory function.
declare function createSteamAudioModule(moduleArg?: Partial<EmscriptenModule>): Promise<SteamAudioBindings>;
export default createSteamAudioModule;
`;

import { writeFileSync } from 'fs';

const outPath = process.argv[2];
if (outPath) {
  writeFileSync(outPath, output);
} else {
  console.log(output);
}
