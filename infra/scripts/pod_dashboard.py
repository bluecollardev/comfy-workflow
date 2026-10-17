#!/usr/bin/env python3
"""
Simple Web Dashboard for RunPod Pod Management
Run locally to see your pods in a browser interface
"""

import os
import json
from flask import Flask, render_template_string, jsonify
import runpod

app = Flask(__name__)

# HTML Dashboard Template
DASHBOARD_HTML = """
<!DOCTYPE html>
<html>
<head>
    <title>RunPod Pod Manager</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        .header h1 { font-size: 28px; margin-bottom: 10px; }
        .header p { opacity: 0.9; }
        .content { padding: 30px; }
        .status {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .stat-card {
            background: #f8f9fa;
            border-left: 4px solid #667eea;
            padding: 20px;
            border-radius: 8px;
        }
        .stat-label { font-size: 12px; color: #666; text-transform: uppercase; margin-bottom: 5px; }
        .stat-value { font-size: 32px; font-weight: bold; color: #333; }
        .pods-section h2 { margin-bottom: 20px; color: #333; }
        .pod-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 20px;
        }
        .pod-card {
            border: 2px solid #eee;
            border-radius: 8px;
            padding: 20px;
            background: #f8f9fa;
            transition: all 0.3s;
        }
        .pod-card:hover { border-color: #667eea; box-shadow: 0 4px 12px rgba(102,126,234,0.15); }
        .pod-name { font-size: 18px; font-weight: bold; color: #333; margin-bottom: 10px; }
        .pod-detail { font-size: 13px; color: #666; margin: 8px 0; }
        .pod-detail strong { color: #333; }
        .status-badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: bold;
            margin-top: 10px;
        }
        .status-running { background: #d4edda; color: #155724; }
        .status-starting { background: #fff3cd; color: #856404; }
        .status-stopped { background: #f8d7da; color: #721c24; }
        .error-message {
            background: #f8d7da;
            border: 1px solid #f5c6cb;
            color: #721c24;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
        }
        .loading { text-align: center; color: #666; padding: 20px; }
        .refresh-btn {
            background: #667eea;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            margin-bottom: 20px;
        }
        .refresh-btn:hover { background: #764ba2; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 RunPod Pod Manager</h1>
            <p>Real-time pod status and management</p>
        </div>
        <div class="content">
            <button class="refresh-btn" onclick="location.reload()">🔄 Refresh</button>
            <div id="dashboard"></div>
        </div>
    </div>

    <script>
        fetch('/api/dashboard')
            .then(r => r.json())
            .then(data => {
                if (data.error) {
                    document.getElementById('dashboard').innerHTML =
                        '<div class="error-message"><strong>❌ Error:</strong> ' + data.error + '</div>';
                    return;
                }

                let html = '<div class="status">';

                html += '<div class="stat-card">';
                html += '<div class="stat-label">Total Pods</div>';
                html += '<div class="stat-value">' + data.total_pods + '</div>';
                html += '</div>';

                html += '<div class="stat-card">';
                html += '<div class="stat-label">Running</div>';
                html += '<div class="stat-value" style="color: #28a745;">' + data.running_pods + '</div>';
                html += '</div>';

                html += '<div class="stat-card">';
                html += '<div class="stat-label">Stopped</div>';
                html += '<div class="stat-value" style="color: #dc3545;">' + data.stopped_pods + '</div>';
                html += '</div>';

                html += '</div>';

                if (data.pods.length === 0) {
                    html += '<div class="error-message">No pods found. Create one with:<br><code>python3 create_pod.py create --name ComfyUI-Dev --gpu rtx4090</code></div>';
                } else {
                    html += '<div class="pods-section"><h2>Your Pods</h2><div class="pod-grid">';

                    data.pods.forEach(pod => {
                        let statusClass = pod.status.includes('running') ? 'status-running' :
                                         pod.status.includes('starting') ? 'status-starting' : 'status-stopped';

                        html += '<div class="pod-card">';
                        html += '<div class="pod-name">' + pod.name + '</div>';
                        html += '<div class="pod-detail"><strong>ID:</strong> ' + pod.id.substring(0, 8) + '...</div>';
                        html += '<div class="pod-detail"><strong>GPU:</strong> ' + pod.gpu + '</div>';
                        html += '<div class="pod-detail"><strong>Status:</strong> <span class="status-badge ' + statusClass + '">' + pod.status + '</span></div>';
                        if (pod.web_url) {
                            html += '<div class="pod-detail"><strong><a href="' + pod.web_url + '" target="_blank">🌐 Web UI</a></strong></div>';
                        }
                        if (pod.ssh_cmd) {
                            html += '<div class="pod-detail"><strong>SSH:</strong><br><code>' + pod.ssh_cmd + '</code></div>';
                        }
                        html += '</div>';
                    });

                    html += '</div></div>';
                }

                document.getElementById('dashboard').innerHTML = html;
            })
            .catch(err => {
                document.getElementById('dashboard').innerHTML =
                    '<div class="error-message"><strong>❌ Connection Error:</strong> ' + err.message + '</div>';
            });
    </script>
</body>
</html>
"""


@app.route('/')
def index():
    """Serve dashboard"""
    return render_template_string(DASHBOARD_HTML)


@app.route('/api/dashboard')
def api_dashboard():
    """Get pod data for API"""
    try:
        api_key = os.getenv('RUNPOD_API_KEY')
        if not api_key:
            return jsonify({'error': 'RUNPOD_API_KEY not set'}), 401

        runpod.api_key = api_key
        pods = runpod.get_pods()

        running = sum(1 for p in pods if 'running' in str(p.get('runtime', {}).get('uptimeInSeconds', '')))
        stopped = len(pods) - running

        pod_list = []
        for pod in pods:
            pod_id = pod.get('id', 'unknown')
            pod_list.append({
                'id': pod_id,
                'name': pod.get('name', 'Unknown'),
                'status': 'running' if 'running' in str(pod.get('runtime', {})) else 'stopped',
                'gpu': pod.get('runtime', {}).get('gpuCount', '?'),
                'web_url': f'http://{pod_id}.proxy.runpod.io:8188' if 'running' in str(pod.get('runtime', {})) else None,
                'ssh_cmd': f'ssh root@{pod_id}.proxy.runpod.io'
            })

        return jsonify({
            'total_pods': len(pods),
            'running_pods': running,
            'stopped_pods': stopped,
            'pods': pod_list,
            'error': None
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


def main():
    """Run dashboard"""
    print("""
╔════════════════════════════════════════════════════════════╗
║            RunPod Pod Manager Dashboard                     ║
╠════════════════════════════════════════════════════════════╣
║                                                              ║
║  🌐 Open your browser:  http://localhost:5000               ║
║                                                              ║
║  Real-time view of your RunPod pods                         ║
║  Click on pod IDs to access ComfyUI web UI                 ║
║                                                              ║
║  Press Ctrl+C to stop                                       ║
║                                                              ║
╚════════════════════════════════════════════════════════════╝
    """)

    app.run(debug=True, host='0.0.0.0', port=5000)


if __name__ == '__main__':
    main()
