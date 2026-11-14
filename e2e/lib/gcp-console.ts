import { expect, type Locator, type Page } from '@playwright/test';
import { urls } from './config';
import { waitForGoogleSignIn } from './signin';

/**
 * How long to wait for a Console page to finish loading. The Console often shows only a
 * spinner for a minute or more, so this is generous. Override with PAGE_LOAD_TIMEOUT_SEC.
 */
const PAGE_LOAD = Number(process.env.PAGE_LOAD_TIMEOUT_SEC || 180) * 1_000;

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
    await expect(this.nameInput).toBeVisible({ timeout: PAGE_LOAD });
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

  /** The open dropdown panel (Angular CDK overlay); falls back to the whole page. */
  private get overlay(): Locator {
    return this.page.locator('.cdk-overlay-container .cdk-overlay-pane').last();
  }

  /**
   * The search box at the top of the open role picker. Its label is "Search" with the
   * placeholder "Service, role or permission" (older Consoles: "Filter"). Looked up inside the
   * open panel first, so the Console's own search bar at the top of the page isn't used.
   */
  private async roleSearchBox(): Promise<Locator> {
    const inPanel = this.overlay.locator('input:visible').first();
    if (await inPanel.isVisible({ timeout: 10_000 }).catch(() => false)) return inPanel;
    return this.page
      .getByPlaceholder(/service, role or permission|filter/i)
      .or(this.page.getByRole('textbox', { name: /filter/i }))
      .last();
  }

  /**
   * Pick `roleName` in the role dropdown at row `index`, adding a row with "Add another role"
   * first if needed. Works in the create wizard and in IAM "Grant access".
   */
  async addRole(roleName: string, index: number): Promise<void> {
    if (index > 0) {
      const before = await this.rolePickers.count();
      await this.page.getByRole('button', { name: /add another role/i }).first().click();
      await expect(this.rolePickers).toHaveCount(before + 1);
    }
    const picker = this.rolePickers.nth(index);
    await expect(picker).toBeVisible({ timeout: 60_000 });
    await picker.click();

    const search = await this.roleSearchBox();
    await search.fill(roleName);

    // Results show role titles, sometimes with a description in the same option. Match the exact
    // title ("Service Account Admin" must not pick "Service Account Key Admin"), inside the open
    // panel when there is one.
    const scope = (await this.overlay.isVisible().catch(() => false)) ? this.overlay : this.page.locator('body');
    const titleRe = new RegExp(`^\\s*${escapeRe(roleName)}(\\s|$)`);
    const choice = scope
      .getByRole('option', { name: roleName, exact: true })
      .or(scope.getByRole('menuitem', { name: roleName, exact: true }))
      .or(scope.getByRole('option', { name: titleRe }))
      .or(scope.getByText(roleName, { exact: true }))
      .first();
    await expect(choice, `role "${roleName}" not found in the role picker`).toBeVisible({ timeout: 30_000 });
    await choice.click();

    // The picker now shows the chosen role (in its text, or as the value of its input).
    const shown = await expect(picker).toContainText(roleName, { timeout: 15_000 }).then(() => true, () => false);
    if (!shown) {
      await expect(this.overlay, `role picker for "${roleName}" did not close`).toBeHidden({ timeout: 10_000 });
      const value = await picker.evaluate((el) => (el as HTMLInputElement).value ?? el.querySelector('input')?.value ?? '').catch(() => '');
      if (!value.includes(roleName)) {
        await expect(this.page.locator('main').getByText(roleName, { exact: true }).first(), `role "${roleName}" was not selected`).toBeVisible();
      }
    }
  }

  /** Wizard steps 2 and 3: Continue (if shown), then Done; waits until it's back on the list. */
  async finishWizard(): Promise<void> {
    const cont = this.page.getByRole('button', { name: 'Continue', exact: true });
    if (await cont.isVisible({ timeout: 5_000 }).catch(() => false)) await cont.click();
    await this.page.getByRole('button', { name: 'Done', exact: true }).click();
    await this.page.waitForURL(/\/iam-admin\/serviceaccounts(\?|$)/, { timeout: PAGE_LOAD, waitUntil: 'commit' });
  }

  /** Leave the wizard without roles (used when picking a role fails): the account already exists. */
  async abandonWizard(): Promise<void> {
    await this.page.keyboard.press('Escape').catch(() => {});
    const done = this.page.getByRole('button', { name: 'Done', exact: true });
    if (await done.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await done.click().catch(() => {});
      await this.page.waitForURL(/\/iam-admin\/serviceaccounts(\?|$)/, { timeout: 60_000, waitUntil: 'commit' }).catch(() => {});
    }
  }

  // ---------------------------------------------------------------- IAM roles

  /** Which of `roles` the principal does NOT have, read from its row on the IAM page. */
  async missingRoles(email: string, roles: readonly string[]): Promise<string[]> {
    await this.goto(urls.iam());
    await this.waitForTableOrFilter(PAGE_LOAD);
    await this.filterList(email);
    const row = this.tableRows.filter({ hasText: email }).first();
    // An account with no roles at all has no row on the IAM page.
    const text = (await row.isVisible({ timeout: 30_000 }).catch(() => false)) ? await row.innerText() : '';
    return roles.filter((r) => !new RegExp(`(^|[\\s,])${escapeRe(r)}($|[\\s,])`).test(text));
  }

  /** IAM page → "Grant access": add `roles` for the principal `email`, then Save. */
  async grantRoles(email: string, roles: readonly string[]): Promise<void> {
    await this.goto(urls.iam());
    await this.waitForTableOrFilter(PAGE_LOAD);
    const grant = this.page.getByRole('button', { name: /grant access/i }).first();
    await expect(grant).toBeVisible({ timeout: PAGE_LOAD });
    await grant.click();

    const principals = this.page
      .getByLabel(/new principals/i)
      .or(this.page.getByRole('combobox', { name: /principals/i }))
      .or(this.page.getByPlaceholder(/principal/i))
      .first();
    await expect(principals, '"New principals" field not found in Grant access').toBeVisible({ timeout: 60_000 });
    await principals.fill(email);
    // The field turns the email into a chip; pick the suggestion if one appears, else press Enter.
    const suggestion = this.page.getByRole('option', { name: new RegExp(escapeRe(email)) }).first();
    if (await suggestion.isVisible({ timeout: 10_000 }).catch(() => false)) await suggestion.click();
    else await principals.press('Enter');

    for (const [i, role] of roles.entries()) await this.addRole(role, i);

    await this.page.getByRole('button', { name: 'Save', exact: true }).click();
    // The panel closes when the policy is saved.
    await expect(principals).toBeHidden({ timeout: 120_000 });
  }

  // ---------------------------------------------------------------- list / details

  async openServiceAccountList(): Promise<void> {
    await this.goto(urls.serviceAccounts());
    // Ready when the "Create service account" button or the table/filter shows up.
    await expect(
      this.page.getByRole('button', { name: /create service account/i }).first()
        .or(this.filterBox).or(this.tableRows.first()).first(),
      'service account list did not finish loading',
    ).toBeVisible({ timeout: PAGE_LOAD });
  }

  /**
   * Table rows only. The Console's filter chips (mat-chip-row) also have role="row" and contain
   * the filtered text, so `getByRole('row')` would match them too.
   */
  get tableRows(): Locator {
    return this.page.locator('tr, [role="row"]:not(mat-chip-row):not(.mat-mdc-chip)');
  }

  /** The row for `email` in the service account list. */
  serviceAccountRow(email: string): Locator {
    return this.tableRows.filter({ hasText: email });
  }

  /** True if the service account is in the list (opens the list page). */
  async serviceAccountListed(email: string): Promise<boolean> {
    await this.openServiceAccountList();
    await this.filterList(email);
    // The table loads after the page; give it a moment before deciding the row isn't there.
    await this.tableRows.nth(1).waitFor({ timeout: 60_000 }).catch(() => {});
    return this.serviceAccountRow(email).first().isVisible({ timeout: 5_000 }).catch(() => false);
  }

  /** Type into the list's filter box so pagination can't hide the row. Best effort. */
  private async filterList(text: string): Promise<void> {
    await this.waitForTableOrFilter(PAGE_LOAD).catch(() => {});
    const filter = this.filterBox;
    if (await filter.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await filter.click();
      await filter.fill(text);
      await filter.press('Enter');
    }
  }


  /** Open the service account details page and switch to the Keys tab. */
  async openKeysTab(email: string): Promise<void> {
    await this.openServiceAccountList();
    await this.filterList(email);
    const link = this.page.getByRole('link', { name: email, exact: true }).first();
    await expect(link, `${email} not found in the service account list`).toBeVisible({ timeout: PAGE_LOAD });
    await link.click();
    await this.page.waitForURL(/\/iam-admin\/serviceaccounts\/details\//, { timeout: PAGE_LOAD, waitUntil: 'commit' });
    const keysTab = this.page.getByRole('tab', { name: 'Keys', exact: true });
    await expect(keysTab).toBeVisible({ timeout: PAGE_LOAD });
    await keysTab.click();
    await expect(this.page.getByRole('button', { name: 'Add key' })).toBeVisible({ timeout: PAGE_LOAD });
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
    return this.tableRows.filter({ hasText: keyId });
  }

  // ---------------------------------------------------------------- IAM page

  /**
   * IAM page row for a principal. The IAM page is slow (it can show a spinner for a minute or
   * more), so wait for it to finish, then filter by the email so pagination can't hide the row.
   */
  async iamRowFor(email: string): Promise<Locator> {
    await this.goto(urls.iam());
    await this.waitForTableOrFilter(PAGE_LOAD);
    await this.filterList(email);
    const row = this.tableRows.filter({ hasText: email }).first();
    await expect(row, `${email} not found on the IAM page`).toBeVisible({ timeout: PAGE_LOAD });
    return row;
  }

  /** The filter box above Console tables; its placeholder/label differs between pages. */
  get filterBox(): Locator {
    return this.page
      .getByPlaceholder(/filter|property name or value/i)
      .or(this.page.getByRole('textbox', { name: /filter/i }))
      .or(this.page.getByRole('combobox', { name: /filter/i }))
      .or(this.page.locator('input[aria-label*="filter" i], input[placeholder*="filter" i]'))
      .first();
  }

  /** Wait until the page has finished loading: a filter box or a table row is shown. */
  async waitForTableOrFilter(timeout: number): Promise<void> {
    await expect(this.filterBox.or(this.tableRows.first()).first(), 'page did not finish loading').toBeVisible({ timeout });
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
