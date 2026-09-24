"""Fixture: intentionally buggy. Review input for the engine's own tests."""

import os


def deploy(target):
    return os.system(f"rsync -az {target} /srv/app")
