-- ============================================================================
-- VELTRIVA AI — Multi-Tenant PostgreSQL 16 Relational Schema (3NF / BCNF)
-- Course Alignment: ETCCMS304 (DBMS Capstone: Payroll & Attendance System)
-- Covers: Multi-Tenant SaaS Isolation (organizations), CO1-CO4
-- ============================================================================

-- 0. MULTI-TENANT ORGANIZATIONS (Isolated Production Workspaces & PayPal Keys)
CREATE TABLE IF NOT EXISTS organizations (
    org_id SERIAL PRIMARY KEY,
    org_code VARCHAR(24) UNIQUE NOT NULL,
    org_name VARCHAR(120) NOT NULL,
    owner_name VARCHAR(100) NOT NULL,
    owner_email VARCHAR(120) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    base_currency VARCHAR(5) DEFAULT 'USD',
    paypal_client_id TEXT,
    paypal_client_secret TEXT,
    is_demo_workspace BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed default Demo Organization #1 immediately so FK references succeed
INSERT INTO organizations (org_id, org_code, org_name, owner_name, owner_email, password_hash, is_demo_workspace)
VALUES (1, 'ORG-DEMO-01', 'Veltriva Sandbox Corp (Demo)', 'Shantanu Pandya', 'shantanu@veltriva.ai', '$2a$10$X7vG6k8Z1Y2W3Q4R5T6U7O8P9A0S1D2F3G4H5J6K7L8M9N0B1V2C', TRUE)
ON CONFLICT (org_id) DO NOTHING;

SELECT setval('organizations_org_id_seq', GREATEST(COALESCE((SELECT MAX(org_id) FROM organizations), 1), 1));

-- 1. ROLES & PERMISSIONS (RBAC - CO3 Database Security)
CREATE TABLE IF NOT EXISTS roles_permissions (
    role_id SERIAL PRIMARY KEY,
    role_name VARCHAR(40) UNIQUE NOT NULL,
    description TEXT NOT NULL,
    can_approve_payroll BOOLEAN DEFAULT FALSE,
    can_trigger_paypal BOOLEAN DEFAULT FALSE,
    can_edit_salary BOOLEAN DEFAULT FALSE,
    can_manage_attendance BOOLEAN DEFAULT FALSE
);

-- 2. DEPARTMENTS (Cost Centers & Treasury Budgets per Organization)
CREATE TABLE IF NOT EXISTS departments (
    dept_id SERIAL PRIMARY KEY,
    org_id INT NOT NULL DEFAULT 1 REFERENCES organizations(org_id) ON DELETE CASCADE,
    dept_code VARCHAR(16) NOT NULL,
    dept_name VARCHAR(80) NOT NULL,
    monthly_budget_usd NUMERIC(12, 2) NOT NULL CHECK (monthly_budget_usd >= 0),
    cost_center_account VARCHAR(32) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. PROGRESSIVE TAX SLABS (3NF Lookup Table by Jurisdiction)
CREATE TABLE IF NOT EXISTS tax_slabs (
    slab_id SERIAL PRIMARY KEY,
    country_code VARCHAR(5) NOT NULL,
    slab_name VARCHAR(50) NOT NULL,
    min_annual_usd NUMERIC(12, 2) NOT NULL,
    max_annual_usd NUMERIC(12, 2),
    tax_rate_pct NUMERIC(5, 2) NOT NULL CHECK (tax_rate_pct >= 0 AND tax_rate_pct <= 60),
    standard_deduction_usd NUMERIC(10, 2) DEFAULT 0
);

-- 4. EMPLOYEES & GLOBAL CONTRACTORS (Core Workforce Entity per Organization)
CREATE TABLE IF NOT EXISTS employees (
    emp_id SERIAL PRIMARY KEY,
    org_id INT NOT NULL DEFAULT 1 REFERENCES organizations(org_id) ON DELETE CASCADE,
    emp_code VARCHAR(20) UNIQUE NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(120) UNIQUE NOT NULL,
    paypal_email VARCHAR(120) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role_id INT NOT NULL REFERENCES roles_permissions(role_id) ON DELETE RESTRICT,
    dept_id INT NOT NULL REFERENCES departments(dept_id) ON DELETE RESTRICT,
    designation VARCHAR(80) NOT NULL,
    employment_type VARCHAR(25) NOT NULL CHECK (employment_type IN ('FULL_TIME', 'CONTRACTOR', 'PART_TIME')),
    country_code VARCHAR(5) NOT NULL DEFAULT 'US',
    join_date DATE NOT NULL DEFAULT CURRENT_DATE,
    attrition_risk_score NUMERIC(5, 2) DEFAULT 12.50,
    ml_cluster_label VARCHAR(40) DEFAULT 'Core Performer',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. SALARY STRUCTURES (BCNF Separated Compensation Entity)
CREATE TABLE IF NOT EXISTS salary_structures (
    structure_id SERIAL PRIMARY KEY,
    emp_id INT UNIQUE NOT NULL REFERENCES employees(emp_id) ON DELETE CASCADE,
    base_salary_usd NUMERIC(10, 2) NOT NULL CHECK (base_salary_usd >= 0),
    hra_allowance_usd NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (hra_allowance_usd >= 0),
    special_allowance_usd NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (special_allowance_usd >= 0),
    hourly_overtime_rate_usd NUMERIC(8, 2) NOT NULL DEFAULT 45.00 CHECK (hourly_overtime_rate_usd >= 0),
    pf_contribution_pct NUMERIC(5, 2) NOT NULL DEFAULT 12.00 CHECK (pf_contribution_pct >= 0 AND pf_contribution_pct <= 30),
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. ATTENDANCE LOGS (Shift & Daily Time Tracking)
CREATE TABLE IF NOT EXISTS attendance_logs (
    attendance_id SERIAL PRIMARY KEY,
    emp_id INT NOT NULL REFERENCES employees(emp_id) ON DELETE CASCADE,
    work_date DATE NOT NULL,
    shift_code VARCHAR(20) DEFAULT 'SHIFT_MORNING',
    check_in_time TIME,
    check_out_time TIME,
    hours_worked NUMERIC(5, 2) DEFAULT 0,
    overtime_hours NUMERIC(5, 2) DEFAULT 0,
    status VARCHAR(20) NOT NULL CHECK (status IN ('PRESENT', 'LATE', 'ABSENT', 'HALF_DAY', 'REMOTE')),
    is_late BOOLEAN DEFAULT FALSE,
    anomaly_score NUMERIC(5, 2) DEFAULT 0.00,
    verification_source VARCHAR(40) DEFAULT 'BIOMETRIC_GEO',
    notes TEXT,
    UNIQUE (emp_id, work_date)
);

-- 7. LEAVE REQUESTS (Paid / Unpaid Leave Workflow)
CREATE TABLE IF NOT EXISTS leave_requests (
    leave_id SERIAL PRIMARY KEY,
    emp_id INT NOT NULL REFERENCES employees(emp_id) ON DELETE CASCADE,
    leave_type VARCHAR(30) NOT NULL CHECK (leave_type IN ('EARNED_LEAVE', 'SICK_LEAVE', 'CASUAL_LEAVE', 'UNPAID_LWP')),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    days_count NUMERIC(4, 1) NOT NULL CHECK (days_count > 0),
    is_paid BOOLEAN NOT NULL DEFAULT TRUE,
    approval_status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED')),
    approved_by INT REFERENCES employees(emp_id),
    reason TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CHECK (end_date >= start_date)
);

-- 8. CONTRACTOR MILESTONES (Deliverable Gantt & PayPal Milestone Escrow)
CREATE TABLE IF NOT EXISTS contractor_milestones (
    milestone_id SERIAL PRIMARY KEY,
    org_id INT NOT NULL DEFAULT 1 REFERENCES organizations(org_id) ON DELETE CASCADE,
    emp_id INT NOT NULL REFERENCES employees(emp_id) ON DELETE CASCADE,
    project_name VARCHAR(100) NOT NULL,
    milestone_title VARCHAR(140) NOT NULL,
    start_date DATE NOT NULL,
    due_date DATE NOT NULL,
    completion_pct INT NOT NULL DEFAULT 0 CHECK (completion_pct >= 0 AND completion_pct <= 100),
    escrow_amount_usd NUMERIC(10, 2) NOT NULL CHECK (escrow_amount_usd > 0),
    deliverable_url VARCHAR(255),
    ai_verification_score NUMERIC(5, 2) DEFAULT 0.00,
    ai_verification_notes TEXT,
    status VARCHAR(25) NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS', 'AI_VERIFIED', 'ESCROW_LOCKED', 'RELEASED_PAYPAL', 'DISPUTED')),
    paypal_order_id VARCHAR(64),
    paypal_capture_id VARCHAR(64),
    dependency_milestone_id INT REFERENCES contractor_milestones(milestone_id)
);

-- 9. PAYROLL RUNS (Monthly / Cycle Slip & PayPal Payouts Settlement)
CREATE TABLE IF NOT EXISTS payroll_runs (
    payroll_id SERIAL PRIMARY KEY,
    org_id INT NOT NULL DEFAULT 1 REFERENCES organizations(org_id) ON DELETE CASCADE,
    emp_id INT NOT NULL REFERENCES employees(emp_id) ON DELETE CASCADE,
    pay_period_month INT NOT NULL CHECK (pay_period_month BETWEEN 1 AND 12),
    pay_period_year INT NOT NULL CHECK (pay_period_year >= 2024),
    working_days INT NOT NULL DEFAULT 22,
    present_days NUMERIC(4, 1) NOT NULL DEFAULT 22,
    paid_leave_days NUMERIC(4, 1) NOT NULL DEFAULT 0,
    unpaid_leave_days NUMERIC(4, 1) NOT NULL DEFAULT 0,
    late_marks_count INT NOT NULL DEFAULT 0,
    overtime_hours NUMERIC(5, 2) NOT NULL DEFAULT 0,
    gross_pay_usd NUMERIC(10, 2) NOT NULL DEFAULT 0,
    late_deduction_usd NUMERIC(10, 2) NOT NULL DEFAULT 0,
    unpaid_leave_deduction_usd NUMERIC(10, 2) NOT NULL DEFAULT 0,
    pf_deduction_usd NUMERIC(10, 2) NOT NULL DEFAULT 0,
    income_tax_usd NUMERIC(10, 2) NOT NULL DEFAULT 0,
    ai_performance_bonus_usd NUMERIC(10, 2) NOT NULL DEFAULT 0,
    net_pay_usd NUMERIC(10, 2) NOT NULL DEFAULT 0,
    payment_status VARCHAR(25) NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK (payment_status IN ('DRAFT', 'PENDING_APPROVAL', 'PROCESSING_PAYPAL', 'COMPLETED', 'FAILED_ROLLBACK')),
    paypal_batch_id VARCHAR(64),
    paypal_payout_item_id VARCHAR(64),
    paypal_transaction_id VARCHAR(64),
    paypal_invoice_id VARCHAR(64),
    ai_audit_verdict VARCHAR(30) DEFAULT 'CLEAN_VERIFIED',
    paid_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (emp_id, pay_period_month, pay_period_year)
);

-- 10. DOUBLE-ENTRY ACCOUNTING LEDGER (ACID Financial Integrity)
CREATE TABLE IF NOT EXISTS double_entry_ledger (
    entry_id SERIAL PRIMARY KEY,
    org_id INT NOT NULL DEFAULT 1 REFERENCES organizations(org_id) ON DELETE CASCADE,
    tx_reference VARCHAR(64) NOT NULL,
    payroll_id INT REFERENCES payroll_runs(payroll_id) ON DELETE SET NULL,
    milestone_id INT REFERENCES contractor_milestones(milestone_id) ON DELETE SET NULL,
    account_code VARCHAR(40) NOT NULL,
    entry_type VARCHAR(10) NOT NULL CHECK (entry_type IN ('DEBIT', 'CREDIT')),
    amount_usd NUMERIC(12, 2) NOT NULL CHECK (amount_usd > 0),
    currency VARCHAR(5) DEFAULT 'USD',
    narration TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 11. IMMUTABLE AUDIT LOGS (Trigger-Populated Security Trail)
CREATE TABLE IF NOT EXISTS audit_logs (
    audit_id SERIAL PRIMARY KEY,
    org_id INT NOT NULL DEFAULT 1 REFERENCES organizations(org_id) ON DELETE CASCADE,
    table_name VARCHAR(60) NOT NULL,
    operation_type VARCHAR(60) NOT NULL,
    record_id VARCHAR(40) NOT NULL,
    actor_role VARCHAR(40) DEFAULT 'SYSTEM_TRIGGER',
    old_payload JSONB,
    new_payload JSONB,
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Safe schema migration for pre-existing tables in cloud PostgreSQL
ALTER TABLE departments ADD COLUMN IF NOT EXISTS org_id INT NOT NULL DEFAULT 1 REFERENCES organizations(org_id) ON DELETE CASCADE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS org_id INT NOT NULL DEFAULT 1 REFERENCES organizations(org_id) ON DELETE CASCADE;
ALTER TABLE contractor_milestones ADD COLUMN IF NOT EXISTS org_id INT NOT NULL DEFAULT 1 REFERENCES organizations(org_id) ON DELETE CASCADE;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS org_id INT NOT NULL DEFAULT 1 REFERENCES organizations(org_id) ON DELETE CASCADE;
ALTER TABLE double_entry_ledger ADD COLUMN IF NOT EXISTS org_id INT NOT NULL DEFAULT 1 REFERENCES organizations(org_id) ON DELETE CASCADE;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS org_id INT NOT NULL DEFAULT 1 REFERENCES organizations(org_id) ON DELETE CASCADE;
ALTER TABLE departments DROP CONSTRAINT IF EXISTS departments_dept_code_key;
ALTER TABLE departments DROP CONSTRAINT IF EXISTS departments_dept_name_key;

-- ============================================================================
-- CO2: B-TREE & COMPOSITE INDEXES FOR QUERY OPTIMIZATION
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_employees_org_dept ON employees(org_id, dept_id, is_active);
CREATE INDEX IF NOT EXISTS idx_attendance_emp_date ON attendance_logs(emp_id, work_date);
CREATE INDEX IF NOT EXISTS idx_payroll_period_status ON payroll_runs(org_id, pay_period_year, pay_period_month, payment_status);
CREATE INDEX IF NOT EXISTS idx_ledger_tx_ref ON double_entry_ledger(org_id, tx_reference);
CREATE INDEX IF NOT EXISTS idx_milestones_status ON contractor_milestones(org_id, status, due_date);

-- ============================================================================
-- CO2: MULTI-TENANT ANALYTICAL VIEWS WITH JOINS & WINDOW FUNCTIONS
-- ============================================================================
DROP VIEW IF EXISTS vw_employee_360_payroll CASCADE;
CREATE OR REPLACE VIEW vw_employee_360_payroll AS
SELECT 
    e.org_id,
    e.emp_id,
    e.emp_code,
    e.full_name,
    e.email,
    e.paypal_email,
    e.designation,
    e.employment_type,
    e.country_code,
    e.attrition_risk_score,
    e.ml_cluster_label,
    r.role_name,
    d.dept_id,
    d.dept_code,
    d.dept_name,
    s.base_salary_usd,
    s.hra_allowance_usd,
    s.special_allowance_usd,
    s.hourly_overtime_rate_usd,
    s.pf_contribution_pct,
    (s.base_salary_usd + s.hra_allowance_usd + s.special_allowance_usd) AS fixed_monthly_ctc_usd,
    p.payroll_id,
    p.pay_period_month,
    p.pay_period_year,
    p.working_days,
    p.present_days,
    p.paid_leave_days,
    p.unpaid_leave_days,
    p.late_marks_count,
    p.overtime_hours,
    p.gross_pay_usd,
    p.late_deduction_usd,
    p.unpaid_leave_deduction_usd,
    p.pf_deduction_usd,
    p.income_tax_usd,
    p.ai_performance_bonus_usd,
    p.net_pay_usd,
    p.payment_status,
    p.paypal_batch_id,
    p.paypal_transaction_id,
    p.paypal_invoice_id,
    p.ai_audit_verdict,
    p.paid_at,
    RANK() OVER (PARTITION BY e.org_id, d.dept_id ORDER BY COALESCE(p.net_pay_usd, 0) DESC) AS dept_earner_rank,
    RANK() OVER (PARTITION BY e.org_id, d.dept_id ORDER BY COALESCE(p.net_pay_usd, 0) DESC) AS dept_salary_rank,
    RANK() OVER (PARTITION BY e.org_id, d.dept_id ORDER BY COALESCE(p.net_pay_usd, 0) DESC) AS dept_net_pay_rank
FROM employees e
INNER JOIN roles_permissions r ON e.role_id = r.role_id
INNER JOIN departments d ON e.dept_id = d.dept_id
LEFT JOIN salary_structures s ON e.emp_id = s.emp_id
LEFT JOIN payroll_runs p ON e.emp_id = p.emp_id 
    AND p.pay_period_month = 11 
    AND p.pay_period_year = 2026;

DROP VIEW IF EXISTS vw_department_burn_analytics CASCADE;
CREATE OR REPLACE VIEW vw_department_burn_analytics AS
SELECT 
    d.org_id,
    d.dept_id,
    d.dept_code,
    d.dept_name,
    d.cost_center_account,
    d.monthly_budget_usd,
    COUNT(DISTINCT e.emp_id) AS headcount,
    COALESCE(SUM(p.gross_pay_usd), 0) AS total_gross_burn_usd,
    COALESCE(SUM(p.net_pay_usd), 0) AS total_net_disbursed_usd,
    COALESCE(SUM(p.income_tax_usd + p.pf_deduction_usd), 0) AS total_statutory_withholding_usd,
    COALESCE(SUM(p.overtime_hours), 0) AS total_overtime_hours,
    ROUND((COALESCE(SUM(p.gross_pay_usd), 0) / NULLIF(d.monthly_budget_usd, 0)) * 100, 2) AS budget_utilization_pct,
    ROUND(COALESCE(AVG(e.attrition_risk_score), 0), 2) AS avg_attrition_risk_pct,
    RANK() OVER (PARTITION BY d.org_id ORDER BY COALESCE(SUM(p.gross_pay_usd), 0) DESC) AS spend_rank
FROM departments d
LEFT JOIN employees e ON d.dept_id = e.dept_id AND e.is_active = TRUE
LEFT JOIN payroll_runs p ON e.emp_id = p.emp_id AND p.pay_period_month = 11 AND p.pay_period_year = 2026
GROUP BY d.org_id, d.dept_id, d.dept_code, d.dept_name, d.cost_center_account, d.monthly_budget_usd;

DROP VIEW IF EXISTS vw_double_entry_trial_balance CASCADE;
CREATE OR REPLACE VIEW vw_double_entry_trial_balance AS
SELECT 
    org_id,
    account_code,
    SUM(CASE WHEN entry_type = 'DEBIT' THEN amount_usd ELSE 0 END) AS total_debit_usd,
    SUM(CASE WHEN entry_type = 'CREDIT' THEN amount_usd ELSE 0 END) AS total_credit_usd,
    SUM(CASE WHEN entry_type = 'DEBIT' THEN amount_usd ELSE -amount_usd END) AS net_balance_usd,
    COUNT(*) AS posting_count
FROM double_entry_ledger
GROUP BY org_id, account_code
ORDER BY account_code;
