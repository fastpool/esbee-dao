// The Hiro API, with this site's key attached.
//
//   /api/testnet/v2/info            ->  https://api.testnet.hiro.so/v2/info
//   /api/mainnet/v2/contracts/...   ->  https://api.hiro.so/v2/contracts/...
//
// Every read the page makes is anonymous otherwise, and anonymous means a rate
// limit shared with the whole internet: a visitor who opens the page twice can
// be told 429 by a node that is perfectly happy to answer. The key belongs to
// the deploy, not to the browser, so it cannot travel in the bundle -- which is
// what this function is for.
//
// `HIRO_API_KEY` is set in the Netlify UI (Site configuration -> Environment
// variables), never in the repo. Without it this still proxies, just anonymously,
// so a preview deploy or a fork is degraded rather than broken.
//
// JavaScript rather than TypeScript on purpose: `tsconfig.json` covers `src/`
// and the smoke test, and a function that needs `@netlify/functions` types
// would drag a dependency into a repo that otherwise has none at runtime.

/** Only these two, so a path cannot name an arbitrary host. */
const HOSTS = {
  testnet: "https://api.testnet.hiro.so",
  mainnet: "https://api.hiro.so",
};

// What the page actually calls. `/v2/` is the node's own API -- read-only calls,
// chain tip -- and `/extended/` is Hiro's index, which the sBTC balance uses.
const ALLOWED = ["/v2/", "/extended/"];

// The faucets are deliberately not proxied. They are rate-limited per IP, and
// behind a function every visitor shares one: the first request of the hour
// would spend the allowance for everybody. The page calls them directly from
// the browser, where the limit is the reader's own.
const DENIED = ["/extended/v1/faucets/"];

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export default async function proxy(request, context) {
  const network = context.params?.network;
  const upstream = HOSTS[network];
  if (!upstream) return json(404, { error: `unknown network: ${network}` });

  if (!["GET", "HEAD", "POST"].includes(request.method)) {
    return json(405, { error: `${request.method} is not proxied` });
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(`/api/${network}`, "") || "/";
  if (!ALLOWED.some((prefix) => path.startsWith(prefix))) {
    return json(403, { error: `not a proxied path: ${path}` });
  }
  if (DENIED.some((prefix) => path.startsWith(prefix))) {
    return json(403, { error: "the faucets are called directly, not through here" });
  }

  const headers = { accept: request.headers.get("accept") ?? "application/json" };
  const contentType = request.headers.get("content-type");
  if (contentType) headers["content-type"] = contentType;
  // The whole point. Absent, Hiro answers anonymously -- which is what a fork
  // or a preview without the variable set should get.
  if (process.env.HIRO_API_KEY) headers["x-hiro-api-key"] = process.env.HIRO_API_KEY;

  try {
    const response = await fetch(`${upstream}${path}${url.search}`, {
      method: request.method,
      headers,
      body: request.method === "POST" ? await request.text() : undefined,
    });

    // Pass the answer through as it came, minus anything about the upstream
    // connection. Notably the status: a 429 or a 404 from Hiro is the real
    // answer and the page's error handling already reads it.
    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ?? "application/json",
        // A read is only true for the block it was read in, and the page polls
        // on its own schedule.
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return json(502, { error: `upstream unreachable: ${String(error)}` });
  }
}

export const config = {
  path: "/api/:network/*",
};
