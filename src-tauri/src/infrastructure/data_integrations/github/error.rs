use std::fmt;

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum GithubErrorKind {
    Authentication,
    Authorization,
    NotFound,
    Validation,
    RateLimited,
    Transient,
    Unknown,
}

#[derive(Debug, Clone, Copy, Default, Eq, PartialEq)]
pub struct GithubRateLimit {
    pub limit: Option<u64>,
    pub remaining: Option<u64>,
    pub used: Option<u64>,
    pub reset_epoch_seconds: Option<u64>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum GithubError {
    InvalidBaseUrl,
    InvalidPathSegment,
    InvalidPageSize,
    Transport,
    Http {
        status: u16,
        kind: GithubErrorKind,
        retryable: bool,
        retry_after_seconds: Option<u64>,
        rate_limit: GithubRateLimit,
    },
    InvalidResponse,
}

impl GithubError {
    pub fn kind(&self) -> Option<GithubErrorKind> {
        match self {
            Self::Http { kind, .. } => Some(*kind),
            _ => None,
        }
    }

    pub fn is_retryable(&self) -> bool {
        match self {
            Self::Transport => true,
            Self::Http { retryable, .. } => *retryable,
            Self::InvalidBaseUrl
            | Self::InvalidPathSegment
            | Self::InvalidPageSize
            | Self::InvalidResponse => false,
        }
    }

    pub fn retry_after_seconds(&self) -> Option<u64> {
        match self {
            Self::Http {
                retry_after_seconds,
                ..
            } => *retry_after_seconds,
            _ => None,
        }
    }

    pub fn rate_limit(&self) -> Option<GithubRateLimit> {
        match self {
            Self::Http { rate_limit, .. } => Some(*rate_limit),
            _ => None,
        }
    }
}

impl fmt::Display for GithubError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidBaseUrl => f.write_str("invalid GitHub base URL"),
            Self::InvalidPathSegment => f.write_str("invalid GitHub path segment"),
            Self::InvalidPageSize => f.write_str("invalid GitHub page size"),
            Self::Transport => f.write_str("GitHub transport error"),
            Self::Http {
                status,
                kind,
                retryable,
                ..
            } => write!(
                f,
                "GitHub HTTP error ({status}, {kind:?}, retryable={retryable})"
            ),
            Self::InvalidResponse => f.write_str("invalid GitHub response"),
        }
    }
}

impl std::error::Error for GithubError {}
