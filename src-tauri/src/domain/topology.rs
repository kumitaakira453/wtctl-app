//! wasurenai ローカルスタックのトポロジ定義（ドメイン知識）。
//!
//! compose.yaml のサービス名・image 名・ポート・bind mount パスと同期させること。
//! ここはリポジトリ外の固定知識であり、compose.yaml 側の変更を自動追従はしない。

pub const PROJECT: &str = "wasurenai";

/// メインチェックアウトの FE dev server（Vite）のポート。
pub const MAIN_FE_PORT: u16 = 3000;

/// 差し替え単位（同一 /app ソースを共有するサービス群）。
pub struct GroupSpec {
    pub key: &'static str,
    pub services: &'static [&'static str],
    pub src: &'static str,
    pub image: &'static str,
    pub dockerfile: &'static str,
    /// migrate / showmigrations を実行する runserver コンテナ。
    pub container: &'static str,
}

/// 個別 compose サービス。
pub struct ServiceSpec {
    pub name: &'static str,
    pub group: &'static str,
    pub src: &'static str,
    /// runserver のホスト側ポート（celery 系は None）。
    pub port: Option<u16>,
}

pub static GROUPS: &[GroupSpec] = &[
    GroupSpec {
        key: "bff",
        services: &["bff", "bff-celery", "bff-celery-beat"],
        src: "backend/bff",
        image: "wasurenai_bff",
        dockerfile: "docker/bff.dockerfile",
        container: "bff",
    },
    GroupSpec {
        key: "assignment",
        services: &["assignment", "assignment-celery"],
        src: "backend/assignment",
        image: "wasurenai_assignment",
        dockerfile: "docker/assignment.dockerfile",
        container: "assignment",
    },
    GroupSpec {
        key: "hanarenai-integration",
        services: &["hanarenai-integration"],
        src: "backend/hanarenai-integration",
        image: "wasurenai_hanarenai_integration",
        dockerfile: "docker/hanarenai-integration.dockerfile",
        container: "hanarenai-integration",
    },
];

pub static SERVICES: &[ServiceSpec] = &[
    ServiceSpec { name: "bff", group: "bff", src: "backend/bff", port: Some(8000) },
    ServiceSpec { name: "bff-celery", group: "bff", src: "backend/bff", port: None },
    ServiceSpec { name: "bff-celery-beat", group: "bff", src: "backend/bff", port: None },
    ServiceSpec { name: "assignment", group: "assignment", src: "backend/assignment", port: Some(8001) },
    ServiceSpec { name: "assignment-celery", group: "assignment", src: "backend/assignment", port: None },
    ServiceSpec {
        name: "hanarenai-integration",
        group: "hanarenai-integration",
        src: "backend/hanarenai-integration",
        port: Some(8002),
    },
];

pub fn known_services() -> Vec<&'static str> {
    SERVICES.iter().map(|s| s.name).collect()
}

pub fn group(key: &str) -> Option<&'static GroupSpec> {
    GROUPS.iter().find(|g| g.key == key)
}

pub fn service(name: &str) -> Option<&'static ServiceSpec> {
    SERVICES.iter().find(|s| s.name == name)
}

pub fn group_of(service_name: &str) -> Option<&'static GroupSpec> {
    service(service_name).and_then(|s| group(s.group))
}

/// 指定グループに属する全サービスを重複なく列挙する。
pub fn services_of(groups: &[String]) -> Vec<String> {
    let mut result: Vec<String> = Vec::new();
    for g in groups {
        if let Some(spec) = group(g) {
            for svc in spec.services {
                if !result.iter().any(|x| x == svc) {
                    result.push((*svc).to_string());
                }
            }
        }
    }
    result
}
