use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use tauri_plugin_fs::FsExt;

/// Creates the first free `<stem>.bak.<ext>`, `<stem>.bak-2.<ext>`, … beside `source` and returns it
/// open. `create_new` makes "free" atomic: an earlier backup (which may hold the true original) or a
/// file or link planted under that name is never written through.
fn create_backup_file(source: &Path) -> io::Result<(PathBuf, File)> {
    let stem = source.file_stem().ok_or_else(|| io::Error::other("the path has no file name"))?.to_string_lossy();
    let ext = source.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    for n in 1..1000 {
        let suffix = if n == 1 { String::from(".bak") } else { format!(".bak-{n}") };
        let candidate = source.with_file_name(format!("{stem}{suffix}{ext}"));
        match OpenOptions::new().write(true).create_new(true).open(&candidate) {
            Ok(file) => return Ok((candidate, file)),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
    Err(io::Error::other("no free backup name (999 backups already exist)"))
}

/// Backs `path` up beside itself, then replaces it with `bytes` by writing a temporary sibling and
/// renaming it over the original, so a failure at any step leaves the original whole. Returns the
/// backup's path.
fn overwrite_with_backup_at(path: &Path, bytes: &[u8]) -> io::Result<PathBuf> {
    let (backup, mut backup_file) = create_backup_file(path)?;
    io::copy(&mut File::open(path)?, &mut backup_file)?;
    backup_file.sync_all()?;

    let name = path.file_name().ok_or_else(|| io::Error::other("the path has no file name"))?.to_string_lossy();
    let temp = path.with_file_name(format!(".{name}.writing-check-tmp"));
    let written = (|| {
        let mut file = File::create(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        // On Windows std::fs::rename replaces an existing file (MoveFileExW with REPLACE_EXISTING).
        fs::rename(&temp, path)
    })();
    if written.is_err() {
        let _ = fs::remove_file(&temp); // best effort: the error below is what the user needs
    }
    written.map(|_| backup)
}

/// Overwrite-with-backup for a file the user chose (the open dialog or a drop put it in the fs scope).
/// The webview's fs scope holds only such files, so it can't create the backup or temp file itself.
#[tauri::command]
fn overwrite_with_backup(app: tauri::AppHandle, path: String, bytes: Vec<u8>) -> Result<String, String> {
    let target = PathBuf::from(&path);
    if !app.fs_scope().is_allowed(&target) {
        return Err(format!("{path} was not opened in writing-check, so it can't be overwritten"));
    }
    overwrite_with_backup_at(&target, &bytes)
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
    use super::overwrite_with_backup_at;
    use std::fs;
    use std::path::PathBuf;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("writing-check-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
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
        assert!(!dir.join(".essay.docx.writing-check-tmp").exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_failed_write_leaves_the_original_intact() {
        let dir = scratch("overwrite-fail");
        let doc = dir.join("essay.docx");
        fs::write(&doc, b"original").unwrap();
        // A directory where the temp file goes makes the write fail after the backup.
        fs::create_dir(dir.join(".essay.docx.writing-check-tmp")).unwrap();

        assert!(overwrite_with_backup_at(&doc, b"checked").is_err());
        assert_eq!(fs::read(&doc).unwrap(), b"original");
        assert_eq!(fs::read(dir.join("essay.bak.docx")).unwrap(), b"original");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_missing_original_writes_nothing() {
        let dir = scratch("overwrite-missing");
        assert!(overwrite_with_backup_at(&dir.join("gone.txt"), b"x").is_err());
        assert!(!dir.join("gone.txt").exists());
        fs::remove_dir_all(&dir).unwrap();
    }
}
