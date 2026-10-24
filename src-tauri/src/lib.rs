use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::ipc::{InvokeBody, Request};
use tauri_plugin_fs::FsExt;

#[cfg(windows)]
mod job;
mod llm;
mod locale;
mod migrate;
mod sessions;

/// Opens the first free name from `names` with `create_new`, so an existing file, or a link planted
/// under that name, is never written through.
fn create_first_free(names: impl Iterator<Item = PathBuf>) -> io::Result<(PathBuf, File)> {
    for candidate in names {
        match OpenOptions::new().write(true).create_new(true).open(&candidate) {
            Ok(file) => return Ok((candidate, file)),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
    Err(io::Error::other("no free file name"))
}

/// `<stem>.bak.<ext>`, `<stem>.bak-2.<ext>`, …: an earlier backup (which may hold the true original) is never reused.
fn create_backup_file(source: &Path) -> io::Result<(PathBuf, File)> {
    let stem = source.file_stem().ok_or_else(|| io::Error::other("the path has no file name"))?.to_string_lossy().into_owned();
    let ext = source.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    create_first_free((1..1000).map(|n| {
        let suffix = if n == 1 { String::from(".bak") } else { format!(".bak-{n}") };
        source.with_file_name(format!("{stem}{suffix}{ext}"))
    }))
}

/// The end of a temporary file's name; a leftover one (only a crash leaves one) is cleaned up in sessions.rs.
const TEMP_SUFFIX: &str = ".kashiro-tmp";

/// A temporary sibling with a name no other save uses: two quick saves never share one.
fn create_temp_file(target: &Path) -> io::Result<(PathBuf, File)> {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let name = target.file_name().ok_or_else(|| io::Error::other("the path has no file name"))?.to_string_lossy().into_owned();
    let pid = std::process::id();
    create_first_free((0..100).map(|_| {
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        target.with_file_name(format!(".{name}.{pid}-{n}{TEMP_SUFFIX}"))
    }))
}

/// Backs `path` up beside itself, then replaces it with `bytes` by writing a temporary sibling and
/// renaming it over the original, so a failure at any step leaves the original whole. Returns the
/// backup's path; an error after the backup names it.
fn overwrite_with_backup_at(path: &Path, bytes: &[u8]) -> io::Result<PathBuf> {
    overwrite_with_backup_using(path, bytes, |target, bytes| replace_via_temp(target, bytes, |from, to| fs::rename(from, to)))
}

/// overwrite_with_backup_at with the replace step passed in, so a test can make it fail. Every error
/// after the backup exists names it, so the user knows where the copy is.
fn overwrite_with_backup_using(path: &Path, bytes: &[u8], replace: impl FnOnce(&Path, &[u8]) -> io::Result<()>) -> io::Result<PathBuf> {
    // Opened first: a missing or unreadable original leaves no empty backup behind.
    let mut original = File::open(path)?;
    let (backup, mut backup_file) = create_backup_file(path)?;
    let done = (|| {
        io::copy(&mut original, &mut backup_file)?;
        backup_file.sync_all()?;
        drop(original);
        replace(path, bytes)
    })();
    done.map(|_| backup.clone()).map_err(|e| {
        let note = format!("{e}; the original is unchanged, and a backup copy was kept at {}", backup.display());
        io::Error::new(e.kind(), note)
    })
}

/// Writes `bytes` to a fresh temporary sibling and renames it over `target` (`rename` passed in for
/// tests), removing the temporary file if any step fails.
fn replace_via_temp(target: &Path, bytes: &[u8], rename: impl FnOnce(&Path, &Path) -> io::Result<()>) -> io::Result<()> {
    let (temp, mut temp_file) = create_temp_file(target)?;
    let written = (|| {
        temp_file.write_all(bytes)?;
        temp_file.sync_all()?;
        drop(temp_file);
        // On Windows std::fs::rename replaces an existing file (MoveFileExW with REPLACE_EXISTING);
        // it fails while another program (Word) holds the file open.
        rename(&temp, target)
    })();
    if written.is_err() {
        let _ = fs::remove_file(&temp); // best effort: the caller reports the error
    }
    written
}

/// `encodeURIComponent` undone, for the path header (header values must be ASCII, paths may not be).
fn percent_decode(text: &str) -> Option<String> {
    let mut out = Vec::with_capacity(text.len());
    let mut bytes = text.bytes();
    while let Some(b) = bytes.next() {
        if b != b'%' {
            out.push(b);
            continue;
        }
        let hex = [bytes.next()?, bytes.next()?];
        out.push(u8::from_str_radix(std::str::from_utf8(&hex).ok()?, 16).ok()?);
    }
    String::from_utf8(out).ok()
}

/// Overwrite-with-backup for a file the user chose (the open dialog or a drop put it in the fs scope).
/// The webview's fs scope holds only such files, so it can't create the backup or temp file itself.
/// Takes the file as a raw IPC body (no JSON number array) and the path, URI-encoded, in the `path`
/// header. Async, so the disk work runs off the main thread.
#[tauri::command]
async fn overwrite_with_backup(app: tauri::AppHandle, request: Request<'_>) -> Result<String, String> {
    let header = request.headers().get("path").and_then(|v| v.to_str().ok()).ok_or("the save request has no path")?;
    let path = percent_decode(header).ok_or("the save request's path is not valid")?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(String::from("the save request has no file contents"));
    };
    let target = PathBuf::from(&path);
    if !app.fs_scope().is_allowed(&target) {
        return Err(format!("{path} was not opened in Kashiro, so it can't be overwritten"));
    }
    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || overwrite_with_backup_at(&target, &bytes))
        .await
        .map_err(|e| format!("could not overwrite {path}: {e}"))?
        .map(|backup| backup.to_string_lossy().into_owned())
        .map_err(|e| format!("could not overwrite {path}: {e}"))
}

/// How long the page has to show the window (App.tsx does, after its first frame) before Rust does.
const SHOW_WINDOW_FALLBACK: std::time::Duration = std::time::Duration::from_secs(5);

/// The main window starts hidden (tauri.conf.json) so it never flashes white. If the page fails before it can
/// show the window, it is shown anyway, so the app never runs invisibly.
fn show_window_if_page_does_not(app: tauri::AppHandle) {
    use tauri::Manager;
    std::thread::spawn(move || {
        std::thread::sleep(SHOW_WINDOW_FALLBACK);
        let Some(window) = app.get_webview_window("main") else { return };
        if !window.is_visible().unwrap_or(true) {
            let _ = window.show();
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(llm::LlmState::default())
        .setup(|app| {
            // Before the page loads its settings. A failed copy is reported and the app starts with new settings.
            if let Err(e) = migrate::copy_old_app_data_once(app.handle()) {
                eprintln!("{e}");
            }
            show_window_if_page_does_not(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            overwrite_with_backup,
            sessions::session_save,
            sessions::session_load,
            sessions::session_list,
            sessions::session_delete,
            sessions::session_prune,
            llm::sha256_file,
            llm::llm_start,
            llm::llm_stop,
            llm::llm_installed,
            locale::os_locale
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                llm::stop_on_exit(app);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{create_temp_file, overwrite_with_backup_at, overwrite_with_backup_using, percent_decode, replace_via_temp, TEMP_SUFFIX};
    use std::fs;
    use std::path::{Path, PathBuf};

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("writing-check-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn temp_files(dir: &Path) -> usize {
        fs::read_dir(dir).unwrap().filter(|e| e.as_ref().unwrap().file_name().to_string_lossy().ends_with(TEMP_SUFFIX)).count()
    }

    #[test]
    fn the_temp_file_is_named_after_kashiro() {
        let dir = scratch("temp-name");
        let (temp, file) = create_temp_file(&dir.join("a.txt")).unwrap();
        drop(file);
        let name = temp.file_name().unwrap().to_string_lossy().into_owned();
        assert!(name.starts_with(".a.txt.") && name.ends_with(".kashiro-tmp"), "{name}");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn backs_up_first_then_replaces_and_never_reuses_a_backup_name() {
        let dir = scratch("overwrite");
        let doc = dir.join("essay.docx");
        fs::write(&doc, b"original").unwrap();

        let first = overwrite_with_backup_at(&doc, b"checked once").unwrap();
        assert_eq!(first, dir.join("essay.bak.docx"));
        assert_eq!(fs::read(&first).unwrap(), b"original");
        assert_eq!(fs::read(&doc).unwrap(), b"checked once");

        let second = overwrite_with_backup_at(&doc, b"checked twice").unwrap();
        assert_eq!(second, dir.join("essay.bak-2.docx"));
        assert_eq!(fs::read(&first).unwrap(), b"original");
        assert_eq!(fs::read(&second).unwrap(), b"checked once");
        assert_eq!(fs::read(&doc).unwrap(), b"checked twice");
        assert_eq!(temp_files(&dir), 0);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_failed_replace_leaves_the_original_intact_and_names_the_backup() {
        let dir = scratch("overwrite-fail");
        let doc = dir.join("notes.txt");
        fs::write(&doc, b"original").unwrap();
        // As when Word holds the file open: the final rename is refused.
        let locked = |_: &Path, _: &Path| Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "file in use"));

        let e = overwrite_with_backup_using(&doc, b"checked", |target, bytes| replace_via_temp(target, bytes, locked)).unwrap_err();
        assert!(e.to_string().contains("file in use"), "{e}");
        assert!(e.to_string().contains("notes.bak.txt"), "{e}");
        assert_eq!(fs::read(&doc).unwrap(), b"original");
        assert_eq!(fs::read(dir.join("notes.bak.txt")).unwrap(), b"original");
        assert_eq!(temp_files(&dir), 0);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn any_failure_after_the_backup_names_it() {
        let dir = scratch("overwrite-temp-fail");
        let doc = dir.join("essay.docx");
        fs::write(&doc, b"original").unwrap();
        // As when the temporary file can't be created (disk full, folder became read-only).
        let no_temp = |_: &Path, _: &[u8]| Err(std::io::Error::new(std::io::ErrorKind::StorageFull, "disk full"));

        let e = overwrite_with_backup_using(&doc, b"checked", no_temp).unwrap_err();
        assert!(e.to_string().contains("disk full"), "{e}");
        assert!(e.to_string().contains("essay.bak.docx"), "{e}");
        assert_eq!(fs::read(&doc).unwrap(), b"original");
        assert_eq!(fs::read(dir.join("essay.bak.docx")).unwrap(), b"original");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_missing_original_leaves_no_backup() {
        let dir = scratch("overwrite-nobak");
        assert!(overwrite_with_backup_at(&dir.join("gone.txt"), b"x").is_err());
        assert!(!dir.join("gone.bak.txt").exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn quick_saves_never_share_a_temp_file() {
        let dir = scratch("overwrite-temp");
        let doc = dir.join("a.txt");
        fs::write(&doc, b"0").unwrap();
        // A leftover temp from a crash, under the first name the next save could pick, is not reused.
        let pid = std::process::id();
        for n in 0..3 {
            fs::write(dir.join(format!(".a.txt.{pid}-{n}{TEMP_SUFFIX}")), b"stale").unwrap();
        }
        overwrite_with_backup_at(&doc, b"1").unwrap();
        assert_eq!(fs::read(&doc).unwrap(), b"1");
        assert_eq!(temp_files(&dir), 3); // the stale ones, untouched
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_missing_original_writes_nothing() {
        let dir = scratch("overwrite-missing");
        assert!(overwrite_with_backup_at(&dir.join("gone.txt"), b"x").is_err());
        assert!(!dir.join("gone.txt").exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn decodes_uri_encoded_paths() {
        assert_eq!(percent_decode("C%3A%5CUsers%5C%E0%A4%85.docx").unwrap(), "C:\\Users\\अ.docx");
        assert_eq!(percent_decode("/docs/plain.txt").unwrap(), "/docs/plain.txt");
        assert!(percent_decode("%E0%A4").is_none());
        assert!(percent_decode("%4").is_none());
    }
}
