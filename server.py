# Local dev server for machines without Ruby: `python server.py [port]` (default 5173).
# Same as server.rb: serves this folder and tells the browser to re-check every
# file on each load, so edits never hide behind the browser cache.
import functools
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, *args):
        pass


port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
handler = functools.partial(NoCacheHandler, directory=os.path.dirname(os.path.abspath(__file__)))
with http.server.ThreadingHTTPServer(('', port), handler) as server:
    print(f'Scoreboard on http://localhost:{port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
