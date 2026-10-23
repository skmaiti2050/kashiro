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
    /// The CPU build runs because the GPU build was tried and did not come up (the speed advice says so).
    gpu_fallback: bool,
}

struct Running {
    child: Child,
    model: PathBuf,
    info: HelperInfo,
    /// False while the model loads (/health not yet 200).
    ready: bool,
}

/// At most one server. Starts are serialised by `starting`; `helper` is only held for short steps, so a stop
/// (or app exit) can kill a server that is still loading.
#[derive(Default)]
pub struct LlmState {
    starting: Mutex<()>,
    helper: Mutex<Helper>,
}

#[derive(Default)]
struct Helper {
    running: Option<Running>,
    /// Stops asked for so far. A start remembers the count when it begins; if it has moved by the time the
    /// start would spawn (a stop came during the GPU probe), the start is cancelled.
    stop_requests: u64,
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

/// 64 hex characters from std's RandomState. Its SipHash keys are seeded once per thread from the OS random
/// generator, and each later RandomState adds 1 to the first key, so the four hashes share that 128-bit seed:
/// the key carries 128 bits of OS randomness, which SipHash and SHA-256 do not reveal.
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

/// A model file the user chose: an existing `.gguf` file, by absolute local path. A network (UNC) or device
/// path is refused before anything touches it: opening `\\host\share` would send the user's Windows
/// credentials to that host.
fn check_model_path(model: &Path) -> Result<(), String> {
    let text = model.as_os_str().to_string_lossy();
    if text.starts_with(r"\\") || text.starts_with("//") {
        return Err(format!("{text} is on a network share. Copy the model file to this computer and choose it again in Settings › Modules."));
    }
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

/// True when the CPU build runs because a GPU (Vulkan) build was tried and did not come up.
fn gpu_fallback(running: Backend, failed: &[Backend]) -> bool {
    running == Backend::Cpu && failed.contains(&Backend::Vulkan)
}

const DAMAGED: &str ="the writing helper's state is damaged; restart the app";
const STOPPED_WHILE_LOADING: &str = "The writing helper was stopped while it was loading the model.";

impl LlmState {
    fn helper(&self) -> Result<std::sync::MutexGuard<'_, Helper>, String> {
        self.helper.lock().map_err(|_| String::from(DAMAGED))
    }

    /// Starts the server for `model` with the first of `builds()` that comes up (Vulkan, then CPU) and waits
    /// until it answers, or returns the running one when it is ready and serves this model (then `builds` is
    /// never called, so no device probe runs). A server that died, or serves another model, is replaced.
    /// Fails only when every build failed, naming each failure.
    pub fn start(&self, builds: impl FnOnce() -> Result<Vec<(Backend, PathBuf)>, String>, model: &Path) -> Result<HelperInfo, String> {
        check_model_path(model)?;
        // Read before waiting for another start: any stop asked for after this point cancels this start.
        let stops_at_start = self.helper()?.stop_requests;
        // One start at a time; stop never takes this lock, so it can end a server that is still loading.
        let _one_start = self.starting.lock().map_err(|_| String::from(DAMAGED))?;
        {
            let mut helper = self.helper()?;
            if let Some(running) = helper.running.as_mut() {
                let alive = matches!(running.child.try_wait(), Ok(None));
                if alive && running.ready && running.model == model {
                    return Ok(running.info.clone());
                }
            }
            stop_running(&mut helper).map_err(|e| format!("could not stop the previous writing helper: {e}"))?;
        }
        let mut failures = Vec::new();
        let mut failed = Vec::new();
        for (backend, exe) in builds()? {
            match self.launch(backend, &exe, model, stops_at_start, gpu_fallback(backend, &failed)) {
                Ok(info) => return Ok(info),
                Err(e) if e == STOPPED_WHILE_LOADING => return Err(e),
                Err(e) => {
                    failures.push(e);
                    failed.push(backend);
                }
            }
        }
        Err(failures.join(" "))
    }

    /// One build: spawn, tie to the job object, keep it where stop() can kill it, and wait for /health without
    /// holding the lock. Kills the process on any failure. Spawns nothing when a stop was asked for since the
    /// start began (`stops_at_start`): the spawn happens under the same lock that stop() counts under.
    fn launch(&self, backend: Backend, exe: &Path, model: &Path, stops_at_start: u64, gpu_fallback: bool) -> Result<HelperInfo, String> {
        let port = free_port().map_err(|e| format!("no free local port for the writing helper: {e}"))?;
        let api_key = new_api_key();
        {
            let mut helper = self.helper()?;
            if helper.stop_requests != stops_at_start {
                return Err(String::from(STOPPED_WHILE_LOADING));
            }
            let mut child = server_command(exe, model, port, &api_key, std::env::vars_os())
                .spawn()
                .map_err(|e| format!("could not start the writing helper ({}): {e}. Reinstall the app.", exe.display()))?;
            let info = HelperInfo { port, api_key: api_key.clone(), backend, gpu_fallback };
            // Spawning under the lock is short (no wait for the model), and keeps the spawn and the stop count in step.
            #[cfg(windows)]
            if let Err(e) = Self::assign_to_job(&mut helper, &child) {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("could not tie the writing helper to the app: {e}"));
            }
            helper.running = Some(Running { child, model: model.to_owned(), info, ready: false });
        }
        self.wait_until_ready(port)?;
        Ok(HelperInfo { port, api_key, backend, gpu_fallback })
    }

    /// Polls /health until 200. Fails when the process exits, when stop() took it, or after START_TIMEOUT
    /// (then it is killed). The lock is held only for each short check.
    fn wait_until_ready(&self, port: u16) -> Result<(), String> {
        let started = Instant::now();
        loop {
            {
                let mut helper = self.helper()?;
                let Some(running) = helper.running.as_mut().filter(|r| r.info.port == port) else {
                    return Err(String::from(STOPPED_WHILE_LOADING));
                };
                if let Ok(Some(status)) = running.child.try_wait() {
                    helper.running = None;
                    return Err(format!("The writing helper stopped while loading the model ({status}). The file may not be a model llama.cpp can run."));
                }
            }
            let ready = health_ok(port);
            let mut helper = self.helper()?;
            let Some(running) = helper.running.as_mut().filter(|r| r.info.port == port) else {
                return Err(String::from(STOPPED_WHILE_LOADING));
            };
            if ready {
                running.ready = true;
                return Ok(());
            }
            if started.elapsed() > START_TIMEOUT {
                let _ = stop_running(&mut helper);
                return Err(String::from("The writing helper did not finish loading the model within 2 minutes. Try a smaller model."));
            }
            drop(helper);
            std::thread::sleep(Duration::from_millis(250));
        }
    }

    #[cfg(windows)]
    fn assign_to_job(helper: &mut Helper, child: &Child) -> io::Result<()> {
        if helper.job.is_none() {
            helper.job = Some(crate::job::KillOnClose::new()?);
        }
        helper.job.as_ref().expect("created above").assign(child)
    }

    /// Stops the server, if one runs or is still loading, and waits until its process has ended. Never waits
    /// for a start to finish, so app exit can't hang on a model load.
    pub fn stop(&self) -> Result<(), String> {
        let mut helper = self.helper()?;
        helper.stop_requests += 1;
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
    tauri::async_runtime::spawn_blocking(move || app.state::<LlmState>().start(|| builds_to_try(&app), Path::new(&model_path)))
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
    fn refuses_network_and_device_paths_without_touching_them() {
        for path in [r"\\attacker\share\model.gguf", "//attacker/share/model.gguf", r"\\?\UNC\host\share\m.gguf", r"\\.\pipe\m.gguf"] {
            assert!(check_model_path(Path::new(path)).unwrap_err().contains("network share"), "{path}");
        }
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
        let builds = vec![(Backend::Vulkan, dir.join("vulkan/llama-server.exe")), (Backend::Cpu, dir.join("cpu/llama-server.exe"))];
        let e = LlmState::default().start(|| Ok(builds), &model).unwrap_err();
        assert!(e.contains("vulkan") && e.contains("cpu"), "{e}");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_stop_during_the_device_probe_cancels_the_start() {
        let dir = std::env::temp_dir().join(format!("writing-check-probe-stop-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let model = dir.join("m.gguf");
        fs::write(&model, b"GGUF").unwrap();
        let state = LlmState::default();
        // The stop arrives while builds() probes the GPU: nothing may be spawned after it.
        let builds = || {
            state.stop().unwrap();
            Ok(vec![(Backend::Cpu, dir.join("cpu/llama-server.exe"))])
        };
        assert_eq!(state.start(builds, &model).unwrap_err(), STOPPED_WHILE_LOADING);
        // A stop that came before the start does not cancel it: this start runs (and fails on the missing build).
        let e = state.start(|| Ok(vec![(Backend::Cpu, dir.join("cpu/llama-server.exe"))]), &model).unwrap_err();
        assert!(e.contains("could not start the writing helper"), "{e}");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn reports_a_gpu_fallback_only_when_the_cpu_build_runs_after_a_gpu_build_failed() {
        assert!(gpu_fallback(Backend::Cpu, &[Backend::Vulkan]));
        assert!(!gpu_fallback(Backend::Cpu, &[]), "no GPU was listed: nothing fell back");
        assert!(!gpu_fallback(Backend::Vulkan, &[]));
    }

    /// POSTs a one-token chat request, as the client does, with an optional bearer key; returns the HTTP status.
    fn chat_status(port: u16, key: Option<&str>) -> u16 {
        let body = r#"{"messages":[{"role":"user","content":"Hi"}],"max_tokens":1}"#;
        let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
        let auth = key.map(|k| format!("Authorization: Bearer {k}\r\n")).unwrap_or_default();
        let head = format!("POST /v1/chat/completions HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\n", body.len());
        write!(stream, "{head}{auth}Connection: close\r\n\r\n{body}").unwrap();
        let mut reply = String::new();
        stream.read_to_string(&mut reply).unwrap();
        reply[9..12].parse().unwrap()
    }

    fn cpu_only() -> Result<Vec<(Backend, PathBuf)>, String> {
        Ok(vec![(Backend::Cpu, bundled("cpu"))])
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
        let state = LlmState::default();
        let info = state.start(cpu_only, &model).unwrap();
        assert_eq!(info.backend, Backend::Cpu);
        let reused = state.start(|| panic!("no device probe when the running server is reused"), &model).unwrap();
        assert_eq!(reused, info, "a second start reuses the running server");
        assert_eq!(chat_status(info.port, None), 401);
        assert_eq!(chat_status(info.port, Some("wrong")), 401);
        assert_eq!(chat_status(info.port, Some(&info.api_key)), 200);
        state.stop().unwrap();
        assert!(!health_ok(info.port), "the server still answers after stop");
    }

    #[test]
    #[ignore = "needs the builds (npm run fetch:llama) and a model in WRITING_CHECK_TEST_MODEL"]
    fn stop_ends_a_server_that_is_still_loading_without_waiting_for_it() {
        let model = test_model();
        let state = std::sync::Arc::new(LlmState::default());
        let starter = std::thread::spawn({
            let state = state.clone();
            move || state.start(cpu_only, &model)
        });
        // The model takes several seconds to load; stop while it does.
        std::thread::sleep(Duration::from_millis(1500));
        let asked = Instant::now();
        state.stop().unwrap();
        assert!(asked.elapsed() < Duration::from_secs(3), "stop waited {:?}", asked.elapsed());
        assert_eq!(starter.join().unwrap().unwrap_err(), STOPPED_WHILE_LOADING);
    }

    #[test]
    #[ignore = "needs the builds (npm run fetch:llama), a GPU, and a model in WRITING_CHECK_TEST_MODEL"]
    fn vulkan_when_a_gpu_is_listed_and_cpu_when_vulkan_does_not_come_up() {
        let model = test_model();
        assert!(vulkan_gpu_present(&bundled("vulkan")), "this test needs a Vulkan GPU");
        assert!(!vulkan_gpu_present(&bundled("cpu")), "the CPU build lists no GPU");
        let state = LlmState::default();
        let info = state.start(|| Ok(vec![(Backend::Vulkan, bundled("vulkan")), (Backend::Cpu, bundled("cpu"))]), &model).unwrap();
        assert_eq!(info.backend, Backend::Vulkan);
        assert!(!info.gpu_fallback);
        state.stop().unwrap();
        // A Vulkan build that can't start (here: missing) falls back to the CPU build.
        let broken = Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries/missing/llama-server.exe");
        let info = state.start(|| Ok(vec![(Backend::Vulkan, broken), (Backend::Cpu, bundled("cpu"))]), &model).unwrap();
        assert_eq!(info.backend, Backend::Cpu);
        assert!(info.gpu_fallback, "the CPU build runs because the GPU build failed");
        state.stop().unwrap();
    }
}
