import { validateReaction } from '../shared/reactions.mjs';
import { downloadAsset } from '../desktop/media-files.cjs';
import { Connection } from '../desktop/renderer/connection.mjs';
import type { MediaAsset } from '../shared/contracts.js';

declare const media: MediaAsset;
declare const connection: Connection;
void downloadAsset(media, 'http://localhost:3210', '/tmp/media');
// @ts-expect-error A wire media size is numeric, never arbitrary JSON.
void downloadAsset({ ...media, bytes: '1024' }, 'http://localhost:3210', '/tmp/media');
// @ts-expect-error Reaction duration must remain numeric across the protocol boundary.
validateReaction({ caption: 'Test', duration: '5' }, new Map());
// @ts-expect-error The actual transport rejects a misspelled protocol operation at compile time.
void connection.request('broadcats', { caption: 'Test', duration: 5 });
// @ts-expect-error Native persistence accepts a client state, not just a nickname.
void window.memeroom.saveClient({ nickname: 'Test' });
