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

	// Imported lazily so nodemailer is only loaded when SMTP is actually used.
	const { createTransport } = await import('nodemailer');
	const port = Number(env.SMTP_PORT) || 587;
	const transport = createTransport({
		host: env.SMTP_HOST,
		port,
		secure: port === 465,
		auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined
	});

	const inviter = data.inviterName ? `${data.inviterName} invited you` : 'You have been invited';
	await transport.sendMail({
		from: env.SMTP_FROM || env.SMTP_USER,
		to: data.to,
		subject: `Join ${data.orgName} on uprox`,
		text: `${inviter} to join ${data.orgName} on uprox as ${data.role}.\n\nAccept: ${data.inviteUrl}`,
		html: `<p>${inviter} to join <strong>${data.orgName}</strong> on uprox as <strong>${data.role}</strong>.</p>
<p><a href="${data.inviteUrl}">Accept invitation</a></p>
<p style="color:#888;font-size:12px">If you weren't expecting this, you can ignore this email.</p>`
	});
}
