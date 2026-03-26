import { useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import GovHeader from "./components/GovHeader";
import NavBar from "./components/NavBar";
import GovFooter from "./components/GovFooter";
import HomePage from "./pages/HomePage";
import DetectPage from "./pages/DetectPage";
import AboutPage from "./pages/AboutPage";
import AdminLogin from "./pages/AdminLogin";
import AdminDashboard from "./pages/AdminDashboard";
import CitizenTracking from "./pages/CitizenTracking";
import "./index.css";

export default function App() {
  const [lang, setLang]                 = useState("en");
  const [highContrast, setHighContrast] = useState(false);
  const [fontSize, setFontSize]         = useState(16);
  const [screenReader, setScreenReader] = useState(false);

  const ProtectedAdmin = ({ children }) => {
    const token = localStorage.getItem("adminToken");
    if (!token) return <Navigate to="/admin/login" replace />;
    return children;
  };

  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div className="app-wrapper">
        <GovHeader
          lang={lang}           setLang={setLang}
          highContrast={highContrast} setHighContrast={setHighContrast}
          fontSize={fontSize}   setFontSize={setFontSize}
          screenReader={screenReader} setScreenReader={setScreenReader}
        />
        <NavBar lang={lang} />
        <div className="main-content">
          <Routes>
            <Route path="/"               element={<HomePage lang={lang} />} />
            <Route path="/detect"         element={<DetectPage />} />
            <Route path="/track"          element={<CitizenTracking />} />
            <Route path="/about"          element={<AboutPage />} />
            <Route path="/report"         element={<Navigate to="/track" replace />} />
            <Route path="/admin/login"    element={<AdminLogin />} />
            <Route path="/admin/dashboard" element={
              <ProtectedAdmin><AdminDashboard /></ProtectedAdmin>
            } />
            <Route path="*"              element={<Navigate to="/" replace />} />
          </Routes>
        </div>
        <GovFooter />
      </div>
    </BrowserRouter>
  );
}