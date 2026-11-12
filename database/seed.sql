-- ============================================================================
-- VELTRIVA AI — Enterprise Seed Data (Triggers & Stored Procedures Active)
-- ============================================================================

-- 1. Seed Roles (RBAC)
INSERT INTO roles_permissions (role_name, description, can_approve_payroll, can_trigger_paypal, can_edit_salary, can_manage_attendance)
VALUES
    ('CFO_ADMIN', 'Chief Financial Officer / Global Treasury Admin', TRUE, TRUE, TRUE, TRUE),
    ('HR_DIRECTOR', 'Global People & Attendance Operations Lead', TRUE, FALSE, TRUE, TRUE),
    ('ENGINEERING_LEAD', 'Department Engineering Manager', FALSE, FALSE, FALSE, TRUE),
    ('FULL_TIME_STAFF', 'Salaried Full-Time Employee', FALSE, FALSE, FALSE, FALSE),
    ('GLOBAL_CONTRACTOR', 'Milestone-Based International Contractor', FALSE, FALSE, FALSE, FALSE)
ON CONFLICT (role_name) DO NOTHING;

-- 2. Seed Departments
INSERT INTO departments (org_id, dept_code, dept_name, monthly_budget_usd, cost_center_account)
VALUES
    (1, 'AI-CORE', 'Autonomous AI & Agentic Systems', 48000.00, 'CC-1001-AI'),
    (1, 'FIN-ENG', 'PayPal Treasury & Ledger Engineering', 42000.00, 'CC-1002-FIN'),
    (1, 'SEC-OPS', 'Zero-Trust Database & Risk Security', 32000.00, 'CC-1003-SEC'),
    (1, 'PROD-UX', 'Enterprise Design & Bryntum/AG-Grid UX', 26000.00, 'CC-1004-UX')
ON CONFLICT DO NOTHING;

-- 3. Seed Progressive Tax Slabs (US, IN, UK, SG, DE)
INSERT INTO tax_slabs (country_code, slab_name, min_annual_usd, max_annual_usd, tax_rate_pct, standard_deduction_usd)
VALUES
    ('US', 'US Federal Standard Bracket 1', 0, 45000, 12.00, 14600),
    ('US', 'US Federal Mid Bracket 2', 45001, 110000, 18.50, 14600),
    ('US', 'US Federal High Bracket 3', 110001, NULL, 24.00, 14600),
    ('IN', 'India New Regime Slab 1', 0, 36000, 10.00, 9000),
    ('IN', 'India New Regime Slab 2', 36001, 85000, 15.00, 9000),
    ('IN', 'India New Regime High Slab', 85001, NULL, 20.00, 9000),
    ('UK', 'UK HMRC Basic Rate', 0, 65000, 16.00, 12500),
    ('UK', 'UK HMRC Higher Rate', 65001, NULL, 22.00, 12500),
    ('SG', 'Singapore IRAS Resident Rate', 0, NULL, 11.50, 10000),
    ('DE', 'Germany Solidarity & Income Tax', 0, NULL, 21.00, 11600);

-- 4. Seed 10 Global Employees & Contractors
-- Password hash corresponds to 'veltriva123'
INSERT INTO employees (emp_code, full_name, email, paypal_email, password_hash, role_id, dept_id, designation, employment_type, country_code, join_date, attrition_risk_score, ml_cluster_label)
VALUES
    ('VLT-101', 'Shantanu Pandya', 'shantanu@veltriva.ai', 'shantanu.cfo.sandbox@paypal.com', '$2a$10$X7vG6k8Z1Y2W3Q4R5T6U7O8P9A0S1D2F3G4H5J6K7L8M9N0B1V2C', 1, 1, 'Founder & Chief AI Architect', 'FULL_TIME', 'IN', '2025-01-10', 4.20, 'High-Impact Innovator'),
    ('VLT-102', 'Elena Rostova', 'elena.r@veltriva.ai', 'elena.rostova.sb@paypal.com', '$2a$10$X7vG6k8Z1Y2W3Q4R5T6U7O8P9A0S1D2F3G4H5J6K7L8M9N0B1V2C', 2, 2, 'VP of Treasury & People Ops', 'FULL_TIME', 'US', '2025-02-15', 8.50, 'Steady Core Leader'),
    ('VLT-103', 'Marcus Vance', 'marcus.v@veltriva.ai', 'marcus.vance.sb@paypal.com', '$2a$10$X7vG6k8Z1Y2W3Q4R5T6U7O8P9A0S1D2F3G4H5J6K7L8M9N0B1V2C', 3, 2, 'Principal Distributed DBMS Engineer', 'FULL_TIME', 'US', '2025-03-01', 14.10, 'High-Impact Innovator'),
    ('VLT-104', 'Aarav Mehta', 'aarav.m@veltriva.ai', 'aarav.mehta.sb@paypal.com', '$2a$10$X7vG6k8Z1Y2W3Q4R5T6U7O8P9A0S1D2F3G4H5J6K7L8M9N0B1V2C', 4, 1, 'Senior LLM & RAG Systems Engineer', 'FULL_TIME', 'IN', '2025-04-12', 19.40, 'High-Impact Innovator'),
    ('VLT-105', 'Sophia Chen', 'sophia.c@veltriva.ai', 'sophia.chen.sb@paypal.com', '$2a$10$X7vG6k8Z1Y2W3Q4R5T6U7O8P9A0S1D2F3G4H5J6K7L8M9N0B1V2C', 4, 3, 'Staff Fraud & ML Risk Scientist', 'FULL_TIME', 'SG', '2025-05-20', 11.80, 'Steady Core Leader'),
    ('VLT-106', 'Liam O''Connor', 'liam.o@veltriva.ai', 'liam.oconnor.sb@paypal.com', '$2a$10$X7vG6k8Z1Y2W3Q4R5T6U7O8P9A0S1D2F3G4H5J6K7L8M9N0B1V2C', 5, 4, 'Lead Bryntum & AG-Grid Architect', 'CONTRACTOR', 'UK', '2025-06-01', 28.60, 'Specialist Contractor'),
    ('VLT-107', 'Priya Nair', 'priya.n@veltriva.ai', 'priya.nair.sb@paypal.com', '$2a$10$X7vG6k8Z1Y2W3Q4R5T6U7O8P9A0S1D2F3G4H5J6K7L8M9N0B1V2C', 4, 2, 'PayPal API & Webhook Specialist', 'FULL_TIME', 'IN', '2025-07-10', 15.20, 'Steady Core Leader'),
    ('VLT-108', 'Lucas Weber', 'lucas.w@veltriva.ai', 'lucas.weber.sb@paypal.com', '$2a$10$X7vG6k8Z1Y2W3Q4R5T6U7O8P9A0S1D2F3G4H5J6K7L8M9N0B1V2C', 5, 3, 'Zero-Knowledge Audit Contractor', 'CONTRACTOR', 'DE', '2025-08-18', 68.50, 'Overtime Burnout Risk'),
    ('VLT-109', 'Zara Al-Mansoor', 'zara.a@veltriva.ai', 'zara.mansoor.sb@paypal.com', '$2a$10$X7vG6k8Z1Y2W3Q4R5T6U7O8P9A0S1D2F3G4H5J6K7L8M9N0B1V2C', 4, 1, 'Agentic Commerce Protocol Engineer', 'FULL_TIME', 'UK', '2025-09-05', 22.00, 'High-Impact Innovator'),
    ('VLT-110', 'Devon Brooks', 'devon.b@veltriva.ai', 'devon.brooks.sb@paypal.com', '$2a$10$X7vG6k8Z1Y2W3Q4R5T6U7O8P9A0S1D2F3G4H5J6K7L8M9N0B1V2C', 5, 4, 'Design Systems & Motion Engineer', 'CONTRACTOR', 'US', '2025-10-01', 74.20, 'Overtime Burnout Risk')
ON CONFLICT (emp_code) DO NOTHING;

-- 5. Seed Salary Structures (3NF / BCNF Compensation Table)
INSERT INTO salary_structures (emp_id, base_salary_usd, hra_allowance_usd, special_allowance_usd, hourly_overtime_rate_usd, pf_contribution_pct)
VALUES
    (1, 8500.00, 2200.00, 1800.00, 85.00, 12.00),
    (2, 7200.00, 1800.00, 1400.00, 70.00, 10.00),
    (3, 7600.00, 1900.00, 1500.00, 75.00, 10.00),
    (4, 6200.00, 1500.00, 1100.00, 60.00, 12.00),
    (5, 6800.00, 1600.00, 1200.00, 65.00, 10.00),
    (6, 5800.00, 1200.00, 900.00, 65.00, 5.00),
    (7, 5400.00, 1300.00, 950.00, 55.00, 12.00),
    (8, 6000.00, 1100.00, 800.00, 70.00, 5.00),
    (9, 6400.00, 1500.00, 1100.00, 62.00, 10.00),
    (10, 5100.00, 1000.00, 750.00, 55.00, 5.00)
ON CONFLICT (emp_id) DO NOTHING;

-- 6. Seed Attendance Logs for November 2026 (Fires trg_attendance_auto_metrics!)
INSERT INTO attendance_logs (emp_id, work_date, shift_code, check_in_time, check_out_time, status, verification_source, notes)
VALUES
    -- Emp 1: Shantanu (High overtime, punctual)
    (1, '2026-11-02', 'SHIFT_MORNING', '08:50:00', '19:20:00', 'PRESENT', 'GITHUB_SSO_BIO', 'Shipped APIMatic PayPal Context Engine'),
    (1, '2026-11-03', 'SHIFT_MORNING', '08:55:00', '18:45:00', 'PRESENT', 'GITHUB_SSO_BIO', 'PostgreSQL BCNF Trigger Architecture'),
    (1, '2026-11-04', 'SHIFT_MORNING', '09:00:00', '19:30:00', 'PRESENT', 'GITHUB_SSO_BIO', 'PayPal Payouts v1 Batch Pipeline'),
    -- Emp 2: Elena
    (2, '2026-11-02', 'SHIFT_MORNING', '09:02:00', '17:30:00', 'PRESENT', 'BIOMETRIC_GEO', 'Treasury audit review'),
    (2, '2026-11-03', 'SHIFT_MORNING', '09:05:00', '18:00:00', 'PRESENT', 'BIOMETRIC_GEO', 'Tax compliance check'),
    -- Emp 3: Marcus
    (3, '2026-11-02', 'SHIFT_MORNING', '09:10:00', '18:40:00', 'PRESENT', 'BIOMETRIC_GEO', 'B-Tree indexing optimization'),
    (3, '2026-11-03', 'SHIFT_MORNING', '09:28:00', '18:30:00', 'PRESENT', 'BIOMETRIC_GEO', 'Traffic delay'),
    -- Emp 4: Aarav
    (4, '2026-11-02', 'SHIFT_MORNING', '09:00:00', '19:00:00', 'PRESENT', 'GITHUB_SSO_BIO', 'RAG compliance parser'),
    (4, '2026-11-03', 'SHIFT_MORNING', '08:58:00', '18:30:00', 'PRESENT', 'GITHUB_SSO_BIO', 'Vector embeddings sync'),
    -- Emp 5: Sophia
    (5, '2026-11-02', 'SHIFT_MORNING', '09:04:00', '18:04:00', 'PRESENT', 'BIOMETRIC_GEO', 'Isolation Forest model tuning'),
    -- Emp 6: Liam (Contractor)
    (6, '2026-11-02', 'SHIFT_FLEX', '09:12:00', '19:12:00', 'REMOTE', 'KERNEL_VERIFIER', 'Bryntum Gantt & AG Grid integration'),
    -- Emp 7: Priya (3 late marks to demonstrate the 3-late-marks = 0.5 day salary deduction rule!)
    (7, '2026-11-02', 'SHIFT_MORNING', '09:35:00', '18:05:00', 'PRESENT', 'BIOMETRIC_GEO', 'Late check-in #1'),
    (7, '2026-11-03', 'SHIFT_MORNING', '09:42:00', '18:10:00', 'PRESENT', 'BIOMETRIC_GEO', 'Late check-in #2'),
    (7, '2026-11-04', 'SHIFT_MORNING', '09:50:00', '18:15:00', 'PRESENT', 'BIOMETRIC_GEO', 'Late check-in #3 (Triggers 0.5 day deduction in Stored Procedure)'),
    -- Emp 8: Lucas (Suspicious overtime spike -> triggers AI Anomaly Flag!)
    (8, '2026-11-02', 'SHIFT_NIGHT', '08:00:00', '22:30:00', 'REMOTE', 'VPN_LOG', 'Unverified 6.5hr overtime spike'),
    (8, '2026-11-03', 'SHIFT_NIGHT', '08:30:00', '21:45:00', 'REMOTE', 'VPN_LOG', 'High consecutive overtime'),
    -- Emp 9: Zara
    (9, '2026-11-02', 'SHIFT_MORNING', '09:01:00', '18:30:00', 'PRESENT', 'GITHUB_SSO_BIO', 'PayPal Webhook signature verification'),
    -- Emp 10: Devon (3 late marks + unpaid leave)
    (10, '2026-11-02', 'SHIFT_MORNING', '09:40:00', '17:40:00', 'PRESENT', 'BIOMETRIC_GEO', 'Late arrival #1'),
    (10, '2026-11-03', 'SHIFT_MORNING', '09:55:00', '17:55:00', 'PRESENT', 'BIOMETRIC_GEO', 'Late arrival #2'),
    (10, '2026-11-04', 'SHIFT_MORNING', '10:05:00', '18:05:00', 'PRESENT', 'BIOMETRIC_GEO', 'Late arrival #3')
ON CONFLICT (emp_id, work_date) DO NOTHING;

-- 7. Seed Leave Requests (Paid & Unpaid LWP)
INSERT INTO leave_requests (emp_id, leave_type, start_date, end_date, days_count, is_paid, approval_status, approved_by, reason)
VALUES
    (4, 'EARNED_LEAVE', '2026-11-12', '2026-11-13', 2.0, TRUE, 'APPROVED', 2, 'Family Diwali Festival Travel'),
    (7, 'SICK_LEAVE', '2026-11-06', '2026-11-06', 1.0, TRUE, 'APPROVED', 2, 'Medical dental appointment'),
    (8, 'UNPAID_LWP', '2026-11-05', '2026-11-06', 2.0, FALSE, 'APPROVED', 2, 'Personal contractor hiatus (Unpaid Leave)'),
    (10, 'UNPAID_LWP', '2026-11-05', '2026-11-07', 3.0, FALSE, 'APPROVED', 2, 'Unpaid leave without pay (3 days)'),
    (9, 'CASUAL_LEAVE', '2026-11-18', '2026-11-19', 2.0, TRUE, 'PENDING', NULL, 'Speaking at FinTech AI Summit London');

-- 8. Seed Bryntum Gantt Contractor Milestones & PayPal Escrow Tasks
INSERT INTO contractor_milestones (emp_id, project_name, milestone_title, start_date, due_date, completion_pct, escrow_amount_usd, deliverable_url, ai_verification_score, ai_verification_notes, status, paypal_order_id, paypal_capture_id)
VALUES
    (1, 'Veltriva Core Engine', 'M1: 3NF/BCNF PostgreSQL Schema & ACID Triggers', '2026-11-01', '2026-11-04', 100, 3200.00, 'https://github.com/veltriva-ai/core/pull/101', 99.40, 'AI Verified: 11 BCNF tables, 3 triggers & 2 PL/pgSQL procedures passing all ACID tests.', 'RELEASED_PAYPAL', 'PP-ORD-8821904A', 'PP-CAP-9910234X'),
    (3, 'Veltriva Core Engine', 'M2: Pessimistic Locking & Double-Entry Ledger', '2026-11-03', '2026-11-07', 100, 2850.00, 'https://github.com/veltriva-ai/core/pull/108', 97.80, 'AI Verified: SELECT FOR UPDATE & trial balance view verified zero discrepancy.', 'RELEASED_PAYPAL', 'PP-ORD-8821905B', 'PP-CAP-9910235Y'),
    (6, 'Enterprise UI Suite', 'M3: AG Grid CFO Treasury & Pivot Analytics', '2026-11-04', '2026-11-09', 100, 2400.00, 'https://github.com/veltriva-ai/ui/pull/42', 96.20, 'AI Verified: AG Grid multi-filter, row selection, pinned totals & CSV export active.', 'AI_VERIFIED', 'PP-ORD-8821906C', NULL),
    (6, 'Enterprise UI Suite', 'M4: Bryntum Workforce Gantt & Shift Scheduler', '2026-11-06', '2026-11-11', 92, 2600.00, 'https://github.com/veltriva-ai/ui/pull/49', 94.50, 'AI Verified: Interactive timeline bars, dependency links & shift conflict guard ready.', 'AI_VERIFIED', 'PP-ORD-8821907D', NULL),
    (4, 'Agentic AI Copilot', 'M5: APIMatic PayPal Context & ML Anomaly Model', '2026-11-05', '2026-11-10', 100, 3100.00, 'https://github.com/veltriva-ai/ai/pull/19', 98.10, 'AI Verified: Isolation anomaly detector + APIMatic grounded PayPal Payouts agent.', 'AI_VERIFIED', 'PP-ORD-8821908E', NULL),
    (8, 'Zero-Trust Audit', 'M6: Cross-Border Tax & GDPR Compliance Audit', '2026-11-07', '2026-11-12', 65, 1950.00, 'https://github.com/veltriva-ai/sec/pull/12', 71.00, 'AI Warning: Overtime log exceeds threshold; awaiting manual CFO sign-off.', 'ESCROW_LOCKED', 'PP-ORD-8821909F', NULL),
    (10, 'Design Systems', 'M7: Executive Dark-Mode & PayPal Receipt PDF', '2026-11-08', '2026-11-12', 80, 1750.00, 'https://github.com/veltriva-ai/ux/pull/27', 88.50, 'AI Verified: Cryptographic salary slip modal & print stylesheet validated.', 'IN_PROGRESS', 'PP-ORD-8821910G', NULL);

-- 9. Execute Stored Function fn_compute_employee_monthly_payroll() for all 10 Employees!
SELECT fn_compute_employee_monthly_payroll(1, 11, 2026, 1200.00);
SELECT fn_compute_employee_monthly_payroll(2, 11, 2026, 650.00);
SELECT fn_compute_employee_monthly_payroll(3, 11, 2026, 800.00);
SELECT fn_compute_employee_monthly_payroll(4, 11, 2026, 750.00);
SELECT fn_compute_employee_monthly_payroll(5, 11, 2026, 500.00);
SELECT fn_compute_employee_monthly_payroll(6, 11, 2026, 450.00);
SELECT fn_compute_employee_monthly_payroll(7, 11, 2026, 300.00);
SELECT fn_compute_employee_monthly_payroll(8, 11, 2026, 0.00);
SELECT fn_compute_employee_monthly_payroll(9, 11, 2026, 550.00);
SELECT fn_compute_employee_monthly_payroll(10, 11, 2026, 200.00);

-- 10. Mark first 4 employees as COMPLETED via PayPal Payouts
-- This automatically fires trg_payroll_double_entry_and_audit to populate double_entry_ledger & audit_logs!
UPDATE payroll_runs
SET payment_status = 'COMPLETED',
    paypal_batch_id = 'PPBATCH-202611-VLT01',
    paypal_payout_item_id = 'PPITEM-100' || emp_id,
    paypal_transaction_id = '9XK82716VLT00' || emp_id,
    paypal_invoice_id = 'INV2-VLT-2026-100' || emp_id,
    paid_at = CURRENT_TIMESTAMP - INTERVAL '2 hours'
WHERE emp_id IN (1, 2, 3, 5)
  AND pay_period_month = 11
  AND pay_period_year = 2026;
