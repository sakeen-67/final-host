import { useState, useCallback, useEffect } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon   from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

L.Marker.prototype.options.icon = L.icon({
  iconUrl:    markerIcon,
  shadowUrl:  markerShadow,
  iconSize:   [25, 41],
  iconAnchor: [12, 41],
});

const DEFAULT_CENTER = [11.0168, 76.9558]; // Coimbatore

function MapEvents({ onMapClick, markerPos }) {
  const map = useMap();
  useMapEvents({ click(e) { onMapClick(e.latlng.lat, e.latlng.lng); } });
  useEffect(() => { if (markerPos) map.panTo(markerPos); }, [markerPos, map]);
  return null;
}

export default function LocationPicker({ onLocationSelect }) {
  const [marker,     setMarker]     = useState(null);
  const [address,    setAddress]    = useState("");
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError,   setGpsError]   = useState("");

  const verifyOnRoad = async (lat, lng) => {
    try {
      // Queries OpenStreetMap to see if there is a 'highway' (road) within 30 meters of the pin
      const query = `[out:json];way["highway"](around:30,${lat},${lng});out ids;`;
      const res = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`);
      const data = await res.json();
      
      // If elements array is empty, there are no mapped roads within 30 meters
      if (data.elements && data.elements.length === 0) {
        setGpsError("⚠ Warning: This pin is not near any known roads. Please drag the pin onto a valid road.");
        return false;
      }
      return true;
    } catch (e) {
      console.error("Road verification failed:", e);
      return true; // Failsafe: if the API is down, let them proceed anyway
    }
  };

  const reverseGeocode = useCallback(async (lat, lng) => {
    try {
      const res  = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
        { headers: { "Accept-Language": "en", "User-Agent": "IRDDP-RoadDamage/1.0" } }
      );
      const data = await res.json();
      if (data?.display_name) {
        setAddress(data.display_name);
        onLocationSelect({ latitude: lat, longitude: lng, address: data.display_name });
      }
    } catch (e) {
      console.error("Reverse geocode failed:", e);
      // Still pass coords even if address lookup fails
      onLocationSelect({ latitude: lat, longitude: lng, address: `${lat.toFixed(5)}, ${lng.toFixed(5)}` });
    }
  }, [onLocationSelect]);

  const updateLocation = useCallback(async (lat, lng) => {
    setMarker([lat, lng]);
    setGpsError(""); // Clear any previous errors
    
    // 1. Get the address text
    reverseGeocode(lat, lng);
    
    // 2. Verify it is actually on a road
    await verifyOnRoad(lat, lng);
  }, [reverseGeocode]);

  const handleGPS = () => {
    if (!navigator.geolocation) {
      setGpsError("Geolocation not supported by your browser.");
      return;
    }
    setGpsLoading(true);
    setGpsError("");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        updateLocation(coords.latitude, coords.longitude);
        setGpsLoading(false);
      },
      () => {
        setGpsError("Could not detect location. Please tap the map to pin manually.");
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  return (
    <div className="lp-wrapper">

      {/* GPS Button */}
      <button
        className="lp-gps-btn"
        onClick={(e) => { e.preventDefault(); handleGPS(); }}
        disabled={gpsLoading}
      >
        {gpsLoading
          ? <><span className="lp-spinner"></span> Detecting location…</>
          : <><span>📍</span> Use My Current Location</>}
      </button>

      {gpsError && (
        <div className="lp-gps-error">⚠ {gpsError}</div>
      )}

      <div className="lp-hint">
        Or tap anywhere on the map to drop a pin
      </div>

      {/* Map */}
      <div className="lp-map-container">
        <MapContainer
          center={marker || DEFAULT_CENTER}
          zoom={15}
          style={{ height: "100%", width: "100%", zIndex: 0 }} // Added zIndex: 0 so it doesn't overlap dropdowns
          dragging={!L.Browser.mobile} // Disable one-finger drag on mobile
          tap={!L.Browser.mobile}      // Fixes touch issues on mobile
          scrollWheelZoom={false}      // Stops map zooming when scrolling on desktop
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {marker && <Marker position={marker} />}
          <MapEvents onMapClick={updateLocation} markerPos={marker} />
        </MapContainer>
      </div>

      {/* Selected address */}
      {address && (
        <div className="lp-address-box">
          <div className="lp-address-label">📍 Selected Location</div>
          <div className="lp-address-text">{address}</div>
          <div className="lp-coords">
            {marker?.[0].toFixed(6)}, {marker?.[1].toFixed(6)}
          </div>
        </div>
      )}

      <style>{`
        .lp-wrapper {
          width: 100%;
          font-family: 'Noto Sans', sans-serif;
        }

        /* GPS Button */
        .lp-gps-btn {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.65rem 1.1rem;
          background: var(--gov-blue, #003366);
          color: #fff;
          border: none;
          border-radius: var(--radius, 8px);
          font-size: 0.88rem;
          font-weight: 700;
          cursor: pointer;
          font-family: 'Noto Sans', sans-serif;
          transition: background 0.2s;
          margin-bottom: 0.6rem;
        }
        .lp-gps-btn:hover:not(:disabled) {
          background: var(--gov-blue-dark, #002244);
        }
        .lp-gps-btn:disabled {
          background: #9aabb8;
          cursor: not-allowed;
        }
        .lp-spinner {
          width: 14px; height: 14px;
          border: 2px solid rgba(255,255,255,0.35);
          border-top-color: #fff;
          border-radius: 50%;
          animation: lpSpin 0.7s linear infinite;
          display: inline-block;
        }
        @keyframes lpSpin { to { transform: rotate(360deg); } }

        .lp-gps-error {
          font-size: 0.82rem;
          color: #c0392b;
          background: #fff4f4;
          border: 1px solid #f5c6cb;
          border-left: 3px solid #c0392b;
          border-radius: var(--radius, 8px);
          padding: 0.5rem 0.75rem;
          margin-bottom: 0.6rem;
        }

        .lp-hint {
          font-size: 0.78rem;
          color: #777;
          margin-bottom: 0.6rem;
        }

        /* Map */
        .lp-map-container {
          height: 320px;
          width: 100%;
          border-radius: var(--radius, 8px);
          overflow: hidden;
          border: 1.5px solid var(--border, #DDE1E7);
          box-shadow: var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.06));
        }

        /* Address box */
        .lp-address-box {
          margin-top: 0.85rem;
          padding: 0.85rem 1rem;
          background: #f0f4ff;
          border: 1px solid #c7d7f5;
          border-left: 4px solid var(--gov-blue, #003366);
          border-radius: var(--radius, 8px);
        }
        .lp-address-label {
          font-size: 0.72rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--saffron, #FF6600);
          margin-bottom: 0.3rem;
        }
        .lp-address-text {
          font-size: 0.88rem;
          color: var(--text-dark, #1A1A2E);
          line-height: 1.4;
          font-weight: 500;
        }
        .lp-coords {
          font-size: 0.72rem;
          color: #777;
          font-family: monospace;
          margin-top: 0.35rem;
        }

        @media (max-width: 480px) {
          .lp-map-container { height: 250px; }
        }
      `}</style>
    </div>
  );
}