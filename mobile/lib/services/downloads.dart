import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

import '../core/api_client.dart';

/// One saved video and what is known about it.
class DownloadEntry {
  DownloadEntry({
    required this.episodeId,
    required this.titleId,
    required this.titleName,
    required this.episodeLabel,
    required this.filePath,
    required this.sizeBytes,
    required this.downloadedAt,
    required this.validUntil,
    this.posterUrl,
  });

  final String episodeId;
  final String titleId;
  final String titleName;
  final String episodeLabel;
  final String filePath;
  final int sizeBytes;
  final DateTime downloadedAt;

  /// When the offline copy stops being playable without checking in online —
  /// the subscription's own expiry, handed down by the server. Enforced at
  /// play time, not at download time, exactly as Netflix does it: the file
  /// stays on disk, the right to watch it is what lapses.
  final DateTime validUntil;
  final String? posterUrl;

  bool get stillValid => DateTime.now().isBefore(validUntil);

  Map<String, dynamic> toJson() => {
        'episodeId': episodeId,
        'titleId': titleId,
        'titleName': titleName,
        'episodeLabel': episodeLabel,
        'filePath': filePath,
        'sizeBytes': sizeBytes,
        'downloadedAt': downloadedAt.toIso8601String(),
        'validUntil': validUntil.toIso8601String(),
        'posterUrl': posterUrl,
      };

  static DownloadEntry fromJson(Map<String, dynamic> j) => DownloadEntry(
        episodeId: j['episodeId'] as String,
        titleId: j['titleId'] as String,
        titleName: j['titleName'] as String,
        episodeLabel: j['episodeLabel'] as String,
        filePath: j['filePath'] as String,
        sizeBytes: (j['sizeBytes'] as num).toInt(),
        downloadedAt: DateTime.parse(j['downloadedAt'] as String),
        validUntil: DateTime.parse(j['validUntil'] as String),
        posterUrl: j['posterUrl'] as String?,
      );
}

/// Progress of a download in flight, for the UI to render.
class DownloadProgress {
  DownloadProgress(this.received, this.total, {this.preparing = false});
  final int received;
  final int total;

  /// Cloudflare is still producing the MP4 rendition — nothing to fetch yet.
  final bool preparing;

  double get fraction => total > 0 ? received / total : 0;
}

/// Owns every offline copy on this device: the files, the index that
/// describes them, and the transfers currently running.
///
/// The index is a JSON file next to the videos rather than a database —
/// tens of entries at most, rewritten atomically on every change, and
/// readable with no migration story when the app updates.
class DownloadsStore extends ChangeNotifier {
  DownloadsStore(this._api);
  final ApiClient _api;

  final List<DownloadEntry> _entries = [];
  final Map<String, DownloadProgress> _inFlight = {};
  bool _loaded = false;

  List<DownloadEntry> get entries => List.unmodifiable(_entries);
  DownloadProgress? progressOf(String episodeId) => _inFlight[episodeId];
  bool isDownloaded(String episodeId) => _entries.any((e) => e.episodeId == episodeId);

  Future<Directory> _dir() async {
    final docs = await getApplicationDocumentsDirectory();
    final d = Directory('${docs.path}/muza_downloads');
    if (!await d.exists()) await d.create(recursive: true);
    return d;
  }

  Future<File> _indexFile() async => File('${(await _dir()).path}/index.json');

  Future<void> load() async {
    if (_loaded) return;
    _loaded = true;
    try {
      final f = await _indexFile();
      if (await f.exists()) {
        final list = (jsonDecode(await f.readAsString()) as List).cast<Map<String, dynamic>>();
        _entries
          ..clear()
          ..addAll(list.map(DownloadEntry.fromJson));
        // Drop entries whose file vanished (OS cleared storage, user cleared
        // data) so the screen never lists a ghost it cannot play.
        _entries.removeWhere((e) => !File(e.filePath).existsSync());
      }
    } catch (_) {
      // A corrupt index loses the list, not the videos; re-downloading is the
      // recovery path, crashing on startup is not.
      _entries.clear();
    }
    notifyListeners();
  }

  Future<void> _persist() async {
    final f = await _indexFile();
    final tmp = File('${f.path}.tmp');
    await tmp.writeAsString(jsonEncode(_entries.map((e) => e.toJson()).toList()));
    await tmp.rename(f.path); // atomic: never a half-written index
  }

  /// Start (or continue waiting for) a download. Safe to call repeatedly.
  ///
  /// Two phases, both surfaced through [progressOf]: first the server may
  /// answer `preparing` while Cloudflare produces the MP4 — polled at a slow
  /// cadence because it takes minutes, not seconds — then the actual byte
  /// transfer with real progress. Throws ApiException(402) when the account
  /// is not entitled, which the caller routes exactly as it routes a play
  /// refusal.
  Future<void> download({
    required String episodeId,
    required String titleId,
    required String titleName,
    required String episodeLabel,
    String? posterUrl,
  }) async {
    if (isDownloaded(episodeId) || _inFlight.containsKey(episodeId)) return;
    _inFlight[episodeId] = DownloadProgress(0, 0, preparing: true);
    notifyListeners();

    try {
      // Phase 1: the rendition. Bounded: renditions for a feature film take
      // single-digit minutes; half an hour of "preparing" is a fault.
      Map<String, dynamic> info;
      var waited = Duration.zero;
      while (true) {
        final res = await _api.request('/episodes/$episodeId/download', method: 'POST');
        info = (res.data as Map).cast<String, dynamic>();
        if (info['status'] == 'ready') break;
        if (waited > const Duration(minutes: 30)) {
          throw ApiException(504, 'The download could not be prepared. Try again later.', null);
        }
        const step = Duration(seconds: 10);
        await Future.delayed(step);
        waited += step;
      }

      // Phase 2: the bytes.
      final dir = await _dir();
      final path = '${dir.path}/$episodeId.mp4';
      final tmpPath = '$path.part';
      await _api.dio.download(
        info['url'] as String,
        tmpPath,
        onReceiveProgress: (received, total) {
          _inFlight[episodeId] = DownloadProgress(received, total);
          notifyListeners();
        },
      );
      final file = File(tmpPath);
      await file.rename(path);

      _entries.add(DownloadEntry(
        episodeId: episodeId,
        titleId: titleId,
        titleName: titleName,
        episodeLabel: episodeLabel,
        filePath: path,
        sizeBytes: await File(path).length(),
        downloadedAt: DateTime.now(),
        validUntil: DateTime.parse(info['validUntil'] as String),
        posterUrl: posterUrl,
      ));
      await _persist();
    } finally {
      _inFlight.remove(episodeId);
      notifyListeners();
    }
  }

  Future<void> delete(String episodeId) async {
    final i = _entries.indexWhere((e) => e.episodeId == episodeId);
    if (i < 0) return;
    final entry = _entries.removeAt(i);
    try {
      final f = File(entry.filePath);
      if (await f.exists()) await f.delete();
    } catch (_) {}
    await _persist();
    notifyListeners();
  }

  /// Push validity forward after a successful online check-in — called when
  /// the app is online with a live session, so an active subscriber's
  /// downloads never lapse while a cancelled one's stop at their paid-up date.
  Future<void> revalidate() async {
    var changed = false;
    for (var i = 0; i < _entries.length; i++) {
      try {
        final res = await _api.request('/episodes/${_entries[i].episodeId}/download', method: 'POST');
        final info = (res.data as Map).cast<String, dynamic>();
        if (info['status'] == 'ready' && info['validUntil'] != null) {
          final e = _entries[i];
          _entries[i] = DownloadEntry(
            episodeId: e.episodeId,
            titleId: e.titleId,
            titleName: e.titleName,
            episodeLabel: e.episodeLabel,
            filePath: e.filePath,
            sizeBytes: e.sizeBytes,
            downloadedAt: e.downloadedAt,
            validUntil: DateTime.parse(info['validUntil'] as String),
            posterUrl: e.posterUrl,
          );
          changed = true;
        }
      } catch (_) {
        // Offline or refused — existing validity stands, and lapses on its own.
      }
    }
    if (changed) {
      await _persist();
      notifyListeners();
    }
  }
}
