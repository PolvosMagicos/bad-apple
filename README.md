# 🍎 Bad Apple on UNMSM Calendar

Render **Bad Apple!!** inside the UNMSM timetable by dynamically repainting the calendar grid using  
**rectangle-merged binary frames**, synchronized with audio and multilingual lyrics.

This project uses a **Rust preprocessing + local Actix server + lightweight userscript** pipeline for performance, correctness, and maintainability.

---

## ✨ Features

- High-resolution **Bad Apple!!** animation
- Rectangle-merge optimization (5–10× fewer DOM nodes)
- Audio-driven sync (no drift, audio is the master clock)
- Aspect-ratio preserved (letterboxed, no stretching)
- Original calendar visible until ▶ Start
- Lyrics displayed on the sides:
  - **Left:** Japanese + Romaji
  - **Right:** English + Spanish
- Heavy processing moved to **Rust**
- Local pipeline: **FFmpeg → Rust → Actix**
- Browser playback via **Violentmonkey**
- Hours column of the calendar is preserved

---

## 🧠 Architecture Overview

### Rust (offline / server side)
- Converts PNG frames → rectangle-merged JSON (`rectFrames.json`)
- Parses `.srt` subtitles → compact JSON
- Automatically regenerates missing outputs
- Serves static assets via Actix

### JavaScript (userscript)
- Fetches preprocessed JSON
- Renders rectangles efficiently using CSS Grid
- Syncs animation + subtitles to audio time
- Handles layout and UI only (no heavy parsing)

---

## 📁 Project Structure

```
bad-apple/
├─ bad_apple.mp4
├─ frames/
├─ lyrics/
│  ├─ transcript_jp.srt
│  ├─ transcript_romaji.srt
│  ├─ transcript_en.srt
│  └─ transcript_es.srt
├─ out/
│  ├─ rectFrames.json
│  ├─ audio.mp3
│  ├─ transcript_jp.json
│  ├─ transcript_romaji.json
│  ├─ transcript_en.json
│  └─ transcript_es.json
├─ src/
│  ├─ bin/
│  │  ├─ convert_rectframes.rs
│  │  └─ server.rs
│  ├─ rectframes.rs
│  ├─ subs.rs
│  └─ lib.rs
├─ script.js
├─ Cargo.toml
├─ Cargo.lock
├─ demo.mp4
└─ README.md
```

---

## ⚙️ Requirements

### System
- FFmpeg ≥ 5
- Rust ≥ 1.75
- Cargo

### Browser
- Firefox or Chromium
- Violentmonkey extension

---

## 🎞️ Step 1 — Extract Frames (FFmpeg)

```
mkdir -p frames
```

```
ffmpeg -y -i bad_apple.mp4 \
  -vf "fps=30,scale=256:192:flags=lanczos,unsharp=5:5:1.2:5:5:0.0,format=gray" \
  frames/frame_%05d.png
```

---

## 🔊 Step 2 — Extract Audio

```
mkdir -p out
ffmpeg -y -i bad_apple.mp4 -vn -acodec libmp3lame -q:a 2 out/audio.mp3
```

---

## 🦀 Step 3 — Convert Frames (Rust)

```
cargo run --release --bin convert_rectframes -- \
  --w 256 --h 192 --fps 30 --in frames --out out/rectFrames.json
```

---

## 📝 Step 4 — Subtitles (Rust)

- Input: `.srt` files in `lyrics/`
- Output: `.json` files in `out/`
- Automatically regenerated when running the server if missing or outdated

---

## 🌐 Step 5 — Run Actix Server

```
cargo run --release --bin server
```

Server address:

```
http://127.0.0.1:8080
```

---

## 🧩 Step 6 — Install Userscript

1. Open **Violentmonkey**
2. Create a new userscript
3. Paste the contents of `script.js`
4. Save

Target page:

```
https://sum.unmsm.edu.pe/alumnoWebSum/v2/reportes/horarios
```

---

## ▶️ Playback & Sync

- Audio is the master clock
- Frame index:

```
frame = currentTime × (totalFrames / audioDuration)
```
---

## 🚀 Performance Notes

Rectangle merging reduces DOM updates by **5–10×**.

---

## 🙏 Credits

- **Bad Apple!!** — Alstroemeria Records  
- Inspiration: [comabay](https://github.com/comaybay/bad-apple-uit-timetable)
- Implementation: Me
