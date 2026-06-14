// One-shot repair for the migration-22 checksum error (line-ending drift).
// 1. Rewrites any CRLF migration file to LF (the canonical git-blob form).
// 2. Updates _sqlx_migrations rows whose stored checksum matches the CRLF
//    variant of a file to the LF hash, so the DB agrees with the LF files.
// Run with the app CLOSED: node scripts/fix-migration-eol.cjs
const { DatabaseSync } = require('node:sqlite');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const sha384 = (s) => createHash('sha384').update(s).digest();

const dir = path.join(__dirname, '..', 'src-tauri', 'migrations');
const dbPath = path.join(process.env.APPDATA, 'com.myfinance.app', 'myfinance.db');
const db = new DatabaseSync(dbPath);
const stored = new Map(
  db.prepare('SELECT version, hex(checksum) AS cs FROM _sqlx_migrations').all().map((r) => [r.version, r.cs])
);
const upd = db.prepare('UPDATE _sqlx_migrations SET checksum = ? WHERE version = ?');

for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
  const v = parseInt(f.slice(0, 4), 10);
  const p = path.join(dir, f);
  const raw = fs.readFileSync(p, 'utf8');
  const lf = raw.replace(/\r\n/g, '\n');
  if (raw !== lf) {
    fs.writeFileSync(p, lf);
    console.log(v, 'file: CRLF -> LF');
  }
  const cs = stored.get(v);
  if (!cs) continue;
  const lfHash = sha384(lf);
  if (cs === lfHash.toString('hex').toUpperCase()) continue; // already consistent
  if (cs === sha384(lf.replace(/\n/g, '\r\n')).toString('hex').toUpperCase()) {
    upd.run(lfHash, v);
    console.log(v, 'db checksum: CRLF hash -> LF hash');
  } else {
    console.log(v, 'WARNING: stored checksum matches neither LF nor CRLF form — content truly differs, NOT touched');
  }
}
console.log('done');
