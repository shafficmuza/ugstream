import 'package:flutter_test/flutter_test.dart';
import 'package:ham_watch/models/models.dart';

void main() {
  test('TitleCard parses API shape', () {
    final c = TitleCard.fromJson({
      'id': 27, 'slug': '72-hours', 'name': '72 HOURS', 'kind': 'movie',
      'posterUrl': 'https://x/p.jpg', 'access': 'subscription', 'priceUgx': null,
      'releaseYear': 2024, 'firstEpisodeId': 26,
    });
    expect(c.id, '27');
    expect(c.slug, '72-hours');
    expect(c.firstEpisodeId, '26');
    expect(c.kind, 'movie');
  });

  test('HomeData parses billboard + rails', () {
    final h = HomeData.fromJson({
      'billboard': {'id': 1, 'slug': 's', 'name': 'N', 'kind': 'movie', 'description': 'd', 'bannerUrl': 'b'},
      'rails': [
        {'key': 'new', 'rail': 'New', 'titles': [{'id': 2, 'slug': 'a', 'name': 'A', 'kind': 'movie'}]},
      ],
    });
    expect(h.billboard!.name, 'N');
    expect(h.billboard!.description, 'd');
    expect(h.rails.length, 1);
    expect(h.rails.first.name, 'New');
    expect(h.rails.first.titles.first.slug, 'a');
  });

  test('PlayInfo shows S/E label only for series', () {
    final movie = PlayInfo.fromJson({
      'provider': 'r2_hls', 'playbackUrl': 'u', 'resumeAt': 30,
      'title': {'name': 'M', 'kind': 'movie'}, 'episode': {'season': 1, 'number': 1},
    });
    expect(movie.epLabel, isNull);
    expect(movie.resumeAt, 30);

    final series = PlayInfo.fromJson({
      'provider': 'cloudflare', 'playbackUrl': 'u', 'resumeAt': 0,
      'title': {'name': 'S', 'kind': 'series'}, 'episode': {'season': 2, 'number': 5},
    });
    expect(series.epLabel, 'S2 E5');
  });

  test('PlayInfo carries the server duration, and defaults to 0 without one', () {
    // The player clamps seeks against this rather than the duration read off
    // the HLS manifest, which can be a segment out or momentarily 0 — an
    // unguarded 0 upper bound sent every forward seek back to the start.
    final withDuration = PlayInfo.fromJson({
      'provider': 'cloudflare', 'playbackUrl': 'u', 'resumeAt': 0, 'durationSecs': 2598,
      'title': {'name': 'M', 'kind': 'movie'},
    });
    expect(withDuration.durationSecs, 2598);

    // An older backend that does not send the field must still parse.
    final without = PlayInfo.fromJson({
      'provider': 'cloudflare', 'playbackUrl': 'u', 'resumeAt': 0,
      'title': {'name': 'M', 'kind': 'movie'},
    });
    expect(without.durationSecs, 0);
  });

  test('ContinueItem computes progress', () {
    final c = ContinueItem.fromJson({
      'episodeId': 9, 'positionSecs': 300, 'durationSecs': 600,
      'title': {'slug': 's', 'name': 'n', 'kind': 'movie', 'posterUrl': null},
    });
    expect(c.progress, 0.5);
  });

  test('image URLs from the API are made absolute (native has no origin)', () {
    final c = TitleCard.fromJson({
      'id': 1, 'slug': 's', 'name': 'n', 'kind': 'movie',
      'posterUrl': '/api/uploads/images/x.jpg',
    });
    expect(c.posterUrl, startsWith('https://'));
    expect(c.posterUrl, endsWith('/api/uploads/images/x.jpg'));

    // Already-absolute URLs (e.g. R2/Cloudflare) pass through untouched.
    final abs = TitleCard.fromJson({
      'id': 2, 'slug': 's', 'name': 'n', 'kind': 'movie',
      'posterUrl': 'https://cdn.example.com/p.jpg',
    });
    expect(abs.posterUrl, 'https://cdn.example.com/p.jpg');

    // Null stays null rather than becoming a broken origin-only URL.
    final none = TitleCard.fromJson({'id': 3, 'slug': 's', 'name': 'n', 'kind': 'movie'});
    expect(none.posterUrl, isNull);
  });
}
