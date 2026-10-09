# Boxing news headlines

The site lists headlines from boxing outlets' own public feeds, each a link to the original story. It keeps the title, the date, the link and the short excerpt the feed itself publishes. It also saves the one picture the feed offers for the headline (see "The pictures of headlines" below). It never keeps an article body, and it shows nothing of an outlet's work beyond that.

## Turn it on

```bash
export NEWS_CONTACT=you@example.org                 # required: goes in the User-Agent so an outlet can reach you
npm run news:refresh -- --dry-run                   # lists the feeds it would read; reads none
npm run news:refresh                                # reads them, keeps the new headlines, drops those older than 120 days, looks up Wayback copies
```

Run it hourly from the nightly job's scheduler or cron. It asks only for what changed (ETag / Last-Modified), reads `robots.txt` first and stays away from what it forbids, waits three seconds between outlets, takes only XML up to 1.5 MB, follows no redirect to another site, never fetches a private address, and does not retry a refusal (401, 403, 429). One outlet failing never stops the others. Nothing is shown until a refresh has run: the fighter and card pages show a section only when there are headlines about them.

## Which outlets

`lib/news/sources.ts` lists them, each with why it is allowed. Four independent outlets' public feeds are read by default (Boxing News, Boxing News 24, 15Rounds, World Boxing News). The BBC, The Guardian and Sky Sports limit their feeds to non-commercial sites: they are read only if you set `NEWS_NONCOMMERCIAL=1`, which is your statement that the site earns nothing (no advertising, no sales, no paid tier). Boxing News's excerpts have the names cut out of them, so only its headlines are kept.

To add an outlet, add a line there with its feed address and what its terms say, and confirm it with `--dry-run` before the first read.

## Where it shows

- A fighter's page: "In the news", the five newest headlines that name them.
- A card's page: the six newest that name a fighter on the card.
- `/news`: the 60 newest, filtered by outlet (`?source=`). Kept out of search results.

A headline is credited to a fighter only when their whole name (two words or more) appears in the title or excerpt, the name is one fighter's in the whole league, and they have fought at least three times. It errs towards saying nothing.

## Wayback copies

Each headline gets a link to a Wayback Machine copy when the Internet Archive has one ("Archived copy"), so a link that goes dead still leads somewhere. A story from today is usually not archived yet; a headline without a copy is asked about again after a week, 25 at a time, one a second.

## What the visitor sees and sends

Links open the outlet's own page in a new tab with `noopener noreferrer nofollow`. Nothing is loaded from an outlet's site when a page is viewed: no image, script or frame (the pictures are files this site saved and serves itself). The privacy page needs no change.

The news page has two tabs, **Videos to watch** (the official videos, newest 24) and **News to read** (the outlet filter, chosen posts and headlines), as plain links: `/news?tab=videos` and `/news?tab=news`. Videos open first unless there are none.

## The pictures of headlines

Three of the four open outlets' feeds offer a picture for each headline (Boxing News, Boxing News 24, World Boxing News; 15Rounds offers none). `news:refresh` saves it: only from an outlet listed as open (never the BBC, The Guardian or Sky Sports), only an https address the feed itself gave, at a public host whose `robots.txt` allows it, with no redirect, and only a real JPEG, PNG or WebP of at most 600 KB (60 a run, 25 an outlet). It goes in `news-images/` beside the database (`/data/news-images` on Fly) and the cards show it from `/api/news-image/<id>`, with "Picture from <outlet>" under it and the picture linking to the story. A visitor's browser never contacts the outlet's image host. A picture is deleted when its headline is pruned (after 120 days) or its outlet is switched off.

**These pictures belong to the outlets**, and often to the agencies they license from. The owner chose to show them; this has not been read by a lawyer, and no outlet has been asked. To stop for one outlet (if it asks, or you would rather ask first): set `NEWS_IMAGE_SOURCES` to the list of outlets you keep (`boxing-news,boxing-news-24,world-boxing-news,15-rounds`), or `none`; the next refresh deletes what was saved from the others.

## Official videos

The same refresh lists the newest uploads of eight official channels (DAZN Boxing, Matchroom, Top Rank, Queensberry, Sky Sports Boxing, ProBox TV, Premier Boxing Champions, Golden Boy) and shows the ones that name a fighter on that fighter's page and on the card's page, and the newest twelve on `/news`.

**A key of your own is needed.** YouTube's `robots.txt` closes its RSS feeds to bots, so the channels are read with YouTube's Data API, which is free (10,000 units a day; a refresh uses 8):

1. In the [Google Cloud console](https://console.cloud.google.com/) create a project, enable "YouTube Data API v3", and under Credentials create an API key. Restrict it to that API.
2. Save the key where only you can read it (the key is not echoed or kept in your shell history):

```bash
read -s "k?Paste the YouTube key, then press Return: "; printf '%s\n' "$k" > ~/.ringside-youtube-key; chmod 600 ~/.ringside-youtube-key; unset k
```

   `npm run news:refresh` reads `~/.ringside-youtube-key` (or `YOUTUBE_API_KEY` if that is set, which wins). A secret: never commit it.

Without the key the videos are skipped and the headlines still refresh. The key goes to Google only; it is never stored, logged or shown (an error message has it replaced with `[key]`).

**What is kept:** the video's title, date and watch address, never the description. Each video's thumbnail picture is saved by this server (see below).

**The pictures.** `news:refresh` saves each listed video's thumbnail from YouTube's image host (`i.ytimg.com`, the large 16:9 one, else the small one) into a folder beside the database (`video-thumbs/` next to `DATABASE_PATH`; `/data/video-thumbs` on Fly) and the site shows it from its own address (`/api/video-thumb/<id>`). A visitor's browser therefore never contacts YouTube or Google until play is pressed. Limits, to stay within YouTube's terms for data got through its API: a picture is fetched again after 25 days and is never kept or served past 30; one whose video has left the list is deleted at the next refresh; only a real JPEG up to 400 KB is saved, from that one host, with no redirects; at most 80 are fetched per run; the route that serves them reads the folder only and fetches nothing. A video with no saved picture shows the text card as before. About 30–100 KB each: a few MB for a hundred videos.

**How it plays:** the page shows the video's picture (where saved), the channel, the title and a "Play the video" button. No request goes to YouTube or Google while the page is just open (no script, no frame, no picture from them; checked in a real browser: zero requests before the press, then YouTube's privacy-enhanced player, `youtube-nocookie.com`, in a sandboxed frame). The content security policy allows that one frame source and no other, and the privacy page says what YouTube can see after a press of play.

## Chosen posts (YouTube, X, Reddit, Instagram, Facebook)

An editor or administrator chooses specific public posts; the site cannot find posts by itself (every platform's search is a paid or approved API, and scraping is against their terms, which this site does not do).

1. Sign in as an editor and open **/review/social** ("Chosen posts").
2. Paste the link to one post by an account you have checked is the real one, say where it shows (a fighter's page: the last part of that page's address; a card's page: its number; or the news page), and optionally the account's name and a short note.
3. The link is checked on the server: only a link to one public post on youtube.com / youtu.be, x.com / twitter.com (`/handle/status/ID`), reddit.com (`/r/sub/comments/ID`), instagram.com (`/p|reel|tv/CODE`) or facebook.com (`/page/posts/ID`, `/videos/`, `/reel/`, `/watch/?v=`, `permalink.php`) is accepted. The address in the frame is built from the checked parts, never from the pasted text. A place shows at most six posts; the same post is added once per place; removing one takes effect at once; every add and removal is in the audit log.

**What a visitor sees:** the platform's name, the account, your note and a "Show the post" button. Nothing is requested from the platform until they press it (checked in a real browser: no request before the press). Then that platform's own embed opens in a sandboxed frame, one at a time per list. The content security policy allows exactly five frame hosts (`www.youtube-nocookie.com`, `platform.twitter.com`, `embed.reddit.com`, `www.instagram.com`, `www.facebook.com`) and no others; the privacy page lists each and what it can see after a press.

**Limits:** a post its author deletes, or an account that becomes private, shows the platform's own "unavailable" in the frame; remove it. Instagram and Facebook may ask a visitor to sign in to view some posts. Reddit's and Instagram's embed addresses were checked to answer and to allow framing, but with no real post to try the Reddit and Instagram cards show the platform's generic page; try one real post of each before relying on it.
