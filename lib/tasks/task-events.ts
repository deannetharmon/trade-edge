// lib/tasks/task-events.ts

import type {
  TradeEdgeTaskEvent,
  TradeEdgeTaskEventListener,
  TradeEdgeTaskEventType,
} from './task-types';

/**
 * Lightweight, dependency-free publish/subscribe bus for task lifecycle events.
 * No external event-emitter libraries are used.
 */
export class TaskEventBus {
  private listeners: Map<TradeEdgeTaskEventType, Set<TradeEdgeTaskEventListener>> = new Map();
  private wildcardListeners: Set<TradeEdgeTaskEventListener> = new Set();

  /**
   * Subscribe to a specific event type. Returns an unsubscribe function.
   */
  on(type: TradeEdgeTaskEventType, listener: TradeEdgeTaskEventListener): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
    return () => {
      this.listeners.get(type)?.delete(listener);
    };
  }

  /**
   * Subscribe to all task events regardless of type. Returns an unsubscribe function.
   */
  onAny(listener: TradeEdgeTaskEventListener): () => void {
    this.wildcardListeners.add(listener);
    return () => {
      this.wildcardListeners.delete(listener);
    };
  }

  /**
   * Emit an event to all matching listeners.
   */
  emit(event: TradeEdgeTaskEvent): void {
    this.listeners.get(event.type)?.forEach((listener) => listener(event));
    this.wildcardListeners.forEach((listener) => listener(event));
  }

  /**
   * Remove all listeners. Primarily useful for test teardown.
   */
  clear(): void {
    this.listeners.clear();
    this.wildcardListeners.clear();
  }
}

