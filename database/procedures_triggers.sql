-- ============================================================================
-- VELTRIVA AI — Multi-Tenant PL/pgSQL Stored Functions, Procedures & Triggers
-- Course Alignment: ETCCMS304 Unit 3 (CO3: Transactions, PL/SQL & Security)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS plpgsql;

-- ----------------------------------------------------------------------------
-- 1. STORED FUNCTION: Progressive Tax Calculation (CO3 Procedural SQL)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_calculate_progressive_tax(
    p_country VARCHAR,
    p_monthly_gross NUMERIC
) RETURNS NUMERIC AS $$
DECLARE
    v_annual_gross NUMERIC;
    v_tax_rate NUMERIC := 15.0;
    v_std_deduction NUMERIC := 0.0;
    v_taxable_annual NUMERIC;
    v_monthly_tax NUMERIC;
BEGIN
    v_annual_gross := p_monthly_gross * 12.0;

    SELECT tax_rate_pct, standard_deduction_usd
    INTO v_tax_rate, v_std_deduction
    FROM tax_slabs
    WHERE country_code = p_country
      AND v_annual_gross >= min_annual_usd
      AND (max_annual_usd IS NULL OR v_annual_gross <= max_annual_usd)
    ORDER BY min_annual_usd DESC
    LIMIT 1;

    IF NOT FOUND THEN
        v_tax_rate := 15.0;
        v_std_deduction := 12000.0;
    END IF;

    v_taxable_annual := GREATEST(0, v_annual_gross - COALESCE(v_std_deduction, 0));
    v_monthly_tax := ROUND((v_taxable_annual * (v_tax_rate / 100.0)) / 12.0, 2);

    RETURN v_monthly_tax;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 2. STORED FUNCTION: Full Monthly Payroll & Slip Generator (Capstone Exp 5)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_compute_employee_monthly_payroll(
    p_emp_id INT,
    p_month INT,
    p_year INT,
    p_bonus NUMERIC DEFAULT 0
) RETURNS INT AS $$
DECLARE
    v_org_id INT;
    v_country VARCHAR(5);
    v_base NUMERIC(10,2);
    v_hra NUMERIC(10,2);
    v_special NUMERIC(10,2);
    v_ot_rate NUMERIC(8,2);
    v_pf_pct NUMERIC(5,2);
    v_fixed_gross NUMERIC(10,2);
    v_per_day_salary NUMERIC(10,2);
    v_working_days INT := 22;
    v_present_days NUMERIC(4,1) := 0;
    v_late_count INT := 0;
    v_ot_hours NUMERIC(5,2) := 0;
    v_paid_leaves NUMERIC(4,1) := 0;
    v_unpaid_leaves NUMERIC(4,1) := 0;
    v_ot_pay NUMERIC(10,2) := 0;
    v_gross_pay NUMERIC(10,2) := 0;
    v_late_deduction NUMERIC(10,2) := 0;
    v_unpaid_deduction NUMERIC(10,2) := 0;
    v_pf_deduction NUMERIC(10,2) := 0;
    v_tax_deduction NUMERIC(10,2) := 0;
    v_net_pay NUMERIC(10,2) := 0;
    v_payroll_id INT;
    v_max_anomaly NUMERIC(5,2) := 0;
    v_verdict VARCHAR(30) := 'CLEAN_VERIFIED';
BEGIN
    SELECT e.org_id, e.country_code, s.base_salary_usd, s.hra_allowance_usd, s.special_allowance_usd,
           s.hourly_overtime_rate_usd, s.pf_contribution_pct
    INTO v_org_id, v_country, v_base, v_hra, v_special, v_ot_rate, v_pf_pct
    FROM employees e
    INNER JOIN salary_structures s ON e.emp_id = s.emp_id
    WHERE e.emp_id = p_emp_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Employee ID % or Salary Structure not found', p_emp_id;
    END IF;

    v_fixed_gross := v_base + v_hra + v_special;
    v_per_day_salary := ROUND(v_fixed_gross / v_working_days, 2);

    SELECT 
        COALESCE(SUM(CASE WHEN status IN ('PRESENT', 'LATE', 'REMOTE') THEN 1.0 WHEN status = 'HALF_DAY' THEN 0.5 ELSE 0 END), 20),
        COALESCE(SUM(CASE WHEN is_late = TRUE THEN 1 ELSE 0 END), 0),
        COALESCE(SUM(overtime_hours), 0),
        COALESCE(MAX(anomaly_score), 0)
    INTO v_present_days, v_late_count, v_ot_hours, v_max_anomaly
    FROM attendance_logs
    WHERE emp_id = p_emp_id
      AND EXTRACT(MONTH FROM work_date) = p_month
      AND EXTRACT(YEAR FROM work_date) = p_year;

    IF v_present_days < 5 THEN
        v_present_days := 21.0 + (v_present_days * 0.2);
    END IF;

    SELECT 
        COALESCE(SUM(CASE WHEN is_paid = TRUE THEN days_count ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN is_paid = FALSE THEN days_count ELSE 0 END), 0)
    INTO v_paid_leaves, v_unpaid_leaves
    FROM leave_requests
    WHERE emp_id = p_emp_id
      AND approval_status = 'APPROVED'
      AND EXTRACT(MONTH FROM start_date) = p_month
      AND EXTRACT(YEAR FROM start_date) = p_year;

    v_ot_pay := ROUND(v_ot_hours * v_ot_rate, 2);
    v_gross_pay := ROUND(v_fixed_gross + v_ot_pay + COALESCE(p_bonus, 0), 2);

    v_late_deduction := ROUND(FLOOR(v_late_count / 3.0) * (v_per_day_salary * 0.5), 2);
    v_unpaid_deduction := ROUND(v_unpaid_leaves * v_per_day_salary, 2);
    v_pf_deduction := ROUND(v_base * (v_pf_pct / 100.0), 2);
    v_tax_deduction := fn_calculate_progressive_tax(v_country, v_gross_pay - v_late_deduction - v_unpaid_deduction);

    v_net_pay := GREATEST(0, ROUND(
        v_gross_pay - v_late_deduction - v_unpaid_deduction - v_pf_deduction - v_tax_deduction,
        2
    ));

    IF v_max_anomaly >= 70.0 THEN
        v_verdict := 'FLAGGED_OT_SPIKE';
    END IF;

    INSERT INTO payroll_runs (
        org_id, emp_id, pay_period_month, pay_period_year, working_days, present_days,
        paid_leave_days, unpaid_leave_days, late_marks_count, overtime_hours,
        gross_pay_usd, late_deduction_usd, unpaid_leave_deduction_usd,
        pf_deduction_usd, income_tax_usd, ai_performance_bonus_usd,
        net_pay_usd, payment_status, ai_audit_verdict
    ) VALUES (
        v_org_id, p_emp_id, p_month, p_year, v_working_days, LEAST(v_working_days, v_present_days),
        v_paid_leaves, v_unpaid_leaves, v_late_count, v_ot_hours,
        v_gross_pay, v_late_deduction, v_unpaid_deduction,
        v_pf_deduction, v_tax_deduction, COALESCE(p_bonus, 0),
        v_net_pay, 'PENDING_APPROVAL', v_verdict
    )
    ON CONFLICT (emp_id, pay_period_month, pay_period_year)
    DO UPDATE SET
        org_id = EXCLUDED.org_id,
        present_days = EXCLUDED.present_days,
        paid_leave_days = EXCLUDED.paid_leave_days,
        unpaid_leave_days = EXCLUDED.unpaid_leave_days,
        late_marks_count = EXCLUDED.late_marks_count,
        overtime_hours = EXCLUDED.overtime_hours,
        gross_pay_usd = EXCLUDED.gross_pay_usd,
        late_deduction_usd = EXCLUDED.late_deduction_usd,
        unpaid_leave_deduction_usd = EXCLUDED.unpaid_leave_deduction_usd,
        pf_deduction_usd = EXCLUDED.pf_deduction_usd,
        income_tax_usd = EXCLUDED.income_tax_usd,
        ai_performance_bonus_usd = EXCLUDED.ai_performance_bonus_usd,
        net_pay_usd = EXCLUDED.net_pay_usd,
        ai_audit_verdict = EXCLUDED.ai_audit_verdict
    WHERE payroll_runs.payment_status != 'COMPLETED'
    RETURNING payroll_id INTO v_payroll_id;

    RETURN v_payroll_id;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 3. TRIGGER 1: Attendance Auto-Calculation & Anomaly Guard
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_fn_attendance_auto_metrics()
RETURNS TRIGGER AS $$
DECLARE
    v_hours NUMERIC(5,2);
BEGIN
    IF NEW.check_in_time IS NOT NULL AND NEW.check_out_time IS NOT NULL THEN
        v_hours := ROUND(EXTRACT(EPOCH FROM (NEW.check_out_time - NEW.check_in_time)) / 3600.0, 2);
        IF v_hours < 0 THEN
            v_hours := v_hours + 24.0;
        END IF;
        NEW.hours_worked := v_hours;
        NEW.overtime_hours := GREATEST(0, ROUND(v_hours - 8.0, 2));
    END IF;

    IF NEW.check_in_time IS NOT NULL AND NEW.check_in_time > '09:15:00'::TIME THEN
        NEW.is_late := TRUE;
        IF NEW.status = 'PRESENT' THEN
            NEW.status := 'LATE';
        END IF;
    END IF;

    IF NEW.overtime_hours > 4.5 AND NEW.anomaly_score = 0 THEN
        NEW.anomaly_score := LEAST(98.0, ROUND(55.0 + (NEW.overtime_hours * 6.5), 2));
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_attendance_auto_metrics ON attendance_logs;
CREATE TRIGGER trg_attendance_auto_metrics
BEFORE INSERT OR UPDATE ON attendance_logs
FOR EACH ROW
EXECUTE FUNCTION trg_fn_attendance_auto_metrics();

-- ----------------------------------------------------------------------------
-- 4. TRIGGER 2: Automated Multi-Tenant Double-Entry Accounting & Audit Log
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_fn_payroll_double_entry_and_audit()
RETURNS TRIGGER AS $$
DECLARE
    v_tx_ref VARCHAR(64);
BEGIN
    IF NEW.payment_status = 'COMPLETED' AND (OLD.payment_status IS DISTINCT FROM 'COMPLETED') THEN
        v_tx_ref := COALESCE(NEW.paypal_transaction_id, 'PP-TX-' || NEW.payroll_id);

        INSERT INTO double_entry_ledger (org_id, tx_reference, payroll_id, account_code, entry_type, amount_usd, narration)
        VALUES (
            NEW.org_id,
            v_tx_ref,
            NEW.payroll_id,
            '5100_SALARIES_AND_WAGES_EXPENSE',
            'DEBIT',
            NEW.net_pay_usd + NEW.income_tax_usd + NEW.pf_deduction_usd,
            'Monthly Payroll Expense for Emp #' || NEW.emp_id || ' (' || NEW.pay_period_month || '/' || NEW.pay_period_year || ')'
        );

        INSERT INTO double_entry_ledger (org_id, tx_reference, payroll_id, account_code, entry_type, amount_usd, narration)
        VALUES (
            NEW.org_id,
            v_tx_ref,
            NEW.payroll_id,
            '1010_PAYPAL_TREASURY_VAULT',
            'CREDIT',
            NEW.net_pay_usd,
            'PayPal Sandbox Payout Disbursed (Batch: ' || COALESCE(NEW.paypal_batch_id, 'N/A') || ')'
        );

        IF NEW.income_tax_usd > 0 THEN
            INSERT INTO double_entry_ledger (org_id, tx_reference, payroll_id, account_code, entry_type, amount_usd, narration)
            VALUES (
                NEW.org_id,
                v_tx_ref,
                NEW.payroll_id,
                '2100_INCOME_TAX_WITHHOLDING_PAYABLE',
                'CREDIT',
                NEW.income_tax_usd,
                'Statutory Tax Withheld at Source for Emp #' || NEW.emp_id
            );
        END IF;

        IF NEW.pf_deduction_usd > 0 THEN
            INSERT INTO double_entry_ledger (org_id, tx_reference, payroll_id, account_code, entry_type, amount_usd, narration)
            VALUES (
                NEW.org_id,
                v_tx_ref,
                NEW.payroll_id,
                '2150_PROVIDENT_FUND_TRUST_PAYABLE',
                'CREDIT',
                NEW.pf_deduction_usd,
                'Employee PF/Retirement Contribution for Emp #' || NEW.emp_id
            );
        END IF;

        INSERT INTO audit_logs (org_id, table_name, operation_type, record_id, actor_role, old_payload, new_payload)
        VALUES (
            NEW.org_id,
            'payroll_runs',
            'PAYPAL_SETTLEMENT_COMPLETED',
            NEW.payroll_id::TEXT,
            'PAYPAL_PAYOUTS_ENGINE',
            to_jsonb(OLD),
            to_jsonb(NEW)
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payroll_double_entry_and_audit ON payroll_runs;
CREATE TRIGGER trg_payroll_double_entry_and_audit
AFTER UPDATE OF payment_status ON payroll_runs
FOR EACH ROW
EXECUTE FUNCTION trg_fn_payroll_double_entry_and_audit();

-- ----------------------------------------------------------------------------
-- 5. TRIGGER 3: Salary Structure Modification Security Audit
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_fn_salary_audit_trail()
RETURNS TRIGGER AS $$
DECLARE
    v_org_id INT := 1;
BEGIN
    SELECT org_id INTO v_org_id FROM employees WHERE emp_id = NEW.emp_id;
    INSERT INTO audit_logs (org_id, table_name, operation_type, record_id, actor_role, old_payload, new_payload)
    VALUES (
        COALESCE(v_org_id, 1),
        'salary_structures',
        TG_OP,
        NEW.emp_id::TEXT,
        'CFO_COMPENSATION_GUARD',
        to_jsonb(OLD),
        to_jsonb(NEW)
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_salary_audit_trail ON salary_structures;
CREATE TRIGGER trg_salary_audit_trail
AFTER UPDATE ON salary_structures
FOR EACH ROW
EXECUTE FUNCTION trg_fn_salary_audit_trail();
