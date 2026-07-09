#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Repeater Clone — herramienta tipo "Burp Suite Repeater".

Edita peticiones HTTP crudas, reenvíalas y analiza la respuesta con resaltado
de sintaxis, historial, notas e Inspector. Incluye envío en paralelo con
last-byte synchronization para probar race conditions.

- Solo librería estándar de Python 3 (brotli es opcional).
- El backend hace el envío real (evita las restricciones de CORS del navegador).
- La interfaz es una página web local.

AVISO: úsalo solo contra sistemas para los que tengas autorización expresa.
"""

__version__ = "2.0.0"

from .client import send_request
from .parallel import send_group_parallel
from .server import run

__all__ = ["send_request", "send_group_parallel", "run", "__version__"]
