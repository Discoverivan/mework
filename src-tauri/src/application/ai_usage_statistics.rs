use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{Row, SqlitePool};

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AiUsagePeriod {
    Today,
    SevenDays,
    Month,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AiTokenUsageRecord {
    pub recorded_at: String,
    pub provider_id: String,
    pub model: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub total_tokens: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AiTokenUsageCounts {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub total_tokens: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiUsageBucket {
    pub date: String,
    pub provider_id: String,
    pub provider_name: String,
    pub model: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub total_tokens: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiUsageModelTotal {
    pub provider_id: String,
    pub provider_name: String,
    pub model: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub total_tokens: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiUsageTotal {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub total_tokens: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiUsageStatistics {
    pub period: AiUsagePeriod,
    pub daily: Vec<AiUsageBucket>,
    pub by_model: Vec<AiUsageModelTotal>,
    pub total: AiUsageTotal,
}

pub async fn record(pool: &SqlitePool, usage: AiTokenUsageRecord) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO ai_token_usage
            (recorded_at, provider, model, input_tokens, output_tokens, total_tokens)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(usage.recorded_at)
    .bind(usage.provider_id)
    .bind(usage.model)
    .bind(usage.input_tokens)
    .bind(usage.output_tokens)
    .bind(usage.total_tokens)
    .execute(pool)
    .await
    .map(|_| ())
}

pub async fn record_now(
    pool: &SqlitePool,
    provider_id: &str,
    model: &str,
    counts: AiTokenUsageCounts,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO ai_token_usage
            (recorded_at, provider, model, input_tokens, output_tokens, total_tokens)
         VALUES (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?, ?, ?, ?, ?)",
    )
    .bind(provider_id)
    .bind(model)
    .bind(counts.input_tokens)
    .bind(counts.output_tokens)
    .bind(counts.total_tokens)
    .execute(pool)
    .await
    .map(|_| ())
}

pub async fn statistics(
    pool: &SqlitePool,
    period: AiUsagePeriod,
) -> Result<AiUsageStatistics, String> {
    let daily_rows = sqlx::query(daily_query(period))
        .fetch_all(pool)
        .await
        .map_err(|_| "failed to read AI usage statistics".to_owned())?;
    let daily = daily_rows
        .into_iter()
        .map(|row| {
            let provider_id: String = row.try_get("provider")?;
            Ok(AiUsageBucket {
                date: row.try_get("usage_date")?,
                provider_name: provider_name(&provider_id),
                provider_id,
                model: row.try_get("model")?,
                input_tokens: row.try_get("input_tokens")?,
                output_tokens: row.try_get("output_tokens")?,
                total_tokens: row.try_get("total_tokens")?,
            })
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()
        .map_err(|_| "failed to read AI usage statistics".to_owned())?;

    let by_model_rows = sqlx::query(by_model_query(period))
        .fetch_all(pool)
        .await
        .map_err(|_| "failed to read AI usage statistics".to_owned())?;
    let by_model = by_model_rows
        .into_iter()
        .map(|row| {
            let provider_id: String = row.try_get("provider")?;
            Ok(AiUsageModelTotal {
                provider_name: provider_name(&provider_id),
                provider_id,
                model: row.try_get("model")?,
                input_tokens: row.try_get("input_tokens")?,
                output_tokens: row.try_get("output_tokens")?,
                total_tokens: row.try_get("total_tokens")?,
            })
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()
        .map_err(|_| "failed to read AI usage statistics".to_owned())?;

    let total_row = sqlx::query(total_query(period))
        .fetch_one(pool)
        .await
        .map_err(|_| "failed to read AI usage statistics".to_owned())?;
    Ok(AiUsageStatistics {
        period,
        daily,
        by_model,
        total: AiUsageTotal {
            input_tokens: total_row
                .try_get("input_tokens")
                .map_err(|_| "failed to read AI usage statistics".to_owned())?,
            output_tokens: total_row
                .try_get("output_tokens")
                .map_err(|_| "failed to read AI usage statistics".to_owned())?,
            total_tokens: total_row
                .try_get("total_tokens")
                .map_err(|_| "failed to read AI usage statistics".to_owned())?,
        },
    })
}

fn daily_query(period: AiUsagePeriod) -> &'static str {
    match period {
        AiUsagePeriod::Today => "SELECT date(recorded_at, 'localtime') AS usage_date, provider, model, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(total_tokens) AS total_tokens FROM ai_token_usage WHERE date(recorded_at, 'localtime') = date('now', 'localtime') GROUP BY usage_date, provider, model ORDER BY usage_date ASC, provider ASC, model ASC",
        AiUsagePeriod::SevenDays => "SELECT date(recorded_at, 'localtime') AS usage_date, provider, model, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(total_tokens) AS total_tokens FROM ai_token_usage WHERE date(recorded_at, 'localtime') >= date('now', 'localtime', '-6 days') AND date(recorded_at, 'localtime') <= date('now', 'localtime') GROUP BY usage_date, provider, model ORDER BY usage_date ASC, provider ASC, model ASC",
        AiUsagePeriod::Month => "SELECT date(recorded_at, 'localtime') AS usage_date, provider, model, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(total_tokens) AS total_tokens FROM ai_token_usage WHERE strftime('%Y-%m', recorded_at, 'localtime') = strftime('%Y-%m', 'now', 'localtime') GROUP BY usage_date, provider, model ORDER BY usage_date ASC, provider ASC, model ASC",
    }
}

fn by_model_query(period: AiUsagePeriod) -> &'static str {
    match period {
        AiUsagePeriod::Today => "SELECT provider, model, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(total_tokens) AS total_tokens FROM ai_token_usage WHERE date(recorded_at, 'localtime') = date('now', 'localtime') GROUP BY provider, model ORDER BY provider ASC, model ASC",
        AiUsagePeriod::SevenDays => "SELECT provider, model, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(total_tokens) AS total_tokens FROM ai_token_usage WHERE date(recorded_at, 'localtime') >= date('now', 'localtime', '-6 days') AND date(recorded_at, 'localtime') <= date('now', 'localtime') GROUP BY provider, model ORDER BY provider ASC, model ASC",
        AiUsagePeriod::Month => "SELECT provider, model, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(total_tokens) AS total_tokens FROM ai_token_usage WHERE strftime('%Y-%m', recorded_at, 'localtime') = strftime('%Y-%m', 'now', 'localtime') GROUP BY provider, model ORDER BY provider ASC, model ASC",
    }
}

fn total_query(period: AiUsagePeriod) -> &'static str {
    match period {
        AiUsagePeriod::Today => "SELECT COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(total_tokens), 0) AS total_tokens FROM ai_token_usage WHERE date(recorded_at, 'localtime') = date('now', 'localtime')",
        AiUsagePeriod::SevenDays => "SELECT COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(total_tokens), 0) AS total_tokens FROM ai_token_usage WHERE date(recorded_at, 'localtime') >= date('now', 'localtime', '-6 days') AND date(recorded_at, 'localtime') <= date('now', 'localtime')",
        AiUsagePeriod::Month => "SELECT COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(total_tokens), 0) AS total_tokens FROM ai_token_usage WHERE strftime('%Y-%m', recorded_at, 'localtime') = strftime('%Y-%m', 'now', 'localtime')",
    }
}

fn provider_name(provider_id: &str) -> String {
    match provider_id {
        "codex-cli" => "Codex CLI".to_owned(),
        "claude-code-cli" => "Claude Code CLI".to_owned(),
        "openai-compatible" => "OpenAI-compatible API".to_owned(),
        _ => provider_id.to_owned(),
    }
}

pub fn parse_provider_usage(value: &Value) -> Option<AiTokenUsageCounts> {
    let reported_input_tokens =
        usage_count(value, &["input_tokens", "inputTokens", "prompt_tokens"])?;
    let cached_input_tokens = usage_count(
        value,
        &["cache_creation_input_tokens", "cacheCreationInputTokens"],
    )
    .unwrap_or(0)
    .checked_add(
        usage_count(value, &["cache_read_input_tokens", "cacheReadInputTokens"]).unwrap_or(0),
    )?;
    let input_tokens = reported_input_tokens.checked_add(cached_input_tokens)?;
    let output_tokens = usage_count(
        value,
        &["output_tokens", "outputTokens", "completion_tokens"],
    )?;
    let total_tokens = usage_count(value, &["total_tokens", "totalTokens"])
        .or_else(|| input_tokens.checked_add(output_tokens))?;
    Some(AiTokenUsageCounts {
        input_tokens,
        output_tokens,
        total_tokens,
    })
}

pub fn parse_response_usage(value: &Value) -> Option<AiTokenUsageCounts> {
    value
        .get("modelUsage")
        .or_else(|| value.get("model_usage"))
        .and_then(parse_model_usage_breakdown)
        .or_else(|| value.get("usage").and_then(parse_provider_usage))
}

fn parse_model_usage_breakdown(value: &Value) -> Option<AiTokenUsageCounts> {
    let mut total = AiTokenUsageCounts {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
    };
    let mut found = false;
    for usage in value.as_object()?.values() {
        let Some(counts) = parse_provider_usage(usage) else {
            continue;
        };
        total.input_tokens = total.input_tokens.checked_add(counts.input_tokens)?;
        total.output_tokens = total.output_tokens.checked_add(counts.output_tokens)?;
        total.total_tokens = total.total_tokens.checked_add(counts.total_tokens)?;
        found = true;
    }
    found.then_some(total)
}

pub fn parse_sse_usage(body: &[u8]) -> Option<AiTokenUsageCounts> {
    let mut usage = None;
    for line in String::from_utf8_lossy(body).lines() {
        let data = line
            .strip_prefix("data:")
            .map(str::trim_start)
            .filter(|value| !value.is_empty() && *value != "[DONE]");
        let Some(data) = data else {
            continue;
        };
        if let Ok(value) = serde_json::from_str::<Value>(data) {
            usage = parse_response_usage(&value).or(usage);
        }
    }
    usage
}

pub fn parse_cli_usage(output: &[u8]) -> Option<AiTokenUsageCounts> {
    String::from_utf8_lossy(output)
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter_map(|value| find_usage(&value))
        .next_back()
}

fn find_usage(value: &Value) -> Option<AiTokenUsageCounts> {
    if let Some(usage) = value
        .get("modelUsage")
        .or_else(|| value.get("model_usage"))
        .and_then(parse_model_usage_breakdown)
    {
        return Some(usage);
    }
    if let Some(usage) = value.get("usage").and_then(parse_provider_usage) {
        return Some(usage);
    }
    match value {
        Value::Object(fields) => fields.values().find_map(find_usage),
        Value::Array(items) => items.iter().find_map(find_usage),
        _ => None,
    }
}

fn usage_count(value: &Value, keys: &[&str]) -> Option<i64> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_i64))
        .filter(|value| *value >= 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::db::open_database;
    use serde_json::json;

    #[tokio::test]
    async fn records_and_aggregates_exact_usage_without_storing_prompt_data() {
        let temp_dir = tempfile::tempdir().unwrap();
        let pool = open_database(&temp_dir.path().join("mework.sqlite"))
            .await
            .unwrap();

        let recorded_at: String =
            sqlx::query_scalar("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
                .fetch_one(&pool)
                .await
                .unwrap();
        record(
            &pool,
            AiTokenUsageRecord {
                recorded_at,
                provider_id: "codex-cli".to_owned(),
                model: "example-model".to_owned(),
                input_tokens: 10,
                output_tokens: 4,
                total_tokens: 14,
            },
        )
        .await
        .unwrap();
        let result = statistics(&pool, AiUsagePeriod::Today).await.unwrap();

        assert_eq!(result.period, AiUsagePeriod::Today);
        assert_eq!(result.total.input_tokens, 10);
        assert_eq!(result.total.output_tokens, 4);
        assert_eq!(result.total.total_tokens, 14);
        assert_eq!(result.daily.len(), 1);
        assert_eq!(result.daily[0].provider_id, "codex-cli");
        assert_eq!(result.daily[0].provider_name, "Codex CLI");
        assert_eq!(result.by_model[0].model, "example-model");
        let stored_columns: Vec<String> =
            sqlx::query_scalar("SELECT name FROM pragma_table_info('ai_token_usage') ORDER BY cid")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(
            stored_columns,
            vec![
                "recorded_at",
                "provider",
                "model",
                "input_tokens",
                "output_tokens",
                "total_tokens"
            ]
        );
        let stored_json: String =
            sqlx::query_scalar("SELECT provider || model FROM ai_token_usage")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(!stored_json.contains("synthetic prompt"));
    }

    #[test]
    fn derives_total_tokens_when_providers_report_only_input_and_output() {
        assert_eq!(
            parse_provider_usage(&json!({
                "prompt_tokens": 12,
                "completion_tokens": 8,
                "total_tokens": 20
            })),
            Some(AiTokenUsageCounts {
                input_tokens: 12,
                output_tokens: 8,
                total_tokens: 20,
            })
        );
        assert_eq!(
            parse_provider_usage(&json!({ "input_tokens": 12, "output_tokens": 8 })),
            Some(AiTokenUsageCounts {
                input_tokens: 12,
                output_tokens: 8,
                total_tokens: 20,
            })
        );
    }

    #[test]
    fn parses_cli_usage_from_nested_json_events_without_estimating_counts() {
        let output = br#"{"type":"turn.completed","usage":{"input_tokens":30,"output_tokens":12,"total_tokens":42}}
{"type":"message","text":"no usage here"}
"#;
        assert_eq!(
            parse_cli_usage(output),
            Some(AiTokenUsageCounts {
                input_tokens: 30,
                output_tokens: 12,
                total_tokens: 42,
            })
        );
        assert_eq!(parse_cli_usage(br#"{"usage":{"input_tokens":30}}"#), None);
        assert_eq!(
            parse_cli_usage(
                br#"{"type":"turn.completed","usage":{"input_tokens":30,"cached_input_tokens":18,"output_tokens":12}}"#
            ),
            Some(AiTokenUsageCounts {
                input_tokens: 30,
                output_tokens: 12,
                total_tokens: 42,
            })
        );
    }

    #[test]
    fn parses_claude_per_model_usage_and_includes_cached_input_tokens() {
        let response = json!({
            "modelUsage": {
                "claude-sonnet-4-5": {
                    "inputTokens": 30,
                    "outputTokens": 12,
                    "cacheCreationInputTokens": 10,
                    "cacheReadInputTokens": 18,
                    "costUSD": 0.01
                }
            }
        });

        assert_eq!(
            parse_response_usage(&response),
            Some(AiTokenUsageCounts {
                input_tokens: 58,
                output_tokens: 12,
                total_tokens: 70,
            })
        );
    }
}
