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

  /** Workflow page each started run belongs to; its run list shows the run's status. */
  private workflowPageOf = new Map<string, string>();

  /** Opens the workflow, fills "Run workflow" with `inputs`, starts it and returns the run URL. */
  async startWorkflow(workflowFile: string, inputs: Record<string, string>, secretInputs: string[] = []): Promise<string> {
    // Checks names and choice values against the YAML (which also proves it has workflow_dispatch)
    // before touching GitHub.
    const defs = checkInputs(workflowFile, inputs);
    const workflowUrl = `${this.repoUrl}/actions/workflows/${workflowFile}`;

    await this.goto(workflowUrl);
    if (/not found/i.test(await this.page.title())) {
      throw new Error(`${this.repoUrl} not found - the signed-in GitHub account has no access to it, or GITHUB_REPO is wrong.`);
    }

    const runButton = this.page.getByRole('button', { name: 'Run workflow', exact: true }).first();
    await expect(runButton, 'No "Run workflow" button: the signed-in account needs write access to the repo').toBeVisible({
      timeout: 60_000,
    });
    // Let the run list load so existing runs aren't mistaken for the new one.
    await this.page.locator('a[href*="/actions/runs/"]').first().waitFor({ timeout: 15_000 }).catch(() => {});
    const before = await this.runIds();

    await runButton.click();
    const runButtonInPanel = this.page.getByRole('button', { name: 'Run workflow', exact: true });
    const panel = this.page
      .locator('form[action*="/actions/manual"]')
      .or(this.page.getByRole('dialog').filter({ hasText: /Use workflow from|Branch:/i }))
      .or(this.page.getByRole('dialog').filter({ has: runButtonInPanel }))
      .last();
    await expect(panel, 'The "Run workflow" form did not open').toBeVisible({ timeout: 30_000 });

    for (const [input, value] of Object.entries(inputs)) {
      await this.setField(panel, input, defs[input], value);
      console.log(`  ${input} = ${secretInputs.includes(input) ? `(hidden, ${value.length} characters)` : value}`);
    }

    await panel.getByRole('button', { name: 'Run workflow', exact: true }).last().click();

    // The new run appears in the list after a few seconds.
    let runId = '';
    await expect(async () => {
      await this.page.goto(workflowUrl, { waitUntil: 'domcontentloaded' });
      await this.page.locator('a[href*="/actions/runs/"]').first().waitFor({ timeout: 10_000 }).catch(() => {});
      runId = [...(await this.runIds())].find((id) => !before.has(id)) ?? '';
      expect(runId, 'new workflow run').not.toBe('');
    }).toPass({ timeout: 180_000, intervals: [5_000] });

    const runUrl = `${this.repoUrl}/actions/runs/${runId}`;
    this.workflowPageOf.set(runUrl, workflowUrl);
    return runUrl;
  }

  /**
   * Status of a run from the workflow's run list. Each run is a list item labelled e.g.
   * "completed successfully: Run 40 of ...", "failed: Run 41 of ...", "in progress: ...".
   */
  private async statusFromRunList(runId: string): Promise<string> {
    const item = this.page.getByRole('listitem').filter({ has: this.page.locator(`a[href*="/actions/runs/${runId}"]`) }).first();
    if (!(await item.isVisible({ timeout: 10_000 }).catch(() => false))) return '';
    const label = ((await item.getAttribute('aria-label')) || (await item.innerText().catch(() => ''))).toLowerCase();
    if (/completed successfully|^success/.test(label)) return 'Success';
    if (/startup failure/.test(label)) return 'Startup failure';
    if (/timed out/.test(label)) return 'Timed out';
    if (/cancel/.test(label)) return 'Cancelled';
    if (/skipped/.test(label)) return 'Skipped';
    if (/fail/.test(label)) return 'Failure';
    if (/in progress|running/.test(label)) return 'In progress';
    if (/queued/.test(label)) return 'Queued';
    if (/waiting|pending|requested/.test(label)) return 'Waiting';
    return '';
  }

  /** Status from the run page text ("Status  Success"); fallback for older GitHub layouts. */
  private async statusFromRunPage(runUrl: string): Promise<string> {
    const states = ['Success', 'Failure', 'Cancelled', 'Skipped', 'Timed out', 'Startup failure', 'In progress', 'Queued', 'Waiting', 'Pending', 'Requested'];
    const statusRe = new RegExp(`Status\\s*\\n?\\s*(${states.map(escapeRe).join('|')})`, 'i');
    await this.page.goto(runUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    const text = await this.page.locator('body').innerText().catch(() => '');
    return text.match(statusRe)?.[1] ?? '';
  }

  /** Checks every 30 s until the run finishes; returns Success / Failure / Cancelled ... */
  async waitForRun(runUrl: string, timeoutMs: number): Promise<string> {
    const finished = /^(Success|Failure|Cancelled|Skipped|Timed out|Startup failure)$/i;
    const runId = runUrl.match(/\/runs\/(\d+)/)?.[1] ?? '';
    const workflowUrl = this.workflowPageOf.get(runUrl);
    const deadline = Date.now() + timeoutMs;
    let last = '';
    console.log(`  Following ${runUrl} (checks every 30 s)`);
    while (Date.now() < deadline) {
      let status = '';
      if (workflowUrl) {
        await this.goto(workflowUrl);
        status = await this.statusFromRunList(runId);
      }
      if (!status) status = await this.statusFromRunPage(runUrl);
      if (status && status !== last) {
        console.log(`  ${new Date().toLocaleTimeString()}  run status: ${status}`);
        last = status;
      }
      if (finished.test(status)) {
        await this.page.goto(runUrl, { waitUntil: 'domcontentloaded' }).catch(() => {}); // leave the run open for the report
        return status;
      }
      await this.page.waitForTimeout(30_000);
    }
    throw new Error(`Run did not finish within ${Math.round(timeoutMs / 60_000)} min (last status: ${last || 'unknown'}): ${runUrl}`);
  }
}
