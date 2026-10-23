import { useEffect, useMemo, useState } from 'react';
import { CATALOG, GROUP_LABEL, GROUP_ORDER, type CatalogGroup, type CatalogItem } from '../model/catalog';
import { allTags, matchesTag, type CustomModel } from '../model/library';
import { useLibrary } from '../store/library';
import { ModelForm } from './ModelForm';
import { useUi } from '../store/ui';
import { ASSET_MIME, setDraggedAsset } from '../editor2d/PlanEditor';
import { placeObjectAt } from '../editor2d/tools';
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

/** A transparent drag image: the 3D view shows the dragged machine's shape in its place. */
const BLANK =
  typeof Image !== 'undefined'
    ? Object.assign(new Image(), { src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' })
    : (undefined as unknown as HTMLImageElement);

const fmtSize = (c: CatalogItem) => `${(c.size.w / 1000).toFixed(1)}×${(c.size.d / 1000).toFixed(1)} ม.`;

/** The two shelves of the library: the Mastrox lineup comes first, as it is what the app sells. */
type Shelf = 'mastrox' | 'general' | 'mine';
const shelfOf = (c: CatalogItem): Shelf => (c.group === 'custom' ? 'mine' : c.use === 'machine' ? 'mastrox' : 'general');
const SHELF_GROUPS: Record<Shelf, CatalogGroup[]> = {
  mastrox: GROUP_ORDER.filter((g) => CATALOG.some((c) => c.group === g && shelfOf(c) === 'mastrox')),
  general: GROUP_ORDER.filter((g) => CATALOG.some((c) => c.group === g && shelfOf(c) === 'general')),
  mine: [],
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
  custom: 'คลังของฉัน',
};
const MASTROX_COUNT = CATALOG.filter((c) => shelfOf(c) === 'mastrox').length;

const SHELF_KEY = 'catalog.shelf';
const readShelf = (): Shelf => {
  try {
    const s = localStorage.getItem(SHELF_KEY);
    return s === 'general' || s === 'mine' ? s : 'mastrox';
  } catch {
    return 'mastrox';
  }
};

/** The library of Mastrox machines and built-in factory pieces: click to place, or drag onto the plan. */
export function CatalogPanel() {
  const [q, setQ] = useState('');
  const [shelf, setShelfState] = useState<Shelf>(readShelf);
  const [group, setGroup] = useState<CatalogGroup | 'all'>('all');
  const [tag, setTag] = useState<string | null>(null);
  const [form, setForm] = useState<{ model?: CustomModel } | null>(null);
  const models = useLibrary((s) => s.models);
  const tags = useMemo(() => allTags(models), [models]);
  const tool = useUi((s) => s.tool);
  const in3d = useUi((s) => s.view === '3d');
  /** On the plan a click arms the place tool; in 3D there is no plan to click, so the machine lands mid-view, ready to drag. */
  const pick = (assetId: string, on: boolean) => {
    const ui = useUi.getState();
    if (in3d) {
      const at = ui.floorCentre?.();
      if (!at) return;
      const id = placeObjectAt(assetId, at, 300, true);
      ui.set({ selection: { kind: 'object', id }, move3d: true });
      return;
    }
    ui.setTool(on ? { kind: 'select', drag: null } : { kind: 'placeObject', assetId });
  };
  const setShelf = (s: Shelf) => {
    setShelfState(s);
    setGroup('all');
    setTag(null);
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
    const mine: CatalogItem[] = models.map((m) => ({ id: m.id, label: m.name, group: 'custom', size: m.size, summary: m.note, custom: m }));
    const shown = [...CATALOG, ...mine].filter((c) =>
      needle
        ? c.label.toLowerCase().includes(needle) ||
          c.id.includes(needle) ||
          (c.summary ?? '').toLowerCase().includes(needle) ||
          (c.custom?.tags ?? []).some((t) => t.toLowerCase().includes(needle))
        : shelfOf(c) === shelf && (group === 'all' || c.group === group) && (!c.custom || matchesTag(c.custom, tag)),
    );
    return GROUP_ORDER.map((g) => ({ g, items: shown.filter((c) => c.group === g) })).filter((x) => x.items.length);
  }, [q, shelf, group, tag, models]);
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
          อุปกรณ์
        </button>
        <button role="tab" aria-selected={shelf === 'mine'} className={`shelf-tab${shelf === 'mine' ? ' on' : ''}`} onClick={() => setShelf('mine')} data-testid="shelf-mine">
          ของฉัน{models.length > 0 && <span className="shelf-count">{models.length}</span>}
        </button>
      </div>
      <div className="cat-search">
        <div className="search">
          <Icon name="search" />
          <input
            placeholder={shelf === 'mastrox' ? 'ค้นหาเครื่องจักร Mastrox' : shelf === 'mine' ? 'ค้นหาชื่อหรือ tag' : 'ค้นหาอุปกรณ์'}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {shelf === 'mine' && (
          <button className="btn btn-primary btn-sm" onClick={() => setForm({})} title="เพิ่มโมเดลของคุณเอง" data-testid="add-model">
            <Icon name="plus" /> เพิ่ม
          </button>
        )}
      </div>
      {!searching && shelf === 'mine' && tags.length > 0 && (
        <div className="cat-chips">
          {tags.length > 0 && (
            <button className={`chip${tag === null ? ' on' : ''}`} onClick={() => setTag(null)}>
              ทั้งหมด
            </button>
          )}
          {tags.map((t) => (
            <button key={t} className={`chip${tag === t ? ' on' : ''}`} onClick={() => setTag(tag === t ? null : t)} data-testid={`tag-${t}`}>
              {t}
            </button>
          ))}
        </div>
      )}
      {!searching && shelf !== 'mine' && (
        <div className="cat-chips">
          {(['all', ...SHELF_GROUPS[shelf]] as const).map((g) => (
            <button key={g} className={`chip${group === g ? ' on' : ''}${shelf === 'mastrox' ? ' mx' : ''}`} onClick={() => setGroup(g)} data-testid={`chip-${g}`}>
              {g === 'all' ? 'ทั้งหมด' : CHIP[g]}
            </button>
          ))}
        </div>
      )}
      <div className="dock-scroll">
        {!groups.length && shelf === 'mine' && !searching && (
          <div className="cat-none muted">ยังไม่มีโมเดลของคุณ กดปุ่ม “+ เพิ่ม” แล้วตั้งชื่อ ขนาด สี และ tag หรืออัปโหลดไฟล์ 3D (GLB, glTF, OBJ, STL)</div>
        )}
        {!groups.length && (searching || shelf !== 'mine') && <div className="cat-none muted">ไม่พบ “{q.trim()}”</div>}
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
                      // On the plan the small picture follows the cursor; with 3D open the views draw the shape itself, so nothing does.
                      const img = e.currentTarget.querySelector('img');
                      if (useUi.getState().view !== '2d') e.dataTransfer.setDragImage(BLANK, 0, 0);
                      else if (img) e.dataTransfer.setDragImage(img, 0, 0);
                    }}
                    onDragEnd={() => setDraggedAsset(null)}
                    onClick={() => pick(c.id, on)}
                    title={`${c.label}${c.summary ? `\n${c.summary}` : ''}\n${fmtSize(c)}`}
                    data-testid={`cat-${c.id}`}
                  >
                    <div className="cat-thumb">
                      <Thumb id={c.id} key={c.custom ? `${c.id}:${c.custom.color}:${c.custom.shape}:${c.size.w}x${c.size.d}x${c.size.h}` : c.id} />
                    </div>
                    <div className="cat-name">{c.label}</div>
                    <div className="cat-size">{fmtSize(c)}</div>
                    {c.custom && c.custom.tags.length > 0 && (
                      <div className="cat-tags">
                        {c.custom.tags.map((t) => (
                          <span key={t}>{t}</span>
                        ))}
                      </div>
                    )}
                    {c.custom && (
                      <span
                        role="button"
                        className="cat-edit"
                        title="แก้ไขหรือลบ"
                        onClick={(e) => {
                          e.stopPropagation();
                          setForm({ model: c.custom });
                        }}
                        data-testid={`edit-${c.id}`}
                      >
                        <Icon name="edit" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <div className="dock-foot muted">คลิกแล้ววางบนแปลน หรือลากไปวาง • ด้านที่มีขีดหนาคือด้านหน้า (จุดที่คนยืนทำงาน)</div>
      {form && <ModelForm model={form.model} onClose={() => setForm(null)} />}
    </div>
  );
}
