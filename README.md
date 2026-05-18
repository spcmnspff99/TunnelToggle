# TunnelToggle 🔒

A lightweight, containerized **Node.js + TypeScript** web application enables one-click VPN gateway routing via the OPNsense API on any device.

## Features

- **Automatic IP Detection**: Captures the client device IP from the incoming request
- **Visual Status Display**: Shows current routing status and external IP details
- **One-Click Toggle**: TV-friendly button to route/unroute a device through VPN
- **OPNsense Integration**: Manages firewall alias entries via API
- **Dark Mode UI**: Clean, high-contrast interface optimized for TV browsers
- **D-Pad Compatible**: Focus states designed for remote navigation
- **Containerized**: Docker-ready with host networking for transparent IP handling

## Architecture

The application:
1. Detects the incoming client IP from the HTTP request
2. Queries OPNsense to see if that IP exists in the configured alias
3. Displays route status and toggle action
4. Adds or removes the client IP from the alias while preserving other entries
5. Calls OPNsense alias reconfigure to apply changes
6. Fetches external IP info client-side in the browser

## Prerequisites

- OPNsense firewall with API access enabled
- A firewall alias configured for VPN gateway routing
- Docker and Docker Compose installed on your host
- API credentials generated in OPNsense

## Quick Start

### 1. Clone and Configure

```bash
git clone <repository-url>
cd TunnelToggle
cp .env.example .env
```

Then edit `.env` with your OPNsense details.

### 2. Configure Environment Variables

```env
OPNSENSE_IP=192.168.1.1
ALIAS_UUID=your-alias-uuid-here
OPNSENSE_KEY=your-api-key-here
OPNSENSE_SECRET=your-api-secret-here
FLASK_PORT=5000
PUID=1001
PGID=1001
```

> Note: `FLASK_PORT` is a legacy variable name retained in code for backward compatibility with existing deployments.

**Finding your Alias UUID:**
1. Log into OPNsense
2. Go to **Firewall → Aliases**
3. Edit your target alias
4. UUID appears in URLs like `/api/firewall/alias/setItem/{UUID}`

**Generating API Credentials:**
1. Go to **System → Access → Users**
2. Edit/create user
3. Open **API keys** tab
4. Generate key/secret pair

### 3. Deploy with Docker Compose

```bash
docker-compose up -d
docker-compose logs -f
```

App URL:

```text
http://<your-host-ip>:5000
```

### 4. Access from Google TV or iPad

Open:

```text
http://<nas-or-host-ip>:5000
```

## Usage

1. Open the app from your device browser
2. View detected device IP and current route status
3. Use the toggle button:
   - **Route Through VPN**: adds your IP to the OPNsense alias
   - **Disconnect from VPN**: removes your IP from the alias
4. Wait briefly while routing changes propagate, then UI refreshes

## API Endpoints

- `GET /` — Render status page and controls
- `POST /toggle` — Toggle caller IP in alias
- `GET /external-ip` — Returns the TunnelToggle server/container outbound public IP; this is for server diagnostics and does not report the client device’s routed public IP

## Network Configuration

`docker-compose.yml` uses `network_mode: host` so the container can detect real client IPs instead of NAT/proxy-translated addresses.

## Security Notes

- OPNsense API calls disable TLS cert verification to support self-signed certs (`rejectUnauthorized: false`)
- Keep `.env` private and out of version control
- Use least-privilege API credentials for alias management only
- Container runs app process as non-root (`gosu` with `PUID`/`PGID`)

## Troubleshooting

**Connection Errors**
- Verify `OPNSENSE_IP` is reachable from Docker host
- Confirm firewall rules permit OPNsense API access
- Recheck API key and secret

**Wrong IP Detected**
- Confirm host networking is enabled in Docker Compose
- Check if requests pass through a reverse proxy altering client IP headers

**Alias Not Updating**
- Verify `ALIAS_UUID`
- Check OPNsense API logs
- Ensure API user has alias permissions

## Development

Run locally without Docker:

```bash
npm install
npm run build

export OPNSENSE_IP=192.168.1.1
export ALIAS_UUID=your-uuid
export OPNSENSE_KEY=your-key
export OPNSENSE_SECRET=your-secret
export FLASK_PORT=5000

npm start
```

Useful scripts:

- `npm run build` — Compile TypeScript to `dist/`
- `npm start` — Run compiled app (`dist/index.js`)
- `npm run dev` — Build then run once
- `npm run watch` — TypeScript watch mode

## Technology Stack

- **Runtime**: Node.js 18+
- **Backend**: Express 4
- **Language**: TypeScript
- **HTTP Client**: node-fetch
- **Containerization**: Docker (Node 20 Alpine image)
- **Orchestration**: Docker Compose (host networking)

## License

MIT License

## Contributing

Pull requests are welcome. Please ensure documentation stays aligned with code changes.
