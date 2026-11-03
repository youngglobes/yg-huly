//
// Copyright © 2023 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

/** The parts of a `ws` WebSocket the drain wait reads. */
export interface DrainSocket {
  bufferedAmount: number
  readyState: number
  OPEN: number
}

/**
 * Wait until the socket's send buffer drops to `limit` bytes, the socket stops being open, or
 * `isClosed()` says the connection is gone. Sleeps `pollMs` between checks.
 *
 * Upstream looped on `setImmediate` with no closed check: a socket that never drained (a slow or
 * dead browser) spun the transactor at 100% CPU and froze the portal (2026-11-03).
 */
export async function waitForDrain (
  ws: DrainSocket,
  limit: number,
  isClosed: () => boolean,
  pollMs: number = 10
): Promise<void> {
  while (ws.bufferedAmount > limit && ws.readyState === ws.OPEN && !isClosed()) {
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}
