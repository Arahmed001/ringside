# Off-host backups (encrypted, to any S3-compatible storage)

**Status: built and tested with a stand-in storage service and Amazon's published signing test vector (`tests/offsite.test.ts`). It has NOT been run against a real bucket: do the drill in section 4 once, and send the message if anything differs.**

A backup on the disk that dies is not a backup. The nightly job already makes a verified backup of both databases into `/data/backups`; this copies each one **off the Fly volume**, to storage you own, every night.

**What it does.** For each file in the night's backup folder (the sports database, the accounts database, the checksum list, the model file) it compresses and **encrypts** it on the server with your passphrase (AES-256-GCM), uploads it, checks the stored size, and writes a `_complete` marker last. The bucket holds only random-looking bytes: the accounts database is personal data, and nothing is ever sent without a passphrase. Folders older than the newest 30 are deleted from the bucket after a good upload. It uses no library: the signing is written in `lib/s3.ts` and checked against Amazon's own test vector.

## 1. Choose storage and make a bucket (you do this, with your own account)

Any S3-compatible service works. Two inexpensive ones: **Cloudflare R2** (10 GB free a month, no charge for downloads) or **Backblaze B2** (10 GB free). One bucket, private (never public). Make an **API token or application key limited to that one bucket** with read and write (and delete, so old copies can be removed). Write down: the storage address (R2: `https://<account id>.r2.cloudflarestorage.com`; B2: `https://s3.<region>.backblazeb2.com`), the bucket name, the key id and the secret.

## 2. Choose a passphrase, and keep a copy off the server

A long phrase of 12 characters or more. **Keep a copy in a password manager that is not on this server.** Without it a copy cannot be read, by you or by anyone: that is the point, and it is also the risk.

## 3. Set the settings on Fly (secrets stay out of chat: use the hidden prompt for each)

```
export PATH="$HOME/.fly/bin:$PATH"
read -rs "K?Secret access key (hidden): "; printf 'OFFSITE_S3_SECRET_ACCESS_KEY=%s\n' "$K" | fly secrets import -a ringsidedb; unset K
read -rs "K?Backup passphrase (hidden): "; printf 'BACKUP_PASSPHRASE=%s\n' "$K" | fly secrets import -a ringsidedb; unset K
fly secrets set -a ringsidedb OFFSITE_S3_ENDPOINT=https://<account id>.r2.cloudflarestorage.com OFFSITE_S3_BUCKET=<bucket> OFFSITE_S3_ACCESS_KEY_ID=<key id> \
  NIGHTLY_OFFSITE_CMD="cd /app && node --import tsx scripts/offsite-backup.ts upload"
```

(The key id is not a secret on its own; the secret and the passphrase are.) The machine restarts. Then check that the settings are complete and the bucket answers, sending nothing:

```
fly ssh console -a ringsidedb -C "su node -c 'cd /app && npm run offsite -- check'"
```

*You should see* `the settings are complete and the bucket answered; 0 complete copy(ies)`.

## 4. The first copy, and the drill (do both once)

```
fly ssh console -a ringsidedb -C "su node -c 'cd /app && npm run nightly'"
```

*You should see*, in the output, a line `step=offsite ok exit=0 ... copied` and, above it, one `offsite:` line per file (`accounts.db: 0.1 MB sent, encrypted, size checked` and so on). Then `npm run offsite -- list` shows the folder.

**The drill (a backup you have never restored is a hope):** download the newest copy and check it opens.

```
fly ssh console -a ringsidedb -C "su node -c 'cd /app && npm run offsite -- fetch latest /tmp/drill'"
fly ssh console -a ringsidedb -C "su node -c 'cd /app && npm run backup -- verify /tmp/drill/<the folder it printed>'"
```

*You should see* `backup is good`. If the passphrase were wrong it would say `wrong passphrase, or the file was damaged`. `rm -r /tmp/drill` afterwards. To restore a real disaster, follow `docs/go-live.md` section 5 with the folder `npm run offsite -- fetch` produced (it can be run on any computer with the repository and the same settings).

## What it costs and what it does not do

A few cents a month at this size. It does not make copies more often than the nightly job runs, and it does not replace Fly's own volume snapshots (use both). A lost passphrase is unrecoverable by design; a lost storage key can be replaced in the storage service's dashboard.
