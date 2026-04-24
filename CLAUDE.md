# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**AUTOTRACK** is a vehicle detection and workshop management system. It uses computer vision to detect vehicles at entry/exit gates and tracks their status through a workshop workflow. The app is designed for small-form devices with RTSP IP cameras or video file input.

## Commands

### Frontend
```bash
npm install          # Install dependencies
npm run dev          # Start Vite dev server at localhost:5173
npm run build        # Production build to dist/
npm run lint         # Run ESLint
npm run preview      # Preview production build
```

### Backend
```bash
# Windows (recommended)
run_backend.bat

# Manual
cd backend
python -m venv .backend_venv
.backend_venv\Scripts\activate
pip install -r requirements.txt
python server.py     # Runs at http://0.0.0.0:8000
```

No test framework is configured; testing is done manually via the browser.

## Architecture

### Full Stack
- **Frontend**: React 19 + Vite, TensorFlow.js for on-device ML inference
- **Backend**: Python FastAPI — only used for license plate detection (`/detect-plate`) and RTSP video proxying (`/video-feed`)
- **State**: React Context (`ShopContext`) + LocalStorage — no Redux or external state library

### Key Frontend Files
- [src/App.jsx](src/App.jsx) — Root component with login/portal logic
- [src/context/ShopContext.jsx](src/context/ShopContext.jsx) — Global state: users, vehicles, CRUD operations
- [src/components/Detector.jsx](src/components/Detector.jsx) — Main detection engine (610 lines): video stream, TF.js COCO-SSD inference, motion tracking, color detection, triage modal
- [src/components/WorkshopBoard.jsx](src/components/WorkshopBoard.jsx) — Kanban board with 4 statuses: WAITING → ENTERED → TEMP_OUT → EXITED
- [src/components/DetectionGallery.jsx](src/components/DetectionGallery.jsx) — Detection history grid
- [src/utils/colorUtils.js](src/utils/colorUtils.js) — K-Means color clustering in HSL space

### Backend Files
- [backend/server.py](backend/server.py) — FastAPI app with two endpoints
- [licence_plate.pt](licence_plate.pt) — YOLOv8 custom model (~103MB) for license plate detection

### Detection Pipeline (Detector.jsx)
1. Video input (file upload or RTSP via backend proxy) renders to a `<canvas>`
2. COCO-SSD runs frame inference to detect vehicles
3. Motion tracker counts frames where centroid stays within 5px — triggers triage after 15+ stationary frames (3-second dwell at 5fps effective)
4. Color detection samples the lower-fender ROI, runs K-Means (k=10) clustering, maps RGB→HSL, filters shadows (L<0.12) and glare (L>0.92), votes over 10 frames
5. Triage modal shown: INGRESS mode (accept/reject + QR code generation) or EGRESS mode (match to existing vehicles)

### Backend API
- `POST /detect-plate` — Accepts a base64 image, crops license plate region using YOLO, returns cropped plate image
- `GET /video-feed` — Proxies MJPEG stream from RTSP source to the browser
- CORS is wide-open (`allow_origins=["*"]`) for development

## Important Notes

- **Vite** is configured to exclude the `backend/` directory from file watching ([vite.config.js](vite.config.js))
- **licence_plate.pt** is a large binary — do not commit changes to it accidentally
- Thermal printer support is implemented via CSS `@media print` with 58mm width targeting
- The backend virtual environment lives at `backend/.backend_venv/` and is gitignored
