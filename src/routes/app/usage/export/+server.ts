import type { RequestHandler } from './$types';
import { requireOrgApi } from '$lib/server/org';
import { orgUsageByDimension, orgUsageSeriesGrouped } from '$lib/server/data';
import { resolveUsageRange, normalizeBucket } from '$lib/usage-range';
import { normalizeGroupBy, parseFilters, dimensionLabel } from '$lib/usage-group';

/**
 * CSV export of whatever the usage page is currently showing. The query string
 * is the same one the page uses, so "Export" is literally "this view, as a
 * file" — no second set of parameters to keep in sync, and a shared page URL and
 * its export can never disagree.
 *
 * Two shapes:
 *   ?shape=breakdown (default) — one row per series, the detail table
 *   ?shape=timeseries          — one row per (bucket, series), for a pivot table
 */
export const GET: RequestHandler = async (event) => {
	await requireOrgApi(event);

	const params = event.url.searchParams;
	const range = resolveUsageRange(params.get('range'), {
		from: params.get('from'),
		to: params.get('to')
	});
	const groupBy = normalizeGroupBy(params.get('group'));
	const filters = parseFilters(params.getAll('f'));
	const shape = params.get('shape') === 'timeseries' ? 'timeseries' : 'breakdown';

	const dimHeader = dimensionLabel(groupBy);
	let csv: string;

	if (shape === 'timeseries') {
		const grouped = await orgUsageSeriesGrouped(range, groupBy, {
			unit: normalizeBucket(params.get('bucket')),
			filters
		});
		const rows: string[][] = [['Bucket', dimHeader, 'Spend (USD)', 'Requests', 'Denied', 'Tokens']];
		for (const s of grouped.series) {
			grouped.buckets.forEach((bucket, i) => {
				const p = s.points[i];
				if (!p) return;
				rows.push([
					bucket,
					s.label,
					p.costUsd.toFixed(6),
					String(p.requests),
					String(p.denied),
					String(p.tokens)
				]);
			});
		}
		csv = rows.map(toCsvRow).join('\r\n');
	} else {
		const breakdown = await orgUsageByDimension(range, groupBy, { filters });
		const rows: string[][] = [
			[dimHeader, 'Detail', 'Spend (USD)', 'Requests', 'Denied', 'Input tokens', 'Output tokens']
		];
		for (const r of breakdown) {
			rows.push([
				r.label,
				r.hint ?? '',
				r.costUsd.toFixed(6),
				String(r.requests),
				String(r.denied),
				String(r.inputTokens),
				String(r.outputTokens)
			]);
		}
		csv = rows.map(toCsvRow).join('\r\n');
	}

	const stamp = new Date().toISOString().slice(0, 10);
	return new Response(
		// UTF-8 BOM: without it Excel decodes the file as the local ANSI codepage
		// and mangles any non-ASCII service or model name.
		'\ufeff' + csv,
		{
			headers: {
				'content-type': 'text/csv; charset=utf-8',
				'content-disposition': `attachment; filename="uprox-usage-${groupBy}-${range.key}-${stamp}.csv"`,
				'cache-control': 'no-store'
			}
		}
	);
};

/**
 * RFC 4180 quoting: wrap any field containing a delimiter, quote, or newline and
 * double its inner quotes. Fields opening with =/+/-/@ are quoted too — that
 * alone does not stop a spreadsheet evaluating them, so the real defence is that
 * every value here is a name or a number the gateway recorded, never free text.
 */
function toCsvRow(fields: string[]): string {
	return fields
		.map((f) => {
			const v = f ?? '';
			const risky = /^[=+\-@]/.test(v);
			if (risky || /["\r\n,]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
			return v;
		})
		.join(',');
}
