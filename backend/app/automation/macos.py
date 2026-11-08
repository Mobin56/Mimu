import platform
import subprocess
from typing import Dict
from urllib.parse import urlparse


APP_NAMES: Dict[str, str] = {
    "visual studio code": "Visual Studio Code",
    "vs code": "Visual Studio Code",
    "code": "Visual Studio Code",
    "terminal": "Terminal",
    "chrome": "Google Chrome",
    "google chrome": "Google Chrome",
    "finder": "Finder",
    "system settings": "System Settings",
}


def normalize_action(action_type: str, target: str) -> str:
    if action_type == "app":
        app_label = target.strip().lower()
        if app_label.startswith("open "):
            app_label = app_label[5:].strip()
        app_name = APP_NAMES.get(app_label)
        if not app_name:
            raise ValueError("This application is not in MiMu's approved app list.")
        return app_name

    if action_type == "website":
        parsed = urlparse(target.strip())
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            raise ValueError("Enter a complete http:// or https:// website address.")
        if parsed.username or parsed.password:
            raise ValueError("Website addresses containing credentials are not allowed.")
        return target.strip()

    raise ValueError("This automation action is not supported.")


def execute_action(action_type: str, normalized_target: str) -> None:
    if platform.system() != "Darwin":
        raise RuntimeError("macOS automation is only available on a Mac.")

    if action_type == "app":
        subprocess.run(["open", "-a", normalized_target], check=True, timeout=15)
    else:
        subprocess.run(["open", normalized_target], check=True, timeout=15)
