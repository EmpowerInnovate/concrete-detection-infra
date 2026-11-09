import { expect, type Locator, type Page } from '@playwright/test';
import { urls } from './config';
import { waitForGoogleSignIn } from './signin';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Page object for the IAM & Admin pages of the Google Cloud Console.
 *
 * All Console selectors live here. Google changes this UI from time to time; when a
 * locator stops matching, record the current one with `npm run codegen` and update it here.
 */
export class GcpConsole {
  constructor(readonly page: Page) {}

  /** Navigate; if the Google session has expired, wait for you to sign in again, then retry. */
  async goto(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    if (await waitForGoogleSignIn(this.page)) {
      await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    }
    await this.dismissPopups();
  }

  /** Close first-visit banners/tours that can cover the page. Best effort only. */
  private async dismissPopups(): Promise<void> {
    for (const name of ['Dismiss', 'Got it', 'OK, got it', 'No thanks']) {
      const button = this.page.getByRole('button', { name, exact: true }).first();
      if (await button.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await button.click().catch(() => {});
      }
    }
  }

  // ---------------------------------------------------------------- create wizard

  async openCreateServiceAccount(): Promise<void> {
    await this.goto(urls.createServiceAccount());
    // The form renders a while after the page; the name field is the reliable sign it's ready.
    await expect(this.nameInput).toBeVisible({ timeout: 90_000 });
  }

  get nameInput(): Locator {
    return this.page.getByLabel('Service account name').first();
  }

  /**
   * The "Service account ID" field. Its label isn't always linked to the input, so try the
   * label, then the accessible name, then the form control name.
   */
  get idInputCandidates(): Locator {
    return this.page
      .getByLabel(/Service account ID/i)
      .or(this.page.getByRole('textbox', { name: /account id/i }))
      .or(this.page.locator('input[formcontrolname*="accountId" i], input[formcontrolname*="account_id" i], input[name*="accountId" i]'))
      .or(this.page.locator('[data-e2e="sa-id"]'));
  }

  get idInput(): Locator {
    return this.idInputCandidates.first();
  }

  get descriptionInput(): Locator {
    return this.page.getByLabel(/Service account description/i).first();
  }

  get createAndContinueButton(): Locator {
    return this.page.getByRole('button', { name: 'Create and continue' });
  }

  /**
   * Last resort for the ID field: after the name is typed, the Console fills the ID with a
   * value derived from it. Find that input and tag it so `idInput` matches it.
   */
  private async tagIdInputByValue(name: string): Promise<void> {
    await this.page.waitForTimeout(1_000); // let the Console fill in the generated ID
    const slug = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 20);
    const tagged = await this.page.evaluate((prefix) => {
      const inputs = [...document.querySelectorAll('input')].filter((i) => i.offsetParent !== null);
      const nameInput = document.activeElement;
      const hit = inputs.find((i) => i !== nameInput && i.value.toLowerCase().startsWith(prefix));
      if (hit) hit.setAttribute('data-e2e', 'sa-id');
      return !!hit;
    }, slug);
    if (!tagged) throw new Error('Could not find the "Service account ID" field. Update idInput in lib/gcp-console.ts (npm run codegen).');
  }

  /** The Console's inline "already exists / in use" message for the ID. */
  get idTakenMessage(): Locator {
    return this.page.getByText(/already (exists|in use|been used|taken)|is not available/i).first();
  }

  /**
   * Step 1: "Create service account" (name, ID, description).
   * Returns 'exists' if the Console says the ID is already taken (the account already exists).
   */
  /** Type the display name, then make sure the ID field can be found. */
  async fillName(name: string): Promise<void> {
    await this.nameInput.fill(name);
    if (!(await this.idInput.isVisible({ timeout: 10_000 }).catch(() => false))) {
      await this.tagIdInputByValue(name);
    }
  }

  async fillDetails(details: { name: string; id: string; description?: string }): Promise<'ok' | 'exists'> {
    await this.fillName(details.name);
    // The ID is auto-generated from the name (with a number added if it's taken);
    // replace it with the exact ID we want.
    await this.idInput.fill(details.id);
    await expect(this.idInput).toHaveValue(details.id);
    await this.idInput.press('Tab'); // the Console checks the ID when the field loses focus
    if (details.description) await this.descriptionInput.fill(details.description).catch(() => {});
    if (await this.idTakenMessage.isVisible({ timeout: 5_000 }).catch(() => false)) return 'exists';
    return 'ok';
  }

  /**
   * Clicks "Create and continue". Returns 'created' when step 2 ("Permissions") opens, or
   * 'exists' when the Console says an account with this ID already exists.
   */
  async submitDetails(): Promise<'created' | 'exists'> {
    await this.createAndContinueButton.click();
    const created = this.rolePickers.first();
    const exists = this.idTakenMessage;
    await expect(created.or(exists).first()).toBeVisible({ timeout: 60_000 });
    return (await exists.isVisible().catch(() => false)) ? 'exists' : 'created';
  }

  /** Role dropdowns in step 2 of the wizard (one per "Add another role" row). */
  get rolePickers(): Locator {
    return this.page.getByRole('combobox', { name: /role/i });
  }

  /** Step 2: pick `roleName` in the role dropdown at row `index`, adding a new row if needed. */
  async addRole(roleName: string, index: number): Promise<void> {
    if (index > 0) {
      await this.page.getByRole('button', { name: 'Add another role' }).click();
      await expect(this.rolePickers).toHaveCount(index + 1);
    }
    await this.rolePickers.nth(index).click();

    // The picker opens a panel with a filter box; narrow it down, then pick the role.
    const filter = this.page.getByRole('textbox', { name: /filter/i }).last();
    await filter.fill(roleName);

    // An option's accessible name is sometimes the title alone ("Owner") and sometimes the
    // title plus its description ("Owner Full access to most Google Cloud resources...").
    // `\b` after the title keeps "Service Account Admin" from matching "Service Account Key Admin".
    const exact = this.page.getByRole('option', { name: roleName, exact: true }).first();
    const prefix = this.page.getByRole('option', { name: new RegExp(`^\\s*${escapeRe(roleName)}\\b`) }).first();
    await expect(exact.or(prefix).first()).toBeVisible();
    await ((await exact.isVisible()) ? exact : prefix).click();

    await expect(this.rolePickers.nth(index)).toContainText(roleName);
  }

  /** Steps 2 and 3: Continue, then Done. Waits until we're back on the service account list. */
  async finishWizard(): Promise<void> {
    await this.page.getByRole('button', { name: 'Continue', exact: true }).click();
    await this.page.getByRole('button', { name: 'Done', exact: true }).click();
    await this.page.waitForURL(/\/iam-admin\/serviceaccounts(\?|$)/, { timeout: 90_000 });
  }

  // ---------------------------------------------------------------- list / details

  async openServiceAccountList(): Promise<void> {
    await this.goto(urls.serviceAccounts());
    await expect(this.page.getByRole('button', { name: /create service account/i }).first()).toBeVisible();
  }

  /** The row for `email` in the service account list. */
  serviceAccountRow(email: string): Locator {
    return this.page.getByRole('row').filter({ hasText: email });
  }

  /** True if the service account is in the list (opens the list page). */
  async serviceAccountListed(email: string): Promise<boolean> {
    await this.openServiceAccountList();
    await this.filterList(email);
    // The table loads after the page; give it a moment before deciding the row isn't there.
    await this.page.getByRole('row').nth(1).waitFor({ timeout: 30_000 }).catch(() => {});
    return this.serviceAccountRow(email).first().isVisible({ timeout: 5_000 }).catch(() => false);
  }

  /** Type into the list's filter box so pagination can't hide the row. Best effort. */
  private async filterList(text: string): Promise<void> {
    const filter = this.page
      .getByPlaceholder(/filter/i)
      .or(this.page.getByRole('textbox', { name: /filter/i }))
      .or(this.page.getByRole('combobox', { name: /filter/i }))
      .first();
    if (await filter.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await filter.fill(text);
      await filter.press('Enter');
    }
  }

  /** Open the service account details page and switch to the Keys tab. */
  async openKeysTab(email: string): Promise<void> {
    await this.openServiceAccountList();
    await this.filterList(email);
    await this.page.getByRole('link', { name: email, exact: true }).click();
    await this.page.waitForURL(/\/iam-admin\/serviceaccounts\/details\//);
    await this.page.getByRole('tab', { name: 'Keys', exact: true }).click();
    await expect(this.page.getByRole('button', { name: 'Add key' })).toBeVisible();
  }

  // ---------------------------------------------------------------- keys

  /**
   * Keys tab: Add key → Create new key → JSON → Create, and save the download to `savePath`.
   * Throws a clear error if an org policy blocks key creation.
   */
  async createJsonKey(savePath: string): Promise<void> {
    await this.page.getByRole('button', { name: 'Add key' }).click();
    await this.page.getByRole('menuitem', { name: 'Create new key' }).click();

    const dialog = this.page.getByRole('dialog').filter({ hasText: /create private key/i });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('radio', { name: /JSON/ }).check();

    const download = this.page.waitForEvent('download', { timeout: 60_000 });
    const policyError = this.page
      .getByText(/key creation is disabled|iam\.disableServiceAccountKeyCreation|iam\.managed\.disableServiceAccountKeyCreation/i)
      .first()
      .waitFor({ timeout: 60_000 })
      .then(() => 'blocked' as const);
    policyError.catch(() => {}); // the losing waiter times out; ignore it

    await dialog.getByRole('button', { name: 'Create', exact: true }).click();

    const tooManyKeys = this.page
      .getByText(/maximum number of keys|key quota|exceeded.*keys|keys.*limit/i)
      .first()
      .waitFor({ timeout: 60_000 })
      .then(() => 'limit' as const);
    tooManyKeys.catch(() => {});

    const result = await Promise.race([download, policyError, tooManyKeys]);
    if (result === 'blocked') {
      throw new Error(
        'Key creation is blocked by the organization policy iam.disableServiceAccountKeyCreation. ' +
          'Ask an org admin to allow it for this project.',
      );
    }
    if (result === 'limit') {
      throw new Error(
        'This service account already has the maximum of 10 keys. Delete old keys on its Keys tab, ' +
          'or point SA_KEY_FILE at a key you already have.',
      );
    }
    await result.saveAs(savePath);

    // Confirmation dialog: "Private key saved to your computer".
    const saved = this.page.getByRole('dialog').filter({ hasText: /private key saved/i });
    await expect(saved).toBeVisible();
    await saved.getByRole('button', { name: 'Close' }).click();
    await expect(saved).toBeHidden();
  }

  /** Row in the Keys table for a key ID. */
  keyRow(keyId: string): Locator {
    return this.page.getByRole('row').filter({ hasText: keyId });
  }

  // ---------------------------------------------------------------- IAM page

  /** IAM page row for a principal, filtered so pagination doesn't hide it. */
  async iamRowFor(email: string): Promise<Locator> {
    await this.goto(urls.iam());
    const filter = this.page.getByPlaceholder(/filter/i).first();
    await filter.fill(email);
    await filter.press('Enter');
    const row = this.page.getByRole('row').filter({ hasText: email });
    await expect(row.first()).toBeVisible();
    return row.first();
  }

  // ---------------------------------------------------------------- cleanup (UI fallback)

  /** Delete a service account through the UI (used only when gcloud is not available). */
  async deleteServiceAccount(email: string): Promise<void> {
    await this.openServiceAccountList();
    const row = this.serviceAccountRow(email);
    if ((await row.count()) === 0) return;
    await row.getByRole('button', { name: /actions/i }).click();
    await this.page.getByRole('menuitem', { name: 'Delete' }).click();
    const dialog = this.page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(row).toHaveCount(0, { timeout: 60_000 });
  }
}
