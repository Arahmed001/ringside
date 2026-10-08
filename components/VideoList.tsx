"use client";
import { useState } from "react";

export interface VideoCard { id: number; videoId: string; title: string; channel: string; date: string; url: string }

/**
 * Official videos, played in YouTube's own embedded player and only after a visitor presses play. Until then the page shows text and a button: nothing is requested
 * from YouTube or Google (no picture, no script, no frame), so merely opening a page here tells them nothing. The player is YouTube's privacy-enhanced one
 * (youtube-nocookie.com), which sets no cookie until the video plays. The channel name and the title are YouTube's own words and stay in their language.
 */
export function VideoList({ items, play, watch }: { items: VideoCard[]; play: string; watch: string }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {items.map((v) => (
        <li key={v.id} className="card p-4">
          <div className="text-xs text-muted"><span lang="en" dir="ltr">{v.channel}</span> · {v.date}</div>
          <div lang="en" dir="ltr" className="mt-1 font-display text-lg font-bold leading-snug">{v.title}</div>
          {open === v.videoId ? (
            <div className="mt-3 aspect-video w-full overflow-hidden rounded-lg bg-black">
              <iframe
                title={v.title} src={`https://www.youtube-nocookie.com/embed/${v.videoId}?autoplay=1&rel=0`} className="h-full w-full" loading="lazy" referrerPolicy="strict-origin-when-cross-origin"
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
              />
            </div>
          ) : (
            <button type="button" onClick={() => setOpen(v.videoId)} className="btn mt-3 min-h-11 cursor-pointer">▶ {play}</button>
          )}
          <div className="mt-2 text-xs text-muted"><a href={v.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-block py-1 hover:text-ink">{watch} ↗</a></div>
        </li>
      ))}
    </ul>
  );
}
