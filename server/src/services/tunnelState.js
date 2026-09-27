let registeredTunnelUrl = null;
let lastHeartbeat = 0;

function setRegisteredTunnel(url) {
  if (url && typeof url === 'string') {
    registeredTunnelUrl = url.replace(/\/+$/, '');
    lastHeartbeat = Date.now();
  }
}

function getRegisteredTunnel() {
  const isFresh = registeredTunnelUrl && (Date.now() - lastHeartbeat < 60 * 60 * 1000);
  return {
    url: registeredTunnelUrl,
    isFresh: Boolean(isFresh),
    lastHeartbeat
  };
}

module.exports = {
  setRegisteredTunnel,
  getRegisteredTunnel
};
