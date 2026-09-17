"""Local stand-in for the Vercel static deploy: serves public/ and applies the
single rewrite from vercel.json so "/" can be checked exactly as it will ship."""
import functools, http.server, json, os, socketserver

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "sanko-landing page", "public")
REWRITES = {r["source"]: r["destination"]
            for r in json.load(open(os.path.join(ROOT, "vercel.json"))).get("rewrites", [])}


class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        return super().translate_path(REWRITES.get(path.split("?")[0], path))


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("", 4175), functools.partial(Handler, directory=ROOT)) as httpd:
    print("serving public/ with vercel rewrites on http://localhost:4175")
    httpd.serve_forever()
