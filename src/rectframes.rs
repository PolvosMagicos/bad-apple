use anyhow::{Context, Result};
use serde::Serialize;
use std::{collections::HashMap, fs, path::Path};

#[derive(Clone, Debug)]
pub struct ConvertRectframesOpts<'a> {
    pub w: u32,
    pub h: u32,
    pub fps: u32,
    pub invert: bool,
    pub th_mul: f32,
    pub in_dir: &'a Path,
}

#[derive(Serialize, Clone, Debug)]
pub struct Rect {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
    pub v: u8, // 1 = black/on
}

#[derive(Serialize)]
pub struct Payload {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub threshold: u32,
    pub th_mul: f32,
    pub invert: bool,
    pub frames_count: usize,
    pub rect_frames: Vec<Vec<Rect>>,
}

#[inline]
fn idx(x: usize, y: usize, w: usize) -> usize {
    y * w + x
}

fn adaptive_threshold(gray: &[u8]) -> f32 {
    let sum: u64 = gray.iter().map(|&v| v as u64).sum();
    (sum as f32) / (gray.len() as f32)
}

/*
Strategy:
1) For each row, convert 1/0 pixels into horizontal runs: (x_start, run_width)
2) Merge vertical rectangles only when the run key (x_start, run_width) matches exactly
*/
fn merge_frame_to_rects(frame: &[u8], w: usize, h: usize) -> Vec<Rect> {
    let mut runs_by_row: Vec<Vec<(usize, usize)>> = vec![Vec::new(); h];

    for (y, row_runs) in runs_by_row.iter_mut().enumerate() {
        let mut x = 0usize;

        while x < w {
            while x < w && frame[idx(x, y, w)] == 0 {
                x += 1;
            }
            if x >= w {
                break;
            }

            let start = x;
            while x < w && frame[idx(x, y, w)] == 1 {
                x += 1;
            }

            let run_w = x - start;
            row_runs.push((start, run_w));
        }
    }

    let mut rects: Vec<Rect> = Vec::new();
    let mut active: HashMap<(usize, usize), usize> = HashMap::new();

    for (y, runs) in runs_by_row.iter().enumerate() {
        let mut next_active: HashMap<(usize, usize), usize> = HashMap::new();

        for &(x, run_w) in runs {
            let key = (x, run_w);

            if let Some(&rect_idx) = active.get(&key) {
                rects[rect_idx].h += 1;
                next_active.insert(key, rect_idx);
            } else {
                let rect_idx = rects.len();
                rects.push(Rect {
                    x: x as u32,
                    y: y as u32,
                    w: run_w as u32,
                    h: 1,
                    v: 1,
                });
                next_active.insert(key, rect_idx);
            }
        }

        active = next_active;
    }

    rects
}

pub fn convert_rectframes(opts: ConvertRectframesOpts<'_>) -> Result<Payload> {
    if !opts.in_dir.exists() {
        anyhow::bail!("Input directory not found: {}", opts.in_dir.display());
    }

    let mut files: Vec<_> = fs::read_dir(opts.in_dir)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().map(|x| x == "png").unwrap_or(false))
        .collect();

    files.sort();

    if files.is_empty() {
        anyhow::bail!("No PNG frames found in {}", opts.in_dir.display());
    }

    println!("🎞️  Frames: {}", files.len());
    println!("📐 {}×{} @ {}fps", opts.w, opts.h, opts.fps);
    println!("🔁 Invert: {}", opts.invert);
    println!("🎚️  Threshold multiplier: {}", opts.th_mul);

    let mut rect_frames: Vec<Vec<Rect>> = Vec::with_capacity(files.len());
    let mut th_sum: f64 = 0.0;

    for (i, fp) in files.iter().enumerate() {
        let img = image::open(fp).with_context(|| format!("Failed to open {}", fp.display()))?;

        let gray = img.to_luma8();
        let (iw, ih) = gray.dimensions();

        if iw != opts.w || ih != opts.h {
            anyhow::bail!(
                "❌ Frame size mismatch in {}: got {}×{}, expected {}×{}",
                fp.file_name().unwrap_or_default().to_string_lossy(),
                iw,
                ih,
                opts.w,
                opts.h
            );
        }

        let buf = gray.as_raw();
        let th = adaptive_threshold(buf) * opts.th_mul;
        th_sum += th as f64;

        let mut frame = vec![0u8; buf.len()];
        for (pi, &v) in buf.iter().enumerate() {
            let mut on = (v as f32) < th;
            if opts.invert {
                on = !on;
            }
            frame[pi] = if on { 1 } else { 0 };
        }

        let rects = merge_frame_to_rects(&frame, opts.w as usize, opts.h as usize);
        rect_frames.push(rects);

        if i % 200 == 0 {
            println!("  ✔ {}/{}", i, files.len());
        }
    }

    let avg_th = (th_sum / files.len() as f64).round().clamp(0.0, 255.0) as u32;

    Ok(Payload {
        width: opts.w,
        height: opts.h,
        fps: opts.fps,
        threshold: avg_th,
        th_mul: opts.th_mul,
        invert: opts.invert,
        frames_count: rect_frames.len(),
        rect_frames,
    })
}

pub fn convert_rectframes_to_file(opts: ConvertRectframesOpts<'_>, out_file: &Path) -> Result<()> {
    let payload = convert_rectframes(opts)?;

    if let Some(parent) = out_file.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::write(out_file, serde_json::to_string(&payload)?)?;

    println!("✅ rectFrames.json written: {}", out_file.display());
    println!("🧮 frames_count: {}", payload.frames_count);
    println!("🎚️ avg threshold: {}", payload.threshold);

    Ok(())
}
