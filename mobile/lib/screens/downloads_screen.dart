import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/downloads.dart';
import 'player_screen.dart';

/// Everything saved on this device, playable with no connection at all.
class DownloadsScreen extends StatelessWidget {
  const DownloadsScreen({super.key});

  String _size(int bytes) {
    if (bytes >= 1 << 30) return '${(bytes / (1 << 30)).toStringAsFixed(1)} GB';
    return '${(bytes / (1 << 20)).toStringAsFixed(0)} MB';
  }

  @override
  Widget build(BuildContext context) {
    final store = context.watch<DownloadsStore>();
    final entries = store.entries;
    final active = store.inFlight;

    return Scaffold(
      appBar: AppBar(title: const Text('Downloads')),
      body: entries.isEmpty && active.isEmpty
          ? const Center(
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
            )
          : ListView.builder(
              itemCount: active.length + entries.length,
              itemBuilder: (context, index) {
                // Work in progress sits above finished files: tapping
                // download and finding this screen empty is what made the
                // feature feel broken even while it was working.
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
                        // The file is here; the right to watch it lapsed with
                        // the subscription. Going online with an active plan
                        // renews it without re-downloading.
                        ? 'Expired — connect to renew'
                        : '${e.episodeLabel} · ${_size(e.sizeBytes)}',
                    style: TextStyle(color: expired ? Colors.orangeAccent : Colors.white54, fontSize: 12),
                  ),
                  trailing: IconButton(
                    icon: const Icon(Icons.delete_outline, color: Colors.white54),
                    onPressed: () => store.delete(e.episodeId),
                  ),
                  onTap: expired ? null : () => PlayerScreen.openLocal(context, e),
                );
              },
            ),
    );
  }
}
