//! 実行中アクションの子プロセス管理と中断。
//!
//! アクションは channel の id で識別する。実行中に起動した子プロセスをその id に
//! 紐づけて覚えておき、中断要求が来たらプロセスグループごと止める。npm ci のように
//! 数分かかる処理を待たされるだけで打ち切れない状態を作らないための仕組み。

use std::cell::Cell;
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

// 今このスレッドが実行しているアクションの id。stream から参照する。
thread_local! {
    static CURRENT: Cell<u32> = const { Cell::new(0) };
}

struct Registry {
    /// アクション id -> 実行中の子プロセスのグループ id
    children: HashMap<u32, HashSet<u32>>,
    /// 中断を要求されたアクション id
    cancelled: HashSet<u32>,
}

fn registry() -> &'static Mutex<Registry> {
    static R: OnceLock<Mutex<Registry>> = OnceLock::new();
    R.get_or_init(|| {
        Mutex::new(Registry { children: HashMap::new(), cancelled: HashSet::new() })
    })
}

/// アクションの開始と終了。終了時に記録を捨てる。
pub fn begin(action: u32) {
    CURRENT.with(|c| c.set(action));
    let mut r = registry().lock().unwrap();
    r.children.entry(action).or_default();
    r.cancelled.remove(&action);
}

pub fn end(action: u32) {
    CURRENT.with(|c| c.set(0));
    let mut r = registry().lock().unwrap();
    r.children.remove(&action);
    r.cancelled.remove(&action);
}

pub fn current() -> u32 {
    CURRENT.with(|c| c.get())
}

/// 子プロセスを登録する。すでに中断要求が出ていれば false を返し、呼び出し側は起動を諦める。
pub fn register(pid: u32) -> bool {
    let action = current();
    if action == 0 {
        return true;
    }
    let mut r = registry().lock().unwrap();
    if r.cancelled.contains(&action) {
        return false;
    }
    r.children.entry(action).or_default().insert(pid);
    true
}

pub fn unregister(pid: u32) {
    let action = current();
    if action == 0 {
        return;
    }
    if let Some(set) = registry().lock().unwrap().children.get_mut(&action) {
        set.remove(&pid);
    }
}

pub fn is_cancelled(action: u32) -> bool {
    registry().lock().unwrap().cancelled.contains(&action)
}

/// 実行中の子プロセスをプロセスグループごと止める。子は process_group(0) で起動しており、
/// pid がそのままグループ id になる。npm のように孫を持つものを取り残さないため、
/// 個別の pid ではなくグループへ送る。
pub fn cancel(action: u32) -> usize {
    let pids: Vec<u32> = {
        let mut r = registry().lock().unwrap();
        r.cancelled.insert(action);
        r.children.get(&action).map(|s| s.iter().copied().collect()).unwrap_or_default()
    };
    for pid in &pids {
        let group = format!("-{pid}");
        let _ = std::process::Command::new("kill").args(["-TERM", &group]).status();
    }
    pids.len()
}
