import { useEffect, useState } from 'react';
import { Icon } from '../editor2d/Toolbar';
import { deleteShare, sentShares, shareUrl, type SentShare } from '../store/share';
import { confirmDialog } from '../ui/Dialog';

const when = (t: number) => new Date(t).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });

/**
 * The links made in this browser, newest first: open one, copy it again, or delete it so it stops working for
 * whoever has it. Links made before deleting existed can only be taken off this list.
 */
export function SentLinks() {
  const [list, setList] = useState<SentShare[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => void sentShares().then(setList);
  useEffect(refresh, []);
  if (!list?.length) return null;

  const copy = async (id: string) => {
    try {
      await navigator.clipboard.writeText(shareUrl(id));
      setCopied(id);
    } catch {
      window.prompt('คัดลอกลิงก์', shareUrl(id));
    }
  };
  const remove = async (s: SentShare) => {
    const yes = await confirmDialog({
      title: `ลบลิงก์ “${s.name}”?`,
      message: s.deleteKey
        ? 'คนที่มีลิงก์นี้จะเปิดไม่ได้อีก การจัดวางที่ลูกค้าส่งกลับมาเป็นลิงก์อื่น ไม่หายไปด้วย'
        : 'ลิงก์นี้สร้างก่อนมีปุ่มลบ จึงลบได้แค่จากรายการนี้ ลิงก์ยังเปิดได้อยู่',
      ok: 'ลบลิงก์',
      danger: true,
    });
    if (!yes) return;
    setError(null);
    try {
      await deleteShare(s.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    refresh();
  };

  return (
    <section className="home-list sent-links" data-testid="sent-links">
      <div className="list-head">
        <h2>
          ลิงก์ที่ส่งไป <span className="count">{list.length}</span>
        </h2>
      </div>
      {error && (
        <div className="error-note" role="alert">
          <Icon name="info" /> {error}
        </div>
      )}
      <ul className="sent-list">
        {list.map((s) => (
          <li key={s.id} data-testid={`sent-${s.id}`}>
            <div className="sent-text">
              <b>
                {s.from === 'customer' ? 'ส่งกลับ · ' : ''}
                {s.name}
              </b>
              <span>
                {when(s.createdAt)}
                {s.sender ? ` · จาก ${s.sender}` : ''}
                {s.note ? ` · “${s.note}”` : ''}
              </span>
            </div>
            <a className="btn btn-sm" href={shareUrl(s.id)} title="เปิดลิงก์">
              เปิด
            </a>
            <button className="btn btn-sm" onClick={() => void copy(s.id)}>
              {copied === s.id ? 'คัดลอกแล้ว ✓' : 'คัดลอก'}
            </button>
            <button className="ib sm" onClick={() => void remove(s)} title="ลบลิงก์" aria-label="ลบลิงก์" data-testid="sent-delete">
              <Icon name="trash" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
