/** Display helpers for the service list and detail pages. */

/** Confirmation copy for deleting a service, which revokes all of its tokens. */
export function deleteServiceDescription(activeTokens: number): string {
	const tail = "This can't be undone.";
	if (activeTokens === 0) return `This service has no active tokens. ${tail}`;
	const noun = activeTokens === 1 ? 'active token' : 'active tokens';
	return `${activeTokens} ${noun} will be revoked and stop working immediately. ${tail}`;
}
