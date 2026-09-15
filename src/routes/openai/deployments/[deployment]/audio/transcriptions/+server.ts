import { gatewayEndpoint, ENDPOINTS, azureDeployment } from '$lib/server/gateway';

export const POST = gatewayEndpoint(azureDeployment(ENDPOINTS.audioTranscriptions));
