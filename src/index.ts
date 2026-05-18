#!/usr/bin/env node
/**
 * TunnelToggle - OPNsense VPN Gateway Toggle for Google TV / iPad
 * Detects client IP and toggles it within an OPNsense firewall alias
 */

import express, { Request, Response } from 'express';
import https from 'https';
import fetch from 'node-fetch';

// Disable SSL certificate validation for self-signed certs
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

// Load configuration from environment
const OPNSENSE_IP = process.env.OPNSENSE_IP;
const ALIAS_UUID = process.env.ALIAS_UUID;
const OPNSENSE_KEY = process.env.OPNSENSE_KEY;
const OPNSENSE_SECRET = process.env.OPNSENSE_SECRET;
const FLASK_PORT = parseInt(process.env.FLASK_PORT || '5000', 10);

// OPNsense API endpoints
const ALIAS_GET_URL = `https://${OPNSENSE_IP}/api/firewall/alias/getItem/${ALIAS_UUID}`;
const ALIAS_SET_URL = `https://${OPNSENSE_IP}/api/firewall/alias/setItem/${ALIAS_UUID}`;
const ALIAS_RECONFIGURE_URL = `https://${OPNSENSE_IP}/api/firewall/alias/reconfigure`;

// Create Express app
const app = express();
app.use(express.json());

// Types
interface AliasContentItem {
  value: string;
  selected: number;
  description?: string;
}

interface AliasData {
  enabled: string;
  name: string;
  content: Record<string, AliasContentItem>;
  current_items?: string;
  last_updated?: string;
  description?: string;
}

interface ApiResponse {
  alias?: AliasData;
  result?: string;
  validations?: Record<string, string>;
}

/**
 * Extract the client's IP address from the request
 */
function getClientIp(req: Request): string {
  // Try X-Forwarded-For first (if behind a proxy), then fall back to remote address
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const forwardedStr = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    return forwardedStr.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/**
 * Fetch the current alias configuration from OPNsense
 */
async function getAliasData(): Promise<AliasData | null> {
  try {
    const auth = 'Basic ' + Buffer.from(`${OPNSENSE_KEY}:${OPNSENSE_SECRET}`).toString('base64');
    
    const response = await fetch(ALIAS_GET_URL, {
      method: 'GET',
      headers: { Authorization: auth },
      agent: httpsAgent,
    });

    if (!response.ok) {
      console.error(`Error fetching alias data: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = (await response.json()) as ApiResponse;
    console.log('Alias data structure:', JSON.stringify(data, null, 2));
    return data.alias || null;
  } catch (error) {
    console.error('Error fetching alias data:', error);
    return null;
  }
}

/**
 * Extract the list of IPs from the alias content field
 */
function getAliasIps(aliasData: AliasData | null): string[] {
  if (!aliasData || !aliasData.content) {
    return [];
  }

  // Content is a dict where selected items have 'selected': 1
  const ips: string[] = [];
  for (const [key, value] of Object.entries(aliasData.content)) {
    if (value.selected === 1) {
      ips.push(value.value);
    }
  }
  return ips;
}

/**
 * Update the alias with a new list of IPs
 */
async function updateAlias(newIpList: string[]): Promise<boolean> {
  try {
    // OPNsense expects newline-separated values for alias content
    const content = newIpList.join('\n');
    
    const payload = {
      alias: {
        content,
      },
    };

    console.log(`Updating alias with ${newIpList.length} IPs`);
    console.log('Payload content:', content);

    const auth = 'Basic ' + Buffer.from(`${OPNSENSE_KEY}:${OPNSENSE_SECRET}`).toString('base64');

    // Set the alias
    const response = await fetch(ALIAS_SET_URL, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      agent: httpsAgent,
    });

    if (!response.ok) {
      console.error(`Update failed: ${response.status} ${response.statusText}`);
      return false;
    }

    const result = (await response.json()) as ApiResponse;
    console.log('Update response:', result);

    // Check if the update was successful
    if (result.result !== 'saved') {
      console.error('Update failed:', result);
      return false;
    }

    // Reconfigure the alias system to apply changes
    const reconfigureResponse = await fetch(ALIAS_RECONFIGURE_URL, {
      method: 'POST',
      headers: { Authorization: auth },
      agent: httpsAgent,
    });

    if (!reconfigureResponse.ok) {
      console.error(`Reconfigure failed: ${reconfigureResponse.status}`);
      return false;
    }

    const reconfigureResult = await reconfigureResponse.json();
    console.log('Reconfigure response:', reconfigureResult);

    console.log(`Successfully updated alias with ${newIpList.length} IPs`);
    return true;
  } catch (error) {
    console.error('Error updating alias:', error);
    return false;
  }
}

/**
 * Main page - displays current status and toggle button
 */
app.get('/', async (req: Request, res: Response) => {
  const clientIp = getClientIp(req);
  const aliasData = await getAliasData();

  let isRouted = false;
  let errorMessage: string | null = null;

  if (aliasData === null) {
    errorMessage = 'Failed to connect to OPNsense API. Check configuration.';
  } else {
    const currentIps = getAliasIps(aliasData);
    isRouted = currentIps.includes(clientIp);
  }

  res.send(renderTemplate(clientIp, isRouted, errorMessage));
});

/**
 * Toggle the client IP in the OPNsense alias
 */
app.post('/toggle', async (req: Request, res: Response) => {
  const clientIp = getClientIp(req);
  const aliasData = await getAliasData();

  if (aliasData === null) {
    res.status(500).json({ success: false, error: 'Failed to fetch alias data' });
    return;
  }

  const currentIps = getAliasIps(aliasData);
  let newIps: string[];
  let action: string;

  if (currentIps.includes(clientIp)) {
    // Remove IP from alias
    newIps = currentIps.filter((ip) => ip !== clientIp);
    action = 'removed';
  } else {
    // Add IP to alias
    newIps = [...currentIps, clientIp];
    action = 'added';
  }

  const success = await updateAlias(newIps);

  if (success) {
    res.json({ success: true, action, ip: clientIp });
  } else {
    res.status(500).json({ success: false, error: 'Failed to update alias' });
  }
});

/**
 * Get external IP (proxy endpoint to avoid CORS)
 */
app.get('/external-ip', async (req: Request, res: Response) => {
  // Note: This endpoint exists but should not be used for client routing verification
  // It returns the server's external IP, not the client's
  try {
    const response = await fetch('https://api.ipify.org?format=json');
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error fetching external IP:', error);
    res.status(500).json({ error: 'Failed to fetch external IP' });
  }
});

/**
 * Render the HTML template
 */
function renderTemplate(clientIp: string, isRouted: boolean, errorMessage: string | null): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TunnelToggle</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: #121212;
            color: #e0e0e0;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        
        .container {
            max-width: 600px;
            width: 100%;
            text-align: center;
        }
        
        h1 {
            font-size: 2.5rem;
            margin-bottom: 1rem;
            color: #ffffff;
        }
        
        .subtitle {
            font-size: 1.1rem;
            color: #b0b0b0;
            margin-bottom: 2rem;
        }
        
        .info-card {
            background: #1e1e1e;
            border-radius: 12px;
            padding: 1.5rem;
            margin-bottom: 1.5rem;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
        }
        
        .info-label {
            font-size: 0.9rem;
            color: #888;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 0.5rem;
        }
        
        .info-value {
            font-size: 1.5rem;
            font-weight: 600;
            color: #4fc3f7;
            word-break: break-all;
        }
        
        .status-badge {
            display: inline-block;
            padding: 0.5rem 1.5rem;
            border-radius: 20px;
            font-size: 1rem;
            font-weight: 600;
            margin: 1rem 0;
        }
        
        .status-routed {
            background: #d32f2f;
            color: white;
        }
        
        .status-direct {
            background: #1976d2;
            color: white;
        }
        
        .toggle-button {
            width: 100%;
            padding: 1.5rem;
            font-size: 1.5rem;
            font-weight: 700;
            border: none;
            border-radius: 12px;
            cursor: pointer;
            transition: all 0.3s ease;
            margin-bottom: 1.5rem;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        .toggle-button:focus {
            outline: 4px solid #ffeb3b;
            outline-offset: 4px;
            transform: scale(1.05);
        }
        
        .toggle-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 12px rgba(0, 0, 0, 0.4);
        }
        
        .toggle-button:active {
            transform: translateY(0);
        }
        
        .btn-route {
            background: #1976d2;
            color: white;
        }
        
        .btn-disconnect {
            background: #d32f2f;
            color: white;
        }
        
        .external-ip-card {
            background: #1e1e1e;
            border-radius: 12px;
            padding: 1.5rem;
            margin-bottom: 1.5rem;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
        }
        
        .external-ip-value {
            font-size: 1.3rem;
            font-weight: 600;
            color: #66bb6a;
            margin-top: 0.5rem;
        }
        
        .geo-info {
            font-size: 1rem;
            color: #b0b0b0;
            margin-top: 0.5rem;
        }
        
        .refresh-btn {
            background: #424242;
            border: none;
            color: #e0e0e0;
            padding: 0.5rem 1rem;
            border-radius: 8px;
            cursor: pointer;
            font-size: 0.9rem;
            margin-top: 0.75rem;
            transition: background 0.2s;
        }
        
        .refresh-btn:hover {
            background: #616161;
        }
        
        .refresh-btn:focus {
            outline: 2px solid #ffeb3b;
            outline-offset: 2px;
        }
        
        .refresh-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .loading {
            color: #888;
            font-style: italic;
        }
        
        .error {
            background: #b71c1c;
            color: white;
            padding: 1rem;
            border-radius: 8px;
            margin-bottom: 1.5rem;
        }
        
        .footer {
            margin-top: 2rem;
            font-size: 0.85rem;
            color: #666;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔒 TunnelToggle</h1>
        <p class="subtitle">VPN Gateway Router</p>
        
        ${errorMessage ? `<div class="error">⚠️ ${errorMessage}</div>` : ''}
        
        <div class="info-card">
            <div class="info-label">Your Device IP</div>
            <div class="info-value">${clientIp}</div>
        </div>
        
        <div class="external-ip-card">
            <div class="info-label">External IP Address</div>
            <div class="external-ip-value loading" id="external-ip">Loading...</div>
            <div class="geo-info" id="geo-info"></div>
            <button class="refresh-btn" id="refresh-btn" onclick="refreshExternalIP()">🔄 Refresh</button>
        </div>
        
        ${!errorMessage ? `
        <div class="status-badge ${isRouted ? 'status-routed' : 'status-direct'}">
            ${isRouted ? '🔴 Routed Through VPN' : '🔵 Direct Connection'}
        </div>
        
        <button class="toggle-button ${isRouted ? 'btn-disconnect' : 'btn-route'}" 
                id="toggle-btn" 
                onclick="toggleVPN()">
            ${isRouted ? 'Disconnect from VPN' : 'Route Through VPN'}
        </button>
        ` : ''}
    </div>
    
    <script>
        // Fetch external IP and geo information (CLIENT-SIDE - goes through device's route)
        async function fetchExternalIP() {
            const externalIpEl = document.getElementById('external-ip');
            const geoInfoEl = document.getElementById('geo-info');
            
            try {
                // Use ifconfig.me - simple, no session caching
                const cacheBuster = new Date().getTime() + Math.random();
                console.log('[External IP] Fetching from ifconfig.me (client-side)...');
                
                const response = await fetch(\`https://ifconfig.me/ip?t=\${cacheBuster}\`, {
                    cache: 'no-store',
                    headers: {
                        'Accept': 'text/plain'
                    }
                });
                
                if (!response.ok) {
                    throw new Error(\`HTTP error! status: \${response.status}\`);
                }
                
                const ip = (await response.text()).trim();
                console.log('[External IP] Got IP:', ip);
                
                externalIpEl.textContent = ip;
                externalIpEl.classList.remove('loading');
                
                // Try to get geo info separately
                try {
                    const geoResponse = await fetch(\`http://ip-api.com/json/\${ip}?t=\${cacheBuster}\`, {
                        cache: 'no-store'
                    });
                    
                    if (geoResponse.ok) {
                        const geoData = await geoResponse.json();
                        const city = geoData.city || '';
                        const region = geoData.regionName || '';
                        const country = geoData.country || '';
                        
                        if (city || region) {
                            geoInfoEl.textContent = 
                                \`\${city}\${city && region ? ', ' : ''}\${region}\${country ? ' (' + country + ')' : ''}\`;
                        }
                    }
                } catch (geoError) {
                    console.warn('[External IP] Could not fetch geo data:', geoError);
                }
            } catch (error) {
                console.error('[External IP] Failed to fetch:', error);
                externalIpEl.textContent = 'Unable to fetch';
                externalIpEl.classList.remove('loading');
            }
        }
        
        // Manual refresh button handler
        async function refreshExternalIP() {
            const refreshBtn = document.getElementById('refresh-btn');
            const externalIpEl = document.getElementById('external-ip');
            
            refreshBtn.disabled = true;
            refreshBtn.textContent = '⏳ Checking...';
            externalIpEl.classList.add('loading');
            externalIpEl.textContent = 'Checking...';
            
            await fetchExternalIP();
            
            refreshBtn.disabled = false;
            refreshBtn.textContent = '🔄 Refresh';
        }
        
        // Toggle VPN routing
        async function toggleVPN() {
            const button = document.getElementById('toggle-btn');
            button.disabled = true;
            button.textContent = 'Processing...';
            
            try {
                const response = await fetch('/toggle', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
                
                const data = await response.json();
                
                if (data.success) {
                    console.log(\`[Toggle] Successfully \${data.action} IP \${data.ip}\`);
                    // Wait 2 seconds for routing changes to propagate, then reload
                    button.textContent = 'Applying changes...';
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    window.location.reload();
                } else {
                    alert('Error: ' + (data.error || 'Unknown error occurred'));
                    button.disabled = false;
                    button.textContent = button.classList.contains('btn-route') ? 'Route Through VPN' : 'Disconnect from VPN';
                }
            } catch (error) {
                console.error('Error toggling VPN:', error);
                alert('Failed to connect to server');
                button.disabled = false;
                button.textContent = button.classList.contains('btn-route') ? 'Route Through VPN' : 'Disconnect from VPN';
            }
        }
        
        // Load external IP on page load
        fetchExternalIP();
    </script>
</body>
</html>`;
}

// Validate required environment variables
const requiredVars = ['OPNSENSE_IP', 'ALIAS_UUID', 'OPNSENSE_KEY', 'OPNSENSE_SECRET'];
const missingVars = requiredVars.filter((varName) => !process.env[varName]);

if (missingVars.length > 0) {
  console.error(`Missing required environment variables: ${missingVars.join(', ')}`);
  process.exit(1);
}

// Start the server
app.listen(FLASK_PORT, '0.0.0.0', () => {
  console.log(`TunnelToggle server listening on http://0.0.0.0:${FLASK_PORT}`);
});
