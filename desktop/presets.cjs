const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { downloadAsset, uploadAsset } = require('./media-files.cjs');
const validID = (value) => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);

class Presets {
  constructor(directory, protocol) {
    this.directory = directory;
    this.protocol = protocol;
    this.busy = false;
  }
  folder(id) {
    if (!validID(id)) throw new Error('Message enregistré invalide.');
    return path.join(this.directory, id);
  }
  async list() {
    await fs.mkdir(this.directory, { recursive: true });
    const values = [];
    for (const id of await fs.readdir(this.directory)) {
      if (!validID(id)) continue;
      try {
        values.push(await this.read(id));
      } catch {
        /* Incomplete saves are not listed. */
      }
    }
    return values.sort((a, b) => b.createdAt - a.createdAt);
  }
  async read(id) {
    const value = JSON.parse(await fs.readFile(path.join(this.folder(id), 'message.json'), 'utf8'));
    return {
      id,
      name: this.protocol.cleanText(value.name, 60),
      caption: this.protocol.cleanText(value.caption, 500),
      duration: Number(value.duration),
      subtitles: this.protocol.validCues(value.subtitles),
      createdAt: Number(value.createdAt),
      media: value.media,
      audio: value.audio,
    };
  }
  async mutate(action) {
    if (this.busy) throw new Error('Un enregistrement est en cours.');
    this.busy = true;
    try {
      return await action();
    } finally {
      this.busy = false;
    }
  }
  async save(input) {
    return this.mutate(async () => {
      const name = this.protocol.cleanText(input?.name, 60);
      if (!name) throw new Error('Donnez un nom au message.');
      const source = input.reaction;
      const media = new Map(
        [source?.media, source?.audio].filter(Boolean).map((asset) => [asset.id, asset]),
      );
      const reaction = this.protocol.validateReaction(
        { ...source, mediaId: source?.media?.id, audioId: source?.audio?.id },
        media,
      );
      const id = randomUUID(),
        folder = this.folder(id);
      await fs.mkdir(folder, { recursive: true });
      try {
        const value = {
          id,
          name,
          caption: reaction.caption,
          duration: reaction.duration,
          subtitles: reaction.subtitles,
          createdAt: Date.now(),
          media: null,
          audio: null,
        };
        for (const key of ['media', 'audio'])
          if (reaction[key])
            value[key] = await downloadAsset(
              reaction[key],
              this.protocol.normalizeServer(source.server),
              path.join(folder, key),
            );
        await fs.writeFile(path.join(folder, 'message.json'), JSON.stringify(value), {
          mode: 0o600,
        });
        return value;
      } catch (error) {
        await fs.rm(folder, { recursive: true, force: true });
        throw error;
      }
    });
  }
  async rename(id, name) {
    return this.mutate(async () => {
      const value = await this.read(id);
      value.name = this.protocol.cleanText(name, 60);
      if (!value.name) throw new Error('Donnez un nom au message.');
      const file = path.join(this.folder(id), 'message.json');
      await fs.writeFile(file + '.tmp', JSON.stringify(value), { mode: 0o600 });
      await fs.rename(file + '.tmp', file);
      return value;
    });
  }
  async remove(id) {
    return this.mutate(() => fs.rm(this.folder(id), { recursive: true, force: true }));
  }
  async load(id, server, token) {
    return this.mutate(async () => {
      const value = await this.read(id),
        result = { ...value, media: null, audio: null };
      for (const key of ['media', 'audio'])
        if (value[key])
          result[key] = await uploadAsset(
            path.join(this.folder(id), key),
            value[key],
            this.protocol.normalizeServer(server),
            token,
          );
      return result;
    });
  }
}
module.exports = { Presets };
