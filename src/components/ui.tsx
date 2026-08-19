import type { CSSProperties, ReactNode } from "react";
import { useEffect } from "react";
import { Icon } from "./Icon";

type Variant = "primary" | "default" | "danger" | "ghost";

const VARIANT_STYLE: Record<Variant, CSSProperties> = {
  primary: { background: "var(--wt-accent)", color: "var(--wt-accent-fg)", borderColor: "transparent" },
  default: { background: "var(--wt-elevated)", color: "var(--wt-fg)", borderColor: "var(--wt-border-strong)" },
  danger: { background: "var(--wt-danger-soft)", color: "var(--wt-danger)", borderColor: "var(--wt-danger)" },
  ghost: { background: "transparent", color: "var(--wt-fg-dim)", borderColor: "transparent" },
};

export function Button({
  children,
  onClick,
  variant = "default",
  icon,
  disabled,
  title,
  size = "md",
}: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: Variant;
  icon?: string;
  disabled?: boolean;
  title?: string;
  size?: "sm" | "md";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="wt-no-drag inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border font-medium transition-colors"
      style={{
        ...VARIANT_STYLE[variant],
        padding: size === "sm" ? "4px 9px" : "7px 13px",
        fontSize: size === "sm" ? 12 : 13,
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
      onMouseEnter={(e) => {
        if (!disabled && variant === "default") e.currentTarget.style.background = "var(--wt-active)";
        if (!disabled && variant === "ghost") e.currentTarget.style.background = "var(--wt-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = VARIANT_STYLE[variant].background as string;
      }}
    >
      {icon && <Icon name={icon} size={size === "sm" ? 15 : 17} />}
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  onClick,
  title,
  disabled,
  active,
  size = 18,
}: {
  icon: string;
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
  active?: boolean;
  size?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="wt-no-drag inline-flex items-center justify-center rounded-lg transition-colors"
      style={{
        width: 34,
        height: 34,
        color: active ? "var(--wt-accent)" : "var(--wt-fg-dim)",
        background: active ? "var(--wt-accent-soft)" : "transparent",
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
      onMouseEnter={(e) => {
        if (!disabled && !active) e.currentTarget.style.background = "var(--wt-hover)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

export function Badge({
  children,
  color = "var(--wt-muted)",
  soft,
}: {
  children: ReactNode;
  color?: string;
  soft?: boolean;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md whitespace-nowrap"
      style={{
        padding: "1px 7px",
        fontSize: 11,
        fontWeight: 600,
        color,
        border: `1px solid ${color}`,
        background: soft ? "color-mix(in srgb, currentColor 12%, transparent)" : "transparent",
      }}
    >
      {children}
    </span>
  );
}

export function Panel({
  title,
  children,
  right,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl ${className}`}
      style={{ background: "var(--wt-panel)", border: "1px solid var(--wt-border)" }}
    >
      {title && (
        <div
          className="flex items-center justify-between px-4 py-2.5"
          style={{ borderBottom: "1px solid var(--wt-border)" }}
        >
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--wt-muted)" }}>
            {title}
          </span>
          {right}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      className="wt-spin inline-block rounded-full"
      style={{
        width: size,
        height: size,
        border: `2px solid var(--wt-border-strong)`,
        borderTopColor: "var(--wt-accent)",
      }}
    />
  );
}

export function Modal({
  title,
  children,
  onClose,
  width = 560,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="wt-fade flex max-h-[82vh] flex-col overflow-hidden rounded-2xl"
        style={{
          width,
          maxWidth: "92vw",
          background: "var(--wt-bg)",
          border: "1px solid var(--wt-border-strong)",
          boxShadow: "var(--wt-shadow)",
        }}
      >
        <div
          className="flex items-center justify-between px-5 py-3.5"
          style={{ borderBottom: "1px solid var(--wt-border)" }}
        >
          <span className="text-sm font-semibold">{title}</span>
          <IconButton icon="close" onClick={onClose} title="閉じる" size={18} />
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
