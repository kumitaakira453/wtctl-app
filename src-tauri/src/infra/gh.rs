//! GitHub CLI アダプタ。gh が無い/未認証なら空を返して機能を落とさない。

use std::collections::HashMap;
use std::process::{Command, Stdio};

use crate::domain::models::PrInfo;

fn rank(state: &str) -> i32 {
    match state {
        "draft" | "open" => 0,
        "merged" => 1,
        "closed" => 2,
        _ => 9,
    }
}

pub struct Gh;

impl Gh {
    pub fn pull_requests(&self, repo: &str) -> HashMap<String, PrInfo> {
        let out = Command::new("gh")
            .args([
                "pr", "list", "--state", "all", "--limit", "300", "--json",
                "number,headRefName,state,isDraft,url",
            ])
            .current_dir(repo)
            .stderr(Stdio::null())
            .output();
        let out = match out {
            Ok(o) if o.status.success() => o,
            _ => return HashMap::new(),
        };
        let text = String::from_utf8_lossy(&out.stdout);
        if text.trim().is_empty() {
            return HashMap::new();
        }
        let data: serde_json::Value = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(_) => return HashMap::new(),
        };
        let arr = match data.as_array() {
            Some(a) => a,
            None => return HashMap::new(),
        };
        let mut result: HashMap<String, PrInfo> = HashMap::new();
        for pr in arr {
            let head = pr.get("headRefName").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if head.is_empty() {
                continue;
            }
            let raw_state = pr.get("state").and_then(|v| v.as_str()).unwrap_or("").to_uppercase();
            let is_draft = pr.get("isDraft").and_then(|v| v.as_bool()).unwrap_or(false);
            let state = if is_draft && raw_state == "OPEN" {
                "draft".to_string()
            } else {
                raw_state.to_lowercase()
            };
            let info = PrInfo {
                number: pr.get("number").and_then(|v| v.as_i64()).unwrap_or(0),
                state: state.clone(),
                url: pr.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            };
            let replace = match result.get(&head) {
                None => true,
                Some(prev) => rank(&state) < rank(&prev.state),
            };
            if replace {
                result.insert(head, info);
            }
        }
        result
    }
}
