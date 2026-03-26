import { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

const API_BASE_URL = "http://localhost:8000";

export default function AdminLogin() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await axios.post(`${API_BASE_URL}/admin/login`, {
        username,
        password,
      });

      if (response.data.token) {
        localStorage.setItem("adminToken", response.data.token);
        localStorage.setItem("adminName", response.data.name);
        navigate("/admin/dashboard");
      }
    } catch (err) {
      setError(err.response?.data?.detail || "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-login-page">

      {/* Page Title Banner */}
      <div className="page-title-bar">
        <div className="page-title-inner">
          <div className="page-title-icon">🔐</div>
          <div>
            <h1 className="page-title-text">Administrator Login</h1>
            <p className="page-title-sub">
              Ministry of Road Transport &amp; Highways — Authorized Access Only
            </p>
          </div>
        </div>
      </div>

      {/* Login Card */}
      <div className="admin-login-wrapper">
        <div className="admin-login-card">

          {/* Card Header */}
          <div className="admin-login-card-header">
            <div className="admin-login-emblem">
              <img
                src="https://upload.wikimedia.org/wikipedia/commons/5/55/Emblem_of_India.svg"
                alt="Emblem of India"
                className="admin-emblem-img"
                onError={(e) => { e.target.style.display = "none"; }}
              />
            </div>
            <h2 className="admin-login-title">Secure Portal Access</h2>
            <p className="admin-login-subtitle">
              IRDDP — Intelligent Road Damage Detection &amp; Prioritization
            </p>
            <div className="admin-login-divider"></div>
          </div>

          {/* Form */}
          <form onSubmit={handleLogin} className="admin-login-form">

            {error && (
              <div className="admin-login-error">
                <span className="admin-login-error-icon">⚠</span>
                <span>{error}</span>
              </div>
            )}

            <div className="admin-form-group">
              <label className="admin-form-label" htmlFor="admin-username">
                Username
              </label>
              <div className="admin-input-wrapper">
                <span className="admin-input-icon">👤</span>
                <input
                  id="admin-username"
                  type="text"
                  className="admin-form-input"
                  placeholder="Enter admin username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoComplete="username"
                />
              </div>
            </div>

            <div className="admin-form-group">
              <label className="admin-form-label" htmlFor="admin-password">
                Password
              </label>
              <div className="admin-input-wrapper">
                <span className="admin-input-icon">🔒</span>
                <input
                  id="admin-password"
                  type="password"
                  className="admin-form-input"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>
            </div>

            <button
              type="submit"
              className="admin-login-btn"
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="admin-login-spinner"></span>
                  Verifying Credentials…
                </>
              ) : (
                <>
                  <span>🔓</span> Access Dashboard
                </>
              )}
            </button>
          </form>

          {/* Notice */}
          <div className="admin-login-notice">
            <span className="admin-notice-icon">ℹ</span>
            <span>
              This portal is restricted to authorized government personnel only.
              Unauthorized access attempts are logged and may be prosecuted.
            </span>
          </div>
        </div>

        {/* Back link */}
        <div className="admin-login-back">
          <a href="/" className="admin-back-link">
            ← Return to Citizen Portal
          </a>
        </div>
      </div>

      <style>{`
        /* ── Page Layout ─────────────────────────────────── */
        .admin-login-page {
          min-height: calc(100vh - 160px);
          background: var(--off-white, #F8F9FA);
          font-family: 'Noto Sans', sans-serif;
        }

        /* ── Title Banner ────────────────────────────────── */
        .page-title-bar {
          background: var(--gov-blue, #003366);
          border-bottom: 4px solid var(--saffron, #FF6600);
          padding: 1.25rem 2rem;
        }

        .page-title-inner {
          max-width: 900px;
          margin: 0 auto;
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .page-title-icon {
          font-size: 2rem;
          background: rgba(255,255,255,0.1);
          padding: 0.5rem 0.75rem;
          border-radius: var(--radius, 8px);
          border: 1px solid rgba(255,255,255,0.2);
        }

        .page-title-text {
          color: #fff;
          font-size: 1.5rem;
          font-weight: 700;
          margin: 0 0 0.2rem 0;
          font-family: 'Noto Serif', serif;
        }

        .page-title-sub {
          color: rgba(255,255,255,0.75);
          font-size: 0.85rem;
          margin: 0;
        }

        /* ── Wrapper ─────────────────────────────────────── */
        .admin-login-wrapper {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 2.5rem 1rem 3rem;
        }

        /* ── Card ────────────────────────────────────────── */
        .admin-login-card {
          width: 100%;
          max-width: 440px;
          background: #fff;
          border: 1px solid var(--border, #DDE1E7);
          border-top: 4px solid var(--gov-blue, #003366);
          border-radius: var(--radius-lg, 12px);
          box-shadow: var(--shadow-md,
            0 4px 6px -1px rgba(0,0,0,0.07),
            0 2px 4px -1px rgba(0,0,0,0.04));
          overflow: hidden;
        }

        /* ── Card Header ─────────────────────────────────── */
        .admin-login-card-header {
          background: var(--gov-blue, #003366);
          padding: 2rem 2rem 1.5rem;
          text-align: center;
        }

        .admin-login-emblem {
          margin-bottom: 0.75rem;
        }

        .admin-emblem-img {
          width: 52px;
          height: 52px;
          filter: brightness(0) invert(1);
          opacity: 0.9;
        }

        .admin-login-title {
          color: #fff;
          font-size: 1.3rem;
          font-weight: 700;
          margin: 0 0 0.3rem;
          font-family: 'Noto Serif', serif;
        }

        .admin-login-subtitle {
          color: rgba(255,255,255,0.7);
          font-size: 0.8rem;
          margin: 0;
          line-height: 1.4;
        }

        .admin-login-divider {
          height: 2px;
          background: linear-gradient(
            90deg,
            transparent,
            var(--saffron, #FF6600),
            transparent
          );
          margin-top: 1.25rem;
          border-radius: 2px;
        }

        /* ── Form ────────────────────────────────────────── */
        .admin-login-form {
          padding: 1.75rem 2rem;
        }

        .admin-form-group {
          margin-bottom: 1.25rem;
        }

        .admin-form-label {
          display: block;
          font-size: 0.85rem;
          font-weight: 600;
          color: var(--text-dark, #1A1A2E);
          margin-bottom: 0.5rem;
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }

        .admin-input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }

        .admin-input-icon {
          position: absolute;
          left: 0.75rem;
          font-size: 1rem;
          pointer-events: none;
          z-index: 1;
        }

        .admin-form-input {
          width: 100%;
          padding: 0.75rem 0.75rem 0.75rem 2.5rem;
          border: 1.5px solid var(--border, #DDE1E7);
          border-radius: var(--radius, 8px);
          font-size: 0.95rem;
          font-family: 'Noto Sans', sans-serif;
          color: var(--text-dark, #1A1A2E);
          background: var(--off-white, #F8F9FA);
          transition: border-color 0.2s, box-shadow 0.2s;
          box-sizing: border-box;
        }

        .admin-form-input:focus {
          outline: none;
          border-color: var(--gov-blue, #003366);
          box-shadow: 0 0 0 3px rgba(0, 51, 102, 0.12);
          background: #fff;
        }

        .admin-form-input::placeholder {
          color: #aaa;
        }

        /* ── Error Box ───────────────────────────────────── */
        .admin-login-error {
          display: flex;
          align-items: flex-start;
          gap: 0.5rem;
          background: #fff4f4;
          border: 1px solid #f5c6cb;
          border-left: 4px solid #dc3545;
          border-radius: var(--radius, 8px);
          padding: 0.75rem 1rem;
          margin-bottom: 1.25rem;
          font-size: 0.88rem;
          color: #842029;
        }

        .admin-login-error-icon {
          font-size: 1rem;
          flex-shrink: 0;
          margin-top: 0.05rem;
        }

        /* ── Login Button ─────────────────────────────────── */
        .admin-login-btn {
          width: 100%;
          padding: 0.875rem 1rem;
          background: var(--gov-blue, #003366);
          color: #fff;
          border: none;
          border-radius: var(--radius, 8px);
          font-size: 1rem;
          font-weight: 700;
          font-family: 'Noto Sans', sans-serif;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          margin-top: 0.5rem;
          transition: background 0.2s, transform 0.15s, box-shadow 0.2s;
          letter-spacing: 0.02em;
        }

        .admin-login-btn:hover:not(:disabled) {
          background: var(--gov-blue-dark, #002244);
          transform: translateY(-1px);
          box-shadow: 0 4px 14px rgba(0, 51, 102, 0.25);
        }

        .admin-login-btn:active:not(:disabled) {
          transform: translateY(0);
        }

        .admin-login-btn:disabled {
          opacity: 0.75;
          cursor: not-allowed;
        }

        /* ── Spinner ─────────────────────────────────────── */
        .admin-login-spinner {
          width: 16px;
          height: 16px;
          border: 2px solid rgba(255,255,255,0.4);
          border-top-color: #fff;
          border-radius: 50%;
          animation: adminSpin 0.7s linear infinite;
          display: inline-block;
        }

        @keyframes adminSpin {
          to { transform: rotate(360deg); }
        }

        /* ── Notice ──────────────────────────────────────── */
        .admin-login-notice {
          display: flex;
          align-items: flex-start;
          gap: 0.5rem;
          background: #fffbf0;
          border-top: 1px solid var(--border, #DDE1E7);
          padding: 0.9rem 2rem;
          font-size: 0.78rem;
          color: #7a6200;
          line-height: 1.5;
        }

        .admin-notice-icon {
          flex-shrink: 0;
          font-size: 1rem;
          color: var(--saffron, #FF6600);
          margin-top: 0.05rem;
        }

        /* ── Back Link ───────────────────────────────────── */
        .admin-login-back {
          margin-top: 1.25rem;
        }

        .admin-back-link {
          color: var(--gov-blue, #003366);
          font-size: 0.88rem;
          text-decoration: none;
          font-weight: 600;
          opacity: 0.8;
          transition: opacity 0.2s;
        }

        .admin-back-link:hover {
          opacity: 1;
          text-decoration: underline;
        }

        /* ── Mobile ──────────────────────────────────────── */
        @media (max-width: 480px) {
          .page-title-bar {
            padding: 1rem;
          }

          .page-title-text {
            font-size: 1.2rem;
          }

          .admin-login-form {
            padding: 1.5rem 1.25rem;
          }

          .admin-login-notice {
            padding: 0.9rem 1.25rem;
          }

          .admin-login-card-header {
            padding: 1.5rem 1.25rem 1.25rem;
          }
        }
      `}</style>
    </div>
  );
}