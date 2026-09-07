/** Minimal WebSocket stand-in: lets a test drive open/message/close by hand. */
export class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static reset() {
    MockWebSocket.instances = [];
  }
  static get last(): MockWebSocket | undefined {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
  }

  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  open() {
    this.onopen?.();
  }
  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
  /** Simulate the peer going away (not a local close). */
  drop() {
    this.onclose?.();
  }
  close() {
    this.closed = true;
  }
}
