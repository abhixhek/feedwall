#!/bin/sh
# Renders the trailer: every frame from trailer/index.html through headless Chrome, the score from trailer/score.py,
# then one MP4. Needs Google Chrome, Node 22+, ffmpeg and uv. Run from the repository root:
#   sh scripts/make_trailer.sh [output.mp4]
set -e
OUT="${1:-trailer.mp4}"
WORK="$(mktemp -d)"
PORT=48795
python3 -m http.server $PORT >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 1
node trailer/render.mjs --out "$WORK/frames" --base "http://localhost:$PORT"
uv run -q --with numpy --with scipy python trailer/score.py "$WORK/frames/sfx.json" "$WORK/score.wav"
# The film grain changes every frame, so the bitrate is capped rather than left to CRF alone.
ffmpeg -y -v error -framerate 30 -i "$WORK/frames/f%05d.jpg" -i "$WORK/score.wav" \
  -c:v libx264 -preset slow -crf 20 -maxrate 7M -bufsize 14M -pix_fmt yuv420p -profile:v high -g 60 \
  -c:a aac -b:a 192k -af "loudnorm=I=-14:TP=-1.5:LRA=11" -shortest -movflags +faststart "$OUT"
echo "wrote $OUT"
