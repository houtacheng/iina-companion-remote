#!/usr/bin/env python3
"""Minimal dependency-free smoke test for the IINA WebSocket plugin."""

import argparse
import base64
import json
import os
import plistlib
import socket
import struct
import time


def read_frame(sock):
    header = sock.recv(2)
    if len(header) != 2:
        raise RuntimeError("Connection closed")
    opcode = header[0] & 0x0F
    length = header[1] & 0x7F
    if length == 126:
        length = struct.unpack("!H", sock.recv(2))[0]
    elif length == 127:
        length = struct.unpack("!Q", sock.recv(8))[0]
    data = b""
    while len(data) < length:
        data += sock.recv(length - len(data))
    if opcode not in (1, 2):
        return None
    return json.loads(data.decode("utf-8"))


def send_json(sock, payload):
    data = json.dumps(payload, separators=(",", ":")).encode()
    mask = os.urandom(4)
    if len(data) < 126:
        header = bytes((0x81, 0x80 | len(data)))
    else:
        header = bytes((0x81, 0x80 | 126)) + struct.pack("!H", len(data))
    masked = bytes(byte ^ mask[index % 4] for index, byte in enumerate(data))
    sock.sendall(header + mask + masked)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="::1")
    parser.add_argument("--port", type=int, default=19190)
    parser.add_argument("--token")
    parser.add_argument("--preferences")
    parser.add_argument("--command")
    parser.add_argument("--library", action="store_true")
    args = parser.parse_args()

    token = args.token
    if not token and args.preferences:
        with open(args.preferences, "rb") as file:
            token = plistlib.load(file).get("token")
    if not token:
        raise SystemExit("Provide --token or --preferences")

    family = socket.AF_INET6 if ":" in args.host else socket.AF_INET
    sock = socket.socket(family, socket.SOCK_STREAM)
    sock.settimeout(4)
    sock.connect((args.host, args.port))
    key = base64.b64encode(os.urandom(16)).decode()
    request = (
        f"GET / HTTP/1.1\r\nHost: {args.host}:{args.port}\r\n"
        "Upgrade: websocket\r\nConnection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
    )
    sock.sendall(request.encode())
    response = b""
    while b"\r\n\r\n" not in response:
        response += sock.recv(4096)
    if b" 101 " not in response.split(b"\r\n", 1)[0]:
        raise RuntimeError(response.decode(errors="replace"))

    hello = read_frame(sock)
    print("hello:", hello and hello.get("type"))
    send_json(sock, {"type": "auth", "token": token, "requestId": "diagnose-auth"})
    deadline = time.time() + 4
    while time.time() < deadline:
        message = read_frame(sock)
        if not message:
            continue
        if message.get("type") == "auth_result":
            print("authenticated:", message.get("ok"))
            if args.library:
                send_json(sock, {"type": "refresh_library", "requestId": "diagnose-library"})
            elif args.command:
                send_json(sock, {"type": "command", "command": args.command, "args": {}, "requestId": "diagnose-command"})
            else:
                send_json(sock, {"type": "get_state", "requestId": "diagnose-state"})
        elif message.get("requestId") == "diagnose-library":
            print("folder:", message.get("folder"))
            print("files:", json.dumps(message.get("files") or [], ensure_ascii=False, indent=2))
            return
        elif message.get("requestId") in ("diagnose-state", "diagnose-command"):
            state = message.get("state") or {}
            print("result:", message.get("type"), message.get("ok", True))
            print("playback:", state.get("playback"))
            print("title:", state.get("title"))
            return
        elif message.get("type") == "error":
            raise RuntimeError(message.get("error"))
    raise RuntimeError("Timed out waiting for plugin response")


if __name__ == "__main__":
    main()
