/* ============================================================================
 * VELTRIVA — Enterprise Treasury & Payroll OS Controller
 * ============================================================================ */

let state = {
  jwtToken: null,
  currentUser: null,
  activeOrgId: Number(localStorage.getItem('veltriva_org_id')) || 1,
  overview: null,
  gridApi: null
};

const VIEW_TITLES = {
  'view-payroll': 'Global Payroll & Disbursements',
  'view-escrow': 'Contractor Milestone Escrow',
  'view-attendance': 'Time, Shifts & Attendance Policy',
  'view-intelligence': 'Workforce Risk & Treasury Intelligence',
  'view-ledger': 'General Ledger, Audit Trail & SQL Studio'
};

const fmtUsd = (val) =>
  '$' +
  Number(val || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

function showToast(msg, isError = false) {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast-item ${isError ? 'toast-err' : ''}`;
  el.innerHTML = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

async function apiFetch(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.jwtToken) {
    headers.Authorization = `Bearer ${state.jwtToken}`;
  }
  const res = await fetch(url, { ...options, headers });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

function switchView(viewId) {
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === viewId);
  });
  document.querySelectorAll('.workspace-view').forEach((panel) => {
    panel.classList.toggle('active', panel.id === viewId);
  });
  const titleEl = document.getElementById('currentViewTitle');
  if (titleEl && VIEW_TITLES[viewId]) {
    titleEl.textContent = VIEW_TITLES[viewId];
  }
}

// ============================================================================
// 1. AUTHENTICATION, MULTI-TENANT WORKSPACE & DATA LOAD
// ============================================================================
async function authenticateWithRole(roleName = 'CFO_ADMIN', orgIdOverride = null) {
  try {
    const targetOrgId = Number(orgIdOverride || state.activeOrgId || 1);
    const authRes = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ org_id: targetOrgId, roleOverride: roleName })
    });
    state.jwtToken = authRes.token;
    state.currentUser = authRes.user;
    state.activeOrgId = Number(authRes.user?.org_id || 1);
    localStorage.setItem('veltriva_org_id', String(state.activeOrgId));
  } catch (err) {
    // Fallback to Demo Org #1 if saved orgId no longer exists
    if (state.activeOrgId !== 1) {
      state.activeOrgId = 1;
      localStorage.setItem('veltriva_org_id', '1');
      return authenticateWithRole(roleName, 1);
    }
    showToast(err.message, true);
  }
}

window.switchOrganization = async (orgId) => {
  const role = document.getElementById('rbacRoleSelect')?.value || 'CFO_ADMIN';
  await authenticateWithRole(role, orgId);
  await loadDashboardData();
  document.getElementById('orgAuthModal')?.classList.add('hidden');
  showToast(`Switched active workspace to <strong>${state.overview?.activeOrganization?.org_name || 'Organization'}</strong>`);
};

function renderWorkspaceContext(data) {
  const org = data.activeOrganization;
  if (org) {
    const orgNameEl = document.getElementById('sidebarOrgName');
    const orgTagEl = document.getElementById('sidebarOrgTag');
    const ownerLabelEl = document.getElementById('activeOwnerLabel');
    if (orgNameEl) orgNameEl.textContent = org.org_name;
    if (orgTagEl) {
      orgTagEl.textContent = org.is_demo_workspace
        ? 'DEMO SANDBOX • Click to create your own'
        : `${org.org_code} • Custom Workspace (${org.owner_name})`;
    }
    if (ownerLabelEl) {
      ownerLabelEl.textContent = `${org.owner_name} (${org.org_name})`;
    }
  }

  // Populate department dropdown in Onboard Employee modal with this org's cost centers
  const deptSelect = document.getElementById('onboardDept');
  if (deptSelect && Array.isArray(data.departmentBurn) && data.departmentBurn.length > 0) {
    deptSelect.innerHTML = data.departmentBurn
      .map((d) => `<option value="${d.dept_id}">${d.dept_name} (${d.dept_code})</option>`)
      .join('');
  }

  // Render quick switcher list inside Workspace Modal
  const orgListEl = document.getElementById('orgSwitchList');
  if (orgListEl && Array.isArray(data.organizations)) {
    orgListEl.innerHTML = data.organizations
      .map((o) => {
        const isCurrent = Number(o.org_id) === Number(state.activeOrgId);
        return `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 10px; border:1px solid ${
            isCurrent ? 'rgba(52,211,153,0.4)' : 'var(--border-hairline)'
          }; border-radius:6px; background:${isCurrent ? 'rgba(52,211,153,0.06)' : '#14151a'};">
            <div>
              <div style="font-size:12px; font-weight:600; color:#f4f4f5;">
                ${o.org_name}
                <code style="margin-left:4px;">${o.is_demo_workspace ? 'DEMO' : o.org_code}</code>
              </div>
              <div style="font-size:11px; color:#71717a;">${o.owner_name} &bull; ${o.owner_email}</div>
            </div>
            ${
              isCurrent
                ? `<span class="status-pill pill-paid" style="font-size:10.5px;">Active</span>`
                : `<button class="btn btn-secondary btn-xs" onclick="window.switchOrganization(${o.org_id})">Switch</button>`
            }
          </div>
        `;
      })
      .join('');
  }
}

async function loadDashboardData() {
  try {
    const data = await apiFetch('/api/dashboard/overview');
    state.overview = data;

    renderWorkspaceContext(data);
    renderKpis(data);
    renderAgGrid(data.employeesPayroll);
    renderDepartmentBurn(data.departmentBurn);
    renderBryntumGantt(data.milestones);
    renderAttendanceSection(data.employeesPayroll, data.attendanceLogs, data.leaveRequests);
    renderMlInsights(data.mlInsights);
    renderDbmsTables(data.trialBalance, data.auditLogs);
    updatePayPalConfigBadge(data.paypalStatus);
  } catch (err) {
    showToast(`Telemetry sync error: ${err.message}`, true);
  }
}

// ============================================================================
// 2. EXECUTIVE METRICS STRIP & COST CENTER ALLOCATION
// ============================================================================
function renderKpis(data) {
  const rows = data.employeesPayroll || [];
  const totalGross = rows.reduce((s, r) => s + Number(r.gross_pay_usd || 0), 0);
  const completedRows = rows.filter((r) => r.payment_status === 'COMPLETED');
  const pendingRows = rows.filter((r) => r.payment_status !== 'COMPLETED');

  const disbursedNet = completedRows.reduce((s, r) => s + Number(r.net_pay_usd || 0), 0);
  const pendingNet = pendingRows.reduce((s, r) => s + Number(r.net_pay_usd || 0), 0);

  document.getElementById('kpiGrossBurn').textContent = fmtUsd(totalGross);
  document.getElementById('kpiGrossFoot').textContent = `${rows.length} active workforce contracts`;

  document.getElementById('kpiDisbursed').textContent = fmtUsd(disbursedNet);
  document.getElementById('kpiDisbursedFoot').textContent = `${completedRows.length} of ${rows.length} disbursements settled`;

  document.getElementById('kpiPending').textContent = fmtUsd(pendingNet);
  document.getElementById('kpiPendingFoot').textContent = `${pendingRows.length} queued for PayPal execution`;
  document.getElementById('pendingCountBadge').textContent = pendingRows.length;
  document.getElementById('navPendingBadge').textContent = pendingRows.length;

  const tb = data.trialBalance || [];
  const totalDebit = tb.reduce((s, r) => s + Number(r.total_debit_usd || 0), 0);
  const totalCredit = tb.reduce((s, r) => s + Number(r.total_credit_usd || 0), 0);
  document.getElementById('kpiTrialBalance').textContent =
    Math.abs(totalDebit - totalCredit) < 0.01 ? '100% Balanced' : 'Variance Detected';
  document.getElementById('kpiTrialFoot').textContent = `Debits ${fmtUsd(totalDebit)} = Credits ${fmtUsd(totalCredit)}`;
}

function renderDepartmentBurn(deptBurn) {
  const container = document.getElementById('deptBurnContainer');
  container.innerHTML = deptBurn
    .map((d) => {
      const pct = Math.min(100, Number(d.budget_utilization_pct || 0));
      return `
      <div class="cost-row">
        <div class="cost-row-head">
          <span>${d.dept_name} <code>${d.dept_code}</code></span>
          <span style="font-family:var(--font-mono);">${fmtUsd(d.total_gross_burn_usd)} <span style="color:#71717a; font-weight:400;">/ ${fmtUsd(d.monthly_budget_usd)} (${pct}%)</span></span>
        </div>
        <div class="bar-rail">
          <div class="bar-fill" style="width:${pct}%"></div>
        </div>
        <div class="cost-row-foot">
          <span>Headcount: ${d.headcount} &bull; Overtime: ${d.total_overtime_hours} hrs</span>
          <span>Withholding: ${fmtUsd(d.total_statutory_withholding_usd)} &bull; Attrition Risk: ${d.avg_attrition_risk_pct}%</span>
        </div>
      </div>
    `;
    })
    .join('');
}

// ============================================================================
// 3. AG GRID GLOBAL PAYROLL LEDGER (ZERO TRUNCATION, CLEAN CARBON LAYOUT)
// ============================================================================
function renderAgGrid(rowData) {
  const gridDiv = document.getElementById('payrollAgGrid');

  const columnDefs = [
    {
      headerName: '',
      checkboxSelection: true,
      headerCheckboxSelection: true,
      width: 44,
      maxWidth: 44,
      pinned: 'left',
      sortable: false,
      filter: false
    },
    {
      field: 'emp_code',
      headerName: 'ID',
      width: 90,
      cellStyle: { fontFamily: 'JetBrains Mono', fontSize: '12px', color: '#a1a1aa' }
    },
    {
      field: 'full_name',
      headerName: 'Employee',
      minWidth: 200,
      flex: 1.4,
      cellRenderer: (p) => `
        <div style="display:flex; flex-direction:column; justify-content:center; line-height:1.25;">
          <div style="font-weight:600; color:#f4f4f5; font-size:12.5px;">
            ${p.value}
            <span style="font-family:JetBrains Mono; font-size:10px; color:#a1a1aa; border:1px solid rgba(255,255,255,0.12); padding:0 4px; border-radius:3px; margin-left:4px;">${p.data.country_code}</span>
          </div>
          <div style="font-size:11px; color:#71717a;">${p.data.designation}</div>
        </div>
      `
    },
    {
      field: 'dept_code',
      headerName: 'Cost Center',
      width: 115,
      cellRenderer: (p) => `<code>${p.value}</code>`
    },
    {
      field: 'paypal_email',
      headerName: 'PayPal Sandbox Recipient',
      minWidth: 215,
      flex: 1.3,
      cellStyle: { fontFamily: 'JetBrains Mono', fontSize: '11.5px', color: '#a1a1aa' }
    },
    {
      field: 'gross_pay_usd',
      headerName: 'Gross Pay',
      width: 118,
      valueFormatter: (p) => fmtUsd(p.value),
      cellStyle: { fontFamily: 'JetBrains Mono', fontVariantNumeric: 'tabular-nums' }
    },
    {
      headerName: 'Attendance Adj.',
      width: 128,
      valueGetter: (p) => Number(p.data.late_deduction_usd || 0) + Number(p.data.unpaid_leave_deduction_usd || 0),
      cellRenderer: (p) => {
        const val = Number(p.value || 0);
        if (val > 0) {
          return `<span style="color:#f43f5e; font-family:JetBrains Mono; font-size:12px;">-${fmtUsd(val)}</span>`;
        }
        return `<span style="color:#52525b; font-family:JetBrains Mono; font-size:12px;">$0.00</span>`;
      }
    },
    {
      headerName: 'Tax & PF',
      width: 115,
      valueGetter: (p) => Number(p.data.income_tax_usd || 0) + Number(p.data.pf_deduction_usd || 0),
      valueFormatter: (p) => '-' + fmtUsd(p.value),
      cellStyle: { fontFamily: 'JetBrains Mono', color: '#a1a1aa' }
    },
    {
      field: 'net_pay_usd',
      headerName: 'Net Payout',
      width: 125,
      cellStyle: { fontFamily: 'JetBrains Mono', fontWeight: '600', color: '#f4f4f5' },
      valueFormatter: (p) => fmtUsd(p.value)
    },
    {
      field: 'payment_status',
      headerName: 'Settlement Status',
      width: 155,
      cellRenderer: (p) => {
        if (p.value === 'COMPLETED') {
          return `<span class="status-pill pill-paid"><span class="status-dot dot-emerald"></span>Settled</span>`;
        }
        return `<span class="status-pill pill-pending"><span class="status-dot dot-amber"></span>Queued</span>`;
      }
    },
    {
      headerName: 'Operations',
      width: 245,
      pinned: 'right',
      sortable: false,
      filter: false,
      cellRenderer: (p) => {
        const payAction =
          p.data.payment_status !== 'COMPLETED'
            ? `<button class="btn btn-primary btn-xs" onclick="window.paySingleEmployee(${p.data.payroll_id})">Disburse</button>`
            : `<button class="btn btn-ghost btn-xs" disabled style="opacity:0.4; cursor:default;">Paid</button>`;
        return `
          <div style="display:flex; gap:5px; align-items:center;">
            ${payAction}
            <button class="btn btn-secondary btn-xs" onclick="window.openSalarySlip(${p.data.emp_id})">Paystub</button>
            <button class="btn btn-ghost btn-xs" onclick="window.openEditSalary(${p.data.emp_id})">Adjust</button>
            <button class="btn btn-ghost btn-xs" title="Remove employee" style="color:#f43f5e; padding:0 6px;" onclick="window.removeEmployee(${p.data.emp_id})">&times;</button>
          </div>
        `;
      }
    }
  ];

  if (state.gridApi) {
    state.gridApi.setGridOption('rowData', rowData);
    return;
  }

  const gridOptions = {
    columnDefs,
    rowData,
    rowSelection: 'multiple',
    suppressRowClickSelection: true,
    rowHeight: 52,
    headerHeight: 40,
    animateRows: true,
    defaultColDef: {
      sortable: true,
      filter: true,
      resizable: true
    }
  };

  state.gridApi = agGrid.createGrid(gridDiv, gridOptions);
}

// ============================================================================
// 4. PAYPAL PAYOUTS EXECUTION
// ============================================================================
async function executePayPalPayouts(payrollIds = []) {
  try {
    const res = await apiFetch('/api/paypal/payouts/execute', {
      method: 'POST',
      body: JSON.stringify({
        payrollIds,
        batchNote: 'Veltriva Treasury Payroll Settlement'
      })
    });

    document.getElementById('paypalTelemetryBox').textContent = JSON.stringify(
      {
        acidTransactionProtocol: res.acidProtocol,
        endpoint: res.payoutResult.apiEndpointUsed || 'POST /v1/payments/payouts',
        apimaticValidation: res.payoutResult.apimaticValidation,
        paypalBatchId: res.payoutResult.batchId,
        paypalSandboxResponse: res.payoutResult.rawResponse
      },
      null,
      2
    );

    showToast(res.message);
    await loadDashboardData();
  } catch (err) {
    showToast(err.message, true);
  }
}

window.paySingleEmployee = (payrollId) => {
  executePayPalPayouts([payrollId]);
};

// ============================================================================
// 5. CONTRACTOR MILESTONE ESCROW & TIMELINE
// ============================================================================
function renderBryntumGantt(milestones) {
  const body = document.getElementById('bryntumGanttBody');
  body.innerHTML = milestones
    .map((m) => {
      const startDay = Math.max(1, new Date(m.start_date).getDate());
      const dueDay = Math.min(14, new Date(m.due_date).getDate());
      const leftPct = Math.min(72, (startDay - 1) * 7.0);
      const widthPct = Math.max(22, (dueDay - startDay + 1) * 7.0);

      const isSettled = m.status === 'RELEASED_PAYPAL';
      const statusPill = isSettled
        ? `<span class="status-pill pill-paid">Released (${m.paypal_capture_id})</span>`
        : `<span class="status-pill pill-pending">${m.status}</span>`;

      const actionHtml = isSettled
        ? `<span style="font-family:var(--font-mono); font-size:11.5px; color:#71717a;">Order ${m.paypal_order_id}</span>`
        : `<button class="btn btn-primary btn-xs" onclick="window.releaseMilestoneEscrow(${m.milestone_id})">Release ${fmtUsd(m.escrow_amount_usd)}</button>`;

      return `
      <div class="gantt-item">
        <div>
          <div style="font-weight:600; color:#f4f4f5;">${m.milestone_title}</div>
          <div style="font-size:11.5px; color:#71717a; margin-top:2px;">${m.full_name} (<code>${m.emp_code}</code>) &bull; ${m.project_name}</div>
          <div style="font-size:11px; color:#a1a1aa; margin-top:3px;">${m.ai_verification_notes || ''}</div>
        </div>
        <div>
          <div style="font-family:var(--font-mono); font-weight:600;">${fmtUsd(m.escrow_amount_usd)}</div>
          <div style="font-size:11px; color:#a1a1aa; margin:2px 0 4px;">Verification Score: ${m.ai_verification_score}%</div>
          ${statusPill}
        </div>
        <div>
          <div class="gantt-track">
            <div class="gantt-pill ${isSettled ? 'settled' : ''}" style="left:${leftPct}%; width:${widthPct}%;">
              ${m.completion_pct}% &bull; ${m.start_date.slice(5)} to ${m.due_date.slice(5)}
            </div>
          </div>
        </div>
        <div style="text-align:right;">${actionHtml}</div>
      </div>
    `;
    })
    .join('');
}

window.releaseMilestoneEscrow = async (milestoneId) => {
  try {
    const res = await apiFetch(`/api/paypal/milestones/${milestoneId}/release`, {
      method: 'POST'
    });
    document.getElementById('paypalTelemetryBox').textContent = JSON.stringify(res.captureResult, null, 2);
    showToast(res.message);
    await loadDashboardData();
  } catch (err) {
    showToast(err.message, true);
  }
};

// ============================================================================
// 6. TIME, SHIFTS & LEAVE LEDGER
// ============================================================================
function renderAttendanceSection(employees, logs, leaves = []) {
  const empOptionsHtml = employees
    .map((e) => `<option value="${e.emp_id}">${e.emp_code} — ${e.full_name} (${e.dept_code})</option>`)
    .join('');

  ['attEmpSelect', 'leaveEmpSelect', 'mileEmpSelect'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = empOptionsHtml;
  });

  const container = document.getElementById('attendanceTableContainer');
  container.innerHTML = `
    <table class="clean-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Employee</th>
          <th>Clock Window</th>
          <th>Hours / OT</th>
          <th>Policy Status</th>
          <th>Anomaly Index</th>
        </tr>
      </thead>
      <tbody>
        ${logs
          .map(
            (l) => `
          <tr>
            <td style="font-family:var(--font-mono); color:#a1a1aa;">${String(l.work_date).slice(0, 10)}</td>
            <td><strong>${l.full_name}</strong> <code>${l.emp_code}</code></td>
            <td style="font-family:var(--font-mono);">${l.check_in_time} – ${l.check_out_time}</td>
            <td style="font-family:var(--font-mono);">${l.hours_worked}h <span style="color:#71717a;">(OT: ${l.overtime_hours}h)</span></td>
            <td>${
              l.is_late
                ? '<span style="color:#f43f5e; font-weight:500;">Late Arrival (&gt;09:15)</span>'
                : '<span style="color:#34d399;">Compliant</span>'
            }</td>
            <td style="font-family:var(--font-mono); color:${Number(l.anomaly_score) > 50 ? '#f43f5e' : '#a1a1aa'};">
              ${l.anomaly_score}%
            </td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;

  const leaveBox = document.getElementById('leaveTableContainer');
  if (leaveBox) {
    leaveBox.innerHTML = `
      <table class="clean-table">
        <thead>
          <tr>
            <th>Employee</th>
            <th>Category</th>
            <th>Dates</th>
            <th>Days</th>
            <th>Payroll Impact</th>
          </tr>
        </thead>
        <tbody>
          ${leaves
            .map(
              (lv) => `
            <tr>
              <td><strong>${lv.full_name}</strong> <code>${lv.emp_code}</code></td>
              <td><code>${lv.leave_type}</code></td>
              <td style="font-family:var(--font-mono); color:#a1a1aa;">${String(lv.start_date).slice(0, 10)} → ${String(lv.end_date).slice(0, 10)}</td>
              <td style="font-family:var(--font-mono);">${lv.days_count}d</td>
              <td>${
                lv.is_paid
                  ? '<span style="color:#34d399;">Paid Leave (No Cut)</span>'
                  : '<span style="color:#f43f5e; font-weight:500;">Unpaid LWP (Salary Deducted)</span>'
              }</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    `;
  }
}

// ============================================================================
// 7. WORKFORCE RISK & ML TELEMETRY
// ============================================================================
function renderMlInsights(ml) {
  if (!ml) return;
  const meta = ml.modelMetadata;
  document.getElementById('mlMetricsCards').innerHTML = `
    <div class="ml-stat-card">
      <div class="ml-stat-title">Attrition Classifier (Logistic + k-NN)</div>
      <div class="ml-stat-val">F1 ${meta.supervisedClassification.f1Score} &bull; AUC ${meta.supervisedClassification.rocAuc}</div>
    </div>
    <div class="ml-stat-card">
      <div class="ml-stat-title">Next Cycle Burn Forecast (Linear R²=${meta.supervisedRegression.rSquared})</div>
      <div class="ml-stat-val">${fmtUsd(meta.supervisedRegression.predictedNextMonthGrossUsd)}</div>
    </div>
    <div class="ml-stat-card">
      <div class="ml-stat-title">Workforce Segmentation (k-Means k=3)</div>
      <div class="ml-stat-val">Silhouette ${meta.unsupervisedClustering.silhouetteScore}</div>
    </div>
  `;

  document.getElementById('mlPredictionsTable').innerHTML = `
    <table class="clean-table">
      <thead>
        <tr>
          <th>Employee</th>
          <th>Feature Vector [OT, Pay, Late]</th>
          <th>Attrition Probability</th>
          <th>Cluster Segment</th>
          <th>Audit Status</th>
        </tr>
      </thead>
      <tbody>
        ${ml.predictions
          .map(
            (p) => `
          <tr>
            <td><strong>${p.full_name}</strong> <code>${p.emp_code}</code></td>
            <td style="font-family:var(--font-mono); color:#a1a1aa;">[${p.normalizedFeatures.overtimeScaled}, ${p.normalizedFeatures.compensationScaled}, ${p.normalizedFeatures.latenessScaled}]</td>
            <td style="font-family:var(--font-mono); font-weight:600; color:${p.predictedAttritionPct >= 45 ? '#f43f5e' : '#34d399'};">${p.predictedAttritionPct}%</td>
            <td><code>${p.assignedCluster}</code></td>
            <td style="color:#a1a1aa;">${p.aiAuditStatus}</td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

// ============================================================================
// 8. GENERAL LEDGER, AUDIT LOGS & SQL STUDIO
// ============================================================================
function renderDbmsTables(trialBalance, auditLogs) {
  document.getElementById('trialBalanceBox').innerHTML = `
    <table class="clean-table">
      <thead>
        <tr>
          <th>Account Code</th>
          <th>Total Debits</th>
          <th>Total Credits</th>
          <th>Entries</th>
        </tr>
      </thead>
      <tbody>
        ${trialBalance
          .map(
            (r) => `
          <tr>
            <td><code>${r.account_code}</code></td>
            <td style="font-family:var(--font-mono);">${fmtUsd(r.total_debit_usd)}</td>
            <td style="font-family:var(--font-mono); color:#34d399;">${fmtUsd(r.total_credit_usd)}</td>
            <td style="font-family:var(--font-mono); color:#a1a1aa;">${r.posting_count}</td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;

  document.getElementById('auditLogsBox').innerHTML = `
    <table class="clean-table">
      <thead>
        <tr>
          <th>Audit ID</th>
          <th>Entity</th>
          <th>Event Type</th>
          <th>Record Ref</th>
          <th>Timestamp</th>
        </tr>
      </thead>
      <tbody>
        ${auditLogs
          .map(
            (a) => `
          <tr>
            <td style="font-family:var(--font-mono); color:#71717a;">#${a.audit_id}</td>
            <td><code>${a.table_name}</code></td>
            <td style="font-weight:500;">${a.operation_type}</td>
            <td style="font-family:var(--font-mono); color:#a1a1aa;">ID ${a.record_id}</td>
            <td style="font-family:var(--font-mono); color:#71717a;">${new Date(a.changed_at).toLocaleTimeString()}</td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

async function executeLiveSql(sqlText) {
  const metaBar = document.getElementById('sqlMetaBar');
  const container = document.getElementById('sqlResultContainer');
  try {
    const res = await apiFetch('/api/dbms/sql-explorer', {
      method: 'POST',
      body: JSON.stringify({ sql: sqlText })
    });

    metaBar.textContent = `Query completed in ${res.durationMs}ms (${res.rowCount} rows)`;
    if (res.rows.length === 0) {
      container.innerHTML = `<div style="padding:16px 20px; color:#71717a;">0 rows returned.</div>`;
      return;
    }

    const cols = res.fields.length ? res.fields : Object.keys(res.rows[0]);
    container.innerHTML = `
      <table class="clean-table">
        <thead>
          <tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${res.rows
            .map(
              (row) =>
                `<tr>${cols
                  .map(
                    (c) =>
                      `<td style="font-family:var(--font-mono); font-size:11.5px;">${
                        typeof row[c] === 'object' && row[c] !== null ? JSON.stringify(row[c]) : row[c] ?? 'NULL'
                      }</td>`
                  )
                  .join('')}</tr>`
            )
            .join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    metaBar.textContent = `Execution Error: ${err.message}`;
  }
}

// ============================================================================
// 9. PAYSTUB MODAL & SALARY ADJUSTMENT MODAL
// ============================================================================
window.openSalarySlip = (empId) => {
  const emp = (state.overview?.employeesPayroll || []).find((e) => Number(e.emp_id) === Number(empId));
  if (!emp) return;

  const otPay = (Number(emp.overtime_hours || 0) * Number(emp.hourly_overtime_rate_usd || 0)).toFixed(2);
  const body = document.getElementById('slipModalBody');
  body.innerHTML = `
    <div style="border:1px solid var(--border-hairline); border-radius:8px; padding:20px; background:#0c0d10;">
      <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-hairline); padding-bottom:14px; margin-bottom:16px;">
        <div>
          <div style="font-size:15px; font-weight:700; color:#f4f4f5;">VELTRIVA TREASURY</div>
          <div style="font-size:11.5px; color:#71717a;">Statutory Remittance &amp; Tax Withholding Statement &bull; Nov 2026</div>
        </div>
        <div style="text-align:right; font-family:var(--font-mono); font-size:11.5px; color:#a1a1aa;">
          <div>Statement: <strong>SLIP-202611-${emp.emp_code}</strong></div>
          <div>PayPal Ref: <strong>${emp.paypal_transaction_id || 'QUEUED'}</strong></div>
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px 16px; font-size:12px; margin-bottom:18px; color:#a1a1aa;">
        <div>Employee: <strong style="color:#f4f4f5;">${emp.full_name}</strong> (<code>${emp.emp_code}</code>)</div>
        <div>Cost Center: <strong style="color:#f4f4f5;">${emp.dept_name}</strong></div>
        <div>Role: <strong style="color:#f4f4f5;">${emp.designation}</strong></div>
        <div>PayPal Wallet: <code>${emp.paypal_email}</code></div>
        <div>Attendance: <strong style="color:#f4f4f5;">${emp.present_days}/${emp.working_days}d</strong> (Late: ${emp.late_marks_count}, LWP: ${emp.unpaid_leave_days}d)</div>
        <div>Tax Jurisdiction: <strong style="color:#f4f4f5;">${emp.country_code} Statutory Slab</strong></div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
        <table class="clean-table" style="border:1px solid var(--border-hairline);">
          <thead><tr><th>Earnings</th><th>Amount</th></tr></thead>
          <tbody>
            <tr><td>Base Salary</td><td style="font-family:var(--font-mono);">${fmtUsd(emp.base_salary_usd)}</td></tr>
            <tr><td>Housing Allowance (HRA)</td><td style="font-family:var(--font-mono);">${fmtUsd(emp.hra_allowance_usd)}</td></tr>
            <tr><td>Special Allowance</td><td style="font-family:var(--font-mono);">${fmtUsd(emp.special_allowance_usd)}</td></tr>
            <tr><td>Overtime (${emp.overtime_hours}h @ $${emp.hourly_overtime_rate_usd}/h)</td><td style="font-family:var(--font-mono);">${fmtUsd(otPay)}</td></tr>
            <tr><td>Performance Bonus</td><td style="font-family:var(--font-mono);">${fmtUsd(emp.ai_performance_bonus_usd)}</td></tr>
            <tr style="font-weight:600; background:#14151a;"><td>Gross Compensation</td><td style="font-family:var(--font-mono);">${fmtUsd(emp.gross_pay_usd)}</td></tr>
          </tbody>
        </table>

        <table class="clean-table" style="border:1px solid var(--border-hairline);">
          <thead><tr><th>Deductions &amp; Taxes</th><th>Amount</th></tr></thead>
          <tbody>
            <tr><td>Income Tax Withholding (${emp.country_code})</td><td style="font-family:var(--font-mono);">-${fmtUsd(emp.income_tax_usd)}</td></tr>
            <tr><td>Retirement / PF (${emp.pf_contribution_pct}%)</td><td style="font-family:var(--font-mono);">-${fmtUsd(emp.pf_deduction_usd)}</td></tr>
            <tr><td>Late Arrival Deduction (${emp.late_marks_count} marks)</td><td style="font-family:var(--font-mono); color:#f43f5e;">-${fmtUsd(emp.late_deduction_usd)}</td></tr>
            <tr><td>Unpaid Leave (${emp.unpaid_leave_days}d LWP)</td><td style="font-family:var(--font-mono); color:#f43f5e;">-${fmtUsd(emp.unpaid_leave_deduction_usd)}</td></tr>
            <tr style="font-weight:600; background:#14151a; color:#34d399;"><td>Net PayPal Payout</td><td style="font-family:var(--font-mono);">${fmtUsd(emp.net_pay_usd)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
  document.getElementById('slipModal').classList.remove('hidden');
};

window.openEditSalary = (empId) => {
  const emp = (state.overview?.employeesPayroll || []).find((e) => Number(e.emp_id) === Number(empId));
  if (!emp) return;
  document.getElementById('editSalEmpId').value = emp.emp_id;
  document.getElementById('editSalEmpName').value = `${emp.emp_code} — ${emp.full_name}`;
  document.getElementById('editSalBase').value = emp.base_salary_usd;
  document.getElementById('editSalOtRate').value = emp.hourly_overtime_rate_usd;
  document.getElementById('editSalBonus').value = emp.ai_performance_bonus_usd || 500;
  document.getElementById('salaryEditModal').classList.remove('hidden');
};

function updatePayPalConfigBadge(status) {
  if (!status) return;
  const dot = document.getElementById('paypalLiveDot');
  dot.className = `status-dot ${status.connectedToLiveSandbox ? 'dot-emerald' : 'dot-amber'}`;
  const sub = document.getElementById('sidebarPayPalSub');
  if (sub) {
    sub.textContent = status.connectedToLiveSandbox ? 'Live • api-m.sandbox.paypal.com' : 'Sandbox Emulator Active';
  }
  const statusBox = document.getElementById('paypalConfigStatusBox');
  if (statusBox) {
    statusBox.innerHTML = `
      <div>Status: <strong>${status.statusLabel}</strong></div>
      <div>Schema: ${status.apimaticContextVersion}</div>
      <div>Client ID: ${status.clientIdPreview}</div>
    `;
  }
}

// ============================================================================
// 10. AI COPILOT & EVENT BINDINGS
// ============================================================================
async function sendCopilotMessage(promptText) {
  const chatBox = document.getElementById('copilotChatBox');
  const userDiv = document.createElement('div');
  userDiv.className = 'msg-bubble msg-user';
  userDiv.textContent = promptText;
  chatBox.appendChild(userDiv);

  try {
    const res = await apiFetch('/api/ai/copilot', {
      method: 'POST',
      body: JSON.stringify({ prompt: promptText })
    });

    const aiDiv = document.createElement('div');
    aiDiv.className = 'msg-bubble msg-ai';
    const formattedReply = res.reply
      .replace(/### (.*)/g, '<div style="font-weight:600; color:#f4f4f5; margin-bottom:6px;">$1</div>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br/>');

    aiDiv.innerHTML = `
      <div>${formattedReply}</div>
      <div style="margin-top:8px; padding-top:6px; border-top:1px solid var(--border-hairline); font-family:var(--font-mono); font-size:11px; color:#71717a;">
        SQL Trace: ${res.sqlExecuted}
      </div>
    `;
    chatBox.appendChild(aiDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
  } catch (err) {
    showToast(err.message, true);
  }
}

window.removeEmployee = async (empId) => {
  try {
    const res = await apiFetch(`/api/dbms/employees/${empId}`, { method: 'DELETE' });
    showToast(res.message);
    await loadDashboardData();
  } catch (err) {
    showToast(err.message, true);
  }
};

document.addEventListener('DOMContentLoaded', async () => {
  await authenticateWithRole('CFO_ADMIN');
  await loadDashboardData();

  // Only auto-reset demo pending rows if we are inside the Demo Sandbox and all demo rows were previously completed
  const allRows = state.overview?.employeesPayroll || [];
  const pendingCount = allRows.filter((r) => r.payment_status !== 'COMPLETED').length;
  if (state.overview?.activeOrganization?.is_demo_workspace && allRows.length > 0 && pendingCount === 0) {
    await apiFetch('/api/demo/reset-pending', { method: 'POST' });
    await loadDashboardData();
  }

  await executeLiveSql(document.getElementById('sqlQueryInput').value);
  await sendCopilotMessage('Give me an executive CFO briefing on November 2026 PayPal payouts and next month ML burn forecast.');

  // Multi-Tenant Workspace & Account Modal
  const openOrgModal = () => document.getElementById('orgAuthModal')?.classList.remove('hidden');
  document.getElementById('btnOpenWorkspaceModal')?.addEventListener('click', openOrgModal);
  document.getElementById('btnNewBlankOrgSidebar')?.addEventListener('click', openOrgModal);
  document.getElementById('btnCloseOrgModal')?.addEventListener('click', () => {
    document.getElementById('orgAuthModal')?.classList.add('hidden');
  });

  // Register a 100% Blank Organization Workspace (Zero Sample Data, Own PayPal Keys)
  document.getElementById('registerOrgForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await apiFetch('/api/auth/register-org', {
        method: 'POST',
        body: JSON.stringify({
          org_name: document.getElementById('regOrgName').value,
          owner_name: document.getElementById('regOwnerName').value,
          owner_email: document.getElementById('regOwnerEmail').value,
          password: document.getElementById('regPassword').value,
          paypal_client_id: document.getElementById('regPayPalId').value,
          paypal_client_secret: document.getElementById('regPayPalSecret').value
        })
      });
      state.jwtToken = res.token;
      state.currentUser = res.user;
      state.activeOrgId = Number(res.organization.org_id);
      localStorage.setItem('veltriva_org_id', String(state.activeOrgId));
      document.getElementById('orgAuthModal')?.classList.add('hidden');
      document.getElementById('registerOrgForm').reset();
      showToast(res.message);
      await loadDashboardData();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // Sign In to Existing Organization
  document.getElementById('loginOrgForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: document.getElementById('loginEmailInput').value,
          password: document.getElementById('loginPasswordInput').value
        })
      });
      state.jwtToken = res.token;
      state.currentUser = res.user;
      state.activeOrgId = Number(res.user.org_id || 1);
      localStorage.setItem('veltriva_org_id', String(state.activeOrgId));
      document.getElementById('orgAuthModal')?.classList.add('hidden');
      showToast(`Signed in to <strong>${res.user.org_name}</strong> as ${res.user.full_name}`);
      await loadDashboardData();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // Clear All Employees / Sample Data in Active Workspace
  document.getElementById('btnClearWorkspace')?.addEventListener('click', async () => {
    try {
      const res = await apiFetch('/api/workspace/clear', { method: 'DELETE' });
      showToast(res.message);
      await loadDashboardData();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // Sidebar Navigation
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  document.getElementById('btnOpenCopilotDrawer').addEventListener('click', () => {
    switchView('view-intelligence');
  });

  // RBAC Switcher
  document.getElementById('rbacRoleSelect').addEventListener('change', async (e) => {
    await authenticateWithRole(e.target.value);
    showToast(`Switched active session role to <strong>${e.target.value}</strong>`);
  });

  // AG Grid Filter & CSV Export
  document.getElementById('agQuickFilter').addEventListener('input', (e) => {
    if (state.gridApi) state.gridApi.setGridOption('quickFilterText', e.target.value);
  });

  document.getElementById('btnExportCsv').addEventListener('click', () => {
    if (state.gridApi) state.gridApi.exportDataAsCsv({ fileName: 'Veltriva_PayPal_Payroll_Register.csv' });
  });

  // Batch Payouts
  document.getElementById('btnBatchPayoutTop').addEventListener('click', () => executePayPalPayouts([]));
  document.getElementById('btnDisburseSelected').addEventListener('click', () => {
    if (!state.gridApi) return;
    const selected = state.gridApi.getSelectedRows();
    if (selected.length === 0) {
      showToast('Select one or more rows in the table first.', true);
      return;
    }
    executePayPalPayouts(selected.map((r) => r.payroll_id));
  });

  // Reset Cycle
  document.getElementById('btnResetDemo').addEventListener('click', async () => {
    const res = await apiFetch('/api/demo/reset-pending', { method: 'POST' });
    showToast(res.message);
    await loadDashboardData();
  });

  // Attendance Form
  document.getElementById('attendanceForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await apiFetch('/api/dbms/attendance', {
        method: 'POST',
        body: JSON.stringify({
          emp_id: document.getElementById('attEmpSelect').value,
          work_date: document.getElementById('attDate').value,
          shift_code: document.getElementById('attShift').value,
          check_in_time: document.getElementById('attCheckIn').value + ':00',
          check_out_time: document.getElementById('attCheckOut').value + ':00',
          notes: document.getElementById('attNotes').value
        })
      });
      showToast(res.message);
      await loadDashboardData();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // Copilot
  document.getElementById('copilotForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('copilotInput');
    if (input.value.trim()) {
      sendCopilotMessage(input.value.trim());
      input.value = '';
    }
  });

  document.querySelectorAll('.prompt-pill:not(.sql-preset)').forEach((pill) => {
    pill.addEventListener('click', () => sendCopilotMessage(pill.dataset.prompt));
  });

  // SQL Runner
  document.getElementById('btnRunSql').addEventListener('click', () => {
    executeLiveSql(document.getElementById('sqlQueryInput').value);
  });

  document.querySelectorAll('.sql-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById('sqlQueryInput').value = btn.dataset.sql;
      executeLiveSql(btn.dataset.sql);
    });
  });

  // Modals
  document.getElementById('btnCloseSlip').addEventListener('click', () => {
    document.getElementById('slipModal').classList.add('hidden');
  });
  document.getElementById('btnPrintSlip').addEventListener('click', () => window.print());

  document.getElementById('btnPayPalConfig').addEventListener('click', () => {
    document.getElementById('paypalModal').classList.remove('hidden');
  });
  document.getElementById('btnClosePayPalModal').addEventListener('click', () => {
    document.getElementById('paypalModal').classList.add('hidden');
  });
  document.getElementById('paypalConfigForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await apiFetch('/api/paypal/config', {
      method: 'POST',
      body: JSON.stringify({
        clientId: document.getElementById('inputPayPalClientId').value,
        clientSecret: document.getElementById('inputPayPalClientSecret').value
      })
    });
    updatePayPalConfigBadge(res.status);
    showToast(res.message);
  });

  document.getElementById('btnCloseSalaryModal').addEventListener('click', () => {
    document.getElementById('salaryEditModal').classList.add('hidden');
  });
  document.getElementById('salaryEditForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const empId = document.getElementById('editSalEmpId').value;
      const res = await apiFetch(`/api/dbms/salary/${empId}`, {
        method: 'PUT',
        body: JSON.stringify({
          base_salary_usd: document.getElementById('editSalBase').value,
          hourly_overtime_rate_usd: document.getElementById('editSalOtRate').value,
          bonus_usd: document.getElementById('editSalBonus').value
        })
      });
      document.getElementById('salaryEditModal').classList.add('hidden');
      showToast(res.message);
      await loadDashboardData();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // Onboard Employee Modal
  document.getElementById('btnOpenOnboardModal').addEventListener('click', () => {
    document.getElementById('onboardModal').classList.remove('hidden');
  });
  document.getElementById('btnCloseOnboardModal').addEventListener('click', () => {
    document.getElementById('onboardModal').classList.add('hidden');
  });
  document.getElementById('onboardForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const empType = document.getElementById('onboardType').value;
      const res = await apiFetch('/api/dbms/employees', {
        method: 'POST',
        body: JSON.stringify({
          full_name: document.getElementById('onboardName').value,
          email: document.getElementById('onboardEmail').value,
          paypal_email: document.getElementById('onboardPayPal').value,
          designation: document.getElementById('onboardTitle').value,
          dept_id: Number(document.getElementById('onboardDept').value),
          role_id: empType === 'CONTRACTOR' ? 5 : 4,
          employment_type: empType,
          country_code: document.getElementById('onboardCountry').value,
          base_salary_usd: Number(document.getElementById('onboardBase').value),
          hra_allowance_usd: Number(document.getElementById('onboardHra').value),
          special_allowance_usd: Number(document.getElementById('onboardSpecial').value),
          hourly_overtime_rate_usd: 65
        })
      });
      document.getElementById('onboardModal').classList.add('hidden');
      document.getElementById('onboardForm').reset();
      showToast(res.message);
      await loadDashboardData();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // Create Milestone Escrow Modal
  document.getElementById('btnOpenMilestoneModal').addEventListener('click', () => {
    document.getElementById('milestoneModal').classList.remove('hidden');
  });
  document.getElementById('btnCloseMilestoneModal').addEventListener('click', () => {
    document.getElementById('milestoneModal').classList.add('hidden');
  });
  document.getElementById('milestoneForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await apiFetch('/api/dbms/milestones', {
        method: 'POST',
        body: JSON.stringify({
          emp_id: document.getElementById('mileEmpSelect').value,
          project_name: document.getElementById('mileProject').value,
          milestone_title: document.getElementById('mileTitle').value,
          start_date: document.getElementById('mileStart').value,
          due_date: document.getElementById('mileDue').value,
          escrow_amount_usd: document.getElementById('mileAmount').value,
          deliverable_url: document.getElementById('mileUrl').value
        })
      });
      document.getElementById('milestoneModal').classList.add('hidden');
      showToast(res.message);
      await loadDashboardData();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // Leave / Unpaid Absence Form
  document.getElementById('leaveForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await apiFetch('/api/dbms/leaves', {
        method: 'POST',
        body: JSON.stringify({
          emp_id: document.getElementById('leaveEmpSelect').value,
          leave_type: document.getElementById('leaveTypeSelect').value,
          start_date: document.getElementById('leaveStartDate').value,
          end_date: document.getElementById('leaveEndDate').value,
          days_count: document.getElementById('leaveDaysCount').value,
          reason: document.getElementById('leaveReason').value
        })
      });
      showToast(res.message);
      await loadDashboardData();
    } catch (err) {
      showToast(err.message, true);
    }
  });
});
