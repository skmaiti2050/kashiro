// The app manifest makes Tauri generate allow-/deny- permissions for the app's own commands, so each one
// must be granted in a capability. Without it, any local webview may call any app command (tauri-build
// acl.rs). This list must equal `generate_handler!` in src/lib.rs (tests/deps/appCommands.test.ts).
fn main() {
    // Test binaries get no app manifest, so Windows gives them comctl32 v5, which lacks TaskDialogIndirect (muda,
    // linked once a test builds a mock app), and the test exe can't start. Ask the linker for the v6 dependency.
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg-tests=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'"
        );
    }
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "overwrite_with_backup",
            "save_copy",
            "session_save",
            "session_load",
            "session_list",
            "session_delete",
            "session_prune",
            "sha256_file",
            "llm_start",
            "llm_stop",
            "llm_installed",
            "os_locale",
            "open_project_page",
        ]),
    ))
    .expect("failed to run the Tauri build script");
}
