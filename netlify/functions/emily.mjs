// Emily, with this site's token attached.
//
//   /emily/testnet/deposit          ->  https://temp.sbtc-emily-dev.com/deposit
//   /emily/testnet/deposit/<txid>/0 ->  https://temp.sbtc-emily-dev.com/deposit/<txid>/0
//
// Emily is what tells the sBTC signers a deposit exists; a deposit nobody
// registers is swept by nobody. The instance this site talks to on testnet
// wants an auth token, and a token that shipped in the bundle would not be a
// token -- the bundle is a static file anyone can read. So it is attached here,
// the same way `hiro.mjs` attaches the Hiro key.
//
// `EMILY_API_TOKEN` is set in the Netlify UI (Site configuration -> Environment
// variables), never in the repo. Without it this still forwards, unauthenticated,
// which is what a fork or a preview should get: Emily's own answer, whatever it
// is, rather than a page that cannot say what went wrong.
//
// `EMILY_TOKEN_HEADER` overrides the header name for an instance that wants
// something other than `x-api-key`. One variable rather than a code change,
// because which of the two an Emily deployment wants is deployment
// configuration and not a fact about this site.
//
// JavaScript rather than TypeScript, for the reason `hiro.mjs` gives.

/** Only these, so a path cannot name an arbitrary host. */
const HOSTS = {
  testnet: "https://temp.sbtc-emily-dev.com",
  mainnet: "https://sbtc-emily.com",
};

// What the page actually calls: registering a deposit, and reading one back.
const ALLOWED = ["/deposit", "/limits", "/health"];

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
  const path = url.pathname.replace(`/emily/${network}`, "") || "/";
  if (!ALLOWED.some((prefix) => path.startsWith(prefix))) {
    return json(403, { error: `not a proxied path: ${path}` });
  }

  const headers = { accept: request.headers.get("accept") ?? "application/json" };
  const contentType = request.headers.get("content-type");
  if (contentType) headers["content-type"] = contentType;
  // The whole point.
  if (process.env.EMILY_API_TOKEN) {
    headers[process.env.EMILY_TOKEN_HEADER ?? "x-api-key"] = process.env.EMILY_API_TOKEN;
  }

  try {
    const response = await fetch(`${upstream}${path}${url.search}`, {
      method: request.method,
      headers,
      body: request.method === "POST" ? await request.text() : undefined,
    });

    // Emily's own answer, status and all: a 400 about a malformed deposit and a
    // 403 about a token are both things the page says out loud, and neither is
    // improved by this function having an opinion about it.
    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return json(502, { error: `Emily unreachable: ${String(error)}` });
  }
}

export const config = {
  path: "/emily/:network/*",
};
