import { SocialPosts } from "./SocialPosts";
import { PROVIDER_NAME } from "@/lib/social/post";
import type { SocialPost } from "@/lib/social/store";
import type { T } from "@/lib/i18n/t";

/** Server side of the chosen posts: the cards for the client component, with nothing but text and the checked embed address. */
export function Social({ items, t }: { items: SocialPost[]; t: T }) {
  if (!items.length) return null;
  return <SocialPosts items={items.map((p) => ({ id: p.id, provider: p.provider, providerName: PROVIDER_NAME[p.provider], url: p.url, embed: p.embed, account: p.account, note: p.note }))} show={t("Show the post")} open={t("Open the post")} />;
}
