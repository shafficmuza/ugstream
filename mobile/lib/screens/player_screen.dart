import 'dart:async';
import 'package:chewie/chewie.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:video_player/video_player.dart';
import '../core/api_client.dart';
import '../core/auth.dart';
import '../models/models.dart';
import '../services/catalog.dart';
import 'subscribe_screen.dart';

class PlayerScreen extends StatefulWidget {
  const PlayerScreen({super.key, required this.episodeId, required this.play, this.startAt});
  final String episodeId;
  final PlayInfo play;
  final int? startAt;

  /// Resolve entitlement + playback, then open the player. On 402 (not
  /// entitled) routes to the subscribe screen instead.
  static Future<void> open(BuildContext context, String episodeId, {int? startAt}) async {
    final catalog = CatalogService(context.read<Auth>().api);
    showDialog(context: context, barrierDismissible: false, builder: (_) => const Center(child: CircularProgressIndicator(color: Color(0xFFE50914))));
    try {
      final play = await catalog.play(episodeId);
      if (context.mounted) Navigator.of(context).pop(); // dismiss loader
      if (context.mounted) {
        Navigator.of(context).push(MaterialPageRoute(
          builder: (_) => PlayerScreen(episodeId: episodeId, play: play, startAt: startAt),
        ));
      }
    } on ApiException catch (e) {
      if (context.mounted) Navigator.of(context).pop();
      if (e.statusCode == 402) {
        if (context.mounted) Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SubscribeScreen()));
      } else if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  @override
  State<PlayerScreen> createState() => _PlayerScreenState();
}

class _PlayerScreenState extends State<PlayerScreen> {
  VideoPlayerController? _video;
  ChewieController? _chewie;
  Timer? _progressTimer;
  late final CatalogService _catalog;

  @override
  void initState() {
    super.initState();
    _catalog = CatalogService(context.read<Auth>().api);
    SystemChrome.setPreferredOrientations([DeviceOrientation.landscapeLeft, DeviceOrientation.landscapeRight]);
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
    _init();
  }

  Future<void> _init() async {
    final v = VideoPlayerController.networkUrl(Uri.parse(widget.play.playbackUrl));
    _video = v;
    await v.initialize();
    final start = widget.startAt ?? widget.play.resumeAt;
    if (start > 0) await v.seekTo(Duration(seconds: start));
    setState(() {
      _chewie = ChewieController(
        videoPlayerController: v,
        autoPlay: true,
        // This screen IS the fullscreen player (landscape + immersive), so
        // Chewie's own fullscreen would push a nested route that hides our
        // back control — leaving iOS users with no way out (no system back).
        allowFullScreen: false,
        allowedScreenSleep: false,
        materialProgressColors: ChewieProgressColors(playedColor: const Color(0xFFE50914)),
      );
    });
    // Save resume position every 15s.
    _progressTimer = Timer.periodic(const Duration(seconds: 15), (_) => _saveProgress());
  }

  void _saveProgress() {
    final pos = _video?.value.position.inSeconds ?? 0;
    if (pos > 0) _catalog.saveProgress(widget.episodeId, pos).catchError((_) {});
  }

  @override
  void dispose() {
    _saveProgress();
    _progressTimer?.cancel();
    _chewie?.dispose();
    _video?.dispose();
    SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          Center(
            child: _chewie != null && _video!.value.isInitialized
                ? Chewie(controller: _chewie!)
                : const CircularProgressIndicator(color: Color(0xFFE50914)),
          ),
          // Explicit exit control: iOS has no system back button, and the
          // status bar is hidden here, so without this the player is a
          // dead end. Always visible, above the player chrome.
          Positioned(
            top: 8,
            left: 8,
            child: SafeArea(
              child: Row(
                children: [
                  Material(
                    color: Colors.black54,
                    shape: const CircleBorder(),
                    child: IconButton(
                      icon: const Icon(Icons.arrow_back, color: Colors.white),
                      tooltip: 'Back',
                      onPressed: () => Navigator.of(context).maybePop(),
                    ),
                  ),
                  if (widget.play.titleName != null)
                    Padding(
                      padding: const EdgeInsets.only(left: 10),
                      child: Text(
                        [widget.play.titleName, widget.play.epLabel].where((e) => e != null).join(' · '),
                        style: const TextStyle(color: Colors.white, fontSize: 14, shadows: [Shadow(blurRadius: 6)]),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
