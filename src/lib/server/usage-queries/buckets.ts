/** Time-bucket helpers shared by the time-series queries. */
import type { SeriesBucket } from '$lib/features/usage/range';

/** Postgres `date_trunc`/`generate_series` step for each bucket unit. */
export const BUCKET_STEP: Record<SeriesBucket, string> = {
	hour: '1 hour',
	day: '1 day',
	week: '1 week',
	month: '1 month'
};
