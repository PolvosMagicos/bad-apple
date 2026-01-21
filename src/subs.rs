// src/lib/subs.rs
// Reads .srt (UTF-8) and writes compact JSON cues for the userscript.
//
// Output schema (compact):
//   [{ "s": 12.345, "e": 14.200, "t": "line1\nline2" }, ...]
//
// Usage example:
//   srt_to_json_file("out/transcript_jp.srt", "out/transcript_jp.json")?;

use anyhow::{anyhow, Context, Result};
use serde::Serialize;
use std::{fs, path::Path};

#[derive(Debug, Clone, Serialize)]
pub struct Cue {
    pub s: f32, // start seconds
    pub e: f32, // end seconds
    pub t: String,
}

fn parse_ts_to_seconds(ts: &str) -> f32 {
    // Accept: "HH:MM:SS,mmm" or "HH:MM:SS.mmm"
    // We keep it permissive; return 0 on failure.
    let ts = ts.trim();
    let mut parts = ts.split([':', ',', '.']).map(|p| p.trim());
    let hh = parts
        .next()
        .and_then(|x| x.parse::<u32>().ok())
        .unwrap_or(0);
    let mm = parts
        .next()
        .and_then(|x| x.parse::<u32>().ok())
        .unwrap_or(0);
    let ss = parts
        .next()
        .and_then(|x| x.parse::<u32>().ok())
        .unwrap_or(0);
    let ms = parts
        .next()
        .map(|x| {
            // normalize to 3 digits
            let mut s = x.to_string();
            if s.len() < 3 {
                s.push_str(&"0".repeat(3 - s.len()));
            }
            s.truncate(3);
            s.parse::<u32>().unwrap_or(0)
        })
        .unwrap_or(0);

    (hh as f32) * 3600.0 + (mm as f32) * 60.0 + (ss as f32) + (ms as f32) / 1000.0
}

pub fn parse_srt_to_cues(srt_text: &str) -> Vec<Cue> {
    let norm = srt_text.replace("\r\n", "\n").replace('\r', "\n");
    let blocks = norm
        .split("\n\n")
        .map(|b| b.trim())
        .filter(|b| !b.is_empty());

    let mut cues = Vec::new();

    for block in blocks {
        let lines: Vec<&str> = block.lines().map(|l| l.trim_end()).collect();
        if lines.len() < 2 {
            continue;
        }

        // SRT can be:
        //   1
        //   00:00:01,000 --> 00:00:02,000
        //   text...
        //
        // Or without numeric index:
        //   00:00:01,000 --> 00:00:02,000
        //   text...
        let time_line_idx = if lines.get(1).map(|l| l.contains("-->")).unwrap_or(false) {
            1
        } else {
            0
        };

        let time_line = match lines.get(time_line_idx) {
            Some(x) => *x,
            None => continue,
        };

        if !time_line.contains("-->") {
            continue;
        }

        let mut parts = time_line.split("-->").map(|s| s.trim());
        let start_ts = parts.next().unwrap_or("");
        let end_ts = parts.next().unwrap_or("");
        if start_ts.is_empty() || end_ts.is_empty() {
            continue;
        }

        let s = parse_ts_to_seconds(start_ts);
        let e = parse_ts_to_seconds(end_ts);

        // Text lines after time line
        let text_lines = &lines[(time_line_idx + 1)..];
        let t = text_lines
            .iter()
            .map(|l| l.trim_end())
            .filter(|l| !l.is_empty())
            .collect::<Vec<_>>()
            .join("\n")
            .trim()
            .to_string();

        if t.is_empty() {
            continue;
        }

        cues.push(Cue { s, e, t });
    }

    cues.sort_by(|a, b| a.s.partial_cmp(&b.s).unwrap_or(std::cmp::Ordering::Equal));
    cues
}

pub fn srt_to_json_file<P: AsRef<Path>, Q: AsRef<Path>>(srt_path: P, json_path: Q) -> Result<()> {
    let srt_path = srt_path.as_ref();
    let json_path = json_path.as_ref();

    let srt = fs::read_to_string(srt_path)
        .with_context(|| format!("Failed reading SRT: {}", srt_path.display()))?;

    let cues = parse_srt_to_cues(&srt);

    if cues.is_empty() {
        return Err(anyhow!("No cues parsed from {}", srt_path.display()));
    }

    if let Some(parent) = json_path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("Failed creating dir: {}", parent.display()))?;
    }

    // Compact JSON
    let json = serde_json::to_string(&cues).context("Failed serializing cues to JSON")?;
    fs::write(json_path, json)
        .with_context(|| format!("Failed writing JSON: {}", json_path.display()))?;

    Ok(())
}
