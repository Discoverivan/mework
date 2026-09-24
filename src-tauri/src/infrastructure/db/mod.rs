use std::{path::Path, time::Duration};

use sqlx::{migrate::Migrator, sqlite::SqliteConnectOptions, SqlitePool};

pub const DATABASE_FILENAME: &str = "mework.sqlite";
pub const MOCK_DATABASE_FILENAME: &str = "mework-mock.sqlite";
static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

/// Reset only the dedicated disposable mock database and SQLite sidecars.
/// The normal development and production databases are never touched.
pub fn reset_mock_database_file(app_data_dir: &Path) -> Result<std::path::PathBuf, std::io::Error> {
    let database_path = app_data_dir.join(MOCK_DATABASE_FILENAME);
    for suffix in ["", "-wal", "-shm"] {
        let mut path = database_path.as_os_str().to_owned();
        path.push(suffix);
        match std::fs::remove_file(std::path::PathBuf::from(path)) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    Ok(database_path)
}

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
