# Repeater Clone

Herramienta tipo **Burp Suite Repeater**: edita peticiones HTTP crudas,
reenvíalas y analiza la respuesta con resaltado de sintaxis, historial, notas e
Inspector. Incluye envío en paralelo con *last-byte synchronization* para probar
race conditions.

- Solo librería estándar de Python 3 (`brotli` es opcional).
- El backend hace el envío real, evitando las restricciones de CORS del navegador.
- La interfaz es una página web local servida en `http://127.0.0.1:8777`.

> **Aviso:** no me hago responsable de su uso

## Uso

```bash
python run.py                 # puerto 8777, abre el navegador
python run.py 9000            # otro puerto
python run.py --no-browser    # no abrir el navegador
python run.py --help          # todas las opciones

# equivalente:
python -m repeater
```

Requiere Python 3.7 o superior. Sin dependencias externas obligatorias. Para
descomprimir respuestas con `Content-Encoding: br` puedes instalar Brotli
opcionalmente:

```bash
pip install brotli
```

## Estructura

Antes todo vivía en un único archivo. Ahora está separado en un paquete Python
y los assets web como archivos independientes:

```
repeater_clone/
├── run.py                  # lanzador delgado (python run.py)
├── README.md
├── .gitignore
└── repeater/               # paquete
    ├── __init__.py         # API pública + versión
    ├── __main__.py         # CLI (python -m repeater)
    ├── raw_http.py         # parseo/decodificación de HTTP crudo
    ├── client.py           # envío de una petición (con redirecciones)
    ├── parallel.py         # envío en paralelo (race conditions)
    ├── server.py           # servidor local + servido de estáticos + API
    └── web/                # interfaz (antes embebida como string)
        ├── index.html
        ├── style.css
        └── app.js
```

### Responsabilidad de cada módulo

| Módulo | Contenido |
|--------|-----------|
| `raw_http.py` | Parsear peticiones crudas, (des)comprimir cuerpos, `chunked`, reconstruir bytes y parsear respuestas. Contexto TLS. |
| `client.py` | `send_request()`: una petición con `http.client`, opcionalmente siguiendo redirecciones. |
| `parallel.py` | `send_group_parallel()`: N peticiones sincronizadas soltando el último byte a la vez. |
| `server.py` | Servidor `ThreadingHTTPServer`, servido de `web/` y endpoints `/api/send` y `/api/send_group`. |

## API interna

```python
from repeater import send_request, send_group_parallel, run

# enviar una petición
send_request({"scheme": "https", "host": "example.com",
              "request": "GET / HTTP/1.1\nHost: example.com\n\n"})

# arrancar el servidor desde código
run(host="127.0.0.1", port=8777, open_browser=False)
```

## Cambios respecto a la versión de un solo archivo

- **Separado en varios archivos y carpetas** (paquete Python + `web/`), en lugar
  de todo el HTML/CSS/JS embebido como string.
- **La interfaz se sirve desde disco** (`web/`) con tipos MIME correctos y
  protección contra *path traversal*; las rutas resuelven relativas al paquete,
  así funciona desde cualquier directorio.
- **Contexto TLS con API pública** (`create_default_context` + `CERT_NONE`) en
  lugar de la privada `ssl._create_unverified_context()`.
- **Lectura de respuestas `chunked` más robusta**: espera al chunk terminador
  real en vez de una heurística frágil sobre el último byte.
- **CLI con `argparse`**: `--host`, `--no-browser`, `--version`, `--help`.
- **Brotli opcional** y detectado en tiempo de import (antes fallaba en silencio).
- **Corrección de UI**: el nombre por defecto de una pestaña ya no se desalinea
  respecto a su `id`.
- **Cierre limpio del servidor** (`shutdown` + `server_close`) al parar.
