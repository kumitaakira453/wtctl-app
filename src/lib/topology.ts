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

export interface GroupDef {
  key: string;
  services: string[];
}

export const GROUPS: GroupDef[] = [
  { key: "bff", services: ["bff", "bff-celery", "bff-celery-beat"] },
  { key: "assignment", services: ["assignment", "assignment-celery"] },
  { key: "hanarenai-integration", services: ["hanarenai-integration"] },
];
