use std::{path::Path, time::Duration};

use sqlx::{migrate::Migrator, sqlite::SqliteConnectOptions, SqlitePool};

pub const DATABASE_FILENAME: &str = "mework.sqlite";
static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

pub async fn open_database(path: &Path) -> Result<SqlitePool, sqlx::Error> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(5));

    let pool = SqlitePool::connect_with(options).await?;
    MIGRATOR.run(&pool).await?;
    Ok(pool)
}

pub mod planning_repositories;
pub mod repositories;

#[cfg(test)]
mod tests;
