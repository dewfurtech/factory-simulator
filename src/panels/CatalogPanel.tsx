import { useEffect, useMemo, useState } from 'react';
import { CATALOG, GROUP_LABEL, GROUP_ORDER, type CatalogItem } from '../model/catalog';
import { useUi } from '../store/ui';
import { ASSET_MIME, setDraggedAsset } from '../editor2d/PlanEditor';
import { Icon } from '../editor2d/Toolbar';
import { thumbnail } from '../view3d/thumbs';

function Thumb({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    thumbnail(id, (u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [id]);
  return url ? <img src={url} alt="" draggable={false} /> : <span className="thumb-wait" />;
}

const fmtSize = (c: CatalogItem) => `${(c.size.w / 1000).toFixed(1)}×${(c.size.d / 1000).toFixed(1)} ม.`;

/** The library of Mastrox machines and built-in factory pieces: click to place, or drag onto the plan. */
export function CatalogPanel() {
  const [q, setQ] = useState('');
  const tool = useUi((s) => s.tool);
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const shown = CATALOG.filter((c) => !needle || c.label.toLowerCase().includes(needle) || c.id.includes(needle) || (c.summary ?? '').toLowerCase().includes(needle));
    return GROUP_ORDER.map((g) => ({ g, items: shown.filter((c) => c.group === g) })).filter((x) => x.items.length);
  }, [q]);
  return (
    <div className="dock-body" data-testid="catalog">
      <div className="search">
        <Icon name="search" />
        <input placeholder="ค้นหาเครื่องจักร / อุปกรณ์" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="dock-scroll">
        {groups.map(({ g, items }) => (
          <section key={g} className="cat-group">
            <h4>{GROUP_LABEL[g]}</h4>
            <div className="cat-grid">
              {items.map((c) => {
                const on = tool.kind === 'placeObject' && tool.assetId === c.id;
                return (
                  <button
                    key={c.id}
                    className={`cat-item${on ? ' on' : ''}${c.use === 'machine' ? ' machine' : ''}`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(ASSET_MIME, c.id);
                      e.dataTransfer.effectAllowed = 'copy';
                      setDraggedAsset(c.id);
                      // Only the small picture follows the cursor, so the object drawn on the plan stays in view.
                      const img = e.currentTarget.querySelector('img');
                      if (img) e.dataTransfer.setDragImage(img, 0, 0);
                    }}
                    onDragEnd={() => setDraggedAsset(null)}
                    onClick={() => useUi.getState().setTool(on ? { kind: 'select', drag: null } : { kind: 'placeObject', assetId: c.id })}
                    title={`${c.label}${c.summary ? `\n${c.summary}` : ''}\n${fmtSize(c)}`}
                    data-testid={`cat-${c.id}`}
                  >
                    <div className="cat-thumb">
                      <Thumb id={c.id} />
                    </div>
                    <div className="cat-name">{c.label}</div>
                    <div className="cat-size">{fmtSize(c)}</div>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <div className="dock-foot muted">คลิกแล้ววางบนแปลน หรือลากไปวาง • ด้านที่มีขีดหนาคือด้านหน้า (จุดที่คนยืนทำงาน)</div>
    </div>
  );
}
