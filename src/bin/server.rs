use actix_cors::Cors;
use actix_files::Files;
use actix_web::{App, HttpServer};
use anyhow::{Context, Result};
use bad_apple::rectframes::{convert_rectframes_to_file, ConvertRectframesOpts};
use bad_apple::subs::srt_to_json_file;
use clap::Parser;
use std::{
    fs, io,
    path::{Path, PathBuf},
    time::SystemTime,
};

#[derive(Parser, Debug)]
#[command(author, version, about)]
struct Args {
    /// Directory to serve (e.g. "out")
    #[arg(long, default_value = "out")]
    dir: String,

    /// Directory containing PNG frames
    #[arg(long, default_value = "frames")]
    frames_dir: String,

    /// Directory containing SRT lyrics
    #[arg(long, default_value = "lyrics")]
    lyrics_dir: String,

    /// Converter width/height/fps
    #[arg(long, default_value_t = 256)]
    w: u32,

    #[arg(long, default_value_t = 192)]
    h: u32,

    #[arg(long, default_value_t = 30)]
    fps: u32,

    /// Invert output (0/1)
    #[arg(long, default_value_t = 0)]
    invert: u8,

    /// Threshold multiplier
    #[arg(long, default_value_t = 0.95)]
    th_mul: f32,

    /// Bind host
    #[arg(long, default_value = "127.0.0.1")]
    host: String,

    /// Bind port
    #[arg(long, default_value_t = 8080)]
    port: u16,

    /// URL mount path
    #[arg(long, default_value = "/out")]
    mount: String,
}

fn mtime(p: &Path) -> Result<SystemTime> {
    Ok(fs::metadata(p)?.modified()?)
}

fn needs_regen(src: &Path, dst: &Path) -> bool {
    if !dst.exists() {
        return true;
    }
    match (mtime(src), mtime(dst)) {
        (Ok(s), Ok(d)) => s > d,
        _ => true,
    }
}

fn ensure_subtitle_jsons(out_dir: &Path, lyrics_dir: &Path) -> Result<()> {
    let pairs = [
        ("transcript_jp.srt", "transcript_jp.json"),
        ("transcript_romaji.srt", "transcript_romaji.json"),
        ("transcript_en.srt", "transcript_en.json"),
        ("transcript_es.srt", "transcript_es.json"),
    ];

    for (srt_name, json_name) in pairs {
        let srt_path = lyrics_dir.join(srt_name);
        let json_path = out_dir.join(json_name);

        if !srt_path.exists() {
            anyhow::bail!("Missing SRT: {}", srt_path.display());
        }

        if needs_regen(&srt_path, &json_path) {
            println!("📝 Generating {}", json_path.display());
            srt_to_json_file(&srt_path, &json_path).with_context(|| {
                format!(
                    "Failed converting {} -> {}",
                    srt_path.display(),
                    json_path.display()
                )
            })?;
        } else {
            println!("📝 OK {}", json_path.display());
        }
    }
    Ok(())
}

fn ensure_rectframes(out_dir: &Path, frames_dir: &Path, args: &Args) -> Result<()> {
    let rect_path = out_dir.join("rectFrames.json");
    if rect_path.exists() {
        println!("🎞️ OK {}", rect_path.display());
        return Ok(());
    }

    println!(
        "⚠️ Missing {} — generating via library…",
        rect_path.display()
    );

    let opts = ConvertRectframesOpts {
        w: args.w,
        h: args.h,
        fps: args.fps,
        invert: args.invert == 1,
        th_mul: args.th_mul,
        in_dir: frames_dir,
    };

    convert_rectframes_to_file(opts, &rect_path).context("rectFrames generation failed")?;

    Ok(())
}

#[actix_web::main]
async fn main() -> io::Result<()> {
    let args = Args::parse();

    let out_dir = PathBuf::from(&args.dir);
    let frames_dir = PathBuf::from(&args.frames_dir);
    let lyrics_dir = PathBuf::from(&args.lyrics_dir);

    fs::create_dir_all(&out_dir).ok();

    // ✅ Build pipeline before serving
    ensure_rectframes(&out_dir, &frames_dir, &args)
        .context("ensure_rectframes failed")
        .unwrap();

    ensure_subtitle_jsons(&out_dir, &lyrics_dir)
        .context("ensure_subtitle_jsons failed")
        .unwrap();

    let bind_addr = format!("{}:{}", args.host, args.port);

    println!(
        "📡 Serving '{}' at http://{}{}",
        args.dir, bind_addr, args.mount
    );

    HttpServer::new(move || {
        App::new()
            .wrap(
                Cors::default()
                    .allow_any_origin()
                    .allow_any_method()
                    .allow_any_header(),
            )
            .service(
                Files::new(&args.mount, &args.dir)
                    .prefer_utf8(true)
                    .use_last_modified(true),
            )
    })
    .bind(bind_addr)?
    .run()
    .await
}
