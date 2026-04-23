// Cloudflare Worker entry. For now this is a walking skeleton — Step 4
// ships `/ping` only so the build + test pipeline is proven end-to-end.
// Step 5 adds the Durable Object + `/rooms`; Step 6 adds the WebSocket
// upgrade; later steps grow the protocol out.

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/ping') {
      return new Response('pong', { headers: { 'content-type': 'text/plain' } });
    }
    return new Response('Not Found', { status: 404 });
  },
};
