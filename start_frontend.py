"""Lance le site Aura en local sans dépendance externe (Python 3.9+)."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from functools import partial
from threading import Timer
import webbrowser

ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT / "frontend"
PORT = 5500

if not (FRONTEND / "index.html").exists():
    raise SystemExit("ERREUR : le dossier frontend/ est introuvable. Vérifiez l'extraction du ZIP.")

class AuraHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

try:
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), partial(AuraHandler, directory=str(FRONTEND)))
except OSError as e:
    raise SystemExit(f"Impossible de démarrer sur le port {PORT}. Fermez l'ancien serveur Aura. ({e})")

print("\n" + "=" * 55)
print("  AURA — SITE WEB")
print(f"  http://127.0.0.1:{PORT}")
print("  Gardez cette fenêtre ouverte pendant la démonstration.")
print("  Ctrl+C pour arrêter le site.")
print("=" * 55 + "\n")
Timer(1.0, lambda: webbrowser.open(f"http://127.0.0.1:{PORT}/")).start()
try:
    httpd.serve_forever()
except KeyboardInterrupt:
    print("\nFermeture du site Aura.")
finally:
    httpd.server_close()
