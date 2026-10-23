//! A Windows job object that kills its processes when its last handle closes. The app keeps one handle for its
//! whole life and puts llama-server in the job, so Windows ends the helper even when the app crashes or is
//! killed from Task Manager (no exit handler runs then). Declared by hand from kernel32, which std already
//! links, so no Windows bindings crate is needed.

use std::ffi::c_void;
use std::io;
use std::os::windows::io::AsRawHandle;
use std::process::Child;

type Handle = *mut c_void;

/// JOBOBJECT_BASIC_LIMIT_INFORMATION (winnt.h).
#[repr(C)]
#[derive(Default)]
struct BasicLimits {
    per_process_user_time_limit: i64,
    per_job_user_time_limit: i64,
    limit_flags: u32,
    minimum_working_set_size: usize,
    maximum_working_set_size: usize,
    active_process_limit: u32,
    affinity: usize,
    priority_class: u32,
    scheduling_class: u32,
}

/// JOBOBJECT_EXTENDED_LIMIT_INFORMATION (winnt.h); IO_COUNTERS is six u64s.
#[repr(C)]
#[derive(Default)]
struct ExtendedLimits {
    basic: BasicLimits,
    io_counters: [u64; 6],
    process_memory_limit: usize,
    job_memory_limit: usize,
    peak_process_memory_used: usize,
    peak_job_memory_used: usize,
}

const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION: i32 = 9;
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x2000;

#[link(name = "kernel32")]
unsafe extern "system" {
    fn CreateJobObjectW(attributes: *mut c_void, name: *const u16) -> Handle;
    fn SetInformationJobObject(job: Handle, class: i32, info: *mut c_void, length: u32) -> i32;
    fn AssignProcessToJobObject(job: Handle, process: Handle) -> i32;
    fn CloseHandle(handle: Handle) -> i32;
}

/// A job whose processes die with it: when this is dropped, or when the app process ends however it ends.
pub struct KillOnClose(Handle);

// The handle is only passed to thread-safe kernel calls.
unsafe impl Send for KillOnClose {}

impl KillOnClose {
    pub fn new() -> io::Result<Self> {
        // SAFETY: plain kernel32 calls; every pointer passed is valid for the call, and the size matches the struct.
        unsafe {
            let job = CreateJobObjectW(std::ptr::null_mut(), std::ptr::null());
            if job.is_null() {
                return Err(io::Error::last_os_error());
            }
            let job = KillOnClose(job);
            let mut limits = ExtendedLimits::default();
            limits.basic.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let size = std::mem::size_of::<ExtendedLimits>() as u32;
            if SetInformationJobObject(job.0, JOB_OBJECT_EXTENDED_LIMIT_INFORMATION, (&raw mut limits).cast(), size) == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(job)
        }
    }

    pub fn assign(&self, child: &Child) -> io::Result<()> {
        // SAFETY: the child's handle stays open while `child` is borrowed.
        if unsafe { AssignProcessToJobObject(self.0, child.as_raw_handle()) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
}

impl Drop for KillOnClose {
    fn drop(&mut self) {
        // SAFETY: the handle came from CreateJobObjectW and is closed once.
        unsafe { CloseHandle(self.0) };
    }
}

#[cfg(test)]
mod tests {
    use super::KillOnClose;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    #[test]
    fn closing_the_job_kills_its_process() {
        let job = KillOnClose::new().unwrap();
        // ping waits about 30 s unless it is killed.
        let mut child = Command::new("ping").args(["-n", "30", "127.0.0.1"]).stdout(Stdio::null()).spawn().unwrap();
        job.assign(&child).unwrap();
        assert!(child.try_wait().unwrap().is_none());
        drop(job);
        let deadline = Instant::now() + Duration::from_secs(5);
        while child.try_wait().unwrap().is_none() {
            assert!(Instant::now() < deadline, "the process outlived its job");
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}
