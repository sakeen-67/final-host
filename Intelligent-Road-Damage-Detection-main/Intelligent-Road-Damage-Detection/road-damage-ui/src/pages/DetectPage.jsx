import { useState, useRef, useEffect, useCallback } from "react";
import axios from "axios";
import { printReportAsPDF } from "../utils/reportGenerator";
import LocationPicker from "../components/LocationPicker";

const API_BASE = "http://localhost:8000";

const PRIORITY_CONFIG = {
  LOW:      { color: "#1a6e35", bg: "#f0fff4", border: "#b7dfbf", icon: "👁️" },
  MEDIUM:   { color: "#8a6200", bg: "#fffbec", border: "#ffe082", icon: "🔧" },
  HIGH:     { color: "#c0641a", bg: "#fff4ec", border: "#ffd5b0", icon: "⚠️" },
  CRITICAL: { color: "#c0392b", bg: "#fff0f0", border: "#f5c6cb", icon: "🚨" },
  CLEAR:    { color: "#1a3a6e", bg: "#f0f4ff", border: "#b0c4f5", icon: "✅" },
};

const SUBMIT_STEPS = [
  { key: "db",    label: "Saving report to database..."  },
  { key: "email", label: "Sending confirmation email..."  },
  { key: "pdf",   label: "Generating PDF report..."       },
];

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

function StepIndicator({ currentStep }) {
  const steps = [
    { num: 1, label: "Upload & Info"  },
    { num: 2, label: "Review Results" },
    { num: 3, label: "Done"           },
  ];
  return (
    <div className="step-indicator">
      {steps.map((s, i) => (
        <div key={s.num} className="step-indicator-item">
          <div className={`step-circle ${currentStep === s.num ? "step-active" : currentStep > s.num ? "step-done" : "step-pending"}`}>
            {currentStep > s.num ? "✓" : s.num}
          </div>
          <div className={`step-label ${currentStep === s.num ? "step-label-active" : ""}`}>{s.label}</div>
          {i < steps.length - 1 && (
            <div className={`step-connector ${currentStep > s.num ? "step-connector-done" : ""}`} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function DetectPage() {
  const [step, setStep] = useState(1);

  const [tab, setTab]         = useState("upload");
  const [files, setFiles]     = useState([]);
  const [previews, setPreviews] = useState([]);

  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError,  setCameraError]  = useState("");

  const [gpsStatus,  setGpsStatus]  = useState("idle");
  const [gpsAddress, setGpsAddress] = useState("");

  const [form, setForm] = useState({
    citizen_name: "", citizen_email: "", citizen_phone: "",
    location: "", latitude: null, longitude: null, address: ""
  });
  const [emailError,  setEmailError]  = useState("");
  const [formErrors,  setFormErrors]  = useState({});

  const [analyzing,    setAnalyzing]    = useState(false);
  const [analyzeError, setAnalyzeError] = useState("");
  const [analysisData, setAnalysisData] = useState(null);

  const [submitting,   setSubmitting]   = useState(false);
  const [submitError,  setSubmitError]  = useState("");
  const [stepsDone,    setStepsDone]    = useState([]);
  const [submitResult, setSubmitResult] = useState(null);

  const [otp,         setOtp]         = useState("");
  const [otpSent,     setOtpSent]     = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [otpLoading,  setOtpLoading]  = useState(false);
  const [otpError,    setOtpError]    = useState("");
  const [otpSuccess,  setOtpSuccess]  = useState("");

  const fileInputRef = useRef();
  const addMoreRef   = useRef();

  // ── Prevent Accidental Tab Closure ───────────────────────────────
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (analyzing || submitting) {
        e.preventDefault();
        e.returnValue = "We are still processing your images. Are you sure you want to leave?";
        return e.returnValue;
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [analyzing, submitting]);

  // ── GPS ──────────────────────────────────────────────────────────
  const requestGPS = useCallback(() => {
    setGpsStatus("requesting");
    if (!navigator.geolocation) { setGpsStatus("error"); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        const locStr = `${latitude.toFixed(5)}° N, ${longitude.toFixed(5)}° E`;
        
        // Warn user if GPS is highly inaccurate
        if (accuracy > 100) {
          setGpsAddress(`${locStr} (Low Accuracy: ±${Math.round(accuracy)}m)`);
          alert(`GPS accuracy is low (±${Math.round(accuracy)} meters). Please double-check the pin on the map and drag it to the exact pothole location.`);
        } else {
          setGpsAddress(`${locStr} (±${Math.round(accuracy)}m)`);
        }

        setGpsStatus("granted");
        setForm(f => ({ ...f, location: locStr, latitude, longitude }));
      },
      (err) => setGpsStatus(err.code === 1 ? "denied" : "error"),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  // ── Camera ───────────────────────────────────────────────────────
  const startCamera = async () => {
    setCameraError("");
    try {
      // ATTEMPT 1: Force exact environment camera (For mobile)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { exact: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraActive(true);
    } catch (err) {
      // ATTEMPT 2: Fallback to any environment camera (For laptops/desktop)
      try {
        const fallbackStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        streamRef.current = fallbackStream;
        if (videoRef.current) videoRef.current.srcObject = fallbackStream;
        setCameraActive(true);
      } catch (fallbackErr) {
        setCameraError("Camera access denied or unavailable on this device.");
      }
    }
  };

  const stopCamera = () => {
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    setCameraActive(false);
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current, canvas = canvasRef.current;
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `camera_${Date.now()}.jpg`, { type: "image/jpeg" });
      const url  = URL.createObjectURL(blob);
      setFiles(f => [...f, file].slice(0, 10));
      setPreviews(p => [...p, url].slice(0, 10));
    }, "image/jpeg", 0.92);
  };

  const handleCameraTab = () => {
    setTab("camera");
    if (gpsStatus === "idle") requestGPS();
  };

  useEffect(() => { if (tab !== "camera") stopCamera(); return () => stopCamera(); }, [tab]);

  // ── File Upload ──────────────────────────────────────────────────
  const addFiles = (newFiles) => {
    const arr = Array.from(newFiles);
    setFiles(f => [...f, ...arr].slice(0, 10));
    setPreviews(p => [...p, ...arr.map(f => URL.createObjectURL(f))].slice(0, 10));
    setAnalyzeError("");
  };

  const removeFile = (idx) => {
    setFiles(f => f.filter((_, i) => i !== idx));
    setPreviews(p => {
      URL.revokeObjectURL(p[idx]); // Prevent mobile memory leak
      return p.filter((_, i) => i !== idx);
    });
  };

  // ── OTP ──────────────────────────────────────────────────────────
  const handleSendOtp = async () => {
    if (!isValidEmail(form.citizen_email)) {
      setEmailError("Please enter a valid email address first.");
      return;
    }
    setOtpLoading(true); setOtpError(""); setOtpSuccess("");
    try {
      await axios.post(`${API_BASE}/send-otp`, { email: form.citizen_email });
      setOtpSent(true);
      setOtpSuccess(`OTP sent to ${form.citizen_email}. Check your inbox.`);
    } catch (err) {
      setOtpError(err.response?.data?.detail || "Failed to send OTP. Try again.");
    } finally { setOtpLoading(false); }
  };

  const handleVerifyOtp = async () => {
    if (otp.length !== 6) { setOtpError("Please enter the 6-digit code."); return; }
    setOtpLoading(true); setOtpError("");
    try {
      await axios.post(`${API_BASE}/verify-otp`, { email: form.citizen_email, otp });
      setOtpVerified(true);
      setOtpSuccess("Email verified successfully!");
    } catch (err) {
      setOtpError(err.response?.data?.detail || "Invalid code. Please try again.");
    } finally { setOtpLoading(false); }
  };

  const getCaptchaToken = async () => {
    return new Promise((resolve) => {
      if (typeof window.grecaptcha === "undefined") { resolve("dev-token"); return; }
      window.grecaptcha.ready(() => {
        window.grecaptcha.execute("6Le-g4ssAAAAAESvbgGLOgYqXV3FdXp_FQL3xAk9", { action: "submit" }).then(resolve);
      });
    });
  };

  const handleEmailBlur = () => {
    if (form.citizen_email && !isValidEmail(form.citizen_email)) {
      setEmailError("Please enter a valid email address (e.g. name@gmail.com)");
    } else { setEmailError(""); }
  };

  // ── Validation ───────────────────────────────────────────────────
  const validateStep1 = () => {
    const errors = {};
    if (files.length === 0)        errors.files        = "Please upload or capture at least one road image.";
    if (!form.citizen_name.trim()) errors.citizen_name = "Full name is required.";
    if (!form.latitude)            errors.location     = "Please select your location on the map.";
    if (!form.citizen_email)       errors.citizen_email = "Email is required for OTP verification.";
    else if (!isValidEmail(form.citizen_email)) errors.citizen_email = "Please enter a valid email address.";
    // if (!otpVerified)              errors.otp          = "Please verify your email via OTP before submitting.";
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Checklist for analyze button tooltip
  const getReadinessIssues = () => {
    const issues = [];
    if (files.length === 0)   issues.push("Add at least one road image");
    if (!form.latitude)       issues.push("Select location on the map");
    if (!form.citizen_name.trim()) issues.push("Enter your full name");
    // if (!otpVerified)         issues.push("Verify your email via OTP");
    return issues;
  };

  const isReadyToAnalyze = () => getReadinessIssues().length === 0;

  // ── Analyze ──────────────────────────────────────────────────────
  const handleAnalyze = async () => {
    if (!validateStep1()) return;
    setAnalyzing(true); setAnalyzeError("");
    const fd = new FormData();
    files.forEach(f => fd.append("files", f));
    try {
      const res = await axios.post(`${API_BASE}/analyze`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setAnalysisData(res.data);
      setStep(2);
    } catch (err) {
      const detail = err.response?.data?.detail;
      const msg = typeof detail === "object"
        ? `${detail.filename}: ${detail.reason}`
        : detail || "Analysis failed. Please check backend is running.";
      setAnalyzeError(msg);
    } finally { setAnalyzing(false); }
  };

  // ── Submit ───────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (form.citizen_email && !isValidEmail(form.citizen_email)) {
      setEmailError("Please enter a valid email address."); return;
    }
    if (!form.citizen_name.trim()) { setSubmitError("Name is required."); return; }
    if (!form.latitude || !form.longitude) { setSubmitError("Please select the damage location on the map."); return; }

    setSubmitting(true); setSubmitError(""); setStepsDone([]);

    const summary      = analysisData.batch_summary;
    const captchaToken = await getCaptchaToken();

    let submitRes;
    try {
      const res = await axios.post(`${API_BASE}/submit`, {
        citizen_name:     form.citizen_name,
        citizen_email:    form.citizen_email || "",
        citizen_phone:    form.citizen_phone || "",
        location: {
          latitude:  form.latitude,
          longitude: form.longitude,
          address:   form.address || form.location,
        },
        image_paths:      analysisData._image_paths,
        processed_paths:  analysisData._processed_paths,
        total_potholes:   summary.total_potholes,
        worst_severity:   summary.worst_severity,
        overall_priority: summary.overall_priority,
        max_confidence:   summary.max_confidence,
        has_detection:    summary.has_detection,
        total_images:     summary.total_images,
        captcha_token:    captchaToken,
      });
      submitRes = res.data;
      if (submitRes.permanent_image_paths && submitRes.permanent_processed_paths) {
        setAnalysisData(prev => ({
          ...prev,
          _image_paths:     submitRes.permanent_image_paths,
          _processed_paths: submitRes.permanent_processed_paths,
          results: prev.results.map((r, i) => ({
            ...r,
            image_url:           `/${submitRes.permanent_image_paths[i]     ?? prev._image_paths[i]}`,
            processed_image_url: `/${submitRes.permanent_processed_paths[i] ?? prev._processed_paths[i]}`,
          })),
        }));
      }
    } catch (err) {
      setSubmitError(err.response?.data?.detail || "Submission failed. Please try again.");
      setSubmitting(false); return;
    }

    await delay(600);  setStepsDone(["db"]);
    await delay(700);  setStepsDone(["db", "email"]);
    await delay(700);  setStepsDone(["db", "email", "pdf"]);
    await delay(400);

    printReportAsPDF({
      batchReport: { ...summary, report_id: submitRes.report_id, generated_at: submitRes.created_at },
      imageResults: analysisData.results,
      citizen: { name: form.citizen_name, email: form.citizen_email, phone: form.citizen_phone },
      location: form.location,
    });

    setSubmitResult(submitRes);
    setSubmitting(false);
    setStep(3);
  };

  const delay = (ms) => new Promise(res => setTimeout(res, ms));

  const handleReset = () => {
    // Prevent memory leaks on mobile devices by revoking image URLs
    previews.forEach(p => URL.revokeObjectURL(p)); 

    setFiles([]); setPreviews([]);
    setAnalysisData(null); setSubmitResult(null);
    setStepsDone([]); setAnalyzeError(""); setSubmitError("");
    setEmailError(""); setFormErrors({});
    setOtp(""); setOtpSent(false); setOtpVerified(false); setOtpError(""); setOtpSuccess("");
    setAnalyzing(false); setSubmitting(false);
    setStep(1);
    setForm({ citizen_name: "", citizen_email: "", citizen_phone: "", location: gpsAddress || "", latitude: null, longitude: null, address: "" });
    stopCamera(); setCameraActive(false);
  };

  const batchSummary = analysisData?.batch_summary;
  const pCfg = batchSummary ? (PRIORITY_CONFIG[batchSummary.overall_priority] || PRIORITY_CONFIG["CLEAR"]) : null;
  const readinessIssues = getReadinessIssues();

  // ════════════════════════════════════════════════════════════════
  return (
    <main id="main-content" className="page-wrapper">
      <div className="page-header">
        <div className="breadcrumb">🏠 Home › Report Road Damage</div>
        <h1 className="page-title">Report Road Damage</h1>
        <p className="page-subtitle">Upload road images for instant AI-powered damage assessment</p>
      </div>

      <StepIndicator currentStep={step} />

      {/* ══════════════ STEP 1 ══════════════ */}
      {step === 1 && (
        <div className="detect-layout">

          {/* LEFT: Images */}
          <div className="detect-form-panel">
            <div className="form-card">
              <div className="form-card-header">
                <span className="form-card-icon">📸</span>
                <span>
                  Road Images
                  {files.length > 0 && <span className="img-count-badge">{files.length}/10</span>}
                </span>
              </div>

              <div className="input-tabs">
                <button className={`input-tab ${tab === "upload" ? "active" : ""}`} onClick={() => setTab("upload")}>📁 Upload</button>
                <button className={`input-tab ${tab === "camera" ? "active" : ""}`} onClick={handleCameraTab}>📷 Camera</button>
              </div>

              {tab === "upload" && (
                <div className="tab-content">
                  <div className="upload-zone"
                    onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
                    onDragOver={(e) => e.preventDefault()}
                    onClick={() => fileInputRef.current.click()}>
                    <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={e => addFiles(e.target.files)} />
                    <div className="upload-icon">📁</div>
                    <div className="upload-title">Drag & Drop road images here</div>
                    <div className="upload-sub">or click to browse</div>
                    <div className="upload-formats">JPG, PNG, WEBP — up to 10 images, max 10MB each</div>
                  </div>
                </div>
              )}

              {tab === "camera" && (
                <div className="tab-content">
                  <div className={`gps-status-bar gps-${gpsStatus}`}>
                    {gpsStatus === "idle"       && <span>📍 GPS will be requested</span>}
                    {gpsStatus === "requesting" && <span>📍 Requesting GPS...</span>}
                    {gpsStatus === "granted"    && <span>✅ GPS: {gpsAddress}</span>}
                    {gpsStatus === "denied"     && <span>⚠️ GPS denied <button className="gps-retry-btn" onClick={requestGPS}>Retry</button></span>}
                    {gpsStatus === "error"      && <span>⚠️ GPS unavailable <button className="gps-retry-btn" onClick={requestGPS}>Retry</button></span>}
                  </div>
                  {cameraError && <div className="error-box" style={{margin:"0 0.75rem 0.75rem"}}>{cameraError}</div>}
                  {!cameraActive ? (
                    <div className="camera-start-box">
                      <div className="camera-icon">📷</div>
                      <div className="camera-start-title">Rear camera for road photos</div>
                      <div className="camera-start-sub">Rear-facing camera selected by default</div>
                      <button className="btn-start-camera" onClick={startCamera}>▶ Start Camera</button>
                    </div>
                  ) : (
                    <div className="camera-view">
                      <video ref={videoRef} autoPlay playsInline muted className="camera-video" />
                      <canvas ref={canvasRef} style={{display:"none"}} />
                      <div className="camera-controls">
                        <button className="btn-capture" onClick={capturePhoto} disabled={files.length >= 10}>
                          📸 Capture {files.length >= 10 && "(Max)"}
                        </button>
                        <button className="btn-stop-camera" onClick={stopCamera}>⏹ Stop</button>
                      </div>
                      {files.length > 0 && <div className="captured-count">✅ {files.length} photo(s) ready</div>}
                    </div>
                  )}
                </div>
              )}

              {previews.length > 0 && (
                <div className="image-manager">
                  <div className="img-manager-title">
                    📋 Selected ({files.length}/10)
                    {files.length < 10 && (
                      <button className="btn-add-more" onClick={() => addMoreRef.current.click()}>+ Add More</button>
                    )}
                    <input ref={addMoreRef} type="file" accept="image/*" multiple hidden onChange={e => addFiles(e.target.files)} />
                  </div>
                  <div className="image-thumbs">
                    {previews.map((p, i) => (
                      <div className={`img-thumb ${analyzing ? "is-analyzing" : ""}`} key={i}>
                        <img src={p} alt={`Image ${i+1}`} />
                        {!analyzing && <button className="img-delete-btn" onClick={() => removeFile(i)}>✕</button>}
                        <div className="img-thumb-label">{i+1}</div>
                        {analyzing && <div className="scanner-line"></div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {formErrors.files && <div className="field-error" style={{margin:"0.5rem 1rem 0.75rem"}}>⚠️ {formErrors.files}</div>}
            </div>
          </div>

          {/* RIGHT: Form — Location first, then details */}
          <div className="detect-results-panel">

            {/* ── Location Card (FIRST) ── */}
            <div className="form-card">
              <div className="form-card-header">
                <span className="form-card-icon">📍</span>
                <span>Damage Location <span className="required-star">*</span></span>
                {form.latitude && (
                  <span className="verified-inline">✅ Location set</span>
                )}
              </div>
              <div style={{padding:"1rem"}}>
                <LocationPicker
                  onLocationSelect={(data) => {
                    setForm(prev => ({
                      ...prev,
                      latitude:  data.latitude,
                      longitude: data.longitude,
                      address:   data.address,
                      location:  data.address,
                    }));
                    setFormErrors(fe => ({...fe, location: ""}));
                  }}
                />
                {formErrors.location && (
                  <div className="field-error" style={{marginTop:"0.5rem"}}>⚠️ {formErrors.location}</div>
                )}
              </div>
            </div>

            {/* ── Citizen Info Card ── */}
            <div className="form-card">
              <div className="form-card-header">
                <span className="form-card-icon">👤</span>
                <span>Your Details</span>
              </div>
              <div className="form-grid">

                {/* Name */}
                <div className="form-group">
                  <label>Full Name <span className="required-star">*</span></label>
                  <input
                    type="text"
                    placeholder="Enter your full name"
                    value={form.citizen_name}
                    className={formErrors.citizen_name ? "input-error" : ""}
                    onChange={e => { setForm({...form, citizen_name: e.target.value}); setFormErrors(fe => ({...fe, citizen_name: ""})); }}
                  />
                  {formErrors.citizen_name && <div className="field-error">⚠️ {formErrors.citizen_name}</div>}
                </div>

                {/* Email + OTP — clean dedicated section */}
                <div className="form-group">
                  <label>Email Address <span className="required-star">*</span></label>

                  {/* Email input row */}
                  <div className="otp-email-row">
                    <input
                      type="email"
                      placeholder="your@email.com"
                      value={form.citizen_email}
                      disabled={otpVerified}
                      className={emailError || formErrors.citizen_email ? "input-error" : ""}
                      onChange={e => {
                        setForm({...form, citizen_email: e.target.value});
                        setEmailError(""); setOtpSent(false); setOtpVerified(false);
                        setOtpSuccess(""); setFormErrors(fe => ({...fe, citizen_email: "", otp: ""}));
                      }}
                      onBlur={handleEmailBlur}
                    />
                    {!otpVerified && (
                      <button
                        className="btn-otp-send"
                        onClick={handleSendOtp}
                        disabled={otpLoading || !form.citizen_email || !isValidEmail(form.citizen_email)}
                      >
                        {otpLoading && !otpSent ? (
                          <><span className="spinner" style={{width:"12px",height:"12px"}}></span></>
                        ) : otpSent ? "Resend" : "Send OTP"}
                      </button>
                    )}
                  </div>

                  {/* OTP verified state */}
                  {otpVerified && (
                    <div className="otp-verified-bar">
                      <span>✅</span>
                      <span>Email verified — <strong>{form.citizen_email}</strong></span>
                    </div>
                  )}

                  {/* OTP entry — shown after send, before verify */}
                  {otpSent && !otpVerified && (
                    <div className="otp-entry-block">
                      <div className="otp-entry-label">
                        📧 Enter the 6-digit code sent to <strong>{form.citizen_email}</strong>
                      </div>
                      <div className="otp-input-row">
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength="6"
                          placeholder="_ _ _ _ _ _"
                          value={otp}
                          onChange={e => { setOtp(e.target.value.replace(/\D/g,"")); setOtpError(""); }}
                          className="otp-digit-input"
                        />
                        <button
                          className="btn-otp-verify"
                          onClick={handleVerifyOtp}
                          disabled={otpLoading || otp.length !== 6}
                        >
                          {otpLoading ? <span className="spinner" style={{width:"12px",height:"12px"}}></span> : "Verify"}
                        </button>
                      </div>
                    </div>
                  )}

                  {otpError   && <div className="field-error" style={{marginTop:"0.4rem"}}>⚠️ {otpError}</div>}
                  {otpSuccess && !otpVerified && <div className="otp-success-note">{otpSuccess}</div>}
                  {(emailError || formErrors.citizen_email) && (
                    <div className="field-error" style={{marginTop:"0.4rem"}}>⚠️ {emailError || formErrors.citizen_email}</div>
                  )}
                  {formErrors.otp && !otpVerified && (
                    <div className="field-error" style={{marginTop:"0.4rem"}}>⚠️ {formErrors.otp}</div>
                  )}
                  {!otpSent && !otpVerified && !emailError && (
                    <div className="form-hint">📧 OTP verification required to submit</div>
                  )}
                </div>

                {/* Phone */}
                <div className="form-group">
                  <label>Phone Number <span className="optional-tag">Optional</span></label>
                  <input
                    type="tel"
                    placeholder="+91 XXXXX XXXXX"
                    value={form.citizen_phone}
                    onChange={e => setForm({...form, citizen_phone: e.target.value})}
                  />
                </div>

              </div>
            </div>

            {/* ── Readiness Checklist + Analyze Button ── */}
            <div className="analyze-panel">
              {analyzeError && (
                <div className="error-box" style={{marginBottom:"1rem"}}>⚠️ {analyzeError}</div>
              )}

              {/* Checklist — only shown when not ready */}
              {!isReadyToAnalyze() && (
                <div className="readiness-checklist">
                  <div className="readiness-title">Complete these steps to analyze:</div>
                  {readinessIssues.map((issue, i) => (
                    <div className="readiness-item" key={i}>
                      <span className="readiness-dot">○</span>
                      <span>{issue}</span>
                    </div>
                  ))}
                </div>
              )}

              {isReadyToAnalyze() && (
                <div className="readiness-ready">
                  ✅ All set — ready to analyze {files.length} image{files.length !== 1 ? "s" : ""}
                </div>
              )}

              <button
                className={`btn-submit ${isReadyToAnalyze() ? "btn-submit-ready" : ""}`}
                onClick={handleAnalyze}
                disabled={analyzing}
              >
                {analyzing
                  ? <><span className="spinner"></span> Analyzing {files.length} image(s)…</>
                  : isReadyToAnalyze()
                    ? "🔍 Analyze Images"
                    : "🔍 Analyze Images"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════ STEP 2 ══════════════ */}
      {step === 2 && analysisData && batchSummary && (
        <div className="detect-layout">
          <div className="detect-form-panel">
            <div className="form-card">
              <div className="form-card-header">
                <span className="form-card-icon">👤</span>
                <span>Review Your Information</span>
                <span className="editable-tag">✏️ Editable</span>
              </div>
              <div className="form-grid">
                <div className="form-group">
                  <label>Full Name <span className="required-star">*</span></label>
                  <input type="text" placeholder="Enter your full name" value={form.citizen_name}
                    onChange={e => setForm({...form, citizen_name: e.target.value})} />
                </div>
                <div className="form-group">
                  <label>Email Address</label>
                  <input type="email" placeholder="your@email.com" value={form.citizen_email}
                    className={emailError ? "input-error" : ""}
                    onChange={e => { setForm({...form, citizen_email: e.target.value}); setEmailError(""); }}
                    onBlur={handleEmailBlur} />
                  {emailError && <div className="field-error">⚠️ {emailError}</div>}
                </div>
                <div className="form-group">
                  <label>Phone Number <span className="optional-tag">Optional</span></label>
                  <input type="tel" placeholder="+91 XXXXX XXXXX" value={form.citizen_phone}
                    onChange={e => setForm({...form, citizen_phone: e.target.value})} />
                </div>
                <div className="form-group">
                  <label>Damage Location</label>
                  <input type="text" value={form.location}
                    onChange={e => setForm({...form, location: e.target.value})} />
                </div>
              </div>
            </div>

            <div className="form-card">
              <div className="form-card-header">
                <span className="form-card-icon">📸</span>
                <span>Submitted Images ({previews.length})</span>
              </div>
              <div className="image-manager" style={{borderTop:"none"}}>
                <div className="image-thumbs">
                  {previews.map((p, i) => (
                    <div className="img-thumb" key={i}>
                      <img src={p} alt={`Image ${i+1}`} />
                      <div className="img-thumb-label">{i+1}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {submitError && <div className="error-box" style={{marginBottom:"1rem"}}>⚠️ {submitError}</div>}

            {!submitting && (
              <div className="submit-row">
                <button className="btn-confirm-submit" onClick={handleSubmit}>✅ Submit Official Report</button>
                <button className="btn-back" onClick={() => { setStep(1); setAnalysisData(null); }}>← Go Back & Edit</button>
              </div>
            )}

            {submitting && (
              <div className="submission-progress-card">
                <div className="spc-title">Submitting Your Report...</div>
                {SUBMIT_STEPS.map((s, i) => {
                  const isDone   = stepsDone.includes(s.key);
                  const isActive = !isDone && stepsDone.length === i;
                  return (
                    <div className={`spc-step ${isDone ? "spc-done" : isActive ? "spc-active" : "spc-pending"}`} key={s.key}>
                      <div className="spc-icon">{isDone ? "✅" : <span className="spc-spinner"></span>}</div>
                      <div className="spc-label">{s.label}</div>
                    </div>
                  );
                })}
              </div>
            )}
            <button className="btn-reset-small" onClick={handleReset} style={{marginTop:"0.75rem"}}>↺ Start New Report</button>
          </div>

          <div className="detect-results-panel">
            <div className="batch-summary-card" style={{borderColor: pCfg.border}}>
              <div className="bsc-header" style={{background: pCfg.color}}>
                <div className="bsc-left">
                  <div className="bsc-report-id">AI Analysis Complete</div>
                  <div className="bsc-sub">{batchSummary.total_images} image(s) analyzed</div>
                </div>
                <div className="bsc-priority-badge">{pCfg.icon} {batchSummary.overall_priority}</div>
              </div>
              {batchSummary.has_detection ? (
                <div className="bsc-stats" style={{background: pCfg.bg}}>
                  <div className="bsc-stat"><div className="bsc-stat-label">Total Potholes</div><div className="bsc-stat-val">{batchSummary.total_potholes}</div></div>
                  <div className="bsc-stat"><div className="bsc-stat-label">Cracks Detected</div><div className="bsc-stat-val" style={{color:"#b45309"}}>{batchSummary.total_cracks ?? 0}</div></div>
                  <div className="bsc-stat"><div className="bsc-stat-label">Worst Severity</div><div className="bsc-stat-val">{batchSummary.worst_severity}</div></div>
                  <div className="bsc-stat"><div className="bsc-stat-label">Max Confidence</div><div className="bsc-stat-val">{(parseFloat(batchSummary.max_confidence)*100).toFixed(1)}%</div></div>
                  <div className="bsc-stat"><div className="bsc-stat-label">Action Needed</div><div className="bsc-stat-val" style={{color:pCfg.color,fontSize:"0.82rem"}}>{batchSummary.recommended_action}</div></div>
                </div>
              ) : (
                <div className="no-detection-box" style={{margin:"1rem"}}>
                  <div className="no-det-icon">✅</div>
                  <div className="no-det-title">No Road Damage Detected</div>
                  <div className="no-det-sub">AI found no significant damage across all submitted images.</div>
                </div>
              )}
            </div>

            {analysisData.results.map((result, idx) => {
              const ir    = result.image_report;
              const iPCfg = PRIORITY_CONFIG[ir?.priority_level || "CLEAR"] || PRIORITY_CONFIG["CLEAR"];
              return (
                <div className="result-card" key={idx}>
                  <div className="result-card-header">
                    <span>🖼️ Image {idx+1}: {result.filename}</span>
                    <span className="report-id-badge" style={{background: iPCfg.color}}>
                      {ir ? ir.priority_level : "CLEAR"}
                    </span>
                  </div>
                  <div className="result-images">
                    <div className="result-image-box">
                      <div className="result-image-label">Original</div>
                      <img src={`${API_BASE}${result.image_url}`} alt="Original" />
                    </div>
                    <div className="result-image-box">
                      <div className="result-image-label">AI Detection</div>
                      <img src={`${API_BASE}${result.processed_image_url}`} alt="Processed" />
                    </div>
                  </div>
                  {ir ? (
                    <div className="report-details" style={{borderColor:iPCfg.border, background:iPCfg.bg}}>
                      <div className="report-priority-banner" style={{background:iPCfg.color}}>
                        <span>{iPCfg.icon} {ir.priority_level}</span>
                        <span style={{marginLeft:"auto",fontSize:"0.82rem"}}>— {ir.recommended_action}</span>
                      </div>
                      <div className="report-stats-grid">
                        <div className="report-stat"><div className="rs-label">Potholes</div><div className="rs-value">{ir.detected_potholes}</div></div>
                        {ir.detected_cracks > 0 && (
                        <div className="report-stat"><div className="rs-label">Cracks</div><div className="rs-value" style={{color:"#b45309"}}>{ir.detected_cracks}</div></div>
                        )}
                        <div className="report-stat"><div className="rs-label">Severity</div><div className="rs-value">{ir.highest_severity}</div></div>
                        <div className="report-stat"><div className="rs-label">Confidence</div><div className="rs-value">{(parseFloat(ir.confidence_level)*100).toFixed(1)}%</div></div>
                      </div>
                    </div>
                  ) : (
                    <div className="no-detection-box" style={{margin:"0 1.25rem 1rem"}}>
                      <div className="no-det-icon">✅</div>
                      <div className="no-det-title">No Damage Detected</div>
                      <div className="no-det-sub">Road appears in good condition.</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ══════════════ STEP 3 ══════════════ */}
      {step === 3 && submitResult && (
        <div className="step3-wrapper">
          <div className="success-banner">
            <div className="sb-icon">🎉</div>
            <div className="sb-title">Report Successfully Submitted!</div>
            <div className="sb-report-id">{submitResult.report_id}</div>
            <div className="sb-sub">Your report has been officially recorded.</div>
            <div className="sb-details">
              {form.citizen_email && submitResult.email_sent && (
                <div className="sb-detail-item">✅ Confirmation email sent to <strong>{form.citizen_email}</strong></div>
              )}
              <div className="sb-detail-item">📍 Location: <strong>{submitResult.location?.address || form.address || form.location}</strong></div>
              <div className="sb-detail-item">📄 PDF report downloaded to your device</div>
            </div>
            <div className="sb-track-note">
              Track anytime at <strong>Track Report</strong> using ID: <strong>{submitResult.report_id}</strong>
            </div>
            <div className="sb-actions" style={{display:"flex", gap:"1rem", justifyContent:"center", marginTop:"1.5rem", flexWrap:"wrap"}}>
              <button className="btn-submit" style={{width:"auto", padding:"0.75rem 2rem"}} onClick={handleReset}>
                ↺ Start New Report
              </button>
              <button className="btn-submit" style={{width:"auto", padding:"0.75rem 2rem", background:"var(--gov-blue)"}}
                onClick={() => { window.location.href = `/track?id=${submitResult.report_id}&email=${form.citizen_email}`; }}>
                🔍 Track Live Progress
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        /* Step indicator */
        .step-indicator { display:flex; align-items:center; justify-content:center; padding:1.5rem 2rem 0.5rem; max-width:480px; margin:0 auto; }
        .step-indicator-item { display:flex; flex-direction:column; align-items:center; position:relative; flex:1; }
        .step-circle { width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:0.9rem; border:2px solid #ccc; background:#fff; color:#999; transition:all 0.3s; z-index:1; }
        .step-active  { border-color:var(--gov-blue,#003366); background:var(--gov-blue,#003366); color:#fff; }
        .step-done    { border-color:var(--green-india,#138808); background:var(--green-india,#138808); color:#fff; }
        .step-pending { border-color:#ccc; background:#f5f5f5; color:#aaa; }
        .step-label { font-size:0.72rem; color:#888; margin-top:0.3rem; text-align:center; white-space:nowrap; }
        .step-label-active { color:var(--gov-blue,#003366); font-weight:600; }
        .step-connector { position:absolute; top:18px; left:calc(50% + 18px); width:calc(100% - 36px); height:2px; background:#ccc; z-index:0; }
        .step-connector-done { background:var(--green-india,#138808); }

        /* OTP section */
        .otp-email-row {
          display: flex;
          gap: 0.5rem;
          align-items: stretch;
        }
        .otp-email-row input { flex: 1; min-width: 0; }
        .btn-otp-send {
          padding: 0 1rem;
          background: var(--gov-blue, #003366);
          color: #fff;
          border: none;
          border-radius: var(--radius, 8px);
          font-size: 0.8rem;
          font-weight: 700;
          cursor: pointer;
          white-space: nowrap;
          font-family: inherit;
          min-height: 44px;
          transition: background 0.2s;
          flex-shrink: 0;
        }
        .btn-otp-send:hover:not(:disabled) { background: var(--gov-blue-dark, #002244); }
        .btn-otp-send:disabled { background: #9aabb8; cursor: not-allowed; }

        .otp-entry-block {
          margin-top: 0.75rem;
          background: #f0f4ff;
          border: 1px solid #c7d7f5;
          border-left: 3px solid var(--gov-blue, #003366);
          border-radius: var(--radius, 8px);
          padding: 0.85rem 1rem;
        }
        .otp-entry-label {
          font-size: 0.78rem;
          color: #444;
          margin-bottom: 0.6rem;
          line-height: 1.4;
        }
        .otp-input-row {
          display: flex;
          gap: 0.5rem;
          align-items: stretch;
        }
        .otp-digit-input {
          flex: 1;
          text-align: center;
          letter-spacing: 6px;
          font-size: 1.1rem;
          font-weight: 700;
          border: 1.5px solid var(--border, #DDE1E7);
          border-radius: var(--radius, 8px);
          padding: 0.6rem;
          font-family: monospace;
          min-height: 48px;
        }
        .otp-digit-input:focus {
          outline: none;
          border-color: var(--gov-blue, #003366);
        }
        .btn-otp-verify {
          padding: 0 1.25rem;
          background: var(--green-india, #138808);
          color: #fff;
          border: none;
          border-radius: var(--radius, 8px);
          font-size: 0.88rem;
          font-weight: 700;
          cursor: pointer;
          font-family: inherit;
          min-height: 48px;
          transition: background 0.2s;
          flex-shrink: 0;
        }
        .btn-otp-verify:hover:not(:disabled) { background: #0d6606; }
        .btn-otp-verify:disabled { background: #9aabb8; cursor: not-allowed; }

        .otp-verified-bar {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-top: 0.5rem;
          background: #f0fff4;
          border: 1px solid #b7dfbf;
          border-left: 3px solid var(--green-india, #138808);
          border-radius: var(--radius, 8px);
          padding: 0.6rem 0.85rem;
          font-size: 0.85rem;
          color: #1a6e35;
          font-weight: 500;
        }
        .otp-success-note {
          font-size: 0.78rem;
          color: #1a6e35;
          margin-top: 0.35rem;
          padding: 0.3rem 0.5rem;
          background: #f0fff4;
          border-radius: 4px;
        }

        /* Verified inline badge in card header */
        .verified-inline {
          margin-left: auto;
          font-size: 0.72rem;
          color: var(--green-india, #138808);
          background: rgba(19,136,8,0.08);
          border: 1px solid rgba(19,136,8,0.2);
          border-radius: 4px;
          padding: 0.15rem 0.5rem;
        }

        /* Readiness checklist */
        .analyze-panel {
          margin-bottom: 1rem;
        }
        .readiness-checklist {
          background: #fffbf0;
          border: 1px solid #ffe082;
          border-left: 3px solid var(--saffron, #FF6600);
          border-radius: var(--radius, 8px);
          padding: 0.85rem 1rem;
          margin-bottom: 0.85rem;
        }
        .readiness-title {
          font-size: 0.78rem;
          font-weight: 700;
          color: #8a6200;
          margin-bottom: 0.5rem;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .readiness-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.82rem;
          color: #7a5500;
          padding: 0.2rem 0;
        }
        .readiness-dot {
          color: var(--saffron, #FF6600);
          font-size: 0.9rem;
          flex-shrink: 0;
        }
        .readiness-ready {
          background: #f0fff4;
          border: 1px solid #b7dfbf;
          border-left: 3px solid var(--green-india, #138808);
          border-radius: var(--radius, 8px);
          padding: 0.75rem 1rem;
          font-size: 0.85rem;
          color: #1a6e35;
          font-weight: 600;
          margin-bottom: 0.85rem;
        }
        .btn-submit-ready {
          background: var(--gov-blue, #003366) !important;
          box-shadow: 0 4px 14px rgba(0,51,102,0.25);
        }

        /* Field errors */
        .field-error { font-size:0.78rem; color:#c0392b; margin-top:0.3rem; }
        input.input-error { border-color:#c0392b !important; background:#fdecea !important; }

        /* Back button */
        .btn-back { width:100%; padding:0.65rem; background:#f0f0f0; color:#555; border:1px solid #ddd; border-radius:6px; font-size:0.9rem; cursor:pointer; margin-top:0.6rem; transition:background 0.2s; font-family:inherit; }
        .btn-back:hover { background:#e0e0e0; }

        /* Editable tag */
        .editable-tag { margin-left:auto; font-size:0.72rem; color:#27ae60; background:#eafaf1; border:1px solid #a9dfbf; border-radius:4px; padding:0.15rem 0.5rem; }

        /* Step 3 */
        .step3-wrapper { max-width:640px; margin:2rem auto; padding:0 1rem; }

        /* Mobile */
        @media (max-width: 600px) {
          .otp-email-row { flex-wrap: wrap; }
          .btn-otp-send { width: 100%; }
          .otp-input-row { flex-direction: column; }
          .btn-otp-verify { width: 100%; }
        }

        /* --- PREMIUM UI UPGRADES --- */

        /* 1. Image Thumbnail Polish */
        .img-thumb {
          position: relative;
          width: 100px;
          height: 100px;
          border-radius: 8px;
          overflow: hidden;
          box-shadow: 0 2px 5px rgba(0,0,0,0.1);
          border: 2px solid transparent;
          transition: transform 0.2s, border-color 0.2s;
        }
        .img-thumb:hover {
          transform: translateY(-2px);
          border-color: var(--gov-blue, #003366);
        }
        .img-thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover; /* Prevents squishing! */
          display: block;
        }
        
        /* 2. AI Scanning Animation */
        .img-thumb.is-analyzing img {
          filter: brightness(0.6) sepia(0.2) hue-rotate(180deg) saturate(150%);
          transition: filter 0.5s;
        }
        .scanner-line {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 4px;
          background: #00ffcc;
          box-shadow: 0 0 10px #00ffcc, 0 0 20px #00ffcc;
          animation: scan 1.5s ease-in-out infinite alternate;
          z-index: 10;
        }
        @keyframes scan {
          0% { top: 0; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { top: calc(100% - 4px); opacity: 0; }
        }

        /* 3. Sticky Bottom Action Bar for Mobile */
        @media (max-width: 768px) {
          .analyze-panel, .submit-row {
            position: sticky;
            bottom: 0;
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            padding: 1rem;
            margin: 0 -1rem; /* Pulls it flush to the screen edges */
            border-top: 1px solid var(--border, #DDE1E7);
            box-shadow: 0 -4px 15px rgba(0,0,0,0.08);
            z-index: 100;
          }
          .detect-results-panel {
            padding-bottom: 80px; /* Gives room so the sticky bar doesn't cover content */
          }
        }
      `}</style>
    </main>
  );
}