#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Lanzador de Repeater Clone.

    python run.py            # puerto 8777, abre el navegador
    python run.py 9000       # otro puerto
    python run.py --no-browser
    python run.py --help

Equivalente a `python -m repeater`.
"""

from repeater.__main__ import main

if __name__ == "__main__":
    raise SystemExit(main())
