//! アクション実行中にフロントへ逐次送るログイベント。
//!
//! `kind` で色分けする: cmd=実行コマンド, out=標準出力/エラー, info/success/warn/error=進捗。

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEvent {
    pub kind: String,
    pub text: String,
}

impl LogEvent {
    fn make(kind: &str, text: impl Into<String>) -> Self {
        Self {
            kind: kind.to_string(),
            text: text.into(),
        }
    }
    pub fn cmd(text: impl Into<String>) -> Self {
        Self::make("cmd", text)
    }
    pub fn out(text: impl Into<String>) -> Self {
        Self::make("out", text)
    }
    pub fn info(text: impl Into<String>) -> Self {
        Self::make("info", text)
    }
    pub fn success(text: impl Into<String>) -> Self {
        Self::make("success", text)
    }
    pub fn warn(text: impl Into<String>) -> Self {
        Self::make("warn", text)
    }
    pub fn error(text: impl Into<String>) -> Self {
        Self::make("error", text)
    }
}

/// サービス層が進捗を送るための出力先。コマンド層で Channel へ橋渡しする。
pub type Sink<'a> = dyn Fn(LogEvent) + Send + Sync + 'a;
