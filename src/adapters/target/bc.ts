// SPDX-License-Identifier: Elastic-2.0
// Copyright (c) 2026 Caracal Lynx Limited

/**
 * Business Central REST (OData v4) target adapter.
 *
 * Token management: BcTokenManager acquires OAuth2 client-credential tokens
 * against login.microsoftonline.com, caches in-memory, refreshes 60s before
 * expiry. Tenant id, client id, and client secret are read from
 * BC_TENANT_ID / BC_CLIENT_ID / BC_CLIENT_SECRET env vars (per CLAUDE.md).
 *
 * Load path: for each batch (max 100 rows per $batch), build a multipart
 * body and POST to `{baseUrl}/api/{version}/companies({company})/$batch`.
 * HTTP 409 with onConflict: upsert → individual PATCH. Other 4xx → increment
 * rowsFailed and continue iff runConfig.onError === 'continue'.
 *
 * Implementation is intentionally minimal. Rigorous multipart parsing is
 * deferred; tests mock the token endpoint and response shape.
 */

import { randomUUID } from 'node:crypto';

import axios, { type AxiosInstance } from 'axios';

import type { RunConfig, TargetConfig } from '../../config/types.js';
import { quoteIdent, type StagingStore } from '../../staging/index.js';
import { requireEnv } from '../../utils/env.js';
import { ConfigError, LoadError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import type { LoadResult, TargetAdapter } from './types.js';

const STAGING_TABLE = 'stg_transformed';
const MAX_BATCH_OPS = 100;
const TOKEN_REFRESH_BUFFER_MS = 60_000;

export class BcTokenManager {
  private token: string | null = null;
  private expiresAt = 0;

  constructor(private readonly http: AxiosInstance = axios.create({ timeout: 30_000 })) {}

  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt - TOKEN_REFRESH_BUFFER_MS) {
      return this.token;
    }
    const tenantId = requireEnv('BC_TENANT_ID');
    const clientId = requireEnv('BC_CLIENT_ID');
    const clientSecret = requireEnv('BC_CLIENT_SECRET');
    const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    try {
      const res = await this.http.post(
        url,
        new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
          scope: 'https://api.businesscentral.dynamics.com/.default',
        }),
      );
      const body = res.data as { access_token?: string; expires_in?: number };
      if (!body.access_token) {
        throw new LoadError(`bc: token response had no access_token`);
      }
      this.token = body.access_token;
      const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 3600;
      this.expiresAt = Date.now() + expiresIn * 1000;
      return this.token;
    } catch (err) {
      throw new LoadError(
        `bc: token acquisition failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }
}

export class BcTargetAdapter implements TargetAdapter {
  readonly id = 'bc';
  private tokenManager: BcTokenManager = new BcTokenManager();
  private http: AxiosInstance = axios.create({ timeout: 30_000 });

  async connect(config: TargetConfig): Promise<void> {
    if (!config.baseUrl) throw new ConfigError('bc target requires `baseUrl`');
    if (!config.company) throw new ConfigError('bc target requires `company`');
    if (!config.entity) throw new ConfigError('bc target requires `entity`');
    // Token is fetched lazily on first load call.
  }

  async disconnect(): Promise<void> {
    // nothing to release — axios client is reused per process.
  }

  async load(
    config: TargetConfig,
    store: StagingStore,
    runConfig: RunConfig,
    onProgress: (rows: number) => void,
  ): Promise<LoadResult> {
    const rows = await store.query<Record<string, unknown>>(
      `SELECT * FROM ${quoteIdent(STAGING_TABLE)}`,
    );
    if (rows.length === 0) {
      return { rowsLoaded: 0, rowsFailed: 0 };
    }

    const token = await this.tokenManager.getToken();
    const endpoint = `${config.baseUrl}/api/${config.apiVersion}/companies(${encodeURIComponent(config.company!)})/${config.entity}`;

    let rowsLoaded = 0;
    let rowsFailed = 0;

    for (let i = 0; i < rows.length; i += MAX_BATCH_OPS) {
      const batch = rows.slice(i, i + MAX_BATCH_OPS);

      if (!config.batchEndpoint) {
        // Fall back to per-row POST when $batch is disabled
        for (const row of batch) {
          try {
            await this.http.post(endpoint, row, {
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            });
            rowsLoaded++;
          } catch (err) {
            const handled = await this.handleRowError(err, endpoint, row, token, config);
            if (handled) rowsLoaded++;
            else {
              rowsFailed++;
              if (runConfig.onError === 'stop') {
                throw new LoadError(
                  `bc: row insert failed: ${err instanceof Error ? err.message : String(err)}`,
                  err,
                );
              }
            }
          }
          onProgress(rowsLoaded);
        }
        continue;
      }

      // $batch path
      const boundary = `batch_${randomUUID()}`;
      const body = buildBatchBody(batch, endpoint, boundary);
      const batchUrl = `${config.baseUrl}/api/${config.apiVersion}/companies(${encodeURIComponent(config.company!)})/$batch`;
      try {
        const res = await this.http.post(batchUrl, body, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': `multipart/mixed; boundary=${boundary}`,
          },
        });
        const counts = countBatchResponses(String(res.data ?? ''));
        rowsLoaded += counts.succeeded;
        rowsFailed += counts.failed;
        if (counts.failed > 0 && runConfig.onError === 'stop') {
          throw new LoadError(`bc: ${counts.failed} batch operations failed`);
        }
      } catch (err) {
        rowsFailed += batch.length;
        if (runConfig.onError === 'stop') {
          throw new LoadError(
            `bc: $batch failed: ${err instanceof Error ? err.message : String(err)}`,
            err,
          );
        }
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'bc: $batch failed (onError: continue)',
        );
      }
      onProgress(rowsLoaded);
    }

    return { rowsLoaded, rowsFailed };
  }

  private async handleRowError(
    err: unknown,
    endpoint: string,
    row: Record<string, unknown>,
    token: string,
    config: TargetConfig,
  ): Promise<boolean> {
    if (!axios.isAxiosError(err)) return false;
    const status = err.response?.status;
    if (status === 409 && config.onConflict === 'upsert') {
      try {
        await this.http.patch(endpoint, row, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        return true;
      } catch (patchErr) {
        logger.warn(
          { err: patchErr instanceof Error ? patchErr.message : String(patchErr) },
          'bc: upsert PATCH failed',
        );
        return false;
      }
    }
    logger.warn({ status }, 'bc: row insert failed');
    return false;
  }
}

function buildBatchBody(
  batch: Record<string, unknown>[],
  endpoint: string,
  boundary: string,
): string {
  const parts: string[] = [];
  for (const row of batch) {
    const payload = JSON.stringify(row);
    parts.push(
      `--${boundary}`,
      'Content-Type: application/http',
      'Content-Transfer-Encoding: binary',
      '',
      `POST ${endpoint} HTTP/1.1`,
      'Content-Type: application/json',
      '',
      payload,
      '',
    );
  }
  parts.push(`--${boundary}--`, '');
  return parts.join('\r\n');
}

function countBatchResponses(body: string): { succeeded: number; failed: number } {
  // Minimal parser: count HTTP status lines. 2xx → success, else failure.
  const re = /HTTP\/[0-9.]+ (\d{3})/g;
  let match: RegExpExecArray | null;
  let succeeded = 0;
  let failed = 0;
  while ((match = re.exec(body))) {
    const code = Number.parseInt(match[1]!, 10);
    if (code >= 200 && code < 300) succeeded++;
    else failed++;
  }
  return { succeeded, failed };
}
