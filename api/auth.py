"""JWT auth and role gates. Three seeded roles, per the build plan."""

from datetime import UTC, datetime, timedelta

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.orm import Session

from config import settings
from db import get_db
from models import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)

# bcrypt hashes at most 72 bytes and raises above that, so truncate explicitly.
# (passlib would have handled this, but it has been unmaintained since 2020 and
# its backend probe crashes against bcrypt 5.x.)
_MAX = 72


def _encode(raw: str) -> bytes:
    return raw.encode("utf-8")[:_MAX]


def hash_password(raw: str) -> str:
    return bcrypt.hashpw(_encode(raw), bcrypt.gensalt()).decode("ascii")


def verify_password(raw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_encode(raw), hashed.encode("ascii"))
    except (ValueError, TypeError):
        return False


def create_access_token(user: User) -> str:
    expire = datetime.now(UTC) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {
        "sub": str(user.id),
        "username": user.username,
        "role": user.role,
        "mine_id": user.mine_id,
        "exp": expire,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def current_user(
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not token:
        raise unauthorized
    try:
        payload = jwt.decode(
            token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
        )
        user_id = int(payload["sub"])
    except (JWTError, KeyError, ValueError) as exc:
        raise unauthorized from exc

    user = db.scalar(select(User).where(User.id == user_id))
    if not user:
        raise unauthorized
    return user


def require_roles(*roles: str):
    """Gate an endpoint to specific roles."""

    def dependency(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"role '{user.role}' may not perform this action",
            )
        return user

    return dependency


def resolve_mine_id(user: User, requested: int | None) -> int:
    """Regulators may query any mine; everyone else is pinned to their own."""
    if user.role == "regulator":
        if requested is None:
            raise HTTPException(status_code=400, detail="mine_id is required")
        return requested
    if requested is not None and requested != user.mine_id:
        raise HTTPException(status_code=403, detail="not your mine")
    if user.mine_id is None:
        raise HTTPException(status_code=400, detail="user has no mine assigned")
    return user.mine_id
