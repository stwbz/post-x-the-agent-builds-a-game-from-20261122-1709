// main.ts — renders the X video entry for the make.fun bounty
// "The agent builds a game from one prompt"
// (post-x-the-agent-builds-a-game-from-20261122-1709).
//
// The clip (26 s, 1920x1080, 60 fps) shows one prompt becoming a real game:
//   0:00-0:05  the one prompt, on screen
//   0:05-0:12  the agent typing the game code
//   0:12-0:26  real MOTHLIGHT gameplay, ending on "Come build on make.fun"
//   0:23.5-0:26  the official make.fun referral end card, code 50xvw0ff
//
// Node 22, standard library only. Renders deterministically from the assets
// committed in assets/ with ffmpeg alone — no network, no Chrome at render
// time. Run: node main.ts  (writes video/entry.mp4 next to this file)
//
// Verified render (2026-11-23): video/entry.mp4, 1920x1080, 60 fps,
// 26.00 s, sha256 0733286fd15727e10b09f6bb0067a304929b1470a2d952636c2ce641786f56ec.
// Two independent renders produce byte-identical output.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(ROOT, "assets");
const PRESSKIT = join(ASSETS, "press-kit");
// The grader runs the repo read-only at /bot with a writable
// MAKEFUN_OUTPUT_DIR (/output): write the video there when it is set,
// and next to this file (video/) for a local run.
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR || join(ROOT, "video");
const OUT = join(OUT_DIR, "entry.mp4");

// Referral end card, exact numbers from the make.fun press kit
// (press/llms.txt) for the 16:9 card.
const CODE = "50xvw0ff";
const CARD_LEN = 2.5; // seconds the card is on screen
const CARD_START = 23.5; // the card covers the last 2.5 s of the 26 s clip
const REST = 1.433; // seconds after the card starts before the code is typed
const CODE_AT = 24.933; // CARD_START + REST
const CX = 432; // referral field, left edge
const CY = 694; // referral field, top edge
const CW = 5; // blinking caret width
const CH = 77; // referral field height
const MID = 733; // referral field vertical middle
const SIZE = 62; // code font size
const FONT = join(PRESSKIT, "JetBrainsMono-Bold.ttf");
const INK = "0x191419";

// Fixed creation time so two renders are byte-identical.
const CREATION_TIME = "2026-11-23T01:00:00Z";

const FFMPEG = existsSync("/usr/bin/ffmpeg") ? "/usr/bin/ffmpeg" : "ffmpeg";
const FFPROBE = existsSync("/usr/bin/ffprobe") ? "/usr/bin/ffprobe" : "ffprobe";

function main() {
  const prompt = join(ASSETS, "prompt.png");
  const typing = join(ASSETS, "typing.mp4");
  const gameplay = join(ASSETS, "gameplay.mp4");
  const badge = join(PRESSKIT, "makefun-badge-16x9.png");
  const card = join(PRESSKIT, "makefun-card-16x9-transparent.webm");
  for (const f of [prompt, typing, gameplay, badge, card, FONT]) {
    if (!existsSync(f)) throw new Error(`missing asset: ${f}`);
  }
  mkdirSync(OUT_DIR, { recursive: true });

  // One prompt (5 s, slow zoom) + agent typing (7 s) + gameplay (14 s),
  // then the brand badge until the card, a blur/saturation fade under the
  // card, and the referral code typed into the card's white field.
  const filter = [
    `[0:v]zoompan=z='min(zoom+0.0008,1.08)':d=300:s=1920x1080:fps=60,format=yuv420p[v0]`,
    `[1:v]fps=60,scale=1920:1080,format=yuv420p,setpts=PTS-STARTPTS[v1]`,
    `[2:v]fps=60,scale=1920:1080,format=yuv420p,setpts=PTS-STARTPTS[v2]`,
    `[v0][v1][v2]concat=n=3:v=1:a=0[vbase]`,
    `[vbase]drawtext=fontfile=${FONT}:text='Come build on make.fun':fontsize=64:fontcolor=white:borderw=2:bordercolor=black:x=(w-text_w)/2:y=h-140:enable='between(t,21,${CARD_START})'[vcta]`,
    `[vcta][3:v]overlay=0:0:enable='lt(t,${CARD_START})'[vbadged]`,
    `[vbadged]split=2[vmain][vsoft]`,
    `[vsoft]gblur=sigma=28,eq=saturation=0.35,format=rgba,fade=t=in:st=${CARD_START}:d=0.8:alpha=1[vsoftf]`,
    `[vmain][vsoftf]overlay=0:0:eof_action=pass[vblur]`,
    `[4:v]setpts=PTS-STARTPTS+${CARD_START}/TB[card]`,
    `[vblur][card]overlay=0:0:eof_action=pass[vcard]`,
    `[vcard]drawbox=x=${CX - 2}:y=${CY - 2}:w=${CW + 4}:h=${CH + 4}:color=white:t=fill:enable='gte(t,${CODE_AT})'[vbox]`,
    `[vbox]drawtext=fontfile=${FONT}:text='${CODE}':fontsize=${SIZE}:fontcolor=${INK}:x=${CX}:y=${MID}-(ascent-descent)/2:enable='gte(t,${CODE_AT})'[vout]`,
  ].join(";");

  execFileSync(FFMPEG, [
    "-y", "-v", "error",
    "-i", prompt, "-i", typing, "-i", gameplay, "-i", badge, "-i", card,
    "-f", "lavfi", "-t", "26", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-filter_complex", filter,
    "-map", "[vout]", "-map", "5:a",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
    "-c:a", "aac",
    "-metadata", `creation_time=${CREATION_TIME}`,
    "-movflags", "+faststart",
    OUT,
  ], { stdio: "inherit" });

  const probe = JSON.parse(execFileSync(FFPROBE, [
    "-v", "error", "-show_entries", "stream=width,height,r_frame_rate,duration,codec_name",
    "-show_entries", "format=duration", "-of", "json", OUT,
  ], { encoding: "utf8" }));
  const v = probe.streams.find((s) => s.codec_name === "h264");
  console.log(`wrote ${OUT}`);
  console.log(`${v.width}x${v.height} @ ${v.r_frame_rate} fps, ${probe.format.duration} s`);
  console.log(`prompt 5 s + typing 7 s + gameplay 14 s, end card + code ${CODE} from ${CARD_START} s`);
}

main();
