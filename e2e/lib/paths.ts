import path from 'node:path';

/** Saved Google session (cookies). Gitignored - never commit it. */
export const AUTH_FILE = path.join(__dirname, '..', '.auth', 'gcp-user.json');

/** Saved GitHub session (cookies), used to start the cluster pipeline. Gitignored - never commit it. */
export const GITHUB_AUTH_FILE = path.join(__dirname, '..', '.auth', 'github-user.json');
