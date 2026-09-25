import { expect, type Locator, type Page } from '@playwright/test';

/** A shadcn card containing `text` (presets, settings sections). */
export function cardWith(page: Page, text: string): Locator {
	return page.locator('[data-slot="card"]').filter({ hasText: text });
}

/** A sonner toast with exactly this message. */
export function toast(page: Page, message: string): Locator {
	return page.locator('[data-sonner-toast]').filter({ hasText: message });
}

/** Open a bits-ui select by its trigger and pick the option named `option`. */
export async function pickOption(page: Page, trigger: Locator, option: string) {
	await trigger.click();
	await page.getByRole('option', { name: option, exact: true }).click();
	await expect(trigger).toHaveText(option);
}

/**
 * Turn off the browser's constraint validation on the form around `field`, so
 * a value its `min` would block reaches the server. The server is the real
 * guard (the REST API and scripted clients skip the browser), so its message
 * must still land in the UI.
 */
export async function skipNativeValidation(field: Locator) {
	await field.evaluate((el) => {
		const form = (el as HTMLInputElement).form;
		if (!form) throw new Error('field is not inside a form');
		form.noValidate = true;
	});
}
