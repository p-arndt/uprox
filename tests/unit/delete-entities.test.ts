import { beforeEach, describe, expect, it, vi } from 'vitest';

// db.delete(...).where(...).returning(...) resolves to `deletedRows`.
let deletedRows: Record<string, unknown>[] = [];
vi.mock('$lib/server/db', () => ({
	db: {
		delete: () => ({
			where: () => ({ returning: () => Promise.resolve(deletedRows) })
		})
	}
}));

const audit = vi.fn<(entry: unknown) => Promise<string | null>>(() => Promise.resolve('audit-id'));
vi.mock('$lib/server/audit', () => ({ audit: (entry: unknown) => audit(entry) }));

import { deleteProviderSecret } from '$lib/server/provider-secrets';
import { deletePolicy } from '$lib/server/policies';

beforeEach(() => {
	deletedRows = [];
	audit.mockClear();
});

describe('deleteProviderSecret', () => {
	it('audits the deletion and reports it', async () => {
		deletedRows = [{ provider: 'azure', label: 'West Europe' }];

		expect(await deleteProviderSecret('secret-1')).toBe(true);
		expect(audit).toHaveBeenCalledWith({
			action: 'provider.delete',
			status: 'ok',
			provider: 'azure',
			detail: 'West Europe'
		});
	});

	it('falls back to the provider id when the secret has no label', async () => {
		deletedRows = [{ provider: 'openai', label: null }];

		await deleteProviderSecret('secret-1');
		expect(audit).toHaveBeenCalledWith(expect.objectContaining({ detail: 'openai' }));
	});

	it('returns false and audits nothing for an unknown id', async () => {
		expect(await deleteProviderSecret('missing')).toBe(false);
		expect(audit).not.toHaveBeenCalled();
	});
});

describe('deletePolicy', () => {
	it('audits the deletion and reports it', async () => {
		deletedRows = [{ name: 'Strict' }];

		expect(await deletePolicy('policy-1')).toBe(true);
		expect(audit).toHaveBeenCalledWith({ action: 'policy.delete', status: 'ok', detail: 'Strict' });
	});

	it('returns false and audits nothing for an unknown id', async () => {
		expect(await deletePolicy('missing')).toBe(false);
		expect(audit).not.toHaveBeenCalled();
	});
});
