import type {
  ClientState,
  MediaAsset,
  ReactionEnvelope,
  Settings,
  SubtitleCue,
} from './contracts.js';

export interface Preset {
  id: string;
  name: string;
  caption: string;
  duration: number;
  media: Omit<MediaAsset, 'id' | 'url'> | null;
  audio: Omit<MediaAsset, 'id' | 'url'> | null;
  subtitles: SubtitleCue[];
}
export interface HostingInfo {
  server: string;
  addresses: string[];
}
export interface NativeAPI {
  info(): Promise<
    HostingInfo & {
      settings: Settings;
      clientState: ClientState;
      platform: string;
      shortcutError?: string;
      displays: { id: string; label: string }[];
    }
  >;
  ensureHosting(): Promise<HostingInfo>;
  onHosting(callback: (value: HostingInfo) => void): void;
  preparePreview(id: string, asset: MediaAsset, server: string): Promise<string>;
  releasePreview(id: string): void;
  saveSettings(value: Settings): Promise<unknown>;
  recordShortcut(active: boolean): Promise<unknown>;
  saveDismissShortcut(value: string): Promise<Settings>;
  saveClient(value: ClientState): Promise<unknown>;
  listPresets(): Promise<Preset[]>;
  savePreset(value: { name: string; reaction: ReactionEnvelope }): Promise<unknown>;
  renamePreset(id: string, name: string): Promise<unknown>;
  removePreset(id: string): Promise<unknown>;
  loadPreset(
    id: string,
    server: string,
    token: string,
  ): Promise<
    Omit<Preset, 'media' | 'audio'> & { media: MediaAsset | null; audio: MediaAsset | null }
  >;
  show(value: ReactionEnvelope): Promise<unknown>;
  test(): Promise<{ shown: boolean }>;
  clear(): void;
  minimize(): Promise<unknown>;
  onSettings(callback: (value: Settings) => void): void;
  onError(callback: (value: string) => void): void;
}
export interface OverlayAPI {
  onShow(
    callback: (value: ReactionEnvelope & { playbackId: string; volume: number }) => void,
  ): void;
  onClear(callback: () => void): void;
  onVolume(callback: (value: number) => void): void;
  done(id: string): void;
  ready(id: string): void;
  progress(id: string): void;
  error(message: string, id: string): void;
}
declare global {
  interface Window {
    memeroom: NativeAPI;
    overlay: OverlayAPI;
  }
}
