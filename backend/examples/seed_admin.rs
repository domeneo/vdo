// seed_admin.rs — Run with: cargo run --example seed_admin
// Usage: cargo run --example seed_admin -- <username> <password>
use std::env;

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 {
        eprintln!("Usage: seed_admin <username> <password> [--admin]");
        std::process::exit(1);
    }
    let username = &args[1];
    let password = &args[2];
    let is_admin = args.get(3).map(|s| s == "--admin").unwrap_or(true);

    let hash = bcrypt::hash(password, bcrypt::DEFAULT_COST).expect("bcrypt failed");

    // DB path = same dir as exe
    let db_path = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("vdo.sqlite")))
        .unwrap_or_else(|| std::path::PathBuf::from("vdo.sqlite"));

    let conn = rusqlite::Connection::open(&db_path).expect("cannot open DB");
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS users (
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
        );",
    ).expect("schema failed");

    conn.execute(
        "INSERT INTO users (username, password, is_admin) VALUES (?1, ?2, ?3)
         ON CONFLICT(username) DO UPDATE SET password=excluded.password, is_admin=excluded.is_admin",
        rusqlite::params![username, hash, is_admin],
    ).expect("insert failed");

    println!("✅ User '{}' (admin={}) upserted into {:?}", username, is_admin, db_path);
}
