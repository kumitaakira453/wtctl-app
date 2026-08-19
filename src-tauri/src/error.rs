//! フロントへ返せる（Serialize 可能な）エラー型。

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct WtError {
    pub message: String,
}

impl WtError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl std::fmt::Display for WtError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for WtError {}

impl From<std::io::Error> for WtError {
    fn from(e: std::io::Error) -> Self {
        WtError::new(e.to_string())
    }
}

impl From<serde_json::Error> for WtError {
    fn from(e: serde_json::Error) -> Self {
        WtError::new(e.to_string())
    }
}

pub type WtResult<T> = Result<T, WtError>;
