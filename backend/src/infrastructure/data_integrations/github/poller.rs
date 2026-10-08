use super::client::{GithubClient, GithubRequestCache};
use super::error::GithubError;
use super::models::{
    GithubCheckRun, GithubComment, GithubCommit, GithubCommitStatusResponse, GithubPullRequest,
    GithubPullRequestLifecycle, GithubPullRequestTransition, GithubReview, GithubReviewRequest,
};

#[derive(Debug, Clone)]
pub struct GithubPullRequestSnapshot {
    pub pull_request: GithubPullRequest,
    pub reviews: Vec<GithubReview>,
    pub review_comments: Vec<GithubComment>,
    pub issue_comments: Vec<GithubComment>,
    pub review_requests: GithubReviewRequest,
    pub commits: Vec<GithubCommit>,
    pub check_runs: Vec<GithubCheckRun>,
    pub commit_status: Option<GithubCommitStatusResponse>,
    pub transition: Option<GithubPullRequestTransition>,
}

pub struct GithubPoller<'a> {
    client: &'a GithubClient,
    page_size: u32,
}

impl<'a> GithubPoller<'a> {
    pub fn new(client: &'a GithubClient, page_size: u32) -> Result<Self, GithubError> {
        if !(1..=100).contains(&page_size) {
            return Err(GithubError::InvalidPageSize);
        }
        Ok(Self { client, page_size })
    }

    pub async fn poll_pull_request(
        &self,
        owner: &str,
        repo: &str,
        number: u64,
        previous: Option<GithubPullRequestLifecycle>,
        cache: &mut GithubRequestCache,
    ) -> Result<GithubPullRequestSnapshot, GithubError> {
        let pull_request = self
            .client
            .get_pull_request(owner, repo, number, cache)
            .await?
            .value
            .ok_or(GithubError::InvalidResponse)?;
        let head_sha = pull_request.head.sha.clone();
        let reviews = self
            .client
            .list_reviews(owner, repo, number, self.page_size, cache)
            .await?
            .items;
        let review_comments = self
            .client
            .list_review_comments(owner, repo, number, self.page_size, cache)
            .await?
            .items;
        let issue_comments = self
            .client
            .list_issue_comments(owner, repo, number, self.page_size, cache)
            .await?
            .items;
        let review_requests = self
            .client
            .list_review_requests(owner, repo, number, cache)
            .await?
            .value
            .ok_or(GithubError::InvalidResponse)?;
        let commits = self
            .client
            .list_commits(owner, repo, number, self.page_size, cache)
            .await?
            .items;
        let check_runs = self
            .client
            .list_check_runs(owner, repo, &head_sha, self.page_size, cache)
            .await?
            .items;
        let commit_status = self
            .client
            .get_commit_status(owner, repo, &head_sha, cache)
            .await?
            .value;
        let lifecycle = GithubPullRequestLifecycle::from_pull_request(&pull_request);
        Ok(GithubPullRequestSnapshot {
            pull_request,
            reviews,
            review_comments,
            issue_comments,
            review_requests,
            commits,
            check_runs,
            commit_status,
            transition: GithubPullRequestTransition::between(previous, lifecycle),
        })
    }

    pub async fn poll_repository(
        &self,
        owner: &str,
        repo: &str,
        state: &str,
        previous: &std::collections::HashMap<u64, GithubPullRequestLifecycle>,
        cache: &mut GithubRequestCache,
    ) -> Result<Vec<GithubPullRequestSnapshot>, GithubError> {
        let pull_requests = self
            .client
            .list_pull_requests(owner, repo, state, self.page_size, cache)
            .await?
            .items;
        let mut snapshots = Vec::with_capacity(pull_requests.len());
        for pull_request in pull_requests {
            let number = pull_request.number;
            snapshots.push(
                self.poll_pull_request(owner, repo, number, previous.get(&number).copied(), cache)
                    .await?,
            );
        }
        Ok(snapshots)
    }
}
