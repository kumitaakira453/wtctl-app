//! OS プロセス・Vite の起動/停止アダプタ。

use std::fs::File;
use std::net::TcpStream;
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;

use crate::error::{WtError, WtResult};
use crate::event::Sink;
use crate::infra::shell::stream;

const KILL_WAIT_TICKS: usize = 50; // 0.1s * 50 = 5s

pub struct Process;

impl Process {
    pub fn port_in_use(&self, port: u16) -> bool {
        TcpStream::connect_timeout(
            &format!("127.0.0.1:{port}").parse().unwrap(),
            Duration::from_millis(300),
        )
        .is_ok()
    }

    fn listeners(&self, port: u16) -> Vec<i64> {
        let out = Command::new("lsof")
            .args(["-ti", &format!("tcp:{port}"), "-sTCP:LISTEN"])
            .stderr(Stdio::null())
            .output();
        match out {
            Ok(o) => String::from_utf8_lossy(&o.stdout)
                .split_whitespace()
                .filter_map(|s| s.parse::<i64>().ok())
                .collect(),
            Err(_) => vec![],
        }
    }

    /// 指定ポートを LISTEN しているプロセスを停止する（TERM→KILL）。停止数を返す。
    pub fn terminate_port(&self, port: u16) -> usize {
        let pids = self.listeners(port);
        for pid in &pids {
            let _ = Command::new("kill").arg("-15").arg(pid.to_string()).status();
        }
        for _ in 0..KILL_WAIT_TICKS {
            if self.listeners(port).is_empty() {
                return pids.len();
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        for pid in self.listeners(port) {
            let _ = Command::new("kill").arg("-9").arg(pid.to_string()).status();
        }
        pids.len()
    }

    pub fn lstart(&self, pid: i64) -> String {
        Command::new("ps")
            .args(["-o", "lstart=", "-p", &pid.to_string()])
            .stderr(Stdio::null())
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default()
    }

    /// pid が生存し、かつ起動時刻が記録と一致するか（pid 再利用対策）。
    pub fn is_alive(&self, pid: i64, lstart: &str) -> bool {
        !lstart.is_empty() && self.lstart(pid) == lstart
    }

    pub fn spawn_vite(&self, webdir: &str, port: u16, log_path: &str) -> WtResult<(i64, String)> {
        let vbin = Path::new(webdir).join("node_modules").join(".bin").join("vite");
        if !vbin.exists() {
            return Err(WtError::new(format!("{} が実行できない", vbin.to_string_lossy())));
        }
        let log = File::create(log_path)?;
        let err = log.try_clone()?;
        let child = Command::new(vbin)
            .args(["--host", "0.0.0.0", "--port", &port.to_string(), "--strictPort"])
            .current_dir(webdir)
            .stdout(Stdio::from(log))
            .stderr(Stdio::from(err))
            .process_group(0) // 親から切り離す（setsid 相当）
            .spawn()
            .map_err(|e| WtError::new(format!("vite の起動に失敗: {e}")))?;
        let pid = child.id() as i64;
        Ok((pid, self.lstart(pid)))
    }

    pub fn kill(&self, pid: i64, lstart: &str) {
        if !self.is_alive(pid, lstart) {
            return;
        }
        let _ = Command::new("kill").arg("-15").arg(pid.to_string()).status();
        for _ in 0..KILL_WAIT_TICKS {
            if !self.is_alive(pid, lstart) {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        let _ = Command::new("kill").arg("-9").arg(pid.to_string()).status();
    }

    pub fn npm_ci(&self, worktree: &str, sink: &Sink) -> WtResult<()> {
        // 旧 symlink 方式の node_modules が残っていれば外す
        for link in [
            Path::new(worktree).join("node_modules"),
            Path::new(worktree).join("frontend").join("web").join("node_modules"),
        ] {
            if let Ok(meta) = std::fs::symlink_metadata(&link) {
                if meta.file_type().is_symlink() {
                    let _ = std::fs::remove_file(&link);
                }
            }
        }
        stream(&["npm", "ci"], Some(worktree), true, sink)
    }
}
