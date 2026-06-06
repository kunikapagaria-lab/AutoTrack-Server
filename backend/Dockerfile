FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        libglib2.0-0 libgl1 libgomp1 ffmpeg curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

# Install Python deps — separate layer so it only rebuilds when requirements change
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App code
COPY backend/ .

# yolov8n.pt — ultralytics downloads it automatically if not present
RUN python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')" 2>/dev/null || true

# licence_plate.pt — custom YOLO model (~103 MB, gitignored, must be present in AutoTrack-Server/
COPY licence_plate.pt /app/licence_plate.pt

RUN mkdir -p uploads data

EXPOSE 8000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--log-level", "warning"]
