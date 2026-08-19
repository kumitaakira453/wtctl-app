//! 最小限の HTTP プローブ（localhost 固定）。進捗は Sink へ流す。

use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

use crate::event::{LogEvent, Sink};

const POLL_INTERVAL_SECS: u64 = 2;
const OK_MIN: u16 = 100;
const OK_MAX: u16 = 500; // 1xx-4xx は応答あり、5xx は壊れ扱い

pub struct Http;

fn parse_url(url: &str) -> Option<(String, u16, String)> {
    let rest = url.strip_prefix("http://")?;
    let (authority, path) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, "/"),
    };
    let (host, port) = match authority.rsplit_once(':') {
        Some((h, p)) => (h.to_string(), p.parse::<u16>().ok()?),
        None => (authority.to_string(), 80),
    };
    Some((host, port, path.to_string()))
}

impl Http {
    /// GET してステータスコードを返す。接続不可・その他は None。
    pub fn probe(&self, url: &str) -> Option<u16> {
        let (host, port, path) = parse_url(url)?;
        let addr = format!("127.0.0.1:{port}");
        let mut stream = TcpStream::connect_timeout(
            &addr.parse().ok()?,
            Duration::from_secs(2),
        )
        .ok()?;
        stream.set_read_timeout(Some(Duration::from_secs(2))).ok()?;
        stream.set_write_timeout(Some(Duration::from_secs(2))).ok()?;
        let req = format!("GET {path} HTTP/1.0\r\nHost: {host}\r\nConnection: close\r\n\r\n");
        stream.write_all(req.as_bytes()).ok()?;
        let mut buf = [0u8; 128];
        let n = stream.read(&mut buf).ok()?;
        let head = String::from_utf8_lossy(&buf[..n]);
        // "HTTP/1.1 200 OK" のコード部分を拾う
        let mut parts = head.split_whitespace();
        let _proto = parts.next()?;
        let code = parts.next()?.parse::<u16>().ok()?;
        Some(code)
    }

    pub fn wait(&self, url: &str, timeout_secs: u64, sink: &Sink) -> bool {
        sink(LogEvent::out(format!("  {url} の応答を待機中…")));
        let mut waited = 0u64;
        let mut last = "接続不可".to_string();
        while waited < timeout_secs {
            if let Some(code) = self.probe(url) {
                last = code.to_string();
                if (OK_MIN..OK_MAX).contains(&code) {
                    sink(LogEvent::out(format!("  {url} -> {code}（{waited}s）")));
                    return true;
                }
            }
            std::thread::sleep(Duration::from_secs(POLL_INTERVAL_SECS));
            waited += POLL_INTERVAL_SECS;
            sink(LogEvent::out(format!("  …待機中 {waited}s（最終応答: {last}）")));
        }
        sink(LogEvent::error(format!(
            "  TIMEOUT: {url} が {timeout_secs}s 以内に応答しない (最終: {last})"
        )));
        false
    }
}
