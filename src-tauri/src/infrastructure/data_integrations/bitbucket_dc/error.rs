use std::fmt;

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum BitbucketHttpErrorKind {
    Authentication,
    PermissionDenied,
    RateLimited,
    Server,
    Client,
    Other,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum BitbucketDcError {
    InvalidBaseUrl,
    InvalidRequest,
    InvalidCredentials,
    Transport,
    Http {
        status: u16,
        kind: BitbucketHttpErrorKind,
        retryable: bool,
        retry_after_seconds: Option<u64>,
        detail: Option<String>,
    },
    InvalidResponse,
}

impl BitbucketDcError {
    pub fn is_retryable(&self) -> bool {
        match self {
            Self::Http { retryable, .. } => *retryable,
            Self::Transport => true,
            Self::InvalidBaseUrl
            | Self::InvalidRequest
            | Self::InvalidCredentials
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

    pub fn http_kind(&self) -> Option<BitbucketHttpErrorKind> {
        match self {
            Self::Http { kind, .. } => Some(*kind),
            _ => None,
        }
    }

    pub fn is_authentication_error(&self) -> bool {
        self.http_kind() == Some(BitbucketHttpErrorKind::Authentication)
    }

    pub fn is_permission_error(&self) -> bool {
        self.http_kind() == Some(BitbucketHttpErrorKind::PermissionDenied)
    }

    pub fn is_rate_limited(&self) -> bool {
        self.http_kind() == Some(BitbucketHttpErrorKind::RateLimited)
    }
}

impl fmt::Display for BitbucketDcError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidBaseUrl => f.write_str("invalid Bitbucket Data Center base URL"),
            Self::InvalidRequest => f.write_str("invalid Bitbucket Data Center request"),
            Self::InvalidCredentials => f.write_str("invalid Bitbucket Data Center credentials"),
            Self::Transport => f.write_str("Bitbucket Data Center transport error"),
            Self::Http { status, .. } => write!(f, "Bitbucket Data Center HTTP error ({status})"),
            Self::InvalidResponse => f.write_str("invalid Bitbucket Data Center response"),
        }
    }
}

impl std::error::Error for BitbucketDcError {}
