import type { ActionResult, HostLobby, TransitionSchema } from '@localmenti/shared';
import type { z } from 'zod';

type Action = z.infer<typeof TransitionSchema>['action'];
/** Host Next may close then reveal, always using the acknowledged revision. */
export async function advanceHost(session: HostLobby, action: Action, send: (command: z.infer<typeof TransitionSchema>) => Promise<ActionResult<HostLobby>>) {
  let current = session;
  if (action === 'reveal' && current.state === 'QUESTION_OPEN' && current.question?.phase === 'ANSWERING' && !current.question.closed) {
    const closed = await send({ sessionId:current.id,expectedRevision:current.revision,action:'close' });
    if (!closed.ok) return closed;
    current = closed.data;
  }
  return send({ sessionId:current.id,expectedRevision:current.revision,action });
}
