#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Envío en paralelo con LAST-BYTE SYNCHRONIZATION (race conditions, HTTP/1).

Técnica: se abren N conexiones, se envía cada petición MENOS su último byte;
una barrera espera a que todas estén listas y, en ese instante, todos los hilos
sueltan el último byte a la vez. Así las peticiones se completan en el servidor
casi simultáneamente, lo que sirve para probar race conditions en sistemas para
los que se tenga autorización expresa.
"""

import time
import socket
import threading

from .raw_http import build_request_bytes, parse_response_bytes, make_ssl_context
from .client import send_request

MAX_GROUP = 100
BARRIER_WAIT_CAP = 15  # tope de segundos que un hilo espera en la barrera


def open_socket(scheme, host, port, verify_tls, timeout):
    """Abre el socket (y hace el handshake TLS) ANTES de la sincronización."""
    sock = socket.create_connection((host, port), timeout=timeout)
    sock.settimeout(timeout)
    if scheme == "https":
        ctx = make_ssl_context(verify_tls)
        sock = ctx.wrap_socket(sock, server_hostname=host)
    return sock


def read_http_response(sock, timeout):
    """Lee una respuesta HTTP completa desde un socket crudo.

    Maneja tres casos para saber cuándo parar: `Transfer-Encoding: chunked`
    (hasta el chunk terminador `0\\r\\n\\r\\n`), `Content-Length` explícito, o
    lectura hasta cierre de conexión.
    """
    sock.settimeout(timeout)
    buf = b""
    # 1) Leer al menos hasta el final de las cabeceras.
    while b"\r\n\r\n" not in buf:
        try:
            chunk = sock.recv(65536)
        except Exception:
            break
        if not chunk:
            return buf
        buf += chunk

    head_b, _, body = buf.partition(b"\r\n\r\n")
    head_low = head_b.lower()

    if b"transfer-encoding:" in head_low and b"chunked" in head_low:
        # Parar cuando aparezca el chunk terminador.
        while b"\r\n0\r\n\r\n" not in body and not body.endswith(b"0\r\n\r\n"):
            try:
                chunk = sock.recv(65536)
            except Exception:
                break
            if not chunk:
                break
            body += chunk
    else:
        cl = None
        for line in head_b.split(b"\r\n"):
            if line.lower().startswith(b"content-length:"):
                try:
                    cl = int(line.split(b":", 1)[1].strip())
                except Exception:
                    cl = None
                break
        if cl is not None:
            while len(body) < cl:
                try:
                    chunk = sock.recv(65536)
                except Exception:
                    break
                if not chunk:
                    break
                body += chunk
        else:
            # Sin longitud conocida: leer hasta que el servidor cierre.
            try:
                while True:
                    chunk = sock.recv(65536)
                    if not chunk:
                        break
                    body += chunk
            except Exception:
                pass

    return head_b + b"\r\n\r\n" + body


def send_group_parallel(payload):
    """Envía un grupo de peticiones en paralelo con last-byte synchronization."""
    reqs = payload.get("requests", [])
    update_cl = payload.get("updateContentLength", True)
    verify_tls = payload.get("verifyTls", False)
    timeout = float(payload.get("timeout", 30) or 30)

    n = len(reqs)
    if n == 0:
        return {"ok": False, "error": "El grupo está vacío."}
    if n > MAX_GROUP:
        return {"ok": False, "error": "Máximo %d peticiones por grupo." % MAX_GROUP}
    if n == 1:
        # Una sola: no hay nada que sincronizar, envío normal.
        spec = reqs[0]
        res = send_request({**spec, "updateContentLength": update_cl,
                            "verifyTls": verify_tls, "timeout": timeout})
        res["index"] = 0
        if res.get("ok"):
            res["order"] = 1
        return {"ok": True, "results": [res]}

    barrier = threading.Barrier(n)
    results = [None] * n
    t0 = time.perf_counter()
    bwait = min(timeout, BARRIER_WAIT_CAP)

    def worker(i, spec):
        scheme = (spec.get("scheme") or "https").lower()
        host = (spec.get("host") or "").strip()
        port = int(spec.get("port") or (443 if scheme == "https" else 80))
        raw = spec.get("request", "")
        sock = None
        try:
            data = build_request_bytes(scheme, host, port, raw, update_cl)
            if len(data) < 2:
                raise ValueError("Petición demasiado corta")
            sock = open_socket(scheme, host, port, verify_tls, timeout)
            sock.sendall(data[:-1])              # todo MENOS el último byte
        except Exception as exc:
            results[i] = {"ok": False, "error": "%s: %s" % (type(exc).__name__, exc), "index": i}
            try:
                barrier.abort()                  # libera al resto para que no se cuelguen
            except Exception:
                pass
            if sock:
                try:
                    sock.close()
                except Exception:
                    pass
            return

        try:
            barrier.wait(timeout=bwait)          # <-- punto de sincronización
        except Exception:
            pass

        try:
            sock.sendall(data[-1:])              # ÚLTIMO byte (a la vez en todos)
            resp_bytes = read_http_response(sock, timeout)
            recv_ts = time.perf_counter()
            parsed = parse_response_bytes(resp_bytes)
            parsed["timeMs"] = round((recv_ts - t0) * 1000, 2)
            parsed["recvOffsetMs"] = round((recv_ts - t0) * 1000, 3)
            parsed["index"] = i
            results[i] = parsed
        except Exception as exc:
            results[i] = {"ok": False, "error": "%s: %s" % (type(exc).__name__, exc), "index": i}
        finally:
            try:
                sock.close()
            except Exception:
                pass

    threads = [threading.Thread(target=worker, args=(i, s)) for i, s in enumerate(reqs)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=timeout + 5)

    # Asignar el ORDEN de llegada (clave para interpretar la race condition).
    valid = [r for r in results if r and r.get("ok") and "recvOffsetMs" in r]
    for rank, r in enumerate(sorted(valid, key=lambda r: r["recvOffsetMs"]), 1):
        r["order"] = rank
    return {"ok": True, "results": results}
