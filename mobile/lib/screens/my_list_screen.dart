import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../core/auth.dart';
import '../models/models.dart';
import '../services/catalog.dart';
import '../widgets/title_card.dart';

class MyListScreen extends StatefulWidget {
  const MyListScreen({super.key});
  @override
  State<MyListScreen> createState() => _MyListScreenState();
}

class _MyListScreenState extends State<MyListScreen> {
  late final CatalogService _catalog;
  Future<List<TitleCard>>? _future;

  /// Removal is behind an explicit mode rather than a long-press.
  ///
  /// A hidden gesture is not a way out of a list — someone who saved a title
  /// by accident has to already know the trick to undo it. The toggle names
  /// itself in the app bar, and only then do the tiles grow a remove control.
  bool _editing = false;

  /// The list as last loaded, so a removal can be reflected without waiting
  /// for a round trip and without rebuilding a future mid-frame.
  List<TitleCard>? _items;

  @override
  void initState() {
    super.initState();
    _catalog = CatalogService(context.read<Auth>().api);
    _future = _catalog.myList();
  }

  Future<void> _reload() async {
    setState(() {
      _items = null;
      _future = _catalog.myList();
    });
  }

  /// Remove optimistically, and put it back if the server disagrees.
  ///
  /// The alternative — spinner, await, rebuild — makes tidying a list of ten
  /// feel like ten separate operations. Undo is offered because a mis-tap in
  /// edit mode is otherwise unrecoverable without hunting the title down again.
  Future<void> _remove(TitleCard card) async {
    final list = _items;
    if (list == null) return;
    final index = list.indexOf(card);
    if (index < 0) return;

    setState(() => list.removeAt(index));
    final messenger = ScaffoldMessenger.of(context);
    messenger.hideCurrentSnackBar();

    try {
      await _catalog.removeFromMyList(card.id);
      if (!mounted) return;
      messenger.showSnackBar(
        SnackBar(
          content: Text('Removed ${card.name}'),
          action: SnackBarAction(
            label: 'Undo',
            onPressed: () async {
              try {
                await _catalog.addToMyList(card.id);
              } finally {
                if (mounted) _reload();
              }
            },
          ),
        ),
      );
    } catch (_) {
      // Put it back: the list on screen must not claim something the server
      // still holds, or a refresh would silently resurrect it later.
      if (!mounted) return;
      setState(() => list.insert(index, card));
      messenger.showSnackBar(
        SnackBar(content: Text('Could not remove ${card.name}. Check your connection.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('My List'),
        actions: [
          // Only offered when there is something to remove — an Edit button
          // over an empty list is a control that cannot do anything.
          if ((_items ?? const []).isNotEmpty)
            TextButton(
              onPressed: () => setState(() => _editing = !_editing),
              child: Text(_editing ? 'Done' : 'Edit'),
            ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _reload,
        child: FutureBuilder<List<TitleCard>>(
          future: _future,
          builder: (context, snap) {
            if (snap.connectionState == ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator(color: Color(0xFFE50914)));
            }
            // Hold the loaded list so removals can edit it in place; the
            // future is only re-run on an explicit reload.
            _items ??= List<TitleCard>.from(snap.data ?? const <TitleCard>[]);
            final items = _items!;
            if (items.isEmpty) {
              return ListView(children: const [
                SizedBox(height: 120),
                Icon(Icons.bookmark_border, size: 48, color: Colors.white24),
                SizedBox(height: 12),
                Center(child: Text('Your list is empty', style: TextStyle(color: Colors.white38))),
              ]);
            }
            return GridView.builder(
              padding: const EdgeInsets.all(12),
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 3, childAspectRatio: 2 / 3, crossAxisSpacing: 10, mainAxisSpacing: 10),
              itemCount: items.length,
              itemBuilder: (_, i) => _tile(items[i]),
            );
          },
        ),
      ),
    );
  }

  /// A poster, with a remove badge over it while editing.
  ///
  /// The badge sits in the corner and absorbs its own taps, so editing never
  /// makes the poster itself unopenable by accident — the rest of the tile
  /// still behaves exactly as it does everywhere else in the app.
  Widget _tile(TitleCard card) {
    final tile = TitleCardTile(card: card, width: double.infinity);
    if (!_editing) return tile;
    return Stack(
      clipBehavior: Clip.none,
      children: [
        Positioned.fill(child: tile),
        Positioned(
          top: 4,
          right: 4,
          child: Semantics(
            button: true,
            label: 'Remove ${card.name} from My List',
            child: Material(
              color: Colors.black87,
              shape: const CircleBorder(),
              child: InkWell(
                customBorder: const CircleBorder(),
                onTap: () => _remove(card),
                child: const Padding(
                  padding: EdgeInsets.all(5),
                  child: Icon(Icons.close, size: 17, color: Colors.white),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

}
