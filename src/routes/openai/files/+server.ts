import { filesEndpoint } from '$lib/server/gateway';

export const POST = filesEndpoint('azure', 'list');
export const GET = filesEndpoint('azure', 'list');
