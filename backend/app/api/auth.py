"""Authentication endpoints — JWT login, me, and role routing.

Login validates credentials against the local SQLite users table and returns
a signed JWT carrying the `sub` (user email/id), `name` and `role`

Roles: `student`, `admin`. Self-registrations start as `pending` and require
admin approval. Only `admin` may access the `/api/v1/admin/*` endpoints
(guarded by `require_admin`).
"""
from __future__ import annotations

import threading
import time

from pydantic import BaseModel, EmailStr, Field
from fastapi import APIRouter, Depends, HTTPException, status

from ..core.config import settings
from ..core.db import get_db
from ..core.security import (
    create_access_token,
    get_current_user,
    require_admin,
    verify_password,
)

router = APIRouter(prefix="/api/v1", tags=["auth"])


# ---------------------------------------------------------------------------
# Password-attempt limiter (brute-force guard for verify/change endpoints)
# ---------------------------------------------------------------------------
# In-memory per-email attempt tracking; fine for single-node SQLite deployment.
_MAX_ATTEMPTS = 5
_WINDOW_SECONDS = 60
_LOCK = threading.Lock()
_ATTEMPTS: dict[str, list[float]] = {}


def _check_attempts(email: str) -> None:
    """Raise 429 if the email has too many recent failed attempts."""
    now = time.monotonic()
    with _LOCK:
        ts = [t for t in _ATTEMPTS.get(email, []) if now - t < _WINDOW_SECONDS]
        if len(ts) >= _MAX_ATTEMPTS:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many attempts. Please wait a minute and try again.",
            )
        _ATTEMPTS[email] = ts


def _record_failed(email: str) -> None:
    now = time.monotonic()
    with _LOCK:
        _ATTEMPTS.setdefault(email, []).append(now)


def _record_success(email: str) -> None:
    with _LOCK:
        _ATTEMPTS.pop(email, None)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    name: str
    email: str


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    name: str = Field(min_length=1, max_length=128)


class MeResponse(BaseModel):
    email: str
    name: str
    role: str


class UserOut(BaseModel):
    id: int
    email: str
    name: str | None
    role: str


class ApproveRejectRequest(BaseModel):
    user_id: int


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=6, max_length=128)


class VerifyPasswordRequest(BaseModel):
    password: str = Field(min_length=1, max_length=128)


class AdminResetPasswordRequest(BaseModel):
    new_password: str = Field(min_length=6, max_length=128)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.post("/register", response_model=LoginResponse, status_code=status.HTTP_201_CREATED)
def register(req: RegisterRequest) -> LoginResponse:
    db = get_db()
    existing = db.get_user_by_email(req.email)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists",
        )
    if db.get_user_by_name(req.name):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That name is already in use. Please choose a different one.",
        )
    user = db.create_user(email=req.email, password=req.password, name=req.name, role="pending")
    token = create_access_token(
        sub=str(user["email"]),
        role=user["role"],
        name=user.get("name") or user["email"],
    )
    return LoginResponse(
        access_token=token,
        role=user["role"],
        name=user.get("name") or user["email"],
        email=user["email"],
    )
@router.post("/login", response_model=LoginResponse)
def login(req: LoginRequest) -> LoginResponse:
    """Authenticate the user and return a JWT."""
    db = get_db()
    user = db.get_user_by_email(req.email)
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )
    if user["role"] == "pending":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is pending admin approval",
        )
    token = create_access_token(
        sub=str(user["email"]),  # email as primary subject identifier
        role=user["role"],
        name=user.get("name") or user["email"],
    )
    return LoginResponse(
        access_token=token,
        role=user["role"],
        name=user.get("name") or user["email"],
        email=user["email"],
    )


@router.get("/me", response_model=MeResponse)
def me(user: dict = Depends(get_current_user)) -> MeResponse:
    """Return the currently authenticated user's profile."""
    return MeResponse(
        email=user.get("sub", ""),
        name=user.get("name", ""),
        role=user.get("role", "student"),
    )


# ---------------------------------------------------------------------------
# Admin user management (admin only)
# ---------------------------------------------------------------------------
@router.get("/admin/users", response_model=list[UserOut])
def list_users(user: dict = require_admin) -> list[UserOut]:
    db = get_db()
    users = db.list_users()
    return [UserOut(id=u["id"], email=u["email"], name=u.get("name"), role=u["role"]) for u in users]


@router.post("/admin/users/{user_id}/approve", response_model=UserOut)
def approve_user(user_id: int, user: dict = require_admin) -> UserOut:
    db = get_db()
    updated = db.update_user_role(user_id, "student")
    if not updated:
        raise HTTPException(status_code=404, detail="User not found")
    return UserOut(id=updated["id"], email=updated["email"], name=updated.get("name"), role=updated["role"])


@router.post("/admin/users/{user_id}/reject")
def reject_user(user_id: int, user: dict = require_admin) -> dict:
    db = get_db()
    deleted = db.delete_user(user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "User rejected and removed"}


# ---------------------------------------------------------------------------
# Password management
# ---------------------------------------------------------------------------
@router.post("/me/password")
def change_own_password(
    req: ChangePasswordRequest,
    user: dict = Depends(get_current_user),
) -> dict:
    """Let the logged-in user change their own password (verifies current).

    Returns 400 (not 401) when the current password is wrong, so the client
    can distinguish an invalid token from a bad current password and show the
    right message without logging the user out.
    """
    db = get_db()
    email = user.get("sub", "")
    _check_attempts(email)
    me = db.get_user_by_email(email)
    if not me or not verify_password(req.current_password, me["password_hash"]):
        _record_failed(email)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )
    _record_success(email)
    db.update_user_password(me["id"], req.new_password)
    return {"message": "Password updated successfully"}


@router.post("/me/verify-password")
def verify_own_password(
    req: VerifyPasswordRequest,
    user: dict = Depends(get_current_user),
) -> dict:
    """Verify the caller's current password. Never 401s on a wrong password —
    always 200 with `valid: false`, so the token/logout logic stays untouched.
    Used by the two-step change-password dialog.
    """
    db = get_db()
    email = user.get("sub", "")
    _check_attempts(email)
    me = db.get_user_by_email(email)
    ok = bool(me) and verify_password(req.password, me["password_hash"])
    if not ok:
        _record_failed(email)
    else:
        _record_success(email)
    return {"valid": ok}


@router.post("/admin/users/{user_id}/password")
def admin_reset_password(
    user_id: int,
    req: AdminResetPasswordRequest,
    user: dict = require_admin,
) -> dict:
    """Admin forcibly resets another user's password (no current password needed)."""
    db = get_db()
    target = db.get_user_by_id(user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    db.update_user_password(user_id, req.new_password)
    return {"message": f"Password reset for {target['email']}"}

