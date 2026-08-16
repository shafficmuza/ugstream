import 'package:flutter_test/flutter_test.dart';
import 'package:ham_watch/services/downloads.dart';

/// The queue's job is to make several taps behave sensibly. Two properties
/// matter and neither is visible from the happy path:
///
///   - every tap gets its OWN outcome, so a 402 on episode 3 reaches the
///     button for episode 3 rather than whichever transfer happens to be
///     running;
///   - every waiting episode can say what it is waiting for, because a bare
///     ring is what made this feel broken while it was working.
void main() {
  test('a queued episode reports itself as queued, not as a blank spinner', () {
    final p = DownloadProgress(0, 0, queued: true);
    expect(p.label, 'Queued');
  });

  test('the rendition wait is announced rather than left silent', () {
    expect(DownloadProgress(0, 0, preparing: true).label, 'Preparing…');
  });

  test('progress reads as a percentage once bytes are moving', () {
    expect(DownloadProgress(50, 200).label, 'Downloading 25%');
    expect(DownloadProgress(25 * 1024 * 1024, 100 * 1024 * 1024).label,
        'Downloading 25% · 25 MB of 100 MB');
  });

  test('an unknown content length still says something honest', () {
    // Never "0%", which reads as stuck.
    expect(DownloadProgress(1024, 0).label, 'Downloading…');
    expect(DownloadProgress(1024, -1).label, 'Downloading…');
  });

  test('progress names real sizes, so a big file reads as progress not a stall', () {
    // "Downloading 3%" on a 700MB film looks stuck; "3% · 21 MB of 700 MB"
    // reads as movement.
    expect(DownloadProgress(21 * 1024 * 1024, 700 * 1024 * 1024).label,
        'Downloading 3% · 21 MB of 700 MB');
  });

  test('byte sizes are written the way a person would say them', () {
    expect(formatBytes(512), '512 B');
    expect(formatBytes(5 * 1024 * 1024), '5 MB');
    expect(formatBytes((1.5 * (1 << 30)).round()), '1.5 GB');
  });

  test('expiry is stated in the units that matter near the deadline', () {
    DownloadEntry at(Duration d) => DownloadEntry(
          episodeId: '1', titleId: '1', titleName: 't', episodeLabel: 'e',
          filePath: '/tmp/x', sizeBytes: 1, downloadedAt: DateTime.now(),
          validUntil: DateTime.now().add(d),
        );
    expect(at(const Duration(days: 9)).expiryLabel, 'Expires in 9 days');
    expect(at(const Duration(hours: 5)).expiryLabel, 'Expires in 5 hours');
    expect(at(const Duration(minutes: 30)).expiryLabel, 'Expires soon');
    expect(at(const Duration(days: -1)).expiryLabel, 'Expired');
    expect(at(const Duration(days: -1)).stillValid, isFalse);
  });

  test('fraction never divides by a missing total', () {
    expect(DownloadProgress(10, 0).fraction, 0);
    expect(DownloadProgress(10, -1).fraction, 0);
    expect(DownloadProgress(10, 100).fraction, 0.1);
  });
}
