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
  });

  test('an unknown content length still says something honest', () {
    // Never "0%", which reads as stuck.
    expect(DownloadProgress(1024, 0).label, 'Downloading…');
    expect(DownloadProgress(1024, -1).label, 'Downloading…');
  });

  test('fraction never divides by a missing total', () {
    expect(DownloadProgress(10, 0).fraction, 0);
    expect(DownloadProgress(10, -1).fraction, 0);
    expect(DownloadProgress(10, 100).fraction, 0.1);
  });
}
