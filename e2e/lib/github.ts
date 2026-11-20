import { expect, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { announce, waitForGitHubSignIn } from './signin';
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

  private async runIds(page: Page = this.page): Promise<Set<string>> {
    const hrefs = await page
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
      // GitHub collapses runs of spaces in the label and adds " *" to required inputs, e.g.
      // "Cloud provider to use *". Match the description from the start, whitespace-tolerant.
      const words = def.description.trim().split(/\s+/).map(escapeRe).join('\\s+');
      const label = new RegExp(`^\\s*${words}\\s*\\*?\\s*$`);
      const byRole = panel.getByRole('combobox', { name: label }).or(panel.getByRole('textbox', { name: label }));
      if (await byRole.count()) return byRole.first();
      const byLabel = panel.getByLabel(label);
      if (await byLabel.count()) return byLabel.first();
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
  /**
   * Opens the workflow's "Run workflow" form and starts a run; returns the run URL.
   *
   * manual (default): pre-fills what it can, puts the secret input (the key) on the clipboard,
   *   then WAITS for you to check/enter the inputs and click "Run workflow" yourself. The page you
   *   type in is never reloaded; a background tab watches for the new run.
   * auto: fills every input and clicks "Run workflow" itself.
   */
  async startWorkflow(
    workflowFile: string,
    inputs: Record<string, string>,
    secretInputs: string[] = [],
    opts: { manual?: boolean; manualWaitMs?: number; notes?: string[] } = {},
  ): Promise<string> {
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
    // The form is a dialog named "Run workflow" (older GitHub: a dropdown with a form).
    const dialog = this.page.getByRole('dialog', { name: /run workflow/i });
    const panel = (await dialog.first().isVisible({ timeout: 15_000 }).catch(() => false))
      ? dialog.first()
      : this.page.locator('form[action*="/actions/manual"]').filter({ visible: true }).first();
    const formOpen = await expect(panel).toBeVisible({ timeout: 30_000 }).then(() => true, () => false);
    if (!formOpen && !opts.manual) throw new Error('The "Run workflow" form did not open.');

    const shown = (input: string, value: string) =>
      secretInputs.includes(input) ? `(key, ${value.length} characters)` : value;

    if (opts.manual) {
      return this.waitForManualRun(workflowUrl, panel, defs, inputs, secretInputs, before, shown, opts);
    }

    for (const [input, value] of Object.entries(inputs)) {
      await this.setField(panel, input, defs[input], value);
      console.log(`  ${input} = ${shown(input, value)}`);
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

  /** Copy text to the clipboard (xclip / xsel / wl-copy). Returns false if none is installed. */
  private copyToClipboard(text: string): boolean {
    const tools: [string, string[]][] = [
      ['xclip', ['-selection', 'clipboard']],
      ['xsel', ['--clipboard', '--input']],
      ['wl-copy', []],
    ];
    for (const [cmd, args] of tools) {
      try {
        execFileSync(cmd, args, { input: text, stdio: ['pipe', 'ignore', 'ignore'], timeout: 5_000 });
        return true;
      } catch {
        // not installed / no display - try the next one
      }
    }
    return false;
  }

  /**
   * Manual mode: pre-fill (best effort), tell you what to enter, then wait until YOU click
   * "Run workflow". A background tab polls the run list so the form you type in is never reloaded.
   */
  private async waitForManualRun(
    workflowUrl: string,
    panel: Locator,
    defs: Record<string, WorkflowInput>,
    inputs: Record<string, string>,
    secretInputs: string[],
    before: Set<string>,
    shown: (input: string, value: string) => string,
    opts: { manualWaitMs?: number; notes?: string[] },
  ): Promise<string> {
    const filled: string[] = [];
    const formOpen = await panel.isVisible().catch(() => false);
    for (const [input, value] of Object.entries(formOpen ? inputs : {})) {
      try {
        await this.setField(panel, input, defs[input], value);
        filled.push(input);
      } catch {
        // Not found or not fillable - you enter it yourself.
      }
    }
    const secret = secretInputs.map((i) => inputs[i]).find(Boolean);
    const inClipboard = secret ? this.copyToClipboard(secret) : false;

    const lines = [
      'ACTION NEEDED: check the "Run workflow" form in Chrome and click "Run workflow"',
      formOpen
        ? `The form is open on ${workflowUrl}`
        : `Open it yourself: ${workflowUrl} -> "Run workflow"`,
      filled.length === Object.keys(inputs).length
        ? 'All inputs are pre-filled - just check them. Values:'
        : `Pre-filled ${filled.length} of ${Object.keys(inputs).length}; enter the others (marked *). Values:`,
      ...Object.entries(inputs).map(
        ([input, value]) => `  ${filled.includes(input) ? ' ' : '*'} ${input} = ${shown(input, value)}` +
          (secretInputs.includes(input) && !filled.includes(input)
            ? (inClipboard ? '  <- in your clipboard, paste it' : '  <- copy it from the file below')
            : ''),
      ),
      ...(opts.notes ?? []),
      `Waiting up to ${Math.round((opts.manualWaitMs ?? 20 * 60_000) / 60_000)} minutes for the new run...`,
    ];
    announce(lines);
    await this.page.bringToFront();

    // Watch for the new run in a separate tab, so the form isn't reloaded while you type.
    const watcher = await this.page.context().newPage();
    await this.page.bringToFront();
    const deadline = Date.now() + (opts.manualWaitMs ?? 20 * 60_000);
    let runId = '';
    try {
      while (Date.now() < deadline && !runId) {
        await watcher.goto(workflowUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await watcher.locator('a[href*="/actions/runs/"]').first().waitFor({ timeout: 10_000 }).catch(() => {});
        runId = [...(await this.runIds(watcher))].find((id) => !before.has(id)) ?? '';
        if (!runId) await watcher.waitForTimeout(10_000);
      }
    } finally {
      await watcher.close().catch(() => {});
    }
    if (!runId) {
      throw new Error(`No new run of ${workflowUrl} was started within the waiting time. Run the test again when you are ready.`);
    }
    console.log(`Thanks - your run started.`);
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
