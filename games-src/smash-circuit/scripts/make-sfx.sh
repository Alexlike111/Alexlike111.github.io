#!/usr/bin/env bash
# Generates PLACEHOLDER sound effects into public/sfx/ with ffmpeg (reproducible, deterministic).
#
#  !!  These files are synthesized by a script. Playgama requirement 3.3.2 forbids code-synthesized sound
#  !!  in a published game: REPLACE every file with a recorded CC0 / licensed sound (same file name,
#  !!  same loop/one-shot role) before publishing. See docs/AUDIO.md.
#
# Usage: bash scripts/make-sfx.sh        (needs ffmpeg with libvorbis + libmp3lame)
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=public/sfx
mkdir -p "$OUT"
SR=44100
FF=(ffmpeg -hide_banner -loglevel error -y)

# encode <name> <ffmpeg lavfi args...>: renders to .ogg (primary) and .mp3 (Safari/iOS fallback)
render() {
  local name="$1"; shift
  "${FF[@]}" "$@" -ar $SR -ac 1 -c:a libvorbis -q:a 3 "$OUT/$name.ogg"
  "${FF[@]}" -i "$OUT/$name.ogg" -c:a libmp3lame -q:a 5 "$OUT/$name.mp3"
}
# expr <name> <duration> <expression> [audio filter]: expression-synthesised sound
expr() {
  local name="$1" dur="$2" e="$3" af="${4:-anull}"
  render "$name" -f lavfi -i "aevalsrc=exprs='${e}':s=${SR}:d=${dur}" -af "$af,alimiter=limit=0.9"
}

PI2="6.283185307"

# ---- engine loop (2 s, integer cycles -> seamless): 50 Hz fundamental + harmonics + 25 Hz roughness
expr engine 2 "0.34*(0.75+0.25*sin(${PI2}*25*t))*(sin(${PI2}*50*t)+0.55*sin(${PI2}*100*t+0.6)+0.4*sin(${PI2}*150*t+1.1)+0.25*sin(${PI2}*200*t+2.0)+0.15*sin(${PI2}*250*t)+0.1*sin(${PI2}*300*t+0.3))" "lowpass=f=2400"

# ---- skid loop (1.6 s filtered noise, faded edges)
render skid -f lavfi -i "anoisesrc=d=1.6:c=white:r=${SR}:a=0.9:s=7" -af "highpass=f=1200,lowpass=f=5200,volume=0.8,afade=t=in:d=0.05,afade=t=out:st=1.55:d=0.05"

# ---- impacts
expr impact_light 0.22 "(0.9*sin(${PI2}*140*t)*exp(-26*t)+0.7*(2*random(1)-1)*exp(-40*t))*0.9"
expr impact_heavy 0.7 "(1.0*sin(${PI2}*(70-30*t)*t)*exp(-7*t)+0.9*(2*random(2)-1)*exp(-18*t)+0.5*sin(${PI2}*180*t)*exp(-14*t))*0.9" "lowpass=f=3500"
expr crunch 0.55 "((2*random(3)-1)*(exp(-22*t)+0.8*exp(-30*mod(t,0.07))*lt(t,0.35))+0.45*sin(${PI2}*(900+300*sin(${PI2}*11*t))*t)*exp(-9*t))*0.7" "highpass=f=300,lowpass=f=7000"
expr debris 0.4 "(2*random(4)-1)*(0.9*exp(-70*mod(t,0.055))*lt(t,0.3)+0.6*exp(-12*t))*0.8" "highpass=f=600,lowpass=f=6000"

# ---- ui
expr click 0.07 "0.8*sin(${PI2}*(820+1400*t)*t)*exp(-55*t)"
expr buy 0.5 "0.6*(sin(${PI2}*988*t)*exp(-9*t)+lt(t,0.5)*gt(t,0.1)*sin(${PI2}*1319*(t-0.1))*exp(-8*(t-0.1)))"
expr error 0.3 "0.55*sin(${PI2}*150*t)*(0.6+0.4*sin(${PI2}*38*t))*exp(-5*t)*(1+0.3*sin(${PI2}*300*t))"

# ---- race jingles
expr countdown 0.22 "0.7*sin(${PI2}*660*t)*min(1,t*200)*exp(-6*t)"
expr go 0.5 "0.7*(sin(${PI2}*880*t)+0.4*sin(${PI2}*1760*t))*min(1,t*200)*exp(-3.5*t)"
expr finish 1.4 "0.55*((sin(${PI2}*523*t)*exp(-3*t))+gt(t,0.18)*sin(${PI2}*659*(t-0.18))*exp(-3*(t-0.18))+gt(t,0.36)*sin(${PI2}*784*(t-0.36))*exp(-3*(t-0.36))+gt(t,0.54)*(sin(${PI2}*1047*(t-0.54))+0.3*sin(${PI2}*2094*(t-0.54)))*exp(-2.6*(t-0.54)))"

# ---- music loop: 32 eighth-note steps at 140 bpm (A minor), bass + arpeggio + hat; exact loop length
STEP=$(awk 'BEGIN{printf "%.6f", 60/140/2}')
LEN=$(awk -v s="$STEP" 'BEGIN{printf "%.6f", s*32}')
# note tables (Hz) per step index 0..31
BASS=(55 55 0 55 55 0 55 82.4  49 49 0 49 49 0 49 73.4  44 44 0 44 44 0 44 65.4  49 49 0 49 49 0 61.7 73.4)
ARP=(220 330 440 330 220 330 440 523  196 294 392 294 196 294 392 494  175 262 349 262 175 262 349 440  196 294 392 294 196 294 392 494)
N="mod(floor(t/${STEP}),32)"      # step index
TB="mod(t,${STEP})"               # time inside the step
seq_expr() { # seq_expr <values...>  -> nested if(eq(N,k),v,...)
  local arr=("$@") e="0" i
  for ((i=${#arr[@]}-1; i>=0; i--)); do e="if(eq(${N},$i),${arr[$i]},$e)"; done
  echo "$e"
}
FB=$(seq_expr "${BASS[@]}")
FA=$(seq_expr "${ARP[@]}")
expr music "$LEN" "0.32*gt(${FB},0)*(sin(${PI2}*(${FB})*${TB})+0.5*sin(${PI2}*2*(${FB})*${TB}))*exp(-5*${TB})+0.16*(sin(${PI2}*(${FA})*${TB})+0.3*sin(${PI2}*2*(${FA})*${TB}))*exp(-7*${TB})+0.07*(2*random(5)-1)*exp(-60*mod(t,${STEP}/2))*eq(mod(${N},2),1)" "lowpass=f=6000,volume=0.9"

ls -l "$OUT"
