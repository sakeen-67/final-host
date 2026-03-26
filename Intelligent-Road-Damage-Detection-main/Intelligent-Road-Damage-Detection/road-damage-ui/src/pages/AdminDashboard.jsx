import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const API_BASE_URL = "http://localhost:8000";

const STATUSES = ["Pending", "Under Review", "Repair Scheduled", "Resolved", "Rejected"];

const PRIORITY_COLORS = {
  CRITICAL: "#c0392b",
  HIGH:     "#c0641a",
  MEDIUM:   "#8a6200",
  LOW:      "#1a6e35",
  CLEAR:    "#1a3a6e",
};

// Custom colored map markers based on priority
const createCustomIcon = (priority) => {
  const color = PRIORITY_COLORS[priority] || "#003366";
  return L.divIcon({
    className: "custom-map-marker",
    html: `<div style="background-color: ${color}; width: 18px; height: 18px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 6px rgba(0,0,0,0.5);"></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
};

function PriorityBadge({ priority }) {
  const map = {
    CRITICAL: { bg: "#fff0f0", color: "#c0392b", border: "#f5c6cb", label: "CRITICAL" },
    HIGH:     { bg: "#fff4ec", color: "#c0641a", border: "#ffd5b0", label: "HIGH" },
    MEDIUM:   { bg: "#fffbec", color: "#8a6200", border: "#ffe082", label: "MEDIUM" },
    LOW:      { bg: "#f0fff4", color: "#1a6e35", border: "#b7dfbf", label: "LOW" },
    CLEAR:    { bg: "#f0f4ff", color: "#1a3a6e", border: "#b0c4f5", label: "CLEAR" },
  };
  const s = map[priority] || map["LOW"];
  return (
    <span style={{
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
      borderRadius: "4px", padding: "0.2rem 0.55rem",
      fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.04em"
    }}>{s.label}</span>
  );
}

function StatusBadge({ status }) {
  const map = {
    "Pending":          { bg: "#f3f4f6", color: "#374151", border: "#d1d5db" },
    "Under Review":     { bg: "#dbeafe", color: "#1e40af", border: "#bfdbfe" },
    "Repair Scheduled": { bg: "#fef3c7", color: "#92400e", border: "#fde68a" },
    "Resolved":         { bg: "#dcfce7", color: "#166534", border: "#bbf7d0" },
    "Rejected":         { bg: "#fee2e2", color: "#991b1b", border: "#fecaca" },
  };
  const s = map[status] || { bg: "#f3f4f6", color: "#374151", border: "#d1d5db" };
  return (
    <span style={{
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
      borderRadius: "4px", padding: "0.2rem 0.55rem",
      fontSize: "0.72rem", fontWeight: 700
    }}>{status}</span>
  );
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [stats, setStats]                   = useState({ total: 0, pending: 0, under_review: 0, resolved: 0, rejected: 0 });
  const [reports, setReports]               = useState([]);
  const [loading, setLoading]               = useState(true);
  
  // UI State
  const [viewMode, setViewMode]             = useState("inbox"); // "inbox" | "map"
  const [selectedReport, setSelectedReport] = useState(null);
  
  // Form & Filter State
  const [updateLoading, setUpdateLoading]   = useState(false);
  const [deleteLoading, setDeleteLoading]   = useState(false);
  const [newStatus, setNewStatus]           = useState("");
  const [adminNote, setAdminNote]           = useState("");
  const [filterStatus, setFilterStatus]     = useState("ALL");
  const [filterPriority, setFilterPriority] = useState("ALL");
  const [sortBy, setSortBy]                 = useState("date_desc");
  const [toast, setToast]                   = useState(null);
  
  const adminName = localStorage.getItem("adminName") || "Administrator";

  useEffect(() => { fetchData(); }, []);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [statsRes, reportsRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/admin/stats`),
        axios.get(`${API_BASE_URL}/admin/reports`),
      ]);
      setStats(statsRes.data);
      setReports(reportsRes.data);
      
      // Auto-select first report if inbox view is active and none selected
      if (reportsRes.data.length > 0 && !selectedReport) {
        handleSelectReport(reportsRes.data[0]);
      }
    } catch (err) {
      console.error("Error fetching admin data:", err);
      showToast("Failed to load dashboard data.", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("adminToken");
    localStorage.removeItem("adminName");
    navigate("/admin/login");
  };

  const handleSelectReport = (report) => {
    setSelectedReport(report);
    setNewStatus(report.status);
    setAdminNote(report.admin_note || "");
  };

  const handleUpdateReport = async () => {
    setUpdateLoading(true);
    try {
      await axios.patch(`${API_BASE_URL}/admin/reports/${selectedReport.report_id}`, {
        status: newStatus,
        admin_note: adminNote,
      });
      await fetchData();
      showToast("Report updated successfully.");
    } catch (err) {
      showToast("Failed to update: " + (err.response?.data?.detail || err.message), "error");
    } finally {
      setUpdateLoading(false);
    }
  };

  const handleDeleteReport = async (reportId) => {
    if (!window.confirm(`Permanently delete report ${reportId}? This cannot be undone.`)) return;
    setDeleteLoading(true);
    try {
      await axios.delete(`${API_BASE_URL}/admin/reports/${reportId}`);
      await fetchData();
      if (selectedReport?.report_id === reportId) setSelectedReport(null);
      showToast(`Report ${reportId} deleted.`);
    } catch (err) {
      showToast("Delete failed: " + (err.response?.data?.detail || err.message), "error");
    } finally {
      setDeleteLoading(false);
    }
  };

  const exportToCSV = () => {
    if (filteredAndSortedReports.length === 0) return showToast("No data to export", "error");
    
    const headers = ["Report ID", "Date", "Citizen Name", "Phone", "Email", "Location", "Potholes", "Priority", "Status", "Admin Note"];
    const csvRows = [headers.join(",")];
    
    filteredAndSortedReports.forEach(r => {
      const row = [
        r.report_id,
        r.created_at ? new Date(r.created_at).toLocaleDateString("en-IN") : "N/A",
        `"${r.citizen_name || ""}"`,
        r.citizen_phone || "N/A",
        r.citizen_email || "N/A",
        `"${getAddress(r).replace(/"/g, '""')}"`,
        r.total_potholes || 0,
        r.overall_priority || "CLEAR",
        r.status,
        `"${(r.admin_note || "").replace(/"/g, '""')}"`
      ];
      csvRows.push(row.join(","));
    });
    
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.setAttribute("hidden", "");
    a.setAttribute("href", url);
    a.setAttribute("download", `IRDDP_Reports_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const getAddress = (r) => r.location?.address || (typeof r.location === "string" ? r.location : "") || "N/A";

  // Filtering and Sorting Logic
  const filteredAndSortedReports = useMemo(() => {
    let filtered = reports.filter(r => {
      const statusOk   = filterStatus   === "ALL" || r.status === filterStatus;
      const priorityOk = filterPriority === "ALL" || r.overall_priority === filterPriority;
      return statusOk && priorityOk;
    });

    const priorityScore = { "CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "LOW": 1, "CLEAR": 0 };

    return filtered.sort((a, b) => {
      if (sortBy === "date_desc") return new Date(b.created_at) - new Date(a.created_at);
      if (sortBy === "date_asc")  return new Date(a.created_at) - new Date(b.created_at);
      if (sortBy === "priority_desc") {
        const scoreA = priorityScore[a.overall_priority] || 0;
        const scoreB = priorityScore[b.overall_priority] || 0;
        if (scoreB !== scoreA) return scoreB - scoreA;
        return new Date(b.created_at) - new Date(a.created_at); // Tie-breaker
      }
      return 0;
    });
  }, [reports, filterStatus, filterPriority, sortBy]);

  // Default map center (try to find first report with GPS, else default to center of India/TN)
  const defaultMapCenter = useMemo(() => {
    const reportWithGPS = filteredAndSortedReports.find(r => r.location?.latitude);
    return reportWithGPS ? [reportWithGPS.location.latitude, reportWithGPS.location.longitude] : [11.0168, 76.9558];
  }, [filteredAndSortedReports]);

  if (loading && reports.length === 0) {
    return (
      <div className="adm-loading-screen">
        <div className="adm-spinner"></div>
        <p>Loading Command Centre…</p>
      </div>
    );
  }

  return (
    <div className="adm-page">
      {/* ── Toast ── */}
      {toast && (
        <div className={`adm-toast ${toast.type === "error" ? "adm-toast-error" : "adm-toast-success"}`}>
          {toast.type === "error" ? "⚠ " : "✓ "}{toast.msg}
        </div>
      )}

      {/* ── Top Bar ── */}
      <div className="adm-topbar">
        <div className="adm-topbar-inner">
          <div className="adm-topbar-left">
            <div className="adm-topbar-emblem">🏛</div>
            <div>
              <div className="adm-topbar-title">Road Authority Command Centre</div>
              <div className="adm-topbar-sub">IRDDP — Administrative Portal</div>
            </div>
          </div>
          <div className="adm-topbar-right">
            <span className="adm-welcome">👤 {adminName}</span>
            <button className="adm-btn-logout" onClick={handleLogout}>Logout</button>
          </div>
        </div>
      </div>

      <div className="adm-body">
        
        {/* ── Stats ── */}
        <div className="adm-stats-grid">
          {[
            { icon: "📋", val: stats.total,        label: "Total Reports", accent: "var(--gov-blue)" },
            { icon: "⏳", val: stats.pending,      label: "Pending",       accent: "#b45309" },
            { icon: "🔍", val: stats.under_review, label: "Under Review",  accent: "#1d4ed8" },
            { icon: "✅", val: stats.resolved,     label: "Resolved",      accent: "var(--green-india)" },
            { icon: "🚨", val: reports.filter(r=>r.overall_priority==="CRITICAL" && r.status!=="Resolved").length, label: "Critical Active", accent: "#c0392b" },
          ].map(({ icon, val, label, accent }) => (
            <div className="adm-stat-card" key={label}>
              <div className="adm-stat-icon">{icon}</div>
              <div className="adm-stat-val" style={{ color: accent }}>{val}</div>
              <div className="adm-stat-label">{label}</div>
            </div>
          ))}
        </div>

        {/* ── Main Dashboard Header ── */}
        <div className="adm-controls-panel">
          <div className="adm-view-toggles">
            <button className={`adm-view-btn ${viewMode === "inbox" ? "active" : ""}`} onClick={() => setViewMode("inbox")}>
              🗂 Inbox View
            </button>
            <button className={`adm-view-btn ${viewMode === "map" ? "active" : ""}`} onClick={() => setViewMode("map")}>
              🗺 Global Map
            </button>
          </div>
          
          <div className="adm-filters">
            <select className="adm-filter-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
              <option value="date_desc">Sort: Newest First</option>
              <option value="date_asc">Sort: Oldest First</option>
              <option value="priority_desc">Sort: Highest Priority</option>
            </select>
            <select className="adm-filter-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="ALL">All Statuses</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="adm-filter-select" value={filterPriority} onChange={e => setFilterPriority(e.target.value)}>
              <option value="ALL">All Priorities</option>
              {["CRITICAL","HIGH","MEDIUM","LOW","CLEAR"].map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            
            {/* NEW: Clear Filters Button (Only shows if a filter or sort is active) */}
            {(filterStatus !== "ALL" || filterPriority !== "ALL" || sortBy !== "date_desc") && (
              <button 
                className="adm-btn-clear" 
                onClick={() => {
                  setFilterStatus("ALL");
                  setFilterPriority("ALL");
                  setSortBy("date_desc");
                }}
                title="Clear all filters"
              >
                ✕ Clear
              </button>
            )}

            <button className="adm-btn-export" onClick={exportToCSV} title="Export to CSV">📥 Export CSV</button>
            <button className="adm-btn-refresh" onClick={fetchData} title="Refresh Data">↺</button>
          </div>
        </div>

        {/* ── View Rendering ── */}
        {filteredAndSortedReports.length === 0 ? (
          <div className="adm-empty-state">
            <div className="adm-empty-icon">📭</div>
            <h3>No Reports Found</h3>
            <p>Try adjusting your filters to see more results.</p>
          </div>
        ) : viewMode === "map" ? (
          
          /* ── MAP VIEW ── */
          <div className="adm-map-wrapper">
            <MapContainer center={defaultMapCenter} zoom={13} style={{ height: "100%", width: "100%", zIndex: 0 }}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {filteredAndSortedReports.map(r => r.location?.latitude ? (
                <Marker 
                  key={r.report_id} 
                  position={[r.location.latitude, r.location.longitude]}
                  icon={createCustomIcon(r.overall_priority)}
                >
                  <Popup>
                    <div style={{ fontFamily: "Noto Sans", minWidth: "200px" }}>
                      <strong style={{ display: "block", color: "var(--gov-blue)", marginBottom: "4px" }}>{r.report_id}</strong>
                      <div style={{ marginBottom: "6px" }}><PriorityBadge priority={r.overall_priority} /></div>
                      <p style={{ margin: "4px 0", fontSize: "12px" }}><strong>Status:</strong> {r.status}</p>
                      <p style={{ margin: "4px 0", fontSize: "12px" }}><strong>Potholes:</strong> {r.total_potholes}</p>
                      <button 
                        style={{ marginTop: "8px", width: "100%", background: "var(--gov-blue)", color: "white", border: "none", padding: "6px", borderRadius: "4px", cursor: "pointer" }}
                        onClick={() => { handleSelectReport(r); setViewMode("inbox"); }}
                      >
                        View Full Details
                      </button>
                    </div>
                  </Popup>
                </Marker>
              ) : null)}
            </MapContainer>
          </div>
          
        ) : (

          /* ── INBOX (SPLIT) VIEW ── */
          <div className="adm-split-layout">
            
            {/* Left: Scrollable List */}
            <div className="adm-inbox-list">
              {filteredAndSortedReports.map(r => (
                <div 
                  key={r.report_id} 
                  className={`adm-inbox-card ${selectedReport?.report_id === r.report_id ? "active" : ""}`}
                  onClick={() => handleSelectReport(r)}
                >
                  <div className="adm-inbox-card-top">
                    <span className="adm-inbox-id">{r.report_id}</span>
                    <span className="adm-inbox-date">{new Date(r.created_at).toLocaleDateString("en-IN")}</span>
                  </div>
                  <div className="adm-inbox-location">📍 {getAddress(r)}</div>
                  <div className="adm-inbox-card-bottom">
                    <PriorityBadge priority={r.overall_priority} />
                    <StatusBadge status={r.status} />
                  </div>
                </div>
              ))}
            </div>

            {/* Right: Selected Detail Panel */}
            <div className="adm-detail-panel">
              {selectedReport ? (
                <div className="adm-detail-content">
                  
                  {/* Detail Header */}
                  <div className="adm-detail-header">
                    <div>
                      <h2 className="adm-detail-title">Report Detail</h2>
                      <div className="adm-detail-subtitle">{selectedReport.report_id}</div>
                    </div>
                    <div className="adm-detail-actions">
                       <button className="adm-btn-delete-small" onClick={() => handleDeleteReport(selectedReport.report_id)} disabled={deleteLoading}>
                         🗑 Delete
                       </button>
                    </div>
                  </div>

                  <div className="adm-detail-grid">
                    
                    {/* Left Column of Details */}
                    <div className="adm-detail-info-col">
                      <div className="adm-info-block">
                        <div className="adm-info-label">Citizen Details</div>
                        <div className="adm-info-value">{selectedReport.citizen_name}</div>
                        <div className="adm-info-sub">{selectedReport.citizen_email}</div>
                        {selectedReport.citizen_phone && <div className="adm-info-sub">📞 {selectedReport.citizen_phone}</div>}
                      </div>

                      <div className="adm-info-block">
                        <div className="adm-info-label">AI Detection Summary</div>
                        <div className="adm-findings-row">
                          <span className="adm-finding-item">
                            <span className="adm-finding-num">{selectedReport.total_potholes}</span>
                            <span className="adm-finding-key">Potholes</span>
                          </span>
                          <span className="adm-finding-item">
                            <span className="adm-finding-num" style={{fontSize:"1.1rem", marginTop:"2px"}}>{selectedReport.worst_severity || "—"}</span>
                            <span className="adm-finding-key">Worst</span>
                          </span>
                          <span className="adm-finding-item">
                            <PriorityBadge priority={selectedReport.overall_priority} />
                            <span className="adm-finding-key" style={{marginTop:"4px"}}>Priority</span>
                          </span>
                        </div>
                      </div>

                      {/* Status Update Form */}
                      <div className="adm-action-panel">
                        <div className="adm-action-title">Manage Report</div>
                        <div className="adm-form-group">
                          <label className="adm-form-label">Current Status</label>
                          <select className="adm-form-select" value={newStatus} onChange={e => setNewStatus(e.target.value)}>
                            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                        <div className="adm-form-group">
                          <label className="adm-form-label">Admin Notes (Sent to Citizen Tracker)</label>
                          <textarea className="adm-form-textarea" value={adminNote} onChange={e => setAdminNote(e.target.value)} placeholder="Add internal notes about this repair schedule…" rows={3} />
                        </div>
                        <button className="adm-btn-save" onClick={handleUpdateReport} disabled={updateLoading}>
                          {updateLoading ? <span className="adm-btn-spinner"></span> : "✓ Save Changes"}
                        </button>
                      </div>
                    </div>

                    {/* Right Column of Details (Images & Map) */}
                    <div className="adm-detail-media-col">
                      <div className="adm-info-label">Location</div>
                      <div className="adm-location-box">
                         {getAddress(selectedReport)}
                         {selectedReport.location?.latitude && (
                           <a className="adm-map-link-small" href={`https://www.openstreetmap.org/?mlat=${selectedReport.location.latitude}&mlon=${selectedReport.location.longitude}#map=17/${selectedReport.location.latitude}/${selectedReport.location.longitude}`} target="_blank" rel="noreferrer">
                             ↗ Open in Maps
                           </a>
                         )}
                      </div>

                      <div className="adm-info-label" style={{ marginTop: "1rem" }}>
                        Analysed Images ({selectedReport.processed_image_paths?.length || 0})
                      </div>
                      <div className="adm-image-gallery">
                        {(selectedReport.processed_image_paths || []).length === 0 ? (
                          <div className="adm-no-images">No images available</div>
                        ) : (
                          selectedReport.processed_image_paths.map((p, i) => (
                            <div key={i} className="adm-gallery-item">
                              <img src={`${API_BASE_URL}/${p}`} alt={`Detection ${i + 1}`} className="adm-gallery-img" />
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                </div>
              ) : (
                <div className="adm-detail-placeholder">
                  <div className="adm-placeholder-icon">👈</div>
                  <h3>Select a report</h3>
                  <p>Click on any report in the list to view details, AI images, and update its status.</p>
                </div>
              )}
            </div>

          </div>
        )}
      </div>

      <style>{`
        /* ── Core Layout ── */
        .adm-page { min-height: calc(100vh - 160px); background: var(--off-white, #F8F9FA); font-family: 'Noto Sans', sans-serif; }
        .adm-body { max-width: 1400px; margin: 0 auto; padding: 1.5rem 1.5rem 3rem; }
        
        /* ── Loading & Toast ── */
        .adm-loading-screen { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 60vh; gap: 1rem; color: var(--gov-blue, #003366); font-weight: 600; }
        .adm-spinner { width: 40px; height: 40px; border: 3px solid rgba(0,51,102,0.15); border-top-color: var(--gov-blue, #003366); border-radius: 50%; animation: admSpin 0.8s linear infinite; }
        @keyframes admSpin { to { transform: rotate(360deg); } }
        .adm-toast { position: fixed; top: 1.25rem; right: 1.25rem; padding: 0.75rem 1.25rem; border-radius: var(--radius, 8px); font-size: 0.88rem; font-weight: 600; z-index: 9999; box-shadow: var(--shadow-lg, 0 10px 25px rgba(0,0,0,0.15)); animation: admFadeIn 0.3s ease; }
        .adm-toast-success { background: var(--green-india, #138808); color: #fff; border-left: 4px solid #0d6606; }
        .adm-toast-error { background: #fff; color: #c0392b; border-left: 4px solid #c0392b; border: 1px solid #fecaca; }
        @keyframes admFadeIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }

        /* ── Topbar ── */
        .adm-topbar { background: var(--gov-blue, #003366); border-bottom: 4px solid var(--saffron, #FF6600); }
        .adm-topbar-inner { max-width: 1400px; margin: 0 auto; padding: 1rem 1.5rem; display: flex; justify-content: space-between; align-items: center; }
        .adm-topbar-left { display: flex; align-items: center; gap: 0.85rem; }
        .adm-topbar-emblem { font-size: 1.8rem; background: rgba(255,255,255,0.1); padding: 0.4rem 0.6rem; border-radius: var(--radius, 8px); border: 1px solid rgba(255,255,255,0.18); }
        .adm-topbar-title { color: #fff; font-size: 1.15rem; font-weight: 700; font-family: 'Noto Serif', serif; }
        .adm-topbar-sub { color: rgba(255,255,255,0.65); font-size: 0.78rem; margin-top: 0.1rem; }
        .adm-topbar-right { display: flex; align-items: center; gap: 1rem; }
        .adm-welcome { color: rgba(255,255,255,0.85); font-size: 0.88rem; font-weight: 500; }
        .adm-btn-logout { background: rgba(255,255,255,0.12); color: #fff; border: 1px solid rgba(255,255,255,0.3); padding: 0.45rem 1rem; border-radius: var(--radius, 8px); font-size: 0.85rem; cursor: pointer; transition: background 0.2s; }
        .adm-btn-logout:hover { background: rgba(255,255,255,0.22); }

        /* ── Stats Grid ── */
        .adm-stats-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 1rem; margin-bottom: 1.5rem; }
        .adm-stat-card { background: #fff; border: 1px solid var(--border, #DDE1E7); border-top: 3px solid var(--gov-blue, #003366); border-radius: 10px; padding: 1rem; text-align: center; box-shadow: var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.06)); }
        .adm-stat-icon { font-size: 1.5rem; margin-bottom: 0.2rem; }
        .adm-stat-val { font-size: 1.8rem; font-weight: 800; line-height: 1; margin-bottom: 0.2rem; }
        .adm-stat-label { font-size: 0.7rem; color: #666; text-transform: uppercase; font-weight: 700; }

        /* ── Controls Panel ── */
        .adm-controls-panel { display: flex; justify-content: space-between; align-items: center; background: #fff; padding: 0.85rem 1rem; border: 1px solid var(--border, #DDE1E7); border-radius: 10px; margin-bottom: 1rem; flex-wrap: wrap; gap: 1rem; box-shadow: 0 2px 4px rgba(0,0,0,0.02); }
        .adm-view-toggles { display: flex; background: #f0f2f5; padding: 0.25rem; border-radius: 8px; border: 1px solid #e1e5ec; }
        .adm-view-btn { background: none; border: none; padding: 0.5rem 1rem; border-radius: 6px; font-size: 0.85rem; font-weight: 600; color: #555; cursor: pointer; transition: all 0.2s; }
        .adm-view-btn.active { background: #fff; color: var(--gov-blue, #003366); box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .adm-filters { display: flex; gap: 0.5rem; flex-wrap: wrap; }
        .adm-filter-select { padding: 0.45rem 0.75rem; border: 1.5px solid var(--border, #DDE1E7); border-radius: 6px; font-size: 0.82rem; color: var(--text-dark); background: #fff; cursor: pointer; }
        .adm-btn-export { background: #eef2fa; color: var(--gov-blue); border: 1px solid #c7d7f5; padding: 0.45rem 1rem; border-radius: 6px; font-size: 0.82rem; font-weight: 600; cursor: pointer; }
        .adm-btn-export:hover { background: #dbeafe; }
        .adm-btn-clear { background: #fff0f0; color: #c0392b; border: 1px solid #fecaca; padding: 0.45rem 0.8rem; border-radius: 6px; font-size: 0.82rem; font-weight: 600; cursor: pointer; transition: 0.2s; }
        .adm-btn-clear:hover { background: #fecaca; }
        .adm-btn-refresh { padding: 0.45rem 0.8rem; background: var(--gov-blue); color: white; border: none; border-radius: 6px; cursor: pointer; }

        /* ── Empty State ── */
        .adm-empty-state { text-align: center; padding: 4rem; background: #fff; border: 1px dashed var(--border); border-radius: 10px; color: #666; }
        .adm-empty-icon { font-size: 3rem; margin-bottom: 1rem; }

        /* ── Map View ── */
        .adm-map-wrapper { height: 600px; border-radius: 10px; overflow: hidden; border: 1px solid var(--border); box-shadow: 0 4px 12px rgba(0,0,0,0.05); }

        /* ── Split Inbox Layout ── */
        .adm-split-layout { display: flex; gap: 1.5rem; height: calc(100vh - 350px); min-height: 500px; }
        
        /* Inbox List (Left) */
        .adm-inbox-list { width: 35%; display: flex; flex-direction: column; gap: 0.75rem; overflow-y: auto; padding-right: 0.5rem; }
        .adm-inbox-list::-webkit-scrollbar { width: 6px; }
        .adm-inbox-list::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
        .adm-inbox-card { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 1rem; cursor: pointer; transition: all 0.2s ease; border-left: 4px solid transparent; }
        .adm-inbox-card:hover { border-color: #bfdbfe; transform: translateY(-1px); box-shadow: 0 4px 6px rgba(0,0,0,0.04); }
        .adm-inbox-card.active { border-left-color: var(--gov-blue); border-top-color: #bfdbfe; border-right-color: #bfdbfe; border-bottom-color: #bfdbfe; background: #f8faff; box-shadow: 0 4px 10px rgba(0,51,102,0.08); }
        .adm-inbox-card-top { display: flex; justify-content: space-between; margin-bottom: 0.4rem; }
        .adm-inbox-id { font-family: monospace; font-size: 0.85rem; font-weight: 700; color: var(--gov-blue); }
        .adm-inbox-date { font-size: 0.75rem; color: #888; }
        .adm-inbox-location { font-size: 0.82rem; color: #555; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 0.75rem; }
        .adm-inbox-card-bottom { display: flex; gap: 0.5rem; }

        /* Detail Panel (Right) */
        .adm-detail-panel { width: 65%; background: #fff; border: 1px solid var(--border); border-radius: 10px; overflow-y: auto; box-shadow: 0 4px 12px rgba(0,0,0,0.03); }
        .adm-detail-placeholder { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #888; text-align: center; padding: 2rem; }
        .adm-placeholder-icon { font-size: 3rem; margin-bottom: 1rem; opacity: 0.5; }
        
        .adm-detail-content { display: flex; flex-direction: column; height: 100%; }
        .adm-detail-header { padding: 1.25rem 1.5rem; border-bottom: 1px solid var(--border); background: #fafbfc; display: flex; justify-content: space-between; align-items: flex-start; position: sticky; top: 0; z-index: 10; }
        .adm-detail-title { margin: 0 0 0.25rem; font-size: 1.2rem; color: var(--gov-blue); font-family: 'Noto Serif', serif; }
        .adm-detail-subtitle { font-family: monospace; font-size: 0.85rem; background: #eef2fa; padding: 0.2rem 0.5rem; border-radius: 4px; display: inline-block; color: #555; }
        .adm-btn-delete-small { background: #fff0f0; color: #c0392b; border: 1px solid #fecaca; padding: 0.4rem 0.75rem; border-radius: 6px; font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: 0.2s; }
        .adm-btn-delete-small:hover { background: #fecaca; }

        .adm-detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; padding: 1.5rem; }
        .adm-info-block { background: #f8f9fb; border: 1px solid var(--border); border-radius: 8px; padding: 1rem; margin-bottom: 1rem; }
        .adm-info-label { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; color: var(--saffron); margin-bottom: 0.4rem; }
        .adm-info-value { font-size: 0.95rem; font-weight: 600; color: var(--text-dark); margin-bottom: 0.2rem; }
        .adm-info-sub { font-size: 0.82rem; color: #666; margin-top: 0.2rem; }
        
        .adm-findings-row { display: flex; gap: 1.25rem; margin-top: 0.5rem; }
        .adm-finding-item { display: flex; flex-direction: column; align-items: flex-start; }
        .adm-finding-num { font-size: 1.3rem; font-weight: 800; color: var(--gov-blue); line-height: 1; }
        .adm-finding-key { font-size: 0.7rem; color: #888; text-transform: uppercase; margin-top: 0.3rem; font-weight: 600;}

        /* Action Panel Inside Detail */
        .adm-action-panel { background: #f0f4ff; border: 1px solid #c7d7f5; border-left: 4px solid var(--gov-blue); border-radius: 8px; padding: 1.25rem; }
        .adm-action-title { font-size: 0.85rem; font-weight: 700; text-transform: uppercase; color: var(--gov-blue); margin-bottom: 1rem; }
        .adm-form-group { margin-bottom: 1rem; }
        .adm-form-label { display: block; font-size: 0.78rem; font-weight: 700; color: #444; margin-bottom: 0.35rem; }
        .adm-form-select, .adm-form-textarea { width: 100%; padding: 0.6rem 0.75rem; border: 1.5px solid var(--border); border-radius: 6px; font-size: 0.88rem; font-family: inherit; }
        .adm-form-textarea { resize: vertical; }
        .adm-btn-save { width: 100%; padding: 0.75rem; background: var(--green-india); color: #fff; border: none; border-radius: 6px; font-weight: 700; cursor: pointer; transition: 0.2s; display: flex; justify-content: center; align-items: center;}
        .adm-btn-save:hover:not(:disabled) { background: #0d6606; }
        .adm-btn-spinner { width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.4); border-top-color: #fff; border-radius: 50%; animation: admSpin 0.7s linear infinite; }

        /* Media Column */
        .adm-location-box { background: #f8f9fb; padding: 0.75rem 1rem; border: 1px solid var(--border); border-radius: 8px; font-size: 0.85rem; line-height: 1.4; display: flex; flex-direction: column; gap: 0.5rem; align-items: flex-start; }
        .adm-map-link-small { font-size: 0.75rem; color: var(--gov-blue); font-weight: 600; text-decoration: none; background: #eef2fa; padding: 0.2rem 0.5rem; border-radius: 4px;}
        
        .adm-image-gallery { display: flex; flex-direction: column; gap: 1rem; }
        .adm-gallery-item { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.04); }
        .adm-gallery-img { width: 100%; display: block; }
        .adm-no-images { padding: 2rem; text-align: center; border: 1px dashed var(--border); border-radius: 8px; color: #888; font-size: 0.85rem; }

        /* ── Responsive ── */
        @media (max-width: 1024px) {
          .adm-stats-grid { grid-template-columns: repeat(3, 1fr); }
          .adm-split-layout { flex-direction: column; height: auto; }
          .adm-inbox-list { width: 100%; height: 300px; padding-right: 0; }
          .adm-detail-panel { width: 100%; height: auto; overflow-y: visible; }
        }
        @media (max-width: 768px) {
          .adm-controls-panel { flex-direction: column; align-items: stretch; }
          .adm-filters { flex-direction: column; }
          .adm-detail-grid { grid-template-columns: 1fr; gap: 1rem; }
          .adm-stats-grid { grid-template-columns: 1fr 1fr; }
        }
      `}</style>
    </div>
  );
}