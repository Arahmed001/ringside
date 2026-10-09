# Recorded pictures: showing a photo you have the right to show

The site shows a fighter's photo only when it has a right to: a free licence from Wikimedia Commons (found automatically, see [media.md](media.md)), the supplier's own feed (which carries its own terms), or a picture an editor **recorded** with the licence or the rights-holder's permission. This page is about the third.

## Recording a picture

1. Sign in as an editor and open **/review/photos** ("Recorded pictures").
2. Fill in: the fighter (the last part of their page address, `/boxers/<this>`), the picture's address (https, ending `.jpg`, `.png` or `.webp`), the **licence** (CC0, Public domain, CC BY, CC BY-SA, or *By permission of the rights-holder*), the **credit** (photographer or rights-holder, shown beside the picture), the **source page** (where it came from), and for a permission, the **evidence** (who agreed, how, and when).
3. Save. A record without a licence and a credit cannot be saved. The picture is put on the fighter's page at once; removing the record takes it off.

Rules the form enforces: https only, no credentials in the address, a picture file type, a credit, a source page, and for "By permission" at least ten characters of evidence. A fighter whose photo came with the supplier's feed keeps it (the feed's licence stands); a Commons photo or an earlier record is replaced by the new record.

The record lives in the accounts database, so it survives a reload of the sports database. After a reload put them all back with:

```bash
npm run photos:apply -- --database ~/ringside-real/real.db
```

## Pictures sent in through the site

Anyone signed in can send a picture from a fighter's page ("Is this you or your fighter? Send a photo", under the report link). They choose who they are to the picture (the fighter, the team or promoter, the photographer, someone else with permission), write the credit, and tick a box saying they took it or have the owner's permission. Nothing appears until an editor decides.

- **What is accepted:** a real JPEG or PNG (judged by the file's first bytes, not its name), up to 4 MB, 300 to 8000 pixels on each side. The kept copy has its location, camera and comment data removed.
- **Limits:** three pictures waiting per person, five per fighter, and the usual rate limit.
- **Deciding:** editors open **/review/photos**, section "Pictures sent in", look at the picture and the sender (an account linked to the fighter is marked), and press Approve or Refuse. Approve records the picture "by permission" with the sender as the evidence and shows it on the fighter's page at once; a photo that came with the supplier's data is never replaced. Refuse deletes the file. You cannot decide on your own picture unless you are an admin.
- **Where the files are:** in a `photos` folder next to the accounts database (on Fly, `/data/photos`). They are served at `/api/photo-file/<name>` only while on a fighter's page (or to the sender and editors while waiting).
- **Backups:** `npm run backup` copies the databases, **not** this folder. The record of an approved picture is in the accounts database, but the picture file itself is only in `photos`. Copy that folder when you copy the databases (on Fly: `fly ssh sftp get -R /data/photos`), or a restore would show broken pictures until the senders send them again.
- **Corrections:** if the owner of a picture asks for it to be taken down, remove its record on the same page.

## Where the picture is stored

For a picture recorded by its address: nowhere on this site: the page points the visitor's browser at the address you gave (the rights-holder's own hosting or the Commons thumbnail), and the privacy page already says pictures come from other websites. If you want pictures on your own hosting, put the file there and record that address; a licence that allows showing a picture usually allows hosting it, but a *permission* should say so.

## Asking for permission (a template you send yourself)

Nothing in the site sends email. Adapt, send from your own address, and keep the reply: it is your evidence.

> Subject: Permission to show a photo of [fighter] on Ringside
>
> Hello [name],
>
> I run Ringside, a boxing results and statistics site ([address]). I would like to show the attached/linked photo of [fighter] on his page, with the credit "[photographer / promotion]" beside it and a link back to [your page]. It would be shown as the picture of his page and in lists, at about 400 pixels wide, not sold and not altered beyond cropping.
>
> May I? If you would prefer a different credit, or only certain uses, please say. A reply of "yes" is enough for me to record it.
>
> Thank you,
> [name]

Record the date of the reply and who sent it in the **evidence** field.

## Never

A picture from BoxRec, from a news site or agency, from a social post, or from a promoter's site without a reply saying yes. Finding a picture on the web is not permission to show it.
