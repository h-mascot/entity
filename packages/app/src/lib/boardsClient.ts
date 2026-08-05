/**
 * Customizable boards API client — thin fetch wrappers over `/api/boards`.
 * Pure request/response transport; the reducer/adapter logic lives in boardsState.ts.
 */

import { buildApiCandidates, requestJsonWithFallback } from './http';
import {
  parseBoardSummary,
  parseBoardsListResponse,
  type BoardFilterConfig,
  type BoardSummary,
  type BoardTemplate,
  type BoardView,
} from './boardsState';

async function requestBoard(
  path: string,
  init: RequestInit,
  fallbackError: string,
): Promise<BoardSummary> {
  const payload = await requestJsonWithFallback<unknown>({
    urls: buildApiCandidates(path),
    init,
    continueOnStatuses: [],
    fallbackError,
  });
  const board = parseBoardSummary(payload);
  if (!board) throw new Error('Invalid board response');
  return board;
}

export async function fetchBoards(): Promise<BoardSummary[]> {
  const payload = await requestJsonWithFallback<unknown>({
    urls: buildApiCandidates('/api/boards'),
    continueOnStatuses: [],
    fallbackError: 'Unable to load boards.',
  });
  return parseBoardsListResponse(payload);
}

export interface CreateBoardRequest {
  name: string;
  template?: BoardTemplate;
  view?: BoardView;
  filter_config?: BoardFilterConfig;
}

export async function createBoard(input: CreateBoardRequest): Promise<BoardSummary> {
  return requestBoard(
    '/api/boards',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
    'Unable to create board.',
  );
}

export interface UpdateBoardRequest {
  name?: string;
  view?: BoardView;
  filter_config?: BoardFilterConfig;
}

export async function updateBoard(
  id: number,
  updates: UpdateBoardRequest,
): Promise<BoardSummary> {
  return requestBoard(
    `/api/boards/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    },
    'Unable to update board.',
  );
}

export async function reorderBoards(ids: readonly number[]): Promise<BoardSummary[]> {
  const payload = await requestJsonWithFallback<unknown>({
    urls: buildApiCandidates('/api/boards/reorder'),
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    },
    continueOnStatuses: [],
    fallbackError: 'Unable to reorder boards.',
  });
  return parseBoardsListResponse(payload);
}

export async function deleteBoard(id: number): Promise<void> {
  await requestJsonWithFallback<unknown>({
    urls: buildApiCandidates(`/api/boards/${encodeURIComponent(id)}`),
    init: { method: 'DELETE' },
    continueOnStatuses: [],
    fallbackError: 'Unable to delete board.',
  });
}
