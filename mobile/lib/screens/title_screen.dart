import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../core/auth.dart';
import '../models/models.dart';
import '../services/catalog.dart';
import '../services/downloads.dart';
import '../core/api_client.dart';
import '../core/store_policy.dart';
import 'player_screen.dart';
import 'subscribe_screen.dart';

class TitleScreen extends StatefulWidget {
  const TitleScreen({super.key, required this.slug, required this.name});
  final String slug;
  final String name;
  @override
  State<TitleScreen> createState() => _TitleScreenState();
}

/// Download control for one episode: idle, in flight (with progress), done.
class _DownloadButton extends StatelessWidget {
  const _DownloadButton({
    required this.episodeId,
    required this.titleId,
    required this.titleName,
    required this.episodeLabel,
    this.posterUrl,
    this.expanded = false,
  });
  /// Full-width button with a label (films) vs a 48dp icon (episode rows).
  final bool expanded;
  final String episodeId;
  final String titleId;
  final String titleName;
  final String episodeLabel;
  final String? posterUrl;

  Future<void> _start(BuildContext context) async {
    final store = context.read<DownloadsStore>();
    try {
      await store.download(
        episodeId: episodeId,
        titleId: titleId,
        titleName: titleName,
        episodeLabel: episodeLabel,
        posterUrl: posterUrl,
      );
    } on ApiException catch (e) {
      if (!context.mounted) return;
      if (e.statusCode == 402) {
        // Same fork as a refused play: subscribe where purchase is allowed,
        // a plain notice on iOS (see store_policy.dart).
        if (purchasesAllowed) {
          Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SubscribeScreen()));
        } else {
          showNotEntitledNotice(context);
        }
      } else {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      }
    } catch (_) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Download failed. Check your connection and try again.')));
      }
    }
  }

  Widget _ring(DownloadProgress progress, {double size = 22}) {
    return SizedBox(
      width: size,
      height: size,
      child: CircularProgressIndicator(
        strokeWidth: 2.5,
        color: const Color(0xFFE50914),
        // Indeterminate while Cloudflare prepares the file, real progress
        // once bytes are moving.
        value: progress.preparing || progress.total == 0 ? null : progress.fraction,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final store = context.watch<DownloadsStore>();
    final done = store.isDownloaded(episodeId);
    final progress = store.progressOf(episodeId);

    if (expanded) {
      // One full-width surface — icon, word and progress are all the same
      // button, so there is nothing dead to tap. The compact icon-only form
      // taught users to tap the word "Download", which did nothing.
      final label = done
          ? 'Downloaded'
          : progress == null
              ? 'Download'
              : progress.preparing
                  ? 'Preparing…'
                  : 'Downloading ${(progress.fraction * 100).round()}%';
      return SizedBox(
        width: double.infinity,
        child: OutlinedButton.icon(
          onPressed: done || progress != null ? null : () => _start(context),
          icon: done
              ? const Icon(Icons.download_done)
              : progress != null
                  ? _ring(progress, size: 18)
                  : const Icon(Icons.download_outlined),
          label: Text(label),
          style: OutlinedButton.styleFrom(
            foregroundColor: Colors.white70,
            disabledForegroundColor: Colors.white54,
            side: const BorderSide(color: Colors.white24),
            padding: const EdgeInsets.symmetric(vertical: 12),
          ),
        ),
      );
    }

    // Compact form for episode rows — still a full 48dp Material touch
    // target, the minimum a finger can hit reliably.
    if (done) {
      return const SizedBox(
        width: 48,
        height: 48,
        child: Icon(Icons.download_done, color: Colors.white54),
      );
    }
    if (progress != null) {
      return SizedBox(width: 48, height: 48, child: Center(child: _ring(progress)));
    }
    return IconButton(
      constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
      icon: const Icon(Icons.download_outlined, color: Colors.white70),
      onPressed: () => _start(context),
    );
  }
}

class _TitleScreenState extends State<TitleScreen> {
  late final CatalogService _catalog;
  Future<TitleDetail>? _future;
  bool _inList = false;

  @override
  void initState() {
    super.initState();
    _catalog = CatalogService(context.read<Auth>().api);
    _future = _catalog.title(widget.slug);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.name)),
      body: FutureBuilder<TitleDetail>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator(color: Color(0xFFE50914)));
          }
          if (snap.hasError) return const Center(child: Text('Could not load this title.'));
          final t = snap.data!;
          final img = t.bannerUrl ?? t.posterUrl;
          return ListView(
            padding: EdgeInsets.zero,
            children: [
              if (img != null)
                AspectRatio(aspectRatio: 16 / 9, child: CachedNetworkImage(imageUrl: img, fit: BoxFit.cover)),
              Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(t.name, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
                    const SizedBox(height: 6),
                    Text(
                      [t.kind[0].toUpperCase() + t.kind.substring(1), if (t.genres.isNotEmpty) t.genres.join(' · ')].join('  •  '),
                      style: const TextStyle(color: Colors.white54, fontSize: 13),
                    ),
                    const SizedBox(height: 14),
                    Row(children: [
                      Expanded(
                        child: FilledButton.icon(
                          onPressed: t.firstPlayable == null
                              ? null
                              : () => PlayerScreen.open(context, t.firstPlayable!.id),
                          icon: const Icon(Icons.play_arrow),
                          label: Text(t.firstPlayable == null ? 'Not available' : 'Play'),
                        ),
                      ),
                      const SizedBox(width: 12),
                      OutlinedButton.icon(
                        onPressed: () async {
                          try {
                            _inList ? await _catalog.removeFromMyList(t.id) : await _catalog.addToMyList(t.id);
                            setState(() => _inList = !_inList);
                          } catch (_) {}
                        },
                        icon: Icon(_inList ? Icons.check : Icons.add),
                        label: const Text('My List'),
                      ),
                    ]),
                    if (t.kind != 'series' && t.firstPlayable != null) ...[
                      const SizedBox(height: 10),
                      _DownloadButton(
                        episodeId: t.firstPlayable!.id,
                        titleId: t.id,
                        titleName: t.name,
                        episodeLabel: 'Film',
                        posterUrl: t.posterUrl,
                        expanded: true,
                      ),
                    ],
                    if (t.description != null) ...[
                      const SizedBox(height: 16),
                      Text(t.description!, style: const TextStyle(color: Colors.white70, height: 1.4)),
                    ],
                    if (t.kind == 'series' && t.episodes.isNotEmpty) ...[
                      const SizedBox(height: 20),
                      const Text('Episodes', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                      const SizedBox(height: 8),
                      for (final e in t.episodes)
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: CircleAvatar(backgroundColor: const Color(0xFF1A1A1A), child: Text('${e.number}')),
                          title: Text(e.name ?? 'Episode ${e.number}'),
                          subtitle: Text(e.ready ? 'Ready' : 'Processing…', style: TextStyle(color: e.ready ? Colors.white54 : Colors.orangeAccent)),
                          trailing: e.ready
                              ? Row(mainAxisSize: MainAxisSize.min, children: [
                                  _DownloadButton(
                                    episodeId: e.id,
                                    titleId: t.id,
                                    titleName: t.name,
                                    episodeLabel: e.name ?? 'Episode ${e.number}',
                                    posterUrl: t.posterUrl,
                                  ),
                                  const SizedBox(width: 4),
                                  const Icon(Icons.play_arrow),
                                ])
                              : null,
                          onTap: e.ready ? () => PlayerScreen.open(context, e.id) : null,
                        ),
                    ],
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
