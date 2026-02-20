/**
 * Mandala Client
 *
 * AuthFetch wrapper for Mandala Node (agidnode) API.
 * Mirrors X402Client pattern — constructor takes wallet, creates AuthFetch,
 * all methods take nodeUrl as first param so agent can target any node.
 */

import { AuthFetch } from '@bsv/sdk'
import type { BRC100Wallet } from '../../types/index.js'

// Response types (mirrored from mandala-cli)

export interface ProjectListing {
  id: string
  name: string
  balance: number
  created_at: string
  network: string
}

export interface ProjectInfo {
  id: string
  name: string
  network: string
  status: {
    online: boolean
    lastChecked: string
    domains: { frontend?: string; backend?: string; ssl: boolean }
    deploymentId: string | null
  }
  billing: { balance: number }
  sslEnabled: boolean
  customDomains: { frontend?: string; backend?: string }
  webUIConfig: unknown
  agent_config?: Record<string, string>
  engine_config?: unknown
}

export interface DeployInfo {
  deployment_uuid: string
  created_at: string
}

export interface AdminInfo {
  identity_key: string
  email: string
  added_at: string
}

export class MandalaClient {
  private authFetch: AuthFetch
  private registered = new Set<string>()

  constructor(wallet: BRC100Wallet) {
    this.authFetch = new AuthFetch(wallet.asWalletInterface())
  }

  private async ensureRegistered(nodeUrl: string): Promise<void> {
    const base = nodeUrl.replace(/\/$/, '')
    if (this.registered.has(base)) return
    await this.authFetch.fetch(`${base}/api/v1/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    this.registered.add(base)
  }

  private async post(nodeUrl: string, path: string, body: Record<string, unknown> = {}): Promise<any> {
    const base = nodeUrl.replace(/\/$/, '')
    await this.ensureRegistered(base)
    const response = await this.authFetch.fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return response.json()
  }

  // Project lifecycle

  async createProject(nodeUrl: string, name: string, network?: string): Promise<{ projectId: string }> {
    const body: Record<string, unknown> = { name }
    if (network) body.network = network
    return this.post(nodeUrl, '/api/v1/project/create', body)
  }

  async listProjects(nodeUrl: string): Promise<{ projects: ProjectListing[] }> {
    return this.post(nodeUrl, '/api/v1/project/list')
  }

  async getProjectInfo(nodeUrl: string, projectId: string): Promise<ProjectInfo> {
    return this.post(nodeUrl, `/api/v1/project/${projectId}/info`)
  }

  async deleteProject(nodeUrl: string, projectId: string): Promise<any> {
    return this.post(nodeUrl, `/api/v1/project/${projectId}/delete`)
  }

  // Deployment

  async deploy(nodeUrl: string, projectId: string): Promise<{ url: string; deploymentId: string }> {
    return this.post(nodeUrl, `/api/v1/project/${projectId}/deploy`)
  }

  async listDeploys(nodeUrl: string, projectId: string): Promise<{ deploys: DeployInfo[] }> {
    return this.post(nodeUrl, `/api/v1/project/${projectId}/deploys/list`)
  }

  // Configuration

  async updateSettings(nodeUrl: string, projectId: string, settings: Record<string, unknown>): Promise<any> {
    return this.post(nodeUrl, `/api/v1/project/${projectId}/settings/update`, settings)
  }

  // Logs

  async getProjectLogs(nodeUrl: string, projectId: string): Promise<{ logs: string }> {
    return this.post(nodeUrl, `/api/v1/project/${projectId}/logs/project`)
  }

  async getResourceLogs(
    nodeUrl: string,
    projectId: string,
    resource: string,
    opts?: { since?: string; tail?: number; level?: string }
  ): Promise<{ logs: string; metadata?: unknown }> {
    return this.post(nodeUrl, `/api/v1/project/${projectId}/logs/resource/${resource}`, opts ?? {})
  }

  // Admin management

  async addAdmin(nodeUrl: string, projectId: string, identityKeyOrEmail: string): Promise<any> {
    return this.post(nodeUrl, `/api/v1/project/${projectId}/addAdmin`, { identityKeyOrEmail })
  }

  async removeAdmin(nodeUrl: string, projectId: string, identityKeyOrEmail: string): Promise<any> {
    return this.post(nodeUrl, `/api/v1/project/${projectId}/removeAdmin`, { identityKeyOrEmail })
  }

  async listAdmins(nodeUrl: string, projectId: string): Promise<{ admins: AdminInfo[] }> {
    return this.post(nodeUrl, `/api/v1/project/${projectId}/admins/list`)
  }

  // Billing

  async topUp(nodeUrl: string, projectId: string, amount: number): Promise<any> {
    return this.post(nodeUrl, `/api/v1/project/${projectId}/pay`, { amount })
  }

  // Operations

  async restart(nodeUrl: string, projectId: string): Promise<any> {
    return this.post(nodeUrl, `/api/v1/project/${projectId}/admin/restart`)
  }

  // Public (unauthenticated)

  async getPublicInfo(nodeUrl: string): Promise<any> {
    const base = nodeUrl.replace(/\/$/, '')
    const response = await fetch(`${base}/api/v1/public`)
    if (!response.ok) {
      throw new Error(`Public info fetch failed: ${response.status} ${response.statusText}`)
    }
    return response.json()
  }
}
