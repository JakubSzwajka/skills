//! Thumbnail generation. Gallery cards never load originals.

use image::codecs::webp::WebPEncoder;
use image::ExtendedColorType;
use std::io::BufWriter;
use std::path::Path;

pub const MAX_THUMBNAIL_DIM: u32 = 512;

/// Decode `src`, downscale to at most 512 px on the long side, and write a
/// lossless WebP to `dest`. Returns the thumbnail dimensions.
pub fn create_thumbnail(src: &Path, dest: &Path) -> Result<(u32, u32), String> {
    let img = image::open(src).map_err(|e| format!("thumbnail decode failed: {e}"))?;
    let thumb = img.thumbnail(MAX_THUMBNAIL_DIM, MAX_THUMBNAIL_DIM);
    let rgba = thumb.to_rgba8();
    let (w, h) = rgba.dimensions();
    if let Some(parent) = dest.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let file = std::fs::File::create(dest).map_err(|e| format!("thumbnail write failed: {e}"))?;
    WebPEncoder::new_lossless(BufWriter::new(file))
        .encode(&rgba, w, h, ExtendedColorType::Rgba8)
        .map_err(|e| format!("thumbnail encode failed: {e}"))?;
    Ok((w, h))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::RgbaImage;

    #[test]
    fn creates_downscaled_webp() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("src.png");
        let dest = dir.path().join("thumb.webp");
        RgbaImage::from_pixel(1024, 768, image::Rgba([200, 30, 30, 255]))
            .save(&src)
            .unwrap();
        let (w, h) = create_thumbnail(&src, &dest).unwrap();
        assert!(w <= MAX_THUMBNAIL_DIM && h <= MAX_THUMBNAIL_DIM);
        assert!(dest.exists());
        let thumb = image::open(&dest).unwrap();
        assert!(thumb.width() <= MAX_THUMBNAIL_DIM);
    }
}
