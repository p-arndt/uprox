import { filesEndpoint } from '$lib/server/gateway';

export const GET = filesEndpoint('azure', 'file');
export const DELETE = filesEndpoint('azure', 'file');
