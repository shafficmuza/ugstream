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
  final _focus = FocusNode();
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
    // The Cancel control only exists while the field has focus, so the screen
    // has to rebuild when that changes.
    _focus.addListener(() => setState(() {}));
    _load(reset: true);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _scroll.dispose();
    _ctrl.dispose();
    _focus.dispose();
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
      appBar: browsingRail
          ? AppBar(title: Text(widget.heading!))
          : AppBar(
              title: const Text('Search'),
              titleSpacing: 20,
              elevation: 0,
              backgroundColor: Colors.transparent,
            ),
      // The empty state and the count line are not scrollable, so a tap has to
      // work as well as a drag — otherwise a search that returns nothing is a
      // dead end with the keyboard still up.
      body: GestureDetector(
        behavior: HitTestBehavior.translucent,
        onTap: () => _focus.unfocus(),
        child: Column(
          children: [
            if (!browsingRail) _searchField(),
            if (_results.isNotEmpty) _countLine(),
            Expanded(child: _grid()),
          ],
        ),
      ),
    );
  }

  /// A proper search field rather than a bare input in the app bar: a rounded
  /// filled box with the icon inside it, which is what the control is expected
  /// to look like and gives the tap target some size on a phone.
  Widget _searchField() {
    final hasText = _ctrl.text.isNotEmpty;
    // The way out.
    //
    // This screen lives in the shell's IndexedStack, so its only exit is the
    // bottom navigation bar — and the keyboard sits on top of that. A viewer
    // who tapped the field and then changed their mind was stuck on Search
    // with no visible way back unless they happened to submit or drag the
    // grid. Cancel is the iOS convention here and costs nothing on Android.
    final showCancel = _focus.hasFocus || hasText;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
      child: Row(children: [
        Expanded(child: _searchBox(hasText)),
        if (showCancel)
          Padding(
            padding: const EdgeInsets.only(left: 4),
            child: TextButton(
              onPressed: () {
                _focus.unfocus();
                if (hasText) {
                  _ctrl.clear();
                  _query = '';
                  _load(reset: true);
                }
                setState(() {});
              },
              child: const Text('Cancel'),
            ),
          ),
      ]),
    );
  }

  Widget _searchBox(bool hasText) {
    return Padding(
      padding: EdgeInsets.zero,
      child: Material(
        color: const Color(0xFF1C1C1E),
        borderRadius: BorderRadius.circular(12),
        child: TextField(
          controller: _ctrl,
          onChanged: (q) {
            setState(() {}); // keeps the clear button in step with the text
            _onChanged(q);
          },
          textInputAction: TextInputAction.search,
          focusNode: _focus,
          onSubmitted: (q) {
            _query = q.trim();
            _load(reset: true);
            // Submitting is the end of typing. Without this the keyboard stays
            // up over the bottom navigation bar, and since this screen sits in
            // the shell's IndexedStack there is then no way back to Home.
            _focus.unfocus();
          },
          style: const TextStyle(fontSize: 15.5),
          cursorColor: const Color(0xFFE50914),
          decoration: InputDecoration(
            hintText: 'Titles, genres, VJs…',
            hintStyle: const TextStyle(color: Colors.white38, fontSize: 15),
            prefixIcon: const Icon(Icons.search, color: Colors.white54, size: 22),
            suffixIcon: hasText
                ? IconButton(
                    icon: const Icon(Icons.close, color: Colors.white54, size: 20),
                    tooltip: 'Clear',
                    onPressed: () {
                      _ctrl.clear();
                      _query = '';
                      setState(() {});
                      _load(reset: true);
                    },
                  )
                : null,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide.none,
            ),
            contentPadding: const EdgeInsets.symmetric(vertical: 14),
          ),
        ),
      ),
    );
  }

  /// What is being shown, so an empty box does not look like a failed search:
  /// with no query this screen is the whole catalogue, not "no results yet".
  Widget _countLine() {
    final label = _query.isEmpty
        ? 'All titles'
        : 'Results for “$_query”';
    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 0, 18, 8),
      child: Row(
        children: [
          Text(label,
              style: const TextStyle(fontSize: 12.5, color: Colors.white54, letterSpacing: 0.2)),
          const Spacer(),
          Text(_end ? '${_results.length}' : '${_results.length}+',
              style: const TextStyle(fontSize: 12.5, color: Colors.white38)),
        ],
      ),
    );
  }

  Widget _grid() {
    if (_results.isEmpty && _busy) {
      return const Center(child: CircularProgressIndicator(color: Color(0xFFE50914)));
    }
    if (_results.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(_query.isEmpty ? Icons.movie_outlined : Icons.search_off,
                  color: Colors.white24, size: 44),
              const SizedBox(height: 12),
              Text(
                _query.isEmpty ? 'Nothing here yet' : 'Nothing matches “$_query”',
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white38),
              ),
            ],
          ),
        ),
      );
    }
    return GridView.builder(
      controller: _scroll,
      // Drag-to-dismiss: the platform-standard gesture, and the one a viewer
      // reaches for first when the keyboard is covering what they came to see.
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 3,
        childAspectRatio: 2 / 3,
        crossAxisSpacing: 10,
        mainAxisSpacing: 10,
      ),
      // One extra cell while more is loading, so the spinner sits at the end of
      // the grid rather than replacing it.
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
    );
  }
}
