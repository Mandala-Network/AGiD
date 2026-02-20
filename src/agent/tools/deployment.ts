/**
 * Deployment Tools
 *
 * Mandala Node infrastructure management — create projects, deploy services,
 * manage configs, view logs, and administer projects on the Mandala Network.
 */

import { MandalaClient } from '../../integrations/mandala/index.js'
import type { ToolDescriptor } from './types.js'
import { ok } from './types.js'

export function deploymentTools(): ToolDescriptor[] {
  return [
    {
      definition: {
        name: 'agid_mandala_create_project',
        description: 'Create a new project on a Mandala Node.',
        input_schema: {
          type: 'object',
          properties: {
            nodeUrl: { type: 'string', description: 'Mandala Node URL (e.g. https://cars.babbage.systems)' },
            name: { type: 'string', description: 'Project name' },
            network: { type: 'string', description: 'Network: "mainnet" or "testnet" (default: mainnet)' },
          },
          required: ['nodeUrl', 'name'],
        },
      },
      requiresWallet: true,
      execute: async (params, ctx) => {
        const client = new MandalaClient(ctx.wallet)
        const result = await client.createProject(
          params.nodeUrl as string,
          params.name as string,
          params.network as string | undefined,
        )
        return ok({ action: 'created', ...result })
      },
    },
    {
      definition: {
        name: 'agid_mandala_list_projects',
        description: 'List all projects the agent has access to on a Mandala Node.',
        input_schema: {
          type: 'object',
          properties: {
            nodeUrl: { type: 'string', description: 'Mandala Node URL' },
          },
          required: ['nodeUrl'],
        },
      },
      requiresWallet: true,
      execute: async (params, ctx) => {
        const client = new MandalaClient(ctx.wallet)
        const result = await client.listProjects(params.nodeUrl as string)
        return ok({ projects: result.projects, total: result.projects.length })
      },
    },
    {
      definition: {
        name: 'agid_mandala_project_info',
        description: 'Get detailed project info including status, balance, domains, and configuration.',
        input_schema: {
          type: 'object',
          properties: {
            nodeUrl: { type: 'string', description: 'Mandala Node URL' },
            projectId: { type: 'string', description: 'Project ID' },
          },
          required: ['nodeUrl', 'projectId'],
        },
      },
      requiresWallet: true,
      execute: async (params, ctx) => {
        const client = new MandalaClient(ctx.wallet)
        const info = await client.getProjectInfo(params.nodeUrl as string, params.projectId as string)
        return ok(info as unknown as Record<string, unknown>)
      },
    },
    {
      definition: {
        name: 'agid_mandala_deploy',
        description: 'Create a deployment slot for a project and get the artifact upload URL.',
        input_schema: {
          type: 'object',
          properties: {
            nodeUrl: { type: 'string', description: 'Mandala Node URL' },
            projectId: { type: 'string', description: 'Project ID' },
          },
          required: ['nodeUrl', 'projectId'],
        },
      },
      requiresWallet: true,
      execute: async (params, ctx) => {
        const client = new MandalaClient(ctx.wallet)
        const result = await client.deploy(params.nodeUrl as string, params.projectId as string)
        return ok({ action: 'deployed', url: result.url, deploymentId: result.deploymentId })
      },
    },
    {
      definition: {
        name: 'agid_mandala_update_settings',
        description: 'Update project settings such as environment variables and engine configuration.',
        input_schema: {
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
      },
      requiresWallet: true,
      execute: async (params, ctx) => {
        const client = new MandalaClient(ctx.wallet)
        const result = await client.updateSettings(
          params.nodeUrl as string,
          params.projectId as string,
          params.settings as Record<string, unknown>,
        )
        return ok({ action: 'settings_updated', ...result })
      },
    },
    {
      definition: {
        name: 'agid_mandala_project_logs',
        description: 'View project logs or resource-specific logs (frontend, backend, mongo, mysql).',
        input_schema: {
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
      },
      requiresWallet: true,
      execute: async (params, ctx) => {
        const client = new MandalaClient(ctx.wallet)
        const nodeUrl = params.nodeUrl as string
        const projectId = params.projectId as string
        const resource = params.resource as string | undefined

        if (resource) {
          const result = await client.getResourceLogs(nodeUrl, projectId, resource, {
            since: params.since as string | undefined,
            tail: params.tail as number | undefined,
          })
          return ok({ resource, logs: result.logs, metadata: result.metadata })
        }

        const result = await client.getProjectLogs(nodeUrl, projectId)
        return ok({ logs: result.logs })
      },
    },
    {
      definition: {
        name: 'agid_mandala_manage_admins',
        description: 'Add, remove, or list project admins.',
        input_schema: {
          type: 'object',
          properties: {
            nodeUrl: { type: 'string', description: 'Mandala Node URL' },
            projectId: { type: 'string', description: 'Project ID' },
            action: { type: 'string', description: '"add", "remove", or "list"' },
            identityKeyOrEmail: { type: 'string', description: 'Identity key or email of the admin (required for add/remove)' },
          },
          required: ['nodeUrl', 'projectId', 'action'],
        },
      },
      requiresWallet: true,
      execute: async (params, ctx) => {
        const client = new MandalaClient(ctx.wallet)
        const nodeUrl = params.nodeUrl as string
        const projectId = params.projectId as string
        const action = params.action as string

        if (action === 'add') {
          const id = params.identityKeyOrEmail as string
          if (!id) return ok({ error: 'identityKeyOrEmail is required for add' })
          const result = await client.addAdmin(nodeUrl, projectId, id)
          return ok({ action: 'admin_added', ...result })
        }

        if (action === 'remove') {
          const id = params.identityKeyOrEmail as string
          if (!id) return ok({ error: 'identityKeyOrEmail is required for remove' })
          const result = await client.removeAdmin(nodeUrl, projectId, id)
          return ok({ action: 'admin_removed', ...result })
        }

        const result = await client.listAdmins(nodeUrl, projectId)
        return ok({ admins: result.admins, total: result.admins.length })
      },
    },
    {
      definition: {
        name: 'agid_mandala_node_info',
        description: 'Get public info from a Mandala Node (pricing, public keys, deployment domain).',
        input_schema: {
          type: 'object',
          properties: {
            nodeUrl: { type: 'string', description: 'Mandala Node URL' },
          },
          required: ['nodeUrl'],
        },
      },
      requiresWallet: false,
      execute: async (params) => {
        const client = new MandalaClient(null as any)
        const info = await client.getPublicInfo(params.nodeUrl as string)
        return ok(info)
      },
    },
  ]
}
