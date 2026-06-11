#!/usr/bin/env node
/**
 * Generate TypeScript declarations from bindings/bindings.h
 *
 * Usage: node scripts/generate-types.ts > bindings/bindings.d.ts
 */

import process from 'node:process'

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const headerPath = join(__dirname, '..', 'bindings', 'bindings.h')
const header = readFileSync(headerPath, 'utf-8')

// Parse the flat bridge declarations. Pointer return values are WASM addresses.
const funcRegex = /^(int|void|float\*)\s+(sa_\w+)\s*\(([^)]*)\);/gm

// Map C types to TS types for parameters
const cTypeToTs = (type: string) => {
  type = type.trim()
  // remove const
  type = type.replace(/^const\s+/, '')
  // pointers
  if (type.includes('**'))
    return 'number' // double pointer (out params)
  if (type.includes('*')) {
    if (type === 'float*' || type === 'int*')
      return 'number' // WASM heap pointer
    if (type === 'void**')
      return 'number'
    if (type === 'char*')
      return 'string'
    return 'number'
  }
  if (type === 'int' || type === 'float')
    return 'number'
  if (type === 'void')
    return 'void'
  return 'number'
}

// Extract parameter name and type
const parseParams = (sig: string) => {
  if (!sig.trim())
    return []
  return sig.split(',').map((p) => {
    p = p.trim()
    // match "const float* name" or "int name" etc.
    // eslint-disable-next-line sonarjs/slow-regex, regexp/no-super-linear-backtracking
    const m = /^(.*?)\s+(\w+)$/.exec(p)
    if (!m)
      return null
    const [, type, name] = m
    return { cType: type.trim(), name, tsType: cTypeToTs(type) }
  }).filter(Boolean)
}

const functions = []
let m
// eslint-disable-next-line no-cond-assign
while ((m = funcRegex.exec(header)) !== null) {
  const [, retType, name, params] = m
  functions.push({ name, params: parseParams(params), retType })
}

// Generate d.ts
let output = `// Auto-generated from bindings/bindings.h
// Do not edit manually. Run: node scripts/generate-types.ts

export interface SteamAudioBindings extends EmscriptenModule {
  HEAPF32: Float32Array;
  HEAP32: Int32Array;
  HEAPU32: Uint32Array;
  HEAPU8: Uint8Array;
  _malloc(size: number): number;
  _free(pointer: number): void;
`

for (const fn of functions) {
  const args = fn.params.map(p => `${p!.name}: ${p!.tsType}`).join(', ')
  const ret = fn.retType === 'void' ? 'void' : 'number'
  output += `  _${fn.name}(${args}): ${ret};\n`
}

output += `}

// The default export is an async factory function.
declare function createSteamAudioModule(moduleArg?: Partial<EmscriptenModule>): Promise<SteamAudioBindings>;
export default createSteamAudioModule;
`

const outPath = process.argv[2]
if (outPath) {
  writeFileSync(outPath, output)
}
else {
  console.log(output)
}
