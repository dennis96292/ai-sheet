import subprocess
import sys
import urllib.request
import venv
from pathlib import Path

ROOT = Path(__file__).parent
VENV = ROOT / ".venv"
PM2S = ROOT / "vendor" / "PM2S"
PM2S_REPO = "https://github.com/cheriell/PM2S.git"
PM2S_COMMIT = "9586f91cd16aaa50dbb82f720f6a34a3e0186f47"
PM2S_MODELS = {
    "beat": "RNNJointBeatModel",
    "key_signature": "RNNKeySignatureModel",
    "time_signature": "CNNTimeSignatureModel",
}


def run(*cmd):
    print(">", " ".join(map(str, cmd)))
    subprocess.run(cmd, check=True)


def main():
    python = VENV / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
    if not python.exists():
        venv.create(VENV, with_pip=True)
    run(python, "-m", "pip", "install", "--upgrade", "pip")
    run(python, "-m", "pip", "install", "torch", "torchaudio", "--index-url", "https://download.pytorch.org/whl/cpu")
    run(python, "-m", "pip", "install", "--no-deps", "transkun==2.0.1")
    run(python, "-m", "pip", "install", "-r", ROOT / "requirements.txt")

    if not PM2S.exists():
        PM2S.parent.mkdir(parents=True, exist_ok=True)
        run("git", "clone", PM2S_REPO, PM2S)
    run("git", "-C", PM2S, "checkout", "-q", PM2S_COMMIT)
    for folder, name in PM2S_MODELS.items():
        target = PM2S / "pm2s" / "_model_state_dicts" / folder / f"{name}.pth"
        if target.exists() and target.stat().st_size > 1_000_000:
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        url = f"https://zenodo.org/records/10520196/files/{name}.pth?download=1"
        print("下載", url)
        urllib.request.urlretrieve(url, target)

    print("\n完成。啟動服務：npm run server")


if __name__ == "__main__":
    main()
