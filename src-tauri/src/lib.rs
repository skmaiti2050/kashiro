use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::ipc::{InvokeBody, Request};
use tauri_plugin_fs::FsExt;

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

/// A temporary sibling with a name no other save uses: two quick saves never share one.
fn create_temp_file(target: &Path) -> io::Result<(PathBuf, File)> {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let name = target.file_name().ok_or_else(|| io::Error::other("the path has no file name"))?.to_string_lossy().into_owned();
    let pid = std::process::id();
    create_first_free((0..100).map(|_| {
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        target.with_file_name(format!(".{name}.{pid}-{n}.writing-check-tmp"))
    }))
}

/// Backs `path` up beside itself, then replaces it with `bytes` by writing a temporary sibling and
/// renaming it over the original, so a failure at any step leaves the original whole. Returns the
/// backup's path; an error after the backup names it.
fn overwrite_with_backup_at(path: &Path, bytes: &[u8]) -> io::Result<PathBuf> {
    overwrite_with_backup_using(path, bytes, |from, to| fs::rename(from, to))
}

/// overwrite_with_backup_at with the final rename passed in, so a test can make it fail.
fn overwrite_with_backup_using(path: &Path, bytes: &[u8], rename: impl FnOnce(&Path, &Path) -> io::Result<()>) -> io::Result<PathBuf> {
    let (backup, mut backup_file) = create_backup_file(path)?;
    io::copy(&mut File::open(path)?, &mut backup_file)?;
    backup_file.sync_all()?;

    let (temp, mut temp_file) = create_temp_file(path)?;
    let written = (|| {
        temp_file.write_all(bytes)?;
        temp_file.sync_all()?;
        drop(temp_file);
        // On Windows std::fs::rename replaces an existing file (MoveFileExW with REPLACE_EXISTING);
        // it fails while another program (Word) holds the file open.
        rename(&temp, path)
    })();
    if let Err(e) = written {
        let _ = fs::remove_file(&temp); // best effort: the error below is what the user needs
        let note = format!("{e}; the original is unchanged, and a backup copy was kept at {}", backup.display());
        return Err(io::Error::new(e.kind(), note));
    }
    Ok(backup)
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
        return Err(format!("{path} was not opened in writing-check, so it can't be overwritten"));
    }
    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || overwrite_with_backup_at(&target, &bytes))
        .await
        .map_err(|e| format!("could not overwrite {path}: {e}"))?
        .map(|backup| backup.to_string_lossy().into_owned())
        .map_err(|e| format!("could not overwrite {path}: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![overwrite_with_backup])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{overwrite_with_backup_at, overwrite_with_backup_using, percent_decode};
    use std::fs;
    use std::path::{Path, PathBuf};

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("writing-check-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn temp_files(dir: &Path) -> usize {
        fs::read_dir(dir).unwrap().filter(|e| e.as_ref().unwrap().file_name().to_string_lossy().ends_with(".writing-check-tmp")).count()
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

        let e = overwrite_with_backup_using(&doc, b"checked", locked).unwrap_err();
        assert!(e.to_string().contains("file in use"), "{e}");
        assert!(e.to_string().contains("notes.bak.txt"), "{e}");
        assert_eq!(fs::read(&doc).unwrap(), b"original");
        assert_eq!(fs::read(dir.join("notes.bak.txt")).unwrap(), b"original");
        assert_eq!(temp_files(&dir), 0);
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
            fs::write(dir.join(format!(".a.txt.{pid}-{n}.writing-check-tmp")), b"stale").unwrap();
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
