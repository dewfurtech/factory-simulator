/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The site's Google OAuth client ID (public), for signing in with Google to make AI pictures. Unset: that way is off. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}
