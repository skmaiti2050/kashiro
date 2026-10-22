//! Saved review sessions (Task S3): one JSON file per review in `<app data>/sessions/`. The webview's fs
//! scope holds only files the user chose, and must not be widened to the app's data folder, so these
//! commands do the disk work. Keys come from the webview: only hex or uuid keys are accepted, so a key can
//! never name a path outside the folder.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use tauri::Manager;

use crate::replace_via_temp;

const FOLDER: &str = "sessions";
const EXTENSION: &str = ".json";
/// A SHA-256 in hex is 64 characters, a uuid 36.
const MAX_KEY_LENGTH: usize = 64;
/// Far above any real review (pasted text included): a runaway caller can't fill the disk.
const MAX_SESSION_BYTES: usize = 32 * 1024 * 1024;
const DAY: Duration = Duration::from_secs(24 * 60 * 60);

/// One saved review as the webview reads it back.
#[derive(serde::Serialize, Debug, PartialEq)]
pub struct SavedSession {
    key: String,
    json: String,
}

/// Hex digits and dashes only ("3fa9…", "0b6e1c2a-…"): no separator, dot or drive letter can get in.
fn is_session_key(key: &str) -> bool {
    !key.is_empty() && key.len() <= MAX_KEY_LENGTH && key.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
}

fn session_file(dir: &Path, key: &str) -> io::Result<PathBuf> {
    if !is_session_key(key) {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, format!("\"{key}\" is not a saved review's key")));
    }
    Ok(dir.join(format!("{key}{EXTENSION}")))
}

/// The key of a saved review's file name ("<key>.json"); None for anything else in the folder (temp files).
fn key_of(name: &str) -> Option<&str> {
    name.strip_suffix(EXTENSION).filter(|key| is_session_key(key))
}

/// Writes the review through a temporary file renamed over the old one, so a crash never leaves half a file.
pub fn save_at(dir: &Path, key: &str, json: &str) -> io::Result<()> {
    let file = session_file(dir, key)?;
    if json.len() > MAX_SESSION_BYTES {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "the saved review is too large"));
    }
    fs::create_dir_all(dir)?;
    replace_via_temp(&file, json.as_bytes(), |from, to| fs::rename(from, to))
}

/// The saved review, or None when there is none under `key`.
pub fn load_at(dir: &Path, key: &str) -> io::Result<Option<String>> {
    match fs::read_to_string(session_file(dir, key)?) {
        Ok(json) => Ok(Some(json)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

/// Every saved review in the folder (none when it doesn't exist yet), in no particular order.
pub fn list_at(dir: &Path) -> io::Result<Vec<SavedSession>> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    let mut sessions = Vec::new();
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(key) = key_of(&name) else { continue };
        sessions.push(SavedSession { key: key.to_owned(), json: fs::read_to_string(entry.path())? });
    }
    Ok(sessions)
}

/// Deletes one saved review; deleting one that isn't there is not an error.
pub fn delete_at(dir: &Path, key: &str) -> io::Result<()> {
    match fs::remove_file(session_file(dir, key)?) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

/// Deletes the saved reviews (and leftover temp files) last written more than `keep_days` before `now`;
/// 0 deletes them all. Only this folder's own files are touched.
pub fn prune_at(dir: &Path, keep_days: u32, now: SystemTime) -> io::Result<()> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e),
    };
    let cutoff = now.checked_sub(DAY * keep_days).unwrap_or(SystemTime::UNIX_EPOCH);
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let ours = key_of(&name).is_some() || name.ends_with(".writing-check-tmp");
        if !ours || !entry.file_type()?.is_file() {
            continue;
        }
        let written = entry.metadata()?.modified()?;
        if keep_days == 0 || written < cutoff {
            fs::remove_file(entry.path())?;
        }
    }
    Ok(())
}

fn sessions_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data = app.path().app_data_dir().map_err(|e| format!("could not find the app's data folder: {e}"))?;
    Ok(data.join(FOLDER))
}

/// Runs `work` on the sessions folder off the main thread, with the error as a message the UI can show.
async fn in_sessions_dir<T: Send + 'static>(
    app: tauri::AppHandle,
    what: &'static str,
    work: impl FnOnce(&Path) -> io::Result<T> + Send + 'static,
) -> Result<T, String> {
    let dir = sessions_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || work(&dir))
        .await
        .map_err(|e| format!("could not {what}: {e}"))?
        .map_err(|e| format!("could not {what}: {e}"))
}

#[tauri::command]
pub async fn session_save(app: tauri::AppHandle, key: String, json: String) -> Result<(), String> {
    in_sessions_dir(app, "save the review", move |dir| save_at(dir, &key, &json)).await
}

#[tauri::command]
pub async fn session_load(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    in_sessions_dir(app, "read the saved review", move |dir| load_at(dir, &key)).await
}

#[tauri::command]
pub async fn session_list(app: tauri::AppHandle) -> Result<Vec<SavedSession>, String> {
    in_sessions_dir(app, "list the saved reviews", list_at).await
}

#[tauri::command]
pub async fn session_delete(app: tauri::AppHandle, key: String) -> Result<(), String> {
    in_sessions_dir(app, "delete the saved review", move |dir| delete_at(dir, &key)).await
}

#[tauri::command]
pub async fn session_prune(app: tauri::AppHandle, keep_days: u32) -> Result<(), String> {
    in_sessions_dir(app, "delete old saved reviews", move |dir| prune_at(dir, keep_days, SystemTime::now())).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("writing-check-sessions-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    const SHA: &str = "3fa9c0d1e2f3a4b5c6d7e8f90123456789abcdef0123456789abcdef01234567";
    const UUID: &str = "0b6e1c2a-5d3f-4e8a-9b1c-2d3e4f5a6b7c";

    #[test]
    fn accepts_hex_and_uuid_keys_only() {
        assert!(is_session_key(SHA));
        assert!(is_session_key(UUID));
        for bad in ["", "..", "../settings", "..\\settings", "a/b", "a\\b", "C:", "abc.json", "x", " 12", &"a".repeat(65)] {
            assert!(!is_session_key(bad), "{bad:?} was accepted");
        }
    }

    #[test]
    fn a_bad_key_never_reaches_the_disk() {
        let dir = scratch("bad-key");
        for bad in ["../escape", "..", "a/b"] {
            assert_eq!(save_at(&dir, bad, "{}").unwrap_err().kind(), io::ErrorKind::InvalidInput);
            assert_eq!(load_at(&dir, bad).unwrap_err().kind(), io::ErrorKind::InvalidInput);
            assert_eq!(delete_at(&dir, bad).unwrap_err().kind(), io::ErrorKind::InvalidInput);
        }
        assert!(!dir.exists(), "nothing was created");
        assert!(!dir.parent().unwrap().join("escape.json").exists());
    }

    #[test]
    fn saves_atomically_and_reads_back() {
        let dir = scratch("save");
        save_at(&dir, SHA, r#"{"v":1}"#).unwrap();
        save_at(&dir, SHA, r#"{"v":2}"#).unwrap();
        assert_eq!(load_at(&dir, SHA).unwrap().as_deref(), Some(r#"{"v":2}"#));
        assert_eq!(load_at(&dir, UUID).unwrap(), None);
        // Only the review itself is left: the temporary file was renamed over it.
        let names: Vec<String> = fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        assert_eq!(names, vec![format!("{SHA}.json")]);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_failed_rename_keeps_the_old_review_whole() {
        let dir = scratch("save-fail");
        save_at(&dir, SHA, "old").unwrap();
        let file = session_file(&dir, SHA).unwrap();
        let refused = |_: &Path, _: &Path| Err(io::Error::new(io::ErrorKind::PermissionDenied, "in use"));
        assert!(replace_via_temp(&file, b"new", refused).is_err());
        assert_eq!(load_at(&dir, SHA).unwrap().as_deref(), Some("old"));
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1, "no temp file left");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn lists_reviews_and_skips_other_files() {
        let dir = scratch("list");
        assert_eq!(list_at(&dir).unwrap(), vec![], "no folder yet: nothing saved");
        save_at(&dir, SHA, "a").unwrap();
        save_at(&dir, UUID, "b").unwrap();
        fs::write(dir.join(".x.json.1-0.writing-check-tmp"), "partial").unwrap();
        fs::write(dir.join("notes.txt"), "not ours").unwrap();
        let mut listed = list_at(&dir).unwrap();
        listed.sort_by(|a, b| a.key.cmp(&b.key));
        assert_eq!(
            listed,
            vec![SavedSession { key: UUID.into(), json: "b".into() }, SavedSession { key: SHA.into(), json: "a".into() }]
        );
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn deletes_one_review_and_a_missing_one_is_fine() {
        let dir = scratch("delete");
        save_at(&dir, SHA, "a").unwrap();
        delete_at(&dir, SHA).unwrap();
        delete_at(&dir, SHA).unwrap();
        assert_eq!(load_at(&dir, SHA).unwrap(), None);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn prune_removes_old_reviews_and_zero_keeps_nothing() {
        let dir = scratch("prune");
        save_at(&dir, SHA, "old").unwrap();
        save_at(&dir, UUID, "new").unwrap();
        fs::write(dir.join("notes.txt"), "not ours").unwrap();
        let now = SystemTime::now();
        let old = fs::File::options().write(true).open(session_file(&dir, SHA).unwrap()).unwrap();
        old.set_modified(now - DAY * 31).unwrap();
        drop(old);

        prune_at(&dir, 30, now).unwrap();
        assert_eq!(load_at(&dir, SHA).unwrap(), None);
        assert_eq!(load_at(&dir, UUID).unwrap().as_deref(), Some("new"));

        prune_at(&dir, 0, now).unwrap();
        assert_eq!(list_at(&dir).unwrap(), vec![]);
        assert!(dir.join("notes.txt").exists(), "files that aren't reviews are left alone");
        prune_at(&scratch("prune-missing"), 30, now).unwrap();
        fs::remove_dir_all(&dir).unwrap();
    }
}
