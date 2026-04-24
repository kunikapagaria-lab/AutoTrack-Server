# Auto Tracking System 🚗

A real-time **license plate detection and recognition** system using React (Vite) frontend and a Python (FastAPI) backend with YOLO and EasyOCR.

## Features

- 🔍 Real-time license plate detection via YOLO model
- 📝 OCR text extraction using EasyOCR
- 📹 Webcam / RTSP stream support
- ⚡ React + Vite frontend with live feed display
- 🐍 FastAPI Python backend

---

## Setup & Run

### Prerequisites
- Node.js >= 18
- Python >= 3.9
- pip

### 1. Frontend

```bash
npm install
npm run dev
```

Frontend will be available at: `http://localhost:5173`

### 2. Backend

```bash
cd backend
pip install -r requirements.txt
python server.py
```

> **Note:** The YOLO model file (`licence_plate.pt`) is not included in the repository due to its large size (~100 MB). Place it in the project root before running the backend.

---

## Project Structure

```
├── src/               # React frontend source
│   └── components/    # UI components (Detector, etc.)
├── backend/
│   ├── server.py      # FastAPI backend
│   └── requirements.txt
├── public/
├── index.html
└── vite.config.js
```
