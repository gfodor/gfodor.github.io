// Copyright 2026 Greg Fodor
// SPDX-License-Identifier: Apache-2.0

export interface VisemeFrame {
  viseme: number;
  timestamp: number;
  effectiveTimestamp: number;
  confidence: number;
  logit: number | null;
  speaking: boolean;
  levelDb: number;
  changed: boolean;
}

export interface LipSyncOptions {
  modelUrl?: string | URL;
  workerUrl?: string | URL;
  wasmBaseUrl?: string | URL;
  workerFactory?: (url: string | URL) => Worker;
  readyTimeoutMs?: number;
  silenceThresholdDb?: number;
  silenceHoldMs?: number;
  agreementFrames?: number;
  minimumVisemeFrames?: number;
}

export interface WebAudioLipSyncOptions extends LipSyncOptions {
  workletUrl?: string | URL;
  chunkSize?: number;
  conditionAudio?: boolean;
  sourceNode?: AudioNode;
}

export class PcmLipSyncer extends EventTarget {
  static create(options: LipSyncOptions & { inputSampleRate: number }): Promise<PcmLipSyncer>;
  readonly currentViseme: number;
  push(samples: Float32Array, timestamp?: number): void;
  attachAudioPort(port: MessagePort): void;
  setSpeaking(speaking: boolean | null): void;
  reset(): void;
  destroy(): void;
  addEventListener(type: "viseme", listener: (event: CustomEvent<VisemeFrame>) => void): void;
  addEventListener(type: "error", listener: (event: CustomEvent<Error>) => void): void;
}

export class WebAudioLipSyncer extends EventTarget {
  static create(audioContext: AudioContext, options?: WebAudioLipSyncOptions): Promise<WebAudioLipSyncer>;
  readonly currentViseme: number;
  connect(sourceNode: AudioNode): this;
  disconnect(): void;
  createPcmTap(): MessagePort;
  detachPcmTap(): void;
  setSpeaking(speaking: boolean | null): void;
  reset(): void;
  destroy(): void;
  addEventListener(type: "viseme", listener: (event: CustomEvent<VisemeFrame>) => void): void;
  addEventListener(type: "error", listener: (event: CustomEvent<Error>) => void): void;
}

export const MODEL_SAMPLE_RATE: number;
export const MODEL_WINDOW_SIZE: number;
export const MODEL_HOP_SIZE: number;
export const MODEL_LABEL_DELAY_FRAMES: number;
export const MODEL_LABEL_DELAY_SECONDS: number;
export const MODEL_FEATURE_COUNT: number;
export const MODEL_VISEME_COUNT: number;
export const MODEL_INFERENCE_STRIDE: number;
export const MODEL_HIDDEN_SIZE: number;
export const MODEL_HIDDEN_LAYERS: number;
export const MODEL_TARGET_LOOKAHEAD_SECONDS: number;
