import { create } from 'zustand';
import { DEFAULT_IMAGE_MODEL, GEMINI_INTERACTIONS_URL, googleError, interactionBody, readInteraction, type RenderError, type RenderInput } from './gemini';

/**
 * Signing in with the person's own Google account to make pictures with Gemini, billed to a Cloud project of theirs.
 * Google Identity Services' token model (https://developers.google.com/identity/oauth2/web/guides/use-token-model):
 * the browser gets a short-lived access token in a Google pop-up, with no client secret and nothing on our server.
 * The token lives in memory only (gone on reload); the chosen project is remembered in this browser.
 *
 * The Gemini call goes from the browser straight to Google with `Authorization: Bearer <token>` and the project in
 * `x-goog-user-project`, which is how Google lets a request name the project to bill
 * (https://docs.cloud.google.com/docs/quotas/set-quota-project). That project needs the Generative Language API on and
 * billing set up, and the person needs the Service Usage Consumer role on it (an owner has it).
 *
 * The site's OAuth client ID is public by design and comes from the build: VITE_GOOGLE_CLIENT_ID.
 */

export const GOOGLE_CLIENT_ID: string = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? '';
/** cloud-platform is the scope Google's Gemini OAuth guide asks for; email only shows who is signed in. */
export const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/cloud-platform email';
const GIS_SCRIPT = 'https://accounts.google.com/gsi/client';
const PROJECT_KEY = 'factory-sim:gemini-project';

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
  error_description?: string;
}
interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}
interface GoogleOAuth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (r: TokenResponse) => void;
    error_callback?: (e: { type?: string; message?: string }) => void;
  }): TokenClient;
  revoke(token: string, done?: () => void): void;
}
declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2 } };
  }
}

export interface CloudProject {
  id: string;
  name: string;
}

interface GoogleState {
  /** idle: not prepared yet; loading: script on its way; ready: can sign in; failed: script did not load. */
  phase: 'idle' | 'loading' | 'ready' | 'failed';
  token: string | null;
  expiresAt: number;
  email: string | null;
  projects: CloudProject[] | null;
  projectsError: string | null;
  project: string;
  error: string | null;
}

const readProject = () => {
  try {
    return localStorage.getItem(PROJECT_KEY) ?? '';
  } catch {
    return '';
  }
};

export const useGoogle = create<GoogleState>(() => ({
  phase: 'idle',
  token: null,
  expiresAt: 0,
  email: null,
  projects: null,
  projectsError: null,
  project: readProject(),
  error: null,
}));

let tokenClient: TokenClient | null = null;

/** Signed in, with at least a minute left on the token. */
export const signedIn = (s: GoogleState = useGoogle.getState()) => Boolean(s.token && s.expiresAt - Date.now() > 60_000);

export function chooseProject(id: string): void {
  const project = id.trim();
  useGoogle.setState({ project });
  try {
    if (project) localStorage.setItem(PROJECT_KEY, project);
    else localStorage.removeItem(PROJECT_KEY);
  } catch {
    /* private window: chosen for this visit only */
  }
}

/** Loads Google's sign-in script and makes the token client, so the sign-in button can open the pop-up in its click. */
export function prepareGoogle(): void {
  const s = useGoogle.getState();
  if (!GOOGLE_CLIENT_ID || s.phase === 'loading' || s.phase === 'ready') return;
  useGoogle.setState({ phase: 'loading', error: null });
  const init = () => {
    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2) return useGoogle.setState({ phase: 'failed', error: 'โหลดระบบเข้าสู่ระบบของ Google ไม่สำเร็จ' });
    tokenClient = oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GOOGLE_SCOPES,
      callback: (r) => void tokenArrived(r),
      error_callback: (e) => useGoogle.setState({ error: e.type === 'popup_closed' ? null : `เข้าสู่ระบบไม่สำเร็จ (${e.type ?? e.message ?? 'unknown'})` }),
    });
    useGoogle.setState({ phase: 'ready' });
  };
  if (window.google?.accounts?.oauth2) return init();
  const script = document.createElement('script');
  script.src = GIS_SCRIPT;
  script.async = true;
  script.onload = init;
  script.onerror = () => useGoogle.setState({ phase: 'failed', error: 'โหลดระบบเข้าสู่ระบบของ Google ไม่สำเร็จ (เครือข่ายหรือตัวบล็อกโฆษณา)' });
  document.head.appendChild(script);
}

/** Opens Google's pop-up. Call it straight from a click: browsers block pop-ups opened later. */
export function signInWithGoogle(): void {
  if (!tokenClient) return;
  useGoogle.setState({ error: null });
  tokenClient.requestAccessToken({ prompt: useGoogle.getState().email ? '' : 'consent' });
}

export function signOutOfGoogle(): void {
  const { token } = useGoogle.getState();
  if (token) window.google?.accounts?.oauth2?.revoke(token);
  useGoogle.setState({ token: null, expiresAt: 0, email: null, projects: null, projectsError: null, error: null });
}

async function tokenArrived(r: TokenResponse): Promise<void> {
  if (!r.access_token) return useGoogle.setState({ error: `เข้าสู่ระบบไม่สำเร็จ (${r.error_description ?? r.error ?? 'ไม่ได้ token'})` });
  const token = r.access_token;
  useGoogle.setState({ token, expiresAt: Date.now() + Number(r.expires_in ?? 3600) * 1000, error: null });
  const auth = { authorization: `Bearer ${token}` };
  const [me, projects] = await Promise.allSettled([
    fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: auth }).then((x) => (x.ok ? (x.json() as Promise<{ email?: string }>) : ({} as { email?: string }))),
    listProjects(token),
  ]);
  if (useGoogle.getState().token !== token) return;
  const email = me.status === 'fulfilled' ? (me.value.email ?? null) : null;
  if (projects.status === 'fulfilled') {
    const list = projects.value;
    useGoogle.setState({ email, projects: list, projectsError: null });
    // One project, or none chosen yet that is in the list: take the first, which the person can still change.
    const chosen = useGoogle.getState().project;
    if (list.length && !list.some((p) => p.id === chosen)) chooseProject(list[0].id);
  } else useGoogle.setState({ email, projects: null, projectsError: (projects.reason as Error).message });
}

/** The person's active Cloud projects (Cloud Resource Manager v1), by name. */
export async function listProjects(token: string, fetchFn: typeof fetch = fetch): Promise<CloudProject[]> {
  const out: CloudProject[] = [];
  let pageToken = '';
  for (let page = 0; page < 5; page++) {
    const url = `https://cloudresourcemanager.googleapis.com/v1/projects?filter=${encodeURIComponent('lifecycleState:ACTIVE')}&pageSize=200${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const res = await fetchFn(url, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(googleError(res.status, await res.text()).error);
    const body = (await res.json()) as { projects?: { projectId: string; name?: string }[]; nextPageToken?: string };
    for (const p of body.projects ?? []) out.push({ id: p.projectId, name: p.name || p.projectId });
    if (!body.nextPageToken) break;
    pageToken = encodeURIComponent(body.nextPageToken);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** One picture from Gemini as the signed-in person, billed to `project`. */
export async function renderAsUser(
  auth: { token: string; project: string; model?: string },
  input: RenderInput,
  fetchFn: typeof fetch = fetch,
): Promise<{ blob: Blob; model: string } | RenderError> {
  const model = auth.model || DEFAULT_IMAGE_MODEL;
  let res: Response;
  try {
    res = await fetchFn(GEMINI_INTERACTIONS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${auth.token}`, 'x-goog-user-project': auth.project },
      body: JSON.stringify(interactionBody(model, input)),
    });
  } catch (e) {
    return { error: `ติดต่อ Gemini ไม่ได้: ${(e as Error).message}` };
  }
  if (!res.ok) return googleError(res.status, await res.text(), auth.project);
  let result: unknown;
  try {
    result = await res.json();
  } catch {
    return { error: 'Gemini ตอบกลับมาไม่ใช่ JSON' };
  }
  const got = readInteraction(result);
  if ('error' in got) return got;
  return { blob: new Blob([got.bytes], { type: got.mime }), model };
}
