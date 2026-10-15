"""add user.xplan_access, seeded once from XPLAN_ALLOWED_USERS

Revision ID: a7c3e9d1f2b4
Revises: 461111b60977
Create Date: 2026-10-15 00:00:00.000000

axi: who may use XPLAN moves from the XPLAN_ALLOWED_USERS env list to a
per-user switch (Admin → Users). Seeded here, once, so nobody listed today
loses access; a later removal in the UI is never undone by a restart.
An empty or unset list seeds nobody (empty now means nobody, not everyone).
"""

import os
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'a7c3e9d1f2b4'
down_revision: Union[str, None] = '461111b60977'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _seed(conn, raw) -> None:
    emails = sorted({e.strip().lower() for e in (raw or '').split(',') if e.strip()})
    if not emails:
        return
    user = sa.table('user', sa.column('email', sa.String), sa.column('xplan_access', sa.Boolean))
    conn.execute(user.update().where(sa.func.lower(user.c.email).in_(emails)).values(xplan_access=True))


def upgrade() -> None:
    op.add_column('user', sa.Column('xplan_access', sa.Boolean(), nullable=False, server_default=sa.false()))
    _seed(op.get_bind(), os.environ.get('XPLAN_ALLOWED_USERS', ''))


def downgrade() -> None:
    op.drop_column('user', 'xplan_access')
