// functions/instagram.js

export async function onRequest(context) {
    // const token = context.env.INSTAGRAM_TOKEN;
    let token = await context.env.ATELIER_STORE.get("INSTAGRAM_TOKEN");

    if (!token) {
        return new Response(JSON.stringify({ error: "Token not configured" }), { status: 500 });
    }

    // Basic Display API supported fields only
    const userFields = "username,id"; 
    // Removed 'like_count' to prevent API errors with Basic tokens
    const mediaFields = "id,media_type,media_url,permalink,thumbnail_url,caption,timestamp,children{media_url,thumbnail_url,media_type}";

    try {
        const [userRes, mediaRes] = await Promise.all([
            fetch(`https://graph.instagram.com/me?fields=${userFields}&access_token=${token}`),
            fetch(`https://graph.instagram.com/me/media?fields=${mediaFields}&limit=1&access_token=${token}`)
        ]);

        if (!userRes.ok || !mediaRes.ok) {
            // Log error details for debugging if needed
            throw new Error(`Instagram API Error: User ${userRes.status}, Media ${mediaRes.status}`);
        }

        const userData = await userRes.json();
        const mediaData = await mediaRes.json();

        return new Response(JSON.stringify({ 
            user: userData, 
            post: mediaData.data && mediaData.data.length > 0 ? mediaData.data[0] : null 
        }), {
            headers: { 
                "content-type": "application/json",
                // Cache for 15 minutes
                "Cache-Control": "public, max-age=900" 
            }
        });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}