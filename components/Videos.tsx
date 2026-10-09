import { VideoList, type VideoCard } from "./VideoList";
import { fmtDate } from "@/lib/format";
import { sourceName } from "@/lib/news/read";
import { videoIdOf } from "@/lib/news/sources";
import { hasThumb } from "@/lib/news/thumbs";
import type { NewsItem } from "@/lib/news/store";
import type { T } from "@/lib/i18n/t";

/** Official videos as cards that play on a click (see VideoList). An item whose address is not a YouTube watch address is left out. */
export function Videos({ items, t }: { items: NewsItem[]; t: T }) {
  const cards: VideoCard[] = items.flatMap((n) => {
    const videoId = videoIdOf(n.url);
    return videoId ? [{ id: n.id, videoId, title: n.title, channel: sourceName(n.source), thumb: hasThumb(videoId) ? `/api/video-thumb/${videoId}` : "", date: n.published ? fmtDate(n.published.slice(0, 10), { month: "short", day: "numeric", year: "numeric" }, t.locale) : "", url: n.url }] : [];
  });
  if (!cards.length) return null;
  return <VideoList items={cards} play={t("Play the video")} watch={t("Watch on YouTube")} />;
}
