from __future__ import annotations

import os
from typing import Optional

from cryptography.fernet import Fernet

from app.core.config import settings
from app.core.paths import data_dir


def _data_dir() -> str:
    return data_dir()


def _key_file_path() -> str:
    return os.path.join(_data_dir(), ".db_key")


def _load_or_create_key() -> bytes:
    env_key = (getattr(settings, "DB_ENCRYPTION_KEY", "") or "").strip()
    if env_key:
        try:
            return env_key.encode("utf-8")
        except Exception:
            return env_key.encode()

    path = _key_file_path()
    if os.path.exists(path):
        with open(path, "rb") as f:
            raw = f.read().strip()
            if raw:
                return raw

    key = Fernet.generate_key()
    with open(path, "wb") as f:
        f.write(key)
    return key


_FERNET: Optional[Fernet] = None


def get_fernet() -> Fernet:
    global _FERNET
    if _FERNET is None:
        key = _load_or_create_key()
        try:
            _FERNET = Fernet(key)
        except Exception as e:
            raise RuntimeError(f"DB_ENCRYPTION_KEY 无效或密钥文件损坏: {e}")
    return _FERNET


def encrypt_text(value: str) -> str:
    if value is None:
        return ""
    raw = str(value).encode("utf-8")
    token = get_fernet().encrypt(raw)
    return token.decode("utf-8")


def decrypt_text(token: str) -> str:
    if not token:
        return ""
    try:
        raw = get_fernet().decrypt(token.encode("utf-8"))
        return raw.decode("utf-8")
    except Exception as e:
        raise RuntimeError(f"连接密码解密失败，请检查 DB_ENCRYPTION_KEY: {e}")
