import { invoke, isTauri } from '@tauri-apps/api/core';
import { getBase } from '../api';
import { getCallerToken, subscribeAuth } from '../auth/callerSession';
import type { Task } from '../generated/Task';
import type { Submission } from '../generated/Submission';
import type { Observation } from '../generated/Observation';
import type { AnswerSubmission } from '../generated/AnswerSubmission';
import type { RequestAsset } from '../generated/RequestAsset';
import type { StartMessage } from '../generated/StartMessage';
import type { StartSession } from '../generated/StartSession';
import type { StartSessionSummary } from '../generated/StartSessionSummary';
import type { AppendStartMessage } from '../generated/AppendStartMessage';
import type { PatchStartSession } from '../generated/PatchStartSession';
export type { Task, Submission, Observation, AnswerSubmission };
export type { StartMessage, StartSession, StartSessionSummary, AppendStartMessage, PatchStartSession };

let credential: { base: string; token: string } | null = null;
let credentialVersion = 0;
// A different caller (or logout) must never revive an earlier, more privileged
// browser-owner capability. Native apps can explicitly retrieve their own again.
const invalidateCredential = () => { credential = null; credentialVersion++; };
subscribeAuth(invalidateCredential);
if (typeof window !== 'undefined') window.addEventListener('jev-api-base-change', invalidateCredential);
export function setDecisionCredential(token: string) {
  credentialVersion++;
  credential = token.trim() ? { base: getBase(), token: token.trim() } : null;
  window.dispatchEvent(new Event('decision-credential-change'));
}
export class DecisionError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); }
}

async function token(base: string): Promise<string> {
  const caller = getCallerToken();
  if (caller) return caller;
  if (credential?.base === base) return credential.token;
  // Never send a native owner's capability to an externally configured gateway.
  const url = new URL(base || window.location.origin);
  if (isTauri() && ['127.0.0.1', 'localhost'].includes(url.hostname) && url.protocol === 'http:') {
    let native: string;
    try { native = await invoke<string>('decision_owner_token', { base: url.origin }); }
    catch { throw new DecisionError('decision_native_identity_unavailable', 503, 'The native identity bridge is unavailable. Start this candidate’s owned gateway and restore its matching owner key if needed.'); }
    credential = { base, token: native };
    return native;
  }
  throw new DecisionError('decision_auth_required', 401, 'Open the native app, or enter a managed caller token.');
}

async function authorizedFetch(path: string, init: RequestInit): Promise<Response> {
  const base = getBase();
  const version = credentialVersion;
  const caller = getCallerToken();
  const secret = await token(base);
  if (getBase() !== base || version !== credentialVersion || caller !== getCallerToken()) throw new DOMException('Gateway or identity changed before dispatch', 'AbortError');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${secret}`);
  const response = await fetch(`${base}${path}`, { ...init, cache: 'no-store', headers });
  if (getBase() !== base || version !== credentialVersion || caller !== getCallerToken()) throw new DOMException('Gateway or identity changed while awaiting the result', 'AbortError');
  return response;
}

async function responseError(response: Response): Promise<DecisionError> {
  let data: { code?: string; error?: string } = {};
  try { data = await response.json() as typeof data; } catch { /* Keep the status as the diagnostic. */ }
  return new DecisionError(data.code ?? 'decision_request_failed', response.status, data.error ?? `HTTP ${response.status}`);
}

export async function decisionRequest<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', signal?: AbortSignal): Promise<T> {
  const response = await authorizedFetch(`/v1/systorch${path}`, {
    method, signal,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  if (!response.ok) throw await responseError(response);
  const data = await response.json();
  return data as T;
}

export interface AssetReceipt { asset_id: string; mime_type: string; size_bytes: number; expires_at: number }

export async function uploadDecisionAsset(file: File, signal?: AbortSignal): Promise<AssetReceipt> {
  const response = await authorizedFetch('/v1/systorch/assets', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!response.ok) throw await responseError(response);
  return await response.json() as AssetReceipt;
}

export async function fetchTaskAsset(taskId: string, assetId: string, signal?: AbortSignal): Promise<Blob> {
  const path = `/v1/systorch/decisions/${encodeURIComponent(taskId)}/assets/${encodeURIComponent(assetId)}`;
  const response = await authorizedFetch(path, { method: 'GET', signal });
  if (!response.ok) throw await responseError(response);
  return response.blob();
}

export async function fetchStartSessionAsset(sessionId: string, assetId: string, signal?: AbortSignal): Promise<Blob> {
  const path = `/v1/systorch/sessions/${encodeURIComponent(sessionId)}/assets/${encodeURIComponent(assetId)}`;
  const response = await authorizedFetch(path, { method: 'GET', signal });
  if (!response.ok) throw await responseError(response);
  return response.blob();
}

export async function deleteDecisionAsset(assetId: string): Promise<void> {
  const response = await authorizedFetch(`/v1/systorch/assets/${encodeURIComponent(assetId)}`, { method: 'DELETE' });
  if (response.status === 204 || response.status === 409) return;
  if (!response.ok) throw await responseError(response);
}

export type { RequestAsset };

export const submitDecision = (body: Submission) => decisionRequest<Task>('/decisions', body);
export const answerDecision = (task: Task, answer: Omit<AnswerSubmission, 'revision'>) => decisionRequest<Task>(`/decisions/${encodeURIComponent(task.id)}/answers`, { revision: task.revision, ...answer });

export const listStartSessions = (offset = 0, archived = false, signal?: AbortSignal) => decisionRequest<StartSessionSummary[]>(`/sessions?offset=${Math.max(0, Math.trunc(offset))}&archived=${archived}`, undefined, 'GET', signal);
export const readStartSession = (id: string, signal?: AbortSignal) => decisionRequest<StartSession>(`/sessions/${encodeURIComponent(id)}`, undefined, 'GET', signal);
export const appendStartSessionMessage = (id: string, body: AppendStartMessage, signal?: AbortSignal) => decisionRequest<StartSession>(`/sessions/${encodeURIComponent(id)}/messages`, body, 'POST', signal);
export const patchStartSession = (id: string, body: PatchStartSession) => decisionRequest<StartSession>(`/sessions/${encodeURIComponent(id)}`, body, 'PATCH');
export const deleteStartSession = (id: string) => decisionRequest<void>(`/sessions/${encodeURIComponent(id)}`, undefined, 'DELETE');
