import '../core/api_client.dart';
import '../models/models.dart';

/// Catalogue + playback API calls.
class CatalogService {
  CatalogService(this._api);
  final ApiClient _api;

  Future<HomeData> home() async {
    final res = await _api.request('/home', auth: false);
    return HomeData.fromJson(res.data);
  }

  Future<List<TitleCard>> browse({String? kind, String? genre, String? q, int page = 1}) async {
    final res = await _api.request('/titles', auth: false, query: {
      if (kind != null) 'kind': kind,
      if (genre != null) 'genre': genre,
      if (q != null && q.isNotEmpty) 'q': q,
      'page': page,
      'per_page': 30,
    });
    final items = (res.data['items'] as List?) ?? [];
    return items.map((t) => TitleCard.fromJson(t)).toList();
  }

  Future<TitleDetail> title(String slug) async {
    final res = await _api.request('/titles/$slug', auth: false);
    return TitleDetail.fromJson(res.data);
  }

  Future<List<TitleCard>> similar(String slug) async {
    final res = await _api.request('/titles/$slug/similar', auth: false);
    final list = res.data is List ? res.data as List : ((res.data['items'] as List?) ?? []);
    return list.map((t) => TitleCard.fromJson(t)).toList();
  }

  /// Start playback. Throws ApiException(402) when the user isn't entitled,
  /// or ApiException(409) when the account is already at its simultaneous
  /// stream limit — the message from the server names how many devices.
  Future<PlayInfo> play(String episodeId) async {
    final res = await _api.request('/episodes/$episodeId/play', method: 'POST');
    return PlayInfo.fromJson(res.data);
  }

  Future<void> saveProgress(String episodeId, int positionSecs) async {
    await _api.request('/episodes/$episodeId/progress', method: 'PUT', data: {'positionSecs': positionSecs});
  }

  /// Give the concurrent-stream slot back immediately. Best-effort: the
  /// server expires the lease on its own if this never arrives, so a failure
  /// here costs at most a minute of a slot staying held.
  Future<void> releaseStream() async {
    try {
      await _api.request('/playback/stream', method: 'DELETE');
    } catch (_) {
      /* nothing useful to do; the lease times out server-side */
    }
  }

  Future<List<ContinueItem>> continueWatching() async {
    final res = await _api.request('/me/continue-watching');
    final list = (res.data as List?) ?? [];
    return list.map((c) => ContinueItem.fromJson(c)).toList();
  }

  Future<List<TitleCard>> myList() async {
    final res = await _api.request('/me/my-list');
    return ((res.data as List?) ?? []).map((t) => TitleCard.fromJson(t)).toList();
  }

  Future<void> addToMyList(String titleId) => _api.request('/me/my-list/$titleId', method: 'POST');
  Future<void> removeFromMyList(String titleId) => _api.request('/me/my-list/$titleId', method: 'DELETE');
}
