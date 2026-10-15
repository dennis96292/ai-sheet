FROM --platform=$BUILDPLATFORM node:22-slim AS web
WORKDIR /web
COPY package.json package-lock.json ./
COPY scripts/copy-model.mjs scripts/
RUN npm ci
COPY index.html vite.config.js ./
COPY public public
COPY src src
RUN npm run build

FROM --platform=$BUILDPLATFORM alpine:3.20 AS pm2s
RUN apk add --no-cache git curl
ARG PM2S_COMMIT=9586f91cd16aaa50dbb82f720f6a34a3e0186f47
RUN git clone https://github.com/cheriell/PM2S.git /pm2s \
 && git -C /pm2s checkout -q "$PM2S_COMMIT" \
 && rm -rf /pm2s/.git /pm2s/dev /pm2s/demo.ipynb /pm2s/generated_score.mid
RUN for m in beat/RNNJointBeatModel key_signature/RNNKeySignatureModel time_signature/CNNTimeSignatureModel; do \
      dir="/pm2s/pm2s/_model_state_dicts/${m%/*}"; mkdir -p "$dir"; \
      curl -fsSL --retry 5 -o "$dir/${m#*/}.pth" "https://zenodo.org/records/10520196/files/${m#*/}.pth?download=1"; \
    done

FROM python:3.11-slim
WORKDIR /app
COPY server/requirements.txt server/requirements.txt
RUN pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir --no-deps transkun==2.0.1 \
 && pip install --no-cache-dir -r server/requirements.txt
COPY server/__init__.py server/analyze.py server/app.py server/
COPY --from=pm2s /pm2s server/vendor/PM2S
COPY --from=web /web/dist dist
COPY LICENSE THIRD_PARTY_NOTICES.md ./

RUN useradd --create-home --uid 10001 app
USER app
ENV AI_SHEET_STATIC=/app/dist \
    PYTHONUNBUFFERED=1
EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/api/health', timeout=3)"
CMD ["uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "8765"]
