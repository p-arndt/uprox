import { gatewayEndpoint, ENDPOINTS, azureStyle } from '$lib/server/gateway';

export const POST = gatewayEndpoint(azureStyle(ENDPOINTS.chatCompletions));
