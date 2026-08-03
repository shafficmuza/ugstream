import 'dart:async';
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
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (_) => const Center(child: CircularProgressIndicator(color: Color(0xFFE50914))),
    );
    try {
      final play = await catalog.play(episodeId);
      if (context.mounted) Navigator.of(context).pop();
      if (context.mounted) {
        Navigator.of(context).push(MaterialPageRoute(
          builder: (_) => PlayerScreen(episodeId: episodeId, play: play, startAt: startAt),
        ));
      }
    } on ApiException catch (e) {
      if (context.mounted) Navigator.of(context).pop();
      if (e.statusCode == 402) {
        if (context.mounted) {
          Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SubscribeScreen()));
        }
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
  Timer? _progressTimer;
  Timer? _hideTimer;
  late final CatalogService _catalog;

  bool _controlsVisible = true;
  bool _ready = false;
  /// Brief center icon flashed on tap (play/pause) or double-tap (seek).
  IconData? _flashIcon;

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
    await v.play();
    v.addListener(_onTick);
    if (mounted) setState(() => _ready = true);
    _scheduleHide();
    _progressTimer = Timer.periodic(const Duration(seconds: 15), (_) => _saveProgress());
  }

  void _onTick() {
    if (mounted) setState(() {}); // drives the scrubber/time labels
  }

  void _saveProgress() {
    final pos = _video?.value.position.inSeconds ?? 0;
    if (pos > 0) _catalog.saveProgress(widget.episodeId, pos).catchError((_) {});
  }

  void _scheduleHide() {
    _hideTimer?.cancel();
    // Controls linger while paused so the user can see what's going on.
    if (_video?.value.isPlaying != true) return;
    _hideTimer = Timer(const Duration(seconds: 3), () {
      if (mounted) setState(() => _controlsVisible = false);
    });
  }

  void _flash(IconData icon) {
    setState(() => _flashIcon = icon);
    Future.delayed(const Duration(milliseconds: 500), () {
      if (mounted) setState(() => _flashIcon = null);
    });
  }

  /// Netflix-style single tap: toggle play/pause and reveal the controls.
  void _togglePlay() {
    final v = _video;
    if (v == null || !v.value.isInitialized) return;
    if (v.value.isPlaying) {
      v.pause();
      _flash(Icons.pause);
      _hideTimer?.cancel();
      setState(() => _controlsVisible = true);
    } else {
      v.play();
      _flash(Icons.play_arrow);
      setState(() => _controlsVisible = true);
      _scheduleHide();
    }
  }

  void _seekBy(int seconds) {
    final v = _video;
    if (v == null || !v.value.isInitialized) return;
    final target = v.value.position + Duration(seconds: seconds);
    final max = v.value.duration;
    v.seekTo(target < Duration.zero ? Duration.zero : (target > max ? max : target));
    _flash(seconds < 0 ? Icons.replay_10 : Icons.forward_10);
    setState(() => _controlsVisible = true);
    _scheduleHide();
  }

  String _fmt(Duration d) {
    final h = d.inHours, m = d.inMinutes % 60, s = d.inSeconds % 60;
    final mm = m.toString().padLeft(2, '0'), ss = s.toString().padLeft(2, '0');
    return h > 0 ? '$h:$mm:$ss' : '$mm:$ss';
  }

  @override
  void dispose() {
    _saveProgress();
    _progressTimer?.cancel();
    _hideTimer?.cancel();
    _video?.removeListener(_onTick);
    _video?.dispose();
    SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final v = _video;
    final value = v?.value;
    final pos = value?.position ?? Duration.zero;
    final dur = value?.duration ?? Duration.zero;
    final playing = value?.isPlaying ?? false;

    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        fit: StackFit.expand,
        children: [
          Center(
            child: _ready && value != null && value.isInitialized
                ? AspectRatio(aspectRatio: value.aspectRatio, child: VideoPlayer(v!))
                : const CircularProgressIndicator(color: Color(0xFFE50914)),
          ),

          // Gesture layer: tap = play/pause, double-tap left/right = seek 10s.
          Row(
            children: [
              Expanded(
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: _togglePlay,
                  onDoubleTap: () => _seekBy(-10),
                ),
              ),
              Expanded(
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: _togglePlay,
                  onDoubleTap: () => _seekBy(10),
                ),
              ),
            ],
          ),

          // Center flash feedback for the last gesture.
          if (_flashIcon != null)
            Center(
              child: Container(
                padding: const EdgeInsets.all(16),
                decoration: const BoxDecoration(color: Colors.black45, shape: BoxShape.circle),
                child: Icon(_flashIcon, color: Colors.white, size: 52),
              ),
            ),

          // Buffering spinner while the player stalls mid-playback.
          if (_ready && (value?.isBuffering ?? false))
            const Center(child: CircularProgressIndicator(color: Color(0xFFE50914))),

          // Top chrome: back + title.
          AnimatedOpacity(
            opacity: _controlsVisible ? 1 : 0,
            duration: const Duration(milliseconds: 200),
            child: IgnorePointer(
              ignoring: !_controlsVisible,
              child: SafeArea(
                child: Padding(
                  padding: const EdgeInsets.all(8),
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
                        Expanded(
                          child: Padding(
                            padding: const EdgeInsets.only(left: 10),
                            child: Text(
                              [widget.play.titleName, widget.play.epLabel].where((e) => e != null).join(' · '),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(color: Colors.white, fontSize: 15, shadows: [Shadow(blurRadius: 6)]),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ),

          // Bottom chrome: big play/pause, seek buttons, scrubber, times.
          AnimatedOpacity(
            opacity: _controlsVisible ? 1 : 0,
            duration: const Duration(milliseconds: 200),
            child: IgnorePointer(
              ignoring: !_controlsVisible,
              child: Align(
                alignment: Alignment.bottomCenter,
                child: Container(
                  decoration: const BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [Colors.transparent, Colors.black87],
                    ),
                  ),
                  padding: const EdgeInsets.fromLTRB(12, 30, 12, 8),
                  child: SafeArea(
                    top: false,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Row(
                          children: [
                            IconButton(
                              icon: const Icon(Icons.replay_10, color: Colors.white),
                              onPressed: () => _seekBy(-10),
                            ),
                            IconButton(
                              iconSize: 40,
                              icon: Icon(playing ? Icons.pause : Icons.play_arrow, color: Colors.white),
                              onPressed: _togglePlay,
                            ),
                            IconButton(
                              icon: const Icon(Icons.forward_10, color: Colors.white),
                              onPressed: () => _seekBy(10),
                            ),
                            Text(_fmt(pos), style: const TextStyle(color: Colors.white, fontSize: 12)),
                            Expanded(
                              child: Slider(
                                value: dur.inMilliseconds == 0
                                    ? 0
                                    : pos.inMilliseconds.clamp(0, dur.inMilliseconds).toDouble(),
                                max: dur.inMilliseconds.toDouble().clamp(1, double.infinity),
                                activeColor: const Color(0xFFE50914),
                                inactiveColor: Colors.white24,
                                onChanged: (val) {
                                  v?.seekTo(Duration(milliseconds: val.round()));
                                  setState(() => _controlsVisible = true);
                                },
                                onChangeEnd: (_) => _scheduleHide(),
                              ),
                            ),
                            Text(_fmt(dur), style: const TextStyle(color: Colors.white, fontSize: 12)),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
