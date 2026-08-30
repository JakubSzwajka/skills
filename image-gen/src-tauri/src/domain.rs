//! Domain vocabulary shared by every module. See DESIGN.md "Domain model".

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Openai,
    Antigravity,
}

impl Provider {
    pub const ALL: [Provider; 2] = [Provider::Openai, Provider::Antigravity];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Openai => "openai",
            Self::Antigravity => "antigravity",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "openai" => Some(Self::Openai),
            "antigravity" => Some(Self::Antigravity),
            _ => None,
        }
    }

    /// Name of the CLI binary this provider adapter launches.
    pub fn binary_name(self) -> &'static str {
        match self {
            Self::Openai => "codex",
            Self::Antigravity => "agy",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Queued,
    Running,
    Succeeded,
    Failed,
    Cancelled,
    Interrupted,
}

impl JobStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::Interrupted => "interrupted",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "queued" => Some(Self::Queued),
            "running" => Some(Self::Running),
            "succeeded" => Some(Self::Succeeded),
            "failed" => Some(Self::Failed),
            "cancelled" => Some(Self::Cancelled),
            "interrupted" => Some(Self::Interrupted),
            _ => None,
        }
    }

    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Succeeded | Self::Failed | Self::Cancelled | Self::Interrupted
        )
    }

    /// Job rows are immutable attempts; only these transitions are legal.
    pub fn can_transition(self, to: JobStatus) -> bool {
        match self {
            Self::Queued => matches!(to, Self::Running | Self::Cancelled | Self::Interrupted),
            Self::Running => matches!(
                to,
                Self::Succeeded | Self::Failed | Self::Cancelled | Self::Interrupted
            ),
            _ => false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    ProviderUnavailable,
    AuthenticationRequired,
    QuotaExhausted,
    BackendError,
    PermissionDenied,
    Timeout,
    InvalidOutput,
    Cancelled,
    Interrupted,
    Unknown,
}

impl ErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ProviderUnavailable => "provider_unavailable",
            Self::AuthenticationRequired => "authentication_required",
            Self::QuotaExhausted => "quota_exhausted",
            Self::BackendError => "backend_error",
            Self::PermissionDenied => "permission_denied",
            Self::Timeout => "timeout",
            Self::InvalidOutput => "invalid_output",
            Self::Cancelled => "cancelled",
            Self::Interrupted => "interrupted",
            Self::Unknown => "unknown",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "provider_unavailable" => Some(Self::ProviderUnavailable),
            "authentication_required" => Some(Self::AuthenticationRequired),
            "quota_exhausted" => Some(Self::QuotaExhausted),
            "backend_error" => Some(Self::BackendError),
            "permission_denied" => Some(Self::PermissionDenied),
            "timeout" => Some(Self::Timeout),
            "invalid_output" => Some(Self::InvalidOutput),
            "cancelled" => Some(Self::Cancelled),
            "interrupted" => Some(Self::Interrupted),
            "unknown" => Some(Self::Unknown),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AssetKind {
    Generated,
    Reference,
}

impl AssetKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Generated => "generated",
            Self::Reference => "reference",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "generated" => Some(Self::Generated),
            "reference" => Some(Self::Reference),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetView {
    pub id: String,
    pub kind: AssetKind,
    pub path: String,
    pub thumbnail_path: Option<String>,
    pub media_type: String,
    pub width: u32,
    pub height: u32,
    pub byte_size: u64,
    pub sha256: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobView {
    pub id: String,
    pub batch_id: String,
    pub provider: Provider,
    pub variant_index: u32,
    pub status: JobStatus,
    pub retry_of_job_id: Option<String>,
    pub error_code: Option<ErrorCode>,
    pub error_message: Option<String>,
    pub created_at: i64,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
    pub output_asset: Option<AssetView>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchView {
    pub id: String,
    pub prompt: String,
    pub variant_count: u32,
    pub created_at: i64,
    pub jobs: Vec<JobView>,
    pub references: Vec<AssetView>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cursor {
    pub created_at: i64,
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPage {
    pub batches: Vec<BatchView>,
    pub next_cursor: Option<Cursor>,
}

pub fn now_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queued_transitions() {
        assert!(JobStatus::Queued.can_transition(JobStatus::Running));
        assert!(JobStatus::Queued.can_transition(JobStatus::Cancelled));
        assert!(JobStatus::Queued.can_transition(JobStatus::Interrupted));
        assert!(!JobStatus::Queued.can_transition(JobStatus::Succeeded));
        assert!(!JobStatus::Queued.can_transition(JobStatus::Failed));
    }

    #[test]
    fn running_transitions() {
        assert!(JobStatus::Running.can_transition(JobStatus::Succeeded));
        assert!(JobStatus::Running.can_transition(JobStatus::Failed));
        assert!(JobStatus::Running.can_transition(JobStatus::Cancelled));
        assert!(JobStatus::Running.can_transition(JobStatus::Interrupted));
        assert!(!JobStatus::Running.can_transition(JobStatus::Queued));
    }

    #[test]
    fn terminal_states_are_frozen() {
        for terminal in [
            JobStatus::Succeeded,
            JobStatus::Failed,
            JobStatus::Cancelled,
            JobStatus::Interrupted,
        ] {
            assert!(terminal.is_terminal());
            for to in [
                JobStatus::Queued,
                JobStatus::Running,
                JobStatus::Succeeded,
                JobStatus::Failed,
                JobStatus::Cancelled,
                JobStatus::Interrupted,
            ] {
                assert!(!terminal.can_transition(to));
            }
        }
    }
}
