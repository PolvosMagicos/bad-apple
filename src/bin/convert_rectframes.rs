use clap::Parser;
use std::path::PathBuf;

use bad_apple::rectframes::{convert_rectframes_to_file, ConvertRectframesOpts};

#[derive(Parser, Debug)]
#[command(author, version, about)]
struct Args {
    #[arg(long, default_value_t = 192)]
    w: u32,

    #[arg(long, default_value_t = 144)]
    h: u32,

    #[arg(long, default_value_t = 30)]
    fps: u32,

    #[arg(long, default_value_t = 0)]
    invert: u8,

    #[arg(long, default_value = "frames")]
    r#in: String,

    #[arg(long, default_value = "out/rectFrames.json")]
    out: String,

    #[arg(long, default_value_t = 0.95)]
    th_mul: f32,
}

fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    let in_dir = PathBuf::from(&args.r#in);
    let out_file = PathBuf::from(&args.out);

    let opts = ConvertRectframesOpts {
        w: args.w,
        h: args.h,
        fps: args.fps,
        invert: args.invert == 1,
        th_mul: args.th_mul,
        in_dir: &in_dir,
    };

    convert_rectframes_to_file(opts, &out_file)
}
