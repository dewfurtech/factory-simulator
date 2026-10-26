import { describe, expect, it } from 'vitest';
import { DEFAULT_IMAGE_MODEL, GEMINI_INTERACTIONS_URL } from './gemini';
import { listProjects, renderAsUser } from './googleAccount';

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** A stand-in for Google: answers each call in turn, and keeps what it was asked. */
function fakeGoogle(...answers: (() => Response)[]) {
  const calls: { url: string; headers: Headers; body?: Record<string, unknown> }[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers), body: init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : undefined });
    return answers[Math.min(calls.length - 1, answers.length - 1)]();
  }) as typeof fetch;
  return { fetchFn, calls };
}

const errorBody = (code: number, message: string, status: string, reason?: string) =>
  new Response(JSON.stringify({ error: { code, message, status, details: reason ? [{ reason }] : [] } }), { status: code });

describe('making a picture as the signed-in person', () => {
  it('sends the token and bills the chosen project, and gives the picture back', async () => {
    const google = fakeGoogle(
      () => new Response(JSON.stringify({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'image', mime_type: 'image/png', data: PNG_B64 }] }] })),
    );
    const got = await renderAsUser({ token: 'ya29.token', project: 'my-factory' }, { prompt: 'a hall', image: { mimeType: 'image/png', data: PNG_B64 } }, google.fetchFn);
    if ('error' in got) throw new Error(got.error);
    expect(got.model).toBe(DEFAULT_IMAGE_MODEL);
    expect(got.blob.type).toBe('image/png');
    expect(got.blob.size).toBeGreaterThan(60);

    const [call] = google.calls;
    expect(call.url).toBe(GEMINI_INTERACTIONS_URL);
    expect(call.headers.get('authorization')).toBe('Bearer ya29.token');
    expect(call.headers.get('x-goog-user-project')).toBe('my-factory');
    expect(call.headers.get('x-goog-api-key')).toBeNull();
    expect(call.body?.store).toBe(false);
  });

  it('says what to switch on in the project, with a link to it', async () => {
    const disabled = fakeGoogle(() =>
      errorBody(403, 'Generative Language API has not been used in project 123 before or it is disabled.', 'PERMISSION_DENIED', 'SERVICE_DISABLED'),
    );
    const a = await renderAsUser({ token: 't', project: 'my-factory' }, { prompt: 'x' }, disabled.fetchFn);
    expect(a).toMatchObject({ error: expect.stringContaining('Generative Language API'), link: { href: expect.stringContaining('project=my-factory') } });

    const billing = fakeGoogle(() => errorBody(403, 'This API method requires billing to be enabled.', 'PERMISSION_DENIED', 'BILLING_DISABLED'));
    const b = await renderAsUser({ token: 't', project: 'my-factory' }, { prompt: 'x' }, billing.fetchFn);
    expect(b).toMatchObject({ error: expect.stringContaining('billing'), link: { href: expect.stringContaining('billing') } });

    const denied = fakeGoogle(() =>
      errorBody(
        403,
        'Caller does not have required permission to use project x. Grant the caller the roles/serviceusage.serviceUsageConsumer role, or a custom role with the serviceusage.services.use permission',
        'PERMISSION_DENIED',
        'USER_PROJECT_DENIED',
      ),
    );
    const c = await renderAsUser({ token: 't', project: 'x' }, { prompt: 'x' }, denied.fetchFn);
    expect('error' in c && c.error).toContain('Service Usage Consumer');

    const expired = fakeGoogle(() => errorBody(401, 'Request had invalid authentication credentials.', 'UNAUTHENTICATED'));
    const d = await renderAsUser({ token: 't', project: 'x' }, { prompt: 'x' }, expired.fetchFn);
    expect('error' in d && d.error).toContain('เข้าสู่ระบบใหม่');
  });
});

describe('listing Cloud projects', () => {
  it('reads every page, by name', async () => {
    const google = fakeGoogle(
      () => new Response(JSON.stringify({ projects: [{ projectId: 'zeta-1', name: 'Zeta' }], nextPageToken: 'p2' })),
      () => new Response(JSON.stringify({ projects: [{ projectId: 'alpha-2', name: 'Alpha' }] })),
    );
    expect(await listProjects('tok', google.fetchFn)).toEqual([
      { id: 'alpha-2', name: 'Alpha' },
      { id: 'zeta-1', name: 'Zeta' },
    ]);
    expect(google.calls).toHaveLength(2);
    expect(google.calls[1].url).toContain('pageToken=p2');
    expect(google.calls[0].headers.get('authorization')).toBe('Bearer tok');
  });
});
