#!/usr/bin/env node
/**
 * Generate Supabase Database types from supabase/schema_fresh.sql.
 * This is intentionally dependency-free (regex + simple parsers).
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SCHEMA = path.join(ROOT, 'supabase', 'schema_fresh.sql');
const OUT_WEB = path.join(ROOT, 'apps', 'web', 'src', 'lib', 'database.types.ts');
const OUT_EDGE = path.join(ROOT, 'supabase', 'functions', '_shared', 'database.types.ts');

function readFile(p) {
  return fs.readFileSync(p, 'utf8');
}

function writeFile(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
}

function extractCreateTableBlocks(sql) {
  const blocks = new Map();
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.([a-zA-Z0-9_]+)\s*\(/gi;
  for (let m; (m = re.exec(sql)); ) {
    const name = m[1].toLowerCase();
    let i = re.lastIndex - 1; // '('
    let depth = 0;
    for (; i < sql.length; i++) {
      const ch = sql[i];
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) {
          blocks.set(name, sql.slice(re.lastIndex, i)); // inside parens
          break;
        }
      }
    }
  }
  return blocks;
}

const CONSTRAINT_WORDS = new Set([
  'primary',
  'references',
  'not',
  'null',
  'default',
  'unique',
  'check',
  'constraint',
  'generated',
  'collate',
]);

function parseTypeAndNullable(rest) {
  const s = rest.replace(/--.*/g, '').trim().replace(/,$/, '');
  let i = 0;
  while (i < s.length && /\s/.test(s[i])) i++;
  let depth = 0;
  let type = '';
  while (i < s.length) {
    const ch = s[i];
    if (ch === '(') {
      depth++;
      type += ch;
      i++;
      continue;
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      type += ch;
      i++;
      continue;
    }
    if (depth === 0 && /\s/.test(ch)) {
      // lookahead word
      let j = i;
      while (j < s.length && /\s/.test(s[j])) j++;
      let k = j;
      while (k < s.length && /[a-zA-Z0-9_.]/.test(s[k])) k++;
      const word = s.slice(j, k).toLowerCase();
      if (!word || CONSTRAINT_WORDS.has(word)) break;
      type += ' ';
      i = j;
      continue;
    }
    type += ch;
    i++;
  }
  const nullable = !/\bnot\s+null\b/i.test(s);
  return { pgType: type.trim(), nullable };
}

function parseEnums(sql) {
  const enums = new Map();
  const re = /create\s+type\s+public\.([a-zA-Z0-9_]+)\s+as\s+enum\s*\(([\s\S]*?)\);/gi;
  for (let m; (m = re.exec(sql)); ) {
    const name = m[1].toLowerCase();
    const body = m[2];
    const vals = Array.from(body.matchAll(/'([^']+)'/g)).map((x) => x[1]);
    enums.set(name, vals);
  }
  return enums;
}

function pgToTs(pgType, enumNames) {
  let t = (pgType ?? '').trim().toLowerCase().replace(/"/g, '');
  let isArray = false;
  if (t.endsWith('[]')) {
    isArray = true;
    t = t.slice(0, -2).trim();
  }
  let base = 'unknown';
  if (t.startsWith('public.')) {
    const en = t.split('.', 2)[1];
    base = enumNames.has(en) ? `Database['public']['Enums']['${en}']` : 'unknown';
  } else if (t === 'uuid') base = 'string';
  else if (['text', 'varchar', 'character varying', 'character', 'char', 'citext'].includes(t)) base = 'string';
  else if (['int2', 'int4', 'int8', 'integer', 'bigint', 'smallint', 'serial', 'bigserial'].includes(t)) base = 'number';
  else if (t.startsWith('numeric') || t.startsWith('decimal') || ['real', 'double precision', 'float4', 'float8'].includes(t)) base = 'number';
  else if (['bool', 'boolean'].includes(t)) base = 'boolean';
  else if (['json', 'jsonb'].includes(t)) base = 'Json';
  else if (['timestamptz', 'timestamp with time zone', 'timestamp without time zone', 'timestamp', 'date', 'time'].includes(t)) base = 'string';
  else if (t.startsWith('geography') || t.startsWith('geometry')) base = 'string';
  return isArray ? `${base}[]` : base;
}

function parseTables(sql, createBlocks, enums) {
  const tables = new Map(); // table -> col -> {pgType, nullable}
  for (const [table, block] of createBlocks.entries()) {
    const cols = new Map();
    const lines = block.split('\n');
    for (const line0 of lines) {
      const line = line0.trim();
      if (!line || line.startsWith('--')) continue;
      if (/^(CONSTRAINT|PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK)\b/i.test(line)) continue;
      if (/^(generated|stored|always)\b/i.test(line)) continue;

      const m = /^"?(?<col>[a-zA-Z0-9_]+)"?\s+(?<rest>.+)$/.exec(line.replace(/,$/, ''));
      if (!m?.groups) continue;

      const col = m.groups.col.toLowerCase();
      const { pgType, nullable } = parseTypeAndNullable(m.groups.rest);
      cols.set(col, { pgType, nullable });
    }
    tables.set(table, cols);
  }

  // Apply ALTER TABLE ... ADD COLUMN ...
  const alter = /alter\s+table\s+public\.([a-zA-Z0-9_]+)\s+([\s\S]*?)\s*;/gi;
  for (let m; (m = alter.exec(sql)); ) {
    const table = m[1].toLowerCase();
    const body = m[2];
    const cols = tables.get(table) ?? new Map();
    const addRe = /add\s+column\s+(?:if\s+not\s+exists\s+)?/gi;
    for (let a; (a = addRe.exec(body)); ) {
      const sub = body.slice(addRe.lastIndex);
      // read until comma at top-level
      let depth = 0;
      let i = 0;
      for (; i < sub.length; i++) {
        const ch = sub[i];
        if (ch === '(') depth++;
        else if (ch === ')') depth = Math.max(0, depth - 1);
        else if (ch === ',' && depth === 0) break;
      }
      const clause = sub.slice(0, i).trim();
      const mm = /^"?(?<col>[a-zA-Z0-9_]+)"?\s+(?<rest>.+)$/.exec(clause);
      if (!mm?.groups) continue;
      const col = mm.groups.col.toLowerCase();
      const { pgType, nullable } = parseTypeAndNullable(mm.groups.rest);
      cols.set(col, { pgType, nullable });
      tables.set(table, cols);
    }
  }

  return tables;
}

function parseFunctions(sql) {
  const funcs = new Map();
  const re = /create\s+or\s+replace\s+function\s+public\.([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\)\s*returns\s+([^\n]+)/gi;
  for (let m; (m = re.exec(sql)); ) {
    const name = m[1].toLowerCase();
    const argsBlob = m[2];
    const returns = m[3].trim();

    const args = {};
    const parts = [];
    let cur = '';
    let depth = 0;
    for (const ch of argsBlob) {
      if (ch === '(') depth++;
      if (ch === ')') depth = Math.max(0, depth - 1);
      if (ch === ',' && depth === 0) {
        parts.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    if (cur.trim()) parts.push(cur.trim());

    for (const p0 of parts) {
      const p = p0.trim().replace(/^(in|out|inout)\s+/i, '');
      if (!p) continue;
      const mm = /^([a-zA-Z0-9_]+)\s+([\s\S]+)$/.exec(p);
      if (!mm) continue;
      const argName = mm[1];
      const rest = mm[2].split(/\bdefault\b/i)[0].trim();
      const { pgType } = parseTypeAndNullable(rest);
      args[argName] = pgType;
    }

    funcs.set(name, { args, returns });
  }
  return funcs;
}

function returnsToTs(returns, enumNames) {
  const r = returns.trim().toLowerCase();
  if (r.startsWith('table') || r.startsWith('setof') || r.startsWith('trigger')) return 'unknown';
  if (r.startsWith('void')) return 'undefined';
  if (r.startsWith('boolean') || r.startsWith('bool')) return 'boolean';
  const first = returns.trim().split(/\s+/)[0];
  return pgToTs(first, enumNames);
}

function buildTypes({ enums, tables, functions }) {
  const enumNames = new Set(enums.keys());

  const out = [];
  out.push('/* eslint-disable */');
  out.push('// Auto-generated from supabase/schema_fresh.sql. Do not edit by hand.');
  out.push('');
  out.push('export type Json =');
  out.push('  | string');
  out.push('  | number');
  out.push('  | boolean');
  out.push('  | null');
  out.push('  | { [key: string]: Json | undefined }');
  out.push('  | Json[];');
  out.push('');
  out.push('export type Database = {');
  out.push('  public: {');

  out.push('    Enums: {');
  for (const [name, vals] of Array.from(enums.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    const union = vals.length ? vals.map((v) => `'${v}'`).join(' | ') : 'string';
    out.push(`      ${name}: ${union};`);
  }
  out.push('    };');

  out.push('    Tables: {');
  for (const [tname, cols] of Array.from(tables.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    out.push(`      ${tname}: {`);
    out.push('        Row: {');
    for (const [cname, meta] of Array.from(cols.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      const ts = pgToTs(meta.pgType, enumNames);
      out.push(`          ${cname}: ${meta.nullable ? `${ts} | null` : ts};`);
    }
    out.push('        };');

    const writeInsertOrUpdate = (kind) => {
      out.push(`        ${kind}: {`);
      for (const [cname, meta] of Array.from(cols.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
        const ts = pgToTs(meta.pgType, enumNames);
        out.push(`          ${cname}?: ${meta.nullable ? `${ts} | null` : ts};`);
      }
      out.push('        };');
    };
    writeInsertOrUpdate('Insert');
    writeInsertOrUpdate('Update');

    out.push('        Relationships: [];');
    out.push('      };');
  }
  out.push('    };');

  out.push('    Functions: {');
  for (const [fname, f] of Array.from(functions.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    out.push(`      ${fname}: {`);
    out.push('        Args: {');
    for (const [aname, pgType] of Object.entries(f.args).sort((a, b) => a[0].localeCompare(b[0]))) {
      out.push(`          ${aname}: ${pgToTs(pgType, enumNames)};`);
    }
    out.push('        };');
    out.push(`        Returns: ${returnsToTs(f.returns, enumNames)};`);
    out.push('      };');
  }
  out.push('    };');

  out.push('    CompositeTypes: {};');
  out.push('    Views: {};');
  out.push('  };');
  out.push('};');
  out.push('');
  return out.join('\n');
}

function main() {
  if (!fs.existsSync(SCHEMA)) {
    console.error(`schema not found: ${SCHEMA}`);
    process.exit(1);
  }
  const sql = readFile(SCHEMA);
  const enums = parseEnums(sql);
  const createBlocks = extractCreateTableBlocks(sql);
  const tables = parseTables(sql, createBlocks, enums);
  const functions = parseFunctions(sql);

  const content = buildTypes({ enums, tables, functions });
  writeFile(OUT_WEB, content);
  writeFile(OUT_EDGE, content);
  console.log('✅ Generated database types:', OUT_WEB, OUT_EDGE);
}

main();
