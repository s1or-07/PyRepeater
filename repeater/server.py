#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Servidor HTTP local que sirve la interfaz web y expone la API de envío.

- `GET /`            -> web/index.html
- `GET /style.css`   -> estáticos de web/
- `GET /app.js`      -> estáticos de web/
- `POST /api/send`        -> client.send_request
- `POST /api/send_group`  -> parallel.send_group_parallel

Se enlaza solo a la interfaz de loopback (127.0.0.1) por seguridad.
"""

import os
import json
import mimetypes
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .client import send_request
from .parallel import send_group_parallel

# Carpeta con los assets web, resuelta relativa a este archivo (no al CWD).
WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8777


def _guess_type(path):
    ctype, _ = mimetypes.guess_type(path)
    if ctype is None:
        return "application/octet-stream"
    if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
        return ctype + "; charset=utf-8"
    return ctype


class Handler(BaseHTTPRequestHandler):
    server_version = "RepeaterClone"

    def log_message(self, *args):
        pass  # silenciar el log por petición

    # -- helpers -----------------------------------------------------------
    def _send(self, code, content_type, body_bytes):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body_bytes)))
        self.end_headers()
        self.wfile.write(body_bytes)

    def _serve_static(self, rel_path):
        """Sirve un archivo de WEB_DIR, con protección contra path traversal."""
        rel_path = rel_path.lstrip("/") or "index.html"
        full = os.path.normpath(os.path.join(WEB_DIR, rel_path))
        # El archivo resuelto debe seguir dentro de WEB_DIR.
        if not full.startswith(WEB_DIR + os.sep) and full != WEB_DIR:
            self._send(403, "text/plain; charset=utf-8", b"Forbidden")
            return
        if not os.path.isfile(full):
            self._send(404, "text/plain; charset=utf-8", b"Not found")
            return
        try:
            with open(full, "rb") as fh:
                data = fh.read()
        except OSError:
            self._send(500, "text/plain; charset=utf-8", b"Read error")
            return
        self._send(200, _guess_type(full), data)

    # -- rutas -------------------------------------------------------------
    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path in ("/", "/index.html"):
            self._serve_static("index.html")
        elif path == "/favicon.ico":
            self._send(204, "image/x-icon", b"")
        elif path in ("/style.css", "/app.js"):
            self._serve_static(path)
        else:
            self._send(404, "text/plain; charset=utf-8", b"Not found")

    def do_POST(self):
        if self.path not in ("/api/send", "/api/send_group"):
            self._send(404, "text/plain; charset=utf-8", b"Not found")
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length) or b"{}")
            if self.path == "/api/send_group":
                result = send_group_parallel(payload)
            else:
                result = send_request(payload)
        except Exception as exc:
            result = {"ok": False, "error": "%s: %s" % (type(exc).__name__, exc)}
        self._send(200, "application/json; charset=utf-8", json.dumps(result).encode("utf-8"))


def run(host=DEFAULT_HOST, port=DEFAULT_PORT, open_browser=True):
    """Arranca el servidor y (opcionalmente) abre el navegador."""
    server = ThreadingHTTPServer((host, port), Handler)
    url = "http://%s:%d" % (host, port)
    print("=" * 56)
    print("  Repeater Clone en marcha")
    print("  Abre en tu navegador:  %s" % url)
    print("  (Ctrl+C para detener)")
    print("=" * 56)
    if open_browser:
        try:
            threading.Timer(0.8, lambda: webbrowser.open(url)).start()
        except Exception:
            pass
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nDetenido.")
    finally:
        server.shutdown()
        server.server_close()
