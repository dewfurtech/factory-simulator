import { Component, type ErrorInfo, type ReactNode } from 'react';
import { exportProject, flushAutosave } from './store/persist';
import { useProject } from './store/project';

interface State {
  error: Error | null;
}

/**
 * Catches a crash while rendering so the app shows what happened instead of a blank page, with ways out: back to the
 * project list, a reload, or the open project saved to a file first. The autosave has the last edits already (it runs
 * within half a second of a change), so the file is a belt to its braces.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Factory Simulator crashed', error, info.componentStack);
  }

  private home = () => {
    flushAutosave();
    location.hash = '#/';
    this.setState({ error: null });
  };

  private save = async () => {
    flushAutosave();
    const p = useProject.getState().project;
    if (!p) return;
    const url = URL.createObjectURL(await exportProject(p.id));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${p.name}.factory.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const open = useProject.getState().project;
    return (
      <div className="crash" role="alert" data-testid="crash">
        <div className="crash-card glass">
          <h1>เกิดข้อผิดพลาดในโปรแกรม</h1>
          <p>หน้านี้แสดงต่อไม่ได้ งานล่าสุดถูกบันทึกอัตโนมัติไว้แล้ว กลับไปหน้ารายการหรือโหลดหน้าใหม่ได้เลย</p>
          <pre>{error.message}</pre>
          <div className="crash-actions">
            <button className="btn btn-primary" onClick={this.home}>
              กลับไปหน้ารายการ
            </button>
            <button className="btn" onClick={() => location.reload()}>
              โหลดหน้าใหม่
            </button>
            {open && (
              <button className="btn" onClick={() => void this.save()}>
                บันทึก “{open.name}” เป็นไฟล์
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
}
