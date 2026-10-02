#!/usr/bin/env python3
"""Create a URL-safe runtime DB password in the private personal env file."""
from __future__ import annotations

import os
import re
import secrets
import stat
import sys
import tempfile
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: ensure-personal-runtime-db-secret.py <private-env-file>")
    env_path = Path(sys.argv[1])
    if env_path.is_symlink() or not env_path.is_file():
        raise SystemExit("Personal env file must be a regular non-symlink file.")
    mode = stat.S_IMODE(env_path.stat().st_mode)
    if mode & 0o077:
        raise SystemExit("Personal env file permissions must be 0600 or stricter.")

    content = env_path.read_text(encoding="utf-8")
    match = re.search(r"^APP_DB_PASSWORD=(.*)$", content, re.MULTILINE)
    if match and match.group(1):
        if not re.fullmatch(r"[a-f0-9]{64}", match.group(1)):
            raise SystemExit("APP_DB_PASSWORD must be exactly 64 lowercase hex characters.")
        return 0

    password = secrets.token_hex(32)
    if match:
        content = content[:match.start(1)] + password + content[match.end(1):]
    else:
        content += ("" if content.endswith("\n") else "\n") + f"APP_DB_PASSWORD={password}\n"

    fd, tmp_name = tempfile.mkstemp(prefix=".env.personal.", dir=env_path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as tmp:
            tmp.write(content)
            tmp.flush()
            os.fsync(tmp.fileno())
        os.replace(tmp_name, env_path)
        dir_fd = os.open(env_path.parent, os.O_RDONLY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)
    print("Generated a private runtime database credential in .env.personal.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
