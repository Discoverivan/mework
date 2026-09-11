use std::fmt;

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum JiraError {
    InvalidBaseUrl,
    Transport,
    Http {
        status: u16,
        retryable: bool,
        retry_after_seconds: Option<u64>,
    },
    InvalidResponse,
    InvalidResponseDetails(String),
    UnsupportedCapability,
}

impl JiraError {
    pub fn status(&self) -> Option<u16> {
        match self {
            Self::Http { status, .. } => Some(*status),
            _ => None,
        }
    }

    pub fn is_retryable(&self) -> bool {
        match self {
            Self::Http { retryable, .. } => *retryable,
            Self::Transport => true,
            Self::InvalidBaseUrl
            | Self::InvalidResponse
            | Self::InvalidResponseDetails(_)
            | Self::UnsupportedCapability => false,
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
}

impl fmt::Display for JiraError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidBaseUrl => f.write_str("invalid Jira base URL"),
            Self::Transport => f.write_str("Jira transport error"),
            Self::Http { status, .. } => write!(f, "Jira HTTP error ({status})"),
            Self::InvalidResponse => f.write_str("invalid Jira response"),
            Self::InvalidResponseDetails(details) => write!(f, "invalid Jira response: {details}"),
            Self::UnsupportedCapability => f.write_str("unsupported Jira capability"),
        }
    }
}

impl std::error::Error for JiraError {}
