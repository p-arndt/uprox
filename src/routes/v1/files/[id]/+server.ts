import { filesEndpoint } from '$lib/server/gateway';

export const GET = filesEndpoint('openai', 'file');
export const DELETE = filesEndpoint('openai', 'file');
