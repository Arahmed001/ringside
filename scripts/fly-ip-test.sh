#!/bin/sh
# Does the host overwrite a visitor-written Fly-Client-IP? (docs/fly-deploy.md, step 9)
#   sh scripts/fly-ip-test.sh https://YOURAPP.fly.dev
# Sends 25 sign-in attempts for users that do not exist, each claiming a different address in the Fly-Client-IP header. Sign-in is limited to 20 attempts
# per address per 15 minutes. If the host overwrites the header, all 25 come from your real address and the 21st is refused (429). If the header is believed,
# each attempt looks like a new visitor and none is refused. Afterwards your own address cannot sign in for up to 15 minutes (nobody is harmed: no account is touched).
base="${1:?usage: sh scripts/fly-ip-test.sh https://YOURAPP.fly.dev}"
codes=""
i=1
while [ "$i" -le 25 ]; do
  c=$(curl -s -o /dev/null -m 20 -w "%{http_code}" -X POST -H "content-type: application/json" -H "Fly-Client-IP: 203.0.113.$i" \
    -d "{\"username\":\"iptest$i\",\"password\":\"x\"}" "$base/api/account/login")
  codes="$codes $c"; i=$((i + 1))
done
echo "answers:$codes"
case "$codes" in
  *429*) echo "GOOD: the host overwrote the header (attempts were counted against one address and refused after 20)." ;;
  *401*) echo "BAD: no attempt was refused, so a visitor can choose the address the limits see. Do not rely on per-visitor limits; tell Claude." ;;
  *) echo "UNCLEAR: unexpected answers (is the site up? is sign-in switched off?). Do not draw a conclusion." ;;
esac
