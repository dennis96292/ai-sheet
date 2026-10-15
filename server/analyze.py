import json
import sys
import time
import warnings
from functools import lru_cache
from pathlib import Path

import av
import numpy as np
import torch

warnings.filterwarnings("ignore")
torch.set_grad_enabled(False)
sys.path.insert(0, str(Path(__file__).parent / "vendor" / "PM2S"))

SPEED = {"transcribe": 1.8}


def load_audio(path: str, sr: int, channels: int) -> np.ndarray:
    resampler = av.AudioResampler(format="flt", layout="stereo" if channels == 2 else "mono", rate=sr)
    chunks = []
    with av.open(str(path)) as container:
        stream = next(s for s in container.streams if s.type == "audio")
        for frame in container.decode(stream):
            chunks.extend(f.to_ndarray().reshape(-1) for f in resampler.resample(frame))
    chunks.extend(f.to_ndarray().reshape(-1) for f in resampler.resample(None))
    data = np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)
    return data.astype(np.float32, copy=False).reshape(-1, channels)


@lru_cache(maxsize=1)
def transkun_model():
    import moduleconf
    from importlib.resources import files

    pretrained = files("transkun") / "pretrained"
    conf_manager = moduleconf.parseFromFile(str(pretrained / "2.0.conf"))
    model = conf_manager["Model"].module.TransKun(conf=conf_manager["Model"].config)
    checkpoint = torch.load(str(pretrained / "2.0.pt"), map_location="cpu")
    model.load_state_dict(checkpoint.get("best_state_dict", checkpoint["state_dict"]), strict=False)
    return model.eval()


@lru_cache(maxsize=1)
def pm2s_processors():
    from pm2s.features.beat import RNNJointBeatProcessor
    from pm2s.features.key_signature import RNNKeySignatureProcessor
    from pm2s.features.time_signature import CNNTimeSignatureProcessor

    return RNNJointBeatProcessor(), CNNTimeSignatureProcessor(), RNNKeySignatureProcessor()


def audio_duration(path: str) -> float:
    try:
        with av.open(str(path)) as container:
            stream = next(s for s in container.streams if s.type == "audio")
            if stream.duration and stream.time_base:
                return float(stream.duration * stream.time_base)
            return (container.duration or 0) / av.time_base
    except (av.FFmpegError, StopIteration, OSError):
        return 0.0


@torch.inference_mode()
def transcribe(path: str) -> list[dict]:
    model = transkun_model()
    audio = load_audio(path, model.fs, 2)
    notes = model.transcribe(torch.from_numpy(audio), discardSecondHalf=False)
    return sorted(
        (
            {"start": round(float(n.start), 4), "end": round(float(n.end), 4), "pitch": int(n.pitch), "velocity": int(n.velocity)}
            for n in notes
            if 21 <= n.pitch <= 108 and n.end > n.start
        ),
        key=lambda n: (n["start"], n["pitch"]),
    )


@torch.inference_mode()
def score_features(notes: list[dict]) -> dict:
    if len(notes) < 8:
        return {"beats": [], "downbeats": [], "timeSignature": None, "key": None}
    beat_proc, ts_proc, key_proc = pm2s_processors()
    seq = np.array([[n["pitch"], n["start"], n["end"] - n["start"], n["velocity"]] for n in notes], dtype=np.float32)
    beats, downbeats = beat_proc.process_note_seq(
        seq, pps_args={"prob_thresh": 0.5, "penalty": 1.0, "merge_downbeats": False, "method": "dp"}
    )
    beat_probs, downbeat_probs, _ = beat_proc._model(torch.tensor(seq).unsqueeze(0))
    beat_probs = beat_probs.squeeze(0).numpy()
    downbeat_probs = downbeat_probs.squeeze(0).numpy()
    onsets = seq[:, 1]

    def near_max(probs, t):
        mask = np.abs(onsets - t) < 0.12
        return round(float(probs[mask].max()), 3) if mask.any() else 0.0

    keys = key_proc.process_note_seq(seq)
    return {
        "beats": [round(float(b), 4) for b in beats],
        "beatProb": [near_max(beat_probs, b) for b in beats],
        "downbeatProb": [near_max(downbeat_probs, b) for b in beats],
        "downbeats": [round(float(d), 4) for d in downbeats],
        "timeSignature": ts_proc.process_note_seq(seq),
        "key": keys[0][1] if keys else None,
    }


def analyze(path: str) -> dict:
    t0 = time.time()
    notes = transcribe(path)
    t1 = time.time()
    features = score_features(notes)
    t2 = time.time()
    return {"notes": notes, **features, "timing": {"transcribe": round(t1 - t0, 1), "score": round(t2 - t1, 1)}}


if __name__ == "__main__":
    result = analyze(sys.argv[1])
    if len(sys.argv) > 2:
        Path(sys.argv[2]).write_text(json.dumps(result))
    summary = {k: (len(v) if isinstance(v, list) else v) for k, v in result.items()}
    print(summary)
