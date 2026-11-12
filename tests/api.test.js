process.env.DATABASE_URL = ''; // Run unit tests in isolated in-memory PGlite 16 instance
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const paypalService = require('../src/services/paypalService');
const aiMlService = require('../src/services/aiMlService');

test('1. PostgreSQL 16 BCNF Schema, Views & Seed Data Initialization', async () => {
  await db.initDatabase();
  const empRes = await db.query('SELECT * FROM vw_employee_360_payroll ORDER BY emp_id');
  assert.equal(empRes.rows.length, 10, 'Should have 10 global employees seeded');
  assert.ok(Number(empRes.rows[0].net_pay_usd) > 0, 'Stored function should have calculated positive net pay');
});

test('2. PL/pgSQL Trigger trg_attendance_auto_metrics & Stored Function Recalculation', async () => {
  await db.query(
    `INSERT INTO attendance_logs (emp_id, work_date, check_in_time, check_out_time, status, notes)
     VALUES (4, '2026-11-11', '09:40:00', '20:40:00', 'PRESENT', 'Unit Test Late + Overtime')
     ON CONFLICT (emp_id, work_date) DO UPDATE SET check_in_time = '09:40:00', check_out_time = '20:40:00'`
  );

  const checkLog = await db.query(
    `SELECT hours_worked, overtime_hours, is_late FROM attendance_logs WHERE emp_id = 4 AND work_date = '2026-11-11'`
  );
  assert.equal(checkLog.rows[0].is_late, true, 'Trigger should mark check_in > 09:15 as is_late = TRUE');
  assert.equal(Number(checkLog.rows[0].hours_worked), 11, 'Trigger should compute 11.0 hours worked');
  assert.equal(Number(checkLog.rows[0].overtime_hours), 3, 'Trigger should compute 3.0 hours overtime');
});

test('3. Double-Entry ACID Ledger Trial Balance Reconciliation (Debits == Credits)', async () => {
  const tbRes = await db.query('SELECT * FROM vw_double_entry_trial_balance');
  const totalDebit = tbRes.rows.reduce((s, r) => s + Number(r.total_debit_usd), 0);
  const totalCredit = tbRes.rows.reduce((s, r) => s + Number(r.total_credit_usd), 0);
  assert.ok(totalDebit > 0, 'Trial balance should have positive debits');
  assert.equal(totalDebit.toFixed(2), totalCredit.toFixed(2), 'Double-entry ledger must strictly balance Debits == Credits');
});

test('4. PayPal Payouts v1 APIMatic Schema Validator & Batch Settlement', async () => {
  const sampleItems = [
    { payroll_id: 99, emp_id: 4, emp_code: 'VLT-104', paypal_email: 'aarav.mehta.sb@paypal.com', net_pay_usd: 7420.5 }
  ];
  const payout = await paypalService.executeBatchPayout(sampleItems, 'Automated Test Batch');
  assert.equal(payout.apimaticValidation.valid, true, 'Payload must pass APIMatic OpenAPI 3.1 validation');
  assert.equal(payout.itemsProcessed.length, 1);
  assert.ok(Boolean(payout.batchId), 'Should return a PayPal batch/order ID');
});

test('5. Workforce Machine Learning Pipeline (Logistic Attrition, Linear Burn, k-Means)', async () => {
  const empRes = await db.query('SELECT * FROM vw_employee_360_payroll WHERE org_id = 1');
  const deptRes = await db.query('SELECT * FROM vw_department_burn_analytics WHERE org_id = 1');
  const ml = aiMlService.runWorkforceMlPipeline(empRes.rows, deptRes.rows);
  assert.equal(ml.predictions.length, 10);
  assert.ok(ml.modelMetadata.supervisedClassification.f1Score > 0.9);
  assert.ok(ml.modelMetadata.unsupervisedClustering.silhouetteScore > 0.7);
});

test('6. Multi-Tenant Organization Isolation (Blank Custom Company Workspace)', async () => {
  const orgRes = await db.query(
    `INSERT INTO organizations (org_code, org_name, owner_name, owner_email, password_hash, is_demo_workspace)
     VALUES ('ORG-ACME', 'Acme FinTech Inc.', 'Jane Founder', 'jane@acme.io', 'hash', FALSE)
     RETURNING org_id, org_name, is_demo_workspace`
  );
  const newOrgId = orgRes.rows[0].org_id;
  const customEmpRes = await db.query('SELECT * FROM vw_employee_360_payroll WHERE org_id = $1', [newOrgId]);
  assert.equal(customEmpRes.rows.length, 0, 'Newly created company organization must start with 0 sample employees');
});
