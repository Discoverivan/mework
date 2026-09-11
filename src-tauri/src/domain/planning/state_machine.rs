use serde::{Deserialize, Serialize};
use std::fmt;

/// Durable planning lifecycle, including the explicit unlock handshake.
#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanningState {
    Draft,
    Applying,
    PartiallySynced,
    Locked,
    Conflict,
    UnlockRequested,
}

impl PlanningState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::Applying => "applying",
            Self::PartiallySynced => "partially_synced",
            Self::Locked => "locked",
            Self::Conflict => "conflict",
            Self::UnlockRequested => "unlock_requested",
        }
    }

    pub fn can_transition_to(self, next: Self) -> bool {
        matches!(
            (self, next),
            (Self::Draft, Self::Applying)
                | (Self::Draft, Self::Conflict)
                | (Self::Applying, Self::Locked)
                | (Self::Applying, Self::PartiallySynced)
                | (Self::Applying, Self::Conflict)
                | (Self::PartiallySynced, Self::Applying)
                | (Self::PartiallySynced, Self::Conflict)
                | (Self::Conflict, Self::Draft)
                | (Self::Conflict, Self::Applying)
                | (Self::Locked, Self::UnlockRequested)
                | (Self::Locked, Self::Conflict)
                | (Self::UnlockRequested, Self::Draft)
        )
    }
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum StateMachineError {
    StaleRevision {
        expected: i64,
        actual: i64,
    },
    StaleRemoteRevision {
        expected: Option<String>,
        actual: Option<String>,
    },
    InvalidTransition {
        from: PlanningState,
        to: PlanningState,
    },
}

impl fmt::Display for StateMachineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::StaleRevision { expected, actual } => {
                write!(
                    f,
                    "stale planning revision: expected {expected}, actual {actual}"
                )
            }
            Self::StaleRemoteRevision { .. } => f.write_str("stale Jira planning revision"),
            Self::InvalidTransition { from, to } => {
                write!(
                    f,
                    "invalid planning transition: {} -> {}",
                    from.as_str(),
                    to.as_str()
                )
            }
        }
    }
}

impl std::error::Error for StateMachineError {}

/// Small, persistence-friendly state transition core.
#[derive(Debug, Clone, Eq, PartialEq)]
pub struct PlanningStateMachine {
    state: PlanningState,
    revision: i64,
    remote_revision: Option<String>,
}

impl PlanningStateMachine {
    pub fn new(revision: i64, remote_revision: Option<String>) -> Self {
        Self {
            state: PlanningState::Draft,
            revision,
            remote_revision,
        }
    }

    pub fn from_parts(
        state: PlanningState,
        revision: i64,
        remote_revision: Option<String>,
    ) -> Self {
        Self {
            state,
            revision,
            remote_revision,
        }
    }

    pub fn state(&self) -> PlanningState {
        self.state
    }

    pub fn revision(&self) -> i64 {
        self.revision
    }

    pub fn remote_revision(&self) -> Option<&str> {
        self.remote_revision.as_deref()
    }

    pub fn transition(
        &mut self,
        next: PlanningState,
        expected_revision: i64,
    ) -> Result<(), StateMachineError> {
        self.check_revision(expected_revision)?;
        self.check_transition(next)?;
        self.state = next;
        self.revision += 1;
        Ok(())
    }

    pub fn begin_apply(
        &mut self,
        expected_revision: i64,
        observed_remote_revision: Option<&str>,
    ) -> Result<(), StateMachineError> {
        self.check_revision(expected_revision)?;
        self.check_remote_revision(observed_remote_revision)?;
        self.transition(PlanningState::Applying, expected_revision)
    }

    pub fn finish_success(&mut self, expected_revision: i64) -> Result<(), StateMachineError> {
        self.transition(PlanningState::Locked, expected_revision)
    }

    pub fn finish_partial(&mut self, expected_revision: i64) -> Result<(), StateMachineError> {
        self.transition(PlanningState::PartiallySynced, expected_revision)
    }

    pub fn mark_conflict(&mut self, expected_revision: i64) -> Result<(), StateMachineError> {
        self.transition(PlanningState::Conflict, expected_revision)
    }

    pub fn request_unlock(&mut self, expected_revision: i64) -> Result<(), StateMachineError> {
        self.transition(PlanningState::UnlockRequested, expected_revision)
    }

    pub fn confirm_unlock(&mut self, expected_revision: i64) -> Result<(), StateMachineError> {
        self.transition(PlanningState::Draft, expected_revision)
    }

    /// Compare Jira's marker before an apply. This never silently unlocks a workspace.
    pub fn detect_remote_conflict(
        &mut self,
        observed_remote_revision: Option<&str>,
    ) -> Result<(), StateMachineError> {
        if self.remote_revision.as_deref() == observed_remote_revision {
            return Ok(());
        }
        let expected = self.remote_revision.clone();
        let actual = observed_remote_revision.map(str::to_owned);
        if self.state != PlanningState::Conflict {
            self.check_transition(PlanningState::Conflict)?;
            self.state = PlanningState::Conflict;
            self.revision += 1;
        }
        Err(StateMachineError::StaleRemoteRevision { expected, actual })
    }

    pub fn set_remote_revision(&mut self, remote_revision: Option<String>) {
        self.remote_revision = remote_revision;
    }

    fn check_revision(&self, expected_revision: i64) -> Result<(), StateMachineError> {
        if expected_revision == self.revision {
            Ok(())
        } else {
            Err(StateMachineError::StaleRevision {
                expected: expected_revision,
                actual: self.revision,
            })
        }
    }

    #[allow(dead_code)]
    fn check_remote_revision(
        &self,
        observed_remote_revision: Option<&str>,
    ) -> Result<(), StateMachineError> {
        if self.remote_revision.as_deref() == observed_remote_revision {
            Ok(())
        } else {
            Err(self.remote_revision_error(observed_remote_revision))
        }
    }

    fn remote_revision_error(&self, observed_remote_revision: Option<&str>) -> StateMachineError {
        StateMachineError::StaleRemoteRevision {
            expected: self.remote_revision.clone(),
            actual: observed_remote_revision.map(str::to_owned),
        }
    }

    fn check_transition(&self, next: PlanningState) -> Result<(), StateMachineError> {
        if self.state.can_transition_to(next) {
            Ok(())
        } else {
            Err(StateMachineError::InvalidTransition {
                from: self.state,
                to: next,
            })
        }
    }
}
