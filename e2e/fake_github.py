"""A programmable stand-in for api.github.com's REST surface, plus an alert receiver.

The server under test is pointed at it through GITHUB_API_URL with no token, so its
*real* live resolver (unauthenticated REST: repository, pulls, languages, commits and
`.city` rule files) runs end to end without a GitHub credential. Tests flip `mode` to
rehearse an outage (503), an exhausted quota (403 with a rate-limit body) and a
repository turning private, and read back what the city posted to CITY_ALERT_URL.
"""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse


def repo_json(full_name, **overrides):
    owner, name = full_name.split("/")
    row = dict(
        id=abs(hash(full_name)) % 10_000_000 + 1000,
        full_name=full_name,
        html_url=f"https://github.com/{full_name}",
        description=f"{name} by {owner}",
        private=False,
        stargazers_count=100,
        forks_count=4,
        size=2048,
        language="TypeScript",
        open_issues_count=7,  # issues + open PRs, as GitHub reports it
        pushed_at="2026-09-16T10:00:00Z",
        updated_at="2026-09-16T10:00:00Z",
        default_branch="main",
        pulls=[dict(user=dict(login="alice", type="User")), dict(user=dict(login="bob", type="User"))],
        languages={"TypeScript": 90000, "CSS": 4000},
        commits=[dict(author=dict(login="alice", type="User"), commit=dict(author=dict(name="Alice", date="2026-09-15T09:00:00Z")))],
        rules={},  # .city/<file> -> parsed JSON body; anything else is 404
    )
    row.update(overrides)
    return row


class FakeGitHub:
    def __init__(self):
        self.repos = {}
        self.mode = "ok"  # ok | outage | ratelimit
        self.requests = []
        self.alerts = []
        self.lock = threading.Lock()
        fake = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *_):
                pass

            def _send(self, status, body, content_type="application/json", headers=()):
                data = body if isinstance(body, bytes) else json.dumps(body).encode()
                self.send_response(status)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(data)))
                self.send_header("X-RateLimit-Remaining", "0" if fake.mode == "ratelimit" else "57")
                for k, v in headers:
                    self.send_header(k, v)
                self.end_headers()
                self.wfile.write(data)

            def do_POST(self):
                length = int(self.headers.get("Content-Length") or 0)
                payload = json.loads(self.rfile.read(length) or b"{}")
                path = urlparse(self.path).path
                with fake.lock:
                    fake.requests.append(("POST", path))
                    if path == "/alerts":
                        fake.alerts.append(payload)
                        self._send(200, dict(ok=True))
                        return
                self._send(404, dict(message="Not Found"))

            def do_GET(self):
                url = urlparse(self.path)
                parts = url.path.strip("/").split("/")
                with fake.lock:
                    fake.requests.append(("GET", url.path))
                    mode = fake.mode
                if mode == "outage":
                    self._send(503, dict(message="Service Unavailable"))
                    return
                if mode == "ratelimit":
                    self._send(403, dict(message="API rate limit exceeded for 127.0.0.1."))
                    return
                if len(parts) < 3 or parts[0] != "repos":
                    self._send(404, dict(message="Not Found"))
                    return
                full_name = f"{parts[1]}/{parts[2]}"
                with fake.lock:
                    repo = fake.repos.get(full_name.lower())
                if repo is None or repo.get("deleted"):
                    self._send(404, dict(message="Not Found"))
                    return
                if repo.get("forbidden"):
                    # Authorization lost (installation removed, token scope revoked): a 403
                    # that is not about quota.
                    self._send(403, dict(message="Resource not accessible by integration"))
                    return
                rest = parts[3:]
                if not rest:
                    body = {k: v for k, v in repo.items() if k not in ("pulls", "languages", "commits", "rules", "deleted", "forbidden")}
                    self._send(200, body)
                elif rest == ["pulls"]:
                    self._send(200, repo["pulls"])
                elif rest == ["languages"]:
                    self._send(200, repo["languages"])
                elif rest == ["commits"]:
                    self._send(200, repo["commits"])
                elif rest[:2] == ["contents", ".city"] and len(rest) == 3:
                    body = repo["rules"].get(rest[2])
                    if body is None:
                        self._send(404, dict(message="Not Found"))
                    else:
                        self._send(200, json.dumps(body).encode(), content_type="application/vnd.github.raw+json")
                else:
                    self._send(404, dict(message="Not Found"))

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.httpd.daemon_threads = True
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def add(self, full_name, **overrides):
        with self.lock:
            self.repos[full_name.lower()] = repo_json(full_name, **overrides)
        return self.repos[full_name.lower()]

    def set(self, full_name, **fields):
        with self.lock:
            self.repos[full_name.lower()].update(fields)

    def hits(self, path_prefix, method="GET"):
        with self.lock:
            return [p for m, p in self.requests if m == method and p.startswith(path_prefix)]

    def alert_kinds(self):
        with self.lock:
            return [a["kind"] for a in self.alerts]

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()
