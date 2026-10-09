/**
 * A link to one public post on YouTube, X, Reddit, Instagram or Facebook, read strictly into the provider, the post's own id and the address of that platform's official
 * embed. Anything that is not exactly such a link (another site, a profile or a search page, a javascript: address, an id with a quote in it) is refused, so what is stored
 * and later put in a frame is built from checked parts and never from the pasted text.
 */
export type Provider = "youtube" | "x" | "reddit" | "instagram" | "facebook";
export const PROVIDERS: Provider[] = ["youtube", "x", "reddit", "instagram", "facebook"];
export const PROVIDER_NAME: Record<Provider, string> = { youtube: "YouTube", x: "X", reddit: "Reddit", instagram: "Instagram", facebook: "Facebook" };

/** The hosts whose frames a page may hold (the content security policy's frame-src is built from this list). */
export const EMBED_HOSTS: Record<Provider, string> = { youtube: "www.youtube-nocookie.com", x: "platform.twitter.com", reddit: "embed.reddit.com", instagram: "www.instagram.com", facebook: "www.facebook.com" };

export interface ParsedPost { provider: Provider; id: string; url: string; embed: string; account: string | null }

const host = (h: string, ...names: string[]) => names.some((n) => h === n || h === `www.${n}`);

export function parsePost(raw: string): ParsedPost | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password || (u.port && u.port !== "443" && u.port !== "80")) return null;
  const h = u.hostname.toLowerCase().replace(/^(m|mobile|old|np|mbasic)\./, ""), parts = u.pathname.split("/").filter(Boolean);

  // YouTube: watch?v=ID, youtu.be/ID, /shorts/ID, /live/ID, /embed/ID
  if (host(h, "youtube.com") || h === "youtu.be") {
    const id = h === "youtu.be" ? parts[0] : parts[0] === "watch" ? u.searchParams.get("v") : ["shorts", "live", "embed"].includes(parts[0]) ? parts[1] : undefined;
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
    return { provider: "youtube", id, url: `https://www.youtube.com/watch?v=${id}`, embed: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`, account: null };
  }
  // X: /handle/status/ID
  if (host(h, "x.com", "twitter.com")) {
    const [handle, word, id] = parts;
    if (!handle || word !== "status" || !/^[A-Za-z0-9_]{1,15}$/.test(handle) || !/^\d{1,20}$/.test(id ?? "")) return null;
    return { provider: "x", id, url: `https://x.com/${handle}/status/${id}`, embed: `https://platform.twitter.com/embed/Tweet.html?id=${id}&dnt=true&theme=dark`, account: handle };
  }
  // Reddit: /r/sub/comments/id/slug
  if (host(h, "reddit.com")) {
    const [r, sub, c, id, slug] = parts;
    if (r !== "r" || c !== "comments" || !/^[A-Za-z0-9_]{2,21}$/.test(sub ?? "") || !/^[a-z0-9]{5,8}$/.test(id ?? "")) return null;
    const s = /^[A-Za-z0-9_]{1,100}$/.test(slug ?? "") ? slug : "";
    return { provider: "reddit", id, url: `https://www.reddit.com/r/${sub}/comments/${id}/${s ? s + "/" : ""}`, embed: `https://embed.reddit.com/r/${sub}/comments/${id}/${s ? s + "/" : ""}?embed=true&theme=dark`, account: `r/${sub}` };
  }
  // Instagram: /p|reel|tv/CODE or /username/p|reel|tv/CODE
  if (host(h, "instagram.com")) {
    const i = parts.findIndex((p) => ["p", "reel", "reels", "tv"].includes(p));
    const kind = parts[i] === "reels" ? "reel" : parts[i], code = parts[i + 1];
    if (i < 0 || i > 1 || !/^[A-Za-z0-9_-]{5,20}$/.test(code ?? "")) return null;
    const user = i === 1 && /^[A-Za-z0-9_.]{1,30}$/.test(parts[0]) ? parts[0] : null;
    return { provider: "instagram", id: code, url: `https://www.instagram.com/${kind}/${code}/`, embed: `https://www.instagram.com/${kind}/${code}/embed/`, account: user };
  }
  // Facebook: /page/posts/ID, /page/videos/ID, /reel/ID, /watch/?v=ID, /permalink.php?story_fbid=ID&id=PAGE
  if (host(h, "facebook.com") || h === "fb.com") {
    let canonical: string | null = null, id: string | null = null, account: string | null = null, video = false;
    if (parts[0] === "permalink.php") { const s = u.searchParams.get("story_fbid"), p = u.searchParams.get("id"); if (/^[A-Za-z0-9]{5,40}$/.test(s ?? "") && /^\d{5,20}$/.test(p ?? "")) { canonical = `https://www.facebook.com/permalink.php?story_fbid=${s}&id=${p}`; id = s; account = p; } }
    else if (parts[0] === "watch") { const v = u.searchParams.get("v"); if (/^\d{5,20}$/.test(v ?? "")) { canonical = `https://www.facebook.com/watch/?v=${v}`; id = v; video = true; } }
    else if (parts[0] === "reel" && /^\d{5,20}$/.test(parts[1] ?? "")) { canonical = `https://www.facebook.com/reel/${parts[1]}`; id = parts[1]; video = true; }
    else if (/^[A-Za-z0-9.\-]{2,80}$/.test(parts[0] ?? "") && ["posts", "videos"].includes(parts[1] ?? "") && /^[A-Za-z0-9]{5,40}$/.test(parts[2] ?? "")) { canonical = `https://www.facebook.com/${parts[0]}/${parts[1]}/${parts[2]}`; id = parts[2]; account = parts[0]; video = parts[1] === "videos"; }
    if (!canonical || !id) return null;
    return { provider: "facebook", id, url: canonical, embed: `https://www.facebook.com/plugins/${video ? "video" : "post"}.php?href=${encodeURIComponent(canonical)}&show_text=true&width=500`, account };
  }
  return null;
}
