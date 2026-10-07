"""Forced password change for admin-created users.

Runs the real FastAPI app against a throwaway SQLite database. The module
refuses to run against any non-SQLite DATABASE_URL so it can never touch a
live database.

    cd backend && DATABASE_URL=sqlite:////tmp/owt/webui.db DATA_DIR=/tmp/owt \
        VECTOR_DB=chroma python -m pytest open_webui/test/test_password_change_required.py
"""

import os
import tempfile

import pytest

_tmp = tempfile.mkdtemp(prefix='owui-pwchange-')
os.environ.setdefault('DATA_DIR', _tmp)
os.environ.setdefault('DATABASE_URL', f'sqlite:///{_tmp}/webui.db')
os.environ.setdefault('VECTOR_DB', 'chroma')

if not os.environ['DATABASE_URL'].startswith('sqlite'):
    pytest.skip('refusing to run against a non-SQLite database', allow_module_level=True)

from fastapi.testclient import TestClient  # noqa: E402

from open_webui.main import app  # noqa: E402
from open_webui.models.auths import Auths  # noqa: E402
from open_webui.models.users import Users  # noqa: E402

import asyncio  # noqa: E402

ADMIN = {'name': 'Admin', 'email': 'admin@example.com', 'password': 'AdminPassw0rd'}
INITIAL_PASSWORD = 'Abcdefgh2345'
NEW_PASSWORD = 'Zyxwvuts9876'
DETAIL = 'PASSWORD_CHANGE_REQUIRED'


def _run(coro):
    return asyncio.run(coro)


def _info(user_id):
    user = _run(Users.get_user_by_id(user_id))
    return user.info or {}


def _auth(token):
    return {'Authorization': f'Bearer {token}'}


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


def _add_user(client, admin_token, email, password=INITIAL_PASSWORD):
    r = client.post(
        '/api/v1/auths/add',
        headers=_auth(admin_token),
        json={'name': email.split('@')[0], 'email': email, 'password': password, 'role': 'user'},
    )
    assert r.status_code == 200, r.text
    return r.json()['id']


def _signin(client, email, password=INITIAL_PASSWORD):
    r = client.post('/api/v1/auths/signin', json={'email': email, 'password': password})
    assert r.status_code == 200, r.text
    return r.json()


def test_admin_is_not_flagged(client, admin_token):
    r = client.get('/api/v1/users/user/settings', headers=_auth(admin_token))
    assert r.status_code == 200, r.text


def test_admin_add_user_sets_flag(client, admin_token):
    user_id = _add_user(client, admin_token, 'added@example.com')
    assert _info(user_id).get('must_change_password') is True


def test_signin_and_session_report_flag(client, admin_token):
    _add_user(client, admin_token, 'session@example.com')
    signin = _signin(client, 'session@example.com')
    assert signin['must_change_password'] is True

    r = client.get('/api/v1/auths/', headers=_auth(signin['token']))
    assert r.status_code == 200, r.text
    assert r.json()['must_change_password'] is True


def test_flagged_user_blocked_except_allowlist(client, admin_token):
    _add_user(client, admin_token, 'blocked@example.com')
    token = _signin(client, 'blocked@example.com')['token']

    r = client.get('/api/v1/users/user/settings', headers=_auth(token))
    assert r.status_code == 403
    assert r.json() == {'detail': DETAIL}

    r = client.get('/api/models', headers=_auth(token))
    assert r.status_code == 403
    assert r.json() == {'detail': DETAIL}

    # Blocking must not log the user out (no cookie deletion).
    assert 'token=""' not in r.headers.get('set-cookie', '')

    assert client.get('/api/v1/auths/', headers=_auth(token)).status_code == 200
    assert client.get('/api/config', headers=_auth(token)).status_code == 200
    r = client.post('/api/v1/auths/update/timezone', headers=_auth(token), json={'timezone': 'Australia/Sydney'})
    assert r.status_code == 200, r.text
    assert client.post('/api/v1/auths/signout', headers=_auth(token)).status_code == 200


def test_update_password_rejects_same_password(client, admin_token):
    user_id = _add_user(client, admin_token, 'same@example.com')
    token = _signin(client, 'same@example.com')['token']
    r = client.post(
        '/api/v1/auths/update/password',
        headers=_auth(token),
        json={'password': INITIAL_PASSWORD, 'new_password': INITIAL_PASSWORD},
    )
    assert r.status_code == 400
    assert _info(user_id).get('must_change_password') is True


def test_update_password_requires_current_password(client, admin_token):
    user_id = _add_user(client, admin_token, 'wrongcurrent@example.com')
    token = _signin(client, 'wrongcurrent@example.com')['token']
    r = client.post(
        '/api/v1/auths/update/password',
        headers=_auth(token),
        json={'password': 'not-the-password', 'new_password': NEW_PASSWORD},
    )
    assert r.status_code == 400
    assert _info(user_id).get('must_change_password') is True


def test_update_password_clears_flag(client, admin_token):
    user_id = _add_user(client, admin_token, 'clears@example.com')
    token = _signin(client, 'clears@example.com')['token']
    r = client.post(
        '/api/v1/auths/update/password',
        headers=_auth(token),
        json={'password': INITIAL_PASSWORD, 'new_password': NEW_PASSWORD},
    )
    assert r.status_code == 200, r.text
    assert not _info(user_id).get('must_change_password')

    r = client.get('/api/v1/users/user/settings', headers=_auth(token))
    assert r.status_code == 200, r.text
    assert _signin(client, 'clears@example.com', NEW_PASSWORD)['must_change_password'] is False


def test_self_signup_not_flagged(client, admin_token):
    app.state.config.ENABLE_SIGNUP = True
    r = client.post(
        '/api/v1/auths/signup',
        json={'name': 'Self', 'email': 'self@example.com', 'password': 'SelfPassw0rd'},
    )
    assert r.status_code == 200, r.text
    assert r.json()['must_change_password'] is False
    assert not _info(r.json()['id']).get('must_change_password')


def test_oauth_style_user_not_flagged():
    # OAuth/SSO and LDAP create users via Auths.insert_new_auth directly.
    user = _run(Auths.insert_new_auth('sso@example.com', '', 'SSO', role='user', oauth={'oidc': {'sub': 'x'}}))
    assert not (user.info or {}).get('must_change_password')


def test_admin_password_reset_sets_flag(client, admin_token):
    user_id = _add_user(client, admin_token, 'reset@example.com')
    token = _signin(client, 'reset@example.com')['token']
    client.post(
        '/api/v1/auths/update/password',
        headers=_auth(token),
        json={'password': INITIAL_PASSWORD, 'new_password': NEW_PASSWORD},
    )
    assert not _info(user_id).get('must_change_password')

    # Admin edit without a password leaves the flag alone.
    r = client.post(
        f'/api/v1/users/{user_id}/update',
        headers=_auth(admin_token),
        json={'name': 'Renamed'},
    )
    assert r.status_code == 200, r.text
    assert not _info(user_id).get('must_change_password')

    r = client.post(
        f'/api/v1/users/{user_id}/update',
        headers=_auth(admin_token),
        json={'password': 'Resetpass2345'},
    )
    assert r.status_code == 200, r.text
    assert _info(user_id).get('must_change_password') is True
