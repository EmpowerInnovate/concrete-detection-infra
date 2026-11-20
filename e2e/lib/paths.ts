import path from 'node:path';

/** Saved Google session (cookies). Gitignored - never commit it. */
export const AUTH_FILE = path.join(__dirname, '..', '.auth', 'gcp-user.json');

/** Saved GitHub session (cookies), used to start the cluster pipeline. Gitignored - never commit it. */
export const GITHUB_AUTH_FILE = path.join(__dirname, '..', '.auth', 'github-user.json');

/** Saved DigitalOcean session (cookies), used to create the API token and Spaces key. Gitignored - never commit it. */
export const DO_AUTH_FILE = path.join(__dirname, '..', '.auth', 'do-user.json');

/** Saved Azure Portal session (cookies + local storage). Gitignored - never commit it. */
export const AZ_AUTH_FILE = path.join(__dirname, '..', '.auth', 'azure-user.json');
