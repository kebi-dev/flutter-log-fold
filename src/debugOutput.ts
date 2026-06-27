export interface DebugOutputMessage {
  type?: unknown;
  event?: unknown;
  body?: {
    output?: unknown;
  };
}

export function getDebugOutputText(message: DebugOutputMessage): string | null {
  if (message.type !== 'event' || message.event !== 'output') {
    return null;
  }

  const output = message.body?.output;
  return typeof output === 'string' && output.length > 0 ? output : null;
}
