//! subprocess 実行ヘルパ。
//!
//! `capture` は出力を取得して返す。`stream` は行単位で Sink（ログ出力先）へ流す。

use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};

use crate::error::{WtError, WtResult};
use crate::event::{LogEvent, Sink};

/// コマンドを実行し stdout を返す。check=true で非ゼロ終了はエラーにする。
pub fn capture(cmd: &[&str], cwd: Option<&str>, check: bool) -> WtResult<String> {
    let mut c = Command::new(cmd[0]);
    c.args(&cmd[1..]);
    if let Some(dir) = cwd {
        c.current_dir(dir);
    }
    let out = c
        .output()
        .map_err(|e| WtError::new(format!("{} の起動に失敗: {e}", cmd[0])))?;
    if check && !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let stdout = String::from_utf8_lossy(&out.stdout);
        let detail = if !stderr.trim().is_empty() {
            stderr.trim().to_string()
        } else {
            stdout.trim().to_string()
        };
        return Err(WtError::new(format!("$ {}\n{}", cmd.join(" "), detail)));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

/// コマンドを実行し stdout/stderr を行単位で Sink へ流す。
pub fn stream(cmd: &[&str], cwd: Option<&str>, check: bool, sink: &Sink) -> WtResult<()> {
    sink(LogEvent::cmd(format!("$ {}", cmd.join(" "))));
    let mut c = Command::new(cmd[0]);
    c.args(&cmd[1..]);
    if let Some(dir) = cwd {
        c.current_dir(dir);
    }
    c.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = c
        .spawn()
        .map_err(|e| WtError::new(format!("{} の起動に失敗: {e}", cmd[0])))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    std::thread::scope(|s| {
        if let Some(o) = stdout {
            s.spawn(move || {
                for line in BufReader::new(o).lines().map_while(Result::ok) {
                    sink(LogEvent::out(line));
                }
            });
        }
        if let Some(e) = stderr {
            s.spawn(move || {
                for line in BufReader::new(e).lines().map_while(Result::ok) {
                    sink(LogEvent::out(line));
                }
            });
        }
    });

    let status = child.wait()?;
    if check && !status.success() {
        return Err(WtError::new(format!(
            "コマンドが失敗しました (exit {})",
            status.code().unwrap_or(-1)
        )));
    }
    Ok(())
}
