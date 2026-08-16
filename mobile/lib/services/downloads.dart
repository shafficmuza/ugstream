import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

import 'package:dio/dio.dart';

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

  /// How long this copy may still be watched offline, in words. Netflix shows
  /// this because the alternative — discovering it on a plane — is the moment
  /// people stop trusting downloads.
  String get expiryLabel {
    final left = validUntil.difference(DateTime.now());
    if (left.isNegative) return 'Expired';
    // Rounded up, not truncated: 8 days and 23 hours is "9 days" to a person,
    // and truncating always under-reports the time they actually have.
    final days = (left.inMinutes / (60 * 24)).ceil();
    if (days >= 2) return 'Expires in $days days';
    final hours = (left.inMinutes / 60).ceil();
    if (hours >= 2) return 'Expires in $hours hours';
    return 'Expires soon';
  }

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

/// Bytes as a person would say them.
String formatBytes(int bytes) {
  if (bytes >= 1 << 30) return '${(bytes / (1 << 30)).toStringAsFixed(1)} GB';
  if (bytes >= 1 << 20) return '${(bytes / (1 << 20)).toStringAsFixed(0)} MB';
  if (bytes >= 1024) return '${(bytes / 1024).toStringAsFixed(0)} KB';
  return '$bytes B';
}

/// Progress of a download in flight, for the UI to render.
class DownloadProgress {
  DownloadProgress(this.received, this.total, {this.preparing = false, this.queued = false});
  final int received;
  final int total;

  /// Cloudflare is still producing the MP4 rendition — nothing to fetch yet.
  /// This takes minutes per episode, which is why it needs to be said out
  /// loud rather than left as a spinning ring.
  final bool preparing;

  /// Waiting for the transfer ahead of it to finish.
  final bool queued;

  double get fraction => total > 0 ? received / total : 0;

  /// What the viewer should be told, in a couple of words.
  String get label {
    if (queued) return 'Queued';
    if (preparing) return 'Preparing…';
    if (total <= 0) return 'Downloading…';
    final pct = 'Downloading ${(fraction * 100).round()}%';
    // Sizes are reassuring on a video and noise on anything small — a
    // percentage alone on a 700MB film reads as stalled.
    if (total < 1 << 20) return pct;
    return '$pct · ${formatBytes(received)} of ${formatBytes(total)}';
  }
}

/// One queued request, with the future its caller is awaiting.
class _DownloadJob {
  _DownloadJob({
    required this.episodeId,
    required this.titleId,
    required this.titleName,
    required this.episodeLabel,
    required this.posterUrl,
    required this.completer,
  });
  final String episodeId;
  final String titleId;
  final String titleName;
  final String episodeLabel;
  final String? posterUrl;
  final Completer<void> completer;
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
  final List<_DownloadJob> _queue = [];
  /// Metadata for everything queued or transferring, so the Downloads screen
  /// can list work in progress and not just finished files.
  final Map<String, _DownloadJob> _pending = {};
  /// Live transfers, so a download can be stopped mid-flight.
  final Map<String, CancelToken> _cancels = {};
  bool _draining = false;
  bool _loaded = false;

  List<DownloadEntry> get entries => List.unmodifiable(_entries);
  DownloadProgress? progressOf(String episodeId) => _inFlight[episodeId];
  bool isDownloaded(String episodeId) => _entries.any((e) => e.episodeId == episodeId);

  /// Downloads that are queued or transferring right now, in queue order.
  List<({String episodeId, String titleName, String episodeLabel, String? posterUrl, DownloadProgress progress})>
      get inFlight => [
            for (final id in _pending.keys)
              if (_inFlight[id] != null)
                (
                  episodeId: id,
                  titleName: _pending[id]!.titleName,
                  episodeLabel: _pending[id]!.episodeLabel,
                  posterUrl: _pending[id]!.posterUrl,
                  progress: _inFlight[id]!,
                ),
          ];

  /// One line describing this episode's download state, or null when there is
  /// nothing to say. Every surface uses this, so a queued episode in a series
  /// list reads the same as one on a film page.
  String? statusLabel(String episodeId) {
    if (isDownloaded(episodeId)) return 'Downloaded';
    return _inFlight[episodeId]?.label;
  }

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

      // Sweep partial files left by a download that was killed with the app.
      // Nothing resumes them across launches, so they are pure wasted space.
      final dir = await _dir();
      await for (final f in dir.list()) {
        if (f is File && f.path.endsWith('.part')) {
          await f.delete().catchError((_) => f);
        }
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
  }) {
    if (isDownloaded(episodeId) || _inFlight.containsKey(episodeId)) {
      return Future.value();
    }

    // Queued, not started. Transfers run one at a time: tapping six episodes
    // of a series used to start six competing downloads, so every one of them
    // crawled and the ring on each looked stuck.
    final job = _DownloadJob(
      episodeId: episodeId,
      titleId: titleId,
      titleName: titleName,
      episodeLabel: episodeLabel,
      posterUrl: posterUrl,
      completer: Completer<void>(),
    );
    _queue.add(job);
    _pending[episodeId] = job;
    _inFlight[episodeId] = DownloadProgress(0, 0, queued: _queue.length > 1 || _draining);
    notifyListeners();

    // The caller keeps its own future, so a 402 on one episode still reaches
    // the button that was tapped rather than whichever download is running.
    unawaited(_drain());
    return job.completer.future;
  }

  Future<void> _drain() async {
    if (_draining) return;
    _draining = true;
    try {
      while (_queue.isNotEmpty) {
        final job = _queue.removeAt(0);
        try {
          await _run(job);
          if (!job.completer.isCompleted) job.completer.complete();
        } catch (e, st) {
          if (!job.completer.isCompleted) job.completer.completeError(e, st);
        } finally {
          _inFlight.remove(job.episodeId);
          _pending.remove(job.episodeId);
          // Whatever is now at the head of the queue stops being 'queued'.
          if (_queue.isNotEmpty) {
            final next = _queue.first.episodeId;
            _inFlight[next] = DownloadProgress(0, 0, preparing: true);
          }
          notifyListeners();
        }
      }
    } finally {
      _draining = false;
    }
  }

  Future<void> _run(_DownloadJob job) async {
    final episodeId = job.episodeId;
    _inFlight[episodeId] = DownloadProgress(0, 0, preparing: true);
    notifyListeners();

    // Phase 1: the rendition. Cloudflare builds one MP4 per video on first
    // request and it takes minutes, so this phase is announced rather than
    // left as an unexplained spinner. Bounded: half an hour is a fault.
    Map<String, dynamic> info;
    var waited = Duration.zero;
    while (true) {
      final res = await _api.request('/episodes/$episodeId/download', method: 'POST');
      info = (res.data as Map).cast<String, dynamic>();
      if (info['status'] == 'ready') break;
      if (waited > const Duration(minutes: 30)) {
        throw ApiException(504, 'The download could not be prepared. Try again later.', null);
      }
      const step = Duration(seconds: 5);
      await Future.delayed(step);
      waited += step;
    }

    // Phase 2: the bytes, resumably.
    final dir = await _dir();
    final path = '${dir.path}/$episodeId.mp4';
    final tmpPath = '$path.part';
    await _transfer(episodeId, info['url'] as String, tmpPath);
    await File(tmpPath).rename(path);

    _entries.add(DownloadEntry(
      episodeId: episodeId,
      titleId: job.titleId,
      titleName: job.titleName,
      episodeLabel: job.episodeLabel,
      filePath: path,
      sizeBytes: await File(path).length(),
      downloadedAt: DateTime.now(),
      validUntil: DateTime.parse(info['validUntil'] as String),
      posterUrl: job.posterUrl,
    ));
    await _persist();
  }

  /// Fetch [url] into [tmpPath], resuming a partial file and retrying a
  /// dropped connection.
  ///
  /// Written by hand rather than handed to Dio's `download` because all three
  /// behaviours matter on a Ugandan mobile connection and none is free: a
  /// 700MB film that restarts from zero every time the signal dips will never
  /// finish, and the data it wasted was paid for.
  Future<void> _transfer(String episodeId, String url, String tmpPath) async {
    final file = File(tmpPath);
    const maxAttempts = 4;

    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
      final already = await file.exists() ? await file.length() : 0;
      final token = CancelToken();
      _cancels[episodeId] = token;

      try {
        final res = await _api.dio.get<ResponseBody>(
          url,
          cancelToken: token,
          options: Options(
            responseType: ResponseType.stream,
            followRedirects: true,
            // Ask only for the part we are missing. A server that honours it
            // answers 206; one that ignores it answers 200 with the whole
            // file, which is handled below rather than silently appended to
            // what we already had — that would corrupt the video.
            headers: already > 0 ? {'range': 'bytes=$already-'} : null,
            validateStatus: (code) => code != null && code >= 200 && code < 400,
          ),
        );

        final resumed = res.statusCode == 206 && already > 0;
        final sink = file.openWrite(mode: resumed ? FileMode.append : FileMode.write);
        var received = resumed ? already : 0;

        // Content-Length covers only the remaining bytes on a 206.
        final lenHeader = res.headers.value(Headers.contentLengthHeader);
        final remaining = int.tryParse(lenHeader ?? '') ?? -1;
        final total = remaining < 0 ? -1 : (resumed ? already + remaining : remaining);

        try {
          await for (final chunk in res.data!.stream) {
            sink.add(chunk);
            received += chunk.length;
            _inFlight[episodeId] = DownloadProgress(received, total);
            notifyListeners();
          }
          await sink.flush();
        } finally {
          await sink.close();
        }
        _cancels.remove(episodeId);
        return;
      } on DioException catch (e) {
        _cancels.remove(episodeId);
        if (CancelToken.isCancel(e)) rethrow;
        if (attempt == maxAttempts) rethrow;
        // Keep the partial file: the next attempt resumes from it.
        _inFlight[episodeId] = DownloadProgress(already, -1);
        notifyListeners();
        await Future.delayed(Duration(seconds: attempt * 3));
      }
    }
  }

  /// Stop a download and discard what has been fetched so far.
  Future<void> cancel(String episodeId) async {
    _queue.removeWhere((j) => j.episodeId == episodeId);
    _cancels.remove(episodeId)?.cancel('cancelled by user');
    _inFlight.remove(episodeId);
    final job = _pending.remove(episodeId);
    if (job != null && !job.completer.isCompleted) job.completer.complete();
    try {
      final dir = await _dir();
      final part = File('${dir.path}/$episodeId.mp4.part');
      if (await part.exists()) await part.delete();
    } catch (_) {}
    notifyListeners();
  }

  /// Total bytes held by finished downloads.
  int get totalBytes => _entries.fold(0, (sum, e) => sum + e.sizeBytes);

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
