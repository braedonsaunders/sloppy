import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SloppyEventEmitter } from '../services/event-emitter.js';
import type { SloppyEvent } from '../services/types.js';

describe('SloppyEventEmitter', () => {
  let emitter: SloppyEventEmitter;

  beforeEach(() => {
    emitter = new SloppyEventEmitter();
  });

  describe('subscribe/unsubscribe', () => {
    it('should subscribe to events', async () => {
      const handler = vi.fn();
      emitter.subscribe(handler);

      const event: SloppyEvent = {
        type: 'session:started',
        sessionId: 'test-session',
        timestamp: new Date(),
        config: {} as any,
      };

      await emitter.emit(event);
      expect(handler).toHaveBeenCalledWith(event);
    });

    it('should unsubscribe from events', async () => {
      const handler = vi.fn();
      const unsubscribe = emitter.subscribe(handler);
      unsubscribe();

      const event: SloppyEvent = {
        type: 'session:started',
        sessionId: 'test-session',
        timestamp: new Date(),
        config: {} as any,
      };

      await emitter.emit(event);
      expect(handler).not.toHaveBeenCalled();
    });

    it('should support multiple subscribers', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      emitter.subscribe(handler1);
      emitter.subscribe(handler2);

      const event: SloppyEvent = {
        type: 'session:started',
        sessionId: 'test-session',
        timestamp: new Date(),
        config: {} as any,
      };

      await emitter.emit(event);
      expect(handler1).toHaveBeenCalledWith(event);
      expect(handler2).toHaveBeenCalledWith(event);
    });
  });

  describe('subscribeToSession', () => {
    it('should only receive events for specific session', async () => {
      const handler = vi.fn();
      emitter.subscribeToSession('session-1', handler);

      const event1: SloppyEvent = {
        type: 'session:started',
        sessionId: 'session-1',
        timestamp: new Date(),
        config: {} as any,
      };

      const event2: SloppyEvent = {
        type: 'session:started',
        sessionId: 'session-2',
        timestamp: new Date(),
        config: {} as any,
      };

      await emitter.emit(event1);
      await emitter.emit(event2);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(event1);
    });
  });

  describe('subscribeToType', () => {
    it('should only receive events of specific type', async () => {
      const handler = vi.fn();
      emitter.subscribeToType('issue:resolved', handler);

      const resolvedEvent: SloppyEvent = {
        type: 'issue:resolved',
        sessionId: 'test-session',
        timestamp: new Date(),
        issue: {} as any,
        commitHash: 'abc123',
        duration: 1000,
      };

      const startedEvent: SloppyEvent = {
        type: 'session:started',
        sessionId: 'test-session',
        timestamp: new Date(),
        config: {} as any,
      };

      await emitter.emit(resolvedEvent);
      await emitter.emit(startedEvent);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(resolvedEvent);
    });
  });

  describe('emit', () => {
    it('should handle errors in subscribers gracefully', async () => {
      const errorHandler = vi.fn().mockRejectedValue(new Error('Handler error'));
      const successHandler = vi.fn();

      emitter.subscribe(errorHandler);
      emitter.subscribe(successHandler);

      const event: SloppyEvent = {
        type: 'session:started',
        sessionId: 'test-session',
        timestamp: new Date(),
        config: {} as any,
      };

      // Should not throw
      await emitter.emit(event);

      expect(errorHandler).toHaveBeenCalled();
      expect(successHandler).toHaveBeenCalled();
    });

    it('should record event in history', async () => {
      const event: SloppyEvent = {
        type: 'session:started',
        sessionId: 'test-session',
        timestamp: new Date(),
        config: {} as any,
      };

      await emitter.emit(event);

      const history = emitter.getHistory('test-session');
      expect(history).toContainEqual(event);
    });
  });

  describe('getHistory', () => {
    it('should return events for specific session', async () => {
      const event1: SloppyEvent = {
        type: 'session:started',
        sessionId: 'session-1',
        timestamp: new Date(),
        config: {} as any,
      };

      const event2: SloppyEvent = {
        type: 'session:started',
        sessionId: 'session-2',
        timestamp: new Date(),
        config: {} as any,
      };

      await emitter.emit(event1);
      await emitter.emit(event2);

      const history = emitter.getHistory('session-1');
      expect(history).toHaveLength(1);
      expect(history[0]).toEqual(event1);
    });

    it('should limit history size', async () => {
      for (let i = 0; i < 150; i++) {
        await emitter.emit({
          type: 'issue:progress',
          sessionId: 'test-session',
          timestamp: new Date(),
          issueId: `issue-${i}`,
          step: 'analyzing',
        });
      }

      const history = emitter.getHistory('test-session');
      expect(history.length).toBeLessThanOrEqual(100);
    });
  });

  describe('clearHistory', () => {
    it('should clear history for specific session', async () => {
      await emitter.emit({
        type: 'session:started',
        sessionId: 'session-1',
        timestamp: new Date(),
        config: {} as any,
      });

      await emitter.emit({
        type: 'session:started',
        sessionId: 'session-2',
        timestamp: new Date(),
        config: {} as any,
      });

      emitter.clearHistory('session-1');

      expect(emitter.getHistory('session-1')).toHaveLength(0);
      expect(emitter.getHistory('session-2')).toHaveLength(1);
    });
  });
});
