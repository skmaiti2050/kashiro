//! The local writing helper (Task 12): llama.cpp's `llama-server`, bundled in two builds as resources
//! (`llama/vulkan/` and `llama/cpu/`, see tauri.conf.json), run as a child process on 127.0.0.1 with a random
//! key for each launch. Only this module starts it, from those two paths only, with a fixed argument list plus
//! the model file the user chose: the webview can't pass flags, and has no shell or process permission at all
//! (owner decision, 2026-10-23: no shell plugin). The Vulkan build is tried first when it lists a GPU; if it
//! does not come up, the CPU build is started instead. The server is stopped by llm_stop, on app exit, and
//! (Windows) by a job object when the app dies without running its exit handler.

use sha2::{Digest, Sha256};
use std::ffi::OsString;
use std::fs::File;
use std::hash::{BuildHasher, RandomState};
use std::io::{self, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Manager;
use tauri_plugin_fs::FsExt;

/// The server loads the model before /health answers 200; a 2.5 GB model from a slow disk can take a minute.
const START_TIMEOUT: Duration = Duration::from_secs(120);
/// llama.cpp reads its options from these environment variables too (LLAMA_ARG_TOOLS would turn on its shell
/// tool): none may reach the server except the key we set.
const INHERITED_PREFIXES: [&str; 2] = ["LLAMA_", "GGML_"];

/// `--list-devices` must answer within this; a hung GPU driver means CPU.
const DEVICE_PROBE_TIMEOUT: Duration = Duration::from_secs(15);

/// Which llama-server build runs: Settings shows it.
#[derive(serde::Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Backend {
    Vulkan,
    Cpu,
}

/// What the webview needs to talk to the running server, and which build it is.
#[derive(serde::Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HelperInfo {
    port: u16,
    api_key: String,
    backend: Backend,
}

struct Running {
    child: Child,
    model: PathBuf,
    info: HelperInfo,
}

/// At most one server. Starting and stopping take the same lock, so a start never overlaps a pending stop.
#[derive(Default)]
pub struct LlmState {
    helper: Mutex<Helper>,
}

#[derive(Default)]
struct Helper {
    running: Option<Running>,
    /// Created with the first server and kept for the app's life: closing it would kill the server.
    #[cfg(windows)]
    job: Option<crate::job::KillOnClose>,
}

/// The arguments llama-server gets; nothing else is ever passed. Threads are llama.cpp's default (the
/// physical cores). One slot and 1,024 tokens: one sentence at a time (the client skips longer ones). No web
/// UI, no thinking, offline, and no host-memory prompt cache: it grew private memory from 2.6 to 4 GB over the
/// Task 12 measurement without speeding anything up.
fn server_args(model: &Path, port: u16) -> Vec<OsString> {
    let mut args: Vec<OsString> = vec!["--model".into(), model.as_os_str().to_owned(), "--host".into(), "127.0.0.1".into(), "--port".into(), port.to_string().into()];
    for fixed in ["--ctx-size", "1024", "--parallel", "1", "--cache-ram", "0", "--no-webui", "--reasoning", "off", "--offline", "--no-slots"] {
        args.push(fixed.into());
    }
    args
}

/// A llama-server command with no console window, no input, and none of the app's LLAMA_*/GGML_* settings.
/// `inherited` is the app's environment (passed in for tests).
fn bare_command(exe: &Path, inherited: impl Iterator<Item = (OsString, OsString)>) -> Command {
    let mut command = Command::new(exe);
    command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    for (name, _) in inherited {
        let upper = name.to_string_lossy().to_ascii_uppercase();
        if INHERITED_PREFIXES.iter().any(|prefix| upper.starts_with(prefix)) {
            command.env_remove(&name);
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// The server's command. The key goes in its environment, not its arguments, so it isn't shown in Task
/// Manager's command line.
fn server_command(exe: &Path, model: &Path, port: u16, api_key: &str, inherited: impl Iterator<Item = (OsString, OsString)>) -> Command {
    let mut command = bare_command(exe, inherited);
    command.args(server_args(model, port)).env("LLAMA_API_KEY", api_key);
    command
}

/// True when `--list-devices` output names a GPU: "  Vulkan1: NVIDIA GeForce RTX 3050 Laptop GPU (3965 MiB, …)".
/// llama.cpp itself prefers a dedicated GPU over an integrated one.
fn lists_gpu(output: &str) -> bool {
    output.lines().any(|line| {
        let line = line.trim_start();
        line.strip_prefix("Vulkan").is_some_and(|rest| rest.split(':').next().is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit())))
    })
}

/// Asks the Vulkan build which devices it sees (it exits at once). Any failure or a hang means no GPU.
fn vulkan_gpu_present(exe: &Path) -> bool {
    let mut command = bare_command(exe, std::env::vars_os());
    command.arg("--list-devices").stdout(Stdio::piped());
    let Ok(mut child) = command.spawn() else { return false };
    let mut stdout = child.stdout.take().expect("piped above");
    let reader = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = stdout.read_to_string(&mut text);
        text
    });
    let started = Instant::now();
    while matches!(child.try_wait(), Ok(None)) {
        if started.elapsed() > DEVICE_PROBE_TIMEOUT {
            let _ = child.kill();
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let _ = child.wait();
    reader.join().map(|text| lists_gpu(&text)).unwrap_or(false)
}

/// 64 hex characters derived from std's RandomState, whose SipHash keys come from the OS random generator.
fn new_api_key() -> String {
    let mut hasher = Sha256::new();
    for n in 0..4u8 {
        hasher.update(RandomState::new().hash_one(n).to_le_bytes());
    }
    hex(&hasher.finalize())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// A model file the user chose: an existing `.gguf` file, by absolute path.
fn check_model_path(model: &Path) -> Result<(), String> {
    let is_gguf = model.extension().is_some_and(|e| e.eq_ignore_ascii_case("gguf"));
    if !model.is_absolute() || !is_gguf {
        return Err(format!("{} is not a .gguf model file. Choose the model file again in Settings › Modules.", model.display()));
    }
    if !model.is_file() {
        return Err(format!("The model file {} is missing. Choose it again in Settings › Modules.", model.display()));
    }
    Ok(())
}

/// A port nothing listens on now (the OS picks it).
fn free_port() -> io::Result<u16> {
    Ok(TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?.local_addr()?.port())
}

/// True when GET /health answers 200 (it answers 503 while the model loads).
fn health_ok(port: u16) -> bool {
    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(500)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    if stream.write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n").is_err() {
        return false;
    }
    let mut status = [0u8; 12];
    stream.read_exact(&mut status).is_ok() && status.starts_with(b"HTTP/1.1 200")
}

fn wait_until_ready(child: &mut Child, port: u16) -> Result<(), String> {
    let started = Instant::now();
    loop {
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!("The writing helper stopped while loading the model ({status}). The file may not be a model llama.cpp can run."));
        }
        if health_ok(port) {
            return Ok(());
        }
        if started.elapsed() > START_TIMEOUT {
            return Err(String::from("The writing helper did not finish loading the model within 2 minutes. Try a smaller model."));
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

fn stop_running(helper: &mut Helper) -> io::Result<()> {
    let Some(mut running) = helper.running.take() else { return Ok(()) };
    // kill fails with InvalidInput when the process already ended; then wait just reaps it.
    let killed = running.child.kill();
    running.child.wait()?;
    match killed {
        Err(e) if e.kind() != io::ErrorKind::InvalidInput => Err(e),
        _ => Ok(()),
    }
}

impl LlmState {
    /// Starts the server for `model` with the first of `builds` that comes up (Vulkan, then CPU) and waits
    /// until it answers, or returns the running one when it already serves this model. A server that died, or
    /// serves another model, is replaced. Fails only when every build failed, naming each failure.
    pub fn start(&self, builds: &[(Backend, PathBuf)], model: &Path) -> Result<HelperInfo, String> {
        check_model_path(model)?;
        let mut helper = self.helper.lock().map_err(|_| "the writing helper's state is damaged; restart the app")?;
        if let Some(running) = helper.running.as_mut() {
            let alive = matches!(running.child.try_wait(), Ok(None));
            if alive && running.model == model {
                return Ok(running.info.clone());
            }
        }
        stop_running(&mut helper).map_err(|e| format!("could not stop the previous writing helper: {e}"))?;
        let mut failures = Vec::new();
        for (backend, exe) in builds {
            match Self::launch(&mut helper, *backend, exe, model) {
                Ok(info) => return Ok(info),
                Err(e) => failures.push(e),
            }
        }
        Err(failures.join(" "))
    }

    /// One build: spawn, tie to the job object, wait for /health. Kills the process on any failure.
    fn launch(helper: &mut Helper, backend: Backend, exe: &Path, model: &Path) -> Result<HelperInfo, String> {
        let port = free_port().map_err(|e| format!("no free local port for the writing helper: {e}"))?;
        let api_key = new_api_key();
        let mut child = server_command(exe, model, port, &api_key, std::env::vars_os())
            .spawn()
            .map_err(|e| format!("could not start the writing helper ({}): {e}. Reinstall the app.", exe.display()))?;
        #[cfg(windows)]
        let tied = Self::assign_to_job(helper, &child).map_err(|e| format!("could not tie the writing helper to the app: {e}"));
        #[cfg(not(windows))]
        let tied: Result<(), String> = Ok(());
        if let Err(e) = tied.and_then(|_| wait_until_ready(&mut child, port)) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(e);
        }
        let info = HelperInfo { port, api_key, backend };
        helper.running = Some(Running { child, model: model.to_owned(), info: info.clone() });
        Ok(info)
    }

    #[cfg(windows)]
    fn assign_to_job(helper: &mut Helper, child: &Child) -> io::Result<()> {
        if helper.job.is_none() {
            helper.job = Some(crate::job::KillOnClose::new()?);
        }
        helper.job.as_ref().expect("created above").assign(child)
    }

    /// Stops the server, if one runs, and waits until its process has ended.
    pub fn stop(&self) -> Result<(), String> {
        let mut helper = self.helper.lock().map_err(|_| "the writing helper's state is damaged; restart the app")?;
        stop_running(&mut helper).map_err(|e| format!("could not stop the writing helper: {e}"))
    }
}

/// The bundled builds to try, in order: Vulkan when it lists a GPU, then CPU. These two paths are the only
/// programs the app ever starts.
fn builds_to_try(app: &tauri::AppHandle) -> Result<Vec<(Backend, PathBuf)>, String> {
    let resources = app.path().resource_dir().map_err(|e| format!("could not find the app's folder: {e}"))?;
    let exe = |folder: &str| resources.join("llama").join(folder).join(format!("llama-server{}", std::env::consts::EXE_SUFFIX));
    let vulkan = exe("vulkan");
    let mut builds = Vec::new();
    if vulkan_gpu_present(&vulkan) {
        builds.push((Backend::Vulkan, vulkan));
    }
    builds.push((Backend::Cpu, exe("cpu")));
    Ok(builds)
}

/// SHA-256 of a file in lowercase hex, read in chunks (models are gigabytes).
pub fn sha256_of(path: &Path) -> io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            return Ok(hex(&hasher.finalize()));
        }
        hasher.update(&buffer[..read]);
    }
}

/// The hash of a file the user just chose (the open dialog put it in the fs scope), so the app can name a
/// known model. Async, so a multi-gigabyte read runs off the main thread.
#[tauri::command]
pub async fn sha256_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let file = PathBuf::from(&path);
    if !app.fs_scope().is_allowed(&file) {
        return Err(format!("{path} was not chosen in writing-check, so it can't be read"));
    }
    tauri::async_runtime::spawn_blocking(move || sha256_of(&file))
        .await
        .map_err(|e| format!("could not read {path}: {e}"))?
        .map_err(|e| format!("could not read {path}: {e}"))
}

/// Starts the writing helper with the model file at `model_path` and returns its port, key and build.
#[tauri::command]
pub async fn llm_start(app: tauri::AppHandle, model_path: String) -> Result<HelperInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let builds = builds_to_try(&app)?;
        app.state::<LlmState>().start(&builds, Path::new(&model_path))
    })
    .await
    .map_err(|e| format!("could not start the writing helper: {e}"))?
}

/// Stops the writing helper (AI rewrites switched off, or the model changed).
#[tauri::command]
pub async fn llm_stop(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<LlmState>().stop())
        .await
        .map_err(|e| format!("could not stop the writing helper: {e}"))?
}

/// On app exit: stop the server (the job object covers exits that skip this).
pub fn stop_on_exit(app: &tauri::AppHandle) {
    if let Err(e) = app.state::<LlmState>().stop() {
        eprintln!("{e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;
    use std::fs;

    fn os(text: &str) -> &OsStr {
        OsStr::new(text)
    }

    #[test]
    fn hashes_a_file() {
        let dir = std::env::temp_dir().join(format!("writing-check-sha-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("abc.txt");
        fs::write(&file, b"abc").unwrap();
        assert_eq!(sha256_of(&file).unwrap(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn passes_only_the_fixed_arguments_and_the_model() {
        let model = Path::new("C:/models/qwen.gguf");
        let args: Vec<String> = server_args(model, 4321).iter().map(|a| a.to_string_lossy().into_owned()).collect();
        assert_eq!(
            args,
            [
                "--model", "C:/models/qwen.gguf", "--host", "127.0.0.1", "--port", "4321", "--ctx-size", "1024", "--parallel", "1", "--cache-ram", "0",
                "--no-webui", "--reasoning", "off", "--offline", "--no-slots"
            ]
        );
    }

    #[test]
    fn the_key_goes_in_the_environment_and_llama_settings_from_the_app_do_not() {
        let inherited = [("LLAMA_ARG_TOOLS", "all"), ("ggml_backend", "x"), ("PATH", "C:/Windows"), ("LLAMA_API_KEY", "old")]
            .into_iter()
            .map(|(k, v)| (OsString::from(k), OsString::from(v)));
        let command = server_command(Path::new("llama-server"), Path::new("/m.gguf"), 1, "secret", inherited);
        let envs: Vec<(&OsStr, Option<&OsStr>)> = command.get_envs().collect();
        assert!(envs.contains(&(os("LLAMA_ARG_TOOLS"), None)));
        assert!(envs.contains(&(os("ggml_backend"), None)));
        assert!(envs.contains(&(os("LLAMA_API_KEY"), Some(os("secret")))));
        assert!(!envs.iter().any(|(k, _)| *k == os("PATH")));
        assert!(!command.get_args().any(|a| a.to_string_lossy().contains("secret")));
    }

    #[test]
    fn keys_are_long_random_hex() {
        let (a, b) = (new_api_key(), new_api_key());
        assert_eq!(a.len(), 64);
        assert!(a.bytes().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    #[test]
    fn accepts_only_an_existing_gguf_file_by_absolute_path() {
        let dir = std::env::temp_dir().join(format!("writing-check-model-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let model = dir.join("tiny.GGUF");
        fs::write(&model, b"GGUF").unwrap();
        assert!(check_model_path(&model).is_ok());
        assert!(check_model_path(Path::new("tiny.gguf")).unwrap_err().contains("not a .gguf model file"));
        assert!(check_model_path(&dir.join("notes.txt")).unwrap_err().contains("not a .gguf model file"));
        assert!(check_model_path(&dir.join("gone.gguf")).unwrap_err().contains("is missing"));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn stopping_with_nothing_running_is_fine() {
        assert!(LlmState::default().stop().is_ok());
    }

    #[test]
    fn reads_a_gpu_from_the_device_list() {
        let two = "Available devices:\n  Vulkan0: Intel(R) UHD Graphics (8061 MiB, 7402 MiB free)\n  Vulkan1: NVIDIA GeForce RTX 3050 Laptop GPU (3965 MiB, 3370 MiB free)\n";
        assert!(lists_gpu(two));
        assert!(!lists_gpu("Available devices:\n  (none)\n"));
        assert!(!lists_gpu(""));
        assert!(!lists_gpu("load_backend: loaded Vulkan backend from ggml-vulkan.dll"));
    }

    #[test]
    fn when_every_build_fails_the_error_names_each() {
        let dir = std::env::temp_dir().join(format!("writing-check-nobuild-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let model = dir.join("m.gguf");
        fs::write(&model, b"GGUF").unwrap();
        let builds = [(Backend::Vulkan, dir.join("vulkan/llama-server.exe")), (Backend::Cpu, dir.join("cpu/llama-server.exe"))];
        let e = LlmState::default().start(&builds, &model).unwrap_err();
        assert!(e.contains("vulkan") && e.contains("cpu"), "{e}");
        fs::remove_dir_all(&dir).unwrap();
    }

    /// GET `path` on the server with an optional bearer key; returns the HTTP status.
    fn status_of(port: u16, path: &str, key: Option<&str>) -> u16 {
        let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
        let auth = key.map(|k| format!("Authorization: Bearer {k}\r\n")).unwrap_or_default();
        write!(stream, "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n{auth}Connection: close\r\n\r\n").unwrap();
        let mut reply = String::new();
        stream.read_to_string(&mut reply).unwrap();
        reply[9..12].parse().unwrap()
    }

    fn test_model() -> PathBuf {
        PathBuf::from(std::env::var("WRITING_CHECK_TEST_MODEL").expect("WRITING_CHECK_TEST_MODEL"))
    }

    fn bundled(folder: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries").join(folder).join("llama-server.exe")
    }

    /// Runs the real server: `WRITING_CHECK_TEST_MODEL=<model.gguf> cargo test -- --ignored --test-threads=1`.
    #[test]
    #[ignore = "needs the builds (npm run fetch:llama) and a model in WRITING_CHECK_TEST_MODEL"]
    fn the_real_server_refuses_requests_without_the_key_and_stops() {
        let model = test_model();
        let builds = [(Backend::Cpu, bundled("cpu"))];
        let state = LlmState::default();
        let info = state.start(&builds, &model).unwrap();
        assert_eq!(info.backend, Backend::Cpu);
        assert_eq!(state.start(&builds, &model).unwrap(), info, "a second start reuses the running server");
        assert_eq!(status_of(info.port, "/v1/models", None), 401);
        assert_eq!(status_of(info.port, "/v1/models", Some("wrong")), 401);
        assert_eq!(status_of(info.port, "/v1/models", Some(&info.api_key)), 200);
        state.stop().unwrap();
        assert!(!health_ok(info.port), "the server still answers after stop");
    }

    #[test]
    #[ignore = "needs the builds (npm run fetch:llama), a GPU, and a model in WRITING_CHECK_TEST_MODEL"]
    fn vulkan_when_a_gpu_is_listed_and_cpu_when_vulkan_does_not_come_up() {
        let model = test_model();
        assert!(vulkan_gpu_present(&bundled("vulkan")), "this test needs a Vulkan GPU");
        assert!(!vulkan_gpu_present(&bundled("cpu")), "the CPU build lists no GPU");
        let state = LlmState::default();
        let info = state.start(&[(Backend::Vulkan, bundled("vulkan")), (Backend::Cpu, bundled("cpu"))], &model).unwrap();
        assert_eq!(info.backend, Backend::Vulkan);
        state.stop().unwrap();
        // A Vulkan build that can't start (here: missing) falls back to the CPU build.
        let broken = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries/missing/llama-server.exe");
        let info = state.start(&[(Backend::Vulkan, broken), (Backend::Cpu, bundled("cpu"))], &model).unwrap();
        assert_eq!(info.backend, Backend::Cpu);
        state.stop().unwrap();
    }
}
