export default {
  async scheduled(event, env, ctx) {
    console.log("Starting Instagram Token Refresh...");

    // 1. Get current token from KV
    let currentToken = await env.ATELIER_STORE.get("INSTAGRAM_TOKEN");

    if (!currentToken) {
      console.log("No current token found in KV.");
      return;
    }

    // 2. Ask Instagram for a refresh
    // Documentation: https://developers.facebook.com/docs/instagram-basic-display-api/guides/long-lived-access-tokens/
    const url = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${currentToken}`;

    try {
      const response = await fetch(url);
      const data = await response.json();

      if (data.access_token) {
        // 3. Save the NEW token back to KV
        await env.ATELIER_STORE.put("INSTAGRAM_TOKEN", data.access_token);
        console.log("Token successfully refreshed and saved!");
      } else {
        console.error("Instagram Error:", JSON.stringify(data));
      }
    } catch (err) {
      console.error("Network/Script Error:", err);
    }
  }
};
