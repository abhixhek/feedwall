#!/bin/sh
# Rebuilds docs/demo.mp4 from the visual test bench: the real extension code on a sample feed, no API key needed.
# Needs Google Chrome and ffmpeg. Run from the repository root:  sh scripts/make_demo.sh
set -e
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
PORT=48794
OUT="$(mktemp -d)"
python3 -m http.server $PORT >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 1
BASE="http://localhost:$PORT/tests/harness"

shot() { # number, step label, caption, bench url
  src=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$4")
  cap=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$3")
  step=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$2")
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1.5 --window-size=1280,720 \
    --virtual-time-budget=6000 --screenshot="$OUT/$1.png" "$BASE/scene.html?step=$step&caption=$cap&src=$src" >/dev/null 2>&1
}

shot 1 "Before" "A normal feed: bait, outrage, filler, and a few posts you actually want." "index.html?site=x&eager=1&off=1&hud=0"
shot 2 "Feedwall on" "You wrote the rules in plain English. Bait collapses. What you care about is kept." "index.html?site=x&eager=1&hud=0"
shot 3 "Focus mode" "Only what you asked for. Everything else is counted, one click away." "index.html?site=x&eager=1&focus=1&hud=0"
shot 4 "Your topics" "Any number of topics. Keep, highlight, dim or hide. Your call, per topic." "options.html"
shot 5 "Test it" "Try a topic on posts you actually scrolled past, before you save it." "options.html?scene=editor"
shot 6 "Honest about mistakes" "It tracks where it was wrong and suggests a better confidence bar." "options.html?scene=report"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1.5 --window-size=1280,720 \
  --screenshot="$OUT/7.png" "$BASE/scene.html?end=1" >/dev/null 2>&1

# 7 stills, 4.5 s each (the last 3.5 s), 0.5 s cross-fades, with a silent audio track (X rejects some silent files).
HOLD=4.5; FADE=0.5
inputs=""; for i in 1 2 3 4 5 6 7; do inputs="$inputs -loop 1 -t $HOLD -i $OUT/$i.png"; done
filter="[0:v]scale=1920:1080,format=yuv420p,fps=30[v0]"
for i in 1 2 3 4 5 6; do filter="$filter;[$i:v]scale=1920:1080,format=yuv420p,fps=30[s$i]"; done
prev="v0"
for i in 1 2 3 4 5 6; do
  offset=$(python3 -c "print(round($i*($HOLD-$FADE),2))")
  filter="$filter;[$prev][s$i]xfade=transition=fade:duration=$FADE:offset=$offset[x$i]"; prev="x$i"
done
ffmpeg -y -v error $inputs -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -filter_complex "$filter" -map "[$prev]" -map 7:a -shortest \
  -c:v libx264 -profile:v high -pix_fmt yuv420p -r 30 -g 60 -b:v 4000k -maxrate 6000k -bufsize 12000k -c:a aac -b:a 128k -movflags +faststart docs/demo.mp4
cp "$OUT/2.png" docs/demo-poster.png
# GitHub only plays a video inline when it is uploaded through the web editor, so the README shows a GIF and links the MP4.
ffmpeg -y -v error -i docs/demo.mp4 -vf "fps=8,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" docs/demo.gif
echo "wrote docs/demo.mp4 and docs/demo.gif"
