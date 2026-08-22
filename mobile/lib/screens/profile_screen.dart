import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/app_version.dart';
import '../core/auth.dart';
import 'delete_account_screen.dart';
import '../core/branding.dart';
import '../core/store_policy.dart';
import 'subscribe_screen.dart';

const _accent = Color(0xFFE50914);
const _cardColor = Color(0xFF151515);
const _cardBorder = Color(0x14FFFFFF);
const _fieldColor = Color(0xFF1E1E1E);
const _chipColor = Color(0xFF242424);
const _hairline = Color(0x12FFFFFF);
const _muted = Color(0xFF9A9A9A);
const _faint = Color(0xFF6E6E6E);

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});
  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _address = TextEditingController();
  bool _busy = false;
  String? _msg;

  /// Null until the platform answers, and forever if it cannot — never a
  /// literal in the source, so it always matches the installed binary.
  String? _version;

  @override
  void initState() {
    super.initState();
    final u = context.read<Auth>().user;
    _name.text = u?.displayName ?? '';
    _email.text = u?.email ?? '';
    _address.text = u?.address ?? '';
    _loadVersion();
  }

  Future<void> _loadVersion() async {
    final v = await AppVersion.load();
    if (!mounted) return;
    setState(() => _version = v);
  }

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _address.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      setState(() => _msg = 'Name is required.');
      return;
    }
    setState(() { _busy = true; _msg = null; });
    try {
      await context.read<Auth>().updateProfile(
            displayName: _name.text.trim(), email: _email.text.trim(), address: _address.text.trim());
      setState(() => _msg = 'Saved.');
    } catch (e) {
      setState(() => _msg = e.toString());
    } finally {
      setState(() => _busy = false);
    }
  }

  /// Set or change the PIN. Changing asks for the current one, so a phone left
  /// unattended for a moment cannot be used to lock its owner out.
  Future<void> _editPin(BuildContext context, {required bool hasPin}) async {
    final current = TextEditingController();
    final next = TextEditingController();
    final confirm = TextEditingController();
    String? error;

    await showDialog<void>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) => AlertDialog(
          backgroundColor: const Color(0xFF161616),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
          title: Text(hasPin ? 'Change your PIN' : 'Set a PIN'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (hasPin)
                TextField(
                  controller: current,
                  obscureText: true,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: 'Current PIN'),
                ),
              TextField(
                controller: next,
                obscureText: true,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'New PIN (4–8 digits)'),
              ),
              TextField(
                controller: confirm,
                obscureText: true,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'Confirm new PIN'),
              ),
              if (error != null) ...[
                const SizedBox(height: 10),
                Text(error!, style: const TextStyle(color: Colors.redAccent, fontSize: 12.5)),
              ],
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () async {
                if (next.text.trim() != confirm.text.trim()) {
                  setDialogState(() => error = 'The two PINs do not match.');
                  return;
                }
                try {
                  await context.read<Auth>().setPin(
                        next.text.trim(),
                        currentPin: hasPin ? current.text.trim() : null,
                      );
                  if (dialogContext.mounted) Navigator.of(dialogContext).pop();
                } catch (e) {
                  setDialogState(() => error = e.toString());
                }
              },
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _removePin(BuildContext context) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: const Color(0xFF161616),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        title: const Text('Remove your PIN?'),
        content: const Text(
            'You will go back to receiving a code by SMS each time you sign in.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: const Text('Remove')),
        ],
      ),
    );
    if (ok == true && context.mounted) await context.read<Auth>().clearPin();
  }

  @override
  Widget build(BuildContext context) {
    final u = context.watch<Auth>().user;
    final branding = context.watch<Branding>();
    final push = context.read<Auth>().push;
    final hasPin = u?.pinSet == true;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Profile', style: TextStyle(fontWeight: FontWeight.w700)),
      ),
      body: ListView(
        padding: EdgeInsets.zero,
        children: [
          _ProfileHeader(
            name: u?.displayName,
            phone: u?.phone,
            // Only shown when the account is on a non-standard catalogue. An
            // ordinary viewer sees nothing here; someone whose catalogue looks
            // wrong finds out why without anyone querying the database.
            audienceLabel: u?.audienceLabel,
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _Section(
                  title: 'Account',
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 18, 16, 18),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          _Field(label: 'Name', controller: _name, hint: 'Your name', required: true),
                          const SizedBox(height: 16),
                          _Field(
                            label: 'Email',
                            controller: _email,
                            hint: 'you@example.com',
                            keyboardType: TextInputType.emailAddress,
                          ),
                          const SizedBox(height: 16),
                          _Field(label: 'Address', controller: _address, hint: 'Where you live'),
                          if (_msg != null) ...[
                            const SizedBox(height: 14),
                            _SaveMessage(message: _msg!),
                          ],
                          const SizedBox(height: 18),
                          SizedBox(
                            height: 48,
                            child: FilledButton(
                              style: FilledButton.styleFrom(
                                backgroundColor: _accent,
                                foregroundColor: Colors.white,
                                disabledBackgroundColor: const Color(0xFF3A1216),
                                disabledForegroundColor: Colors.white54,
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                                textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
                              ),
                              onPressed: _busy ? null : _save,
                              child: Text(_busy ? 'Saving…' : 'Save'),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),

                // Absent on iOS rather than disabled: a visible entry to a purchase
                // is itself a "call to action" under guideline 3.1.1.
                if (purchasesAllowed)
                  _Section(
                    title: 'Subscription',
                    children: [
                      _Row(
                        icon: Icons.card_membership,
                        title: 'Subscribe / manage plan',
                        subtitle: 'Plans, payment and renewal',
                        trailing: const Icon(Icons.chevron_right, color: _faint),
                        onTap: () => Navigator.of(context)
                            .push(MaterialPageRoute(builder: (_) => const SubscribeScreen())),
                      ),
                    ],
                  ),

                // The PIN is what keeps a returning sign-in free, so changing and
                // removing it both live in plain sight rather than buried.
                _Section(
                  title: 'Security',
                  children: [
                    _Row(
                      icon: hasPin ? Icons.pin : Icons.pin_outlined,
                      title: hasPin ? 'Change sign-in PIN' : 'Set a sign-in PIN',
                      subtitle: hasPin
                          ? 'You sign in with your PIN instead of waiting for a text.'
                          : 'Sign in without waiting for a text message.',
                      trailing: const Icon(Icons.chevron_right, color: _faint),
                      onTap: () => _editPin(context, hasPin: hasPin),
                    ),
                    if (hasPin)
                      _Row(
                        icon: Icons.lock_open,
                        iconColor: Colors.orangeAccent,
                        title: 'Remove PIN',
                        subtitle: 'Go back to a code by SMS each time you sign in.',
                        onTap: () => _removePin(context),
                      ),
                  ],
                ),

                _Section(
                  title: 'Notifications',
                  children: [
                    // The user's own switch, distinct from OS permission: off means the
                    // server deletes this device's token and sends nothing at all.
                    ValueListenableBuilder<bool>(
                      valueListenable: push.enabledNotifier,
                      builder: (context, enabled, _) => _SwitchRow(
                        icon: Icons.notifications_outlined,
                        title: 'Push notifications',
                        subtitle: enabled ? 'New titles and account alerts' : 'This device receives nothing',
                        value: enabled,
                        onChanged: (v) => context.read<Auth>().push.setEnabled(v),
                      ),
                    ),
                    // Push state, surfaced because a store build cannot be attached to a
                    // debugger: without this, a handset that fails to register is
                    // invisible from both ends. It sits directly under the switch it
                    // reports on — as a second row titled "Notifications" it read as a
                    // duplicate of the switch rather than as its status.
                    ValueListenableBuilder<String>(
                      valueListenable: push.statusNotifier,
                      builder: (context, status, _) {
                        final ok = context.read<Auth>().push.hasToken;
                        return _Row(
                          icon: ok ? Icons.notifications_active : Icons.notifications_off,
                          iconColor: ok ? Colors.greenAccent : Colors.orangeAccent,
                          title: 'Delivery status',
                          subtitle: status,
                          trailing: IconButton(
                            icon: const Icon(Icons.refresh, color: _muted),
                            tooltip: 'Retry registration',
                            onPressed: () => context.read<Auth>().push.onSignedIn(),
                          ),
                        );
                      },
                    ),
                  ],
                ),

                SupportSection(
                  contacts: branding.support,
                  appName: branding.appName,
                  userPhone: u?.phone,
                  appVersion: _version,
                  onRetry: () => context.read<Branding>().refresh(),
                ),

                _Section(
                  children: [
                    _Row(
                      icon: Icons.logout,
                      iconColor: Colors.redAccent,
                      titleColor: Colors.redAccent,
                      title: 'Log out',
                      onTap: () => context.read<Auth>().logout(),
                    ),
                    // Account deletion, required by App Store guideline
                    // 5.1.1(v) to be reachable from inside the app. It sits
                    // beside Log out because that is where someone looking to
                    // leave will look — burying it would satisfy the letter of
                    // the rule and not the point of it. The screen it opens is
                    // what makes it hard to do by accident, not its placement.
                    _Row(
                      icon: Icons.person_remove_outlined,
                      iconColor: Colors.redAccent,
                      titleColor: Colors.redAccent,
                      title: 'Delete account',
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => const DeleteAccountScreen()),
                      ),
                    ),
                  ],
                ),

                VersionFooter(version: _version),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Avatar, name and number, over a soft wash of the brand red.
class _ProfileHeader extends StatelessWidget {
  const _ProfileHeader({this.name, this.phone, this.audienceLabel});

  final String? name;
  final String? phone;
  final String? audienceLabel;

  /// First character of whatever we can show, never an empty-string crash: a
  /// saved-then-cleared name arrives as "" rather than null.
  String get _initial {
    final n = name?.trim() ?? '';
    final source = n.isNotEmpty ? n : (phone?.trim() ?? '');
    return source.isEmpty ? '?' : source.substring(0, 1).toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final displayName = (name?.trim().isNotEmpty == true) ? name!.trim() : 'Your profile';
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(20, 4, 20, 28),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0x2EE50914), Color(0x00E50914)],
        ),
      ),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(2.5),
            decoration: const BoxDecoration(
              shape: BoxShape.circle,
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [_accent, Color(0xFF6D0007)],
              ),
            ),
            child: CircleAvatar(
              radius: 38,
              backgroundColor: const Color(0xFF121212),
              child: Text(
                _initial,
                style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w600, color: Colors.white),
              ),
            ),
          ),
          const SizedBox(height: 14),
          Text(
            displayName,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: Colors.white),
          ),
          if (phone?.isNotEmpty == true) ...[
            const SizedBox(height: 4),
            Text(phone!, style: const TextStyle(fontSize: 14, color: _muted)),
          ],
          if (audienceLabel != null) ...[
            const SizedBox(height: 14),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: const Color(0x1FE50914),
                borderRadius: BorderRadius.circular(999),
                border: Border.all(color: const Color(0x66E50914)),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.visibility_outlined, size: 15, color: _accent),
                  const SizedBox(width: 8),
                  Flexible(
                    child: Text(
                      audienceLabel!,
                      style: const TextStyle(fontSize: 12, color: Colors.white70),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// A titled group of rows on one rounded surface. [title] is optional so a
/// lone action (log out) can sit on the same surface without a heading.
class _Section extends StatelessWidget {
  const _Section({this.title, required this.children, this.footer});

  final String? title;
  final List<Widget> children;
  final Widget? footer;

  @override
  Widget build(BuildContext context) {
    final rows = <Widget>[];
    for (var i = 0; i < children.length; i++) {
      if (i > 0) rows.add(const Divider(height: 1, thickness: 1, color: _hairline, indent: 68, endIndent: 16));
      rows.add(children[i]);
    }
    return Padding(
      padding: const EdgeInsets.only(bottom: 26),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (title != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(6, 0, 6, 10),
              child: Text(
                title!.toUpperCase(),
                style: const TextStyle(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 1.3,
                  color: _muted,
                ),
              ),
            ),
          Container(
            clipBehavior: Clip.antiAlias,
            decoration: BoxDecoration(
              color: _cardColor,
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: _cardBorder),
            ),
            child: Column(children: rows),
          ),
          if (footer != null)
            Padding(padding: const EdgeInsets.fromLTRB(8, 10, 8, 0), child: footer!),
        ],
      ),
    );
  }
}

/// The round icon chip every row leads with, so rows line up whatever they do.
class _IconChip extends StatelessWidget {
  const _IconChip(this.icon, {this.color});
  final IconData icon;
  final Color? color;

  @override
  Widget build(BuildContext context) => Container(
        width: 38,
        height: 38,
        decoration: const BoxDecoration(color: _chipColor, shape: BoxShape.circle),
        child: Icon(icon, size: 19, color: color ?? Colors.white70),
      );
}

class _Row extends StatelessWidget {
  const _Row({
    required this.icon,
    required this.title,
    this.subtitle,
    this.trailing,
    this.onTap,
    this.iconColor,
    this.titleColor,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final VoidCallback? onTap;
  final Color? iconColor;
  final Color? titleColor;

  @override
  Widget build(BuildContext context) => ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        leading: _IconChip(icon, color: iconColor),
        title: Text(
          title,
          style: TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w600,
            color: titleColor ?? Colors.white,
          ),
        ),
        subtitle: subtitle == null
            ? null
            : Padding(
                padding: const EdgeInsets.only(top: 3),
                child: Text(
                  subtitle!,
                  style: const TextStyle(fontSize: 12.5, height: 1.3, color: _faint),
                ),
              ),
        trailing: trailing,
        onTap: onTap,
      );
}

class _SwitchRow extends StatelessWidget {
  const _SwitchRow({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.value,
    required this.onChanged,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    // Themed rather than `activeColor:`, which is deprecated — same brand red
    // on the track, and it survives the next Material 3 switch revision.
    return SwitchTheme(
      data: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith(
            (s) => s.contains(WidgetState.selected) ? Colors.white : null),
        trackColor: WidgetStateProperty.resolveWith(
            (s) => s.contains(WidgetState.selected) ? _accent : null),
        trackOutlineColor: WidgetStateProperty.resolveWith(
            (s) => s.contains(WidgetState.selected) ? _accent : null),
      ),
      child: SwitchListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        secondary: _IconChip(icon),
        title: Text(title,
            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Colors.white)),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 3),
          child: Text(subtitle, style: const TextStyle(fontSize: 12.5, height: 1.3, color: _faint)),
        ),
        value: value,
        onChanged: onChanged,
      ),
    );
  }
}

class _Field extends StatelessWidget {
  const _Field({
    required this.label,
    required this.controller,
    this.hint,
    this.keyboardType,
    this.required = false,
  });

  final String label;
  final TextEditingController controller;
  final String? hint;
  final TextInputType? keyboardType;
  final bool required;

  @override
  Widget build(BuildContext context) {
    const radius = BorderRadius.all(Radius.circular(12));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text(label,
                style: const TextStyle(
                    fontSize: 12.5, fontWeight: FontWeight.w600, color: _muted, letterSpacing: 0.2)),
            if (required)
              const Text(' *', style: TextStyle(fontSize: 12.5, color: _accent))
            else
              const Text('  optional', style: TextStyle(fontSize: 11.5, color: _faint)),
          ],
        ),
        const SizedBox(height: 7),
        TextField(
          controller: controller,
          keyboardType: keyboardType,
          style: const TextStyle(fontSize: 15, color: Colors.white),
          decoration: InputDecoration(
            isDense: true,
            hintText: hint,
            hintStyle: const TextStyle(fontSize: 15, color: Color(0xFF5A5A5A)),
            filled: true,
            fillColor: _fieldColor,
            contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
            border: const OutlineInputBorder(borderRadius: radius, borderSide: BorderSide.none),
            enabledBorder: const OutlineInputBorder(
                borderRadius: radius, borderSide: BorderSide(color: _cardBorder)),
            focusedBorder: const OutlineInputBorder(
                borderRadius: radius, borderSide: BorderSide(color: _accent, width: 1.4)),
          ),
        ),
      ],
    );
  }
}

/// The result of a save. Same strings as before — the server's error text is
/// shown verbatim — but a failure no longer looks identical to a success.
class _SaveMessage extends StatelessWidget {
  const _SaveMessage({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) {
    final ok = message == 'Saved.';
    final color = ok ? const Color(0xFF5BD07A) : Colors.redAccent;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(ok ? Icons.check_circle_outline : Icons.error_outline, size: 16, color: color),
        const SizedBox(width: 8),
        Expanded(
          child: Text(message, style: TextStyle(fontSize: 12.5, height: 1.35, color: color)),
        ),
      ],
    );
  }
}

/// Help & support: the channels an admin has configured in the dashboard.
///
/// Public and driven entirely by its parameters rather than by providers, so
/// it can be pumped in a widget test without standing up Auth, Branding and
/// the network behind them.
class SupportSection extends StatelessWidget {
  const SupportSection({
    super.key,
    required this.contacts,
    required this.appName,
    this.userPhone,
    this.appVersion,
    this.onRetry,
  });

  final SupportContacts contacts;
  final String appName;
  final String? userPhone;
  final String? appVersion;

  /// Re-fetch /settings. Used by the empty state, because "no contacts" is far
  /// more often "/settings has not loaded yet" than "the admin set none".
  final VoidCallback? onRetry;

  /// Enough for support to know who is writing without asking twice.
  String get _prefilledMessage {
    final b = StringBuffer('Hi $appName support, I need help with my account.');
    if (userPhone?.isNotEmpty == true) b.write('\n\nMy number: $userPhone');
    if (appVersion != null) b.write('\nApp version: $appVersion');
    return b.toString();
  }

  String get _emailSubject {
    final parts = <String>['$appName support'];
    if (userPhone?.isNotEmpty == true) parts.add(userPhone!);
    if (appVersion != null) parts.add('v$appVersion');
    return parts.join(' — ');
  }

  /// Opens [uri], and when nothing on the handset can — WhatsApp not
  /// installed, no mail app configured — says so while handing over the
  /// address itself, so the viewer is told how to reach support rather than
  /// left at a tap that does nothing.
  static Future<void> _open(
    BuildContext context,
    Uri uri, {
    required String failure,
    required String copyText,
  }) async {
    var opened = false;
    try {
      opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      opened = false;
    }
    if (opened || !context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(failure),
        backgroundColor: const Color(0xFF262626),
        behavior: SnackBarBehavior.floating,
        duration: const Duration(seconds: 7),
        action: SnackBarAction(
          label: 'Copy',
          textColor: _accent,
          onPressed: () => Clipboard.setData(ClipboardData(text: copyText)),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final rows = <Widget>[];

    final whatsappDigits = contacts.whatsappDigits;
    if (whatsappDigits != null) {
      rows.add(_Row(
        icon: Icons.chat_bubble_outline,
        iconColor: const Color(0xFF25D366),
        title: 'WhatsApp',
        subtitle: contacts.whatsapp,
        trailing: const Icon(Icons.open_in_new, size: 18, color: _faint),
        onTap: () => _open(
          context,
          // wa.me wants bare digits; the '?text=' body must be percent-encoded
          // or the message is cut at the first space.
          Uri.parse('https://wa.me/$whatsappDigits?text=${Uri.encodeComponent(_prefilledMessage)}'),
          failure: 'Couldn’t open WhatsApp. Message ${contacts.whatsapp} instead.',
          copyText: contacts.whatsapp!,
        ),
      ));
    }

    final email = contacts.email;
    if (email != null) {
      rows.add(_Row(
        icon: Icons.mail_outline,
        title: 'Email us',
        subtitle: email,
        trailing: const Icon(Icons.open_in_new, size: 18, color: _faint),
        onTap: () => _open(
          context,
          // Built by hand, not with Uri(queryParameters:) — that encodes
          // spaces as '+', which a good many mail clients then show literally
          // in the subject line.
          Uri.parse('mailto:$email?subject=${Uri.encodeComponent(_emailSubject)}'),
          failure: 'No mail app is set up. Write to $email instead.',
          copyText: email,
        ),
      ));
    }

    final phone = contacts.phone;
    if (phone != null) {
      rows.add(_Row(
        icon: Icons.call_outlined,
        title: 'Call us',
        subtitle: phone,
        trailing: const Icon(Icons.open_in_new, size: 18, color: _faint),
        onTap: () => _open(
          context,
          Uri.parse('tel:${phone.replaceAll(RegExp(r'[^0-9+]'), '')}'),
          failure: 'Couldn’t start the call. Dial $phone instead.',
          copyText: phone,
        ),
      ));
    }

    // Never an empty card. The likeliest reason there is nothing to show is
    // that /settings has not been fetched yet — offline, or a first launch —
    // so the empty state offers the retry that fixes that case and stays
    // honest about the other.
    if (rows.isEmpty) {
      rows.add(_Row(
        icon: Icons.support_agent,
        title: 'Contact support',
        subtitle: 'Contact details aren’t available right now. Tap to refresh.',
        trailing: const Icon(Icons.refresh, size: 18, color: _faint),
        onTap: onRetry,
      ));
    }

    final hours = contacts.hours;
    return _Section(
      title: 'Help & support',
      footer: hours == null
          ? null
          : Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.schedule, size: 14, color: _faint),
                const SizedBox(width: 7),
                Expanded(
                  child: Text(hours,
                      style: const TextStyle(fontSize: 12, height: 1.3, color: _faint)),
                ),
              ],
            ),
      children: rows,
    );
  }
}

/// The version line at the foot of Profile.
///
/// Keeps its height whether or not the version has arrived: the plugin answers
/// a frame or two after the screen first builds, and a row that appears out of
/// nothing shoves the list under the reader's thumb.
class VersionFooter extends StatelessWidget {
  const VersionFooter({super.key, required this.version});

  final String? version;

  @override
  Widget build(BuildContext context) => SizedBox(
        height: 44,
        child: Center(
          child: AnimatedOpacity(
            opacity: version == null ? 0 : 1,
            duration: const Duration(milliseconds: 180),
            child: Text(
              version == null ? '' : 'Version $version',
              style: const TextStyle(fontSize: 12, color: _faint, letterSpacing: 0.3),
            ),
          ),
        ),
      );
}
