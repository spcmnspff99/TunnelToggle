#!/usr/bin/env python3
"""
TunnelToggle - OPNsense VPN Gateway Toggle for Google TV / iPad
Detects client IP and toggles it within an OPNsense firewall alias
"""

import os
import logging
from flask import Flask, render_template_string, request, jsonify
import requests
import urllib3

# Disable SSL warnings for self-signed certificates
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Load configuration from environment
OPNSENSE_IP = os.getenv("OPNSENSE_IP")
ALIAS_UUID = os.getenv("ALIAS_UUID")
OPNSENSE_KEY = os.getenv("OPNSENSE_KEY")
OPNSENSE_SECRET = os.getenv("OPNSENSE_SECRET")
FLASK_PORT = int(os.getenv("FLASK_PORT", 5000))

# OPNsense API endpoints
ALIAS_GET_URL = f"https://{OPNSENSE_IP}/api/firewall/alias/getItem/{ALIAS_UUID}"
ALIAS_SET_URL = f"https://{OPNSENSE_IP}/api/firewall/alias/setItem/{ALIAS_UUID}"
ALIAS_RECONFIGURE_URL = f"https://{OPNSENSE_IP}/api/firewall/alias/reconfigure"


def get_client_ip():
    """Extract the client's IP address from the request."""
    # Try X-Forwarded-For first (if behind a proxy), then fall back to remote_addr
    if request.headers.get("X-Forwarded-For"):
        return request.headers.get("X-Forwarded-For").split(",")[0].strip()
    return request.remote_addr


def get_alias_data():
    """Fetch the current alias configuration from OPNsense."""
    try:
        response = requests.get(
            ALIAS_GET_URL,
            auth=(OPNSENSE_KEY, OPNSENSE_SECRET),
            verify=False,
            timeout=10
        )
        response.raise_for_status()
        data = response.json()
        logger.info(f"Alias data structure: {data}")
        return data.get("alias", {})
    except Exception as e:
        logger.error(f"Error fetching alias data: {e}")
        return None


def get_alias_ips(alias_data):
    """Extract the list of IPs from the alias content field."""
    if not alias_data:
        return []
    
    content = alias_data.get("content", "")
    if not content:
        return []
    
    # Handle different content formats from OPNsense API
    if isinstance(content, dict):
        # Content is a dict where selected items have 'selected': 1
        # Only extract items that are currently selected (active in the alias)
        ips = []
        for key, value in content.items():
            if isinstance(value, dict) and value.get("selected") == 1:
                # Extract the value field which contains the actual IP/hostname
                ip_value = value.get("value")
                if ip_value:
                    ips.append(ip_value)
        return ips
    elif isinstance(content, list):
        # Content is a list of IPs
        return [str(ip).strip() for ip in content if ip]
    else:
        # Content is a comma-separated or newline-separated string
        return [ip.strip() for ip in str(content).replace("\n", ",").split(",") if ip.strip()]


def update_alias(new_ip_list):
    """Update the alias with a new list of IPs."""
    try:
        # OPNsense expects newline-separated values for alias content
        content = "\n".join(new_ip_list)
        
        payload = {
            "alias": {
                "content": content
            }
        }
        
        logger.info(f"Updating alias with {len(new_ip_list)} IPs")
        logger.info(f"Payload content: {content}")
        
        response = requests.post(
            ALIAS_SET_URL,
            auth=(OPNSENSE_KEY, OPNSENSE_SECRET),
            json=payload,
            verify=False,
            timeout=10
        )
        response.raise_for_status()
        result = response.json()
        logger.info(f"Update response: {result}")
        
        # Check if the update was successful
        if result.get("result") != "saved":
            logger.error(f"Update failed: {result}")
            return False
        
        # Reconfigure the alias system to apply changes
        reconfigure_response = requests.post(
            ALIAS_RECONFIGURE_URL,
            auth=(OPNSENSE_KEY, OPNSENSE_SECRET),
            verify=False,
            timeout=10
        )
        reconfigure_response.raise_for_status()
        logger.info(f"Reconfigure response: {reconfigure_response.json()}")
        
        logger.info(f"Successfully updated alias with {len(new_ip_list)} IPs")
        return True
    except Exception as e:
        logger.error(f"Error updating alias: {e}")
        return False


@app.route("/")
def index():
    """Main page - displays current status and toggle button."""
    client_ip = get_client_ip()
    alias_data = get_alias_data()
    
    if alias_data is None:
        error_message = "Failed to connect to OPNsense API. Check configuration."
        is_routed = False
    else:
        current_ips = get_alias_ips(alias_data)
        is_routed = client_ip in current_ips
        error_message = None
    
    return render_template_string(HTML_TEMPLATE, 
                                  client_ip=client_ip,
                                  is_routed=is_routed,
                                  error_message=error_message)


@app.route("/toggle", methods=["POST"])
def toggle():
    """Toggle the client IP in the OPNsense alias."""
    client_ip = get_client_ip()
    alias_data = get_alias_data()
    
    if alias_data is None:
        return jsonify({"success": False, "error": "Failed to fetch alias data"}), 500
    
    current_ips = get_alias_ips(alias_data)
    
    if client_ip in current_ips:
        # Remove IP from alias
        new_ips = [ip for ip in current_ips if ip != client_ip]
        action = "removed"
    else:
        # Add IP to alias
        new_ips = current_ips + [client_ip]
        action = "added"
    
    success = update_alias(new_ips)
    
    if success:
        return jsonify({"success": True, "action": action, "ip": client_ip})
    else:
        return jsonify({"success": False, "error": "Failed to update alias"}), 500


# HTML Template with inline CSS and JavaScript
HTML_TEMPLATE = """
<!DOCTYPE html>
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
        
        {% if error_message %}
        <div class="error">
            ⚠️ {{ error_message }}
        </div>
        {% endif %}
        
        <div class="info-card">
            <div class="info-label">Your Device IP</div>
            <div class="info-value">{{ client_ip }}</div>
        </div>
        
        <div class="external-ip-card">
            <div class="info-label">External IP Address</div>
            <div class="external-ip-value loading" id="external-ip">Loading...</div>
            <div class="geo-info" id="geo-info"></div>
        </div>
        
        {% if not error_message %}
        <div class="status-badge {% if is_routed %}status-routed{% else %}status-direct{% endif %}">
            {% if is_routed %}
            🔴 Routed Through VPN
            {% else %}
            🔵 Direct Connection
            {% endif %}
        </div>
        
        <button class="toggle-button {% if is_routed %}btn-disconnect{% else %}btn-route{% endif %}" 
                id="toggle-btn" 
                onclick="toggleVPN()">
            {% if is_routed %}
            Disconnect from VPN
            {% else %}
            Route Through VPN
            {% endif %}
        </button>
        {% endif %}
        
        <div class="footer">
            Built for Google TV & iPad
        </div>
    </div>
    
    <script>
        // Update external IP display with new data
        function updateExternalIPDisplay(ipInfo) {
            if (ipInfo && ipInfo.ip) {
                document.getElementById('external-ip').textContent = ipInfo.ip;
                document.getElementById('external-ip').classList.remove('loading');
                
                const city = ipInfo.city || '';
                const region = ipInfo.region || '';
                const country = ipInfo.country || '';
                
                if (city || region) {
                    document.getElementById('geo-info').textContent = 
                        `${city}${city && region ? ', ' : ''}${region}${country ? ' (' + country + ')' : ''}`;
                } else {
                    document.getElementById('geo-info').textContent = '';
                }
            }
        }
        
        // Fetch external IP from the client side (device's actual external IP)
        async function fetchExternalIP() {
            try {
                const response = await fetch('https://ifconfig.co/json');
                const data = await response.json();
                updateExternalIPDisplay(data);
                return data.ip;
            } catch (error) {
                console.error('Error fetching external IP:', error);
                document.getElementById('external-ip').textContent = 'Unable to fetch';
                document.getElementById('external-ip').classList.remove('loading');
                return null;
            }
        }
        
        // Poll for external IP change after routing update
        async function waitForIPChange(originalIP, maxAttempts = 6) {
            const ipElement = document.getElementById('external-ip');
            
            for (let i = 0; i < maxAttempts; i++) {
                await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
                
                ipElement.classList.add('loading');
                ipElement.textContent = `Checking routing... (${i + 1}/${maxAttempts})`;
                
                const newIP = await fetchExternalIP();
                
                // If IP changed or we've exhausted attempts, reload page
                if (newIP && newIP !== originalIP) {
                    console.log(`IP changed from ${originalIP} to ${newIP}`);
                    break;
                }
            }
            
            // Reload page to show updated button status
            window.location.reload();
        }
        
        // Toggle VPN routing
        async function toggleVPN() {
            const button = document.getElementById('toggle-btn');
            button.disabled = true;
            button.textContent = 'Processing...';
            
            // Capture current external IP before toggling
            const currentIPElement = document.getElementById('external-ip');
            const originalIP = currentIPElement.textContent;
            
            try {
                const response = await fetch('/toggle', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
                
                const data = await response.json();
                
                if (data.success) {
                    // Wait for routing to propagate and IP to change
                    button.textContent = 'Waiting for routing...';
                    await waitForIPChange(originalIP);
                } else {
                    alert('Error: ' + (data.error || 'Unknown error occurred'));
                    button.disabled = false;
                    button.textContent = button.classList.contains('btn-route') 
                        ? 'Route Through VPN' 
                        : 'Disconnect from VPN';
                }
            } catch (error) {
                console.error('Error toggling VPN:', error);
                alert('Failed to connect to server');
                button.disabled = false;
                button.textContent = button.classList.contains('btn-route') 
                    ? 'Route Through VPN' 
                    : 'Disconnect from VPN';
            }
        }
        
        // Load external IP on page load
        fetchExternalIP();
    </script>
</body>
</html>
"""

if __name__ == "__main__":
    # Validate required environment variables
    required_vars = ["OPNSENSE_IP", "ALIAS_UUID", "OPNSENSE_KEY", "OPNSENSE_SECRET"]
    missing_vars = [var for var in required_vars if not os.getenv(var)]
    
    if missing_vars:
        logger.error(f"Missing required environment variables: {', '.join(missing_vars)}")
        exit(1)
    
    app.run(host="0.0.0.0", port=FLASK_PORT, debug=False)
