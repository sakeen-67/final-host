import { useState, useEffect, useRef } from "react";
import axios from "axios";

const API_BASE_URL = "http://localhost:8000";
const WS_BASE_URL  = "ws://localhost:8000";

const STEPS = [
  { label: "Reported",  status: "Pending" },
  { label: "Reviewed",  status: "Under Review" },
  { label: "Scheduled", status: "Repair Scheduled" },
  { label: "Resolved",  status: "Resolved" },
];

const PRIORITY_COLORS = {
  CRITICAL: "#c0392b",
  HIGH:     "#c0641a",
  MEDIUM:   "#8a6200",
  LOW:      "#1a6e35",
  CLEAR:    "#1a3a6e",
};

export default function CitizenTracking() {
  const [reportId, setReportId]     = useState("");
  const [email, setEmail]           = useState("");
  const [report, setReport]         = useState(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef(null);

  /* ── Auto-track from URL params ── */
  useEffect(() => {
    const params     = new URLSearchParams(window.location.search);
    const idParam    = params.get("id");
    const emailParam = params.get("email");
    if (idParam && emailParam) {
      setReportId(idParam);
      setEmail(emailParam);
      doTrack(idParam, emailParam);
    }
  }, []);

  /* ── Cleanup WS on unmount ── */
  useEffect(() => {
    return () => { if (socketRef.current) socketRef.current.close(); };
  }, []);

  const doTrack = async (rid, mail) => {
    setLoading(true);
    setError("");
    setReport(null);
    if (socketRef.current) socketRef.current.close();

    try {
      const res = await axios.get(
        `${API_BASE_URL}/track/${rid.trim().toUpperCase()}`,
        { params: { email: mail.trim() } }
      );
      setReport(res.data);
      setupWebSocket(res.data.report_id);
    } catch (err) {
      setError(err.response?.data?.detail || "Report not found. Please check the ID and email.");
    } finally {
      setLoading(false);
    }
  };

  const handleTrack = (e) => {
    e.preventDefault();
    doTrack(reportId, email);
  };

  const setupWebSocket = (rid) => {
    let reconnectAttempts = 0;
    const maxAttempts = 5;

    const connect = () => {
      const ws = new WebSocket(`${WS_BASE_URL}/ws/track/${rid}`);
      
      ws.onopen = () => {
        setIsConnected(true);
        reconnectAttempts = 0; // Reset attempts on successful connection
      };
      
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        setReport(prev => ({
          ...prev,
          status:     data.status,
          admin_note: data.admin_note,
          updated_at: data.updated_at,
        }));
      };

      ws.onclose = () => {
        setIsConnected(false);
        // Auto-reconnect logic
        if (reconnectAttempts < maxAttempts) {
          reconnectAttempts++;
          setTimeout(() => {
            console.log(`WebSocket reconnecting... Attempt ${reconnectAttempts}`);
            connect();
          }, Math.min(1000 * Math.pow(2, reconnectAttempts), 10000)); // Exponential backoff
        }
      };

      socketRef.current = ws;
    };

    connect();
  };

  const getStepState = (stepIndex, currentStatus) => {
    if (currentStatus === "Rejected") {
      return stepIndex === 0 ? "completed" : stepIndex === 1 ? "rejected" : "pending";
    }
    const currentIndex = STEPS.findIndex(s => s.status === currentStatus);
    if (currentStatus === "Resolved") return "completed";
    if (stepIndex < currentIndex)  return "completed";
    if (stepIndex === currentIndex) return "active";
    return "pending";
  };

  const getAddress = (r) =>
    r.location?.address || (typeof r.location === "string" ? r.location : "") || "N/A";

  return (
    <div className="ct-page">

      {/* ── Title Bar ── */}
      <div className="ct-title-bar">
        <div className="ct-title-inner">
          <div className="ct-title-icon">📡</div>
          <div>
            <h1 className="ct-title-text">Track Your Report</h1>
            <p className="ct-title-sub">
              Real-time status updates — IRDDP Citizen Portal
            </p>
          </div>
        </div>
      </div>

      <div className="ct-body">
        {!report ? (

          /* ── Search Card ── */
          <div className="ct-search-card">
            <div className="ct-search-header">
              <div className="ct-search-icon">🔍</div>
              <h2 className="ct-search-title">Enter Report Details</h2>
              <p className="ct-search-sub">
                Use the Report ID from your confirmation email and the email
                address you registered with.
              </p>
            </div>

            <form onSubmit={handleTrack} className="ct-form">
              {error && (
                <div className="ct-error">
                  <span>⚠</span>
                  <span>{error}</span>
                </div>
              )}

              <div className="ct-form-group">
                <label className="ct-form-label" htmlFor="ct-report-id">
                  Report ID
                </label>
                <div className="ct-input-wrap">
                  <span className="ct-input-icon">📋</span>
                  <input
                    id="ct-report-id"
                    type="text"
                    className="ct-input"
                    placeholder="e.g. RD-2026-AB12CD34"
                    value={reportId}
                    onChange={e => setReportId(e.target.value)}
                    required
                    autoComplete="off"
                  />
                </div>
              </div>

              <div className="ct-form-group">
                <label className="ct-form-label" htmlFor="ct-email">
                  Registered Email
                </label>
                <div className="ct-input-wrap">
                  <span className="ct-input-icon">✉</span>
                  <input
                    id="ct-email"
                    type="email"
                    className="ct-input"
                    placeholder="your@email.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                  />
                </div>
              </div>

              <button type="submit" className="ct-btn-track" disabled={loading}>
                {loading ? (
                  <><span className="ct-spinner"></span> Searching…</>
                ) : (
                  <><span>🔍</span> Track Status</>
                )}
              </button>
            </form>

            <div className="ct-search-notice">
              <span className="ct-notice-icon">ℹ</span>
              <span>
                Your Report ID was sent to your email immediately after submission.
                Both fields are required to protect your privacy.
              </span>
            </div>
          </div>

        ) : (

          /* ── Result Card ── */
          <div className="ct-result-card">

            {/* Result Top Bar */}
            <div className="ct-result-topbar">
              <button className="ct-btn-back" onClick={() => { setReport(null); setError(""); }}>
                ← New Search
              </button>
              <div className="ct-live-badge">
                <span className={`ct-pulse ${isConnected ? "ct-pulse-on" : "ct-pulse-off"}`}></span>
                {isConnected ? "Live Updates Active" : "Offline"}
              </div>
            </div>

            {/* Status Hero */}
            <div className="ct-status-hero">
              <span className="ct-report-id-pill">{report.report_id}</span>
              <div
                className="ct-status-label"
                style={{ color: report.status === "Rejected" ? "#c0392b" : "var(--gov-blue, #003366)" }}
              >
                {report.status}
              </div>
              <div className="ct-location-row">
                📍 {getAddress(report)}
              </div>
              {report.location?.latitude && (
                <div className="ct-gps-row">
                  GPS: {Number(report.location.latitude).toFixed(6)}, {Number(report.location.longitude).toFixed(6)}
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${report.location.latitude}&mlon=${report.location.longitude}#map=17/${report.location.latitude}/${report.location.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                    className="ct-map-link"
                  >View on Map ↗</a>
                </div>
              )}
            </div>

            {/* Timeline */}
            <div className="ct-timeline-section">
              <div className="ct-timeline">
                {STEPS.map((step, idx) => {
                  const state = getStepState(idx, report.status);
                  return (
                    <div className={`ct-step ct-step-${state}`} key={step.label}>
                      <div className="ct-step-circle">
                        {state === "completed" ? "✓" : state === "rejected" ? "✕" : idx + 1}
                      </div>
                      <div className="ct-step-label">{step.label}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Latest Update */}
            <div className="ct-update-block">
              <div className="ct-update-header">
                <span className="ct-update-icon">📣</span>
                <span className="ct-update-title">Latest Update from Authorities</span>
              </div>
              <div className="ct-update-time">
                📅 {report.updated_at
                  ? new Date(report.updated_at).toLocaleString("en-IN")
                  : new Date(report.created_at).toLocaleString("en-IN")}
              </div>
              <p className="ct-update-note">
                {report.admin_note ||
                  "Your report has been received and is currently in the queue for authority review."}
              </p>
            </div>

            {/* Detection Summary */}
            <div className="ct-summary-row">
              <div className="ct-summary-item">
                <div className="ct-summary-val">{report.total_potholes ?? "—"}</div>
                <div className="ct-summary-key">Potholes Detected</div>
              </div>
              <div className="ct-summary-divider"></div>
              <div className="ct-summary-item">
                <div
                  className="ct-summary-val"
                  style={{ color: PRIORITY_COLORS[report.overall_priority] || "var(--gov-blue)" }}
                >
                  {report.overall_priority || "—"}
                </div>
                <div className="ct-summary-key">AI Priority</div>
              </div>
              <div className="ct-summary-divider"></div>
              <div className="ct-summary-item">
                <div className="ct-summary-val">{report.worst_severity || "—"}</div>
                <div className="ct-summary-key">Worst Severity</div>
              </div>
              <div className="ct-summary-divider"></div>
              <div className="ct-summary-item">
                <div className="ct-summary-val">
                  {report.created_at
                    ? new Date(report.created_at).toLocaleDateString("en-IN")
                    : "—"}
                </div>
                <div className="ct-summary-key">Submitted On</div>
              </div>
            </div>

          </div>
        )}
      </div>

      <style>{`
        /* ── Page ──────────────────────────────────────────── */
        .ct-page {
          min-height: calc(100vh - 160px);
          background: var(--off-white, #F8F9FA);
          font-family: 'Noto Sans', sans-serif;
        }

        /* ── Title Bar ─────────────────────────────────────── */
        .ct-title-bar {
          background: var(--gov-blue, #003366);
          border-bottom: 4px solid var(--saffron, #FF6600);
          padding: 1.25rem 2rem;
        }
        .ct-title-inner {
          max-width: 700px;
          margin: 0 auto;
          display: flex;
          align-items: center;
          gap: 1rem;
        }
        .ct-title-icon {
          font-size: 2rem;
          background: rgba(255,255,255,0.1);
          padding: 0.5rem 0.75rem;
          border-radius: var(--radius, 8px);
          border: 1px solid rgba(255,255,255,0.2);
        }
        .ct-title-text {
          color: #fff;
          font-size: 1.5rem;
          font-weight: 700;
          margin: 0 0 0.2rem;
          font-family: 'Noto Serif', serif;
        }
        .ct-title-sub {
          color: rgba(255,255,255,0.7);
          font-size: 0.82rem;
          margin: 0;
        }

        /* ── Body ──────────────────────────────────────────── */
        .ct-body {
          max-width: 700px;
          margin: 0 auto;
          padding: 2.5rem 1rem 3rem;
        }

        /* ── Search Card ───────────────────────────────────── */
        .ct-search-card {
          background: #fff;
          border: 1px solid var(--border, #DDE1E7);
          border-top: 4px solid var(--gov-blue, #003366);
          border-radius: var(--radius-lg, 12px);
          box-shadow: var(--shadow-md, 0 4px 6px rgba(0,0,0,0.07));
          overflow: hidden;
        }
        .ct-search-header {
          background: var(--gov-blue, #003366);
          padding: 1.75rem 2rem;
          text-align: center;
        }
        .ct-search-icon {
          font-size: 2.2rem;
          margin-bottom: 0.5rem;
        }
        .ct-search-title {
          color: #fff;
          font-size: 1.3rem;
          font-weight: 700;
          font-family: 'Noto Serif', serif;
          margin: 0 0 0.4rem;
        }
        .ct-search-sub {
          color: rgba(255,255,255,0.7);
          font-size: 0.85rem;
          margin: 0;
          line-height: 1.5;
        }

        /* ── Form ──────────────────────────────────────────── */
        .ct-form {
          padding: 1.75rem 2rem;
        }
        .ct-form-group { margin-bottom: 1.25rem; }
        .ct-form-label {
          display: block;
          font-size: 0.82rem;
          font-weight: 700;
          color: var(--text-dark, #1A1A2E);
          margin-bottom: 0.45rem;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .ct-input-wrap {
          position: relative;
          display: flex;
          align-items: center;
        }
        .ct-input-icon {
          position: absolute;
          left: 0.75rem;
          font-size: 1rem;
          pointer-events: none;
        }
        .ct-input {
          width: 100%;
          padding: 0.75rem 0.75rem 0.75rem 2.5rem;
          border: 1.5px solid var(--border, #DDE1E7);
          border-radius: var(--radius, 8px);
          font-size: 0.95rem;
          font-family: 'Noto Sans', sans-serif;
          color: var(--text-dark, #1A1A2E);
          background: var(--off-white, #F8F9FA);
          box-sizing: border-box;
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        .ct-input:focus {
          outline: none;
          border-color: var(--gov-blue, #003366);
          box-shadow: 0 0 0 3px rgba(0,51,102,0.1);
          background: #fff;
        }
        .ct-input::placeholder { color: #aaa; }

        /* ── Error ─────────────────────────────────────────── */
        .ct-error {
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

        /* ── Track Button ──────────────────────────────────── */
        .ct-btn-track {
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
          transition: background 0.2s, transform 0.15s;
          margin-top: 0.25rem;
        }
        .ct-btn-track:hover:not(:disabled) {
          background: var(--gov-blue-dark, #002244);
          transform: translateY(-1px);
        }
        .ct-btn-track:disabled { opacity: 0.7; cursor: not-allowed; }

        .ct-spinner {
          width: 16px; height: 16px;
          border: 2px solid rgba(255,255,255,0.35);
          border-top-color: #fff;
          border-radius: 50%;
          animation: ctSpin 0.7s linear infinite;
          display: inline-block;
        }
        @keyframes ctSpin { to { transform: rotate(360deg); } }

        /* ── Notice ────────────────────────────────────────── */
        .ct-search-notice {
          display: flex;
          align-items: flex-start;
          gap: 0.5rem;
          background: #fffbf0;
          border-top: 1px solid var(--border, #DDE1E7);
          padding: 0.85rem 2rem;
          font-size: 0.78rem;
          color: #7a6200;
          line-height: 1.5;
        }
        .ct-notice-icon {
          flex-shrink: 0;
          color: var(--saffron, #FF6600);
          font-size: 1rem;
        }

        /* ── Result Card ───────────────────────────────────── */
        .ct-result-card {
          background: #fff;
          border: 1px solid var(--border, #DDE1E7);
          border-top: 4px solid var(--gov-blue, #003366);
          border-radius: var(--radius-lg, 12px);
          box-shadow: var(--shadow-md, 0 4px 6px rgba(0,0,0,0.07));
          overflow: hidden;
        }

        /* ── Result Top Bar ────────────────────────────────── */
        .ct-result-topbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.85rem 1.5rem;
          border-bottom: 1px solid var(--border, #DDE1E7);
          background: #fafbfc;
        }
        .ct-btn-back {
          background: none;
          border: 1px solid var(--border, #DDE1E7);
          color: var(--gov-blue, #003366);
          font-size: 0.85rem;
          font-weight: 700;
          padding: 0.4rem 0.85rem;
          border-radius: var(--radius, 8px);
          cursor: pointer;
          font-family: 'Noto Sans', sans-serif;
          transition: background 0.2s;
        }
        .ct-btn-back:hover { background: #f0f4ff; }
        .ct-live-badge {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          font-size: 0.78rem;
          font-weight: 700;
          color: #555;
          background: #f3f5f8;
          padding: 0.3rem 0.75rem;
          border-radius: 20px;
          border: 1px solid var(--border, #DDE1E7);
        }
        .ct-pulse {
          width: 9px; height: 9px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .ct-pulse-on {
          background: var(--green-india, #138808);
          box-shadow: 0 0 6px var(--green-india, #138808);
          animation: ctPulse 1.5s ease-in-out infinite;
        }
        .ct-pulse-off { background: #aaa; }
        @keyframes ctPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        /* ── Status Hero ───────────────────────────────────── */
        .ct-status-hero {
          padding: 2rem 2rem 1.5rem;
          text-align: center;
          border-bottom: 1px solid var(--border, #DDE1E7);
          background: linear-gradient(180deg, #f8f9ff 0%, #fff 100%);
        }
        .ct-report-id-pill {
          display: inline-block;
          background: rgba(0,51,102,0.08);
          color: var(--gov-blue, #003366);
          border: 1px solid rgba(0,51,102,0.15);
          padding: 0.3rem 1rem;
          border-radius: 20px;
          font-size: 0.82rem;
          font-weight: 700;
          font-family: monospace;
          margin-bottom: 0.85rem;
          letter-spacing: 0.05em;
        }
        .ct-status-label {
          font-size: 2.2rem;
          font-weight: 800;
          font-family: 'Noto Serif', serif;
          margin-bottom: 0.5rem;
          line-height: 1.1;
        }
        .ct-location-row {
          font-size: 0.9rem;
          color: #555;
          margin-top: 0.25rem;
        }
        .ct-gps-row {
          font-size: 0.78rem;
          color: #777;
          margin-top: 0.4rem;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          flex-wrap: wrap;
        }
        .ct-map-link {
          color: var(--gov-blue, #003366);
          text-decoration: underline;
          font-weight: 600;
        }

        /* ── Timeline ──────────────────────────────────────── */
        .ct-timeline-section {
          padding: 1.75rem 2rem;
          border-bottom: 1px solid var(--border, #DDE1E7);
        }
        .ct-timeline {
          display: flex;
          justify-content: space-between;
          position: relative;
        }
        .ct-timeline::before {
          content: '';
          position: absolute;
          top: 16px;
          left: 5%;
          right: 5%;
          height: 2px;
          background: var(--border, #DDE1E7);
          z-index: 0;
        }
        .ct-step {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.5rem;
          flex: 1;
        }
        .ct-step-circle {
          width: 34px; height: 34px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.85rem;
          font-weight: 700;
          border: 2px solid var(--border, #DDE1E7);
          background: #fff;
          color: #aaa;
          transition: all 0.3s;
        }
        .ct-step-label {
          font-size: 0.72rem;
          font-weight: 700;
          color: #aaa;
          text-align: center;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        /* Step states */
        .ct-step-completed .ct-step-circle {
          background: var(--green-india, #138808);
          border-color: var(--green-india, #138808);
          color: #fff;
        }
        .ct-step-completed .ct-step-label { color: var(--green-india, #138808); }

        .ct-step-active .ct-step-circle {
          background: var(--gov-blue, #003366);
          border-color: var(--gov-blue, #003366);
          color: #fff;
          box-shadow: 0 0 0 4px rgba(0,51,102,0.15);
        }
        .ct-step-active .ct-step-label { color: var(--gov-blue, #003366); }

        .ct-step-rejected .ct-step-circle {
          background: #c0392b;
          border-color: #c0392b;
          color: #fff;
        }
        .ct-step-rejected .ct-step-label { color: #c0392b; }

        /* ── Update Block ──────────────────────────────────── */
        .ct-update-block {
          margin: 0;
          padding: 1.5rem 2rem;
          border-bottom: 1px solid var(--border, #DDE1E7);
          background: #fafbfc;
        }
        .ct-update-header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.6rem;
        }
        .ct-update-icon { font-size: 1rem; }
        .ct-update-title {
          font-size: 0.78rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--saffron, #FF6600);
        }
        .ct-update-time {
          font-size: 0.78rem;
          color: #888;
          margin-bottom: 0.5rem;
        }
        .ct-update-note {
          font-size: 0.9rem;
          color: #444;
          line-height: 1.6;
          margin: 0;
          padding: 0.75rem 1rem;
          background: #fff;
          border: 1px solid var(--border, #DDE1E7);
          border-left: 3px solid var(--gov-blue, #003366);
          border-radius: var(--radius, 8px);
        }

        /* ── Summary Row ───────────────────────────────────── */
        .ct-summary-row {
          display: flex;
          align-items: center;
          padding: 1.25rem 2rem;
        }
        .ct-summary-item {
          flex: 1;
          text-align: center;
        }
        .ct-summary-val {
          font-size: 1.2rem;
          font-weight: 800;
          color: var(--gov-blue, #003366);
          margin-bottom: 0.2rem;
        }
        .ct-summary-key {
          font-size: 0.7rem;
          color: #888;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          font-weight: 600;
        }
        .ct-summary-divider {
          width: 1px;
          height: 40px;
          background: var(--border, #DDE1E7);
          flex-shrink: 0;
        }

        /* ── Responsive ────────────────────────────────────── */
        @media (max-width: 600px) {
          .ct-title-bar { padding: 1rem; }
          .ct-title-text { font-size: 1.2rem; }
          .ct-form { padding: 1.25rem 1.25rem; }
          .ct-search-header { padding: 1.25rem; }
          .ct-search-notice { padding: 0.85rem 1.25rem; }
          .ct-status-hero { padding: 1.5rem 1.25rem 1.25rem; }
          .ct-status-label { font-size: 1.6rem; }
          .ct-timeline-section { padding: 1.25rem; }
          .ct-timeline::before { display: none; }
          .ct-timeline { flex-wrap: wrap; gap: 0.75rem; justify-content: center; }
          .ct-step { width: 45%; flex: none; }
          .ct-update-block { padding: 1.25rem; }
          .ct-summary-row { padding: 1rem; flex-wrap: wrap; gap: 0.75rem; }
          .ct-summary-item { width: 45%; flex: none; }
          .ct-summary-divider { display: none; }
        }
      `}</style>
    </div>
  );
}