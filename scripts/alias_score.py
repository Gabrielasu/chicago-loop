"""Aliasing: mean error of the 1x render against a 2x render box-filtered down, over the model."""
import subprocess
import sys

import numpy as np


def load(path: str, w: int, h: int) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-i", path, "-vf", f"scale={w}:{h}:flags=area", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.uint8).reshape(h, w).astype(np.float32)


a = load(f"{sys.argv[1]}/dpr1.png", 1600, 900)
b = load(f"{sys.argv[1]}/dpr2.png", 1600, 900)
d = np.abs(a - b)[150:850, 300:1350]
print(f"aliasing error {d.mean():.2f}  pixels off by >32: {(d > 32).mean() * 100:.1f}%")
