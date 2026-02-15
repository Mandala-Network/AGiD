/**
 * API Client for AGIdentity Gateway
 *
 * Provides simplified HTTP wrapper for plugin tool implementations.
 * Authentication will be handled by the gateway (uses wallet from plugin context).
 */

export interface ApiClientConfig {
  gatewayUrl: string;
}

/**
 * Create API client for plugin tools
 *
 * Note: Wallet/authentication will come from plugin context during execution.
 * This is just a fetch wrapper for HTTP requests to the gateway.
 */
export function createPluginClient(config: ApiClientConfig) {
  return {
    request: async (method: string, path: string, body?: any): Promise<any> => {
      const url = `${config.gatewayUrl}${path}`;

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      return response.json();
    },
  };
}

/**
 * Simplified request function for tool implementations
 */
export async function request(
  gatewayUrl: string,
  method: string,
  path: string,
  body?: any
): Promise<any> {
  const client = createPluginClient({ gatewayUrl });
  return client.request(method, path, body);
}
