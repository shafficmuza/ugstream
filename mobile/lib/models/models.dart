import '../core/config.dart';

// Data models mirroring the ham/ugstream API responses.

class User {
  User({
    required this.id,
    required this.phone,
    this.displayName,
    this.email,
    this.address,
    required this.role,
    this.pinSet = false,
  });
  final String id;
  final String phone;
  final String? displayName;
  final String? email;
  final String? address;
  final String role;

  /// Whether a sign-in PIN is set. Never the PIN itself — the server only ever
  /// reports that one exists.
  final bool pinSet;

  factory User.fromJson(Map<String, dynamic> j) => User(
        id: j['id'].toString(),
        phone: j['phone'] ?? '',
        displayName: j['displayName'],
        email: j['email'],
        address: j['address'],
        role: j['role'] ?? 'user',
        pinSet: j['pinSet'] == true,
      );
}

class TitleCard {
  TitleCard({
    required this.id,
    required this.slug,
    required this.name,
    required this.kind,
    this.posterUrl,
    this.access,
    this.priceUgx,
    this.releaseYear,
    this.firstEpisodeId,
  });
  final String id;
  final String slug;
  final String name;
  final String kind;
  final String? posterUrl;
  final String? access;
  final int? priceUgx;
  final int? releaseYear;
  final String? firstEpisodeId;

  // Generative (not factory) so subclasses like Billboard can super-call it.
  TitleCard.fromJson(Map<String, dynamic> j)
      : id = j['id'].toString(),
        slug = j['slug'] ?? '',
        name = j['name'] ?? '',
        kind = j['kind'] ?? 'movie',
        posterUrl = AppConfig.absUrl(j['posterUrl']),
        access = j['access'],
        priceUgx = j['priceUgx'],
        releaseYear = j['releaseYear'],
        firstEpisodeId = j['firstEpisodeId']?.toString();
}

class Billboard extends TitleCard {
  Billboard.fromJson(Map<String, dynamic> j)
      : description = j['description'],
        bannerUrl = AppConfig.absUrl(j['bannerUrl']),
        super.fromJson(j);
  final String? description;
  final String? bannerUrl;
}

class Rail {
  Rail({required this.key, required this.name, required this.titles});
  final String key;
  final String name;
  final List<TitleCard> titles;

  factory Rail.fromJson(Map<String, dynamic> j) => Rail(
        key: j['key'] ?? '',
        name: j['rail'] ?? '',
        titles: ((j['titles'] as List?) ?? []).map((t) => TitleCard.fromJson(t)).toList(),
      );
}

class HomeData {
  HomeData({this.billboard, required this.rails});
  final Billboard? billboard;
  final List<Rail> rails;

  factory HomeData.fromJson(Map<String, dynamic> j) => HomeData(
        billboard: j['billboard'] != null ? Billboard.fromJson(j['billboard']) : null,
        rails: ((j['rails'] as List?) ?? []).map((r) => Rail.fromJson(r)).toList(),
      );
}

class Episode {
  Episode({required this.id, required this.season, required this.number, this.name, required this.cfStatus, this.durationSecs});
  final String id;
  final int season;
  final int number;
  final String? name;
  final String cfStatus;
  final int? durationSecs;

  factory Episode.fromJson(Map<String, dynamic> j) => Episode(
        id: j['id'].toString(),
        season: j['season'] ?? 1,
        number: j['number'] ?? 1,
        name: j['name'],
        cfStatus: j['cfStatus'] ?? 'pending',
        durationSecs: j['durationSecs'],
      );
  bool get ready => cfStatus == 'ready';
}

class TitleDetail {
  TitleDetail({
    required this.id,
    required this.name,
    required this.slug,
    required this.kind,
    this.description,
    required this.genres,
    required this.episodes,
    this.posterUrl,
    this.bannerUrl,
    required this.access,
    this.priceUgx,
  });
  final String id;
  final String name;
  final String slug;
  final String kind;
  final String? description;
  final List<String> genres;
  final List<Episode> episodes;
  final String? posterUrl;
  final String? bannerUrl;
  final String access;
  final int? priceUgx;

  factory TitleDetail.fromJson(Map<String, dynamic> j) => TitleDetail(
        id: j['id'].toString(),
        name: j['name'] ?? '',
        slug: j['slug'] ?? '',
        kind: j['kind'] ?? 'movie',
        description: j['description'],
        genres: ((j['genres'] as List?) ?? []).map((g) => g.toString()).toList(),
        episodes: ((j['episodes'] as List?) ?? []).map((e) => Episode.fromJson(e)).toList(),
        posterUrl: AppConfig.absUrl(j['posterUrl']),
        bannerUrl: AppConfig.absUrl(j['bannerUrl']),
        access: j['access'] ?? 'subscription',
        priceUgx: j['priceUgx'],
      );

  Episode? get firstPlayable {
    for (final e in episodes) {
      if (e.ready) return e;
    }
    return null;
  }
}

class PlayInfo {
  PlayInfo({
    required this.provider,
    required this.playbackUrl,
    required this.resumeAt,
    this.durationSecs = 0,
    this.titleName,
    this.epLabel,
  });
  final String provider;
  final String playbackUrl;
  final int resumeAt;

  /// Running time as the server knows it, 0 when unknown. The player prefers
  /// this over the duration AVPlayer/ExoPlayer reads off the HLS manifest,
  /// which can be a segment out or momentarily 0.
  final int durationSecs;
  final String? titleName;
  final String? epLabel;

  factory PlayInfo.fromJson(Map<String, dynamic> j) {
    final ep = j['episode'] as Map?;
    return PlayInfo(
      provider: j['provider'] ?? 'cloudflare',
      playbackUrl: j['playbackUrl'] ?? '',
      resumeAt: (j['resumeAt'] ?? 0) as int,
      durationSecs: (j['durationSecs'] ?? 0) as int,
      titleName: (j['title'] as Map?)?['name'],
      epLabel: ep != null && (j['title'] as Map?)?['kind'] == 'series' ? 'S${ep['season']} E${ep['number']}' : null,
    );
  }
}

class ContinueItem {
  ContinueItem({required this.episodeId, required this.positionSecs, this.durationSecs, this.thumbnailUrl, required this.title, this.kind});
  final String episodeId;
  final int positionSecs;
  final int? durationSecs;
  final String? thumbnailUrl;
  final TitleCard title;
  final String? kind;

  factory ContinueItem.fromJson(Map<String, dynamic> j) {
    final t = (j['title'] as Map?) ?? {};
    return ContinueItem(
      episodeId: j['episodeId'].toString(),
      positionSecs: j['positionSecs'] ?? 0,
      durationSecs: j['durationSecs'],
      thumbnailUrl: AppConfig.absUrl(j['thumbnailUrl']),
      kind: t['kind'],
      title: TitleCard(id: '', slug: t['slug'] ?? '', name: t['name'] ?? '', kind: t['kind'] ?? 'movie', posterUrl: AppConfig.absUrl(t['posterUrl'])),
    );
  }
  double get progress => (durationSecs != null && durationSecs! > 0) ? (positionSecs / durationSecs!).clamp(0, 1) : 0;
}

class Plan {
  Plan({required this.id, required this.name, required this.priceUgx, required this.durationDays});
  final int id;
  final String name;
  final int priceUgx;
  final int durationDays;
  factory Plan.fromJson(Map<String, dynamic> j) => Plan(
        id: j['id'],
        name: j['name'] ?? '',
        priceUgx: j['priceUgx'] ?? 0,
        durationDays: j['durationDays'] ?? 0,
      );
}

class PayMethod {
  PayMethod({required this.method, required this.provider, required this.enabled, this.label});
  final String method; // 'card' | 'mobile_money'
  final String provider;
  final bool enabled;
  final String? label;
  factory PayMethod.fromJson(Map<String, dynamic> j) => PayMethod(
        method: j['method'],
        provider: j['provider'] ?? '',
        enabled: j['enabled'] ?? false,
        label: j['label'],
      );
}

class CheckoutResult {
  CheckoutResult({required this.paymentId, this.provider, this.actionType, this.actionUrl, this.checkoutUrl});
  final String paymentId;
  final String? provider;
  final String? actionType; // 'redirect' | 'phone_prompt'
  final String? actionUrl;
  final String? checkoutUrl;
  factory CheckoutResult.fromJson(Map<String, dynamic> j) {
    final action = j['action'] as Map?;
    return CheckoutResult(
      paymentId: j['paymentId'].toString(),
      provider: j['provider'],
      actionType: action?['type'],
      actionUrl: action?['url'],
      checkoutUrl: j['checkoutUrl'],
    );
  }
}
