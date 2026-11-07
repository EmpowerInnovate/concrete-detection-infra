import { expect, type Locator, type Page } from '@playwright/test';
import { urls } from './config';

/**
 * Page object for the IAM & Admin pages of the Google Cloud Console.
 *
 * All Console selectors live here. Google changes this UI from time to time; when a
 * locator stops matching, record the current one with `npm run codegen` and update it here.
 */
export class GcpConsole {
  constructor(readonly page: Page) {}

  /** Navigate and fail fast with a clear message if the saved Google session has expired. */
  async goto(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    if (new URL(this.page.url()).hostname === 'accounts.google.com') {
      throw new Error('Google session expired or missing. Run `npm run auth` in e2e/ and sign in again.');
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
    await expect(this.page.getByRole('heading', { name: 'Create service account' }).first()).toBeVisible();
  }

  get nameInput(): Locator {
    return this.page.getByLabel('Service account name');
  }

  get idInput(): Locator {
    return this.page.getByLabel(/^Service account ID/);
  }

  get descriptionInput(): Locator {
    return this.page.getByLabel('Service account description');
  }

  get createAndContinueButton(): Locator {
    return this.page.getByRole('button', { name: 'Create and continue' });
  }

  /** Step 1: "Create service account" (name, ID, description). */
  async fillDetails(details: { name: string; id: string; description?: string }): Promise<void> {
    await this.nameInput.fill(details.name);
    // The ID is auto-generated from the name; replace it with the exact ID we want.
    await this.idInput.fill(details.id);
    await expect(this.idInput).toHaveValue(details.id);
    if (details.description) await this.descriptionInput.fill(details.description);
  }

  async submitDetails(): Promise<void> {
    await this.createAndContinueButton.click();
    // Step 2 ("Permissions (optional)") opens once the account exists.
    await expect(this.rolePickers.first()).toBeVisible({ timeout: 60_000 });
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

    // The picker opens a panel with a filter box; narrow it down, then pick the exact title.
    const filter = this.page.getByRole('textbox', { name: /filter/i }).last();
    await filter.fill(roleName);
    await this.page.getByRole('option', { name: roleName, exact: true }).first().click();

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

  /** Open the service account details page and switch to the Keys tab. */
  async openKeysTab(email: string): Promise<void> {
    await this.openServiceAccountList();
    await this.page.getByRole('link', { name: email, exact: true }).click();
    await this.page.waitForURL(/\/iam-admin\/serviceaccounts\/details\//);
    await this.page.getByRole('tab', { name: 'Keys', exact: true }).click();
    await expect(this.page.getByRole('button', { name: 'Add key' })).toBeVisible();
  }

  // ---------------------------------------------------------------- keys

  /**
   * Keys tab: Add key → Create new key → JSON → Create.
   * Returns the downloaded file, or throws a clear error if an org policy blocks key creation.
   */
  async createJsonKey(savePath: string): Promise<void> {
    await this.page.getByRole('button', { name: 'Add key' }).click();
    await this.page.getByRole('menuitem', { name: 'Create new key' }).click();

    const dialog = this.page.getByRole('dialog').filter({ hasText: /create private key/i });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('radio', { name: /JSON/ }).check();

    const download = this.page.waitForEvent('download', { timeout: 60_000 });
    const policyError = this.page
      .getByText(/key creation is disabled|iam\.disableServiceAccountKeyCreation/i)
      .first()
      .waitFor({ timeout: 60_000 })
      .then(() => 'blocked' as const);

    await dialog.getByRole('button', { name: 'Create', exact: true }).click();

    const result = await Promise.race([download, policyError]);
    if (result === 'blocked') {
      throw new Error(
        'Key creation is blocked by the organization policy iam.disableServiceAccountKeyCreation. ' +
          'Ask an org admin to allow it for this project.',
      );
    }
    policyError.catch(() => {}); // the losing waiter will time out; ignore it
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
