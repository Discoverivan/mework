//! Synthetic review results and discussions for the development PR gallery.
use super::developer_review::{
    PullRequestReviewComment, PullRequestReviewDto, PullRequestReviewResult,
    PullRequestReviewSeverity as Severity, PullRequestReviewStatus, PullRequestReviewVerdict,
};

pub struct FindingFixture {
    pub finding: PullRequestReviewComment,
    pub existing: Option<String>,
    #[cfg(feature = "dev-mock-rest")]
    pub addition: String,
}

pub fn findings(id: u64) -> Vec<FindingFixture> {
    let severities = match id {
        42 => vec![(Severity::Low, "new")],
        43 => vec![
            (Severity::Medium, "full"),
            (Severity::Medium, "partial"),
            (Severity::Medium, "new"),
        ],
        44 => vec![
            (Severity::High, "full"),
            (Severity::High, "partial"),
            (Severity::High, "new"),
        ],
        45 => vec![
            (Severity::Blocker, "new"),
            (Severity::High, "partial"),
            (Severity::Medium, "full"),
            (Severity::Low, "full"),
            (Severity::Low, "partial"),
            (Severity::Low, "new"),
        ],
        _ => vec![],
    };
    severities
        .into_iter()
        .map(|(severity, coverage)| {
            let (name, defect, consequence) = match severity {
                Severity::Blocker => (
                    "blocker",
                    "Preserve the queued records before clearing the buffer.",
                    "Otherwise unsaved records are lost.",
                ),
                Severity::High => (
                    "high",
                    "Wait for pending requests before shutdown.",
                    "Otherwise the final update can be lost.",
                ),
                Severity::Medium => (
                    "medium",
                    "Cancel the previous refresh timer before starting another.",
                    "Otherwise both timers repeat the same request.",
                ),
                Severity::Low => (
                    "low",
                    "Remove the repeated status label.",
                    "Keep the longer explanation in a tooltip.",
                ),
            };
            let comment = format!("{defect} {consequence}");
            FindingFixture {
                finding: PullRequestReviewComment {
                    severity,
                    file: format!("src/example-{name}-{coverage}.ts"),
                    line: Some(1),
                    comment: comment.clone(),
                },
                existing: match coverage {
                    "full" => Some(format!("This is already covered: {defect} {consequence}")),
                    "partial" => Some(defect.to_owned()),
                    _ => None,
                },
                #[cfg(feature = "dev-mock-rest")]
                addition: if coverage == "partial" {
                    consequence.to_owned()
                } else {
                    String::new()
                },
            }
        })
        .collect()
}

pub fn title(id: u64) -> Option<&'static str> {
    match id {
        41 => Some("Approved, no findings"),
        42 => Some("Low findings, new discussion"),
        43 => Some("Medium findings, full and partial overlap"),
        44 => Some("High findings, full and partial overlap"),
        45 => Some("Mixed severities, new and overlapping discussions"),
        46 => Some("AI error, review result validation failed"),
        _ => None,
    }
}

pub fn review(id: u64, now: i64) -> Option<PullRequestReviewDto> {
    title(id)?;
    let comments = findings(id)
        .into_iter()
        .map(|fixture| fixture.finding)
        .collect();
    Some(PullRequestReviewDto {
        run_id: format!("mock-review-{id}"),
        status: if id == 46 {
            PullRequestReviewStatus::Failed
        } else {
            PullRequestReviewStatus::Completed
        },
        reviewed_commit: Some(format!("mock-commit-{id}")),
        result: if id == 46 {
            None
        } else {
            Some(PullRequestReviewResult {
                verdict: if id <= 42 {
                    PullRequestReviewVerdict::Ok
                } else {
                    PullRequestReviewVerdict::NeedsChanges
                },
                description: "An example change used to preview AI review results.".into(),
                summary: if id == 41 {
                    "No findings. The example change is ready to merge."
                } else {
                    "Review the example findings and their existing discussions before publishing."
                }
                .into(),
                comments,
            })
        },
        error: (id == 46).then(|| "AI provider returned an invalid review comment".to_owned()),
        started_at: now - 60_000,
        finished_at: Some(now),
        execution: None,
        instructions_changed: false,
    })
}
