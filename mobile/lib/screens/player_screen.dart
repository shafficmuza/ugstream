import 'dart:async';
import 'dart:io' show Platform;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:video_player/video_player.dart';
import '../core/api_client.dart';
import '../core/auth.dart';
import '../core/store_policy.dart';
import 'dart:io' show File;
import '../models/models.dart';
import '../services/downloads.dart';
import '../services/catalog.dart';
import '../widgets/cast_button.dart';
import 'subscribe_screen.dart';

class PlayerScreen extends StatefulWidget {
  const PlayerScreen({super.key, required this.episodeId, required this.play, this.startAt, this.localPath});
  final String episodeId;
  final PlayInfo play;
  final int? startAt;

  /// Set when playing a downloaded file: the player reads this path instead
  /// of the network, saves no progress, and never tries to re-resolve a
  /// stream — there may be no connection at all.
  final String? localPath;

  /// Play an offline copy. No entitlement round-trip: the server authorized
  /// this video when it was downloaded, and the entry's own validity window
  /// (checked by the caller) is the offline enforcement.
  static void openLocal(BuildContext context, DownloadEntry entry) {
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => PlayerScreen(
        episodeId: entry.episodeId,
        localPath: entry.filePath,
        play: PlayInfo(
          provider: 'local',
          playbackUrl: '',
          resumeAt: 0,
          titleName: entry.titleName,
          epLabel: entry.episodeLabel,
        ),
      ),
    ));
  }

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
          // iOS builds carry no purchase flow (see store_policy.dart) — the
          // viewer gets told, not sold.
          if (purchasesAllowed) {
            Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SubscribeScreen()));
          } else {
            showNotEntitledNotice(context);
          }
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

class _PlayerScreenState extends State<PlayerScreen> with WidgetsBindingObserver {
  VideoPlayerController? _video;
  Timer? _progressTimer;
  Timer? _hideTimer;
  late final CatalogService _catalog;

  bool _controlsVisible = true;
  bool _ready = false;
  /// Brief centre icon flashed on a double-tap seek.
  IconData? _flashIcon;

  /// Where the finger is while dragging the scrubber, in milliseconds; null
  /// when not dragging. The slider follows this instead of the player's live
  /// position mid-drag — bound straight to the player, every position callback
  /// rewrote the thumb back under the finger and the bar fought the gesture.
  double? _dragMs;

  /// What the tick listener last rebuilt for. Rebuilding on every position
  /// callback re-ran the whole tree — video texture and the iOS AirPlay
  /// UiKitView included — many times a second, for a clock that only shows
  /// whole seconds.
  int _paintedSecond = -1;
  bool _paintedPlaying = false;
  bool _paintedBuffering = false;

  /// Last position that was actually playing — the recovery resume point.
  /// Tracked continuously because after a playback error the controller's
  /// own position can be reset or unreliable.
  int _lastPositionSecs = 0;
  bool _recovering = false;
  int _recoveryAttempts = 0;
  /// True while a resume seek is still settling. Progress saves are suppressed
  /// until it clears so a half-finished resume cannot overwrite the bookmark.
  bool _resumePending = false;

  @override
  void initState() {
    super.initState();
    _catalog = CatalogService(context.read<Auth>().api);
    WidgetsBinding.instance.addObserver(this);
    SystemChrome.setPreferredOrientations([DeviceOrientation.landscapeLeft, DeviceOrientation.landscapeRight]);
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
    widget.localPath != null
        ? _init(widget.localPath!, widget.startAt ?? 0, local: true)
        : _init(widget.play.playbackUrl, widget.startAt ?? widget.play.resumeAt);
  }

  /// Leaving the app is a checkpoint, not a pause we can ignore.
  ///
  /// The app declares no `audio` background mode, so iOS stops playback the
  /// moment it is backgrounded and may terminate the process without ever
  /// running dispose(). Everything dispose() was relied on for — saving the
  /// position, handing back the concurrent-stream slot — was therefore lost
  /// exactly when the viewer was most likely to come back and resume.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused) {
      // Actually backgrounded. iOS has stopped the video already; pausing
      // keeps our own state honest so the button is right on return.
      _video?.pause();
      _saveProgress();
    } else if (state == AppLifecycleState.inactive) {
      // Transient: Control Centre, a notification banner, the AirPlay route
      // picker. Worth a checkpoint, but pausing here would stop playback
      // every time the viewer opened the AirPlay menu in this very screen.
      _saveProgress();
    }
  }

  Future<void> _init(String url, int startAtSecs, {bool local = false}) async {
    final v = local
        ? VideoPlayerController.file(File(url))
        : VideoPlayerController.networkUrl(Uri.parse(url));
    _video = v;
    await v.initialize();
    await _resumeTo(v, startAtSecs);
    v.addListener(_onTick);
    if (mounted) setState(() => _ready = true);
    _scheduleHide();
    if (widget.localPath == null) {
      _progressTimer ??= Timer.periodic(const Duration(seconds: 15), (_) => _saveProgress());
    }
  }

  /// Start playing at [startAtSecs], confirming the player actually got there.
  ///
  /// Seeking straight after `initialize()` silently failed on iOS: the item is
  /// ready, but an HLS stream's seekable range is not populated yet, so
  /// AVPlayer drops the seek and starts from zero. That alone would only be an
  /// annoyance — what made it destructive is the 15s progress timer, which
  /// then saved the new position over the real bookmark. One failed resume
  /// erased where the viewer had got to, so the episode could never be resumed
  /// again.
  ///
  /// Playing first gives AVPlayer a live timeline to seek within, and the
  /// landing position is verified rather than assumed: ExoPlayer honours the
  /// first attempt, AVPlayer occasionally needs another.
  Future<void> _resumeTo(VideoPlayerController v, int startAtSecs) async {
    if (startAtSecs <= 0) {
      await v.play();
      return;
    }
    // Hold off the progress timer until the seek has landed, so a slow or
    // failed resume can never overwrite the saved position with ~0.
    _resumePending = true;
    final target = Duration(seconds: startAtSecs);
    try {
      await v.play();
      for (var attempt = 0; attempt < 3; attempt++) {
        await v.seekTo(target);
        // A seek lands on the nearest decodable frame, so exact equality never
        // holds on HLS — anything within a segment of the target is a success.
        final landed = (await v.position) ?? Duration.zero;
        if ((landed - target).abs() <= const Duration(seconds: 10)) break;
        await Future.delayed(const Duration(milliseconds: 300));
      }
      _lastPositionSecs = startAtSecs;
    } finally {
      // Always clear it: leaving it set on a throw would silently disable
      // progress saving for the rest of the sitting.
      _resumePending = false;
    }
  }

  void _onTick() {
    final value = _video?.value;
    if (value != null && !value.hasError) {
      final pos = value.position.inSeconds;
      if (pos > 0) _lastPositionSecs = pos;
    }
    // The signed playback URL can lapse (e.g. the app sat paused for many
    // hours) — the stream then dies with a token error mid-episode. Netflix
    // behaviour is to resume seamlessly, so fetch a fresh URL and drop the
    // viewer back on the exact second, instead of freezing on a dead frame.
    if (value != null && value.hasError && !_recovering) {
      _recover();
    }
    if (!mounted || value == null) return;

    // Repaint only when something the UI actually shows has changed.
    final second = value.position.inSeconds;
    if (second == _paintedSecond &&
        value.isPlaying == _paintedPlaying &&
        value.isBuffering == _paintedBuffering) {
      return;
    }
    _paintedSecond = second;
    _paintedPlaying = value.isPlaying;
    _paintedBuffering = value.isBuffering;
    setState(() {}); // drives the scrubber/time labels
  }

  /// Total running time, preferring the server's figure.
  ///
  /// The player's own duration comes from the HLS manifest and can be a
  /// segment out, or 0 while the manifest is still loading or just after a
  /// recovery. Seek clamping used it unguarded, so a momentary 0 made every
  /// forward seek clamp to zero and throw the viewer back to the start.
  Duration get _duration {
    final own = _video?.value.duration ?? Duration.zero;
    if (own > Duration.zero) return own;
    return Duration(seconds: widget.play.durationSecs);
  }

  Future<void> _recover() async {
    if (_recovering || !mounted) return;
    _recovering = true;
    _recoveryAttempts += 1;
    try {
      final old = _video;
      _video = null;
      old?.removeListener(_onTick);
      await old?.dispose();
      if (_recoveryAttempts > 3) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Playback keeps failing. Please try again.')),
          );
          Navigator.of(context).maybePop();
        }
        return;
      }
      if (mounted) setState(() => _ready = false);
      if (widget.localPath != null) {
        await _init(widget.localPath!, _lastPositionSecs, local: true);
        _recovering = false;
        return;
      }
      final fresh = await _catalog.play(widget.episodeId);
      if (!mounted) return;
      await _init(fresh.playbackUrl, _lastPositionSecs);
      // Recovered. The budget is for a stream failing repeatedly, not for a
      // long film that legitimately needs a fresh URL every few hours — a
      // cumulative count gave up on the fourth success of the sitting.
      _recoveryAttempts = 0;
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Connection lost. Please reopen the video.')),
        );
        Navigator.of(context).maybePop();
      }
    } finally {
      _recovering = false;
    }
  }

  void _saveProgress() {
    // Never report a position while a resume is still settling — that is the
    // window in which a failed seek would otherwise persist ~0 over a real
    // bookmark and lose the viewer's place permanently.
    if (_resumePending) return;
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
      // Pausing is the natural checkpoint — the web player has always saved
      // here, and without it a viewer who pauses and walks away loses up to
      // 15 seconds off their bookmark.
      _saveProgress();
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
    unawaited(_seekTo(v.value.position + Duration(seconds: seconds)));
    _flash(seconds < 0 ? Icons.replay_10 : Icons.forward_10);
    setState(() => _controlsVisible = true);
    _scheduleHide();
  }

  /// Seek, clamped into the episode. An unknown duration clamps the lower
  /// bound only — clamping to a zero upper bound is what sent forward seeks
  /// to the beginning.
  Future<void> _seekTo(Duration target) async {
    final v = _video;
    if (v == null || !v.value.isInitialized) return;
    final max = _duration;
    var clamped = target < Duration.zero ? Duration.zero : target;
    if (max > Duration.zero && clamped > max) clamped = max;
    await v.seekTo(clamped);
  }

  /// Finish a scrub: seek once, and keep the bar under the finger until the
  /// player has actually moved. Releasing the thumb before the seek resolves
  /// would snap it back to the old position for a beat and then jump.
  Future<void> _commitDrag(double ms) async {
    await _seekTo(Duration(milliseconds: ms.round()));
    if (mounted) setState(() => _dragMs = null);
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
    WidgetsBinding.instance.removeObserver(this);
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
    final dur = _duration;
    // While dragging, the bar shows the finger's position, not the player's.
    final pos = _dragMs != null
        ? Duration(milliseconds: _dragMs!.round())
        : (value?.position ?? Duration.zero);
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
                              // Dragging moves the thumb only; the seek is
                              // issued once, on release. Seeking on every
                              // drag frame meant tens of zero-tolerance
                              // seeks per gesture — each one an HLS segment
                              // fetch and decode on iOS, which AVPlayer
                              // coalesces and reorders — and since nothing
                              // seeked on release, the viewer landed wherever
                              // the last mid-drag seek happened to resolve
                              // rather than where they let go.
                              child: Slider(
                                value: dur.inMilliseconds == 0
                                    ? 0
                                    : pos.inMilliseconds.clamp(0, dur.inMilliseconds).toDouble(),
                                max: dur.inMilliseconds.toDouble().clamp(1, double.infinity),
                                activeColor: const Color(0xFFE50914),
                                inactiveColor: Colors.white24,
                                onChangeStart: (val) {
                                  _hideTimer?.cancel();
                                  setState(() {
                                    _dragMs = val;
                                    _controlsVisible = true;
                                  });
                                },
                                onChanged: (val) => setState(() => _dragMs = val),
                                onChangeEnd: _commitDrag,
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
