import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireOrg, requirePermission } from '$lib/server/org';
import { getSettings, updateSettings } from '$lib/server/data';

export const load: PageServerLoad = async (event) => {
	await requireOrg(event);
	return { settings: await getSettings() };
};

export const actions: Actions = {
	updateCache: async (event) => {
		await requirePermission(event, 'settings:manage');
		const data = await event.request.formData();
		const ttl = Number(data.get('cacheTtlSeconds'));
		if (!Number.isFinite(ttl) || ttl < 0) {
			return fail(400, { message: 'Cache TTL must be a non-negative number' });
		}
		await updateSettings({ cacheTtlSeconds: ttl });
		return { success: true };
	},
	updateMemberPermissions: async (event) => {
		await requirePermission(event, 'settings:manage');
		const data = await event.request.formData();
		const isOn = (v: FormDataEntryValue | null) => v === 'on' || v === 'true';
		const membersCanManageTokens = isOn(data.get('membersCanManageTokens'));
		const membersCanManageServices = isOn(data.get('membersCanManageServices'));
		await updateSettings({
			membersCanManageTokens,
			membersCanManageServices
		});
		return { success: true };
	},
	updateTokenSecurity: async (event) => {
		await requirePermission(event, 'settings:manage');
		const data = await event.request.formData();
		const isOn = (v: FormDataEntryValue | null) => v === 'on' || v === 'true';
		await updateSettings({
			tokensRecopyableDefault: isOn(data.get('tokensRecopyableDefault'))
		});
		return { success: true };
	},
	updateInstanceBudget: async (event) => {
		await requirePermission(event, 'settings:manage');
		const data = await event.request.formData();
		// blank = clear (unlimited); otherwise must be a non-negative number
		const parse = (v: FormDataEntryValue | null) => {
			const s = String(v ?? '').trim();
			if (s === '') return null;
			const n = Number(s);
			return Number.isFinite(n) && n >= 0 ? n : NaN;
		};
		const daily = parse(data.get('dailyBudgetUsd'));
		const monthly = parse(data.get('monthlyBudgetUsd'));
		if (Number.isNaN(daily) || Number.isNaN(monthly)) {
			return fail(400, { message: 'Budgets must be non-negative numbers' });
		}
		await updateSettings({ dailyBudgetUsd: daily, monthlyBudgetUsd: monthly });
		return { success: true };
	},
	updateBudgetAlerts: async (event) => {
		await requirePermission(event, 'settings:manage');
		const data = await event.request.formData();
		const isOn = (v: FormDataEntryValue | null) => v === 'on' || v === 'true';
		const enabled = isOn(data.get('budgetAlertsEnabled'));
		const pct = Number(data.get('budgetAlertThresholdPct'));
		if (enabled && (!Number.isFinite(pct) || pct < 1 || pct > 100)) {
			return fail(400, { message: 'Alert threshold must be between 1 and 100' });
		}
		const email = String(data.get('budgetAlertEmail') ?? '').trim();
		if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
			return fail(400, { message: 'Notification email is not a valid address' });
		}
		await updateSettings({
			budgetAlertsEnabled: enabled,
			budgetAlertThresholdPct: pct,
			budgetAlertEmail: email
		});
		return { success: true };
	},
	updateTracing: async (event) => {
		await requirePermission(event, 'settings:manage');
		const data = await event.request.formData();
		const isOn = (v: FormDataEntryValue | null) => v === 'on' || v === 'true';
		const enabled = isOn(data.get('tracingEnabled'));
		const days = Number(data.get('tracingRetentionDays'));
		if (enabled && (!Number.isFinite(days) || days < 1)) {
			return fail(400, { message: 'Retention must be at least 1 day' });
		}
		await updateSettings({
			tracingEnabled: enabled,
			tracingRetentionDays: days
		});
		return { success: true };
	}
};
