-- src/schema.sql
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    is_admin BOOLEAN NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    path TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS folder_visibility (
    user_id INTEGER NOT NULL,
    folder_id INTEGER NOT NULL,
    hidden BOOLEAN NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, folder_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS additional_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    path TEXT NOT NULL,
    excluded_folders TEXT NOT NULL DEFAULT '',
    hidden_for_normal_users TEXT NOT NULL DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS playback_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    video_path TEXT NOT NULL,
    start_time REAL NOT NULL DEFAULT 0.0,
    quality TEXT,
    subtitle_id INTEGER,
    audio_id INTEGER,
    rectime DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, video_path),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
