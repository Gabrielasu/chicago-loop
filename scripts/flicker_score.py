"""Mean absolute difference between consecutive flicker frames (0 to 255), over the model area."""
import subprocess
import sys

import numpy as np


def load(path: str) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.uint8).reshape(900, 1600).astype(np.float32)


frames = [load(f"{sys.argv[1]}/f{i}.png") for i in range(int(sys.argv[2]))]
diffs = [np.abs(a - b)[150:850, 300:1350] for a, b in zip(frames, frames[1:])]
print(f"mean {np.mean([d.mean() for d in diffs]):.2f}  share of pixels changing >24: {np.mean([(d > 24).mean() for d in diffs]) * 100:.1f}%")
