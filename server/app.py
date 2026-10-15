import asyncio
import os
import shutil
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.staticfiles import StaticFiles

from . import analyze

MAX_UPLOAD_MB = int(os.environ.get("AI_SHEET_MAX_UPLOAD_MB", "60"))
MAX_QUEUE = int(os.environ.get("AI_SHEET_MAX_QUEUE", "4"))
RESULT_TTL = 15 * 60
STATIC_DIR = Path(os.environ.get("AI_SHEET_STATIC", Path(__file__).resolve().parent.parent / "dist"))
PUBLIC_URL = os.environ.get("AI_SHEET_URL", "http://localhost:8765")

executor = ThreadPoolExecutor(max_workers=1)
jobs: dict[str, dict] = {}
lock = threading.Lock()


def warm_up():
    try:
        analyze.transkun_model()
        analyze.pm2s_processors()
    except Exception as e:
        print(f"模型預先載入失敗（第一次分析時會再試）：{e}")


@asynccontextmanager
async def lifespan(_app):
    executor.submit(warm_up)
    asyncio.get_running_loop().call_later(0.2, lambda: print(f"AI Sheet is ready: {PUBLIC_URL}", flush=True))
    yield

app = FastAPI(lifespan=lifespan)


def run_job(job_id: str, path: Path):
    job = jobs[job_id]
    try:
        job["stage"] = "transcribe"
        job["started"] = time.time()
        notes = analyze.transcribe(str(path))
        elapsed = time.time() - job["started"]
        if job["duration"] > 0:
            analyze.SPEED["transcribe"] = elapsed / job["duration"]
        job["stage"] = "score"
        job["result"] = {"notes": notes, **analyze.score_features(notes)}
        job["stage"] = "done"
    except Exception as e:
        job["stage"] = "error"
        job["error"] = str(e)
    finally:
        job["finished"] = time.time()
        shutil.rmtree(path.parent, ignore_errors=True)


def cleanup_jobs():
    now = time.time()
    with lock:
        for job_id in [k for k, j in jobs.items() if j.get("finished") and now - j["finished"] > RESULT_TTL]:
            jobs.pop(job_id, None)


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/analyze")
async def submit(file: UploadFile = File(...)):
    cleanup_jobs()
    with lock:
        active = sum(1 for j in jobs.values() if j["stage"] in ("queued", "transcribe", "score"))
    if active >= MAX_QUEUE:
        raise HTTPException(429, "分析佇列已滿，請稍後再試")

    tmp = Path(tempfile.mkdtemp(prefix="ai-sheet-"))
    path = tmp / "audio"
    size = 0
    with path.open("wb") as f:
        while chunk := await file.read(1 << 20):
            size += len(chunk)
            if size > MAX_UPLOAD_MB << 20:
                shutil.rmtree(tmp, ignore_errors=True)
                raise HTTPException(413, f"檔案超過 {MAX_UPLOAD_MB} MB")
            f.write(chunk)

    duration = analyze.audio_duration(str(path))
    if duration <= 0:
        shutil.rmtree(tmp, ignore_errors=True)
        raise HTTPException(400, "無法解碼的音訊檔")

    job_id = uuid.uuid4().hex
    with lock:
        jobs[job_id] = {"stage": "queued", "duration": duration, "started": None}
    executor.submit(run_job, job_id, path)
    return {"id": job_id}


@app.get("/api/jobs/{job_id}")
def status(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404)
    progress = 0.0
    if job["stage"] == "transcribe" and job["started"]:
        expected = max(1.0, job["duration"] * analyze.SPEED["transcribe"])
        progress = min(0.95, (time.time() - job["started"]) / expected)
    elif job["stage"] in ("score", "done"):
        progress = 1.0
    body = {"stage": job["stage"], "progress": round(progress, 3)}
    if job["stage"] == "done":
        body["result"] = job["result"]
        jobs.pop(job_id, None)
    elif job["stage"] == "error":
        body["error"] = job["error"]
        jobs.pop(job_id, None)
    return body

if STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="web")
