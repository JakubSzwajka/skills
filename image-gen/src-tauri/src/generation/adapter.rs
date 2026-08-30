//! Provider adapter seam. Adapters build a `CommandSpec`; the runner
//! executes it. This keeps command construction testable without
//! spawning processes.

use crate::domain::{ErrorCode, Provider};
use std::path::{Path, PathBuf};

/// Credential variables removed from every child process, both providers.
pub const CREDENTIAL_ENV_VARS: &[&str] = &[
    // OpenAI / Codex
    "OPENAI_API_KEY",
    "CODEX_API_KEY",
    "CODEX_ACCESS_TOKEN",
    // Google / Antigravity / Cloud
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_CLOUD_PROJECT",
    "GOOGLE_CLOUD_LOCATION",
    "GOOGLE_CLOUD_QUOTA_PROJECT",
    "GCLOUD_PROJECT",
    "CLOUDSDK_CORE_PROJECT",
    "GOOGLE_GENAI_USE_VERTEXAI",
    "GOOGLE_GENAI_USE_GCA",
];

/// One provider invocation: absolute program, argument array, optional
/// stdin payload. Never `sh -c`, never a concatenated command string.
#[derive(Debug, Clone)]
pub struct CommandSpec {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub stdin: Option<String>,
    pub cwd: PathBuf,
    pub env_remove: &'static [&'static str],
}

/// Everything an adapter needs to build one invocation.
#[derive(Debug, Clone)]
pub struct JobRequest {
    pub prompt: String,
    pub workspace: PathBuf,
    pub output_path: PathBuf,
    pub reference_files: Vec<PathBuf>,
}

pub trait ProviderAdapter: Send + Sync {
    fn provider(&self) -> Provider;
    fn build_command(&self, executable: &Path, request: &JobRequest) -> CommandSpec;
    fn classify_failure(&self, diagnostics: &str) -> ErrorCode {
        classify_common(diagnostics)
    }
}

pub fn adapter_for(provider: Provider) -> Box<dyn ProviderAdapter> {
    match provider {
        Provider::Openai => Box::new(super::openai::OpenAiAdapter),
        Provider::Antigravity => Box::new(super::antigravity::AntigravityAdapter),
    }
}

/// Shared prompt section identifying each reference path clearly.
pub fn reference_section(reference_files: &[PathBuf]) -> String {
    if reference_files.is_empty() {
        return String::new();
    }
    let mut out = String::from(
        "Use the following image files in this directory as visual reference context:\n",
    );
    for (index, path) in reference_files.iter().enumerate() {
        out.push_str(&format!("- Reference {}: {}\n", index + 1, path.display()));
    }
    out.push('\n');
    out
}

/// Normalize provider failure text into one error code.
pub fn classify_common(diagnostics: &str) -> ErrorCode {
    let lower = diagnostics.to_lowercase();
    let has = |needle: &str| lower.contains(needle);
    if has("http 500") || has("500 internal") || has("internal server error") || has("\"code\": 500")
    {
        ErrorCode::BackendError
    } else if has("not logged in")
        || has("login required")
        || has("please log in")
        || has("please sign in")
        || has("unauthorized")
        || has("401")
        || has("authentication")
    {
        ErrorCode::AuthenticationRequired
    } else if has("quota") || has("rate limit") || has("resource_exhausted") || has("429") {
        ErrorCode::QuotaExhausted
    } else if has("permission denied") || has("permission_denied") || has("403") {
        ErrorCode::PermissionDenied
    } else if has("timed out") || has("timeout") {
        ErrorCode::Timeout
    } else if has("unavailable") || has("503") || has("connection refused") || has("network") {
        ErrorCode::ProviderUnavailable
    } else {
        ErrorCode::Unknown
    }
}

/// Keep a short, redacted diagnostic trail. Strips URLs (which can carry
/// auth material) and long token-like strings, then truncates.
pub fn redact(diagnostics: &str) -> String {
    let mut cleaned = String::with_capacity(diagnostics.len().min(1200));
    for token in diagnostics.split_whitespace() {
        let safe = if token.starts_with("http://") || token.starts_with("https://") {
            "[url]"
        } else if token.len() > 80 {
            "[redacted]"
        } else {
            token
        };
        if !cleaned.is_empty() {
            cleaned.push(' ');
        }
        cleaned.push_str(safe);
    }
    // Keep the tail; provider CLIs print the real error last.
    let max = 800;
    if cleaned.len() > max {
        let start = cleaned.len() - max;
        let boundary = cleaned
            .char_indices()
            .map(|(i, _)| i)
            .find(|&i| i >= start)
            .unwrap_or(start);
        cleaned = format!("…{}", &cleaned[boundary..]);
    }
    cleaned
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn antigravity_http_500_is_backend_error() {
        assert_eq!(
            classify_common("Error: generate_image failed: HTTP 500 INTERNAL"),
            ErrorCode::BackendError
        );
    }

    #[test]
    fn auth_quota_permission_timeout_unavailable() {
        assert_eq!(
            classify_common("You are not logged in. Run: codex login"),
            ErrorCode::AuthenticationRequired
        );
        assert_eq!(
            classify_common("429 rate limit exceeded"),
            ErrorCode::QuotaExhausted
        );
        assert_eq!(
            classify_common("permission denied while writing"),
            ErrorCode::PermissionDenied
        );
        assert_eq!(classify_common("request timed out"), ErrorCode::Timeout);
        assert_eq!(
            classify_common("service unavailable"),
            ErrorCode::ProviderUnavailable
        );
        assert_eq!(classify_common("???"), ErrorCode::Unknown);
    }

    #[test]
    fn redact_strips_urls_and_long_tokens() {
        let input = format!(
            "visit https://auth.example.com/oauth?token=abc token {}",
            "x".repeat(200)
        );
        let out = redact(&input);
        assert!(!out.contains("auth.example.com"));
        assert!(out.contains("[url]"));
        assert!(out.contains("[redacted]"));
    }

    #[test]
    fn credential_list_covers_generate_sh() {
        for var in [
            "OPENAI_API_KEY",
            "CODEX_API_KEY",
            "CODEX_ACCESS_TOKEN",
            "GEMINI_API_KEY",
            "GOOGLE_API_KEY",
            "GOOGLE_APPLICATION_CREDENTIALS",
            "GOOGLE_CLOUD_PROJECT",
            "GOOGLE_CLOUD_LOCATION",
            "GOOGLE_CLOUD_QUOTA_PROJECT",
            "GCLOUD_PROJECT",
            "CLOUDSDK_CORE_PROJECT",
            "GOOGLE_GENAI_USE_VERTEXAI",
            "GOOGLE_GENAI_USE_GCA",
        ] {
            assert!(CREDENTIAL_ENV_VARS.contains(&var), "missing {var}");
        }
    }
}
