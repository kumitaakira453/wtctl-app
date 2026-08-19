//! 識別子生成の純粋ユーティリティ。

use sha2::{Digest, Sha256};

/// タグに使える slug へ変換する（`[a-z0-9]` 以外の連続を `-` に、両端の `-` を除去）。
pub fn sanitize(name: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in name.to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "wt".to_string()
    } else {
        trimmed
    }
}

fn basename(path: &str) -> &str {
    path.trim_end_matches('/').rsplit('/').next().unwrap_or(path)
}

/// worktree 専用 image タグのサフィックス。basename の slug にパスのハッシュを付け、
/// 別パスの同名 worktree と衝突しないようにする。
pub fn image_suffix(worktree: &str) -> String {
    let base = sanitize(basename(worktree));
    let mut hasher = Sha256::new();
    hasher.update(worktree.as_bytes());
    let digest = hasher.finalize();
    let hex: String = digest.iter().take(4).map(|b| format!("{b:02x}")).collect();
    format!("{base}-{hex}")
}
