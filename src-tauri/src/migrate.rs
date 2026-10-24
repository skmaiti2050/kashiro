//! The one-time move to the Kashiro identifier (Task R1). Before the rename the app was writing-check, with the
//! identifier app.writingcheck.desktop, so testers' settings and saved reviews are in that app-data folder. On
//! the first start of Kashiro they are copied across; the old folder is never changed or deleted.

use std::fs;
use std::io;
use std::path::Path;
use tauri::Manager;

/// The identifier before the rename: its app-data folder is a sibling of the new one.
const OLD_IDENTIFIER: &str = "app.writingcheck.desktop";
/// What is copied: the settings store (src/ui/platform/settings.ts) and the saved reviews (sessions.rs).
const COPIED: [&str; 2] = ["settings.json", "sessions"];

/// Copies the old app-data folder's settings and saved reviews into the new one, on the first start after
/// the rename. Returns whether it copied.
pub fn copy_old_app_data_once(app: &tauri::AppHandle) -> Result<bool, String> {
    let new = app.path().app_data_dir().map_err(|e| format!("could not find the app's data folder: {e}"))?;
    let old = new.with_file_name(OLD_IDENTIFIER);
    copy_old_app_data(&old, &new).map_err(|e| format!("could not copy the settings and saved reviews from {}: {e}", old.display()))
}

/// When `old` exists and `new` doesn't, copies settings.json and sessions/ from `old` into a new `new`. The copy
/// is made in a temporary sibling and renamed to `new` at the end, so a copy stopped half-way leaves no `new` and
/// is redone whole on the next start. Nothing in `old` is written.
fn copy_old_app_data(old: &Path, new: &Path) -> io::Result<bool> {
    if !old.is_dir() || new.exists() {
        return Ok(false);
    }
    let name = new.file_name().ok_or_else(|| io::Error::other("the app's data folder has no name"))?.to_string_lossy();
    let temp = new.with_file_name(format!("{name}.migrating"));
    if temp.exists() {
        fs::remove_dir_all(&temp)?; // only this module creates it: what an interrupted copy left
    }
    fs::create_dir_all(&temp)?;
    for entry in COPIED {
        copy_if_present(&old.join(entry), &temp.join(entry))?;
    }
    fs::rename(&temp, new)?;
    Ok(true)
}

/// Copies a file, or a folder with everything in it; a missing source is skipped, and so is a link (never followed).
fn copy_if_present(from: &Path, to: &Path) -> io::Result<()> {
    let kind = match fs::symlink_metadata(from) {
        Ok(metadata) => metadata.file_type(),
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e),
    };
    if kind.is_file() {
        fs::copy(from, to)?;
    } else if kind.is_dir() {
        fs::create_dir(to)?;
        for entry in fs::read_dir(from)? {
            let entry = entry?;
            copy_if_present(&entry.path(), &to.join(entry.file_name()))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::copy_old_app_data;
    use std::fs;
    use std::path::PathBuf;

    /// An empty scratch folder holding the old and new app-data folders' paths (neither created).
    fn scratch(name: &str) -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!("writing-check-migrate-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        (dir.join("app.writingcheck.desktop"), dir.join("app.kashiro.desktop"))
    }

    fn write(path: PathBuf, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    fn read(path: PathBuf) -> String {
        fs::read_to_string(path).unwrap()
    }

    #[test]
    fn copies_settings_and_saved_reviews_and_keeps_the_old_folder() {
        let (old, new) = scratch("copy");
        write(old.join("settings.json"), r#"{"dialect":"en-IN"}"#);
        write(old.join("sessions").join("3fa9.json"), "review one");
        write(old.join("sessions").join("0b6e.json"), "review two");
        write(old.join("other.log"), "not copied");

        assert!(copy_old_app_data(&old, &new).unwrap());

        assert_eq!(read(new.join("settings.json")), r#"{"dialect":"en-IN"}"#);
        assert_eq!(read(new.join("sessions").join("3fa9.json")), "review one");
        assert_eq!(read(new.join("sessions").join("0b6e.json")), "review two");
        assert!(!new.join("other.log").exists());
        // The old folder is untouched.
        assert_eq!(read(old.join("settings.json")), r#"{"dialect":"en-IN"}"#);
        assert_eq!(read(old.join("sessions").join("3fa9.json")), "review one");
        assert_eq!(read(old.join("other.log")), "not copied");
    }

    #[test]
    fn runs_once_never_over_the_new_folder() {
        let (old, new) = scratch("once");
        write(old.join("settings.json"), "old");
        write(new.join("settings.json"), "new");

        assert!(!copy_old_app_data(&old, &new).unwrap());

        assert_eq!(read(new.join("settings.json")), "new");
        assert!(!new.join("sessions").exists());
    }

    #[test]
    fn does_nothing_for_a_fresh_install() {
        let (old, new) = scratch("fresh");

        assert!(!copy_old_app_data(&old, &new).unwrap());

        assert!(!new.exists());
    }

    #[test]
    fn copies_what_there_is_when_one_part_is_missing() {
        let (old, new) = scratch("partial");
        write(old.join("sessions").join("3fa9.json"), "review");

        assert!(copy_old_app_data(&old, &new).unwrap());

        assert_eq!(read(new.join("sessions").join("3fa9.json")), "review");
        assert!(!new.join("settings.json").exists());
    }

    #[test]
    fn an_interrupted_copy_is_redone_whole() {
        let (old, new) = scratch("interrupted");
        write(old.join("settings.json"), "settings");
        // What a copy stopped half-way (power cut) leaves: the temporary folder, never a half-filled new one.
        write(new.with_file_name("app.kashiro.desktop.migrating").join("settings.json"), "half");

        assert!(copy_old_app_data(&old, &new).unwrap());

        assert_eq!(read(new.join("settings.json")), "settings");
        assert!(!new.with_file_name("app.kashiro.desktop.migrating").exists());
    }
}
