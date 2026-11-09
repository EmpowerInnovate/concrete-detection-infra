import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

export type WorkflowInput = {
  description?: string;
  type?: string;
  options?: string[];
  default?: string;
  required?: boolean;
};

/** Repo root: e2e/ lives directly under it. */
const REPO_ROOT = path.join(__dirname, '..', '..');

/** The workflow_dispatch inputs of .github/workflows/<file>, read from this checkout. */
export function workflowInputs(file: string): Record<string, WorkflowInput> {
  const full = path.join(REPO_ROOT, '.github', 'workflows', file);
  if (!fs.existsSync(full)) throw new Error(`Workflow file not found: ${full}`);
  const doc = parse(fs.readFileSync(full, 'utf8'));
  // YAML 1.1 turns the key `on` into `true` in some parsers; accept both.
  const on = doc?.on ?? doc?.[true as unknown as string];
  const inputs = on?.workflow_dispatch?.inputs;
  if (!inputs) throw new Error(`${file} has no workflow_dispatch inputs`);
  return inputs;
}

/**
 * Fail fast, before anything is started, if an input name or choice value no longer matches
 * the workflow file (e.g. the workflow was edited and an input renamed).
 */
export function checkInputs(file: string, values: Record<string, string>): Record<string, WorkflowInput> {
  const defs = workflowInputs(file);
  const problems: string[] = [];
  for (const [name, value] of Object.entries(values)) {
    const def = defs[name];
    if (!def) problems.push(`input "${name}" does not exist`);
    else if (def.type === 'choice' && def.options && !def.options.includes(value)) {
      problems.push(`"${value}" is not an option of "${name}" (${def.options.join(', ')})`);
    }
  }
  for (const [name, def] of Object.entries(defs)) {
    if (def.required && def.default === undefined && !(name in values)) problems.push(`required input "${name}" is not set`);
  }
  if (problems.length) throw new Error(`${file}: ${problems.join('; ')}`);
  return defs;
}
