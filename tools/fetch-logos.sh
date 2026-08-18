#!/usr/bin/env bash
# One-off downloader for the film title-treatment logos, kept for provenance.
# Resolves each curated File: page on the MCU wiki (marvelcinematicuniverse.
# fandom.com) through the MediaWiki API and downloads the original image to
# assets/logos/<slug>.png. Logos are © Marvel Studios / The Walt Disney
# Company; used here for identification only.
set -euo pipefail
cd "$(dirname "$0")/.."

API="https://marvelcinematicuniverse.fandom.com/api.php"
OUT="assets/logos"
mkdir -p "$OUT"

# slug|File title on the wiki
FILES='
iron-man|Iron Man (film) White Logo.png
the-incredible-hulk|The Incredible Hulk Logo.png
iron-man-2|Iron Man 2 White Logo.png
thor|Thor (film) White Logo.png
captain-america-the-first-avenger|Captain America- The First Avenger Logo.png
the-avengers|The Avengers Logo.png
iron-man-3|Iron Man 3 White Logo.png
thor-the-dark-world|Thor- The Dark World White Logo.png
captain-america-the-winter-soldier|The Winter Soldier logo no background.png
guardians-of-the-galaxy|Guardians of the Galaxy White Logo.png
avengers-age-of-ultron|Avengers- Age of Ultron White Logo.png
ant-man|Ant-Man White Logo.png
captain-america-civil-war|Captain America- Civil War White Logo.png
doctor-strange|Doctor Strange (film) White Logo.png
guardians-of-the-galaxy-vol-2|Guardians of the Galaxy Vol. 2 White Logo.png
spider-man-homecoming|Spider-Man Homecoming Logo Transparent.png
thor-ragnarok|Thor Ragnarok Transparent Logo.png
black-panther|Black Panther (Updated Logo - Transparent).png
avengers-infinity-war|IW Transparent Logo.png
ant-man-and-the-wasp|Ant-Man and the Wasp Logo.png
captain-marvel|Captain Marvel (Updated Logo - Transparent).png
avengers-endgame|Avengers- Endgame Logo.png
spider-man-far-from-home|Spider-Man- Far From Home Logo.png
shang-chi|Shang-Chi Logo.png
eternals|Eternals Logo.png
spider-man-no-way-home|Spider-Man No Way Home Logo.png
doctor-strange-multiverse-of-madness|Doctor Strange in the Multiverse of Madness Logo.png
thor-love-and-thunder|Thor Love and Thunder Logo.png
black-panther-wakanda-forever|Black Panther Wakanda Forever Transparent Logo.png
ant-man-and-the-wasp-quantumania|Ant-Man and the Wasp- Quantumania Logo.png
guardians-of-the-galaxy-vol-3|Guardians of the Galaxy Vol.3 Logo.png
the-marvels|The Marvels Transparent Logo.png
deadpool-and-wolverine|Deadpool & Wolverine Logo.png
captain-america-brave-new-world|Captain America Brave New World Transparent Logo.png
thunderbolts|Thunderbolts* Transparent Logo.png
the-fantastic-four-first-steps|The Fantastic Four First Steps Transparent Logo.png
spider-man-brand-new-day|Spider-Man Brand New Day Transparent Logo.png
'

echo "$FILES" | while IFS='|' read -r slug title; do
  [ -z "$slug" ] && continue
  url=$(curl -s --get "$API" \
      --data-urlencode "action=query" \
      --data-urlencode "format=json" \
      --data-urlencode "prop=imageinfo" \
      --data-urlencode "iiprop=url" \
      --data-urlencode "titles=File:$title" \
    | python3 -c 'import json,sys
pages = json.load(sys.stdin)["query"]["pages"]
info = next(iter(pages.values())).get("imageinfo")
print(info[0]["url"] if info else "")')
  if [ -z "$url" ]; then
    echo "MISSING: $slug ($title)" >&2
    continue
  fi
  curl -s -o "$OUT/$slug.png" "$url"
  echo "$slug ← $title"
done

# Black Widow: the MCU wiki has no clean transparent wordmark; Wikimedia
# Commons hosts the official one as an SVG (white+red, ideal on dark).
curl -s -o "$OUT/black-widow.svg" \
  "https://upload.wikimedia.org/wikipedia/commons/c/ca/Black_Widow.svg"
echo "black-widow ← commons: Black Widow.svg"

# Post-processing note: Fandom serves WebP bytes under .png names. Convert and
# downscale everything in one pass (macOS):
#   for f in assets/logos/*.png; do
#     sips -s format png -Z 600 "$f" --out "$f.tmp" >/dev/null && mv "$f.tmp" "$f"
#   done
