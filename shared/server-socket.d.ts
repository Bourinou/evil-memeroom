import 'ws';
declare module 'ws' {
  interface WebSocket {
    alive: boolean;
    rate: { start: number; count: number };
    queue: Promise<void>;
    queued: number;
    member?: {
      id: string;
      token: string;
      code: string;
      name: string;
      owner: boolean;
      desktop: boolean;
      paused: boolean;
      ws: WebSocket;
    };
  }
}
