//! Reference import: clipboard bytes → validated, deduplicated asset.
//! Rejects unsupported, oversized, or invalid images before persistence.

use crate::domain::{AssetKind, AssetView};
use crate::library::{thumbnails, Library, NewAsset};
use crate::paths::AppPaths;
use uuid::Uuid;

pub const MAX_REFERENCE_BYTES: u64 = 20 * 1024 * 1024;
pub const MAX_BATCH_REFERENCE_BYTES: u64 = 80 * 1024 * 1024;
pub const MAX_REFERENCES_PER_BATCH: usize = 8;
pub const MAX_SIDE_PIXELS: u32 = 12_000;
pub const MAX_TOTAL_PIXELS: u64 = 40_000_000;

pub fn import_image(
    bytes: &[u8],
    paths: &AppPaths,
    library: &Library,
) -> Result<AssetView, String> {
    if bytes.is_empty() {
        return Err("the pasted image is empty".into());
    }
    if bytes.len() as u64 > MAX_REFERENCE_BYTES {
        return Err("references are limited to 20 MB each".into());
    }
    let format = image::guess_format(bytes).map_err(|_| "unsupported image format")?;
    let (media_type, ext) = match format {
        image::ImageFormat::Png => ("image/png", "png"),
        image::ImageFormat::Jpeg => ("image/jpeg", "jpg"),
        image::ImageFormat::WebP => ("image/webp", "webp"),
        _ => return Err("only PNG, JPEG, and WebP references are supported".into()),
    };
    let img = image::load_from_memory_with_format(bytes, format)
        .map_err(|_| "the image could not be decoded")?;
    let (width, height) = (img.width(), img.height());
    if width == 0 || height == 0 {
        return Err("the image is empty".into());
    }
    if width > MAX_SIDE_PIXELS || height > MAX_SIDE_PIXELS {
        return Err("references are limited to 12,000 px on either side".into());
    }
    if width as u64 * height as u64 > MAX_TOTAL_PIXELS {
        return Err("references are limited to 40 megapixels".into());
    }

    let sha256 = crate::generation::runner::sha256_hex(bytes);
    if let Some(existing) = library.find_asset_by_sha(&sha256).map_err(|e| e.to_string())? {
        return Ok(existing);
    }

    let dest = paths.reference_path(&sha256, ext);
    std::fs::write(&dest, bytes).map_err(|e| format!("failed to store reference: {e}"))?;

    let asset_id = Uuid::new_v4().to_string();
    let thumbnail = paths.thumbnail_path(&asset_id);
    thumbnails::create_thumbnail(&dest, &thumbnail)?;

    library
        .insert_asset(NewAsset {
            id: asset_id,
            kind: AssetKind::Reference,
            path: dest.display().to_string(),
            thumbnail_path: Some(thumbnail.display().to_string()),
            media_type: media_type.into(),
            width,
            height,
            byte_size: bytes.len() as u64,
            sha256,
        })
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, AppPaths, Library) {
        let dir = tempfile::tempdir().unwrap();
        let paths = AppPaths::under_root(dir.path()).unwrap();
        let library = Library::open_in_memory().unwrap();
        (dir, paths, library)
    }

    fn png_bytes(w: u32, h: u32) -> Vec<u8> {
        let img = image::RgbaImage::from_pixel(w, h, image::Rgba([10, 200, 120, 255]));
        let mut out = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut out, image::ImageFormat::Png)
            .unwrap();
        out.into_inner()
    }

    #[test]
    fn valid_png_becomes_reference_asset_with_thumbnail() {
        let (_dir, paths, library) = setup();
        let asset = import_image(&png_bytes(64, 32), &paths, &library).unwrap();
        assert_eq!(asset.kind, AssetKind::Reference);
        assert_eq!((asset.width, asset.height), (64, 32));
        assert_eq!(asset.media_type, "image/png");
        assert!(std::path::Path::new(&asset.path).exists());
        assert!(std::path::Path::new(asset.thumbnail_path.as_deref().unwrap()).exists());
    }

    #[test]
    fn duplicate_paste_reuses_the_same_asset() {
        let (_dir, paths, library) = setup();
        let bytes = png_bytes(16, 16);
        let first = import_image(&bytes, &paths, &library).unwrap();
        let second = import_image(&bytes, &paths, &library).unwrap();
        assert_eq!(first.id, second.id);
    }

    #[test]
    fn garbage_and_oversized_inputs_are_rejected() {
        let (_dir, paths, library) = setup();
        assert!(import_image(b"not an image", &paths, &library).is_err());
        assert!(import_image(&[], &paths, &library).is_err());
        let too_big = vec![0u8; (MAX_REFERENCE_BYTES + 1) as usize];
        assert!(import_image(&too_big, &paths, &library).is_err());
    }

    #[test]
    fn unsupported_format_is_rejected() {
        // BMP decodes fine but is not in the allowed set.
        let img = image::RgbaImage::from_pixel(8, 8, image::Rgba([1, 2, 3, 255]));
        let mut out = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut out, image::ImageFormat::Bmp)
            .unwrap();
        let (_dir, paths, library) = setup();
        let result = import_image(&out.into_inner(), &paths, &library);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("PNG, JPEG, and WebP"));
    }
}
