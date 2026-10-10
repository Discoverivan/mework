use super::ai_prompts;
use crate::infrastructure::db::repositories;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

const SETTINGS_KEY: &str = "developer.review_instruction_rules";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum InstructionScope {
    Project,
    Repository,
    Author,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum InstructionMode {
    Replace,
    Append,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewInstructionRule {
    pub integration_id: String,
    pub scope: InstructionScope,
    pub external_id: String,
    pub label: String,
    pub mode: InstructionMode,
    pub instructions: String,
}

pub async fn load(pool: &SqlitePool) -> Result<Vec<ReviewInstructionRule>, String> {
    repositories::get_setting(pool, SETTINGS_KEY)
        .await
        .map_err(|_| "Failed to load review instruction rules".to_owned())?
        .map(|raw| {
            serde_json::from_str(&raw).map_err(|_| "Invalid review instruction rules".to_owned())
        })
        .transpose()
        .map(|rules| rules.unwrap_or_default())
}

pub async fn save(
    pool: &SqlitePool,
    mut rules: Vec<ReviewInstructionRule>,
) -> Result<Vec<ReviewInstructionRule>, String> {
    if rules.len() > 300 {
        return Err("Too many review instruction rules".to_owned());
    }
    let mut seen = std::collections::HashSet::new();
    for rule in &mut rules {
        rule.integration_id = rule.integration_id.trim().to_owned();
        rule.external_id = rule.external_id.trim().to_owned();
        rule.label = rule.label.trim().to_owned();
        rule.instructions = rule.instructions.trim().to_owned();
        if rule.integration_id.is_empty()
            || rule.external_id.is_empty()
            || rule.label.is_empty()
            || rule.instructions.is_empty()
            || rule.instructions.chars().count() > ai_prompts::MAX_INSTRUCTIONS_LENGTH
        {
            return Err("Select a target and enter 1–20000 characters of instructions".to_owned());
        }
        if !seen.insert((
            rule.integration_id.clone(),
            rule.scope,
            rule.external_id.to_lowercase(),
        )) {
            return Err("A review instruction rule already exists for this target".to_owned());
        }
    }
    let value = serde_json::to_string(&rules)
        .map_err(|_| "Failed to serialize review instruction rules".to_owned())?;
    repositories::upsert_setting(pool, SETTINGS_KEY, &value, 1)
        .await
        .map_err(|_| "Failed to save review instruction rules".to_owned())?;
    Ok(rules)
}

pub fn resolve(
    rules: &[ReviewInstructionRule],
    base: &str,
    integration_id: &str,
    project: &str,
    repository: &str,
    author: Option<&str>,
) -> String {
    let repository_id = format!("{project}/{repository}");
    let matches = |rule: &&ReviewInstructionRule| {
        rule.integration_id == integration_id
            && match rule.scope {
                InstructionScope::Project => rule.external_id.eq_ignore_ascii_case(project),
                InstructionScope::Repository => {
                    rule.external_id.eq_ignore_ascii_case(&repository_id)
                }
                InstructionScope::Author => {
                    author.is_some_and(|author| rule.external_id.eq_ignore_ascii_case(author))
                }
            }
    };
    let matching: Vec<_> = rules.iter().filter(matches).collect();
    let priority = |scope| match scope {
        InstructionScope::Author => 0,
        InstructionScope::Project => 1,
        InstructionScope::Repository => 2,
    };
    let mut resolved = matching
        .iter()
        .filter(|rule| rule.mode == InstructionMode::Replace)
        .max_by_key(|rule| priority(rule.scope))
        .map(|rule| rule.instructions.clone())
        .unwrap_or_else(|| base.to_owned());
    // Stable order independent of the order in which the user edited the tables.
    for scope in [
        InstructionScope::Project,
        InstructionScope::Repository,
        InstructionScope::Author,
    ] {
        for rule in matching
            .iter()
            .filter(|rule| rule.scope == scope && rule.mode == InstructionMode::Append)
        {
            resolved.push_str("\n\n");
            resolved.push_str(&rule.instructions);
        }
    }
    resolved
}

pub fn effective(
    rules: &[ReviewInstructionRule],
    base: &str,
    integration_id: &str,
    project: &str,
    repository: &str,
    author: Option<&str>,
) -> String {
    // Formatting remains an application setting even when custom instructions replace the base.
    for enabled in [true, false] {
        let formatting = ai_prompts::fix_examples_rule(enabled);
        if let Some(custom_base) = base.strip_suffix(&format!("\n\n{formatting}")) {
            return format!(
                "{}\n\n{formatting}",
                resolve(
                    rules,
                    custom_base,
                    integration_id,
                    project,
                    repository,
                    author
                )
            );
        }
    }
    resolve(rules, base, integration_id, project, repository, author)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn persists_and_resolves_scoped_review_instructions() {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::infrastructure::db::open_database(&dir.path().join("example.sqlite"))
            .await
            .unwrap();
        let rule = |scope, id: &str, mode, instructions: &str| ReviewInstructionRule {
            integration_id: "example-bitbucket".into(),
            scope,
            external_id: id.into(),
            label: id.into(),
            mode,
            instructions: instructions.into(),
        };
        save(
            &pool,
            vec![
                rule(
                    InstructionScope::Project,
                    "EXAMPLE",
                    InstructionMode::Replace,
                    "Check project behavior.",
                ),
                rule(
                    InstructionScope::Repository,
                    "EXAMPLE/example-repo",
                    InstructionMode::Replace,
                    "Check repository behavior.",
                ),
                rule(
                    InstructionScope::Author,
                    "example-author",
                    InstructionMode::Append,
                    "Explain concurrency defects.",
                ),
            ],
        )
        .await
        .unwrap();
        let rules = load(&pool).await.unwrap();
        assert_eq!(
            resolve(
                &rules,
                "General instructions.",
                "example-bitbucket",
                "EXAMPLE",
                "example-repo",
                Some("example-author")
            ),
            "Check repository behavior.\n\nExplain concurrency defects."
        );
        assert_eq!(
            resolve(
                &rules,
                "General instructions.",
                "other-example",
                "EXAMPLE",
                "example-repo",
                Some("example-author")
            ),
            "General instructions."
        );
        let formatting = ai_prompts::fix_examples_rule(true);
        let effective = effective(
            &rules,
            &format!("General instructions.\n\n{formatting}"),
            "example-bitbucket",
            "EXAMPLE",
            "example-repo",
            Some("example-author"),
        );
        assert_eq!(
            effective,
            format!("Check repository behavior.\n\nExplain concurrency defects.\n\n{formatting}")
        );
        pool.close().await;
    }
}
