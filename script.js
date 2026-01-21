// ==UserScript==
// @name         Bad Apple on UNMSM Calendar (Center Video + Side Lyrics)
// @namespace    unmsm-bad-apple
// @version      4.4
// @description  Bad Apple on UNMSM SUM Calendar: centered rect-video + side lyrics (JP+Romaji | EN+ES).
// @match        https://sum.unmsm.edu.pe/alumnoWebSum/v2/reportes/horarios
// @grant        GM.xmlHttpRequest
// @connect      127.0.0.1
// @connect      localhost
// ==/UserScript==

(async function () {
  "use strict";

  /* ---------------- config ---------------- */

  const PATH = "http://127.0.0.1:8080/out";
  const RECT_FRAMES_URL = `${PATH}/rectFrames.json`;
  const AUDIO_URL = `${PATH}/audio.mp3`;

  const SUB_JP_URL = `${PATH}/transcript_jp.json`;
  const SUB_RO_URL = `${PATH}/transcript_romaji.json`;
  const SUB_EN_URL = `${PATH}/transcript_en.json`;
  const SUB_ES_URL = `${PATH}/transcript_es.json`;

  // Visuals
  const GRIDLINE_COLOR = "rgba(229,229,229,0.9)";
  const GRIDLINE_THICKNESS_PX = 1;
  const ON_OPACITY = 0.95;

  // Sync tuning
  const START_ON_TIMEUPDATE = true;
  const SUB_TIME_OFFSET_SEC = 0.0; // (+ shows earlier, - shows later)
  const VIDEO_TIME_OFFSET_SEC = 0.0; // (+ shows later, - shows earlier)
  const INVERT = false;

  // Optional pixel shifts
  const X_SHIFT = 0;
  const Y_SHIFT = 0;

  // Side captions styling
  const SIDE_FONT_SIZE = "13px";
  const SIDE_LINE_HEIGHT = "1.35";
  const SIDE_BG = "rgba(255,255,255,0.92)";
  const SIDE_TEXT = "#111";

  // Debug
  const DEBUG_LAYOUT = false; // logs layout numbers
  const DEBUG_FRAME = false; // logs frame indices

  /* ---------------- utils ---------------- */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(selector, timeout = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const el = document.querySelector(selector);
      if (el) return el;
      await sleep(200);
    }
    throw new Error(`Timeout waiting for ${selector}`);
  }

  function gmFetchText(url) {
    return new Promise((resolve, reject) => {
      GM.xmlHttpRequest({
        method: "GET",
        url,
        onload: (r) => resolve(r),
        onerror: (e) => reject(e),
        ontimeout: () => reject(new Error("timeout")),
        timeout: 30000,
      });
    });
  }

  async function gmFetchJson(url) {
    const r = await gmFetchText(url);
    if (r.status !== 200)
      throw new Error(`Failed to load JSON: ${url} (status ${r.status})`);

    try {
      return JSON.parse(r.responseText || "null");
    } catch (e) {
      console.error("[BadApple] JSON parse error:", {
        url,
        head: (r.responseText || "").slice(0, 200),
      });
      throw new Error(`Invalid JSON at ${url}`);
    }
  }

  function fitAspect(containerW, containerH, contentW, contentH) {
    const containerAR = containerW / containerH;
    const contentAR = contentW / contentH;

    if (containerAR > contentAR) {
      const h = containerH;
      const w = h * contentAR;
      return { width: w, height: h, left: (containerW - w) / 2, top: 0 };
    } else {
      const w = containerW;
      const h = w / contentAR;
      return { width: w, height: h, left: 0, top: (containerH - h) / 2 };
    }
  }

  /* ---------------- subtitles (JSON cues) ---------------- */

  // Cue schema from Rust:
  //  { s: number, e: number, t: string }
  function normalizeCues(cues) {
    if (!Array.isArray(cues)) return [];
    const out = cues
      .map((c) => {
        if (!c || typeof c !== "object") return null;
        const s = Number(c.s);
        const e = Number(c.e);
        const t = typeof c.t === "string" ? c.t : "";
        if (!Number.isFinite(s) || !Number.isFinite(e) || !t) return null;
        return { s, e, t };
      })
      .filter(Boolean);

    out.sort((a, b) => a.s - b.s);
    return out;
  }

  function findActiveCue(cues, t, startIndexHint = 0) {
    let i = Math.max(0, startIndexHint);
    while (i < cues.length && cues[i].e < t) i++;
    if (i < cues.length && cues[i].s <= t && t <= cues[i].e)
      return { cue: cues[i], idx: i };
    return { cue: null, idx: i };
  }

  /* ---------------- load rectFrames ---------------- */

  async function loadRectFrames() {
    const r = await gmFetchText(RECT_FRAMES_URL);

    console.log("[BadApple] rectFrames fetch:", {
      url: RECT_FRAMES_URL,
      status: r.status,
      statusText: r.statusText,
      finalUrl: r.finalUrl,
      len: (r.responseText || "").length,
      head: (r.responseText || "").slice(0, 160),
    });

    if (r.status !== 200)
      throw new Error(`Failed to load rectFrames.json (status ${r.status})`);

    let json;
    try {
      json = JSON.parse(r.responseText);
    } catch {
      throw new Error(
        "rectFrames.json is not valid JSON (maybe you fetched HTML?)",
      );
    }

    const width = json.width;
    const height = json.height;
    const fps = json.fps ?? null;

    const raw = json.rect_frames ?? json.rectFrames;
    if (!width || !height)
      throw new Error("rectFrames.json missing width/height");
    if (!Array.isArray(raw) || raw.length === 0)
      throw new Error("rectFrames.json missing rect_frames[]");

    const rectFrames = raw.map((frame) => {
      if (!Array.isArray(frame)) return [];
      return frame
        .map((r) => {
          if (Array.isArray(r)) {
            const [x, y, w, h, v] = r;
            return { x, y, w, h, v: v ?? 1 };
          }
          if (r && typeof r === "object") {
            return { x: r.x, y: r.y, w: r.w, h: r.h, v: r.v ?? 1 };
          }
          return null;
        })
        .filter(Boolean);
    });

    return { width, height, fps, rectFrames };
  }

  /* ---------------- calendar geometry ---------------- */

  function findCalendarParts(calendarEl) {
    const header =
      calendarEl.querySelector(".tui-full-calendar-dayname-container") ||
      calendarEl.querySelector(".tui-full-calendar-dayname-layout");

    const leftCol = calendarEl.querySelector(
      ".tui-full-calendar-timegrid-left",
    );
    const rightGrid = calendarEl.querySelector(
      ".tui-full-calendar-timegrid-right",
    );
    const vlayout = calendarEl.querySelector(
      ".tui-full-calendar-vlayout-container",
    );

    return { header, leftCol, rightGrid, vlayout };
  }

  // Overlay only covers the schedule grid (.timegrid-right),
  // and is positioned past the hours column (hours stay visible).
  function computeGridRect(calendarEl) {
    const { header, leftCol, rightGrid, vlayout } =
      findCalendarParts(calendarEl);

    if (!rightGrid)
      throw new Error("Could not find .tui-full-calendar-timegrid-right");
    if (!vlayout)
      throw new Error("Could not find .tui-full-calendar-vlayout-container");

    const top = header?.offsetHeight ?? 0;
    const left = leftCol?.offsetWidth ?? 0;
    const width = rightGrid.offsetWidth;
    const height = vlayout.offsetHeight;

    return {
      top: Math.max(0, top),
      left: Math.max(0, left),
      width: Math.max(0, width),
      height: Math.max(0, height),
    };
  }

  /* ---------------- styles ---------------- */

  function injectStyles() {
    const id = "bad-apple-v44-style";
    if (document.getElementById(id)) return;

    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
      #bad-apple-start {
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 2147483647;
        padding: 10px 14px;
        font-size: 14px;
        border-radius: 10px;
        border: 1px solid #ccc;
        background: #111;
        color: #fff;
        cursor: pointer;
      }

      #bad-apple-audio {
        position: fixed;
        left: 12px;
        bottom: 12px;
        z-index: 2147483646;
        width: 320px;
      }

      #bad-apple-overlay {
        position: absolute;
        pointer-events: none;
        z-index: 999999;
        overflow: hidden;
        background: #fff;
      }

      /* gridlines */
      #bad-apple-stage::before,
      .bad-apple-side::before {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 0;
        background-image:
          linear-gradient(to right, ${GRIDLINE_COLOR} ${GRIDLINE_THICKNESS_PX}px, transparent ${GRIDLINE_THICKNESS_PX}px),
          linear-gradient(to bottom, ${GRIDLINE_COLOR} ${GRIDLINE_THICKNESS_PX}px, transparent ${GRIDLINE_THICKNESS_PX}px);
        background-position: 0 0;
        background-size: var(--ba-grid, 20px 20px);
        opacity: 1;
      }

      #bad-apple-stage {
        position: absolute;
        display: grid;
        overflow: hidden;
        background: #fff;
      }

      #bad-apple-stage > .ba-rect {
        z-index: 1;
        background: #000;
        opacity: ${ON_OPACITY};
      }

      .bad-apple-side {
        position: absolute;
        top: 0;
        height: 100%;
        overflow: hidden;
        background: #fff;
      }

      .bad-apple-side .side-text {
        position: absolute;
        inset: 0;
        z-index: 1;
        padding: 10px 12px;
        font: ${SIDE_FONT_SIZE}/${SIDE_LINE_HEIGHT} system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        color: ${SIDE_TEXT};
        background: ${SIDE_BG};
        white-space: pre-wrap;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        justify-content: center;
        text-align: center;
      }

      .side-text .lang {
        font-weight: 800;
        margin-bottom: 8px;
        opacity: 0.9;
      }
      .side-text .line {
        opacity: 0.95;
      }
    `;
    document.head.appendChild(style);
  }

  /* ---------------- start button + audio ---------------- */

  function addStartButton(onClick) {
    const existing = document.getElementById("bad-apple-start");
    if (existing) existing.remove();

    const btn = document.createElement("button");
    btn.id = "bad-apple-start";
    btn.textContent = "▶ Start Bad Apple";

    btn.addEventListener("click", async () => {
      if (btn.dataset.running === "1") return;
      btn.dataset.running = "1";
      btn.disabled = true;
      btn.style.cursor = "default";
      btn.textContent = "⏳ Loading…";

      try {
        await onClick();
        btn.remove();
      } catch (e) {
        console.error("[BadApple] start failed:", e);
        btn.dataset.running = "0";
        btn.disabled = false;
        btn.style.cursor = "pointer";
        btn.textContent = "▶ Start Bad Apple (retry)";
      }
    });

    document.body.appendChild(btn);
    return btn;
  }

  function createAudioElem(url) {
    const existing = document.getElementById("bad-apple-audio");
    if (existing) existing.remove();

    const audio = document.createElement("audio");
    audio.id = "bad-apple-audio";
    audio.src = url;
    audio.preload = "auto";
    audio.controls = true;
    document.body.appendChild(audio);
    return audio;
  }

  /* ---------------- overlay system ---------------- */

  function createOverlaySystem(calendarEl, contentW, contentH) {
    injectStyles();

    const old = document.getElementById("bad-apple-overlay");
    if (old) old.remove();

    const overlay = document.createElement("div");
    overlay.id = "bad-apple-overlay";

    // Ensure calendar container can host absolute children
    const cs = getComputedStyle(calendarEl);
    if (cs.position === "static") calendarEl.style.position = "relative";
    calendarEl.style.opacity = "1";

    const stage = document.createElement("div");
    stage.id = "bad-apple-stage";

    const leftSide = document.createElement("div");
    leftSide.className = "bad-apple-side";

    const rightSide = document.createElement("div");
    rightSide.className = "bad-apple-side";

    const leftText = document.createElement("div");
    leftText.className = "side-text";
    leftText.innerHTML = `
      <div class="lang">JP / Romaji</div>
      <div class="line"></div>
    `;

    const rightText = document.createElement("div");
    rightText.className = "side-text";
    rightText.innerHTML = `
      <div class="lang">EN / ES</div>
      <div class="line"></div>
    `;

    leftSide.appendChild(leftText);
    rightSide.appendChild(rightText);

    overlay.appendChild(leftSide);
    overlay.appendChild(stage);
    overlay.appendChild(rightSide);
    calendarEl.appendChild(overlay);

    const applyLayout = () => {
      const r = computeGridRect(calendarEl);

      overlay.style.top = r.top + "px";
      overlay.style.left = r.left + "px";
      overlay.style.width = r.width + "px";
      overlay.style.height = r.height + "px";

      const fit = fitAspect(r.width, r.height, contentW, contentH);

      const stageLeft = fit.left;
      const stageTop = fit.top;
      const stageW = fit.width;
      const stageH = fit.height;

      Object.assign(stage.style, {
        left: `${stageLeft}px`,
        top: `${stageTop}px`,
        width: `${stageW}px`,
        height: `${stageH}px`,
        gridTemplateColumns: `repeat(${contentW}, 1fr)`,
        gridTemplateRows: `repeat(${contentH}, 1fr)`,
      });

      const cellW = stageW / contentW;
      const cellH = stageH / contentH;

      // ✅ single var for both stage+side so they align perfectly
      const bg = `${cellW.toFixed(4)}px ${cellH.toFixed(4)}px`;
      stage.style.setProperty("--ba-grid", bg);

      // Side panels fill remaining width
      const sideLeftW = Math.max(0, stageLeft);
      const sideRightW = Math.max(0, r.width - (stageLeft + stageW));

      leftSide.style.setProperty("--ba-grid", bg);
      rightSide.style.setProperty("--ba-grid", bg);

      Object.assign(leftSide.style, {
        left: "0px",
        width: `${sideLeftW}px`,
        height: `${r.height}px`,
        display: sideLeftW < 40 ? "none" : "block",
      });

      Object.assign(rightSide.style, {
        left: `${stageLeft + stageW}px`,
        width: `${sideRightW}px`,
        height: `${r.height}px`,
        display: sideRightW < 40 ? "none" : "block",
      });

      if (DEBUG_LAYOUT) {
        console.log("[BadApple][layout]", {
          overlay: { w: r.width, h: r.height, top: r.top, left: r.left },
          stage: { left: stageLeft, top: stageTop, w: stageW, h: stageH },
          sides: { leftW: sideLeftW, rightW: sideRightW },
          cell: { w: cellW, h: cellH },
        });
      }
    };

    applyLayout();
    const ro = new ResizeObserver(() => applyLayout());
    ro.observe(calendarEl);

    // TUI reflows after render; retry a few times
    let tries = 0;
    const iv = setInterval(() => {
      tries++;
      try {
        applyLayout();
      } catch {}
      if (tries > 25) clearInterval(iv);
    }, 250);

    return {
      overlay,
      stage,
      leftTextBox: leftText.querySelector(".line"),
      rightTextBox: rightText.querySelector(".line"),
      destroy() {
        ro.disconnect();
        clearInterval(iv);
        overlay.remove();
      },
    };
  }

  /* ---------------- video render ---------------- */

  function clearRects(stage) {
    stage.querySelectorAll(".ba-rect").forEach((n) => n.remove());
  }

  function drawRectFrame(stage, rects) {
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      const v = r.v ?? 1;
      const on = INVERT ? (v ? 0 : 1) : v;
      if (!on) continue;

      const d = document.createElement("div");
      d.className = "ba-rect";

      const x = (r.x | 0) + X_SHIFT;
      const y = (r.y | 0) + Y_SHIFT;

      d.style.gridColumn = `${x + 1} / span ${r.w | 0}`;
      d.style.gridRow = `${y + 1} / span ${r.h | 0}`;

      stage.appendChild(d);
    }
  }

  /* ---------------- playback ---------------- */

  function startPlaybackSynced({ stage, rectFrames, audio, videoOffsetSec = 0 }) {
    const N = rectFrames.length;
    let lastIndex = -1;
    let rafId = 0;

    const effectiveFps = N / audio.duration;

    console.log("[BadApple] Sync clock:", {
      frames: N,
      duration: audio.duration,
      effectiveFps,
      videoOffsetSec,
    });

    function tick() {
      const t = Math.max(0, audio.currentTime + videoOffsetSec);
      const idx = Math.floor(t * effectiveFps);

      if (idx !== lastIndex && idx >= 0 && idx < N) {
        clearRects(stage);
        drawRectFrame(stage, rectFrames[idx]);
        lastIndex = idx;
        if (DEBUG_FRAME && idx % 60 === 0) console.log("[BadApple] frame", idx);
      }

      if (idx < N && !audio.ended) rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }

  function startSideSubtitles({
    audio,
    leftTextBox,
    rightTextBox,
    jpCues,
    roCues,
    enCues,
    esCues,
    timeOffsetSec = 0,
  }) {
    let idxJP = 0, idxRO = 0, idxEN = 0, idxES = 0;
    let rafId = 0;

    function render() {
      const t = audio.currentTime + timeOffsetSec;

      const a = findActiveCue(jpCues, t, idxJP); idxJP = a.idx;
      const b = findActiveCue(roCues, t, idxRO); idxRO = b.idx;
      const c = findActiveCue(enCues, t, idxEN); idxEN = c.idx;
      const d = findActiveCue(esCues, t, idxES); idxES = d.idx;

      const leftLines = [];
      if (a.cue) leftLines.push(a.cue.t);
      if (b.cue) leftLines.push(b.cue.t);

      const rightLines = [];
      if (c.cue) rightLines.push(c.cue.t);
      if (d.cue) rightLines.push(d.cue.t);

      leftTextBox.textContent = leftLines.join("\n\n");
      rightTextBox.textContent = rightLines.join("\n\n");

      if (!audio.ended) rafId = requestAnimationFrame(render);
    }

    rafId = requestAnimationFrame(render);

    audio.addEventListener(
      "ended",
      () => {
        cancelAnimationFrame(rafId);
        leftTextBox.textContent = "";
        rightTextBox.textContent = "";
      },
      { once: true },
    );

    return () => cancelAnimationFrame(rafId);
  }

  /* ---------------- main ---------------- */

  try {
    injectStyles();

    const calendarEl = await waitFor("#calendar", 20000);
    await waitFor("#calendar .tui-full-calendar-timegrid-right", 20000);

    // preload frames NOW (start button stable)
    const data = await loadRectFrames();

    console.log("🍎 rectFrames loaded", {
      width: data.width,
      height: data.height,
      frames: data.rectFrames.length,
      rectsInFrame0: data.rectFrames[0]?.length,
      fpsMeta: data.fps,
    });

    addStartButton(async () => {
      const ui = createOverlaySystem(calendarEl, data.width, data.height);

      // fetch compact JSON cues generated by Rust
      const [jpRaw, roRaw, enRaw, esRaw] = await Promise.all([
        gmFetchJson(SUB_JP_URL),
        gmFetchJson(SUB_RO_URL),
        gmFetchJson(SUB_EN_URL),
        gmFetchJson(SUB_ES_URL),
      ]);

      const jpCues = normalizeCues(jpRaw);
      const roCues = normalizeCues(roRaw);
      const enCues = normalizeCues(enRaw);
      const esCues = normalizeCues(esRaw);

      if (!jpCues.length || !roCues.length || !enCues.length || !esCues.length) {
        console.warn("[BadApple] Some subtitle tracks are empty:", {
          jp: jpCues.length,
          ro: roCues.length,
          en: enCues.length,
          es: esCues.length,
        });
      }

      const audio = createAudioElem(AUDIO_URL);
      await audio.play();

      const start = () => {
        startPlaybackSynced({
          stage: ui.stage,
          rectFrames: data.rectFrames,
          audio,
          videoOffsetSec: VIDEO_TIME_OFFSET_SEC,
        });

        startSideSubtitles({
          audio,
          leftTextBox: ui.leftTextBox,
          rightTextBox: ui.rightTextBox,
          jpCues,
          roCues,
          enCues,
          esCues,
          timeOffsetSec: SUB_TIME_OFFSET_SEC,
        });

        console.log("✅ Started");
      };

      if (!START_ON_TIMEUPDATE) {
        start();
        return;
      }

      // Start only when audio clock moves (avoids late video)
      const t0 = audio.currentTime;
      let started = false;

      const onTimeUpdate = () => {
        if (started) return;
        if (audio.currentTime > t0 + 0.02) {
          started = true;
          audio.removeEventListener("timeupdate", onTimeUpdate);
          start();
        }
      };

      audio.addEventListener("timeupdate", onTimeUpdate);

      setTimeout(() => {
        if (!started) {
          started = true;
          audio.removeEventListener("timeupdate", onTimeUpdate);
          start();
        }
      }, 200);
    });

    console.log("✅ Ready. Click ▶ Start.");
  } catch (err) {
    console.error("Bad Apple failed:", err);
  }
})();
