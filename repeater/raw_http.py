#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Utilidades de bajo nivel para trabajar con peticiones/respuestas HTTP crudas.

Aquí vive todo lo que no depende de sockets ni de conexiones: parsear el texto
de una petición, (des)comprimir cuerpos, decodificar `chunked`, reconstruir la
petición en bytes y parsear una respuesta cruda a un diccionario homogéneo.
"""

import re
import ssl
import gzip
import zlib

# Brotli no forma parte de la librería estándar. Es opcional: si no está
# instalado, los cuerpos con `Content-Encoding: br` se devuelven sin descomprimir.
try:
    import brotli  # type: ignore
    _HAS_BROTLI = True
except ImportError:  # pragma: no cover
    brotli = None
    _HAS_BROTLI = False


def make_ssl_context(verify_tls):
    """Crea un contexto TLS.

    Con `verify_tls=False` (por defecto en una herramienta de pruebas) se acepta
    cualquier certificado, incluidos los autofirmados. Se usa la API pública en
    lugar de `ssl._create_unverified_context()`.
    """
    ctx = ssl.create_default_context()
    if not verify_tls:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    return ctx


def parse_raw_request(raw):
    """Divide una petición cruda en (method, path, headers, body).

    `headers` es una lista de tuplas (clave, valor). El separador cabecera/cuerpo
    es la primera línea en blanco. Se normalizan los finales de línea.
    """
    raw = raw.replace("\r\n", "\n").replace("\r", "\n")
    if "\n\n" in raw:
        head, body = raw.split("\n\n", 1)
    else:
        head, body = raw, ""

    lines = head.split("\n")
    request_line = lines[0].strip() if lines else "GET / HTTP/1.1"
    parts = request_line.split(" ")
    method = parts[0] if parts and parts[0] else "GET"
    path = parts[1] if len(parts) > 1 else "/"

    # Si la línea de petición trae una URL absoluta, quedarnos con path+query.
    if path.startswith("http://") or path.startswith("https://"):
        from urllib.parse import urlsplit
        sp = urlsplit(path)
        path = sp.path or "/"
        if sp.query:
            path += "?" + sp.query

    headers = []
    for line in lines[1:]:
        if not line.strip():
            continue
        if ":" in line:
            k, v = line.split(":", 1)
            headers.append((k.strip(), v.strip()))
    return method, path, headers, body


def decode_body(data, headers):
    """Descomprime `data` según el `Content-Encoding` de `headers` (si lo hay)."""
    enc = ""
    for k, v in headers:
        if k.lower() == "content-encoding":
            enc = v.lower()
            break
    try:
        if "gzip" in enc:
            return gzip.decompress(data)
        if "deflate" in enc:
            try:
                return zlib.decompress(data)
            except zlib.error:
                return zlib.decompress(data, -zlib.MAX_WBITS)
        if "br" in enc and _HAS_BROTLI:
            return brotli.decompress(data)
    except Exception:
        return data
    return data


def dechunk(data):
    """Decodifica un cuerpo con `Transfer-Encoding: chunked`."""
    out, i = b"", 0
    try:
        while i < len(data):
            j = data.find(b"\r\n", i)
            if j < 0:
                break
            size = int(data[i:j].split(b";")[0].strip() or b"0", 16)
            if size == 0:
                break
            start = j + 2
            out += data[start:start + size]
            i = start + size + 2
    except Exception:
        return data
    return out


def build_request_bytes(scheme, host, port, raw, update_cl):
    """Reconstruye la petición como bytes HTTP/1.1 listos para enviar por socket.

    Se usa en el envío en paralelo (last-byte synchronization), donde escribimos
    directamente sobre el socket en lugar de usar `http.client`.
    """
    method, path, headers, body = parse_raw_request(raw)
    body_bytes = body.encode("utf-8", "replace") if body else b""

    if update_cl and method.upper() not in ("GET", "HEAD") and body_bytes:
        headers = [(k, v) for (k, v) in headers if k.lower() != "content-length"]
        headers.append(("Content-Length", str(len(body_bytes))))

    if not any(k.lower() == "host" for k, _ in headers):
        default_port = (scheme == "https" and port == 443) or (scheme == "http" and port == 80)
        headers.insert(0, ("Host", host if default_port else "%s:%d" % (host, port)))

    lines = ["%s %s HTTP/1.1" % (method, path)]
    lines += ["%s: %s" % (k, v) for k, v in headers]
    head = ("\r\n".join(lines) + "\r\n\r\n").encode("utf-8", "replace")
    return head + body_bytes


def parse_response_bytes(resp_bytes):
    """Convierte los bytes crudos de una respuesta en un dict homogéneo.

    El dict resultante tiene la misma forma que el de `client.send_request`,
    para que la interfaz pueda tratar ambos igual.
    """
    sep = resp_bytes.find(b"\r\n\r\n")
    if sep < 0:
        head_b, body_b = resp_bytes, b""
    else:
        head_b, body_b = resp_bytes[:sep], resp_bytes[sep + 4:]

    head_text = head_b.decode("latin-1", "replace")
    lines = head_text.split("\r\n")
    m = re.match(r"^(\S+)\s+(\d{3})\s*(.*)$", lines[0] if lines else "")
    version = m.group(1) if m else "HTTP/1.1"
    status = int(m.group(2)) if m else 0
    reason = m.group(3) if m else ""

    headers = []
    for ln in lines[1:]:
        if ":" in ln:
            k, v = ln.split(":", 1)
            headers.append([k.strip(), v.strip()])

    if any(k.lower() == "transfer-encoding" and "chunked" in v.lower() for k, v in headers):
        body_b = dechunk(body_b)
    decoded = decode_body(body_b, [(k, v) for k, v in headers])
    body_text = decoded.decode("utf-8", "replace")

    raw_text = head_text + "\r\n\r\n" + body_text
    return {
        "ok": True, "status": status, "reason": reason, "version": version,
        "headers": headers, "body": body_text,
        "sizeBytes": len(resp_bytes), "raw": raw_text,
    }
