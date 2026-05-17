# Use Python 3.11 slim base image for minimal footprint
FROM python:3.11-slim

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PUID=1001 \
    PGID=1001

# Set working directory
WORKDIR /app

# Copy requirements first for better layer caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app.py .

# Create entrypoint script to handle PUID/PGID
RUN echo '#!/bin/bash\n\
groupadd -g ${PGID} appgroup 2>/dev/null || true\n\
useradd -u ${PUID} -g ${PGID} -m -s /bin/bash appuser 2>/dev/null || true\n\
chown -R ${PUID}:${PGID} /app\n\
exec gosu ${PUID}:${PGID} gunicorn --bind 0.0.0.0:5000 --workers 2 --threads 4 --timeout 60 --access-logfile - --error-logfile - app:app\n\
' > /entrypoint.sh && chmod +x /entrypoint.sh

# Install gosu for proper user switching
RUN apt-get update && \
    apt-get install -y --no-install-recommends gosu && \
    rm -rf /var/lib/apt/lists/*

# Expose Flask port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:5000', timeout=5)" || exit 1

# Run application with entrypoint script
ENTRYPOINT ["/entrypoint.sh"]
