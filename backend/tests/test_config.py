"""CORS_ORIGINS accepts the three spellings people actually use."""

from __future__ import annotations

import pytest

from app.config import Settings


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("https://a.example", ["https://a.example"]),
        ("https://a.example,https://b.example", ["https://a.example", "https://b.example"]),
        ("https://a.example, https://b.example ", ["https://a.example", "https://b.example"]),
        ('["https://c.example"]', ["https://c.example"]),
        ("", []),
    ],
)
def test_cors_origins_accepts_plain_and_json(monkeypatch, raw, expected):
    """A bare origin used to abort startup with an unexplained SettingsError."""
    monkeypatch.setenv("CORS_ORIGINS", raw)
    assert Settings().cors_origins == expected


def test_cors_origins_default(monkeypatch):
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    assert Settings().cors_origins == ["https://rmm.rxf-sys.de"]
