import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/downloads.dart';
import 'player_screen.dart';

/// Everything saved on this device, playable with no connection at all.
class DownloadsScreen extends StatelessWidget {
  const DownloadsScreen({super.key});

  Future<void> _confirmDelete(BuildContext context, DownloadEntry e) async {
    // Worth a tap to confirm: re-downloading a film costs real money on a
    // Ugandan mobile bundle, so an accidental delete is not a small mistake.
    final store = context.read<DownloadsStore>();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF141414),
        title: const Text('Delete download?'),
        content: Text(
          '${e.titleName} — ${e.episodeLabel}\n\n'
          'This frees ${formatBytes(e.sizeBytes)}. You will need to download it again to watch offline.',
          style: const TextStyle(color: Colors.white70, height: 1.4),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Keep')),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Delete', style: TextStyle(color: Color(0xFFE50914))),
          ),
        ],
      ),
    );
    if (ok == true) await store.delete(e.episodeId);
  }

  @override
  Widget build(BuildContext context) {
    final store = context.watch<DownloadsStore>();
    final entries = store.entries;
    final active = store.inFlight;

    if (entries.isEmpty && active.isEmpty) {
      return Scaffold(
        appBar: AppBar(title: const Text('Downloads')),
        body: const Center(
          child: Padding(
            padding: EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.download_for_offline_outlined, size: 56, color: Colors.white24),
                SizedBox(height: 16),
                Text('Nothing downloaded yet', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                SizedBox(height: 8),
                Text(
                  'Videos you download appear here and play without internet — '
                  'look for the download button on any title.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.white54, height: 1.4),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Downloads'),
        bottom: entries.isEmpty
            ? null
            : PreferredSize(
                preferredSize: const Size.fromHeight(22),
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text(
                    '${entries.length} ${entries.length == 1 ? 'video' : 'videos'} · ${formatBytes(store.totalBytes)} used',
                    style: const TextStyle(fontSize: 12, color: Colors.white54),
                  ),
                ),
              ),
      ),
      body: ListView.builder(
        itemCount: active.length + entries.length,
        itemBuilder: (context, index) {
          // Work in progress sits above finished files: tapping download and
          // finding this screen empty is what made the feature feel broken
          // even while it was working.
          if (index < active.length) {
            final a = active[index];
            final p = a.progress;
            return ListTile(
              leading: SizedBox(
                width: 72,
                child: Center(
                  child: SizedBox(
                    width: 24,
                    height: 24,
                    child: CircularProgressIndicator(
                      strokeWidth: 2.5,
                      color: const Color(0xFFE50914),
                      value: p.queued || p.preparing || p.total <= 0 ? null : p.fraction,
                    ),
                  ),
                ),
              ),
              title: Text(a.titleName),
              subtitle: Text(
                '${a.episodeLabel} · ${p.label}',
                style: const TextStyle(fontSize: 12, color: Color(0xFFE50914)),
              ),
              trailing: IconButton(
                tooltip: 'Stop download',
                icon: const Icon(Icons.close, color: Colors.white54),
                onPressed: () => context.read<DownloadsStore>().cancel(a.episodeId),
              ),
            );
          }

          final e = entries[index - active.length];
          final expired = !e.stillValid;
          return ListTile(
            leading: SizedBox(
              width: 72,
              child: e.posterUrl != null
                  ? ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: CachedNetworkImage(imageUrl: e.posterUrl!, fit: BoxFit.cover),
                    )
                  : const Icon(Icons.movie, color: Colors.white38),
            ),
            title: Text(e.titleName),
            subtitle: Text(
              expired
                  // The file is here; the right to watch it lapsed with the
                  // subscription. Going online with an active plan renews it
                  // without re-downloading.
                  ? 'Expired — connect to renew'
                  : '${e.episodeLabel} · ${formatBytes(e.sizeBytes)} · ${e.expiryLabel}',
              style: TextStyle(color: expired ? Colors.orangeAccent : Colors.white54, fontSize: 12),
            ),
            trailing: IconButton(
              icon: const Icon(Icons.delete_outline, color: Colors.white54),
              onPressed: () => _confirmDelete(context, e),
            ),
            onTap: expired ? null : () => PlayerScreen.openLocal(context, e),
          );
        },
      ),
    );
  }
}
