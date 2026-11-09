import { expect, type Locator, type Page } from '@playwright/test';
import { waitForGitHubSignIn } from './signin';
import { checkInputs, type WorkflowInput } from './workflow';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Page object for GitHub Actions: start a workflow_dispatch workflow and follow its run.
 * All GitHub selectors live here.
 */
export class GitHubActions {
  constructor(
    readonly page: Page,
    readonly repo: string,
  ) {}

  private get repoUrl() {
    return `https://github.com/${this.repo}`;
  }

  /** Navigate; if you're not signed in to GitHub, wait for you to sign in, then retry. */
  async goto(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    if (await waitForGitHubSignIn(this.page, this.repo)) {
      await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    }
  }

  private async runIds(): Promise<Set<string>> {
    const hrefs = await this.page
      .locator('a[href*="/actions/runs/"]')
      .evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
    return new Set(hrefs.map((h) => h.match(/\/actions\/runs\/(\d+)/)?.[1]).filter((x): x is string => !!x));
  }

  /**
   * The "Run workflow" form field for an input. GitHub names fields `inputs[<id>]` and labels them
   * with the input's description, so try the name first, then the description from the YAML.
   */
  private async field(panel: Locator, input: string, def: WorkflowInput): Promise<Locator> {
    const byName = panel.locator(`[name="inputs[${input}]"]`);
    if (await byName.count()) return byName.first();
    if (def.description) {
      const byLabel = panel.getByLabel(def.description.trim(), { exact: true });
      if (await byLabel.count()) return byLabel.first();
      const byLabelLoose = panel.getByLabel(def.description.trim().slice(0, 40), { exact: false });
      if (await byLabelLoose.count()) return byLabelLoose.first();
    }
    throw new Error(`Workflow input "${input}" not found in the "Run workflow" form. Update lib/github.ts.`);
  }

  private async setField(panel: Locator, input: string, def: WorkflowInput, value: string) {
    const field = await this.field(panel, input, def);
    const kind = await field.evaluate((el) => `${el.tagName.toLowerCase()}:${(el as HTMLInputElement).type ?? ''}`);
    if (kind.startsWith('select')) {
      await field.selectOption(value);
    } else if (kind === 'input:checkbox') {
      await field.setChecked(value === 'true');
    } else if (kind.startsWith('button')) {
      // Newer GitHub UI renders choice inputs as a dropdown button with a menu.
      await field.click();
      await this.page
        .getByRole('menuitemradio', { name: value, exact: true })
        .or(this.page.getByRole('option', { name: value, exact: true }))
        .first()
        .click();
      await expect(field).toContainText(value);
    } else {
      await field.fill(value);
      await expect(field).toHaveValue(value);
    }
  }

  /** Opens the workflow, fills "Run workflow" with `inputs`, starts it and returns the run URL. */
  async startWorkflow(workflowFile: string, inputs: Record<string, string>, secretInputs: string[] = []): Promise<string> {
    // Checks names and choice values against the YAML before touching GitHub.
    const defs = checkInputs(workflowFile, inputs);

    await this.goto(`${this.repoUrl}/actions/workflows/${workflowFile}`);
    if (/not found/i.test(await this.page.title())) {
      throw new Error(`${this.repoUrl} not found - the signed-in GitHub account has no access to it, or GITHUB_REPO is wrong.`);
    }
    await expect(this.page.getByText(/workflow_dispatch/).first(), `${workflowFile} cannot be run by hand`).toBeVisible();

    const before = await this.runIds();

    const runButton = this.page.getByRole('button', { name: 'Run workflow', exact: true }).first();
    await expect(runButton, 'No "Run workflow" button: the signed-in account needs write access to the repo').toBeVisible();
    await runButton.click();
    const panel = this.page
      .locator('form[action*="/actions/manual"]')
      .or(this.page.getByRole('dialog').filter({ hasText: /Use workflow from/ }))
      .last();
    await expect(panel).toBeVisible();

    for (const [input, value] of Object.entries(inputs)) {
      await this.setField(panel, input, defs[input], value);
      console.log(`  ${input} = ${secretInputs.includes(input) ? `(hidden, ${value.length} characters)` : value}`);
    }

    await panel.getByRole('button', { name: 'Run workflow', exact: true }).click();

    // The new run appears in the list after a few seconds.
    let runId = '';
    await expect(async () => {
      await this.page.reload({ waitUntil: 'domcontentloaded' });
      runId = [...(await this.runIds())].find((id) => !before.has(id)) ?? '';
      expect(runId, 'new workflow run').not.toBe('');
    }).toPass({ timeout: 120_000, intervals: [5_000] });

    return `${this.repoUrl}/actions/runs/${runId}`;
  }

  /** Reloads the run page every 30 s until it finishes; returns Success / Failure / Cancelled ... */
  async waitForRun(runUrl: string, timeoutMs: number): Promise<string> {
    const states = ['Success', 'Failure', 'Cancelled', 'Skipped', 'Timed out', 'Startup failure', 'In progress', 'Queued', 'Waiting', 'Pending', 'Requested'];
    const finished = /^(Success|Failure|Cancelled|Skipped|Timed out|Startup failure)$/i;
    const statusRe = new RegExp(`Status\\s*\\n?\\s*(${states.map(escapeRe).join('|')})`, 'i');
    const deadline = Date.now() + timeoutMs;
    let last = '';
    await this.goto(runUrl);
    while (Date.now() < deadline) {
      const text = await this.page.locator('body').innerText().catch(() => '');
      const status = text.match(statusRe)?.[1] ?? '';
      if (status && status !== last) {
        console.log(`  ${new Date().toLocaleTimeString()}  run status: ${status}`);
        last = status;
      }
      if (finished.test(status)) return status;
      await this.page.waitForTimeout(30_000);
      await this.page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    }
    throw new Error(`Run did not finish within ${Math.round(timeoutMs / 60_000)} min (last status: ${last || 'unknown'}): ${runUrl}`);
  }
}
