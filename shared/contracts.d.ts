/** Editor contracts; runtime validation is implemented in the adjacent .mjs modules. */
export interface MediaAsset {
  id: string;
  name: string;
  kind: 'image' | 'video' | 'audio';
  mime: string;
  url: string;
  bytes: number;
}
export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}
export interface ReactionInput {
  caption?: string;
  mediaId?: string | null;
  audioId?: string | null;
  duration: number;
  subtitles?: SubtitleCue[];
}
export interface ReactionEnvelope extends ReactionInput {
  id?: string;
  server: string;
  media?: MediaAsset | null;
  audio?: MediaAsset | null;
  sender?: { name: string };
  delay?: number;
}
export interface SavedRoom {
  code: string;
  name: string;
  server: 'local' | string;
  joinToken?: string;
  ownerToken?: string;
}
export interface ClientState {
  nickname: string;
  rooms: SavedRoom[];
  active: Pick<SavedRoom, 'code' | 'server'> | null;
  autoJoin: boolean;
}
export interface MediaLease {
  file: string;
  bytes: number;
  mime?: string;
  release(): void;
}
