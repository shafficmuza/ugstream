import 'dart:async';
import 'package:flutter/material.dart';
import 'dart:io' show Platform;
import 'package:flutter_chrome_cast/flutter_chrome_cast.dart';
import 'package:url_launcher/url_launcher.dart';

/// Chromecast button + device picker.
///
/// Casting hands the *stream URL* to the TV, which fetches it directly — so it
/// only works with publicly reachable URLs (our R2/HLS content). The receiver
/// is Google's Default Media Receiver, which plays standard HLS/MP4, so no
/// custom receiver app is needed.
class CastButton extends StatefulWidget {
  const CastButton({
    super.key,
    required this.streamUrl,
    required this.title,
    this.posterUrl,
    this.startAtSeconds = 0,
    this.onCastStarted,
  });

  final String streamUrl;
  final String title;
  final String? posterUrl;
  final int startAtSeconds;
  final VoidCallback? onCastStarted;

  @override
  State<CastButton> createState() => _CastButtonState();
}

class _CastButtonState extends State<CastButton> {
  StreamSubscription? _sessionSub;
  bool _connected = false;
  bool _initialised = false;
  String? _initError;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    try {
      // Default Media Receiver — plays HLS/MP4 without a custom receiver app.
      const appId = GoogleCastDiscoveryCriteria.kDefaultApplicationId;
      final GoogleCastOptions options = Platform.isIOS
          ? IOSGoogleCastOptions(
              GoogleCastDiscoveryCriteriaInitialize.initWithApplicationID(appId),
              stopCastingOnAppTerminated: true,
            )
          : GoogleCastOptionsAndroid(appId: appId, stopCastingOnAppTerminated: true);
      await GoogleCastContext.instance.setSharedInstanceWithOptions(options);

      // Discovery runs from here rather than from the picker. mDNS browsing
      // takes seconds, not milliseconds, and starting it only on tap meant the
      // sheet opened onto an empty list and looked broken even where a
      // Chromecast was sitting on the same network.
      //
      // On iOS this is also what triggers the Local Network permission
      // prompt — asking while the viewer is looking at a device list they
      // expected to be populated is the worst moment for it.
      GoogleCastDiscoveryManager.instance.startDiscovery();

      _sessionSub = GoogleCastSessionManager.instance.currentSessionStream.listen((session) {
        final connected = session?.connectionState == GoogleCastConnectState.connected;
        if (mounted && connected != _connected) setState(() => _connected = connected);
      });
      if (mounted) setState(() => _initialised = true);
    } catch (e) {
      // Cast genuinely unavailable (no Play Services, SDK missing) — hide the
      // button rather than break playback, but keep why, so the picker can say
      // something better than "searching" forever.
      _initError = '$e';
    }
  }

  @override
  void dispose() {
    _sessionSub?.cancel();
    super.dispose();
  }

  Future<void> _openPicker() async {
    try {
      GoogleCastDiscoveryManager.instance.startDiscovery();
      // Give discovery a moment to find devices on the network.
      await Future<void>.delayed(const Duration(milliseconds: 1200));
      if (!mounted) return;

      final device = await showModalBottomSheet<GoogleCastDevice>(
        context: context,
        backgroundColor: const Color(0xFF141414),
        builder: (ctx) => SafeArea(
          child: StreamBuilder<List<GoogleCastDevice>>(
            stream: GoogleCastDiscoveryManager.instance.devicesStream,
            builder: (ctx, snap) {
              final devices = snap.data ?? const <GoogleCastDevice>[];
              return Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Padding(
                    padding: EdgeInsets.all(16),
                    child: Text('Cast to', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                  ),
                  if (devices.isEmpty) _emptyState(),
                  for (final d in devices)
                    ListTile(
                      leading: const Icon(Icons.tv),
                      title: Text(d.friendlyName),
                      onTap: () => Navigator.of(ctx).pop(d),
                    ),
                  if (_connected)
                    ListTile(
                      leading: const Icon(Icons.stop_circle_outlined, color: Colors.redAccent),
                      title: const Text('Stop casting', style: TextStyle(color: Colors.redAccent)),
                      onTap: () {
                        GoogleCastSessionManager.instance.endSessionAndStopCasting();
                        Navigator.of(ctx).pop();
                      },
                    ),
                ],
              );
            },
          ),
        ),
      );

      if (device == null) return;
      await GoogleCastSessionManager.instance.startSessionWithDevice(device);
      await GoogleCastRemoteMediaClient.instance.loadMedia(
        GoogleCastMediaInformationIOS(
          contentId: widget.streamUrl,
          contentUrl: Uri.parse(widget.streamUrl),
          streamType: CastMediaStreamType.buffered,
          contentType: widget.streamUrl.contains('.m3u8')
              ? 'application/x-mpegURL'
              : 'video/mp4',
          metadata: GoogleCastMovieMediaMetadata(
            title: widget.title,
            images: [
              if (widget.posterUrl != null) GoogleCastImage(url: Uri.parse(widget.posterUrl!)),
            ],
          ),
        ),
        autoPlay: true,
        playPosition: Duration(seconds: widget.startAtSeconds),
      );
      widget.onCastStarted?.call();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not cast: $e')),
        );
      }
    }
  }

  /// What to say when discovery has found nothing.
  ///
  /// "Searching…" was the only message, and it never stopped being true, so a
  /// viewer whose phone simply is not allowed to look had no way to tell that
  /// from a slow network. On iOS an empty list nearly always means the Local
  /// Network permission was declined — it is asked once, silently fails
  /// forever after, and can only be restored from Settings, so the sheet has
  /// to say so and offer the way there.
  Widget _emptyState() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (_initError != null)
            Text('Casting is unavailable on this device.\n$_initError',
                style: const TextStyle(color: Colors.white54))
          else ...[
            const Text('No devices found yet.',
                style: TextStyle(color: Colors.white70, fontWeight: FontWeight.w600)),
            const SizedBox(height: 6),
            Text(
              Platform.isIOS
                  ? 'Your Chromecast must be on the same Wi-Fi network, and Muza Watch '
                    'needs permission to find devices on it.'
                  : 'Your Chromecast must be on the same Wi-Fi network — casting does '
                    'not work over mobile data.',
              style: const TextStyle(color: Colors.white54, fontSize: 13.5, height: 1.45),
            ),
            if (Platform.isIOS) ...[
              const SizedBox(height: 10),
              TextButton.icon(
                onPressed: () => launchUrl(Uri.parse('app-settings:'),
                    mode: LaunchMode.externalApplication),
                icon: const Icon(Icons.settings, size: 18),
                label: const Text('Open Settings → Local Network'),
              ),
            ],
          ],
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (!_initialised) return const SizedBox.shrink();
    return Container(
      width: 54,
      height: 54,
      decoration: const BoxDecoration(color: Colors.black54, shape: BoxShape.circle),
      child: IconButton(
        iconSize: 28,
        icon: Icon(
          _connected ? Icons.cast_connected : Icons.cast,
          color: _connected ? const Color(0xFFE50914) : Colors.white,
        ),
        tooltip: 'Cast to TV',
        onPressed: _openPicker,
      ),
    );
  }
}
