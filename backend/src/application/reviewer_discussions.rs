use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::infrastructure::data_integrations::bitbucket_dc::models::{
    BitbucketComment, BitbucketPullRequestActivity, BitbucketUser,
};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DiscussionChangeKind {
    Reply,
    Mention,
    Resolved,
    Reopened,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiscussionChange {
    pub revision: u64,
    pub comment_id: u64,
    pub kind: DiscussionChangeKind,
    pub actor: Option<String>,
    pub updated_at: Option<i64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiscussionStatus {
    pub revision: u64,
    pub changes: Vec<DiscussionChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct CommentCheckpoint {
    text_hash: String,
    state: Option<String>,
    #[serde(default)]
    thread_resolved: Option<bool>,
}

/// Independent of the reviewed commit and the code's read checkpoint. No comment bodies.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiscussionState {
    account_key: String,
    initialized: bool,
    comments: BTreeMap<u64, CommentCheckpoint>,
    pub status: DiscussionStatus,
}

impl DiscussionState {
    pub fn observe(&mut self, activities: &[BitbucketPullRequestActivity], account_key: &str) {
        let account_key = account_key.trim();
        if account_key.is_empty() {
            return;
        }
        if !self.account_key.eq_ignore_ascii_case(account_key) {
            *self = Self {
                account_key: account_key.to_owned(),
                status: DiscussionStatus {
                    revision: self.status.revision.saturating_add(1),
                    changes: Vec::new(),
                },
                ..Self::default()
            };
        }
        // Activities are newest first. Nested replies may also appear separately in the feed.
        let mut comments = BTreeMap::new();
        let mut own_threads = HashSet::new();
        let mut aliases = HashSet::from([account_key.to_lowercase()]);
        for activity in activities {
            if let Some(comment) = &activity.comment {
                collect_comments(
                    comment,
                    comment.id,
                    activity.user.as_ref(),
                    activity.created_date,
                    activity.comment_action.as_deref() == Some("DELETED"),
                    account_key,
                    &mut comments,
                    &mut own_threads,
                    &mut aliases,
                );
            }
        }
        for (id, observed) in &comments {
            let comment = observed.comment;
            let checkpoint = CommentCheckpoint {
                text_hash: Sha256::digest(comment.text.as_bytes())
                    .iter()
                    .map(|byte| format!("{byte:02x}"))
                    .collect(),
                state: comment.state.clone(),
                thread_resolved: comment.thread_resolved,
            };
            let previous = self.comments.get(id).cloned();
            if self.initialized && !observed.deleted {
                let own_thread = own_threads.contains(&observed.thread_id);
                let own_comment = is_me(comment.author.as_ref(), account_key);
                if !own_comment
                    && comment.author.is_some()
                    && previous
                        .as_ref()
                        .is_none_or(|value| value.text_hash != checkpoint.text_hash)
                {
                    let mentioned = mentions(&comment.text, &aliases);
                    if mentioned || (own_thread && *id != observed.thread_id) {
                        self.push_change(
                            *id,
                            if mentioned {
                                DiscussionChangeKind::Mention
                            } else {
                                DiscussionChangeKind::Reply
                            },
                            comment.author.as_ref(),
                            comment.updated_date.or(comment.created_date),
                        );
                    }
                }
                if own_thread && !is_me(observed.actor, account_key) {
                    let kind = previous
                        .as_ref()
                        .and_then(|previous| resolution_change(previous, &checkpoint));
                    if let Some(kind) = kind {
                        self.push_change(
                            *id,
                            kind,
                            observed.actor,
                            observed.activity_date.or(comment.updated_date),
                        );
                    }
                }
            }
            self.comments.insert(*id, checkpoint);
        }
        self.initialized = true;
    }

    fn push_change(
        &mut self,
        comment_id: u64,
        kind: DiscussionChangeKind,
        actor: Option<&BitbucketUser>,
        updated_at: Option<i64>,
    ) {
        self.status.revision += 1;
        // Keep the latest unread reason for a comment, without growing a polling history.
        self.status
            .changes
            .retain(|change| change.comment_id != comment_id || change.kind != kind);
        self.status.changes.push(DiscussionChange {
            revision: self.status.revision,
            comment_id,
            kind,
            actor: actor.and_then(|user| {
                user.display_name
                    .clone()
                    .or(user.name.clone())
                    .or(user.slug.clone())
            }),
            updated_at,
        });
    }

    pub fn mark_read(&mut self, through_revision: u64, comment_id: Option<u64>) {
        self.status.changes.retain(|change| {
            change.revision > through_revision
                || comment_id.is_some_and(|id| change.comment_id != id)
        });
    }
}

struct ObservedComment<'a> {
    comment: &'a BitbucketComment,
    thread_id: u64,
    actor: Option<&'a BitbucketUser>,
    activity_date: Option<i64>,
    deleted: bool,
}

fn is_me(user: Option<&BitbucketUser>, account_key: &str) -> bool {
    user.is_some_and(|user| {
        [user.name.as_deref(), user.slug.as_deref()]
            .into_iter()
            .flatten()
            .any(|value| value.eq_ignore_ascii_case(account_key))
    })
}

fn resolution_change(
    previous: &CommentCheckpoint,
    current: &CommentCheckpoint,
) -> Option<DiscussionChangeKind> {
    // Thread resolution and task resolution are separate Bitbucket fields.
    match (previous.thread_resolved, current.thread_resolved) {
        (Some(false), Some(true)) => Some(DiscussionChangeKind::Resolved),
        (Some(true), Some(false)) => Some(DiscussionChangeKind::Reopened),
        _ => match (previous.state.as_deref(), current.state.as_deref()) {
            (Some("OPEN"), Some("RESOLVED")) => Some(DiscussionChangeKind::Resolved),
            (Some("RESOLVED"), Some("OPEN")) => Some(DiscussionChangeKind::Reopened),
            _ => None,
        },
    }
}

#[allow(clippy::too_many_arguments)]
fn collect_comments<'a>(
    comment: &'a BitbucketComment,
    thread_id: u64,
    actor: Option<&'a BitbucketUser>,
    activity_date: Option<i64>,
    deleted: bool,
    account_key: &str,
    comments: &mut BTreeMap<u64, ObservedComment<'a>>,
    own_threads: &mut HashSet<u64>,
    aliases: &mut HashSet<String>,
) {
    if is_me(comment.author.as_ref(), account_key) {
        own_threads.insert(thread_id);
        if let Some(user) = &comment.author {
            aliases.extend(
                [user.name.as_deref(), user.slug.as_deref()]
                    .into_iter()
                    .flatten()
                    .map(str::to_lowercase),
            );
        }
    }
    // A newer standalone reply can be linked by an older parent activity. Keep its
    // latest body/actor while recovering the thread identity from the nested tree.
    if let Some(old) = comments.get_mut(&comment.id) {
        if old.thread_id == comment.id && thread_id != comment.id {
            old.thread_id = thread_id;
        }
    }
    let thread_id = comments
        .get(&comment.id)
        .filter(|old| old.thread_id != comment.id)
        .map_or(thread_id, |old| old.thread_id);
    let replace = comments.get(&comment.id).is_none_or(|old| {
        (comment.version, comment.updated_date) > (old.comment.version, old.comment.updated_date)
    });
    if replace {
        comments.insert(
            comment.id,
            ObservedComment {
                comment,
                thread_id,
                actor,
                activity_date,
                deleted: deleted || comment.deleted == Some(true),
            },
        );
    }
    for reply in &comment.comments {
        collect_comments(
            reply,
            thread_id,
            reply.author.as_ref(),
            reply.updated_date,
            deleted,
            account_key,
            comments,
            own_threads,
            aliases,
        );
    }
}

fn mentions(text: &str, aliases: &HashSet<String>) -> bool {
    // Match complete account names, never display names or substrings of another account.
    text.split(|character: char| {
        !(character.is_alphanumeric() || matches!(character, '@' | '_' | '-' | '.'))
    })
    .filter_map(|token| token.strip_prefix('@'))
    .any(|name| aliases.contains(&name.trim_end_matches('.').to_lowercase()))
        || text
            .split("[~")
            .skip(1)
            .filter_map(|tail| tail.split_once(']').map(|(name, _)| name))
            .any(|name| aliases.contains(&name.to_lowercase()))
}
