import 'dart:async';
import 'dart:io' show Platform;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:video_player/video_player.dart';
import '../core/api_client.dart';
import '../core/auth.dart';
import '../models/models.dart';
import '../services/catalog.dart';
import '../widgets/cast_button.dart';
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
      } else if (e.statusCode == 409 && context.mounted) {
        // Concurrent-stream limit. Entitled, just watching elsewhere — offer a
        // retry rather than a dead-end message, since the condition clears the
        // moment the other device stops.
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(e.message),
            duration: const Duration(seconds: 8),
            action: SnackBarAction(
              label: 'Retry',
              onPressed: () => open(context, episodeId, startAt: startAt),
            ),
          ),
        );
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
  /// Brief centre icon flashed on a double-tap seek.
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

  /// Show/hide the controls overlay (what a single tap does on Netflix).
  void _toggleControls() {
    setState(() => _controlsVisible = !_controlsVisible);
    if (_controlsVisible) _scheduleHide();
  }

  /// Play/pause — driven by the centre button, not by tapping the video.
  void _togglePlay() {
    final v = _video;
    if (v == null || !v.value.isInitialized) return;
    if (v.value.isPlaying) {
      v.pause();
      _hideTimer?.cancel();
      setState(() => _controlsVisible = true);
    } else {
      v.play();
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
    // Free the stream slot for the account's other devices right away.
    _catalog.releaseStream();
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

          // Netflix gesture model:
          //  - single tap on the video toggles the controls overlay (playback
          //    is unaffected); pausing is the big centre button below
          //  - double tap on the left/right half seeks -10s/+10s
          // Tap no longer pauses, so the ~300ms double-tap arbitration delay
          // is imperceptible here.
          Row(
            children: [
              Expanded(
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: _toggleControls,
                  onDoubleTap: () => _seekBy(-10),
                ),
              ),
              Expanded(
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: _toggleControls,
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

          // Centre play/pause — the primary control, like Netflix.
          if (_ready)
            AnimatedOpacity(
              opacity: _controlsVisible ? 1 : 0,
              duration: const Duration(milliseconds: 200),
              child: IgnorePointer(
                ignoring: !_controlsVisible,
                child: Center(
                  child: Material(
                    color: Colors.black45,
                    shape: const CircleBorder(),
                    child: IconButton(
                      iconSize: 64,
                      padding: const EdgeInsets.all(18),
                      icon: Icon(playing ? Icons.pause : Icons.play_arrow, color: Colors.white),
                      onPressed: _togglePlay,
                    ),
                  ),
                ),
              ),
            ),

          // Buffering spinner while the player stalls mid-playback.
          if (_ready && (value?.isBuffering ?? false))
            const Center(child: CircularProgressIndicator(color: Color(0xFFE50914))),

          // Top chrome: back at the top-left, AirPlay at the top-right,
          // title between them. Kept out of the centre so it never competes
          // with the play/pause button.
          AnimatedOpacity(
            opacity: _controlsVisible ? 1 : 0,
            duration: const Duration(milliseconds: 200),
            child: IgnorePointer(
              ignoring: !_controlsVisible,
              child: SafeArea(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Material(
                        color: Colors.black54,
                        shape: const CircleBorder(),
                        child: IconButton(
                          iconSize: 30,
                          padding: const EdgeInsets.all(12),
                          constraints: const BoxConstraints(minWidth: 54, minHeight: 54),
                          icon: const Icon(Icons.arrow_back, color: Colors.white),
                          tooltip: 'Back',
                          onPressed: () => Navigator.of(context).maybePop(),
                        ),
                      ),
                      if (widget.play.titleName != null)
                        Expanded(
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
                            child: Text(
                              [widget.play.titleName, widget.play.epLabel].where((e) => e != null).join(' · '),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(color: Colors.white, fontSize: 16, shadows: [Shadow(blurRadius: 6)]),
                            ),
                          ),
                        )
                      else
                        const Spacer(),
                      // Chromecast (both platforms). Pauses local playback
                      // when a cast starts so audio isn't doubled.
                      CastButton(
                        streamUrl: widget.play.playbackUrl,
                        title: widget.play.titleName ?? 'Muza Watch',
                        startAtSeconds: _video?.value.position.inSeconds ?? 0,
                        onCastStarted: () => _video?.pause(),
                      ),
                      const SizedBox(width: 8),
                      // AirPlay picker (iOS only — Apple requires its own
                      // native view for route selection).
                      if (Platform.isIOS)
                        Container(
                          width: 54,
                          height: 54,
                          padding: const EdgeInsets.all(9),
                          decoration: const BoxDecoration(color: Colors.black54, shape: BoxShape.circle),
                          child: const UiKitView(viewType: 'airplay_button'),
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
                              iconSize: 30,
                              icon: const Icon(Icons.replay_10, color: Colors.white),
                              onPressed: () => _seekBy(-10),
                            ),
                            IconButton(
                              iconSize: 30,
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
