#!/bin/zsh
# Pool TV look: low-res, few colours, ordered dither, hard pixels; the last 0.6 s fades into the start so it loops.
# usage: tvify.sh in.mp4 out.mp4 [mono]
set -e
in=$1 out=$2 mono=${3:-}
L=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$in")
off=$(awk -v l="$L" 'BEGIN{printf "%.3f", l-1.2}')
tone="eq=saturation=0.85:contrast=1.1:gamma=0.95"
[[ $mono == mono ]] && tone="hue=s=0,eq=contrast=1.25:brightness=-0.03"
nice -n 10 ffmpeg -loglevel error -y -i "$in" -filter_complex "[0:v]fps=15,scale=136:136:flags=area,$tone,split=2[a][b];[a]trim=0.6,setpts=PTS-STARTPTS[a1];[b]trim=0:0.6,setpts=PTS-STARTPTS[b1];[a1][b1]xfade=transition=fade:duration=0.6:offset=${off}[x];[x]split[p][q];[p]palettegen=max_colors=20:stats_mode=full[pal];[q][pal]paletteuse=dither=bayer:bayer_scale=3[d];[d]scale=272:272:flags=neighbor,format=yuv420p" -an -c:v libx264 -crf 25 -preset slow -tune animation -movflags +faststart "$out"
