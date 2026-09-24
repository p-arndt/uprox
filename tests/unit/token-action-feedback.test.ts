import { describe, expect, it } from 'vitest';
import {
	actionToast,
	dialogMessage,
	withoutSearchParam
} from '../../src/lib/features/tokens/action-feedback';

describe('dialogMessage', () => {
	it("only hands a dialog its own action's error", () => {
		const form = { action: 'update' as const, message: 'Name is required' };
		expect(dialogMessage(form, 'update')).toBe('Name is required');
		expect(dialogMessage(form, 'create')).toBeUndefined();
	});

	it('is empty without a result', () => {
		expect(dialogMessage(null, 'create')).toBeUndefined();
		expect(dialogMessage(undefined, 'update')).toBeUndefined();
	});
});

describe('actionToast', () => {
	it('leaves the error to the dialog that is open for that action', () => {
		expect(actionToast({ action: 'create', message: 'boom' }, 'create')).toBeNull();
	});

	it('toasts errors no open dialog can show', () => {
		expect(actionToast({ action: 'revoke', message: 'Token not found' }, null)).toEqual({
			kind: 'error',
			message: 'Token not found'
		});
		expect(actionToast({ action: 'reveal', message: 'nope' }, 'update')).toEqual({
			kind: 'error',
			message: 'nope'
		});
	});

	it('toasts successes, naming the token when known', () => {
		expect(actionToast({ action: 'create' }, 'create')).toEqual({
			kind: 'success',
			message: 'Token created'
		});
		expect(actionToast({ action: 'update', success: true }, 'update')?.message).toBe('Token saved');
		expect(actionToast({ action: 'revoke', success: true, name: 'ci' }, null)?.message).toBe(
			'Token “ci” revoked'
		);
		expect(actionToast({ action: 'delete', success: true }, null)?.message).toBe('Token deleted');
	});

	it('stays quiet for a successful reveal (the secret dialog is the feedback)', () => {
		expect(actionToast({ action: 'reveal' }, null)).toBeNull();
	});

	it('ignores results without an action', () => {
		expect(actionToast(null, null)).toBeNull();
		expect(actionToast({ message: 'legacy' }, null)).toBeNull();
	});
});

describe('withoutSearchParam', () => {
	it('drops one param and keeps the rest', () => {
		const url = new URL('https://x.test/app/tokens?service=abc&q=1');
		expect(withoutSearchParam(url, 'service').href).toBe('https://x.test/app/tokens?q=1');
		// the original is untouched
		expect(url.searchParams.get('service')).toBe('abc');
	});
});
