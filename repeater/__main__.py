#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Punto de entrada del paquete: `python -m repeater [opciones]`.
"""

import sys
import argparse

from . import __version__
from .server import run, DEFAULT_HOST, DEFAULT_PORT


def build_parser():
    p = argparse.ArgumentParser(
        prog="repeater",
        description="Repeater Clone — cliente HTTP manual estilo Burp Repeater.",
    )
    p.add_argument("port", nargs="?", type=int, default=DEFAULT_PORT,
                   help="Puerto de escucha (por defecto %d)." % DEFAULT_PORT)
    p.add_argument("--host", default=DEFAULT_HOST,
                   help="Interfaz de escucha (por defecto %s; usar 0.0.0.0 la "
                        "expone a la red, no recomendado)." % DEFAULT_HOST)
    p.add_argument("--no-browser", action="store_true",
                   help="No abrir el navegador automáticamente.")
    p.add_argument("--version", action="version",
                   version="Repeater Clone %s" % __version__)
    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        run(host=args.host, port=args.port, open_browser=not args.no_browser)
    except OSError as exc:
        print("No se pudo arrancar en %s:%d — %s" % (args.host, args.port, exc),
              file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
