import { filesEndpoint } from '$lib/server/gateway';

export const POST = filesEndpoint('openai', 'list');
export const GET = filesEndpoint('openai', 'list');
