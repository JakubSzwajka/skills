//! One-shot icon prep: crop the generated artwork to its rounded square,
//! resize to 1024, and make the macOS icon corners transparent.
//!
//! Usage: cargo run --release --example make_icon -- <src.png> <dest.png>

use image::RgbaImage;

const SIZE: u32 = 1024;
// macOS app-icon corner radius at 1024 px (Apple grid ≈ 22.4%).
const CORNER_RADIUS: f32 = 230.0;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (src, dest) = (&args[1], &args[2]);
    let img = image::open(src).expect("open source").to_rgba8();
    let (w, h) = img.dimensions();

    // Bounding box of non-white, non-transparent pixels (the artwork).
    let (mut min_x, mut min_y, mut max_x, mut max_y) = (w, h, 0u32, 0u32);
    for (x, y, pixel) in img.enumerate_pixels() {
        let [r, g, b, a] = pixel.0;
        let background = a < 10 || (r > 244 && g > 244 && b > 244);
        if !background {
            min_x = min_x.min(x);
            min_y = min_y.min(y);
            max_x = max_x.max(x);
            max_y = max_y.max(y);
        }
    }
    assert!(min_x < max_x && min_y < max_y, "no artwork found");

    let cropped = image::imageops::crop_imm(&img, min_x, min_y, max_x - min_x + 1, max_y - min_y + 1)
        .to_image();
    let mut resized: RgbaImage =
        image::imageops::resize(&cropped, SIZE, SIZE, image::imageops::FilterType::Lanczos3);

    // Transparent rounded corners.
    let r = CORNER_RADIUS;
    let size = SIZE as f32;
    for (x, y, pixel) in resized.enumerate_pixels_mut() {
        let (fx, fy) = (x as f32 + 0.5, y as f32 + 0.5);
        let cx = if fx < r {
            Some(r)
        } else if fx > size - r {
            Some(size - r)
        } else {
            None
        };
        let cy = if fy < r {
            Some(r)
        } else if fy > size - r {
            Some(size - r)
        } else {
            None
        };
        if let (Some(cx), Some(cy)) = (cx, cy) {
            let dist = ((fx - cx).powi(2) + (fy - cy).powi(2)).sqrt();
            if dist > r {
                pixel.0 = [0, 0, 0, 0];
            } else if dist > r - 1.5 {
                // 1.5 px anti-aliased edge.
                let alpha = ((r - dist) / 1.5).clamp(0.0, 1.0);
                pixel.0[3] = (pixel.0[3] as f32 * alpha) as u8;
            }
        }
    }

    resized.save(dest).expect("save icon");
    println!("icon written to {dest}");
}
