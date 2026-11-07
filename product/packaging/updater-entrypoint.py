#!/usr/bin/env python3
"""Kachinco-style resident process; Updater owns container restart and mounts."""
import http.server
import json
import os
import pathlib
import signal
import subprocess
import sys
import threading
import time


def settings(environment, state):
    retained = state / 'connection.json'
    old = json.loads(retained.read_text()) if retained.exists() else {}
    endpoint = environment.get('FLAMORIS2D_HUB_ENDPOINT') or old.get('endpoint', '')
    credential = environment.get('FLAMORIS2D_HUB_TOKEN') or old.get('credential', '')
    if not endpoint.startswith('wss://') or not credential or len(credential) > 4096 or any(ord(c) < 32 for c in credential):
        raise ValueError('Configure the dedicated WSS endpoint and private connector credential')
    return endpoint, credential


def main():
    state = pathlib.Path('/data/state')
    endpoint, credential = settings(os.environ, state)
    port = int(os.environ.get('FLAMORIS2D_PORT', '8774'))
    if not 1 <= port <= 65535:
        raise ValueError('Invalid health port')
    initial = state / 'initial.fl2d'
    if not initial.exists():
        if (state / 'workspace/project.fl2d').exists():
            raise ValueError('Retained workspace exists without its startup source; restore initial.fl2d')
        subprocess.run(['/app/flamoris2d', 'new', '--output', str(initial)], check=True, timeout=30)
    environment = os.environ.copy()
    environment.pop('FLAMORIS2D_HUB_TOKEN', None)
    os.environ.pop('FLAMORIS2D_HUB_TOKEN', None)
    environment['FLAMORIS_HUB_CREDENTIAL'] = credential
    credential = None
    child = subprocess.Popen(['/app/flamoris2d', 'mcp', str(initial), '--workspace', str(state / 'workspace'),
                              '--permission', 'edit', '--hub', endpoint], env=environment,
                             stdout=subprocess.PIPE, text=True)
    environment.pop('FLAMORIS_HUB_CREDENTIAL', None)
    stopping = threading.Event()
    ready = threading.Event()
    connected = threading.Event()

    class Health(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path != '/healthz':
                self.send_error(404)
                return
            alive = ready.is_set() and child.poll() is None and not stopping.is_set()
            body = json.dumps({'status': 'ready' if alive else 'starting', 'hubConnected': connected.is_set() and alive}).encode()
            self.send_response(200 if alive else 503)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers(); self.wfile.write(body)
        def log_message(self, *_):
            pass

    def output():
        for line in child.stdout:
            print(line, end='', flush=True)
            try:
                status = json.loads(line)
                if status.get('status') == 'started': ready.set()
                if status.get('hubConnected'): connected.set()
                else: connected.clear()
            except (ValueError, AttributeError):
                pass

    def stop(*_):
        stopping.set()
        if child.poll() is None: child.terminate()

    server = http.server.ThreadingHTTPServer(('127.0.0.1', port), Health)
    server.daemon_threads = True
    signal.signal(signal.SIGTERM, stop); signal.signal(signal.SIGINT, stop)
    threading.Thread(target=output, daemon=True).start()
    threading.Thread(target=server.serve_forever, kwargs={'poll_interval': .2}, daemon=True).start()
    try:
        deadline = None
        while child.poll() is None:
            if stopping.is_set():
                deadline = deadline or time.monotonic() + 25
                if time.monotonic() > deadline: child.kill()
            time.sleep(.1)
        return child.returncode
    finally:
        ready.clear(); connected.clear(); server.shutdown(); server.server_close()
        if child.poll() is None:
            child.terminate()
            try: child.wait(timeout=25)
            except subprocess.TimeoutExpired: child.kill(); child.wait()


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(json.dumps({'error': 'resident_start_failed', 'type': type(error).__name__}), file=sys.stderr)
        sys.exit(1)
