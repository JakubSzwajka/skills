//! Library module: the only owner of SQLite access.
//! The UI never touches the database; it sees `BatchView`/`JobView` only.

pub mod database;
pub mod thumbnails;

use crate::domain::*;
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::path::Path;
use std::sync::Mutex;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum LibraryError {
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("illegal transition from {from} to {to} for job {job_id}")]
    IllegalTransition {
        job_id: String,
        from: &'static str,
        to: &'static str,
    },
    #[error("{0}")]
    Invalid(String),
}

pub struct NewAsset {
    pub id: String,
    pub kind: AssetKind,
    pub path: String,
    pub thumbnail_path: Option<String>,
    pub media_type: String,
    pub width: u32,
    pub height: u32,
    pub byte_size: u64,
    pub sha256: String,
}

pub struct Library {
    conn: Mutex<Connection>,
}

impl Library {
    pub fn open(db_path: &Path) -> Result<Self, LibraryError> {
        Ok(Self {
            conn: Mutex::new(database::open(db_path)?),
        })
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self, LibraryError> {
        Ok(Self {
            conn: Mutex::new(database::open_in_memory()?),
        })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().expect("library connection lock poisoned")
    }

    /// After an abnormal exit, every surviving queued or running job
    /// becomes `interrupted`. Returns the number of recovered jobs.
    pub fn recover_interrupted(&self) -> Result<u32, LibraryError> {
        let conn = self.lock();
        let n = conn.execute(
            "UPDATE generation_jobs
             SET status = 'interrupted', error_code = 'interrupted', finished_at = ?1
             WHERE status IN ('queued', 'running')",
            params![now_millis()],
        )?;
        Ok(n as u32)
    }

    pub fn create_batch(
        &self,
        prompt: &str,
        providers: &[Provider],
        variant_count: u32,
        reference_asset_ids: &[String],
    ) -> Result<BatchView, LibraryError> {
        let batch_id = Uuid::new_v4().to_string();
        let now = now_millis();
        {
            let mut conn = self.lock();
            let tx = conn.transaction()?;
            tx.execute(
                "INSERT INTO generation_batches (id, prompt, variant_count, created_at)
                 VALUES (?1, ?2, ?3, ?4)",
                params![batch_id, prompt, variant_count, now],
            )?;
            for provider in providers {
                for variant_index in 0..variant_count {
                    tx.execute(
                        "INSERT INTO generation_jobs
                           (id, batch_id, provider, variant_index, status, created_at)
                         VALUES (?1, ?2, ?3, ?4, 'queued', ?5)",
                        params![
                            Uuid::new_v4().to_string(),
                            batch_id,
                            provider.as_str(),
                            variant_index,
                            now
                        ],
                    )?;
                }
            }
            for (position, asset_id) in reference_asset_ids.iter().enumerate() {
                tx.execute(
                    "INSERT INTO batch_references (batch_id, asset_id, position)
                     VALUES (?1, ?2, ?3)",
                    params![batch_id, asset_id, position as i64],
                )?;
            }
            tx.commit()?;
        }
        self.get_batch(&batch_id)
    }

    pub fn get_batch(&self, batch_id: &str) -> Result<BatchView, LibraryError> {
        let conn = self.lock();
        let (id, prompt, variant_count, created_at) = conn
            .query_row(
                "SELECT id, prompt, variant_count, created_at
                 FROM generation_batches WHERE id = ?1",
                params![batch_id],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, u32>(2)?,
                        r.get::<_, i64>(3)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| LibraryError::NotFound(format!("batch {batch_id}")))?;
        Ok(BatchView {
            jobs: batch_jobs(&conn, &id)?,
            references: batch_references(&conn, &id)?,
            id,
            prompt,
            variant_count,
            created_at,
        })
    }

    pub fn get_job(&self, job_id: &str) -> Result<JobView, LibraryError> {
        let conn = self.lock();
        job_by_id(&conn, job_id)
    }

    /// Apply one legal state transition and stamp timestamps.
    pub fn transition_job(
        &self,
        job_id: &str,
        to: JobStatus,
        error: Option<(ErrorCode, String)>,
        output_asset_id: Option<&str>,
    ) -> Result<JobView, LibraryError> {
        let conn = self.lock();
        let current = job_by_id(&conn, job_id)?;
        if !current.status.can_transition(to) {
            return Err(LibraryError::IllegalTransition {
                job_id: job_id.to_string(),
                from: current.status.as_str(),
                to: to.as_str(),
            });
        }
        let now = now_millis();
        let started_at = if to == JobStatus::Running {
            Some(now)
        } else {
            current.started_at
        };
        let finished_at = if to.is_terminal() { Some(now) } else { None };
        let (error_code, error_message) = match &error {
            Some((code, message)) => (Some(code.as_str()), Some(message.clone())),
            None => (None, None),
        };
        conn.execute(
            "UPDATE generation_jobs
             SET status = ?2, started_at = ?3, finished_at = ?4,
                 error_code = ?5, error_message = ?6,
                 output_asset_id = COALESCE(?7, output_asset_id)
             WHERE id = ?1",
            params![
                job_id,
                to.as_str(),
                started_at,
                finished_at,
                error_code,
                error_message,
                output_asset_id
            ],
        )?;
        job_by_id(&conn, job_id)
    }

    /// Retry never mutates the old attempt; it links a new queued job.
    pub fn create_retry_job(&self, of_job_id: &str) -> Result<JobView, LibraryError> {
        let conn = self.lock();
        let old = job_by_id(&conn, of_job_id)?;
        // Any terminal attempt (including succeeded) may spawn a retry;
        // queued and running attempts may not.
        if !old.status.is_terminal() {
            return Err(LibraryError::Invalid(format!(
                "job {of_job_id} is {} and cannot be retried",
                old.status.as_str()
            )));
        }
        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO generation_jobs
               (id, batch_id, provider, variant_index, status, retry_of_job_id, created_at)
             VALUES (?1, ?2, ?3, ?4, 'queued', ?5, ?6)",
            params![
                id,
                old.batch_id,
                old.provider.as_str(),
                old.variant_index,
                of_job_id,
                now_millis()
            ],
        )?;
        job_by_id(&conn, &id)
    }

    /// Descending `(created_at, id)` page with an exclusive cursor.
    pub fn history_page(
        &self,
        cursor: Option<&Cursor>,
        limit: u32,
    ) -> Result<HistoryPage, LibraryError> {
        let conn = self.lock();
        let mut stmt = conn.prepare(
            "SELECT id, prompt, variant_count, created_at
             FROM generation_batches
             WHERE (?1 IS NULL)
                OR (created_at < ?1)
                OR (created_at = ?1 AND id < ?2)
             ORDER BY created_at DESC, id DESC
             LIMIT ?3",
        )?;
        let rows: Vec<(String, String, u32, i64)> = stmt
            .query_map(
                params![
                    cursor.map(|c| c.created_at),
                    cursor.map(|c| c.id.as_str()),
                    // Fetch one extra row to learn whether another page exists.
                    limit + 1
                ],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, u32>(2)?,
                        r.get::<_, i64>(3)?,
                    ))
                },
            )?
            .collect::<Result<_, _>>()?;

        let has_more = rows.len() as u32 > limit;
        let page_rows = &rows[..rows.len().min(limit as usize)];
        let mut batches = Vec::with_capacity(page_rows.len());
        for (id, prompt, variant_count, created_at) in page_rows {
            batches.push(BatchView {
                id: id.clone(),
                prompt: prompt.clone(),
                variant_count: *variant_count,
                created_at: *created_at,
                jobs: batch_jobs(&conn, id)?,
                references: batch_references(&conn, id)?,
            });
        }
        let next_cursor = if has_more {
            batches.last().map(|b| Cursor {
                created_at: b.created_at,
                id: b.id.clone(),
            })
        } else {
            None
        };
        Ok(HistoryPage {
            batches,
            next_cursor,
        })
    }

    pub fn insert_asset(&self, new: NewAsset) -> Result<AssetView, LibraryError> {
        let conn = self.lock();
        let id = new.id;
        conn.execute(
            "INSERT INTO assets
               (id, kind, path, thumbnail_path, media_type, width, height,
                byte_size, sha256, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                id,
                new.kind.as_str(),
                new.path,
                new.thumbnail_path,
                new.media_type,
                new.width,
                new.height,
                new.byte_size as i64,
                new.sha256,
                now_millis()
            ],
        )?;
        asset_by_id(&conn, &id)
    }

    pub fn get_asset(&self, asset_id: &str) -> Result<AssetView, LibraryError> {
        let conn = self.lock();
        asset_by_id(&conn, asset_id)
    }

    pub fn find_asset_by_sha(&self, sha256: &str) -> Result<Option<AssetView>, LibraryError> {
        let conn = self.lock();
        let id: Option<String> = conn
            .query_row(
                "SELECT id FROM assets WHERE sha256 = ?1 LIMIT 1",
                params![sha256],
                |r| r.get(0),
            )
            .optional()?;
        match id {
            Some(id) => Ok(Some(asset_by_id(&conn, &id)?)),
            None => Ok(None),
        }
    }

    /// Total encoded bytes for a set of assets (batch reference budget).
    pub fn total_asset_bytes(&self, asset_ids: &[String]) -> Result<u64, LibraryError> {
        let conn = self.lock();
        let mut total = 0u64;
        for id in asset_ids {
            let asset = asset_by_id(&conn, id)?;
            total += asset.byte_size;
        }
        Ok(total)
    }
}

fn job_by_id(conn: &Connection, job_id: &str) -> Result<JobView, LibraryError> {
    let job = conn
        .query_row(
            "SELECT id, batch_id, provider, variant_index, status, retry_of_job_id,
                    output_asset_id, error_code, error_message,
                    created_at, started_at, finished_at
             FROM generation_jobs WHERE id = ?1",
            params![job_id],
            map_job_row,
        )
        .optional()?
        .ok_or_else(|| LibraryError::NotFound(format!("job {job_id}")))?;
    hydrate_job(conn, job)
}

fn batch_jobs(conn: &Connection, batch_id: &str) -> Result<Vec<JobView>, LibraryError> {
    let mut stmt = conn.prepare(
        "SELECT id, batch_id, provider, variant_index, status, retry_of_job_id,
                output_asset_id, error_code, error_message,
                created_at, started_at, finished_at
         FROM generation_jobs
         WHERE batch_id = ?1
         ORDER BY provider, variant_index, created_at, id",
    )?;
    let raw: Vec<RawJob> = stmt
        .query_map(params![batch_id], map_job_row)?
        .collect::<Result<_, _>>()?;
    raw.into_iter().map(|j| hydrate_job(conn, j)).collect()
}

fn batch_references(conn: &Connection, batch_id: &str) -> Result<Vec<AssetView>, LibraryError> {
    let mut stmt = conn.prepare(
        "SELECT a.id FROM batch_references br
         JOIN assets a ON a.id = br.asset_id
         WHERE br.batch_id = ?1
         ORDER BY br.position",
    )?;
    let ids: Vec<String> = stmt
        .query_map(params![batch_id], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    ids.iter().map(|id| asset_by_id(conn, id)).collect()
}

struct RawJob {
    view: JobView,
    output_asset_id: Option<String>,
}

fn map_job_row(r: &Row<'_>) -> rusqlite::Result<RawJob> {
    let provider: String = r.get(2)?;
    let status: String = r.get(4)?;
    let error_code: Option<String> = r.get(7)?;
    Ok(RawJob {
        view: JobView {
            id: r.get(0)?,
            batch_id: r.get(1)?,
            provider: Provider::parse(&provider).unwrap_or(Provider::Openai),
            variant_index: r.get(3)?,
            status: JobStatus::parse(&status).unwrap_or(JobStatus::Interrupted),
            retry_of_job_id: r.get(5)?,
            error_code: error_code.as_deref().and_then(ErrorCode::parse),
            error_message: r.get(8)?,
            created_at: r.get(9)?,
            started_at: r.get(10)?,
            finished_at: r.get(11)?,
            output_asset: None,
        },
        output_asset_id: r.get(6)?,
    })
}

fn hydrate_job(conn: &Connection, raw: RawJob) -> Result<JobView, LibraryError> {
    let mut view = raw.view;
    if let Some(asset_id) = raw.output_asset_id {
        view.output_asset = Some(asset_by_id(conn, &asset_id)?);
    }
    Ok(view)
}

fn asset_by_id(conn: &Connection, asset_id: &str) -> Result<AssetView, LibraryError> {
    conn.query_row(
        "SELECT id, kind, path, thumbnail_path, media_type, width, height,
                byte_size, sha256, created_at
         FROM assets WHERE id = ?1",
        params![asset_id],
        |r| {
            let kind: String = r.get(1)?;
            Ok(AssetView {
                id: r.get(0)?,
                kind: AssetKind::parse(&kind).unwrap_or(AssetKind::Generated),
                path: r.get(2)?,
                thumbnail_path: r.get(3)?,
                media_type: r.get(4)?,
                width: r.get(5)?,
                height: r.get(6)?,
                byte_size: r.get::<_, i64>(7)? as u64,
                sha256: r.get(8)?,
                created_at: r.get(9)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| LibraryError::NotFound(format!("asset {asset_id}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lib() -> Library {
        Library::open_in_memory().unwrap()
    }

    #[test]
    fn batch_owns_provider_times_variant_jobs() {
        let l = lib();
        let batch = l
            .create_batch("a potato", &Provider::ALL, 3, &[])
            .unwrap();
        assert_eq!(batch.jobs.len(), 6);
        assert!(batch.jobs.iter().all(|j| j.status == JobStatus::Queued));
    }

    #[test]
    fn transition_rules_are_enforced() {
        let l = lib();
        let batch = l.create_batch("x", &[Provider::Openai], 1, &[]).unwrap();
        let job = &batch.jobs[0];
        let running = l
            .transition_job(&job.id, JobStatus::Running, None, None)
            .unwrap();
        assert!(running.started_at.is_some());
        let failed = l
            .transition_job(
                &job.id,
                JobStatus::Failed,
                Some((ErrorCode::BackendError, "HTTP 500 INTERNAL".into())),
                None,
            )
            .unwrap();
        assert_eq!(failed.error_code, Some(ErrorCode::BackendError));
        assert!(failed.finished_at.is_some());
        // Terminal rows are immutable.
        assert!(l
            .transition_job(&job.id, JobStatus::Running, None, None)
            .is_err());
    }

    #[test]
    fn retry_links_and_preserves_the_old_attempt() {
        let l = lib();
        let batch = l.create_batch("x", &[Provider::Openai], 1, &[]).unwrap();
        let job_id = batch.jobs[0].id.clone();
        l.transition_job(&job_id, JobStatus::Running, None, None)
            .unwrap();
        l.transition_job(
            &job_id,
            JobStatus::Failed,
            Some((ErrorCode::Unknown, "boom".into())),
            None,
        )
        .unwrap();
        let retry = l.create_retry_job(&job_id).unwrap();
        assert_eq!(retry.retry_of_job_id.as_deref(), Some(job_id.as_str()));
        assert_eq!(retry.status, JobStatus::Queued);
        let old = l.get_job(&job_id).unwrap();
        assert_eq!(old.status, JobStatus::Failed);
        // Queued jobs cannot be retried.
        assert!(l.create_retry_job(&retry.id).is_err());
    }

    #[test]
    fn recovery_marks_survivors_interrupted() {
        let l = lib();
        let batch = l.create_batch("x", &Provider::ALL, 1, &[]).unwrap();
        l.transition_job(&batch.jobs[0].id, JobStatus::Running, None, None)
            .unwrap();
        let recovered = l.recover_interrupted().unwrap();
        assert_eq!(recovered, 2);
        let after = l.get_batch(&batch.id).unwrap();
        assert!(after
            .jobs
            .iter()
            .all(|j| j.status == JobStatus::Interrupted));
    }

    #[test]
    fn history_pages_have_no_duplicates_or_gaps() {
        let l = lib();
        let mut ids = Vec::new();
        for i in 0..25 {
            let b = l
                .create_batch(&format!("prompt {i}"), &[Provider::Openai], 1, &[])
                .unwrap();
            ids.push(b.id.clone());
            // Include failed jobs in history.
            if i % 3 == 0 {
                let job = &b.jobs[0];
                l.transition_job(&job.id, JobStatus::Running, None, None)
                    .unwrap();
                l.transition_job(
                    &job.id,
                    JobStatus::Failed,
                    Some((ErrorCode::Unknown, "x".into())),
                    None,
                )
                .unwrap();
            }
        }
        let mut seen = Vec::new();
        let mut cursor: Option<Cursor> = None;
        loop {
            let page = l.history_page(cursor.as_ref(), 7).unwrap();
            for b in &page.batches {
                seen.push(b.id.clone());
            }
            match page.next_cursor {
                Some(c) => cursor = Some(c),
                None => break,
            }
        }
        assert_eq!(seen.len(), 25);
        let mut unique = seen.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(unique.len(), 25, "duplicate batches across pages");
        for id in ids {
            assert!(seen.contains(&id), "missing batch {id}");
        }
    }
}
