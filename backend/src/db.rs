use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct User {
    pub id: i64,
    pub username: String,
    #[serde(skip_serializing)]
    pub password: String,
    pub is_admin: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Folder {
    pub id: i64,
    pub name: String,
    pub path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FolderInput {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FolderWithVisibility {
    pub id: i64,
    pub name: String,
    pub path: String,
    pub is_hidden_for_normal_users: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AdditionalFolder {
    pub id: i64,
    pub name: String,
    pub path: String,
    pub excluded_folders: String,
    pub hidden_for_normal_users: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PlaybackProgress {
    pub user_id: i64,
    pub video_path: String,
    pub start_time: f64,
    pub quality: Option<String>,
    pub subtitle_id: Option<i64>,
    pub audio_id: Option<i64>,
    pub rectime: String,
}

pub struct Db {
    pub conn: Mutex<Connection>,
}

impl Db {
    pub fn new(path: &str) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(include_str!("schema.sql"))?;

        // Migration: Ensure hidden_for_normal_users column exists in additional_folders
        let _ = conn.execute(
            "ALTER TABLE additional_folders ADD COLUMN hidden_for_normal_users TEXT NOT NULL DEFAULT ''",
            [],
        );

        // Migration: Ensure quality, subtitle_id, audio_id columns exist in playback_progress
        let _ = conn.execute(
            "ALTER TABLE playback_progress ADD COLUMN quality TEXT",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE playback_progress ADD COLUMN subtitle_id INTEGER",
            [],
        );
        let _ = conn.execute(
            "ALTER TABLE playback_progress ADD COLUMN audio_id INTEGER",
            [],
        );

        Ok(Self { conn: Mutex::new(conn) })
    }

    // ─── Playback Progress ────────────────────────────────────────────────────

    pub fn save_playback_progress(
        &self,
        user_id: i64,
        video_path: &str,
        start_time: f64,
        quality: Option<&str>,
        subtitle_id: Option<i64>,
        audio_id: Option<i64>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO playback_progress (user_id, video_path, start_time, quality, subtitle_id, audio_id, rectime)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now', 'localtime'))
             ON CONFLICT(user_id, video_path) DO UPDATE SET
                start_time = excluded.start_time,
                quality = COALESCE(excluded.quality, playback_progress.quality),
                subtitle_id = COALESCE(excluded.subtitle_id, playback_progress.subtitle_id),
                audio_id = COALESCE(excluded.audio_id, playback_progress.audio_id),
                rectime = datetime('now', 'localtime')",
            params![user_id, video_path, start_time, quality, subtitle_id, audio_id],
        )?;
        Ok(())
    }

    pub fn get_playback_progress(&self, user_id: i64, video_path: &str) -> Result<Option<PlaybackProgress>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT user_id, video_path, start_time, quality, subtitle_id, audio_id, datetime(rectime)
             FROM playback_progress
             WHERE user_id = ?1 AND video_path = ?2"
        )?;
        let mut rows = stmt.query(params![user_id, video_path])?;
        if let Some(row) = rows.next()? {
            Ok(Some(PlaybackProgress {
                user_id: row.get(0)?,
                video_path: row.get(1)?,
                start_time: row.get(2)?,
                quality: row.get(3)?,
                subtitle_id: row.get(4)?,
                audio_id: row.get(5)?,
                rectime: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
            }))
        } else {
            Ok(None)
        }
    }

    // ─── Additional Folders ───────────────────────────────────────────────────

    pub fn list_additional_folders(&self) -> Result<Vec<AdditionalFolder>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, path, excluded_folders, COALESCE(hidden_for_normal_users, '') FROM additional_folders ORDER BY id"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(AdditionalFolder {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                excluded_folders: row.get(3)?,
                hidden_for_normal_users: row.get(4)?,
            })
        })?;
        rows.collect()
    }

    pub fn add_additional_folder(
        &self,
        name: &str,
        path: &str,
        excluded_folders: &str,
        hidden_for_normal_users: &str,
    ) -> Result<AdditionalFolder> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO additional_folders (name, path, excluded_folders, hidden_for_normal_users) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(name) DO UPDATE SET
                path=excluded.path,
                excluded_folders=excluded.excluded_folders,
                hidden_for_normal_users=excluded.hidden_for_normal_users",
            params![name, path, excluded_folders, hidden_for_normal_users],
        )?;
        let id = conn.last_insert_rowid();
        Ok(AdditionalFolder {
            id,
            name: name.to_string(),
            path: path.to_string(),
            excluded_folders: excluded_folders.to_string(),
            hidden_for_normal_users: hidden_for_normal_users.to_string(),
        })
    }

    pub fn update_additional_folder(
        &self,
        id: i64,
        name: &str,
        path: &str,
        excluded_folders: &str,
        hidden_for_normal_users: &str,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE additional_folders SET name = ?1, path = ?2, excluded_folders = ?3, hidden_for_normal_users = ?4 WHERE id = ?5",
            params![name, path, excluded_folders, hidden_for_normal_users, id],
        )?;
        Ok(())
    }

    pub fn delete_additional_folder(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM additional_folders WHERE id = ?1", params![id])?;
        Ok(())
    }

    // ─── Settings ─────────────────────────────────────────────────────────────

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
        let mut rows = stmt.query(params![key])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    // ─── Users ────────────────────────────────────────────────────────────────

    pub fn get_user_by_name(&self, name: &str) -> Result<Option<User>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, username, password, is_admin FROM users WHERE username = ?1",
        )?;
        let mut rows = stmt.query(params![name])?;
        if let Some(row) = rows.next()? {
            Ok(Some(User {
                id: row.get(0)?,
                username: row.get(1)?,
                password: row.get(2)?,
                is_admin: row.get(3)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn create_user(&self, username: &str, password_hash: &str, is_admin: bool) -> Result<User> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO users (username, password, is_admin) VALUES (?1, ?2, ?3)",
            params![username, password_hash, is_admin],
        )?;
        let id = conn.last_insert_rowid();
        Ok(User {
            id,
            username: username.to_string(),
            password: password_hash.to_string(),
            is_admin,
        })
    }

    pub fn list_users(&self) -> Result<Vec<User>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, username, password, is_admin FROM users ORDER BY id",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(User {
                id: row.get(0)?,
                username: row.get(1)?,
                password: row.get(2)?,
                is_admin: row.get(3)?,
            })
        })?;
        rows.collect()
    }

    pub fn delete_user(&self, user_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM users WHERE id = ?1", params![user_id])?;
        Ok(())
    }

    pub fn list_non_admin_user_ids(&self) -> Result<Vec<i64>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id FROM users WHERE is_admin = 0")?;
        let rows = stmt.query_map([], |row| row.get(0))?;
        rows.collect()
    }

    // ─── Folders ──────────────────────────────────────────────────────────────

    pub fn list_folders(&self) -> Result<Vec<Folder>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, name, path FROM folders ORDER BY name")?;
        let rows = stmt.query_map([], |row| {
            Ok(Folder {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
            })
        })?;
        rows.collect()
    }

    pub fn list_folders_with_visibility(&self) -> Result<Vec<FolderWithVisibility>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT f.id, f.name, f.path, 
             COALESCE((SELECT 1 FROM folder_visibility fv WHERE fv.folder_id = f.id AND fv.hidden = 1 LIMIT 1), 0) as is_hidden
             FROM folders f
             ORDER BY f.name"
        )?;
        let rows = stmt.query_map([], |row| {
            let hidden_val: i64 = row.get(3)?;
            Ok(FolderWithVisibility {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                is_hidden_for_normal_users: hidden_val == 1,
            })
        })?;
        rows.collect()
    }

    pub fn is_folder_hidden_for_user(&self, user_id: i64, folder_name: &str) -> bool {
        let conn = self.conn.lock().unwrap();
        let mut stmt = match conn.prepare(
            "SELECT fv.hidden FROM folders f
             JOIN folder_visibility fv ON f.id = fv.folder_id
             WHERE f.name = ?1 AND fv.user_id = ?2"
        ) {
            Ok(s) => s,
            Err(_) => return false,
        };
        let mut rows = match stmt.query(params![folder_name, user_id]) {
            Ok(r) => r,
            Err(_) => return false,
        };
        if let Ok(Some(row)) = rows.next() {
            let hidden: i64 = row.get(0).unwrap_or(0);
            return hidden == 1;
        }
        false
    }

    pub fn get_hidden_folder_names_for_user(&self, user_id: i64) -> Vec<String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = match conn.prepare(
            "SELECT f.name FROM folders f
             JOIN folder_visibility fv ON f.id = fv.folder_id
             WHERE fv.user_id = ?1 AND fv.hidden = 1"
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        let rows = stmt.query_map(params![user_id], |row| row.get(0));
        match rows {
            Ok(r) => r.filter_map(|res| res.ok()).collect(),
            Err(_) => Vec::new(),
        }
    }

    pub fn sync_folders(&self, inputs: &[FolderInput]) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        for fi in inputs {
            conn.execute(
                "INSERT INTO folders (name, path) VALUES (?1, ?2)
                 ON CONFLICT(name) DO UPDATE SET path=excluded.path",
                params![fi.name, fi.path],
            )?;
        }
        Ok(())
    }

    pub fn visible_folders_for_user(&self, user_id: i64) -> Result<Vec<Folder>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT f.id, f.name, f.path FROM folders f
            LEFT JOIN folder_visibility fv
                ON f.id = fv.folder_id AND fv.user_id = ?1
            WHERE fv.hidden IS NULL OR fv.hidden = 0
            ORDER BY f.name",
        )?;
        let rows = stmt.query_map(params![user_id], |row| {
            Ok(Folder {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
            })
        })?;
        rows.collect()
    }

    pub fn hide_folder_for_user(&self, user_id: i64, folder_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO folder_visibility (user_id, folder_id, hidden) VALUES (?1, ?2, 1)
             ON CONFLICT(user_id, folder_id) DO UPDATE SET hidden=1",
            params![user_id, folder_id],
        )?;
        Ok(())
    }

    pub fn show_folder_for_user(&self, user_id: i64, folder_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO folder_visibility (user_id, folder_id, hidden) VALUES (?1, ?2, 0)
             ON CONFLICT(user_id, folder_id) DO UPDATE SET hidden=0",
            params![user_id, folder_id],
        )?;
        Ok(())
    }
}
