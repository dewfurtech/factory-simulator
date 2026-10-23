/** Over the 3D pane while its code downloads and the factory is built, so it never sits there blank. */
export function Loading3D({ leaving = false }: { leaving?: boolean }) {
  return (
    <div className={`loading3d${leaving ? ' leaving' : ''}`} role="status" aria-live="polite" data-testid="loading-3d">
      <div className="loading3d-cube" aria-hidden>
        <svg viewBox="0 0 48 48" width="48" height="48" fill="none" strokeWidth="2.5" strokeLinejoin="round">
          <path d="M24 4 42 14v20L24 44 6 34V14z" stroke="var(--line-2)" />
          <path d="M6 14l18 10 18-10M24 24v20" stroke="var(--line-2)" />
          <path className="loading3d-trace" d="M24 4 42 14v20L24 44 6 34V14z" stroke="var(--accent)" />
        </svg>
      </div>
      <b>กำลังสร้างภาพ 3D…</b>
      <span>ขึ้นผนัง วางเครื่องจักร จัดแสง</span>
    </div>
  );
}
