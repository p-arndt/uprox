import { env } from '$env/dynamic/private';

/**
 * Minimal transactional email. Uses SMTP via nodemailer when configured;
 * otherwise it no-ops (the caller still surfaces a copy-able link in the UI,
 * so invites work locally with no mail setup).
 *
 * Configure with SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.
 */
export function smtpConfigured(): boolean {
	return Boolean(env.SMTP_HOST);
}

async function getTransport() {
	const { createTransport } = await import('nodemailer');
	const port = Number(env.SMTP_PORT) || 587;
	return createTransport({
		host: env.SMTP_HOST,
		port,
		secure: port === 465,
		auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined
	});
}

interface InvitationEmail {
	to: string;
	inviteUrl: string;
	orgName: string;
	inviterName?: string;
	role: string;
}

export async function sendInvitationEmail(data: InvitationEmail): Promise<void> {
	if (!smtpConfigured()) {
		// No SMTP configured — the dashboard shows a copy-able link instead.
		console.log(`[email] SMTP not configured; invite link for ${data.to}: ${data.inviteUrl}`);
		return;
	}

	const inviter = data.inviterName ? `${data.inviterName} invited you` : 'You have been invited';
	try {
		const transport = await getTransport();
		await transport.sendMail({
			from: env.SMTP_FROM || env.SMTP_USER,
			to: data.to,
			subject: `Join ${data.orgName} on uprox`,
			text: `${inviter} to join ${data.orgName} on uprox as ${data.role}.\n\nAccept: ${data.inviteUrl}`,
			html: `<p>${inviter} to join <strong>${data.orgName}</strong> on uprox as <strong>${data.role}</strong>.</p>
<p><a href="${data.inviteUrl}">Accept invitation</a></p>
<p style="color:#888;font-size:12px">If you weren't expecting this, you can ignore this email.</p>`
		});
	} catch (err) {
		// Swallow so the caller (better-auth background task) doesn't crash.
		// The invite still exists in the DB and is reachable via the copy-link
		// in the members dashboard.
		const reason = err instanceof Error ? err.message : String(err);
		console.error(
			`[email] Failed to send invitation to ${data.to} (${reason}). Invite link: ${data.inviteUrl}`
		);
	}
}

interface BudgetAlertEmail {
	to: string[];
	orgName: string;
	serviceName: string;
	window: 'daily' | 'monthly';
	level: 'warn' | 'over';
	spentUsd: number;
	budgetUsd: number;
	pct: number;
	/** absolute link to the usage dashboard, or null when ORIGIN isn't known */
	usageUrl?: string | null;
}

/**
 * Notify org admins that a service has crossed its spend threshold. Shares the
 * same graceful-degradation contract as {@link sendInvitationEmail}: no-ops (with
 * a log line) when SMTP isn't configured, so the in-app banner remains the
 * source of truth in local/dev setups.
 */
export async function sendBudgetAlertEmail(data: BudgetAlertEmail): Promise<void> {
	const recipients = data.to.filter(Boolean);
	if (recipients.length === 0) return;

	const money = (n: number) => `$${n.toFixed(2)}`;
	const headline =
		data.level === 'over'
			? `${data.serviceName} is over its ${data.window} budget`
			: `${data.serviceName} has reached ${data.pct}% of its ${data.window} budget`;

	if (!smtpConfigured()) {
		console.log(
			`[email] SMTP not configured; budget alert for ${recipients.join(', ')}: ${headline}`
		);
		return;
	}

	const link = data.usageUrl ? `\n\nView usage: ${data.usageUrl}` : '';
	const linkHtml = data.usageUrl
		? `<p><a href="${data.usageUrl}">View usage dashboard</a></p>`
		: '';

	try {
		const transport = await getTransport();
		await transport.sendMail({
			from: env.SMTP_FROM || env.SMTP_USER,
			to: recipients,
			subject: `[uprox] ${headline}`,
			text: `${headline} in ${data.orgName}.\n\nSpend: ${money(data.spentUsd)} of ${money(data.budgetUsd)} (${data.pct}%).${link}`,
			html: `<p><strong>${headline}</strong> in ${data.orgName}.</p>
<p>Spend: <strong>${money(data.spentUsd)}</strong> of ${money(data.budgetUsd)} (${data.pct}%).</p>
${linkHtml}`
		});
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		console.error(
			`[email] Failed to send budget alert to ${recipients.join(', ')} (${reason}): ${headline}`
		);
	}
}
