# TunnelToggle 🔒

A lightweight, containerized Python Flask web application designed for Google TV and iPad that enables one-click VPN gateway routing via OPNsense firewall API.

## Features

- **Automatic IP Detection**: Captures the client device's local IP address automatically
- **Visual Status Display**: Shows current routing status and external IP with geolocation
- **One-Click Toggle**: Large, Google TV remote-friendly buttons to route/unroute through VPN
- **OPNsense Integration**: Directly manages firewall alias entries via API
- **Dark Mode UI**: Clean, modern interface optimized for TV browsers
- **D-Pad Compatible**: High-contrast focus states for physical remote navigation
- **Containerized**: Docker-ready with host networking for transparent IP handling

## Architecture

The application:
1. Detects the incoming client IP from the HTTP request
2. Queries the OPNsense API to check if the IP exists in the configured firewall alias
3. Displays a toggle button based on current routing state
4. When toggled, adds or removes the IP from the alias (preserving existing entries)
5. Reloads the OPNsense firewall to apply changes
6. Shows external IP and geolocation via client-side fetch to ipinfo.io

## Prerequisites

- OPNsense firewall with API access enabled
- A firewall alias configured for VPN gateway routing
- Docker and Docker Compose installed on your host
- API credentials generated in OPNsense

## Quick Start

### 1. Clone and Configure

```bash
# Clone the repository
git clone <repository-url>
cd TunnelToggle

# Copy the example environment file
cp .env.example .env

# Edit .env with your OPNsense credentials
nano .env
```

### 2. Configure Environment Variables

Edit `.env` with your OPNsense details:

```env
OPNSENSE_IP=192.168.1.1
ALIAS_UUID=your-alias-uuid-here
OPNSENSE_KEY=your-api-key-here
OPNSENSE_SECRET=your-api-secret-here
FLASK_PORT=5000
```

**Finding your Alias UUID:**
1. Log into OPNsense
2. Go to **Firewall → Aliases**
3. Click edit on your target alias
4. The UUID is in the browser URL: `/api/firewall/alias/setItem/{UUID}`

**Generating API Credentials:**
1. Go to **System → Access → Users**
2. Edit your user or create a dedicated API user
3. Click **API keys** tab
4. Generate a new key/secret pair

### 3. Deploy with Docker Compose

```bash
# Build and start the container
docker-compose up -d

# Check logs
docker-compose logs -f
```

The application will be available at `http://<your-host-ip>:5000`

### 4. Access from Google TV or iPad

Open your TV browser or iPad and navigate to:
```
http://<nas-or-host-ip>:5000
```

## Usage

1. **View Status**: The page displays your device's local IP and external IP with location
2. **Toggle Routing**:
   - If showing **"Route Through VPN"** (blue), click to route traffic through the VPN gateway
   - If showing **"Disconnect from VPN"** (red), click to route directly (bypass VPN)
3. **Navigate with Remote**: Use the D-pad on your Google TV remote to focus and select the button

## Network Configuration

The application uses `network_mode: host` in Docker Compose to ensure:
- The container sees the real client IP without NAT translation
- Direct access to the OPNsense API on your local network
- No port mapping complications

## Security Notes

- OPNsense API calls use `verify=False` to handle self-signed certificates
- Store your `.env` file securely and never commit it to version control
- Consider restricting API user permissions to only firewall alias management
- The application runs as a non-root user inside the container

## Troubleshooting

**Connection Errors:**
- Verify `OPNSENSE_IP` is reachable from your Docker host
- Check firewall rules allow access to the OPNsense API
- Ensure API credentials are correct

**Wrong IP Detected:**
- Confirm `network_mode: host` is set in docker-compose.yml
- Check if there's a proxy between the client and the application

**Alias Not Updating:**
- Verify the `ALIAS_UUID` is correct
- Check OPNsense logs for API errors
- Ensure the API user has sufficient permissions

## Development

Run locally without Docker:

```bash
# Install dependencies
pip install -r requirements.txt

# Set environment variables
export OPNSENSE_IP=192.168.1.1
export ALIAS_UUID=your-uuid
export OPNSENSE_KEY=your-key
export OPNSENSE_SECRET=your-secret

# Run the application
python app.py
```

## Technology Stack

- **Backend**: Python 3.11, Flask, Gunicorn
- **API Client**: Requests library with SSL verification disabled
- **Frontend**: Vanilla JavaScript with Fetch API
- **Containerization**: Docker with Python slim base image
- **Orchestration**: Docker Compose with host networking

## License

MIT License - See LICENSE file for details

## Contributing

Pull requests are welcome! Please ensure:
- Code follows PEP 8 style guidelines
- Changes are tested with OPNsense API
- Documentation is updated accordingly
