import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../core/auth.dart';
import '../models/models.dart';
import '../services/catalog.dart';
import '../widgets/title_card.dart';

class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key});
  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  late final CatalogService _catalog;
  final _ctrl = TextEditingController();
  Timer? _debounce;
  List<TitleCard> _results = [];
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _catalog = CatalogService(context.read<Auth>().api);
  }

  void _onChanged(String q) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () => _run(q));
  }

  Future<void> _run(String q) async {
    if (q.trim().isEmpty) {
      setState(() => _results = []);
      return;
    }
    setState(() => _busy = true);
    try {
      final r = await _catalog.browse(q: q.trim());
      setState(() => _results = r);
    } catch (_) {} finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: TextField(
          controller: _ctrl,
          autofocus: false,
          onChanged: _onChanged,
          decoration: const InputDecoration(hintText: 'Search titles, genres…', border: InputBorder.none),
        ),
      ),
      body: _busy
          ? const Center(child: CircularProgressIndicator(color: Color(0xFFE50914)))
          : _results.isEmpty
              ? const Center(child: Text('Search for something to watch', style: TextStyle(color: Colors.white38)))
              : GridView.builder(
                  padding: const EdgeInsets.all(12),
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 3, childAspectRatio: 2 / 3, crossAxisSpacing: 10, mainAxisSpacing: 10),
                  itemCount: _results.length,
                  itemBuilder: (_, i) => TitleCardTile(card: _results[i], width: double.infinity),
                ),
    );
  }
}
