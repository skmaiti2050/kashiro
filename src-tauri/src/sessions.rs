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
/// At most this many saved reviews; saving one more deletes the oldest.
const MAX_SESSIONS: usize = 500;
/// replace_via_temp's temporary files (lib.rs), left behind only by a crash.
const TEMP_SUFFIX: &str = ".writing-check-tmp";

/// One saved review as the webview reads it back.
#[derive(serde::Serialize, Debug, PartialEq)]
pub struct SavedSession {
    key: String,
    json: String,
}

/// session_list's answer: the reviews read, and one "<file>: <cause>" line per file that could not be.
#[derive(serde::Serialize, Debug, PartialEq)]
pub struct SessionList {
    sessions: Vec<SavedSession>,
    problems: Vec<String>,
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
    replace_via_temp(&file, json.as_bytes(), |from, to| fs::rename(from, to))?;
    keep_newest(dir, MAX_SESSIONS).map_err(|e| io::Error::other(format!("the review was saved, but older reviews could not be removed: {e}")))
}

/// The saved review, or None when there is none under `key`.
pub fn load_at(dir: &Path, key: &str) -> io::Result<Option<String>> {
    match fs::read_to_string(session_file(dir, key)?) {
        Ok(json) => Ok(Some(json)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

/// Every saved review in the folder (none when it doesn't exist yet), in no particular order. A review that
/// can't be read doesn't hide the others: it is reported as "<file>: <cause>" in `problems`.
pub fn list_at(dir: &Path) -> io::Result<SessionList> {
    let mut list = SessionList { sessions: Vec::new(), problems: Vec::new() };
    for (name, path) in our_files(dir, &mut list.problems)? {
        let Some(key) = key_of(&name) else { continue };
        match fs::read_to_string(&path) {
            Ok(json) => list.sessions.push(SavedSession { key: key.to_owned(), json }),
            Err(e) => list.problems.push(format!("{name}: {e}")),
        }
    }
    Ok(list)
}

/// The saved reviews and leftover temp files in `dir` (name and path): only these are ever read or deleted.
/// An entry that can't be read is reported in `problems`; a missing folder has none.
fn our_files(dir: &Path, problems: &mut Vec<String>) -> io::Result<Vec<(String, PathBuf)>> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    let mut files = Vec::new();
    for entry in entries {
        match entry {
            Ok(entry) => {
                let name = entry.file_name().to_string_lossy().into_owned();
                if key_of(&name).is_some() || name.ends_with(TEMP_SUFFIX) {
                    files.push((name, entry.path()));
                }
            }
            Err(e) => problems.push(format!("{}: {e}", dir.display())),
        }
    }
    Ok(files)
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
    prune_using(dir, keep_days, now, |path| fs::remove_file(path))
}

/// prune_at with the delete step passed in, so a test can make it fail. A file that can't be deleted (another
/// program holds it) doesn't stop the rest: every failure is collected into one error.
fn prune_using(dir: &Path, keep_days: u32, now: SystemTime, remove: impl Fn(&Path) -> io::Result<()>) -> io::Result<()> {
    let mut problems = Vec::new();
    let cutoff = now.checked_sub(DAY * keep_days).unwrap_or(SystemTime::UNIX_EPOCH);
    for (name, path) in our_files(dir, &mut problems)? {
        let written = match file_written(&path) {
            Ok(Some(written)) => written,
            Ok(None) => continue, // a folder under a review's name: not ours to delete
            Err(e) => {
                problems.push(format!("{name}: {e}"));
                continue;
            }
        };
        if keep_days == 0 || written < cutoff {
            if let Err(e) = remove(&path) {
                problems.push(format!("{name}: {e}"));
            }
        }
    }
    all_done(problems)
}

/// Deletes the oldest saved reviews beyond `max`, so the folder can't grow without bound.
fn keep_newest(dir: &Path, max: usize) -> io::Result<()> {
    let mut problems = Vec::new();
    let mut reviews = Vec::new();
    for (name, path) in our_files(dir, &mut problems)? {
        if key_of(&name).is_none() {
            continue;
        }
        match file_written(&path) {
            Ok(Some(written)) => reviews.push((written, name, path)),
            Ok(None) => {} // a folder under a review's name: not a review, not ours to delete
            Err(e) => problems.push(format!("{name}: {e}")),
        }
    }
    reviews.sort(); // oldest first
    let extra = reviews.len().saturating_sub(max);
    for (_, name, path) in reviews.into_iter().take(extra) {
        if let Err(e) = fs::remove_file(&path) {
            problems.push(format!("{name}: {e}"));
        }
    }
    all_done(problems)
}

/// When a regular file was last written; None for anything else (a folder), which prune and the cap skip.
fn file_written(path: &Path) -> io::Result<Option<SystemTime>> {
    let metadata = fs::metadata(path)?;
    if metadata.is_file() { metadata.modified().map(Some) } else { Ok(None) }
}

/// Ok, or one error listing every file that failed.
fn all_done(problems: Vec<String>) -> io::Result<()> {
    if problems.is_empty() { Ok(()) } else { Err(io::Error::other(problems.join("; "))) }
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
pub async fn session_list(app: tauri::AppHandle) -> Result<SessionList, String> {
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
    fn an_unreadable_review_is_reported_and_the_others_still_listed() {
        let dir = scratch("list-bad");
        save_at(&dir, SHA, "good").unwrap();
        fs::write(dir.join(format!("{UUID}.json")), [0xff, 0xfe, 0x00]).unwrap(); // not UTF-8
        fs::create_dir(dir.join("abc.json")).unwrap(); // a folder under a review's name
        let listed = list_at(&dir).unwrap();
        assert_eq!(listed.sessions, vec![SavedSession { key: SHA.into(), json: "good".into() }]);
        let mut problems = listed.problems.clone();
        problems.sort();
        assert_eq!(problems.len(), 2, "{problems:?}");
        assert!(problems[0].starts_with(&format!("{UUID}.json: ")), "{problems:?}");
        assert!(problems[1].starts_with("abc.json: "), "{problems:?}");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_file_that_cant_be_deleted_does_not_stop_the_prune() {
        let dir = scratch("prune-locked");
        save_at(&dir, SHA, "a").unwrap();
        save_at(&dir, UUID, "b").unwrap();
        // As when another program holds one review open.
        let locked = |path: &Path| {
            if path.ends_with(format!("{SHA}.json")) { Err(io::Error::new(io::ErrorKind::PermissionDenied, "in use")) } else { fs::remove_file(path) }
        };
        let e = prune_using(&dir, 0, SystemTime::now(), locked).unwrap_err();
        assert!(e.to_string().contains(&format!("{SHA}.json: in use")), "{e}");
        assert_eq!(load_at(&dir, UUID).unwrap(), None, "the other review was still deleted");
        assert!(load_at(&dir, SHA).unwrap().is_some());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn keeps_at_most_the_newest_reviews() {
        let dir = scratch("cap");
        let keys = ["a1", "b2", "c3"];
        let now = SystemTime::now();
        for (age, key) in keys.iter().enumerate() {
            save_at(&dir, key, key).unwrap();
            let file = fs::File::options().write(true).open(session_file(&dir, key).unwrap()).unwrap();
            file.set_modified(now - DAY * (3 - age as u32)).unwrap(); // a1 oldest, c3 newest
        }
        keep_newest(&dir, 2).unwrap();
        let mut left: Vec<String> = list_at(&dir).unwrap().sessions.into_iter().map(|s| s.key).collect();
        left.sort();
        assert_eq!(left, vec!["b2", "c3"]);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_cap_counts_and_deletes_only_regular_files() {
        let dir = scratch("cap-folder");
        save_at(&dir, SHA, "a").unwrap();
        fs::create_dir(dir.join(format!("{UUID}.json"))).unwrap(); // a folder under a review's name
        keep_newest(&dir, 1).unwrap();
        assert!(load_at(&dir, SHA).unwrap().is_some(), "the one review is within the cap");
        assert!(dir.join(format!("{UUID}.json")).is_dir(), "the folder is left alone");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn lists_reviews_and_skips_other_files() {
        let dir = scratch("list");
        assert_eq!(list_at(&dir).unwrap(), SessionList { sessions: vec![], problems: vec![] }, "no folder yet: nothing saved");
        save_at(&dir, SHA, "a").unwrap();
        save_at(&dir, UUID, "b").unwrap();
        fs::write(dir.join(".x.json.1-0.writing-check-tmp"), "partial").unwrap();
        fs::write(dir.join("notes.txt"), "not ours").unwrap();
        let SessionList { sessions: mut listed, problems } = list_at(&dir).unwrap();
        assert_eq!(problems, Vec::<String>::new());
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
        assert_eq!(list_at(&dir).unwrap().sessions, vec![]);
        assert!(dir.join("notes.txt").exists(), "files that aren't reviews are left alone");
        prune_at(&scratch("prune-missing"), 30, now).unwrap();
        fs::remove_dir_all(&dir).unwrap();
    }
}
