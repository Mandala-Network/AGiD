/**
 * AGiD Deploy Plugin
 *
 * Mandala Node infrastructure management tools.
 */

import { MandalaClient } from '../../integrations/mandala/index.js';
import { definePluginEntry } from '../define-plugin-entry.js';

function json(data: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

export const agidDeployPlugin = definePluginEntry({
  id: 'agid-deploy',
  name: 'AGiD Deploy',
  register(api) {
    // =========================================================================
    // 1. agid_mandala_create_project
    // =========================================================================
    api.registerTool(
      {
        name: 'agid_mandala_create_project',
        description: 'Create a new project on a Mandala Node.',
        parameters: {
          type: 'object',
          properties: {
            nodeUrl: { type: 'string', description: 'Mandala Node URL (e.g. https://cars.babbage.systems)' },
            name: { type: 'string', description: 'Project name' },
            network: { type: 'string', description: 'Network: "mainnet" or "testnet" (default: mainnet)' },
          },
          required: ['nodeUrl', 'name'],
        },
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const client = new MandalaClient(ctx!.wallet);
          const result = await client.createProject(
            params.nodeUrl as string,
            params.name as string,
            params.network as string | undefined,
          );
          return json({ action: 'created', ...result });
        },
      },
      { group: 'deploy' },
    );

    // =========================================================================
    // 2. agid_mandala_list_projects
    // =========================================================================
    api.registerTool(
      {
        name: 'agid_mandala_list_projects',
        description: 'List all projects the agent has access to on a Mandala Node.',
        parameters: {
          type: 'object',
          properties: {
            nodeUrl: { type: 'string', description: 'Mandala Node URL' },
          },
          required: ['nodeUrl'],
        },
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const client = new MandalaClient(ctx!.wallet);
          const result = await client.listProjects(params.nodeUrl as string);
          return json({ projects: result.projects, total: result.projects.length });
        },
      },
      { group: 'deploy' },
    );

    // =========================================================================
    // 3. agid_mandala_project_info
    // =========================================================================
    api.registerTool(
      {
        name: 'agid_mandala_project_info',
        description: 'Get detailed project info including status, balance, domains, and configuration.',
        parameters: {
          type: 'object',
          properties: {
            nodeUrl: { type: 'string', description: 'Mandala Node URL' },
            projectId: { type: 'string', description: 'Project ID' },
          },
          required: ['nodeUrl', 'projectId'],
        },
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const client = new MandalaClient(ctx!.wallet);
          const info = await client.getProjectInfo(params.nodeUrl as string, params.projectId as string);
          return json(info as unknown as Record<string, unknown>);
        },
      },
      { group: 'deploy' },
    );

    // =========================================================================
    // 4. agid_mandala_deploy
    // =========================================================================
    api.registerTool(
      {
        name: 'agid_mandala_deploy',
        description: 'Create a deployment slot for a project and get the artifact upload URL.',
        parameters: {
          type: 'object',
          properties: {
            nodeUrl: { type: 'string', description: 'Mandala Node URL' },
            projectId: { type: 'string', description: 'Project ID' },
          },
          required: ['nodeUrl', 'projectId'],
        },
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const client = new MandalaClient(ctx!.wallet);
          const result = await client.deploy(params.nodeUrl as string, params.projectId as string);
          return json({ action: 'deployed', url: result.url, deploymentId: result.deploymentId });
        },
      },
      { group: 'deploy' },
    );

    // =========================================================================
    // 5. agid_mandala_update_settings
    // =========================================================================
    api.registerTool(
      {
        name: 'agid_mandala_update_settings',
        description: 'Update project settings such as environment variables and engine configuration.',
        parameters: {
          type: 'object',
          properties: {
            nodeUrl: { type: 'string', description: 'Mandala Node URL' },
            projectId: { type: 'string', description: 'Project ID' },
            settings: {
              type: 'object',
              description: 'Settings object (e.g. { env: { KEY: "value" }, engine_config: { ... } })',
              additionalProperties: true,
            },
          },
          required: ['nodeUrl', 'projectId', 'settings'],
        },
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const client = new MandalaClient(ctx!.wallet);
          const result = await client.updateSettings(
            params.nodeUrl as string,
            params.projectId as string,
            params.settings as Record<string, unknown>,
          );
          return json({ action: 'settings_updated', ...result });
        },
      },
      { group: 'deploy' },
    );

    // =========================================================================
    // 6. agid_mandala_project_logs
    // =========================================================================
    api.registerTool(
      {
        name: 'agid_mandala_project_logs',
        description: 'View project logs or resource-specific logs (frontend, backend, mongo, mysql).',
        parameters: {
          type: 'object',
          properties: {
            nodeUrl: { type: 'string', description: 'Mandala Node URL' },
            projectId: { type: 'string', description: 'Project ID' },
            resource: { type: 'string', description: 'Resource name: "frontend", "backend", "mongo", "mysql". Omit for project-level logs.' },
            since: { type: 'string', description: 'ISO 8601 timestamp to fetch logs from (resource logs only)' },
            tail: { type: 'number', description: 'Number of recent log lines to return (resource logs only)' },
          },
          required: ['nodeUrl', 'projectId'],
        },
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const client = new MandalaClient(ctx!.wallet);
          const nodeUrl = params.nodeUrl as string;
          const projectId = params.projectId as string;
          const resource = params.resource as string | undefined;

          if (resource) {
            const result = await client.getResourceLogs(nodeUrl, projectId, resource, {
              since: params.since as string | undefined,
              tail: params.tail as number | undefined,
            });
            return json({ resource, logs: result.logs, metadata: result.metadata });
          }

          const result = await client.getProjectLogs(nodeUrl, projectId);
          return json({ logs: result.logs });
        },
      },
      { group: 'deploy' },
    );

    // =========================================================================
    // 7. agid_mandala_manage_admins
    // =========================================================================
    api.registerTool(
      {
        name: 'agid_mandala_manage_admins',
        description: 'Add, remove, or list project admins.',
        parameters: {
          type: 'object',
          properties: {
            nodeUrl: { type: 'string', description: 'Mandala Node URL' },
            projectId: { type: 'string', description: 'Project ID' },
            action: { type: 'string', description: '"add", "remove", or "list"' },
            identityKeyOrEmail: { type: 'string', description: 'Identity key or email of the admin (required for add/remove)' },
          },
          required: ['nodeUrl', 'projectId', 'action'],
        },
        requiresWallet: true,
        async execute(_id, params, ctx) {
          const client = new MandalaClient(ctx!.wallet);
          const nodeUrl = params.nodeUrl as string;
          const projectId = params.projectId as string;
          const action = params.action as string;

          if (action === 'add') {
            const id = params.identityKeyOrEmail as string;
            if (!id) return json({ error: 'identityKeyOrEmail is required for add' });
            const result = await client.addAdmin(nodeUrl, projectId, id);
            return json({ action: 'admin_added', ...result });
          }

          if (action === 'remove') {
            const id = params.identityKeyOrEmail as string;
            if (!id) return json({ error: 'identityKeyOrEmail is required for remove' });
            const result = await client.removeAdmin(nodeUrl, projectId, id);
            return json({ action: 'admin_removed', ...result });
          }

          const result = await client.listAdmins(nodeUrl, projectId);
          return json({ admins: result.admins, total: result.admins.length });
        },
      },
      { group: 'deploy' },
    );

    // =========================================================================
    // 8. agid_mandala_node_info
    // =========================================================================
    api.registerTool(
      {
        name: 'agid_mandala_node_info',
        description: 'Get public info from a Mandala Node (pricing, public keys, deployment domain).',
        parameters: {
          type: 'object',
          properties: {
            nodeUrl: { type: 'string', description: 'Mandala Node URL' },
          },
          required: ['nodeUrl'],
        },
        requiresWallet: false,
        async execute(_id, params, _ctx) {
          const client = new MandalaClient(null as any);
          const info = await client.getPublicInfo(params.nodeUrl as string);
          return json(info);
        },
      },
      { group: 'deploy' },
    );
  },
});
