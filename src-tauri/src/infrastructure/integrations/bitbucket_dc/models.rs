use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct BitbucketPage<T> {
    pub values: Vec<T>,
    #[serde(rename = "isLastPage")]
    pub is_last_page: bool,
    #[serde(rename = "nextPageStart")]
    pub next_page_start: Option<u64>,
    pub size: Option<u64>,
    pub total: Option<u64>,
    pub limit: Option<u64>,
    pub start: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BitbucketRepository {
    pub slug: String,
    pub id: u64,
    pub name: String,
    #[serde(rename = "scmId")]
    pub scm_id: String,
    pub state: Option<String>,
    #[serde(rename = "statusMessage")]
    pub status_message: Option<String>,
    pub public: bool,
    pub project: BitbucketProject,
    pub links: Option<BitbucketLinks>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BitbucketProject {
    pub key: String,
    pub id: u64,
    pub name: String,
    pub public: Option<bool>,
    #[serde(rename = "type")]
    pub project_type: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum BitbucketPullRequestAuthor {
    Participant(BitbucketParticipant),
    User(BitbucketUser),
}

#[derive(Debug, Clone, Deserialize)]
pub struct BitbucketDashboardPullRequest {
    pub id: u64,
    pub version: u64,
    pub title: String,
    pub state: String,
    #[serde(default)]
    pub draft: bool,
    pub open: bool,
    pub closed: bool,
    #[serde(rename = "createdDate")]
    pub created_date: Option<i64>,
    #[serde(rename = "updatedDate")]
    pub updated_date: Option<i64>,
    #[serde(rename = "fromRef")]
    pub from_ref: BitbucketRef,
    #[serde(rename = "toRef")]
    pub to_ref: BitbucketRef,
    pub author: Option<BitbucketPullRequestAuthor>,
    #[serde(default)]
    pub reviewers: Vec<BitbucketParticipant>,
    #[serde(default)]
    pub links: Option<BitbucketLinks>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BitbucketPullRequest {
    pub id: u64,
    pub version: u64,
    pub title: String,
    pub description: Option<String>,
    pub state: String,
    pub open: bool,
    pub closed: bool,
    #[serde(rename = "createdDate")]
    pub created_date: Option<i64>,
    #[serde(rename = "updatedDate")]
    pub updated_date: Option<i64>,
    #[serde(rename = "fromRef")]
    pub from_ref: BitbucketRef,
    #[serde(rename = "toRef")]
    pub to_ref: BitbucketRef,
    pub locked: Option<bool>,
    pub author: Option<BitbucketUser>,
    pub reviewers: Vec<BitbucketUser>,
    pub participants: Vec<BitbucketParticipant>,
    pub properties: Option<serde_json::Value>,
    pub links: Option<BitbucketLinks>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BitbucketRef {
    pub id: String,
    #[serde(rename = "displayId")]
    pub display_id: String,
    #[serde(rename = "latestCommit")]
    pub latest_commit: Option<String>,
    pub repository: Option<BitbucketRepositorySummary>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BitbucketRepositorySummary {
    pub slug: Option<String>,
    pub id: Option<u64>,
    pub name: Option<String>,
    pub project: Option<BitbucketProject>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BitbucketUser {
    pub name: Option<String>,
    #[serde(rename = "displayName")]
    pub display_name: Option<String>,
    #[serde(rename = "emailAddress")]
    pub email_address: Option<String>,
    pub id: Option<u64>,
    pub active: Option<bool>,
    pub slug: Option<String>,
    pub links: Option<BitbucketLinks>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BitbucketParticipant {
    pub user: BitbucketUser,
    pub role: String,
    pub approved: Option<bool>,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BitbucketComment {
    pub id: u64,
    pub version: u64,
    pub text: String,
    pub author: Option<BitbucketUser>,
    #[serde(rename = "createdDate")]
    pub created_date: Option<i64>,
    #[serde(rename = "updatedDate")]
    pub updated_date: Option<i64>,
    pub deleted: Option<bool>,
    pub permitted: Option<bool>,
    pub anchor: Option<BitbucketCommentAnchor>,
    pub links: Option<BitbucketLinks>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BitbucketCommentAnchor {
    #[serde(rename = "diffType")]
    pub diff_type: Option<String>,
    pub path: Option<String>,
    pub line: Option<i64>,
    #[serde(rename = "lineType")]
    pub line_type: Option<String>,
    #[serde(rename = "srcPath")]
    pub src_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BitbucketBuildStatus {
    pub key: String,
    pub state: String,
    pub name: Option<String>,
    pub url: Option<String>,
    pub description: Option<String>,
    #[serde(rename = "dateAdded")]
    pub date_added: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BitbucketLinks {
    #[serde(rename = "self")]
    pub self_link: Option<Vec<BitbucketLink>>,
    pub avatar: Option<Vec<BitbucketLink>>,
    pub clone: Option<Vec<BitbucketLink>>,
    pub commits: Option<Vec<BitbucketLink>>,
    pub comments: Option<Vec<BitbucketLink>>,
    pub activity: Option<Vec<BitbucketLink>>,
    pub overview: Option<Vec<BitbucketLink>>,
    pub diff: Option<Vec<BitbucketLink>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BitbucketLink {
    pub href: String,
    pub name: Option<String>,
}
