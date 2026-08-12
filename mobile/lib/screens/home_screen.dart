import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../core/auth.dart';
import '../models/models.dart';
import '../services/catalog.dart';
import '../widgets/title_card.dart';
import 'title_screen.dart';
import 'player_screen.dart';
import 'search_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late final CatalogService _catalog;
  Future<HomeData>? _homeF;
  Future<List<ContinueItem>>? _continueF;

  @override
  void initState() {
    super.initState();
    _catalog = CatalogService(context.read<Auth>().api);
    _load();
  }

  void _load() {
    _homeF = _catalog.home();
    _continueF = _catalog.continueWatching().catchError((_) => <ContinueItem>[]);
  }

  Future<void> _refresh() async {
    setState(_load);
    await _homeF;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder<HomeData>(
          future: _homeF,
          builder: (context, snap) {
            if (snap.connectionState == ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator(color: Color(0xFFE50914)));
            }
            if (snap.hasError) {
              return _error(snap.error.toString());
            }
            final home = snap.data!;
            return CustomScrollView(
              slivers: [
                if (home.billboard != null) SliverToBoxAdapter(child: _Billboard(billboard: home.billboard!)),
                SliverToBoxAdapter(child: _ContinueRail(future: _continueF!)),
                for (final rail in home.rails)
                  SliverToBoxAdapter(child: _Rail(rail: rail)),
                const SliverToBoxAdapter(child: SizedBox(height: 24)),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _error(String msg) => ListView(children: [
        const SizedBox(height: 120),
        const Icon(Icons.wifi_off, color: Colors.white24, size: 48),
        const SizedBox(height: 12),
        const Center(child: Text('Could not load. Pull to retry.', style: TextStyle(color: Colors.white54))),
      ]);
}

class _Billboard extends StatelessWidget {
  const _Billboard({required this.billboard});
  final Billboard billboard;
  @override
  Widget build(BuildContext context) {
    final img = billboard.bannerUrl ?? billboard.posterUrl;
    return Stack(
      children: [
        SizedBox(
          height: 460,
          width: double.infinity,
          child: img != null
              ? CachedNetworkImage(imageUrl: img, fit: BoxFit.cover)
              : Container(color: const Color(0xFF1A1A1A)),
        ),
        Positioned.fill(
          child: DecoratedBox(
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [Colors.transparent, Color(0xCC0B0B0B), Color(0xFF0B0B0B)],
                stops: [0.4, 0.85, 1],
              ),
            ),
          ),
        ),
        Positioned(
          left: 16, right: 16, bottom: 20,
          child: Column(
            children: [
              Text(billboard.name,
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800)),
              const SizedBox(height: 12),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  FilledButton.icon(
                    onPressed: billboard.firstEpisodeId == null
                        ? () => _openTitle(context, billboard)
                        : () => PlayerScreen.open(context, billboard.firstEpisodeId!),
                    icon: const Icon(Icons.play_arrow),
                    label: const Text('Play'),
                  ),
                  const SizedBox(width: 12),
                  OutlinedButton.icon(
                    onPressed: () => _openTitle(context, billboard),
                    icon: const Icon(Icons.info_outline),
                    label: const Text('Info'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }

  void _openTitle(BuildContext context, TitleCard c) => Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => TitleScreen(slug: c.slug, name: c.name)),
      );
}

/// What a rail's key means as a browse filter, or null when the rail is not a
/// window onto a larger list.
class _RailFilter {
  const _RailFilter({this.kind, this.genre});
  final String? kind;
  final String? genre;
}

_RailFilter? _railFilter(String key) {
  if (key == 'movies') return const _RailFilter(kind: 'movie');
  if (key == 'series') return const _RailFilter(kind: 'series');
  if (key.startsWith('genre-')) return _RailFilter(genre: key.substring('genre-'.length));
  return null;
}

class _Rail extends StatelessWidget {
  const _Rail({required this.rail});
  final Rail rail;
  @override
  Widget build(BuildContext context) {
    if (rail.titles.isEmpty) return const SizedBox.shrink();
    // A rail carries at most twelve titles, so anything beyond that was
    // unreachable from the app. Rails that map to a filter get a way through
    // to the full list; 'new' and 'top10' are inherently short lists, not a
    // truncated view of something larger, so they get none.
    final filter = _railFilter(rail.key);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 20, 16, 10),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Expanded(
                child: Text(
                  rail.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
                ),
              ),
              if (filter != null)
                TextButton(
                  style: TextButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 6),
                    minimumSize: Size.zero,
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => SearchScreen(
                        heading: rail.name,
                        kind: filter.kind,
                        genre: filter.genre,
                      ),
                    ),
                  ),
                  child: const Text(
                    'View all  ›',
                    style: TextStyle(fontSize: 13, color: Colors.white70),
                  ),
                ),
            ],
          ),
        ),
        SizedBox(
          height: 180,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            itemCount: rail.titles.length,
            separatorBuilder: (_, __) => const SizedBox(width: 10),
            itemBuilder: (_, i) => TitleCardTile(card: rail.titles[i]),
          ),
        ),
      ],
    );
  }
}

class _ContinueRail extends StatelessWidget {
  const _ContinueRail({required this.future});
  final Future<List<ContinueItem>> future;
  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<ContinueItem>>(
      future: future,
      builder: (context, snap) {
        final items = snap.data ?? [];
        if (items.isEmpty) return const SizedBox.shrink();
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 20, 16, 10),
              child: Text('Continue Watching', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
            ),
            SizedBox(
              height: 130,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 16),
                itemCount: items.length,
                separatorBuilder: (_, __) => const SizedBox(width: 10),
                itemBuilder: (_, i) {
                  final it = items[i];
                  return GestureDetector(
                    onTap: () => PlayerScreen.open(context, it.episodeId, startAt: it.positionSecs),
                    child: SizedBox(
                      width: 200,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: ClipRRect(
                              borderRadius: BorderRadius.circular(6),
                              child: Stack(
                                fit: StackFit.expand,
                                children: [
                                  if (it.title.posterUrl != null || it.thumbnailUrl != null)
                                    CachedNetworkImage(imageUrl: (it.title.posterUrl ?? it.thumbnailUrl)!, fit: BoxFit.cover)
                                  else
                                    Container(color: const Color(0xFF1A1A1A)),
                                  const Align(alignment: Alignment.center, child: Icon(Icons.play_circle_fill, size: 40)),
                                  Align(
                                    alignment: Alignment.bottomCenter,
                                    child: LinearProgressIndicator(value: it.progress, color: const Color(0xFFE50914), backgroundColor: Colors.white24, minHeight: 3),
                                  ),
                                ],
                              ),
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(it.title.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12)),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        );
      },
    );
  }
}
