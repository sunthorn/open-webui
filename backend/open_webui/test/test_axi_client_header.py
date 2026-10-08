"""X-Axi-Client is forwarded to the hermes connection only (spec §3.6)."""
from open_webui.utils.headers import axi_client_header

HERMES = {"headers": {"X-Axi-Agent-User": "{{USER_EMAIL}}", "X-Axi-Agent-Owner": "{{USER_ID}}"}}
GEMINI = {"model_ids": ["gemini-3.7-flash"]}


def test_forwarded_to_the_agent_connection():
    assert axi_client_header({"x-axi-client": " 899317 "}, HERMES) == {"X-Axi-Client": "899317"}


def test_never_sent_to_a_third_party_connection():
    assert axi_client_header({"x-axi-client": "899317"}, GEMINI) == {}


def test_absent_or_malformed_header_sends_nothing():
    assert axi_client_header({}, HERMES) == {}
    assert axi_client_header({"x-axi-client": "../x"}, HERMES) == {}
    assert axi_client_header({"x-axi-client": "a" * 65}, HERMES) == {}
