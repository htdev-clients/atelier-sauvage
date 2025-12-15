export async function onRequest(context) {
    const token = context.env.INSTAGRAM_TOKEN; // This pulls from Cloudflare settings
    
    if (!token) {
        return new Response(JSON.stringify({ error: "Token not configured" }), { status: 500 });
    }

    const userFields = "username,profile_picture_url";
    const mediaFields = "id,media_type,media_url,permalink,thumbnail_url,caption,like_count,timestamp,children{media_url,thumbnail_url,media_type}";

    try {
        // Fetch data from Instagram from the server side
        const [userRes, mediaRes] = await Promise.all([
            fetch(`https://graph.instagram.com/me?fields=${userFields}&access_token=${token}`),
            fetch(`https://graph.instagram.com/me/media?fields=${mediaFields}&limit=1&access_token=${token}`)
        ]);

        const userData = await userRes.json();
        const mediaData = await mediaRes.json();

        if (userData.error || mediaData.error) {
            throw new Error("Instagram API Error");
        }

        // Return the combined data to your frontend
        return new Response(JSON.stringify({ 
            user: userData, 
            post: mediaData.data.length > 0 ? mediaData.data[0] : null 
        }), {
            headers: { 
                "content-type": "application/json",
                // Cache the result for 15 minutes to save API quota and load faster
                "Cache-Control": "public, max-age=900" 
            }
        });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}