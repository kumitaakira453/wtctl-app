// Rust 側 domain/topology と一致させる固定知識（FE 表示用）。

export const MAIN_FE_PORT = 3000;

export const KNOWN_SERVICES = [
  "bff",
  "bff-celery",
  "bff-celery-beat",
  "assignment",
  "assignment-celery",
  "hanarenai-integration",
] as const;

export const SERVICE_PORT: Record<string, number | null> = {
  bff: 8000,
  "bff-celery": null,
  "bff-celery-beat": null,
  assignment: 8001,
  "assignment-celery": null,
  "hanarenai-integration": 8002,
};

// 差し替え対象ではないが同じスタックで動く基盤サービス。ログ閲覧の対象にする。
export const INFRA_SERVICES = ["db", "dynamodb", "garage", "elasticmq", "selenium"] as const;

// ログを見られる全サービス（アプリ + 基盤）。
export const LOGGABLE_SERVICES: string[] = [...KNOWN_SERVICES, ...INFRA_SERVICES];

export interface GroupDef {
  key: string;
  services: string[];
}

export const GROUPS: GroupDef[] = [
  { key: "bff", services: ["bff", "bff-celery", "bff-celery-beat"] },
  { key: "assignment", services: ["assignment", "assignment-celery"] },
  { key: "hanarenai-integration", services: ["hanarenai-integration"] },
];
