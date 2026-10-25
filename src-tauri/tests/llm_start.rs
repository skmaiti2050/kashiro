//! The llm_start command itself refuses a model the user never chose (review #4, F3 re-review): the pure
//! helper's tests can't see a command that stops calling it.

use writing_check_lib::{llm_start, LlmState};

#[test]
fn llm_start_refuses_a_model_the_user_did_not_choose() {
    let app = tauri::test::mock_builder()
        .plugin(tauri_plugin_fs::init())
        .manage(LlmState::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("a mock app");
    // Not in the fs scope and never remembered. Without the check, LlmState::start would fail on it as a
    // missing file instead.
    let model = std::env::temp_dir().join("kashiro-never-chosen").join("model.gguf");
    let error = tauri::async_runtime::block_on(llm_start(app.handle().clone(), model.to_string_lossy().into_owned())).unwrap_err();
    assert!(error.contains("was not chosen in Kashiro"), "{error}");
}
