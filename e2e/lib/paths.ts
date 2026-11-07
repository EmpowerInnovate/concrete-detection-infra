import path from 'node:path';

/** Saved Google session (cookies). Gitignored - never commit it. */
export const AUTH_FILE = path.join(__dirname, '..', '.auth', 'gcp-user.json');
