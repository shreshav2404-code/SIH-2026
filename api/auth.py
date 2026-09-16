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


# Every named demo account may write. The three roles are kept as DESIGNATIONS
# - the job title the person holds and the dashboard shows - but none of them
# is a permission ceiling here, because five teammates share one mine's
# register during a demo and nobody wants to swap logins mid-answer.
#
# This is a demo posture, not the production one. In the field the split is
# real and statutory: a regulator inspects a register, they do not edit it, and
# under the Mines Act the certificated manager is the accountable signatory.
# Narrowing back is a one-line change - drop "regulator" from this tuple and
# the five endpoints that use it refuse her again.
#
# What is NOT relaxed: the hash chain, the threshold arithmetic, the boundary
# checks, and the rule that a NAMED PERSON signs a return. Widening who may act
# does not widen what the system will believe.
DEMO_WRITERS = ("mine_manager", "safety_officer", "regulator")


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
    """Regulators may query any mine; everyone else is pinned to their own.

    A regulator normally has no mine of their own, so naming one is required.
    If a regulator HAS been given a home mine - nisarga has, so the whole team
    works one register - that mine is the default and they can still name any
    other.
    """
    if user.role == "regulator":
        if requested is None:
            if user.mine_id is None:
                raise HTTPException(status_code=400, detail="mine_id is required")
            return user.mine_id
        return requested
    if requested is not None and requested != user.mine_id:
        raise HTTPException(status_code=403, detail="not your mine")
    if user.mine_id is None:
        raise HTTPException(status_code=400, detail="user has no mine assigned")
    return user.mine_id
