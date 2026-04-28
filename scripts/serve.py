#!/usr/bin/env python3
import argparse
import ipaddress
import json
import mimetypes
import os
import socket
import urllib.error
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path


MAX_SUBSCRIPTION_BYTES = 5 * 1024 * 1024
SUBSCRIPTION_TIMEOUT_SECONDS = 12
YIOVE_API_HOSTNAME = "shuyuan-api.yiove.com"
YIOVE_SITE_ORIGIN = "https://shuyuan.yiove.com"


def is_public_hostname(hostname: str) -> bool:
    try:
        addresses = socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)
    except socket.gaierror:
        return False

    for *_, sockaddr in addresses:
        ip = ipaddress.ip_address(sockaddr[0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            return False
    return True


def validate_subscription_url(raw_url: str) -> str:
    parsed = urllib.parse.urlparse(raw_url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("订阅地址必须是 http/https URL")
    if not parsed.hostname:
        raise ValueError("订阅地址缺少域名")
    if not is_public_hostname(parsed.hostname):
        raise ValueError("订阅地址域名不是公网地址")
    return urllib.parse.urlunparse(parsed)


def fetch_subscription_json(url: str) -> bytes:
    parsed = urllib.parse.urlparse(url)
    headers = {
        "Accept": "application/json, text/plain;q=0.9, */*;q=0.8",
        "User-Agent": "Mozilla/5.0 Legado-Web/1.0 SourceSubscription",
    }
    if parsed.hostname == YIOVE_API_HOSTNAME:
        headers.update(
            {
                "Origin": YIOVE_SITE_ORIGIN,
                "Referer": f"{YIOVE_SITE_ORIGIN}/",
            }
        )

    request = urllib.request.Request(
        url,
        headers=headers,
    )
    try:
        with urllib.request.urlopen(
            request,
            timeout=SUBSCRIPTION_TIMEOUT_SECONDS,
        ) as response:
            final_url = validate_subscription_url(response.geturl())
            if final_url != response.geturl():
                raise ValueError("订阅地址重定向到不支持的 URL")
            content = response.read(MAX_SUBSCRIPTION_BYTES + 1)
    except urllib.error.HTTPError as error:
        raise ValueError(f"订阅服务器返回 HTTP {error.code}") from error
    except urllib.error.URLError as error:
        raise ValueError(f"订阅服务器无法访问：{error.reason}") from error

    if len(content) > MAX_SUBSCRIPTION_BYTES:
        raise ValueError("订阅内容超过 5MB 限制")

    try:
        json.loads(content.decode("utf-8-sig"))
    except Exception as error:
        raise ValueError("订阅内容不是有效 JSON") from error
    return content


class LegadoWebHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/source-subscription":
            self.handle_source_subscription(parsed)
            return
        super().do_GET()

    def handle_source_subscription(self, parsed: urllib.parse.ParseResult) -> None:
        query = urllib.parse.parse_qs(parsed.query)
        raw_url = query.get("url", [""])[0]
        try:
            url = validate_subscription_url(raw_url)
            content = fetch_subscription_json(url)
        except ValueError as error:
            self.send_error(400, str(error))
            return

        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def translate_path(self, path: str) -> str:
        translated = super().translate_path(path)
        if os.path.exists(translated):
            return translated

        parsed = urllib.parse.urlparse(path)
        if "." not in Path(parsed.path).name:
            return str(Path(self.directory) / "index.html")
        return translated


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve Legado Web dist")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--directory", default="dist")
    args = parser.parse_args()

    mimetypes.add_type("application/javascript", ".js")
    mimetypes.add_type("text/css", ".css")
    handler = lambda *handler_args, **handler_kwargs: LegadoWebHandler(
        *handler_args,
        directory=args.directory,
        **handler_kwargs,
    )
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"Serving {args.directory} on http://{args.host}:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
