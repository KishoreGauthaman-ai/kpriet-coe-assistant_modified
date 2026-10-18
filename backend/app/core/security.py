"""Security primitives: prompt sanitization, JWT, password hashing & RBAC.

No external HTTP calls — everything here runs in-process.
"""
from __future__ import annotations

import re
import time
import uuid
from typing import Any

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from passlib.context import CryptContext

from .config import settings


# ---------------------------------------------------------------------------
# Password hashing (bcrypt via passlib)
# ---------------------------------------------------------------------------
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return pwd_context.verify(plain, hashed)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# JWT issuance & decoding
# ---------------------------------------------------------------------------
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/login", auto_error=False)


def create_access_token(
    *, sub: str, role: str, name: str | None = None
) -> str:
    """Create a signed JWT carrying the user id, role and display name."""
    now = int(time.time())
    payload: dict[str, Any] = {
        "sub": sub,
        "role": role,
        "name": name or sub,
        "iat": now,
        "exp": now + settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict[str, Any]:
    """Decode & validate a JWT. Raises HTTPException(401) on failure."""
    try:
        return jwt.decode(
            token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM]
        )
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


# ---------------------------------------------------------------------------
# FastAPI dependencies for RBAC
# ---------------------------------------------------------------------------
async def get_current_user(token: str | None = Depends(oauth2_scheme)) -> dict[str, Any]:
    """Resolve the bearer token → current user payload {sub, role, name}.

    The role/name are read fresh from the database on every request rather than
    trusting the JWT claim verbatim, so admin approval (pending → student) takes
    effect for an already-issued token without requiring a re-login. Returns 401
    if the token is missing/invalid or the account no longer exists.
    """
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_token(token)
    # Lazy import to avoid a circular import: core.db imports core.security.
    from .db import get_db  # noqa: PLC0415

    db = get_db()
    user = db.get_user_by_email(str(payload.get("sub", "")))
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account no longer exists",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return {
        "sub": user["email"],
        "role": user["role"],
        "name": user.get("name") or user["email"],
    }


def require_role(*allowed_roles: str):
    """Dependency factory: allow only users whose `role` is in allowed_roles."""

    async def _checker(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
        if user.get("role") not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{user.get('role')}' is not permitted for this resource",
            )
        return user

    return _checker


def require_active(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    """Reject accounts that are still pending admin approval.

    Guards end-user features (chat, voice) so pending users cannot use the
    assistant until an admin approves them.
    """
    if user.get("role") == "pending":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is pending admin approval",
        )
    return user


# Convenience: any authenticated user
require_authenticated = Depends(get_current_user)
# Convenience: admin-only
require_admin = Depends(require_role("admin"))
# Convenience: any approved (non-pending) user
require_approved = Depends(require_active)


# ---------------------------------------------------------------------------
# Prompt sanitization — strip prompt-injection vectors before they reach any model
# ---------------------------------------------------------------------------
# Pre-compile a single scanner; the banned tokens list drives it.
_TOKEN_ALTS: dict[str, re.Pattern[str]] = {
    tok: re.compile(re.escape(tok), re.IGNORECASE) for tok in settings.BANNED_TOKENS
}


def sanitize_prompt(text: str | None) -> str:
    """Remove banned control tokens and clip absurd lengths.

    Returns a clean string. Never raises.
    """
    if not text:
        return ""
    cleaned = text
    for pattern in _TOKEN_ALTS.values():
        cleaned = pattern.sub("", cleaned)
    # Collapse runs of whitespace introduced by removals
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()
    # Hard ceiling on input characters (defensive; token cap enforced server-side too)
    max_chars = settings.MAX_TOKENS * 8  # ~8 chars/token conservative
    if len(cleaned) > max_chars:
        cleaned = cleaned[:max_chars]
    return cleaned
