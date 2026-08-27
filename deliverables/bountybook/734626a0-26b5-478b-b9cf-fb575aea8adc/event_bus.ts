export class EventBus<T extends Record<string, unknown[]>> {
  private readonly handlers = new Map<
    keyof T,
    Set<(...args: unknown[]) => void>
  >();

  on<K extends keyof T>(event: K, handler: (...args: T[K]) => void): void {
    let eventHandlers = this.handlers.get(event);
    if (!eventHandlers) {
      eventHandlers = new Set();
      this.handlers.set(event, eventHandlers);
    }
    eventHandlers.add(handler as unknown as (...args: unknown[]) => void);
  }

  off<K extends keyof T>(event: K, handler: (...args: T[K]) => void): void {
    const eventHandlers = this.handlers.get(event);
    if (!eventHandlers) return;

    eventHandlers.delete(handler as unknown as (...args: unknown[]) => void);
    if (eventHandlers.size === 0) {
      this.handlers.delete(event);
    }
  }

  emit<K extends keyof T>(event: K, ...args: T[K]): void {
    const eventHandlers = this.handlers.get(event);
    if (!eventHandlers) return;

    for (const handler of [...eventHandlers]) {
      (handler as unknown as (...values: T[K]) => void)(...args);
    }
  }
}
