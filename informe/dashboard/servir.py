"""
Sirve el dashboard en http://localhost:8765 para verlo fuera de claude.ai.

index.html está escrito como contenido de página (sin <!doctype>/<head>), igual que se publica
como Artifact; este servidor le agrega el esqueleto de documento para que el navegador lo
muestre igual. Fuera de claude.ai las notas se guardan en el navegador y se exportan desde
"Fuentes y método".

Uso:
    python informe/dashboard/servir.py
"""

import http.server
import socketserver
from pathlib import Path

CARPETA = Path(__file__).resolve().parent
PUERTO = 8765
ESQUELETO = (
    "<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\">"
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">"
    "<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}"
    "body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>"
    "</head><body>{contenido}</body></html>"
)


class Manejador(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(CARPETA), **kwargs)

    def do_GET(self):
        if self.path.split("?")[0] in ("/", "/index.html"):
            html = ESQUELETO.replace("{contenido}", (CARPETA / "index.html").read_text(encoding="utf-8")).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(html)))
            self.end_headers()
            self.wfile.write(html)
            return
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    socketserver.ThreadingTCPServer.daemon_threads = True
    with socketserver.ThreadingTCPServer(("127.0.0.1", PUERTO), Manejador) as srv:
        print(f"Pulso Bancario GT en http://localhost:{PUERTO}  (Ctrl+C para detener)")
        srv.serve_forever()
