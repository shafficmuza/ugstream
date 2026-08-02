import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import '../models/models.dart';
import '../screens/title_screen.dart';

/// A poster tile (2:3) used across rails and grids.
class TitleCardTile extends StatelessWidget {
  const TitleCardTile({super.key, required this.card, this.width = 120});
  final TitleCard card;
  final double width;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => TitleScreen(slug: card.slug, name: card.name)),
      ),
      child: SizedBox(
        width: width,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(6),
          child: AspectRatio(
            aspectRatio: 2 / 3,
            child: card.posterUrl != null
                ? CachedNetworkImage(
                    imageUrl: card.posterUrl!,
                    fit: BoxFit.cover,
                    placeholder: (_, __) => Container(color: const Color(0xFF1A1A1A)),
                    errorWidget: (_, __, ___) => _fallback(card.name),
                  )
                : _fallback(card.name),
          ),
        ),
      ),
    );
  }

  Widget _fallback(String name) => Container(
        color: const Color(0xFF1A1A1A),
        alignment: Alignment.center,
        padding: const EdgeInsets.all(8),
        child: Text(name, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white54, fontSize: 12)),
      );
}
