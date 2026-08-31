//! docker スタックを触る操作の排他ロック。
//!
//! 起動と停止が重なると db が exit 0 で落ち、依存コンテナが「dependency failed to start」で
//! 起動できなくなる。UI 側のボタン無効化だけでは、アプリの再起動・二重起動・CLI や手動の
//! docker compose をすり抜けるため、プロセスを跨いで効くファイルロックで直列化する。
//!
//! ロックは flock で取る。プロセスが死ねばカーネルが解放するので、pid ファイル方式のような
//! 「取り残されたロックで永久に操作できない」状態にはならない。

use std::fs::{File, OpenOptions};
use std::io::{Seek, SeekFrom, Write};
use std::os::unix::io::AsRawFd;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, TryLockError};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::{WtError, WtResult};
use crate::infra::config;

/// 同一プロセス内の排他。flock は同じプロセスが別 FD で取り直せてしまうため併用する。
static IN_PROCESS: Mutex<()> = Mutex::new(());

/// ロック保持者。取得できなかった側が「誰が何を実行中か」を伝えるために書き出す。
#[derive(Serialize, Deserialize)]
struct Holder {
    pid: u32,
    action: String,
    started_at: u64,
}

fn lock_path() -> PathBuf {
    config::state_dir().join("stack.lock")
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// ロックファイルに残っている保持者情報を人間向けの文言にする。
fn holder_label() -> String {
    let Ok(text) = std::fs::read_to_string(lock_path()) else {
        return "他の docker 操作".to_string();
    };
    let Ok(h) = serde_json::from_str::<Holder>(&text) else {
        return "他の docker 操作".to_string();
    };
    let elapsed = now_secs().saturating_sub(h.started_at);
    format!("{}（pid {} / {} 秒前に開始）", h.action, h.pid, elapsed)
}

fn busy_error() -> WtError {
    WtError::new(format!(
        "{} が実行中のため受け付けません。完了を待って再実行してください。",
        holder_label()
    ))
}

/// LOCK_EX | LOCK_NB。取得できたら true、他が保持中なら false。
fn try_flock(file: &File) -> std::io::Result<bool> {
    let rc = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    if rc == 0 {
        return Ok(true);
    }
    let err = std::io::Error::last_os_error();
    match err.raw_os_error() {
        // EWOULDBLOCK と EAGAIN は同値。他プロセスが保持している場合。
        Some(libc::EWOULDBLOCK) => Ok(false),
        _ => Err(err),
    }
}

/// 保持中はスタックを触る操作を他から実行できない。Drop で解放する。
pub struct StackLock {
    file: File,
    _in_process: MutexGuard<'static, ()>,
}

impl Drop for StackLock {
    fn drop(&mut self) {
        // 次に取得した側が古い保持者を読まないよう内容を消してから解放する。
        let _ = self.file.set_len(0);
        unsafe {
            libc::flock(self.file.as_raw_fd(), libc::LOCK_UN);
        }
    }
}

/// スタック操作のロックを取る。取得できなければ保持者を添えたエラーを返す（待たない）。
pub fn acquire(action: &str) -> WtResult<StackLock> {
    let in_process = match IN_PROCESS.try_lock() {
        Ok(g) => g,
        // 直前の操作が panic していてもロック自体は有効なものとして扱う。
        Err(TryLockError::Poisoned(p)) => p.into_inner(),
        Err(TryLockError::WouldBlock) => return Err(busy_error()),
    };

    let dir = config::state_dir();
    std::fs::create_dir_all(&dir)?;
    // 既存の保持者情報は open では消さない。ロックを取れてから書き換える。
    let mut file =
        OpenOptions::new().read(true).write(true).truncate(false).create(true).open(lock_path())?;

    if !try_flock(&file)? {
        return Err(busy_error());
    }

    let holder = Holder {
        pid: std::process::id(),
        action: action.to_string(),
        started_at: now_secs(),
    };
    file.set_len(0)?;
    file.seek(SeekFrom::Start(0))?;
    file.write_all(serde_json::to_string(&holder)?.as_bytes())?;
    file.flush()?;

    Ok(StackLock { file, _in_process: in_process })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 排他の性質は 1 本のテストにまとめる。XDG_STATE_HOME はプロセス全体の状態なので、
    /// テストを分けると並列実行で互いの状態ディレクトリを奪い合う。
    #[test]
    fn 保持中は弾き解放後は取り直せる() {
        // 実行中の wtctl-app のロックを触らないよう、状態ディレクトリをテスト専用に向ける。
        let dir = std::env::temp_dir().join(format!("wtctl-lock-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::env::set_var("XDG_STATE_HOME", &dir);

        let held = acquire("BE 起動").expect("最初の取得は成功する");

        let Err(blocked) = acquire("BE 停止") else {
            panic!("保持中に取得できてしまった");
        };
        // 誰が何を実行中かを、弾かれた側が判断できる形で伝える。
        assert!(blocked.message.contains("BE 起動"), "{}", blocked.message);
        assert!(
            blocked.message.contains(&format!("pid {}", std::process::id())),
            "{}",
            blocked.message
        );

        drop(held);
        // 解放時に保持者情報を消しておかないと、次に弾かれた側が古い操作名を読んでしまう。
        assert_eq!(std::fs::read_to_string(lock_path()).unwrap(), "");

        let reacquired = acquire("BE 停止").expect("解放後は取得できる");
        drop(reacquired);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
