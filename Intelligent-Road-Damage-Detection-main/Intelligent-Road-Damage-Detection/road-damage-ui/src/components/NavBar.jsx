import { useState } from "react";
import { Link, useLocation } from "react-router-dom";

export default function NavBar() {
  const location = useLocation();
  const [open, setOpen] = useState(false);

  const links = [
    { path: "/",            label: "Home" },
    { path: "/detect",      label: "Report Damage" },
    { path: "/track",       label: "Track Report" },
    { path: "/about",       label: "About" },
    { path: "/admin/login", label: "Admin Portal" },
  ];

  const isActive = (path) =>
    path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);

  return (
    <nav className="gov-navbar" role="navigation" aria-label="Main navigation">
      <div className="nav-inner">
        <div className="desktop-nav">
          {links.map(link => (
            <Link
              key={link.path}
              to={link.path}
              className={`nav-link ${isActive(link.path) ? "active" : ""}`}
            >
              {link.label}
            </Link>
          ))}
        </div>
        <button
          className="mobile-menu-btn"
          onClick={() => setOpen(o => !o)}
          aria-label="Toggle menu"
          aria-expanded={open}
        >
          {open ? "✕" : "☰"}
        </button>
      </div>
      {open && (
        <div className="mobile-nav">
          {links.map(link => (
            <Link
              key={link.path}
              to={link.path}
              className={`mobile-nav-link ${isActive(link.path) ? "active" : ""}`}
              onClick={() => setOpen(false)}
            >
              {link.label}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}