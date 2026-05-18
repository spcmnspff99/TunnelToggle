#!/bin/bash
set -e

# Create group and user with specified PUID/PGID
groupadd -g ${PGID} appgroup 2>/dev/null || true
useradd -u ${PUID} -g ${PGID} -m -s /bin/bash appuser 2>/dev/null || true

# Fix permissions
chown -R ${PUID}:${PGID} /app

# Run the application as the specified user
exec gosu ${PUID}:${PGID} node dist/index.js
