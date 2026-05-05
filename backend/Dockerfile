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

# licence_plate.pt — custom model hosted on GitHub Releases
# CACHEBUST forces Docker to re-download the model on every build
ARG CACHEBUST=1
ARG PLATE_MODEL_URL
RUN if [ -n "$PLATE_MODEL_URL" ]; then \
        curl -L -o /app/licence_plate.pt "$PLATE_MODEL_URL" && \
        echo "licence_plate.pt downloaded successfully"; \
    else \
        echo "WARNING: PLATE_MODEL_URL not set — plate detection disabled"; \
    fi

RUN mkdir -p uploads data

EXPOSE 8000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--log-level", "warning"]
