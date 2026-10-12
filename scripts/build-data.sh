#!/usr/bin/env bash
# Phase 1: download raw data if missing, build build/loop.json, validate it and write the data report.
set -euo pipefail
cd "$(dirname "$0")/.."
PY=.venv/bin/python
$PY -m pipeline.fetch "$@"
$PY -m pipeline.build
$PY -m pipeline.validate
$PY -m pipeline.report
$PY -m pipeline.export_network
