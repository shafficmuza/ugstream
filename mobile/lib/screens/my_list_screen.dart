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

  @override
  void initState() {
    super.initState();
    _catalog = CatalogService(context.read<Auth>().api);
    _future = _catalog.myList();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('My List')),
      body: RefreshIndicator(
        onRefresh: () async => setState(() => _future = _catalog.myList()),
        child: FutureBuilder<List<TitleCard>>(
          future: _future,
          builder: (context, snap) {
            if (snap.connectionState == ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator(color: Color(0xFFE50914)));
            }
            final items = snap.data ?? [];
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
              itemBuilder: (_, i) => TitleCardTile(card: items[i], width: double.infinity),
            );
          },
        ),
      ),
    );
  }
}
