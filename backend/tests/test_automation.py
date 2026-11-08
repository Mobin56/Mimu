import pytest

from app.automation.macos import normalize_action


def test_approved_app_alias_resolves_to_known_application():
    assert normalize_action("app", "open vs code") == "Visual Studio Code"


def test_unknown_application_is_rejected():
    with pytest.raises(ValueError):
        normalize_action("app", "an arbitrary application")


@pytest.mark.parametrize("target", ["javascript:alert(1)", "file:///etc/passwd", "https://user:pass@example.com"])
def test_unsafe_website_urls_are_rejected(target):
    with pytest.raises(ValueError):
        normalize_action("website", target)


def test_http_website_is_allowed():
    assert normalize_action("website", "https://example.com") == "https://example.com"
