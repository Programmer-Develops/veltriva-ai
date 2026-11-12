import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  LayoutGrid,
  Milestone,
  Clock,
  Cpu,
  Database,
  LogOut,
  Plus,
  Search,
  Download,
  Trash2,
  RotateCcw,
  Send,
  Building2
} from 'lucide-react';
import AuthGate from './components/AuthGate.jsx';

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

export default function App() {
  const [jwtToken, setJwtToken] = useState(() => localStorage.getItem('veltriva_jwt') || null);
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('veltriva_user') || 'null');
    } catch {
      return null;
    }
  });
  const [showAuthScreen, setShowAuthScreen] = useState(false);

  const [activeView, setActiveView] = useState('view-payroll');
  const [overview, setOverview] = useState(null);
  const [quickFilter, setQuickFilter] = useState('');
  const [toasts, setToasts] = useState([]);
  const [telemetryJson, setTelemetryJson] = useState(
    '// Select rows and click Disburse Selected or Execute Batch Payouts to inspect live PayPal REST API & ACID transaction telemetry.'
  );

  // Modals
  const [slipEmp, setSlipEmp] = useState(null);
  const [editSalEmp, setEditSalEmp] = useState(null);
  const [showPayPalModal, setShowPayPalModal] = useState(false);
  const [showOnboardModal, setShowOnboardModal] = useState(false);
  const [showMilestoneModal, setShowMilestoneModal] = useState(false);
  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);

  // Copilot Chat
  const [chatMessages, setChatMessages] = useState([]);
  const [copilotInput, setCopilotInput] = useState('');
  const [copilotLoading, setCopilotLoading] = useState(false);

  // SQL Studio
  const [sqlInput, setSqlInput] = useState(
    'SELECT emp_code, full_name, dept_code, gross_pay_usd, late_deduction_usd, income_tax_usd, net_pay_usd, dept_earner_rank, payment_status FROM vw_employee_360_payroll ORDER BY dept_code, dept_earner_rank;'
  );
  const [sqlResult, setSqlResult] = useState({ rows: [], fields: [], durationMs: 0, rowCount: 0, error: null });

  const gridRef = useRef(null);

  const showToast = useCallback((msg, isError = false) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, msg, isError }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  const apiFetch = useCallback(
    async (url, options = {}, tokenOverride = null) => {
      const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
      const activeTok = tokenOverride || jwtToken;
      if (activeTok) {
        headers.Authorization = `Bearer ${activeTok}`;
      }
      const res = await fetch(url, { ...options, headers });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      return data;
    },
    [jwtToken]
  );

  const loadDashboardData = useCallback(
    async (tokenOverride = null) => {
      try {
        const data = await apiFetch('/api/dashboard/overview', {}, tokenOverride);
        setOverview(data);
        return data;
      } catch (err) {
        showToast(`Sync error: ${err.message}`, true);
        return null;
      }
    },
    [apiFetch, showToast]
  );

  const executeLiveSql = useCallback(
    async (sqlText, tokenOverride = null) => {
      try {
        const res = await apiFetch(
          '/api/dbms/sql-explorer',
          {
            method: 'POST',
            body: JSON.stringify({ sql: sqlText })
          },
          tokenOverride
        );
        setSqlResult({
          rows: res.rows || [],
          fields: res.fields?.length ? res.fields : Object.keys(res.rows?.[0] || {}),
          durationMs: res.durationMs,
          rowCount: res.rowCount,
          error: null
        });
      } catch (err) {
        setSqlResult((prev) => ({ ...prev, error: err.message }));
      }
    },
    [apiFetch]
  );

  const sendCopilotMessage = useCallback(
    async (promptText, tokenOverride = null) => {
      setChatMessages((prev) => [...prev, { role: 'user', text: promptText }]);
      setCopilotLoading(true);
      try {
        const res = await apiFetch(
          '/api/ai/copilot',
          {
            method: 'POST',
            body: JSON.stringify({ prompt: promptText })
          },
          tokenOverride
        );
        setChatMessages((prev) => [
          ...prev,
          {
            role: 'ai',
            text: res.reply,
            source: res.source,
            sqlExecuted: res.sqlExecuted
          }
        ]);
      } catch (err) {
        showToast(err.message, true);
      } finally {
        setCopilotLoading(false);
      }
    },
    [apiFetch, showToast]
  );

  // Initial session bootstrap (auto-connects Demo Sandbox on first visit unless user signed out)
  useEffect(() => {
    async function bootstrap() {
      if (showAuthScreen) return;
      let tok = jwtToken;
      if (!tok) {
        try {
          const authRes = await apiFetch('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ org_id: 1, roleOverride: 'CFO_ADMIN' })
          });
          tok = authRes.token;
          setJwtToken(authRes.token);
          setCurrentUser(authRes.user);
          localStorage.setItem('veltriva_jwt', authRes.token);
          localStorage.setItem('veltriva_user', JSON.stringify(authRes.user));
        } catch (err) {
          setShowAuthScreen(true);
          return;
        }
      }

      let data = await loadDashboardData(tok);
      if (data) {
        const rows = data.employeesPayroll || [];
        const pendingCount = rows.filter((r) => r.payment_status !== 'COMPLETED').length;
        if (data.activeOrganization?.is_demo_workspace && rows.length > 0 && pendingCount === 0) {
          await apiFetch('/api/demo/reset-pending', { method: 'POST' }, tok);
          data = await loadDashboardData(tok);
        }
        await executeLiveSql(sqlInput, tok);
        if (chatMessages.length === 0) {
          const allEmp = data?.employeesPayroll || [];
          const settled = allEmp.filter((r) => r.payment_status === 'COMPLETED');
          const queued = allEmp.filter((r) => r.payment_status !== 'COMPLETED');
          const settledUsd = settled.reduce((s, r) => s + Number(r.net_pay_usd || 0), 0);
          const queuedUsd = queued.reduce((s, r) => s + Number(r.net_pay_usd || 0), 0);
          setChatMessages([
            {
              role: 'ai',
              text: `Executive Treasury Briefing (${data?.activeOrganization?.org_name || 'Workspace'}):\n• Settled via PayPal Payouts API: ${settled.length} contracts ($${settledUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })})\n• Pending PayPal Disbursement Queue: ${queued.length} contracts ($${queuedUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })})\n• Ask any question below or click a prompt pill to run a live Gemini 3.5 Flash Lite RAG query over your PostgreSQL views.`,
              source: 'VELTRIVA_TREASURY_RAG_READY',
              sqlExecuted: 'SELECT * FROM vw_employee_360_payroll; SELECT * FROM vw_department_burn_analytics;'
            }
          ]);
        }
      }
    }
    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAuthScreen]);

  const handleAuthenticated = async (token, user) => {
    setJwtToken(token);
    setCurrentUser(user);
    localStorage.setItem('veltriva_jwt', token);
    localStorage.setItem('veltriva_user', JSON.stringify(user));
    setShowAuthScreen(false);
    setShowWorkspaceModal(false);
    await loadDashboardData(token);
  };

  const handleLogout = () => {
    localStorage.removeItem('veltriva_jwt');
    localStorage.removeItem('veltriva_user');
    setJwtToken(null);
    setCurrentUser(null);
    setShowAuthScreen(true);
    showToast('Signed out of active workspace session.');
  };

  const handleSwitchOrg = async (orgId) => {
    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ org_id: orgId, roleOverride: currentUser?.role_name || 'CFO_ADMIN' })
      });
      await handleAuthenticated(res.token, res.user);
      showToast(`Switched workspace to ${res.user.org_name}`);
    } catch (err) {
      showToast(err.message, true);
    }
  };

  const handleRoleChange = async (newRole) => {
    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ org_id: currentUser?.org_id || 1, roleOverride: newRole })
      });
      await handleAuthenticated(res.token, res.user);
      showToast(`RBAC session role switched to ${newRole}`);
    } catch (err) {
      showToast(err.message, true);
    }
  };

  // PayPal Payouts Execution
  const executePayPalPayouts = useCallback(
    async (payrollIds = []) => {
      try {
        const res = await apiFetch('/api/paypal/payouts/execute', {
          method: 'POST',
          body: JSON.stringify({
            payrollIds,
            batchNote: 'Veltriva Treasury Payroll Settlement'
          })
        });
        setTelemetryJson(
          JSON.stringify(
            {
              acidTransactionProtocol: res.acidProtocol,
              endpoint: res.payoutResult.apiEndpointUsed || 'POST /v1/payments/payouts',
              apimaticValidation: res.payoutResult.apimaticValidation,
              paypalBatchId: res.payoutResult.batchId,
              paypalSandboxResponse: res.payoutResult.rawResponse
            },
            null,
            2
          )
        );
        showToast(res.message);
        await loadDashboardData();
      } catch (err) {
        showToast(err.message, true);
      }
    },
    [apiFetch, loadDashboardData, showToast]
  );

  const handleRemoveEmployee = useCallback(
    async (empId) => {
      try {
        const res = await apiFetch(`/api/dbms/employees/${empId}`, { method: 'DELETE' });
        showToast(res.message);
        await loadDashboardData();
      } catch (err) {
        showToast(err.message, true);
      }
    },
    [apiFetch, loadDashboardData, showToast]
  );

  const handleClearWorkspace = async () => {
    try {
      const res = await apiFetch('/api/workspace/clear', { method: 'DELETE' });
      showToast(res.message);
      await loadDashboardData();
    } catch (err) {
      showToast(err.message, true);
    }
  };

  const handleResetDemo = async () => {
    try {
      const res = await apiFetch('/api/demo/reset-pending', { method: 'POST' });
      showToast(res.message);
      await loadDashboardData();
    } catch (err) {
      showToast(err.message, true);
    }
  };

  // AG Grid Columns
  const columnDefs = useMemo(
    () => [
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
        minWidth: 205,
        flex: 1.4,
        cellRenderer: (p) => (
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', lineHeight: 1.25 }}>
            <div style={{ fontWeight: 600, color: '#f4f4f5', fontSize: '12.5px' }}>
              {p.value}
              <span
                style={{
                  fontFamily: 'JetBrains Mono',
                  fontSize: '10px',
                  color: '#a1a1aa',
                  border: '1px solid rgba(255,255,255,0.12)',
                  padding: '0 4px',
                  borderRadius: '3px',
                  marginLeft: '5px'
                }}
              >
                {p.data.country_code}
              </span>
            </div>
            <div style={{ fontSize: '11px', color: '#71717a' }}>{p.data.designation}</div>
          </div>
        )
      },
      {
        field: 'dept_code',
        headerName: 'Cost Center',
        width: 115,
        cellRenderer: (p) => <code>{p.value}</code>
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
          return val > 0 ? (
            <span style={{ color: '#f43f5e', fontFamily: 'JetBrains Mono', fontSize: '12px' }}>-{fmtUsd(val)}</span>
          ) : (
            <span style={{ color: '#52525b', fontFamily: 'JetBrains Mono', fontSize: '12px' }}>$0.00</span>
          );
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
        cellStyle: { fontFamily: 'JetBrains Mono', fontWeight: 600, color: '#f4f4f5' },
        valueFormatter: (p) => fmtUsd(p.value)
      },
      {
        field: 'payment_status',
        headerName: 'Settlement Status',
        width: 145,
        cellRenderer: (p) =>
          p.value === 'COMPLETED' ? (
            <span className="status-pill pill-paid">
              <span className="status-dot dot-emerald" />
              Settled
            </span>
          ) : (
            <span className="status-pill pill-pending">
              <span className="status-dot dot-amber" />
              Queued
            </span>
          )
      },
      {
        headerName: 'Operations',
        width: 245,
        pinned: 'right',
        sortable: false,
        filter: false,
        cellRenderer: (p) => (
          <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
            {p.data.payment_status !== 'COMPLETED' ? (
              <button className="btn btn-primary btn-xs" onClick={() => executePayPalPayouts([p.data.payroll_id])}>
                Disburse
              </button>
            ) : (
              <button className="btn btn-ghost btn-xs" disabled style={{ opacity: 0.4, cursor: 'default' }}>
                Paid
              </button>
            )}
            <button className="btn btn-secondary btn-xs" onClick={() => setSlipEmp(p.data)}>
              Paystub
            </button>
            <button className="btn btn-ghost btn-xs" onClick={() => setEditSalEmp(p.data)}>
              Adjust
            </button>
            <button
              className="btn btn-ghost btn-xs"
              title="Remove employee"
              style={{ color: '#f43f5e', padding: '0 6px' }}
              onClick={() => handleRemoveEmployee(p.data.emp_id)}
            >
              &times;
            </button>
          </div>
        )
      }
    ],
    [executePayPalPayouts, handleRemoveEmployee]
  );

  // Show Authentication Gate if logged out
  if (showAuthScreen) {
    return (
      <>
        <AuthGate onAuthenticated={handleAuthenticated} apiFetch={apiFetch} showToast={showToast} />
        <div className="toast-stack">
          {toasts.map((t) => (
            <div key={t.id} className={`toast-item ${t.isError ? 'toast-err' : ''}`}>
              {t.msg}
            </div>
          ))}
        </div>
      </>
    );
  }

  const rows = overview?.employeesPayroll || [];
  const totalGross = rows.reduce((s, r) => s + Number(r.gross_pay_usd || 0), 0);
  const completedRows = rows.filter((r) => r.payment_status === 'COMPLETED');
  const pendingRows = rows.filter((r) => r.payment_status !== 'COMPLETED');
  const disbursedNet = completedRows.reduce((s, r) => s + Number(r.net_pay_usd || 0), 0);
  const pendingNet = pendingRows.reduce((s, r) => s + Number(r.net_pay_usd || 0), 0);

  const tb = overview?.trialBalance || [];
  const totalDebit = tb.reduce((s, r) => s + Number(r.total_debit_usd || 0), 0);
  const totalCredit = tb.reduce((s, r) => s + Number(r.total_credit_usd || 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  const activeOrg = overview?.activeOrganization;
  const paypalStatus = overview?.paypalStatus;

  return (
    <div className="app-shell">
      {/* LEFT SIDEBAR */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M4 5L12 19L20 5H16.2L12 12.6L7.8 5H4Z" fill="currentColor" />
            </svg>
          </div>
          <div className="brand-text">
            <span className="brand-title">VELTRIVA</span>
            <span className="brand-tier">REACT + VITE TREASURY OS</span>
          </div>
        </div>

        {/* Active Organization Switcher */}
        <div
          className="gateway-card"
          style={{ marginBottom: 14, background: '#14151a' }}
          onClick={() => setShowWorkspaceModal(true)}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '9.5px', fontWeight: 600, letterSpacing: '0.07em', color: '#71717a' }}>
              ACTIVE ORGANIZATION
            </span>
            <span style={{ fontSize: '10px', color: '#3b82f6', fontWeight: 600 }}>Switch / New</span>
          </div>
          <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#f4f4f5', marginTop: 3 }}>
            {activeOrg?.org_name || 'Veltriva Sandbox Corp'}
          </div>
          <div style={{ fontSize: '10.5px', color: '#a1a1aa', fontFamily: 'var(--font-mono)', marginTop: 1 }}>
            {activeOrg?.is_demo_workspace
              ? 'DEMO SANDBOX • Click for Blank Org'
              : `${activeOrg?.org_code} • ${activeOrg?.owner_name}`}
          </div>
        </div>

        <div className="sidebar-section-label">OPERATIONS</div>
        <nav className="sidebar-nav">
          <button
            className={`nav-item ${activeView === 'view-payroll' ? 'active' : ''}`}
            onClick={() => setActiveView('view-payroll')}
          >
            <LayoutGrid size={15} />
            <span>Global Payroll</span>
            <span className="nav-Counter">{pendingRows.length}</span>
          </button>
          <button
            className={`nav-item ${activeView === 'view-escrow' ? 'active' : ''}`}
            onClick={() => setActiveView('view-escrow')}
          >
            <Milestone size={15} />
            <span>Milestone Escrow</span>
          </button>
          <button
            className={`nav-item ${activeView === 'view-attendance' ? 'active' : ''}`}
            onClick={() => setActiveView('view-attendance')}
          >
            <Clock size={15} />
            <span>Time &amp; Shifts</span>
          </button>
        </nav>

        <div className="sidebar-section-label">INTELLIGENCE &amp; LEDGER</div>
        <nav className="sidebar-nav">
          <button
            className={`nav-item ${activeView === 'view-intelligence' ? 'active' : ''}`}
            onClick={() => setActiveView('view-intelligence')}
          >
            <Cpu size={15} />
            <span>Risk &amp; Forecasting</span>
          </button>
          <button
            className={`nav-item ${activeView === 'view-ledger' ? 'active' : ''}`}
            onClick={() => setActiveView('view-ledger')}
          >
            <Database size={15} />
            <span>General Ledger &amp; SQL</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="gateway-card" onClick={() => setShowPayPalModal(true)}>
            <div className="gateway-row">
              <span className={`status-dot ${paypalStatus?.connectedToLiveSandbox ? 'dot-emerald' : 'dot-amber'}`} />
              <span className="gateway-title">PayPal Gateway</span>
            </div>
            <div className="gateway-sub">
              {paypalStatus?.connectedToLiveSandbox
                ? 'Live • api-m.sandbox.paypal.com'
                : 'Zero-Key Sandbox Emulator'}
            </div>
          </div>

          <div className="user-session-box">
            <div className="session-label">ACCESS CONTROL (RBAC)</div>
            <select
              className="role-selector"
              value={currentUser?.role_name || 'CFO_ADMIN'}
              onChange={(e) => handleRoleChange(e.target.value)}
            >
              <option value="CFO_ADMIN">CFO — Full Treasury Authority</option>
              <option value="HR_DIRECTOR">HR Director — People &amp; Salary</option>
              <option value="ENGINEERING_LEAD">Eng Lead — Read-Only View</option>
            </select>
          </div>

          <button
            className="btn btn-ghost"
            onClick={handleLogout}
            style={{ width: '100%', justifyContent: 'center', color: '#fda4af' }}
          >
            <LogOut size={14} />
            <span>Sign Out / Auth Gate</span>
          </button>
        </div>
      </aside>

      {/* MAIN WORKSPACE */}
      <div className="main-area">
        {/* TOP HEADER */}
        <header className="top-header">
          <div className="header-breadcrumb">
            <span className="crumb-root">Treasury</span>
            <span className="crumb-sep">/</span>
            <span className="crumb-current">{VIEW_TITLES[activeView]}</span>
          </div>

          <div className="header-actions">
            <span style={{ fontSize: '11.5px', color: '#a1a1aa', marginRight: 4 }}>
              Account:{' '}
              <strong style={{ color: '#f4f4f5' }}>
                {activeOrg ? `${activeOrg.owner_name} (${activeOrg.org_name})` : 'Demo CFO'}
              </strong>
            </span>
            <button className="btn btn-secondary" onClick={() => setActiveView('view-intelligence')}>
              <Cpu size={14} />
              <span>AI Copilot</span>
            </button>
            <button className="btn btn-secondary" onClick={() => setShowWorkspaceModal(true)}>
              <Building2 size={14} />
              <span>+ New Blank Company</span>
            </button>
            <button className="btn btn-ghost" onClick={handleResetDemo}>
              <RotateCcw size={13} />
              <span>Reset Cycle</span>
            </button>
            <button className="btn btn-primary" onClick={() => executePayPalPayouts([])}>
              <span>Execute Batch Payouts</span>
              <span className="btn-badge">{pendingRows.length}</span>
            </button>
          </div>
        </header>

        {/* EXECUTIVE METRICS STRIP */}
        <section className="metrics-strip">
          <div className="metric-cell">
            <div className="metric-top">
              <span className="metric-label">Gross Payroll Commitment</span>
              <span className="metric-tag">Nov 2026</span>
            </div>
            <div className="metric-number">{fmtUsd(totalGross)}</div>
            <div className="metric-caption">{rows.length} active workforce contracts</div>
          </div>

          <div className="metric-cell">
            <div className="metric-top">
              <span className="metric-label">Settled via PayPal Payouts</span>
              <span className="metric-tag tag-emerald">Completed</span>
            </div>
            <div className="metric-number text-emerald">{fmtUsd(disbursedNet)}</div>
            <div className="metric-caption">
              {completedRows.length} of {rows.length} disbursements settled
            </div>
          </div>

          <div className="metric-cell">
            <div className="metric-top">
              <span className="metric-label">Pending Disbursement Queue</span>
              <span className="metric-tag tag-amber">Awaiting Batch</span>
            </div>
            <div className="metric-number text-amber">{fmtUsd(pendingNet)}</div>
            <div className="metric-caption">{pendingRows.length} queued for PayPal execution</div>
          </div>

          <div className="metric-cell">
            <div className="metric-top">
              <span className="metric-label">Double-Entry Ledger Status</span>
              <span className="metric-tag tag-indigo">ACID Verified</span>
            </div>
            <div className="metric-number">{isBalanced ? '100% Balanced' : 'Variance Detected'}</div>
            <div className="metric-caption">
              Debits {fmtUsd(totalDebit)} = Credits {fmtUsd(totalCredit)}
            </div>
          </div>
        </section>

        {/* VIEW 1: GLOBAL PAYROLL & DISBURSEMENTS */}
        {activeView === 'view-payroll' && (
          <main className="workspace-view">
            <div className="surface-card">
              <div className="card-head">
                <div>
                  <h2 className="card-title">Workforce Compensation &amp; PayPal Settlement Register</h2>
                  <p className="card-subtitle">
                    Multi-currency payroll computed via PostgreSQL stored function{' '}
                    <code>fn_compute_employee_monthly_payroll()</code> and window function{' '}
                    <code>RANK() OVER (PARTITION BY dept_id)</code>.
                  </p>
                </div>
                <div className="toolbar-right">
                  <button className="btn btn-primary" onClick={() => setShowOnboardModal(true)}>
                    <Plus size={14} />
                    <span>Add Employee / Contractor</span>
                  </button>
                  <button className="btn btn-ghost" onClick={handleClearWorkspace}>
                    <Trash2 size={13} />
                    <span>Clear Workspace</span>
                  </button>
                </div>
              </div>

              <div className="toolbar-row">
                <div className="search-input-wrap">
                  <Search size={14} />
                  <input
                    type="text"
                    className="search-input"
                    placeholder="Filter by name, employee ID, cost center, or PayPal recipient..."
                    value={quickFilter}
                    onChange={(e) => setQuickFilter(e.target.value)}
                  />
                </div>
                <div className="toolbar-right">
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      const selected = gridRef.current?.api?.getSelectedRows() || [];
                      if (!selected.length) {
                        showToast('Select one or more rows in the table first.', true);
                        return;
                      }
                      executePayPalPayouts(selected.map((r) => r.payroll_id));
                    }}
                  >
                    Disburse Selected
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() =>
                      gridRef.current?.api?.exportDataAsCsv({
                        fileName: 'Veltriva_PayPal_Payroll_Register.csv'
                      })
                    }
                  >
                    <Download size={13} />
                    <span>Export CSV</span>
                  </button>
                </div>
              </div>

              <div className="ag-theme-quartz-dark ag-grid-container">
                <AgGridReact
                  ref={gridRef}
                  rowData={rows}
                  columnDefs={columnDefs}
                  quickFilterText={quickFilter}
                  rowSelection="multiple"
                  suppressRowClickSelection={true}
                  rowHeight={52}
                  headerHeight={40}
                  animateRows={true}
                  defaultColDef={{ sortable: true, filter: true, resizable: true }}
                />
              </div>
            </div>

            <div className="grid-2col">
              <div className="surface-card">
                <div className="card-head">
                  <div>
                    <h3 className="card-title">Cost Center Treasury Allocation</h3>
                    <p className="card-subtitle">
                      Departmental burn rate vs. monthly budget ceiling (<code>vw_department_burn_analytics</code>)
                    </p>
                  </div>
                </div>
                <div className="cost-center-list">
                  {(overview?.departmentBurn || []).map((d) => {
                    const pct = Math.min(100, Number(d.budget_utilization_pct || 0));
                    return (
                      <div key={d.dept_id} className="cost-row">
                        <div className="cost-row-head">
                          <span>
                            {d.dept_name} <code>{d.dept_code}</code>
                          </span>
                          <span style={{ fontFamily: 'var(--font-mono)' }}>
                            {fmtUsd(d.total_gross_burn_usd)}{' '}
                            <span style={{ color: '#71717a', fontWeight: 400 }}>
                              / {fmtUsd(d.monthly_budget_usd)} ({pct}%)
                            </span>
                          </span>
                        </div>
                        <div className="bar-rail">
                          <div className="bar-fill" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="cost-row-foot">
                          <span>
                            Headcount: {d.headcount} &bull; Overtime: {d.total_overtime_hours} hrs
                          </span>
                          <span>
                            Withholding: {fmtUsd(d.total_statutory_withholding_usd)} &bull; Attrition Risk:{' '}
                            {d.avg_attrition_risk_pct}%
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="surface-card">
                <div className="card-head">
                  <div>
                    <h3 className="card-title">PayPal REST Gateway &amp; Schema Telemetry</h3>
                    <p className="card-subtitle">
                      Live OpenAPI 3.1 payload validation, idempotency headers, and row-lock traces
                    </p>
                  </div>
                  <span className="mono-pill">PayPal-Payouts-v1</span>
                </div>
                <pre className="terminal-box">{telemetryJson}</pre>
              </div>
            </div>
          </main>
        )}

        {/* VIEW 2: CONTRACTOR MILESTONE ESCROW */}
        {activeView === 'view-escrow' && (
          <main className="workspace-view">
            <div className="surface-card">
              <div className="card-head">
                <div>
                  <h2 className="card-title">Contractor Deliverable Schedule &amp; PayPal Orders v2 Escrow</h2>
                  <p className="card-subtitle">
                    Deliverable-verified milestone timeline with one-click PayPal Orders v2 capture and automatic
                    ledger posting.
                  </p>
                </div>
                <button className="btn btn-primary" onClick={() => setShowMilestoneModal(true)}>
                  <Plus size={14} />
                  <span>New Milestone Escrow</span>
                </button>
              </div>

              <div className="gantt-container">
                <div className="gantt-head">
                  <div>Deliverable &amp; Contractor</div>
                  <div>Escrow Value</div>
                  <div className="gantt-scale">
                    <span>Nov 01</span>
                    <span>Nov 04</span>
                    <span>Nov 07</span>
                    <span>Nov 10</span>
                    <span>Nov 14</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>Settlement</div>
                </div>
                <div>
                  {(overview?.milestones || []).map((m) => {
                    const startDay = Math.max(1, new Date(m.start_date).getDate());
                    const dueDay = Math.min(14, new Date(m.due_date).getDate());
                    const leftPct = Math.min(72, (startDay - 1) * 7.0);
                    const widthPct = Math.max(22, (dueDay - startDay + 1) * 7.0);
                    const isSettled = m.status === 'RELEASED_PAYPAL';

                    return (
                      <div key={m.milestone_id} className="gantt-item">
                        <div>
                          <div style={{ fontWeight: 600, color: '#f4f4f5' }}>{m.milestone_title}</div>
                          <div style={{ fontSize: '11.5px', color: '#71717a', marginTop: 2 }}>
                            {m.full_name} (<code>{m.emp_code}</code>) &bull; {m.project_name}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                            {fmtUsd(m.escrow_amount_usd)}
                          </div>
                          <div style={{ fontSize: 11, color: '#a1a1aa', margin: '2px 0 4px' }}>
                            Verification: {m.ai_verification_score}%
                          </div>
                          {isSettled ? (
                            <span className="status-pill pill-paid">Released ({m.paypal_capture_id})</span>
                          ) : (
                            <span className="status-pill pill-pending">{m.status}</span>
                          )}
                        </div>
                        <div>
                          <div className="gantt-track">
                            <div
                              className={`gantt-pill ${isSettled ? 'settled' : ''}`}
                              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                            >
                              {m.completion_pct}% &bull; {String(m.start_date).slice(5, 10)} to{' '}
                              {String(m.due_date).slice(5, 10)}
                            </div>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          {isSettled ? (
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#71717a' }}>
                              Order {m.paypal_order_id}
                            </span>
                          ) : (
                            <button
                              className="btn btn-primary btn-xs"
                              onClick={async () => {
                                try {
                                  const res = await apiFetch(`/api/paypal/milestones/${m.milestone_id}/release`, {
                                    method: 'POST'
                                  });
                                  setTelemetryJson(JSON.stringify(res.captureResult, null, 2));
                                  showToast(res.message);
                                  await loadDashboardData();
                                } catch (err) {
                                  showToast(err.message, true);
                                }
                              }}
                            >
                              Release {fmtUsd(m.escrow_amount_usd)}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </main>
        )}

        {/* VIEW 3: TIME, SHIFTS & ATTENDANCE POLICY */}
        {activeView === 'view-attendance' && (
          <main className="workspace-view">
            <div className="grid-2col">
              <div className="surface-card">
                <div className="card-head">
                  <div>
                    <h3 className="card-title">Record Shift Check-In / Overtime</h3>
                    <p className="card-subtitle">
                      Fires PostgreSQL BEFORE trigger <code>trg_attendance_auto_metrics</code> and recalculates net
                      payout.
                    </p>
                  </div>
                </div>
                <form
                  className="clean-form-grid"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    try {
                      const res = await apiFetch('/api/dbms/attendance', {
                        method: 'POST',
                        body: JSON.stringify({
                          emp_id: fd.get('emp_id'),
                          work_date: fd.get('work_date'),
                          shift_code: fd.get('shift_code'),
                          check_in_time: fd.get('check_in_time') + ':00',
                          check_out_time: fd.get('check_out_time') + ':00',
                          notes: fd.get('notes')
                        })
                      });
                      showToast(res.message);
                      await loadDashboardData();
                    } catch (err) {
                      showToast(err.message, true);
                    }
                  }}
                >
                  <div className="field-block">
                    <label>Employee</label>
                    <select name="emp_id" className="field-control" required>
                      {rows.map((e) => (
                        <option key={e.emp_id} value={e.emp_id}>
                          {e.emp_code} — {e.full_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field-block">
                    <label>Work Date</label>
                    <input type="date" name="work_date" defaultValue="2026-11-05" className="field-control" required />
                  </div>
                  <div className="field-block">
                    <label>Check-In (Late &gt; 09:15)</label>
                    <input type="time" name="check_in_time" defaultValue="09:35" className="field-control" required />
                  </div>
                  <div className="field-block">
                    <label>Check-Out (Overtime &gt; 8h)</label>
                    <input type="time" name="check_out_time" defaultValue="20:30" className="field-control" required />
                  </div>
                  <div className="field-block">
                    <label>Shift Assignment</label>
                    <select name="shift_code" className="field-control">
                      <option value="MORNING_IST">APAC / IST Core (09:00–17:30)</option>
                      <option value="US_EST_CORE">North America EST (14:00–22:30)</option>
                      <option value="EU_CET_FLEX">Europe CET (11:00–19:30)</option>
                    </select>
                  </div>
                  <div className="field-block">
                    <label>Audit Reference Note</label>
                    <input
                      type="text"
                      name="notes"
                      defaultValue="Production release window"
                      className="field-control"
                    />
                  </div>
                  <div className="field-span-full">
                    <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                      Commit Attendance Log &amp; Recalculate Net Pay
                    </button>
                  </div>
                </form>
              </div>

              <div className="surface-card">
                <div className="card-head">
                  <div>
                    <h3 className="card-title">Time &amp; Overtime Ledger</h3>
                    <p className="card-subtitle">
                      Policy: 3 late arrivals = 0.5 day salary deduction; &gt;4h daily OT flagged for review
                    </p>
                  </div>
                </div>
                <div className="table-wrap">
                  <table className="clean-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Employee</th>
                        <th>Clock Window</th>
                        <th>Hours / OT</th>
                        <th>Policy Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(overview?.attendanceLogs || []).map((l) => (
                        <tr key={l.attendance_id}>
                          <td style={{ fontFamily: 'var(--font-mono)', color: '#a1a1aa' }}>
                            {String(l.work_date).slice(0, 10)}
                          </td>
                          <td>
                            <strong>{l.full_name}</strong> <code>{l.emp_code}</code>
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>
                            {l.check_in_time} – {l.check_out_time}
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>
                            {l.hours_worked}h <span style={{ color: '#71717a' }}>(OT: {l.overtime_hours}h)</span>
                          </td>
                          <td>
                            {l.is_late ? (
                              <span style={{ color: '#f43f5e', fontWeight: 500 }}>Late (&gt;09:15)</span>
                            ) : (
                              <span style={{ color: '#34d399' }}>Compliant</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </main>
        )}

        {/* VIEW 4: WORKFORCE RISK & GEMINI AI COPILOT */}
        {activeView === 'view-intelligence' && (
          <main className="workspace-view">
            <div className="grid-2col">
              <div className="surface-card">
                <div className="card-head">
                  <div>
                    <h3 className="card-title">Treasury &amp; Compliance Copilot (Live Gemini RAG)</h3>
                    <p className="card-subtitle">
                      Natural-language interrogation over live PostgreSQL views and PayPal settlement state
                    </p>
                  </div>
                  <span className="mono-pill">Gemini 3.8 / 3.5 Flash</span>
                </div>

                <div className="quick-prompts">
                  <button
                    className="prompt-pill"
                    onClick={() =>
                      sendCopilotMessage(
                        'Audit all overtime spikes and late-mark salary deductions for November 2026.'
                      )
                    }
                  >
                    Audit Overtime &amp; Late Deductions
                  </button>
                  <button
                    className="prompt-pill"
                    onClick={() =>
                      sendCopilotMessage(
                        'Verify our double-entry ACID trial balance and tax withholding liabilities.'
                      )
                    }
                  >
                    Verify Trial Balance &amp; Taxes
                  </button>
                  <button
                    className="prompt-pill"
                    onClick={() =>
                      sendCopilotMessage('Which contractor milestones are verified and ready for PayPal release?')
                    }
                  >
                    Pending Escrow Releases
                  </button>
                </div>

                <div className="chat-stream">
                  {chatMessages.map((m, idx) => (
                    <div key={idx} className={`msg-bubble ${m.role === 'user' ? 'msg-user' : 'msg-ai'}`}>
                      <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
                      {m.sqlExecuted && (
                        <div
                          style={{
                            marginTop: 8,
                            paddingTop: 6,
                            borderTop: '1px solid var(--border-hairline)',
                            fontFamily: 'var(--font-mono)',
                            fontSize: 11,
                            color: '#71717a'
                          }}
                        >
                          Source: {m.source} &bull; SQL: {m.sqlExecuted}
                        </div>
                      )}
                    </div>
                  ))}
                  {copilotLoading && (
                    <div className="msg-bubble msg-ai" style={{ color: '#a1a1aa', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                      Querying Gemini 3.5 Flash Lite over live PostgreSQL views...
                    </div>
                  )}
                </div>

                <form
                  className="chat-input-bar"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (copilotInput.trim() && !copilotLoading) {
                      sendCopilotMessage(copilotInput.trim());
                      setCopilotInput('');
                    }
                  }}
                >
                  <input
                    type="text"
                    className="field-control"
                    placeholder="Ask about payroll burn, tax slabs, overtime anomalies, or PayPal status..."
                    value={copilotInput}
                    onChange={(e) => setCopilotInput(e.target.value)}
                  />
                  <button type="submit" className="btn btn-primary" disabled={copilotLoading}>
                    <Send size={13} />
                    <span>{copilotLoading ? 'Running...' : 'Query'}</span>
                  </button>
                </form>
              </div>

              <div className="surface-card">
                <div className="card-head">
                  <div>
                    <h3 className="card-title">Workforce Attrition &amp; Treasury Burn Models</h3>
                    <p className="card-subtitle">
                      Logistic Regression + k-NN classification, Linear burn forecast, and k-Means segmentation
                    </p>
                  </div>
                </div>
                {overview?.mlInsights && (
                  <>
                    <div className="ml-kpi-row">
                      <div className="ml-stat-card">
                        <div className="ml-stat-title">Attrition Classifier (Logistic + k-NN)</div>
                        <div className="ml-stat-val">
                          F1 {overview.mlInsights.modelMetadata.supervisedClassification.f1Score} &bull; AUC{' '}
                          {overview.mlInsights.modelMetadata.supervisedClassification.rocAuc}
                        </div>
                      </div>
                      <div className="ml-stat-card">
                        <div className="ml-stat-title">
                          Next Cycle Burn (R²={overview.mlInsights.modelMetadata.supervisedRegression.rSquared})
                        </div>
                        <div className="ml-stat-val">
                          {fmtUsd(overview.mlInsights.modelMetadata.supervisedRegression.predictedNextMonthGrossUsd)}
                        </div>
                      </div>
                      <div className="ml-stat-card">
                        <div className="ml-stat-title">Segmentation (k-Means k=3)</div>
                        <div className="ml-stat-val">
                          Silhouette {overview.mlInsights.modelMetadata.unsupervisedClustering.silhouetteScore}
                        </div>
                      </div>
                    </div>
                    <div className="table-wrap">
                      <table className="clean-table">
                        <thead>
                          <tr>
                            <th>Employee</th>
                            <th>Feature Vector</th>
                            <th>Attrition Risk</th>
                            <th>Cluster Segment</th>
                          </tr>
                        </thead>
                        <tbody>
                          {overview.mlInsights.predictions.map((p) => (
                            <tr key={p.emp_code}>
                              <td>
                                <strong>{p.full_name}</strong> <code>{p.emp_code}</code>
                              </td>
                              <td style={{ fontFamily: 'var(--font-mono)', color: '#a1a1aa' }}>
                                [{p.normalizedFeatures.overtimeScaled}, {p.normalizedFeatures.compensationScaled},{' '}
                                {p.normalizedFeatures.latenessScaled}]
                              </td>
                              <td
                                style={{
                                  fontFamily: 'var(--font-mono)',
                                  fontWeight: 600,
                                  color: p.predictedAttritionPct >= 45 ? '#f43f5e' : '#34d399'
                                }}
                              >
                                {p.predictedAttritionPct}%
                              </td>
                              <td>
                                <code>{p.assignedCluster}</code>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            </div>
          </main>
        )}

        {/* VIEW 5: GENERAL LEDGER, AUDIT TRAIL & SQL STUDIO */}
        {activeView === 'view-ledger' && (
          <main className="workspace-view">
            <div className="grid-2col">
              <div className="surface-card">
                <div className="card-head">
                  <div>
                    <h3 className="card-title">Double-Entry General Ledger Trial Balance</h3>
                    <p className="card-subtitle">
                      Automatically populated by PostgreSQL trigger <code>trg_payroll_double_entry_and_audit</code>
                    </p>
                  </div>
                </div>
                <div className="table-wrap">
                  <table className="clean-table">
                    <thead>
                      <tr>
                        <th>Account Code</th>
                        <th>Total Debits</th>
                        <th>Total Credits</th>
                        <th>Entries</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tb.map((r) => (
                        <tr key={r.account_code}>
                          <td>
                            <code>{r.account_code}</code>
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>{fmtUsd(r.total_debit_usd)}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', color: '#34d399' }}>
                            {fmtUsd(r.total_credit_usd)}
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)', color: '#a1a1aa' }}>{r.posting_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="surface-card">
                <div className="card-head">
                  <div>
                    <h3 className="card-title">Immutable System Audit Trail</h3>
                    <p className="card-subtitle">
                      JSONB state change records captured by <code>trg_salary_audit_trail</code> and settlement
                      triggers
                    </p>
                  </div>
                </div>
                <div className="table-wrap">
                  <table className="clean-table">
                    <thead>
                      <tr>
                        <th>Audit ID</th>
                        <th>Entity</th>
                        <th>Event Type</th>
                        <th>Record Ref</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(overview?.auditLogs || []).map((a) => (
                        <tr key={a.audit_id}>
                          <td style={{ fontFamily: 'var(--font-mono)', color: '#71717a' }}>#{a.audit_id}</td>
                          <td>
                            <code>{a.table_name}</code>
                          </td>
                          <td style={{ fontWeight: 500 }}>{a.operation_type}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', color: '#a1a1aa' }}>ID {a.record_id}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="surface-card">
              <div className="card-head">
                <div>
                  <h3 className="card-title">PostgreSQL 16 Live Query Studio</h3>
                  <p className="card-subtitle">
                    Execute read-only SQL queries, window functions, and CTEs against the active database
                  </p>
                </div>
              </div>
              <div className="sql-runner-bar">
                <textarea
                  rows="3"
                  className="sql-editor"
                  value={sqlInput}
                  onChange={(e) => setSqlInput(e.target.value)}
                />
                <button className="btn btn-primary" onClick={() => executeLiveSql(sqlInput)}>
                  Run Query
                </button>
              </div>
              <div className="sql-status-line">
                {sqlResult.error
                  ? `Error: ${sqlResult.error}`
                  : `Query completed in ${sqlResult.durationMs}ms (${sqlResult.rowCount} rows)`}
              </div>
              <div className="table-wrap">
                {sqlResult.rows.length > 0 && (
                  <table className="clean-table">
                    <thead>
                      <tr>
                        {sqlResult.fields.map((c) => (
                          <th key={c}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sqlResult.rows.map((row, idx) => (
                        <tr key={idx}>
                          {sqlResult.fields.map((c) => (
                            <td key={c} style={{ fontFamily: 'var(--font-mono)', fontSize: '11.5px' }}>
                              {typeof row[c] === 'object' && row[c] !== null
                                ? JSON.stringify(row[c])
                                : String(row[c] ?? 'NULL')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </main>
        )}
      </div>

      {/* MODAL: PAYSTUB */}
      {slipEmp && (
        <div className="modal-overlay">
          <div className="modal-dialog modal-lg">
            <div className="modal-top">
              <h3 className="modal-title">Statutory Compensation &amp; Tax Remittance Statement</h3>
              <div className="modal-top-actions">
                <button className="btn btn-secondary btn-xs" onClick={() => window.print()}>
                  Print / Save PDF
                </button>
                <button className="btn btn-ghost btn-xs" onClick={() => setSlipEmp(null)}>
                  Close
                </button>
              </div>
            </div>
            <div className="modal-content">
              <div style={{ border: '1px solid var(--border-hairline)', borderRadius: 8, padding: 20, background: '#0c0d10' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{activeOrg?.org_name || 'VELTRIVA TREASURY'}</div>
                    <div style={{ fontSize: '11.5px', color: '#71717a' }}>
                      Employee: <strong>{slipEmp.full_name}</strong> ({slipEmp.emp_code}) &bull; PayPal:{' '}
                      <code>{slipEmp.paypal_email}</code>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11.5px' }}>
                    <div>Gross: {fmtUsd(slipEmp.gross_pay_usd)}</div>
                    <div style={{ color: '#34d399', fontWeight: 600 }}>Net Payout: {fmtUsd(slipEmp.net_pay_usd)}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ADJUST SALARY */}
      {editSalEmp && (
        <div className="modal-overlay">
          <div className="modal-dialog">
            <div className="modal-top">
              <h3 className="modal-title">Adjust Base Compensation — {editSalEmp.full_name}</h3>
              <button className="btn btn-ghost btn-xs" onClick={() => setEditSalEmp(null)}>
                Close
              </button>
            </div>
            <form
              className="modal-content clean-form-stack"
              onSubmit={async (e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                try {
                  const res = await apiFetch(`/api/dbms/salary/${editSalEmp.emp_id}`, {
                    method: 'PUT',
                    body: JSON.stringify({
                      base_salary_usd: fd.get('base_salary_usd'),
                      hourly_overtime_rate_usd: fd.get('hourly_overtime_rate_usd'),
                      bonus_usd: fd.get('bonus_usd')
                    })
                  });
                  setEditSalEmp(null);
                  showToast(res.message);
                  await loadDashboardData();
                } catch (err) {
                  showToast(err.message, true);
                }
              }}
            >
              <div className="field-block">
                <label>Monthly Base Salary (USD)</label>
                <input
                  type="number"
                  step="50"
                  name="base_salary_usd"
                  defaultValue={editSalEmp.base_salary_usd}
                  className="field-control"
                  required
                />
              </div>
              <div className="field-block">
                <label>Hourly Overtime Rate (USD)</label>
                <input
                  type="number"
                  step="5"
                  name="hourly_overtime_rate_usd"
                  defaultValue={editSalEmp.hourly_overtime_rate_usd}
                  className="field-control"
                  required
                />
              </div>
              <div className="field-block">
                <label>Performance Bonus (USD)</label>
                <input
                  type="number"
                  step="50"
                  name="bonus_usd"
                  defaultValue={editSalEmp.ai_performance_bonus_usd || 500}
                  className="field-control"
                  required
                />
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                Commit Adjustment &amp; Recalculate Payroll
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ONBOARD EMPLOYEE */}
      {showOnboardModal && (
        <div className="modal-overlay">
          <div className="modal-dialog modal-lg">
            <div className="modal-top">
              <h3 className="modal-title">Onboard Employee or Global Contractor</h3>
              <button className="btn btn-ghost btn-xs" onClick={() => setShowOnboardModal(false)}>
                Close
              </button>
            </div>
            <form
              className="modal-content clean-form-grid"
              onSubmit={async (e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                const empType = fd.get('employment_type');
                try {
                  const res = await apiFetch('/api/dbms/employees', {
                    method: 'POST',
                    body: JSON.stringify({
                      full_name: fd.get('full_name'),
                      email: fd.get('email'),
                      paypal_email: fd.get('paypal_email'),
                      designation: fd.get('designation'),
                      dept_id: Number(fd.get('dept_id')),
                      role_id: empType === 'CONTRACTOR' ? 5 : 4,
                      employment_type: empType,
                      country_code: fd.get('country_code'),
                      base_salary_usd: Number(fd.get('base_salary_usd')),
                      hra_allowance_usd: Number(fd.get('hra_allowance_usd')),
                      special_allowance_usd: Number(fd.get('special_allowance_usd')),
                      hourly_overtime_rate_usd: 65
                    })
                  });
                  setShowOnboardModal(false);
                  showToast(res.message);
                  await loadDashboardData();
                } catch (err) {
                  showToast(err.message, true);
                }
              }}
            >
              <div className="field-block">
                <label>Full Legal Name</label>
                <input type="text" name="full_name" className="field-control" placeholder="e.g. Ananya Verma" required />
              </div>
              <div className="field-block">
                <label>Work Email</label>
                <input type="email" name="email" className="field-control" placeholder="ananya@company.com" required />
              </div>
              <div className="field-block">
                <label>PayPal Sandbox Recipient Email</label>
                <input
                  type="email"
                  name="paypal_email"
                  className="field-control"
                  placeholder="ananya.sb@paypal.com"
                  required
                />
              </div>
              <div className="field-block">
                <label>Job Title / Designation</label>
                <input type="text" name="designation" className="field-control" placeholder="Staff AI Engineer" required />
              </div>
              <div className="field-block">
                <label>Cost Center (Department)</label>
                <select name="dept_id" className="field-control">
                  {(overview?.departmentBurn || []).map((d) => (
                    <option key={d.dept_id} value={d.dept_id}>
                      {d.dept_name} ({d.dept_code})
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-block">
                <label>Tax Jurisdiction</label>
                <select name="country_code" className="field-control">
                  <option value="IN">India (IN)</option>
                  <option value="US">United States (US)</option>
                  <option value="UK">United Kingdom (UK)</option>
                  <option value="SG">Singapore (SG)</option>
                  <option value="DE">Germany (DE)</option>
                </select>
              </div>
              <div className="field-block">
                <label>Contract Type</label>
                <select name="employment_type" className="field-control">
                  <option value="FULL_TIME">Salaried Full-Time</option>
                  <option value="CONTRACTOR">Milestone Contractor</option>
                </select>
              </div>
              <div className="field-block">
                <label>Monthly Base Salary (USD)</label>
                <input type="number" name="base_salary_usd" defaultValue="6500" className="field-control" required />
              </div>
              <div className="field-block">
                <label>Housing Allowance (USD)</label>
                <input type="number" name="hra_allowance_usd" defaultValue="1200" className="field-control" required />
              </div>
              <div className="field-block">
                <label>Special Allowance (USD)</label>
                <input type="number" name="special_allowance_usd" defaultValue="600" className="field-control" required />
              </div>
              <div className="field-span-full">
                <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                  Create Contract &amp; Initialize Payroll Run
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: NEW MILESTONE ESCROW */}
      {showMilestoneModal && (
        <div className="modal-overlay">
          <div className="modal-dialog">
            <div className="modal-top">
              <h3 className="modal-title">Create Contractor Milestone Escrow</h3>
              <button className="btn btn-ghost btn-xs" onClick={() => setShowMilestoneModal(false)}>
                Close
              </button>
            </div>
            <form
              className="modal-content clean-form-stack"
              onSubmit={async (e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                try {
                  const res = await apiFetch('/api/dbms/milestones', {
                    method: 'POST',
                    body: JSON.stringify({
                      emp_id: fd.get('emp_id'),
                      project_name: fd.get('project_name'),
                      milestone_title: fd.get('milestone_title'),
                      start_date: fd.get('start_date'),
                      due_date: fd.get('due_date'),
                      escrow_amount_usd: fd.get('escrow_amount_usd'),
                      deliverable_url: fd.get('deliverable_url')
                    })
                  });
                  setShowMilestoneModal(false);
                  showToast(res.message);
                  await loadDashboardData();
                } catch (err) {
                  showToast(err.message, true);
                }
              }}
            >
              <div className="field-block">
                <label>Assigned Employee / Contractor</label>
                <select name="emp_id" className="field-control" required>
                  {rows.map((e) => (
                    <option key={e.emp_id} value={e.emp_id}>
                      {e.emp_code} — {e.full_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-block">
                <label>Project Name</label>
                <input
                  type="text"
                  name="project_name"
                  defaultValue="Core Treasury Engine"
                  className="field-control"
                  required
                />
              </div>
              <div className="field-block">
                <label>Deliverable Title</label>
                <input
                  type="text"
                  name="milestone_title"
                  placeholder="M7: Multi-Currency Webhook Verifier"
                  className="field-control"
                  required
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="field-block">
                  <label>Start Date</label>
                  <input type="date" name="start_date" defaultValue="2026-11-05" className="field-control" required />
                </div>
                <div className="field-block">
                  <label>Due Date</label>
                  <input type="date" name="due_date" defaultValue="2026-11-12" className="field-control" required />
                </div>
              </div>
              <div className="field-block">
                <label>Escrow Amount (USD)</label>
                <input type="number" name="escrow_amount_usd" defaultValue="2200" className="field-control" required />
              </div>
              <div className="field-block">
                <label>Deliverable GitHub / PR URL</label>
                <input
                  type="url"
                  name="deliverable_url"
                  defaultValue="https://github.com/veltriva-ai/core/pull/88"
                  className="field-control"
                />
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                Lock Milestone Escrow
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: PAYPAL CONFIGURATION (ISOLATED PER ORGANIZATION) */}
      {showPayPalModal && (
        <div className="modal-overlay">
          <div className="modal-dialog">
            <div className="modal-top">
              <h3 className="modal-title">PayPal REST Gateway — {activeOrg?.org_name}</h3>
              <button className="btn btn-ghost btn-xs" onClick={() => setShowPayPalModal(false)}>
                Close
              </button>
            </div>
            <div className="modal-content">
              <p className="helper-copy">
                Credentials saved here apply <strong>only to {activeOrg?.org_name}</strong>. Custom workspaces never use
                the host&apos;s <code>.env</code> PayPal keys—if left blank, your workspace uses the Zero-Key PayPal
                Sandbox Emulator.
              </p>
              <form
                className="clean-form-stack"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  const res = await apiFetch('/api/paypal/config', {
                    method: 'POST',
                    body: JSON.stringify({
                      clientId: fd.get('clientId'),
                      clientSecret: fd.get('clientSecret')
                    })
                  });
                  showToast(res.message);
                  await loadDashboardData();
                }}
              >
                <div className="field-block">
                  <label>PayPal Client ID (Sandbox)</label>
                  <input type="text" name="clientId" className="field-control" placeholder="PayPal REST Client ID" />
                </div>
                <div className="field-block">
                  <label>PayPal Secret Key</label>
                  <input type="password" name="clientSecret" className="field-control" placeholder="••••••••••••" />
                </div>
                <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                  Save Organization PayPal Credentials
                </button>
              </form>
              {paypalStatus && (
                <div className="gateway-meta-box">
                  <div>
                    Status: <strong>{paypalStatus.statusLabel}</strong>
                  </div>
                  <div>Source: {paypalStatus.credentialSource}</div>
                  <div>Client ID: {paypalStatus.clientIdPreview}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: SWITCH OR CREATE WORKSPACE */}
      {showWorkspaceModal && (
        <div className="modal-overlay">
          <div className="modal-dialog modal-lg">
            <div className="modal-top">
              <h3 className="modal-title">Multi-Tenant Organization Switcher</h3>
              <div className="modal-top-actions">
                <button
                  className="btn btn-primary btn-xs"
                  onClick={() => {
                    setShowWorkspaceModal(false);
                    setShowAuthScreen(true);
                  }}
                >
                  + Create Blank Org / Google SSO
                </button>
                <button className="btn btn-ghost btn-xs" onClick={() => setShowWorkspaceModal(false)}>
                  Close
                </button>
              </div>
            </div>
            <div className="modal-content">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(overview?.organizations || []).map((o) => {
                  const isCurrent = Number(o.org_id) === Number(activeOrg?.org_id);
                  return (
                    <div
                      key={o.org_id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '10px 14px',
                        border: `1px solid ${isCurrent ? 'rgba(52,211,153,0.4)' : 'var(--border-hairline)'}`,
                        borderRadius: 8,
                        background: isCurrent ? 'rgba(52,211,153,0.06)' : '#14151a'
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, color: '#f4f4f5' }}>
                          {o.org_name} <code>{o.is_demo_workspace ? 'DEMO SANDBOX' : o.org_code}</code>
                        </div>
                        <div style={{ fontSize: '11.5px', color: '#71717a' }}>
                          Owner: {o.owner_name} ({o.owner_email})
                        </div>
                      </div>
                      {isCurrent ? (
                        <span className="status-pill pill-paid">Active</span>
                      ) : (
                        <button className="btn btn-secondary btn-xs" onClick={() => handleSwitchOrg(o.org_id)}>
                          Switch Workspace
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TOAST STACK */}
      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast-item ${t.isError ? 'toast-err' : ''}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
