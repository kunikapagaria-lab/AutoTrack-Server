FROM python:3.11-slim

# System libs required by OpenCV and FFmpeg
RUN apt-get update && apt-get install -y --no-install-recommends \
        libglib2.0-0 libgl1 libgomp1 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

# Install Python deps as a separate layer — only rebuilds when requirements.txt changes
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App code
COPY backend/ .

# ML models
# licence_plate.pt: server.py loads it as ../licence_plate.pt relative to itself
# yolov8n.pt: YOLO("yolov8n.pt") looks in the working directory first
COPY licence_plate.pt /app/licence_plate.pt
COPY yolov8n.pt .

RUN mkdir -p uploads

EXPOSE 8000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--log-level", "warning"]
