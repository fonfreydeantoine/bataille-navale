import Ably from "ably";

export default async (req, context) => {
  const ably = new Ably.Rest(process.env.ABLY_API_KEY);
  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId") || "anonymous";

  const tokenRequest = await ably.auth.createTokenRequest({
    clientId,
    capability: { "*": ["publish", "subscribe", "presence"] },
  });

  return new Response(JSON.stringify(tokenRequest), {
    headers: { "Content-Type": "application/json" },
  });
};

export const config = { path: "/api/ably-token" };
