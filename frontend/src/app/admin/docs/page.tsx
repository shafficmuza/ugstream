'use client';

import { useState } from 'react';

/* ------------------------------------------------------------------ *
 * In-app platform guide / staff training manual. Static content — the
 * single source of truth admins and new employees read to learn the
 * system. Keep it in sync with the real UI when workflows change.
 * ------------------------------------------------------------------ */

const accent = '#e50914';
const border = '#2a2a2a';
const muted = 'rgba(255,255,255,0.62)';

const SECTIONS: { id: string; label: string }[] = [
  { id: 'overview', label: '1. What this platform is' },
  { id: 'concepts', label: '2. Key concepts' },
  { id: 'add-title', label: '3. Add a title' },
  { id: 'upload', label: '4. Upload video (all methods)' },
  { id: 'encode', label: '5. Encode a 4K ladder' },
  { id: 'posters', label: '6. Posters' },
  { id: 'storage', label: '7. Where content is stored' },
  { id: 'costs', label: '8. Cost strategies' },
  { id: 'kinds-genres', label: '9. Kinds & Genres' },
  { id: 'sections', label: '10. Admin sections' },
  { id: 'roles', label: '11. Roles & access' },
  { id: 'payments', label: '12. Payments setup' },
  { id: 'trouble', label: '13. Troubleshooting' },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        background: copied ? accent : '#333',
        color: '#fff',
        border: 'none',
        borderRadius: 4,
        padding: '4px 10px',
        fontSize: 12,
        cursor: 'pointer',
      }}
    >
      {copied ? 'Copied ✓' : 'Copy'}
    </button>
  );
}

function Code({ children }: { children: string }) {
  return (
    <div style={{ position: 'relative', margin: '12px 0' }}>
      <CopyButton text={children} />
      <pre
        style={{
          background: '#0c0c0c',
          border: `1px solid ${border}`,
          borderRadius: 6,
          padding: '14px 16px',
          overflowX: 'auto',
          fontSize: 12.5,
          lineHeight: 1.55,
          margin: 0,
        }}
      >
        <code>{children}</code>
      </pre>
    </div>
  );
}

function Callout({ kind, children }: { kind: 'tip' | 'warn' | 'note'; children: React.ReactNode }) {
  const colors = {
    tip: { bar: '#3ddc84', label: 'TIP' },
    warn: { bar: '#ffb020', label: 'IMPORTANT' },
    note: { bar: '#4a9eff', label: 'NOTE' },
  }[kind];
  return (
    <div
      style={{
        borderLeft: `3px solid ${colors.bar}`,
        background: 'rgba(255,255,255,0.03)',
        borderRadius: '0 6px 6px 0',
        padding: '10px 14px',
        margin: '14px 0',
        fontSize: 13.5,
      }}
    >
      <span style={{ color: colors.bar, fontWeight: 700, fontSize: 11, letterSpacing: 0.5 }}>
        {colors.label}
      </span>
      <div style={{ marginTop: 4 }}>{children}</div>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{ scrollMarginTop: 20, marginBottom: 44 }}>
      <h2 style={{ fontSize: 19, marginBottom: 14, paddingBottom: 8, borderBottom: `1px solid ${border}` }}>
        {title}
      </h2>
      <div style={{ fontSize: 14, lineHeight: 1.7 }}>{children}</div>
    </section>
  );
}

const th: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', borderBottom: `1px solid ${border}`, fontSize: 12.5, opacity: 0.7 };
const td: React.CSSProperties = { padding: '8px 12px', borderBottom: `1px solid ${border}`, fontSize: 13, verticalAlign: 'top' };

const LADDER_CMD = `INPUT="movie.mp4"          # your source (any resolution)
OUT="movie_hls"            # output folder to upload
mkdir -p "$OUT"

ffmpeg -y -i "$INPUT" \\
  -filter_complex "\\
[0:v]split=4[v0][v1][v2][v3];\\
[v0]scale=w=-2:h=min(ih\\,2160)[o0];\\
[v1]scale=w=-2:h=min(ih\\,1080)[o1];\\
[v2]scale=w=-2:h=min(ih\\,720)[o2];\\
[v3]scale=w=-2:h=min(ih\\,480)[o3]" \\
  -map "[o0]" -map 0:a:0? -map "[o1]" -map 0:a:0? -map "[o2]" -map 0:a:0? -map "[o3]" -map 0:a:0? \\
  -c:v libx264 -preset medium -profile:v high \\
  -b:v:0 16000k -maxrate:v:0 16000k -bufsize:v:0 32000k \\
  -b:v:1 6000k  -maxrate:v:1 6000k  -bufsize:v:1 12000k \\
  -b:v:2 3000k  -maxrate:v:2 3000k  -bufsize:v:2 6000k \\
  -b:v:3 1200k  -maxrate:v:3 1200k  -bufsize:v:3 2400k \\
  -c:a aac -b:a 128k \\
  -g 48 -keyint_min 48 -sc_threshold 0 \\
  -var_stream_map "v:0,a:0 v:1,a:1 v:2,a:2 v:3,a:3" \\
  -master_pl_name master.m3u8 \\
  -f hls -hls_time 6 -hls_playlist_type vod \\
  -hls_segment_filename "$OUT/stream_%v/seg_%03d.ts" \\
  "$OUT/stream_%v/playlist.m3u8"`;

export default function AdminDocsPage() {
  return (
    <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start' }}>
      {/* Table of contents */}
      <nav
        style={{
          position: 'sticky',
          top: 20,
          flex: '0 0 210px',
          fontSize: 13,
          borderRight: `1px solid ${border}`,
          paddingRight: 16,
        }}
        className="docs-toc"
      >
        <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 12, letterSpacing: 0.5, opacity: 0.6 }}>
          CONTENTS
        </div>
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            style={{ display: 'block', padding: '5px 0', color: muted, textDecoration: 'none' }}
          >
            {s.label}
          </a>
        ))}
      </nav>

      {/* Body */}
      <div style={{ flex: 1, minWidth: 0, maxWidth: 820 }}>
        <h1 style={{ fontSize: 26, marginBottom: 6 }}>Platform Guide &amp; Staff Manual</h1>
        <p style={{ color: muted, marginBottom: 32, fontSize: 14 }}>
          How Ham Watch works and how to run it day to day. New team members: read this top to
          bottom once, then use the contents list to jump back to any task.
        </p>

        <Section id="overview" title="1. What this platform is">
          <p>
            Ham Watch is a subscription video streaming service (Netflix-style) for Uganda and the
            diaspora. Viewers sign in with their phone number, subscribe or buy individual titles,
            and watch on the web. This admin portal is where staff add content, manage pricing, and
            support users.
          </p>
          <p style={{ marginTop: 10 }}>
            Everything you publish flows to viewers through two content backends — Cloudflare Stream
            (up to 1080p, fully automatic) and Cloudflare R2 (our own storage, used for true 4K and
            for the cheapest delivery). You choose which per video; section 4 explains when to use
            which.
          </p>
        </Section>

        <Section id="concepts" title="2. Key concepts">
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={th}>Term</th>
                <th style={th}>What it is</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={td}><b>Title</b></td>
                <td style={td}>A single piece of content — one film, or one show. Has a name, poster, description, pricing, and one or more videos.</td>
              </tr>
              <tr>
                <td style={td}><b>Kind</b></td>
                <td style={td}>The <i>format</i> of a title — <b>one per title</b>. Movie, Series, Documentary, etc. A <b>Series</b> shows the episode manager; a Movie is a single video. Managed under <b>Kinds</b>.</td>
              </tr>
              <tr>
                <td style={td}><b>Genre</b></td>
                <td style={td}>What a title is <i>about</i> — <b>many per title</b> (Action + Comedy). A browsing tag only. Managed under <b>Genres</b>.</td>
              </tr>
              <tr>
                <td style={td}><b>Episode / Video</b></td>
                <td style={td}>The actual video file(s) attached to a title. A movie has one; a series has many (Season/Number). Each has a status: <i>uploading → ready</i> (or <i>error</i>).</td>
              </tr>
              <tr>
                <td style={td}><b>Access</b></td>
                <td style={td}>Who can watch: Free, Subscription only, Pay-per-title, or Subscription-or-purchase. Set per title.</td>
              </tr>
            </tbody>
          </table>
          <Callout kind="note">
            <b>Kind vs Genre</b> is the most common mix-up. Kind = the shelf (Movies / Series /
            Documentaries). Genre = the mood/topic tag. A title has exactly one Kind but can carry
            several Genres. Don&apos;t put the same word in both.
          </Callout>
        </Section>

        <Section id="add-title" title="3. Add a title">
          <ol style={{ paddingLeft: 20 }}>
            <li>Go to <b>Titles → New title</b>.</li>
            <li>Fill in <b>Kind</b>, <b>Name</b> (the slug auto-fills), description, language, VJ name, year.</li>
            <li>Tick the <b>Genres</b> that apply.</li>
            <li>Upload a <b>Poster</b> (portrait) and optional <b>Banner</b> (wide). See section 6.</li>
            <li>Choose <b>Access</b> and, if paid, the price and rental window.</li>
            <li>Save. You&apos;re taken to the edit page — scroll down to add the video (section 4).</li>
            <li>When the video is <b>ready</b>, tick <b>Published</b> so viewers can see it.</li>
          </ol>
          <Callout kind="tip">
            To reach a title&apos;s edit page later, open <b>Titles</b> and click the title&apos;s{' '}
            <b>name</b>.
          </Callout>
        </Section>

        <Section id="upload" title="4. Upload video — choosing a method">
          <p>On a title&apos;s edit page, scroll to the video section. There are several ways to get a video in. Pick by what you have:</p>
          <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: 12 }}>
            <thead>
              <tr>
                <th style={th}>You have…</th>
                <th style={th}>Use</th>
                <th style={th}>Result</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={td}>A normal film, ≤1080p</td>
                <td style={td}><b>+ Add video</b> → file upload (Cloudflare Stream)</td>
                <td style={td}>Cloudflare auto-transcodes to adaptive quality. Easiest. Max 1080p.</td>
              </tr>
              <tr>
                <td style={td}>The film is on a URL somewhere</td>
                <td style={td}><b>Import from a direct video URL</b></td>
                <td style={td}>Server pulls it in — best for large files, no browser upload.</td>
              </tr>
              <tr>
                <td style={td}>An already-encoded <b>4K H.264 MP4</b></td>
                <td style={td}>4K panel → <b>Ready 4K file (fast)</b></td>
                <td style={td}>Uploaded straight to R2, live instantly. Single quality.</td>
              </tr>
              <tr>
                <td style={td}>You can encode a <b>ladder</b> yourself</td>
                <td style={td}>4K panel → <b>Pre-made HLS ladder</b> ★</td>
                <td style={td}>Full adaptive 4K, no server load, cheapest to run. See section 5.</td>
              </tr>
              <tr>
                <td style={td}>A raw 4K source, no encoder</td>
                <td style={td}>4K panel → <b>Transcode source</b></td>
                <td style={td}>This server builds the ladder. <b>Slow</b> — hours per film.</td>
              </tr>
            </tbody>
          </table>
          <Callout kind="warn">
            For any R2 path, the video must be <b>H.264</b>. HEVC / H.265 files will upload but{' '}
            <b>won&apos;t play</b> in most browsers. If a 4K file won&apos;t play, wrong codec is the
            first thing to check.
          </Callout>
          <Callout kind="tip">
            ★ The <b>Pre-made HLS ladder</b> is the recommended path for 4K: viewers get automatic
            quality-switching, this server does no work, and delivery from R2 is free. Encode on your
            own machine or an on-demand VDS.
          </Callout>
        </Section>

        <Section id="encode" title="5. Encode a 4K ladder & upload the folder">
          <p>
            Run this on your own computer or a rented VDS. It produces a folder (<code>movie_hls</code>)
            with <code>master.m3u8</code> and one sub-folder per quality. It never upscales — a 1080p
            source just makes 1080/720/480; a true-4K source adds the 2160 rung.
          </p>
          <Code>{LADDER_CMD}</Code>
          <p style={{ marginTop: 14 }}><b>Then upload it:</b></p>
          <ol style={{ paddingLeft: 20 }}>
            <li>Open the title&apos;s edit page → <b>Upload 4K (self-hosted on R2)</b>.</li>
            <li>Choose <b>Pre-made HLS ladder (adaptive, recommended)</b>.</li>
            <li>Click the picker and select the <b>whole <code>movie_hls</code> folder</b>. Confirm the browser&apos;s folder-upload prompt.</li>
            <li>Every file uploads straight to R2 (progress shown), then it publishes automatically.</li>
          </ol>
          <Callout kind="warn">
            Video must be <b>H.264 (libx264)</b>, and the master playlist must be{' '}
            <b><code>master.m3u8</code></b> (the command above handles this). Keep the folder
            structure ffmpeg produces.
          </Callout>
        </Section>

        <Section id="posters" title="6. Posters">
          <p>
            Posters are the first thing viewers judge. Our standard: a <b>striking frame pulled from
            the video itself</b>, cropped to a <b>2:3 portrait</b> — never a low-res archive
            thumbnail. Make each title&apos;s poster visually distinct so similar titles don&apos;t
            blur together in the rails.
          </p>
          <Callout kind="tip">
            To pull a frame from a video with ffmpeg:{' '}
            <code>ffmpeg -i movie.mp4 -ss 00:03:30 -vframes 1 -vf &quot;crop=ih*2/3:ih&quot; poster.jpg</code>{' '}
            — pick a moment with strong composition and colour.
          </Callout>
        </Section>

        <Section id="storage" title="7. Where content is stored">
          <p>Nothing large lives on the app server. It only transcodes (temporarily) and serves the portal.</p>
          <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: 10 }}>
            <thead>
              <tr>
                <th style={th}>Method</th>
                <th style={th}>Stored on</th>
                <th style={th}>Delivered by</th>
              </tr>
            </thead>
            <tbody>
              <tr><td style={td}>Cloudflare Stream upload / URL import</td><td style={td}>Cloudflare Stream</td><td style={td}>Cloudflare edge</td></tr>
              <tr><td style={td}>R2 (ready file / ladder / transcode)</td><td style={td}>Cloudflare R2 bucket</td><td style={td}>Cloudflare edge (free egress)</td></tr>
              <tr><td style={td}>This app server</td><td style={td}>Nothing permanent — temp scratch during transcode only</td><td style={td}>—</td></tr>
            </tbody>
          </table>
        </Section>

        <Section id="costs" title="8. Cost strategies">
          <p>Two costs: <b>storage</b> (fixed monthly) and <b>delivery</b> (grows with how much people watch). They behave very differently:</p>
          <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: 10 }}>
            <thead>
              <tr>
                <th style={th}>Backend</th>
                <th style={th}>Storage</th>
                <th style={th}>Delivery</th>
                <th style={th}>Best for</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={td}><b>Cloudflare Stream</b></td>
                <td style={td}>~$5 / 1,000 min</td>
                <td style={td}>$1 / 1,000 min <b>watched</b> — grows with audience</td>
                <td style={td}>Quick uploads, low-view titles, ≤1080p</td>
              </tr>
              <tr>
                <td style={td}><b>Cloudflare R2</b></td>
                <td style={td}>~$0.015 / GB</td>
                <td style={td}><b>$0 egress</b> — flat at any scale</td>
                <td style={td}>4K, and anything popular</td>
              </tr>
            </tbody>
          </table>
          <Callout kind="tip">
            <b>The rule of thumb:</b> the more a title gets watched, the more it should live on R2.
            Stream&apos;s per-minute-watched delivery is what grows the bill; R2 delivery is free.
            Encode adaptive ladders on an on-demand VDS (a few dollars of burst compute) and your
            ongoing bill stays near storage-only.
          </Callout>
        </Section>

        <Section id="kinds-genres" title="9. Managing Kinds & Genres">
          <p>
            Both are editable at runtime — no developer needed. Under <b>Kinds</b>, add formats like
            Documentary, Music, or Kids; under <b>Genres</b>, add topics like Thriller or Faith. A
            Kind can&apos;t be deleted while titles still use it (reassign those titles first).
          </p>
        </Section>

        <Section id="sections" title="10. Admin sections at a glance">
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              <tr><td style={td}><b>Dashboard</b></td><td style={td}>Users, subscriptions, revenue, catalogue counts.</td></tr>
              <tr><td style={td}><b>Titles</b></td><td style={td}>Add / edit content and upload videos.</td></tr>
              <tr><td style={td}><b>Genres / Kinds</b></td><td style={td}>Manage the browsing tags and content formats.</td></tr>
              <tr><td style={td}><b>Plans</b></td><td style={td}>Subscription tiers and prices.</td></tr>
              <tr><td style={td}><b>Users</b></td><td style={td}>Find accounts, grant admin, check subscriptions.</td></tr>
              <tr><td style={td}><b>Payments</b></td><td style={td}>Transactions and their status.</td></tr>
              <tr><td style={td}><b>Settings</b></td><td style={td}>Branding — logo, hero and login background images.</td></tr>
            </tbody>
          </table>
        </Section>

        <Section id="roles" title="11. Roles & access">
          <p>There are two staff roles. Admins assign them in <b>Users</b> (role dropdown).</p>
          <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: 10 }}>
            <thead>
              <tr>
                <th style={th}>Can…</th>
                <th style={th}>Editor</th>
                <th style={th}>Admin</th>
              </tr>
            </thead>
            <tbody>
              <tr><td style={td}>Add / edit titles, upload video, publish</td><td style={td}>✅</td><td style={td}>✅</td></tr>
              <tr><td style={td}>Add genres & kinds</td><td style={td}>✅</td><td style={td}>✅</td></tr>
              <tr><td style={td}>View dashboard</td><td style={td}>✅</td><td style={td}>✅</td></tr>
              <tr><td style={td}><b>Delete</b> anything (titles, genres, kinds…)</td><td style={td}>❌</td><td style={td}>✅</td></tr>
              <tr><td style={td}>Settings, payments & credentials</td><td style={td}>❌</td><td style={td}>✅</td></tr>
              <tr><td style={td}>Plans & pricing</td><td style={td}>❌</td><td style={td}>✅</td></tr>
              <tr><td style={td}>Users & roles</td><td style={td}>❌</td><td style={td}>✅</td></tr>
            </tbody>
          </table>
          <Callout kind="note">
            To add a staff member: have them sign up normally (phone + code), then an admin opens{' '}
            <b>Users</b>, finds their number, and sets their role to <b>editor</b>. Only admins can
            create other admins, and <b>only admins can delete</b> anything.
          </Callout>
        </Section>

        <Section id="payments" title="12. Payments setup (admins)">
          <p>
            Card payments always use <b>Stripe</b>. For <b>mobile money</b> you choose one active
            processor — <b>MTN MoMo</b>, <b>Flutterwave</b>, <b>Yo! Payments</b>, or <b>DPO Pay</b> —
            in <b>Settings → Payments</b>, switchable anytime with no redeploy.
          </p>
          <ol style={{ paddingLeft: 20, marginTop: 8 }}>
            <li>Enter the provider&apos;s API credentials in the <b>Mobile money credentials</b> form (stored securely, never shown back).</li>
            <li>Pick that provider in the <b>Mobile money provider</b> dropdown.</li>
            <li>The status line should read <span style={{ color: '#3ddc84' }}>credentials set</span>.</li>
          </ol>
          <Callout kind="warn">
            Yo! and DPO integrations are built to the providers&apos; APIs but must be tested with a
            real (sandbox) transaction before going live. Test one small payment end-to-end after
            entering credentials.
          </Callout>
        </Section>

        <Section id="trouble" title="13. Troubleshooting">
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr><th style={th}>Symptom</th><th style={th}>Cause / fix</th></tr>
            </thead>
            <tbody>
              <tr>
                <td style={td}>A 4K video won&apos;t play</td>
                <td style={td}>Almost always the wrong codec — it must be <b>H.264</b>, not HEVC/H.265. Re-encode and re-upload.</td>
              </tr>
              <tr>
                <td style={td}>Video stuck on <i>uploading</i></td>
                <td style={td}>A server transcode is still running (can take hours for 4K), or an upload failed. Re-open the page to refresh status.</td>
              </tr>
              <tr>
                <td style={td}>&quot;Too many codes requested&quot; on login</td>
                <td style={td}>OTP rate limit (3/hour per number). Wait, or an admin clears it. Contact the developer if a staff account is locked.</td>
              </tr>
              <tr>
                <td style={td}>Ladder upload says &quot;no master playlist&quot;</td>
                <td style={td}>The folder has no <code>master.m3u8</code> with quality variants. Re-encode with the section 5 command, or use <b>Ready file</b> for a single MP4.</td>
              </tr>
              <tr>
                <td style={td}>Title not visible to viewers</td>
                <td style={td}>It isn&apos;t <b>Published</b>, or its video isn&apos;t <b>ready</b> yet. Check both on the edit page.</td>
              </tr>
            </tbody>
          </table>
        </Section>

        <p style={{ color: muted, fontSize: 12.5, borderTop: `1px solid ${border}`, paddingTop: 16 }}>
          Keep this guide current: when a workflow changes, update it so it stays the team&apos;s
          single source of truth.
        </p>
      </div>
    </div>
  );
}
