import { gatewayEndpoint, ENDPOINTS } from '$lib/server/gateway';

export const POST = gatewayEndpoint(ENDPOINTS.chatCompletions);
