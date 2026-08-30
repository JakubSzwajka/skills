//! Platform directory layout. See DESIGN.md "File layout".

use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct AppPaths {
    pub data_dir: PathBuf,
    pub db_path: PathBuf,
    pub output_root: PathBuf,
    pub references_dir: PathBuf,
    pub thumbnails_dir: PathBuf,
    pub jobs_dir: PathBuf,
    pub logs_dir: PathBuf,
}

impl AppPaths {
    pub fn new(data_dir: PathBuf, output_root: PathBuf) -> std::io::Result<Self> {
        let paths = Self {
            db_path: data_dir.join("library.sqlite"),
            references_dir: data_dir.join("references"),
            thumbnails_dir: data_dir.join("thumbnails"),
            jobs_dir: data_dir.join("jobs"),
            logs_dir: data_dir.join("logs"),
            data_dir,
            output_root,
        };
        for dir in [
            &paths.data_dir,
            &paths.references_dir,
            &paths.thumbnails_dir,
            &paths.jobs_dir,
            &paths.logs_dir,
            &paths.output_root,
        ] {
            std::fs::create_dir_all(dir)?;
        }
        Ok(paths)
    }

    /// Everything under one root; used by tests.
    pub fn under_root(root: &Path) -> std::io::Result<Self> {
        Self::new(root.join("app-data"), root.join("pictures"))
    }

    /// `<output_root>/YYYY/MM/<job_id>.<ext>` (UTC calendar).
    pub fn output_path_for_job(&self, job_id: &str, ext: &str, at_millis: i64) -> PathBuf {
        let (year, month) = civil_year_month(at_millis / 1000);
        self.output_root
            .join(format!("{year:04}"))
            .join(format!("{month:02}"))
            .join(format!("{job_id}.{ext}"))
    }

    pub fn thumbnail_path(&self, asset_id: &str) -> PathBuf {
        self.thumbnails_dir.join(format!("{asset_id}.webp"))
    }

    pub fn reference_path(&self, sha256: &str, ext: &str) -> PathBuf {
        self.references_dir.join(format!("{sha256}.{ext}"))
    }

    pub fn job_workspace(&self, job_id: &str) -> PathBuf {
        self.jobs_dir.join(job_id)
    }
}

/// Days-to-civil conversion (Howard Hinnant's algorithm), UTC.
fn civil_year_month(unix_seconds: i64) -> (i64, u32) {
    let days = unix_seconds.div_euclid(86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    (year, m as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_conversion_matches_known_dates() {
        // 2026-08-30 ~ 1_787_000_000
        assert_eq!(civil_year_month(1_787_000_000), (2026, 8));
        // Unix epoch
        assert_eq!(civil_year_month(0), (1970, 1));
    }

    #[test]
    fn output_path_uses_year_month_layout() {
        let dir = tempfile::tempdir().unwrap();
        let paths = AppPaths::under_root(dir.path()).unwrap();
        let p = paths.output_path_for_job("job-1", "png", 1_787_000_000_000);
        assert!(p.ends_with("2026/08/job-1.png"));
    }
}
