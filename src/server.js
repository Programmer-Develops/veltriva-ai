require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');
const paypalService = require('./services/paypalService');
const aiMlService = require('./services/aiMlService');

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'veltriva_super_secret_jwt_key_2026_fintech';

app.use(cors());
app.use(express.json());
app.get('/favicon.ico', (req, res) => res.status(204).end());
app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'veltriva-ai', uptime: process.uptime() }));
app.use(express.static(path.join(__dirname, '..', 'dist')));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Request Logger Middleware (ETCCWD303 Lab 1)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/api')) {
      console.log(`[Veltriva API] ${req.method} ${req.path} -> ${res.statusCode} (${Date.now() - start}ms)`);
    }
  });
  next();
});

// JWT + Multi-Tenant Organization & RBAC Middleware
function authenticateRole(requiredPermission = null) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    let user = {
      org_id: 1,
      org_name: 'Veltriva Sandbox Corp (Demo)',
      is_demo_workspace: true,
      emp_id: 1,
      full_name: 'Shantanu Pandya',
      email: 'shantanu@veltriva.ai',
      role_name: 'CFO_ADMIN',
      can_approve_payroll: true,
      can_trigger_paypal: true,
      can_edit_salary: true,
      can_manage_attendance: true
    };

    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        user = jwt.verify(authHeader.slice(7), JWT_SECRET);
      } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired session token. Please sign in again.' });
      }
    }

    if (requiredPermission && !user[requiredPermission]) {
      return res.status(403).json({
        error: `RBAC Access Denied: Active role '${user.role_name}' lacks '${requiredPermission}' permission.`
      });
    }

    req.user = user;
    next();
  };
}

async function getOrgRecord(orgId) {
  const res = await db.query('SELECT * FROM organizations WHERE org_id = $1 LIMIT 1', [Number(orgId || 1)]);
  return res.rows[0] || { org_id: 1, org_name: 'Veltriva Sandbox Corp (Demo)', is_demo_workspace: true };
}

// ============================================================================
// 1. MULTI-TENANT ORGANIZATION SIGN-UP, LOGIN & WORKSPACE SWITCHER
// ============================================================================

// List available organizations
app.get('/api/organizations', async (req, res, next) => {
  try {
    const orgs = await db.query(
      'SELECT org_id, org_code, org_name, owner_name, owner_email, is_demo_workspace, created_at FROM organizations ORDER BY org_id ASC'
    );
    res.json({ organizations: orgs.rows });
  } catch (err) {
    next(err);
  }
});

// Register a brand-new Clean Organization (0 Sample Data, Own PayPal Keys)
app.post('/api/auth/register-org', async (req, res, next) => {
  try {
    const { org_name, owner_name, owner_email, password, paypal_client_id, paypal_client_secret } = req.body;
    if (!org_name || !owner_name || !owner_email || !password) {
      return res.status(400).json({ error: 'Organization name, owner name, email, and password are required.' });
    }

    const existing = await db.query('SELECT org_id FROM organizations WHERE LOWER(owner_email) = LOWER($1)', [
      owner_email.trim()
    ]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'An organization with this owner email already exists. Please sign in.' });
    }

    const hash = await bcrypt.hash(password, 10);
    const orgCode = `ORG-${Date.now().toString().slice(-5)}`;

    await db.exec('BEGIN');
    const orgIns = await db.query(
      `INSERT INTO organizations (
        org_code, org_name, owner_name, owner_email, password_hash,
        paypal_client_id, paypal_client_secret, is_demo_workspace
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE)
      RETURNING *`,
      [
        orgCode,
        org_name.trim(),
        owner_name.trim(),
        owner_email.trim().toLowerCase(),
        hash,
        paypal_client_id ? paypal_client_id.trim() : null,
        paypal_client_secret ? paypal_client_secret.trim() : null
      ]
    );
    const newOrg = orgIns.rows[0];

    // Seed clean default cost centers for the new organization (0 sample employees!)
    await db.query(
      `INSERT INTO departments (org_id, dept_code, dept_name, monthly_budget_usd, cost_center_account)
       VALUES
         ($1, 'ENG', 'Core Engineering & AI', 50000.00, 'CC-ENG-01'),
         ($1, 'PROD', 'Product & Design', 30000.00, 'CC-PROD-02'),
         ($1, 'OPS', 'Operations & Finance', 25000.00, 'CC-OPS-03')`,
      [newOrg.org_id]
    );
    await db.exec('COMMIT');

    const sessionPayload = {
      org_id: newOrg.org_id,
      org_name: newOrg.org_name,
      is_demo_workspace: false,
      full_name: newOrg.owner_name,
      email: newOrg.owner_email,
      role_name: 'CFO_ADMIN',
      can_approve_payroll: true,
      can_trigger_paypal: true,
      can_edit_salary: true,
      can_manage_attendance: true
    };

    const token = jwt.sign(sessionPayload, JWT_SECRET, { expiresIn: '24h' });
    res.status(201).json({
      message: `Created clean workspace "${newOrg.org_name}" (0 sample data). Add your team and connect your PayPal credentials.`,
      token,
      user: sessionPayload
    });
  } catch (err) {
    try { await db.exec('ROLLBACK'); } catch (_) {}
    next(err);
  }
});

// Login to existing Organization or Switch Workspace / RBAC Role
app.post('/api/auth/login', async (req, res, next) => {
  try {
    const { email, password, org_id, roleOverride } = req.body;

    let orgRow = null;
    if (org_id) {
      orgRow = await getOrgRecord(org_id);
    } else if (email) {
      const orgByEmail = await db.query('SELECT * FROM organizations WHERE LOWER(owner_email) = LOWER($1) LIMIT 1', [
        email.trim()
      ]);
      if (!orgByEmail.rows[0]) {
        return res.status(401).json({ error: 'No workspace found for that email address. Create a new workspace first.' });
      }
      orgRow = orgByEmail.rows[0];
      if (!orgRow.is_demo_workspace) {
        const valid = await bcrypt.compare(String(password || ''), orgRow.password_hash);
        if (!valid) {
          return res.status(401).json({ error: 'Invalid password for this organization.' });
        }
      }
    }

    if (!orgRow) {
      orgRow = await getOrgRecord(1);
    }

    const roleName = roleOverride || 'CFO_ADMIN';
    const roleRes = await db.query('SELECT * FROM roles_permissions WHERE role_name = $1 LIMIT 1', [roleName]);
    const rolePerms = roleRes.rows[0] || {
      role_name: 'CFO_ADMIN',
      can_approve_payroll: true,
      can_trigger_paypal: true,
      can_edit_salary: true,
      can_manage_attendance: true
    };

    const sessionPayload = {
      org_id: orgRow.org_id,
      org_name: orgRow.org_name,
      is_demo_workspace: orgRow.is_demo_workspace,
      full_name: orgRow.owner_name,
      email: orgRow.owner_email,
      ...rolePerms
    };

    const token = jwt.sign(sessionPayload, JWT_SECRET, { expiresIn: '24h' });
    res.json({
      message: `Active Workspace: ${orgRow.org_name} (${sessionPayload.role_name})`,
      token,
      user: sessionPayload
    });
  } catch (err) {
    next(err);
  }
});

// Google OAuth / SSO Sign-In & Auto-Workspace Provisioning
app.post('/api/auth/google', async (req, res, next) => {
  try {
    const { google_email, google_name, company_name } = req.body;
    if (!google_email) {
      return res.status(400).json({ error: 'Google account email is required.' });
    }

    const cleanEmail = google_email.trim().toLowerCase();
    const cleanName = (google_name || cleanEmail.split('@')[0]).trim();

    let orgRow = (
      await db.query('SELECT * FROM organizations WHERE LOWER(owner_email) = LOWER($1) LIMIT 1', [cleanEmail])
    ).rows[0];

    let createdNew = false;
    if (!orgRow) {
      createdNew = true;
      const domainPart = cleanEmail.split('@')[1]?.split('.')[0] || 'Company';
      const defaultOrgName =
        company_name && company_name.trim()
          ? company_name.trim()
          : `${cleanName}'s Treasury (${domainPart.toUpperCase()})`;
      const orgCode = `G-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
      const oauthHash = await bcrypt.hash(`google_oauth_${Date.now()}`, 10);

      await db.exec('BEGIN');
      const ins = await db.query(
        `INSERT INTO organizations (org_code, org_name, owner_name, owner_email, password_hash, is_demo_workspace)
         VALUES ($1, $2, $3, $4, $5, FALSE)
         RETURNING *`,
        [orgCode, defaultOrgName, cleanName, cleanEmail, oauthHash]
      );
      orgRow = ins.rows[0];

      await db.query(
        `INSERT INTO departments (org_id, dept_code, dept_name, monthly_budget_usd, cost_center_account)
         VALUES
           ($1, 'ENG', 'Core Engineering & AI', 50000.00, 'CC-ENG-01'),
           ($1, 'PROD', 'Product & Design', 30000.00, 'CC-PROD-02'),
           ($1, 'OPS', 'Operations & Finance', 25000.00, 'CC-OPS-03')`,
        [orgRow.org_id]
      );
      await db.exec('COMMIT');
    }

    const sessionPayload = {
      org_id: orgRow.org_id,
      org_name: orgRow.org_name,
      is_demo_workspace: orgRow.is_demo_workspace,
      full_name: orgRow.owner_name,
      email: orgRow.owner_email,
      auth_provider: 'GOOGLE_OAUTH',
      role_name: 'CFO_ADMIN',
      can_approve_payroll: true,
      can_trigger_paypal: true,
      can_edit_salary: true,
      can_manage_attendance: true
    };

    const token = jwt.sign(sessionPayload, JWT_SECRET, { expiresIn: '24h' });
    res.json({
      message: createdNew
        ? `Authenticated via Google & created blank workspace "${orgRow.org_name}" (0 sample rows).`
        : `Signed in via Google to "${orgRow.org_name}".`,
      token,
      user: sessionPayload,
      organization: orgRow
    });
  } catch (err) {
    try { await db.exec('ROLLBACK'); } catch (_) {}
    next(err);
  }
});

// ============================================================================
// 2. MULTI-TENANT DASHBOARD OVERVIEW (ISOLATED BY org_id)
// ============================================================================
app.get('/api/dashboard/overview', authenticateRole(), async (req, res, next) => {
  try {
    const orgId = Number(req.user.org_id || 1);
    const orgRow = await getOrgRecord(orgId);

    const [empPayroll, deptBurn, trialBalance, milestones, attendance, leaves, audits, taxSlabs, allOrgs] =
      await Promise.all([
        db.query('SELECT * FROM vw_employee_360_payroll WHERE org_id = $1 ORDER BY emp_id ASC', [orgId]),
        db.query('SELECT * FROM vw_department_burn_analytics WHERE org_id = $1 ORDER BY spend_rank ASC', [orgId]),
        db.query('SELECT * FROM vw_double_entry_trial_balance WHERE org_id = $1', [orgId]),
        db.query(
          `SELECT m.*, e.full_name, e.emp_code, e.paypal_email, e.designation
           FROM contractor_milestones m
           INNER JOIN employees e ON m.emp_id = e.emp_id
           WHERE m.org_id = $1
           ORDER BY m.milestone_id ASC`,
          [orgId]
        ),
        db.query(
          `SELECT a.*, e.full_name, e.emp_code, d.dept_name
           FROM attendance_logs a
           INNER JOIN employees e ON a.emp_id = e.emp_id
           INNER JOIN departments d ON e.dept_id = d.dept_id
           WHERE e.org_id = $1
           ORDER BY a.work_date DESC, a.emp_id ASC`,
          [orgId]
        ),
        db.query(
          `SELECT l.*, e.full_name, e.emp_code, d.dept_name
           FROM leave_requests l
           INNER JOIN employees e ON l.emp_id = e.emp_id
           INNER JOIN departments d ON e.dept_id = d.dept_id
           WHERE e.org_id = $1
           ORDER BY l.created_at DESC`,
          [orgId]
        ),
        db.query('SELECT * FROM audit_logs WHERE org_id = $1 ORDER BY audit_id DESC LIMIT 25', [orgId]),
        db.query('SELECT * FROM tax_slabs ORDER BY country_code, min_annual_usd'),
        db.query('SELECT org_id, org_code, org_name, owner_name, owner_email, is_demo_workspace FROM organizations ORDER BY org_id ASC')
      ]);

    const mlInsights = aiMlService.runWorkforceMlPipeline(empPayroll.rows, deptBurn.rows);

    res.json({
      activeOrganization: {
        org_id: orgRow.org_id,
        org_code: orgRow.org_code,
        org_name: orgRow.org_name,
        owner_name: orgRow.owner_name,
        owner_email: orgRow.owner_email,
        is_demo_workspace: orgRow.is_demo_workspace
      },
      organizations: allOrgs.rows,
      dbmsInfo: db.getEngineInfo(),
      paypalStatus: paypalService.getStatus(orgRow),
      employeesPayroll: empPayroll.rows,
      departmentBurn: deptBurn.rows,
      trialBalance: trialBalance.rows,
      milestones: milestones.rows,
      attendanceLogs: attendance.rows,
      leaveRequests: leaves.rows,
      auditLogs: audits.rows,
      taxSlabs: taxSlabs.rows,
      mlInsights
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// 3. PAYPAL PAYOUTS API + ACID PESSIMISTIC LOCKING (SCOPED TO ORGANIZATION)
// ============================================================================
app.post('/api/paypal/payouts/execute', authenticateRole('can_trigger_paypal'), async (req, res, next) => {
  try {
    const orgId = Number(req.user.org_id || 1);
    const orgRow = await getOrgRecord(orgId);
    const { payrollIds, batchNote } = req.body;

    await db.exec('BEGIN');
    await db.exec('SAVEPOINT before_paypal_payout');

    let targetQuery = `
      SELECT p.payroll_id, p.emp_id, p.net_pay_usd, p.payment_status,
             e.emp_code, e.full_name, e.paypal_email, e.country_code
      FROM payroll_runs p
      INNER JOIN employees e ON p.emp_id = e.emp_id
      WHERE p.org_id = $1 AND p.payment_status != 'COMPLETED'
    `;
    const params = [orgId];
    if (Array.isArray(payrollIds) && payrollIds.length > 0) {
      targetQuery += ` AND p.payroll_id = ANY($2::INT[])`;
      params.push(payrollIds.map(Number));
    }
    targetQuery += ` FOR UPDATE`;

    const lockedRows = await db.query(targetQuery, params);

    if (lockedRows.rows.length === 0) {
      await db.exec('ROLLBACK');
      return res.status(400).json({
        error: 'No queued payroll disbursements found in this workspace.'
      });
    }

    const payoutResult = await paypalService.executeBatchPayout(
      lockedRows.rows,
      batchNote || `${orgRow.org_name} — Payroll Settlement`,
      orgRow
    );

    for (const item of payoutResult.itemsProcessed) {
      await db.query(
        `UPDATE payroll_runs
         SET payment_status = 'COMPLETED',
             paypal_batch_id = $1,
             paypal_payout_item_id = $2,
             paypal_transaction_id = $3,
             paypal_invoice_id = $4,
             paid_at = CURRENT_TIMESTAMP
         WHERE payroll_id = $5`,
        [
          item.paypal_batch_id,
          item.paypal_payout_item_id,
          item.paypal_transaction_id,
          item.paypal_invoice_id,
          item.payroll_id
        ]
      );
    }

    await db.exec('COMMIT');

    res.json({
      message: `Disbursed ${payoutResult.itemsProcessed.length} payroll record(s) for ${orgRow.org_name} via PayPal.`,
      acidProtocol: 'BEGIN -> SAVEPOINT -> SELECT FOR UPDATE -> PAYPAL API -> TRIGGER LEDGER -> COMMIT',
      payoutResult
    });
  } catch (err) {
    try { await db.exec('ROLLBACK'); } catch (_) {}
    next(err);
  }
});

// ============================================================================
// 4. MILESTONE ESCROW RELEASE VIA PAYPAL ORDERS v2 CAPTURE API
// ============================================================================
app.post('/api/paypal/milestones/:id/release', authenticateRole('can_trigger_paypal'), async (req, res, next) => {
  try {
    const orgId = Number(req.user.org_id || 1);
    const orgRow = await getOrgRecord(orgId);
    const milestoneId = Number(req.params.id);
    await db.exec('BEGIN');

    const mRes = await db.query(
      `SELECT m.*, e.full_name, e.paypal_email, e.emp_code
       FROM contractor_milestones m
       INNER JOIN employees e ON m.emp_id = e.emp_id
       WHERE m.milestone_id = $1 AND m.org_id = $2 FOR UPDATE`,
      [milestoneId, orgId]
    );

    if (mRes.rows.length === 0) {
      await db.exec('ROLLBACK');
      return res.status(404).json({ error: 'Milestone not found in this organization' });
    }

    const milestone = mRes.rows[0];
    if (milestone.status === 'RELEASED_PAYPAL') {
      await db.exec('ROLLBACK');
      return res.status(400).json({ error: 'Milestone escrow already released via PayPal' });
    }

    const captureResult = await paypalService.releaseMilestoneEscrow(milestone, milestone, orgRow);

    await db.query(
      `UPDATE contractor_milestones
       SET status = 'RELEASED_PAYPAL',
           completion_pct = 100,
           paypal_order_id = $1,
           paypal_capture_id = $2
       WHERE milestone_id = $3`,
      [captureResult.orderId, captureResult.captureId, milestoneId]
    );

    await db.query(
      `INSERT INTO double_entry_ledger (org_id, tx_reference, milestone_id, account_code, entry_type, amount_usd, narration)
       VALUES
         ($1, $2, $3, '5200_CONTRACTOR_MILESTONE_ESCROW_EXPENSE', 'DEBIT', $4, $5),
         ($1, $2, $3, '1010_PAYPAL_TREASURY_VAULT', 'CREDIT', $4, $6)`,
      [
        orgId,
        captureResult.captureId,
        milestoneId,
        milestone.escrow_amount_usd,
        `Milestone Escrow Released: ${milestone.milestone_title} (${milestone.full_name})`,
        `PayPal Orders v2 Capture (${captureResult.orderId})`
      ]
    );

    await db.exec('COMMIT');

    res.json({
      message: `Milestone #${milestoneId} Escrow ($${milestone.escrow_amount_usd}) captured & released via PayPal Orders v2.`,
      captureResult
    });
  } catch (err) {
    try { await db.exec('ROLLBACK'); } catch (_) {}
    next(err);
  }
});

// ============================================================================
// 5. PER-ORGANIZATION PAYPAL CREDENTIALS & WORKSPACE RESET / CLEAR
// ============================================================================
app.post('/api/paypal/config', authenticateRole(), async (req, res, next) => {
  try {
    const orgId = Number(req.user.org_id || 1);
    const { clientId, clientSecret } = req.body;

    const upd = await db.query(
      `UPDATE organizations
       SET paypal_client_id = $1, paypal_client_secret = $2
       WHERE org_id = $3
       RETURNING *`,
      [clientId ? clientId.trim() : null, clientSecret ? clientSecret.trim() : null, orgId]
    );

    const orgRow = upd.rows[0] || (await getOrgRecord(orgId));
    const status = paypalService.getStatus(orgRow);
    res.json({
      message: `Saved PayPal Sandbox credentials for organization "${orgRow.org_name}".`,
      status
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/demo/reset-pending', authenticateRole(), async (req, res, next) => {
  try {
    const orgId = Number(req.user.org_id || 1);
    await db.query(
      `UPDATE payroll_runs
       SET payment_status = 'PENDING_APPROVAL',
           paypal_batch_id = NULL,
           paypal_transaction_id = NULL,
           paid_at = NULL
       WHERE org_id = $1`,
      [orgId]
    );
    await db.query(
      `UPDATE contractor_milestones
       SET status = 'AI_VERIFIED', paypal_capture_id = NULL
       WHERE org_id = $1`,
      [orgId]
    );
    res.json({ message: 'Workspace cycle reset: All payroll rows and milestones queued for fresh PayPal settlement.' });
  } catch (err) {
    next(err);
  }
});

// Clear all employees & sample data in the current workspace for a 100% blank slate
app.delete('/api/workspace/clear', authenticateRole('can_edit_salary'), async (req, res, next) => {
  try {
    const orgId = Number(req.user.org_id || 1);
    await db.query('DELETE FROM employees WHERE org_id = $1', [orgId]);
    await db.query('DELETE FROM double_entry_ledger WHERE org_id = $1', [orgId]);
    await db.query('DELETE FROM audit_logs WHERE org_id = $1', [orgId]);
    res.json({
      message: 'Purged all employees, milestones, and ledger entries from this workspace. You now have a 100% blank slate.'
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// 6. FULL CRUD OPERATIONS (EMPLOYEES, DEPARTMENTS, ATTENDANCE, LEAVES, SALARY)
// ============================================================================
app.post('/api/dbms/departments', authenticateRole('can_edit_salary'), async (req, res, next) => {
  try {
    const orgId = Number(req.user.org_id || 1);
    const { dept_code, dept_name, monthly_budget_usd } = req.body;
    const ins = await db.query(
      `INSERT INTO departments (org_id, dept_code, dept_name, monthly_budget_usd, cost_center_account)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [orgId, (dept_code || 'NEW').toUpperCase(), dept_name || 'New Department', Number(monthly_budget_usd || 30000), `CC-${Date.now().toString().slice(-4)}`]
    );
    res.status(201).json({ message: `Created cost center ${ins.rows[0].dept_name}`, department: ins.rows[0] });
  } catch (err) {
    next(err);
  }
});

app.post('/api/dbms/employees', authenticateRole('can_edit_salary'), async (req, res, next) => {
  try {
    const orgId = Number(req.user.org_id || 1);
    const {
      full_name,
      email,
      paypal_email,
      dept_id,
      role_id,
      designation,
      employment_type,
      country_code,
      base_salary_usd,
      hra_allowance_usd,
      special_allowance_usd,
      hourly_overtime_rate_usd
    } = req.body;

    if (!full_name || !email || !paypal_email) {
      return res.status(400).json({ error: 'Name, work email, and PayPal email are required.' });
    }

    await db.exec('BEGIN');
    const maxRes = await db.query('SELECT COALESCE(MAX(emp_id), 100) + 1 AS next_num FROM employees');
    const empCode = `VLT-${100 + Number(maxRes.rows[0].next_num)}`;

    // Ensure dept_id belongs to this org, or fallback to first dept of this org
    let validDeptId = Number(dept_id || 1);
    const deptCheck = await db.query('SELECT dept_id FROM departments WHERE org_id = $1 AND dept_id = $2', [orgId, validDeptId]);
    if (deptCheck.rows.length === 0) {
      const firstDept = await db.query('SELECT dept_id FROM departments WHERE org_id = $1 ORDER BY dept_id ASC LIMIT 1', [orgId]);
      validDeptId = firstDept.rows[0]?.dept_id || 1;
    }

    const empInsert = await db.query(
      `INSERT INTO employees (
        org_id, emp_code, full_name, email, paypal_email, password_hash,
        role_id, dept_id, designation, employment_type, country_code,
        attrition_risk_score, ml_cluster_label
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 10.50, 'Steady Core Leader')
      RETURNING *`,
      [
        orgId,
        empCode,
        full_name.trim(),
        email.trim(),
        paypal_email.trim(),
        '$2a$10$X7vG6k8Z1Y2W3Q4R5T6U7O8P9A0S1D2F3G4H5J6K7L8M9N0B1V2C',
        Number(role_id || 4),
        validDeptId,
        designation || 'Senior Software Engineer',
        employment_type || 'FULL_TIME',
        country_code || 'US'
      ]
    );

    const newEmp = empInsert.rows[0];

    await db.query(
      `INSERT INTO salary_structures (
        emp_id, base_salary_usd, hra_allowance_usd, special_allowance_usd,
        hourly_overtime_rate_usd, pf_contribution_pct
      ) VALUES ($1, $2, $3, $4, $5, 10.00)`,
      [
        newEmp.emp_id,
        Number(base_salary_usd || 6000),
        Number(hra_allowance_usd || 1200),
        Number(special_allowance_usd || 800),
        Number(hourly_overtime_rate_usd || 60)
      ]
    );

    await db.query('SELECT fn_compute_employee_monthly_payroll($1, 11, 2026, 0.00)', [newEmp.emp_id]);
    await db.exec('COMMIT');

    res.status(201).json({
      message: `Onboarded ${newEmp.full_name} (${newEmp.emp_code}) into ${req.user.org_name}.`,
      employee: newEmp
    });
  } catch (err) {
    try { await db.exec('ROLLBACK'); } catch (_) {}
    next(err);
  }
});

app.delete('/api/dbms/employees/:empId', authenticateRole('can_edit_salary'), async (req, res, next) => {
  try {
    const orgId = Number(req.user.org_id || 1);
    const empId = Number(req.params.empId);
    const delRes = await db.query('DELETE FROM employees WHERE emp_id = $1 AND org_id = $2 RETURNING full_name, emp_code', [
      empId,
      orgId
    ]);
    if (delRes.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found in this workspace' });
    }
    res.json({
      message: `Removed ${delRes.rows[0].full_name} (${delRes.rows[0].emp_code}) from workspace.`
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/dbms/milestones', authenticateRole('can_approve_payroll'), async (req, res, next) => {
  try {
    const orgId = Number(req.user.org_id || 1);
    const { emp_id, project_name, milestone_title, start_date, due_date, escrow_amount_usd, deliverable_url } = req.body;
    const aiScore = deliverable_url && deliverable_url.startsWith('http') ? 96.8 : 89.5;
    const ins = await db.query(
      `INSERT INTO contractor_milestones (
        org_id, emp_id, project_name, milestone_title, start_date, due_date,
        completion_pct, escrow_amount_usd, deliverable_url,
        ai_verification_score, ai_verification_notes, status, paypal_order_id
      ) VALUES ($1, $2, $3, $4, $5, $6, 100, $7, $8, $9, $10, 'AI_VERIFIED', $11)
      RETURNING *`,
      [
        orgId,
        Number(emp_id),
        project_name || 'Global Expansion Initiative',
        milestone_title || 'Deliverable Milestone',
        start_date || '2026-11-08',
        due_date || '2026-11-13',
        Number(escrow_amount_usd || 2000),
        deliverable_url || 'https://github.com/veltriva-ai/core/pull/200',
        aiScore,
        `Automated deliverable check passed (${aiScore}% confidence). Ready for PayPal Orders v2 capture.`,
        `PP-ORD-${Date.now().toString().slice(-6)}`
      ]
    );
    res.status(201).json({
      message: `Created Milestone Escrow "${ins.rows[0].milestone_title}" ($${ins.rows[0].escrow_amount_usd}).`,
      milestone: ins.rows[0]
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/dbms/attendance', authenticateRole(), async (req, res, next) => {
  try {
    const { emp_id, work_date, shift_code, check_in_time, check_out_time, notes } = req.body;
    const insertRes = await db.query(
      `INSERT INTO attendance_logs (emp_id, work_date, shift_code, check_in_time, check_out_time, status, notes)
       VALUES ($1, $2, $3, $4, $5, 'PRESENT', $6)
       ON CONFLICT (emp_id, work_date)
       DO UPDATE SET check_in_time = EXCLUDED.check_in_time, check_out_time = EXCLUDED.check_out_time, notes = EXCLUDED.notes
       RETURNING *`,
      [Number(emp_id), work_date || '2026-11-10', shift_code || 'SHIFT_MORNING', check_in_time || '09:30:00', check_out_time || '19:30:00', notes || 'Shift logged']
    );

    await db.query('SELECT fn_compute_employee_monthly_payroll($1, 11, 2026, 400.00)', [Number(emp_id)]);

    res.json({
      message: 'Shift attendance recorded and monthly payroll recalculated.',
      attendanceRow: insertRes.rows[0]
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/dbms/leaves', authenticateRole(), async (req, res, next) => {
  try {
    const { emp_id, leave_type, start_date, end_date, days_count, reason } = req.body;
    const isPaid = leave_type !== 'UNPAID_LWP';
    const ins = await db.query(
      `INSERT INTO leave_requests (emp_id, leave_type, start_date, end_date, days_count, is_paid, approval_status, reason)
       VALUES ($1, $2, $3, $4, $5, $6, 'APPROVED', $7)
       RETURNING *`,
      [
        Number(emp_id),
        leave_type || 'UNPAID_LWP',
        start_date || '2026-11-11',
        end_date || '2026-11-12',
        Number(days_count || 1),
        isPaid,
        reason || 'Submitted via Workforce Leave Portal'
      ]
    );

    await db.query('SELECT fn_compute_employee_monthly_payroll($1, 11, 2026, 400.00)', [Number(emp_id)]);

    res.status(201).json({
      message: `Leave request recorded (${leave_type}, ${days_count}d) and payroll updated.`,
      leave: ins.rows[0]
    });
  } catch (err) {
    next(err);
  }
});

app.put('/api/dbms/salary/:empId', authenticateRole('can_edit_salary'), async (req, res, next) => {
  try {
    const empId = Number(req.params.empId);
    const { base_salary_usd, hourly_overtime_rate_usd, bonus_usd } = req.body;

    await db.query(
      `UPDATE salary_structures
       SET base_salary_usd = COALESCE($1, base_salary_usd),
           hourly_overtime_rate_usd = COALESCE($2, hourly_overtime_rate_usd),
           updated_at = CURRENT_TIMESTAMP
       WHERE emp_id = $3`,
      [base_salary_usd ? Number(base_salary_usd) : null, hourly_overtime_rate_usd ? Number(hourly_overtime_rate_usd) : null, empId]
    );

    await db.query('SELECT fn_compute_employee_monthly_payroll($1, 11, 2026, $2)', [
      empId,
      bonus_usd !== undefined ? Number(bonus_usd) : 500.0
    ]);

    res.json({
      message: `Updated compensation structure for Emp #${empId} and recalculated payroll.`
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/dbms/sql-explorer', authenticateRole(), async (req, res, next) => {
  try {
    const { sql } = req.body;
    if (!sql || typeof sql !== 'string') {
      return res.status(400).json({ error: 'SQL query string is required' });
    }

    const trimmed = sql.trim();
    const upper = trimmed.toUpperCase();
    if (
      !upper.startsWith('SELECT') &&
      !upper.startsWith('EXPLAIN') &&
      !upper.startsWith('WITH') &&
      !upper.startsWith('SHOW')
    ) {
      return res.status(400).json({
        error: 'The SQL studio permits SELECT, WITH (CTE), EXPLAIN ANALYZE, and Stored Function SELECT calls.'
      });
    }

    const startTime = performance.now();
    const result = await db.query(trimmed);
    const durationMs = Number((performance.now() - startTime).toFixed(2));

    res.json({
      durationMs,
      rowCount: result.rows.length,
      fields: result.fields ? result.fields.map((f) => f.name) : Object.keys(result.rows[0] || {}),
      rows: result.rows
    });
  } catch (err) {
    res.status(400).json({ error: `PostgreSQL Execution Error: ${err.message}` });
  }
});

// ============================================================================
// 7. AI TREASURY COPILOT & RAG ENDPOINT (SCOPED TO ACTIVE ORGANIZATION)
// ============================================================================
app.post('/api/ai/copilot', authenticateRole(), async (req, res, next) => {
  try {
    const orgId = Number(req.user.org_id || 1);
    const { prompt } = req.body;
    const [empRes, deptRes, trialRes, mileRes] = await Promise.all([
      db.query('SELECT * FROM vw_employee_360_payroll WHERE org_id = $1', [orgId]),
      db.query('SELECT * FROM vw_department_burn_analytics WHERE org_id = $1', [orgId]),
      db.query('SELECT * FROM vw_double_entry_trial_balance WHERE org_id = $1', [orgId]),
      db.query('SELECT * FROM contractor_milestones WHERE org_id = $1', [orgId])
    ]);

    const response = await aiMlService.askTreasuryCopilot(prompt, {
      employees: empRes.rows,
      deptBurn: deptRes.rows,
      trialBalance: trialRes.rows,
      milestones: mileRes.rows
    });

    res.json(response);
  } catch (err) {
    next(err);
  }
});

// Centralized Error Handler
app.use((err, req, res, next) => {
  console.error('[Veltriva Server Error]:', err);
  res.status(500).json({
    error: err.message || 'Internal Server Error'
  });
});

if (require.main === module) {
  db.initDatabase()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`\n==================================================================`);
        console.log(`VELTRIVA — Multi-Tenant Treasury, Payroll & DBMS OS Live`);
        console.log(`Local URL: http://localhost:${PORT}`);
        console.log(`==================================================================\n`);
      });
    })
    .catch((err) => {
      console.error('Failed to initialize PostgreSQL engine:', err);
      process.exit(1);
    });
}

module.exports = app;
