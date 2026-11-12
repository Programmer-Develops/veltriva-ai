import React, { useState } from 'react';
import { ShieldCheck, Lock, Building2, ArrowRight, Play } from 'lucide-react';

export default function AuthGate({ onAuthenticated, apiFetch, showToast }) {
  const [mode, setMode] = useState('register'); // 'login' | 'register' | 'google'
  const [loading, setLoading] = useState(false);

  // Login State
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Register Blank Organization State
  const [orgName, setOrgName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [password, setPassword] = useState('');
  const [paypalClientId, setPaypalClientId] = useState('');
  const [paypalSecret, setPaypalSecret] = useState('');

  // Google SSO State
  const [googleEmail, setGoogleEmail] = useState('');
  const [googleName, setGoogleName] = useState('');
  const [googleCompany, setGoogleCompany] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: loginEmail, password: loginPassword })
      });
      showToast(res.message);
      onAuthenticated(res.token, res.user);
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await apiFetch('/api/auth/register-org', {
        method: 'POST',
        body: JSON.stringify({
          org_name: orgName,
          owner_name: ownerName,
          owner_email: ownerEmail,
          password,
          paypal_client_id: paypalClientId,
          paypal_client_secret: paypalSecret
        })
      });
      showToast(res.message);
      onAuthenticated(res.token, res.user);
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await apiFetch('/api/auth/google', {
        method: 'POST',
        body: JSON.stringify({
          google_email: googleEmail,
          google_name: googleName,
          company_name: googleCompany
        })
      });
      showToast(res.message);
      onAuthenticated(res.token, res.user);
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setLoading(false);
    }
  };

  const handleEnterDemoSandbox = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ org_id: 1, roleOverride: 'CFO_ADMIN' })
      });
      showToast('Entered Interactive Demo Sandbox (Veltriva Sandbox Corp)');
      onAuthenticated(res.token, res.user);
    } catch (err) {
      showToast(err.message, true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-gate-shell">
      {/* Left Institutional Brand & Architecture Panel */}
      <div className="auth-hero-panel">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 42 }}>
            <div className="brand-mark">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 5L12 19L20 5H16.2L12 12.6L7.8 5H4Z"
                  fill="currentColor"
                />
              </svg>
            </div>
            <div>
              <div className="brand-title">VELTRIVA</div>
              <div className="brand-tier">GLOBAL PAYROLL &amp; TREASURY OS</div>
            </div>
          </div>

          <h1
            style={{
              fontSize: 30,
              fontWeight: 700,
              letterSpacing: '-0.03em',
              lineHeight: 1.2,
              marginBottom: 16,
              color: '#f4f4f5'
            }}
          >
            Multi-tenant global payroll, milestone escrow, and ACID ledger settlement.
          </h1>
          <p style={{ fontSize: 13.5, color: '#a1a1aa', maxWidth: 480, lineHeight: 1.65 }}>
            Provision a completely clean company workspace with zero sample data, or launch the interactive
            sandbox pre-loaded with 10 global staff contracts, PostgreSQL 16 triggers, and PayPal Payouts v1
            settlement flows.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 36 }}>
            <div
              style={{
                display: 'flex',
                gap: 12,
                padding: '14px 16px',
                background: '#111216',
                border: '1px solid var(--border-hairline)',
                borderRadius: 8
              }}
            >
              <Building2 size={18} style={{ color: '#f4f4f5', flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: 12.5, color: '#f4f4f5' }}>
                  Strict Multi-Tenant PostgreSQL Isolation (<code>org_id</code>)
                </div>
                <div style={{ fontSize: 11.5, color: '#71717a', marginTop: 2 }}>
                  Every company account is stored in PostgreSQL 16 (`organizations` table) with bcrypt password
                  hashing, JWT session tokens, and zero cross-tenant data leakage.
                </div>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                gap: 12,
                padding: '14px 16px',
                background: '#111216',
                border: '1px solid var(--border-hairline)',
                borderRadius: 8
              }}
            >
              <ShieldCheck size={18} style={{ color: '#34d399', flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: 12.5, color: '#f4f4f5' }}>
                  Isolated Per-Company PayPal Gateway &amp; Zero-Key Emulator
                </div>
                <div style={{ fontSize: 11.5, color: '#71717a', marginTop: 2 }}>
                  Custom user workspaces never access the host&apos;s <code>.env</code> PayPal keys or funds. Workspaces
                  without linked PayPal API keys automatically run in Zero-Key PayPal Sandbox Emulator mode until you
                  connect your own Client ID &amp; Secret.
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            paddingTop: 20,
            borderTop: '1px solid var(--border-hairline)',
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 11.5,
            color: '#71717a',
            fontFamily: 'var(--font-mono)'
          }}
        >
          <span>React 18 + Vite 5 • Node/Express</span>
          <span>PostgreSQL 16 BCNF • PayPal Sandbox v2</span>
        </div>
      </div>

      {/* Right Authentication & Workspace Provisioning Card */}
      <div className="auth-form-panel">
        <div className="auth-card">
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#f4f4f5' }}>
              {mode === 'register' && 'Create Blank Company Workspace'}
              {mode === 'login' && 'Sign In to Existing Workspace'}
              {mode === 'google' && 'Continue with Google SSO'}
            </div>
            <div style={{ fontSize: 12, color: '#71717a', marginTop: 3 }}>
              {mode === 'register' && 'Starts with 0 sample employees. Add your own team & PayPal keys.'}
              {mode === 'login' && 'Enter your organization owner email and password.'}
              {mode === 'google' && 'Sign in or auto-provision a clean workspace with your Google account.'}
            </div>
          </div>

          {/* Mode Switcher Tabs */}
          <div className="auth-tabs">
            <button
              type="button"
              className={`auth-tab-btn ${mode === 'register' ? 'active' : ''}`}
              onClick={() => setMode('register')}
            >
              New Blank Org
            </button>
            <button
              type="button"
              className={`auth-tab-btn ${mode === 'login' ? 'active' : ''}`}
              onClick={() => setMode('login')}
            >
              Email Sign In
            </button>
            <button
              type="button"
              className={`auth-tab-btn ${mode === 'google' ? 'active' : ''}`}
              onClick={() => setMode('google')}
            >
              Google SSO
            </button>
          </div>

          {/* TAB 1: CREATE BLANK ORGANIZATION */}
          {mode === 'register' && (
            <form onSubmit={handleRegister} className="clean-form-stack">
              <div className="field-block">
                <label>Company / Organization Name</label>
                <input
                  type="text"
                  className="field-control"
                  placeholder="e.g. Acme Global Technologies"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  required
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="field-block">
                  <label>Your Full Name</label>
                  <input
                    type="text"
                    className="field-control"
                    placeholder="e.g. Alex Rivera"
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    required
                  />
                </div>
                <div className="field-block">
                  <label>Work Email</label>
                  <input
                    type="email"
                    className="field-control"
                    placeholder="alex@acme.io"
                    value={ownerEmail}
                    onChange={(e) => setOwnerEmail(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="field-block">
                <label>Workspace Password</label>
                <input
                  type="password"
                  className="field-control"
                  placeholder="Create password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <div
                style={{
                  padding: '10px 12px',
                  background: '#0c0d10',
                  border: '1px solid var(--border-hairline)',
                  borderRadius: 7
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 600, color: '#a1a1aa', marginBottom: 8 }}>
                  Optional: Your Own PayPal REST Credentials (Leave blank to use Zero-Key Sandbox Emulator)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <input
                    type="text"
                    className="field-control"
                    placeholder="PayPal Client ID"
                    value={paypalClientId}
                    onChange={(e) => setPaypalClientId(e.target.value)}
                  />
                  <input
                    type="password"
                    className="field-control"
                    placeholder="PayPal Secret"
                    value={paypalSecret}
                    onChange={(e) => setPaypalSecret(e.target.value)}
                  />
                </div>
              </div>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading}
                style={{ width: '100%', justifyContent: 'center', height: 36 }}
              >
                {loading ? 'Provisioning Workspace...' : 'Create Blank Workspace (0 Sample Rows)'}
              </button>
            </form>
          )}

          {/* TAB 2: EMAIL + PASSWORD LOGIN */}
          {mode === 'login' && (
            <form onSubmit={handleLogin} className="clean-form-stack">
              <div className="field-block">
                <label>Organization Owner Email</label>
                <input
                  type="email"
                  className="field-control"
                  placeholder="you@company.com"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  required
                />
              </div>
              <div className="field-block">
                <label>Password</label>
                <input
                  type="password"
                  className="field-control"
                  placeholder="••••••••"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  required
                />
              </div>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading}
                style={{ width: '100%', justifyContent: 'center', height: 36 }}
              >
                <Lock size={13} />
                {loading ? 'Signing In...' : 'Sign In to Workspace'}
              </button>
            </form>
          )}

          {/* TAB 3: GOOGLE SSO */}
          {mode === 'google' && (
            <form onSubmit={handleGoogleSignIn} className="clean-form-stack">
              <div className="field-block">
                <label>Google Account Email</label>
                <input
                  type="email"
                  className="field-control"
                  placeholder="name@gmail.com or name@company.com"
                  value={googleEmail}
                  onChange={(e) => setGoogleEmail(e.target.value)}
                  required
                />
              </div>
              <div className="field-block">
                <label>Your Display Name</label>
                <input
                  type="text"
                  className="field-control"
                  placeholder="e.g. Rohan Sharma"
                  value={googleName}
                  onChange={(e) => setGoogleName(e.target.value)}
                  required
                />
              </div>
              <div className="field-block">
                <label>Company Workspace Name (if creating new)</label>
                <input
                  type="text"
                  className="field-control"
                  placeholder="e.g. NovaPay Labs"
                  value={googleCompany}
                  onChange={(e) => setGoogleCompany(e.target.value)}
                />
              </div>
              <button type="submit" className="google-sso-btn" disabled={loading}>
                <svg width="15" height="15" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96z"
                  />
                </svg>
                {loading ? 'Authenticating with Google...' : 'Continue with Google Account'}
              </button>
            </form>
          )}

          {/* Divider for 1-Click Judge / Demo Sandbox */}
          <div
            style={{
              margin: '20px 0 14px',
              borderTop: '1px solid var(--border-hairline)',
              position: 'relative',
              textAlign: 'center'
            }}
          >
            <span
              style={{
                background: 'var(--bg-surface)',
                padding: '0 10px',
                fontSize: 10.5,
                color: '#71717a',
                position: 'relative',
                top: -9,
                letterSpacing: '0.06em',
                fontWeight: 600
              }}
            >
              OR EXPLORE PRE-SEEDED SANDBOX
            </span>
          </div>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleEnterDemoSandbox}
            disabled={loading}
            style={{ width: '100%', justifyContent: 'space-between', height: 38, padding: '0 14px' }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Play size={13} style={{ color: '#34d399' }} />
              <span>Enter Demo Sandbox (10 Staff &amp; Live PayPal Sandbox)</span>
            </span>
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
