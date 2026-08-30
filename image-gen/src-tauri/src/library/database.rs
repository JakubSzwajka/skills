//! Connection setup and bundled, versioned migrations.

use rusqlite::Connection;
use std::path::Path;

const MIGRATIONS: &[&str] = &[
    // v1: initial schema
    "
    CREATE TABLE generation_batches (
      id TEXT PRIMARY KEY,
      prompt TEXT NOT NULL,
      variant_count INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE generation_jobs (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL REFERENCES generation_batches(id),
      provider TEXT NOT NULL,
      variant_index INTEGER NOT NULL,
      status TEXT NOT NULL,
      retry_of_job_id TEXT,
      output_asset_id TEXT,
      error_code TEXT,
      error_message TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER
    );

    CREATE TABLE assets (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      path TEXT NOT NULL,
      thumbnail_path TEXT,
      media_type TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      byte_size INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE batch_references (
      batch_id TEXT NOT NULL REFERENCES generation_batches(id),
      asset_id TEXT NOT NULL REFERENCES assets(id),
      position INTEGER NOT NULL,
      PRIMARY KEY (batch_id, asset_id)
    );

    CREATE INDEX idx_batches_cursor ON generation_batches(created_at DESC, id DESC);
    CREATE INDEX idx_jobs_batch ON generation_jobs(batch_id);
    CREATE INDEX idx_jobs_status ON generation_jobs(status);
    CREATE INDEX idx_assets_sha ON assets(sha256);
    ",
];

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let conn = Connection::open(path)?;
    configure(&conn)?;
    migrate(&conn)?;
    Ok(conn)
}

#[cfg(test)]
pub fn open_in_memory() -> rusqlite::Result<Connection> {
    let conn = Connection::open_in_memory()?;
    configure(&conn)?;
    migrate(&conn)?;
    Ok(conn)
}

fn configure(conn: &Connection) -> rusqlite::Result<()> {
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(())
}

pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let version: i64 = conn.query_row("SELECT user_version FROM pragma_user_version", [], |r| {
        r.get(0)
    })?;
    for (index, migration) in MIGRATIONS.iter().enumerate() {
        let target = (index + 1) as i64;
        if version < target {
            conn.execute_batch(&format!(
                "BEGIN; {migration}; PRAGMA user_version = {target}; COMMIT;"
            ))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_apply_and_are_idempotent() {
        let conn = open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let version: i64 = conn
            .query_row("SELECT user_version FROM pragma_user_version", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(version, MIGRATIONS.len() as i64);
    }
}
