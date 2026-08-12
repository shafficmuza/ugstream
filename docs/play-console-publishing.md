# Publishing to Google Play

Two ways to get a build onto Play: upload the bundle by hand, or run
`scripts/publish-play.sh`, which builds and pushes it.

    bash scripts/publish-play.sh                 # internal testing
    bash scripts/publish-play.sh production      # when you mean it
    bash scripts/publish-play.sh internal --no-build

Set RELEASE_NOTES to say what changed; otherwise it writes a generic line.

The script refuses a debug-signed bundle, and refuses a versionCode that is not
higher than what the track already holds — the two failures worth catching
before a 46MB upload rather than after it.

---

## What Play wants

Play needs an **Android App Bundle (`.aab`)**, not an APK. New apps have not
been allowed to ship APKs since 2021. The APK on the login page stays as it is
— it is for people installing directly from your site, which the bundle cannot
replace.

Both come from the same source and the same upload key, so they are the same
app to Android; only the packaging differs.

---

## Uploading by hand (do this for the first release)

1. **Play Console → Create app.** Name, default language, "App", "Free".
2. **App content**, and answer every section. The ones that will hold you up:
   - *Privacy policy*: `https://ham.sentepos.com/privacy`
   - *App access*: the reviewer cannot receive your SMS code, so give them the
     demo account — see `brand/store-listing.md`, "App access". This is the
     single most common cause of a rejected first submission.
   - *Target audience*: selecting any age under 13 puts the app under the
     Families policy. Read that section of the listing pack first.
   - *Data safety*: the answers matching this app are in the listing pack.
3. **Testing → Internal testing → Create new release.**
4. Upload the `.aab`.
5. **Play App Signing** will be offered — accept it. Google then holds the real
   signing key and your upload key only proves the bundle came from you. It
   also means losing the upload key is recoverable, which it otherwise is not.
6. Add yourself as an internal tester, roll out, and install from the link Play
   gives you.

Internal testing appears within minutes. Production review takes days, so use
internal testing for anything you want to look at now.

---

## Setting up automated publishing

Worth doing once you are past the first release and expect to ship often.

### 1. Create the service account (in Google Cloud)

Start here rather than in Play Console. The **API access** page is easy to miss:
it lives at the developer ACCOUNT level, not inside an app, so it does not
appear while you are viewing a specific app — and it is visible only to the
account owner. Starting from Cloud avoids the question entirely.

- **APIs & Services → Library** → enable **Google Play Android Developer API**
- **IAM & Admin → Service Accounts → Create service account**, name it
  something like `play-publisher`. No project roles are needed.
- On that account: **Keys → Add key → Create new key → JSON**. Download it.
- Copy the account's email — `play-publisher@<project>.iam.gserviceaccount.com`

### 2. Grant it access in Play Console

A service account is just a user with an email address, so the ordinary invite
flow works on it and you never need the API access page:

- **Play Console → Users and permissions → Invite new users**
- Paste the service account email
- App permissions: this app only
- Grant **Release to testing tracks**, plus **Release apps to production** if
  you want it publishing there
- *Invite user*

Give it access to this app only, not the whole developer account. The key
becomes a credential that can ship software under your name.

### 3. Give me the key

The JSON must **not** go in the repository — it is public. Put it on the server
outside the checkout:

```bash
# from your machine
scp play-publisher.json root@95.111.232.148:/root/secure/play-publisher.json
chmod 600 /root/secure/play-publisher.json
```

`/root/secure/` is already where the Android signing credentials live, and it
is not in git.

Once it is there, publishing a build becomes one command. The pipeline uses
`fastlane supply`, which uploads the bundle, attaches release notes, and rolls
out to the track you name.

---

## What automation cannot do

Worth knowing before you expect too much of it:

- **It cannot create the app** or complete the content questionnaires. Those
  are one-time and manual.
- **It cannot push the first bundle** to a track that has never had one.
- **It cannot answer for you** on data safety, target audience or content
  rating — and those answers are checked against what a reviewer actually sees
  in the app.

So the sequence is: do the first release by hand, then automate the ones after
it.

---

## Version numbers

Play rejects a bundle whose `versionCode` is not higher than the last one
uploaded. Nothing bumps it automatically — `mobile/pubspec.yaml` carries
`version: <name>+<code>`, and the number after the `+` is the versionCode.

**1.3.0+9 is published to internal testing.** The next upload needs `+10` or
higher, and the publish script will stop you before uploading if it is not.

The iOS workflow overrides its build number with the CI run number, so only
Android depends on this being right.
