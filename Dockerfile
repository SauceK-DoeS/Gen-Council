# GEN COUNCIL — Multi-Model AI Consensus Engine
FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY . .

# Cloud container runtime configuration
ENV PORT=8000
ENV HOST=0.0.0.0

EXPOSE 8000

CMD ["python", "server.py"]
