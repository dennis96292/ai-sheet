# 第三方元件與授權

本專案本身以 MIT 授權釋出（見 [LICENSE](LICENSE)）。發布的 Docker 映像檔與網頁另外包含下列第三方元件，各自依其授權條款使用與散布。

## 模型與資料

| 元件 | 用途 | 授權 | 出處 |
| --- | --- | --- | --- |
| Transkun 2.0.1（含預訓練模型） | 鋼琴錄音轉音符 | MIT | Yujia Yan，https://github.com/Yujia-Yan/Transkun |
| PM2S（原始碼，commit 9586f91） | 拍點、小節第一拍、拍號、調號 | MIT | Lele Liu 等，https://github.com/cheriell/PM2S |
| PM2S 預訓練模型（RNNJointBeatModel、RNNKeySignatureModel、CNNTimeSignatureModel） | 同上 | CC BY 4.0 | Liu, L., Kong, Q., Morfi, G.-V., Benetos, E.，"Performance MIDI-to-score conversion by neural beat tracking"，ISMIR 2022；https://zenodo.org/records/10520196 |
| Basic Pitch 1.0.1（含模型） | 瀏覽器內轉譜（沒有分析服務時） | Apache-2.0 | Spotify，https://github.com/spotify/basic-pitch-ts |
| Salamander Grand Piano 取樣（30 個 mp3，`public/samples/piano`） | 播放用鋼琴音色 | CC BY 3.0 | Alexander Holm；mp3 版本取自 Tone.js，https://tonejs.github.io/audio/salamander/ |

## 前端函式庫

| 元件 | 授權 |
| --- | --- |
| OpenSheetMusicDisplay 2.2.1 | BSD-3-Clause |
| VexFlow 1.2.93（OpenSheetMusicDisplay 內含） | MIT |
| Tone.js 15.1.22 | MIT |
| @tonejs/midi 2.0.28 | MIT |
| TensorFlow.js 3.21.0 | Apache-2.0 |

## 分析服務（Python）

| 元件 | 授權 |
| --- | --- |
| PyTorch、torchaudio（CPU 版） | BSD-3-Clause 風格（PyTorch 授權） |
| NumPy | BSD-3-Clause |
| SciPy | BSD-3-Clause |
| pandas | BSD-3-Clause |
| pretty_midi | MIT |
| mido | MIT |
| mir_eval | MIT |
| moduleconf | MIT |
| tqdm | MPL-2.0 與 MIT |
| FastAPI | MIT |
| Starlette | BSD-3-Clause |
| Uvicorn | BSD-3-Clause |
| python-multipart | Apache-2.0 |
| PyAV 18.1.0 | BSD-3-Clause |
| FFmpeg 8.1.2（PyAV wheel 內附，含 x264、x265） | GPL-2.0 或更新版本 |

## FFmpeg（GPL）

音訊解碼使用 PyAV，其 PyPI wheel 內附 FFmpeg 8.1.2 的共享函式庫。該版本啟用了 x264、x265 等 GPL 元件，因此這些 FFmpeg 函式庫以 GPL-2.0 或更新版本散布；本專案原始碼仍為 MIT。對應的原始碼：

- FFmpeg：https://ffmpeg.org/download.html
- PyAV 與其 FFmpeg 建置設定：https://github.com/PyAV-Org/PyAV 、https://github.com/PyAV-Org/pyav-ffmpeg

## 系統套件（Docker 映像檔）

映像檔以 `python:3.11-slim`（Debian）為基礎，Debian 套件的授權與著作權聲明保留在映像檔內的 `/usr/share/doc/<套件名稱>/copyright`。
