import os
import io
import uuid
import json
import sqlite3
import smtplib
import cv2
import numpy as np
from email.message import EmailMessage
from typing import List, Optional
from datetime import datetime, timedelta
from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File, HTTPException, Request, BackgroundTasks, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from ultralytics import YOLO
from PIL import Image
import httpx
import hashlib
import secrets
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ─── Config ───────────────────────────────────────────────────────────
EMAIL_USER           = os.getenv("EMAIL_USER", "")
EMAIL_PASS           = os.getenv("EMAIL_PASS", "")
RECAPTCHA_SECRET_KEY = os.getenv("RECAPTCHA_SECRET_KEY", "")

# ─── Orphan Cleanup ───────────────────────────────────────────────────
def cleanup_orphan_images():
    uploads_dir = "uploads"
    if not os.path.exists(uploads_dir):
        return
    cutoff = datetime.now() - timedelta(hours=1)
    count  = 0
    for fname in os.listdir(uploads_dir):
        if fname.startswith("tmp_"):
            fpath = os.path.join(uploads_dir, fname)
            try:
                if datetime.fromtimestamp(os.path.getmtime(fpath)) < cutoff:
                    os.remove(fpath)
                    count += 1
            except Exception as e:
                print(f"[Cleanup] Could not remove {fpath}: {e}")
    print(f"[Cleanup] ✅ Removed {count} orphan tmp_ file(s)")

# ─── Lifespan ─────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs("uploads", exist_ok=True)
    init_db()
    cleanup_orphan_images()
    yield

# ─── App ──────────────────────────────────────────────────────────────
limiter = Limiter(key_func=get_remote_address)
app     = FastAPI(title="IRDDP API", version="3.4.1", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)
os.makedirs("uploads", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

# ─── WebSocket Manager ────────────────────────────────────────────────
class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, report_id: str):
        await websocket.accept()
        self.active_connections.setdefault(report_id, []).append(websocket)
        print(f"[WS] Connected: {report_id}")

    def disconnect(self, websocket: WebSocket, report_id: str):
        if report_id in self.active_connections:
            self.active_connections[report_id].remove(websocket)
            if not self.active_connections[report_id]:
                del self.active_connections[report_id]

    async def broadcast_status(self, report_id: str, message: dict):
        for conn in list(self.active_connections.get(report_id, [])):
            try:
                await conn.send_json(message)
            except Exception:
                self.disconnect(conn, report_id)

manager = ConnectionManager()

# ─── Database ─────────────────────────────────────────────────────────
DB_FILE = "reports.db"

def init_db():
    with sqlite3.connect(DB_FILE) as conn:
        c = conn.cursor()
        c.execute('''CREATE TABLE IF NOT EXISTS reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            report_id TEXT UNIQUE, citizen_name TEXT, citizen_email TEXT,
            citizen_phone TEXT, location TEXT, total_potholes INTEGER DEFAULT 0,
            worst_severity TEXT, overall_priority TEXT, max_confidence REAL,
            image_count INTEGER DEFAULT 1, image_paths TEXT,
            processed_image_paths TEXT, status TEXT DEFAULT 'Pending',
            admin_note TEXT DEFAULT '', latitude REAL, longitude REAL,
            address TEXT, title TEXT, description TEXT,
            created_at TEXT, updated_at TEXT
        )''')
        c.execute('''CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE, password TEXT, name TEXT
        )''')
        c.execute("SELECT count(*) FROM admins")
        if c.fetchone()[0] == 0:
            c.execute(
                "INSERT INTO admins (username, password, name) VALUES (?,?,?)",
                ("admin", "admin123", "Road Authority Admin")
            )
        c.execute('''CREATE TABLE IF NOT EXISTS otp_verifications (
            email TEXT PRIMARY KEY, otp_hash TEXT, otp_code TEXT,
            expires_at TEXT, verified INTEGER DEFAULT 0, updated_at TEXT
        )''')
        for sql in [
            "ALTER TABLE reports ADD COLUMN total_potholes INTEGER DEFAULT 0",
            "ALTER TABLE reports ADD COLUMN worst_severity TEXT",
            "ALTER TABLE reports ADD COLUMN overall_priority TEXT",
            "ALTER TABLE reports ADD COLUMN max_confidence REAL",
            "ALTER TABLE reports ADD COLUMN image_count INTEGER DEFAULT 1",
            "ALTER TABLE reports ADD COLUMN image_paths TEXT",
            "ALTER TABLE reports ADD COLUMN processed_image_paths TEXT",
            "ALTER TABLE reports ADD COLUMN admin_note TEXT DEFAULT ''",
            "ALTER TABLE reports ADD COLUMN updated_at TEXT",
            "ALTER TABLE reports ADD COLUMN latitude REAL",
            "ALTER TABLE reports ADD COLUMN longitude REAL",
            "ALTER TABLE reports ADD COLUMN address TEXT",
            "ALTER TABLE reports ADD COLUMN title TEXT",
            "ALTER TABLE reports ADD COLUMN description TEXT",
        ]:
            try: c.execute(sql)
            except sqlite3.OperationalError: pass
        c.execute("UPDATE reports SET status='Pending' WHERE status='OPEN'")

def save_report_to_db(data: dict):
    try:
        with sqlite3.connect(DB_FILE) as conn:
            conn.cursor().execute('''
                INSERT INTO reports (
                    report_id, citizen_name, citizen_email, citizen_phone, location,
                    total_potholes, worst_severity, overall_priority, max_confidence,
                    image_count, image_paths, processed_image_paths, status,
                    latitude, longitude, address, created_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ''', (
                data.get("report_id"), data.get("citizen_name",""),
                data.get("citizen_email",""), data.get("citizen_phone",""),
                data.get("location",""), data.get("total_potholes",0),
                data.get("worst_severity",""), data.get("overall_priority",""),
                data.get("max_confidence",0.0), data.get("image_count",1),
                json.dumps(data.get("image_paths",[])),
                json.dumps(data.get("processed_image_paths",[])),
                data.get("status","Pending"), data.get("latitude"),
                data.get("longitude"), data.get("address",""),
                data.get("created_at", datetime.now().isoformat()),
            ))
        print(f"[DB] ✅ Saved {data.get('report_id')}")
    except Exception as e:
        print(f"[DB] ❌ {e}")

# ─── File Validation ──────────────────────────────────────────────────
MAX_FILE_SIZE_BYTES  = 10 * 1024 * 1024
MAX_BATCH_SIZE_BYTES = 50 * 1024 * 1024

def validate_image_file(filename: str, contents: bytes):
    if len(contents) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(status_code=400, detail={
            "filename": filename,
            "reason": f"File too large ({len(contents)//(1024*1024)}MB). Max 10MB."
        })
    h = contents[:12]
    if not (h[:3]==b"\xFF\xD8\xFF" or h[:4]==b"\x89\x50\x4E\x47"
            or (h[:4]==b"\x52\x49\x46\x46" and h[8:12]==b"\x57\x45\x42\x50")):
        raise HTTPException(status_code=400, detail={
            "filename": filename,
            "reason": "Invalid file type. Only JPEG, PNG, WEBP accepted."
        })

# ─── Email ────────────────────────────────────────────────────────────
def _smtp_send(msg: EmailMessage):
    server = smtplib.SMTP("smtp.gmail.com", 587)
    server.ehlo(); server.starttls(); server.ehlo()
    server.login(EMAIL_USER, EMAIL_PASS)
    server.send_message(msg)
    server.quit()

def send_email_task(citizen_name, citizen_email, report_id,
                    total_potholes, worst_severity, overall_priority,
                    image_count, location):
    if not citizen_email or "@" not in citizen_email:
        return
    
    action_map = {
        "LOW": "Regular monitoring has been scheduled.",
        "MEDIUM": "A repair has been scheduled.",
        "HIGH": "Immediate maintenance has been flagged.",
        "CRITICAL": "Emergency response team has been notified.",
        "CLEAR": "No action needed — road is in good condition.",
    }
    
    msg = EmailMessage()
    msg["Subject"] = f"Road Damage Report Confirmed — {report_id}"
    msg["From"]    = EMAIL_USER
    msg["To"]      = citizen_email
    
    # ── 1. Plain Text Fallback (For older email clients) ──
    text_content = f"""Hello {citizen_name or 'Citizen'},

Your road damage report has been officially submitted and recorded.

REPORT DETAILS
Report ID       : {report_id}
Location        : {location or 'Not specified'}
Images Analyzed : {image_count}
Total Potholes  : {total_potholes}
Worst Severity  : {worst_severity}
Priority Level  : {overall_priority}

Next Step: {action_map.get(overall_priority, "Under review.")}

Track your report using ID: {report_id}

Regards,
IRDDP System — VI Semester CSE Capstone
"""
    msg.set_content(text_content)

    # ── 2. HTML Version (Sleek GOI-style formatting) ──
    html_content = f"""
    <html>
      <body style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
        <div style="background-color: #003366; color: white; padding: 20px; text-align: center;">
          <h2 style="margin: 0;">Road Damage Report Confirmed</h2>
          <div style="height: 4px; background: linear-gradient(to right, #FF6600, #FFFFFF, #138808); margin-top: 10px;"></div>
        </div>
        <div style="padding: 20px; background-color: #f9f9f9;">
          <p>Hello <strong>{citizen_name or 'Citizen'}</strong>,</p>
          <p>Your road damage report has been officially submitted and recorded.</p>
          
          <div style="background: white; border-left: 4px solid #003366; padding: 15px; margin: 20px 0; box-shadow: 0 2px 5px rgba(0,0,0,0.05);">
            <h3 style="margin-top: 0; color: #003366;">Report ID: {report_id}</h3>
            <p style="margin: 5px 0;"><strong>Location:</strong> {location or 'Not specified'}</p>
            <p style="margin: 5px 0;"><strong>Images Analyzed:</strong> {image_count}</p>
            <p style="margin: 5px 0;"><strong>Total Potholes:</strong> {total_potholes}</p>
            <p style="margin: 5px 0;"><strong>Priority Level:</strong> <span style="color: #c0392b; font-weight: bold;">{overall_priority}</span></p>
          </div>
          
          <p><strong>Next Step:</strong> {action_map.get(overall_priority, "Under review.")}</p>
          <p style="font-size: 0.9em; color: #666; margin-top: 30px;">Track your report status live on the IRDDP portal using your Report ID.</p>
        </div>
      </body>
    </html>
    """
    msg.add_alternative(html_content, subtype='html')

    try:
        _smtp_send(msg)
        print(f"[Email] ✅ Sent HTML email to {citizen_email}")
    except Exception as e:
        print(f"[Email] ❌ {e}")

def send_otp_email(email: str, otp: str) -> bool:
    msg = EmailMessage()
    msg["Subject"] = f"Your IRDDP Verification Code: {otp}"
    msg["From"]    = EMAIL_USER
    msg["To"]      = email
    msg.set_content(f"""Your verification code is: {otp}

Expires in 5 minutes. Do not share this code.

Regards, IRDDP Security Team
""")
    try:
        _smtp_send(msg)
        print(f"[OTP] ✅ Sent to {email}")
        return True
    except Exception as e:
        print(f"[OTP] ❌ {e}")
        return False

async def verify_recaptcha(token: str) -> float:
    if not RECAPTCHA_SECRET_KEY or RECAPTCHA_SECRET_KEY == "YOUR_RECAPTCHA_SECRET_HERE":
        return 1.0
    async with httpx.AsyncClient() as client:
        try:
            res  = await client.post(
                "https://www.google.com/recaptcha/api/siteverify",
                data={"secret": RECAPTCHA_SECRET_KEY, "response": token},
                timeout=10.0
            )
            data = res.json()
            return data.get("score", 0.0) if data.get("success") else 0.0
        except Exception as e:
            print(f"[reCAPTCHA] ❌ {e}")
            return 0.0

# ─── Priority Helpers ─────────────────────────────────────────────────
PRIORITY_ORDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]

def score_to_priority(score: float) -> tuple:
    if score < 1.5:  return "LOW",      "Monitor"
    if score <= 2.5: return "MEDIUM",   "Schedule Repair"
    if score <= 3.2: return "HIGH",     "Immediate Maintenance"
    return            "CRITICAL",  "Emergency Response Required"

def pick_worst_priority(p1, p2):
    i1 = PRIORITY_ORDER.index(p1) if p1 in PRIORITY_ORDER else 0
    i2 = PRIORITY_ORDER.index(p2) if p2 in PRIORITY_ORDER else 0
    return PRIORITY_ORDER[max(i1, i2)]

def pick_worst_severity(s1, s2):
    order = ["Minor", "Moderate", "Severe"]
    i1 = order.index(s1) if s1 in order else 0
    i2 = order.index(s2) if s2 in order else 0
    return order[max(i1, i2)]

# ─── Severity Algorithm ───────────────────────────────────────────────
def calculate_severity(x1, y1, x2, y2, image_width, image_height):
    """
    3-factor severity scoring (our original algorithm):
    Factor 1 — Area ratio   : Minor <4%, Moderate 4-10%, Severe >10%
    Factor 2 — Position     : Center-lane potholes more dangerous (+20%)
    Factor 3 — Shape        : Square potholes deeper than elongated (+10%)
    """
    area_ratio = ((x2-x1)*(y2-y1)) / (image_width*image_height) * 100
    if area_ratio < 4:    base_weight, label = 1, "Minor"
    elif area_ratio <= 10: base_weight, label = 2, "Moderate"
    else:                  base_weight, label = 3, "Severe"

    center_dist     = abs((x1+x2)/2 - image_width/2) / (image_width/2)
    position_factor = 1.2 - (0.2 * center_dist)          # 1.0–1.2
    aspect          = min(max(x2-x1,1), max(y2-y1,1)) / max(max(x2-x1,1), max(y2-y1,1))
    shape_factor    = 0.9 + (0.2 * aspect)                # 0.9–1.1

    return base_weight * position_factor * shape_factor, label, base_weight

# ─── False Detection Filter ───────────────────────────────────────────
def filter_false_detections(boxes, image_height: int, image_width: int) -> list:
    """
    Removes likely false positives:
    1. Top 30% — sky, dashboard, overhead signs
    2. >60% of frame — whole-image misfire
    3. Thin horizontal bands (w/h > 8) — road markings
    """
    valid      = []
    top_cutoff = image_height * 0.30
    max_area   = image_width * image_height * 0.60
    for box in boxes:
        if float(box.conf[0]) < 0.30: # Lowered threshold for true ensemble
            continue
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        if y2 < top_cutoff:
            continue
        if (x2-x1)*(y2-y1) > max_area:
            continue
        if max(x2-x1,1)/max(y2-y1,1) > 8:
            continue
        valid.append(box)
    return valid

# ─── Non-Road Rejection ───────────────────────────────────────────────
def is_likely_road_image(image_width, image_height, filtered_count, raw_count):
    if raw_count >= 3 and filtered_count == 0:
        return False, "Image does not appear to show a road surface. All detections were in non-road areas."
    if (image_height/max(image_width,1)) > 2.2 and raw_count == 0:
        return False, "Image appears to be a portrait photo, not a road surface."
    return True, ""

# ─── CLAHE Enhancement ────────────────────────────────────────────────
def enhance_image(image_pil: Image.Image) -> Image.Image:
    """
    Lightweight CLAHE enhancement for water-filled pothole detection.
    - CLAHE on L channel (LAB space) — improves contrast without color shift
    - Mild unsharp mask — sharpens pothole edges
    Faster than full pipeline: no denoise step.
    """
    img             = np.array(image_pil)
    l, a, b         = cv2.split(cv2.cvtColor(img, cv2.COLOR_RGB2LAB))
    l_enh           = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8,8)).apply(l)
    enhanced        = cv2.cvtColor(cv2.merge([l_enh, a, b]), cv2.COLOR_LAB2RGB)
    blur            = cv2.GaussianBlur(enhanced, (0,0), 1.5)
    sharpened       = cv2.addWeighted(enhanced, 1.3, blur, -0.3, 0)
    return Image.fromarray(sharpened)

# ─── NMS Merger ───────────────────────────────────────────────────────
def nms_merge(boxes_list: list, iou_threshold: float = 0.45) -> list:
    """
    Non-Maximum Suppression across multiple model outputs.
    Keeps highest-confidence box when two boxes overlap > iou_threshold.
    Standard algorithm used in all production YOLO deployments.
    """
    if not boxes_list:
        return []
    sorted_boxes = sorted(boxes_list, key=lambda x: x["confidence"], reverse=True)
    kept = []
    for cand in sorted_boxes:
        cx1, cy1, cx2, cy2 = cand["bbox"]
        duplicate = False
        for k in kept:
            kx1, ky1, kx2, ky2 = k["bbox"]
            ix1, iy1 = max(cx1,kx1), max(cy1,ky1)
            ix2, iy2 = min(cx2,kx2), min(cy2,ky2)
            if ix2 <= ix1 or iy2 <= iy1:
                continue
            inter = (ix2-ix1)*(iy2-iy1)
            union = (cx2-cx1)*(cy2-cy1) + (kx2-kx1)*(ky2-ky1) - inter
            if union > 0 and inter/union >= iou_threshold:
                duplicate = True
                break
        if not duplicate:
            kept.append(cand)
    print(f"[NMS] {len(boxes_list)} → {len(kept)} boxes after merge")
    return kept

# ─── Model Loading ────────────────────────────────────────────────────
def find_best_model():
    search_dir = "runs/detect"
    if os.path.exists(search_dir):
        try:
            for d in sorted(os.listdir(search_dir), reverse=True):
                p = os.path.join(search_dir, d, "weights", "best.pt")
                if os.path.exists(p):
                    return p
        except Exception:
            pass
    return "best.pt"

# Primary model — cazzz307 (strong on water potholes)
model_path = find_best_model()
print(f"[Model] Loading primary: {model_path}")
app.state.model = YOLO(model_path)

# Secondary model — our trained model (strong on dry potholes)
_secondary_path = "best_original.pt"
if os.path.exists(_secondary_path):
    print(f"[Model] Loading secondary: {_secondary_path}")
    app.state.model2 = YOLO(_secondary_path)
else:
    print(f"[Model] ⚠️ Secondary model not found — single model mode")
    app.state.model2 = None

# ─── /analyze ─────────────────────────────────────────────────────────
@app.post("/analyze")
async def analyze_images(request: Request, files: List[UploadFile] = File(...)):
    if len(files) > 10:
        raise HTTPException(status_code=400, detail="Maximum 10 images allowed")

    # Validate all files upfront
    file_contents = []
    total_bytes   = 0
    for file in files:
        contents     = await file.read()
        total_bytes += len(contents)
        if total_bytes > MAX_BATCH_SIZE_BYTES:
            raise HTTPException(status_code=400, detail={
                "filename": file.filename, "reason": "Batch exceeds 50MB limit."
            })
        validate_image_file(file.filename, contents)
        file_contents.append((file.filename, contents))

    timestamp_base         = datetime.now().strftime("%Y%m%d_%H%M%S")
    batch_total_potholes   = 0
    batch_overall_priority = "LOW"
    batch_worst_severity   = "Minor"
    batch_max_confidence   = 0.0
    batch_image_paths      = []
    batch_processed_paths  = []
    batch_has_detection    = False
    results_list           = []

    try:
        for idx, (filename, contents) in enumerate(file_contents):
            ts            = f"{timestamp_base}_{idx:02d}"
            safe_name     = filename.replace(" ","_").replace("/","_").replace("\\","_")
            file_path     = os.path.join("uploads", f"tmp_{ts}_{safe_name}")

            with open(file_path, "wb") as f:
                f.write(contents)

            image         = Image.open(io.BytesIO(contents)).convert("RGB")
            width, height = image.size

            # ── Step 1: Enhance for better water pothole detection ──
            enhanced = enhance_image(image)

            # ── Step 2: Primary model (cazzz307 - water potholes) ──
            # Lowered confidence and added augment=True for True Ensemble
            res1      = request.app.state.model(enhanced, conf=0.30, augment=True)
            boxes1    = res1[0].boxes
            filtered1 = filter_false_detections(boxes1, height, width) if boxes1 is not None else []

            raw_detections = [{
                "confidence": float(b.conf[0]),
                "bbox":       b.xyxy[0].tolist(),
                "source":     "primary",
            } for b in filtered1]

            # ── Step 3: Secondary model (Our trained model - dry potholes) ──
            # Run every time to merge strengths
            if request.app.state.model2 is not None:
                res2      = request.app.state.model2(enhanced, conf=0.30, augment=True)
                boxes2    = res2[0].boxes
                filtered2 = filter_false_detections(boxes2, height, width) if boxes2 is not None else []
                
                raw_detections.extend([{
                    "confidence": float(b.conf[0]),
                    "bbox":       b.xyxy[0].tolist(),
                    "source":     "secondary",
                } for b in filtered2])
                print(f"[Ensemble] Image {idx+1}: Primary found {len(filtered1)}, Secondary found {len(filtered2)}")

            # ── Step 4: NMS merge (Removes duplicates) ──
            merged = nms_merge(raw_detections)

            # ── Step 5: Non-road rejection ──
            is_valid, reason = is_likely_road_image(
                width, height, len(merged), len(raw_detections)
            )
            if not is_valid:
                if os.path.exists(file_path):
                    os.remove(file_path)
                raise HTTPException(status_code=400, detail={
                    "filename": filename, "reason": reason
                })

            # ── Step 6: Severity scoring ──
            detections       = []
            severity_weights = []
            max_conf         = 0.0

            for det in merged:
                conf = det["confidence"]
                if conf > max_conf:
                    max_conf = conf
                x1, y1, x2, y2 = det["bbox"]
                adj_w, sev_lbl, base_w = calculate_severity(x1, y1, x2, y2, width, height)
                severity_weights.append(adj_w)
                detections.append({
                    "confidence":  conf,
                    "weight":      adj_w,
                    "base_weight": base_w,
                    "severity":    sev_lbl,
                    "bbox":        [x1, y1, x2, y2],
                    "source":      det["source"],
                })

            processed_file_path = file_path
            image_report        = None

            if detections:
                batch_has_detection = True
                pothole_count   = len(detections)
                density_weight  = 1 if pothole_count == 1 else 2 if pothole_count <= 3 else 3
                conf_multiplier = 1.0 if max_conf <= 0.85 else 1.2

                max_sev      = max(severity_weights)
                avg_sev      = sum(severity_weights) / len(severity_weights)
                combined_sev = (max_sev * 0.7) + (avg_sev * 0.3)
                final_score  = ((combined_sev * 0.6) + (density_weight * 0.4)) * conf_multiplier

                priority, action = score_to_priority(final_score)
                worst_base       = max(d["base_weight"] for d in detections)
                severity_label   = ["Minor","Moderate","Severe"][min(worst_base-1, 2)]

                batch_total_potholes   += pothole_count
                batch_max_confidence    = max(batch_max_confidence, max_conf)
                batch_overall_priority  = pick_worst_priority(batch_overall_priority, priority)
                batch_worst_severity    = pick_worst_severity(batch_worst_severity, severity_label)

                # ── Draw annotated image with color-coded boxes ──
                img_draw = np.array(enhanced).copy()
                for det in detections:
                    x1, y1, x2, y2 = [int(v) for v in det["bbox"]]
                    conf   = det["confidence"]
                    # Red = primary model, Blue = secondary model
                    color  = (220, 50, 50) if det["source"] == "primary" else (50, 100, 220)
                    cv2.rectangle(img_draw, (x1, y1), (x2, y2), color, 2)
                    label  = f"Pothole {conf:.2f}"
                    (lw, lh), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
                    cv2.rectangle(img_draw, (x1, y1-lh-6), (x1+lw+4, y1), color, -1)
                    cv2.putText(img_draw, label, (x1+2, y1-4),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255,255,255), 1)

                res_pil    = Image.fromarray(img_draw).convert("RGB")
                proc_fname = f"tmp_proc_{ts}_{safe_name}"
                processed_file_path = os.path.join("uploads", proc_fname)
                res_pil.save(processed_file_path, format="JPEG")

                image_report = {
                    "image_index":        idx + 1,
                    "detected_potholes":  pothole_count,
                    "highest_severity":   severity_label,
                    "priority_level":     priority,
                    "recommended_action": action,
                    "confidence_level":   f"{max_conf:.4f}",
                }

            batch_image_paths.append(file_path)
            batch_processed_paths.append(processed_file_path)
            results_list.append({
                "filename":            filename,
                "image_index":         idx + 1,
                "image_url":           f"/{file_path}",
                "processed_image_url": f"/{processed_file_path}",
                "image_report":        image_report,
            })

        action_map = {
            "LOW": "Monitor", "MEDIUM": "Schedule Repair",
            "HIGH": "Immediate Maintenance", "CRITICAL": "Emergency Response Required",
        }
        return {
            "batch_summary": {
                "total_images":       len(file_contents),
                "total_potholes":     batch_total_potholes,
                "worst_severity":     batch_worst_severity if batch_has_detection else "None",
                "overall_priority":   batch_overall_priority if batch_has_detection else "CLEAR",
                "recommended_action": action_map.get(batch_overall_priority,"Monitor") if batch_has_detection else "No action needed",
                "max_confidence":     f"{batch_max_confidence:.4f}",
                "has_detection":      batch_has_detection,
            },
            "results":          results_list,
            "_image_paths":     batch_image_paths,
            "_processed_paths": batch_processed_paths,
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

# ─── /submit ──────────────────────────────────────────────────────────
class LocationDetail(BaseModel):
    latitude:  float
    longitude: float
    address:   Optional[str] = ""

class SubmitRequest(BaseModel):
    citizen_name:     str
    citizen_email:    str
    citizen_phone:    Optional[str] = ""
    location_text:    Optional[str] = ""
    image_paths:      List[str]
    processed_paths:  List[str]
    total_potholes:   int
    worst_severity:   str
    overall_priority: str
    max_confidence:   str
    has_detection:    bool
    total_images:     int
    captcha_token:    str
    location:         LocationDetail

@app.post("/submit")
@limiter.limit("10/hour")
async def submit_report(request: Request, payload: SubmitRequest, background_tasks: BackgroundTasks):
    if not payload.citizen_email or "@" not in payload.citizen_email:
        raise HTTPException(status_code=400, detail="A valid email is required.")

    with sqlite3.connect(DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute(
            "SELECT verified FROM otp_verifications WHERE email=? ORDER BY updated_at DESC LIMIT 1",
            (payload.citizen_email,)
        )
        # OTP check 
        row = cursor.fetchone()
        if not row or not row["verified"]:
            raise HTTPException(status_code=403, detail="Email not verified via OTP.")

    score = await verify_recaptcha(payload.captcha_token)
    if score < 0.5:
        raise HTTPException(status_code=400, detail=f"reCAPTCHA failed (score={score:.1f}).")

    report_id  = f"RD-{datetime.now().year}-{uuid.uuid4().hex[:8].upper()}"
    created_at = datetime.now().isoformat()

    def rename_path(path, fallback):
        fname = os.path.basename(path)
        if not fname.startswith("tmp_"):
            return path
        new_path = os.path.join("uploads", fname[4:])
        if os.path.exists(path):
            try:
                os.rename(path, new_path)
                return new_path
            except Exception as e:
                print(f"[Submit] Rename error: {e}")
                return path
        return new_path if os.path.exists(new_path) else fallback

    permanent_image_paths     = [rename_path(p, p) for p in payload.image_paths]
    permanent_processed_paths = []
    for i, path in enumerate(payload.processed_paths):
        if path == payload.image_paths[i]:
            permanent_processed_paths.append(permanent_image_paths[i])
        else:
            permanent_processed_paths.append(rename_path(path, permanent_image_paths[i]))

    save_report_to_db({
        "report_id":             report_id,
        "citizen_name":          payload.citizen_name,
        "citizen_email":         payload.citizen_email,
        "citizen_phone":         payload.citizen_phone,
        "location":              payload.location.address,
        "latitude":              payload.location.latitude,
        "longitude":             payload.location.longitude,
        "address":               payload.location.address,
        "total_potholes":        payload.total_potholes,
        "worst_severity":        payload.worst_severity,
        "overall_priority":      payload.overall_priority,
        "max_confidence":        float(payload.max_confidence),
        "image_count":           payload.total_images,
        "image_paths":           permanent_image_paths,
        "processed_image_paths": permanent_processed_paths,
        "status":                "Pending",
        "created_at":            created_at,
    })

    if payload.citizen_email and "@" in payload.citizen_email:
        background_tasks.add_task(
            send_email_task,
            payload.citizen_name, payload.citizen_email, report_id,
            payload.total_potholes, payload.worst_severity,
            payload.overall_priority, payload.total_images,
            payload.location.address,
        )

    return {
        "report_id":                 report_id,
        "created_at":                created_at,
        "status":                    "Pending",
        "email_sent":                bool(payload.citizen_email and "@" in payload.citizen_email),
        "permanent_image_paths":     permanent_image_paths,
        "permanent_processed_paths": permanent_processed_paths,
        "location": {
            "latitude":  payload.location.latitude,
            "longitude": payload.location.longitude,
            "address":   payload.location.address,
        }
    }

# ─── /report/{report_id} ──────────────────────────────────────────────
@app.get("/report/{report_id}")
def get_report(report_id: str):
    with sqlite3.connect(DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM reports WHERE report_id=?", (report_id,))
        row = cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Report not found")
    data = dict(row)
    try:    ip = json.loads(data.get("image_paths") or "[]")
    except: ip = [data.get("image_paths","")]
    try:    pp = json.loads(data.get("processed_image_paths") or "[]")
    except: pp = [data.get("processed_image_paths","")]
    pri = data.get("overall_priority") or "LOW"
    return {
        "report_id":           data["report_id"],
        "citizen_name":        data.get("citizen_name",""),
        "citizen_email":       data.get("citizen_email",""),
        "citizen_phone":       data.get("citizen_phone",""),
        "location": {
            "latitude":        data.get("latitude"),
            "longitude":       data.get("longitude"),
            "address":         data.get("address") or data.get("location",""),
        },
        "detected_potholes":   data.get("total_potholes", 0),
        "highest_severity":    data.get("worst_severity",""),
        "priority_level":      pri,
        "confidence_level":    f"{float(data.get('max_confidence') or 0):.4f}",
        "recommended_action":  {"LOW":"Monitor","MEDIUM":"Schedule Repair","HIGH":"Immediate Maintenance","CRITICAL":"Emergency Response Required","CLEAR":"No action needed"}.get(pri,"Monitor"),
        "image_count":         data.get("image_count", 1),
        "generated_at":        data.get("created_at",""),
        "status":              data.get("status","Pending"),
        "admin_note":          data.get("admin_note",""),
        "updated_at":          data.get("updated_at",""),
        "processed_image_url": f"/{pp[0]}" if pp else "",
        "original_image_url":  f"/{ip[0]}" if ip else "",
        "all_image_urls":      [f"/{p}" for p in ip],
        "all_processed_urls":  [f"/{p}" for p in pp],
    }

# ─── /send-email/{report_id} ──────────────────────────────────────────
@app.post("/send-email/{report_id}")
def resend_email(report_id: str):
    with sqlite3.connect(DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM reports WHERE report_id=?", (report_id,))
        row = cursor.fetchone()
    if not row: raise HTTPException(status_code=404, detail="Report not found")
    data = dict(row)
    if not data.get("citizen_email"):
        raise HTTPException(status_code=400, detail="No email on record")
    send_email_task(
        data.get("citizen_name",""), data["citizen_email"], data["report_id"],
        data.get("total_potholes",0), data.get("worst_severity",""),
        data.get("overall_priority","LOW"), data.get("image_count",1),
        data.get("location",""),
    )
    return {"status": "success", "message": f"Email sent to {data['citizen_email']}"}

# ─── OTP ──────────────────────────────────────────────────────────────
class OtpRequest(BaseModel):
    email: str

@app.post("/send-otp")
@limiter.limit("5/minute")
async def send_otp(request: Request, payload: OtpRequest):
    if not payload.email or "@" not in payload.email:
        raise HTTPException(status_code=400, detail="Invalid email")
    otp        = "".join([str(secrets.randbelow(10)) for _ in range(6)])
    otp_hash   = hashlib.sha256(otp.encode()).hexdigest()
    expires_at = (datetime.now() + timedelta(minutes=5)).isoformat()
    with sqlite3.connect(DB_FILE) as conn:
        conn.cursor().execute(
            "INSERT OR REPLACE INTO otp_verifications (email,otp_hash,otp_code,expires_at,verified,updated_at) VALUES (?,?,?,?,?,?)",
            (payload.email, otp_hash, otp, expires_at, 0, datetime.now().isoformat())
        )
    if not send_otp_email(payload.email, otp):
        raise HTTPException(status_code=500, detail="Failed to send OTP.")
    return {"status": "success", "message": "OTP sent"}

class VerifyRequest(BaseModel):
    email: str
    otp:   str

@app.post("/verify-otp")
@limiter.limit("10/minute")
async def verify_otp(request: Request, payload: VerifyRequest):
    if not payload.email or not payload.otp:
        raise HTTPException(status_code=400, detail="Email and OTP required")
    otp_hash = hashlib.sha256(payload.otp.encode()).hexdigest()
    now      = datetime.now().isoformat()
    with sqlite3.connect(DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        c.execute(
            "SELECT * FROM otp_verifications WHERE email=? AND otp_hash=? AND expires_at>?",
            (payload.email, otp_hash, now)
        )
        if not c.fetchone():
            raise HTTPException(status_code=400, detail="Invalid or expired OTP")
        c.execute("UPDATE otp_verifications SET verified=1, updated_at=? WHERE email=?", (now, payload.email))
    return {"status": "success", "message": "Email verified"}

# ─── /test-email ──────────────────────────────────────────────────────
@app.get("/test-email")
def test_email():
    result = {}
    try:
        server = smtplib.SMTP("smtp.gmail.com", 587, timeout=10)
        server.ehlo(); server.starttls(); server.ehlo()
        result["smtp_connect"] = "ok"
        server.login(EMAIL_USER, EMAIL_PASS)
        result["smtp_login"]   = "ok"
        msg = EmailMessage()
        msg["Subject"] = "IRDDP Email Test"
        msg["From"]    = EMAIL_USER
        msg["To"]      = EMAIL_USER
        msg.set_content("Test email from IRDDP backend.")
        server.send_message(msg); server.quit()
        result["status"] = f"✅ Email sent to {EMAIL_USER}"
    except smtplib.SMTPAuthenticationError as e:
        result["error"] = f"Auth failed: {e.smtp_code}"
        result["fix"]   = "Regenerate App Password at myaccount.google.com"
    except Exception as e:
        result["error"] = str(e)
    result["email_configured"] = bool(EMAIL_PASS)
    return result

# ─── Admin ────────────────────────────────────────────────────────────
class AdminLoginRequest(BaseModel):
    username: str
    password: str

@app.post("/admin/login")
async def admin_login(payload: AdminLoginRequest):
    with sqlite3.connect(DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        c.execute("SELECT * FROM admins WHERE username=? AND password=?", (payload.username, payload.password))
        admin = c.fetchone()
        if not admin:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        return {"status": "success", "token": "mock-admin-token", "name": admin["name"]}

@app.get("/admin/stats")
async def get_admin_stats():
    with sqlite3.connect(DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        def count(w=""):
            c.execute(f"SELECT count(*) as n FROM reports {w}")
            return c.fetchone()["n"]
        return {
            "total":        count(),
            "pending":      count("WHERE status='Pending'"),
            "under_review": count("WHERE status='Under Review'"),
            "resolved":     count("WHERE status='Resolved'"),
            "rejected":     count("WHERE status='Rejected'"),
        }

@app.get("/admin/reports")
async def get_admin_reports():
    with sqlite3.connect(DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        c.execute("SELECT * FROM reports ORDER BY created_at DESC")
        reports = [dict(row) for row in c.fetchall()]
        for r in reports:
            try:    r["image_paths"]           = json.loads(r["image_paths"])
            except: r["image_paths"]           = []
            try:    r["processed_image_paths"] = json.loads(r["processed_image_paths"])
            except: r["processed_image_paths"] = []
            r["location"] = {
                "latitude":  r.get("latitude"),
                "longitude": r.get("longitude"),
                "address":   r.get("address") or r.get("location",""),
            }
        return reports

class AdminUpdateRequest(BaseModel):
    status:     str
    admin_note: Optional[str] = ""

@app.patch("/admin/reports/{report_id}")
async def update_report_status(report_id: str, payload: AdminUpdateRequest):
    now = datetime.now().isoformat()
    with sqlite3.connect(DB_FILE) as conn:
        c = conn.cursor()
        c.execute(
            "UPDATE reports SET status=?, admin_note=?, updated_at=? WHERE report_id=?",
            (payload.status, payload.admin_note, now, report_id)
        )
        if conn.total_changes == 0:
            raise HTTPException(status_code=404, detail="Report not found")
    await manager.broadcast_status(report_id, {
        "status": payload.status, "admin_note": payload.admin_note, "updated_at": now
    })
    return {"status": "success", "updated_at": now}

@app.delete("/admin/reports/{report_id}")
async def delete_report(report_id: str):
    with sqlite3.connect(DB_FILE) as conn:
        c = conn.cursor()
        c.execute("DELETE FROM reports WHERE report_id=?", (report_id,))
        if conn.total_changes == 0:
            raise HTTPException(status_code=404, detail="Report not found")
    return {"status": "success", "message": f"Deleted {report_id}"}

# ─── Citizen Tracking ─────────────────────────────────────────────────
@app.get("/track/{report_id}")
async def track_report(report_id: str, email: str):
    with sqlite3.connect(DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        c.execute("SELECT * FROM reports WHERE report_id=? AND citizen_email=?", (report_id, email))
        report = c.fetchone()
        if not report:
            raise HTTPException(status_code=404, detail="Report not found or email mismatch")
        r = dict(report)
        try:    r["image_paths"]           = json.loads(r["image_paths"])
        except: r["image_paths"]           = []
        try:    r["processed_image_paths"] = json.loads(r["processed_image_paths"])
        except: r["processed_image_paths"] = []
        r["location"] = {
            "latitude":  r.get("latitude"),
            "longitude": r.get("longitude"),
            "address":   r.get("address") or r.get("location",""),
        }
        return r

@app.websocket("/ws/track/{report_id}")
async def websocket_endpoint(websocket: WebSocket, report_id: str):
    await manager.connect(websocket, report_id)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, report_id)
    except Exception as e:
        print(f"[WS] Error: {e}")
        manager.disconnect(websocket, report_id)

# ─── /health ──────────────────────────────────────────────────────────
@app.get("/health")
def health_check():
    db_ok = True
    try:
        with sqlite3.connect(DB_FILE) as conn: conn.execute("SELECT 1")
    except: db_ok = False
    orphans = 0
    try:
        if os.path.exists("uploads"):
            orphans = sum(1 for f in os.listdir("uploads") if f.startswith("tmp_"))
    except: pass
    return {
        "status":           "ok",
        "version":          "3.4.1",
        "primary_model":    model_path,
        "secondary_model":  "best_original.pt" if app.state.model2 else "not loaded",
        "ensemble_mode":    "true_ensemble (both models + TTA augment)",
        "enhancement":      "CLAHE clipLimit=2.5 + unsharp mask",
        "email_configured": bool(EMAIL_PASS),
        "db_status":        "ok" if db_ok else "error",
        "orphan_files":     orphans,
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, ws="websockets")