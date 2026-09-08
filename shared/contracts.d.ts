/** Checked by `npm run check:types`; runtime validation remains in the .mjs modules. */
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
  sender?: { name: string } | string;
  delay?: number;
}
export interface Settings {
  paused: boolean;
  volume: number;
  size: number;
  cooldown: number;
  position: string;
  display: string;
  dismissShortcut: string;
}
export interface RoomTarget extends SavedRoom {
  isPrivate?: boolean;
  password?: string;
}
export interface RoomAccess {
  canManage: boolean;
  isPrivate: boolean;
  unclaimed?: boolean;
  passwordRequired: boolean;
}
export interface JoinedRoom {
  code: string;
  name: string;
  token: string;
  joinToken?: string;
  ownerToken?: string;
  persistent: boolean;
  members: { id: string; name: string; desktop: boolean; paused: boolean }[];
  media: MediaAsset[];
  access: RoomAccess;
}
export interface RoomRequests {
  ping: Record<string, never>;
  create: {
    name: string;
    roomName?: string;
    desktop?: boolean;
    paused?: boolean;
    isPrivate?: boolean;
    password?: string;
  };
  join: {
    name: string;
    code: string;
    desktop?: boolean;
    paused?: boolean;
    password?: string;
    joinToken?: string;
    ownerToken?: string;
  };
  status: { paused: boolean };
  broadcast: ReactionInput;
  'room-settings': { isPrivate: boolean; passwordAction: string; password: string };
}
export interface RoomReplies {
  ping: Record<string, never>;
  create: JoinedRoom;
  join: JoinedRoom;
  status: Record<string, never>;
  broadcast: Record<string, never>;
  'room-settings': { access: RoomAccess; joinToken: string; ownerToken?: string };
}
export type RoomEvent =
  | { type: 'room-deleted' | 'access-changed' }
  | { type: 'members'; members: JoinedRoom['members'] }
  | { type: 'library'; media: MediaAsset[] }
  | { type: 'room-access'; access: RoomAccess }
  | (ReactionEnvelope & { type: 'reaction'; startAt: number; sender: { name: string } });
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
