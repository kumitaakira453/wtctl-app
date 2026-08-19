//! docker / docker compose CLI アダプタ。

use std::collections::HashMap;
use std::path::Path;
use std::process::Command;

use crate::domain::topology::PROJECT;
use crate::error::WtResult;
use crate::event::Sink;
use crate::infra::shell::{capture, stream};

const APP_MOUNT_FMT: &str =
    "{{range .Mounts}}{{if eq .Destination \"/app\"}}{{.Source}}{{end}}{{end}}";

pub struct Docker {
    repo: String,
    override_path: String,
}

impl Docker {
    pub fn new(repo: &str, override_path: &str) -> Self {
        Self { repo: repo.to_string(), override_path: override_path.to_string() }
    }

    fn container(&self, service: &str) -> String {
        format!("{PROJECT}-{service}-1")
    }

    fn compose(&self, args: &[&str], with_override: bool) -> Vec<String> {
        let mut cmd: Vec<String> = vec![
            "docker".into(),
            "compose".into(),
            "-p".into(),
            PROJECT.into(),
            "--project-directory".into(),
            self.repo.clone(),
            "-f".into(),
            Path::new(&self.repo).join("compose.yaml").to_string_lossy().to_string(),
        ];
        let override_yaml = Path::new(&self.repo).join("compose.override.yaml");
        if override_yaml.exists() {
            cmd.push("-f".into());
            cmd.push(override_yaml.to_string_lossy().to_string());
        }
        if with_override && Path::new(&self.override_path).exists() {
            cmd.push("-f".into());
            cmd.push(self.override_path.clone());
        }
        for a in args {
            cmd.push((*a).to_string());
        }
        cmd
    }

    fn run_compose(&self, args: &[&str], with_override: bool, sink: &Sink) -> WtResult<()> {
        let cmd = self.compose(args, with_override);
        let refs: Vec<&str> = cmd.iter().map(String::as_str).collect();
        stream(&refs, None, true, sink)
    }

    pub fn stack_up(&self) -> bool {
        let out = capture(&["docker", "ps", "--format", "{{.Names}}"], None, false).unwrap_or_default();
        out.split_whitespace().any(|n| n == format!("{PROJECT}-db-1"))
    }

    pub fn stack_start(&self, sink: &Sink) -> WtResult<()> {
        self.run_compose(&["start"], false, sink)
    }

    pub fn stack_stop(&self, sink: &Sink) -> WtResult<()> {
        self.run_compose(&["stop"], false, sink)
    }

    pub fn app_mount(&self, service: &str) -> String {
        capture(
            &["docker", "inspect", &self.container(service), "--format", APP_MOUNT_FMT],
            None,
            false,
        )
        .unwrap_or_default()
        .trim()
        .to_string()
    }

    /// 複数サービスの /app mount source と State.Status を 1 回の docker inspect でまとめて取得する。
    /// 返り値: service -> (mount source, container status)。
    pub fn inspect_services(&self, services: &[&str]) -> HashMap<String, (String, String)> {
        let mut by_container: HashMap<String, String> = HashMap::new();
        for s in services {
            by_container.insert(self.container(s), (*s).to_string());
        }
        let fmt = format!("{{{{.Name}}}}\t{APP_MOUNT_FMT}\t{{{{.State.Status}}}}");
        let mut args: Vec<String> = vec!["docker".into(), "inspect".into()];
        for c in by_container.keys() {
            args.push(c.clone());
        }
        args.push("--format".into());
        args.push(fmt);
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let out = capture(&refs, None, false).unwrap_or_default();
        let mut result: HashMap<String, (String, String)> = HashMap::new();
        for line in out.lines() {
            let parts: Vec<&str> = line.splitn(3, '\t').collect();
            if parts.len() < 3 {
                continue;
            }
            let key = parts[0].trim_start_matches('/');
            if let Some(svc) = by_container.get(key) {
                result.insert(svc.clone(), (parts[1].trim().to_string(), parts[2].trim().to_string()));
            }
        }
        result
    }

    pub fn container_state(&self, service: &str) -> String {
        let out = capture(
            &["docker", "inspect", &self.container(service), "--format", "{{.State.Status}}"],
            None,
            false,
        )
        .unwrap_or_default();
        let t = out.trim();
        if t.is_empty() { "missing".to_string() } else { t.to_string() }
    }

    pub fn compose_up(&self, services: &[String], with_override: bool, build: bool, sink: &Sink) -> WtResult<()> {
        let mut args: Vec<&str> = vec!["up", "-d", "--no-deps", "-V"];
        if build {
            args.push("--build");
        }
        for s in services {
            args.push(s.as_str());
        }
        self.run_compose(&args, with_override, sink)
    }

    pub fn compose_restart(&self, service: &str, sink: &Sink) -> WtResult<()> {
        self.run_compose(&["restart", service], false, sink)
    }

    pub fn remove_image(&self, image: &str) {
        let _ = capture(&["docker", "rmi", image], None, false);
    }

    pub fn migrate(&self, container: &str, app: Option<&str>, target: Option<&str>, sink: &Sink) -> WtResult<()> {
        let cname = self.container(container);
        let mut cmd: Vec<&str> = vec!["docker", "exec", &cname, "python", "manage.py", "migrate"];
        if let Some(a) = app {
            cmd.push(a);
        }
        if let Some(t) = target {
            cmd.push(t);
        }
        stream(&cmd, None, true, sink)
    }

    /// コンテナの直近ログ（stdout+stderr 結合）を末尾 tail 行ぶん返す。
    pub fn logs(&self, service: &str, tail: u32) -> String {
        let out = Command::new("docker")
            .args(["logs", "--tail", &tail.to_string(), &self.container(service)])
            .output();
        match out {
            Ok(o) => {
                let mut s = String::from_utf8_lossy(&o.stdout).into_owned();
                let err = String::from_utf8_lossy(&o.stderr);
                if !err.trim().is_empty() {
                    s.push_str(&err);
                }
                s
            }
            Err(e) => format!("docker logs の取得に失敗: {e}"),
        }
    }

    pub fn showmigrations(&self, container: &str, app: &str) -> String {
        capture(
            &["docker", "exec", &self.container(container), "python", "manage.py", "showmigrations", app],
            None,
            false,
        )
        .unwrap_or_default()
    }
}
