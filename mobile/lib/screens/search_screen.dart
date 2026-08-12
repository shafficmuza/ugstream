import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../core/auth.dart';
import '../models/models.dart';
import '../services/catalog.dart';
import '../widgets/title_card.dart';

/// Browse and search, in one screen.
///
/// The home rails cap at twelve titles each, so most of the catalogue could
/// not be reached from the app at all — there was no "see the rest". Opened
/// with no filter it is the search screen; opened with a [kind] or [genre] it
/// is that rail's full list, which is what the "View all" links use.
///
/// Either way it starts by showing titles rather than an empty state: an empty
/// query means "everything", not "nothing", and pages in more as you scroll,
/// so the whole catalogue is reachable.
class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key, this.heading, this.kind, this.genre});

  /// Shown instead of the search field when browsing a specific rail.
  final String? heading;
  final String? kind;
  final String? genre;

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  late final CatalogService _catalog;
  final _ctrl = TextEditingController();
  final _scroll = ScrollController();
  Timer? _debounce;

  final List<TitleCard> _results = [];
  int _page = 1;
  bool _busy = false;
  bool _end = false;
  String _query = '';

  /// Matches the API's per_page, so a short page means there is no more.
  static const _pageSize = 30;

  @override
  void initState() {
    super.initState();
    _catalog = CatalogService(context.read<Auth>().api);
    _scroll.addListener(_onScroll);
    _load(reset: true);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _scroll.dispose();
    _ctrl.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_busy || _end) return;
    // Fetch before the user reaches the bottom, so scrolling stays continuous.
    if (_scroll.position.pixels > _scroll.position.maxScrollExtent - 600) {
      _load();
    }
  }

  void _onChanged(String q) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () {
      _query = q.trim();
      _load(reset: true);
    });
  }

  Future<void> _load({bool reset = false}) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      if (reset) {
        _page = 1;
        _end = false;
        _results.clear();
      }
    });
    try {
      final batch = await _catalog.browse(
        kind: widget.kind,
        genre: widget.genre,
        q: _query.isEmpty ? null : _query,
        page: _page,
      );
      if (!mounted) return;
      setState(() {
        _results.addAll(batch);
        _end = batch.length < _pageSize;
        _page += 1;
      });
    } catch (_) {
      if (mounted) setState(() => _end = true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final browsingRail = widget.heading != null;
    return Scaffold(
      appBar: AppBar(
        title: browsingRail
            ? Text(widget.heading!)
            : TextField(
                controller: _ctrl,
                autofocus: false,
                onChanged: _onChanged,
                decoration: const InputDecoration(
                  hintText: 'Search titles, genres…',
                  border: InputBorder.none,
                ),
              ),
        actions: [
          if (!browsingRail && _query.isNotEmpty)
            IconButton(
              icon: const Icon(Icons.close),
              tooltip: 'Clear',
              onPressed: () {
                _ctrl.clear();
                _query = '';
                _load(reset: true);
              },
            ),
        ],
      ),
      body: _results.isEmpty && _busy
          ? const Center(child: CircularProgressIndicator(color: Color(0xFFE50914)))
          : _results.isEmpty
              ? Center(
                  child: Text(
                    _query.isEmpty ? 'Nothing here yet' : 'Nothing matches “$_query”',
                    style: const TextStyle(color: Colors.white38),
                  ),
                )
              : GridView.builder(
                  controller: _scroll,
                  padding: const EdgeInsets.all(12),
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 3,
                    childAspectRatio: 2 / 3,
                    crossAxisSpacing: 10,
                    mainAxisSpacing: 10,
                  ),
                  // One extra cell while more is loading, so the spinner sits
                  // at the end of the grid rather than replacing it.
                  itemCount: _results.length + (_busy ? 1 : 0),
                  itemBuilder: (_, i) => i >= _results.length
                      ? const Center(
                          child: SizedBox(
                            width: 22,
                            height: 22,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFFE50914)),
                          ),
                        )
                      : TitleCardTile(card: _results[i], width: double.infinity),
                ),
    );
  }
}
