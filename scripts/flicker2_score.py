"""Flicker as the second difference: |f[i] - (f[i-1] + f[i+1]) / 2| over the model.

Smooth motion is close to linear between three nearby frames, so this stays
small; aliasing (details that pop on and off) does not. Prints the mean and
the share of pixels off by more than 24 levels.
"""
import subprocess
import sys

import numpy as np


def load(path: str) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.uint8).reshape(900, 1600).astype(np.float32)


f = [load(f"{sys.argv[1]}/f{i}.png") for i in range(int(sys.argv[2]))]
d = [np.abs(f[i] - (f[i - 1] + f[i + 1]) / 2)[150:850, 300:1350] for i in range(1, len(f) - 1)]
print(f"second difference mean {np.mean([x.mean() for x in d]):.2f}  >24: {np.mean([(x > 24).mean() for x in d]) * 100:.1f}%")
