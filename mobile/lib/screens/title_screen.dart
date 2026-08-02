import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../core/auth.dart';
import '../models/models.dart';
import '../services/catalog.dart';
import 'player_screen.dart';

class TitleScreen extends StatefulWidget {
  const TitleScreen({super.key, required this.slug, required this.name});
  final String slug;
  final String name;
  @override
  State<TitleScreen> createState() => _TitleScreenState();
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
                          trailing: e.ready ? const Icon(Icons.play_arrow) : null,
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
