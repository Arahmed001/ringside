/**
 * npm run offsite -- upload <backup folder>     send one verified backup folder, encrypted, to the bucket (this is what NIGHTLY_OFFSITE_CMD runs; docs/offsite-backups.md)
 * npm run offsite -- list                        the complete copies in the bucket
 * npm run offsite -- fetch <folder|latest> <dir> download one copy, decrypt it into <dir>/<folder>/, ready for `npm run backup -- verify` and `restore`
 * npm run offsite -- check                       look at the settings and the bucket without sending anything
 * Settings (all required except the last three): OFFSITE_S3_ENDPOINT, OFFSITE_S3_BUCKET, OFFSITE_S3_ACCESS_KEY_ID, OFFSITE_S3_SECRET_ACCESS_KEY, BACKUP_PASSPHRASE; OFFSITE_S3_REGION (auto), OFFSITE_S3_PREFIX (ringside/), OFFSITE_KEEP (30).
 */
import { fetchBackup, listBackups, offsiteConfig, uploadBackup } from "../lib/offsite";
import { s3Client } from "../lib/s3";

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  const { config, problems } = offsiteConfig({
    OFFSITE_S3_ENDPOINT: process.env.OFFSITE_S3_ENDPOINT, OFFSITE_S3_BUCKET: process.env.OFFSITE_S3_BUCKET, OFFSITE_S3_ACCESS_KEY_ID: process.env.OFFSITE_S3_ACCESS_KEY_ID,
    OFFSITE_S3_SECRET_ACCESS_KEY: process.env.OFFSITE_S3_SECRET_ACCESS_KEY, OFFSITE_S3_REGION: process.env.OFFSITE_S3_REGION, OFFSITE_S3_PREFIX: process.env.OFFSITE_S3_PREFIX,
    BACKUP_PASSPHRASE: process.env.BACKUP_PASSPHRASE, OFFSITE_KEEP: process.env.OFFSITE_KEEP,
  });
  if (!config) { console.error(`Off-host backup is not set up:\n- ${problems.join("\n- ")}\n(docs/offsite-backups.md)`); process.exit(2); }
  const client = s3Client(config), say = (l: string) => console.log(l);
  if (cmd === "upload") {
    if (!a) { console.error("Say which backup folder: npm run offsite -- upload /data/backups/<folder>"); process.exit(2); }
    const r = await uploadBackup(a, config, client, say);
    console.log(`copied ${r.folder}: ${r.files.length} file(s), encrypted${r.pruned.length ? `; removed ${r.pruned.length} old copy(ies) from the bucket` : ""}`);
  } else if (cmd === "list") {
    const l = await listBackups(config, client); console.log(l.length ? l.join("\n") : "no complete copies in the bucket yet");
  } else if (cmd === "fetch") {
    if (!a || !b) { console.error("Usage: npm run offsite -- fetch <folder|latest> <directory>"); process.exit(2); }
    const r = await fetchBackup(a, b, config, client);
    console.log(`restored ${r.files.join(", ")} into ${r.dir}\nNext: npm run backup -- verify ${r.dir}`);
  } else if (cmd === "check") {
    const l = await listBackups(config, client);
    console.log(`the settings are complete and the bucket answered; ${l.length} complete copy(ies), newest ${l[l.length - 1] ?? "none"}`);
  } else { console.error("Usage: npm run offsite -- upload <folder> | list | fetch <folder|latest> <dir> | check"); process.exit(2); }
}
main().catch((e) => { console.error(`off-host backup failed: ${(e as Error).message}`); process.exit(1); });
