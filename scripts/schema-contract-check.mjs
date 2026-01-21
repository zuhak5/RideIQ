#!/usr/bin/env node
/**
 * Quick schema ↔ code contract check:
 * - Verifies all .from('table') references exist in schema
 * - Verifies all .rpc('fn') references exist in schema
 * - Verifies all .functions.invoke('edgeFn') have a folder in supabase/functions
 *
 * This is intentionally conservative and regex-based (no TS AST).
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SCHEMA = path.join(ROOT, 'supabase', 'schema_fresh.sql');
const CODE_ROOTS = [
  path.join(ROOT, 'apps'),
  path.join(ROOT, 'supabase', 'functions'),
];

function readFile(p) {
  return fs.readFileSync(p, 'utf8');
}

function walk(dir, exts) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((e) => ent.name.endsWith(e))) out.push(p);
  }
  return out;
}

function parseSchema(sql) {
  const tables = new Set();
  const funcs = new Set();

  for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.([a-zA-Z0-9_]+)/gi)) {
    tables.add(m[1].toLowerCase());
  }
  for (const m of sql.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-zA-Z0-9_]+)\s*\(/gi)) {
    funcs.add(m[1].toLowerCase());
  }
  return { tables, funcs };
}

function scanCode() {
  const from = [];
  const rpc = [];
  const invoke = [];

  const fileList = [];
  for (const root of CODE_ROOTS) {
    if (fs.existsSync(root)) fileList.push(...walk(root, ['.ts', '.tsx', '.js', '.jsx', '.mjs']));
  }

  const fromRe = /\.from\(\s*['"]([^'"]+)['"]\s*\)/g;
  const rpcRe = /\.rpc\(\s*['"]([^'"]+)['"]/g;
  const invRe = /\.functions\.invoke\(\s*['"]([^'"]+)['"]/g;

  for (const file of fileList) {
    const src = readFile(file);

    for (const m of src.matchAll(fromRe)) from.push({ name: m[1], file });
    for (const m of src.matchAll(rpcRe)) rpc.push({ name: m[1], file });
    for (const m of src.matchAll(invRe)) invoke.push({ name: m[1], file });
  }
  return { from, rpc, invoke };
}

function main() {
  const sql = readFile(SCHEMA);
  const schema = parseSchema(sql);
  const code = scanCode();

  const errors = [];

  for (const r of code.from) {
    if (!schema.tables.has(r.name.toLowerCase())) {
      errors.push(`Missing table "${r.name}" referenced in ${path.relative(ROOT, r.file)}`);
    }
  }
  for (const r of code.rpc) {
    if (!schema.funcs.has(r.name.toLowerCase())) {
      errors.push(`Missing function "${r.name}" referenced in ${path.relative(ROOT, r.file)}`);
    }
  }

  // Edge functions: folder name under supabase/functions
  const fnRoot = path.join(ROOT, 'supabase', 'functions');
  const fnDirs = fs.existsSync(fnRoot)
    ? new Set(fs.readdirSync(fnRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name))
    : new Set();

  for (const r of code.invoke) {
    if (!fnDirs.has(r.name)) {
      errors.push(`Missing edge function folder "${r.name}" referenced in ${path.relative(ROOT, r.file)}`);
    }
  }

  if (errors.length) {
    console.error('❌ Schema contract check failed:\n');
    for (const e of errors) console.error(' - ' + e);
    process.exit(1);
  }

  console.log('✅ Schema contract check passed.');
}

main();
