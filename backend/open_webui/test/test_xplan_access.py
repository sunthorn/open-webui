"""XPLAN access switch (spec 2026-10-15). Real app, throwaway SQLite.

    cd backend && DATABASE_URL=sqlite:////tmp/owx/webui.db DATA_DIR=/tmp/owx \
        VECTOR_DB=chroma python -m pytest open_webui/test/test_xplan_access.py
"""

import asyncio
import importlib.util
import os
import pathlib
import tempfile
from types import SimpleNamespace

import pytest

_tmp = tempfile.mkdtemp(prefix='owui-xplan-')
os.environ.setdefault('DATA_DIR', _tmp)
os.environ.setdefault('DATABASE_URL', f'sqlite:///{_tmp}/webui.db')
os.environ.setdefault('VECTOR_DB', 'chroma')

if not os.environ['DATABASE_URL'].startswith('sqlite'):
    pytest.skip('refusing to run against a non-SQLite database', allow_module_level=True)

import sqlalchemy as sa  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from open_webui.main import app  # noqa: E402
from open_webui.models.users import Users  # noqa: E402
from open_webui.utils.headers import get_custom_headers  # noqa: E402

ADMIN = {'name': 'Admin', 'email': 'xadmin@example.com', 'password': 'AdminPassw0rd'}
PASSWORD = 'Abcdefgh2345'
MIGRATION = pathlib.Path(__file__).parents[1] / 'migrations' / 'versions' / 'a7c3e9d1f2b4_add_user_xplan_access.py'


def _auth(token):
    return {'Authorization': f'Bearer {token}'}


def _flag(user_id):
    return asyncio.run(Users.get_user_by_id(user_id)).xplan_access


@pytest.fixture(scope='module')
def client():
    return TestClient(app)


@pytest.fixture(scope='module')
def admin_token(client):
    r = client.post('/api/v1/auths/signup', json=ADMIN)
    if r.status_code != 200:
        r = client.post('/api/v1/auths/signin', json={'email': ADMIN['email'], 'password': ADMIN['password']})
    assert r.status_code == 200, r.text
    assert r.json()['role'] == 'admin'
    return r.json()['token']


def _add_user(client, admin_token, email):
    r = client.post('/api/v1/auths/add', headers=_auth(admin_token),
                    json={'name': email.split('@')[0], 'email': email, 'password': PASSWORD, 'role': 'user'})
    assert r.status_code == 200, r.text
    return r.json()['id']


def _update(client, token, user_id, **fields):
    user = asyncio.run(Users.get_user_by_id(user_id))
    body = {'role': user.role, 'name': user.name, 'email': user.email, 'profile_image_url': user.profile_image_url, **fields}
    return client.post(f'/api/v1/users/{user_id}/update', headers=_auth(token), json=body)


def test_new_users_and_admins_start_without_access(client, admin_token):
    uid = _add_user(client, admin_token, 'fresh@example.com')
    assert _flag(uid) is False
    me = client.get('/api/v1/auths/', headers=_auth(admin_token)).json()
    assert me['xplan_access'] is False


def test_admin_switches_it_on_and_off(client, admin_token):
    uid = _add_user(client, admin_token, 'toggle@example.com')
    assert _update(client, admin_token, uid, xplan_access=True).status_code == 200
    assert _flag(uid) is True
    assert _update(client, admin_token, uid, xplan_access=False).status_code == 200
    assert _flag(uid) is False


def test_editing_without_the_field_leaves_it_alone(client, admin_token):
    uid = _add_user(client, admin_token, 'rename@example.com')
    _update(client, admin_token, uid, xplan_access=True)
    r = _update(client, admin_token, uid, name='Renamed')
    assert r.status_code == 200, r.text
    assert _flag(uid) is True


def test_a_user_cannot_grant_it_to_themselves(client, admin_token):
    uid = _add_user(client, admin_token, 'self@example.com')
    # An admin-added user must change their password first; the admin sets
    # it themselves here, which does not flag them.
    asyncio.run(Users.set_must_change_password_by_id(uid, False))
    token = client.post('/api/v1/auths/signin', json={'email': 'self@example.com', 'password': PASSWORD}).json()['token']
    client.post('/api/v1/users/user/info/update', headers=_auth(token), json={'xplan_access': True})
    assert _update(client, token, uid, xplan_access=True).status_code in (401, 403)
    assert _flag(uid) is False


def test_session_reports_the_flag(client, admin_token):
    uid = _add_user(client, admin_token, 'session@example.com')
    asyncio.run(Users.set_must_change_password_by_id(uid, False))
    _update(client, admin_token, uid, xplan_access=True)
    signin = client.post('/api/v1/auths/signin', json={'email': 'session@example.com', 'password': PASSWORD}).json()
    assert signin['xplan_access'] is True
    assert client.get('/api/v1/auths/', headers=_auth(signin['token'])).json()['xplan_access'] is True


def test_user_xplan_header_template():
    h = {'X-Axi-Agent-Xplan': '{{USER_XPLAN}}'}
    assert get_custom_headers(h, SimpleNamespace(id='u', name='n', email='e', role='user', xplan_access=True)) == {'X-Axi-Agent-Xplan': '1'}
    assert get_custom_headers(h, SimpleNamespace(id='u', name='n', email='e', role='user', xplan_access=False)) == {'X-Axi-Agent-Xplan': ''}
    assert get_custom_headers(h, None) == {'X-Axi-Agent-Xplan': ''}


def _migration():
    spec = importlib.util.spec_from_file_location('xplan_migration', MIGRATION)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.mark.parametrize('raw,expected', [
    (' A@x.com, ,b@Y.com ,', {'a@x.com': True, 'b@y.com': True, 'c@x.com': False}),
    ('', {'a@x.com': False, 'b@y.com': False, 'c@x.com': False}),
    (None, {'a@x.com': False, 'b@y.com': False, 'c@x.com': False}),
])
def test_migration_seeds_from_the_env_list(raw, expected):
    engine = sa.create_engine('sqlite://')
    with engine.begin() as conn:
        conn.execute(sa.text('CREATE TABLE "user" (email TEXT, xplan_access BOOLEAN NOT NULL DEFAULT 0)'))
        for e in ('A@x.com', 'b@y.com', 'c@x.com'):
            conn.execute(sa.text('INSERT INTO "user" (email) VALUES (:e)'), {'e': e})
        _migration()._seed(conn, raw)
        got = {r[0].lower(): bool(r[1]) for r in conn.execute(sa.text('SELECT email, xplan_access FROM "user"'))}
    assert got == expected
