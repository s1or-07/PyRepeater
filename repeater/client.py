#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Envío de una única petición HTTP cruda usando `http.client`.

El backend hace el envío real (esto evita las restricciones de CORS del
navegador) y devuelve un diccionario con estado, cabeceras, cuerpo, tiempos y
tamaño. Opcionalmente sigue redirecciones.
"""

import time
import http.client
from urllib.parse import urlsplit

from .raw_http import parse_raw_request, decode_body, make_ssl_context

MAX_REDIRECTS = 10


def send_request(payload):
    """Envía una petición a partir del `payload` que manda la interfaz web."""
    scheme = (payload.get("scheme") or "https").lower()
    host = (payload.get("host") or "").strip()
    if not host:
        return {"ok": False, "error": "Falta el host de destino."}

    port = payload.get("port")
    port = int(port) if port else (443 if scheme == "https" else 80)

    raw = payload.get("request", "")
    update_cl = payload.get("updateContentLength", True)
    verify_tls = payload.get("verifyTls", False)
    follow = payload.get("followRedirects", False)
    timeout = float(payload.get("timeout", 30) or 30)

    method, path, headers, body = parse_raw_request(raw)
    body_bytes = body.encode("utf-8", "replace") if body else b""

    if update_cl and method.upper() not in ("GET", "HEAD") and body_bytes:
        headers = [(k, v) for (k, v) in headers if k.lower() != "content-length"]
        headers.append(("Content-Length", str(len(body_bytes))))

    if not any(k.lower() == "host" for k, _ in headers):
        default_port = (scheme == "https" and port == 443) or (scheme == "http" and port == 80)
        host_value = host if default_port else "%s:%d" % (host, port)
        headers.insert(0, ("Host", host_value))

    redirects = 0
    cur_scheme, cur_host, cur_port, cur_path, cur_method = scheme, host, port, path, method
    cur_body = body_bytes

    while True:
        try:
            if cur_scheme == "https":
                ctx = make_ssl_context(verify_tls)
                conn = http.client.HTTPSConnection(cur_host, cur_port, timeout=timeout, context=ctx)
            else:
                conn = http.client.HTTPConnection(cur_host, cur_port, timeout=timeout)

            start = time.perf_counter()
            conn.putrequest(cur_method, cur_path, skip_host=True, skip_accept_encoding=True)
            for k, v in headers:
                conn.putheader(k, v)
            conn.endheaders(cur_body if cur_body else None)

            resp = conn.getresponse()
            resp_headers = resp.getheaders()
            data = resp.read()
            elapsed_ms = (time.perf_counter() - start) * 1000.0
            status = resp.status
            reason = resp.reason or ""
            version = "HTTP/1.1" if resp.version == 11 else "HTTP/1.0"
            conn.close()
        except Exception as exc:
            return {"ok": False, "error": "%s: %s" % (type(exc).__name__, exc)}

        decoded = decode_body(data, resp_headers)
        body_text = decoded.decode("utf-8", "replace")

        if follow and status in (301, 302, 303, 307, 308) and redirects < MAX_REDIRECTS:
            location = None
            for k, v in resp_headers:
                if k.lower() == "location":
                    location = v
                    break
            if location:
                redirects += 1
                full = location if "://" in location else "%s://%s%s" % (cur_scheme, cur_host, location)
                sp = urlsplit(full)
                cur_scheme = sp.scheme or cur_scheme
                cur_host = sp.hostname or cur_host
                cur_port = sp.port or (443 if cur_scheme == "https" else 80)
                cur_path = (sp.path or "/") + (("?" + sp.query) if sp.query else "")
                if status == 303 or (status in (301, 302) and cur_method == "POST"):
                    cur_method = "GET"
                    cur_body = b""
                headers = [(k, v) for (k, v) in headers if k.lower() not in ("host", "content-length")]
                headers.insert(0, ("Host", cur_host))
                continue

        head_lines = ["%s %d %s" % (version, status, reason)]
        head_lines += ["%s: %s" % (k, v) for k, v in resp_headers]
        raw_response = "\n".join(head_lines) + "\n\n" + body_text
        size_bytes = len(raw_response.encode("utf-8", "replace"))

        return {
            "ok": True,
            "status": status,
            "reason": reason,
            "version": version,
            "headers": [[k, v] for k, v in resp_headers],
            "body": body_text,
            "timeMs": round(elapsed_ms, 1),
            "sizeBytes": size_bytes,
            "raw": raw_response,
            "redirects": redirects,
        }
