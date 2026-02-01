import { EventEmitter } from "events";
import log from "electron-log";

import playerStateStore, { PlayerState } from "../player-state-store";
import IIntegration from "./integration";

type EventListener = (...args: unknown[]) => void;
type PlayerStateListener = (state: PlayerState) => void;

type RegisteredListener =
  | {
      kind: "playerState";
      listener: PlayerStateListener;
    }
  | {
      kind: "eventEmitter";
      emitter: EventEmitter;
      event: string | symbol;
      listener: EventListener;
    };

/**
 * Base class for integrations that provides common functionality
 * like event listener management and safer state handling
 */
export default abstract class BaseIntegration implements IIntegration {
  protected isEnabled = false;
  private readonly registeredListeners = new Set<RegisteredListener>();

  /**
   * Register an event listener with automatic cleanup
   * @param emitter The EventEmitter to listen to
   * @param event The event name
   * @param listener The event listener
   */
  protected registerEventListener<T extends EventEmitter>(emitter: T, event: string | symbol, listener: EventListener): void {
    const wrappedListener: EventListener = (...args: unknown[]) => {
      try {
        listener(...args);
      } catch (error) {
        log.error(`Error in ${this.constructor.name} event listener for ${String(event)}:`, error);
      }
    };

    emitter.on(event, wrappedListener as unknown as Parameters<T["on"]>[1]);

    this.registeredListeners.add({
      kind: "eventEmitter",
      emitter,
      event,
      listener: wrappedListener
    });
  }

  /**
   * Register a player state listener with automatic cleanup
   * @param listener The player state listener
   */
  protected registerPlayerStateListener(listener: PlayerStateListener): void {
    const wrappedListener: PlayerStateListener = (state: PlayerState) => {
      try {
        listener(state);
      } catch (error) {
        log.error(`Error in ${this.constructor.name} player state listener:`, error);
      }
    };

    playerStateStore.addEventListener(wrappedListener);

    this.registeredListeners.add({
      kind: "playerState",
      listener: wrappedListener
    });
  }

  /**
   * Cleanup all registered event listeners
   */
  protected cleanupEventListeners(): void {
    for (const registration of this.registeredListeners) {
      if (registration.kind === "playerState") {
        playerStateStore.removeEventListener(registration.listener);
        continue;
      }

      registration.emitter.off(registration.event, registration.listener as unknown as Parameters<typeof registration.emitter.off>[1]);
    }

    this.registeredListeners.clear();
  }

  // IIntegration implementation - these should be overridden by child classes
  abstract provide(...args: unknown[]): void;

  abstract enable(): void;

  disable(): void {
    this.isEnabled = false;
    this.cleanupEventListeners();
  }

  getYTMScripts(): { name: string; script: string }[] {
    return [];
  }
}
