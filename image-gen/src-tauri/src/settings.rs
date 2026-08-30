//! Narrow first-release settings: output directory and provider
//! executable paths. Never credentials.

use crate::domain::Provider;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub output_dir: Option<String>,
    pub codex_path: Option<String>,
    pub agy_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveSettings {
    pub stored: Settings,
    pub resolved_output_dir: String,
    pub resolved_codex: Option<String>,
    pub resolved_agy: Option<String>,
}

impl Settings {
    pub fn configured_path(&self, provider: Provider) -> Option<&str> {
        match provider {
            Provider::Openai => self.codex_path.as_deref(),
            Provider::Antigravity => self.agy_path.as_deref(),
        }
    }
}

fn settings_file(data_dir: &Path) -> PathBuf {
    data_dir.join("settings.json")
}

pub fn load(data_dir: &Path) -> Settings {
    std::fs::read_to_string(settings_file(data_dir))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn save(data_dir: &Path, settings: &Settings) -> Result<(), String> {
    let _ = std::fs::create_dir_all(data_dir);
    let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(settings_file(data_dir), text).map_err(|e| e.to_string())
}

/// Resolve a provider executable without a login shell. An explicit
/// setting wins strictly: if it is invalid we fail clearly instead of
/// silently running some other binary. With no setting, probe known
/// local install locations. Never `sh -c`, never PATH from a Finder
/// launch.
pub fn resolve_executable(provider: Provider, configured: Option<&str>) -> Option<PathBuf> {
    if let Some(path) = configured {
        let path = PathBuf::from(path);
        return is_executable(&path).then_some(path);
    }
    discover_executable(provider)
}

/// Probe known local install locations for an unset provider path.
pub fn discover_executable(provider: Provider) -> Option<PathBuf> {
    let name = provider.binary_name();
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        candidates.push(home.join(".local/bin").join(name));
        candidates.push(home.join("bin").join(name));
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin").join(name));
    candidates.push(PathBuf::from("/usr/local/bin").join(name));
    candidates.into_iter().find(|p| is_executable(p))
}

fn is_executable(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        path.metadata()
            .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        path.is_file()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_returns_default_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        let s = load(dir.path());
        assert!(s.output_dir.is_none());
    }

    #[test]
    fn save_and_load_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let s = Settings {
            output_dir: Some("/tmp/out".into()),
            codex_path: Some("/tmp/codex".into()),
            agy_path: None,
        };
        save(dir.path(), &s).unwrap();
        let loaded = load(dir.path());
        assert_eq!(loaded.output_dir.as_deref(), Some("/tmp/out"));
        assert_eq!(loaded.codex_path.as_deref(), Some("/tmp/codex"));
    }

    #[test]
    fn configured_executable_wins_when_valid() {
        let dir = tempfile::tempdir().unwrap();
        let fake = dir.path().join("codex");
        std::fs::write(&fake, "#!/bin/sh\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let found = resolve_executable(Provider::Openai, Some(fake.to_str().unwrap()));
        assert_eq!(found, Some(fake));
    }

    #[test]
    fn invalid_configured_path_never_falls_back() {
        // A wrong explicit path must fail clearly, not silently run some
        // other binary found by discovery.
        assert_eq!(
            resolve_executable(Provider::Openai, Some("/nonexistent/codex")),
            None
        );
        let dir = tempfile::tempdir().unwrap();
        let plain = dir.path().join("codex");
        std::fs::write(&plain, "not a program").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&plain, std::fs::Permissions::from_mode(0o644)).unwrap();
            assert_eq!(
                resolve_executable(Provider::Openai, Some(plain.to_str().unwrap())),
                None
            );
        }
    }
}
