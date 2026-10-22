import { useEffect, useMemo, useState } from 'react';
import { CATALOG, GROUP_LABEL, GROUP_ORDER, type CatalogGroup, type CatalogItem } from '../model/catalog';
import { useUi } from '../store/ui';
import { ASSET_MIME, setDraggedAsset } from '../editor2d/PlanEditor';
import { Icon } from '../editor2d/Toolbar';

function Thumb({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    // The renderer, three.js and the machine models load with the first thumbnail, not with the app.
    void import('../view3d/thumbs').then(({ thumbnail }) => live && thumbnail(id, (u) => live && setUrl(u)));
    return () => {
      live = false;
    };
  }, [id]);
  return url ? <img src={url} alt="" draggable={false} /> : <span className="thumb-wait" />;
}

const fmtSize = (c: CatalogItem) => `${(c.size.w / 1000).toFixed(1)}×${(c.size.d / 1000).toFixed(1)} ม.`;

/** The two shelves of the library: the Mastrox lineup comes first, as it is what the app sells. */
type Shelf = 'mastrox' | 'general';
const shelfOf = (c: CatalogItem): Shelf => (c.use === 'machine' ? 'mastrox' : 'general');
const SHELF_GROUPS: Record<Shelf, CatalogGroup[]> = {
  mastrox: GROUP_ORDER.filter((g) => CATALOG.some((c) => c.group === g && shelfOf(c) === 'mastrox')),
  general: GROUP_ORDER.filter((g) => CATALOG.some((c) => c.group === g && shelfOf(c) === 'general')),
};
/** Short chip names; the full group label stays as the section heading. */
const CHIP: Record<CatalogGroup, string> = {
  nesting: 'CNC Nesting',
  edge: 'ปิดขอบ',
  drill: 'CNC เจาะ',
  other: 'เครื่องเสริม',
  office: 'สำนักงาน',
  production: 'ผลิต',
  storage: 'จัดเก็บ',
  amenity: 'พนักงาน',
  decor: 'อื่น ๆ',
};
const MASTROX_COUNT = CATALOG.filter((c) => shelfOf(c) === 'mastrox').length;

const SHELF_KEY = 'catalog.shelf';
const readShelf = (): Shelf => {
  try {
    return localStorage.getItem(SHELF_KEY) === 'general' ? 'general' : 'mastrox';
  } catch {
    return 'mastrox';
  }
};

/** The library of Mastrox machines and built-in factory pieces: click to place, or drag onto the plan. */
export function CatalogPanel() {
  const [q, setQ] = useState('');
  const [shelf, setShelfState] = useState<Shelf>(readShelf);
  const [group, setGroup] = useState<CatalogGroup | 'all'>('all');
  const tool = useUi((s) => s.tool);
  const setShelf = (s: Shelf) => {
    setShelfState(s);
    setGroup('all');
    try {
      localStorage.setItem(SHELF_KEY, s);
    } catch {
      /* private window: the choice just isn't remembered */
    }
  };
  const searching = q.trim() !== '';
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    // A search looks through both shelves (Mastrox first), so nothing hides behind the other tab.
    const shown = CATALOG.filter((c) =>
      needle
        ? c.label.toLowerCase().includes(needle) || c.id.includes(needle) || (c.summary ?? '').toLowerCase().includes(needle)
        : shelfOf(c) === shelf && (group === 'all' || c.group === group),
    );
    return GROUP_ORDER.map((g) => ({ g, items: shown.filter((c) => c.group === g) })).filter((x) => x.items.length);
  }, [q, shelf, group]);
  return (
    <div className="dock-body" data-testid="catalog">
      <div className="shelf-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={shelf === 'mastrox'}
          className={`shelf-tab mastrox${shelf === 'mastrox' ? ' on' : ''}`}
          onClick={() => setShelf('mastrox')}
          data-testid="shelf-mastrox"
        >
          <span className="mx-word">
            mas<b>trox</b>
          </span>
          <span className="shelf-count">{MASTROX_COUNT}</span>
        </button>
        <button
          role="tab"
          aria-selected={shelf === 'general'}
          className={`shelf-tab${shelf === 'general' ? ' on' : ''}`}
          onClick={() => setShelf('general')}
          data-testid="shelf-general"
        >
          อุปกรณ์โรงงาน
        </button>
      </div>
      <div className="search">
        <Icon name="search" />
        <input placeholder={shelf === 'mastrox' ? 'ค้นหาเครื่องจักร Mastrox' : 'ค้นหาอุปกรณ์'} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!searching && (
        <div className="cat-chips">
          {(['all', ...SHELF_GROUPS[shelf]] as const).map((g) => (
            <button key={g} className={`chip${group === g ? ' on' : ''}${shelf === 'mastrox' ? ' mx' : ''}`} onClick={() => setGroup(g)} data-testid={`chip-${g}`}>
              {g === 'all' ? 'ทั้งหมด' : CHIP[g]}
            </button>
          ))}
        </div>
      )}
      <div className="dock-scroll">
        {!groups.length && <div className="cat-none muted">ไม่พบ “{q.trim()}”</div>}
        {groups.map(({ g, items }) => (
          <section key={g} className="cat-group">
            <h4 className={SHELF_GROUPS.mastrox.includes(g) ? 'mx' : undefined}>{GROUP_LABEL[g]}</h4>
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
