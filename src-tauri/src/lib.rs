use std::path::{Path, PathBuf};
use tauri_plugin_fs::FsExt;

/// The first of `<stem>.bak.<ext>`, `<stem>.bak-2.<ext>`, … that does not exist yet, so an earlier
/// backup (which may hold the true original) is never overwritten.
fn free_backup_path(source: &Path) -> Option<PathBuf> {
    let stem = source.file_stem()?.to_string_lossy();
    let ext = source
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    (1..1000).map(|n| {
        let suffix = if n == 1 { String::from(".bak") } else { format!(".bak-{n}") };
        source.with_file_name(format!("{stem}{suffix}{ext}"))
    })
    .find(|candidate| !candidate.exists())
}

/// Copies a file the user chose (it is in the fs scope because the open dialog or a drop put it
/// there) to a free `.bak` name beside it, and returns the backup's path. The webview's fs scope
/// only holds user-chosen files, so it cannot write the backup itself.
#[tauri::command]
fn backup_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let source = PathBuf::from(&path);
    if !app.fs_scope().is_allowed(&source) {
        return Err(format!("{path} was not opened in writing-check, so it is not backed up"));
    }
    let target = free_backup_path(&source).ok_or_else(|| format!("no free backup name for {path}"))?;
    std::fs::copy(&source, &target).map_err(|e| format!("could not back up {path}: {e}"))?;
    Ok(target.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![backup_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::free_backup_path;
    use std::fs;

    #[test]
    fn backup_name_skips_existing_backups() {
        let dir = std::env::temp_dir().join(format!("writing-check-bak-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let source = dir.join("essay.docx");
        assert_eq!(free_backup_path(&source).unwrap(), dir.join("essay.bak.docx"));
        fs::write(dir.join("essay.bak.docx"), b"x").unwrap();
        assert_eq!(free_backup_path(&source).unwrap(), dir.join("essay.bak-2.docx"));
        fs::remove_dir_all(&dir).unwrap();
    }
}
