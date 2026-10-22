// The app manifest makes Tauri generate allow-/deny- permissions for the app's own commands, so each one
// must be granted in a capability. Without it, any local webview may call any app command (tauri-build
// acl.rs). This list must equal `generate_handler!` in src/lib.rs (tests/deps/appCommands.test.ts).
fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "overwrite_with_backup",
            "session_save",
            "session_load",
            "session_list",
            "session_delete",
            "session_prune",
        ]),
    ))
    .expect("failed to run the Tauri build script");
}
