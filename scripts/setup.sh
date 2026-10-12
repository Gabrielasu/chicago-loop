#!/usr/bin/env bash
# Creates .venv with Python 3.11 and Blender as a Python module (bpy).
set -euo pipefail
cd "$(dirname "$0")/.."
command -v uv >/dev/null || { echo "Install uv first: https://docs.astral.sh/uv/"; exit 1; }
[ -d .venv ] || uv venv -p 3.11 .venv
uv pip install -p .venv/bin/python "bpy==5.0.1"
mkdir -p build
.venv/bin/python -c "import bpy; print('Blender', bpy.app.version_string, 'ready')"
