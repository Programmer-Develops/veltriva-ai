const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { PGlite } = require('@electric-sql/pglite');

let dbEngine = null;
let engineType = 'PGLITE_POSTGRES_16';
let isInitialized = false;

/**
 * Initializes the PostgreSQL 16 Database Engine.
 * Uses external PostgreSQL if DATABASE_URL is set, otherwise runs real
 * PostgreSQL 16 natively via PGlite with full PL/pgSQL, Triggers & ACID support.
 */
async function initDatabase() {
  if (isInitialized && dbEngine) return dbEngine;

  if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim() !== '') {
    engineType = 'EXTERNAL_POSTGRESQL_POOL';
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
    });
    dbEngine = {
      type: engineType,
      query: async (text, params = []) => pool.query(text, params),
      exec: async (sqlText) => pool.query(sqlText)
    };
  } else {
    engineType = 'PGLITE_POSTGRES_16_WASM';
    const pglite = await PGlite.create();
    dbEngine = {
      type: engineType,
      raw: pglite,
      query: async (text, params = []) => pglite.query(text, params),
      exec: async (sqlText) => pglite.exec(sqlText)
    };
  }

  // Load and execute DDL Schema, PL/pgSQL Stored Procedures, Triggers & Seed Data
  const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
  const procPath = path.join(__dirname, '..', 'database', 'procedures_triggers.sql');
  const seedPath = path.join(__dirname, '..', 'database', 'seed.sql');

  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  const procSql = fs.readFileSync(procPath, 'utf8');
  const seedSql = fs.readFileSync(seedPath, 'utf8');

  await dbEngine.exec(schemaSql);
  await dbEngine.exec(procSql);

  // Check if already seeded
  const countRes = await dbEngine.query('SELECT COUNT(*)::INT AS cnt FROM employees');
  if (!countRes.rows[0] || countRes.rows[0].cnt === 0) {
    await dbEngine.exec(seedSql);
  }

  isInitialized = true;
  console.log(`[Veltriva DBMS] Initialized ${engineType} with 11 BCNF tables, PL/pgSQL Stored Procedures & Triggers.`);
  return dbEngine;
}

async function query(text, params = []) {
  const db = await initDatabase();
  return db.query(text, params);
}

async function exec(sqlText) {
  const db = await initDatabase();
  return db.exec(sqlText);
}

function getEngineInfo() {
  return {
    engine: engineType,
    postgresVersion: 'PostgreSQL 16.4 (ACID + PL/pgSQL + BCNF)',
    features: [
      '3NF / BCNF Normalized Relational Schema (11 Tables)',
      'PL/pgSQL Stored Functions & Procedures (Progressive Tax & Monthly Payroll)',
      'Automated Triggers (Attendance Metrics, Double-Entry Ledger, JSONB Audit Trail)',
      'Pessimistic Row Locking (SELECT ... FOR UPDATE) & Savepoint Rollbacks',
      'Window Functions (RANK OVER PARTITION BY) & Materialized Analytics Views',
      'B-Tree Composite Indexing & EXPLAIN ANALYZE Query Planner'
    ]
  };
}

module.exports = {
  initDatabase,
  query,
  exec,
  getEngineInfo
};
