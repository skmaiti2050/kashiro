//! The Windows regional format ("en-IN"), which picks the fallback English variant. The webview's
//! `navigator.language` is the Windows display language instead (often "en-US" on Indian PCs), so the app
//! and the CLI (Node reads the regional format) used to fall back to different variants (Task U3 item 6).

/// The user's regional format, e.g. "en-IN"; None when Windows does not give one.
#[tauri::command]
pub fn os_locale() -> Option<String> {
    user_locale_name()
}

#[cfg(windows)]
fn user_locale_name() -> Option<String> {
    /// LOCALE_NAME_MAX_LENGTH (winnls.h), terminating NUL included.
    const MAX_LENGTH: usize = 85;
    // Declared by hand from kernel32, which std already links (as in job.rs).
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetUserDefaultLocaleName(name: *mut u16, length: i32) -> i32;
    }
    let mut buffer = [0u16; MAX_LENGTH];
    // SAFETY: the buffer is valid for MAX_LENGTH UTF-16 units, the length passed.
    let written = unsafe { GetUserDefaultLocaleName(buffer.as_mut_ptr(), MAX_LENGTH as i32) };
    // `written` counts the terminating NUL; 0 means failure.
    let length = usize::try_from(written).ok()?.checked_sub(1)?;
    let name = String::from_utf16(&buffer[..length]).ok()?;
    (!name.is_empty()).then_some(name)
}

#[cfg(not(windows))]
fn user_locale_name() -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    #[cfg(windows)]
    #[test]
    fn windows_gives_a_language_and_region_like_node_does() {
        let name = super::os_locale().expect("Windows has a user locale");
        assert!(name.contains('-'), "{name} has no region");
        assert!(name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'), "{name}");
    }
}
