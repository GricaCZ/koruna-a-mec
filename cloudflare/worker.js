import * as netlifyGame from "../netlify/functions/game.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Herní API
    if (url.pathname === "/.netlify/functions/game") {
      const headers = Object.fromEntries(request.headers);

      // Zachováme IP pro náš jednoduchý rate limit
      headers["x-nf-client-connection-ip"] =
        request.headers.get("cf-connecting-ip") ||
        request.headers.get("x-forwarded-for") ||
        "unknown";

      const event = {
        httpMethod: request.method,
        headers,
        body:
          request.method === "GET" || request.method === "HEAD"
            ? ""
            : await request.text()
      };

      const handler =
        netlifyGame.handler ||
        netlifyGame.default?.handler;

      if (!handler) {
        return new Response(
          JSON.stringify({
            error: "Herní funkce nebyla nalezena."
          }),
          {
            status: 500,
            headers: {
              "Content-Type": "application/json; charset=utf-8"
            }
          }
        );
      }

      const result = await handler(event);

      return new Response(result.body || "", {
        status: result.statusCode || 200,
        headers: result.headers || {
          "Content-Type": "application/json; charset=utf-8"
        }
      });
    }

    // index.html, hudba a ostatní statické soubory
    return env.ASSETS.fetch(request);
  }
};
