const os = require('node:os');

/** @param {{port?: number, host?: string, dataDir?: string, interfaces?: typeof os.networkInterfaces, createServer?: (options: object) => Promise<ReturnType<typeof import('../server/index.mjs').createRoomServer>>}} [options] */
function createLocalHost({
  port = Number(process.env.MEMEROOM_PORT || 3210),
  host = process.env.HOST || '0.0.0.0',
  dataDir,
  interfaces = os.networkInterfaces,
  createServer = async (options) => (await import('../server/index.mjs')).createRoomServer(options),
} = {}) {
  let server,
    starting,
    closed = false,
    hosting = false;
  function info() {
    return {
      hosting,
      server: `http://127.0.0.1:${port}`,
      addresses: Object.values(interfaces())
        .flat()
        .filter((item) => item && item.family === 'IPv4' && !item.internal)
        .map((item) => `http://${item.address}:${port}`),
    };
  }
  return {
    info,
    async ensure() {
      if (closed) throw new Error('Hébergement arrêté.');
      if (!starting)
        starting = (async () => {
          try {
            server = await createServer({ host, port, dataDir });
            let address;
            try {
              address = await server.start();
            } catch (error) {
              if (error.code !== 'EADDRINUSE') throw error;
              await server.stop();
              server = await createServer({ host, port: 0, dataDir });
              address = await server.start();
            }
            port = address.port;
            hosting = true;
            return info();
          } catch (error) {
            await server?.stop();
            server = null;
            starting = null;
            throw error;
          }
        })();
      return starting;
    },
    async stop() {
      closed = true;
      await starting?.catch(() => {});
      await server?.stop();
      hosting = false;
    },
  };
}
module.exports = { createLocalHost };
