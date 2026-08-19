/// Claude のロゴマーク（放射状バースト）を模した SVG。ブランドカラー（clay）で描く。
export function ClaudeMark({ size = 16 }: { size?: number }) {
  const rays = 12;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ display: "block" }}>
      {Array.from({ length: rays }).map((_, i) => (
        <rect
          key={i}
          x={11.15}
          y={2.2}
          width={1.7}
          height={i % 2 === 0 ? 8.2 : 6.6}
          rx={0.85}
          fill="#D97757"
          transform={`rotate(${(i * 360) / rays} 12 12)`}
        />
      ))}
    </svg>
  );
}
